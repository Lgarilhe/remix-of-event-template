/**
 * Ce que l'application dit à un membre quand son compte LinkedIn change d'état (constat F12 de la visite
 * du 12/10/2026) : un seul prédicat, lu par le bandeau du tableau de bord et par la ligne et le chiffre
 * d'« À traiter » (src/lib/linkedinStatus.ts, linkedInOutageKind et myLinkedInOutage).
 *
 * - à reconnecter (CREDENTIALS, ERROR et statuts proches, compte disparu) : bandeau « Reconnecter » ;
 * - connexion partielle (PARTIAL : un produit demande une nouvelle authentification) : bandeau, ligne et
 *   chiffre, avec « Reconnecter ». Le bandeau et la notification du récepteur d'événements disent la phrase de
 *   la carte de connexion, mot pour mot ; la ligne d'« À traiter », qui n'a qu'une ligne de sous-titre dans la
 *   barre de 256 px, dit le geste en 30 caractères au plus (le survol seul ne se lit pas au toucher) et porte la
 *   phrase entière dans son texte de survol (`hint` de SidebarRow) ;
 * - accès restreint (LOCKED, ou is_locked) : bandeau et ligne sans « Reconnecter » (se reconnecter n'y
 *   change rien) ;
 * - connexion limitée (DEGRADED) seule : état de carte seulement, ni bandeau, ni ligne, ni chiffre.
 *   La classe de santé de la carte ne change pas (PARTIAL reste « à reconnecter » sur la carte).
 *
 * Lancer : node --test tests/ux/etat-compte-alertes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { build } from 'esbuild';
import { loadTs, read, ROOT } from './connexion-helpers.mjs';

const status = await loadTs('src/lib/linkedinStatus.ts');
const { linkedInOutageKind, myLinkedInOutage, classifyConnectionHealth, resolveMyLinkedInStatus } = status;
const { todoCount } = await loadTs('src/lib/sidebarSignals.ts');
const copyModule = await loadTs('src/lib/connectionCopy.ts');
const { causeReason } = copyModule;
/** La phrase que la carte de connexion montre pour PARTIAL : bandeau, ligne et notification la reprennent. */
const PARTIAL_SENTENCE = 'Une partie de la connexion LinkedIn demande une nouvelle authentification. Reconnectez le compte pour reprendre les envois.';

// --------------------------------------------------------------------------- Prédicat pur
test('linkedInOutageKind : à reconnecter pour CREDENTIALS, ERROR et statuts proches', () => {
  for (const s of ['CREDENTIALS', 'ERROR', 'errored', 'disconnected', 'DISCONNECTED', 'STOPPED', 'PERMISSIONS', 'DELETED', 'CAPTCHA']) {
    assert.equal(linkedInOutageKind({ status: s }), 'reconnect', s);
  }
});

test('linkedInOutageKind : LOCKED, ou is_locked sur un compte actif ou limité : restreint', () => {
  assert.equal(linkedInOutageKind({ status: 'LOCKED' }), 'locked');
  assert.equal(linkedInOutageKind({ status: 'locked' }), 'locked');
  assert.equal(linkedInOutageKind({ status: 'OK', isLocked: true }), 'locked');
  assert.equal(linkedInOutageKind({ status: 'DEGRADED', isLocked: true }), 'locked');
});

test('linkedInOutageKind : PARTIAL est une connexion partielle, à reconnecter avec sa propre phrase', () => {
  for (const s of ['PARTIAL', 'partial', ' Partial ']) {
    assert.equal(linkedInOutageKind({ status: s }), 'partial', s);
  }
  // Comme la carte (needs_reconnect avant locked) : un PARTIAL verrouillé reste à reconnecter.
  assert.equal(linkedInOutageKind({ status: 'PARTIAL', isLocked: true }), 'partial');
});

test('linkedInOutageKind : DEGRADED seul est un état de carte, pas une panne à signaler', () => {
  for (const s of ['DEGRADED', 'degraded', ' Degraded ']) {
    assert.equal(linkedInOutageKind({ status: s }), null, s);
  }
});

test('linkedInOutageKind : connecté, en synchronisation, en connexion, inconnu : rien', () => {
  for (const s of ['OK', 'RUNNING', 'CONNECTING', 'UNKNOWN', 'PAUSED', 'NOUVEAU_CODE', '', null, undefined]) {
    assert.equal(linkedInOutageKind({ status: s }), null, String(s));
  }
  assert.equal(linkedInOutageKind({ status: 'OK', sync: 'running' }), null);
});

test('linkedInOutageKind : un compte à reconnecter le reste même verrouillé (comme la carte)', () => {
  assert.equal(linkedInOutageKind({ status: 'CREDENTIALS', isLocked: true }), 'reconnect');
  assert.equal(linkedInOutageKind({ status: 'ERROR', isLocked: true }), 'reconnect');
});

test('la classe de santé de la carte ne bouge pas : PARTIAL reste needs_reconnect, DEGRADED limited, LOCKED locked', () => {
  assert.equal(classifyConnectionHealth({ status: 'PARTIAL' }), 'needs_reconnect');
  assert.equal(classifyConnectionHealth({ status: 'DEGRADED' }), 'limited');
  assert.equal(classifyConnectionHealth({ status: 'LOCKED' }), 'locked');
  assert.equal(resolveMyLinkedInStatus({
    userId: 'u1', mappings: [{ user_id: 'u1', linkedin_account_id: 'a1', account_status: 'OK' }], mappingsLoaded: true,
    accounts: [{ id: 'a1', status: 'PARTIAL' }], accountsLoaded: true,
  }).state, 'needs_reconnect');
});

// --------------------------------------------------------------------------- Compte de la personne
const ME = 'u1';
const mapping = (account_status) => ({ user_id: ME, linkedin_account_id: 'a1', account_status });
const withList = (account, mapStatus = 'OK') => ({
  userId: ME, mappings: [mapping(mapStatus)], mappingsLoaded: true, accounts: account ? [account] : [], accountsLoaded: true,
});
const withoutList = (mapStatus) => ({
  userId: ME, mappings: [mapping(mapStatus)], mappingsLoaded: true, accounts: [], accountsLoaded: false,
});

test('myLinkedInOutage : inconnu tant que les liaisons ne sont pas reçues, rien sans liaison à soi', () => {
  assert.equal(myLinkedInOutage({ ...withoutList('OK'), mappingsLoaded: false, mappings: [] }), null);
  assert.equal(myLinkedInOutage({ ...withoutList('OK'), userId: null }), null);
  assert.equal(myLinkedInOutage({ ...withoutList('OK'), mappings: [{ ...mapping('CREDENTIALS'), user_id: 'u2' }] }), false);
});

test('myLinkedInOutage, liste des comptes reçue : à reconnecter, partiel, restreint, rien', () => {
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'CREDENTIALS' })), 'reconnect');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'ERROR' })), 'reconnect');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'LOCKED' })), 'locked');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'OK', is_locked: true })), 'locked');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'OK' })), false);
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'DEGRADED' })), false);
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'PARTIAL' })), 'partial');
  assert.equal(myLinkedInOutage(withList(null)), 'reconnect', 'compte disparu : à reconnecter');
});

test('myLinkedInOutage, sans liste : le statut enregistré sur la liaison fait foi', () => {
  assert.equal(myLinkedInOutage(withoutList('CREDENTIALS')), 'reconnect');
  assert.equal(myLinkedInOutage(withoutList('ERROR')), 'reconnect');
  assert.equal(myLinkedInOutage(withoutList('LOCKED')), 'locked');
  assert.equal(myLinkedInOutage(withoutList('OK')), false);
  assert.equal(myLinkedInOutage(withoutList('DEGRADED')), false);
  assert.equal(myLinkedInOutage(withoutList('PARTIAL')), 'partial');
});

test('retour à OK : la panne disparaît quel que soit son genre (jamais au clic)', () => {
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'LOCKED' }, 'LOCKED')), 'locked');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'OK' }, 'OK')), false);
  assert.equal(myLinkedInOutage(withoutList('OK')), false);
});

// --------------------------------------------------------------------------- Rendus
const stubs = {
  name: 'stubs',
  setup(b) {
    // La ligne et la section de la barre latérale demandent un SidebarProvider : leur rendu est remplacé
    // par un balisage minimal (titre, sous-titre, lien), ce qui garde le texte et le lien décidés par la section.
    b.onResolve({ filter: /(hooks\/useMissionStageCounts|integrations\/supabase\/client|hooks\/sidebar\/useLinkedInOutage|\/SidebarRow|\/SidebarSection)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub',
    }));
    const stubSource = {
      useLinkedInOutage: 'export const useLinkedInOutage = () => globalThis.__outage;',
      SidebarRow: "import { createElement as h } from 'react';\n"
        + "export const SidebarRow = ({ title, sub, hint, to }) => h('a', { href: to, 'data-hint': hint ?? undefined }, h('b', null, title), h('span', null, sub));",
      SidebarSection: "export const SidebarSection = ({ children }) => children ?? null;",
    };
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      const name = Object.keys(stubSource).find((key) => args.path.endsWith(key));
      return {
        contents: name
          ? stubSource[name]
          : ['export const supabase = {};', 'export const useMissionStageCounts = () => ({ data: undefined });'].join('\n'),
        loader: 'js',
        resolveDir: ROOT,
      };
    });
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { DashboardFocusPanel } from './src/components/dashboard/DashboardFocusPanel';",
      "export { LinkedInOutageSection } from './src/components/sidebar/todo/LinkedInOutageSection';",
      "export { MemoryRouter } from 'react-router-dom';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.webp': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const inRouter = (component, props) =>
  kit.renderToStaticMarkup(kit.createElement(kit.MemoryRouter, null, kit.createElement(component, props)));
const focus = (props) => inRouter(kit.DashboardFocusPanel, { unreadMessages: 0, pendingResponses: 0, stagnantCandidates: 0, ...props });
/** Valeur décodée de l'attribut data-hint de la ligne rendue par la maquette de SidebarRow. */
const hintOf = (html) => {
  const match = html.match(/data-hint="([^"]*)"/);
  return match ? match[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
};
const section = (outage) => {
  globalThis.__outage = { status: 'ok', outage: outage !== null, kind: outage, retry: () => {} };
  return inRouter(kit.LinkedInOutageSection, {});
};

test('bandeau du tableau de bord : à reconnecter garde son texte et son bouton', () => {
  const html = focus({ linkedinIssue: true });
  assert.match(html, />Compte LinkedIn à reconnecter</);
  assert.match(html, /href="\/settings\/account\/connections">Reconnecter</);
});

test('bandeau du tableau de bord : accès restreint, texturé comme l\'autre blocage, SANS bouton « Reconnecter »', () => {
  const html = focus({ linkedinLocked: true });
  assert.match(html, /^<div class="[^"]*"><div class="konekt-card-tex konekt-card-tex--warm /);
  assert.match(html, />Compte LinkedIn restreint</);
  assert.match(html, /Les envois sont en pause/);
  assert.match(html, /Patientez/);
  assert.match(html, /directement sur LinkedIn/);
  assert.doesNotMatch(html, /Reconnecter|<a /, 'ni bouton ni lien : se reconnecter n\'y change rien');
  assert.doesNotMatch(html, /<ul|<li/, 'seul, le bandeau n\'ouvre pas de liste vide');
});

test('bandeau du tableau de bord : connexion partielle, texturé, phrase de la carte mot pour mot, avec « Reconnecter »', () => {
  const html = focus({ linkedinPartial: true });
  assert.match(html, /^<div class="[^"]*"><div class="konekt-card-tex konekt-card-tex--warm /);
  assert.match(html, />Connexion LinkedIn partielle</);
  assert.ok(html.includes(`>${PARTIAL_SENTENCE}<`), html);
  assert.match(html, /href="\/settings\/account\/connections">Reconnecter</);
  assert.doesNotMatch(html, /<ul|<li/, 'seul, le bandeau n\'ouvre pas de liste vide');
  assert.equal(causeReason('authentication_partial', 'linkedin'), PARTIAL_SENTENCE, 'c\'est la phrase de la carte de connexion');
});

test('bandeau du tableau de bord : jamais deux à la fois (reconnexion, puis connexion partielle, puis restriction), et rien sans panne', () => {
  const both = focus({ linkedinIssue: true, linkedinLocked: true });
  assert.equal((both.match(/konekt-card-tex--warm/g) || []).length, 1, 'un seul bandeau');
  assert.match(both, />Compte LinkedIn à reconnecter</, 'la reconnexion l\'emporte');
  assert.doesNotMatch(both, /restreint/);
  const partialAndLocked = focus({ linkedinPartial: true, linkedinLocked: true });
  assert.equal((partialAndLocked.match(/konekt-card-tex--warm/g) || []).length, 1, 'un seul bandeau');
  assert.match(partialAndLocked, />Connexion LinkedIn partielle</);
  assert.doesNotMatch(partialAndLocked, /restreint/);
  assert.equal((focus({ linkedinIssue: true, linkedinPartial: true }).match(/konekt-card-tex--warm/g) || []).length, 1);
  assert.doesNotMatch(focus({}), /konekt-card-tex|Compte LinkedIn|Connexion LinkedIn/);
});

test('ligne d\'À traiter : à reconnecter garde son texte, restreint n\'invite pas à reconnecter', () => {
  const reconnect = section('reconnect');
  assert.match(reconnect, /Compte LinkedIn à reconnecter/);
  assert.match(reconnect, /Les envois sont en pause/);
  assert.match(reconnect, /href="\/settings\/account\/connections"/);

  const partial = section('partial');
  assert.match(partial, /Connexion LinkedIn partielle/);
  assert.match(partial, /<span>Reconnectez le compte<\/span>/, 'le sous-titre dit le geste');
  assert.ok(!partial.includes(`>${PARTIAL_SENTENCE}<`), 'la phrase de 120 caractères n\'est pas écrite dans la ligne, qui la couperait : elle est au survol (hint)');
  assert.equal(hintOf(partial), PARTIAL_SENTENCE, 'le survol dit la phrase de la carte, mot pour mot');
  assert.match(partial, /href="\/settings\/account\/connections"/);

  const locked = section('locked');
  assert.match(locked, /Compte LinkedIn restreint/);
  assert.match(locked, /Les envois sont en pause/);
  assert.match(locked, /href="\/settings\/account\/connections"/, 'la carte explique l\'état');
  // Le texte visible n'invite pas à reconnecter ; le survol dit seulement que se reconnecter n'y change rien
  assert.doesNotMatch(locked.replace(/ data-hint="[^"]*"/, ''), /reconnecter/i);

  assert.equal(section(null), '', 'hors panne : rien');
});

test('ligne d\'À traiter : le sous-titre de chaque genre de panne tient sur la ligne de la barre (30 caractères au plus)', () => {
  // SidebarRow rend le sous-titre sur UNE ligne (truncate) dans une barre de 256 px : au-delà d'une trentaine de
  // caractères il est coupé par « … » et le geste n'apparaît plus qu'au survol, absent au toucher. Mesuré dans le
  // navigateur (colonne de 195 px sur ordinateur, 227 px sur téléphone) : « Reconnectez : envois en pause » (29)
  // tient, « Reconnectez pour relancer les envois » (36) est coupé.
  const SUB_BUDGET = 30;
  const TITLE_BUDGET = 60; // le titre tient sur deux lignes (line-clamp-2)
  const source = read('src/components/sidebar/todo/LinkedInOutageSection.tsx');
  const rows = [...source.matchAll(/^\s+(reconnect|partial|locked): \{ title: '([^']+)', sub: '([^']+)' \},$/gm)];
  assert.deepEqual(rows.map((m) => m[1]), ['reconnect', 'partial', 'locked'], 'un texte par genre de panne');
  for (const [, kind, title, sub] of rows) {
    assert.ok(sub.length <= SUB_BUDGET, `${kind} : « ${sub} » fait ${sub.length} caractères`);
    assert.ok(title.length <= TITLE_BUDGET, `${kind} : « ${title} » fait ${title.length} caractères`);
    assert.doesNotMatch(`${title} ${sub}`, /—|unipile/i, kind);
    assert.doesNotMatch(`${title} ${sub}`, /\b(tu|ton|ta|tes|toi)\b/i, kind);
  }
  // Ce que la ligne rend est ce que la section décide, au caractère près.
  for (const [, kind, , sub] of rows) assert.ok(section(kind).includes(`<span>${sub}</span>`), kind);
  // Connexion partielle : le sous-titre dit le geste (verbe d'action), pas une description.
  const partial = rows.find((m) => m[1] === 'partial');
  assert.match(partial[3], /^Reconnectez /);
  // La phrase entière de la carte reste dite par le bandeau, mot pour mot.
  assert.ok(focus({ linkedinPartial: true }).includes(`>${PARTIAL_SENTENCE}<`));
});

test('ligne d\'À traiter : le texte de survol de chaque genre de panne est une phrase entière, celle de la carte quand elle existe', () => {
  const { healthReason } = copyModule;
  assert.equal(hintOf(section('partial')), causeReason('authentication_partial', 'linkedin'), 'connexion partielle : la phrase de la carte');
  assert.equal(hintOf(section('locked')), healthReason('locked', 'linkedin'), 'accès restreint : la phrase de la carte');
  const reconnect = hintOf(section('reconnect'));
  assert.equal(reconnect, copyModule.OUTAGE_ROW_HINT.reconnect, 'à reconnecter : une phrase valable pour toute cause');
  for (const kind of ['reconnect', 'partial', 'locked']) {
    const hint = hintOf(section(kind));
    assert.ok(hint && hint.length > 30 && /[.]$/.test(hint), `${kind} : une phrase entière, plus longue que le sous-titre (${hint})`);
    assert.doesNotMatch(hint, /—|unipile/i, kind);
    assert.doesNotMatch(hint, /\b(tu|ton|ta|tes|toi)\b/i, kind);
  }
  // Le survol d'un compte restreint ne propose pas de se reconnecter ; celui d'une connexion partielle le propose
  assert.match(hintOf(section('locked')), /Se reconnecter n'y change rien/);
  assert.match(hintOf(section('partial')), /Reconnectez le compte/);
});

// SidebarRow réel (sans SidebarProvider : seul le hook qui ferme la barre sur téléphone est remplacé)
const { outputFiles: rowFiles } = await build({
  stdin: {
    contents: [
      "export { SidebarRow } from './src/components/sidebar/SidebarRow';",
      "export { MemoryRouter } from 'react-router-dom';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'close-mobile-stub',
    setup(b) {
      b.onResolve({ filter: /hooks\/sidebar\/useCloseMobileSidebar$/ }, (args) => ({ path: args.path, namespace: 'close-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'close-stub' }, () => ({ contents: 'export const useCloseMobileSidebar = () => () => {};', loader: 'js', resolveDir: ROOT }));
    },
  }],
});
const rowKit = await import(`data:text/javascript;base64,${Buffer.from(rowFiles[0].text).toString('base64')}`);
const rowHtml = (props) => rowKit.renderToStaticMarkup(rowKit.createElement(rowKit.MemoryRouter, null, rowKit.createElement('ul', null, rowKit.createElement(rowKit.SidebarRow, props))));
const titleAttr = (html) => {
  const match = html.match(/ title="([^"]*)"/);
  return match ? match[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
};

test('SidebarRow : le texte de survol est le hint quand il est donné, sinon « titre · sous-titre » (lien, bouton et ligne seule)', () => {
  const HINT = 'Une phrase entière, plus longue que le sous-titre que la ligne peut écrire.';
  for (const target of [{ to: '/settings' }, { onSelect: () => {} }, {}]) {
    const kind = Object.keys(target)[0] ?? 'div';
    assert.equal(titleAttr(rowHtml({ title: 'Titre', sub: 'Sous-titre', hint: HINT, ...target })), HINT, `${kind} : le hint est le texte de survol`);
    assert.equal(titleAttr(rowHtml({ title: 'Titre', sub: 'Sous-titre', ...target })), 'Titre · Sous-titre', `${kind} : sans hint, le texte d'avant`);
    assert.equal(titleAttr(rowHtml({ title: 'Titre', ...target })), 'Titre', `${kind} : sans sous-titre ni hint, le titre`);
    assert.equal(titleAttr(rowHtml({ title: 'Titre', sub: 'Sous-titre', hint: null, ...target })), 'Titre · Sous-titre', `${kind} : un hint nul ne change rien`);
    assert.equal(titleAttr(rowHtml({ title: 'Titre', sub: 'Sous-titre', hint: '', ...target })), 'Titre · Sous-titre', `${kind} : un hint vide ne masque pas le texte d'avant`);
  }
  // Le sous-titre visible reste le texte court : le hint ne change que l'attribut
  const html = rowHtml({ title: 'Titre', sub: 'Sous-titre', hint: HINT, to: '/x' });
  assert.match(html, /<span class="truncate[^"]*">Sous-titre<\/span>/);
  assert.ok(!html.includes(`>${HINT}<`), 'la phrase entière n\'est pas écrite dans la ligne');
});

// --------------------------------------------------------------------------- Bandeau, ligne et chiffre : d'accord
test('bandeau, ligne d\'À traiter et chiffre disent la même chose pour chaque statut enregistré', () => {
  const countFor = (outage) => todoCount({
    replies: { status: 'ok', data: { candidates: [] } },
    signals: { status: 'ok', data: { actions: [], plans: [] } },
    forYouActionCount: { status: 'ok', data: 0 },
    linkedinOutage: { status: 'ok', data: outage },
  });
  const cases = [
    ['OK', {}, null], ['DEGRADED', {}, null], ['RUNNING', {}, null],
    ['PARTIAL', {}, 'partial'], ['CREDENTIALS', {}, 'reconnect'], ['ERROR', {}, 'reconnect'],
    ['LOCKED', {}, 'locked'], ['OK', { is_locked: true }, 'locked'],
  ];
  for (const [accountStatus, extra, expected] of cases) {
    // Même chaîne que le hook : le genre vient du prédicat, `outage` est `kind !== null` (vérifié plus bas).
    const kind = myLinkedInOutage(withList({ id: 'a1', status: accountStatus, ...extra })) || null;
    assert.equal(kind, expected, `${accountStatus} ${JSON.stringify(extra)}`);
    const banner = focus({ linkedinIssue: kind === 'reconnect', linkedinPartial: kind === 'partial', linkedinLocked: kind === 'locked' });
    const row = section(kind);
    const counted = countFor(kind !== null);
    assert.equal(counted, kind === null ? 0 : 1, `${accountStatus} : le chiffre`);
    assert.equal(/konekt-card-tex--warm/.test(banner), kind !== null, `${accountStatus} : le bandeau`);
    assert.equal(row !== '', kind !== null, `${accountStatus} : la ligne`);
  }
});

// --------------------------------------------------------------------------- Câblage : une seule source
test('tableau de bord et barre latérale lisent le même hook, donc le même prédicat', () => {
  const hook = read('src/hooks/sidebar/useLinkedInOutage.ts');
  assert.match(hook, /myLinkedInOutage\(/);
  assert.doesNotMatch(hook, /myLinkedInNeedsAction/);
  assert.match(hook, /kind: LinkedInOutageKind \| null/);
  assert.match(hook, /outage: kind !== null/);

  const dashboard = read('src/pages/Dashboard.tsx');
  assert.match(dashboard, /useLinkedInOutage\(\)/);
  assert.match(dashboard, /linkedinIssue=\{linkedinOutage\.kind === 'reconnect'\}/);
  assert.match(dashboard, /linkedinPartial=\{linkedinOutage\.kind === 'partial'\}/);
  assert.match(dashboard, /linkedinLocked=\{linkedinOutage\.kind === 'locked'\}/);
  assert.doesNotMatch(dashboard, /connections\.linkedin\.status/, 'plus de seconde règle pour le bandeau');

  for (const file of ['src/components/sidebar/todo/TodoPanel.tsx', 'src/hooks/sidebar/useTodoSignal.ts', 'src/components/sidebar/todo/LinkedInOutageSection.tsx']) {
    assert.match(read(file), /useLinkedInOutage\(\)/, file);
  }
});

test('la notification du récepteur d\'événements dit la même chose que le bandeau (titre et phrase de la carte) ; la ligne en reprend le titre', () => {
  const webhook = read('supabase/functions/unipile-webhook/index.ts');
  const sentence = webhook.match(/const PARTIAL_CONNECTION_SENTENCE = '([^']+)';/);
  assert.ok(sentence, 'constante de la phrase dans le récepteur');
  assert.equal(sentence[1], PARTIAL_SENTENCE, 'le récepteur reprend la phrase de la carte mot pour mot');
  assert.match(webhook, /title = 'Connexion LinkedIn partielle';/);
  assert.match(webhook, /body = PARTIAL_CONNECTION_SENTENCE;/);
  const banner = read('src/components/dashboard/DashboardFocusPanel.tsx');
  assert.match(banner, /Connexion LinkedIn partielle/);
  assert.match(banner, /causeReason\('authentication_partial', 'linkedin'\)/, 'la phrase du bandeau vient de la carte');
  const row = read('src/components/sidebar/todo/LinkedInOutageSection.tsx');
  assert.match(row, /title: 'Connexion LinkedIn partielle'/);
  assert.match(row, /causeReason\('authentication_partial', 'linkedin'\)/, 'la phrase du survol de la ligne vient de la carte');
});

test('récepteur : aucune écriture de statut LinkedIn sans condition sur le statut d\'avant (ni double écriture, ni lecture suivie d\'une écriture)', () => {
  const webhook = read('supabase/functions/unipile-webhook/index.ts');
  const between = (from, to) => webhook.slice(webhook.indexOf(from), webhook.indexOf(to, webhook.indexOf(from)));
  // account.status.*, disconnected et errored : la liaison LinkedIn n'est écrite que par les deux fonctions conditionnelles.
  const statusBranches = between("case 'account_status_updated':", "case 'account_locked':");
  assert.doesNotMatch(statusBranches, /\.from\('member_linkedin_accounts'\)/, 'écrit par moveLinkedInAccount ou applyLinkedInStatus seulement');
  assert.match(statusBranches, /applyLinkedInStatus\(/);
  assert.doesNotMatch(webhook, /PARTIAL_ANNOUNCED_FILTER/, 'plus de seconde écriture générale derrière l\'écriture conditionnelle de PARTIAL');
  // account.add / account.reconnect sans tentative de connexion : mêmes fonctions.
  const noAttempt = between('No connection attempt for this event', "case 'error':");
  assert.doesNotMatch(noAttempt, /\.from\('member_linkedin_accounts'\)/);
  assert.match(noAttempt, /applyLinkedInStatus\(/);
  assert.match(noAttempt, /moveLinkedInAccount\(supabase, accountId, statusPatch\(reportedStatus\), LOCK_REPLACES_FILTER\)/, 'LOCKED : même règle que account.locked');
  // Le passage lit la ligne puis n'écrit que si le statut est encore celui qui a été lu, et ne prévient que pour ce qu'il a écrit.
  const transition = between('async function transitionLinkedInAccount(', 'async function readReportedStatus(');
  assert.match(transition, /\.eq\('id', row\.id\)/);
  assert.match(transition, /row\.account_status === null\s*\? write\.is\('account_status', null\)\s*: write\.eq\('account_status', row\.account_status\)/);
  assert.match(transition, /\)\.select\('id'\)/, 'l\'écriture rend ses lignes');
  assert.match(transition, /announcedRows\(target\.status, \[row\]\)/, 'la notification suit l\'écriture réussie, pas la lecture');
  // Le déverrouillage relit l'état chez le prestataire au lieu d'écrire OK à la place du statut d'avant le verrou.
  const unlock = between("case 'account_locked':", "case 'message_read':");
  assert.match(unlock, /readReportedStatus\(accId\)/);
  assert.doesNotMatch(unlock, /account_status: 'OK'/, 'plus de OK écrit d\'office au déverrouillage');
});

test('textes : aucun nom de prestataire, pas de tiret cadratin, vouvoiement', () => {
  for (const file of ['src/components/dashboard/DashboardFocusPanel.tsx', 'src/components/sidebar/todo/LinkedInOutageSection.tsx', 'src/hooks/sidebar/useLinkedInOutage.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /unipile/i, file);
  }
  for (const html of [focus({ linkedinLocked: true }), section('locked'), focus({ linkedinPartial: true }), section('partial')]) {
    assert.doesNotMatch(html, /—|unipile|Apollo|PDL/i);
    assert.doesNotMatch(html, /\b(tu|ton|ta|tes|toi)\b/i);
  }
});
