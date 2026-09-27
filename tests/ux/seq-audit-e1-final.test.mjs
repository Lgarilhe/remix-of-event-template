/**
 * Audit séquences 2026-09-25, vague finale du lot E1 (moteur process-sequences,
 * zone E1) : décisions D1, D2, D3 et D5 du contrat, puis les points de la
 * relecture contradictoire.
 *
 * Invariants épinglés par inspection de source (même style que
 * tests/ux/seq-audit-e1a.test.mjs). Les règles pures sont en plus testées sous
 * Deno : supabase/functions/_shared/sequence-{engine,cycle}-rules.test.ts et
 * sequence-resume.test.ts.
 *
 * Lancer : node --test tests/ux/seq-audit-e1-final.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');
const engineRules = read('supabase/functions/_shared/sequence-engine-rules.ts');
const cycleRules = read('supabase/functions/_shared/sequence-cycle-rules.ts');
const resumeRules = read('supabase/functions/_shared/sequence-resume.ts');
const e2eSpec = read('e2e/api/sequences-engine.spec.ts');

// Découpe tolérante (chaîne vide si le repère manque) : chaque test échoue
// alors pour son propre invariant, pas tout le fichier.
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const callerOrg = slice(engine, 'async function resolveCallerOrganization', '// Refus D3');
const nudge = slice(engine, 'async function handleNudgeSequences', 'async function handleSkipExecution');
const skip = slice(engine, 'async function handleSkipExecution', 'async function isSenderAccountLinked');
const resumeHandler = slice(engine, 'async function handleResumeEnrollments', 'async function resumeOneEnrollment');
const resumeOne = slice(engine, 'async function resumeOneEnrollment', 'async function handleMarkReplied');
const markReplied = slice(engine, 'async function handleMarkReplied', 'async function acquireLock');
const processFn = slice(engine, 'async function handleProcess(', 'async function handleCheckReplies');
const selection = slice(processFn, 'const dueCandidates: DueExecution[] = [];', 'if (fetchError) throw fetchError;');
const dormant = slice(processFn, 'Recovery: enrollments actifs SANS', 'Smart batching: fetch more candidates');
const loop = slice(processFn, 'for (const exec of batchedExecutions)', '// Auto-pause: if >30% of batch actions failed definitively');
const gate = slice(loop, '// === SUBSCRIPTION GATE', '// === AUTO-SKIP: channel unavailable ===');
const channels = slice(loop, '// === AUTO-SKIP: channel unavailable ===', '// Resolve Unipile credentials per-org');
const rotation = slice(loop, '// === INBOX ROTATION', 'const effectiveAccountId =');
const health = slice(loop, "if (accountStatus.account_status === 'CREDENTIALS'", '// Type d\'étape transmis');
const errorBlock = slice(loop, '// Error handling: differentiate rate limits', '} catch (err) {');
const closeReplied = slice(engine, 'async function closeEnrollmentAsReplied', 'async function cancelPendingExecutions');

// ---------------------------------------------------------------- n°1 D2
test('n°1 D2 — étapes e-mail et WhatsApp sautées avant toute recherche d\'adresse ou tout envoi', () => {
  const closedAt = channels.indexOf('const closedChannelReason = closedChannelSkipReason(step);');
  const recoverAt = channels.indexOf('recoverEnrollmentEmail(supabase, enrollment)');
  assert.ok(closedAt !== -1 && recoverAt !== -1 && closedAt < recoverAt, 'saut du canal fermé avant recoverEnrollmentEmail');
  const closedBranch = slice(channels, 'if (closedChannelReason) {', 'continue;');
  assert.match(closedBranch, /status: 'skipped', skip_reason: closedChannelReason/);
  assert.match(closedBranch, /\.eq\('status', 'scheduled'\)\.select\('id'\)/);
  assert.match(closedBranch, /await scheduleNextStep\(supabase, enrollment, step\.step_order, undefined, undefined, 0, step\.id\)/);
  assert.doesNotMatch(closedBranch, /executeStepAction|sequence-send-email|recoverEnrollmentEmail/);
  assert.match(engineRules, /export const CLOSED_SEND_CHANNELS: readonly string\[\] = \['email', 'whatsapp'\];/);
  assert.match(engineRules, /EMAIL_CHANNEL_CLOSED_SKIP_REASON, WHATSAPP_CHANNEL_CLOSED_SKIP_REASON,\n\]\);/, 'jamais la garde no_previous_message');
});

// ---------------------------------------------------------------- D1
test('D1 — une séquence désactivée n\'envoie rien : sélection, rattrapages et dernier contrôle', () => {
  assert.match(selection, /sequence:outreach_sequences!inner\(is_active\)/);
  assert.match(selection, /\.eq\('enrollment\.sequence\.is_active', true\)/);
  assert.match(slice(processFn, 'const dueBlocked', 'const dueBlockedIds'), /\.eq\('enrollment\.sequence\.is_active', true\)/);
  assert.match(dormant, /\.eq\('sequence\.is_active', true\)/);
  const lastCall = slice(loop, '// ⭐ LAST-CALL CHECK', 'const executeResult = await executeStepAction(');
  assert.match(lastCall, /if \(lastCall\.status === 'paused' \|\| sequenceDeactivated\) \{[\s\S]*?status: 'scheduled'/);
});

// ---------------------------------------------------------------- n°2 et n°5 D5
test('n°2 / n°5 D5 — reprise et relance refusées pour une inscription touchée par un effacement', () => {
  const gdprAt = resumeOne.indexOf('isGdprErasedEnrollment(enr.tracking_data, executions)');
  const planAt = resumeOne.indexOf('const plan = planResume(');
  const firstWriteAt = resumeOne.indexOf('.update(');
  assert.ok(gdprAt !== -1 && gdprAt < planAt && gdprAt < firstWriteAt, 'refus avant toute écriture et quel que soit le statut');
  assert.match(resumeOne, /isGdprBlocked\(supabase, \{ linkedinUrl: enr\.profile_url \}\)/, 'registre global');
  assert.match(resumeOne, /return \{ outcome: 'error', message: GDPR_ERASED_RESUME_MESSAGE \};/);
  assert.match(resumeHandler, /completed_at, profile_url, sequence:outreach_sequences/);
  assert.match(resumeRules, /export const GDPR_ERASED_RESUME_MESSAGE = "Ce candidat a demandé l'effacement de ses données : il ne peut plus être relancé\.";/);
  assert.match(resumeRules, /executions\.some\(\(e\) => e\.skip_reason === GDPR_ERASURE_SKIP_REASON\)/);
});

// ---------------------------------------------------------------- n°3
test('n°3 — e-mail coupé après 30 s : exécution laissée « en cours d\'envoi », jamais un échec rejouable', () => {
  const unknownAt = errorBlock.indexOf("} else if (effectiveActionType === 'email' && isEmailOutcomeUnknown(errorStr)) {");
  const uncertainAt = errorBlock.indexOf('} else if (isUncertainSendError(errorStr, effectiveActionType)) {');
  assert.ok(unknownAt !== -1 && unknownAt < uncertainAt);
  const unknownBranch = errorBlock.slice(unknownAt, uncertainAt);
  assert.doesNotMatch(unknownBranch, /\.update\(/, 'rien n\'est écrit : le rattrapage tranche avec la preuve d\'envoi');
  const uncertain = slice(errorBlock, '} else if (isUncertainSendError(errorStr, effectiveActionType)) {', '} else if (isMailboxDisconnectedError');
  assert.match(uncertain, /\}\)\.eq\('id', exec\.id\)\.eq\('status', 'sending'\);/);
  assert.match(errorBlock, /status: 'failed', error_message: executeResult\.error[^\n]*\.eq\('id', exec\.id\)\.eq\('status', 'sending'\);/);
  // Défense : preuve d'envoi d'une autre exécution de la même étape.
  assert.match(loop, /from\('sequence_email_tracking'\)\s*\.select\('id'\)\.in\('execution_id', otherStepExecIds\)\.not\('email_message_id', 'is', null\)/);
  assert.match(loop, /if \(emailProofOnOtherExec \|\| \(!sameStepErr && hasAlreadySentStep/);
});

// ---------------------------------------------------------------- n°4
test('n°4 — rotation : tirage seulement pour une étape LinkedIn, suite selon la cause', () => {
  assert.match(rotation, /!enrollment\.assigned_sender_id\s*&& stepUsesLinkedInSender\(step\)\) \{/);
  assert.match(rotation, /await pickSenderForRotation\(supabase, sequence, rotationDiag\)/);
  assert.match(rotation, /if \(unavailable\?\.kind === 'retry_soon'\) \{[\s\S]*?error_message: unavailable\.message[\s\S]*?continue;/);
  const blocked = slice(rotation, "if (unavailable?.kind === 'block_until_tomorrow') {", 'continue;');
  assert.match(blocked, /skip_reason: ROTATION_SENDERS_EXHAUSTED_REASON/);
  // ROTATION_SENDERS_EXHAUSTED_REASON n'est plus posé que dans ce cas.
  assert.equal(rotation.split('ROTATION_SENDERS_EXHAUSTED_REASON').length - 1, 1);
  assert.match(cycleRules, /if \(cause === 'empty_pool' \|\| cause === 'no_org'\) return \{ kind: 'use_enrollment_account' \};/);
});

// ---------------------------------------------------------------- n°6 et n°7 D3
test('n°6 / n°7 D3 — actions membres : un collaborateur n\'agit que sur ses propres inscriptions', () => {
  assert.match(callerOrg, /\.from\('organization_members'\)\.select\('id, role'\)/);
  assert.match(callerOrg, /return \{ orgId, role: /);
  // Reprise et relance par liste : refus par inscription.
  assert.match(resumeHandler, /if \(!canActOnEnrollment\(\{ userId: callerUserId, role: caller\.role \}, enr\.created_by\)\) \{/);
  assert.match(resumeHandler, /mode === 're_enroll' \? COLLABORATOR_RE_ENROLL_MESSAGE : COLLABORATOR_RESUME_MESSAGE/);
  // Reprise par séquence : seules ses inscriptions sont lues.
  assert.match(resumeHandler, /if \(callerUserId && caller\.role === 'collaborator'\) pausedQuery = pausedQuery\.eq\('created_by', callerUserId\);/);
  assert.match(markReplied, /if \(!canActOnEnrollment\(\{ userId: callerUserId, role: caller\.role \}, enr\.created_by\)\) \{\s*return memberError\('forbidden', COLLABORATOR_ACTION_MESSAGE, 403\);/);
  assert.match(markReplied, /job_id, created_by, sequence:outreach_sequences/);
  assert.match(skip, /const caller = await resolveCallerOrganization\(supabase, orgId, callerUserId\);/);
  assert.match(skip, /canActOnEnrollment\(\{ userId: callerUserId, role: caller\.role \}, enrollment\.created_by\)/);
  assert.match(nudge, /if \(callerUserId && caller\.role === 'collaborator'\) execQuery = execQuery\.eq\('enrollment\.created_by', callerUserId\);/);
  assert.match(nudge, /enrollment:sequence_enrollments!inner\(id, user_timezone, organization_id, status, sequence_id, created_by\)/);
});

// ---------------------------------------------------------------- n°8
test('n°8 — famine entre organisations : sélection légère par pages, cadence par compte au fil des pages', () => {
  assert.doesNotMatch(processFn, /const FETCH_LIMIT = 100;/);
  assert.match(selection, /\.range\(from, from \+ SELECTION_PAGE_SIZE - 1\)/);
  assert.match(selection, /\.order\('scheduled_at', \{ ascending: true \}\)\s*\.order\('id', \{ ascending: true \}\)/);
  assert.match(selection, /if \(!shouldReadNextSelectionPage\(page, pageList\.length, cycleSelection\.selected\.length\)\) break;/);
  assert.match(selection, /\.in\('id', selectedIds\)/, 'relecture complète des seules exécutions retenues');
  // Inscriptions closes hors plafond par compte.
  assert.match(cycleRules, /if \(enrollmentStatus && enrollmentStatus !== 'active'\) \{\s*if \(closed >= maxClosed\) continue;/);
});

// ---------------------------------------------------------------- n°9
test('n°9 — rotation sans migration B6 (22P02) : envoi depuis le compte de l\'inscription, jamais une boucle muette', () => {
  assert.match(rotation, /if \(rotationErr && isInvalidTextRepresentation\(rotationErr\)\) \{/);
  const saveFailed = slice(rotation, '} else if (rotationErr) {', 'continue;');
  assert.match(saveFailed, /error_message: ROTATION_SENDER_NOT_SAVED_MESSAGE/);
  assert.match(rotation, /if \(freezeErr && isInvalidTextRepresentation\(freezeErr\)\) \{/);
  assert.match(cycleRules, /export const ROTATION_SENDER_NOT_SAVED_MESSAGE = 'Expéditeur de rotation non enregistré : envoi reporté';/);
});

// ---------------------------------------------------------------- n°10
test('n°10 — boîte e-mail déconnectée : pause « send_failed » reprenable, jamais « compte LinkedIn déconnecté »', () => {
  const mailboxAt = errorBlock.indexOf('} else if (isMailboxDisconnectedError(errorStr)) {');
  const linkedinAt = errorBlock.indexOf('} else if (isAccountDisconnectedError(errorStr)) {');
  assert.ok(mailboxAt !== -1 && mailboxAt < linkedinAt, 'traitée avant isAccountDisconnectedError');
  const mailbox = errorBlock.slice(mailboxAt, linkedinAt);
  assert.match(mailbox, /pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, 'send_failed', \{\s*tracking_data: \{[\s\S]*?pause_reason: mailboxLabel \}/);
  assert.match(mailbox, /if \(mailboxPause\.count > 0\) \{[\s\S]*?skip_reason: MAILBOX_DISCONNECTED_SKIP_REASON/);
  assert.doesNotMatch(mailbox, /ACCOUNT_DISCONNECTED_PAUSE_REASON|ACCOUNT_DISCONNECTED_SKIP_REASON/);
  assert.match(resumeRules, /ACCOUNT_NOT_IN_ORG_REASON,\n\s+MAILBOX_DISCONNECTED_SKIP_REASON,\n\];/, 'réarmable par resume_enrollments');
});

// ---------------------------------------------------------------- n°11
test('n°11 — abonnement et compte déconnecté : pause d\'une inscription encore active seulement', () => {
  assert.match(gate, /const gatePaused = await pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, 'subscription_required'/);
  assert.match(gate, /if \(gatePaused\.count > 0\) \{[\s\S]*?status: 'cancelled', skip_reason: SUBSCRIPTION_REQUIRED_REASON[\s\S]*?\.eq\('status', 'scheduled'\)/);
  assert.doesNotMatch(gate, /status: 'paused'/, 'plus d\'update d\'inscription sans garde de statut');
  assert.match(health, /const accountPause = await pauseActiveEnrollments\(supabase, \{ id: enrollment\.id \}, ACCOUNT_DISCONNECTED_PAUSE_REASON\);/);
  assert.match(health, /if \(accountPause\.count > 0\) \{[\s\S]*?skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON[\s\S]*?\.eq\('status', 'scheduled'\)/);
  assert.doesNotMatch(health, /status: 'paused'/);
});

// ---------------------------------------------------------------- n°12
test('n°12 — « quota_blocked » échus d\'une inscription close : annulés', () => {
  const janitor = slice(processFn, 'const { data: closedBlocked', '// Recovery: enrollments actifs SANS');
  assert.match(janitor, /\.eq\('status', 'quota_blocked'\)/);
  assert.match(janitor, /\.not\('enrollment\.status', 'in', '\(active,paused\)'\)/);
  assert.match(janitor, /status: 'cancelled', skip_reason: `Inscription close avant l'envoi \(\$\{closedStatus\}\)`/);
});

// ---------------------------------------------------------------- n°13
test('n°13 — « Marquer comme répondu » : succès dès que l\'inscription est close, pipeline mis à jour', () => {
  assert.match(markReplied, /if \(closed\.failed && !closed\.changed && !alreadyReplied\) \{/);
  assert.match(markReplied, /if \(closed\.changed \|\| alreadyReplied\) await markCandidateRepliedInPipeline\(supabase, target\);/);
});

// ---------------------------------------------------------------- n°14
test('n°14 — reprise sans étape créée : erreur explicite, pas « séquence terminée »', () => {
  assert.match(resumeOne, /if \(sequenceFinished\) return \{ outcome: 'nothing_to_resume', message: RESUME_MESSAGES\.nothing \};/);
  assert.match(resumeOne, /mode === 'resume' \? RESUME_MESSAGES\.notScheduledResume : RESUME_MESSAGES\.notScheduledReEnroll/);
  assert.doesNotMatch(engine, /accountUnlinked: 'Ce compte LinkedIn n\\'est plus relié/);
});

// ---------------------------------------------------------------- n°15 / n°20
test('n°15 / n°20 — reprise par séquence : au-delà des 1 000 lus, le reste compte dans « remaining »', () => {
  assert.match(resumeHandler, /\.select\('id', \{ count: 'exact' \}\)/);
  assert.match(resumeHandler, /beyondReadLimit = Math\.max\(0, /);
  assert.match(resumeHandler, /remaining \+= beyondReadLimit;/);
});

// ---------------------------------------------------------------- n°16
test('n°16 — une réponse arrête aussi les autres inscriptions du candidat (tous les chemins de détection)', () => {
  assert.match(closeReplied, /if \(changed\) await stopSiblingEnrollmentsAfterReply\(supabase, enrollment\);/);
  const siblings = slice(engine, 'async function stopSiblingEnrollmentsAfterReply', '/**');
  assert.match(siblings, /\.eq\('organization_id', orgId\)\.in\('status', \['active', 'paused'\]\)\.neq\('id', enrollment\.id\)\.or\(filter\)/);
  assert.match(siblings, /status: 'stopped'/);
  assert.match(siblings, /skip_reason: SIBLING_REPLY_SKIP_REASON/);
  assert.match(markReplied, /profile_id, resolved_profile_id, provider_id/);
});

// ---------------------------------------------------------------- n°17
test('n°17 — e2e « Envoyer les actions du jour » : compteur advanced et borne de fin de journée', () => {
  assert.match(e2eSpec, /res\.body\.advanced/);
  assert.doesNotMatch(e2eSpec, /res\.body\.rescheduled/);
  assert.match(e2eSpec, /Europe\/Paris/);
  assert.match(e2eSpec, /demain/);
});

// ---------------------------------------------------------------- n°19 / n°21
test('n°19 / n°21 — variables d\'une étape e-mail, texte de pause retiré à la réactivation', () => {
  assert.match(loop, /senderUserId = await resolveSequenceSenderUserId\(supabase, enrollment, step\) \?\? senderUserId;/);
  assert.match(resumeOne, /const withoutPauseText = trackingWithoutPauseReason\(activatePatch\.tracking_data \?\? enr\.tracking_data\);/);
});
