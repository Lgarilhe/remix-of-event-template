// Garde des durcissements du faux prestataire (e2e/local-stack/vendor-mock.mjs) : état du
// compte (retiré, verrouillé, déconnecté), intent non terminé, contrat des requêtes de
// recherche, d'envoi et de visite, routes de lecture ajoutées, formes de résultat par licence,
// charges par défaut de /__fire et rejeu. Le faux est lancé sur un port libre, comme par up.sh.
//
//   node --test e2e/local-stack/vendor-mock-contract.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK_FILE = path.join(HERE, 'vendor-mock.mjs');
const FIXTURES = path.join(HERE, '..', '..', 'tests', 'fixtures', 'unipile-v2');
const API_KEY = 'contract-test-key';

let base;
let child;
let receiver;
let received = [];
let receiverStatuses = [];
let receiverUrl;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ url: req.url, body: raw ? JSON.parse(raw) : null });
      res.writeHead(receiverStatuses.shift() ?? 200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [MOCK_FILE], {
    env: {
      ...process.env, VENDOR_MOCK_PORT: String(port), VENDOR_MOCK_V2_API_KEY: API_KEY,
      VENDOR_MOCK_WEBHOOK_TOKEN: 'tok', VENDOR_MOCK_WEBHOOK_URL: receiverUrl,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('vendor mock on')) resolve(); });
    child.on('exit', (code) => reject(new Error(`faux prestataire arrêté (${code})`)));
  });
});

after(() => { child?.kill(); receiver?.close(); });

const acc = () => `acc_${Math.random().toString(36).slice(2, 12)}`;

async function call(method, p, { body, key = API_KEY, host = 'api.unipile.com' } = {}) {
  const headers = { ...(host ? { 'x-original-host': host } : {}), ...(key ? { 'x-api-key': key } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const control = (method, p, body) => call(method, p, { body, host: null, key: null });
const mode = (account, m) => control('POST', '/__mode', { [account]: m });
const violationsOf = async (account, kind) => (await control('GET', `/__violations?account_id=${account}${kind ? `&kind=${kind}` : ''}`)).body;
const contract = async (account) => (await violationsOf(account, 'contract_violation')).map((v) => v.detail).join(' | ');

// ─── État du compte ─────────────────────────────────────────────────────────

test('un compte retiré répond 404 à tout appel, y compris un envoi', async () => {
  const a = acc();
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 200);
  assert.equal((await call('DELETE', `/v2/accounts/${a}`)).status, 200);
  assert.equal((await call('GET', `/v2/accounts/${a}`)).status, 404);
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 404);
  assert.equal((await call('POST', `/v2/${a}/users/me/relation-requests`, { body: { user_id: 'ACoAAx' } })).status, 404);
});

test('un compte verrouillé ou déconnecté refuse tout appel (403), sauf allow_when_locked', async () => {
  const locked = acc();
  await mode(locked, { locked: true });
  const send = (a) => call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } });
  const refused = await send(locked);
  assert.equal(refused.status, 403);
  assert.match(refused.body.detail, /locked/i);
  assert.equal((await call('POST', `/v2/${locked}/users/me/relation-requests`, { body: { user_id: 'ACoAAx' } })).status, 403);
  await mode(locked, { locked: true, allow_when_locked: true });
  assert.equal((await send(locked)).status, 200);

  const gone = acc();
  await mode(gone, { status: 'disconnected' });
  const r = await send(gone);
  assert.equal(r.status, 403);
  assert.match(r.body.detail, /reconnect/i);
  // La lecture du compte lui-même reste possible : c'est elle qui dit pourquoi.
  assert.equal((await call('GET', `/v2/accounts/${gone}`)).body.status, 'disconnected');

  const errored = acc();
  await mode(errored, { status: 'errored' });
  assert.equal((await send(errored)).status, 503);
  // degraded et partial laissent passer : un produit seulement est touché.
  const degraded = acc();
  await mode(degraded, { status: 'degraded' });
  assert.equal((await send(degraded)).status, 200);
});

test('un intent non terminé n\'est pas un compte en marche ; strict_accounts refuse un identifiant jamais vu', async () => {
  const a = acc();
  const intent = await call('POST', '/v2/auth/intent', { body: { provider: 'whatsapp', credentials: { qrcode: true } } });
  assert.equal(intent.body.object, 'AuthenticationQrCode');
  assert.equal((await call('GET', `/v2/accounts/${intent.body.intent_id}`)).status, 404, 'le QR n\'est pas scanné');

  // Par défaut un identifiant inconnu est créé à la volée (comportement historique des specs).
  assert.equal((await call('GET', `/v2/accounts/${a}`)).status, 200);
  const b = acc();
  await mode('*', { strict_accounts: true });
  try {
    assert.equal((await call('GET', `/v2/accounts/${b}`)).status, 404);
    await mode(b, {});
    assert.equal((await call('GET', `/v2/accounts/${b}`)).status, 200, 'configuré par /__mode : connu');
  } finally {
    await mode('*', { strict_accounts: false });
  }
});

// ─── Contrat ────────────────────────────────────────────────────────────────

test('recherche classic : pas de limit, network_distance en nombres, filtres en tableaux', async () => {
  const a = acc();
  const search = (query, body) => call('POST', `/v2/${a}/linkedin/search/people${query}`, { body });
  assert.equal((await search('', { keywords: 'x', network_distance: [1, 2], location: ['102'] })).status, 200);
  assert.equal((await search('?limit=50', { keywords: 'x' })).status, 422, 'limit n\'existe pas en classic');
  assert.equal((await search('', { network_distance: ['FIRST_DEGREE'] })).status, 422);
  assert.equal((await search('', { location: 'Paris' })).status, 422);
  assert.equal((await search('', { connections_of: ['x'] })).status, 422);
  const text = await contract(a);
  assert.match(text, /limit/);
  assert.match(text, /network_distance/);
  assert.match(text, /location/);
  assert.match(text, /connections_of/);
});

test('recherche Recruiter et Sales Navigator : limit dans les bornes, filtre en chaîne refusé', async () => {
  const a = acc();
  const recruiter = (query, body) => call('POST', `/v2/${a}/linkedin/recruiter/search/people${query}`, { body });
  assert.equal((await recruiter('?limit=100', { keywords: 'x', seniority: ['SENIOR'] })).status, 200);
  assert.equal((await recruiter('?limit=500', {})).status, 422);
  assert.equal((await recruiter('', { seniority: 'SENIOR' })).status, 422);
  assert.equal((await recruiter('?offset=10', {})).status, 422, 'Recruiter se pagine par curseur');
  const sales = (query, body) => call('POST', `/v2/${a}/linkedin/sales-navigator/search/people${query}`, { body });
  assert.equal((await sales('?offset=25&limit=25', {})).status, 200);
  assert.equal((await sales('?cursor=abc', {})).status, 422, 'Sales Navigator se pagine par offset');
  assert.equal((await sales('?limit=0', {})).status, 422);
});

test('sendMessage : pas d\'InMail ni de sujet après la création de la conversation', async () => {
  const a = acc();
  const send = (specifics) => call('POST', `/v2/${a}/chats/C1/messages/send`, { body: { text: 'Bonjour', specifics } });
  assert.equal((await send(undefined)).status, 200);
  assert.equal((await send({ linkedin: { classic: { shared_content: { type: 'post', id: '1' } } } })).status, 200);
  assert.equal((await send({ linkedin: { classic: { inmail: true } } })).status, 422);
  assert.equal((await send({ linkedin: { recruiter: { subject: 's', signature: 'x' } } })).status, 422);
});

test('e-mail : le suivi exige html, reply_to est une liste d\'adresses', async () => {
  const a = acc();
  const mail = (extra) => call('POST', `/v2/${a}/emails/send`, { body: { to: [{ email: 'c@example.test' }], subject: 'S', ...extra } });
  assert.equal((await mail({ html: '<p>x</p>', tracking_options: { opens: true } })).status, 200);
  assert.equal((await mail({ plain_text: 'x', tracking_options: { opens: true } })).status, 422);
  assert.equal((await mail({ html: '<p>x</p>', reply_to: 'id-1' })).status, 422);
  assert.equal((await mail({ html: '<p>x</p>', reply_to: [{ email: 'r@example.test' }] })).status, 200);
  assert.equal((await mail({ html: '<p>x</p>', custom_headers: [{ name: 'X-A', value: 1 }] })).status, 422);
});

test('visite de profil : le jeton vient d\'une lecture de profil du même compte', async () => {
  const a = acc();
  const other = acc();
  const token = (await call('GET', `/v2/${a}/users/some-slug`)).body.specifics.notify_visit_token;
  assert.equal((await call('POST', `/v2/${a}/users/visit-profile?token=${token}`)).status, 200);
  assert.equal((await call('POST', `/v2/${a}/users/visit-profile?token=zzz`)).status, 422);
  assert.equal((await call('POST', `/v2/${other}/users/visit-profile?token=${token}`)).status, 422, 'jeton d\'un autre compte');
  await mode(other, { any_visit_token: true });
  assert.equal((await call('POST', `/v2/${other}/users/visit-profile?token=zzz`)).status, 200);
});

test('barre finale : /v2/accounts, /v2/webhooks/endpoints et /v2/webhooks/conversations la portent', async () => {
  const before = (await control('GET', '/__violations?kind=contract_violation')).body.length;
  assert.equal((await call('GET', '/v2/accounts/?limit=1')).status, 200);
  assert.equal((await call('GET', '/v2/webhooks/endpoints/')).status, 200);
  assert.equal((await control('GET', '/__violations?kind=contract_violation')).body.length, before, 'avec barre : aucun écart');
  assert.equal((await call('GET', '/v2/accounts?limit=1')).status, 200, 'sans barre : servi');
  assert.equal((await call('GET', '/v2/webhooks/endpoints')).status, 200);
  const after = (await control('GET', '/__violations?kind=contract_violation')).body;
  assert.equal(after.length, before + 2);
  assert.match(after.at(-1).detail, /barre finale/);
});

// ─── Routes ajoutées ────────────────────────────────────────────────────────

test('routes de lecture ajoutées : dossier d\'e-mails, publications, recherches publications, offres, sociétés Sales Navigator', async () => {
  const a = acc();
  await mode(a, { emails: [{ object: 'Email', id: 'em_1' }] });
  const folder = await call('GET', `/v2/${a}/folders/INBOX/emails`);
  assert.equal(folder.status, 200);
  assert.equal(folder.body.data[0].id, 'em_1');
  assert.deepEqual((await call('GET', `/v2/${a}/users/ACoAAx/posts`)).body, { data: [] });
  assert.equal((await call('POST', `/v2/${a}/linkedin/search/posts?limit=3`, { body: {} })).status, 200);
  assert.equal((await call('POST', `/v2/${a}/linkedin/search/jobs?offset=0&limit=50`, { body: {} })).status, 200);
  assert.equal((await call('POST', `/v2/${a}/linkedin/search/jobs?limit=51`, { body: {} })).status, 422);
  assert.equal((await call('POST', `/v2/${a}/linkedin/sales-navigator/search/companies?limit=25`, { body: {} })).status, 200);
  assert.deepEqual(await violationsOf(a, 'unhandled'), []);
});

// ─── Formes de résultat ─────────────────────────────────────────────────────

test('résultats Recruiter : complet avec nom et listes, partiel sans nom ni URL', async () => {
  const a = acc();
  await mode(a, { search_results: [{ id: 'ACoAAfull' }, { id: 'ACoAApart', visibility: 'partial' }] });
  const [full, partial] = (await call('POST', `/v2/${a}/linkedin/recruiter/search/people`, { body: {} })).body.data;
  assert.equal(full.visibility, 'full');
  assert.equal(full.product, 'recruiter');
  assert.equal(full.display_name, 'Test Candidat');
  for (const key of ['candidate_id', 'is_hidden_candidate', 'is_open_to_work', 'work_experience', 'skills', 'education', 'languages', 'certifications', 'projects', 'volunteering', 'recommendations']) {
    assert.ok(key in full, key);
  }
  assert.equal(partial.visibility, 'partial');
  for (const key of ['display_name', 'public_identifier', 'profile_url']) assert.ok(!(key in partial), `${key} absent d'un profil partiel`);
  assert.ok('candidate_id' in partial && 'work_experience' in partial);
});

test('résultats Sales Navigator : drapeaux et compteurs obligatoires de la spécification', async () => {
  const a = acc();
  await mode(a, { search_results: [{ id: 'ACoAAsn' }] });
  const [lead] = (await call('POST', `/v2/${a}/linkedin/sales-navigator/search/people`, { body: {} })).body.data;
  assert.equal(lead.product, 'sales_navigator');
  for (const key of ['has_been_viewed', 'has_been_saved', 'has_posted_recently', 'has_viewed_your_profile', 'was_hired_recently', 'was_promoted_recently',
    'follows_your_company', 'is_premium', 'is_past_colleague', 'is_open_profile', 'contact_info', 'lists_count', 'notes_count', 'education', 'skills', 'work_experience', 'languages', 'volunteering']) {
    assert.ok(key in lead, key);
  }
});

test('sections de profil : formes de la spécification, contenu posé par profile_sections', async () => {
  const a = acc();
  const empty = (await call('GET', `/v2/${a}/users/ACoAAx?with_sections=linkedin_*`)).body.specifics;
  assert.deepEqual(empty.recommendations, { received: [], given: [] });
  assert.deepEqual(empty.interests, {});
  assert.deepEqual(empty.experience, []);
  assert.deepEqual(empty.volunteer_experience, []);
  await mode(a, { profile_sections: { experience: [{ job_title: 'Dev', company: { id: null, name: 'Acme' } }], skills: [{ name: 'SQL', endorsement_count: 3 }] } });
  const rich = (await call('GET', `/v2/${a}/users/ACoAAx?with_sections=linkedin_experience,linkedin_skills_preview`)).body.specifics;
  assert.equal(rich.experience[0].job_title, 'Dev');
  assert.equal(rich.skills[0].endorsement_count, 3);
  assert.ok(!('education' in rich), 'seules les sections demandées');
});

// ─── Webhooks ───────────────────────────────────────────────────────────────

test('/__fire : message.new porte exactement les clés de la capture réelle', async () => {
  const a = acc();
  const captured = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'webhook-events.json'), 'utf8')).real_message_new.payload;
  const fire = await control('POST', '/__fire', { account_id: a, type: 'message.new' });
  assert.deepEqual(Object.keys(fire.body.event.payload).sort(), Object.keys(captured).sort());
  assert.deepEqual(Object.keys(fire.body.event.payload.sender).sort(), Object.keys(captured.sender).sort());
  // Un test qui veut d'autres champs les pose lui-même.
  const withType = await control('POST', '/__fire', { account_id: a, type: 'message.new', payload: { specifics: { type: 'INMAIL' } } });
  assert.equal(withType.body.event.payload.specifics.type, 'INMAIL');
});

test('/__fire : degraded et partial nomment un produit hors service, account.remove ne se dit pas « running »', async () => {
  const a = acc();
  for (const type of ['account.status.degraded', 'account.status.partial']) {
    const { payload } = (await control('POST', '/__fire', { account_id: a, type })).body.event;
    const states = Object.values(payload.metadata.products_connection_status);
    assert.ok(states.some((s) => s !== 'running'), `${type} : un produit n'est pas en marche`);
    assert.ok(states.includes('running'), `${type} : un autre l'est`);
  }
  const removed = (await control('POST', '/__fire', { account_id: a, type: 'account.remove' })).body.event.payload;
  assert.notEqual(removed.status, 'running');
  assert.equal(removed.id, a);
  for (const type of ['message.receipt.read', 'message.reaction.new']) {
    const { payload } = (await control('POST', '/__fire', { account_id: a, type })).body.event;
    assert.ok(payload.message_id && payload.chat_id, `${type} : message et conversation`);
  }
});

test('/__fire avec retries : même evt_ rejoué avec first_attempt faux tant que le récepteur répond 5xx', async () => {
  const a = acc();
  received = [];
  receiverStatuses = [503, 500, 200];
  const fire = await control('POST', '/__fire', { account_id: a, type: 'message.new', retries: 3 });
  assert.deepEqual(fire.body.deliveries.map((d) => d.http_status), [503, 500, 200]);
  assert.deepEqual(fire.body.deliveries.map((d) => d.first_attempt), [true, false, false]);
  assert.equal(new Set(received.map((r) => r.body.id)).size, 1, 'une seule enveloppe, rejouée');
  // Sans retries : un seul envoi, même en 5xx.
  received = [];
  receiverStatuses = [500];
  const once = await control('POST', '/__fire', { account_id: a, type: 'message.new' });
  assert.equal(once.body.deliveries.length, 1);
});

// ─── Contrôle de fin de série ───────────────────────────────────────────────

test('check-violations.mjs sort en erreur sur un appel de l\'ancienne API, pas sur un écart de contrat', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (...args) => spawnSync(process.execPath, [path.join(HERE, 'check-violations.mjs'), ...args], {
    env: { ...process.env, E2E_VENDOR_MOCK_URL: base }, encoding: 'utf8',
  });
  await control('DELETE', '/__violations');
  assert.equal(run().status, 0);
  const a = acc();
  await call('POST', `/v2/${a}/chats/send`, { body: { account_id: a, attendees_ids: 'x', text: 'x' } }); // écart de contrat seulement
  assert.equal(run().status, 0, 'contract_violation n\'est pas bloquant par défaut');
  assert.equal(run('contract_violation').status, 1);
  const v1 = await fetch(`${base}/api/v1/chats`, { headers: { 'x-original-host': 'api1.unipile.com', 'x-api-key': 'k' } });
  assert.equal(v1.status, 599);
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /v1_call/);
  await control('DELETE', '/__violations');
  assert.equal(run().status, 0);
});
