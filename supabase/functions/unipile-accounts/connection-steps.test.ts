// Pure rules of the connection actions: next-step mapping, start request validation,
// redirect and hosted link rules, error wording.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-accounts/connection-steps.test.ts

import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import type { AuthStep } from '../_shared/unipile/index.ts';
import {
  buildRedirectUri,
  connectionErrorMessage,
  displayAccountName,
  hostedLinkAllowed,
  httpStatusForKind,
  intentIdOf,
  isExpectedHostedLink,
  nextFromAuthStep,
  normalizeCountry,
  normalizeTimezone,
  pairingPhoneNumber,
  parseStartRequest,
  parseWaitingStep,
  scrubVendor,
  userAgentLooksValid,
} from './connection-steps.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function checkpoint(c: Record<string, unknown>): AuthStep {
  return { kind: 'checkpoint', intentId: 'acc_intent1', checkpoint: c as never };
}

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

Deno.test('nextFromAuthStep : un compte rendu par le service est « done » au vocabulaire Konekt', () => {
  const next = nextFromAuthStep({
    kind: 'account',
    account: { id: 'acc_1', provider: 'linkedin', name: 'Claire Martin', status: 'running', is_locked: false } as never,
  });
  deepStrictEqual(next, { kind: 'done', account: { id: 'acc_1', provider: 'linkedin', name: 'Claire Martin', status: 'OK' } });
  const locked = nextFromAuthStep({
    kind: 'account',
    account: { id: 'acc_1', provider: 'linkedin', name: 'user:abc|org:def', status: 'running', is_locked: true } as never,
  });
  strictEqual(locked.kind === 'done' && locked.account.status, 'LOCKED');
  strictEqual(locked.kind === 'done' && locked.account.name, 'Compte LinkedIn', 'jamais le nom qui porte l etat');
});

Deno.test('nextFromAuthStep : QR code, lien OAuth (https seulement) et attente', () => {
  deepStrictEqual(nextFromAuthStep({ kind: 'qrcode', intentId: 'acc_i', qrcode: '2@abc' }), { kind: 'qrcode', qrcode: '2@abc' });
  deepStrictEqual(nextFromAuthStep({ kind: 'oauth_url', url: 'https://accounts.example.com/o/oauth2?x=1' }), {
    kind: 'redirect',
    url: 'https://accounts.example.com/o/oauth2?x=1',
  });
  for (const url of ['http://accounts.example.com/', 'javascript:alert(1)', 'https://user:pw@accounts.example.com/', 'pas une adresse']) {
    throws(() => nextFromAuthStep({ kind: 'oauth_url', url }), TypeError, url);
  }
  deepStrictEqual(nextFromAuthStep(checkpoint({ type: 'LOADING' })), { kind: 'pending' });
});

Deno.test('nextFromAuthStep : les 11 types de vérification passent tels quels, avec leurs seuls champs', () => {
  const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
    [{ type: 'OTP', channel: 'EMAIL' }, { kind: 'checkpoint', type: 'OTP', channel: 'EMAIL' }],
    [{ type: 'OTP' }, { kind: 'checkpoint', type: 'OTP' }],
    [{ type: 'IN_APP_VALIDATION' }, { kind: 'checkpoint', type: 'IN_APP_VALIDATION' }],
    [{ type: 'PAIRING_CODE', code: 'ABCD-1234' }, { kind: 'checkpoint', type: 'PAIRING_CODE', code: 'ABCD-1234' }],
    [{ type: 'PHONE_REGISTER' }, { kind: 'checkpoint', type: 'PHONE_REGISTER' }],
    [{ type: '2FA', platform: 'APP' }, { kind: 'checkpoint', type: '2FA', platform: 'APP' }],
    [
      { type: 'CAPTCHA', public_key: 'pk', data: 'blob' },
      { kind: 'checkpoint', type: 'CAPTCHA', captcha: { public_key: 'pk', data: 'blob' } },
    ],
    [{ type: 'OTP_OR_IN_APP_VALIDATION', channel: 'SMS' }, { kind: 'checkpoint', type: 'OTP_OR_IN_APP_VALIDATION', channel: 'SMS' }],
    [
      { type: 'CONTRACT_SELECTION', contracts: [{ id: 'c1', name: 'Contrat A' }] },
      { kind: 'checkpoint', type: 'CONTRACT_SELECTION', contracts: [{ id: 'c1', name: 'Contrat A' }] },
    ],
    [
      { type: 'CONSENT_SCREEN', products: [{ id: 'recruiter', display_name: 'Recruiter' }] },
      { kind: 'checkpoint', type: 'CONSENT_SCREEN', products: [{ id: 'recruiter', display_name: 'Recruiter' }] },
    ],
    [
      { type: 'CHALLENGE_SELECTION', challenges: [{ id: 'EMAIL', label: 'Par e-mail', description: 'Un code' }, { id: 'SMS', label: 'Par SMS' }] },
      {
        kind: 'checkpoint',
        type: 'CHALLENGE_SELECTION',
        challenges: [{ id: 'EMAIL', label: 'Par e-mail', description: 'Un code' }, { id: 'SMS', label: 'Par SMS' }],
      },
    ],
  ];
  for (const [raw, expected] of cases) deepStrictEqual(nextFromAuthStep(checkpoint(raw)), expected, String(raw.type));
  // Un type inconnu n'est pas deviné : il passe verbatim, l'écran retombe sur la connexion standard.
  deepStrictEqual(nextFromAuthStep(checkpoint({ type: 'NOUVEAU_TYPE' })), { kind: 'checkpoint', type: 'NOUVEAU_TYPE' });
});

Deno.test('nextFromAuthStep : le nom du prestataire est retiré des libellés montrés', () => {
  const next = nextFromAuthStep(checkpoint({
    type: 'CHALLENGE_SELECTION',
    challenges: [{ id: 'EMAIL', label: 'Unipile envoie un code', description: 'via UNIPILE' }],
    })) as { challenges: Array<{ label: string; description?: string }> };
  ok(!/unipile/i.test(JSON.stringify(next)));
  strictEqual(scrubVendor('Code Unipile  reçu'), 'Code reçu');
});

Deno.test('intentIdOf, parseWaitingStep, displayAccountName', () => {
  strictEqual(intentIdOf(checkpoint({ type: 'OTP' })), 'acc_intent1');
  strictEqual(intentIdOf({ kind: 'qrcode', intentId: 'acc_q', qrcode: 'x' }), 'acc_q');
  strictEqual(intentIdOf({ kind: 'oauth_url', url: 'https://a.example' }), null);
  strictEqual(parseWaitingStep('QR_CODE'), 'QR_CODE');
  strictEqual(parseWaitingStep('IN_APP_VALIDATION'), 'IN_APP_VALIDATION');
  strictEqual(parseWaitingStep('OTP'), null);
  strictEqual(parseWaitingStep(undefined), null);
  strictEqual(displayAccountName(undefined, 'whatsapp'), 'Compte WhatsApp');
  strictEqual(displayAccountName('Claire', 'linkedin'), 'Claire');
});

// ---------------------------------------------------------------------------
// Redirect and hosted link
// ---------------------------------------------------------------------------

Deno.test('buildRedirectUri : toujours la page de retour, construite par le serveur', () => {
  strictEqual(buildRedirectUri('https://konekt-app-navy.vercel.app'), 'https://konekt-app-navy.vercel.app/settings/account/connections/retour');
  strictEqual(buildRedirectUri('https://app.konekt.fr/une/page?x=1'), 'https://app.konekt.fr/settings/account/connections/retour');
  strictEqual(buildRedirectUri('http://localhost:5173'), 'http://localhost:5173/settings/account/connections/retour');
  // Un secret absent, http hors local ou avec identifiants : retour à l'origine de production.
  for (const bad of [undefined, null, '', 'pas une adresse', 'http://evil.example', 'https://u:p@evil.example']) {
    strictEqual(buildRedirectUri(bad as never), 'https://konekt-app-navy.vercel.app/settings/account/connections/retour', String(bad));
  }
});

Deno.test('isExpectedHostedLink : https sans identifiants, et le domaine configuré quand il y en a un', () => {
  ok(isExpectedHostedLink('https://connect.konekt.fr/abc', 'connect.konekt.fr'));
  ok(isExpectedHostedLink('https://CONNECT.konekt.fr/abc', 'connect.konekt.fr'));
  ok(!isExpectedHostedLink('https://auth.provider.example/abc', 'connect.konekt.fr'));
  ok(!isExpectedHostedLink('https://connect.konekt.fr.evil.example/abc', 'connect.konekt.fr'));
  ok(isExpectedHostedLink('https://auth.provider.example/abc', null));
  ok(!isExpectedHostedLink('http://connect.konekt.fr/abc', 'connect.konekt.fr'));
  ok(!isExpectedHostedLink('https://u:p@connect.konekt.fr/abc', 'connect.konekt.fr'));
  ok(!isExpectedHostedLink(undefined, null));
});

// ---------------------------------------------------------------------------
// Start request
// ---------------------------------------------------------------------------

Deno.test('hostedLinkAllowed : un domaine propre, ou le drapeau explicite des tests, jamais l hôte du prestataire par défaut', () => {
  ok(hostedLinkAllowed('connect.konekt.fr', undefined));
  ok(hostedLinkAllowed(null, '1'));
  ok(!hostedLinkAllowed(null, undefined));
  ok(!hostedLinkAllowed(null, null));
  ok(!hostedLinkAllowed(null, '0'));
  ok(!hostedLinkAllowed(null, 'true'));
});

Deno.test('parseStartRequest : la page de retour est un nom d une liste fermée', () => {
  const base = { provider: 'linkedin' };
  const parsed = (extra: Record<string, unknown>) => {
    const out = parseStartRequest({ ...base, ...extra });
    return out.ok ? out.value.returnTo : 'invalide';
  };
  strictEqual(parsed({ return_to: 'onboarding' }), 'onboarding');
  strictEqual(parsed({}), null);
  for (const bad of ['https://evil.example/', '/onboarding', 'settings', '', 42, { a: 1 }, ['onboarding']]) strictEqual(parsed({ return_to: bad }), null, JSON.stringify(bad));
});

Deno.test('parseStartRequest : fournisseur et mode', () => {
  for (const bad of [{}, { provider: 'telegram' }, { provider: 42 }, { provider: null }]) {
    const out = parseStartRequest(bad);
    ok(!out.ok, JSON.stringify(bad));
  }
  const hosted = parseStartRequest({ provider: 'linkedin' });
  ok(hosted.ok && hosted.value.mode === 'hosted' && hosted.value.provider === 'linkedin');
  ok(!parseStartRequest({ provider: 'linkedin', mode: 'inconnu' }).ok);
  const email = parseStartRequest({ provider: 'google', mode: 'native' });
  ok(email.ok && email.value.mode === 'native');
});

Deno.test('parseStartRequest : en mode hébergé, aucun identifiant n est lu', () => {
  const out = parseStartRequest({
    provider: 'linkedin',
    linkedin: { method: 'credentials', username: 'a@b.fr', password: 'secret', access_token: 'li_at' },
    imap: { user: 'u', password: 'p' },
  });
  ok(out.ok);
  const json = JSON.stringify(out.ok ? out.value : {});
  ok(!json.includes('secret') && !json.includes('li_at') && !json.includes('"p"'), json);
});

Deno.test('parseStartRequest linkedin natif : identifiants, cookie, agent utilisateur', () => {
  const credentials = parseStartRequest({
    provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'a@b.fr', password: 'mot de passe' },
  });
  ok(credentials.ok && credentials.value.linkedin?.method === 'credentials' && credentials.value.linkedin.username === 'a@b.fr');
  ok(!parseStartRequest({ provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'a@b.fr' } }).ok);

  const cookie = parseStartRequest({
    provider: 'linkedin', mode: 'native',
    linkedin: { access_token: 'AQED…', premium_access_token: 'li_a', user_agent: UA }, country: 'fr', timezone: 'Europe/Paris',
  });
  ok(cookie.ok);
  if (cookie.ok) {
    strictEqual(cookie.value.linkedin?.method, 'cookie', 'un cookie fourni choisit la méthode cookie');
    strictEqual(cookie.value.linkedin?.premiumAccessToken, 'li_a');
    strictEqual(cookie.value.country, 'FR');
    strictEqual(cookie.value.timezone, 'Europe/Paris');
  }
  // L'agent utilisateur est obligatoire avec un cookie, jamais un faux.
  const noUa = parseStartRequest({ provider: 'linkedin', mode: 'native', linkedin: { method: 'cookie', access_token: 'AQED' } });
  ok(!noUa.ok && /User-Agent/.test(noUa.error));
  const badUa = parseStartRequest({ provider: 'linkedin', mode: 'native', linkedin: { method: 'cookie', access_token: 'AQED', user_agent: 'a@b.fr' } });
  ok(!badUa.ok);
  ok(!parseStartRequest({ provider: 'linkedin', mode: 'native', linkedin: { method: 'cookie', user_agent: UA } }).ok);
});

Deno.test('parseStartRequest : offres LinkedIn et pays', () => {
  const products = parseStartRequest({ provider: 'linkedin', linkedin: { products: ['classic', 'recruiter', 'classic'] } });
  ok(products.ok && JSON.stringify(products.value.linkedin?.products) === JSON.stringify(['classic', 'recruiter']));
  ok(!parseStartRequest({ provider: 'linkedin', linkedin: { products: [] } }).ok);
  ok(!parseStartRequest({ provider: 'linkedin', linkedin: { products: ['inconnue'] } }).ok);
  ok(!parseStartRequest({ provider: 'linkedin', country: 'FRA' }).ok);
  ok(parseStartRequest({ provider: 'linkedin', country: '' }).ok);
});

Deno.test('parseStartRequest whatsapp et imap natifs', () => {
  const qr = parseStartRequest({ provider: 'whatsapp', mode: 'native' });
  ok(qr.ok && qr.value.whatsapp?.method === 'qr');
  const pairing = parseStartRequest({ provider: 'whatsapp', mode: 'native', whatsapp: { method: 'pairing', phone_number: '+33 6 12 34 56 78' } });
  ok(pairing.ok && pairing.value.whatsapp?.phoneNumber === '33612345678');
  ok(!parseStartRequest({ provider: 'whatsapp', mode: 'native', whatsapp: { method: 'pairing', phone_number: 'abc' } }).ok);

  const basic = parseStartRequest({ provider: 'imap', mode: 'native', imap: { user: 'a@b.fr', password: 'p' } });
  ok(basic.ok && basic.value.imap?.imap === undefined);
  const full = parseStartRequest({
    provider: 'imap', mode: 'native',
    imap: { user: 'a@b.fr', password: 'p', imap: { host: 'imap.b.fr', port: 993, encryption: 'ssl' }, smtp: { host: 'smtp.b.fr', port: 465 } },
  });
  ok(full.ok && full.value.imap?.imap?.host === 'imap.b.fr' && full.value.imap.smtp?.port === 465);
  ok(!parseStartRequest({ provider: 'imap', mode: 'native', imap: { user: 'a@b.fr' } }).ok);
  ok(!parseStartRequest({ provider: 'imap', mode: 'native', imap: { user: 'a@b.fr', password: 'p', imap: { host: 'imap.b.fr', port: 993 } } }).ok, 'un seul des deux serveurs');
  ok(!parseStartRequest({ provider: 'imap', mode: 'native', imap: { user: 'a@b.fr', password: 'p', imap: { host: 'h', port: 99999 }, smtp: { host: 'h', port: 25 } } }).ok);
});

Deno.test('petits validateurs', () => {
  ok(userAgentLooksValid(UA));
  ok(!userAgentLooksValid('court'));
  ok(!userAgentLooksValid('a@b.com a@b.com a@b.com a@b.com'));
  strictEqual(normalizeCountry(' fr '), 'FR');
  strictEqual(normalizeCountry('FRA'), null);
  strictEqual(pairingPhoneNumber('+33 (6) 12-34-56-78'), '33612345678');
  strictEqual(pairingPhoneNumber('12'), null);
  strictEqual(normalizeTimezone('Europe/Paris'), 'Europe/Paris');
  strictEqual(normalizeTimezone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
  strictEqual(normalizeTimezone('../etc'), null);
});

// ---------------------------------------------------------------------------
// Error wording
// ---------------------------------------------------------------------------

Deno.test('connectionErrorMessage : texte Konekt par nature d erreur, jamais celui du prestataire', () => {
  strictEqual(connectionErrorMessage('validation', 'checkpoint'), "Ce code n'est pas valide. Vérifiez-le, puis réessayez.");
  strictEqual(connectionErrorMessage('not_found', 'checkpoint'), 'La vérification a expiré. Recommencez la connexion.');
  ok(/n'a pas abouti/.test(connectionErrorMessage('validation', 'start')));
  ok(/n'a pas abouti/.test(connectionErrorMessage('auth', 'start')));
  const kinds = ['auth', 'forbidden', 'not_found', 'rate_limited', 'validation', 'account_disconnected', 'account_degraded', 'provider_limit', 'uncertain', 'server', 'network', 'config'] as const;
  for (const kind of kinds) {
    for (const phase of ['start', 'checkpoint'] as const) {
      const message = connectionErrorMessage(kind, phase);
      ok(message.length > 10, `${kind}/${phase}`);
      ok(!/unipile|v2|api|http|\b\d{3}\b/i.test(message), `${kind}/${phase} : ${message}`);
      ok(!/—/.test(message), 'tiret cadratin');
    }
  }
});

Deno.test('httpStatusForKind', () => {
  strictEqual(httpStatusForKind('validation'), 400);
  strictEqual(httpStatusForKind('forbidden'), 403);
  strictEqual(httpStatusForKind('not_found'), 404);
  strictEqual(httpStatusForKind('account_disconnected'), 409);
  strictEqual(httpStatusForKind('rate_limited'), 429);
  strictEqual(httpStatusForKind('provider_limit'), 429);
  strictEqual(httpStatusForKind('server'), 502);
  strictEqual(httpStatusForKind('network'), 502);
  strictEqual(httpStatusForKind('uncertain'), 502);
});
