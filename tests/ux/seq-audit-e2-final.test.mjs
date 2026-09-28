/**
 * Audit séquences 2026-09-25, lot E2, vague finale (relecture contradictoire).
 *
 * Invariants épinglés par inspection de source, plus les règles pures de
 * supabase/functions/_shared/sequence-wait-guards.ts rejouées quand Node sait
 * importer du TypeScript (tests Deno : sequence-wait-guards.test.ts).
 *
 * Lancer : node --test tests/ux/seq-audit-e2-final.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');
const guardsSrc = read('supabase/functions/_shared/sequence-wait-guards.ts');

// Découpe tolérante (chaîne vide si le repère de début manque).
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const checkReplies = slice(engine, 'async function handleCheckReplies', 'async function handleCheckTimeouts');
const timeouts = slice(engine, 'async function handleCheckTimeouts', 'async function handleCheckWaitEvents');
const timeoutScan = slice(timeouts, 'const waitSources = [');
const waitEvents = slice(engine, 'async function handleCheckWaitEvents', '// ============ UTILITIES');
const phase2 = slice(waitEvents, '// Phase 2');
const resolveForChat = slice(engine, 'async function resolveProfileIdForChat', 'async function checkForReplyAfterDate');
const replyCheck = slice(engine, 'async function checkForReplyAfterDate', 'interface ChatAttendeeInfo');
const messagesCheck = slice(engine, 'async function checkMessagesForReply', 'async function checkHasProspectReplied');
const prospectReplied = slice(engine, 'async function checkHasProspectReplied', 'async function loadReplyReferenceDate');

const count = (src, re) => (src.match(re) || []).length;

// ---------------------------------------------------------------- 1. [high] REV engine-conditions-channels-1
test('REV engine-conditions-channels-1 — expéditeur lu sur is_sender, participants illisibles = issue inconnue', () => {
  assert.ok(messagesCheck, 'checkMessagesForReply introuvable');
  // La décision passe par la règle pure (is_sender, puis is_sender_self, puis participants).
  assert.match(messagesCheck, /const verdict = replyStateOfMessages\(messages, afterTimestamp, attendeeInfo\)/);
  assert.doesNotMatch(messagesCheck, /m\.is_sender_self === true\) return false/, 'plus de filtre sur le seul is_sender_self');
  assert.doesNotMatch(messagesCheck, /skip to be safe/, 'un message indéterminé n\'est plus écarté en silence');
  // Expéditeur indéterminé : 'unknown', jamais 'no_reply'.
  const unknownBranch = slice(messagesCheck, "if (verdict.state === 'unknown')", 'return unreadable');
  assert.match(unknownBranch, /unreadable = true;/);
  assert.match(messagesCheck, /return unreadable \? 'unknown' : 'no_reply';/);
  // Participants lus seulement si un message postérieur n'a aucun indicateur.
  assert.match(messagesCheck, /if \(needsAttendeeResolution\(messages, afterTimestamp\)\) \{/);
  assert.match(messagesCheck, /attendeeInfo = await resolveAttendeeIds\(chat\.id, effectiveApiKey, effectiveDsn\)/);
  // Règle pure : is_sender 0/1 et booléens, avant is_sender_self.
  const flagged = slice(guardsSrc, 'export function flaggedSender', 'export function messageSender');
  assert.match(flagged, /m\.is_sender === true \|\| m\.is_sender === 1\) return 'self'/);
  assert.match(flagged, /m\.is_sender === false \|\| m\.is_sender === 0\) return 'candidate'/);
  assert.ok(flagged.indexOf('m.is_sender ===') < flagged.indexOf('m.is_sender_self'), 'is_sender lu en premier');
  const verdict = slice(guardsSrc, 'export function replyStateOfMessages', '// ─── Échéance');
  assert.match(verdict, /undetermined > 0 \? 'unknown' : 'no_reply'/);
});

// ---------------------------------------------------------------- 2. [high] REV integration-2
test('REV integration-2 — check_timeouts : attente de connexion d\'un candidat déjà en relation réarmée, jamais expirée', () => {
  const timedOutAt = timeouts.indexOf('if (!isWaitTimedOut(waitStartedAt(exec), effectiveTimeout, Date.now())) continue;');
  const guardAt = timeouts.indexOf('if (isConnectionWaitSatisfied(step, enrollment)) {');
  const skipAt = timeouts.indexOf("status: 'skipped', skip_reason: `Timeout");
  assert.notEqual(guardAt, -1, 'aucun contrôle de la connexion avant l\'expiration');
  assert.ok(timedOutAt !== -1 && timedOutAt < guardAt, 'contrôle placé après le test d\'échéance');
  assert.ok(guardAt < skipAt, 'contrôle placé avant le passage en « skipped »');
  const guard = slice(timeouts, 'if (isConnectionWaitSatisfied(step, enrollment)) {', 'const overrideApplied');
  // Même réarmement que la phase 1 de check_wait_events, gardé par le statut.
  assert.match(guard, /\.update\(\{ status: 'scheduled', scheduled_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', exec\.id\)\.eq\('status', 'waiting_event'\)\.select\('id'\)/);
  // Réarmement en échec : on passe à la suivante, sans expirer ni planifier la branche de délai.
  assert.match(guard, /if \(rearmErr\) \{[\s\S]*?continue;\s*\}/);
  assert.doesNotMatch(guard, /scheduleNextStep\(/);
  assert.match(guard, /continue;\s*\}\s*$/);
  // Règle pure : connection_status 'connected' ou relation de premier niveau, attentes de connexion seulement.
  const rule = slice(guardsSrc, 'export function isConnectionWaitSatisfied', '// ─── Lecture des attentes');
  assert.match(rule, /if \(!waitsForConnection\(step\)\) return false;/);
  assert.match(rule, /connection_status === 'connected' \|\| enrollment\?\.network_distance === 'FIRST_DEGREE'/);
});

// ---------------------------------------------------------------- 3. [medium] REV engine-conditions-channels-2
test('REV engine-conditions-channels-2 — check_timeouts lit les attentes par pages, sans fenêtre unique', () => {
  assert.ok(timeoutScan, 'lecture des attentes introuvable');
  assert.doesNotMatch(timeoutScan, /\.limit\(/, 'plus de fenêtre unique limit(200) / limit(50)');
  assert.match(timeoutScan, /await source\.query\(\)\.range\(offset, offset \+ WAIT_SCAN_PAGE_SIZE - 1\)/);
  // Tri stable pour paginer : scheduled_at puis id, sur les deux requêtes.
  assert.equal(count(timeoutScan, /\.order\('scheduled_at', \{ ascending: true \}\)\s*\.order\('id', \{ ascending: true \}\)/g), 2);
  // Page suivante tant que la page était pleine et que le budget le permet ;
  // décalage réduit des attentes sorties du filtre.
  assert.match(timeoutScan, /if \(budgetReached \|\| !shouldReadNextWaitPage\(page, waits\.length\)\) break;/);
  assert.match(timeoutScan, /offset = nextWaitPageOffset\(offset, waits\.length, leftFilter\)/);
  assert.match(timeoutScan, /if \(!hasTimeLeft\(deadline, Date\.now\(\), MIN_REMAINING_FOR_DB_WORK_MS\)\) \{\s*budgetReached = true;/);
  // Attente expirée (ou déjà sortie) comptée comme sortie du filtre, erreur non.
  const expire = slice(timeoutScan, "status: 'skipped', skip_reason: `Timeout", 'await scheduleNextStep(');
  assert.ok(expire.indexOf('leftFilter++') > expire.indexOf('if (timeoutErr)'), 'une erreur d\'écriture ne décale pas la page');
  // Première page illisible : erreur visible, comme avant.
  assert.match(timeoutScan, /if \(source\.fatal && page === 0\) throw new Error\(`check_timeouts : attentes illisibles/);
  // Une attente relue (décalage estimé) n'est pas traitée deux fois.
  assert.match(timeoutScan, /if \(seenWaitIds\.has\(exec\.id\)\) continue;/);
});

// ---------------------------------------------------------------- 4. [low] REV engine-conditions-channels-11
test('REV engine-conditions-channels-11 — échéance transmise à la vérification de réponse, testée avant chaque appel', () => {
  assert.match(replyCheck, /dsn\?: string, deadline\?: number \| null\): Promise<ReplyCheckState>/);
  assert.match(replyCheck, /const outOfTime = \(\) => !providerCallAllowed\(deadline, Date\.now\(\)\);/);
  assert.equal(count(replyCheck, /if \(outOfTime\(\)\) return 'unknown';/g), 3, 'avant la résolution, avant la première lecture, avant la seconde');
  assert.match(replyCheck, /resolveProfileIdForChat\([^;]*effectiveDsn, deadline\)/);
  assert.match(replyCheck, /checkMessagesForReply\(r\.chats, afterTimestamp, effectiveApiKey, effectiveDsn, deadline\)/);
  assert.match(resolveForChat, /if \(!providerCallAllowed\(deadline, Date\.now\(\)\)\) return profileId;/);
  assert.equal(count(messagesCheck, /if \(!providerCallAllowed\(deadline, Date\.now\(\)\)\) return 'unknown';/g), 2, 'avant les messages et avant les participants');
  // Les contrôles de fond passent leur échéance ; la vérification avant envoi non (inchangée).
  assert.match(checkReplies, /rCreds\.apiKey, rCreds\.dsn, deadline\)/);
  assert.match(phase2, /weCreds\.apiKey, weCreds\.dsn, afterDate, deadline\)\) === 'replied'/);
  assert.match(prospectReplied, /undefined, undefined, undefined, apiKey, dsn, deadline\)/);
  const rule = slice(guardsSrc, 'export function providerCallAllowed', '// ─── Attente de connexion');
  assert.match(rule, /if \(deadlineMs === null \|\| deadlineMs === undefined\) return true;/);
  assert.match(rule, /hasTimeLeft\(deadlineMs, nowMs, MIN_REMAINING_FOR_PROVIDER_CHECK_MS\)/);
});

// ---------------------------------------------------------------- comportement
let canImportTs = true;
try {
  await import('../../supabase/functions/_shared/sequence-wait-guards.ts');
} catch {
  canImportTs = false;
}

test('règles pures de la vague finale (si Node importe le TypeScript)', { skip: !canImportTs && 'Node sans prise en charge du TypeScript' }, async () => {
  const g = await import('../../supabase/functions/_shared/sequence-wait-guards.ts');
  const after = Date.parse('2026-09-20T08:00:00Z');
  const later = '2026-09-21T08:00:00Z';
  // 1. Participants illisibles : la réponse du candidat (is_sender 0) est vue.
  assert.equal(g.replyStateOfMessages([{ is_sender: 1, timestamp: later }, { is_sender: 0, timestamp: later }], after, g.unresolvedAttendees()).state, 'replied');
  // Expéditeur indéterminé après la référence : inconnu, pas « pas de réponse ».
  assert.equal(g.replyStateOfMessages([{ sender_attendee_id: 'x', timestamp: later }], after, g.unresolvedAttendees()).state, 'unknown');
  assert.equal(g.replyStateOfMessages([{ is_sender: 1, timestamp: later }], after, g.unresolvedAttendees()).state, 'no_reply');
  assert.equal(g.needsAttendeeResolution([{ is_sender: 0, timestamp: later }], after), false);
  // 2. Attente de connexion d'un candidat déjà en relation.
  assert.equal(g.isConnectionWaitSatisfied({ action_type: 'wait_connection' }, { connection_status: 'connected' }), true);
  assert.equal(g.isConnectionWaitSatisfied({ action_type: 'wait_reply' }, { connection_status: 'connected' }), false);
  // 3. 200 attentes non échues : la page suivante est lue, décalée des sorties.
  assert.equal(g.shouldReadNextWaitPage(0, g.WAIT_SCAN_PAGE_SIZE), true);
  assert.equal(g.shouldReadNextWaitPage(0, 12), false);
  assert.equal(g.nextWaitPageOffset(0, 200, 0), 200);
  assert.equal(g.nextWaitPageOffset(200, 200, 30), 370);
  // 4. Échéance : 15 s au moins avant la fin du budget, rien sans échéance.
  assert.equal(g.providerCallAllowed(undefined, 0), true);
  assert.equal(g.providerCallAllowed(14_999, 0), false);
  assert.equal(g.providerCallAllowed(15_000, 0), true);
});
