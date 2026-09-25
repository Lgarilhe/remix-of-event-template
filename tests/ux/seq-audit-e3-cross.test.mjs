/**
 * Audit séquences 2026-09-25, lot E3, second passage : demandes croisées des
 * autres lots (B4, E1a, E1b, E2, F1b, F4a, F4b).
 *
 * Même méthode que seq-audit-e3.test.mjs : les modules purs de
 * supabase/functions/_shared sont compilés avec esbuild et exécutés, les
 * fonctions des edge functions sont découpées et vérifiées sur leur code
 * (commentaires retirés).
 *
 * Lancer : node --test tests/ux/seq-audit-e3-cross.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

const importModule = async (rel) => {
  const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL(rel, root))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['npm:*', 'https:*'],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : -1;
  return code(src.slice(from, to > from ? to : undefined));
};

const sequences = read('supabase/functions/process-sequences/index.ts');
const inmailQueue = read('supabase/functions/process-inmail-queue/index.ts');
const outreachFn = code(read('supabase/functions/generate-outreach-message/index.ts'));
const replyFn = code(read('supabase/functions/generate-reply-suggestions/index.ts'));
const executeStep = sliceBetween(sequences, 'async function executeStepAction(', 'async function closeEnrollmentAsReplied');
const generate = sliceBetween(sequences, 'async function generatePersonalizedMessage(');
const rules = await importModule('supabase/functions/_shared/sequence-send-rules.ts');
const sender = await importModule('supabase/functions/_shared/sequence-sender.ts');
const outreach = await importModule('supabase/functions/_shared/outreach-context.ts');

/** Faux client des tables de comptes : filtres eq / in, lecture en liste ou en ligne. */
function accountsClient(tables) {
  return {
    from(table) {
      const eqs = {};
      const ins = {};
      const rows = () => (tables[table] || []).filter((row) =>
        Object.entries(eqs).every(([k, v]) => row[k] === v)
        && Object.entries(ins).every(([k, v]) => v.includes(row[k])));
      const builder = {
        select() { return builder; },
        eq(col, value) { eqs[col] = value; return builder; },
        in(col, values) { ins[col] = values; return builder; },
        maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------- 1. SEQ-067 (B4)
test('SEQ-067 — étape e-mail : même boîte que sequence-send-email, boîte déconnectée = rien ne part', async () => {
  sender.clearSenderCache();
  const client = accountsClient({
    member_email_accounts: [
      { organization_id: 'org1', user_id: 'u-claire', email_account_id: 'MAIL_KO', account_status: 'CREDENTIALS' },
      { organization_id: 'org1', user_id: 'u-claire', email_account_id: 'MAIL_OK', account_status: 'OK' },
      { organization_id: 'org1', user_id: 'u-theo', email_account_id: 'MAIL_THEO', account_status: 'ERROR' },
    ],
    member_linkedin_accounts: [{ organization_id: 'org1', user_id: 'u-claire', linkedin_account_id: 'LI_CLAIRE' }],
  });
  const enrollment = { organization_id: 'org1', account_id: 'LI_CLAIRE', created_by: 'u-laurent' };
  assert.deepEqual(await sender.resolveEmailStepSender(client, enrollment, null),
    { kind: 'ok', mailboxId: 'MAIL_OK', mailboxStatus: 'OK', ownerUserId: 'u-claire' });
  const theo = await sender.resolveEmailStepSender(client, enrollment, { sender_id: 'MAIL_THEO' });
  assert.equal(theo.mailboxId, 'MAIL_THEO');
  assert.equal(sender.isMailboxDisconnected(theo.mailboxStatus), true);
  // Signature et contexte IA d'une étape e-mail : titulaire de la boîte.
  assert.equal(await sender.resolveSequenceSenderUserId(client, enrollment, { sender_id: 'MAIL_THEO', step_channel: 'email' }), 'u-theo');

  // Contrôle avant l'appel à sequence-send-email, erreur reconnue comme compte déconnecté.
  const emailCase = sliceBetween(executeStep, "case 'email': {", "case 'wait_connection'");
  const checkAt = emailCase.indexOf('isMailboxDisconnected(mailbox.mailboxStatus)');
  const fetchAt = emailCase.indexOf('/functions/v1/sequence-send-email');
  assert.ok(checkAt > 0 && checkAt < fetchAt, 'le contrôle de la boîte doit précéder l’envoi');
  assert.match(emailCase, /error: `email_account_disconnected: /);
  const disconnected = sliceBetween(sequences, 'function isAccountDisconnectedError(', '\n}\n');
  assert.match(disconnected, /e\.includes\('account_disconnected'\)/);
  const label = sliceBetween(sequences, 'function accountDisconnectedLabel(', '\n}\n');
  assert.match(label, /if \(rawError\.startsWith\('email_account_disconnected'\)\)/);
  assert.doesNotMatch(label.match(/Boîte e-mail[^"]*"/)?.[0] ?? '', /Unipile|Resend/);
  // La rédaction IA prend le contexte du même titulaire que la signature.
  assert.match(generate, /loadAiContextForEnrollment\(supabase, enrollment, step as \{ sender_id\?: string \| null \}, senderUserId\)/);
});

// ---------------------------------------------------------------- 2. SEQ-005 (E1a)
test('SEQ-005 — après un POST d’envoi réussi, le suivi ne peut plus transformer l’envoi en échec', () => {
  const message = sliceBetween(executeStep, "case 'smart_message': case 'inmail': case 'message': {", "case 'whatsapp_message': {");
  assert.match(message, /try \{\s*const sendBody = await r\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*await recordUsageSignal\([\s\S]*?await logAnalytics\([\s\S]*?\} catch \(trackErr\) \{[\s\S]*?\}\s*return \{ success: true, message: msg/);
  const whatsapp = sliceBetween(executeStep, "case 'whatsapp_message': {", "case 'connection_request': {");
  assert.match(whatsapp, /try \{\s*await waR\.json\(\)\.catch\(\(\) => null\);\s*await logAnalytics\([\s\S]*?\} catch \(trackErr\) \{[\s\S]*?\}\s*return \{ success: true, message: msg \};/);
  const invite = sliceBetween(executeStep, "case 'connection_request': {", "default: return { success: false, error: '__SKIP_UNSUPPORTED__' };");
  assert.match(invite, /try \{\s*const inviteBody = await r\.json\(\)\.catch\(\(\) => \(\{\}\)\);[\s\S]*?connection_status: 'pending_invite'[\s\S]*?\} catch \(trackErr\) \{[\s\S]*?\}\s*return \{ success: true, message: invitePayload\.message \};/);
});

// ---------------------------------------------------------------- 3. SEQ-074 (E1b)
test('SEQ-074 — pas d’appel de correction IA à moins de 30 s de l’échéance du cycle', () => {
  const deadline = 5_000_000;
  assert.equal(rules.hasTimeForAiCorrection(undefined, deadline), true);
  assert.equal(rules.hasTimeForAiCorrection(deadline, deadline - 40_000), true);
  assert.equal(rules.hasTimeForAiCorrection(deadline, deadline - 20_000), false);
  assert.match(sequences, /diag\?: \{ reason\?: string; deadlineMs\?: number \}\): Promise</);
  assert.match(generate, /const correctionAllowed = rules\.hasTimeForAiCorrection\(diag\?\.deadlineMs, Date\.now\(\)\);/);
  const guarded = generate.indexOf('if (violations.length > 0 && correctionAllowed) {');
  const retry = generate.indexOf('await callAI(correctionPrompt)');
  assert.ok(guarded > 0 && retry > guarded, 'l’appel de correction doit être gardé par l’échéance');
  // La revérification finale bloque toujours un brouillon non conforme.
  assert.match(generate, /const blocking = rules\.detectSequenceViolations\(isRPO, parsed\.message, parsed\.subject\)\.filter\(\(v\) => v\.blocking\);/);
});

// ---------------------------------------------------------------- 4. SEQ-095 (F1b)
test('SEQ-095 — deuxième Message IA vers une relation, ou message après un InMail : RELANCE 1', () => {
  assert.deepEqual(rules.directMessageActionTypes(false), ['message', 'smart_message']);
  assert.deepEqual(rules.directMessageActionTypes(true), ['message', 'smart_message', 'email']);
  assert.equal(rules.directFollowUpType(0), 'RELANCE 1', 'après un InMail seul');
  assert.equal(rules.directFollowUpType(1), 'RELANCE 1', 'après un Message IA parti en direct');
  assert.equal(rules.directFollowUpType(2), 'RELANCE 2');
  assert.match(generate, /const directMessageTypes = rules\.directMessageActionTypes\(isEmailStep\);/);
  assert.match(generate, /\} else if \(rules\.directFollowUpType\(prevDirectMsgs\.length\) === 'RELANCE 1'\) \{\s*msgType = 'RELANCE 1';/);
  assert.doesNotMatch(generate, /prevDirectMsgs\.length === 1/);
});

// ---------------------------------------------------------------- 5. SEQ-126 (F4b)
test('SEQ-126 — action « status » : compteurs exacts sur toute la file de l’appelant', () => {
  const status = sliceBetween(inmailQueue, 'if (action === "status") {', 'if (action === "cancel")');
  assert.match(status, /\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("created_by", user\.id\)\s*\.eq\("status", status\)/);
  assert.match(status, /stats\[status\] = count;/);
  // Forme de réponse attendue par BulkInMailModal inchangée.
  assert.match(status, /pending: 0,\s*scheduled: 0,\s*sending: 0,\s*sent: 0,\s*failed: 0,\s*cancelled: 0,/);
  assert.match(status, /JSON\.stringify\(\{\s*success: true,\s*stats,\s*items: queueItems,/);
});

// ---------------------------------------------------------------- 6. SEQ-045 (F4a)
test('SEQ-045 — relation directe : invitation sautée « Déjà en relation : invitation inutile »', () => {
  assert.equal(rules.ALREADY_CONNECTED_SKIP_REASON, 'Déjà en relation : invitation inutile');
  assert.equal(rules.isFirstDegreeCandidate({ network_distance: 'FIRST_DEGREE' }, null), true);
  assert.equal(rules.isFirstDegreeCandidate({}, { network_distance: 'DISTANCE_1' }), true);
  const invite = sliceBetween(executeStep, "case 'connection_request': {", "default: return { success: false, error: '__SKIP_UNSUPPORTED__' };");
  const skipAt = invite.indexOf("return { success: false, error: '__SKIP_UNSUPPORTED__', skipReason: rules.ALREADY_CONNECTED_SKIP_REASON };");
  assert.ok(skipAt > 0 && skipAt < invite.indexOf('/api/v1/users/invite'));
  // handleProcess passe l'étape en 'skipped' avec ce motif et poursuit.
  assert.match(sequences, /skip_reason: executeResult\.skipReason \|\|/);
});

// ---------------------------------------------------------------- 7. SEQ-007 (E2)
test('SEQ-007 — Notion : rapprochement par URL LinkedIn exacte seulement, rien sans URL', () => {
  const find = sliceBetween(sequences, 'async function findCandidateInNotionSeq(', 'async function findShortlistsForCandidateSeq(');
  assert.doesNotMatch(find, /title: \{ equals/, 'plus de recherche par nom');
  assert.match(find, /if \(!url\) return null;/);
  assert.match(find, /\{ property: 'URL Linkedin', url: \{ equals: url \} \}/);
  const sync = sliceBetween(sequences, 'async function syncNotionStageAfterAction(', 'function extractNotionText(');
  const guardAt = sync.indexOf('if (!profileUrl || !profileUrl.trim()) {');
  assert.ok(guardAt > 0 && guardAt < sync.indexOf('findCandidateInNotionSeq('), 'sans URL : ni mise à jour ni création');
  assert.ok(guardAt < sync.indexOf('createCandidateAndShortlistInNotion('));
});

// ---------------------------------------------------------------- 8. SEQ-097 (E3)
test('SEQ-097 — aperçu et suggestions de réponse : l’expéditeur se présente au nom de son organisation', () => {
  const block = outreach.buildOutreachContext({ recruitment_mode: 'client' }, 'Qonto', 'Laurent', 'Cabinet Alpha');
  assert.match(block, /Tu es recruteur\(se\) chez Cabinet Alpha/);
  assert.doesNotMatch(block, /Konekt/);
  // Nom lu seulement pour un membre vérifié de l'organisation active.
  assert.match(outreachFn, /\.from\('organization_members'\)\s*\.select\('id'\)\.eq\('user_id', userId\)\.eq\('organization_id', orgId\)\.maybeSingle\(\)/);
  assert.match(outreachFn, /buildOutreachContext\(\s*outreachConfig as any,\s*clientName,\s*senderName \|\| 'Recruteur',\s*organizationName \|\| null,\s*\)/);
  assert.match(replyFn, /\.from\('organization_members'\)\s*\.select\('id'\)\.eq\('user_id', userId\)\.eq\('organization_id', orgId\)\.maybeSingle\(\)/);
  assert.match(replyFn, /buildOutreachContext\(\s*context\.outreachConfig as any,\s*context\.outreachClientName \|\| context\.jobData\?\.client\?\.name,\s*context\.candidateName \|\| 'le recruteur',\s*organizationName,\s*\)/);
});

// ---------------------------------------------------------------- 9. SEQ-051 (F4a)
test('SEQ-051 — configuration d’approche relue sur la mission quand le front ne la transmet pas', () => {
  assert.deepEqual(outreach.normalizeMissionId('project:0f0e0d0c-0b0a-4908-8706-050403020100'),
    { kind: 'uuid', id: '0f0e0d0c-0b0a-4908-8706-050403020100' });
  assert.deepEqual(outreach.normalizeMissionId('recAbc123'), { kind: 'job_id', id: 'recAbc123' });
  assert.equal(outreach.normalizeMissionId('x),id.neq.(0'), null, 'jamais injecté dans un filtre');
  assert.equal(outreach.normalizeMissionId(''), null);
  assert.match(outreachFn, /let outreachConfig: typeof bodyOutreachConfig = bodyOutreachConfig;\s*if \(!outreachConfig && verifiedOrgId\) \{/);
  assert.match(outreachFn, /normalizeMissionId\(missionId \?\? job\?\.id\)/);
  assert.match(outreachFn, /\.from\('sourcing_projects'\)\.select\('job_details'\)\.eq\('organization_id', verifiedOrgId\)/);
  // La config relue alimente le contexte d'approche ET l'anonymisation.
  const readAt = outreachFn.indexOf("outreachConfig = cfg as typeof bodyOutreachConfig;");
  assert.ok(readAt > 0 && readAt < outreachFn.indexOf('buildOutreachContext('));
  assert.ok(readAt < outreachFn.indexOf('if (outreachConfig?.anonymize_client && clientNameRaw)'));
});
