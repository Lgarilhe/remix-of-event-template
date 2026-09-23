/**
 * Barre latérale, lots 5 et 6 : coquille (C1a, C1b).
 *
 * Invariants épinglés :
 *   - modules purs sans import (onglets, états de section), chargés en mémoire ;
 *   - onglets : ids, libellés, pages, onglet par défaut, flèches du clavier ;
 *   - un seul état d'onglet (useSidebarTab appelé une fois, dans AppSidebar) ;
 *   - fenêtres de l'Aide rendues hors de <Sidebar> (feuille mobile démontée) ;
 *   - cloche, entrée Notifications et compteur de messages supprimés (A2, D24) ;
 *   - rangée basse : quatre liens et Aide, Marketplace selon les droits ;
 *   - raccourcis G alignés sur GoShortcuts, « Agenda » et « Messagerie » ;
 *   - chiffre des tâches en retard : même règle que la page, invalidé par
 *     toggleComplete et deleteReminder ;
 *   - aucun nom de fournisseur, aucun tiret long visible ;
 *   - cibles de 44 px sur téléphone ; bandeau hors ligne.
 *
 * Sans navigateur ni base. Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(join(ROOT, rel));

/** Fichiers .ts et .tsx d'un dossier, récursivement. */
const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules') continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
};

/** Module TypeScript pur chargé en mémoire (patron de notification-kinds.test.mjs). */
const loadPure = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

/** Littéraux de chaîne et textes JSX, sans commentaires ni chemins d'import (patron de lot2-parametres-coquille). */
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
    ...[...code.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ];
};

const countOf = (src, needle) => src.split(needle).length - 1;

const appSidebar = read('src/components/AppSidebar.tsx');
const appHeader = read('src/components/AppHeader.tsx');
const userMenu = read('src/components/sidebar/SidebarUserMenu.tsx');
const tabsTsx = read('src/components/sidebar/SidebarTabs.tsx');
const bottomRow = read('src/components/sidebar/SidebarBottomRow.tsx');
const helpMenu = read('src/components/sidebar/HelpMenu.tsx');
const shortcuts = read('src/components/sidebar/KeyboardShortcutsDialog.tsx');
const offlineBanner = read('src/components/sidebar/OfflineBanner.tsx');
const offlineHook = read('src/hooks/sidebar/useSidebarOffline.ts');
const overdueHook = read('src/hooks/sidebar/useOverdueTasksCount.ts');
const allReminders = read('src/hooks/useAllReminders.ts');

// ---------------------------------------------------------------- B-C1
test('B-C1 — sidebarTabs.ts et sidebarSection.ts sans import', () => {
  for (const rel of ['src/lib/sidebarTabs.ts', 'src/lib/sidebarSection.ts']) {
    assert.doesNotMatch(read(rel), /^\s*import\s/m, rel);
  }
});

// ---------------------------------------------------------------- B-C2, B-C3
test('B-C2 — SIDEBAR_TABS exact et onglet par défaut', async () => {
  const { SIDEBAR_TABS, parseSidebarTab, SIDEBAR_TAB_STORAGE_KEY } = await loadPure('src/lib/sidebarTabs.ts');
  assert.deepEqual(
    SIDEBAR_TABS.map((t) => [t.id, t.label, t.page]),
    [['todo', 'À traiter', null], ['missions', 'Missions', '/missions'], ['assistant', 'Assistant', '/agents']],
  );
  assert.equal(parseSidebarTab('x'), 'todo');
  assert.equal(parseSidebarTab(null), 'todo');
  assert.equal(parseSidebarTab('missions'), 'missions');
  assert.equal(SIDEBAR_TAB_STORAGE_KEY, 'konekt:nav:tab');
});

test('B-C3 — nextTabIndex : flèches circulaires, Début, Fin', async () => {
  const { nextTabIndex } = await loadPure('src/lib/sidebarTabs.ts');
  assert.equal(nextTabIndex(0, 'ArrowRight', 3), 1);
  assert.equal(nextTabIndex(2, 'ArrowRight', 3), 0);
  assert.equal(nextTabIndex(0, 'ArrowLeft', 3), 2);
  assert.equal(nextTabIndex(1, 'Home', 3), 0);
  assert.equal(nextTabIndex(1, 'End', 3), 2);
  assert.equal(nextTabIndex(1, 'a', 3), null);
  assert.equal(nextTabIndex(0, 'ArrowDown', 3), 1);
  assert.equal(nextTabIndex(0, 'ArrowUp', 3), 2);
});

// ---------------------------------------------------------------- B-C4
test('B-C4 — onglets en props, un seul état, fenêtres hors de <Sidebar>', () => {
  for (const needle of ['role="tablist"', 'aria-selected', 'aria-controls', 'setOpen(true)']) {
    assert.ok(tabsTsx.includes(needle), `SidebarTabs.tsx : ${needle} absent`);
  }
  assert.doesNotMatch(tabsTsx, /useSidebarTab\(/, 'SidebarTabs reçoit l\'onglet en props');
  assert.doesNotMatch(tabsTsx, /from '@\/hooks\/sidebar\/useSidebarTab'/);

  assert.equal(countOf(appSidebar, 'useSidebarTab('), 1, 'useSidebarTab appelé une seule fois');
  for (const banned of ['useUnreadMessageNotifications', 'bg-destructive', 'NAV_ITEMS']) {
    assert.ok(!appSidebar.includes(banned), `AppSidebar.tsx contient encore ${banned}`);
  }

  const open = appSidebar.search(/<Sidebar\s/); // la balise JSX (les commentaires écrivent <Sidebar>)
  const close = appSidebar.indexOf('</Sidebar>');
  assert.ok(open >= 0 && close > open, '<Sidebar> introuvable');
  for (const dialog of ['<KeyboardShortcutsDialog', '<TutorialVideoDialog']) {
    const at = appSidebar.indexOf(dialog);
    assert.ok(at >= 0, `${dialog} non rendu`);
    assert.ok(at > close || at < open, `${dialog} rendu dans <Sidebar>`);
  }
  // Relevé de la mission ouverte, hors de la feuille aussi.
  const tracker = appSidebar.indexOf('<MissionVisitTracker');
  assert.ok(tracker >= 0 && (tracker < open || tracker > close), 'MissionVisitTracker hors de <Sidebar>');
  // Panneaux branchés, un seul monté.
  for (const panel of ["tab === 'todo' && <TodoPanel", "tab === 'missions' && <MissionsPanel", "tab === 'assistant' && <AssistantPanel"]) {
    assert.ok(appSidebar.includes(panel), `AppSidebar.tsx : ${panel} absent`);
  }
  for (const hook of ['useTodoSignal()', 'useAgentSignals()', 'useOverdueTasksCount()', 'useSidebarRealtime()']) {
    assert.ok(appSidebar.includes(hook), `AppSidebar.tsx : ${hook} absent`);
  }
  assert.ok(appSidebar.includes('role="tabpanel"') && appSidebar.includes('id="sidebar-panel"'));
});

// ---------------------------------------------------------------- B-C5
test('B-C5 — cloche et entrées Notifications et Paramètres retirées', () => {
  assert.doesNotMatch(appHeader, /NotificationDropdown/);
  for (const banned of ['useNotifications', 'konekt:open-notifications', "'Notifications'", ">Notifications<", "navigate('/settings')"]) {
    assert.ok(!userMenu.includes(banned), `SidebarUserMenu.tsx contient encore ${banned}`);
  }
  // Menu de l'avatar (D34) : ce qui reste.
  for (const kept of ['Crédits IA', 'Mon compte', 'Mode clair', 'Mode sombre', 'Déconnexion', '/settings/org/billing#credits', '/settings/account/connections']) {
    assert.ok(userMenu.includes(kept), `SidebarUserMenu.tsx : ${kept} absent`);
  }
  assert.match(userMenu, /const avatarUrl = connections\.linkedin\.avatarUrl \|\| null;/, 'R3');
});

// ---------------------------------------------------------------- B-C6
test('B-C6 — rangée basse : quatre liens, Aide en bouton, Marketplace selon les droits', () => {
  for (const route of ["'/tasks'", "'/calendar'", "'/marketplace'", "'/settings'"]) {
    assert.ok(bottomRow.includes(route), `SidebarBottomRow.tsx : ${route} absent`);
  }
  // Les quatre cibles sont rendues par un même <Link> (liste), l'Aide seule est un bouton (HelpMenu).
  assert.ok(countOf(bottomRow, '<Link') >= 1, '<Link absent');
  assert.equal(countOf(bottomRow, '{ to: \''), 4, 'quatre liens dans la liste');
  assert.ok(!bottomRow.includes('<button'), 'seule l\'Aide est un bouton');
  for (const label of ["'Tâches'", "'Agenda'", "'Marketplace'", "'Paramètres'"]) {
    assert.ok(bottomRow.includes(label), `SidebarBottomRow.tsx : libellé ${label} absent`);
  }
  assert.ok(bottomRow.includes('aria-label={name}'));
  assert.ok(bottomRow.includes("aria-current={active ? 'page' : undefined}"));
  assert.ok(helpMenu.includes('aria-label="Aide"'));
  assert.ok(bottomRow.includes("'marketplace_browse'") && bottomRow.includes("'marketplace_publish'"));
  for (const dialog of ['KeyboardShortcutsDialog', 'TutorialVideoDialog']) {
    assert.ok(!helpMenu.includes(dialog), `HelpMenu.tsx contient ${dialog}`);
  }
  assert.ok(helpMenu.includes('Raccourcis clavier') && helpMenu.includes('Vidéo du tutoriel'));
  assert.ok(helpMenu.includes('onCloseAutoFocus') && helpMenu.includes('preventDefault()'));
});

// ---------------------------------------------------------------- B-C7
test('B-C7 — raccourcis G alignés sur GoShortcuts, un nom par page', () => {
  const go = read('src/components/layout/GoShortcuts.tsx');
  const block = go.match(/const G_ROUTES[^{]*\{([\s\S]*?)\};/);
  assert.ok(block, 'G_ROUTES introuvable');
  const letters = [...block[1].matchAll(/^\s*([a-z])\s*:/gm)].map((m) => m[1]);
  assert.ok(letters.length >= 7, 'lettres de G_ROUTES');
  for (const letter of letters) {
    assert.ok(shortcuts.includes(`'G puis ${letter.toUpperCase()}'`), `G puis ${letter.toUpperCase()} absent`);
  }
  assert.ok(shortcuts.includes('Agenda') && shortcuts.includes('Messagerie'));
  assert.ok(!shortcuts.includes('Calendrier'));
  assert.ok(shortcuts.includes('Les raccourcis G ne fonctionnent pas dans un champ de saisie ni quand une fenêtre est ouverte.'));
});

// ---------------------------------------------------------------- B-C8
test('B-C8 — tâches en retard : règle de la page, invalidations', () => {
  for (const needle of ['head: true', ".eq('created_by'", ".is('completed_at', null)", ".lt('due_at'", 'if (error) throw error']) {
    assert.ok(overdueHook.includes(needle), `useOverdueTasksCount.ts : ${needle} absent`);
  }
  assert.ok(!overdueHook.includes(".eq('organization_id'"), 'même filtre que la page : pas d\'organisation');
  assert.match(overdueHook, /\[\s*'all-reminders',\s*'overdue-count'/);
  assert.equal(
    countOf(allReminders, "invalidateQueries({ queryKey: ['all-reminders', 'overdue-count'] })"),
    2,
    'toggleComplete et deleteReminder invalident le chiffre',
  );
});

// ---------------------------------------------------------------- B-C9, B-C10
const brandedFiles = () => [
  ...walk('src/components/sidebar'),
  ...walk('src/hooks/sidebar'),
  ...readdirSync(join(ROOT, 'src/lib')).filter((n) => /^sidebar.*\.ts$/.test(n)).map((n) => `src/lib/${n}`),
  'src/lib/firstSteps.ts',
  'src/lib/businessDays.ts',
  'src/lib/missionViews.ts',
];

test('B-C9 — aucun nom de fournisseur (commentaires compris)', () => {
  const vendors = /\b(Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|People Data Labs|PDL)\b/;
  for (const rel of brandedFiles()) {
    assert.doesNotMatch(read(rel), vendors, rel);
  }
});

test('B-C10 — aucun tiret long dans les textes visibles', () => {
  const files = [
    ...brandedFiles(),
    'src/components/AppSidebar.tsx',
    'src/components/AppHeader.tsx',
    'src/components/help/tutorials.ts',
  ];
  for (const rel of files) {
    for (const s of visibleStrings(read(rel))) {
      assert.ok(!s.includes('—'), `${rel} : « ${s} »`);
    }
  }
});

// ---------------------------------------------------------------- B-C11
test('B-C11 — cloche, useNotifications, compteur de messages et bulle supprimés', () => {
  for (const rel of [
    'src/hooks/useNotifications.ts',
    'src/components/notifications/NotificationDropdown.tsx',
    'src/hooks/useUnreadMessageNotifications.ts',
  ]) {
    assert.equal(exists(rel), false, `${rel} existe encore`);
  }
  const banned = [
    /NotificationDropdown/,
    /['"]@\/hooks\/useNotifications['"]/,
    /['"]@\/hooks\/useUnreadMessageNotifications['"]/,
    /AgentFAB/,
  ];
  for (const rel of walk('src')) {
    const src = read(rel);
    for (const re of banned) {
      assert.doesNotMatch(src, re, `${rel} : ${re}`);
    }
  }
  assert.ok(exists('src/components/agent/AgentDrawer.tsx'), 'AgentDrawer reste (Ctrl K)');
});

// ---------------------------------------------------------------- B-C12
test('B-C12 — SidebarSection et SidebarRow n\'exportent que leur composant', () => {
  for (const [rel, component] of [
    ['src/components/sidebar/SidebarSection.tsx', 'SidebarSection'],
    ['src/components/sidebar/SidebarRow.tsx', 'SidebarRow'],
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /export function queryState/, rel);
    assert.doesNotMatch(src, /export function use/, rel);
    const values = [...src.matchAll(/export\s+(?:default\s+)?(?:function|const|let|class)\s+(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(values, [component], `${rel} : exports ${values.join(', ')}`);
  }
});

// ---------------------------------------------------------------- B-C13
test('B-C13 — queryState : hors ligne, chargement, erreur, données gardées', async () => {
  const { queryState } = await loadPure('src/lib/sidebarSection.ts');
  assert.deepEqual(queryState({ data: undefined, isError: false, fetchStatus: 'paused' }).state, 'offline');
  assert.deepEqual(queryState({ data: undefined, isError: false, fetchStatus: 'fetching' }).state, 'loading');
  assert.deepEqual(queryState({ data: undefined, isError: true, fetchStatus: 'idle' }).state, 'error');
  assert.deepEqual(queryState({ data: [], isError: true, fetchStatus: 'idle' }), { state: 'ok', stale: true });
  assert.deepEqual(queryState({ data: [], isError: false, fetchStatus: 'paused' }), { state: 'ok', stale: false });
});

// ---------------------------------------------------------------- B-C14
test('B-C14 — en-tête : chiffre sur le bouton du menu, téléphone seulement', () => {
  for (const needle of ['useTodoSignal', 'isMobile', 'aria-describedby']) {
    assert.ok(appHeader.includes(needle), `AppHeader.tsx : ${needle} absent`);
  }
  assert.doesNotMatch(appHeader, /NotificationDropdown/);
  for (const text of ['1 élément à traiter', 'éléments à traiter', 'Plus de 9 éléments à traiter']) {
    assert.ok(appHeader.includes(text), `AppHeader.tsx : « ${text} » absent`);
  }
  assert.ok(appHeader.includes('h-12'), 'hauteur de l\'en-tête inchangée');
});

// ---------------------------------------------------------------- B-C15
/** Code sans commentaires : un commentaire qui cite min-h-11 ne pose aucune classe. */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Littéraux de chaîne, lus de gauche à droite (une apostrophe dans "…" n'ouvre rien). */
const literalsOf = (code) =>
  [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0].slice(1, -1));

const classesOf = (literal) => literal.split(/\s+/).filter(Boolean);

/** Classes posées par l'initialiseur d'une constante (jusqu'au premier « ; »). */
const constantClasses = (code, name) => {
  const m = code.match(new RegExp(`\\bconst ${name}\\s*=([^;]*);`));
  assert.ok(m, `constante ${name} introuvable`);
  return literalsOf(m[1]).flatMap(classesOf);
};

/** Littéraux qui posent la classe `cls` (classe entière, pas un préfixe md: ni [&_button]:). */
const literalsWithClass = (code, cls) => literalsOf(code).filter((l) => classesOf(l).includes(cls));

test('B-C15 — cibles de 44 px sur téléphone, dans les classes du code', () => {
  // SidebarRow : cible principale (lien, bouton) et tout bouton de l'action.
  const row = codeOnly(read('src/components/sidebar/SidebarRow.tsx'));
  assert.ok(constantClasses(row, 'TARGET_CLASS').includes('min-h-11'), 'SidebarRow : TARGET_CLASS sans min-h-11');
  assert.ok(countOf(row, 'cn(TARGET_CLASS') >= 2, 'SidebarRow : lien et bouton sans TARGET_CLASS');
  assert.ok(
    literalsOf(row).some((l) => classesOf(l).includes('[&_button]:min-h-11') && classesOf(l).includes('[&_button]:min-w-11')),
    'SidebarRow : boutons de l\'action sans [&_button]:min-h-11 [&_button]:min-w-11',
  );

  // MissionNavRow : épingle et chevron (ICON_BUTTON_CLASS), nom de la mission, vues.
  const nav = codeOnly(read('src/components/sidebar/missions/MissionNavRow.tsx'));
  const iconButton = constantClasses(nav, 'ICON_BUTTON_CLASS');
  assert.ok(iconButton.includes('min-h-11') && iconButton.includes('min-w-11'), 'MissionNavRow : ICON_BUTTON_CLASS sans min-h-11 min-w-11');
  assert.ok(countOf(nav, 'ICON_BUTTON_CLASS') >= 3, 'MissionNavRow : épingle et chevron sans ICON_BUTTON_CLASS');
  assert.ok(literalsWithClass(nav, 'min-h-11').length >= 3, 'MissionNavRow : moins de trois classes min-h-11');

  // Onglets.
  assert.ok(literalsWithClass(codeOnly(tabsTsx), 'min-h-11').length >= 1, 'SidebarTabs : aucune classe min-h-11');

  // Rangée basse : les quatre liens et l'Aide partagent targetClass.
  const bottom = codeOnly(bottomRow);
  const target = constantClasses(bottom, 'targetClass');
  assert.ok(target.includes('min-h-11') && target.includes('min-w-11'), 'SidebarBottomRow : targetClass sans min-h-11 min-w-11');
  assert.ok((bottom.match(/\btargetClass\b/g) ?? []).length >= 3, 'SidebarBottomRow : liens et Aide sans targetClass');
});

// ---------------------------------------------------------------- B-C16
test('B-C16 — bandeau hors ligne', () => {
  assert.ok(offlineBanner.includes('role="status"'));
  assert.ok(offlineBanner.includes('Hors ligne'));
  assert.ok(offlineBanner.includes('Hors ligne · données de '));
  assert.ok(offlineBanner.includes('Réessayer'));
  assert.ok(!offlineBanner.includes('destructive'), 'gris, pas rouge');
  assert.ok(offlineHook.includes("'online'") && offlineHook.includes("'offline'"));
  assert.ok(appSidebar.includes('<OfflineBanner'), 'bandeau monté en tête du panneau');
});

// ---------------------------------------------------------------- Accessibilité des onglets
test('Onglets : noms accessibles et signaux (§2.2, §10)', () => {
  for (const text of [
    'Sections de la barre latérale',
    '1 élément',
    'plus de 9 éléments',
    'un agent travaille',
    'sidebar-tab-',
    'tabIndex={selected ? 0 : -1}',
    'badgeLabel(',
  ]) {
    assert.ok(tabsTsx.includes(text), `SidebarTabs.tsx : ${text} absent`);
  }
  assert.ok(!tabsTsx.includes('animate-'), 'point Assistant sans animation');
  assert.ok(!tabsTsx.includes('destructive'), 'aucun rouge sur les onglets');
});
