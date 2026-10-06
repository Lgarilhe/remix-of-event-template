/**
 * Lot 12 du chantier design, partie 12c : barre latérale et bande d'en-tête.
 * Garde-fous de non-régression sur les constats A-01, A-03, A-15, A-18 à A-21
 * (docs/design/audit/A-coquille-tableau-de-bord-taches-agenda.md), et sur A-16,
 * A-17, A-53, A-54 pour ces fichiers. Pas d'illustration dans la barre : une
 * par écran, portée par la page (docs/design/01-direction.md, § Illustrations).
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const countOf = (src, needle) => src.split(needle).length - 1;

/** Module TypeScript pur chargé en mémoire (patron de notification-kinds.test.mjs). */
const loadPure = async (rel) => {
  const { code: js } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};

function filesUnder(rel) {
  const dir = new URL(`../../${rel}/`, import.meta.url);
  return readdirSync(dir).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(new URL(name, dir)).isDirectory() ? filesUnder(child) : [child];
  });
}

/** Les fichiers du lot : la barre, l'en-tête et l'aide. */
const scope = [
  'src/components/AppSidebar.tsx',
  'src/components/AppHeader.tsx',
  ...filesUnder('src/components/sidebar'),
  ...filesUnder('src/components/help'),
].filter((rel) => /\.tsx?$/.test(rel));

const header = code('src/components/AppHeader.tsx');
const sidebar = code('src/components/AppSidebar.tsx');
const layout = code('src/components/AppLayout.tsx');
const kitSidebar = read('src/components/ui/sidebar.tsx');
const tabs = code('src/components/sidebar/SidebarTabs.tsx');
const bottomRow = code('src/components/sidebar/SidebarBottomRow.tsx');
const helpMenu = code('src/components/sidebar/HelpMenu.tsx');
const userMenu = code('src/components/sidebar/SidebarUserMenu.tsx');
const firstSteps = code('src/components/sidebar/todo/FirstStepsSection.tsx');
const todoPanel = code('src/components/sidebar/todo/TodoPanel.tsx');
const replies = code('src/components/sidebar/todo/RepliesSection.tsx');
const dialog = code('src/components/help/TutorialVideoDialog.tsx');
const buttonClass = code('src/components/sidebar/sidebarButtonClass.ts');

// ---------------------------------------------------------------- A-01
test('A-01 — plus de bande vide sur ordinateur : le bouton de la barre passe dans son en-tête', () => {
  // La bande de 48 px ne reste que sur téléphone, masquée par CSS (pas de saut au premier rendu).
  assert.match(header, /<header className="[^"]*\bh-12\b[^"]*\bmd:hidden\b[^"]*"/);
  assert.doesNotMatch(header, /children/, 'plus d’emplacement vide passé par AppLayout');
  assert.match(layout, /<AppHeader \/>/, 'la bande reste montée pour le téléphone');

  // Ordinateur : le bouton du kit, dans l'en-tête de la barre, un seul élément
  // pour les deux états (le focus clavier le suit quand la barre se replie).
  const head = sidebar.slice(sidebar.indexOf('<SidebarHeader'), sidebar.indexOf('</SidebarHeader>'));
  assert.equal(countOf(sidebar, '<SidebarTrigger'), 1, 'un seul bouton de barre dans AppSidebar');
  assert.match(head, /\{!isMobile && \(\s*<Tooltip>\s*<TooltipTrigger asChild>\s*<SidebarTrigger/);
  assert.match(head, /'Déplier la barre' : 'Replier la barre'/);
  assert.match(sidebar, /const toggleShortcut = isMac \? '⌘B' : 'Ctrl B';/);

  // Nom exact cliqué par e2e/flows/sidebar.spec.ts, et Ctrl B : portés par le kit.
  assert.match(kitSidebar, /<span className="sr-only">Afficher ou masquer la navigation<\/span>/);
  assert.match(kitSidebar, /const SIDEBAR_KEYBOARD_SHORTCUT = "b";/);
});

// ---------------------------------------------------------------- A-03
test('A-03 — bouton du menu sur téléphone : cible de 44 px', () => {
  const trigger = header.slice(header.indexOf('<SidebarTrigger'), header.indexOf('/>', header.indexOf('<SidebarTrigger')));
  assert.match(trigger, /className="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b[^"]*"/);
  assert.doesNotMatch(header, /\bh-8 w-8\b/, 'plus de bouton de 32 px');
  assert.match(trigger, /aria-describedby=\{show \? descriptionId : undefined\}/, 'le chiffre reste lu par aria-describedby');
});

// ---------------------------------------------------------------- A-15
test('A-15 — aide contextuelle : table route → tutoriel, entrée masquée sans vidéo, puces neutres', async () => {
  const { tutorialForRoute, PIPELINE_TUTORIAL, ROUTE_TUTORIALS } = await loadPure('src/components/help/tutorials.ts');
  assert.ok(ROUTE_TUTORIALS.length >= 1);
  assert.equal(tutorialForRoute('/missions/abc', '?tab=pipeline'), PIPELINE_TUTORIAL, 'pipeline d’une mission');
  assert.equal(tutorialForRoute('/missions/abc/', '?tab=pipeline&candidate=x'), PIPELINE_TUTORIAL);
  for (const [path, search] of [
    ['/dashboard', ''],
    ['/missions', '?tab=pipeline'],
    ['/missions/abc', ''],
    ['/missions/abc', '?tab=brief'],
    ['/pipeline', ''],
    ['/tasks', ''],
  ]) {
    assert.equal(tutorialForRoute(path, search), null, `${path}${search} : aucune vidéo`);
  }

  // La barre lit la table ; sans vidéo, rien n'est passé au menu Aide.
  assert.match(sidebar, /const tutorial = tutorialForRoute\(pathname, search\);/);
  assert.match(sidebar, /const openTutorial = tutorial\s*\?/);
  assert.match(sidebar, /:\s*undefined;/);
  assert.match(sidebar, /onOpenTutorial=\{openTutorial\}/);
  assert.doesNotMatch(sidebar, /PIPELINE_TUTORIAL/, 'plus de vidéo du pipeline sur toutes les pages');
  assert.match(bottomRow, /onOpenTutorial\?: \(\) => void;/);
  assert.match(helpMenu, /onOpenTutorial\?: \(\) => void;/);
  assert.match(helpMenu, /\{onOpenTutorial && \(\s*<DropdownMenuItem[\s\S]*?Vidéo du tutoriel/);
  assert.match(helpMenu, /else onOpenTutorial\?\.\(\);/);

  // Puces neutres : ni ancienne marque, ni caractère « • » en guise d'icône.
  assert.doesNotMatch(dialog, /brand-purple/);
  assert.doesNotMatch(dialog, /•/);
  assert.match(dialog, /<ul className="list-disc[^"]*"/);
});

// ---------------------------------------------------------------- A-16, A-17
test('A-16, A-17 (ces fichiers) — anneau de focus partout, une seule famille, graisse 600', () => {
  // Lien de l'organisation : il n'avait pas d'anneau (contour du navigateur).
  const org = sidebar.slice(sidebar.indexOf('const orgLink'), sidebar.indexOf('const activeTab'));
  assert.match(org, /focus-visible:ring-2 focus-visible:ring-sidebar-ring/);
  // Boutons du kit posés dans la barre : anneau de la barre, plein.
  assert.match(buttonClass, /SIDEBAR_GHOST_CLASS =[\s\S]*focus-visible:ring-sidebar-ring focus-visible:ring-offset-0/);
  assert.match(buttonClass, /SIDEBAR_FOCUS_CLASS = 'focus-visible:ring-sidebar-ring focus-visible:ring-offset-0'/);
  for (const rel of scope) {
    const src = code(rel);
    assert.doesNotMatch(src, /\bfont-display\b/, `${rel} : font-display`);
    assert.doesNotMatch(src, /\bfont-bold\b/, `${rel} : graisse 700 hors grands chiffres`);
  }
});

// ---------------------------------------------------------------- A-18
test('A-18 — paliers nommés seulement, plancher de 10 px', () => {
  for (const rel of scope) {
    assert.doesNotMatch(code(rel), /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/, `${rel} : taille arbitraire`);
  }
  // Les deux tailles sous le plancher : tâches en retard (barre repliée), initiales des réponses.
  assert.match(bottomRow, /collapsed \? 'absolute bottom-0 right-0 text-3xs leading-none' : 'text-2xs'/);
  assert.match(replies, /<span className="text-3xs font-semibold leading-none">\{initialsOf\(r\.name\)\}<\/span>/);
});

// ---------------------------------------------------------------- A-19
test('A-19 — coche des premiers pas : jeton success, sans couleur brute ni variante morte', () => {
  assert.match(firstSteps, /<CheckCircle2 className="text-success" \/>/);
  for (const rel of scope) {
    const src = code(rel);
    assert.doesNotMatch(src, /\b(?:bg|text|border|ring)-(?:green|emerald|red|amber|blue|indigo|violet|purple|gray|slate|zinc)-\d{2,3}\b/, `${rel} : couleur brute`);
    assert.doesNotMatch(src, /\bdark:/, `${rel} : variante dark:`);
  }
});

// ---------------------------------------------------------------- A-20
test('A-20 — 44 px sur téléphone : « Aller à… », menu de l’avatar et ses entrées', () => {
  const goTo = sidebar.slice(sidebar.indexOf('aria-label={`Aller à (${paletteShortcut})`}'), sidebar.indexOf('Aller à…'));
  assert.match(goTo, /\bmin-h-11\b/);
  assert.match(goTo, /\bmd:min-h-9\b/);
  assert.doesNotMatch(goTo, /(?<![\w:-])h-9\b/, 'plus de hauteur fixe de 36 px sur téléphone');

  const trigger = userMenu.slice(userMenu.indexOf('<DropdownMenuTrigger asChild>'), userMenu.indexOf('</DropdownMenuTrigger>'));
  assert.match(trigger, /<Button/);
  assert.match(trigger, /\bmin-h-11\b/);
  assert.match(userMenu, /const ITEM_CLASS = 'cursor-pointer min-h-11 md:min-h-8';/);
  // Crédits IA, Mon compte, thème, Déconnexion : les quatre entrées.
  assert.equal(countOf(userMenu, '<DropdownMenuItem'), 4);
  assert.equal((userMenu.match(/className=\{(?:cn\()?ITEM_CLASS/g) ?? []).length, 4);
});

// ---------------------------------------------------------------- A-21
test('A-21 — chiffre d’À traiter en accent, marque lisible, solde sans « ... » ni « n/d »', () => {
  // Le seul chiffre coloré de la barre : signal qui demande l'attention (01-direction.md, « L'accent »).
  assert.match(tabs, /offline \? 'bg-muted text-muted-foreground' : 'bg-brand text-brand-foreground'/);
  assert.match(tabs, /rounded-full px-1 text-3xs font-semibold tabular-nums/);
  assert.doesNotMatch(tabs, /opacity-60/, 'hors ligne : gris, pas une opacité sur le texte');
  assert.match(header, /bg-brand px-1 text-3xs font-semibold tabular-nums text-brand-foreground/);
  for (const [name, src] of [['SidebarTabs', tabs], ['AppHeader', header]]) {
    assert.doesNotMatch(src, /bg-primary[^'"]*text-primary-foreground/, `${name} : pastille monochrome`);
  }

  // Marque « Konekt » : gris lisible, sans capitales ni opacité sur le texte.
  const brand = sidebar.slice(sidebar.indexOf('<KonektLogo'), sidebar.indexOf('</SidebarFooter>'));
  assert.match(brand, /<span className="text-2xs font-medium text-muted-foreground">\s*Konekt\s*<\/span>/);
  assert.doesNotMatch(brand, /uppercase|tracking-|sidebar-foreground\/\d+/);
  assert.match(brand, /ariaLabel=\{collapsed \? 'Konekt' : ''\}/, 'logo décoratif quand le nom est écrit');

  // Solde : « … » et « Chargement » pour le lecteur d'écran, « Indisponible » en échec.
  assert.doesNotMatch(userMenu, /'\.\.\.'|n\/d/);
  assert.match(userMenu, /creditsLoading \? null : !hasCredits \? 'Indisponible' : formatCredits\(creditsRemaining\)/);
  assert.match(userMenu, /<span aria-hidden="true">…<\/span>\s*<span className="sr-only">Chargement<\/span>/);
  assert.match(userMenu, /toLocaleString\('fr-FR', \{/, 'milliers écrits à la française');
});

// ---------------------------------------------------------------- A-53
test('A-53 (ces fichiers) — boutons du kit ; bouton natif seulement pour les lignes de la barre', () => {
  // Contrôles de ligne gardés natifs, avec leur accessibilité propre : la ligne
  // primitive, l'onglet du tablist, le titre repliable d'une section, la vue
  // verrouillée d'une mission.
  const ROW_CONTROLS = {
    'src/components/sidebar/SidebarRow.tsx': 1,
    'src/components/sidebar/SidebarTabs.tsx': 1,
    'src/components/sidebar/SidebarSection.tsx': 1,
    'src/components/sidebar/missions/MissionNavRow.tsx': 1,
  };
  for (const rel of scope) {
    const n = (code(rel).match(/<button\b/g) ?? []).length;
    assert.equal(n, ROW_CONTROLS[rel] ?? 0, `${rel} : ${n} bouton(s) natif(s)`);
  }
  assert.match(tabs, /role="tab"/);
  assert.match(code('src/components/sidebar/SidebarSection.tsx'), /<button\s+type="button"\s+onClick=\{toggle\}\s+aria-expanded=\{isOpen\}/);
  assert.match(code('src/components/sidebar/missions/MissionNavRow.tsx'), /<button\s+type="button"\s+aria-disabled="true"/);

  for (const rel of [
    'src/components/AppSidebar.tsx',
    'src/components/sidebar/HelpMenu.tsx',
    'src/components/sidebar/SidebarUserMenu.tsx',
    'src/components/sidebar/SidebarSection.tsx',
    'src/components/sidebar/OfflineBanner.tsx',
    'src/components/sidebar/missions/MissionNavRow.tsx',
    'src/components/sidebar/missions/NewMissionButton.tsx',
    'src/components/sidebar/assistant/AssistantPanel.tsx',
    'src/components/sidebar/todo/ApprovalsSection.tsx',
    'src/components/sidebar/todo/FirstStepsSection.tsx',
    'src/components/sidebar/todo/ForYouSection.tsx',
    'src/components/sidebar/todo/InterviewsSections.tsx',
    'src/components/help/TutorialVideoDialog.tsx',
  ]) {
    assert.match(code(rel), /import \{ Button \} from '@\/components\/ui\/button';/, `${rel} : Button du kit`);
  }
  // Actions principales monochromes, sans aplat recopié à la main.
  for (const [rel, label] of [
    ['src/components/sidebar/missions/NewMissionButton.tsx', 'Nouvelle mission'],
    ['src/components/sidebar/assistant/AssistantPanel.tsx', 'Nouvelle conversation'],
  ]) {
    const src = code(rel);
    const at = src.indexOf(label);
    assert.match(src.slice(src.lastIndexOf('<Button', at), at), /variant="primary"/, rel);
    assert.doesNotMatch(src, /bg-primary px-3|text-primary-foreground/, `${rel} : aplat recopié à la main`);
  }
  assert.match(dialog, /variant="primary"\s+size="xs"/, '« C’est compris »');
});

// ---------------------------------------------------------------- A-54
test('A-54 (ces fichiers) — ni capitales espacées, ni texte atténué par opacité', () => {
  for (const rel of scope) {
    const src = code(rel);
    assert.doesNotMatch(src, /\buppercase\b|\btracking-wide(?:r|st)?\b/, `${rel} : capitales espacées`);
    assert.doesNotMatch(src, /\btext-[a-z-]*foreground\/\d+/, `${rel} : texte atténué par opacité`);
  }
  // Titre de section : 11 px, graisse 600, casse normale.
  assert.match(code('src/components/sidebar/SidebarSection.tsx'), /className="min-w-0 flex-auto text-2xs font-semibold text-muted-foreground"/);
});

// ---------------------------------------------------------------- Illustration
test('Illustration — aucune dans la barre : l’état vide de la page porte la sienne (une par écran)', () => {
  // La barre est présente sur chaque écran : un dessin dans « À traiter » doublerait
  // celui de l'état vide de la page (tableau de bord, agenda), docs/design/01-direction.md.
  assert.match(todoPanel, /\{nothingToDo && \(\s*<p className="px-3 py-2 text-xs text-muted-foreground">Rien à traiter pour le moment\.<\/p>/);
  for (const rel of scope) {
    assert.doesNotMatch(code(rel), /<Illustration\b/, `${rel} : illustration dans la barre`);
  }
});

// ---------------------------------------------------------------- Textes
test('Textes — ni tiret long, ni points de suspension en ASCII, ni nom de fournisseur', () => {
  const vendors = /\b(?:Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|People Data Labs|PDL)\b/;
  for (const rel of scope) {
    const src = read(rel);
    assert.ok(!src.includes('—'), `${rel} : tiret long`);
    assert.doesNotMatch(src, vendors, `${rel} : nom de fournisseur`);
    assert.doesNotMatch(code(rel), /(?:['"`>])[^'"`<>\n]*\.\.\.(?:['"`<])/, `${rel} : « ... » au lieu de « … »`);
  }
});
