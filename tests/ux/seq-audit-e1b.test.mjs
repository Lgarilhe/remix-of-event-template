/**
 * Audit séquences 2026-09-25, lot E1b — moteur process-sequences (zone E1,
 * défauts medium et low).
 *
 * Invariants épinglés par inspection de source (même style que
 * tests/ux/seq-audit-e1a.test.mjs). Les décisions du cycle sont en plus des
 * fonctions pures testées sous Deno :
 *   supabase/functions/_shared/sequence-cycle-rules.test.ts
 * et rejouées ici quand Node sait importer du TypeScript.
 *
 * Lancer : node --test tests/ux/seq-audit-e1b.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');
const rules = read('supabase/functions/_shared/sequence-cycle-rules.ts');

// Découpe tolérante (chaîne vide si le repère manque) : chaque test échoue
// alors pour son propre invariant, pas tout le fichier.
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const dispatch = slice(engine, 'Deno.serve(async (req)', '// ============ ACTION HANDLERS ============');
const resumeOne = slice(engine, 'async function resumeOneEnrollment', 'async function handleMarkReplied');
const markReplied = slice(engine, 'async function handleMarkReplied', 'async function acquireLock');
const processFn = slice(engine, 'async function handleProcess(', 'async function handleCheckReplies');
const stuckJanitor = slice(processFn, 'const stuckCutoff', 'Recovery: re-arm executions blocked on quota');
const dormantJanitor = slice(processFn, 'Recovery: enrollments actifs SANS', 'const { data: executions, error: fetchError }');
const loop = slice(processFn, 'for (const exec of batchedExecutions)', '// Auto-pause: if >30% of batch actions failed definitively');
const autoPause = slice(processFn, '// Auto-pause: if >30% of batch actions failed definitively', 'return new Response(');
const schedule = slice(engine, 'async function scheduleNextStep(', 'async function executeStepAction(');
const closeReplied = slice(engine, 'async function closeEnrollmentAsReplied', 'async function recordEmailStepSent');
const cancelHelper = slice(engine, 'async function cancelPendingExecutions', '\n}\n');
const stopBlock = slice(loop, '// === CONFIGURABLE STOP CONDITIONS ===', '// === SUBSCRIPTION GATE');
const lockAt = loop.indexOf("status: 'sending',");

// ---------------------------------------------------------------- SEQ-071
test('SEQ-071 — les clôtures annulent toutes les étapes en attente, jamais un envoi en cours', () => {
  assert.match(cancelHelper, /\.in\('status', \['scheduled', 'waiting_event', 'quota_blocked'\]\)/);
  assert.doesNotMatch(cancelHelper, /'sending'\]/, 'jamais une exécution en cours d\'envoi');
  assert.match(stopBlock, /cancelPendingExecutions\(supabase, enrollment\.id, stopReason\)/);
  assert.doesNotMatch(stopBlock, /\.eq\('enrollment_id', enrollment\.id\)\.eq\('status', 'scheduled'\)/, 'ancienne annulation limitée à scheduled');
  assert.match(stopBlock, /\.eq\('id', enrollment\.id\)\.eq\('status', 'active'\)/, 'clôture conditionnée au statut');
  assert.match(closeReplied, /cancelPendingExecutions\(supabase, enrollment\.id, reason, fulfilledExecutionId\)/);
});

// ---------------------------------------------------------------- SEQ-073
test('SEQ-073 — auto-pause calculée par séquence, propriétaire prévenu', () => {
  assert.doesNotMatch(autoPause, /results\.failed \/ totalActioned/, 'ancien taux global multi-organisations');
  assert.match(autoPause, /for \(const seqId of sequencesToAutoPause\(sequenceStats\)\)/);
  assert.match(autoPause, /pauseActiveEnrollments\(supabase, \{ sequenceId: seqId \}, 'auto_paused'\)/);
  assert.match(autoPause, /from\('notifications'\)\.insert\(/);
  assert.match(autoPause, /source: 'sequence_auto_pause'/);
  assert.doesNotMatch(autoPause, /Unipile|Anthropic|Claude/, 'aucun nom de fournisseur dans la notification');
  assert.match(loop, /statsFor\(statsSequenceId\)\.actioned \+= actioned/, 'actions comptées par séquence');
  assert.doesNotMatch(loop, /failedSequenceIds/);
  assert.match(rules, /if \(s\.failed \/ actioned > maxRate\) out\.push\(sequenceId\)/);
});

// ---------------------------------------------------------------- SEQ-074
test('SEQ-074 — échéance du cycle testée avant le verrou, verrou gardé à 10 min', () => {
  assert.match(processFn, /const cycleDeadline = Date\.now\(\) \+ CYCLE_BUDGET_MS;/);
  assert.match(rules, /export const CYCLE_BUDGET_MS = 40_000;/);
  const budgetAt = loop.indexOf('hasTimeToLock(cycleDeadline, Date.now(), { visible: isVisibleAction, needsAi: aiWillGenerate })');
  assert.ok(budgetAt !== -1 && lockAt !== -1 && budgetAt < lockAt, 'test du temps restant avant le verrou');
  assert.match(loop, /if \(Date\.now\(\) >= cycleDeadline\) \{[\s\S]*?break;/);
  assert.match(engine, /p_ttl_minutes: 10/, 'TTL du verrou non raccourcie');
  assert.match(loop, /generatePersonalizedMessage\(supabase, enrollment, step, exec, uCreds\.apiKey, uCreds\.dsn, aiDiag\)/);
});

// ---------------------------------------------------------------- SEQ-076
test('SEQ-076 — le plafond n\'est décompté qu\'après les contrôles qui annulent l\'envoi', () => {
  const gateAt = loop.indexOf('await checkQuotaForAction(');
  const healthAt = loop.indexOf('// Check LinkedIn account health before executing');
  const conditionAt = loop.indexOf('await checkStepCondition(');
  const replyAt = loop.indexOf('// *** PRE-SEND REPLY CHECK ***');
  const hoursAt = loop.indexOf('!isWithinBusinessHours(userTimezone');
  assert.equal(loop.split('await checkQuotaForAction(').length - 1, 1, 'un seul gate, déplacé');
  assert.ok(hoursAt < healthAt && healthAt < gateAt, 'heures ouvrées en tête, gate après la santé du compte');
  assert.ok(conditionAt < gateAt && replyAt < gateAt, 'gate après la condition et la vérification de réponse');
  assert.ok(gateAt < lockAt, 'gate juste avant le verrou');
});

// ---------------------------------------------------------------- SEQ-077
test('SEQ-077 — lecture de profil en échec : nouvel essai au lieu d\'un saut définitif', () => {
  const retry = slice(loop, 'if (isConditionRetry(rawCondition)) {', 'let conditionResult = rawCondition;');
  assert.match(retry, /RETRY_DELAY_MS/);
  assert.match(retry, /conditionRetryCount < MAX_RETRIES/);
  assert.match(retry, /retry_count: conditionRetryCount \+ 1/);
  assert.match(retry, /\.eq\('status', 'scheduled'\)/);
  assert.match(retry, /continue;/);
  assert.ok(loop.indexOf('isConditionRetry(rawCondition)') < loop.indexOf("skip_reason: `Condition: ${step.condition_type}`"));
});

// ---------------------------------------------------------------- SEQ-078
test('SEQ-078 — vérification de réponse impossible : on n\'envoie pas', () => {
  assert.doesNotMatch(loop, /better to send than to silently skip/);
  const unknown = slice(loop, "if (replyState === 'unknown') {", "if (replyState === 'replied') {");
  assert.match(unknown, /replyRetryCount < MAX_RETRIES/);
  assert.match(unknown, /REPLY_CHECK_RETRY_MESSAGE/);
  assert.match(unknown, /status: 'failed'[\s\S]*REPLY_CHECK_FAILED_MESSAGE/);
  assert.match(unknown, /continue;/);
  assert.match(loop, /replyState = normalizeReplyCheck\(await checkForReplyAfterDate\(/);
  assert.match(loop, /catch \(replyCheckErr\) \{[\s\S]*?replyState = 'unknown';/);
});

// ---------------------------------------------------------------- SEQ-079
test('SEQ-079 — passage « envoyé » vérifié, jamais de relance d\'un message parti', () => {
  const sent = slice(loop, 'const sentPatch = {', "await supabase.from('sequence_enrollments').update({ current_step_order: step.step_order + 1 })");
  assert.match(sent, /\.eq\('id', exec\.id\)\.eq\('status', 'sending'\)\.select\('id'\)/);
  assert.match(sent, /if \(sentWrite\.error\) sentWrite = await writeSent\(\);/, 'second essai');
  assert.match(sent, /error_message: SENT_NOT_RECORDED_MESSAGE/);
  assert.match(sent, /continue;/, 'rien n\'est replanifié');
  assert.match(stuckJanitor, /stuck\.error_message === SENT_NOT_RECORDED_MESSAGE/, 'le rattrapage le passe « envoyé »');
});

// ---------------------------------------------------------------- SEQ-080
test('SEQ-080 — e-mail interrompu : « envoyé » seulement avec la preuve d\'envoi', () => {
  assert.match(stuckJanitor, /\.not\('email_message_id', 'is', null\)/);
  assert.match(stuckJanitor, /error_message: EMAIL_UNCERTAIN_MESSAGE/);
  assert.doesNotMatch(stuckJanitor, /stuckActionType === 'email' \|\|/, 'plus de relance automatique d\'un e-mail');
  assert.match(rules, /EMAIL_UNCERTAIN_MESSAGE = "Envoi incertain/, 'reconnu comme envoi incertain par la reprise');
});

// ---------------------------------------------------------------- SEQ-081
test('SEQ-081 — garde anti-doublon sur toutes les variantes A/B du rang', () => {
  const guardAt = schedule.indexOf(".in('step_id', guardStepIds)");
  const pickAt = schedule.indexOf('// Weighted random selection');
  assert.ok(guardAt !== -1 && pickAt !== -1 && guardAt < pickAt, 'tirage après la garde');
  assert.match(schedule, /rankVariants\.map\(\(v\) => v\.id as string\)/);
  assert.doesNotMatch(schedule, /\.eq\('step_id', nextStep\.id\)\.in\('status', blockingStatuses\)/);
});

// ---------------------------------------------------------------- SEQ-082
test('SEQ-082 — inscription dormante reprise avec le routage du moteur', () => {
  assert.match(dormantJanitor, /skip_reason, executed_at, created_at, step:sequence_steps\(action_type, timeout_branch_step_id, if_true_goto_step, if_false_goto_step\)/);
  assert.match(dormantJanitor, /dormantResumeRoute\(lastDone, enr\.connection_status\)/);
  assert.match(dormantJanitor, /route\.kind === 'unknown_connection'[\s\S]*?pauseActiveEnrollments\(supabase, \{ id: enr\.id \}, 'send_failed'/);
  assert.match(dormantJanitor, /route\.kind === 'branch' \? route\.stepId : undefined/);
  assert.match(resumeOne, /dormantResumeRoute\(lastDoneRow, enr\.connection_status\)/, 'même routage à la reprise');
  assert.match(rules, /\(lastDone\.skip_reason \?\? ''\)\.startsWith\('Timeout'\)/);
});

// ---------------------------------------------------------------- SEQ-089 / SEQ-188
test('SEQ-089 / SEQ-188 — désinscription toujours appliquée, adresse en minuscules, e-mail supprimé = arrêt', () => {
  assert.doesNotMatch(stopBlock, /stopCond\.on_unsubscribe &&/);
  assert.match(stopBlock, /normalizeEmailForSuppression\(enrollment\.email_used/);
  assert.match(stopBlock, /\.eq\('email', suppressionEmail\)/);
  const suppressed = slice(loop, "executeResult.skipped === 'suppressed'", '} else if (executeResult.success) {');
  assert.match(suppressed, /status: 'completed'/);
  assert.match(suppressed, /cancelPendingExecutions\(supabase, enrollment\.id, unsubReason, exec\.id\)/);
  assert.doesNotMatch(suppressed, /scheduleNextStep\(/);
});

// ---------------------------------------------------------------- SEQ-090
test('SEQ-090 — la copie du modèle posée au verrou n\'est jamais prise pour une modification', () => {
  assert.match(loop, /const staleTemplateSnapshot = !!step\.use_ai_personalization && isStaleTemplateSnapshot\(/);
  assert.match(loop, /finalMessage: staleTemplateSnapshot \? null : exec\.final_message/);
  const lock = slice(loop, 'const { data: lockResult, error: lockError }', 'if (lockError || !lockResult)');
  assert.match(lock, /aiWillGenerate \? \{ tracking_data: withContentOrigin\(exec\.tracking_data, TEMPLATE_SNAPSHOT_ORIGIN\) \}/);
});

// ---------------------------------------------------------------- SEQ-109 / SEQ-195
test('SEQ-109 / SEQ-195 — un envoi réussi n\'est plus affiché en erreur, canal renseigné', () => {
  const sent = slice(loop, 'const sentPatch = {', 'const writeSent');
  assert.match(sent, /error_message: null, channel: executionChannel\(step\)/);
  assert.doesNotMatch(stuckJanitor, /error_message: 'Recovered: email was sent but status update failed'/);
  assert.match(stuckJanitor, /recovered_by_janitor/);
});

// ---------------------------------------------------------------- SEQ-187
test('SEQ-187 — cadence par compte d\'envoi, e-mails hors plafond et hors espacement', () => {
  assert.match(processFn, /selectCycleBatch<\(typeof dedupedExecutions\)\[number\]>\(dedupedExecutions\)/);
  assert.doesNotMatch(processFn, /if \(visibleCount >= MAX_VISIBLE_PER_CYCLE\) return false;/, 'ancien plafond global');
  assert.match(loop, /if \(isLinkedInStyleSend && \(visibleSentByAccount\.get\(sendAccountKey\) \?\? 0\) > 0\)/, 'espacement par compte');
  assert.doesNotMatch(loop, /!INVISIBLE_ACTIONS\.has\(effectiveActionType\) && visibleActionsExecuted > 0/);
});

// ---------------------------------------------------------------- SEQ-189
test('SEQ-189 — dernier contrôle en échec fermé', () => {
  const lastCall = slice(loop, '// ⭐ LAST-CALL CHECK', 'const executeResult = await executeStepAction(');
  assert.match(lastCall, /\.select\('status'\)\.eq\('id', enrollment\.id\)\.maybeSingle\(\)/);
  assert.match(lastCall, /if \(lastCallErr\) \{[\s\S]*?15 \* 60 \* 1000[\s\S]*?\.eq\('status', 'sending'\)[\s\S]*?continue;/);
  assert.match(lastCall, /if \(!lastCall\) \{[\s\S]*?continue;/, 'inscription disparue : rien ne part');
});

// ---------------------------------------------------------------- SEQ-191 / SEQ-221
test('SEQ-191 / SEQ-221 — réponse comptée une fois, « Marquer comme répondu » met à jour le pipeline', () => {
  assert.match(closeReplied, /\.in\('status', \[\.\.\.allowedFrom\]\)\.select\('id'\)/);
  assert.doesNotMatch(closeReplied, /\.neq\('status', 'replied'\)/);
  assert.match(closeReplied, /if \(changed && enrollment\.sequence_id\) await logAnalytics/);
  assert.match(markReplied, /markCandidateRepliedInPipeline\(supabase/);
  assert.match(markReplied, /\['active', 'paused', 'completed'\]/);
});

// ---------------------------------------------------------------- SEQ-192 / SEQ-193
test('SEQ-192 / SEQ-193 — service indisponible reporté d\'une heure, report du plafond selon la cause', () => {
  const creds = slice(loop, 'let uCreds', 'const senderUserId =');
  assert.match(creds, /catch \(credsErr\)/);
  assert.match(creds, /stepSendChannel\(step\) !== 'email'/);
  assert.match(creds, /error_message: PROVIDER_UNAVAILABLE_MESSAGE/);
  const gate = slice(loop, 'await checkQuotaForAction(', 'results.quota_blocked++;');
  assert.match(gate, /quotaBlockedRetryAt\(quotaCheck\.scope/);
  assert.doesNotMatch(gate, /Date\.now\(\) \+ 86400000/);
});

// ---------------------------------------------------------------- SEQ-194
test('SEQ-194 — battement de cœur « skipped » quand le verrou était tenu', () => {
  assert.match(dispatch, /heartbeatStatus = heartbeatStatusFor\(await response\.clone\(\)\.json\(\)\)/);
  assert.match(dispatch, /p_status: heartbeatStatus/);
  assert.doesNotMatch(dispatch, /\.then\(\(\) => \{\}\)\.catch/, 'PromiseLike sans catch');
});

// ---------------------------------------------------------------- SEQ-196
test('SEQ-196 — fenêtre des inscriptions dormantes paginée', () => {
  assert.match(dormantJanitor, /for \(let page = 0; page < DORMANT_MAX_PAGES && dormant\.length < DORMANT_MAX_PER_RUN; page\+\+\)/);
  assert.match(dormantJanitor, /pageQuery = pageQuery\.gte\('updated_at', dormantCursor\)/);
  assert.doesNotMatch(dormantJanitor, /\.slice\(0, 5\)/);
});

// ---------------------------------------------------------------- SEQ-197 / SEQ-220
test('SEQ-197 / SEQ-220 — fuseau du titulaire du compte, réponse précédente conservée', () => {
  assert.match(schedule, /const tz = await resolveSendingTimezone\(supabase, enrollment, nextStep\);/);
  assert.doesNotMatch(schedule, /const tz = enrollment\.user_timezone \|\| 'Europe\/Paris';/);
  assert.match(loop, /const userTimezone = pickSendingTimezone\(/);
  assert.match(resumeOne, /reEnrollTracking\(enr\.tracking_data, enr\.replied_at, nowIso\)/);
});

// ---------------------------------------------------------------- comportement
let canImportTs = true;
try {
  await import('../../supabase/functions/_shared/sequence-cycle-rules.ts');
} catch {
  canImportTs = false;
}

test('règles pures du cycle (si Node importe le TypeScript)', { skip: !canImportTs && 'Node sans prise en charge du TypeScript' }, async () => {
  const r = await import('../../supabase/functions/_shared/sequence-cycle-rules.ts');
  // SEQ-073 : l'organisation B n'est pas mise en pause pour les échecs de A.
  assert.deepEqual(r.sequencesToAutoPause(new Map([['A', { actioned: 5, failed: 5 }], ['B', { actioned: 2, failed: 1 }]])), ['A']);
  // SEQ-187 : le compte B passe malgré la file du compte A.
  const li = (a) => ({ step: { action_type: 'message' }, enrollment: { account_id: a } });
  const batch = [li('A'), li('A'), li('A'), li('A'), li('B')];
  assert.equal(r.selectCycleBatch(batch).selected.includes(batch[4]), true);
  // SEQ-078 : un doute n'est jamais « pas de réponse ».
  assert.equal(r.normalizeReplyCheck(undefined), 'unknown');
  assert.equal(r.normalizeReplyCheck(false), 'no_reply');
  // SEQ-082 : délai dépassé vers la branche de délai.
  assert.deepEqual(r.dormantResumeRoute({ status: 'skipped', skip_reason: 'Timeout 3d', step: { timeout_branch_step_id: 'x' } }, null), { kind: 'branch', stepId: 'x' });
  // SEQ-193 : panne passagère du contrôle, +30 min.
  const now = new Date('2026-09-25T10:00:00Z');
  assert.equal(r.quotaBlockedRetryAt('infrastructure', now, 'Europe/Paris', 8).toISOString(), '2026-09-25T10:30:00.000Z');
});
