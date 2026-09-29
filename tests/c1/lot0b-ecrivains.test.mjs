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
import { readFileSync } from 'node:fs';
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
  // (« Pré-qualif » ne reste que dans la synchronisation Notion.)
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
  assert.doesNotMatch(erase.slice(erase.indexOf('// 9.')), /\bstatus:|pipeline_stage:/);
  assert.match(read('supabase/functions/rgpd-purge/index.ts'), /\.from\("mission_conversations"\)\s*\.delete\(\)/);
  assert.match(read('supabase/functions/export-org-data/index.ts'), /\.from\("mission_conversations"\)/);
  const ats = read('src/pages/ATS.tsx');
  const display = topLevelBody(ats, 'function displayStage(');
  assert.match(display, /if \(PROCESS_STEP_ID\.test\(stage\)\) return 'ITW en cours';/);
  assert.match(display, /if \(stage === 'hired'\) return 'Gagné';/);
});

test('0b-2a : marqueur de build dans X-Client-Info (même clé que supabase-js)', () => {
  const client = read('src/integrations/supabase/client.ts');
  assert.match(client, /'X-Client-Info': `supabase-js-web\/2\.75\.1 konekt\/\$\{KONEKT_BUILD\}`/);
  const vite = read('vite.config.ts');
  assert.match(vite, /__KONEKT_BUILD__: JSON\.stringify\(KONEKT_BUILD\)/);
  assert.match(vite, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
});
