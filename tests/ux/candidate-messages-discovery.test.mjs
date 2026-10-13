import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { bootModules } from '../agent/unipile-search-harness.mjs';

// Le vrai gestionnaire de découverte (chats.ts de unipile-search, API v2) lit le transport factice du client
// partagé : aucun réseau. La fiche candidat (useCandidateMessages) l'appelle comme le fait le navigateur.
const modules = await bootModules();
const { handleGetChats, handleGetMessages } = modules;
const ACCOUNT = 'acc_my';
let provider = () => ({ status: 500, body: {} });
const mock = modules.withMockTransport(request => provider(request));

const stubs = {
  '@tanstack/react-query': 'export const useQuery = () => {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => {};',
  '@/hooks/useOrganization': 'export const useOrganization = () => {};',
  '@/hooks/useMyLinkedInAccountId': 'export const useMyLinkedInAccountId = () => {};',
  '@/lib/invokeUnipile': 'export const invokeUnipile = options => globalThis.discoveryInvoke(options.body);',
  '@/lib/quotaEvents': 'export const emitQuotaAction = () => {};',
};
const { outputFiles } = await build({
  entryPoints: [new URL('../../src/hooks/useCandidateMessages.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'candidate-history-dependencies', setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => path in stubs ? { path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: stubs[path], loader: 'js' }));
  } }],
});
const { fetchCandidateMessages } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const lookupPath = id => `/${ACCOUNT}/users/${id}/chat`;
const chatObject = (id, stamp = '2026-10-08T20:00:00Z') => ({
  object: 'Chat', id, type: '1to1', is_1to1: true, user_id: 'ACoAAcandidate', last_message_timestamp: stamp,
  user: { id: 'ACoAAcandidate', display_name: 'Candidat' },
});

async function discovery(params = {}) {
  const response = await handleGetChats(ACCOUNT, { attendee_provider_id: 'candidate', ...params });
  return { data: await response.json(), httpStatus: response.status };
}

test.after(() => mock.restore());

test('Une personne sans conversation (liste vide du prestataire) est une absence normale', async () => {
  const requests = [];
  provider = request => { requests.push(request); return { body: { object: 'ChatLookup', data: [] } }; };
  assert.deepEqual(await discovery(), { data: { success: true, chats: [], cursor: null }, httpStatus: 200 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, lookupPath('candidate'));
  assert.equal(requests[0].method, 'GET');
});

for (const [label, status, body] of [
  ['route inexistante', 404, { message: 'Cannot GET /v2/acc_my/users/candidate/chat' }],
  ['compte absent', 404, { detail: 'Account not found' }],
  ['personne introuvable', 404, { detail: 'User not found' }],
  ['session expirée', 401, { detail: 'Unauthorized' }],
  ['accès refusé', 403, { detail: 'Insufficient permissions' }],
  ['limite atteinte', 429, { detail: 'Too many requests' }],
  ['panne serveur', 500, { detail: 'Internal error' }],
  ['service indisponible', 503, { detail: 'No client session is currently running.' }],
]) test(`La découverte conserve l’erreur réelle : ${label}`, async () => {
  provider = () => ({ status, body });
  const { data, httpStatus } = await discovery();
  assert.equal(data.success, false);
  assert.deepEqual(data.chats, []);
  assert.equal(httpStatus, 200, 'statut 200 comme avant : l’appelant lit success');
  assert.doesNotMatch(JSON.stringify(data), /unipile/i);
});

test('La recherche par personne ne se pagine plus : un curseur reçu est la fin de la liste, sans appel', async () => {
  let calls = 0;
  provider = () => { calls++; return { status: 404, body: {} }; };
  assert.deepEqual((await discovery({ cursor: 'next-page' })).data, { success: true, chats: [], cursor: null });
  assert.equal(calls, 0);
});

test('La fiche sans échange charge un historique vide, y compris après résolution de son URL', async () => {
  const actions = [];
  provider = () => ({ body: { object: 'ChatLookup', data: [] } });
  globalThis.discoveryInvoke = async body => {
    actions.push(body.action);
    assert.equal(body.organization_id, 'my-org');
    assert.equal(body.account_id, ACCOUNT);
    if (body.action === 'get_profile') return { data: { success: true, profile: { provider_id: 'resolved-candidate' } } };
    assert.equal(body.action, 'get_chats');
    return discovery(body);
  };
  assert.deepEqual(await fetchCandidateMessages('my-org', ACCOUNT, ['imported-candidate'], 'https://linkedin.com/in/candidate'), { messages: [], chats: [] });
  assert.deepEqual(actions, ['get_chats', 'get_profile', 'get_chats']);
});

test('Un alias sans conversation ne masque pas les messages de l’identifiant résolu', async () => {
  provider = request => {
    if (request.path === lookupPath('resolved-candidate')) return { body: { data: [{ chat_id: 'existing-chat' }] } };
    if (request.path === `/${ACCOUNT}/chats/existing-chat`) return { body: chatObject('existing-chat') };
    return { body: { data: [] } };
  };
  globalThis.discoveryInvoke = async body => {
    if (body.action === 'get_profile') return { data: { success: true, profile: { provider_id: 'resolved-candidate' } } };
    if (body.action === 'get_messages') return { data: { success: true, messages: [{ id: 'existing-message', text: 'Bonjour' }] } };
    return discovery(body);
  };
  const result = await fetchCandidateMessages('my-org', ACCOUNT, ['imported-candidate'], 'https://linkedin.com/in/candidate');
  assert.equal(result.chats[0].id, 'existing-chat');
  assert.equal(result.messages[0].text, 'Bonjour');
});

for (const status of [429, 503]) test(`Une résolution du profil indisponible (${status}) ne devient pas un historique vide après un alias sans conversation`, async () => {
  const actions = [];
  provider = () => ({ body: { data: [] } });
  globalThis.discoveryInvoke = async body => {
    actions.push(body.action);
    if (body.action === 'get_profile') return { data: { success: false, error: 'Profil indisponible' }, httpStatus: status };
    return discovery(body);
  };
  await assert.rejects(() => fetchCandidateMessages('my-org', ACCOUNT, ['imported-candidate'], 'https://linkedin.com/in/candidate'), /indisponibles/);
  assert.deepEqual(actions, ['get_chats', 'get_profile']);
});

test('Un alias vide ne transforme pas la panne d’un autre alias en historique vide', async () => {
  provider = request => request.path === lookupPath('missing-candidate')
    ? { body: { data: [] } }
    : { status: 503, body: { detail: 'Service unavailable' } };
  globalThis.discoveryInvoke = discovery;
  await assert.rejects(() => fetchCandidateMessages('my-org', ACCOUNT, ['missing-candidate', 'candidate']), /indisponibles/);
});

test('Une lecture des messages interrompue reste en erreur dans la fiche candidat', async () => {
  provider = request => {
    if (request.path === lookupPath('candidate')) return { body: { data: [{ chat_id: 'chat-a' }] } };
    if (request.path === `/${ACCOUNT}/chats/chat-a`) return { body: chatObject('chat-a') };
    if (request.path === `/${ACCOUNT}/chats/chat-a/messages`) {
      return request.query.has('cursor')
        ? { status: 500, body: { detail: 'Service unavailable' } }
        : { body: { data: [{ id: 'm1', chat_id: 'chat-a', text: 'Bonjour', timestamp: '2026-10-08T20:00:00Z', is_sender: true }], next_cursor: 'older' } };
    }
    return { status: 404, body: {} };
  };
  globalThis.discoveryInvoke = async body => {
    if (body.action === 'get_messages') {
      const response = await handleGetMessages(ACCOUNT, body);
      return { data: await response.json(), httpStatus: response.status };
    }
    return discovery(body);
  };
  await assert.rejects(() => fetchCandidateMessages('my-org', ACCOUNT, ['candidate']), /indisponibles/);
});

test('Une panne de toutes les boîtes ne devient pas une messagerie vide', async () => {
  const requests = [];
  provider = request => {
    requests.push(request.path);
    return request.path.endsWith('/inboxes')
      ? { body: { data: [{ object: 'Inbox', id: 'inbox_a', disabled: false }, { object: 'Inbox', id: 'inbox_b', disabled: false }] } }
      : { status: 500, body: { detail: 'Service unavailable' } };
  };
  modules.clearLicenceCache();
  const response = await handleGetChats(ACCOUNT, {});
  assert.equal(response.status, 502);
  assert.equal((await response.json()).success, false);
  assert.equal(requests.filter(path => path.endsWith('/chats')).length, 2, 'chaque boîte est lue une fois');
});

test('Une boîte refusée ne masque pas une autre boîte chargée et vide', async () => {
  provider = request => request.path.endsWith('/inboxes')
    ? { body: { data: [{ object: 'Inbox', id: 'inbox_a', disabled: false }, { object: 'Inbox', id: 'inbox_b', disabled: false }] } }
    : request.path.includes('inbox_a') ? { status: 403, body: { detail: 'Feature not subscribed' } } : { body: { data: [] } };
  modules.clearLicenceCache();
  const response = await handleGetChats(ACCOUNT, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
});

test('Des boîtes déjà parcourues ne provoquent aucun appel de liste ni fausse panne', async () => {
  const requests = [];
  provider = request => {
    requests.push(request.path);
    return request.path.endsWith('/inboxes')
      ? { body: { data: [{ object: 'Inbox', id: 'inbox_a', disabled: false }, { object: 'Inbox', id: 'inbox_b', disabled: false }] } }
      : { status: 500, body: {} };
  };
  modules.clearLicenceCache();
  const response = await handleGetChats(ACCOUNT, { cursors: { inbox_a: null, inbox_b: null } });
  const result = await response.json();
  assert.equal(result.success, true);
  assert.deepEqual(result.chats, []);
  assert.equal(result.cursor, null);
  assert.equal(requests.filter(path => path.endsWith('/chats')).length, 0);
});

test('Une boîte déjà parcourue ne masque pas les erreurs des boîtes restant à charger', async () => {
  provider = request => request.path.endsWith('/inboxes')
    ? { body: { data: [{ object: 'Inbox', id: 'inbox_a', disabled: false }, { object: 'Inbox', id: 'inbox_b', disabled: false }] } }
    : { status: 500, body: {} };
  modules.clearLicenceCache();
  const response = await handleGetChats(ACCOUNT, { cursors: { inbox_a: null, inbox_b: 'next-b' } });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).success, false);
});
