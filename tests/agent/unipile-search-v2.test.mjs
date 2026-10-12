import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHandler, fakeDatabase } from './unipile-search-harness.mjs';

// Point d'entrée HTTP de unipile-search sur l'API v2 : authentification, rattachement du compte à l'organisation,
// plafonds, messages sans nom de prestataire, envois au plus une fois. Base, plafonds et prestataire sont des
// doublures locales (le transport factice du client partagé), aucun réseau.
const ACCOUNT = 'acc_mine';
const ENV = { SUPABASE_URL: 'https://supabase.local.test', SB_SECRET_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', UNIPILE_V2_API_KEY: 'provider-key' };

async function boot({ env = ENV, linked = [{ id: 'link-1', user_id: 'user-1' }], member = { id: 'member-1' }, rpc, quota = true, erased = false, throwOn } = {}) {
  const quotaCalls = [];
  const { client, calls } = fakeDatabase({
    rows: table => table === 'member_linkedin_accounts' ? linked : [],
    single: table => table === 'organization_members' ? member : null,
    rpc: async (name, args) => {
      if (throwOn === name) throw new Error('Unipile base arrêtée net : secret interne');
      if (rpc) return rpc(name, args);
      if (name === 'check_rate_limit') return { data: true, error: null };
      return { data: { project_id: 'p1', via: 'explicit', rows: [] }, error: null };
    },
  });
  const h = await bootHandler({
    env,
    createClient: () => client,
    enforceLinkedInAction: async (_client, gate) => { quotaCalls.push(gate); return quota ? { allowed: true } : { allowed: false, reason: 'Plafond du jour atteint.', scope: 'day' }; },
    isCandidateErasedForOrg: async () => erased,
  });
  const provider = [];
  const state = { routes: {} };
  const handler = request => {
    provider.push(`${request.method} ${request.path}`);
    const reply = state.routes[`${request.method} ${request.path}`];
    return reply ?? { status: 404, body: {} };
  };
  async function post(body, { bearer = 'jwt-user', headers = {} } = {}) {
    return h.withMockTransport(handler, async () => {
      const response = await h.handler(new Request('https://app.local.test/functions/v1/unipile-search', {
        method: 'POST',
        headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ organization_id: 'org-1', account_id: ACCOUNT, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    });
  }
  return { h, calls, quotaCalls, provider, state, post };
}

const noVendor = body => assert.doesNotMatch(JSON.stringify(body), /unipile/i, JSON.stringify(body));

test('sans jeton la requête est refusée, et la pré-requête CORS répond', async () => {
  const t = await boot();
  assert.equal((await t.post({ action: 'search' }, { bearer: null })).status, 401);
  const options = await t.h.handler(new Request('https://app.local.test/functions/v1/unipile-search', { method: 'OPTIONS' }));
  assert.equal(options.status, 200);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
});

test('organisation obligatoire, appartenance vérifiée, plafond de requêtes par minute', async () => {
  const t = await boot();
  assert.equal((await t.post({ action: 'search', organization_id: undefined })).status, 400);
  const stranger = await boot({ member: null });
  assert.equal((await stranger.post({ action: 'search' })).status, 403);
  assert.equal(stranger.provider.length, 0);
  const limited = await boot({ rpc: async name => ({ data: name === 'check_rate_limit' ? false : null, error: null }) });
  const response = await limited.post({ action: 'search' });
  assert.equal(response.status, 429);
  assert.equal(response.body.errorType, 'RATE_LIMIT');
  // Ce texte atteint le navigateur : français neutre, comme les autres plafonds de requêtes.
  assert.equal(response.body.error, 'Trop de demandes. Patientez quelques secondes.');
  assert.doesNotMatch(response.body.error, /rate limit/i);
});

test('clé de l\'application absente : panne de configuration dite sans nommer le prestataire', async () => {
  const t = await boot({ env: { ...ENV, UNIPILE_V2_API_KEY: undefined } });
  const response = await t.post({ action: 'search' });
  assert.equal(response.status, 500);
  assert.equal(response.body.errorType, 'NOT_CONFIGURED');
  assert.equal(response.body.error, "La connexion n'est pas configurée sur le serveur. Contactez le support Konekt.");
  noVendor(response.body);
  assert.equal(t.provider.length, 0);
});

test('compte : obligatoire, au format v2 seulement, rattaché à l\'organisation', async () => {
  const t = await boot();
  assert.equal((await t.post({ action: 'search', account_id: undefined })).status, 400);

  const outdated = await t.post({ action: 'search', account_id: 'U0Cfy5DeRuG6gHFSGUk5Sg' });
  assert.equal(outdated.status, 403);
  assert.equal(outdated.body.errorType, 'ACCOUNT_OUTDATED');
  assert.match(outdated.body.error, /reconnecter/);
  noVendor(outdated.body);
  assert.ok(!t.calls.tables.includes('member_linkedin_accounts'), 'aucune lecture pour un identifiant d\'un autre format');

  const traversal = await t.post({ action: 'get_messages', account_id: 'acc_x/../accounts', chat_id: 'c1' });
  assert.equal(traversal.status, 403);

  const foreign = await boot({ linked: [] });
  const refused = await foreign.post({ action: 'get_chats' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.errorType, 'ACCOUNT_NOT_LINKED');
  noVendor(refused.body);
  assert.equal(foreign.provider.length, 0, 'aucun appel au prestataire pour un compte d\'une autre organisation');
});

test('une panne de la base pendant le contrôle ne livre jamais son texte', async () => {
  const t = await boot({ throwOn: 'check_rate_limit' });
  const response = await t.post({ action: 'search' });
  assert.equal(response.status, 500);
  assert.equal(response.body.errorType, 'INTERNAL');
  assert.doesNotMatch(JSON.stringify(response.body), /secret|arrêtée/);
  noVendor(response.body);
});

test('un envoi par un membre ne part que du compte qu\'il a relié', async () => {
  const sent = { 'POST /acc_mine/chats/c1/messages/send': { body: { object: 'MessageSent', message_id: 'm1' } } };
  const colleague = await boot({ linked: [{ id: 'link-1', user_id: 'user-2' }] });
  colleague.state.routes = sent;
  const refused = await colleague.post({ action: 'send_message', chat_id: 'c1', text: 'Bonjour' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.errorType, 'ACCOUNT_NOT_YOURS');
  assert.equal(colleague.provider.length, 0);
  assert.equal(colleague.quotaCalls.length, 0);

  // L'assistant (appel interne, clé de service) agit pour l'organisation et n'est pas soumis à cette règle.
  const internal = await colleague.post({ action: 'send_message', chat_id: 'c1', text: 'Bonjour' }, { bearer: 'service-key' });
  assert.equal(internal.status, 200);

  const own = await boot();
  own.state.routes = sent;
  const accepted = await own.post({ action: 'send_message', chat_id: 'c1', recipient_id: 'ACoAAcand', text: 'Bonjour' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.message.message_id, 'm1');
  assert.deepEqual(own.quotaCalls.map(call => [call.accountId, call.actionType, call.source]), [[ACCOUNT, 'message', 'manual_inbox']]);
});

test('un collaborateur ne lit que le compte qu\'il a relié ; propriétaire, administrateur et membre lisent celui d\'un collègue (F9)', async () => {
  const reads = [
    { action: 'get_chats' },
    { action: 'get_messages', chat_id: 'c1' },
    { action: 'sync_chat_history', chat_id: 'c1' },
    { action: 'list_sent_invitations' },
    { action: 'list_recruiter_projects' },
  ];
  const routes = {
    [`GET /${ACCOUNT}/inboxes`]: { body: { data: [{ object: 'Inbox', id: 'i1', description: 'Classic', disabled: false }] } },
    [`GET /${ACCOUNT}/inboxes/i1/chats`]: { body: { data: [] } },
    [`GET /${ACCOUNT}/chats/c1/messages`]: { body: { data: [] } },
    [`GET /${ACCOUNT}/chats/c1`]: { body: { id: 'c1', type: '1to1' } },
    [`GET /${ACCOUNT}/users/me/relation-requests`]: { body: { data: [], total_count: 0 } },
    [`GET /${ACCOUNT}/linkedin/contracts`]: { body: { object: 'AvailableContracts', contracts: [{ object: 'Contract', id: 'c1', name: 'R', product: 'recruiter', selected: true }] } },
    [`GET /${ACCOUNT}/linkedin/recruiter/projects`]: { body: { data: [], total_count: 0 } },
  };
  const colleagueAccount = [{ id: 'link-1', user_id: 'user-2' }];

  // Collaborateur sur le compte d'un collègue : refusé pour chaque lecture, avant tout appel au prestataire.
  const collaborator = await boot({ member: { id: 'member-1', role: 'collaborator' }, linked: colleagueAccount });
  collaborator.state.routes = routes;
  for (const body of reads) {
    const refused = await collaborator.post(body);
    assert.equal(refused.status, 403, body.action);
    assert.equal(refused.body.errorType, 'ACCOUNT_NOT_YOURS', body.action);
    assert.match(refused.body.error, /relié par un autre membre/);
    noVendor(refused.body);
  }
  assert.deepEqual(collaborator.provider, [], 'aucun appel au prestataire');
  assert.deepEqual(collaborator.quotaCalls, []);

  // Rôle absent : traité comme collaborateur (échec fermé).
  const unknownRole = await boot({ member: { id: 'member-1' }, linked: colleagueAccount });
  unknownRole.state.routes = routes;
  for (const body of reads) assert.equal((await unknownRole.post(body)).status, 403, `rôle absent ${body.action}`);
  assert.deepEqual(unknownRole.provider, []);

  // Collaborateur sur son propre compte : servi.
  const own = await boot({ member: { id: 'member-1', role: 'collaborator' } });
  own.state.routes = routes;
  for (const body of reads) {
    const served = await own.post(body);
    assert.equal(served.status, 200, `${body.action} ${JSON.stringify(served.body)}`);
    assert.equal(served.body.success, true, body.action);
  }
  assert.ok(own.provider.length >= reads.length);

  // Propriétaire, administrateur, membre : lisent le compte d'un collègue comme avant.
  for (const role of ['owner', 'admin', 'member']) {
    const reader = await boot({ member: { id: 'member-1', role }, linked: colleagueAccount });
    reader.state.routes = routes;
    for (const body of reads) {
      const served = await reader.post(body);
      assert.equal(served.status, 200, `${role} ${body.action} ${JSON.stringify(served.body)}`);
      assert.equal(served.body.success, true, `${role} ${body.action}`);
    }
  }

  // Appel interne (assistant, agent) : pas concerné, même sans rôle et sur le compte d'un collègue.
  const internal = await boot({ linked: colleagueAccount });
  internal.state.routes = routes;
  for (const body of reads) assert.equal((await internal.post(body, { bearer: 'service-key' })).status, 200, `interne ${body.action}`);

  // Les actions qui se servent seulement du compte pour consulter LinkedIn restent hors de la règle de lecture.
  const search = await boot({ member: { id: 'member-1', role: 'collaborator' }, linked: colleagueAccount });
  search.state.routes = { ...routes, [`POST /${ACCOUNT}/linkedin/search/people`]: { body: { data: [] } } };
  assert.equal((await search.post({ action: 'search', api: 'classic', keywords: 'Go' })).status, 200);
});

test('le plafond LinkedIn de l\'utilisateur arrête la recherche avant tout appel au prestataire', async () => {
  const t = await boot({ quota: false });
  const response = await t.post({ action: 'search', api: 'classic', keywords: 'Go' });
  assert.equal(response.status, 429);
  assert.equal(response.body.errorType, 'QUOTA');
  assert.equal(response.body.scope, 'day');
  assert.equal(t.provider.length, 0);
  assert.equal(t.quotaCalls[0].accountId, ACCOUNT);
  assert.equal(t.quotaCalls[0].mode, 'manual');
});

test('une recherche ou un envoi refusé ne consomme aucune unité du plafond LinkedIn', async () => {
  const t = await boot();
  t.state.routes = { 'GET /acc_mine/linkedin/contracts': { body: { object: 'AvailableContracts', contracts: [] } } };
  // Licence Recruiter absente, mots-clés trop longs, page périmée : refusés avant le plafond.
  const noLicence = await t.post({ action: 'search', api: 'recruiter', keywords: 'Go' });
  assert.equal(noLicence.status, 400);
  assert.equal(noLicence.body.errorType, 'LICENCE_UNAVAILABLE');
  const tooLong = await t.post({ action: 'search', api: 'classic', keywords: 'a'.repeat(201) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error_code, 'KEYWORDS_TOO_LONG');
  const staleCursor = await t.post({ action: 'search', api: 'sales_navigator', keywords: 'Go', cursor: 'AbCd' });
  assert.equal(staleCursor.status, 400);
  assert.equal(staleCursor.body.error_code, 'INVALID_CURSOR');
  assert.deepEqual(t.quotaCalls, [], 'aucune unité consommée par les recherches refusées');
  assert.equal(t.provider.some(entry => entry.startsWith('POST ')), false);

  // Une recherche valable consomme une unité, une seule, avant l'envoi au prestataire.
  t.state.routes = { 'POST /acc_mine/linkedin/search/people': { body: { data: [] } } };
  assert.equal((await t.post({ action: 'search', api: 'classic', keywords: 'Go' })).status, 200);
  assert.deepEqual(t.quotaCalls.map(call => call.actionType), ['search']);

  // InMail sans objet (Sales Navigator), conversation mal formée, message vide : refusés avant le plafond.
  // Les licences lues plus haut sont en cache dans l'instance : un autre démarrage lit le contrat Sales Navigator.
  const sales = await boot();
  sales.state.routes = { 'GET /acc_mine/linkedin/contracts': { body: { object: 'AvailableContracts', contracts: [{ object: 'Contract', id: 'c1', name: 'SN', product: 'sales_navigator', selected: true }] } } };
  const noSubject = await sales.post({ action: 'send_message', recipient_id: 'ACoAAcandidate1', text: 'Bonjour', is_inmail: true });
  assert.equal(noSubject.status, 400);
  assert.equal((await sales.post({ action: 'send_message', chat_id: 'bad/id', recipient_id: 'ACoAAcandidate1', text: 'Bonjour' })).status, 400);
  assert.equal((await sales.post({ action: 'send_message', chat_id: 'c1', text: '  ' })).status, 400);
  assert.deepEqual(sales.quotaCalls, [], 'aucune unité consommée par les envois refusés');
  assert.equal(sales.provider.some(entry => entry.startsWith('POST ')), false);
  assert.equal(sales.calls.rpc.some(call => call.name === 'record_candidate_outbound'), false, 'ni marqueur');
});

test('les actions gardent leur plafond : recherche, profil, endossement, et la lecture des conversations n\'en a pas', async () => {
  const t = await boot();
  t.state.routes = {
    'POST /acc_mine/linkedin/search/people': { body: { data: [] } },
    'GET /acc_mine/users/ada': { body: { id: 'ACoAAada' } },
    'POST /acc_mine/linkedin/member/m1/endorse-skill': { body: { object: 'SkillEndorsed' } },
    'GET /acc_mine/chats': { body: { data: [] } },
  };
  await t.post({ action: 'search', api: 'classic', keywords: 'Go' });
  await t.post({ action: 'get_profile', profile_id: 'ada' });
  await t.post({ action: 'endorse_skill', profile_id: 'm1', skill_endorsement_id: 3 });
  await t.post({ action: 'get_chats' });
  assert.deepEqual(t.quotaCalls.map(call => call.actionType), ['search', 'profile_view', 'endorse']);
});

test('une action inconnue est refusée', async () => {
  const t = await boot();
  const response = await t.post({ action: 'ne_fait_rien' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Action non reconnue');
});

test('un envoi dans une conversation passe par l\'API v2, marqueur d\'abord, enregistrement ensuite', async () => {
  const t = await boot();
  t.state.routes = { 'POST /acc_mine/chats/c1/messages/send': { body: { object: 'MessageSent', message_id: ['m1'] } } };
  const response = await t.post({ action: 'send_message', chat_id: 'c1', recipient_id: 'ACoAAcand', text: 'Bonjour' });
  assert.equal(response.status, 200);
  assert.deepEqual(t.calls.rpc.filter(call => call.name === 'record_candidate_outbound').map(call => call.args.p_pending), [true, false]);
  assert.deepEqual(t.provider, ['POST /acc_mine/chats/c1/messages/send']);
});

test('un envoi incertain n\'est jamais compté comme envoyé ni repris', async () => {
  const t = await boot();
  t.state.routes = { 'POST /acc_mine/chats/c1/messages/send': { status: 503, body: { detail: 'Unipile indisponible' } } };
  const response = await t.post({ action: 'send_message', chat_id: 'c1', recipient_id: 'ACoAAcand', text: 'Bonjour' });
  assert.equal(response.status, 502);
  assert.equal(response.body.errorType, 'UNCERTAIN');
  noVendor(response.body);
  assert.deepEqual(t.provider, ['POST /acc_mine/chats/c1/messages/send'], 'aucune reprise');
  assert.deepEqual(t.calls.rpc.filter(call => call.name === 'record_candidate_outbound').map(call => call.args.p_pending), [true]);
});

test('un candidat effacé reçoit le message sans marqueur ni lien', async () => {
  const t = await boot({ erased: true });
  t.state.routes = { 'POST /acc_mine/chats/c1/messages/send': { body: { object: 'MessageSent', message_id: 'm1' } } };
  assert.equal((await t.post({ action: 'send_message', chat_id: 'c1', recipient_id: 'ACoAAcand', text: 'Bonjour' })).status, 200);
  assert.equal(t.calls.rpc.filter(call => call.name === 'record_candidate_outbound').length, 0);
});

test('la lecture des conversations et des messages garde les formes lues par la messagerie', async () => {
  const t = await boot();
  t.state.routes = {
    'GET /acc_mine/inboxes': { body: { data: [{ object: 'Inbox', id: 'i1', description: 'Classic', disabled: false }] } },
    'GET /acc_mine/inboxes/i1/chats': { body: { data: [{ object: 'Chat', id: 'c1', type: '1to1', is_1to1: true, user_id: 'ACoAAa', last_message_timestamp: '2026-10-01T10:00:00Z', unread_count: 1, user: { id: 'ACoAAa', display_name: 'Ada' } }] } },
    'GET /acc_mine/chats/c1/messages': { body: { data: [{ id: 'm1', chat_id: 'c1', text: 'Bonjour', timestamp: '2026-10-01T10:00:00Z', is_sender: false, sender_id: 'ACoAAa' }] } },
    'PATCH /acc_mine/chats/c1': { body: { id: 'c1', type: '1to1' } },
  };
  const chats = await t.post({ action: 'get_chats', limit: 50 });
  assert.equal(chats.body.chats[0].attendees[0].name, 'Ada');
  assert.deepEqual(chats.body.chats[0].folder, ['INBOX_LINKEDIN_CLASSIC']);
  assert.deepEqual(chats.body.cursors, { i1: null });
  const messages = await t.post({ action: 'get_messages', chat_id: 'c1' });
  assert.equal(messages.body.messages[0].text, 'Bonjour');
  assert.equal((await t.post({ action: 'mark_as_read', chat_id: 'c1' })).body.success, true);
  assert.equal(t.provider.some(entry => entry.includes('/chat_attendees')), false);
});
