/**
 * Paramètres, lot 2 — coquille à deux portes, adresses et redirections.
 *
 * Invariants épinglés :
 *   - src/lib/settingsRoutes.ts (module pur, sans import) : table des 13 anciens
 *     ?tab=, paramètres conservés (retours de paiement et de Notion, jeton
 *     d'aperçu), kind déduit de l'onglet, idempotence, accès par rôle et type
 *     d'organisation, page d'arrivée, phrase « gérés par » ;
 *   - invariants d'adresses : les liens écrits par le serveur et l'extension
 *     sont tous redirigés ; le front n'écrit plus ?tab= ; chaque lien vers une
 *     rubrique existe, et chaque #ancre citée est posée sur la bonne rubrique ;
 *   - coquille, routes et registre des rubriques, par inspection de source ;
 *   - textes visibles : exacts, et sans nom de fournisseur.
 *
 * settingsRoutes.ts, checkoutReturn.ts et featureGates.ts sont transpilés en
 * mémoire par esbuild (déjà présent via Vite) et chargés par une URL data:,
 * comme dans lot1-paiement-credits.test.mjs. Sans navigateur ni base.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const importTs = async (source) => {
  const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

/** Fichiers d'un dossier, récursivement, filtrés par extension (node_modules exclus). */
const walk = (dir, exts) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules') continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
};
const SRC_FILES = walk('src', ['.ts', '.tsx']);

/** Bloc d'un composant de sections.tsx, jusqu'à la définition suivante en début de ligne. */
const componentBlock = (src, name) => {
  const m = new RegExp(`^(?:export )?(?:function|const) ${name}\\b`, 'm').exec(src);
  assert.ok(m, `${name} introuvable`);
  const rest = src.slice(m.index + m[0].length);
  const next = /^(?:export |function |const |interface |type )/m.exec(rest);
  return rest.slice(0, next ? next.index : rest.length);
};

const VENDORS = /claude|anthropic|unipile|apollo|coresignal|better ?contact|pdl|people data labs|stripe|resend|openai/i;

const routesSrc = read('src/lib/settingsRoutes.ts');
const routes = await importTs(routesSrc);
const {
  SETTINGS_PATHS,
  SETTINGS_DOOR,
  EXTENSION_REVEAL_STORAGE_KEY,
  LEGACY_SETTINGS_TABS,
  resolveLegacySettingsUrl,
  sectionAccess,
  landingPath,
  MANAGED_FALLBACK_NAME,
  managedBySentence,
} = routes;
const { readCheckoutReturn } = await importTs(read('src/lib/checkoutReturn.ts'));
const { hasFeature } = await importTs(read('src/lib/featureGates.ts'));

const app = read('src/App.tsx');
const layout = read('src/components/AppLayout.tsx');
const shell = read('src/pages/Settings.tsx');
const anchor = read('src/components/settings/shell/SettingsAnchor.tsx');
const sections = read('src/components/settings/shell/sections.tsx');
const general = read('src/components/settings/shell/GeneralSection.tsx');
const redirect = read('src/components/settings/shell/LegacySettingsRedirect.tsx');

const OLD_TABS = [
  'general', 'account', 'templates', 'ai-context', 'agent-actions', 'presets', 'team',
  'agency', 'connectors', 'integrations', 'billing', 'credits', 'marketplace',
];
const SECTION_IDS = ['connections', 'writing', 'journal', 'general', 'team', 'billing', 'assistant'];

/** Adresse de sortie de resolveLegacySettingsUrl (§3.1), sans les paramètres. */
const TABLE = {
  general: ['/settings/org/general', ''],
  account: ['/settings/account/connections', ''],
  templates: ['/settings/account/writing', '#modeles'],
  'ai-context': ['/settings/account/writing', '#style'],
  'agent-actions': ['/settings/org/assistant', '#resume'],
  presets: ['/settings/org/assistant', '#icp'],
  team: ['/settings/org/team', ''],
  agency: ['/settings/org/team', ''],
  connectors: ['/settings/org/general', '#outils'],
  integrations: ['/settings/org/general', '#outils'],
  billing: ['/settings/org/billing', ''],
  credits: ['/settings/org/billing', '#credits'],
  marketplace: ['/marketplace', ''],
};

/** Toutes les entrées essayées, rejouées par le test d'idempotence. */
const SAMPLE_INPUTS = [];
const resolve = (pathname, search, hash = '') => {
  SAMPLE_INPUTS.push([pathname, search, hash]);
  return resolveLegacySettingsUrl(pathname, search, hash);
};
const paramsOf = (out) => new URLSearchParams(out.search);

// ---------------------------------------------------------------- 1. Module pur
test('L2-1 — settingsRoutes.ts ne contient aucune instruction d’import', () => {
  assert.doesNotMatch(routesSrc, /^\s*import\b/m, 'tests/ux le charge seul via une URL data:');
  // R10 (lot1-paiement-credits) : aucune lecture brute du retour de paiement hors de checkoutReturn.ts.
  assert.doesNotMatch(routesSrc, /get\(\s*['"]checkout['"]\s*\)|readCheckoutReturn\(/);
});

// ---------------------------------------------------------------- 2. Table §3.1
test('L2-2 — les 13 anciens onglets mènent à leur rubrique et à leur ancre', () => {
  for (const [tab, [pathname, hash]] of Object.entries(TABLE)) {
    const out = resolve('/settings', `?tab=${tab}`);
    assert.ok(out, tab);
    assert.equal(out.pathname, pathname, tab);
    assert.equal(out.hash, hash, tab);
    assert.equal(out.search, '', `${tab} : tab retiré, rien d'autre à garder`);
  }
});

test('L2-2 — onglet vide, inconnu ou piège du prototype : /settings, sans lire le prototype', () => {
  for (const tab of ['', 'xyz', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const out = resolve('/settings', `?tab=${tab}`);
    assert.deepEqual(out, { pathname: '/settings', search: '', hash: '', revealExtension: false }, `tab=${tab}`);
  }
});

test('L2-2 — la valeur de tab est lue sans casse ni espaces', () => {
  const out = resolve('/settings', '?tab=%20Credits%20');
  assert.equal(out.pathname, '/settings/org/billing');
  assert.equal(out.hash, '#credits');
  assert.equal(resolve('/settings', '?tab=BILLING').pathname, '/settings/org/billing');
});

// ---------------------------------------------------------------- 3. Portée
test('L2-3 — null hors de /settings?tab= ; /settings/ est accepté', () => {
  assert.equal(resolveLegacySettingsUrl('/settings', '', ''), null);
  assert.equal(resolveLegacySettingsUrl('/settings', '?foo=1', ''), null);
  assert.equal(resolveLegacySettingsUrl('/settings/org/billing', '?tab=credits', ''), null);
  assert.equal(resolveLegacySettingsUrl('/dashboard', '?tab=credits', ''), null);
  const out = resolve('/settings/', '?tab=credits');
  assert.ok(out, '/settings/ doit être redirigé');
  assert.equal(out.pathname, '/settings/org/billing');
});

// ---------------------------------------------------------------- 4. Notion
test('L2-4 — retour Notion : Connexions #notion, notion_* gardés, tab retiré, Notion prime', () => {
  const failed = resolve('/settings', '?tab=agent-actions&notion_oauth=error&notion_error=state_missing');
  assert.equal(failed.pathname, '/settings/account/connections');
  assert.equal(failed.hash, '#notion');
  assert.equal(paramsOf(failed).get('notion_oauth'), 'error');
  assert.equal(paramsOf(failed).get('notion_error'), 'state_missing');
  assert.equal(paramsOf(failed).has('tab'), false);

  const connected = resolve('/settings', '?notion_oauth=connected');
  assert.ok(connected, 'un retour Notion sans tab est redirigé');
  assert.equal(connected.pathname, '/settings/account/connections');
  assert.equal(connected.hash, '#notion');
  assert.equal(paramsOf(connected).get('notion_oauth'), 'connected');

  const errorOnly = resolve('/settings', '?notion_error=access_denied');
  assert.equal(errorOnly.pathname, '/settings/account/connections');

  const overBilling = resolve('/settings', '?tab=billing&notion_oauth=connected');
  assert.equal(overBilling.pathname, '/settings/account/connections', 'Notion l’emporte sur l’onglet');
  assert.equal(overBilling.hash, '#notion');
  assert.equal(paramsOf(overBilling).has('kind'), false);
});

// ---------------------------------------------------------------- 5. Paramètres gardés
test('L2-5 — tous les paramètres sauf tab sont gardés, valeurs comprises', () => {
  const input = '?tab=credits&__lovable_token=a%2Bb&x=1&email=a%40b.fr&q=un+deux';
  const out = resolve('/settings', input);
  const before = new URLSearchParams(input);
  const after = paramsOf(out);
  assert.equal(after.has('tab'), false);
  for (const key of ['__lovable_token', 'x', 'email', 'q']) {
    assert.equal(after.get(key), before.get(key), key);
  }
  assert.equal(after.get('__lovable_token'), 'a+b');
  assert.equal(after.get('q'), 'un deux');
  assert.deepEqual([...after.keys()], ['__lovable_token', 'x', 'email', 'q'], 'ordre conservé');
});

test('L2-5 — deux tab : le premier gagne, les deux sont retirés', () => {
  const out = resolve('/settings', '?tab=credits&tab=team&x=1');
  assert.equal(out.pathname, '/settings/org/billing');
  assert.equal(out.hash, '#credits');
  assert.equal(paramsOf(out).has('tab'), false);
  assert.equal(paramsOf(out).get('x'), '1');
});

// ---------------------------------------------------------------- 6. Hash
test('L2-6 — un hash déjà présent passe avant l’ancre de la table ; « # » seul est ignoré', () => {
  assert.equal(resolve('/settings', '?tab=credits', '#formule').hash, '#formule');
  assert.equal(resolve('/settings', '?tab=credits', '#').hash, '#credits');
  assert.equal(resolve('/settings', '?tab=billing', '#').hash, '');
});

// ---------------------------------------------------------------- 7. kind
test('L2-7 — checkout sans kind : kind déduit de l’onglet ; kind explicite gardé', () => {
  assert.equal(paramsOf(resolve('/settings', '?tab=credits&checkout=success')).get('kind'), 'pack');
  assert.equal(paramsOf(resolve('/settings', '?tab=billing&checkout=cancel')).get('kind'), 'subscription');
  assert.equal(paramsOf(resolve('/settings', '?tab=credits&checkout=success&kind=subscription')).get('kind'), 'subscription');
  const other = resolve('/settings', '?tab=general&checkout=success');
  assert.equal(paramsOf(other).has('kind'), false);
  assert.equal(other.search, '?checkout=success');
  assert.equal(paramsOf(resolve('/settings', '?tab=credits')).has('kind'), false, 'pas de kind sans checkout');
});

test('L2-7 — le retour de paiement se lit pareil avant et après la redirection', () => {
  let n = 0;
  for (const tab of ['credits', 'billing']) {
    for (const status of ['success', 'cancel']) {
      for (const withKind of [true, false]) {
        const kind = tab === 'credits' ? 'pack' : 'subscription';
        const input = `?tab=${tab}&checkout=${status}${withKind ? `&kind=${kind}` : ''}`;
        const out = resolve('/settings', input);
        const expected = readCheckoutReturn(new URLSearchParams(input));
        assert.ok(expected, `${input} : retour lu avant la redirection`);
        assert.deepEqual(readCheckoutReturn(paramsOf(out)), expected, input);
        n += 1;
      }
    }
  }
  assert.equal(n, 8);
});

// ---------------------------------------------------------------- 9. Extension
test('L2-9 — revealExtension n’est vrai que pour account, sans retour Notion', () => {
  for (const tab of OLD_TABS) {
    assert.equal(resolve('/settings', `?tab=${tab}`).revealExtension, tab === 'account', tab);
  }
  assert.equal(resolve('/settings', '?tab=account&notion_oauth=connected').revealExtension, false);
  assert.equal(resolve('/settings', '?tab=xyz').revealExtension, false);
  assert.equal(typeof EXTENSION_REVEAL_STORAGE_KEY, 'string');
  assert.ok(EXTENSION_REVEAL_STORAGE_KEY.length > 0);
});

// ---------------------------------------------------------------- 10. Table
test('L2-10 — la table couvre exactement les 13 anciens onglets', () => {
  assert.deepEqual(Object.keys(LEGACY_SETTINGS_TABS).sort(), [...OLD_TABS].sort());
  assert.ok(Object.isFrozen(LEGACY_SETTINGS_TABS));
});

// ---------------------------------------------------------------- 8. Idempotence
// Déclaré après les autres : rejoue toutes les entrées essayées plus haut.
test('L2-8 — une adresse redirigée ne l’est plus une seconde fois', () => {
  assert.ok(SAMPLE_INPUTS.length > 30, `trop peu d'entrées (${SAMPLE_INPUTS.length})`);
  for (const [pathname, search, hash] of SAMPLE_INPUTS) {
    const out = resolveLegacySettingsUrl(pathname, search, hash);
    if (!out) continue;
    assert.doesNotMatch(out.search, /(^|[?&])tab=/, `${pathname}${search}${hash}`);
    assert.equal(
      resolveLegacySettingsUrl(out.pathname, out.search, out.hash),
      null,
      `${pathname}${search}${hash} → ${out.pathname}${out.search}${out.hash}`,
    );
  }
});

// ---------------------------------------------------------------- 11-13. Invariants d'adresses
test('L2-11 — chaque ?tab= écrit par le serveur ou l’extension est une clé de la table', () => {
  const files = [
    ...walk('supabase/functions', ['.ts', '.tsx', '.mjs', '.js']),
    ...walk('extensions/chrome/src', ['.ts', '.tsx', '.mjs', '.js', '.jsx']),
  ];
  const found = [];
  for (const rel of files) {
    for (const m of read(rel).matchAll(/\/settings\?tab=([a-z-]+)/g)) found.push([rel, m[1]]);
  }
  assert.ok(found.length >= 10, `liens serveur introuvables (${found.length})`);
  for (const [rel, tab] of found) {
    assert.ok(Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_TABS, tab), `${rel} : ?tab=${tab} non redirigé`);
  }
});

test('L2-12 — le front n’écrit plus /settings?tab=, hors de deux exceptions', () => {
  const allowed = new Set(['src/lib/settingsRoutes.ts', 'src/lib/notificationKinds.ts']);
  const offenders = SRC_FILES.filter((rel) => !allowed.has(rel) && read(rel).includes('/settings?tab='));
  assert.deepEqual(offenders, []);
});

test('L2-13 — chaque adresse de rubrique écrite dans src/ existe', () => {
  const known = new Set(Object.values(SETTINGS_PATHS));
  const bad = [];
  let seen = 0;
  for (const rel of SRC_FILES) {
    const src = read(rel);
    assert.ok(!src.includes('/settings/account/profile'), `${rel} : la rubrique Profil n'arrive qu'au lot 5`);
    for (const m of src.matchAll(/\/settings\/(?:account|org)\/[a-z-]+/g)) {
      seen += 1;
      if (!known.has(m[0])) bad.push(`${rel} : ${m[0]}`);
    }
  }
  assert.ok(seen >= 20, `trop peu de liens trouvés (${seen})`);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- 14. Accès
test('L2-14 — rubriques ouvertes : 7, 7, 6, 6 pour un admin ; 3 pour un membre', () => {
  assert.deepEqual(Object.keys(SETTINGS_PATHS).sort(), [...SECTION_IDS].sort());
  const cases = [['enterprise', 7], ['agency', 7], ['freelance', 6], [null, 6]];
  for (const [orgType, adminCount] of cases) {
    const hasTeam = hasFeature(orgType, 'team_management');
    for (const isOwner of [true, false]) {
      const admin = { isAdmin: true, isOwner, orgType, hasTeam };
      const open = SECTION_IDS.filter((id) => sectionAccess(id, admin) === 'open');
      assert.equal(open.length, adminCount, `admin ${orgType} (propriétaire : ${isOwner})`);
      assert.equal(sectionAccess('team', admin), hasTeam ? 'open' : 'team_unavailable', `équipe, admin ${orgType}`);
    }
    const member = { isAdmin: false, isOwner: false, orgType, hasTeam };
    const memberOpen = SECTION_IDS.filter((id) => sectionAccess(id, member) === 'open');
    assert.deepEqual(memberOpen, ['connections', 'writing', 'journal'], `membre ${orgType}`);
    for (const id of ['general', 'team', 'billing', 'assistant']) {
      assert.equal(sectionAccess(id, member), 'managed', `${id}, membre ${orgType}`);
    }
    assert.equal(sectionAccess('journal', member), 'open', 'journal ouvert à tous (D1)');
  }
  assert.equal(hasFeature('freelance', 'team_management'), false);
  assert.equal(hasFeature(null, 'team_management'), false);
  for (const id of SECTION_IDS) {
    assert.equal(SETTINGS_DOOR[id], SETTINGS_PATHS[id].startsWith('/settings/account/') ? 'account' : 'org', id);
  }
});

// ---------------------------------------------------------------- 15. Page d'arrivée
test('L2-15 — page d’arrivée : Général pour un propriétaire sans type, Connexions sinon', () => {
  const v = (isAdmin, isOwner, orgType) => ({ isAdmin, isOwner, orgType, hasTeam: hasFeature(orgType, 'team_management') });
  assert.equal(landingPath(v(true, true, null)), '/settings/org/general');
  assert.equal(landingPath(v(true, true, 'agency')), '/settings/account/connections');
  assert.equal(landingPath(v(true, false, null)), '/settings/account/connections');
  assert.equal(landingPath(v(false, false, null)), '/settings/account/connections');
  assert.equal(landingPath(v(false, false, 'enterprise')), '/settings/account/connections');
});

// ---------------------------------------------------------------- 16. « gérés par »
test('L2-16 — phrase « gérés par » et son repli', () => {
  assert.equal(managedBySentence('Marie Dubois'), 'Les réglages de l’organisation sont gérés par Marie Dubois.');
  assert.equal(managedBySentence('  Marie Dubois  '), 'Les réglages de l’organisation sont gérés par Marie Dubois.');
  for (const empty of ['', '  ', null, undefined]) {
    assert.equal(managedBySentence(empty), 'Les réglages de l’organisation sont gérés par votre administrateur.', String(empty));
  }
  assert.equal(MANAGED_FALLBACK_NAME, 'votre administrateur');
});

// ---------------------------------------------------------------- 17. Code source
test('L2-17 — App et AppLayout : route /settings/*, redirection avant la garde, clé partagée', () => {
  const line = app.split('\n').find((l) => l.includes('path="/settings/*"'));
  assert.ok(line, 'route /settings/* absente');
  const iRedirect = line.indexOf('<LegacySettingsRedirect>');
  assert.ok(iRedirect >= 0 && iRedirect < line.indexOf('<ProtectedRoute>'), 'la redirection passe avant la garde de connexion (D3)');
  assert.doesNotMatch(app, /path="\/settings" element/, 'l’ancienne route exacte a disparu');
  assert.match(layout, /startsWith\('\/settings\/'\)/);
  assert.match(layout, /key=\{transitionKey\}/);
});

test('L2-17 — coquille : navigation, historique, focus, sans les anciens onglets', () => {
  for (const needle of [
    '(min-width: 1024px)',
    'useSyncExternalStore',
    'aria-label="Rubriques des paramètres"',
    '<Route index',
    'path="*"',
    'key={s.id}',
    'focusHeading',
    'fromList',
    'navigate(-1)',
    'lastPhoneSection',
    'aria-label="Retour aux paramètres"',
  ]) {
    assert.ok(shell.includes(needle), `Settings.tsx : ${needle} absent`);
  }
  assert.doesNotMatch(shell, /useIsMobile/, 'seuil de 768 px, faux au premier rendu');
  // Passer 1024 px ne remonte pas la rubrique : {routes} garde la même place dans l'arbre.
  assert.equal(shell.split('>{routes}<').length - 1, 1, 'une seule position pour {routes}');
  // Ancre : une navigation avec hash relance l'alignement ; le remplacement sans hash
  // des lecteurs de retour (setSearchParams) ne l'interrompt pas.
  assert.ok(shell.includes("if (hash.length > 1 && key !== target.current.key)"));
  assert.ok(shell.includes('}, [paneRef, trigger]);'));
  assert.doesNotMatch(shell, /role="tablist"/);
  assert.doesNotMatch(shell, /resolveTab/);
});

test('L2-17 — ancre, registre et redirection', () => {
  assert.match(anchor, /scroll-mt-20/);
  assert.match(anchor, /empty:hidden/);

  const connections = componentBlock(sections, 'ConnectionsSection');
  const order = ['<MyLinkedInAccount', '<MyEmailAccount', '<NotionConnectionCard', '<ExtensionTokens'].map((t) => connections.indexOf(t));
  assert.ok(order.every((i) => i >= 0), 'une carte de Connexions manque');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordre : LinkedIn, e-mail, Notion, extension');

  for (const id of ['linkedin', 'email', 'notion', 'extension', 'style', 'modeles', 'signatures', 'formule', 'credits', 'consignes', 'resume', 'icp', 'connecteurs']) {
    assert.ok(sections.includes(`id="${id}"`), `ancre #${id} absente de sections.tsx`);
  }

  // Mémo consommé dans un effet : l'initialiseur de useState passe deux fois en StrictMode.
  const iRemove = sections.indexOf('sessionStorage.removeItem(EXTENSION_REVEAL_STORAGE_KEY');
  assert.ok(iRemove >= 0, 'le mémo de l’extension n’est jamais consommé');
  assert.equal(sections.split('sessionStorage.removeItem(').length - 1, 1);
  assert.ok(sections.lastIndexOf('useEffect(', iRemove) > sections.lastIndexOf('useState(', iRemove), 'removeItem doit être dans un useEffect');

  assert.ok(general.includes('<SettingsAnchor id="outils">'));
  assert.doesNotMatch(general, /from ['"]\.\/sections['"]/, 'import circulaire sections ↔ GeneralSection');

  const iSet = redirect.indexOf('sessionStorage.setItem(EXTENSION_REVEAL_STORAGE_KEY');
  assert.ok(iSet >= 0, 'le mémo de l’extension n’est jamais posé (D13)');
  const iTry = redirect.lastIndexOf('try {', iSet);
  assert.ok(iTry >= 0 && redirect.indexOf('catch', iTry) > iSet, 'stockage indisponible : setItem dans un try/catch');
});

test('L2-17 — composants remontés, palette et menu de l’avatar', () => {
  const actions = read('src/components/settings/AgentActionsSettings.tsx');
  assert.doesNotMatch(actions, /<AgentPoliciesSettings/);
  assert.doesNotMatch(actions, /<AgentConnectorsSettings/);
  assert.doesNotMatch(read('src/components/settings/AgentConnectorsSettings.tsx'), /<NotionConnectionCard/);

  const aiContext = read('src/components/settings/AiContextSettings.tsx');
  assert.match(aiContext, /export const UserContextCard/);
  assert.match(aiContext, /export const OrgContextCard/);

  const palette = read('src/components/layout/NavigationPalette.tsx');
  assert.ok(palette.includes("isAdmin && hasFeature(orgType, 'team_management')"));
  assert.ok(palette.includes('/settings/org/team'));
  assert.ok(palette.includes('/settings/org/billing'));
  assert.ok(palette.includes('Abonnement et crédits'));

  const menu = read('src/components/sidebar/SidebarUserMenu.tsx');
  assert.ok(menu.includes('Mon compte'));
  assert.ok(!menu.includes('Mon profil'), 'la rubrique Profil n’arrive qu’au lot 5 (D9)');
});

// ---------------------------------------------------------------- Textes exacts (§1)
test('L2-17 — libellés, introductions et phrases de la coquille', () => {
  for (const text of [
    'Connexions', 'Rédaction', 'Journal de l’assistant', 'Général', 'Équipe', 'Abonnement et crédits', 'Règles de l’assistant',
    'Les comptes que Konekt utilise en votre nom.',
    'Comment l’assistant écrit pour vous, et vos textes prêts à l’emploi.',
    'Ce que l’assistant a proposé et fait, et ce qui attend votre accord.',
    'L’identité de l’organisation et ses outils reliés.',
    'Qui travaille avec vous, et avec quels droits.',
    'Votre formule, vos crédits et ce que vous consommez.',
    'Ce que l’assistant fait pour toute l’organisation.',
    'Seul un administrateur peut ajouter des crédits ou changer de formule.',
  ]) {
    assert.ok(sections.includes(`'${text}'`), `sections.tsx : « ${text} » absent`);
  }
  assert.ok(shell.includes('Équipe n’est proposée qu’aux organisations Entreprise et Cabinet. Le type se règle dans'));
  assert.match(shell, /<Link to=\{SETTINGS_PATHS\.general\}[^>]*>Général<\/Link>/);
  assert.match(shell, /aria-label="Retour aux paramètres"[\s\S]{0,1500}Paramètres\s*<\/Link>/);
});

// ---------------------------------------------------------------- 18. Fournisseurs
/** Littéraux de chaîne et textes JSX d'un fichier, sans commentaires ni chemins d'import. */
const visibleStrings = (src) => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '')
    .replace(/\bimport\(\s*(['"])[^'"\n]*\1\s*\)/g, '');
  return [
    ...[...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    // Texte JSX : après une balise, jusqu'à la suivante ou à une expression {…} ;
    // ni = ni ; (écarte le code qui suit une flèche =>).
    ...[...code.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ];
};

test('L2-18 — aucun nom de fournisseur dans les textes des fichiers de la coquille', () => {
  const files = [
    'src/lib/settingsRoutes.ts',
    'src/hooks/useOrgManagerName.ts',
    'src/pages/Settings.tsx',
    'src/components/settings/shell/LegacySettingsRedirect.tsx',
    'src/components/settings/shell/SettingsAnchor.tsx',
    'src/components/settings/shell/sections.tsx',
    'src/components/settings/shell/GeneralSection.tsx',
    'src/components/settings/shell/TeamSection.tsx',
  ];
  // Le filtre écarte bien les identifiants : resendInvitation (TeamSection) ne compte pas.
  assert.deepEqual(visibleStrings('const { resendInvitation } = useX(); // Stripe\nconst a = "Base Konekt";'), ['Base Konekt']);
  for (const rel of files) {
    for (const text of visibleStrings(read(rel))) {
      assert.doesNotMatch(text, VENDORS, `${rel} : « ${text} »`);
    }
  }
});

// ---------------------------------------------------------------- 19. Ancres
/** Rubrique de chaque ancre (§1). */
const ANCHOR_SECTION = {
  linkedin: 'connections', email: 'connections', notion: 'connections', extension: 'connections',
  style: 'writing', modeles: 'writing', signatures: 'writing',
  outils: 'general',
  formule: 'billing', credits: 'billing',
  consignes: 'assistant', resume: 'assistant', icp: 'assistant', connecteurs: 'assistant',
};

test('L2-19 — chaque #ancre citée par un lien existe, sur la bonne rubrique', () => {
  const blocks = {
    connections: componentBlock(sections, 'ConnectionsSection'),
    writing: componentBlock(sections, 'WritingSection'),
    billing: componentBlock(sections, 'BillingSection'),
    assistant: componentBlock(sections, 'AssistantSection'),
    general: general,
  };
  for (const [id, section] of Object.entries(ANCHOR_SECTION)) {
    assert.ok(blocks[section].includes(`id="${id}"`), `#${id} n'est pas posée dans la rubrique ${section}`);
  }

  const links = [];
  for (const rel of SRC_FILES) {
    for (const m of read(rel).matchAll(/(\/settings\/(?:account|org)\/[a-z-]+)#([a-z-]+)/g)) links.push([rel, m[1], m[2]]);
  }
  assert.ok(links.length >= 8, `trop peu de liens à ancre (${links.length})`);
  for (const [rel, path, id] of links) {
    assert.ok(Object.prototype.hasOwnProperty.call(ANCHOR_SECTION, id), `${rel} : #${id} n'existe dans aucune rubrique`);
    assert.equal(path, SETTINGS_PATHS[ANCHOR_SECTION[id]], `${rel} : #${id} n'est pas sur ${path}`);
  }
  // Les ancres de la table des anciens onglets existent aussi.
  for (const [tab, { pathname, hash }] of Object.entries(LEGACY_SETTINGS_TABS)) {
    if (!hash) continue;
    const id = hash.slice(1);
    assert.equal(pathname, SETTINGS_PATHS[ANCHOR_SECTION[id]], `?tab=${tab} → ${pathname}${hash}`);
  }
});

// ---------------------------------------------------------------- 20. Anciens noms
test('L2-20 — plus aucun renvoi vers un ancien onglet dans src/', () => {
  const OLD_NAMES = [
    'onglet Crédits IA',
    'Paramètres > Abonnement',
    'Paramètres &gt; Abonnement',
    'Paramètres > Mon compte',
    'Paramètres, Crédits IA',
  ];
  const offenders = [];
  for (const rel of SRC_FILES) {
    const src = read(rel);
    for (const old of OLD_NAMES) if (src.includes(old)) offenders.push(`${rel} : ${old}`);
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------- §3.2 et §3.4
test('§3.2 — les liens du front visent directement les nouvelles rubriques', () => {
  const EXPECTED = [
    ['src/components/sidebar/SidebarUserMenu.tsx', ['/settings/org/billing#credits', '/settings/account/connections']],
    ['src/components/layout/NavigationPalette.tsx', ['/settings/org/team', '/settings/org/billing']],
    ['src/components/ai/LowCreditBanner.tsx', ['/settings/org/billing#credits']],
    ['src/components/outreach/result-card/BulkEnrichButton.tsx', ['/settings/org/billing#credits']],
    ['src/components/outreach/result-card/EnrichContactButton.tsx', ['/settings/org/billing#credits']],
    ['src/lib/invokeWithCredits.ts', ['/settings/org/billing#credits']],
    ['src/components/dashboard/DashboardConnections.tsx', ['/settings/account/connections']],
    ['src/components/outreach/search/LinkedInReconnectBanner.tsx', ['/settings/account/connections']],
    ['src/components/missions/EmptyLinkedInAccountState.tsx', ['/settings/account/connections']],
    ['src/contexts/LinkedInAccountsContext.tsx', ['/settings/account/connections']],
    ['src/hooks/useLinkedInSearchActions.ts', ['/settings/account/connections']],
    ['src/pages/Onboarding.tsx', ['/settings/account/connections']],
    ['src/components/onboarding/WelcomeOnboardingModal.tsx', ['/settings/account/connections']],
    ['src/components/agent/AgentChatPanel.tsx', ['/settings/account/connections#email']],
    ['src/components/assistant-ui/connector-menu.tsx', ['/settings/account/connections#notion', '/settings/account/connections#email']],
    ['src/components/outreach/inbox/MessageComposer.tsx', ['/settings/account/writing#modeles']],
    ['src/components/missions/PedigreePresetSelector.tsx', ['/settings/org/assistant#icp']],
    ['src/pages/ATS.tsx', ['/settings/org/general#outils']],
    ['src/components/settings/InviteMemberForm.tsx', ['/settings/org/billing']],
    ['src/pages/Marketplace.tsx', ['/settings/org/general']],
    ['src/pages/PrivacyExtension.tsx', ['/settings/account/connections#extension']],
  ];
  for (const [rel, targets] of EXPECTED) {
    const src = read(rel);
    for (const target of targets) assert.ok(src.includes(target), `${rel} : ${target} absent`);
  }
  // Liens écrits en littéraux : settingsRoutes reste interne à la coquille (§3.2).
  for (const [rel] of EXPECTED) {
    assert.doesNotMatch(read(rel), /from ['"]@\/lib\/settingsRoutes['"]/, `${rel} importe settingsRoutes`);
  }
});

test('§3.4 — les textes renvoient aux nouvelles rubriques', () => {
  const EXPECTED = [
    ['src/components/assistant-ui/chat-adapter.ts', 'Un administrateur peut en ajouter dans Paramètres › Abonnement et crédits. Renvoyez ensuite votre message.'],
    ['src/lib/invokeEdgeFunction.ts', 'Crédits IA insuffisants. Un administrateur peut en ajouter dans Paramètres › Abonnement et crédits.'],
    ['src/components/outreach/result-card/BulkEnrichButton.tsx', 'Lot arrêté : un abonnement est nécessaire (Paramètres › Abonnement et crédits)'],
    ['src/components/outreach/result-card/EnrichContactButton.tsx', 'Paramètres › Abonnement et crédits'],
    ['src/hooks/useCandidateEnrichment.ts', 'Choisissez un forfait dans Paramètres › Abonnement et crédits.'],
    ['src/hooks/useLinkedInSearchActions.ts', '(Paramètres › Connexions)'],
    ['src/hooks/useLinkedInSearchActions.ts', 'Reconnectez votre compte dans Paramètres › Connexions.'],
    ['src/pages/Pricing.tsx', 'Paramètres, Abonnement et crédits'],
    ['src/pages/PrivacyExtension.tsx', 'Paramètres → Connexions'],
    ['src/components/sidebar/SidebarUserMenu.tsx', 'Mon compte'],
    ['src/components/layout/NavigationPalette.tsx', 'Abonnement et crédits'],
  ];
  for (const [rel, text] of EXPECTED) assert.ok(read(rel).includes(text), `${rel} : « ${text} » absent`);
  assert.ok(read('src/components/assistant-ui/chat-adapter.ts').split('Paramètres › Abonnement et crédits').length - 1 >= 2, 'chat-adapter : les deux messages de crédits');
  const pricing = read('src/pages/Pricing.tsx');
  assert.ok(!/Paramètres, Abonnement(?! et crédits)/.test(pricing), 'Pricing.tsx : « Paramètres, Abonnement » seul subsiste');
});
