/**
 * Audit séquences 2026-09-25, dernière passe du lot E1 (moteur process-sequences,
 * zone E1) : points de la relecture ciblée de la vague finale et §8 du contrat.
 *
 * Invariants épinglés par inspection de source (même style que
 * tests/ux/seq-audit-e1-final.test.mjs), plus le comportement des règles pures
 * quand Node importe le TypeScript. Tests Deno complets :
 * supabase/functions/_shared/sequence-{engine,cycle}-rules.test.ts.
 *
 * Lancer : node --test tests/ux/seq-audit-e1-last.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');
const engineRules = read('supabase/functions/_shared/sequence-engine-rules.ts');
const cycleRules = read('supabase/functions/_shared/sequence-cycle-rules.ts');

// Découpe tolérante (chaîne vide si le repère manque).
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const resumeHandler = slice(engine, 'async function handleResumeEnrollments', 'async function resumeOneEnrollment');
const markReplied = slice(engine, 'async function handleMarkReplied', 'async function acquireLock');
const closeReplied = slice(engine, 'async function closeEnrollmentAsReplied', 'async function stopSiblingEnrollmentsAfterReply');
const siblings = slice(engine, 'async function stopSiblingEnrollmentsAfterReply', 'async function cancelPendingExecutions');
const processFn = slice(engine, 'async function handleProcess(', 'async function handleCheckReplies');
const selection = slice(processFn, 'const selectionRead = await readCycleSelection<DueExecution>(', 'if (fetchError) throw fetchError;');

let canImportTs = true;
try {
  await import('../../supabase/functions/_shared/sequence-cycle-rules.ts');
  await import('../../supabase/functions/_shared/sequence-engine-rules.ts');
} catch {
  canImportTs = false;
}
const tsSkip = !canImportTs && 'Node sans prise en charge du TypeScript';

// ---------------------------------------------------------------- n°1 / n°2
test('n°1 / n°2 — « Marquer comme ayant répondu » sur une inscription terminée ne coupe pas une prise de contact ultérieure', () => {
  // Statut et date de fin lus AVANT la clôture, portée transmise à la clôture.
  assert.match(markReplied, /\.select\('id, status, completed_at, /);
  assert.match(markReplied, /closeEnrollmentAsReplied\(\s*supabase, target, null, 'Réponse marquée manuellement', \['active', 'paused', 'completed'\],\s*siblingStopScope\(enr\.status, enr\.completed_at\),\s*\)/);
  // La clôture passe la portée à l'arrêt des sœurs (défaut : toutes, chemins de détection inchangés).
  assert.match(closeReplied, /siblingScope: SiblingStopScope = \{ kind: 'all' \}\): Promise<\{ changed: boolean; failed: boolean; stoppedSiblings: number \}>/);
  assert.match(closeReplied, /const stoppedSiblings = changed \? await stopSiblingEnrollmentsAfterReply\(supabase, enrollment, siblingScope\) : 0;/);
  assert.match(closeReplied, /return \{ changed, failed: !cancelled, stoppedSiblings \};/);
  // Borne appliquée en base ; date de fin inconnue : aucune sœur arrêtée.
  assert.match(siblings, /if \(!orgId \|\| !filter \|\| scope\.kind === 'none'\) return 0;/);
  assert.match(siblings, /if \(scope\.kind === 'created_before'\) siblingQuery = siblingQuery\.lt\('created_at', scope\.before\);/);
  assert.match(engineRules, /if \(previousStatus !== 'completed'\) return \{ kind: 'all' \};/);
});

test('n°1 / n°2 — mark_replied renvoie stopped_siblings (contrat §8), nombre réel d\'inscriptions arrêtées', () => {
  assert.match(markReplied, /stopped_siblings: closed\.stoppedSiblings,/);
  // Le nombre vient des lignes réellement passées 'stopped' (update … select('id')).
  assert.match(siblings, /\.in\('id', targets\)\.in\('status', \['active', 'paused'\]\)\.select\('id'\);/);
  assert.match(siblings, /return stoppedIds\.length;/);
  assert.doesNotMatch(markReplied, /stopped_other_sequences/);
});

test('n°1 — portée de l\'arrêt des sœurs selon le statut avant clôture (règle pure)', { skip: tsSkip }, async () => {
  const r = await import('../../supabase/functions/_shared/sequence-engine-rules.ts');
  assert.deepEqual(r.siblingStopScope('active', null), { kind: 'all' });
  assert.deepEqual(r.siblingStopScope('paused', null), { kind: 'all' });
  assert.deepEqual(r.siblingStopScope('completed', '2026-03-15T09:00:00+00:00'), { kind: 'created_before', before: '2026-03-15T09:00:00.000Z' });
  assert.deepEqual(r.siblingStopScope('completed', null), { kind: 'none' });
});

// ---------------------------------------------------------------- §8 other_members
test('§8 — reprise par séquence d\'un collaborateur : other_members compte les pauses laissées aux autres membres', () => {
  assert.match(resumeHandler, /let otherMembers = 0;/);
  const block = slice(resumeHandler, "if (callerUserId && caller.role === 'collaborator') {", '} else {');
  // Même filtre que la reprise, SANS created_by.
  assert.match(block, /\.select\('id', \{ count: 'exact', head: true \}\)\s*\.eq\('sequence_id', req\.sequenceId\)\.eq\('status', 'paused'\)\.in\('pause_reason', reasons\);/);
  assert.doesNotMatch(block, /created_by/);
  assert.match(block, /otherMembers = Math\.max\(0, allPaused - \(typeof pausedTotal === 'number' \? pausedTotal : targetIds\.length\)\);/);
  assert.match(resumeHandler, /return json200\(\{ success: true, results, counts, remaining, other_members: otherMembers \}\);/);
});

// ---------------------------------------------------------------- n°3
test('n°3 — famine entre organisations : comptes au plafond exclus en base des pages suivantes', () => {
  assert.match(selection, /if \(exclusionFilter\) pageQuery = pageQuery\.or\(exclusionFilter, \{ referencedTable: 'enrollment' \}\);/);
  assert.match(selection, /\.range\(from, to\)/);
  assert.match(selection, /if \(selectionRead\.error\) throw selectionRead\.error;/, 'première page illisible : le cycle échoue comme avant');
  // Le filtre ne vise que les inscriptions actives sans rotation : closes et rotation restent lues.
  assert.match(cycleRules, /return `status\.neq\.active,assigned_sender_id\.not\.is\.null,account_id\.is\.null,account_id\.not\.in\.\(\$\{ids\.join\(','\)\}\)`;/);
  // Offset = exécutions déjà lues que le filtre courant garde (préfixe continu).
  assert.match(cycleRules, /const from = due\.filter\(\(e\) => keptByAccountExclusion\(e\.enrollment, excluded\)\)\.length;/);
  assert.match(cycleRules, /excluded = accountsAtCycleCap\(deduped, selection\.selected\);/);
});

test('n°3 — 1 200 candidats d\'un compte n\'empêchent plus la lecture des autres comptes (simulation)', { skip: tsSkip }, async () => {
  const r = await import('../../supabase/functions/_shared/sequence-cycle-rules.ts');
  const row = (id, account, action = 'connection_request') => ({
    id, step: { action_type: action },
    enrollment: { profile_id: `p-${id}`, status: 'active', account_id: account, assigned_sender_id: null, sequence_id: 's' },
  });
  const rows = [];
  for (let i = 0; i < 1200; i++) rows.push(row(`a${String(i).padStart(4, '0')}`, 'acc_A'));
  for (let i = 0; i < 6; i++) rows.push(row(`b${i}`, `acc_B${i % 2}`, 'message'));
  const readPage = ({ from, to, exclusionFilter }) => {
    const list = exclusionFilter?.match(/account_id\.not\.in\.\(([^)]*)\)/)?.[1].split(',') ?? [];
    const kept = rows.filter((x) => !exclusionFilter || !list.includes(x.enrollment.account_id));
    return Promise.resolve({ rows: kept.slice(from, to + 1), error: null });
  };
  const { selection, error } = await r.readCycleSelection(readPage);
  assert.equal(error, null);
  const accounts = selection.selected.map((x) => x.enrollment.account_id);
  assert.equal(accounts.filter((a) => a === 'acc_A').length, 3);
  assert.equal(accounts.filter((a) => a.startsWith('acc_B')).length, 6, 'avant : aucune exécution des autres comptes n\'était lue');
});
