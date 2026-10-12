/**
 * Assistant de connexion directe : règles pures (src/components/connections/native/nativeFlow.ts)
 * et gardes statiques des écrans (identifiants, champs, bascule vers la page de
 * connexion standard).
 *
 * Lancer : node --test tests/ux/connexion-assistant.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, read, stripComments, ROOT } from './connexion-helpers.mjs';

const flow = await loadTs('src/components/connections/native/nativeFlow.ts');
const copy = await loadTs('src/lib/connectionCopy.ts');

const walk = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
  const next = `${rel}/${d.name}`;
  return d.isDirectory() ? walk(next) : [next];
});
const NATIVE_FILES = walk('src/components/connections/native');
const code = (rel) => stripComments(read(rel));

const cp = (type, extra = {}) => ({ kind: 'checkpoint', type, ...extra });

// ------------------------------------------------------------ Étape suivante du serveur
test('chaque réponse du serveur mène à un écran, une redirection ou la page de connexion standard', () => {
  assert.deepEqual(flow.outcomeOfNext({ kind: 'redirect', url: 'https://exemple.test/x' }), { kind: 'redirect', url: 'https://exemple.test/x' });
  assert.deepEqual(flow.outcomeOfNext({ kind: 'qrcode', qrcode: 'abc' }), { kind: 'step', step: { name: 'qr', qrcode: 'abc', expired: false } });
  assert.deepEqual(flow.outcomeOfNext({ kind: 'pending' }), { kind: 'step', step: { name: 'loading' } });
  const account = { id: 'acc_1', provider: 'linkedin', name: 'Léa', status: 'OK' };
  assert.deepEqual(flow.outcomeOfNext({ kind: 'done', account }), { kind: 'step', step: { name: 'done', account } });
});

test('les huit types de vérification affichés par l\'assistant ont leur écran', () => {
  for (const type of ['OTP', '2FA', 'IN_APP_VALIDATION', 'OTP_OR_IN_APP_VALIDATION', 'CHALLENGE_SELECTION', 'CONTRACT_SELECTION', 'CONSENT_SCREEN']) {
    const out = flow.outcomeOfNext(cp(type));
    assert.equal(out.kind, 'step', type);
    assert.equal(out.step.name, 'checkpoint', type);
    assert.equal(out.step.checkpoint.type, type);
  }
  assert.deepEqual(flow.outcomeOfNext(cp('LOADING')), { kind: 'step', step: { name: 'loading' } });
  assert.deepEqual(flow.outcomeOfNext(cp('PAIRING_CODE', { code: 'ABCD1234' })), { kind: 'step', step: { name: 'pairing', code: 'ABCD1234', expired: false } });
});

test('CAPTCHA, un type inconnu et un code d\'association sans code basculent sur la page de connexion standard', () => {
  assert.deepEqual(flow.outcomeOfNext(cp('CAPTCHA', { captcha: { public_key: 'k', data: 'd' } })), { kind: 'fallback', cause: 'captcha' });
  assert.deepEqual(flow.outcomeOfNext(cp('PHONE_REGISTER')), { kind: 'fallback', cause: 'unsupported' });
  assert.deepEqual(flow.outcomeOfNext(cp('TYPE_NOUVEAU')), { kind: 'fallback', cause: 'unsupported' });
  assert.deepEqual(flow.outcomeOfNext(cp('PAIRING_CODE')), { kind: 'fallback', cause: 'unsupported' });
  assert.equal(flow.fallbackCause('captcha'), 'captcha');
  assert.equal(flow.fallbackCause('otp'), null);
});

// ------------------------------------------------------------ Échecs
test('un échec au départ reste sur le formulaire, quel que soit le code', () => {
  for (const code of ['validation', 'auth', 'rate_limited', 'attempt_expired', 'already_linked_org', 'wrong_account']) {
    assert.deepEqual(flow.outcomeOfFailure({ errorCode: code, message: 'Phrase.' }, 'start'), { kind: 'error', message: 'Phrase.', code });
  }
});

test('pendant une vérification, un code refusé ou un réseau coupé laisse ressaisir, le reste ferme la tentative', () => {
  for (const code of ['validation', 'rate_limited', 'provider_limit', 'network_lost', 'server', 'uncertain']) {
    assert.equal(flow.outcomeOfFailure({ errorCode: code, message: 'x' }, 'checkpoint').kind, 'error', code);
  }
  for (const code of ['attempt_expired', 'attempt_not_found', 'attempt_closed', 'not_found', 'claim_cross_tenant', 'already_linked_member', 'wrong_account', 'auth', 'forbidden']) {
    assert.equal(flow.outcomeOfFailure({ errorCode: code, message: 'x' }, 'checkpoint').kind, 'failed', code);
  }
});

// ------------------------------------------------------------ Départ, retour
const caps = (native) => ({ hosted: { available: true, whiteLabel: false }, native: { linkedin: false, whatsapp: false, imap: false, oauth: false, ...native }, recruiterExclusiveWithSalesNavigator: true });

test('les messageries proposées sont celles que le serveur annonce', () => {
  assert.deepEqual(flow.emailChoices(caps({})), []);
  assert.deepEqual(flow.emailChoices(caps({ oauth: true })), ['google', 'outlook']);
  assert.deepEqual(flow.emailChoices(caps({ imap: true })), ['imap']);
  assert.deepEqual(flow.emailChoices(caps({ oauth: true, imap: true })), ['google', 'outlook', 'imap']);
});

test('première étape : LinkedIn et WhatsApp directement, une nouvelle messagerie par son choix', () => {
  const all = ['google', 'outlook', 'imap'];
  assert.deepEqual(flow.entryStep('linkedin', false, []), { name: 'linkedin_credentials' });
  assert.deepEqual(flow.entryStep('linkedin', true, []), { name: 'linkedin_credentials' });
  assert.deepEqual(flow.entryStep('whatsapp', false, []), { name: 'whatsapp_choice' });
  assert.deepEqual(flow.entryStep('google', false, all), { name: 'email_choice' });
  assert.deepEqual(flow.entryStep('imap', true, all), { name: 'imap' }, 'une reconnexion vise la boîte reliée');
  assert.deepEqual(flow.entryStep('google', true, all), { name: 'oauth' });
});

test('un seul type de messagerie permis : le bouton « Gmail » mène au formulaire IMAP, et inversement', () => {
  assert.equal(flow.startProviderOf('google', false, ['imap']), 'imap');
  assert.deepEqual(flow.entryStep('google', false, ['imap']), { name: 'imap' });
  assert.equal(flow.startProviderOf('imap', false, ['google', 'outlook']), 'imap', 'deux types : le choix décide');
  assert.equal(flow.startProviderOf('imap', true, ['google']), 'imap', 'une reconnexion garde son fournisseur');
  assert.equal(flow.startProviderOf('linkedin', false, ['imap']), 'linkedin');
});

test('« Retour » ne ramène qu\'à l\'écran d\'où l\'on vient', () => {
  const ctx = { provider: 'imap', reconnect: false, choices: ['google', 'outlook', 'imap'] };
  assert.deepEqual(flow.previousStep({ name: 'linkedin_cookie' }, ctx), { name: 'linkedin_credentials' });
  assert.deepEqual(flow.previousStep({ name: 'whatsapp_phone' }, ctx), { name: 'whatsapp_choice' });
  assert.deepEqual(flow.previousStep({ name: 'imap' }, ctx), { name: 'email_choice' });
  assert.equal(flow.previousStep({ name: 'imap' }, { ...ctx, reconnect: true }), null);
  assert.equal(flow.previousStep({ name: 'checkpoint', checkpoint: cp('OTP'), expired: false }, ctx), null);
});

// ------------------------------------------------------------ Suivi d'une attente
test('chaque attente nomme son étape au serveur, avec un délai', () => {
  assert.deepEqual(flow.watchPlan({ name: 'qr', qrcode: 'abc', expired: false }), { waitingStep: 'QR_CODE', timeoutMs: 4 * 60_000 });
  assert.equal(flow.watchPlan({ name: 'qr', qrcode: null, expired: false }), null, 'code en cours de création');
  assert.equal(flow.watchPlan({ name: 'qr', qrcode: 'abc', expired: true }), null);
  assert.deepEqual(flow.watchPlan({ name: 'loading' }), { waitingStep: 'LOADING', timeoutMs: 2 * 60_000 });
  assert.deepEqual(flow.watchPlan({ name: 'checkpoint', checkpoint: cp('IN_APP_VALIDATION'), expired: false }), { waitingStep: 'IN_APP_VALIDATION', timeoutMs: 3 * 60_000 });
  assert.deepEqual(flow.watchPlan({ name: 'checkpoint', checkpoint: cp('OTP_OR_IN_APP_VALIDATION'), expired: false }), { waitingStep: 'IN_APP_VALIDATION', timeoutMs: 3 * 60_000 });
  assert.equal(flow.watchPlan({ name: 'checkpoint', checkpoint: cp('OTP'), expired: false }), null, 'un code se saisit, il ne s\'attend pas');
  assert.equal(flow.watchPlan({ name: 'checkpoint', checkpoint: cp('IN_APP_VALIDATION'), expired: true }), null);
  assert.deepEqual(flow.watchPlan({ name: 'pairing', code: 'ABCD1234', expired: false }), { timeoutMs: 4 * 60_000 }, 'lecture de l\'état seule, sans appeler le prestataire');
  for (const step of [{ name: 'linkedin_credentials' }, { name: 'imap' }, { name: 'done', account: null }, { name: 'failed', message: '', code: '' }]) {
    assert.equal(flow.watchPlan(step), null, step.name);
  }
});

test('une attente arrivée au bout du temps passe en « expirée » ; les autres écrans n\'expirent pas', () => {
  assert.equal(flow.expiredStep({ name: 'qr', qrcode: 'a', expired: false }).expired, true);
  assert.equal(flow.expiredStep({ name: 'pairing', code: 'x', expired: false }).expired, true);
  assert.equal(flow.expiredStep({ name: 'checkpoint', checkpoint: cp('IN_APP_VALIDATION'), expired: false }).expired, true);
  assert.equal(flow.expiredStep({ name: 'loading' }), null);
  assert.equal(flow.expiredStep({ name: 'imap' }), null);
});

test('le suivi n\'est relancé que si l\'écran attendu change', () => {
  const a = { name: 'qr', qrcode: 'a', expired: false };
  assert.equal(flow.watchKey(a), flow.watchKey({ ...a, qrcode: 'b' }), 'un nouveau QR code ne relance pas le suivi');
  assert.notEqual(flow.watchKey(a), flow.watchKey({ ...a, expired: true }));
  assert.notEqual(flow.watchKey({ name: 'checkpoint', checkpoint: cp('OTP'), expired: false }), flow.watchKey({ name: 'checkpoint', checkpoint: cp('2FA'), expired: false }));
  assert.equal(flow.stepKey({ name: 'checkpoint', checkpoint: cp('OTP'), expired: false }), 'checkpoint:OTP');
  assert.equal(flow.stepKey({ name: 'qr', qrcode: 'a', expired: false }), 'qr');
});

test('pendant l\'attente, une étape lue qui diffère de l\'écran le remplace', () => {
  const qr = { name: 'qr', qrcode: 'a', expired: false };
  assert.equal(flow.nextChangesStep(qr, { kind: 'qrcode', qrcode: 'a' }), false);
  assert.equal(flow.nextChangesStep(qr, { kind: 'qrcode', qrcode: 'b' }), true, 'code renouvelé');
  assert.equal(flow.nextChangesStep(qr, { kind: 'pending' }), true, 'code scanné, finalisation');
  assert.equal(flow.nextChangesStep({ name: 'loading' }, { kind: 'pending' }), false);
  const inApp = { name: 'checkpoint', checkpoint: cp('IN_APP_VALIDATION'), expired: false };
  assert.equal(flow.nextChangesStep(inApp, cp('IN_APP_VALIDATION')), false);
  assert.equal(flow.nextChangesStep(inApp, cp('CONTRACT_SELECTION', { contracts: [] })), true);
  assert.equal(flow.nextChangesStep(inApp, cp('CAPTCHA')), true, 'la bascule vers la page standard passe aussi par là');
  assert.equal(flow.nextChangesStep({ name: 'pairing', code: 'A', expired: false }, cp('PAIRING_CODE', { code: 'A' })), false);
  assert.equal(flow.nextChangesStep({ name: 'pairing', code: 'A', expired: false }, cp('PAIRING_CODE', { code: 'B' })), true);
  assert.equal(flow.nextChangesStep(inApp, { kind: 'redirect', url: 'https://x.test' }), true);
});

// ------------------------------------------------------------ Saisies
test('un code de vérification est nettoyé et borné', () => {
  assert.equal(flow.normalizeCode(' 123 456 '), '123456');
  assert.equal(flow.normalizeCode('12-34-56'), '123456');
  assert.equal(flow.codePlausible('123 456'), true);
  assert.equal(flow.codePlausible('12'), false);
  assert.equal(flow.codePlausible(''), false);
  assert.equal(flow.codePlausible('1'.repeat(13)), false);
});

test('numéro WhatsApp : chiffres seuls avec l\'indicatif, un numéro national est expliqué et jamais deviné', () => {
  assert.deepEqual(flow.checkPhone('+33 6 12 34 56 78'), { ok: true, digits: '33612345678' });
  assert.deepEqual(flow.checkPhone('0033612345678'), { ok: true, digits: '33612345678' });
  assert.deepEqual(flow.checkPhone('(+1) 415-555-0100'), { ok: true, digits: '14155550100' });
  assert.deepEqual(flow.checkPhone('06 12 34 56 78'), { ok: false, problem: 'national' });
  assert.deepEqual(flow.checkPhone('abc'), { ok: false, problem: 'invalid' });
  assert.deepEqual(flow.checkPhone('12345'), { ok: false, problem: 'invalid' });
  assert.deepEqual(flow.checkPhone('+' + '1'.repeat(16)), { ok: false, problem: 'invalid' });
});

test('code d\'association : par groupes de quatre quand il en fait huit', () => {
  assert.equal(flow.formatPairingCode('abcd1234'), 'ABCD-1234');
  assert.equal(flow.formatPairingCode('ABCD-1234'), 'ABCD-1234');
  assert.equal(flow.formatPairingCode('123456'), '123456');
});

test('pays de connexion : la région du navigateur si elle est proposée, sinon la France', () => {
  assert.equal(flow.defaultCountry(['fr-FR', 'en-US']), 'FR');
  assert.equal(flow.defaultCountry(['en-GB']), 'GB');
  assert.equal(flow.defaultCountry(['fr', 'de-CH']), 'CH', 'première langue qui porte une région');
  assert.equal(flow.defaultCountry(['en-NZ']), 'FR');
  assert.equal(flow.defaultCountry(undefined), 'FR');
  assert.equal(flow.defaultCountry([]), 'FR');
  assert.ok(flow.COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code) && c.label));
});

test('offres LinkedIn : Recruiter et Sales Navigator ne se cochent pas ensemble', () => {
  const both = [{ id: 'classic' }, { id: 'recruiter' }, { id: 'sales_navigator' }];
  assert.equal(flow.hasExclusiveProducts(both), true);
  assert.equal(flow.hasExclusiveProducts([{ id: 'classic' }, { id: 'recruiter' }]), false);
  assert.deepEqual(flow.defaultProductSelection(both), ['classic', 'sales_navigator'], 'le choix du prestataire : Sales Navigator, pas Recruiter');
  assert.deepEqual(flow.defaultProductSelection([{ id: 'classic' }, { id: 'recruiter' }]), ['classic', 'recruiter']);
  assert.deepEqual(flow.toggleProduct(['classic', 'sales_navigator'], 'recruiter', true, both).sort(), ['classic', 'recruiter']);
  assert.deepEqual(flow.toggleProduct(['classic', 'recruiter'], 'sales_navigator', true, both).sort(), ['classic', 'sales_navigator']);
  assert.deepEqual(flow.toggleProduct(['classic', 'recruiter'], 'recruiter', false, both), ['classic']);
  assert.deepEqual(flow.toggleProduct(['classic'], 'recruiter', true, [{ id: 'classic' }, { id: 'recruiter' }]), ['classic', 'recruiter']);
  assert.equal(flow.consentCode(['sales_navigator', 'classic'], both), 'classic,sales_navigator', 'dans l\'ordre proposé');
  assert.equal(flow.consentCode([], both), '');
});

test('renvoi d\'un code : trente secondes entre deux envois', () => {
  assert.equal(flow.RESEND_COOLDOWN_MS, 30_000);
  assert.equal(flow.resendSecondsLeft(1_000, 1_000), 30);
  assert.equal(flow.resendSecondsLeft(1_000, 1_001), 30);
  assert.equal(flow.resendSecondsLeft(1_000, 29_001), 2);
  assert.equal(flow.resendSecondsLeft(1_000, 31_000), 0);
  assert.equal(flow.resendSecondsLeft(1_000, 99_000), 0);
});

test('serveurs de messagerie : aucun, les deux, jamais un seul', () => {
  const imap = (o = {}) => ({ host: '', port: '993', encryption: 'ssl', ...o });
  const smtp = (o = {}) => ({ host: '', port: '465', encryption: 'ssl', ...o });
  assert.deepEqual(flow.checkServers(imap(), smtp()), { ok: true, servers: null });
  assert.deepEqual(
    flow.checkServers(imap({ host: ' imap.exemple.fr ' }), smtp({ host: 'smtp.exemple.fr', port: '587', encryption: 'starttls' })),
    { ok: true, servers: { imap: { host: 'imap.exemple.fr', port: 993, encryption: 'ssl' }, smtp: { host: 'smtp.exemple.fr', port: 587, encryption: 'starttls' } } },
  );
  assert.deepEqual(flow.checkServers(imap({ host: 'imap.exemple.fr' }), smtp()), { ok: false, problem: 'pair', which: 'both' });
  assert.deepEqual(flow.checkServers(imap({ host: 'imap.exemple.fr', port: '0' }), smtp({ host: 's' })), { ok: false, problem: 'port', which: 'imap' });
  assert.deepEqual(flow.checkServers(imap({ host: 'i' }), smtp({ host: 's', port: 'abc' })), { ok: false, problem: 'port', which: 'smtp' });
  assert.deepEqual(flow.checkServers(imap({ host: 'i', port: '70000' }), smtp({ host: 's' })).problem, 'port');
  assert.deepEqual([...flow.ENCRYPTIONS], ['default', 'ssl', 'tls', 'starttls']);
});

// ------------------------------------------------------------ Textes de l'assistant
test('le bouton qui ouvre l\'assistant dit ce qu\'il permet, sans nom de prestataire', () => {
  assert.equal(copy.nativeTriggerLabel('linkedin', false), 'Saisir mon identifiant LinkedIn');
  assert.equal(copy.nativeTriggerLabel('linkedin', true), 'Reconnecter avec mon identifiant');
  assert.equal(copy.nativeTriggerLabel('whatsapp', false), 'Scanner un QR code ou saisir un code');
  assert.equal(copy.nativeTriggerLabel('imap', false), 'Connecter une autre messagerie');
  assert.equal(copy.nativeTriggerLabel('imap', true), 'Reconnecter avec mon mot de passe');
});

test('la bascule vers la page de connexion standard explique pourquoi, pour chaque cause', () => {
  assert.match(copy.FALLBACK.body('linkedin', 'captcha'), /pas un robot/);
  assert.match(copy.FALLBACK.body('linkedin', 'captcha'), /page de connexion sécurisée/);
  assert.match(copy.FALLBACK.body('whatsapp', 'unsupported'), /ne peut pas afficher ici/);
  assert.notEqual(copy.FALLBACK.heading.captcha, copy.FALLBACK.heading.unsupported);
});

test('méthodes et contrats : le mot de Konekt, sinon le libellé du serveur s\'il est montrable', () => {
  assert.equal(copy.challengeLabel('EMAIL', 'Email'), 'Par e-mail');
  assert.equal(copy.challengeLabel('sms'), 'Par SMS');
  assert.equal(copy.challengeLabel('WHATSAPP'), 'Sur WhatsApp');
  assert.equal(copy.challengeLabel('AUTRE', 'Appel vocal'), 'Appel vocal');
  assert.equal(copy.challengeLabel('AUTRE', `${['Uni', 'pile'].join('')} appel`), 'Autre méthode');
  assert.equal(copy.contractLabel('Acme (Recruiter Lite)'), 'Acme (Recruiter Lite)');
  assert.equal(copy.contractLabel(null), 'Contrat LinkedIn');
});

// ------------------------------------------------------------ Gardes statiques des écrans
test('l\'assistant est chargé à la demande et ne se montre que derrière les deux conditions', () => {
  const slot = code('src/components/connections/NativeConnectSlot.tsx');
  assert.match(slot, /import\('\.\/native\/NativeConnectFlow'\)/);
  assert.match(slot, /if \(!Flow \|\| !allowed\) return null;/);
  assert.doesNotMatch(read('src/App.tsx'), /NativeConnectFlow/, 'jamais chargé avec l\'application');
});

test('aucun écran de l\'assistant n\'écrit dans la console ni ne garde un identifiant', () => {
  for (const f of NATIVE_FILES.filter((x) => /\.tsx?$/.test(x))) {
    const src = code(f);
    assert.doesNotMatch(src, /console\.\w+\(/, `${f} : console`);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${f} : stockage`);
    // Une variable d'état nommée mot de passe, jeton ou cookie : [password, setPassword] = useState(...)
    assert.doesNotMatch(src, /const \[\s*\w*(?:password|passwd|token|cookie)\w*\s*,/i, `${f} : un secret dans l'état`);
  }
});

test('mot de passe, cookie : champs non contrôlés, lus par takeSecret à l\'envoi', () => {
  for (const f of ['src/components/connections/native/steps/LinkedInSteps.tsx', 'src/components/connections/native/steps/EmailSteps.tsx']) {
    const src = code(f);
    assert.match(src, /<SecretField/, f);
    assert.match(src, /takeSecret\(/, f);
    assert.doesNotMatch(src, /<SecretField[^>]*\bvalue=/, `${f} : un champ secret contrôlé`);
  }
  const parts = code('src/components/connections/native/steps/StepParts.tsx');
  assert.match(parts, /type=\{visible \? 'text' : 'password'\}/);
  assert.match(parts, /input\.value = '';/, 'le champ est vidé à la lecture');
  assert.match(parts, /aria-pressed=\{visible\}/);
});

test('les champs portent le bon autoComplete (gestionnaires de mots de passe, code reçu par SMS)', () => {
  const li = code('src/components/connections/native/steps/LinkedInSteps.tsx');
  // Identifiants d'un autre service : jamais ceux de Konekt (voir le test F2 plus bas).
  assert.match(li, /autoComplete="new-password"/);
  assert.match(li, /name="li_at"[\s\S]*?autoComplete="off"/, 'un cookie n\'est pas un mot de passe à retenir');
  assert.match(code('src/components/connections/native/steps/CheckpointSteps.tsx'), /autoComplete="one-time-code"/);
  assert.match(code('src/components/connections/native/steps/WhatsAppSteps.tsx'), /autoComplete="tel"/);
  const em = code('src/components/connections/native/steps/EmailSteps.tsx');
  assert.match(em, /autoComplete="new-password"/);
});

test('champs de 16 px et cibles de 44 px sur téléphone', () => {
  const parts = code('src/components/connections/native/steps/StepParts.tsx');
  assert.match(parts, /max-md:h-11/);
  assert.doesNotMatch(parts, /text-xs[^'"`]*\binput\b/);
  const { Input } = { Input: code('src/components/ui/input.tsx') };
  assert.match(Input.Input ?? Input, /text-base[\s\S]*md:text-sm/, 'le champ est en 16 px sous 768 px');
  for (const f of NATIVE_FILES.filter((x) => x.endsWith('.tsx'))) {
    // Un bouton du pied de page passe par FooterButton (44 px) ; les autres gardent max-md:h-11.
    for (const m of code(f).matchAll(/<Button\b[^>]*>/g)) {
      assert.match(m[0], /max-md:h-11|min-h-11/, `${f} : ${m[0].slice(0, 60)}`);
    }
  }
});

test('les boutons ont un état d\'attente : chargement ou désactivation', () => {
  const flowSrc = code('src/components/connections/native/NativeConnectFlow.tsx');
  assert.match(flowSrc, /submitting=\{submitting\}/);
  for (const f of NATIVE_FILES.filter((x) => /steps\/(LinkedIn|Email|WhatsApp|Checkpoint)/.test(x))) {
    assert.match(code(f), /loading=\{/, f);
    assert.match(code(f), /<fieldset disabled=\{submitting\}|disabled=\{/, f);
  }
});

test('la page de connexion standard ne s\'ouvre jamais dans une fenêtre : même onglet, après la tentative standard', () => {
  const src = code('src/components/connections/native/NativeConnectFlow.tsx');
  assert.match(src, /startHostedConnection\(\{ api: conn\.api \}/);
  assert.match(src, /goToProvider\(outcome\.url\)/);
  assert.doesNotMatch(src, /window\.(open|location)/);
  // La tentative directe n'est pas annulée quand l'onglet part vers la page standard.
  assert.match(src, /leavingRef\.current = true;/);
  assert.match(src, /!leavingRef\.current && !connectedRef\.current/);
});

test('fermer la fenêtre annule la tentative encore ouverte', () => {
  const src = code('src/components/connections/native/NativeConnectFlow.tsx');
  assert.match(src, /void conn\.api\.cancel\(id\)/);
  assert.match(src, /void conn\.api\.cancel\(result\.attemptId\)/, 'tentative créée pendant la fermeture');
  assert.match(code('src/components/connections/native/FlowSurface.tsx'), /event\.preventDefault\(\)/, 'un clic à côté ne ferme pas');
});

test('QR code : noir sur blanc dans les deux thèmes, image acceptée seulement en data:image', () => {
  const src = code('src/components/connections/native/QrCode.tsx');
  assert.match(src, /fill="#ffffff"/);
  assert.match(src, /fill="#000000"/);
  assert.match(src, /role="img"/);
  assert.match(src, /\^data:image/);
  assert.match(src, /catch \{\s*return null;/, 'un texte trop long ne casse pas l\'écran');
});

test('aucun écran de l\'assistant n\'affiche un texte brut du serveur', () => {
  for (const f of NATIVE_FILES.filter((x) => x.endsWith('.tsx'))) {
    const src = code(f);
    assert.doesNotMatch(src, /\{\s*(?:\w+\??\.)*(?:error|err|e|result|response|failure)\??\.(?:message|error)\s*\}/, f);
  }
});

test('F2 — les formulaires d\'identifiants ne se laissent pas remplir par l\'identifiant ni le mot de passe de Konekt', () => {
  for (const f of ['src/components/connections/native/steps/LinkedInSteps.tsx', 'src/components/connections/native/steps/EmailSteps.tsx']) {
    const src = code(f);
    assert.doesNotMatch(src, /autoComplete="(?:username|current-password)"/, f);
    assert.match(src, /autoComplete="new-password"/, f);
  }
});
