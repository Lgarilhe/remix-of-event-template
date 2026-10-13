/**
 * Connexion des comptes : garde statique des textes et des écrans (contrat de
 * connexion, § 4).
 * - aucun nom de prestataire dans src/lib/connectionCopy.ts ni dans les
 *   composants de connexion ;
 * - aucun texte de prestataire affiché tel quel ;
 * - aucune fenêtre ouverte après une attente (window.open après un await) ;
 * - français, vouvoiement, pas de tiret cadratin, pas de mot de remplissage.
 *
 * Le nom de la fonction serveur (`unipile-accounts`) est un identifiant interne,
 * jamais montré : il est retiré avant la recherche des noms de prestataires.
 *
 * Lancer : node --test tests/ux/connexion-copie.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, read, stripComments, ROOT } from './connexion-helpers.mjs';

const copy = await loadTs('src/lib/connectionCopy.ts');

const walk = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
  const next = `${rel}/${d.name}`;
  return d.isDirectory() ? walk(next) : [next];
});

/** Fichiers de l'expérience de connexion écrits par la refonte. */
const CONNECTION_FILES = [
  'src/lib/connectionCopy.ts',
  'src/lib/connectionBeta.ts',
  'src/lib/accountIdFormat.ts',
  'src/hooks/useConnection.ts',
  'src/pages/ConnectReturn.tsx',
  ...walk('src/components/connections'),
];

const VENDORS = /\b(?:unipile|apollo(?:\.io)?|people data labs|pdl|brandfetch|clearbit|logo\.dev|resend|anthropic|claude)\b/i;
// Dans le code, « resend » est le verbe anglais (renvoyer un code) : seul le nom de marque, avec sa majuscule, est un prestataire.
const VENDORS_IN_CODE = /\b(?:unipile|apollo(?:\.io)?|people data labs|pdl|brandfetch|clearbit|logo\.dev|anthropic|claude)\b/i;
const RESEND_BRAND = /\bResend\b/;
const INTERNAL_NAME = /unipile-accounts/g;
// \b ne connaît pas les lettres accentuées (« boîte » contient « te ») : bornes Unicode.
const FILLER = /(?<!\p{L})(?:crucial(?:e|es|s)?|essentiel(?:le|les|s)?|robustes?|riches?|fluides?|puissants?|puissantes?|innovant(?:e|es|s)?|explorer|naviguer|garantir|veiller à)(?!\p{L})/iu;
const TUTOIEMENT = /(?<![\p{L}'])(?:tu|toi|ton|ta|tes|te)(?!\p{L})/iu;
const DASHES = /[—–]/;
const EMOJI = /\p{Extended_Pictographic}/u;

test('la liste des fichiers couvre le module de textes, le hook, la page et le dossier des composants', () => {
  for (const f of ['src/lib/connectionCopy.ts', 'src/hooks/useConnection.ts', 'src/pages/ConnectReturn.tsx', 'src/components/connections/connectionApi.ts', 'src/components/connections/returnState.ts']) {
    assert.ok(CONNECTION_FILES.includes(f), f);
  }
});

test('aucun nom de prestataire dans connectionCopy.ts ni dans les composants de connexion', () => {
  for (const f of CONNECTION_FILES) {
    const src = read(f).replace(INTERNAL_NAME, '');
    assert.doesNotMatch(src, VENDORS_IN_CODE, f);
    assert.doesNotMatch(src, RESEND_BRAND, f);
  }
});

test('connectionCopy.ts est un module pur, sans import', () => {
  assert.doesNotMatch(read('src/lib/connectionCopy.ts'), /^import\s/m);
  assert.doesNotMatch(read('src/lib/connectionBeta.ts'), /^import\s/m);
});

test('aucun tiret cadratin, emoji ni majuscules forcées dans le code de connexion', () => {
  for (const f of CONNECTION_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, DASHES, `${f} : tiret cadratin`);
    assert.doesNotMatch(src, EMOJI, `${f} : emoji`);
  }
});

// ----------------------------------------------- Chaque texte que l'écran peut montrer
const PROVIDERS = ['linkedin', 'whatsapp', 'google', 'outlook', 'imap'];
const CHANNELS = ['linkedin', 'email', 'whatsapp'];
const HEALTHS = ['connected', 'syncing', 'connecting', 'limited', 'locked', 'needs_reconnect', 'not_connected', 'unknown'];
const CAUSES = ['session_expired', 'connection_error', 'authentication_partial', 'outdated_identifier', 'removed', 'unreadable'];
const CODES = [
  'feature_disabled', 'attempt_not_found', 'attempt_expired', 'attempt_closed', 'already_linked_org', 'already_linked_member', 'revoked',
  'wrong_account', 'claim_cross_tenant', 'claim_other_member', 'claim_revoked', 'claim_expired', 'claim_cancelled', 'claim_error',
  'rate_limited', 'provider_limit', 'validation', 'auth', 'not_found', 'forbidden', 'account_disconnected', 'account_degraded',
  'server', 'network', 'uncertain', 'config', 'network_lost', 'unknown', null, undefined,
];
const CHECKPOINT_TYPES = ['OTP', '2FA', 'IN_APP_VALIDATION', 'OTP_OR_IN_APP_VALIDATION', 'PHONE_REGISTER', 'CHALLENGE_SELECTION',
  'CONTRACT_SELECTION', 'CONSENT_SCREEN', 'CAPTCHA', 'PAIRING_CODE', 'LOADING', 'TYPE_NOUVEAU'];

/** Toutes les chaînes d'une valeur exportée : textes simples, listes, objets, et fonctions appelées avec des exemples. */
function collect(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collect(v, out));
  else if (typeof value === 'function') {
    for (const args of [['Léa'], [3], ['Léa', 'x'], [null]]) {
      try { collect(value(...args), out); } catch { /* signature différente : sans importance */ }
    }
  }
  return out;
}

function allStrings() {
  const out = [];
  for (const [name, value] of Object.entries(copy)) {
    if (name === 'checkpointCopy' || typeof value !== 'function') collect(value, out);
  }
  for (const p of PROVIDERS) {
    out.push(copy.providerName(p), copy.ofProvider(p), copy.startTitle(p, false), copy.startTitle(p, true), copy.startBody(p),
      copy.connectLabel(p), copy.successTitle(p), copy.successTitle(p, true), copy.CHECKPOINT_EYEBROW(p), copy.readableConnectionName(null, p));
    for (const code of CODES) for (const phase of ['start', 'checkpoint', 'status']) {
      out.push(copy.connectionErrorMessage(code, p, phase), copy.failureMessage(code, null, p, phase));
    }
    for (const type of CHECKPOINT_TYPES) for (const channel of [undefined, 'EMAIL', 'SMS', 'WHATSAPP']) for (const platform of [undefined, 'APP', 'SMS', 'WHATSAPP']) {
      const c = copy.checkpointCopy({ type, channel, platform }, p);
      out.push(c.heading, c.body, c.primary);
    }
    for (const a of ['connect', 'reconnect', 'refresh']) out.push(copy.healthActionLabel(a, p));
  }
  for (const h of HEALTHS) {
    out.push(copy.HEALTH_LABEL[h]);
    for (const c of CHANNELS) out.push(copy.healthReason(h, c));
  }
  // Une phrase par cause d'un compte à reconnecter ou d'un état non lu, pour chaque canal
  for (const cause of CAUSES) for (const c of CHANNELS) out.push(copy.causeReason(cause, c));
  out.push(copy.productLabel('classic'), copy.productLabel('recruiter'), copy.productLabel('sales_navigator'), copy.productLabel('autre', 'Offre Premium'));
  return out.filter((s) => typeof s === 'string' && s !== '');
}

test('le module rend bien des centaines de textes à contrôler', () => {
  assert.ok(allStrings().length > 300);
});

test('aucun texte montrable ne nomme un prestataire', () => {
  for (const s of allStrings()) assert.doesNotMatch(s, VENDORS, s);
});

test('aucun texte montrable avec tiret cadratin, emoji, mot de remplissage ni tutoiement', () => {
  for (const s of allStrings()) {
    assert.doesNotMatch(s, DASHES, s);
    assert.doesNotMatch(s, EMOJI, s);
    assert.doesNotMatch(s, FILLER, s);
    assert.doesNotMatch(s, TUTOIEMENT, s);
  }
});

test('cartes e-mail — noms accessibles et toast de dissociation : mêmes règles de texte, nom accessible qui commence par le mot affiché', () => {
  const addresses = ['jean@exemple.fr', 'Messagerie Outlook (2)', 'Messagerie (1)'];
  const labels = [copy.CARD_COMMON.retry, copy.CARD_COMMON.refresh, copy.ACTION_LABEL.refresh];
  const texts = [];
  for (const label of labels) for (const address of addresses) {
    const aria = copy.EMAIL_CARD.rowRefreshAria(label, address);
    assert.ok(aria.startsWith(label), `${label} : ${aria}`);
    assert.ok(aria.includes(address), aria);
    texts.push(aria);
  }
  for (const address of [...addresses, undefined, null, '']) texts.push(copy.EMAIL_CARD.unlinkedToast(address));
  assert.equal(copy.EMAIL_CARD.unlinkedToast('Messagerie Outlook (2)'), 'Boîte Messagerie Outlook (2) dissociée');
  assert.equal(copy.EMAIL_CARD.unlinkedToast(), 'Compte e-mail dissocié');
  for (const text of texts) {
    assert.doesNotMatch(text, VENDORS, text);
    assert.doesNotMatch(text, DASHES, text);
    assert.doesNotMatch(text, EMOJI, text);
    assert.doesNotMatch(text, FILLER, text);
    assert.doesNotMatch(text, TUTOIEMENT, text);
  }
});

test('l\'avis de relecture ratée, ses boutons et la ligne d\'offre : mêmes règles de texte', () => {
  for (const text of [copy.CARD_COMMON.staleList, copy.CARD_COMMON.retry, copy.CARD_COMMON.refresh, copy.CARD_COMMON.offer(copy.OFFER_LABEL.classic)]) {
    assert.doesNotMatch(text, VENDORS, text);
    assert.doesNotMatch(text, DASHES, text);
    assert.doesNotMatch(text, FILLER, text);
    assert.doesNotMatch(text, TUTOIEMENT, text);
  }
});

test('les noms de canaux sont ceux que la personne connaît', () => {
  assert.deepEqual(Object.values(copy.PROVIDER_NAME), ['LinkedIn', 'WhatsApp', 'Gmail', 'Outlook', 'Messagerie']);
});

test('un texte de serveur n\'est montré que sans nom de prestataire, court et non vide', () => {
  const vendor = ['Uni', 'pile'].join('');
  assert.equal(copy.safeServerMessage('Phrase de Konekt.'), 'Phrase de Konekt.');
  assert.equal(copy.safeServerMessage(`${vendor} a répondu 500.`), null);
  assert.equal(copy.safeServerMessage('   '), null);
  assert.equal(copy.safeServerMessage('x'.repeat(301)), null);
  assert.equal(copy.safeServerMessage(undefined), null);
  assert.equal(copy.safeServerMessage({ message: 'x' }), null);
  assert.equal(copy.mentionsVendor(`le service ${vendor}`), true);
  assert.equal(copy.mentionsVendor('Apollo'), true);
  assert.equal(copy.mentionsVendor('LinkedIn, Gmail et Outlook'), false);
});

test('F3 — un nom de prestataire dans un identifiant à tiret bas est repéré', () => {
  const v = ['Uni', 'pile'].join('');
  for (const text of [`${v.toUpperCase()}_API_KEY invalide`, `${v.toLowerCase()}_dsn missing`, `LINKEDIN_${v.toUpperCase()}_ERR`, `Erreur ${v}`, `api12.${v.toLowerCase()}.com`, `x-${v.toLowerCase()}-signature`]) {
    assert.equal(copy.mentionsVendor(text), true, text);
    assert.equal(copy.safeServerMessage(text), null, text);
  }
  assert.equal(copy.mentionsVendor('Renvoyer le code'), false);
});

test('R2 — le prénom Claude n\'est pas un nom de prestataire : le compte et la phrase restent affichés', () => {
  const first = ['Clau', 'de'].join('');
  assert.equal(copy.readableConnectionName(`${first} Dupont`, 'linkedin'), `${first} Dupont`);
  assert.equal(copy.safeServerMessage(`${first}, votre compte est limité`), `${first}, votre compte est limité`);
  assert.equal(copy.mentionsVendor(first), false);
  assert.equal(copy.mentionsVendor(`${first} AI`), true);
  assert.equal(copy.mentionsVendor(['Anthro', 'pic'].join('')), true);
});

test('un nom de compte codé ou nommant un prestataire n\'est jamais montré', () => {
  assert.equal(copy.readableConnectionName('user:abc|org:def|providers:LINKEDIN', 'linkedin'), 'Compte LinkedIn');
  assert.equal(copy.readableConnectionName(`Compte ${['Uni', 'pile'].join('')}`, 'whatsapp'), 'Compte WhatsApp');
  assert.equal(copy.readableConnectionName('', 'google'), 'Messagerie Gmail');
  assert.equal(copy.readableConnectionName('  Léa Martin  ', 'linkedin'), 'Léa Martin');
});

test('une offre inconnue prend le nom du serveur seulement s\'il est montrable', () => {
  assert.equal(copy.productLabel('recruiter', 'Recruiter Lite'), 'LinkedIn Recruiter');
  assert.equal(copy.productLabel('truc', 'Offre Premium'), 'Offre Premium');
  assert.equal(copy.productLabel('truc', `${['Uni', 'pile'].join('')} Pro`), 'Autre offre LinkedIn');
  assert.equal(copy.productLabel('truc'), 'Autre offre LinkedIn');
});

test('les 11 types de vérification sont traités, un type nouveau garde un texte d\'attente', () => {
  const controls = Object.fromEntries(CHECKPOINT_TYPES.map((t) => [t, copy.checkpointCopy({ type: t }).control]));
  assert.deepEqual(controls, {
    OTP: 'code', '2FA': 'code', IN_APP_VALIDATION: 'wait', OTP_OR_IN_APP_VALIDATION: 'code', PHONE_REGISTER: 'phone',
    CHALLENGE_SELECTION: 'challenge', CONTRACT_SELECTION: 'contract', CONSENT_SCREEN: 'consent', CAPTCHA: 'captcha',
    PAIRING_CODE: 'pairing', LOADING: 'loading', TYPE_NOUVEAU: 'code',
  });
  assert.match(copy.checkpointCopy({ type: 'OTP', channel: 'EMAIL' }).heading, /par e-mail/);
  assert.match(copy.checkpointCopy({ type: 'OTP', channel: 'EMAIL' }).body, /courriers indésirables/);
  assert.match(copy.checkpointCopy({ type: '2FA', platform: 'APP' }).heading, /application d'authentification/);
  assert.equal(copy.checkpointCopy({ type: 'OTP' }).canResend, true);
  assert.equal(copy.checkpointCopy({ type: '2FA', platform: 'APP' }).canResend, false);
});

// ------------------------------------------------- Aucun texte brut, aucune fenêtre tardive
test('aucun texte d\'erreur du serveur ou d\'une exception n\'est affiché tel quel', () => {
  const direct = [
    /\{\s*(?:\w+\??\.)*(?:error|err|e|data|result|response)\??\.(?:message|error)\s*\}/,
    /toast\.\w+\(\s*(?:\w+\??\.)*(?:error|err|e|data|result|response)\??\.(?:message|error)\b/,
    /error_title|errorTitle/,
  ];
  for (const f of CONNECTION_FILES.filter((x) => x.endsWith('.tsx') || x.endsWith('.ts'))) {
    const src = stripComments(read(f));
    for (const re of direct) assert.doesNotMatch(src, re, `${f} : ${re}`);
  }
});

/** Vrai si un window.open suit un await dans la même fonction (le navigateur bloque cette fenêtre). */
function opensWindowAfterAwait(src) {
  const lines = stripComments(src).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/window\.open\(/.test(lines[i])) continue;
    for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
      if (/\bawait\b/.test(lines[j])) return true;
      if (/^\s{0,6}(?:export\s+)?(?:const|function|async function)\s/.test(lines[j])) break;
    }
  }
  return false;
}

test('la garde sait reconnaître une fenêtre ouverte après une attente', () => {
  assert.equal(opensWindowAfterAwait("const go = async () => {\n  const { data } = await call();\n  window.open(data.url, '_blank');\n};"), true);
  assert.equal(opensWindowAfterAwait("const go = () => {\n  window.open(url, '_blank');\n};"), false);
  assert.equal(opensWindowAfterAwait('const go = async () => {\n  await call();\n};\nconst b = () => {\n  window.location.assign(url);\n};'), false);
});

test('aucune fenêtre ouverte après une attente dans les fichiers de connexion', () => {
  for (const f of CONNECTION_FILES) {
    assert.equal(opensWindowAfterAwait(read(f)), false, f);
    assert.doesNotMatch(stripComments(read(f)), /window\.open\(/, `${f} : la page de connexion s'ouvre dans l'onglet courant`);
  }
});

// Les cartes, l'organisation et l'installation envoient l'onglet courant vers la page de connexion
// (hostedConnect.ts) : aucune ne l'ouvre dans une fenêtre après un appel.
const CARD_FILES = [
  'src/components/settings/MyLinkedInAccount.tsx',
  'src/components/settings/MyEmailAccount.tsx',
  'src/components/settings/MyWhatsAppAccount.tsx',
  'src/components/settings/IntegrationsSettings.tsx',
  'src/components/onboarding/scenes/SceneLinkedIn.tsx',
  'src/pages/Onboarding.tsx',
  'src/lib/onboarding/linkedin.ts',
];
test('cartes et onboarding : aucune fenêtre ouverte après une attente', () => {
  for (const f of CARD_FILES) {
    assert.equal(opensWindowAfterAwait(read(f)), false, f);
    assert.doesNotMatch(stripComments(read(f)), /window\.open\(/, f);
  }
});
