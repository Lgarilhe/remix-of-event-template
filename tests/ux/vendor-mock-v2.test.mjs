// Garde du faux prestataire LinkedIn de la stack e2e (e2e/local-stack/vendor-mock.mjs) :
// il parle l'API v2 uniquement, avec ses formes de réponse, sa surface de contrôle
// (journal par compte, modes, routes scriptées, injection d'erreur, __fire, points de
// contrôle d'authentification) et son piège contre l'ancienne API. Il est lancé comme
// par up.sh, sur un port libre : aucune pile ni Docker.
//
//   node --test tests/ux/vendor-mock-v2.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCK_FILE = path.join(ROOT, 'e2e', 'local-stack', 'vendor-mock.mjs');
const HELPER_FILE = path.join(ROOT, 'e2e', 'helpers', 'sequence-engine.ts');
const API_KEY = 'unit-test-key';
const WEBHOOK_TOKEN = 'unit-test-token';

let mock;
let base;
let child;
let receiver;
let received = [];
let receiverUrl;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}/functions/v1/unipile-webhook`;

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [MOCK_FILE], {
    env: {
      ...process.env, VENDOR_MOCK_PORT: String(port), VENDOR_MOCK_V2_API_KEY: API_KEY,
      VENDOR_MOCK_WEBHOOK_TOKEN: WEBHOOK_TOKEN, VENDOR_MOCK_WEBHOOK_URL: receiverUrl,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('vendor mock on')) resolve(); });
    child.on('exit', (code) => reject(new Error(`faux prestataire arrêté (${code})`)));
  });
  mock = { base };
});

after(() => { child?.kill(); receiver?.close(); });

const acc = () => `acc_${Math.random().toString(36).slice(2, 12)}`;

// Appel comme le ferait une edge function via functions-server.ts (hôte d'origine en en-tête).
async function call(method, p, { body, host = 'api.unipile.com', key = API_KEY, headers = {}, raw } = {}) {
  const h = { ...(host ? { 'x-original-host': host } : {}), ...(key ? { 'x-api-key': key } : {}), ...headers };
  if (body !== undefined && raw === undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const control = (method, p, body) => call(method, p, { body, host: null, key: null });
const mode = (account, m) => control('POST', '/__mode', { [account]: m });
const logOf = async (account) => (await control('GET', `/__log?account_id=${account}`)).body;
const violationsOf = async (account, kind) => (await control('GET', `/__violations?account_id=${account}${kind ? `&kind=${kind}` : ''}`)).body;

// ─── Conversations et messages ──────────────────────────────────────────────

test('startChat : 200 ChatStarted, journalisé avec son operationId et son statut', async () => {
  const a = acc();
  const r = await call('POST', `/v2/${a}/chats/send`, { body: { text: 'Bonjour', users_ids: 'ACoAAcandidate' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.object, 'ChatStarted');
  assert.match(r.body.chat_id, /^CLASSIC_\d+-CHAT$/);
  assert.match(r.body.message_id, /^CLASSIC_\d+-MSG$/);
  const [entry] = await logOf(a);
  assert.equal(entry.op, 'startChat');
  assert.equal(entry.api, 'v2');
  assert.equal(entry.status, 200);
  assert.equal(entry.account_id, a);
  assert.equal(entry.host, 'api.unipile.com');
  assert.equal(entry.body.users_ids, 'ACoAAcandidate');
  assert.deepEqual(await violationsOf(a), []);
});

test('startChat : un corps de l\'ancienne API est un écart de contrat (422), consigné', async () => {
  const a = acc();
  const r = await call('POST', `/v2/${a}/chats/send`, { body: { account_id: a, attendees_ids: 'ACoAAx', text: 'Bonjour' } });
  assert.equal(r.status, 422);
  assert.equal(r.body.kind, 'contract_violation');
  const v = await violationsOf(a, 'contract_violation');
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /attendees_ids/);
  assert.match(v[0].detail, /users_ids/);
  assert.equal((await logOf(a))[0].contract.violations.length, 3);
});

test('InMail : corps valides par licence, sujet ou signature manquants refusés', async () => {
  const a = acc();
  const send = (specifics) => call('POST', `/v2/${a}/chats/send`, { body: { text: 'Hello', users_ids: 'ACoAAx', specifics } });
  assert.equal((await send({ linkedin: { classic: { inmail: true } } })).status, 200);
  assert.equal((await send({ linkedin: { recruiter: { subject: 'Poste', signature: 'Laurent' } } })).status, 200);
  assert.equal((await send({ linkedin: { sales_navigator: { subject: 'Poste' } } })).status, 200);
  assert.equal((await send({ linkedin: { recruiter: { subject: 'Poste' } } })).status, 422, 'recruiter sans signature');
  assert.equal((await send({ linkedin: { sales_navigator: {} } })).status, 422, 'sales_navigator sans sujet');
  assert.equal((await send({ linkedin: { classic: { inmail: 'true' } } })).status, 422, 'inmail booléen');
  assert.equal((await send({ linkedin: { classic: { inmail: true }, recruiter: { subject: 's', signature: 'x' } } })).status, 422, 'une seule licence');
  assert.equal((await violationsOf(a, 'contract_violation')).length, 4);
});

test('sendMessage : 200 MessageSent ; message_id chaîne, tableau ou nul selon le mode', async () => {
  const a = acc();
  const path = `/v2/${a}/chats/CLASSIC_9-CHAT/messages/send`;
  const first = await call('POST', path, { body: { text: 'Relance' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.object, 'MessageSent');
  assert.equal(typeof first.body.message_id, 'string');
  await mode(a, { message_id_shape: 'array' });
  assert.ok(Array.isArray((await call('POST', path, { body: { text: 'x' } })).body.message_id));
  await mode(a, { message_id_shape: 'null' });
  assert.equal((await call('POST', path, { body: { text: 'x' } })).body.message_id, null);
  assert.equal((await call('POST', path, { body: { text: 'x', subject: 'interdit' } })).status, 422, 'pas de subject sur une suite');
  const startShape = await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } });
  assert.equal(startShape.body.message_id, null, 'ChatStarted suit aussi le mode');
});

test('démarrage depuis une inbox : seules les inbox du compte existent', async () => {
  const a = acc();
  const inboxes = (await call('GET', `/v2/${a}/inboxes`)).body.data;
  assert.deepEqual(inboxes.map((i) => i.object), ['Inbox', 'Inbox', 'Inbox']);
  const ok = await call('POST', `/v2/${a}/inboxes/${inboxes[0].id}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('POST', `/v2/${a}/inboxes/INBOX_INCONNUE/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 404);
  await mode(a, { licenses: ['classic'] });
  assert.equal((await call('GET', `/v2/${a}/inboxes`)).body.data.length, 1);
  assert.equal((await logOf(a)).filter((e) => e.op === 'startChatFromInbox').length, 2);
});

test('lecture d\'une conversation : recherche par utilisateur vide (pas de 404), messages, participants d\'un 1to1', async () => {
  const a = acc();
  assert.deepEqual((await call('GET', `/v2/${a}/users/ACoAAx/chat`)).body, { object: 'ChatLookup', data: [] });
  assert.deepEqual((await call('GET', `/v2/${a}/chats/C1/messages`)).body, { data: [] });
  const chat = (await call('GET', `/v2/${a}/chats/C1`)).body;
  assert.equal(chat.object, 'Chat');
  assert.equal(chat.is_1to1, true);
  assert.equal(chat.type, '1to1');
  const message = (await call('GET', `/v2/${a}/chats/C1/messages/M1`)).body;
  assert.equal(message.object, 'Message');
  assert.equal(message.is_sender, false);
  assert.equal(typeof message.is_mentionned, 'boolean');
  assert.equal((await call('GET', `/v2/${a}/chats/C1/participants`)).status, 400, 'participants : groupes seulement');
});

// ─── Profils, demandes de relation, crédits, contrats ───────────────────────

test('profil : distance dans specifics, identifiant fourni ou fabriqué, jeton de visite', async () => {
  const a = acc();
  const slug = (await call('GET', `/v2/${a}/users/jean-dupont`)).body;
  assert.equal(slug.object, 'UserProfile');
  assert.equal(slug.public_identifier, 'jean-dupont');
  assert.match(slug.id, /^ACoAAMOCK/);
  assert.equal(slug.specifics.network_distance, 'FIRST_DEGREE');
  assert.match(slug.specifics.notify_visit_token, /^vt_/);
  assert.equal(slug.is_blocked, false);
  assert.equal(slug.provider, 'linkedin');
  assert.equal((await call('GET', `/v2/${a}/users/ACoAAreal`)).body.id, 'ACoAAreal');
  await mode(a, { distance: 'SECOND_DEGREE' });
  assert.equal((await call('GET', `/v2/${a}/users/x`)).body.specifics.network_distance, 'SECOND_DEGREE');
  await mode(a, { distance: 3 });
  assert.equal((await call('GET', `/v2/${a}/users/x`)).body.specifics.network_distance, 'THIRD_DEGREE');
  await mode(a, { distance: 'SECOND_DEGREE', distance_style: 'legacy' });
  assert.equal((await call('GET', `/v2/${a}/users/x`)).body.specifics.network_distance, 'DISTANCE_2');
  await mode(a, { invitation_pending: true });
  assert.equal((await call('GET', `/v2/${a}/users/x`)).body.specifics.relation_request_status, 'PENDING');
  const kinds = (await logOf(a)).filter((e) => e.op === 'getUserProfile').map((e) => e.id_kind);
  assert.deepEqual(kinds.slice(0, 2), ['slug', 'provider_id']);
  assert.equal((await call('GET', `/v2/${a}/users/me`)).body.specifics.network_distance, 'SELF');
});

test('demande de relation : 201 RelationRequest, champs de l\'ancienne API refusés ; visite avec jeton', async () => {
  const a = acc();
  const r = await call('POST', `/v2/${a}/users/me/relation-requests`, { body: { user_id: 'ACoAAx', message: 'Bonjour' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.object, 'RelationRequest');
  assert.equal(r.body.type, 'sent');
  assert.equal(r.body.message, 'Bonjour');
  assert.equal((await call('POST', `/v2/${a}/users/me/relation-requests`, { body: { provider_id: 'ACoAAx', account_id: a } })).status, 422);
  assert.equal((await call('POST', `/v2/${a}/users/visit-profile`)).status, 422, 'jeton obligatoire');
  // Le jeton vient de la lecture du profil par ce compte : un jeton inventé est un écart de contrat.
  assert.equal((await call('POST', `/v2/${a}/users/visit-profile?token=vt_x`)).status, 422);
  const token = (await call('GET', `/v2/${a}/users/ACoAAx`)).body.specifics.notify_visit_token;
  const visit = await call('POST', `/v2/${a}/users/visit-profile?token=${token}`);
  assert.deepEqual(visit.body, { object: 'ProfileVisited' });
  assert.equal((await call('GET', `/v2/${a}/users/me/relation-requests`)).status, 422, 'type obligatoire');
  assert.deepEqual((await call('GET', `/v2/${a}/users/me/relation-requests?type=sent`)).body, { data: [] });
});

test('crédits InMail : clé classic, licences absentes, filtre service', async () => {
  const a = acc();
  assert.deepEqual((await call('GET', `/v2/${a}/linkedin/inmail-credits`)).body, { object: 'InmailCredits', credits: { classic: 10, recruiter: 10, sales_navigator: 10 } });
  await mode(a, { inmail_credits: { classic: 2 } });
  assert.deepEqual((await call('GET', `/v2/${a}/linkedin/inmail-credits`)).body.credits, { classic: 2 });
  await mode(a, { inmail_credits: { classic: 2, recruiter: 7 } });
  assert.deepEqual((await call('GET', `/v2/${a}/linkedin/inmail-credits?service=recruiter`)).body.credits, { recruiter: 7 });
  await mode(a, { inmail_credits: null });
  assert.deepEqual((await call('GET', `/v2/${a}/linkedin/inmail-credits`)).body.credits, {});
  assert.equal((await call('GET', `/v2/${a}/linkedin/inmail-credits?service=premium`)).status, 422);
});

test('contrats : un seul sélectionné à la fois', async () => {
  const a = acc();
  const list = (await call('GET', `/v2/${a}/linkedin/contracts`)).body;
  assert.equal(list.object, 'AvailableContracts');
  assert.deepEqual(list.contracts.map((c) => [c.product, c.selected]), [['recruiter', true], ['sales_navigator', false]]);
  const picked = await call('POST', `/v2/${a}/linkedin/contracts/mock-contract-sales_navigator/select`);
  assert.equal(picked.body.object, 'ContractSelected');
  assert.deepEqual((await call('GET', `/v2/${a}/linkedin/contracts`)).body.contracts.map((c) => c.selected), [false, true]);
  assert.equal((await call('POST', `/v2/${a}/linkedin/contracts/inconnu/select`)).status, 404);
});

test('recherche : un corps hors des champs de la licence est un écart de contrat', async () => {
  const a = acc();
  await mode(a, { search_results: [{ display_name: 'Marie Curie', headline: 'Physicienne' }], search_next_cursor: 'c2' });
  const ok = await call('POST', `/v2/${a}/linkedin/search/people`, { body: { keywords: 'ingénieur', network_distance: [1, 2] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data[0].object, 'PeopleSearchResult');
  assert.equal(ok.body.data[0].product, 'classic');
  assert.equal(ok.body.next_cursor, 'c2');
  assert.equal((await call('POST', `/v2/${a}/linkedin/search/people`, { body: { role: [{ keywords: 'dev' }] } })).status, 422, 'role n\'existe pas en classic');
  assert.equal((await call('POST', `/v2/${a}/linkedin/recruiter/search/people`, { body: { job_title: [{ name: 'Dev' }], seniority: ['SENIOR'] } })).status, 200);
  assert.equal((await call('POST', `/v2/${a}/linkedin/sales-navigator/search/people`, { body: { current_job_title: { include: ['Dev'] } } })).status, 200);
  assert.equal((await call('POST', `/v2/${a}/linkedin/sales-navigator/search/people`, { body: { skills: ['x'] } })).status, 422);
});

// ─── E-mails ────────────────────────────────────────────────────────────────

test('e-mail : envoi JSON valide, body et account_id de l\'ancienne API refusés, objet Email lu', async () => {
  const a = acc();
  const ok = await call('POST', `/v2/${a}/emails/send`, { body: { to: [{ email: 'c@example.test' }], subject: 'Hello', html: '<p>Hello</p>', tracking_options: { opens: true } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.object, 'EmailSent');
  assert.match(ok.body.id, /^mail_/);
  assert.equal((await call('POST', `/v2/${a}/emails/send`, { body: { account_id: a, to: [{ identifier: 'c@example.test' }], body: '<p>x</p>' } })).status, 422);
  const email = (await call('GET', `/v2/${a}/emails/mail_1`)).body;
  assert.equal(email.object, 'Email');
  assert.equal(Array.isArray(email.from), true);
  assert.equal(email.from[0].email, 'candidat@example.test');
  assert.equal('in_reply_to' in email, false);
  assert.equal((await call('GET', `/v2/${a}/threads/t1`)).body.object, 'Thread');
});

// ─── Scripts, erreurs, modes ────────────────────────────────────────────────

test('fail_send : seuls les envois échouent, le reste répond', async () => {
  const a = acc();
  await mode(a, { fail_send: 500 });
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 500);
  assert.equal((await call('POST', `/v2/${a}/chats/C/messages/send`, { body: { text: 'x' } })).status, 500);
  assert.equal((await call('POST', `/v2/${a}/users/me/relation-requests`, { body: { user_id: 'ACoAAx' } })).status, 500);
  assert.equal((await call('POST', `/v2/${a}/emails/send`, { body: { to: [{ email: 'c@example.test' }] } })).status, 500);
  assert.equal((await call('GET', `/v2/${a}/users/ACoAAx/chat`)).status, 200);
  assert.equal((await call('GET', `/v2/${a}/linkedin/inmail-credits`)).status, 200);
});

test('routes scriptées : op, path, url, times, preset, en-têtes ; l\'isolation par compte tient', async () => {
  const a = acc();
  const b = acc();
  await mode(a, { routes: [
    { method: 'GET', op: 'getUserChat', body: { object: 'ChatLookup', data: [{ chat_id: 'C1', inbox_id: 'I1' }, { chat_id: 'C2', inbox_id: 'I2' }] } },
    { method: 'POST', op: 'startChat', preset: 'rate_limited', times: 1 },
    { method: 'POST', path: '/chats/[^/]+/messages/send$', status: 502, body: { title: 'Bad Gateway' } },
    { method: 'GET', url: 'linkedin/inmail-credits\\?service=recruiter$', status: 200, body: { object: 'InmailCredits', credits: { recruiter: 1 } } },
  ] });
  assert.equal((await call('GET', `/v2/${a}/users/ACoAAx/chat`)).body.data.length, 2);
  const limited = await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  assert.match(limited.body.detail, /Unipile/, 'le corps d\'erreur transporte le nom du fournisseur, à dessein');
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 200, 'times: 1 épuisé');
  assert.equal((await call('POST', `/v2/${a}/chats/C9/messages/send`, { body: { text: 'x' } })).status, 502);
  assert.equal((await call('GET', `/v2/${a}/linkedin/inmail-credits?service=recruiter`)).body.credits.recruiter, 1);
  assert.equal((await call('GET', `/v2/${b}/users/ACoAAx/chat`)).body.data.length, 0, 'l\'autre compte n\'est pas scripté');
  assert.equal((await logOf(a)).filter((e) => e.scripted).length, 4);
  assert.equal((await logOf(b)).filter((e) => e.scripted).length, 0);
});

test('injection d\'erreur : statut et corps libres, filtre par opération, retard, coupure', async () => {
  const a = acc();
  await mode(a, { error: { status: 503, body: { detail: 'Unipile panne sur api.unipile.com, X-API-KEY invalide' }, ops: ['startChat'], times: 2 } });
  const first = await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } });
  assert.equal(first.status, 503);
  assert.match(first.body.detail, /X-API-KEY/);
  assert.equal((await call('GET', `/v2/${a}/users/ACoAAx/chat`)).status, 200, 'ops filtre');
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 503);
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 200, 'times épuisé');

  await mode(a, { error: { preset: 'forbidden' } });
  const forbidden = await call('GET', `/v2/${a}/linkedin/contracts`);
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.body.detail, /Unipile/);

  await mode(a, { routes: [{ op: 'sendMessage', delay_ms: 150, status: 200, body: { object: 'MessageSent', message_id: 'X' } }] });
  const started = Date.now();
  await call('POST', `/v2/${a}/chats/C/messages/send`, { body: { text: 'x' } });
  assert.ok(Date.now() - started >= 140, 'delay_ms');

  await mode(a, { routes: [{ op: 'getUserChat', network_error: true }] });
  await assert.rejects(() => call('GET', `/v2/${a}/users/ACoAAx/chat`));
  assert.equal((await logOf(a)).filter((e) => e.op === 'getUserChat').pop().status, 0);

  await mode(a, { routes: [{ op: 'getUserChat', preset: 'inconnu' }] });
  assert.equal((await call('GET', `/v2/${a}/users/ACoAAx/chat`)).status, 500, 'preset inconnu : erreur du faux prestataire');
});

// ─── Piège contre l'ancienne API et garde-fous ──────────────────────────────

test('ancienne API : 599 et violation v1_call, quel que soit l\'hôte du fournisseur', async () => {
  const a = acc();
  const dsn = await call('GET', '/api/v1/chats?account_id=' + a, { host: 'unipile.mock', key: null });
  assert.equal(dsn.status, 599);
  assert.equal(dsn.body.kind, 'v1_call');
  assert.equal((await call('POST', '/api/v1/users/invite', { host: null, key: null, body: { account_id: a, provider_id: 'ACoAAx' } })).status, 599);
  assert.equal((await call('GET', '/api/v1/chat_attendees/ACoAAx/chats', { host: 'api7.unipile.com:13744', key: null })).status, 599);
  assert.equal((await call('GET', '/e2e-org/api/v1/accounts/x', { host: 'unipile.mock', key: null })).status, 599, 'DSN avec chemin');
  assert.equal((await call('POST', '/api/v1/hosted/accounts/link', { host: 'api.unipile.com', body: {} })).status, 599);
  const mine = await violationsOf(a, 'v1_call');
  assert.equal(mine.length, 2, 'rattaché au compte de la requête ou du corps');
  const all = (await control('GET', '/__violations?kind=v1_call')).body;
  assert.ok(all.length >= 5);
  assert.ok((await logOf(a)).every((e) => e.api === 'v1' && e.status === 599));
  // Les chemins /api/v1 d'un autre fournisseur ne sont pas l'ancienne API.
  const apollo = await call('POST', '/api/v1/mixed_people/api_search', { host: 'api.apollo.io', key: null, body: {} });
  assert.equal(apollo.status, 200);
  assert.deepEqual((await control('GET', '/__violations?kind=v1_call')).body.length, all.length);
});

test('VENDOR_MOCK_STRICT_V1=0 consigne sans refuser', async () => {
  const port = await freePort();
  const lenient = spawn(process.execPath, [MOCK_FILE], { env: { ...process.env, VENDOR_MOCK_PORT: String(port), VENDOR_MOCK_STRICT_V1: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve) => lenient.stdout.on('data', (d) => String(d).includes('vendor mock on') && resolve()));
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/chats`, { headers: { 'x-original-host': 'unipile.mock' } });
    assert.equal(r.status, 200);
    const v = await (await fetch(`http://127.0.0.1:${port}/__violations`)).json();
    assert.equal(v[0].kind, 'v1_call');
  } finally { lenient.kill(); }
});

test('hôte, clé, identifiant de compte et route inconnue : violations distinctes', async () => {
  const a = acc();
  const host = await call('GET', `/v2/${a}/inboxes`, { host: 'unipile.mock' });
  assert.equal(host.status, 599);
  assert.equal(host.body.kind, 'wrong_host');
  assert.equal((await call('GET', `/v2/${a}/inboxes`, { key: 'mauvaise' })).status, 401);
  assert.equal((await call('GET', `/v2/${a}/inboxes`, { key: null })).status, 401);
  const bad = await call('GET', '/v2/email_actions_x1/inboxes');
  assert.equal(bad.status, 400);
  const unknown = await call('GET', `/v2/${a}/choses/inconnues`);
  assert.equal(unknown.status, 501);
  assert.equal(unknown.body.kind, 'unhandled');
  const kinds = (await control('GET', '/__violations')).body.map((v) => v.kind);
  for (const k of ['wrong_host', 'bad_api_key', 'bad_account_id', 'unhandled']) assert.ok(kinds.includes(k), k);
  assert.deepEqual((await violationsOf(a)).map((v) => v.kind).sort(), ['bad_api_key', 'bad_api_key', 'unhandled']);
});

test('autres fournisseurs : IA par marqueur, réponse neutre pour le reste ; comptes isolés', async () => {
  const a = acc();
  await mode(a, { ai_markers: { 'MARQUEUR-42': 'Réponse marquée' } });
  const ai = await call('POST', '/v1/messages', { host: 'api.anthropic.com', key: null, body: { model: 'm', messages: [{ role: 'user', content: 'texte MARQUEUR-42' }] } });
  assert.equal(ai.body.content[0].text, 'Réponse marquée');
  const plain = await call('POST', '/emails', { host: 'api.resend.com', key: null, body: {} });
  assert.deepEqual(plain.body, { object: 'Mock', items: [] });
  const logged = (await control('GET', '/__log')).body.filter((e) => e.host === 'api.resend.com');
  assert.equal(logged[0].api, null);
});

// ─── Comptes, connexion, points de contrôle ─────────────────────────────────

test('comptes : liste paginée, lecture, modification, statuts par mode, suppression', async () => {
  const a = acc();
  await call('GET', `/v2/${a}/inboxes`);
  const got = await call('GET', `/v2/accounts/${a}`);
  assert.equal(got.body.object, 'Account');
  assert.equal(got.body.status, 'running');
  assert.equal(got.body.is_locked, false);
  assert.equal(got.body.provider, 'linkedin');
  assert.match(got.body.application_id, /^app_/);
  assert.equal(got.body.metadata.products_connection_status.recruiter, 'running');
  await mode(a, { status: 'degraded', locked: true, product_status: { recruiter: 'errored' }, v1_account_id: 'v1_abc' });
  const degraded = (await call('GET', `/v2/accounts/${a}`)).body;
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.is_locked, true);
  assert.equal(degraded.metadata.products_connection_status.recruiter, 'errored');
  assert.equal(degraded.metadata.v1_account_id, 'v1_abc');
  const list = (await call('GET', '/v2/accounts/?status=degraded&limit=5')).body;
  assert.equal(list.object, 'Accounts');
  assert.ok(list.data.some((x) => x.id === a));
  assert.equal(typeof list.has_more, 'boolean');
  const patched = await call('PATCH', `/v2/accounts/${a}`, { body: { metadata: { org: 'o1' } } });
  assert.deepEqual(patched.body.metadata.custom_data, { org: 'o1' });
  assert.equal((await call('PATCH', `/v2/accounts/${a}`, { body: { name: 'x' } })).status, 422);
  assert.equal((await call('GET', '/v2/accounts/pas_un_compte')).status, 400);
  assert.deepEqual((await call('DELETE', `/v2/accounts/${a}`)).body, { success: true });
  assert.equal((await call('GET', `/v2/accounts/${a}`)).status, 404);
  const gone = acc();
  await mode(gone, { missing: true });
  assert.equal((await call('GET', `/v2/accounts/${gone}`)).status, 404);
});

test('lien d\'authentification : sans nom ni notify_url, un seul redirect_uri, domaine à marque blanche', async () => {
  const body = { providers: ['linkedin'], expires_on: new Date(Date.now() + 3_600_000).toISOString(), redirect_uri: 'https://app.example.test/retour', state: 'signed.state' };
  const ok = await call('POST', '/v2/auth/link', { body });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.object, 'HostedAuthLink');
  assert.match(ok.body.link, /^https:\/\/auth\.unipile\.com\/[a-z0-9]+$/);
  const white = await call('POST', '/v2/auth/link', { body: { ...body, domain: 'connect.konekt.test' } });
  assert.match(white.body.link, /^https:\/\/connect\.konekt\.test\//);
  const reconnect = await call('POST', '/v2/auth/link', { body: { account_id: 'acc_abc', expires_on: body.expires_on, redirect_uri: body.redirect_uri } });
  assert.equal(reconnect.status, 200);
  const old = await call('POST', '/v2/auth/link', { body: { type: 'create', providers: ['LINKEDIN'], expiresOn: body.expires_on, success_redirect_url: 'https://a.test', notify_url: 'https://b.test', name: 'user:1' } });
  assert.equal(old.status, 422);
  for (const field of ['type', 'expiresOn', 'success_redirect_url', 'notify_url', 'name']) assert.match(old.body.violations.join(' '), new RegExp(field));
  assert.equal((await call('POST', '/v2/auth/link', { body: { ...body, account_id: 'acc_x' } })).status, 422, 'providers et account_id exclusifs');
});

test('intent : succès immédiat sans script, QR WhatsApp, OAuth, corps de cookie sans user_agent refusé', async () => {
  const li = await call('POST', '/v2/auth/intent', { body: { provider: 'linkedin', credentials: { username: 'direct@example.test', password: 'pw' } } });
  assert.equal(li.body.object, 'Account');
  assert.match(li.body.id, /^acc_[0-9a-z]{26}$/);
  assert.equal(li.body.provider, 'linkedin');
  assert.equal((await call('GET', `/v2/accounts/${li.body.id}`)).body.id, li.body.id, 'le compte créé existe');
  const wa = await call('POST', '/v2/auth/intent', { body: { provider: 'whatsapp', credentials: { qrcode: true } } });
  assert.equal(wa.body.object, 'AuthenticationQrCode');
  assert.match(wa.body.intent_id, /^acc_/);
  const done = await call('POST', '/v2/auth/checkpoint', { body: { code: '', intent_id: wa.body.intent_id } });
  assert.equal(done.body.object, 'Account');
  assert.equal(done.body.provider, 'whatsapp');
  const g = await call('POST', '/v2/auth/intent', { body: { provider: 'google', oauth_callback_redirect_uri: 'https://app.example.test/oauth' } });
  assert.equal(g.body.object, 'OauthUrl');
  assert.equal((await call('POST', '/v2/auth/intent', { body: { provider: 'linkedin', credentials: { access_token: 'li_at' } } })).status, 422);
  assert.equal((await call('POST', '/v2/auth/intent', { body: { provider: 'LINKEDIN', credentials: {} } })).status, 422);
});

test('intent scripté : code reçu, mauvais code refusé, renvoi en 204, puis compte', async () => {
  const user = `otp-${Math.random().toString(36).slice(2, 8)}@example.test`;
  assert.equal((await control('POST', '/__auth_script', { match: user, steps: [
    { checkpoint: 'OTP', channel: 'SMS', expect_code: '123456' },
    { checkpoint: 'CONTRACT_SELECTION', contracts: [{ id: 'c1', name: 'Recruiter' }], expect_code: 'c1' },
  ] })).status, 200);
  const start = await call('POST', '/v2/auth/intent', { body: { provider: 'linkedin', credentials: { username: user, password: 'pw' }, state: 'st' } });
  assert.equal(start.body.object, 'AuthenticationCheckpoint');
  assert.deepEqual(start.body.checkpoint, { type: 'OTP', channel: 'SMS' });
  const id = start.body.intent_id;
  assert.equal((await call('POST', '/v2/auth/checkpoint', { body: { code: '000000', intent_id: id } })).status, 400);
  const resend = await call('POST', '/v2/auth/checkpoint/resend', { body: { intent_id: id } });
  assert.equal(resend.status, 204);
  assert.equal(resend.body, null);
  const second = await call('POST', '/v2/auth/checkpoint', { body: { code: '123456', intent_id: id } });
  assert.equal(second.body.object, 'AuthenticationCheckpoint');
  assert.equal(second.body.checkpoint.type, 'CONTRACT_SELECTION');
  assert.equal(second.body.checkpoint.contracts[0].id, 'c1');
  assert.equal('expect_code' in second.body.checkpoint, false, 'le code attendu ne fuit pas');
  const last = await call('POST', '/v2/auth/checkpoint', { body: { code: 'c1', intent_id: id } });
  assert.equal(last.body.object, 'Account');
  assert.equal(last.body.id, id);
  assert.equal((await call('POST', '/v2/auth/checkpoint', { body: { code: 'x', intent_id: id } })).status, 404, 'intent terminé');
  assert.equal((await call('POST', '/v2/auth/checkpoint', { body: { code: 'x', intent_id: id, state: 'st' } })).status, 422, 'state n\'existe plus ici');
  assert.deepEqual((await violationsOf(id, 'contract_violation')).length, 1);
});

test('intent scripté : erreur puis succès, choix d\'un autre canal de vérification', async () => {
  const user = `err-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await control('POST', '/__auth_script', { match: user, steps: [
    { error: { status: 401, body: { title: 'Invalid credentials' } } },
    { checkpoint: 'CHALLENGE_SELECTION', challenges: [{ id: 'EMAIL', label: 'E-mail' }, { id: 'SMS', label: 'SMS' }], then_expect_code: '777' },
  ] });
  const intent = (password) => call('POST', '/v2/auth/intent', { body: { provider: 'linkedin', credentials: { username: user, password } } });
  const first = await intent('mauvais');
  assert.equal(first.status, 401);
  const second = await intent('bon');
  assert.equal(second.body.checkpoint.type, 'CHALLENGE_SELECTION');
  const requested = await call('POST', '/v2/auth/checkpoint/request', { body: { intent_id: second.body.intent_id, challenge: 'EMAIL' } });
  assert.deepEqual(requested.body.checkpoint, { type: 'OTP', channel: 'EMAIL' });
  const ok = await call('POST', '/v2/auth/checkpoint', { body: { code: '777', intent_id: second.body.intent_id } });
  assert.equal(ok.body.object, 'Account');
});

// ─── Webhooks ───────────────────────────────────────────────────────────────

test('__fire : enveloppe v2 complète, jeton en requête, charge par défaut, fusion, rejeu du même id', async () => {
  received = [];
  const a = acc();
  const fired = await control('POST', '/__fire', { account_id: a, type: 'message.new', payload: { text: 'Merci pour votre message', chat_id: 'CHAT-1' } });
  assert.equal(fired.status, 200);
  assert.equal(received.length, 1);
  const hit = received[0];
  assert.equal(hit.method, 'POST');
  assert.equal(new URL(hit.url, 'http://x').searchParams.get('v2_token'), WEBHOOK_TOKEN);
  assert.equal(hit.headers['content-type'], 'application/json');
  const env = hit.body;
  for (const key of ['id', 'type', 'created_at', 'hash', 'account_scope_id', 'account_id', 'account_name', 'account_provider', 'application_id', 'application_production', 'payload']) assert.ok(key in env, key);
  assert.match(env.id, /^evt_[0-9a-z]{26}$/);
  assert.equal(env.type, 'message.new');
  assert.equal(env.account_id, a);
  assert.equal(env.account_provider, 'linkedin');
  assert.match(env.application_id, /^app_/);
  assert.equal(env.payload.object, 'Message');
  assert.equal(env.payload.text, 'Merci pour votre message');
  assert.equal(env.payload.chat_id, 'CHAT-1');
  assert.equal(env.payload.is_sender, false);
  assert.equal(env.payload.sender_id, env.payload.sender.id);
  assert.deepEqual(fired.body.event, env);
  assert.equal(fired.body.deliveries[0].http_status, 200);
  // Même id : le même événement revient (rejeu), avec le même identifiant.
  await control('POST', '/__fire', { account_id: a, type: 'message.new', id: env.id });
  assert.equal(received.length, 2);
  assert.equal(received[1].body.id, env.id);
  const deliveries = (await control('GET', `/__deliveries?account_id=${a}`)).body;
  assert.equal(deliveries.length, 2);
  assert.ok(!JSON.stringify(deliveries).includes(WEBHOOK_TOKEN), 'jeton masqué dans le journal des envois');
  // Pas de jeton, adresse imposée, type hors énumération, identifiant mal formé.
  received = [];
  await control('POST', '/__fire', { account_id: a, type: 'account.status.degraded', token: null });
  assert.equal(new URL(received[0].url, 'http://x').searchParams.has('v2_token'), false);
  assert.equal(received[0].body.payload.status, 'degraded');
  assert.equal((await control('POST', '/__fire', { account_id: a, type: 'relation.request.accept' })).status, 400);
  assert.equal((await control('POST', '/__fire', { account_id: 'pas_un_compte', type: 'message.new' })).status, 400);
  assert.equal((await control('POST', '/__fire', { account_id: a, type: 'message.new', id: 'abc' })).status, 400);
  await control('POST', '/__fire', { account_id: a, type: 'account.add', payload: { state: 'signed.state' }, target_url: `${receiverUrl}?autre=1` });
  const add = received.at(-1);
  assert.equal(new URL(add.url, 'http://x').searchParams.get('autre'), '1');
  assert.equal(add.body.payload.state, 'signed.state');
  assert.equal(add.body.payload.object, 'Account');
  await control('POST', '/__fire', { account_id: a, type: 'relation.new' });
  assert.equal(received.at(-1).body.payload.object, 'UserRelation');
  await control('POST', '/__fire', { account_id: a, type: 'email.new' });
  assert.equal(Array.isArray(received.at(-1).body.payload.from), true);
});

test('endpoints de webhook : cycle de vie, énumération contrôlée, livraison, conversations et rejeu 202', async () => {
  received = [];
  const a = acc();
  const target = `${receiverUrl}?v2_token=secret-in-url`;
  assert.equal((await call('POST', '/v2/webhooks/endpoints/', { body: { url: target, trigger_events: ['message.new', 'relation.paye'] } })).status, 422, 'événement hors énumération');
  assert.equal((await call('POST', '/v2/webhooks/endpoints/', { body: { url: 'ftp://x', trigger_events: ['message.new'] } })).status, 422);
  const created = await call('POST', '/v2/webhooks/endpoints/', { body: { url: target, trigger_events: ['message.new', 'account.add'], account_ids: [a], description: 'e2e' } });
  assert.equal(created.status, 200);
  const e = created.body;
  assert.equal(e.object, 'WebhookEndpoint');
  assert.match(e.id, /^we_/);
  assert.equal(e.enabled, true);
  assert.ok(e.secret.length <= 36);
  assert.equal(e.account_targets[0].id, a);
  const list = (await call('GET', '/v2/webhooks/endpoints/')).body;
  assert.equal(list.object, 'WebhookEndpoints');
  assert.ok(list.data.some((x) => x.id === e.id));
  assert.equal((await call('GET', `/v2/webhooks/endpoints/${e.id}`)).body.url, target);
  assert.equal((await call('PATCH', `/v2/webhooks/endpoints/${e.id}`, { body: { enabled: true, inconnu: 1 } })).status, 422);

  const fired = await control('POST', '/__fire', { account_id: a, type: 'message.new', use_registered_endpoints: true });
  assert.equal(fired.body.deliveries.length, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].url.includes('secret-in-url'), true, 'l\'adresse enregistrée est livrée telle quelle');
  const other = acc();
  assert.equal((await control('POST', '/__fire', { account_id: other, type: 'message.new', use_registered_endpoints: true })).body.deliveries.length, 0, 'account_ids filtre');
  assert.equal((await control('POST', '/__fire', { account_id: a, type: 'relation.new', use_registered_endpoints: true })).body.deliveries.length, 0, 'trigger_events filtre');

  assert.equal((await call('GET', '/v2/webhooks/conversations/')).status, 422, 'endpoint_id obligatoire');
  const convs = (await call('GET', `/v2/webhooks/conversations/?endpoint_id=${e.id}`)).body;
  assert.equal(convs.object, 'WebhookConversations');
  assert.equal(convs.data.length, 1);
  assert.equal(convs.data[0].event_id, fired.body.event.id);
  assert.equal(convs.data[0].http_status, 200);
  assert.equal(convs.data[0].first_attempt, true);

  const replay = await call('POST', `/v2/webhooks/events/${fired.body.event.id}/replay`);
  assert.equal(replay.status, 202);
  assert.deepEqual(replay.body, { object: 'EventReplay', event_id: fired.body.event.id, endpoint_ids: [e.id] });
  for (let i = 0; i < 50 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(received.length, 2);
  assert.equal(received[1].body.id, fired.body.event.id, 'rejeu : identifiant d\'origine');
  const after = (await call('GET', `/v2/webhooks/conversations/?endpoint_id=${e.id}`)).body.data;
  assert.equal(after[0].first_attempt, false);
  assert.equal((await call('POST', '/v2/webhooks/events/evt_inconnu/replay')).status, 404);

  assert.equal((await call('PATCH', `/v2/webhooks/endpoints/${e.id}`, { body: { enabled: false } })).body.enabled, false);
  assert.equal((await control('POST', '/__fire', { account_id: a, type: 'message.new', use_registered_endpoints: true })).body.deliveries.length, 0, 'endpoint désactivé');
  assert.deepEqual((await call('DELETE', `/v2/webhooks/endpoints/${e.id}`)).body, { success: true });
  assert.equal((await call('GET', `/v2/webhooks/endpoints/${e.id}`)).status, 404);
});

test('DELETE /__log remet à zéro journal, modes, violations et comptes', async () => {
  const a = acc();
  await mode(a, { fail_send: 500 });
  await call('GET', `/v2/${a}/inboxes`);
  await call('GET', '/api/v1/chats', { host: 'unipile.mock', key: null });
  assert.equal((await control('DELETE', '/__log')).status, 200);
  assert.deepEqual((await control('GET', '/__log')).body, []);
  assert.deepEqual((await control('GET', '/__violations')).body, []);
  assert.deepEqual((await control('GET', '/__mode')).body, {});
  assert.equal((await call('POST', `/v2/${a}/chats/send`, { body: { text: 'x', users_ids: 'ACoAAx' } })).status, 200, 'mode effacé');
  assert.equal((await control('DELETE', '/__violations')).status, 200);
});

// ─── Helper TypeScript des specs, joué contre le faux prestataire ───────────

test('sequence-engine.ts : accesseurs, constructeurs de routes et enveloppes face au faux prestataire', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-engine-'));
  const HELPER_ENV = ['E2E_VENDOR_MOCK_URL', 'E2E_UNIPILE_V2_WEBHOOK_TOKEN', 'E2E_UNIPILE_V2_API_KEY', 'E2E_UNIPILE_HOSTED_DOMAIN', 'E2E_UNIPILE_WEBHOOK_SECRET', 'E2E_EDGE_FUNCTIONS', 'E2E_PROCESS_SEQUENCES_SECRET'];
  const saved = {};
  try {
    let source = fs.readFileSync(HELPER_FILE, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(HELPER_FILE).href));
    source = source
      .replace("from '@playwright/test'", "from './pw.mjs'")
      .replace("from './env'", "from './env.mjs'")
      .replace("from './supabase-admin'", "from './admin.mjs'");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    fs.writeFileSync(path.join(dir, 'engine.mjs'), js);
    fs.writeFileSync(path.join(dir, 'pw.mjs'), `import assert from 'node:assert/strict';
export const expect = (value, message) => ({
  toBe: (x) => assert.equal(value, x, message), toEqual: (x) => assert.deepEqual(value, x, message),
  toHaveLength: (n) => assert.equal(value.length, n, message),
});
export const request = { newContext: async () => ({}) };
`);
    fs.writeFileSync(path.join(dir, 'env.mjs'), 'export const E2E = { supabaseUrl: "http://127.0.0.1:1", anonKey: "k" };');
    fs.writeFileSync(path.join(dir, 'admin.mjs'), 'export const admin = () => ({}); export const createOrg = async () => ({}); export const seedLinkedInAccount = async () => ""; export const seedSequence = async () => ({});');
    // Environnement propre : un shell qui a chargé le fichier d'environnement de la stack ne change pas le résultat.
    for (const k of HELPER_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.E2E_VENDOR_MOCK_URL = base;
    process.env.E2E_UNIPILE_V2_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
    const h = await import(pathToFileURL(path.join(dir, 'engine.mjs')).href);

    assert.equal(h.engineAvailable, false, 'sans E2E_EDGE_FUNCTIONS=1 et le secret du cron');
    assert.equal(h.WEBHOOK_V2_TOKEN, WEBHOOK_TOKEN);
    assert.deepEqual(h.PROVIDER_ENV, { UNIPILE_V2_API_KEY: 'e2e-test-key', UNIPILE_V2_WEBHOOK_TOKEN: WEBHOOK_TOKEN });
    assert.equal(h.PROVIDER_ERRORS.rate_limited.status, 429);
    assert.equal(h.PROVIDER_ERRORS.credits_exhausted.body.detail.includes('InMail'), true);

    const a = acc();
    await h.setMockMode(a, { routes: [
      h.routes.chatLookup(['CHAT-A']),
      h.routes.messages('CHAT-A', [{ from: 'self', text: 'Bonjour' }, { from: 'candidate', text: 'Oui, volontiers' }]),
      h.routes.profile({ distance: 'THIRD_DEGREE' }),
      h.routes.inmailCredits({ classic: 0 }),
    ] });
    const key = { 'x-api-key': API_KEY, 'x-original-host': 'api.unipile.com' };
    const lookup = await (await fetch(`${base}/v2/${a}/users/ACoAAx/chat`, { headers: key })).json();
    assert.deepEqual(lookup.data, [{ chat_id: 'CHAT-A' }]);
    const msgs = await (await fetch(`${base}/v2/${a}/chats/CHAT-A/messages`, { headers: key })).json();
    assert.deepEqual(msgs.data.map((m) => [m.text, m.is_sender]), [['Oui, volontiers', false], ['Bonjour', true]], 'plus récent d\'abord');
    assert.equal(msgs.data[0].object, 'Message');
    assert.equal((await (await fetch(`${base}/v2/${a}/chats/AUTRE/messages`, { headers: key })).json()).data.length, 0, 'route limitée à sa conversation');
    assert.equal((await (await fetch(`${base}/v2/${a}/users/x`, { headers: key })).json()).specifics.network_distance, 'THIRD_DEGREE');
    assert.deepEqual((await (await fetch(`${base}/v2/${a}/linkedin/inmail-credits`, { headers: key })).json()).credits, { classic: 0 });
    // Le client encode chaque segment du chemin : l'identifiant d'une conversation à caractères encodables doit correspondre.
    assert.match(h.ENGINE_SKIP_REASON, /manque : E2E_EDGE_FUNCTIONS=1, E2E_PROCESS_SEQUENCES_SECRET\)$/);
    const odd = '19:abc@thread=1';
    await h.setMockMode(a, { routes: [h.routes.messages(odd, [{ from: 'candidate', text: 'Encodé' }])] });
    const encoded = await (await fetch(`${base}/v2/${a}/chats/${encodeURIComponent(odd)}/messages`, { headers: key })).json();
    assert.equal(encoded.data[0]?.text, 'Encodé');

    const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { ...key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await post(`/v2/${a}/chats/send`, { text: 'Premier message', users_ids: 'ACoAArecipient', specifics: { linkedin: { recruiter: { subject: 'Sujet', signature: 'Signature' } } } });
    await post(`/v2/${a}/chats/CHAT-A/messages/send`, { text: 'Relance' });
    await post(`/v2/${a}/users/me/relation-requests`, { user_id: 'ACoAArecipient', message: 'Note' });
    assert.deepEqual(await h.sentTexts(a), ['Premier message', 'Relance']);
    const [start] = await h.callsOf(a, 'startChat');
    assert.equal(h.isNewChat(start), true);
    assert.equal(h.recipientOf(start), 'ACoAArecipient');
    assert.deepEqual(h.inmailOf(start), { kind: 'recruiter', subject: 'Sujet', signature: 'Signature' });
    const [followUp] = await h.callsOf(a, 'sendMessage');
    assert.equal(h.chatIdOf(followUp), 'CHAT-A');
    assert.equal(h.inmailOf(followUp), null);
    const invites = await h.sentInvites(a);
    assert.equal(invites.length, 1);
    assert.equal(h.inviteNoteOf(invites[0]), 'Note');
    assert.equal(h.inviteTargetOf(invites[0]), 'ACoAArecipient');
    assert.equal((await h.chatPosts(a)).length, 2);
    await h.expectNoViolations(a);
    await h.expectNoV1Calls();

    await h.setMockMode(a, { routes: [h.routes.fail('startChat', 'credits_exhausted', { times: 1 })] });
    const refused = await post(`/v2/${a}/chats/send`, { text: 'x', users_ids: 'ACoAAx' });
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).detail.includes('InMail credits'), true);

    const msg = h.v2.messageNew({ accountId: a, chatId: 'CHAT-A', text: 'Réponse', isSender: false });
    assert.match(msg.id, /^evt_[0-9a-z]{26}$/);
    assert.equal(msg.type, 'message.new');
    assert.equal(msg.payload.sender_id, msg.payload.sender.id);
    assert.equal(h.v2.accountStatus(a, 'degraded').type, 'account.status.degraded');
    assert.equal(h.v2.relationNew({ accountId: a }).payload.object, 'UserRelation');
    assert.equal(h.v2.accountAdd({ accountId: a, state: 's' }).payload.state, 's');
    assert.deepEqual(h.v2.emailNew({ accountId: a, from: 'x@y.test' }).payload.from, [{ email: 'x@y.test' }]);
    // Les clés d'enveloppe sont celles du mock et de la capture réelle.
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'unipile-v2', 'webhook-events.json'), 'utf8'));
    assert.deepEqual(Object.keys(msg).sort(), [...fixture.envelope_keys].sort());
    assert.deepEqual(Object.keys(fixture.real_message_new).sort(), [...fixture.envelope_keys].sort());

    received = [];
    const fire = await h.fireWebhook({ account_id: a, type: 'account.locked' });
    assert.equal(fire.event.payload.is_locked, true);
    assert.equal(fire.deliveries[0].http_status, 200);
    await h.scriptAuth(`helper-${a}`, [{ checkpoint: 'OTP', expect_code: '1' }]);
    const intent = await post('/v2/auth/intent', { provider: 'linkedin', credentials: { username: `helper-${a}`, password: 'pw' } });
    assert.equal((await intent.json()).checkpoint.type, 'OTP');
  } finally {
    for (const k of HELPER_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fixtures : tous les presets d\'erreur portent un statut et le nom du fournisseur ; énumération de 40 événements', () => {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'unipile-v2', 'error-presets.json'), 'utf8')).presets;
  for (const [name, p] of Object.entries(presets)) {
    assert.ok(Number.isInteger(p.status) && p.status >= 400, name);
    assert.match(JSON.stringify(p.body), /Unipile|unipile/, `${name}: le nom du fournisseur est présent à dessein`);
  }
  const events = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'unipile-v2', 'webhook-events.json'), 'utf8')).trigger_events;
  assert.equal(events.length, 40);
  assert.equal(new Set(events).size, 40);
});
