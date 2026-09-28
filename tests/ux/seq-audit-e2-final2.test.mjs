/**
 * Audit séquences 2026-09-25, lot E2, dernière passe (relecture ciblée de la
 * vague finale).
 *
 * D1 (contrat §7) : une séquence désactivée n'envoie rien, et ses exécutions
 * restent en attente sans être sautées ni annulées. Les contrôles de fond
 * d'E2 qui expirent, réarment ou vérifient chez le fournisseur filtrent donc
 * outreach_sequences.is_active DANS la requête, comme le janitor quota_blocked
 * d'E1 (jointure interne filtrée).
 *
 * Lancer : node --test tests/ux/seq-audit-e2-final2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');

// Découpe tolérante (chaîne vide si le repère de début manque).
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};
const count = (src, re) => (src.match(re) || []).length;

const checkReplies = slice(engine, 'async function handleCheckReplies', 'async function handleCheckTimeouts');
const timeouts = slice(engine, 'async function handleCheckTimeouts', 'async function handleCheckWaitEvents');
const waitSelectDecl = slice(timeouts, 'const waitSelect = ', 'const waitSources = [');
const timeoutSources = slice(timeouts, 'const waitSources = [', 'let checked = 0;');
const timeoutLoop = slice(timeouts, 'let checked = 0;');
const waitEvents = slice(engine, 'async function handleCheckWaitEvents', '// ============ UTILITIES');
const phase1 = slice(waitEvents, '// Phase 1', '// Phase 2');
const phase2 = slice(waitEvents, '// Phase 2');

// Séquence jointe DANS l'embed de l'inscription (pas de parenthèse entre les
// deux : l'alias est bien enrollment.sequence), jointure interne.
const SEQUENCE_IN_ENROLLMENT = /enrollment:sequence_enrollments!inner\([^()`]*sequence:outreach_sequences!inner\(is_active\)\)/;
const ACTIVE = /\.eq\('enrollment\.status', 'active'\)/g;
const ACTIVE_AND_SEQUENCE_ACTIVE = /\.eq\('enrollment\.status', 'active'\)\s*\.eq\('enrollment\.sequence\.is_active', true\)/g;
const EXEC_READ = /\.from\('sequence_step_executions'\)\s*\.select\(/g;

// ---------------------------------------------------------------- 1. [low] engine-conditions-channels-1
test('engine-conditions-channels-1 — check_timeouts : attentes des séquences actives seulement (D1)', () => {
  assert.ok(waitSelectDecl && timeoutSources && timeoutLoop, 'lecture des attentes introuvable');
  assert.match(waitSelectDecl, SEQUENCE_IN_ENROLLMENT, 'séquence non jointe à l\'inscription');
  // Les deux sources (avec délai, sans délai) lisent cette sélection et filtrent is_active.
  assert.equal(count(timeoutSources, /\.select\(waitSelect\)/g), 2);
  assert.equal(count(timeoutSources, ACTIVE_AND_SEQUENCE_ACTIVE), 2, 'filtre is_active manquant sur une source');
  assert.equal(count(timeoutSources, ACTIVE), 2);
  // Expiration, réarmement et branche de délai ne portent que sur les lignes
  // de ces sources : aucune autre lecture d'exécutions dans la boucle.
  assert.match(timeoutLoop, /await source\.query\(\)\.range\(offset, offset \+ WAIT_SCAN_PAGE_SIZE - 1\)/);
  assert.equal(count(timeoutLoop, EXEC_READ), 0);
  assert.ok(timeoutLoop.indexOf('if (isConnectionWaitSatisfied(step, enrollment)) {') !== -1, 'réarmement introuvable');
  assert.ok(timeoutLoop.indexOf('await scheduleNextStep(supabase, enrollment, step.step_order, step.timeout_branch_step_id') !== -1, 'branche de délai introuvable');
  // Seule lecture non filtrée : les attentes d'inscriptions closes, annulées (jamais planifiées).
  const beforeSources = slice(timeouts, 'async function handleCheckTimeouts', 'const waitSources = [');
  assert.equal(count(beforeSources, EXEC_READ), 1);
  assert.match(beforeSources, /\.in\('enrollment\.status', TERMINAL_ENROLLMENT_STATUSES\)/);
  assert.doesNotMatch(beforeSources, /scheduleNextStep\(/);
});

test('engine-conditions-channels-1 — check_wait_events : phases 1 et 2 limitées aux séquences actives (D1)', () => {
  assert.ok(phase1 && phase2, 'phases de check_wait_events introuvables');
  // Phase 1 (réarmement sans appel au fournisseur).
  assert.equal(count(phase1, EXEC_READ), 1);
  assert.match(phase1, SEQUENCE_IN_ENROLLMENT);
  assert.equal(count(phase1, ACTIVE_AND_SEQUENCE_ACTIVE), 1);
  assert.equal(count(phase1, ACTIVE), 1);
  // Phase 2 (lecture de profil journalisée au ledger, vérification de réponse).
  assert.equal(count(phase2, EXEC_READ), 1);
  assert.match(phase2, SEQUENCE_IN_ENROLLMENT);
  assert.match(phase2, /enrollment:sequence_enrollments!inner\(\*, sequence:outreach_sequences!inner\(is_active\)\)/, 'inscription entière toujours lue');
  assert.equal(count(phase2, ACTIVE_AND_SEQUENCE_ACTIVE), 1);
  assert.equal(count(phase2, ACTIVE), 1);
  // La lecture de profil ne porte que sur les lignes de cette requête filtrée.
  const readAt = phase2.indexOf('await readProfileForSend(');
  const queryAt = phase2.indexOf(".eq('enrollment.sequence.is_active', true)");
  assert.ok(readAt !== -1 && queryAt !== -1 && queryAt < readAt);
});

test('engine-conditions-channels-1 — la détection de réponse de fond reste ouverte aux séquences désactivées', () => {
  // Une réponse clôt l'inscription sans rien envoyer : check_replies n'est
  // pas filtré par is_active, et prend le relais de la phase 2 pour ces séquences.
  assert.ok(checkReplies, 'handleCheckReplies introuvable');
  // Décision 9 : actives, et terminées depuis moins de 14 jours.
  assert.match(checkReplies, /\.or\(`status\.eq\.active,and\(status\.eq\.completed,/);
  assert.doesNotMatch(checkReplies, /is_active/);
});
