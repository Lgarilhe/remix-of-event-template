/**
 * Audit séquences 2026-09-25, lot E1a — moteur process-sequences (zone E1).
 *
 * Invariants épinglés par inspection de source (même style que
 * tests/ux/lot1-envois.test.mjs). Les décisions critiques sont en plus des
 * fonctions pures testées sous Deno :
 *   supabase/functions/_shared/sequence-engine-rules.test.ts
 *   supabase/functions/_shared/sequence-resume.test.ts
 * et, quand Node sait importer du TypeScript, rejouées ici.
 *
 * Lancer : node --test tests/ux/seq-audit-e1a.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');
const rules = read('supabase/functions/_shared/sequence-engine-rules.ts');
const resume = read('supabase/functions/_shared/sequence-resume.ts');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.notEqual(from, -1, `repère introuvable : ${start}`);
  const to = src.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

// Découpes de haut niveau tolérantes (chaîne vide si un repère manque) : chaque
// test échoue alors pour son propre invariant, pas tout le fichier.
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const nudge = slice(engine, 'async function handleNudgeSequences', 'async function handleSkipExecution');
const skip = slice(engine, 'async function handleSkipExecution', 'async function isSenderAccountLinked', 'async function acquireLock');
const processFn = slice(engine, 'async function handleProcess(', 'async function handleCheckReplies');
const loop = slice(processFn, 'for (const exec of batchedExecutions)', '// Auto-pause: if >30% of batch actions failed definitively');
const autoPause = slice(processFn, '// Auto-pause: if >30% of batch actions failed definitively', 'return new Response(');
const schedule = slice(engine, 'async function scheduleNextStep(', 'async function executeStepAction(');
const errorBlock = slice(loop, '// Error handling: differentiate rate limits', '} catch (err) {');
const catchBlock = loop.slice(loop.lastIndexOf('} catch (err) {'));

// ---------------------------------------------------------------- SEQ-001
test('SEQ-001 — « Envoyer les actions du jour » : borne de fin de journée, séquences de la mission, envois visibles seulement', () => {
  assert.match(nudge, /\.lte\('scheduled_at', horizonIso\)/, 'borne haute en base');
  assert.match(nudge, /isNudgeable\(e\.scheduled_at, now, e\.enrollment\?\.user_timezone\)/, 'fin de journée dans le fuseau de l\'inscription');
  assert.match(nudge, /\.in\('step\.action_type', NUDGE_ACTION_TYPES\)/);
  assert.doesNotMatch(nudge, /\.neq\('step\.action_type', 'connection_request'\)/, 'ancienne sélection sans borne');
  assert.match(nudge, /\.in\('enrollment\.sequence_id', seqIds\)/, 'bornage aux séquences demandées');
  assert.match(nudge, /\.eq\('organization_id', orgId\)/, 'les séquences demandées appartiennent à l\'organisation');
  assert.match(nudge, /advanced/);
  assert.match(engine, /stringArray\(body\.sequence_ids\)/, 'le dispatch transmet sequence_ids');

  const allowed = rules.match(/NUDGE_ACTION_TYPES: readonly string\[\] = \[([^\]]*)\]/);
  assert.ok(allowed, 'liste NUDGE_ACTION_TYPES introuvable');
  for (const t of ['connection_request', 'wait_reply', 'wait_connection', 'wait_profile_visit', 'condition_branch', 'check_connection']) {
    assert.ok(!allowed[1].includes(`'${t}'`), `${t} ne doit jamais être avancé`);
  }
});

// ---------------------------------------------------------------- SEQ-002
test('SEQ-002 — l\'auto-pause écrit la raison auto_paused, sans annuler les étapes', () => {
  assert.match(autoPause, /pauseActiveEnrollments\(supabase, \{ sequenceId: seqId \}, 'auto_paused'\)/);
  assert.doesNotMatch(autoPause, /update\(\{ status: 'paused' \}\)/, 'pause sans raison');
  assert.doesNotMatch(autoPause, /Auto-paused: high failure rate/, 'annulation des exécutions en attente');
  const helper = sliceBetween(engine, 'async function pauseActiveEnrollments', 'async function recoverEnrollmentEmail');
  assert.match(helper, /pause_reason: pauseReason/);
  assert.match(helper, /\.eq\('status', 'active'\)/);
  assert.match(helper, /if \(!target\.id && !target\.sequenceId\) return/, 'jamais de pause sans cible');
});

// ---------------------------------------------------------------- SEQ-003
test('SEQ-003 — un message livré pendant une pause est « envoyé », jamais « annulé »', () => {
  assert.doesNotMatch(loop, /status: 'cancelled', skip_reason: `Enrollment became \$\{freshEnrollment\.status\} during execution`/);
  const recheck = sliceBetween(loop, 'const postSend = decidePostSendRecheck(', '// For email steps, sequence-send-email already updated');
  assert.match(recheck, /status: 'sent'/);
  assert.match(recheck, /skip_reason: postSend\.skipReason/);
  assert.match(recheck, /current_step_order: step\.step_order \+ 1/);
  assert.doesNotMatch(recheck, /scheduleNextStep\(/, 'la suite n\'est pas planifiée');
  assert.match(recheck, /continue;/);
});

// ---------------------------------------------------------------- SEQ-004
test('SEQ-004 — reprise et relance par actions serveur, filet « étape déjà envoyée » avant l\'envoi', () => {
  for (const action of ['resume_enrollments', 're_enroll', 'mark_replied']) {
    assert.match(sliceBetween(engine, 'const MEMBER_ACTIONS', ']);'), new RegExp(`'${action}'`));
  }
  const handler = sliceBetween(engine, 'async function handleResumeEnrollments', 'async function resumeOneEnrollment');
  assert.match(handler, /resolveCallerOrganization\(/);
  assert.match(handler, /RESUME_BATCH_MAX/);
  const one = sliceBetween(engine, 'async function resumeOneEnrollment', 'async function handleMarkReplied');
  assert.match(one, /planResume\(mode, enr\.status/);
  assert.match(one, /isSenderAccountLinked\(/, 'compte d\'envoi encore relié');
  assert.match(one, /outcome: 'account_unlinked'/);
  assert.match(one, /\.eq\('status', enr\.status\)/, 'réactivation conditionnée au statut relu');

  // Une attente reste une attente ; seules les annulations de pause sont réarmables.
  assert.match(resume, /KEEP_AS_IS_PENDING = new Set\(\['waiting_event', 'sending'\]\)/);
  assert.match(resume, /'Arrêt manuel'/);
  assert.match(resume, /Interrompu pendant l'envoi/);

  const lockAt = loop.indexOf("status: 'sending',");
  const guardAt = loop.indexOf('hasAlreadySentStep(');
  const sendAt = loop.indexOf('await executeStepAction(');
  assert.ok(lockAt !== -1 && guardAt > lockAt && sendAt > guardAt, 'filet entre le verrou et l\'envoi');
  assert.match(loop, /skip_reason: 'Étape déjà envoyée'/);
});

// ---------------------------------------------------------------- SEQ-005
test('SEQ-005 — envoi incertain : échec sans relance ; e-mail parti mais non enregistré : succès', () => {
  const uncertainAt = errorBlock.indexOf('isUncertainSendError(errorStr, effectiveActionType)');
  const retryAt = errorBlock.indexOf('isRetryableError(errorStr)');
  assert.ok(uncertainAt !== -1 && uncertainAt < retryAt, 'l\'envoi incertain est traité avant les relances');
  assert.match(errorBlock, /UNCERTAIN_SEND_MESSAGE/);
  assert.match(errorBlock, /isEmailSentButNotRecorded\(errorStr\)/);
  assert.match(catchBlock, /isUncertainSendError\(errorMsg, catchActionType\)/);
  const email = sliceBetween(engine, 'async function recordEmailStepSent', 'async function logAnalytics');
  assert.match(email, /\.eq\('status', 'sending'\)/, 'écrit « envoyé » si le statut est resté en cours');
  assert.match(rules, /UNCERTAIN_PREFIX_RE = \/\^\(\?:linkedin_send_failed_\|whatsapp_send_failed_\|invite \)5\\d\\d\\b\//);
});

// ---------------------------------------------------------------- SEQ-006
test('SEQ-006 — réponse avant envoi : job_candidate_status borné à l\'organisation (échec fermé) et à la mission', () => {
  // Lot E1b : la mise à jour bornée est partagée avec « Marquer comme répondu »
  // (markCandidateRepliedInPipeline), appelée par la vérification avant envoi.
  assert.match(loop, /if \(closed\.changed\) await markCandidateRepliedInPipeline\(supabase, enrollment\)/);
  const jcs = sliceBetween(engine, 'async function markCandidateRepliedInPipeline', '\n}\n');
  assert.doesNotMatch(jcs, /if \(jcsOrgId\) jcsQuery = jcsQuery\.eq\('organization_id'/, 'ancien filtre optionnel');
  assert.match(jcs, /if \(enrollment\.profile_id && jcsOrgId\)/);
  assert.match(jcs, /\.eq\('organization_id', jcsOrgId\)/);
  assert.match(jcs, /missionJobIds\(enrollment\.job_id/);
  assert.match(jcs, /\.in\('job_id', jcsJobIds\)/);
});

// ---------------------------------------------------------------- SEQ-007
test('SEQ-007 — la synchro Notion après envoi ne sert que l\'organisation propriétaire de la configuration', () => {
  assert.match(loop, /if \(enrollmentOrgId && await canSyncNotionForOrg\(supabase, enrollmentOrgId, notionSyncAllowed\)\) \{\s*syncNotionStageAfterAction\(/);
  const gate = sliceBetween(engine, 'async function canSyncNotionForOrg', '// Raisons de pause qu');
  assert.match(gate, /notion_connected/);
  assert.match(gate, /data\.notion_api_key === envKey/);
  assert.match(gate, /\.eq\('organization_id', orgId\)/);
});

// ---------------------------------------------------------------- SEQ-010
test('SEQ-010 — le compte d\'envoi doit être relié à l\'organisation avant tout appel', () => {
  const block = sliceBetween(loop, 'const effectiveAccountId =', 'await getUserQuotas(');
  assert.match(block, /isSenderAccountLinked\(supabase, enrollmentOrgId, effectiveAccountId, senderAccountCache\)/);
  assert.match(block, /skip_reason: ACCOUNT_NOT_IN_ORG_REASON/);
  const linked = sliceBetween(engine, 'async function isSenderAccountLinked', '/**');
  assert.match(linked, /from\('member_linkedin_accounts'\)[\s\S]*?\.eq\('organization_id', orgId\)/);
  assert.match(linked, /from\('member_email_accounts'\)[\s\S]*?\.eq\('organization_id', orgId\)/);
  const health = sliceBetween(loop, '// Check LinkedIn account health before executing', 'if (accountStatus && accountStatus.account_status');
  assert.match(health, /\.eq\('organization_id', enrollmentOrgId\)/);
});

// ---------------------------------------------------------------- SEQ-013
test('SEQ-013 — l\'expéditeur de rotation doit être enregistré avant d\'envoyer', () => {
  const rotation = sliceBetween(loop, 'const sender = await pickSenderForRotation', 'const effectiveAccountId =');
  assert.match(rotation, /const \{ error: rotationErr \}/);
  const errAt = rotation.indexOf('if (rotationErr)');
  const memAt = rotation.indexOf('enrollment.assigned_sender_id = sender.account_id');
  assert.ok(errAt !== -1 && errAt < memAt, 'contrôle de l\'écriture avant la copie mémoire');
  assert.match(rotation, /15 \* 60 \* 1000/);
  assert.match(rotation, /\.eq\('status', 'scheduled'\)/);
});

// ---------------------------------------------------------------- SEQ-020
test('SEQ-020 — une correction du Journal l\'emporte sur l\'aperçu d\'inscription', () => {
  const lockAt = loop.indexOf("status: 'sending',");
  const resolveAt = loop.indexOf('resolveStepContent({');
  assert.ok(resolveAt !== -1 && resolveAt < lockAt, 'contenu résolu avant le verrou');
  assert.doesNotMatch(loop, /if \(override\.message\?\.trim\(\)\) finalMessage = override\.message\.trim\(\);/, 'l\'aperçu écrasait la correction');
  assert.match(rules, /const message = editedMessage \? \(input\.finalMessage as string\) : \(overrideMessage \|\| input\.messageTemplate \|\| ''\);/);
  assert.match(rules, /const subject = editedSubject \? \(input\.finalSubject as string\) : \(overrideSubject \|\| input\.subjectTemplate \|\| ''\);/);
});

// ---------------------------------------------------------------- SEQ-023
test('SEQ-023 — une étape échue pendant une pause n\'est plus perdue', () => {
  const select = sliceBetween(processFn, 'const { data: executions, error: fetchError }', 'if (fetchError) throw fetchError;');
  assert.match(select, /enrollment:sequence_enrollments!inner\(/);
  assert.match(select, /\.neq\('enrollment\.status', 'paused'\)/);
  assert.doesNotMatch(loop, /status: 'skipped', skip_reason: 'Enrollment inactive'/);
  const rearm = sliceBetween(processFn, 'Recovery: re-arm executions blocked on quota', 'Recovery: enrollments actifs SANS');
  assert.match(rearm, /\.eq\('enrollment\.status', 'active'\)/);
  assert.match(rearm, /\.in\('id', dueBlockedIds\)/);
});

// ---------------------------------------------------------------- SEQ-027
test('SEQ-027 — les clôtures « terminé » exigent une inscription active ; pas de saut sur une inscription inactive', () => {
  assert.doesNotMatch(schedule, /status: 'completed'/, 'plus aucune écriture directe dans scheduleNextStep');
  // Profondeur max, boucle, fin explicite, branche vide sans suite, fin du flux
  // (les deux clôtures de la garde « Si connecté » sont supprimées, SEQ-030).
  assert.equal(schedule.split('await completeEnrollmentIfActive(supabase, enrollment.id)').length - 1, 5);
  const helper = sliceBetween(engine, 'async function completeEnrollmentIfActive', '// deno-lint-ignore no-explicit-any');
  assert.match(helper, /\.eq\('status', 'active'\)/);
  assert.match(skip, /if \(enrollment\.status !== 'active'\) \{[\s\S]*?409\)/);
});

// ---------------------------------------------------------------- SEQ-028
test('SEQ-028 — compte déconnecté à l\'envoi : pause « compte déconnecté », étape annulée, hors auto-pause', () => {
  const branch = sliceBetween(errorBlock, '} else if (isAccountDisconnectedError(errorStr)) {', '} else if (isRateLimitError(errorStr)) {');
  assert.match(branch, /pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, ACCOUNT_DISCONNECTED_PAUSE_REASON\)/);
  assert.match(branch, /skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON/);
  assert.match(branch, /results\.skipped\+\+/);
  assert.doesNotMatch(branch, /failedSequenceIds\.add/);
  const inCatch = sliceBetween(catchBlock, 'isAccountDisconnectedError(errorMsg)', 'isRateLimitError(errorMsg)');
  assert.match(inCatch, /ACCOUNT_DISCONNECTED_PAUSE_REASON/);
  assert.match(inCatch, /skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON/);
});

// ---------------------------------------------------------------- SEQ-029
test('SEQ-029 — un saut de canal, de condition ou manuel ne clôt plus l\'inscription', () => {
  const guard = sliceBetween(loop, 'if (needsMessage(step.action_type) && step.step_order > 0) {', '// *** PRE-SEND REPLY CHECK ***');
  assert.match(guard, /select\('id, status, skip_reason, executed_at/);
  assert.match(guard, /shouldCloseForNoPreviousMessage\(priorMessageSteps\)/);
  assert.doesNotMatch(guard, /const anyPriorSent = priorMessageSteps\.some/);
  assert.match(rules, /isNonBlockingSkip/);
  assert.match(loop, /skip_reason: EMAIL_CHANNEL_SKIP_REASON/, 'motif de saut partagé avec la garde');
});

// ---------------------------------------------------------------- SEQ-030
test('SEQ-030 — plus de clôture sur un connection_status périmé à la planification', () => {
  assert.doesNotMatch(schedule, /candidateNext\.condition_type === 'if_connected'/);
  assert.doesNotMatch(schedule, /candidateNext\.condition_type === 'if_not_connected'/);
  assert.match(loop, /if \(!waitEnrErr\) Object\.assign\(enrollment, waitEnrollmentUpdate\);/);
});

// ---------------------------------------------------------------- SEQ-032
test('SEQ-032 — variantes A/B : le repli linéaire ne clôt plus l\'inscription', () => {
  assert.doesNotMatch(schedule, /\.eq\('step_order', currentStepOrder \+ 1\)/);
  const fallback = sliceBetween(schedule, 'const { data: candidateNext }', 'if (candidateNext) nextStep = candidateNext;');
  assert.match(fallback, /\.gt\('step_order', currentStepOrder\)/);
  assert.match(fallback, /\.order\('variant_group', \{ ascending: true, nullsFirst: true \}\)/);
  assert.match(fallback, /\.limit\(1\)/);
  const current = sliceBetween(schedule, "let currentStepQuery = supabase.from('sequence_steps')", 'const { data: currentStep }');
  assert.match(current, /\.order\('variant_group', \{ ascending: true, nullsFirst: true \}\)\s*\.limit\(1\)/);
});

// ---------------------------------------------------------------- SEQ-034
test('SEQ-034 — vérification de réponse aussi pour le premier message après une invitation', () => {
  const window = sliceBetween(loop, 'const { data: lastVisibleSentRows }', '// *** PRE-SEND REPLY CHECK ***');
  assert.match(window, /\.in\('step\.action_type', VISIBLE_SEND_ACTIONS\)/);
  assert.match(window, /\.in\('status', SENT_EXECUTION_STATUSES\)/);
  assert.match(window, /if \(priorMessageSteps\.length > 0 \|\| lastVisibleSentAt\)/);
  assert.match(rules, /VISIBLE_SEND_ACTIONS: readonly string\[\] = \[[\s\S]*?'connection_request'/);
});

// ---------------------------------------------------------------- SEQ-035
test('SEQ-035 — génération IA en échec ou texte vide : rien ne part', () => {
  const ai = sliceBetween(loop, 'const personalized = await generatePersonalizedMessage(', '// ⭐ Safety net');
  assert.match(ai, /status: 'scheduled'/);
  assert.match(ai, /final_message: preLockMessage/);
  assert.match(ai, /\.eq\('status', 'sending'\)/);
  assert.match(ai, /Génération IA indisponible/);
  assert.match(ai, /continue;/);
  const guardAt = loop.indexOf('isMissingRequiredText(effectiveActionType, finalMessage)');
  assert.ok(guardAt !== -1 && guardAt < loop.indexOf('await executeStepAction('), 'garde de texte vide avant l\'envoi');
});

// ---------------------------------------------------------------- SEQ-056
test('SEQ-056 — exécution incohérente avec son inscription : annulée sans envoi', () => {
  assert.match(loop, /step\.sequence_id !== enrollment\.sequence_id/);
  assert.match(loop, /enrOrgForCheck !== seqOrgForCheck/);
  assert.match(loop, /Étape incohérente avec l\\'inscription/);
});

// ---------------------------------------------------------------- SEQ-066
test('SEQ-066 — adresse e-mail retrouvée avant de sauter une étape e-mail', () => {
  const recoverAt = loop.indexOf('await recoverEnrollmentEmail(supabase, enrollment)');
  const skipAt = loop.indexOf('skip_reason: EMAIL_CHANNEL_SKIP_REASON');
  assert.ok(recoverAt !== -1 && recoverAt < skipAt);
  const fn = sliceBetween(engine, 'async function recoverEnrollmentEmail', '/**');
  assert.match(fn, /getOrFetchContact\(supabase, \{ organizationId: orgId, linkedinUrl: profileUrl \}\)/);
  assert.match(fn, /contact\.gdprBlocked/);
  assert.match(fn, /'undeliverable'/);
  assert.match(fn, /toLowerCase\(\)/);
  assert.match(fn, /update\(\{ email_used: email \}\)/);
});

// ---------------------------------------------------------------- SEQ-067
test('SEQ-067 — l\'état du compte LinkedIn ne bloque que les étapes LinkedIn', () => {
  assert.match(loop, /if \(effectiveAccountId && enrollmentOrgId && stepChannelForQuota === 'linkedin'\) \{/);
});

// ---------------------------------------------------------------- SEQ-070
test('SEQ-070 — les envois e-mail comptent dans les statistiques', () => {
  const email = sliceBetween(engine, 'async function recordEmailStepSent', 'async function logAnalytics');
  assert.match(email, /logAnalytics\(supabase, sequenceId, 'messages_sent'\)/);
  const success = sliceBetween(loop, '// For email steps, sequence-send-email already updated the execution', 'results.processed++;');
  assert.match(success, /recordEmailStepSent\(supabase, exec\.id/);
});

// ---------------------------------------------------------------- comportement
let canImportTs = true;
try {
  await import('../../supabase/functions/_shared/sequence-engine-rules.ts');
} catch {
  canImportTs = false;
}

test('règles pures (si Node importe le TypeScript)', { skip: !canImportTs && 'Node sans prise en charge du TypeScript' }, async () => {
  const r = await import('../../supabase/functions/_shared/sequence-engine-rules.ts');
  const s = await import('../../supabase/functions/_shared/sequence-resume.ts');
  const now = new Date('2026-09-25T10:00:00Z');
  assert.equal(r.isNudgeable('2026-09-25T14:00:00Z', now, 'Europe/Paris'), true);
  assert.equal(r.isNudgeable('2026-09-28T08:00:00Z', now, 'Europe/Paris'), false, 'relance J+3 non avancée');
  assert.deepEqual(r.decidePostSendRecheck('paused', 'message').kind, 'record_sent_and_stop');
  assert.equal(r.isUncertainSendError('linkedin_send_failed_504: x', 'message'), true);
  assert.equal(r.shouldCloseForNoPreviousMessage([{ status: 'skipped', skip_reason: 'Condition: if_connected' }]), false);
  const plan = s.planResume('resume', 'paused', 2, [
    { id: 'c', step_id: 's1', step_order: 1, status: 'cancelled', skip_reason: 'Arrêt manuel', created_at: '2026-09-01T00:00:00Z' },
    { id: 'x', step_id: 's1', step_order: 1, status: 'sent', created_at: '2026-09-02T00:00:00Z' },
  ], now.getTime());
  assert.equal(plan.kind, 'schedule_next', 'jamais une étape déjà envoyée');
  const waiting = s.planResume('resume', 'paused', 1, [{ id: 'w', step_id: 's', step_order: 1, status: 'waiting_event' }], now.getTime());
  assert.deepEqual(waiting, { kind: 'keep_pending', executionId: 'w', newScheduledAt: null });
});
