// Erreurs du client partagé : classement par statut HTTP puis sondes tolérantes
// du corps, textes neutres en français, débogage non énumérable.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/errors.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  classifyError,
  describeForLog,
  type ErrorKind,
  errorKindOf,
  isUnipileError,
  probeText,
  safeErrorOf,
  UnipileError,
  userSafeMessage,
} from './errors.ts';

const ALL_KINDS: ErrorKind[] = [
  'auth', 'forbidden', 'not_found', 'rate_limited', 'validation', 'account_disconnected',
  'account_degraded', 'provider_limit', 'uncertain', 'server', 'network', 'config',
];

Deno.test('userSafeMessage : un texte français neutre par type, sans nom de prestataire ni tiret long', () => {
  const seen = new Set<string>();
  for (const kind of ALL_KINDS) {
    const message = userSafeMessage(kind);
    ok(message.length > 10, kind);
    ok(!/unipile|linkedin api|anthropic|apollo/i.test(message), `${kind}: ${message}`);
    ok(!message.includes('\u2014'), `${kind}: tiret long`);
    ok(!/\b(you|please|error)\b/i.test(message), `${kind}: pas d'anglais`);
    seen.add(message);
  }
  strictEqual(seen.size, ALL_KINDS.length, 'chaque type a son propre texte');
});

Deno.test('classifyError : le statut HTTP décide en premier', () => {
  const k = (status: number | null, body?: unknown) => classifyError(status, body).kind;
  strictEqual(k(null), 'network');
  strictEqual(k(401, { message: 'Invalid API key' }), 'auth');
  strictEqual(k(403, { message: 'nope' }), 'forbidden');
  strictEqual(k(402), 'forbidden');
  strictEqual(k(404), 'not_found');
  strictEqual(k(410), 'not_found');
  strictEqual(k(429), 'rate_limited');
  strictEqual(k(400, { message: 'bad' }), 'validation');
  strictEqual(k(422), 'validation');
  strictEqual(k(409), 'validation');
  strictEqual(k(423), 'account_degraded');
  strictEqual(k(500), 'server');
  strictEqual(k(502), 'server');
  strictEqual(k(503, 'upstream down'), 'server');
});

Deno.test('classifyError : un corps inconnu ou de forme inattendue ne change pas le statut', () => {
  for (const body of [undefined, null, 42, 'plain text', [], {}, { weird: { deep: true } }, [[[['x']]]]]) {
    strictEqual(classifyError(400, body).kind, 'validation');
    strictEqual(classifyError(500, body).kind, 'server');
  }
});

Deno.test('classifyError : compte déconnecté lu dans le corps (error, message, code, type, detail, imbriqué)', () => {
  const bodies: unknown[] = [
    { message: 'The account is disconnected, please reconnect' },
    { error: 'account_disconnected' },
    { error: { code: 'errors/disconnected_account' } },
    { detail: { message: 'Session expired for this account' } },
    { type: 'errors/login_required' },
    { errors: [{ code: 'reconnect_required' }] },
    'Account requires reauthentication',
  ];
  for (const body of bodies) {
    strictEqual(classifyError(403, body).kind, 'account_disconnected', JSON.stringify(body));
    strictEqual(classifyError(400, body).kind, 'account_disconnected', JSON.stringify(body));
    strictEqual(classifyError(500, body).kind, 'account_disconnected', JSON.stringify(body));
  }
});

Deno.test('classifyError : 401 de clé d’API reste auth, 401 de compte devient déconnexion', () => {
  strictEqual(classifyError(401, { message: 'Invalid credentials' }).kind, 'auth');
  strictEqual(classifyError(401, { message: 'Missing API key' }).kind, 'auth');
  strictEqual(classifyError(401, { message: 'Account disconnected, reconnect it' }).kind, 'account_disconnected');
  // Sans le mot « account », une 401 n’est jamais une déconnexion de compte.
  strictEqual(classifyError(401, { message: 'session expired' }).kind, 'auth');
});

Deno.test('classifyError : compte dégradé, partiel ou verrouillé', () => {
  strictEqual(classifyError(403, { message: 'Account is locked' }).kind, 'account_degraded');
  strictEqual(classifyError(400, { code: 'account_degraded' }).kind, 'account_degraded');
  strictEqual(classifyError(500, { detail: 'product recruiter errored' }).kind, 'account_degraded');
});

Deno.test('classifyError : limite du réseau (invitations, InMail, quotas) et 429 simple', () => {
  strictEqual(classifyError(429, { message: 'Rate limit exceeded' }).kind, 'rate_limited');
  strictEqual(classifyError(429, { message: 'Too many requests' }).kind, 'rate_limited');
  strictEqual(classifyError(429, { message: 'Weekly invitation limit reached' }).kind, 'provider_limit');
  strictEqual(classifyError(403, { code: 'errors/inmail_credits_exhausted', message: 'Out of InMail credits' }).kind, 'provider_limit');
  strictEqual(classifyError(422, { message: 'Daily limit exceeded' }).kind, 'provider_limit');
  strictEqual(classifyError(400, { error: 'quota_exceeded' }).kind, 'provider_limit');
  // « rate limit exceeded » seul n’est pas une limite du réseau, même hors 429.
  strictEqual(classifyError(400, { message: 'rate limit exceeded' }).kind, 'validation');
});

Deno.test('classifyError : extrait un code machine court du corps', () => {
  strictEqual(classifyError(400, { code: 'errors/invalid_account' }).code, 'errors/invalid_account');
  strictEqual(classifyError(400, { error: { code: 'X_Y' } }).code, 'x_y');
  strictEqual(classifyError(400, { detail: { type: 'bad.thing' } }).code, 'bad.thing');
  strictEqual(classifyError(400, { message: 'A long sentence is not a code' }).code, null);
  strictEqual(classifyError(500, 'text').code, null);
});

Deno.test('probeText : borne la profondeur et le nombre de chaînes', () => {
  const deep = { error: { error: { error: { error: { message: 'too deep' } } } } };
  ok(!probeText(deep).includes('too deep'));
  const many = { errors: Array.from({ length: 100 }, (_, i) => ({ message: `m${i}` })) };
  ok(probeText(many).split(' | ').length <= 20);
  strictEqual(probeText('Hello'), 'hello');
});

Deno.test('UnipileError : message neutre, débogage non énumérable, JSON sûr', () => {
  const error = new UnipileError('provider_limit', {
    status: 429,
    code: 'x',
    retryAfterMs: 3000,
    debug: { body: { message: 'Unipile says: LinkedIn weekly limit' }, path: '/acc_1/users/invite', method: 'POST' },
  });
  strictEqual(error.message, userSafeMessage('provider_limit'));
  strictEqual(error.userMessage, error.message);
  strictEqual(error.status, 429);
  strictEqual(error.retryAfterMs, 3000);
  ok(!/unipile/i.test(error.message));
  // Non énumérable : absent de JSON, des spreads et des clés.
  ok(!Object.keys(error).includes('debug'));
  ok(!JSON.stringify(error).includes('weekly'));
  ok(!JSON.stringify({ ...error }).includes('weekly'));
  deepStrictEqual(error.toJSON(), { kind: 'provider_limit', message: error.message, status: 429 });
  // Mais lisible côté serveur.
  deepStrictEqual(error.debug.body, { message: 'Unipile says: LinkedIn weekly limit' });
  strictEqual(error.debug.path, '/acc_1/users/invite');
  ok(error instanceof Error);
  ok(isUnipileError(error));
  ok(!isUnipileError(new Error('x')));
});

Deno.test('UnipileError : la cause est conservée mais jamais dans le message', () => {
  const cause = new TypeError('error sending request for url (https://api.unipile.com/v2/x)');
  const error = new UnipileError('network', { cause });
  strictEqual(error.cause, cause);
  ok(!/unipile/i.test(error.message));
});

Deno.test('errorKindOf et safeErrorOf : une exception étrangère devient un échec serveur neutre', () => {
  strictEqual(errorKindOf(new UnipileError('auth')), 'auth');
  strictEqual(errorKindOf(new Error('boom')), 'server');
  strictEqual(errorKindOf('x'), 'server');
  const safe = safeErrorOf(new Error('Unipile secret detail'));
  deepStrictEqual(safe, { kind: 'server', message: userSafeMessage('server') });
  deepStrictEqual(safeErrorOf(new UnipileError('forbidden')), { kind: 'forbidden', message: userSafeMessage('forbidden') });
});

Deno.test('describeForLog : ligne de journal complète, corps tronqué, jamais de clé', () => {
  const error = new UnipileError('server', {
    status: 502,
    code: 'bad_gateway',
    debug: { method: 'GET', path: '/acc_1/chats', requestId: 'req-9', attempts: 3, body: 'x'.repeat(2000) },
  });
  const line = describeForLog(error);
  ok(line.startsWith('[unipile] kind=server status=502'));
  ok(line.includes('code=bad_gateway'));
  ok(line.includes('GET /acc_1/chats'));
  ok(line.includes('request_id=req-9'));
  ok(line.includes('attempts=3'));
  ok(line.length < 700);
  ok(line.endsWith('...'));
  strictEqual(describeForLog(new Error('plain')), 'Error: plain');
  strictEqual(describeForLog('str'), 'str');
});

Deno.test('classifyError : un refus sur le destinataire (« not connected ») n’est jamais une déconnexion du compte', () => {
  const k = (status: number, body: unknown) => classifyError(status, body).kind;
  strictEqual(k(400, { message: 'You are not connected to this user' }), 'validation');
  strictEqual(k(422, { error: 'recipient not connected with sender; cannot send message' }), 'validation');
  strictEqual(k(422, { message: 'Recipient is not connected to you' }), 'validation');
  strictEqual(k(403, { message: 'You are not connected with this user; use InMail' }), 'forbidden');
  // Quand le texte nomme le compte ou la session, c’est bien une déconnexion.
  strictEqual(k(400, { message: 'The account is not connected anymore' }), 'account_disconnected');
  strictEqual(k(403, { message: 'Session not connected' }), 'account_disconnected');
});

Deno.test('classifyError : un refus de taille (note, message) n’est pas une limite du réseau', () => {
  const k = (status: number, body: unknown) => classifyError(status, body).kind;
  strictEqual(k(400, { message: 'Note exceeds the character limit exceeded' }), 'validation');
  strictEqual(k(400, { type: 'errors/invalid_parameters', detail: 'Message length limit exceeded (max 8000)' }), 'validation');
  // Un débit général de l’API reste un 429 simple, pas un quota du jour.
  strictEqual(k(429, { message: 'Too many messages per second' }), 'rate_limited');
  // Les vraies limites gardent leur type.
  strictEqual(k(429, { message: 'Weekly invitation limit reached' }), 'provider_limit');
  strictEqual(k(422, { message: 'Invitation limit exceeded' }), 'provider_limit');
  strictEqual(k(403, { message: 'Weekly invitation limit has been reached' }), 'provider_limit');
});

Deno.test('UnipileError : String(error) ne porte pas le nom du prestataire', () => {
  ok(!/unipile/i.test(String(new UnipileError('uncertain'))));
  ok(!/unipile/i.test(`${new UnipileError('server')}`));
  ok(!/unipile/i.test(userSafeMessage('uncertain')));
  // Le texte d’une issue incertaine vaut pour toute action, pas seulement un envoi.
  ok(!/envoi|messagerie/i.test(userSafeMessage('uncertain')));
});

// Réponses d'erreur réelles du service (essais de contrat du 12 octobre 2026, application Development).
Deno.test('classifyError : les erreurs réelles du service sont classées par statut', async () => {
  const raw = await Deno.readTextFile(new URL('../../../../tests/fixtures/unipile-v2/real-errors.json', import.meta.url));
  const { captures } = JSON.parse(raw) as {
    captures: { name: string; status: number; x_request_id: string | null; body: { type: string; req_id?: string } }[];
  };
  const expected = (status: number): ErrorKind =>
    status === 401 ? 'auth' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'validation';
  ok(captures.length >= 14);
  for (const capture of captures) {
    const result = classifyError(capture.status, capture.body);
    strictEqual(result.kind, expected(capture.status), capture.name);
    strictEqual(result.code, capture.body.type.toLowerCase(), `${capture.name}: code`);
    if (capture.x_request_id !== null) strictEqual(capture.body.req_id, capture.x_request_id, `${capture.name}: req_id`);
    const message = userSafeMessage(result.kind);
    ok(!/unipile|api key|clé d.api/i.test(message), `${capture.name}: ${message}`);
  }
});
