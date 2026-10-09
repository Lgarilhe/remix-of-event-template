import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import ts from 'typescript';

const edgePath = new URL('../../supabase/functions/unipile-search/index.ts', import.meta.url);
const source = await readFile(edgePath, 'utf8');
const parsed = ts.createSourceFile(edgePath.pathname, source, ts.ScriptTarget.Latest, true);
const handler = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleGetChats');
assert.ok(handler, 'Le test doit appeler le véritable handler de découverte');
const { code } = await transform(`
  const corsHeaders = {};
  const console = { log() {}, warn() {}, error() {} };
  const fetchWithTimeout = (...args) => globalThis.discoveryFetch(...args);
  export ${handler.getText(parsed)}
`, { loader: 'ts', format: 'esm' });
const { handleGetChats } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

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
const absent = { status: 404, type: 'errors/resource_not_found', title: 'Resource not found.', detail: 'The requested resource were not found.\nAttendee not found' };
const baseUrl = 'https://provider.example.test/api/v1';

function providerResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function discovery(params = {}) {
  const response = await handleGetChats(baseUrl, 'fixture-key', 'my-account', { attendee_provider_id: 'candidate', ...params });
  return { data: await response.json(), httpStatus: response.status };
}

test('Le 404 participant documenté et observé devient une absence normale de conversation', async () => {
  const requests = [];
  globalThis.discoveryFetch = async (url, options) => {
    requests.push({ url, options });
    return providerResponse(404, absent);
  };
  assert.deepEqual(await discovery(), { data: { success: true, chats: [], cursor: null }, httpStatus: 200 });
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/api/v1/chat_attendees/candidate/chats');
  assert.equal(new URL(requests[0].url).searchParams.get('account_id'), 'my-account');
  assert.equal(requests[0].options.method ?? 'GET', 'GET');
});

for (const [label, status, body] of [
  ['route inexistante', 404, { message: 'Cannot GET /api/v1/chat_attendees/candidate/chats' }],
  ['compte absent', 404, { detail: 'Account not found' }],
  ['ressource absente sans précision', 404, { type: 'errors/resource_not_found', detail: 'The requested resource were not found.' }],
  ['session expirée', 401, { detail: 'Attendee not found' }],
  ['accès refusé', 403, { detail: 'Insufficient permissions' }],
  ['limite atteinte', 429, { detail: 'Too many requests' }],
  ['panne serveur', 500, { detail: 'Attendee not found' }],
  ['service indisponible', 503, { detail: 'No client session is currently running.' }],
]) test(`La découverte conserve l’erreur réelle : ${label}`, async () => {
  globalThis.discoveryFetch = async () => providerResponse(status, body);
  assert.equal((await discovery()).data.success, false);
});

test('Une disparition du participant à la page suivante ne tronque pas silencieusement l’historique', async () => {
  globalThis.discoveryFetch = async () => providerResponse(404, absent);
  assert.equal((await discovery({ cursor: 'next-page' })).data.success, false);
});

test('La fiche sans échange charge un historique vide, y compris après résolution de son URL', async () => {
  const actions = [];
  globalThis.discoveryFetch = async () => providerResponse(404, absent);
  globalThis.discoveryInvoke = async body => {
    actions.push(body.action);
    assert.equal(body.organization_id, 'my-org');
    assert.equal(body.account_id, 'my-account');
    if (body.action === 'get_profile') return { data: { success: true, profile: { provider_id: 'resolved-candidate' } } };
    assert.equal(body.action, 'get_chats');
    return discovery(body);
  };
  assert.deepEqual(await fetchCandidateMessages('my-org', 'my-account', ['imported-candidate'], 'https://linkedin.com/in/candidate'), { messages: [], chats: [] });
  assert.deepEqual(actions, ['get_chats', 'get_profile', 'get_chats']);
});

test('Un alias sans participant ne masque pas les messages de l’identifiant résolu', async () => {
  globalThis.discoveryFetch = async url => new URL(url).pathname.includes('/resolved-candidate/')
    ? providerResponse(200, { items: [{ id: 'existing-chat', timestamp: '2026-10-08T20:00:00Z' }], cursor: null })
    : providerResponse(404, absent);
  globalThis.discoveryInvoke = async body => {
    if (body.action === 'get_profile') return { data: { success: true, profile: { provider_id: 'resolved-candidate' } } };
    if (body.action === 'get_messages') return { data: { success: true, messages: [{ id: 'existing-message', text: 'Bonjour' }] } };
    return discovery(body);
  };
  const result = await fetchCandidateMessages('my-org', 'my-account', ['imported-candidate'], 'https://linkedin.com/in/candidate');
  assert.equal(result.chats[0].id, 'existing-chat');
  assert.equal(result.messages[0].text, 'Bonjour');
});

for (const status of [429, 503]) test(`Une résolution du profil indisponible (${status}) ne devient pas un historique vide après un alias absent`, async () => {
  const actions = [];
  globalThis.discoveryFetch = async () => providerResponse(404, absent);
  globalThis.discoveryInvoke = async body => {
    actions.push(body.action);
    if (body.action === 'get_profile') return { data: { success: false, error: 'Profil indisponible' }, httpStatus: status };
    return discovery(body);
  };
  await assert.rejects(() => fetchCandidateMessages('my-org', 'my-account', ['imported-candidate'], 'https://linkedin.com/in/candidate'), /indisponibles/);
  assert.deepEqual(actions, ['get_chats', 'get_profile']);
});

test('Un alias vide ne transforme pas la panne d’un autre alias en historique vide', async () => {
  globalThis.discoveryFetch = async url => new URL(url).pathname.includes('/missing-candidate/')
    ? providerResponse(404, absent)
    : providerResponse(503, { detail: 'Service unavailable' });
  globalThis.discoveryInvoke = discovery;
  await assert.rejects(() => fetchCandidateMessages('my-org', 'my-account', ['missing-candidate', 'candidate']), /indisponibles/);
});

test('Une pagination interrompue reste en erreur dans la fiche candidat', async () => {
  globalThis.discoveryFetch = async url => new URL(url).searchParams.has('cursor')
    ? providerResponse(404, absent)
    : providerResponse(200, { items: [{ id: 'first-chat' }], cursor: 'next-page' });
  globalThis.discoveryInvoke = discovery;
  await assert.rejects(() => fetchCandidateMessages('my-org', 'my-account', ['candidate']), /indisponible/);
});

test('Une panne de tous les dossiers ne devient pas une messagerie vide', async () => {
  const requests = [];
  globalThis.discoveryFetch = async url => {
    requests.push(url);
    return providerResponse(500, { detail: 'Service unavailable' });
  };
  const response = await handleGetChats(baseUrl, 'fixture-key', 'my-account', {});
  assert.equal(response.status, 502);
  assert.equal((await response.json()).success, false);
  assert.equal(requests.length, 3);
});

test('Un dossier absent de la licence ne masque pas un autre dossier chargé et vide', async () => {
  globalThis.discoveryFetch = async url => new URL(url).searchParams.get('folder') === 'INBOX_LINKEDIN_RECRUITER'
    ? providerResponse(403, { detail: 'Feature not subscribed' })
    : providerResponse(200, { items: [], cursor: null });
  const response = await handleGetChats(baseUrl, 'fixture-key', 'my-account', {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
});

test('Des dossiers déjà parcourus ne provoquent aucun appel ni fausse panne', async () => {
  globalThis.discoveryFetch = () => { throw new Error('Aucun dossier à relire'); };
  const response = await handleGetChats(baseUrl, 'fixture-key', 'my-account', {
    cursors: { INBOX_LINKEDIN_CLASSIC: null, INBOX_LINKEDIN_RECRUITER: null, INBOX: null },
  });
  const result = await response.json();
  assert.equal(result.success, true);
  assert.deepEqual(result.chats, []);
  assert.equal(result.cursor, null);
});

test('Un dossier déjà parcouru ne masque pas les erreurs des dossiers restant à charger', async () => {
  globalThis.discoveryFetch = async () => { throw new Error('Network unavailable'); };
  const response = await handleGetChats(baseUrl, 'fixture-key', 'my-account', {
    cursors: { INBOX_LINKEDIN_CLASSIC: null, INBOX_LINKEDIN_RECRUITER: 'next-recruiter', INBOX: 'next-inbox' },
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).success, false);
});
