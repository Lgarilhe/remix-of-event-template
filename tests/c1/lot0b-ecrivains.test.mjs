/**
 * Refonte mission, lot 0b : garde-fous statiques des écrivains de l'étape
 * candidat (plan final, section 9).
 *
 * Même forme que c1-fonctions.test.mjs : lecture du source et assertions sur
 * les motifs, sans navigateur, sans base ni runtime Deno. Chaque sous-lot
 * ajoute ici ses assertions, pour que la CI de chaque PR reste verte.
 *
 * Lancer : node --test tests/c1/lot0b-ecrivains.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Corps d'une fonction de premier niveau : de sa déclaration à la première
// accolade fermante en colonne 0.
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

// Corps d'un hook déclaré par `const nom = useCallback(` : jusqu'à la fin de
// son tableau de dépendances.
function callbackBody(src, name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const end = src.indexOf('\n  }, [', start);
  assert.ok(end > start, `fin de ${name} introuvable`);
  return src.slice(start, end);
}

const SCORE = 'supabase/functions/score-profile-job/index.ts';
const SCORING_HOOK = 'src/hooks/useLinkedInScoring.ts';
const JCS_HOOK = 'src/hooks/useJobCandidateStatus.ts';

// ─── 0b-3 : la notation n'écrit plus l'étape ni « écarté » ──────────────────

test('0b-3 : score-profile-job n\'écrit plus jamais « dismissed »', () => {
  const src = read(SCORE);
  assert.doesNotMatch(src, /'dismissed'|"dismissed"/);
  const body = fnBody(src, 'async function syncJobCandidateStatus(');
  assert.match(body, /const status = 'scored';/);
  assert.doesNotMatch(body, /pipeline_stage/, 'la notation ne touche pas l\'étape');
  assert.match(body, /skip_reason: result\.skipReason/, 'raison de la suggestion d\'écart, si présente');
  // La raison de l'IA n'est écrite que sur les lignes au stade de la notation :
  // jamais dans la mise à jour « note seule », qui vise aussi les écartés par l'utilisateur.
  const noteStart = body.indexOf('const note = {');
  const noteEnd = body.indexOf('\n    };\n', noteStart);
  assert.ok(noteStart > 0 && noteEnd > noteStart, 'objet note introuvable');
  assert.doesNotMatch(body.slice(noteStart, noteEnd), /skip_reason/, 'skip_reason absent de la note seule');
  assert.match(body, /\.update\(\{ \.\.\.note, status, \.\.\.\(result\.skipReason \? \{ skip_reason: result\.skipReason \} : \{\}\) \}\)/);
  assert.match(src, /const AI_REWRITABLE_STATUSES = \['new', 'discovered', 'untreated', 'scored'\];/);
});

test('0b-3 : useLinkedInScoring n\'archive plus après notation', () => {
  const src = read(SCORING_HOOK);
  assert.doesNotMatch(src, /\bbatchDismiss\b/, 'plus aucun archivage par la notation');
  assert.doesNotMatch(src, /Profil écarté/);
  assert.doesNotMatch(src, /écarté\$\{/, 'le bilan ne parle plus d\'écartés');
  assert.match(src, /peu adapté\$\{[^}]*\}, à confirmer/);
  // Toutes les notes réelles passent par batchSaveScores, raison comprise.
  assert.match(src, /const realScoredProfiles = \[\.\.\.goodScoreProfiles, \.\.\.lowScoreProfiles\];/);
  assert.match(src, /batchSaveScores\(realScoredProfiles\)/);
  assert.match(src, /skipReason: result\.summary \|\| 'Score insuffisant'/);
});

test('0b-3 : les résultats factices d\'un 429 ne sont pas enregistrés', () => {
  const src = read(SCORING_HOOK);
  const placeholder = src.indexOf("summary: 'Rate limited - réessayez plus tard'");
  assert.ok(placeholder > 0, 'résultat factice introuvable');
  assert.match(src.slice(placeholder, placeholder + 600), /rateLimitedPlaceholder: true/);
  const skip = src.indexOf('if (rawResult?.rateLimitedPlaceholder) return;');
  const push = src.indexOf('lowScoreProfiles.push(');
  assert.ok(skip > 0 && skip < push, 'le résultat factice sort avant les listes à enregistrer');
});

test('0b-3 : une note n\'écrit plus le statut dans l\'upsert (N10, N11)', () => {
  const src = read(JCS_HOOK);
  assert.match(src, /const SCORABLE_STATUSES = \['new', 'discovered', 'untreated'\];/);
  const mark = fnBody(src, 'async function markScored(');
  assert.match(mark, /\.update\(\{ status: 'scored' \}\)/);
  assert.match(mark, /\.in\('id', /);
  assert.match(mark, /\.in\('status', SCORABLE_STATUSES\)/);
  const payloads = [['saveScore', '.upsert({', 'onConflict'], ['batchSaveScores', 'const toRecord', '\n      };\n']];
  for (const [name, payloadStart, payloadEnd] of payloads) {
    const body = callbackBody(src, name);
    const from = body.indexOf(payloadStart);
    const to = body.indexOf(payloadEnd, from);
    assert.ok(from > 0 && to > from, `${name} : charge de l'upsert introuvable`);
    assert.doesNotMatch(body.slice(from, to), /\bstatus:/, `${name} : aucun statut dans l'upsert`);
    assert.doesNotMatch(body, /keepStatus/, `${name} : ancienne règle de statut`);
    assert.match(body, /await markScored\(/, `${name} : passage à scored filtré ensuite`);
    // Statut local d'abord (fusion des deux formes de job_id), puis celui relu en base.
    assert.match(body, /statusAfterScore\(existing\?\.status, saved\?\.(\[0\]\?\.)?status\)/,
      `${name} : état local aligné sur la base`);
  }
  const scoring = fnBody(src, 'function isScoringStatus(');
  assert.match(scoring, /SCORABLE_STATUSES\.includes\(status\)/);
  const after = fnBody(src, 'function statusAfterScore(');
  assert.match(after, /if \(!isScoringStatus\(local\)\) return local/, 'un statut local avancé est gardé');
  // Un échec de passage à scored remonte (pas d'état local « scored » menteur).
  assert.match(mark, /if \(error\) throw error;/);
  // En lot : passage à scored juste après l'upsert de chaque groupe, dans la boucle.
  const batch = callbackBody(src, 'batchSaveScores');
  const loop = batch.slice(batch.indexOf('for (const group of groups)'), batch.indexOf('// Update local state'));
  assert.match(loop, /await markScored\(/, 'markScored dans la boucle des groupes');
  assert.equal(batch.match(/await markScored\(/g).length, 1, 'un seul appel, dans la boucle');
  // Rechargement : une ligne au stade de la notation ne masque pas l'autre forme de job_id plus avancée.
  const fetch = callbackBody(src, 'fetchStatuses');
  assert.match(fetch, /status: isScoringStatus\(base\.status\) && !isScoringStatus\(other\.status\) \? other\.status : base\.status/);
});

// ─── 0b-2a : écrivains serveur (réponse, envoi, message propre, rendez-vous) ─

const WEBHOOK = 'supabase/functions/unipile-webhook/index.ts';
const ENGINE = 'supabase/functions/process-sequences/index.ts';
const EVENTS = 'supabase/functions/_shared/candidate-stage-events.ts';
const SEARCH = 'supabase/functions/unipile-search/index.ts';
const INMAIL = 'supabase/functions/process-inmail-queue/index.ts';
const CALENDLY = 'supabase/functions/calendly-webhook/index.ts';
const ANALYZE = 'supabase/functions/auto-analyze-message/index.ts';
const MUTATIONS = 'supabase/functions/_shared/agent-tools-mutations.ts';

// Corps d'une fonction de premier niveau, jusqu'à la déclaration suivante.
function topLevelBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const next = src.slice(start + signature.length).search(/\n(async function|function|interface|const [A-Za-z_]+ = |export )/);
  return next >= 0 ? src.slice(start, start + signature.length + next) : src.slice(start);
}

test('0b-2a : aide partagée, une fonction SQL par appel et classement des erreurs (décision 9)', () => {
  const src = read(EVENTS);
  for (const fn of ['record_candidate_outbound', 'record_candidate_inbound', 'record_own_message',
    'record_reply_summary', 'resolve_meeting_mission', 'record_candidate_meeting']) {
    assert.match(src, new RegExp(`callStageRpc(?:<[^>]+>)?\\(client, '${fn}', \\{`), fn);
  }
  const classify = topLevelBody(src, 'export function classifyStageRpcError(');
  assert.match(src, /const BUSINESS_CODES = new Set\(\['22023', 'P0002', '42501'\]\);/);
  assert.match(src, /const MISSING_CODES = new Set\(\['PGRST202', '42883'\]\);/);
  assert.match(src, /const BUSINESS_HINT_RE = \/\^\(STAGE\|MISSION\|LINK\)_\/;/);
  assert.match(classify, /return 'transient';/);
  // Aucun appel ne lève : l'erreur est rendue avec son classement.
  const call = topLevelBody(src, 'async function callStageRpc');
  assert.match(call, /\} catch \(err\) \{\s*return \{ ok: false,/);
  // Marqueur jamais NULL (NULL enregistrerait l'envoi sans « Contacté »).
  assert.match(src, /p_pending: input\.pending === true,/);
});

test('0b-2a (S2) : le webhook passe par record_candidate_inbound, après les clôtures, par organisation', () => {
  const src = read(WEBHOOK);
  assert.doesNotMatch(src, /markCandidateRepliedInPipeline|\.from\('job_candidate_status'\)/);
  const msg = topLevelBody(src, 'async function handleNewMessage(');
  const closures = msg.indexOf('await closeSiblingEnrollments(');
  const stage = msg.indexOf('await recordInbound(supabase, {');
  const failuresCheck = msg.indexOf('if (failures.length > 0) {');
  assert.ok(closures > 0 && stage > closures && failuresCheck > stage, 'après les clôtures, avant le contrôle des échecs');
  // Transitoire : rejeu (500) levé après les notifications, l'analyse et
  // l'indexation, qui partent une fois par événement (premier passage).
  const notify = msg.indexOf(".from('notifications')\n        .insert(");
  const firstPass = msg.indexOf('if (firstPass) {');
  const analyze = msg.indexOf('/functions/v1/auto-analyze-message');
  const ingest = msg.indexOf('/functions/v1/ingest-context');
  const rethrow = msg.indexOf('throw stageFailures[0];');
  assert.ok(notify > 0 && firstPass > notify && analyze > firstPass && ingest > analyze && rethrow > ingest,
    'notifications, puis analyse et indexation, puis rejeu');
  assert.match(msg, /const firstPass = linkedMembers\.length > 0 \? alreadyNotified\.size === 0 : stageFailures\.length === 0;/);
  // L'analyse ne rattrape pas une réponse déjà écrite par le webhook.
  assert.match(msg, /stage_recorded: stageFailures\.length === 0,/);
  // Notification : mission résolue quand la séquence n'en a pas (décision 17), idempotente au rejeu.
  assert.match(msg, /\?\? \(member\.organization_id \? missionByOrg\.get\(member\.organization_id\) : undefined\)/);
  assert.match(msg, /event_key: eventKey,/);
  // Compte relié à plusieurs organisations (état hérité) : une organisation sans
  // contact sur ce compte n'est écrite que si la conversation y est liée.
  assert.match(msg, /if \(sharedAccount && !anchorsByOrg\.has\(orgId\)\) \{[\s\S]*?if \(!\(await linkedOnAccount\(orgId\)\)\) \{[\s\S]*?continue;/);
  // Candidat effacé (RGPD) dans l'organisation : aucune étape, message propre compris.
  const erasedAt = msg.indexOf('await stageErasedFor(supabase, orgId, stageCandidate)');
  assert.ok(erasedAt > closures && erasedAt < stage, 'contrôle d\'effacement avant l\'écriture de l\'étape');
  assert.match(topLevelBody(src, 'async function stageErasedFor('), /isCandidateErasedForOrg\(supabase, \{/);
  assert.match(topLevelBody(src, 'async function handleOwnMessage('), /stageErasedFor\(supabase, organizationId, candidate\)/);
  // E-mail : mission de l'inscription d'abord ; le rejeu ne retrouve plus
  // l'inscription close, donc un essai de plus et jamais de 500 pour l'étape.
  const mail = topLevelBody(src, 'async function handleNewMail(');
  assert.match(mail, /recordInbound\(supabase, \{[\s\S]*?enrollmentIds: \[enrollment\.id\],\s*enrollmentFirst: true,/);
  assert.match(mail, /if \(!inbound\.ok && inbound\.kind === 'transient'\) inbound = await recordMailReply\(\);/);
  assert.doesNotMatch(mail, /failures\.push\(new Error\(`\$\{inbound\.fn\}/);
});

test('0b-2a (S16) : message écrit depuis le compte du recruteur, par record_own_message, non bloquant', () => {
  const src = read(WEBHOOK);
  const msg = topLevelBody(src, 'async function handleNewMessage(');
  // Les deux formes : is_sender (new_message) et notre propre participant (message_received).
  assert.match(msg, /if \(isSenderSelf === true\) \{\s*await markChatNotificationsRead\([^)]*\);\s*[^\n]*\n\s*await handleOwnMessage\(supabase, uCreds, account_id, chatId, messageId, null\);/);
  assert.match(msg, /await handleOwnMessage\(supabase, uCreds, account_id, chatId, messageId, otherParticipantRef\(attendeeList\)\);/);
  const own = topLevelBody(src, 'async function handleOwnMessage(');
  assert.match(own, /recordOwnMessage\(supabase, \{/);
  assert.match(own, /result\.data\.result === 'no_candidate'/, 'second appel avec les participants lus');
  assert.doesNotMatch(own, /\bthrow\b/, 'jamais bloquant');
  // Compte relié à plusieurs organisations : seulement là où un lien existe sur ce compte (jamais U-I7).
  assert.match(own, /if \(sharedAccount\) \{[\s\S]*?missionLinkOnAccount\(supabase, organizationId, accountId, chatId,[\s\S]*?if \(!linked\) \{[\s\S]*?continue;/);
  assert.ok(own.indexOf('if (sharedAccount) {') < own.indexOf('let result = await call('), 'garde avant record_own_message');
  // Conversation de groupe : aucun candidat attribué.
  const other = topLevelBody(src, 'function otherParticipantRef(');
  assert.match(other, /if \(others\.length !== 1\) return null;/);
});

test('0b-2a (S3) : le moteur reporte la réponse par record_candidate_inbound, mission de l\'inscription d\'abord', () => {
  const src = read(ENGINE);
  assert.doesNotMatch(src, /REPLY_PIPELINE_STATUSES|replyPipelinePatch/);
  const mark = fnBody(src, 'async function markCandidateRepliedInPipeline(');
  assert.doesNotMatch(mark, /\.from\('job_candidate_status'\)/);
  assert.match(mark, /recordInbound\(supabase, \{[\s\S]*?enrollmentIds: \[enrollment\.id\],\s*enrollmentFirst: true,/);
  // Six appelants d'origine, plus la réponse arrivée pendant l'envoi.
  assert.equal(src.match(/await markCandidateRepliedInPipeline\(supabase, /g).length, 7);
  // « Marquer comme répondu » lit le compte d'envoi et l'URL du profil.
  const markReplied = topLevelBody(src, 'async function handleMarkReplied(');
  assert.match(markReplied, /\.select\('[^']*\baccount_id, assigned_sender_id, profile_url\b[^']*'\)/);
  // Plus aucune écriture de job_candidate_status dans le moteur (lectures seules).
  const writes = [...src.matchAll(/\.from\('job_candidate_status'\)[\s\S]{0,200}?;/g)].map((m) => m[0]);
  for (const w of writes) assert.doesNotMatch(w, /\.(update|upsert|insert|delete)\(/, w);
});

test('0b-2a (S13) : envoi du moteur enregistré en tête de la branche de succès, marqueur avant le POST', () => {
  const src = read(ENGINE);
  const branchAt = src.indexOf('} else if (executeResult.success) {');
  assert.ok(branchAt > 0);
  const branch = src.slice(branchAt);
  const record = branch.indexOf('await recordEngineSend(supabase, enrollment, {');
  const firstContinue = branch.indexOf('continue;');
  const reread = branch.indexOf(".from('sequence_enrollments').select('status')");
  assert.ok(record > 0 && record < firstContinue && record < reread, 'avant tout continue et avant la relecture');
  assert.match(branch.slice(0, record), /const sendKind = missionSendKind\(effectiveActionType, executeResult\);/);
  const send = topLevelBody(src, 'async function recordEngineSend(');
  assert.match(send, /source: 'sequence',/);
  assert.match(send, /createdBy: typeof enrollment\.created_by === 'string' \? enrollment\.created_by : null,/);
  assert.match(send, /\} catch \(err\) \{/, 'au mieux');
  // Marqueurs : message et InMail avant le POST ; invitation avant le POST.
  const step = topLevelBody(src, 'async function executeStepAction(');
  const markerMsg = step.indexOf("sendKind: needsInMail ? 'inmail' : 'message', pending: true");
  const postMsg = step.indexOf('r = await postSend(', markerMsg);
  assert.ok(markerMsg > 0 && postMsg > markerMsg);
  const markerInv = step.indexOf("sendKind: 'invitation', pending: true");
  const postInv = step.indexOf('/api/v1/users/invite', markerInv);
  assert.ok(markerInv > 0 && postInv > markerInv);
  const rules = read('supabase/functions/_shared/sequence-engine-rules.ts');
  assert.match(topLevelBody(rules, 'export function missionSendKind('), /actionType === 'email' \|\| actionType === 'whatsapp_message'\) return null;/);
});

test('0b-2a (S14, S15) : envois manuels, assistant et file InMail enregistrés au mieux après l\'envoi', () => {
  const search = read(SEARCH);
  const handle = topLevelBody(search, 'async function handleSendMessage(');
  const prepare = handle.indexOf('const manualSend = await prepareManualSend(');
  const post = handle.indexOf('const response = await fetchWithTimeout(url, {');
  const fail = handle.indexOf('if (!response.ok) {');
  const record = handle.indexOf('await recordManualSend(');
  assert.ok(prepare > 0 && post > prepare, 'candidat, effacement et marqueur avant le POST');
  assert.ok(fail > 0 && record > fail, 'enregistrement seulement après un envoi réussi');
  const before = topLevelBody(search, 'async function prepareManualSend(');
  assert.match(before, /const projectId = missionIdFrom\(rawProjectId\);/);
  assert.match(before, /source: ctx\.isInternal && params\.source === 'assistant' \? 'assistant' : 'manual',/);
  assert.match(before, /createdBy: ctx\.isInternal\s*\?/, 'created_by lu seulement sur un appel interne');
  // Candidat effacé (RGPD) ou registre illisible : rien n'est enregistré.
  const erased = before.indexOf('await isCandidateErasedForOrg(');
  const pendingAt = before.indexOf('pending: true,');
  assert.ok(erased > 0 && pendingAt > erased, 'effacement contrôlé avant le marqueur');
  assert.match(before, /\} catch \(e\) \{[^}]*registre d\\'effacement illisible[^}]*\s*return null;/);
  const manual = topLevelBody(search, 'async function recordManualSend(');
  assert.match(manual, /messageId: sendText\(sent\?\.message_id\),/);
  assert.doesNotMatch(manual, /pending: true/);
  for (const body of [before, manual]) assert.match(body, /\} catch \(e\) \{/, 'au mieux');
  // Assistant : origine, auteur et mission de la conversation (même organisation).
  const mutations = read(MUTATIONS);
  assert.match(mutations, /body\.source = 'assistant';\s*body\.created_by = ctx\.userId;/);
  assert.match(mutations, /\.from\('agent_conversations'\)\s*\.select\('project_id'\)\s*\.eq\('id', ctx\.conversationId\)\s*\.eq\('organization_id', ctx\.organizationId\)/);
  // File InMail : marqueur avant le POST, envoi après status 'sent', mission vérifiée à la mise en file.
  const inmail = read(INMAIL);
  const marker = inmail.indexOf('await recordQueueSend(supabase, item, itemOrgId as string, null);');
  const sent = inmail.indexOf('status: "sent"', marker);
  const recorded = inmail.indexOf('await recordQueueSend(supabase, item, itemOrgId as string, {', sent);
  assert.ok(marker > 0 && sent > marker && recorded > sent);
  assert.match(inmail, /\.from\("sourcing_projects"\)\s*\.select\("id"\)\s*\.eq\("organization_id", callerOrgId\)/);
  assert.match(inmail, /project_id: verifiedMissionOf\(item\),/);
});

test('0b-2a (S4, S5) : ni l\'analyse ni Calendly n\'écrivent l\'étape en direct', () => {
  const analyze = read(ANALYZE);
  assert.doesNotMatch(analyze, /pipeline_stage:|recommendation:|status: appStatus/);
  // Mêmes gardes qu'au webhook (effacement, compte partagé), avant le
  // rattrapage et le résumé ; rattrapage sauté si le webhook a écrit l'étape.
  const guard = topLevelBody(analyze, 'async function stageWriteAllowed(');
  assert.match(guard, /await isCandidateErasedForOrg\(supabase, \{/);
  assert.match(guard, /\.from\('mission_conversations'\)/);
  assert.match(guard, /\} catch \(e\) \{[\s\S]*?return false;/, 'échec fermé');
  assert.match(analyze, /const stageRecorded = isServiceRole && _body\?\.stage_recorded === true;/);
  const allowed = analyze.indexOf('await stageWriteAllowed(');
  assert.ok(allowed > 0 && allowed < analyze.indexOf('await recordInbound(') && allowed < analyze.indexOf('await recordReplySummary('));
  assert.match(analyze, /\} else if \(accountOrgId && stageAllowed\) \{/);
  assert.match(analyze, /if \(accountOrgId && stageAllowed\) \{\s*const summaryRes = await recordReplySummary/);
  const calendly = read(CALENDLY);
  // (« Pré-qualif » est parti avec la synchronisation Notion, retirée le 29/09.)
  assert.doesNotMatch(calendly, /status: 'qualification'|pipeline_stage:/);
  assert.doesNotMatch(calendly, /\.from\('job_candidate_status'\)\s*\.update\(/);
  // Mission résolue avant la séance, même mission pour l'étape.
  const resolve = calendly.indexOf('await resolveMeetingMission(');
  const meeting = calendly.indexOf('await recordMeeting(');
  const session = calendly.indexOf(".from('qualification_sessions')\n      .insert(");
  assert.ok(resolve > 0 && meeting > resolve && session > meeting, 'résolution, étape, puis séance');
  assert.match(calendly, /projectId: meetingProjectId,/);
  // Étape non bloquante : ni la séance, ni l'arrêt des séquences n'en dépendent.
  assert.doesNotMatch(calendly, /throw new Error\(`(resolve_meeting_mission|record_candidate_meeting)/);
  assert.match(calendly, /const sessionProjectId: string \| null = meetingProjectId \?\? /);
});

test('0b-2a : RGPD (effacement, purge, export) et lecture du /pipeline', () => {
  const contact = read('supabase/functions/_shared/get-or-fetch-contact.ts');
  const erase = topLevelBody(contact, 'export async function recordGdprErasure(');
  assert.match(erase, /\.from\('mission_conversations'\)\.delete\(\)\.in\('candidate_id', batch\)/);
  assert.match(erase, /\.update\(\{ reply_summary: null \}\)/);
  const step9 = erase.indexOf('// 9.');
  const step10 = erase.indexOf('// 10.');
  assert.ok(step9 > 0 && step10 > step9, 'étapes 9 puis 10');
  assert.doesNotMatch(erase.slice(step9, step10), /\bstatus:|pipeline_stage:/);
  // Étape 10 (copies privées des photos, lot P du design simplifié) : seul l'état
  // de candidate_photos est écrit, jamais l'étape ni le couple du pipeline.
  assert.match(erase.slice(step10), /\.from\('candidate_photos'\)\.upsert\(/);
  assert.doesNotMatch(erase.slice(step10), /pipeline_stage:|\.from\('job_candidate_status'\)\s*\.(update|upsert|insert|delete)\(/);
  assert.match(read('supabase/functions/rgpd-purge/index.ts'), /\.from\("mission_conversations"\)\s*\.delete\(\)/);
  assert.match(read('supabase/functions/export-org-data/index.ts'), /\.from\("mission_conversations"\)/);
  // Lot 0c-4 : plus de displayStage dans ATS.tsx ; la colonne vient de l'étape
  // générale par atsColumnOf (src/lib/stageDisplay.ts).
  assert.doesNotMatch(read('src/pages/ATS.tsx'), /function displayStage\(/);
  const stageDisplay = read('src/lib/stageDisplay.ts');
  assert.match(stageDisplay, /interviewing: 'ITW en cours',/);
  assert.match(stageDisplay, /hired: 'Gagné',/);
});

test('0b-2a : marqueur de build dans X-Client-Info (même clé que supabase-js)', () => {
  const client = read('src/integrations/supabase/client.ts');
  assert.match(client, /'X-Client-Info': `supabase-js-web\/2\.75\.1 konekt\/\$\{KONEKT_BUILD\}`/);
  const vite = read('vite.config.ts');
  assert.match(vite, /__KONEKT_BUILD__: JSON\.stringify\(KONEKT_BUILD\)/);
  assert.match(vite, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
});

// ─── 0b-2b : le navigateur n'écrit plus « Contacté », les envois portent la mission ─

// Fichiers .ts et .tsx de src/, récursivement.
function srcFiles(dir = 'src') {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...srcFiles(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

test('0b-2b (N14, N18) : plus de markCandidatesMessaged ni de syncAfterInboxSend dans src', () => {
  const files = srcFiles();
  assert.ok(files.length > 100, 'arbre src lu');
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /\bmarkCandidatesMessaged\b|\bshouldMarkMessaged\b|\bSTATUSES_KEPT_ON_ENROLL\b/, `${rel} : écriture « contacté » à l'inscription`);
    assert.doesNotMatch(src, /\bsyncAfterInboxSend\b/, `${rel} : écriture « contacté » après un envoi de la messagerie`);
  }
  // L'inscription ne touche plus job_candidate_status.
  assert.doesNotMatch(read('src/components/outreach/enrollment-preview/enrollmentHelpers.ts'), /job_candidate_status/);
  // L'envoi de la messagerie n'écrit plus le pipeline.
  const send = callbackBody(read('src/hooks/useMessagesInbox.ts'), 'sendMessage');
  assert.match(send, /action: 'send_message'/);
  assert.doesNotMatch(send, /job_candidate_status|add-to-shortlist/);
});

test('0b-2b (N17, N20) : aucun appel à add-to-shortlist avec l\'étape « Contacté », plus d\'upsert « messaged » de la fiche', () => {
  for (const rel of srcFiles()) {
    const src = read(rel);
    assert.doesNotMatch(src, /etape:\s*['"]Contacté['"]/, `${rel} : étape « Contacté » écrite par le navigateur`);
    let at = src.indexOf("'add-to-shortlist'");
    while (at >= 0) {
      const call = src.slice(at, src.indexOf('});', at));
      assert.doesNotMatch(call, /Contacté/, `${rel} : add-to-shortlist avec « Contacté »`);
      at = src.indexOf("'add-to-shortlist'", at + 1);
    }
  }
  assert.doesNotMatch(read('src/components/outreach/OutreachMessageModal.tsx'), /add-to-shortlist/);
  const sheet = read('src/components/outreach/result-card/ProfileDetailSheet.tsx');
  assert.doesNotMatch(sheet, /status: 'messaged'/, 'fiche : plus d\'upsert « messaged » après un message');
});

test('0b-2b : les envois du navigateur passent la mission (project_id)', () => {
  // Mission d'un poste : sans « project: », uuid seulement.
  const hook = read('src/hooks/useEnrollmentPreview.ts');
  const mission = topLevelBody(hook, 'export function missionIdOfJob(');
  assert.match(mission, /normalizeMissionJobId\(rawJobId\)/);
  assert.match(mission, /UUID_RE\.test\(id\)/);
  // Fenêtre de message.
  const modal = read('src/components/outreach/OutreachMessageModal.tsx');
  const modalSend = modal.slice(modal.indexOf("action: 'send_message'"), modal.indexOf('});', modal.indexOf("action: 'send_message'")));
  // Mission explicite d'abord : pour une mission ancienne, job.id est l'id du
  // poste hérité (sourcing_projects.job_id), que le serveur écarte.
  assert.match(modalSend, /project_id: missionIdOfJob\(projectId\) \?\? missionIdOfJob\(job\.id\),/);
  assert.match(modalSend, /recipient_profile_url: recipientProfileUrl,/);
  // Fil de la fiche : propriété projectId, passée au send_message.
  const thread = read('src/components/outreach/result-card/CardMessageThread.tsx');
  assert.match(thread, /projectId\?: string;/);
  const threadSend = callbackBody(thread, 'handleSendReply');
  assert.match(threadSend, /action: 'send_message',[\s\S]*project_id: projectId,/);
  assert.match(read('src/components/outreach/result-card/CardExpandedContent.tsx'), /projectId=\{projectId\}/);
  const sheet = read('src/components/outreach/result-card/ProfileDetailSheet.tsx');
  assert.match(sheet, /projectId=\{missionIdOfJob\(activeProject\?\.id\)\}/);
  const sheetModal = sheet.slice(sheet.indexOf('<OutreachMessageModal'), sheet.indexOf('/>', sheet.indexOf('<OutreachMessageModal')));
  assert.match(sheetModal, /projectId=\{missionIdOfJob\(activeProject\?\.id\)\}/, 'fenêtre de message : mission de la fiche, pas le poste');
  assert.match(read('src/components/ats/CandidateDetailModal.tsx'), /projectId=\{missionIdOfJob\(candidate\.jobId\)\}/);
  // InMail groupé : action queue de la file.
  const bulk = read('src/components/outreach/BulkInMailModal.tsx');
  const queue = bulk.slice(bulk.indexOf("action: 'queue'"), bulk.indexOf('});', bulk.indexOf("action: 'queue'")));
  assert.match(queue, /project_id: missionIdOfJob\(projectId\) \?\? missionIdOfJob\(selectedJob\?\.id\),/);
  const panel = read('src/components/outreach/search/SearchResultsPanel.tsx');
  const panelBulk = panel.slice(panel.indexOf('<BulkInMailModal'), panel.indexOf('/>', panel.indexOf('selectedJob={selectedJob}', panel.indexOf('<BulkInMailModal'))));
  assert.match(panelBulk, /projectId=\{activeProject\?\.id\}/, 'InMail groupé : mission active, pas le poste');
});

// ─── 0b-4 : gestes des utilisateurs, plus aucune écriture directe de l'étape ─
//
// Toute écriture d'étape d'un utilisateur passe par set_candidate_stage(s)
// (navigateur, origine 'user') ou apply_mission_candidate_stage (serveur,
// origine 'user'). Restent permises (plan, section 1.4) : l'insertion À trier,
// la note, l'identité, project_id, et le passage filtré à « scored ».

// Fichiers .ts et .tsx de src/ et de supabase/functions/ (types générés et
// tests Deno exclus : ni l'un ni l'autre n'écrit en production).
function codeFiles() {
  const walk = (dir) => {
    const out = [];
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) {
        if (name !== 'node_modules') out.push(...walk(rel));
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
    }
    return out;
  };
  return [...walk('src'), ...walk('supabase/functions')]
    .filter((rel) => rel !== 'src/integrations/supabase/types.ts');
}

// Saute une chaîne ('…', "…", `…${…}…`) qui commence en i ; rend l'index qui la suit.
function skipString(s, i) {
  const q = s[i];
  i += 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (q === '`' && c === '$' && s[i + 1] === '{') { i = scanTo(s, i + 2, '}') + 1; continue; }
    if (c === q) return i + 1;
    i += 1;
  }
  return i;
}

// Parcourt le code depuis i jusqu'au caractère `close` de profondeur 0 (ou
// jusqu'à une fermante sans ouvrante), en sautant chaînes et commentaires.
function scanTo(s, i, close) {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (depth === 0 && c === close) return i;
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth -= 1;
    }
    i += 1;
  }
  return s.length;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// Chaîne d'appels qui suit `.from('job_candidate_status')` : [{ name, args }].
function parseChain(s, i) {
  const calls = [];
  for (;;) {
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (s.startsWith('//', j)) { i = s.indexOf('\n', j); continue; }
    const m = /^\.\s*([A-Za-z_$][\w$]*)\s*/.exec(s.slice(j, j + 80));
    if (!m) break;
    const k = j + m[0].length;
    if (s[k] !== '(') break;
    const end = scanTo(s, k + 1, ')');
    calls.push({ name: m[1], args: s.slice(k + 1, end) });
    i = end + 1;
  }
  return calls;
}

// Colonnes de l'étape : status, pipeline_stage (couple de compatibilité) et
// les colonnes du modèle 0a, que seul set_candidate_stage écrit.
const STAGE_KEY_RE = /(?:^|[{,\s(])['"]?(status|pipeline_stage|general_stage|process_step_id|decision_source|stage_entered_at)['"]?\s*(?=[:,}])/g;
const IDENT = '[A-Za-z_$][\\w$]*';
// Clé calculée littérale (`['status']: …`), et clé calculée par une expression (illisible).
const STAGE_COMPUTED_KEY_RE = /\[\s*(['"`])(status|pipeline_stage|general_stage|process_step_id|decision_source|stage_entered_at)\1\s*\]\s*:/g;
const OPAQUE_COMPUTED_KEY_RE = /[{,]\s*\[\s*([^\]'"`\s][^\]]*)\]\s*:/g;

// Initialiseur de la dernière déclaration `const|let|var name` avant `before`.
function declarationOf(src, name, before) {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\b[^=;]*=(?!>)`, 'g');
  let at = -1;
  let m;
  while ((m = re.exec(src)) && m.index < before) at = m.index + m[0].length;
  if (at < 0) return null;
  return { text: src.slice(at, scanTo(src, at, ';')), at };
}

// Colonnes de l'étape écrites par une charge (littéral, identifiant, `x.map(fn)`,
// décomposition `...x`), identifiants résolus dans le fichier. `unresolved`
// liste ce qui n'a pas pu être relu : un tel site doit être en liste blanche.
function payloadStageKeys(src, expr, before, depth = 0) {
  const text = stripComments(expr).trim();
  const keys = [...text.matchAll(STAGE_KEY_RE)].map((m) => m[1]);
  keys.push(...[...text.matchAll(STAGE_COMPUTED_KEY_RE)].map((m) => m[2]));
  const unresolved = [...text.matchAll(OPAQUE_COMPUTED_KEY_RE)].map((m) => `[${m[1].trim()}]`);
  const idents = new Set();
  const bare = new RegExp(`^(${IDENT})$`).exec(text);
  const mapped = new RegExp(`^${IDENT}\\.map\\(\\s*(${IDENT})\\s*\\)$`).exec(text);
  // Fonction fléchée (`const toRecord = (c) => ({ … })`) : son texte entier est relu.
  const arrow = new RegExp(`^(?:async\\s*)?(?:\\([^)]*\\)|${IDENT})\\s*(?::[^=]+)?=>`).test(text);
  if (bare) idents.add(bare[1]);
  else if (mapped) idents.add(mapped[1]);
  else if (!arrow && !/^[{[]/.test(text) && !new RegExp(`^${IDENT}\\.map\\(`).test(text)) unresolved.push(text.slice(0, 60));
  // Décompositions : identifiant nu (relu par sa déclaration), littéral `{…}` ou
  // `(cond ? {…} : {…})` (relus dans le texte) ; toute autre forme (appel,
  // membre, expression) est illisible ici.
  for (const m of text.matchAll(/\.\.\.\s*/g)) {
    const rest = text.slice(m.index + m[0].length);
    const id = new RegExp(`^(${IDENT})(?![\\w$.(\\[?])`).exec(rest);
    if (id) { idents.add(id[1]); continue; }
    if (rest.startsWith('{')) continue;
    if (rest.startsWith('(')) {
      const inner = rest.slice(1, scanTo(rest, 1, ')')).trim();
      if (/^[\s\S]+?\?\s*\{[\s\S]*\}\s*:\s*\{[\s\S]*\}$/.test(inner)) continue;
    }
    unresolved.push(`...${rest.slice(0, 40)}`);
  }
  for (const name of idents) {
    const decl = depth < 3 ? declarationOf(src, name, before) : null;
    if (!decl) { unresolved.push(name); continue; }
    const inner = payloadStageKeys(src, decl.text, decl.at, depth + 1);
    keys.push(...inner.keys);
    unresolved.push(...inner.unresolved);
    // Colonne posée après la déclaration : x.status = …, x['pipeline_stage'] = …
    const between = src.slice(decl.at, before);
    const assign = new RegExp(`\\b${name.replace(/\$/g, '\\$')}(?:\\.|\\[['"])(status|pipeline_stage|general_stage|process_step_id)\\b['"]?\\]?\\s*=[^=]`, 'g');
    for (const m of between.matchAll(assign)) keys.push(m[1]);
  }
  return { keys, unresolved };
}

// Toutes les écritures (insert, update, upsert) sur job_candidate_status.
function jcsWriteSites() {
  const sites = [];
  const fromRe = /\.from\(\s*(['"`])job_candidate_status\1\s*(?:as\s+[\w<>]+\s*)?\)/g;
  for (const file of codeFiles()) {
    const src = read(file);
    for (const m of src.matchAll(fromRe)) {
      const calls = parseChain(src, m.index + m[0].length);
      const write = calls.find((c) => ['insert', 'update', 'upsert'].includes(c.name));
      if (!write) {
        // Chaîne coupée (requête rangée dans une variable) : illisible ici.
        if (!calls.some((c) => ['select', 'delete'].includes(c.name))) {
          sites.push({ file, line: src.slice(0, m.index).split('\n').length, index: m.index, op: 'inconnue',
            payload: '', chain: '', keys: [], unresolved: ['chaîne sans select, insert, update, upsert ni delete'], src });
        }
        continue;
      }
      // Premier argument seulement (les options d'upsert ne portent pas de colonne).
      const payload = write.args.slice(0, scanTo(write.args, 0, ','));
      const { keys, unresolved } = payloadStageKeys(src, payload, m.index);
      sites.push({
        file,
        line: src.slice(0, m.index).split('\n').length,
        index: m.index,
        op: write.name,
        payload: stripComments(payload),
        chain: calls.map((c) => `.${c.name}(${c.args})`).join(''),
        keys: [...new Set(keys)],
        unresolved,
        src,
      });
    }
  }
  // Nom de la table hors d'un `.from('…')` littéral (constante, `.from(variable)`) :
  // ses écritures échappent à la lecture ci-dessus. Seules les références de type
  // (Tables<'…'>, ['Tables']['…']) sont admises.
  for (const file of codeFiles()) {
    const code = stripComments(read(file));
    for (const m of code.matchAll(/(['"`])job_candidate_status\1/g)) {
      const head = code.slice(Math.max(0, m.index - 40), m.index);
      if (/\.from\(\s*$/.test(head) || /(?:Tables(?:Insert|Update)?<\s*|\[\s*['"]Tables['"]\s*\]\s*\[\s*)$/.test(head)) continue;
      sites.push({ file, line: code.slice(0, m.index).split('\n').length, index: m.index, op: 'inconnue',
        payload: '', chain: '', keys: [], unresolved: ["nom de table hors d'un .from('…') littéral"], src: read(file) });
    }
  }
  return sites;
}

const ATS_DATA = 'src/hooks/useATSData.ts';
const ADD_TO_PROJECT = 'src/components/outreach/projects/AddToProjectButton.tsx';
const QUICK_ADD = 'supabase/functions/extension-quick-add/index.ts';
const CANDIDATE_STAGE = 'src/lib/candidateStage.ts';

// Liste blanche : les seules écritures directes qui posent encore une colonne
// de l'étape, chacune sans changement d'étape (plan, section 1.4). Chaque
// entrée doit correspondre à exactement un site, et `check` en vérifie la
// justification. Toute autre écriture de job_candidate_status ne pose ni
// status, ni pipeline_stage, ni colonne du modèle.
const STAGE_WRITE_WHITELIST = [
  {
    id: 'N12',
    why: 'batchDiscover : insertion « discovered » (étape À trier), ignoreDuplicates, jamais de mise à jour d\'une ligne existante (les adresses de photo passent par refresh_candidate_pictures, qui n\'écrit que linkedin_profile_data)',
    file: JCS_HOOK,
    match: (s) => s.op === 'upsert' && /ignoreDuplicates:\s*true/.test(s.chain) && s.keys.includes('status'),
    check: (s) => {
      assert.deepEqual(s.keys, ['status'], 'N12 : aucune autre colonne de l\'étape');
      const decl = declarationOf(s.src, s.payload.trim(), s.index);
      assert.ok(decl, 'N12 : charge relue');
      const values = [...stripComments(decl.text).matchAll(/\bstatus:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
      assert.deepEqual(values, ["'discovered'"], 'N12 : statut « discovered » seulement');
    },
  },
  {
    id: 'N10/N11',
    why: 'markScored : passage à « scored » filtré sur new, discovered, untreated (étape À trier inchangée)',
    file: JCS_HOOK,
    match: (s) => s.op === 'update' && /status:\s*'scored'/.test(s.payload),
    check: (s) => {
      assert.match(s.payload.trim(), /^\{\s*status:\s*'scored'\s*\}$/, 'N10/N11 : statut seul');
      assert.match(s.chain, /\.in\('status', SCORABLE_STATUSES\)/, 'N10/N11 : filtre sur les statuts de la notation');
      assert.match(s.src, /const SCORABLE_STATUSES = \['new', 'discovered', 'untreated'\];/);
    },
  },
  {
    id: 'N16',
    why: 'AddToProjectButton : insertion « untreated » (étape À trier) avec organization_id ; jamais un upsert ni une mise à jour',
    file: ADD_TO_PROJECT,
    match: (s) => s.keys.includes('status'),
    check: (s) => {
      assert.equal(s.op, 'insert', 'N16 : insertion seulement');
      assert.deepEqual(s.keys, ['status'], 'N16 : aucune autre colonne de l\'étape');
      assert.match(s.payload, /status: 'untreated',/);
      assert.match(s.payload, /organization_id: /, 'N16 : organisation écrite (RLS)');
    },
  },
  {
    id: 'S6',
    why: 'score-profile-job : « scored » sur les seuls statuts new, discovered, untreated, scored (étape À trier inchangée)',
    file: SCORE,
    match: (s) => s.keys.includes('status'),
    check: (s) => {
      assert.equal(s.op, 'update');
      assert.deepEqual(s.keys, ['status'], 'S6 : aucune autre colonne de l\'étape');
      assert.match(s.chain, /\.in\('status', AI_REWRITABLE_STATUSES\)/, 'S6 : filtre sur les statuts de la notation');
      assert.match(s.src, /const AI_REWRITABLE_STATUSES = \['new', 'discovered', 'untreated', 'scored'\];/);
      assert.match(fnBody(s.src, 'async function syncJobCandidateStatus('), /const status = 'scored';/);
    },
  },
];

test('0b-4 : aucune écriture directe de l\'étape hors liste blanche (src et supabase/functions)', () => {
  const sites = jcsWriteSites();
  assert.ok(sites.length >= 15, `écritures de job_candidate_status relues (${sites.length})`);
  const failures = [];
  const matched = new Map(STAGE_WRITE_WHITELIST.map((w) => [w.id, []]));
  for (const site of sites) {
    const where = `${site.file}:${site.line} (${site.op})`;
    const entry = STAGE_WRITE_WHITELIST.find((w) => w.file === site.file && w.match(site));
    if (entry) {
      matched.get(entry.id).push(where);
      try { entry.check(site); } catch (e) { failures.push(`${where} [${entry.id}] ${e.message}`); }
      continue;
    }
    if (site.keys.length > 0) failures.push(`${where} : écrit ${site.keys.join(', ')} en direct (passer par set_candidate_stage(s) ou apply_mission_candidate_stage)`);
    if (site.unresolved.length > 0) failures.push(`${where} : charge non relue (${site.unresolved.join(', ')}), à justifier en liste blanche`);
  }
  for (const [id, where] of matched) {
    if (where.length !== 1) failures.push(`liste blanche ${id} : ${where.length} site(s) au lieu d'un (${where.join(', ')})`);
  }
  assert.deepEqual(failures, []);
});

test('0b-4 : les insertions À trier S7, N3, N19 et le rattachement N5 n\'écrivent pas l\'étape', () => {
  // Contrôle positif de sites que le test général laisse passer sans les
  // nommer : ils doivent exister, sans colonne de l'étape.
  const sites = jcsWriteSites();
  const at = (file, pred, label) => {
    const found = sites.filter((s) => s.file === file && pred(s));
    assert.equal(found.length, 1, `${label} : un site attendu dans ${file}, ${found.length} trouvé(s)`);
    assert.deepEqual(found[0].keys, [], `${label} : aucune colonne de l'étape`);
    return found[0];
  };
  const s7 = at(QUICK_ADD, (s) => s.op === 'upsert' || s.op === 'insert', 'S7');
  assert.match(s7.chain, /ignoreDuplicates: true/, 'S7 : jamais de mise à jour d\'une ligne existante');
  assert.match(s7.payload, /job_id: `project:\$\{projectId\}`,/);
  assert.match(s7.payload, /project_id: projectId,/);
  assert.match(read(QUICK_ADD), /'Choisissez une mission'/, 'S7 : mission obligatoire');
  const n3 = at(ATS_DATA, (s) => s.op === 'upsert', 'N3');
  assert.match(n3.chain, /ignoreDuplicates: true/);
  assert.match(n3.payload, /organization_id: /);
  const n19 = at('src/components/calendar/CreateEventModal.tsx', (s) => s.op === 'insert', 'N19');
  assert.match(n19.payload, /job_id: `project:\$\{projectId\}`,/);
  assert.match(n19.payload, /created_by: /);
  // N5 : retrait d'une mission, couple intact (section 1.4, point 3).
  at('src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx', (s) => /project_id: null/.test(s.payload), 'N5');
});

test('0b-4 : le navigateur n\'envoie que l\'origine « user » et n\'appelle aucune fonction serveur de l\'étape', () => {
  const files = codeFiles().filter((rel) => rel.startsWith('src/'));
  const calls = [];
  for (const rel of files) {
    const src = read(rel);
    const code = stripComments(src);
    // Aucune autre origine, sous aucune forme (littéral ou variable).
    for (const m of code.matchAll(/\bp_source\s*:\s*([^,\n}]+)/g)) {
      assert.match(m[1].trim(), /^'user'(?: as const)?$/, `${rel} : p_source ${m[1].trim()}`);
    }
    // Fonctions réservées au serveur (service_role) : jamais depuis le navigateur.
    assert.doesNotMatch(code, /rpc\(\s*['"](apply_mission_candidate_stage|record_candidate_outbound|record_candidate_inbound|record_own_message|record_reply_summary|record_candidate_meeting|resolve_meeting_mission)['"]/,
      `${rel} : fonction de l'étape réservée au serveur`);
    for (const m of src.matchAll(/\.rpc\(\s*['"](set_candidate_stages?)['"]\s*,/g)) {
      const open = m.index + m[0].indexOf('(');
      calls.push({ rel, fn: m[1], args: src.slice(open + 1, scanTo(src, open + 1, ')')), src });
    }
  }
  assert.ok(calls.some((c) => c.fn === 'set_candidate_stage'), 'set_candidate_stage appelée depuis src');
  assert.ok(calls.some((c) => c.fn === 'set_candidate_stages'), 'set_candidate_stages appelée depuis src');
  for (const { rel, fn, args, src } of calls) {
    const text = stripComments(args);
    if (/\bp_source\s*:/.test(text)) {
      assert.match(text, /\bp_source:\s*'user'/, `${rel} : ${fn} avec p_source 'user'`);
      continue;
    }
    // Arguments décomposés depuis une aide (…targetArgs(t)) : l'aide pose 'user'.
    const helper = new RegExp(`\\.\\.\\.(${IDENT})\\(`).exec(text);
    assert.ok(helper, `${rel} : ${fn} sans p_source`);
    const body = topLevelBody(src, `function ${helper[1]}(`);
    assert.match(stripComments(body), /\bp_source:\s*'user'(?: as const)?,/, `${rel} : ${helper[1]} pose p_source 'user'`);
  }
  // Le module des gestes ne contient ni 'system' ni 'ai', hors commentaires.
  const stage = stripComments(read(CANDIDATE_STAGE));
  assert.doesNotMatch(stage, /['"](system|ai)['"]/);
});

test('0b-4 : table des libellés du /pipeline identique à celle de l\'assistant', () => {
  const parse = (rel) => {
    const src = read(rel);
    const decl = /const ATS_LABEL_TO_STAGE\b[^=]*=\s*\{/.exec(src);
    assert.ok(decl, `${rel} : ATS_LABEL_TO_STAGE introuvable`);
    const open = decl.index + decl[0].length;
    const body = stripComments(src.slice(open, scanTo(src, open, '}')));
    const table = {};
    for (const m of body.matchAll(/['"]([^'"]+)['"]\s*:\s*\{([^}]*)\}/g)) {
      const stage = /\bstage:\s*'([a-z_]+)'/.exec(m[2]);
      const legacy = /\blegacyStage:\s*'([^']+)'/.exec(m[2]);
      assert.ok(stage, `${rel} : ${m[1]} sans étape`);
      assert.doesNotMatch(m[2], /processStepId/, `${rel} : ${m[1]} sans étape d'entretien`);
      table[m[1]] = legacy ? { stage: stage[1], legacyStage: legacy[1] } : { stage: stage[1] };
    }
    return table;
  };
  const front = parse(CANDIDATE_STAGE);
  const assistant = parse(MUTATIONS);
  assert.equal(Object.keys(front).length, 10, 'dix libellés');
  assert.deepEqual(assistant, front);
  // Mêmes clés que les libellés admis par l'outil de l'assistant.
  const src = read(MUTATIONS);
  const allowedAt = src.indexOf('const ALLOWED_STAGES = [');
  assert.ok(allowedAt >= 0, 'ALLOWED_STAGES introuvable');
  const allowed = [...src.slice(allowedAt, src.indexOf(']', allowedAt)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...allowed].sort(), Object.keys(front).sort());
});

test('0b-4 : côté serveur, les gestes passent par apply_mission_candidate_stage, origine « user »', () => {
  let count = 0;
  for (const rel of codeFiles().filter((f) => f.startsWith('supabase/functions/'))) {
    const src = read(rel);
    for (const m of src.matchAll(/\.rpc\(\s*['"]apply_mission_candidate_stage['"]\s*,/g)) {
      const open = m.index + m[0].indexOf('(');
      const args = stripComments(src.slice(open + 1, scanTo(src, open + 1, ')')));
      assert.match(args, /\bp_source:\s*'user',/, `${rel} : apply_mission_candidate_stage avec p_source 'user'`);
      count += 1;
    }
  }
  assert.ok(count >= 2, 'add-to-shortlist et l\'assistant appellent apply_mission_candidate_stage');
  // S1 : « Retenir » seulement ; la branche « Contacté » est ignorée.
  const shortlist = read('supabase/functions/add-to-shortlist/index.ts');
  assert.match(shortlist, /ignored: 'contact'/);
  assert.match(shortlist, /p_stage: 'retained',/);
});

// ─── 0b-4, piste serveur : extension, assistant (S7 à S12) ───────────────────

// QUICK_ADD, MUTATIONS, topLevelBody : déclarés plus haut.

// Code sans les commentaires de ligne (les commentaires citent l'ancien couple).
const codeOf = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\s\/\/ [^\n]*$/gm, '');

test('0b-4 (S7) : l\'extension insère une ligne À trier dans une mission de l\'organisation, sans étape', () => {
  const src = read(QUICK_ADD);
  const code = codeOf(src);
  assert.doesNotMatch(code, /search_history/, 'mission contrôlée par sourcing_projects');
  assert.doesNotMatch(code, /status: '|pipeline_stage/, 'aucune étape écrite');
  assert.match(src, /if \(!projectId\) \{\s*return new Response\(JSON\.stringify\(\{ error: 'Choisissez une mission' \}\), \{\s*status: 400,/);
  const iMission = src.indexOf(".from('sourcing_projects')");
  const iUpsert = src.indexOf('.upsert(');
  assert.ok(iMission > 0 && iUpsert > iMission, 'mission contrôlée avant l\'insertion');
  assert.match(src.slice(iMission, iUpsert), /\.eq\('id', projectId\)\s*\.eq\('organization_id', auth\.organizationId\)/);
  const upsert = src.slice(iUpsert, src.indexOf('.maybeSingle()', iUpsert));
  assert.match(upsert, /job_id: `project:\$\{projectId\}`,/);
  assert.match(upsert, /project_id: projectId,/);
  assert.match(upsert, /organization_id: auth\.organizationId,/);
  assert.match(upsert, /onConflict: 'job_id,candidate_id,created_by',\s*ignoreDuplicates: true,/);
  // La contrainte de l'onConflict existe (0a et migrations de rattrapage).
  assert.match(read('supabase/migrations/20260401051553_251e6e0e-e0d4-4981-93b4-282b1491b4a9.sql'), /UNIQUE \(job_id, candidate_id, created_by\)/);
});

test('0b-4 (S8 à S12) : les outils d\'étape de l\'assistant passent par apply_mission_candidate_stage', () => {
  const src = read(MUTATIONS);
  const code = codeOf(src);
  // Une seule écriture directe sur job_candidate_status : la raison d'un écart.
  const writes = [...code.matchAll(/\.from\('job_candidate_status'\)\s*\.(update|upsert|insert)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`);
  assert.deepEqual(writes, ['update({ skip_reason: skipReason })']);
  assert.doesNotMatch(code, /\.update\(\{ (pipeline_stage|status: 'dismissed')/);
  // L'appel : origine user, mission et organisation de l'appelant, aucune création.
  const apply = topLevelBody(src, 'async function applyCandidateStage(');
  const call = apply.slice(apply.indexOf("rpc('apply_mission_candidate_stage'"), apply.indexOf('});', apply.indexOf("rpc('apply_mission_candidate_stage'")));
  assert.match(call, /p_organization_id: ctx\.organizationId,/);
  assert.match(call, /p_project_id: projectId,/);
  assert.match(call, /p_candidate: \{ ids: \[candidateId\] \},/);
  assert.match(call, /p_stage: target\.stage,/);
  assert.match(call, /p_source: 'user',/);
  assert.match(call, /p_legacy_stage: target\.legacyStage \?\? null,/);
  assert.match(call, /p_create_by: null,/);
  assert.match(call, /p_only_created_by: null,/);
  assert.equal((code.match(/rpc\('apply_mission_candidate_stage'/g) || []).length, 1, 'un seul appel, dans applyCandidateStage');
  assert.doesNotMatch(code, /p_source: '(system|ai)'/);
  // skip_reason : lignes écartées de la mission, dans l'organisation, pour ce candidat.
  const reason = apply.slice(apply.indexOf('update({ skip_reason: skipReason })'));
  assert.match(reason, /\.eq\('organization_id', ctx\.organizationId\)\s*\.eq\('project_id', projectId\)\s*\.eq\('candidate_id', candidateId\)\s*\.in\('id', rejectedIds\)/);
  assert.match(apply, /if \(skipReason && target\.stage === 'rejected'\)/);
  // Lignes lues par mission (project_id) et organisation, tous auteurs.
  const rows = topLevelBody(src, 'async function missionCandidateRows(');
  assert.match(rows, /\.eq\('organization_id', ctx\.organizationId\)\s*\.eq\('project_id', projectId\)\s*\.in\('candidate_id', candidateIds\)/);
  assert.doesNotMatch(rows, /created_by/);
  assert.match(topLevelBody(src, 'function missionIdParam('), /MISSION_UUID_RE\.test\(raw\)/);
  // Chaque outil passe par ces aides.
  const tool = (name) => {
    const start = src.indexOf(`name: '${name}',`);
    assert.ok(start >= 0, `${name} introuvable`);
    return src.slice(start, src.indexOf('\n};\n', start));
  };
  assert.match(tool('update_candidate_stage'), /verifySingleCandidate\(params, ctx\)/);
  assert.match(tool('update_candidate_stage'), /applyCandidateStage\(ctx, projectId, candidateId, target, null, reason\)/);
  assert.match(tool('add_to_shortlist'), /verifyAccess: \(params, ctx\) => verifySingleCandidate\(params, ctx\)/);
  assert.match(tool('add_to_shortlist'), /ATS_LABEL_TO_STAGE\['Pressenti'\], RETAIN_FROM_STAGES, null/);
  assert.match(src, /const RETAIN_FROM_STAGES: GeneralStage\[\] = \['to_sort', 'retained', 'rejected'\];/);
  assert.match(tool('dismiss_candidate'), /verifyAccess: \(params, ctx\) => verifySingleCandidate\(params, ctx\)/);
  assert.match(tool('dismiss_candidate'), /applyCandidateStage\(ctx, projectId, candidateId, ATS_LABEL_TO_STAGE\['Perdu'\], null, reason\)/);
  assert.match(tool('bulk_update_stage'), /verifyBulkAccess\(params, ctx, 'update_candidate_stage'\)/);
  assert.match(tool('bulk_update_stage'), /applyBulkStage\(ctx, projectId, foundIds, target, null\)/);
  assert.match(tool('bulk_dismiss'), /verifyBulkAccess\(params, ctx, 'dismiss_candidate'\)/);
  assert.match(tool('bulk_dismiss'), /applyBulkStage\(ctx, projectId, foundIds, ATS_LABEL_TO_STAGE\['Perdu'\], reason\)/);
  assert.match(topLevelBody(src, 'async function applyBulkStage('), /for \(const candidateId of candidateIds\) \{\s*const outcome = await applyCandidateStage\(ctx, projectId, candidateId, target, null, skipReason\);/);
  // L'aperçu annonce le nombre de lignes.
  assert.match(topLevelBody(src, 'async function candidateStageDryRun('), /lineCount\(movingRows\.length\)/);
  for (const name of ['bulk_update_stage', 'bulk_dismiss']) assert.match(tool(name), /lineCount\(/);
});

test('0b-4 (relecture) : assistant, candidat laissé à son étape, échecs d\'appel rendus, candidats distincts', () => {
  const src = read(MUTATIONS);
  // add_to_shortlist sur un candidat déjà plus loin : ni « déjà à l'étape », ni new_stage.
  assert.match(src, /const keptAll = isNoOp && keptRows\.length > 0 && keptRows\.length === rows\.length;/);
  assert.match(src, /reste à « \$\{keptLabels\} »/);
  const result = topLevelBody(src, 'function candidateStageResult(');
  const iKept = result.indexOf('outcome.changed + outcome.unchanged === 0 && outcome.kept > 0');
  assert.ok(iKept > 0, 'branche « tout laissé à son étape »');
  const keptBranch = result.slice(iKept, result.indexOf('kept_all: true,', iKept) + 20);
  assert.match(keptBranch, /kept_all: true,/);
  assert.doesNotMatch(keptBranch, /new_stage/);
  // Outils groupés : les candidats non traités (appel en échec) sont rendus et annoncés.
  assert.match(src, /if \(outcome\.error && outcome\.rows\.length === 0\) total\.failedCandidates\+\+;/);
  assert.equal((src.match(/failed: total\.failedCandidates,/g) || []).length, 2);
  assert.equal((src.match(/candidat\(s\) non traité\(s\), réessayez/g) || []).length, 2);
  // Aperçus groupés : candidats distincts, lignes regroupées par candidat.
  assert.match(src, /Déplacer \$\{distinctCandidates\(toMove\)\} candidat\(s\)/);
  assert.match(src, /Écarter \$\{distinctCandidates\(toDismiss\)\} candidat\(s\)/);
  assert.equal((src.match(/candidates: rowsByCandidate\(rows\)\.map\(/g) || []).length, 2);
});
