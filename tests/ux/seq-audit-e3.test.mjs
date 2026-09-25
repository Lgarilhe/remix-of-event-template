/**
 * Audit séquences 2026-09-25, lot E3 — garde-fous de non-régression du moteur
 * d'envoi LinkedIn, de la file InMail et de la rédaction IA.
 *
 * Deux sortes d'assertions :
 *  - comportement : les modules purs de supabase/functions/_shared (règles
 *    d'envoi, variables des modèles, expéditeur) sont compilés avec esbuild et
 *    exécutés sur des cas concrets, avec un faux client Supabase ;
 *  - code : les fonctions du moteur (process-sequences, process-inmail-queue)
 *    sont découpées et vérifiées sur leurs appels réels, pas leurs commentaires.
 *
 * Lancer : node --test tests/ux/seq-audit-e3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

/** Compile un module TypeScript (et ses imports relatifs) puis l'importe. */
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

/** Retire les commentaires pour ne tester que le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : -1;
  return code(src.slice(from, to > from ? to : undefined));
};

const sequences = read('supabase/functions/process-sequences/index.ts');
const inmailQueue = read('supabase/functions/process-inmail-queue/index.ts');
const executeStep = sliceBetween(sequences, 'async function executeStepAction(', 'async function closeEnrollmentAsReplied');
const generate = sliceBetween(sequences, 'async function generatePersonalizedMessage(');
const rules = await importModule('supabase/functions/_shared/sequence-send-rules.ts');
const templates = await importModule('supabase/functions/_shared/template-interpolation.ts');
const sender = await importModule('supabase/functions/_shared/sequence-sender.ts');
const aiContext = await importModule('supabase/functions/_shared/ai-context.ts');

/** Faux client Supabase : chaque table répond via un handler, les requêtes sont gardées. */
function fakeClient(handlers) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, cols: '', filters: {} };
      queries.push(q);
      const answer = () => Promise.resolve(handlers[table]?.(q) ?? { data: null, error: null });
      const builder = {
        select(cols) { q.cols = cols; return builder; },
        eq(col, value) { q.filters[col] = value; return builder; },
        maybeSingle: answer,
        then(resolve, reject) { return Promise.resolve(handlers[table]?.(q) ?? { data: [], error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------- SEQ-005 (critical)
test('SEQ-005 — un 5xx ou un délai du POST d’envoi ne déclenche ni second POST ni relance', () => {
  for (const s of [429, 500, 502, 503, 504]) assert.equal(rules.allowsNewChatFallback(s), false, `${s} ne doit pas rouvrir une conversation`);
  for (const s of [400, 403, 404, 422]) assert.equal(rules.allowsNewChatFallback(s), true, `${s} = conversation inutilisable`);
  assert.equal(rules.classifySendStatus(null), 'uncertain');
  assert.equal(rules.classifySendStatus(502), 'uncertain');
  assert.equal(rules.classifySendStatus(429), 'rate_limited');

  // La nouvelle conversation n'est tentée que derrière allowsNewChatFallback.
  assert.match(executeStep, /if \(r && !r\.ok && rules\.allowsNewChatFallback\(r\.status\)\)/);
  assert.doesNotMatch(executeStep, /if \(!r\.ok\) \{\s*console\.warn\(`\[executeStepAction\] Send to existing chat/, 'ancien repli inconditionnel');
  assert.match(executeStep, /rules\.classifySendStatus\(status\) === 'uncertain'[\s\S]{0,120}rules\.sendUncertainError\('LinkedIn'\)/);

  // isRetryableError refuse toute erreur « send_uncertain ».
  const retryable = sliceBetween(sequences, 'function isRetryableError(', '\n}\n');
  assert.match(retryable, /if \(e\.includes\('send_uncertain'\)\) return false;/);
  const err = rules.sendUncertainError('LinkedIn');
  assert.ok(rules.isSendUncertain(err));
  assert.doesNotMatch(err, /\b5\d\d\b|429/, 'un code HTTP rendrait l’erreur relançable');
});

// ---------------------------------------------------------------- SEQ-011 (critical)
test('SEQ-011 — file InMail : compte exigé dans l’organisation de l’item avant le claim', () => {
  const loop = sliceBetween(inmailQueue, 'for (const item of pendingItems', 'return new Response(');
  const linkAt = loop.indexOf('const accountLink = await getAccountLink(item.account_id, itemOrgId);');
  const failAt = loop.indexOf('accountLink.state === "not_linked"');
  const claimAt = loop.indexOf('.update({ status: "sending" })');
  assert.ok(linkAt > 0 && failAt > linkAt, 'contrôle de liaison introuvable');
  assert.ok(claimAt > failAt, 'le contrôle doit précéder le claim');
  assert.match(loop, /status: "failed", error_message: ACCOUNT_NOT_IN_ORG_MESSAGE/);
  assert.match(inmailQueue, /const ACCOUNT_NOT_IN_ORG_MESSAGE = "Compte non rattaché à l'organisation";/);
  // Statut du compte lu dans l'organisation de l'item, credentials de cette organisation.
  assert.match(loop, /\.eq\('organization_id', itemOrgId as string\)\s*\.eq\('linkedin_account_id', item\.account_id\)/);
  assert.match(loop, /await getCredsFor\(itemOrgId as string\)/);
  assert.doesNotMatch(inmailQueue, /getCredsFor\(item\.created_by\)/);
});

// ---------------------------------------------------------------- SEQ-013 (critical)
test('SEQ-013 — le compte de rotation désigne son titulaire, jamais un user_id', async () => {
  sender.clearSenderCache();
  const profileReads = [];
  const client = {
    from(table) {
      const filters = {};
      const b = {
        select() { return b; },
        eq(col, value) { filters[col] = value; return b; },
        maybeSingle() {
          if (table === 'member_linkedin_accounts') {
            const ok = filters.organization_id === 'org-e3' && filters.linkedin_account_id === 'kzAxdybMQ7ipVxK1U6kwZw';
            return Promise.resolve({ data: ok ? { user_id: 'u-claire' } : null, error: null });
          }
          if (table === 'profiles') profileReads.push(filters.user_id);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return b;
    },
  };
  await aiContext.loadAiContextForEnrollment(client, {
    organization_id: 'org-e3', assigned_sender_id: 'kzAxdybMQ7ipVxK1U6kwZw', account_id: 'ACC_A', created_by: 'u-laurent',
  });
  assert.deepEqual(profileReads, ['u-claire'], 'assigned_sender_id lu comme un user_id');

  // Rotation : l'erreur du comptage est lue, le choix passe par la règle pure.
  const pick = sliceBetween(sequences, 'async function pickSenderForRotation(', '\nfunction needsMessage');
  assert.match(pick, /const \{ data: todaySends, error: countErr \} = await supabase/);
  assert.match(pick, /rules\.chooseRotationSender\(pool, mode, sendCounts\)/);
});

// ---------------------------------------------------------------- SEQ-155 / SEQ-156
test('SEQ-155/156 — rotation : comptes LinkedIn de l’organisation, aucun repli sur le premier compte', () => {
  const pool = [{ account_id: 'A', daily_limit: 1 }, { account_id: 'B', daily_limit: 1 }];
  assert.equal(rules.chooseRotationSender(pool, 'round_robin', new Map([['A', 1], ['B', 1]])), null);
  const pick = sliceBetween(sequences, 'async function pickSenderForRotation(', '\nfunction needsMessage');
  assert.doesNotMatch(pick, /return accounts\[0\]/);
  assert.match(pick, /\.from\('member_linkedin_accounts'\)[\s\S]*\.eq\('organization_id', orgId\)/);
  assert.match(pick, /\.in\('step\.action_type', \['connection_request', 'message', 'inmail', 'smart_message'\]\)/);
});

// ---------------------------------------------------------------- SEQ-035 (high)
test('SEQ-035 — message IA vide ou réduit à la signature : rien ne part', () => {
  assert.equal(rules.isUsableAiMessage('', 'Laurent'), false);
  assert.equal(rules.isUsableAiMessage(undefined, 'Laurent'), false);
  assert.equal(rules.isUsableAiMessage('\n\nLaurent', 'Laurent'), false);
  assert.equal(rules.isUsableAiMessage('Salut Marie,\n\nOn monte une équipe Go, ça te parlerait ?\n\nLaurent', 'Laurent'), true);
  assert.match(generate, /if \(!rules\.isUsableAiMessage\(parsed\.message, senderName\)\) \{[\s\S]{0,200}return null;/);
  assert.doesNotMatch(generate, /parsed\.message = sanitizeSequenceMessage\(parsed\.message \|\| ''\)/, 'plus de message vide accepté');
});

// ---------------------------------------------------------------- SEQ-036 (high)
test('SEQ-036 — invitation à une relation ou à un candidat déjà invité : étape sautée', () => {
  assert.equal(rules.inviteRejectionSkipReason(422, '{"type":"errors/already_invited_recently"}'), 'Invitation déjà en attente');
  assert.equal(rules.inviteRejectionSkipReason(422, 'already connected'), 'Déjà en relation');
  assert.equal(rules.inviteRejectionSkipReason(503, 'already invited'), null);
  const invite = sliceBetween(executeStep, "case 'connection_request': {", "default: return { success: false, error: '__SKIP_UNSUPPORTED__' };");
  const skipAt = invite.indexOf("skipReason: rules.ALREADY_CONNECTED_SKIP_REASON");
  const postAt = invite.indexOf('/api/v1/users/invite');
  assert.ok(skipAt > 0 && skipAt < postAt, 'le cas « déjà en relation » doit précéder l’invitation');
  assert.match(invite, /const skipReason = rules\.inviteRejectionSkipReason\(r\.status, e\);/);
  // Profil introuvable : plus de pause muette de l'inscription (SEQ-121).
  assert.doesNotMatch(invite, /status: 'paused'/);
  assert.match(invite, /candidateError: true/);
});

// ---------------------------------------------------------------- SEQ-037 (high)
test('SEQ-037 — InMail et smart_message : relation directe = message, sinon plafond InMail', () => {
  assert.equal(rules.sendLedgerActionType('smart_message', true), 'message');
  assert.equal(rules.sendLedgerActionType('smart_message', false), 'inmail');
  assert.equal(rules.isFirstDegreeCandidate({ connection_status: 'connected' }, null), true);
  const quota = sliceBetween(sequences, 'async function checkQuotaForAction(', 'async function checkStepCondition');
  assert.match(quota, /ledgerActionType = rules\.sendLedgerActionType\(actionType, firstDegree\);/);
  assert.match(quota, /checkInMailBalance = !firstDegree;/);
  assert.match(quota, /actionType: ledgerActionType as LinkedInActionType/);
  // Même règle à l'envoi.
  assert.match(executeStep, /const isConnected = rules\.isFirstDegreeCandidate\(enrollment, p\);/);
});

// ---------------------------------------------------------------- SEQ-053 (high)
test('SEQ-053 — la rédaction IA ne lit que les données de l’organisation de l’inscription', () => {
  assert.match(generate, /\.from\('job_candidate_status'\)[\s\S]{0,200}\.eq\('organization_id', scopeOrgId\)/);
  assert.match(generate, /if \(!hasExperiences && scopeOrgId\)/);
  assert.match(generate, /if \(scopeOrgId\) projectQuery = projectQuery\.eq\('organization_id', scopeOrgId\);/);
});

// ---------------------------------------------------------------- SEQ-062 / SEQ-100 (high / medium)
test('SEQ-062 — {{sender_name}}, {{ma_signature}} et {{calendly_link}} résolus avec les vraies colonnes', async () => {
  sender.clearSenderCache();
  const client = fakeClient({
    profiles: (q) => (/first_name|last_name/.test(q.cols)
      ? { data: null, error: { message: 'column profiles.first_name does not exist' } }
      : { data: { display_name: 'Laurent Garilhe', job_title: 'Recruteur' }, error: null }),
    sourcing_projects: () => ({ data: { name: 'Lead Dev Go', job_details: {}, calendly_link: 'https://cal.example/l', client_name: 'Qonto' }, error: null }),
  });
  const ctx = await templates.buildSequenceContext(client, {
    enrollment: { profile_name: 'Marie Curie', job_id: 'p1', created_by: '0f0e0d0c-0b0a-4908-8706-050403020100' },
    senderUserId: '0f0e0d0c-0b0a-4908-8706-050403020100',
  });
  assert.equal(ctx.sender_name, 'Laurent');
  assert.equal(ctx.ma_signature, 'Laurent Garilhe');
  assert.equal(ctx.calendly_link, 'https://cal.example/l');
  assert.equal(ctx.client, 'Qonto');
});

// ---------------------------------------------------------------- SEQ-064 (high)
test('SEQ-064 — {{job_title}} reste le poste du candidat, jamais le titre de la mission', async () => {
  const ctx = await templates.buildSequenceContext(fakeClient({}), {
    enrollment: { profile_name: 'Marie Curie', profile_headline: 'Engineering Manager chez Qonto', job_title: 'Lead Dev Go' },
  });
  assert.equal(ctx.job_title, 'Engineering Manager');
  assert.equal(ctx.poste_recherche, 'Lead Dev Go');
});

// ---------------------------------------------------------------- SEQ-099 (medium)
test('SEQ-099 — prénom non fiable : salutation neutre, pas « Bonjour 🚀, »', async () => {
  const ctx = await templates.buildSequenceContext(fakeClient({}), { enrollment: { profile_name: '🚀 Julie Martin' } });
  assert.equal(templates.interpolateAndStrip('Bonjour {{first_name}}, ravie.', ctx).result, 'Bonjour, ravie.');
  for (const name of ['Driss', 'Łukasz', 'N’Golo']) assert.equal(templates.isLikelyRealFirstName(name), true, name);
  assert.equal(templates.isLikelyRealFirstName('Dr.'), false);
});

// ---------------------------------------------------------------- SEQ-096 / SEQ-103 / SEQ-126 (medium)
test('SEQ-096 — la note d’invitation ne s’arrête jamais sur « Node. »', () => {
  const long = 'Bonjour Marie, ' + 'ton travail sur les paiements temps réel et la fiabilité des services '.repeat(3) + 'avec du Node.js et du Go ' + 'chez Acme '.repeat(20);
  const cut = rules.smartTruncate(long, 300);
  assert.ok(cut.length <= 300);
  assert.doesNotMatch(cut, /Node\.$/);
  assert.match(executeStep, /return \{ success: true, message: invitePayload\.message \};/);
});

test('SEQ-103/126 — file InMail : 429 et 503 relancés, annulation sans liste = toute la file en attente', () => {
  assert.equal(rules.inmailQueueRetry(503, null).retry, true);
  assert.equal(rules.inmailQueueRetry(504, null).retry, false);
  const cancel = sliceBetween(inmailQueue, 'if (action === "cancel")', 'throw new Error(`Unknown action');
  assert.match(cancel, /if \(ids\) cancelQuery = cancelQuery\.in\("id", ids\);/);
  assert.match(cancel, /await cancelQuery\.select\("id"\)/);
});
