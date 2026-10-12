/**
 * Connexion des comptes, cartes de Connexions en mode standard (passe 2) :
 * LinkedIn, messagerie, WhatsApp, carte de l'organisation et étape LinkedIn de
 * l'installation.
 *
 * - modules purs : état d'un compte (un geste par cause), destination du retour,
 *   départ vers la page de connexion (même onglet, jamais de fenêtre tardive) ;
 * - garde statique des écrans : plus de formulaire de cookie, plus de lien de
 *   connexion bâti dans l'écran, champs à 16 px, aucun texte brut du serveur,
 *   aucun nom de prestataire, emplacement de la connexion directe vide.
 *
 * Lancer : node --test tests/ux/connexion-cartes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const view = await loadTs('src/components/connections/connectionView.ts');
const target = await loadTs('src/components/connections/returnTarget.ts');
const hosted = await loadTs('src/components/connections/hostedConnect.ts');
const copy = await loadTs('src/lib/connectionCopy.ts');
const status = await loadTs('src/lib/linkedinStatus.ts');

const PROVIDERS = ['linkedin', 'whatsapp', 'google', 'outlook', 'imap'];
const HEALTHS = ['connected', 'syncing', 'connecting', 'limited', 'locked', 'needs_reconnect', 'not_connected', 'unknown'];

// ------------------------------------------------------------------ état d'un compte
test('un seul geste par cause : seul « à reconnecter » propose Reconnecter', () => {
  for (const p of PROVIDERS) {
    const gestes = Object.fromEntries(HEALTHS.map((h) => [h, view.viewOfHealth(h, p).action]));
    assert.deepEqual(gestes, {
      connected: null, syncing: null, connecting: null, limited: null,
      locked: 'contact_support', needs_reconnect: 'reconnect', not_connected: 'connect', unknown: 'refresh',
    }, p);
  }
});

test('connexion limitée : reprise automatique annoncée, aucun bouton ; accès suspendu : le support', () => {
  const limited = view.viewOfHealth('limited', 'linkedin');
  assert.equal(limited.action, null);
  assert.equal(limited.actionLabel, null);
  assert.match(limited.reason, /Nouvelle tentative automatique/);
  assert.equal(limited.tone, 'warning');
  const locked = view.viewOfHealth('locked', 'linkedin');
  assert.equal(locked.actionLabel, 'Contacter le support');
  assert.match(locked.reason, /Se reconnecter n'y change rien/);
  assert.equal(locked.tone, 'danger');
  assert.equal(view.viewOfHealth('needs_reconnect', 'google').actionLabel, 'Reconnecter');
  assert.equal(view.viewOfHealth('not_connected', 'google').actionLabel, 'Connecter Gmail');
});

test('un compte qui a disparu se remplace par une nouvelle connexion', () => {
  assert.equal(view.cardAction(view.viewOfHealth('needs_reconnect', 'linkedin'), true), 'connect');
  assert.equal(view.cardAction(view.viewOfHealth('needs_reconnect', 'linkedin'), false), 'reconnect');
  assert.equal(view.cardAction(view.viewOfHealth('limited', 'linkedin'), false), null);
});

test('chaque classe de santé a un mot, une teinte et une pastille de thème', () => {
  for (const h of HEALTHS) {
    const v = view.viewOfHealth(h, 'linkedin');
    assert.ok(v.label.length > 0, h);
    assert.ok(view.TONE_DOT[v.tone], `${h} : pastille`);
    assert.ok(view.TONE_TEXT[v.tone], `${h} : texte`);
    assert.doesNotMatch(`${view.TONE_DOT[v.tone]} ${view.TONE_TEXT[v.tone]}`, /(?:slate|gray|zinc|red|amber|emerald|green|blue)-\d/, `${h} : couleur brute`);
  }
});

test('la synchronisation d\'un compte actif donne « syncing », et la liste la fournit à la carte', () => {
  assert.equal(status.classifyConnectionHealth({ status: 'OK', sync: 'running' }), 'syncing');
  const li = status.resolveMyLinkedInStatus({
    userId: 'u1', mappings: [{ user_id: 'u1', linkedin_account_id: 'acc_1' }], mappingsLoaded: true,
    accounts: [{ id: 'acc_1', status: 'OK', initial_sync_status: 'running' }], accountsLoaded: true,
  });
  assert.equal(li.state, 'syncing');
  assert.equal(li.isUsable, true);
  const locked = status.resolveMyLinkedInStatus({
    userId: 'u1', mappings: [{ user_id: 'u1', linkedin_account_id: 'acc_1' }], mappingsLoaded: true,
    accounts: [{ id: 'acc_1', status: 'OK', is_locked: true }], accountsLoaded: true,
  });
  assert.equal(locked.state, 'locked');
});

test('fournisseur de messagerie, offre LinkedIn et date de liaison', () => {
  assert.equal(view.emailProviderOf('GOOGLE'), 'google');
  assert.equal(view.emailProviderOf('google_oauth'), 'google');
  assert.equal(view.emailProviderOf('OUTLOOK'), 'outlook');
  assert.equal(view.emailProviderOf('IMAP'), 'imap');
  assert.equal(view.emailProviderOf('MAIL'), 'imap');
  assert.equal(view.emailProviderOf('TRUC'), null);
  assert.equal(view.emailProviderOf(null), null);
  assert.equal(view.offerLabelOf({ classic: true, recruiter: true }), 'LinkedIn Recruiter');
  assert.equal(view.offerLabelOf({ classic: true, sales_navigator: true }), 'Sales Navigator');
  assert.equal(view.offerLabelOf({ classic: true }), 'LinkedIn Classic');
  assert.equal(view.offerLabelOf(null), null);
  assert.equal(view.sinceDate('2026-09-12T10:00:00Z'), '12/09/2026');
  assert.equal(view.sinceDate('nope'), null);
  assert.equal(view.sinceDate(null), null);
});

// ------------------------------------------------------------------ où revenir
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const ID = '3f2b8c1e-9a4d-4e7b-8c21-0d5e6f7a8b9c';

test('la destination notée ne vaut que pour la tentative notée, quelques minutes', () => {
  const storage = memoryStorage();
  assert.equal(target.readReturnTarget(ID, 1000, storage), 'settings', 'rien noté : les Paramètres');
  assert.equal(target.rememberReturnTarget(ID, 'onboarding', 1000, storage), true);
  assert.equal(target.readReturnTarget(ID, 2000, storage), 'onboarding');
  assert.equal(target.readReturnTarget('autre-id', 2000, storage), 'settings', 'autre tentative');
  assert.equal(target.readReturnTarget(null, 2000, storage), 'settings');
  assert.equal(target.readReturnTarget(ID, 1000 + target.RETURN_TARGET_TTL_MS + 1, storage), 'settings', 'périmée');
  assert.equal(target.readReturnTarget(ID, 0, storage), 'onboarding', 'une horloge en retard de moins d\'une minute reste acceptée');
  target.forgetReturnTarget(storage);
  assert.equal(target.readReturnTarget(ID, 2000, storage), 'settings');
});

test('stockage absent, qui refuse ou valeur inattendue : les Paramètres, jamais une erreur', () => {
  assert.equal(target.rememberReturnTarget(ID, 'onboarding', 1, null), false);
  assert.equal(target.readReturnTarget(ID, 1, null), 'settings');
  const refusing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  assert.equal(target.rememberReturnTarget(ID, 'onboarding', 1, refusing), false);
  assert.equal(target.readReturnTarget(ID, 1, refusing), 'settings');
  assert.doesNotThrow(() => target.forgetReturnTarget(refusing));
  for (const raw of ['pas du json', '{}', JSON.stringify({ attemptId: ID, target: '/ailleurs', at: 1 }), JSON.stringify({ attemptId: ID, target: 'onboarding', at: 'x' })]) {
    const s = memoryStorage();
    s.setItem(target.RETURN_TARGET_STORAGE_KEY, raw);
    assert.equal(target.readReturnTarget(ID, 2, s), 'settings', raw);
  }
});

test('la destination est un mot d\'une liste fermée, jamais une adresse', () => {
  assert.deepEqual(target.returnTargetPath('onboarding', true), { pathname: '/onboarding', search: '?li=ok' });
  assert.deepEqual(target.returnTargetPath('onboarding', false), { pathname: '/onboarding', search: '?li=ko' });
  assert.equal(target.returnTargetPath('settings', true), null);
  const src = stripComments(read('src/components/connections/returnTarget.ts'));
  assert.doesNotMatch(src, /https?:\/\//);
});

// ------------------------------------------------------------------ départ vers la page de connexion
const okStart = (url = 'https://connexion.exemple.fr/lien') => async () => ({ ok: true, attemptId: ID, mode: 'hosted', next: { kind: 'redirect', url } });

test('départ : tentative en mode standard, destination notée, état enregistré, puis même onglet', async () => {
  const events = [];
  const calls = [];
  const outcome = await hosted.startHostedConnection({
    api: { start: async (input) => { calls.push(input); return okStart()(); } },
    navigate: (url) => events.push(['navigate', url]),
    remember: (id, t) => events.push(['remember', id, t]),
    onLeave: () => events.push(['leave']),
    timezone: () => 'Europe/Paris',
  }, { provider: 'linkedin', returnTo: 'onboarding' });
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(calls, [{ provider: 'linkedin', mode: 'hosted', locale: 'fr', timezone: 'Europe/Paris', return_to: 'onboarding' }], 'F6 : le serveur garde la destination avec la tentative');
  assert.deepEqual(events, [['remember', ID, 'onboarding'], ['leave'], ['navigate', 'https://connexion.exemple.fr/lien']]);
});

test('départ depuis les Paramètres : rien n\'est noté ; reconnexion : le compte est transmis', async () => {
  const events = [];
  const calls = [];
  await hosted.startHostedConnect?.call;
  await hosted.startHostedConnection({
    api: { start: async (input) => { calls.push(input); return okStart()(); } },
    navigate: (url) => events.push(['navigate', url]),
    remember: () => events.push(['remember']),
    timezone: () => undefined,
  }, { provider: 'google', reconnectAccountId: 'acc_9' });
  assert.deepEqual(events, [['navigate', 'https://connexion.exemple.fr/lien']]);
  assert.deepEqual(calls, [{ provider: 'google', mode: 'hosted', locale: 'fr', reconnect_account_id: 'acc_9' }]);
});

test('départ impossible : une phrase de Konekt, aucune navigation', async () => {
  const navigate = () => assert.fail('aucune navigation');
  const refused = await hosted.startHostedConnection({
    api: { start: async () => ({ ok: false, errorCode: 'rate_limited', message: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' }) },
    navigate,
  }, { provider: 'linkedin' });
  assert.deepEqual(refused, { ok: false, errorCode: 'rate_limited', message: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' });
  // Une étape qui n'est pas une redirection : le texte général, pas un écran vide
  const notRedirect = await hosted.startHostedConnection({
    api: { start: async () => ({ ok: true, attemptId: ID, mode: 'hosted', next: { kind: 'pending' } }) },
    navigate,
  }, { provider: 'whatsapp' });
  assert.equal(notRedirect.ok, false);
  assert.equal(notRedirect.message, copy.GENERIC_FAILURE);
  // Une adresse qui n'est pas en https n'est jamais suivie
  const unsafe = await hosted.startHostedConnection({
    api: { start: okStart('http://connexion.exemple.fr/lien') },
    navigate,
  }, { provider: 'linkedin' });
  assert.equal(unsafe.ok, false);
});

// ------------------------------------------------------------------ écrans
const CARDS = [
  'src/components/settings/MyLinkedInAccount.tsx',
  'src/components/settings/MyEmailAccount.tsx',
  'src/components/settings/MyWhatsAppAccount.tsx',
  'src/components/settings/IntegrationsSettings.tsx',
  'src/components/onboarding/scenes/SceneLinkedIn.tsx',
];
const code = (f) => stripComments(read(f));

test('les cartes partent par la connexion standard : plus de lien bâti dans l\'écran, plus de cookie', () => {
  for (const f of CARDS) {
    const src = code(f);
    assert.doesNotMatch(src, /hosted_auth_link|connect_cookie|connect_credentials|solve_checkpoint|success_redirect_url|failure_redirect_url|org_name/, f);
    assert.doesNotMatch(src, /li_at|li_a\b|User-Agent|userAgent|ReconnectForm|looksLikeLiAt/, f);
  }
  assert.match(code('src/components/settings/MyLinkedInAccount.tsx'), /<HostedConnectButton provider="linkedin"/);
  assert.match(code('src/components/settings/MyLinkedInAccount.tsx'), /<ReconnectButton\s+hosted=\{hosted\}\s+provider="linkedin"\s+accountId=\{myMapping\.linkedin_account_id\}/);
  assert.match(code('src/components/settings/MyWhatsAppAccount.tsx'), /<HostedConnectButton\s+provider="whatsapp"/);
  assert.match(code('src/components/settings/MyWhatsAppAccount.tsx'), /<ReconnectButton\s+hosted=\{hosted\}\s+provider="whatsapp"\s+accountId=\{account\.id\}/);
  assert.match(code('src/components/settings/MyEmailAccount.tsx'), /hosted\.start\(\{ provider, \}?|hosted\.start\(\{ provider \}\)/);
  assert.match(code('src/components/settings/MyEmailAccount.tsx'), /<ReconnectButton\s+hosted=\{hosted\}\s+provider=\{myProvider \?\? 'imap'\}\s+accountId=\{myMapping\.email_account_id\}/, 'Reconnecter la messagerie d\'un compte expiré');
  assert.match(code('src/components/onboarding/scenes/SceneLinkedIn.tsx'), /useHostedConnect\(\)/);
});

test('aucun champ de saisie en text-xs dans les cartes (16 px sur téléphone, pas de zoom)', () => {
  for (const f of CARDS) {
    for (const m of code(f).matchAll(/<(?:Input|Textarea|SelectTrigger)\b[^>]*>/g)) {
      assert.doesNotMatch(m[0], /\btext-xs\b/, `${f} : ${m[0]}`);
    }
  }
});

test('les gestes des pièces communes font 44 px sur téléphone', () => {
  const parts = code('src/components/connections/ConnectionParts.tsx');
  assert.match(parts, /className="w-full max-md:h-11"/, 'bouton de connexion');
  assert.match(parts, /text-muted-foreground hover:text-danger max-sm:flex-1 max-md:h-11/, 'retrait gris au repos');
  assert.match(parts, /<AlertDialogAction variant="destructive" className="max-md:h-11"/);
  assert.match(parts, /aria-live="polite"/, 'état annoncé');
  assert.match(parts, /role="alert"/, 'avis annoncé');
  assert.match(parts, /role="status"/, 'chargement annoncé');
});

test('R7 — les capacités du serveur ne sont demandées que si l\'interrupteur local est allumé', () => {
  const hook = code('src/hooks/useConnection.ts');
  assert.match(hook, /useConnectionCapabilities\(\{ enabled: local \}\)/);
  assert.match(hook, /enabled: wanted && isReady && !!user\?\.id && !!organizationId/);
  assert.ok(hook.indexOf('const local = useConnectionNativeFlag()') < hook.indexOf('useConnectionCapabilities({ enabled: local })'));
});

test('R6 — « Contacter le support » montre aussi l\'adresse, lisible et copiable', () => {
  const parts = code('src/components/connections/ConnectionParts.tsx');
  assert.match(parts, /<a href=\{supportMailto\(channel\)\}>/);
  assert.match(parts, /\{SUPPORT_WRITE_TO\} <span className="select-all">\{SUPPORT_EMAIL\}<\/span>/);
});

test('aucun texte brut du serveur ni d\'une exception dans les cartes', () => {
  const direct = [
    /\{\s*(?:\w+\??\.)*(?:error|err|e|data|result|response)\??\.(?:message|error)\s*\}/,
    /toast\.\w+\(\s*(?:\w+\??\.)*(?:error|err|e|data|result|response)\??\.(?:message|error)\b/,
    /description:\s*(?:err|error|e)\.message/,
  ];
  for (const f of [...CARDS, 'src/components/connections/ConnectionParts.tsx', 'src/components/connections/useHostedConnect.ts', 'src/hooks/useMemberWhatsAppAccounts.ts']) {
    for (const re of direct) assert.doesNotMatch(code(f), re, `${f} : ${re}`);
  }
  // Rattacher ou dissocier un compte LinkedIn : la phrase du serveur passe par le filtre de noms de prestataires
  const hook = code('src/hooks/useMemberLinkedInAccounts.ts');
  assert.match(hook, /actionFailureMessage\(data\?\.error, error\?\.message, "L'association a échoué"\)/);
  assert.match(hook, /actionFailureMessage\(data\?\.error, error\?\.message, 'La dissociation a échoué'\)/);
  const vendor = ['Uni', 'pile'].join('');
  assert.equal(copy.actionFailureMessage(`${vendor} a répondu 500.`, null, 'Repli.'), 'Repli.');
  assert.equal(copy.actionFailureMessage('Phrase de Konekt.', null, 'Repli.'), 'Phrase de Konekt.');
  assert.equal(copy.actionFailureMessage(undefined, 'Problème de connexion réseau.', 'Repli.'), 'Problème de connexion réseau.');
});

test('aucun nom de prestataire dans les textes des cartes ni des pièces communes', () => {
  const VENDORS = /\b(?:unipile|apollo(?:\.io)?|people data labs|pdl|brandfetch|clearbit|logo\.dev|anthropic|claude)\b/i;
  const INTERNAL = /unipile-accounts/g;
  const files = [...CARDS, 'src/components/connections/ConnectionParts.tsx', 'src/components/connections/NativeConnectSlot.tsx', 'src/components/connections/useMyLinkedInAccount.ts',
    'src/components/connections/connectionView.ts', 'src/components/connections/returnTarget.ts', 'src/components/connections/hostedConnect.ts', 'src/components/connections/useHostedConnect.ts'];
  for (const f of files) {
    const strings = [...stripComments(read(f)).replace(INTERNAL, '').matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1|>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g)].map((m) => m[2] ?? m[3]);
    for (const text of strings) assert.doesNotMatch(text, VENDORS, `${f} : « ${text} »`);
  }
});

test('la carte de l\'organisation renvoie vers Connexions : un seul chemin pour connecter son compte', () => {
  const src = code('src/components/settings/IntegrationsSettings.tsx');
  assert.match(src, /<Link to=\{`\$\{SETTINGS_PATHS\.connections\}#linkedin`\}>\{ORG_LINKEDIN_CARD\.goToConnections\}<\/Link>/);
  assert.doesNotMatch(src, /Connecter un compte LinkedIn/);
  assert.match(src, /readableConnectionName\(account\.name, 'linkedin'\)/);
  assert.match(src, /memberName\(getMappingForAccount\(account\.id\)\?\.user_id\)/, 'le membre propriétaire du compte');
  assert.match(src, /<AlertDialogTitle>\{REMOVE_ACCOUNT\.title\}<\/AlertDialogTitle>/);
  assert.doesNotMatch(src, /supprimé de la plateforme/);
  // Le texte de l'échec vient de Konekt, le détail va dans la console
  assert.match(src, /toast\.error\(ORG_LINKEDIN_CARD\.removeFailed\)/);
});

test('l\'emplacement de la connexion directe existe sur chaque carte et ne montre rien tant qu\'une des deux conditions manque', () => {
  const slot = code('src/components/connections/NativeConnectSlot.tsx');
  assert.match(slot, /export const NATIVE_FLOW_LOADER = \(\(\) => import\('\.\/native\/NativeConnectFlow'\)\) as NativeFlowLoader \| null;/, 'l\'assistant est chargé à la demande');
  assert.match(slot, /if \(!Flow \|\| !allowed\) return null;/);
  assert.match(slot, /useNativeScreens\(props\.provider\)/, 'serveur ET interrupteur local');
  assert.match(slot, /lazy\(NATIVE_FLOW_LOADER\)/, 'chargé à la demande');
  for (const f of ['src/components/settings/MyLinkedInAccount.tsx', 'src/components/settings/MyEmailAccount.tsx', 'src/components/settings/MyWhatsAppAccount.tsx']) {
    assert.match(code(f), /<NativeConnectSlot\b/, f);
  }
});

test('le tableau de bord ne prend une connexion limitée, suspendue ou en synchronisation pour une panne', () => {
  const hook = code('src/hooks/useDashboardConnections.ts');
  assert.match(hook, /channelStatusOf\(classifyLinkedInStatus\(raw\)\)/);
  assert.doesNotMatch(hook, /mapUnipileStatus|whatsapp/i);
  assert.equal(status.channelStatusOf(status.classifyLinkedInStatus('DEGRADED')), 'connecting');
  assert.equal(status.channelStatusOf(status.classifyLinkedInStatus('LOCKED')), 'connecting');
  assert.equal(status.channelStatusOf(status.classifyLinkedInStatus('CREDENTIALS')), 'error');
});

test('l\'ancien gestionnaire n\'est plus un écran : il ne garde que la lecture de la correction de licence', () => {
  const src = read('src/components/outreach/LinkedInAccountManager.tsx');
  assert.ok(src.split('\n').length < 40);
  assert.doesNotMatch(stripComments(src), /invokeEdgeFunction|hosted_auth_link|connect_credentials|solve_checkpoint|<Button|useState/);
  assert.match(src, /export function applySubscriptionOverrides/);
});

test('l\'alerte de déconnexion nomme le compte sans état encodé et sépare suspendu de déconnecté', () => {
  const ctx = code('src/contexts/LinkedInAccountsContext.tsx');
  assert.match(ctx, /readableConnectionName\(acc\.name, 'linkedin'\)/);
  assert.match(ctx, /alert === 'locked'/);
  assert.match(ctx, /label: ALERT\.seeAction/);
});

test('F8 — WhatsApp : retrait et actualisation restent bloqués pendant le départ vers la page de connexion', () => {
  const src = code('src/components/settings/MyWhatsAppAccount.tsx');
  assert.match(src, /confirmLabel=\{DISCONNECT_WHATSAPP\.confirm\}\s+disabled=\{disconnect\.isPending \|\| hosted\.busy\}/);
  assert.match(src, /disabled=\{isFetching \|\| disconnect\.isPending \|\| hosted\.busy\}/);
});
