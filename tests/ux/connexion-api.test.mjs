/**
 * Connexion des comptes : appels de l'action serveur et suivi d'une tentative
 * (src/components/connections/connectionApi.ts, sans React ni réseau).
 *
 * Lancer : node --test tests/ux/connexion-api.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const api = await loadTs('src/components/connections/connectionApi.ts');
const { createConnectionApi, parseNext, failureCode, pollAttempt, pollDelay, goToProvider, isHttpsUrl, NO_CAPABILITIES } = api;

/** Appelant simulé : garde les appels, répond selon l'action. */
function fakeInvoke(answers) {
  const calls = [];
  const invoke = async (fn, body) => {
    calls.push({ fn, body });
    const answer = answers[body.action];
    const value = typeof answer === 'function' ? answer(body, calls.length) : answer;
    return value ?? { data: { success: true }, error: null };
  };
  return { invoke, calls };
}
const ok = (data) => ({ data: { success: true, ...data }, error: null });
const refused = (code, error, status) => ({
  data: { success: false, error, ...(code ? { error_code: code } : {}) },
  error: Object.assign(new Error(error ?? 'x'), status ? { status } : {}),
});

// ------------------------------------------------------------------- parseNext
test('parseNext : les cinq formes du contrat', () => {
  assert.deepEqual(parseNext({ kind: 'redirect', url: 'https://connect.exemple.fr/x' }), { kind: 'redirect', url: 'https://connect.exemple.fr/x' });
  assert.deepEqual(parseNext({ kind: 'qrcode', qrcode: 'abc' }), { kind: 'qrcode', qrcode: 'abc' });
  assert.deepEqual(parseNext({ kind: 'pending' }), { kind: 'pending' });
  assert.deepEqual(
    parseNext({ kind: 'done', account: { id: 'acc_1', provider: 'linkedin', name: 'Léa', status: 'OK' } }),
    { kind: 'done', account: { id: 'acc_1', provider: 'linkedin', name: 'Léa', status: 'OK' } },
  );
  const cp = parseNext({
    kind: 'checkpoint', type: 'otp', channel: 'SMS', platform: 'APP', code: '1234',
    challenges: [{ id: 'EMAIL', label: 'Par e-mail', description: 'Un code' }, { label: 'sans id' }],
    contracts: [{ id: 'c1', name: 'Recruiter Corporate' }],
    products: [{ id: 'classic', display_name: 'Classic' }],
    captcha: { public_key: 'pk', data: null },
  });
  assert.equal(cp.type, 'OTP', 'le type est en majuscules');
  assert.equal(cp.channel, 'SMS');
  assert.deepEqual(cp.challenges, [{ id: 'EMAIL', label: 'Par e-mail', description: 'Un code' }]);
  assert.deepEqual(cp.contracts, [{ id: 'c1', name: 'Recruiter Corporate' }]);
  assert.deepEqual(cp.captcha, { public_key: 'pk', data: null });
});

test('parseNext : forme inconnue, adresse non https ou champ manquant : null', () => {
  for (const raw of [null, undefined, {}, { kind: 'nope' }, { kind: 'redirect', url: 'http://x.fr' }, { kind: 'redirect', url: 'javascript:alert(1)' },
    { kind: 'redirect', url: 'https://user:pw@x.fr' }, { kind: 'qrcode' }, { kind: 'done', account: {} }, { kind: 'checkpoint' }]) {
    assert.equal(parseNext(raw), null, JSON.stringify(raw));
  }
});

test('isHttpsUrl et goToProvider : même onglet, https seulement', () => {
  assert.equal(isHttpsUrl('https://a.fr/b?c=1'), true);
  assert.equal(isHttpsUrl('http://a.fr'), false);
  assert.equal(isHttpsUrl('//a.fr'), false);
  const seen = [];
  assert.equal(goToProvider('https://a.fr/x', (u) => seen.push(u)), true);
  assert.deepEqual(seen, ['https://a.fr/x']);
  assert.equal(goToProvider('http://a.fr/x', (u) => seen.push(u)), false);
  assert.equal(seen.length, 1, 'aucune navigation vers une adresse non https');
});

// ----------------------------------------------------------------- failureCode
test('failureCode : le code du corps, sinon celui de l\'erreur, sinon le statut HTTP, sinon réseau perdu', () => {
  assert.equal(failureCode(refused('attempt_expired', 'x', 200)), 'attempt_expired');
  assert.equal(failureCode({ data: { success: false }, error: Object.assign(new Error('x'), { code: 'QUOTA' }) }), 'QUOTA');
  assert.equal(failureCode(refused(undefined, 'x', 403)), 'forbidden');
  assert.equal(failureCode(refused(undefined, 'x', 404)), 'not_found');
  assert.equal(failureCode(refused(undefined, 'x', 429)), 'rate_limited');
  assert.equal(failureCode(refused(undefined, 'x', 502)), 'server');
  assert.equal(failureCode(refused(undefined, 'x', 400)), 'unknown');
  assert.equal(failureCode(refused(undefined, 'Failed to fetch')), 'network_lost');
});

// --------------------------------------------------------------- Les 6 actions
test('connection_capabilities : lecture, valeurs sûres si un champ manque', async () => {
  const { invoke, calls } = fakeInvoke({
    connection_capabilities: ok({
      hosted: { available: true, white_label: true },
      native: { linkedin: true, whatsapp: false },
      products: { recruiter_exclusive_with_sales_navigator: true },
    }),
  });
  const r = await createConnectionApi(invoke, 'org-1').capabilities();
  assert.equal(r.ok, true);
  assert.deepEqual(r.capabilities.hosted, { available: true, whiteLabel: true });
  assert.deepEqual(r.capabilities.native, { linkedin: true, whatsapp: false, imap: false, oauth: false });
  assert.deepEqual(calls[0], { fn: 'unipile-accounts', body: { action: 'connection_capabilities', organization_id: 'org-1' } });
  assert.deepEqual(NO_CAPABILITIES.native, { linkedin: false, whatsapp: false, imap: false, oauth: false }, 'sans réponse : connexion standard seulement');
});

test('connection_capabilities : un échec rend un message, pas une exception', async () => {
  const { invoke } = fakeInvoke({ connection_capabilities: refused('server', 'Erreur', 502) });
  const r = await createConnectionApi(invoke).capabilities();
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'server');
  assert.match(r.message, /ne répond pas pour le moment/);
});

test('connection_start : corps transmis tel quel, réponse normalisée', async () => {
  const { invoke, calls } = fakeInvoke({
    connection_start: ok({ attempt_id: 'att-1', mode: 'hosted', next: { kind: 'redirect', url: 'https://connect.exemple.fr/l' } }),
  });
  const r = await createConnectionApi(invoke, 'org-1').start({ provider: 'linkedin', reconnect_account_id: 'acc_9' });
  assert.equal(r.ok, true);
  assert.equal(r.attemptId, 'att-1');
  assert.equal(r.mode, 'hosted');
  assert.deepEqual(r.next, { kind: 'redirect', url: 'https://connect.exemple.fr/l' });
  assert.equal(calls[0].body.action, 'connection_start');
  assert.equal(calls[0].body.reconnect_account_id, 'acc_9');
  assert.equal('redirect_uri' in calls[0].body, false, 'le navigateur ne donne jamais d\'adresse de retour');
});

test('connection_start : réponse sans étape ou sans tentative : échec général, pas de crash', async () => {
  for (const data of [{ attempt_id: 'a' }, { next: { kind: 'pending' } }, { attempt_id: 'a', next: { kind: 'zzz' } }]) {
    const { invoke } = fakeInvoke({ connection_start: ok(data) });
    const r = await createConnectionApi(invoke).start({ provider: 'whatsapp' });
    assert.equal(r.ok, false);
    assert.match(r.message, /La connexion n'a pas abouti/);
  }
});

test('connection_start : messages d\'échec en français, sans texte de prestataire', async () => {
  const cases = [
    ['feature_disabled', /connexion standard/],
    ['already_linked_org', /autre espace de travail/],
    ['already_linked_member', /autre membre de votre organisation/],
    ['wrong_account', /pas celui que Konekt avait relié/],
    ['rate_limited', /Trop de tentatives/],
    ['validation', /Vérifiez vos informations/],
  ];
  for (const [code, re] of cases) {
    const { invoke } = fakeInvoke({ connection_start: refused(code, 'texte du serveur', 200) });
    const r = await createConnectionApi(invoke).start({ provider: 'linkedin' });
    assert.equal(r.ok, false, code);
    assert.equal(r.errorCode, code);
    assert.match(r.message, re, code);
    assert.doesNotMatch(r.message, /texte du serveur/);
  }
});

test('un texte de serveur inconnu est montré seulement s\'il est montrable (sans prestataire)', async () => {
  const montrable = fakeInvoke({ connection_start: refused('code_nouveau', 'Votre organisation a atteint son plafond.', 200) });
  const r1 = await createConnectionApi(montrable.invoke).start({ provider: 'linkedin' });
  assert.equal(r1.message, 'Votre organisation a atteint son plafond.');
  const vendor = fakeInvoke({ connection_start: refused('code_nouveau', ['Uni', 'pile'].join('') + ' a refusé la requête.', 200) });
  const r2 = await createConnectionApi(vendor.invoke).start({ provider: 'linkedin' });
  assert.match(r2.message, /La connexion n'a pas abouti/);
});

test('connection_checkpoint : code, choix, étape d\'attente ; code invalide en phase de vérification', async () => {
  const { invoke, calls } = fakeInvoke({
    connection_checkpoint: (body) => body.code === '000000' ? refused('validation', 'x', 200) : ok({ next: { kind: 'pending' } }),
  });
  const c = createConnectionApi(invoke);
  const good = await c.checkpoint({ attemptId: 'a1', code: '123456' });
  assert.deepEqual(good, { ok: true, next: { kind: 'pending' } });
  const bad = await c.checkpoint({ attemptId: 'a1', code: '000000' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Ce code n'est pas valide/);
  await c.checkpoint({ attemptId: 'a1', challenge: 'SMS' });
  await c.checkpoint({ attemptId: 'a1', waitingStep: 'IN_APP_VALIDATION' });
  assert.equal(calls[0].body.code, '123456');
  assert.equal(calls[2].body.challenge, 'SMS');
  assert.equal('code' in calls[2].body, false);
  assert.equal(calls[3].body.waiting_step, 'IN_APP_VALIDATION');
  assert.equal('code' in calls[3].body, false, 'jamais de code vide pour une étape qui n\'en attend pas');
});

test('connection_resend : réponse vide acceptée (le serveur répond sans corps)', async () => {
  const { invoke } = fakeInvoke({ connection_resend: ok({}) });
  const r = await createConnectionApi(invoke).resend({ attemptId: 'a1' });
  assert.deepEqual(r, { ok: true, next: null });
  const sw = fakeInvoke({ connection_resend: ok({ next: { kind: 'checkpoint', type: 'OTP', channel: 'EMAIL' } }) });
  const r2 = await createConnectionApi(sw.invoke).resend({ attemptId: 'a1', challenge: 'EMAIL' });
  assert.equal(r2.next.type, 'OTP');
  assert.equal(sw.calls[0].body.challenge, 'EMAIL');
});

test('connection_status : état de la tentative, message d\'échec d\'après le code', async () => {
  const { invoke } = fakeInvoke({
    connection_status: (body) => ({
      pending: ok({ status: 'pending', provider: 'linkedin', mode: 'hosted', return_to: 'onboarding' }),
      pendingOther: ok({ status: 'pending', provider: 'linkedin', mode: 'hosted', return_to: 'https://evil.example/' }),
      completed: ok({ status: 'completed', provider: 'google', mode: 'hosted', account: { id: 'acc_2', name: 'a@b.fr', status: 'OK' } }),
      failed: ok({ status: 'failed', provider: 'whatsapp', mode: 'native', error_code: 'claim_cross_tenant', error: 'texte' }),
      expired: ok({ status: 'expired', provider: 'linkedin', mode: 'hosted', error_code: 'attempt_expired' }),
      bizarre: ok({ status: 'inconnu' }),
      absent: refused('attempt_not_found', 'x', 200),
    }[body.attempt_id]),
  });
  const c = createConnectionApi(invoke);
  const pending = await c.status('pending');
  assert.equal(pending.view.status, 'pending');
  assert.equal(pending.view.account, null);
  assert.equal(pending.view.returnTo, 'onboarding', 'F6 : la destination vient du serveur');
  assert.equal((await c.status('pendingOther')).view.returnTo, null, 'liste fermée : toute autre valeur est ignorée');
  assert.equal((await c.status('completed')).view.returnTo, null);
  const done = await c.status('completed');
  assert.deepEqual(done.view.account, { id: 'acc_2', name: 'a@b.fr', status: 'OK' });
  assert.equal(done.view.provider, 'google');
  const failed = await c.status('failed');
  assert.equal(failed.view.errorCode, 'claim_cross_tenant');
  assert.match(failed.view.errorMessage, /Ce compte WhatsApp est déjà rattaché à un autre espace de travail/);
  const expired = await c.status('expired');
  assert.match(expired.view.errorMessage, /expiré/);
  assert.equal((await c.status('bizarre')).ok, false);
  const gone = await c.status('absent');
  assert.equal(gone.ok, false);
  assert.equal(gone.errorCode, 'attempt_not_found');
});

test('connection_cancel : appel simple', async () => {
  const { invoke, calls } = fakeInvoke({ connection_cancel: ok({}) });
  assert.deepEqual(await createConnectionApi(invoke).cancel('a1'), { ok: true });
  assert.equal(calls[0].body.attempt_id, 'a1');
});

test('aucune action n\'est appelée sous un autre nom que celui du contrat', async () => {
  const { invoke, calls } = fakeInvoke({});
  const c = createConnectionApi(invoke);
  await c.capabilities(); await c.start({ provider: 'linkedin' }); await c.checkpoint({ attemptId: 'a', code: '1' });
  await c.resend({ attemptId: 'a' }); await c.status('a'); await c.cancel('a');
  assert.deepEqual(calls.map((x) => x.body.action), [
    'connection_capabilities', 'connection_start', 'connection_checkpoint', 'connection_resend', 'connection_status', 'connection_cancel',
  ]);
  assert.ok(calls.every((x) => x.fn === 'unipile-accounts'));
});

// ------------------------------------------------------------------- pollAttempt
const view = (status) => ({ ok: true, view: { status, provider: 'linkedin', mode: 'hosted', account: null, next: null, errorCode: null, errorMessage: null } });
const noSleep = async () => {};

test('pollDelay : 2 s au début, puis 4 s', () => {
  assert.equal(pollDelay(0), 2000);
  assert.equal(pollDelay(9), 2000);
  assert.equal(pollDelay(10), 4000);
});

test('suivi : s\'arrête dès que la tentative n\'est plus en cours, et rapporte chaque lecture', async () => {
  const seq = ['pending', 'pending', 'completed'];
  const updates = [];
  const waits = [];
  const result = await pollAttempt({
    status: async () => view(seq.shift()),
    attemptId: 'a1', sleep: async (ms) => { waits.push(ms); }, onUpdate: (v) => updates.push(v.status),
  });
  assert.equal(result.kind, 'settled');
  assert.equal(result.view.status, 'completed');
  assert.deepEqual(updates, ['pending', 'pending', 'completed']);
  assert.deepEqual(waits, [2000, 2000]);
});

test('suivi : délai écoulé tant que la tentative est en cours', async () => {
  let t = 0;
  const result = await pollAttempt({
    status: async () => view('pending'), attemptId: 'a1', timeoutMs: 10_000,
    sleep: async (ms) => { t += ms; }, now: () => t,
  });
  assert.equal(result.kind, 'timeout');
  assert.equal(result.view.status, 'pending');
  assert.ok(t <= 10_000);
});

test('suivi : arrêt par signal, sans autre lecture', async () => {
  const controller = new AbortController();
  let reads = 0;
  const result = await pollAttempt({
    status: async () => { reads += 1; controller.abort(); return view('pending'); },
    attemptId: 'a1', signal: controller.signal, sleep: noSleep,
  });
  assert.equal(result.kind, 'aborted');
  assert.equal(reads, 1);
  const already = new AbortController(); already.abort();
  const none = await pollAttempt({ status: async () => { throw new Error('ne doit pas être appelé'); }, attemptId: 'a1', signal: already.signal, sleep: noSleep });
  assert.equal(none.kind, 'aborted');
});

test('suivi : une lecture ratée est retentée, trois de suite abandonnent', async () => {
  const fail = { ok: false, errorCode: 'network_lost', message: 'Connexion interrompue. Réessayez.' };
  const seq = [fail, fail, view('completed')];
  const recovered = await pollAttempt({ status: async () => seq.shift(), attemptId: 'a1', sleep: noSleep });
  assert.equal(recovered.kind, 'settled');
  let calls = 0;
  const lost = await pollAttempt({ status: async () => { calls += 1; return fail; }, attemptId: 'a1', sleep: noSleep });
  assert.equal(lost.kind, 'error');
  assert.equal(lost.failure.errorCode, 'network_lost');
  assert.equal(calls, 3);
});

test('suivi : tentative introuvable ou refusée, aucune nouvelle lecture', async () => {
  let calls = 0;
  const r = await pollAttempt({ status: async () => { calls += 1; return { ok: false, errorCode: 'attempt_not_found', message: 'x' }; }, attemptId: 'a1', sleep: noSleep });
  assert.equal(r.kind, 'error');
  assert.equal(calls, 1);
});

// ---------------------------------------------------------- Règles de source
test('le module n\'écrit rien dans la console et ne garde aucun identifiant', () => {
  const src = stripComments(read('src/components/connections/connectionApi.ts'));
  assert.doesNotMatch(src, /console\./);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(src, /window\.open/);
  const hook = stripComments(read('src/hooks/useConnection.ts'));
  assert.doesNotMatch(hook, /console\./);
  assert.doesNotMatch(hook, /window\.open/);
});
