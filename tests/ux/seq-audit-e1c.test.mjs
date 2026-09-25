/**
 * Audit séquences 2026-09-25, lot E1, passe 2 — demandes croisées des autres
 * lots sur le moteur process-sequences (zone E1).
 *
 * Invariants épinglés par inspection de source (même style que
 * tests/ux/seq-audit-e1a.test.mjs et seq-audit-e1b.test.mjs), plus les règles
 * pures rejouées quand Node sait importer du TypeScript.
 *
 * Lancer : node --test tests/ux/seq-audit-e1c.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const engine = read('supabase/functions/process-sequences/index.ts');
const agentTools = read('supabase/functions/_shared/agent-tools-mutations.ts');

// Découpe tolérante (chaîne vide si le repère manque) : chaque test échoue
// alors pour son propre invariant, pas tout le fichier.
const slice = (src, start, ...ends) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const tos = ends.map((e) => src.indexOf(e, from + start.length)).filter((i) => i !== -1);
  return tos.length ? src.slice(from, Math.min(...tos)) : src.slice(from);
};

const resumeHandler = slice(engine, 'async function handleResumeEnrollments', 'async function resumeOneEnrollment');
const resumeOne = slice(engine, 'async function resumeOneEnrollment', 'async function handleMarkReplied');
const legacyHelper = slice(engine, 'async function isLegacyAssignedSender', '/**');
const processFn = slice(engine, 'async function handleProcess(', 'async function handleCheckReplies');
const loop = slice(processFn, 'for (const exec of batchedExecutions)', '// Auto-pause: if >30% of batch actions failed definitively');
const rotation = slice(loop, '// === INBOX ROTATION', 'const effectiveAccountId =');
const errorBlock = slice(loop, '// Error handling: differentiate rate limits', '} catch (err) {');
const catchBlock = loop.slice(loop.lastIndexOf('} catch (err) {'));

// ---------------------------------------------------------------- n°4 SEQ-024 (B5)
test('SEQ-024 — reprise par séquence de l\'assistant : bornée à l\'organisation, réponse lue avant le délai de l\'appelant', () => {
  // Corps envoyé par l'outil resume_sequence (clé de service) : organisation, séquence, raisons.
  assert.match(agentTools, /action: 'resume_enrollments',\s*organization_id: ctx\.organizationId,\s*sequence_id: sequenceId,\s*pause_reasons: SEQUENCE_LEVEL_PAUSE_REASONS/);
  // Filtrage : séquence de l'organisation demandée, puis chaque inscription.
  assert.match(resumeHandler, /if \(!seq \|\| \(orgId && seq\.organization_id !== orgId\)\)/);
  assert.match(resumeHandler, /\.eq\('sequence_id', req\.sequenceId\)\.eq\('status', 'paused'\)\.in\('pause_reason', reasons\)/);
  assert.match(resumeHandler, /if \(!enr \|\| \(orgId && enrOrgId !== orgId\)\)/);
  assert.match(resumeHandler, /json200\(\{ success: true, results, counts, remaining \}\)/);

  // Budget serveur sous le délai d'attente de l'outil, avec au moins 5 s de marge.
  const serverDeadline = Number(engine.match(/const RESUME_DEADLINE_MS = ([\d_]+);/)?.[1].replace(/_/g, ''));
  const resumeCall = slice(agentTools, "action: 'resume_enrollments'", '} catch {');
  const clientTimeout = Number(resumeCall.match(/\},\s*([\d_]+)\);/)?.[1].replace(/_/g, ''));
  assert.ok(Number.isFinite(serverDeadline) && Number.isFinite(clientTimeout), 'délais lisibles');
  assert.ok(serverDeadline + 5_000 <= clientTimeout, `budget ${serverDeadline} ms trop proche du délai de l'assistant (${clientTimeout} ms)`);
});

// ---------------------------------------------------------------- n°3 SEQ-010 (B4)
test('SEQ-010 — user_id hérité dans assigned_sender_id : ignoré, jamais une pause « compte non rattaché »', () => {
  assert.match(legacyHelper, /!UUID_RE\.test\(assignedSenderId\)\) return false;/, 'seuls les identifiants au format uuid');
  assert.match(legacyHelper, /\(await isSenderAccountLinked\(supabase, orgId, assignedSenderId, cache\)\) === false/, 'lecture en échec : valeur gardée');

  // Moteur : écarté AVANT la rotation et le contrôle d'appartenance.
  const dropAt = loop.indexOf('await isLegacyAssignedSender(supabase, enrollmentOrgId, enrollment.assigned_sender_id, senderAccountCache)');
  const rotationAt = loop.indexOf('sequence?.multi_sender_enabled && sequence.sender_accounts?.length > 0');
  const checkAt = loop.indexOf('await isSenderAccountLinked(supabase, enrollmentOrgId, effectiveAccountId, senderAccountCache)');
  assert.ok(dropAt !== -1 && dropAt < rotationAt && rotationAt < checkAt, 'ordre : ancien user_id écarté, rotation, contrôle');
  assert.match(loop, /enrollment\.assigned_sender_id = null;/);

  // Reprise : même lecture, sinon « compte non relié » à tort.
  assert.match(resumeOne, /await isLegacyAssignedSender\(supabase, enrOrgId, enr\.assigned_sender_id, accountCache\)\s*\? null : enr\.assigned_sender_id/);
  assert.match(resumeOne, /const senderAccount = assignedSender \|\| enr\.account_id;/);
  assert.doesNotMatch(resumeOne, /const senderAccount = enr\.assigned_sender_id \|\| enr\.account_id;/);
});

// ---------------------------------------------------------------- n°5 SEQ-013 (B6)
test('SEQ-013 — rotation : une conversation engagée garde le compte de l\'inscription, pas de nouveau tirage', () => {
  const engagedAt = rotation.indexOf(".in('status', SENT_EXECUTION_STATUSES)");
  const pickAt = rotation.indexOf('await pickSenderForRotation(supabase, sequence)');
  assert.ok(engagedAt !== -1 && pickAt !== -1 && engagedAt < pickAt, 'historique d\'envoi lu avant tout tirage');
  const engagedBranch = slice(rotation, 'if ((engagedRows ?? []).length > 0) {', '} else {');
  assert.match(engagedBranch, /\.update\(\{ assigned_sender_id: enrollment\.account_id \}\)/);
  assert.doesNotMatch(engagedBranch, /pickSenderForRotation/);
  // Figé = enregistré avant d'envoyer, comme un tirage (sinon report de 15 min).
  assert.match(engagedBranch, /if \(freezeErr\) \{[\s\S]*?15 \* 60 \* 1000[\s\S]*?continue;/);
  // Historique illisible : pas de tirage à l'aveugle.
  assert.match(rotation, /if \(engagedErr\) \{[\s\S]*?\.eq\('status', 'scheduled'\);[\s\S]*?continue;/);
});

// ---------------------------------------------------------------- n°12 SEQ-155 (E3)
test('SEQ-155 — aucun expéditeur disponible : étape bloquée jusqu\'au lendemain, jamais de repli sur le compte de l\'inscription', () => {
  assert.match(engine, /const ROTATION_SENDERS_EXHAUSTED_REASON = 'Tous les expéditeurs ont atteint leur limite du jour';/);
  const noSender = slice(rotation, 'if (!sender) {', 'continue;');
  assert.match(noSender, /status: 'quota_blocked'/);
  assert.match(noSender, /skip_reason: ROTATION_SENDERS_EXHAUSTED_REASON/);
  assert.match(noSender, /quotaBlockedRetryAt\('daily', new Date\(\), enrollment\.user_timezone, DEFAULT_USER_QUOTAS\.business_hours_start\)/);
  assert.match(noSender, /\.eq\('status', 'scheduled'\)/);
  assert.match(noSender, /results\.quota_blocked\+\+/);
  assert.doesNotMatch(rotation, /if \(sender\) \{/, 'plus de chemin « sans expéditeur » qui continue vers l\'envoi');
});

// ---------------------------------------------------------------- n°6 SEQ-077 (E2)
test('SEQ-077 — « Si pas de réponse » impossible à vérifier : message de vérification de réponse, pas de lecture de profil', () => {
  const retry = slice(loop, 'if (isConditionRetry(rawCondition)) {', 'let conditionResult = rawCondition;');
  assert.match(retry, /const replyCheckRetry = step\.condition_type === 'if_no_response' && !step\.wait_for_event;/);
  assert.match(retry, /replyCheckRetry\s*\? REPLY_CHECK_RETRY_MESSAGE\(conditionRetryCount \+ 1, MAX_RETRIES\)\s*: PROFILE_READ_RETRY_MESSAGE\(conditionRetryCount \+ 1, MAX_RETRIES\)/);
  assert.match(retry, /replyCheckRetry \? REPLY_CHECK_FAILED_MESSAGE : PROFILE_READ_FAILED_MESSAGE/);
});

// ---------------------------------------------------------------- n°7 SEQ-088 (E2)
test('SEQ-088 — report après limite du fournisseur : erreur, mode InMail et fuseau d\'envoi transmis', () => {
  assert.match(errorBlock, /getRateLimitRetryDate\(step\.action_type, userTimezone, \{ error: errorStr, sentAsInMail: executeResult\.needsInMail \}\)/);
  assert.match(catchBlock, /getRateLimitRetryDate\(catchActionType, resolvedSendTimezone \|\| enrollment\?\.user_timezone \|\| 'Europe\/Paris', \{ error: errorMsg \}\)/);
  assert.doesNotMatch(loop, /getRateLimitRetryDate\([^)]*enrollment\.user_timezone \|\| 'Europe\/Paris'\)/, 'ancien appel sans fuseau résolu');
  // Le fuseau résolu est connu du catch (déclaré hors du try, renseigné après pickSendingTimezone).
  const declAt = loop.indexOf('let resolvedSendTimezone: string | null = null;');
  const tryAt = loop.indexOf('try {', declAt);
  assert.ok(declAt !== -1 && tryAt > declAt, 'déclaré avant le try');
  assert.match(loop, /resolvedSendTimezone = userTimezone;/);
});

// ---------------------------------------------------------------- n°9 SEQ-121 (E3)
test('SEQ-121 — crédits InMail épuisés à l\'envoi : bloquée jusqu\'au lendemain, ni relance ni échec de séquence', () => {
  const credits = slice(errorBlock, "errorStr.toLowerCase().startsWith('inmail_credits_exhausted')", '} else if (isRateLimitError(errorStr))');
  assert.match(credits, /status: 'quota_blocked'/);
  assert.match(credits, /skip_reason: 'Crédits InMail épuisés'/);
  assert.match(credits, /quotaBlockedRetryAt\('daily', new Date\(\), userTimezone, userQuotas\.business_hours_start\)/);
  assert.match(credits, /\.eq\('status', 'sending'\)/);
  assert.match(credits, /final_message: finalMessage \|\| null/, 'texte résolu gardé');
  assert.doesNotMatch(credits, /noteSequenceFailure|retry_count|results\.failed/);
  const creditsAt = errorBlock.indexOf("startsWith('inmail_credits_exhausted')");
  const retryableAt = errorBlock.indexOf('isRetryableError(errorStr)');
  assert.ok(creditsAt !== -1 && creditsAt < retryableAt, 'avant la relance générique à 30 min');
  // Échec propre au candidat : hors auto-pause (déjà en place).
  assert.match(errorBlock, /if \(!executeResult\.candidateError\) noteSequenceFailure\(enrollment\.sequence_id\);/);
});

// ---------------------------------------------------------------- n°13 SEQ-092 (E3)
test('SEQ-092 — génération IA en échec : la cause précise est affichée dans le report et l\'échec', () => {
  const ai = slice(loop, 'const personalized = await generatePersonalizedMessage(', '// ⭐ Safety net');
  assert.match(loop, /const aiDiag: \{ reason\?: string; deadlineMs: number \} = \{ deadlineMs: cycleDeadline \};/);
  assert.match(ai, /^const personalized = await generatePersonalizedMessage\(supabase, enrollment, step, exec, uCreds\.apiKey, uCreds\.dsn, aiDiag\)/);
  assert.match(ai, /const aiFailure = \(aiDiag\.reason \|\| 'Génération IA indisponible'\)\.replace\(/);
  assert.match(ai, /error_message: `\$\{aiFailure\} : nouvel essai \$\{aiRetryCount \+ 1\}\/\$\{MAX_RETRIES\} dans 30 min`/);
  assert.match(ai, /error_message: `\$\{aiFailure\} : message non envoyé après plusieurs essais\. Relancez l'étape plus tard\.`/);
  // La mention « étape reportée » d'une raison n'est pas doublée.
  const reason = 'Message IA non conforme (salaire, signature ou posture) : étape reportée';
  assert.equal(reason.replace(/\s*:\s*étape reportée$/, ''), 'Message IA non conforme (salaire, signature ou posture)');
});

// ---------------------------------------------------------------- n°11 SEQ-193 (E3)
let canImportTs = true;
try {
  await import('../../supabase/functions/_shared/sequence-cycle-rules.ts');
} catch {
  canImportTs = false;
}

test('SEQ-193 — plus aucun crédit InMail : report au début de la plage du lendemain, comme le plafond du jour', { skip: !canImportTs && 'Node sans prise en charge du TypeScript' }, async () => {
  const gate = slice(loop, 'await checkQuotaForAction(', 'results.quota_blocked++;');
  assert.match(gate, /const retryScope = quotaCheck\.scope === 'inmail_credits' \? 'daily' : quotaCheck\.scope;/);
  const { quotaBlockedRetryAt } = await import('../../supabase/functions/_shared/sequence-cycle-rules.ts');
  const now = new Date('2026-09-24T12:00:00Z'); // jeudi, 14 h à Paris
  const daily = quotaBlockedRetryAt('daily', now, 'Europe/Paris', 8);
  assert.equal(daily.toISOString(), '2026-09-25T06:00:00.000Z', 'lendemain 8 h à Paris');
  // Avant : 'inmail_credits' tombait dans le cas par défaut (+24 h, en pleine journée).
  assert.equal(quotaBlockedRetryAt('inmail_credits', now, 'Europe/Paris', 8).toISOString(), '2026-09-25T12:00:00.000Z');
});
