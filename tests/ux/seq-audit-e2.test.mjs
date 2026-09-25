/**
 * Audit séquences 2026-09-25, lot E2 — contrôles de fond de process-sequences
 * (check_replies, check_timeouts, check_wait_events), conditions d'étape,
 * vérification de réponse et heures d'envoi.
 *
 * Invariants épinglés par inspection de source (même style que
 * tests/ux/seq-audit-e1a.test.mjs). Les décisions de calcul sont en plus des
 * fonctions pures testées sous Deno :
 *   supabase/functions/_shared/sequence-schedule-time.test.ts
 *   supabase/functions/_shared/sequence-wait-rules.test.ts
 * et rejouées ici quand Node sait importer du TypeScript.
 *
 * Lancer : node --test tests/ux/seq-audit-e2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');

// Découpe tolérante (chaîne vide si le repère de début manque) : chaque test
// échoue alors sur son propre invariant.
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const checkReplies = slice(engine, 'async function handleCheckReplies', 'async function handleCheckTimeouts');
const timeouts = slice(engine, 'async function handleCheckTimeouts', 'async function handleCheckWaitEvents');
const waitEvents = slice(engine, 'async function handleCheckWaitEvents', '// ============ UTILITIES');
const phase1 = slice(waitEvents, '// Phase 1', '// Phase 2');
const phase2 = slice(waitEvents, '// Phase 2');
const condition = slice(engine, 'async function checkStepCondition', '// Force reschedule');
const replyCheck = slice(engine, 'async function checkForReplyAfterDate', 'interface ChatAttendeeInfo');
const messagesCheck = slice(engine, 'async function checkMessagesForReply', 'async function checkHasProspectReplied');
const prospectReplied = slice(engine, 'async function checkHasProspectReplied', 'interface QuotaCheckResult');
const setLocalHour = slice(engine, 'function setLocalHour(', 'function getNextBusinessHourSlot');
const nextSlot = slice(engine, 'function getNextBusinessHourSlot', 'async function getProfileInfo');
const rateLimit = slice(engine, 'function getRateLimitRetryDate', 'function safeTimezone');
const userQuotas = slice(engine, 'async function getUserQuotas', 'function setLocalHour(');
const quotasCacheDecl = slice(engine, 'interface UserQuotaConfig', 'async function getUserQuotas');
const scoreCase = slice(condition, "case 'if_score_above'", 'default:');
const unsubscribedCase = slice(condition, "case 'if_unsubscribed'", "case 'if_score_above'");

// ---------------------------------------------------------------- SEQ-006
test('SEQ-006 — check_replies : pipeline « Répondu » borné à l\'organisation et à la mission', () => {
  assert.ok(checkReplies, 'handleCheckReplies introuvable');
  assert.doesNotMatch(checkReplies, /\.from\('job_candidate_status'\)/, 'plus de mise à jour non bornée de job_candidate_status');
  assert.match(checkReplies, /await markCandidateRepliedInPipeline\(supabase, enrollment\)/);
  // Le helper partagé filtre l'organisation (échec fermé) et la mission.
  const helper = slice(engine, 'async function markCandidateRepliedInPipeline', 'async function recordEmailStepSent');
  assert.match(helper, /\.eq\('organization_id', jcsOrgId\)/);
  assert.match(helper, /missionJobIds\(/);
  assert.match(helper, /if \(enrollment\.profile_id && jcsOrgId\)/, 'organisation inconnue : aucune mise à jour');
  // Repli de l'organisation sur la séquence : jointure dans la sélection.
  assert.match(checkReplies, /sequence:outreach_sequences\(organization_id\)/);
});

// ---------------------------------------------------------------- SEQ-007
test('SEQ-007 — check_replies : Notion seulement pour une organisation qui a relié le sien, par URL LinkedIn seule', () => {
  const gateAt = checkReplies.indexOf('canSyncNotionForOrg(supabase, notionOrgId');
  const findAt = checkReplies.indexOf('findCandidateInNotionSeq(');
  assert.notEqual(gateAt, -1, 'synchro Notion non conditionnée à l\'organisation');
  assert.ok(gateAt < findAt, 'le contrôle d\'organisation doit précéder toute écriture Notion');
  assert.match(checkReplies, /findCandidateInNotionSeq\('', enrollment\.profile_url\)/, 'plus de recherche par nom');
  assert.doesNotMatch(checkReplies, /enrollment\.profile_name \|\| ''/);
  assert.match(checkReplies, /notionOrgId && enrollment\.profile_url/);
});

// ---------------------------------------------------------------- SEQ-027
test('SEQ-027 — délais et attentes : inscriptions actives seulement, filtre dans la requête', () => {
  assert.match(timeouts, /enrollment:sequence_enrollments!inner\(\*\)/);
  assert.match(timeouts, /\.eq\('enrollment\.status', 'active'\)/);
  assert.match(timeouts, /\.order\('scheduled_at', \{ ascending: true \}\)/);
  // Attentes des inscriptions closes : annulées à part, jamais expirées.
  assert.match(timeouts, /\.in\('enrollment\.status', TERMINAL_ENROLLMENT_STATUSES\)/);
  assert.match(timeouts, /status: 'cancelled', skip_reason: closedEnrollmentWaitReason\(status\)/);
  assert.match(phase1, /\.eq\('enrollment\.status', 'active'\)/);
  assert.match(phase2, /enrollment:sequence_enrollments!inner\(\*\)/);
  assert.match(phase2, /\.eq\('enrollment\.status', 'active'\)/);
});

// ---------------------------------------------------------------- SEQ-031
test('SEQ-031 — attente sans wait_for_event : événement déduit du type d\'étape', () => {
  assert.match(condition, /stepActionType\?: string \| null/);
  assert.match(condition, /const waitEvent = implicitWaitEvent\(\{ wait_for_event: waitForEvent, action_type: stepActionType \}\)/);
  assert.match(condition, /const eff = waitEvent \? 'wait_for_event'/);
  assert.match(condition, /if \(waitEvent === 'reply_received'\)/);
  // L'appel du moteur transmet le type d'étape.
  assert.match(engine, /await checkStepCondition\([^;]*uCreds\.dsn, step\.action_type\)/);
  // Phase 2 : attente de réponse implicite vérifiée aussi.
  assert.match(phase2, /const forReply = waitsForReply\(step\)/);
  // Plus d'attente à vie : délai par défaut pour les attentes implicites.
  assert.match(timeouts, /\.is\('step\.wait_for_event', null\)/);
  assert.match(timeouts, /\.in\('step\.action_type', IMPLICIT_WAIT_ACTIONS\)/);
  assert.match(timeouts, /effectiveWaitTimeoutDays\(step, overrideTimeout\)/);
});

// ---------------------------------------------------------------- SEQ-038
test('SEQ-038 — setLocalHour : heure locale posée sur la date locale', () => {
  assert.ok(setLocalHour, 'setLocalHour introuvable');
  assert.match(setLocalHour, /function setLocalHour\(date: Date, tz: string, desiredLocalHour: number, minutes = 0\): void/, 'signature inchangée');
  assert.doesNotMatch(setLocalHour, /setUTCHours/, 'plus d\'heure posée sur la date UTC');
  assert.match(setLocalHour, /atLocalTime\(date, safeTimezone\(tz\), desiredLocalHour, minutes\)/);
  assert.doesNotMatch(engine, /function getTimezoneOffsetHours/, 'décalage arrondi à l\'heure supprimé');
  assert.match(nextSlot, /nextSendingSlot\(now, safeTimezone\(timezone\), startHour, endHour/);
  assert.doesNotMatch(nextSlot, /setDate\(/, 'plus de jour avancé sur l\'heure du serveur');
});

// ---------------------------------------------------------------- SEQ-052
test('SEQ-052 — « Si score au-dessus de » : score de l\'organisation et de la mission de l\'inscription', () => {
  assert.match(scoreCase, /\.eq\('organization_id', scoreOrgId\)/);
  assert.match(scoreCase, /if \(!scoreOrgId\) return false;/, 'organisation inconnue : condition non remplie');
  assert.match(scoreCase, /missionJobIds\(enrollment\?\.job_id/);
  assert.match(scoreCase, /\.in\('job_id', scoreJobIds\)/);
});

// ---------------------------------------------------------------- SEQ-071
test('SEQ-071 — réponse captée par check_replies : clôture commune, réponse comptée une fois', () => {
  assert.match(checkReplies, /closeEnrollmentAsReplied\(supabase, enrollment, null, 'Reply detected'\)/);
  assert.doesNotMatch(checkReplies, /logAnalytics\(/, 'la clôture compte déjà la réponse');
  assert.doesNotMatch(checkReplies, /\.eq\('status', 'scheduled'\)/, 'plus d\'annulation limitée aux étapes programmées');
});

// ---------------------------------------------------------------- SEQ-074
test('SEQ-074 — budget de temps avant chaque interrogation du fournisseur', () => {
  assert.match(waitEvents, /const deadline = Date\.now\(\) \+ CHECK_PASS_BUDGET_MS/);
  const budgetAt = phase2.indexOf('hasTimeLeft(deadline, Date.now(), MIN_REMAINING_FOR_PROVIDER_CHECK_MS)');
  const providerAt = phase2.indexOf('await getProfileInfo(');
  assert.notEqual(budgetAt, -1);
  assert.ok(budgetAt < providerAt, 'le budget est testé avant l\'appel');
  assert.match(checkReplies, /hasTimeLeft\(deadline, Date\.now\(\), MIN_REMAINING_FOR_PROVIDER_CHECK_MS\)/);
});

// ---------------------------------------------------------------- SEQ-075
test('SEQ-075 — check_replies : étranglement testé avant le verrou global', () => {
  const throttleAt = checkReplies.indexOf('isThrottled(lastRunBeforeLock');
  const lockAt = checkReplies.indexOf('await acquireLock(');
  assert.notEqual(throttleAt, -1);
  assert.ok(throttleAt < lockAt, 'un passage « trop récent » ne prend plus le verrou');
});

// ---------------------------------------------------------------- SEQ-077
test('SEQ-077 — lecture du profil en échec : nouvel essai, pas « non connecté »', () => {
  assert.match(condition, /Promise<boolean \| 'wait' \| 'retry'>/);
  const connected = slice(condition, "case 'if_connected'", "case 'if_not_connected'");
  const notConnected = slice(condition, "case 'if_not_connected'", "case 'if_no_response'");
  assert.match(connected, /if \(!p\) return 'retry';/);
  assert.match(notConnected, /if \(!p\) return 'retry';/);
});

// ---------------------------------------------------------------- SEQ-078
test('SEQ-078 — vérification de réponse à trois issues : un échec technique n\'est plus « pas de réponse »', () => {
  assert.match(replyCheck, /Promise<ReplyCheckState>/);
  assert.doesNotMatch(replyCheck, /return false/);
  assert.match(replyCheck, /return 'unknown';/);
  assert.match(replyCheck, /chatLookupOutcome\(/, '404 sans fil distingué des 5xx et délais');
  assert.match(messagesCheck, /return unreadable \? 'unknown' : 'no_reply';/);
  const noResponse = slice(condition, "case 'if_no_response'", "case 'wait_until_connected'");
  assert.match(noResponse, /if \(state === 'unknown'\) return 'retry';/);
});

// ---------------------------------------------------------------- SEQ-083
test('SEQ-083 — délai d\'attente compté depuis le début de l\'attente', () => {
  assert.match(timeouts, /isWaitTimedOut\(waitStartedAt\(exec\), effectiveTimeout, Date\.now\(\)\)/);
  assert.doesNotMatch(timeouts, /exec\.created_at/);
});

// ---------------------------------------------------------------- SEQ-084
test('SEQ-084 — réponse attendue après le dernier envoi visible, plus une fenêtre de 72 h', () => {
  assert.match(condition, /loadReplyReferenceDate\(supabaseClient, enrollmentId, enrollment\)/);
  assert.match(phase2, /loadReplyReferenceDate\(supabase, enrollment\.id, enrollment\)/);
  assert.doesNotMatch(prospectReplied, /72 \* 3600000/);
  const loader = slice(engine, 'async function loadReplyReferenceDate', 'interface QuotaCheckResult');
  assert.match(loader, /\.in\('step\.action_type', VISIBLE_SEND_ACTIONS\)/);
  assert.match(loader, /re_enrolled_at/);
});

// ---------------------------------------------------------------- SEQ-085
test('SEQ-085 — phase 1 : seules les attentes de connexion sont réarmées', () => {
  assert.match(phase1, /step:sequence_steps!inner\(action_type, wait_for_event, condition_type\)/);
  assert.match(phase1, /\.or\(CONNECTION_WAIT_STEP_FILTER, \{ referencedTable: 'step' \}\)/);
  assert.match(phase1, /!waitsForConnection\(exec\.step\)/);
});

// ---------------------------------------------------------------- SEQ-086
test('SEQ-086 — phase 2 : file tournante sur les attentes vérifiables', () => {
  assert.match(phase2, /\.or\(POLLABLE_WAIT_STEP_FILTER, \{ referencedTable: 'step' \}\)/);
  assert.match(phase2, /update\(\{ updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(phase2, /if \(!eventOccurred\) \{\s*await touchWait\(exec\.id\);/);
});

// ---------------------------------------------------------------- SEQ-087
test('SEQ-087 — check_replies : rotation par last_check_at, inscriptions avec au moins un envoi', () => {
  assert.match(checkReplies, /\.order\('last_check_at', \{ ascending: true, nullsFirst: true \}\)/);
  assert.match(checkReplies, /sent_steps:sequence_step_executions!inner\(id\)/);
  assert.match(checkReplies, /\.in\('sent_steps\.status', SENT_EXECUTION_STATUSES\)/);
  assert.match(checkReplies, /update\(\{ last_check_at: new Date\(\)\.toISOString\(\) \}\)\.in\('id', examinedIds\)/);
});

// ---------------------------------------------------------------- SEQ-088
test('SEQ-088 — 429 : report mensuel réservé aux crédits InMail épuisés', () => {
  assert.match(rateLimit, /rateLimitRetryAt\(rateLimitDeferral\(actionType, opts\)/);
  assert.doesNotMatch(rateLimit, /actionType === 'inmail' \|\| actionType === 'smart_message'/);
});

// ---------------------------------------------------------------- SEQ-121
test('SEQ-121 — candidat qui a bloqué le compte : pause avec sa raison, étapes gardées', () => {
  assert.match(replyCheck, /pause_reason: 'blocked_by_candidate'/);
  assert.match(replyCheck, /\.eq\('id', enrollmentId\)\.eq\('status', 'active'\)/);
  assert.doesNotMatch(replyCheck, /status: 'cancelled'/, 'contrat §1 : une pause ne touche pas aux étapes en attente');
});

// ---------------------------------------------------------------- SEQ-188
test('SEQ-188 — « Si désinscrit » : adresse comparée en minuscules', () => {
  assert.match(unsubscribedCase, /normalizeEmailForSuppression\(enrollment\?\.email_used\)/);
  assert.match(unsubscribedCase, /\.eq\('email', suppressionEmail\)/);
});

// ---------------------------------------------------------------- SEQ-190
test('SEQ-190 — expiration et réarmement conditionnés à l\'attente toujours en cours', () => {
  const expire = slice(timeouts, "status: 'skipped', skip_reason: `Timeout", 'await scheduleNextStep(');
  assert.match(expire, /\.eq\('id', exec\.id\)\.eq\('status', 'waiting_event'\)\.select\('id'\)/);
  assert.match(expire, /if \(!timedOutRows \|\| timedOutRows\.length === 0\) continue;/);
  assert.match(phase1, /\.eq\('id', exec\.id\)\.eq\('status', 'waiting_event'\)\.select\('id'\)/);
});

// ---------------------------------------------------------------- SEQ-198
test('SEQ-198 — plages horaires relues à chaque passage, clé du cache corrigée', () => {
  assert.match(quotasCacheDecl, /USER_QUOTAS_CACHE_TTL_MS/);
  assert.match(userQuotas, /Date\.now\(\) - cached\.at < USER_QUOTAS_CACHE_TTL_MS/);
  assert.doesNotMatch(userQuotas, /userQuotasCache\.set\(userId/);
});

// ---------------------------------------------------------------- comportement
let canImportTs = true;
try {
  await import('../../supabase/functions/_shared/sequence-schedule-time.ts');
} catch {
  canImportTs = false;
}

test('règles pures (si Node importe le TypeScript)', { skip: !canImportTs && 'Node sans prise en charge du TypeScript' }, async () => {
  const t = await import('../../supabase/functions/_shared/sequence-schedule-time.ts');
  const w = await import('../../supabase/functions/_shared/sequence-wait-rules.ts');
  // SEQ-038 : envoi mardi 18:30 à Paris + 6 h → mercredi 9 h, jamais dans le passé.
  const due = new Date('2026-09-22T22:30:00Z');
  assert.equal(t.nextSendingSlot(due, 'Europe/Paris', 9, 18, 0).toISOString(), '2026-09-23T07:00:00.000Z');
  // Samedi 21:00 New York → lundi 9 h.
  assert.equal(t.nextSendingSlot(new Date('2026-09-27T01:00:00Z'), 'America/New_York', 9, 18, 0).toISOString(), '2026-09-28T13:00:00.000Z');
  // SEQ-088
  assert.equal(t.rateLimitDeferral('smart_message', { error: 'linkedin_send_failed_429: too many requests', sentAsInMail: false }), 'next_business_day');
  assert.equal(t.rateLimitDeferral('inmail', { error: '429 InMail credits exhausted', sentAsInMail: true }), 'next_month');
  // SEQ-031
  assert.equal(w.implicitWaitEvent({ action_type: 'wait_reply', wait_for_event: null }), 'reply_received');
  assert.equal(w.implicitWaitEvent({ action_type: 'wait_connection', wait_for_event: null }), 'connection_accepted');
  // SEQ-078
  assert.equal(w.chatLookupOutcome(404), 'no_thread');
  assert.equal(w.chatLookupOutcome(503), 'unknown');
  assert.equal(w.chatLookupOutcome(null), 'unknown');
  // SEQ-083 : délai de 2 j puis attente de 3 j, pas expirée au bout d'un jour d'attente.
  assert.equal(w.isWaitTimedOut(w.waitStartedAt({ created_at: '2026-09-01T09:00:00Z', scheduled_at: '2026-09-03T09:00:00Z' }), 3, Date.parse('2026-09-04T10:00:00Z')), false);
  // SEQ-084
  assert.equal(w.replyReferenceDate('2026-09-20T08:00:00Z', null, Date.parse('2026-09-25T10:00:00Z')), '2026-09-20T08:00:00.000Z');
});
