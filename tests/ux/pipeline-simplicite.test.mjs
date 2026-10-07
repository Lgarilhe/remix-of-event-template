/**
 * Design simplifié, lot Suite 1 : le Pipeline global (/pipeline) suit les règles
 * de docs/design/06-simplicite.md, comme la page mission (lot M) et les Tâches (lot T).
 *  - une phrase chiffrée sous le titre, les chiffres dans l'Analyse seulement ;
 *  - la recherche et un seul menu « Filtres », la bascule d'affichage de la page mission ;
 *  - colonnes sans bordure, effectif écrit seulement s'il n'est pas nul, colonne vide muette ;
 *  - cartes : visage, nom, anneau de note, mission en texte, signal en texte, sans pastille ;
 *  - tableau à six colonnes, provenance sous la mission, sans cadre autour ;
 *  - chronologie et analyse sans cadre ; aucun chiffre à zéro ;
 *  - pagination du tableau et de la chronologie sous un filet, boutons discrets ;
 *  - aucun bouton plein sur la page tant qu'elle a des candidats.
 *
 * Rendu statique des composants empaquetés par esbuild (alias @/ résolus par
 * tsconfig.app.json, client de base remplacé par un module vide) ; gardes sur
 * le source pour la page. Lancer : node --test tests/ux/pipeline-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const supabase = {}; export const invokeEdgeFunction = () => {};',
      loader: 'js',
    }));
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { ATSStats } from './src/components/ats/ATSStats';",
      "export { ATSFilters } from './src/components/ats/ATSFilters';",
      "export { ATSCandidateCard } from './src/components/ats/ATSCandidateCard';",
      "export { ATSDroppableColumn } from './src/components/ats/ATSDroppableColumn';",
      "export { ATSTable } from './src/components/ats/ATSTable';",
      "export { ATSTimeline } from './src/components/ats/ATSTimeline';",
      "export { ATSPipelineAnalytics } from './src/components/ats/ATSPipelineAnalytics';",
      "export { ScoreRing } from './src/components/ui/score-ring';",
      "export { SegmentedControl } from './src/components/ui/segmented-control';",
      "export { TooltipProvider } from './src/components/ui/tooltip';",
      "export { DndContext } from '@dnd-kit/core';",
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
  loader: { '.webp': 'empty', '.svg': 'empty', '.png': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const h = kit.createElement;
const render = (component, props) =>
  kit.renderToStaticMarkup(h(kit.MemoryRouter, null, h(kit.TooltipProvider, null, h(component, props))));

const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
let seq = 0;
const candidate = (over) => {
  seq += 1;
  return {
    id: `row-${seq}`,
    candidateId: `cand-${seq}`,
    name: `Candidat ${seq}`,
    email: null,
    phone: null,
    linkedin: null,
    headline: 'Staff Engineer Go',
    expertise: [],
    stage: 'Nouveau',
    entity: null,
    source: 'local',
    sourceId: `row-${seq}`,
    jobId: 'project:22222222-2222-4222-8222-000000000001',
    jobTitle: 'Lead Developer Backend · Nova Pay',
    lastActivity: daysAgo(1),
    createdAt: daysAgo(20),
    score: null,
    projectId: '22222222-2222-4222-8222-000000000001',
    generalStage: 'to_sort',
    stageEnteredAt: daysAgo(1),
    ...over,
  };
};
const count = (html, re) => (html.match(re) || []).length;

test('Note : un anneau de la couleur de marque, le nombre lu ; sans note, rien', () => {
  const ring = render(kit.ScoreRing, { score: 82.6 });
  assert.match(ring, /class="stroke-brand"/);
  assert.match(ring, /<span class="sr-only">Note <\/span>83/);
  assert.doesNotMatch(ring, /success|warning|danger/, 'une seule couleur pour tous les niveaux');
  assert.equal(render(kit.ScoreRing, { score: null }), '');
  assert.equal(render(kit.ScoreRing, { score: undefined }), '');
});

test('Indicateurs : tuiles sans cadre, aucune tuile à zéro', () => {
  const quiet = render(kit.ATSStats, { candidates: [candidate({}), candidate({})] });
  assert.match(quiet, />Candidats</);
  assert.doesNotMatch(quiet, /au total|Taux de réponse/, 'rien de contacté : pas de tuile');
  assert.doesNotMatch(quiet, />0</);
  assert.match(quiet, /rounded-xl border-0 bg-muted\/60/);

  const busy = render(kit.ATSStats, {
    candidates: [
      candidate({ stage: 'Contacté', generalStage: 'contacted', contactedAt: daysAgo(3) }),
      candidate({ stage: 'Répondu', generalStage: 'replied', contactedAt: daysAgo(4), repliedAt: daysAgo(2) }),
    ],
  });
  assert.match(busy, /Contactés au total/);
  assert.match(busy, /Taux de réponse/);
  assert.doesNotMatch(busy, /Embauchés au total|Entretiens au total/, 'personne en entretien ni embauché');
});

test('Filtres : la recherche et un seul menu, nombre de choix sans zéro', () => {
  const options = { stages: [{ key: 'Nouveau', label: 'À trier' }], sources: ['local'], jobs: [], tags: [] };
  const empty = { search: '', stage: [], source: [], job: [], tag: [], hasReminder: false };
  const html = render(kit.ATSFilters, { filters: empty, onFiltersChange: () => {}, options });
  assert.match(html, /aria-label="Rechercher un candidat"/);
  assert.match(html, /aria-label="Filtres"/);
  assert.equal(count(html, /aria-haspopup="dialog"/g), 1, 'un seul menu');
  assert.doesNotMatch(html, /\(0\)|>0</);
  const chosen = render(kit.ATSFilters, { filters: { ...empty, stage: ['Nouveau'], hasReminder: true }, onFiltersChange: () => {}, options });
  assert.match(chosen, /aria-label="Filtres : 2 choisis"/);

  const src = read('src/components/ats/ATSFilters.tsx');
  for (const group of ['ats-filter-stage', 'ats-filter-source', 'ats-filter-job', 'ats-filter-tag', 'ats-filter-reminder']) {
    assert.match(src, new RegExp(`id="${group}"`), `groupe ${group}`);
  }
  assert.match(src, /options\.sources\.length > 1 &&/, 'la source ne se choisit que s\'il y en a plusieurs');
});

test('Carte : visage, nom, anneau de note, mission et signal en texte, sans pastille', () => {
  const card = render(kit.ATSCandidateCard, {
    candidate: candidate({ name: 'Inès Durand', score: 74, stage: 'Contacté', generalStage: 'contacted', stageEnteredAt: daysAgo(10) }),
    onOpen: () => {},
    onJobClick: () => {},
  });
  // Clair : carte blanche à ombre légère sur colonne grise ; sombre : carte en retrait sans ombre (contraste v2).
  assert.match(card, /class="group relative rounded-lg border bg-card p-2\.5 shadow-sm[^"]*dark:bg-muted dark:shadow-none/);
  assert.match(card, />ID</, 'initiales du candidat sans photo');
  assert.match(card, /<span class="sr-only">Note <\/span>74/);
  assert.match(card, /<span class="sr-only">Voir la mission <\/span><span class="truncate">Lead Developer Backend · Nova Pay<\/span>/);
  // Bloqué au-delà du délai de l'étape : orange, la seule couleur de la carte.
  assert.match(card, /class="[^"]*font-medium text-warning[^"]*"><span class="truncate">Dans cette étape depuis 10\u00a0j</);

  const sequence = render(kit.ATSCandidateCard, {
    candidate: candidate({ source: 'sequence', stage: 'Nouveau', stageEnteredAt: null, sequenceName: 'Approche', sequenceStatus: 'active', lastActivity: daysAgo(10) }),
    onOpen: () => {},
  });
  assert.match(sequence, /En cours, il y a 10\u00a0j/);
  assert.doesNotMatch(sequence, /text-warning|text-danger|text-success|text-info/);

  const src = read('src/components/ats/ATSCandidateCard.tsx');
  assert.doesNotMatch(src, /components\/ui\/badge|ScoreBadge|EnrollmentStatusBadge|Briefcase/);
});

test('Colonne : sans bordure, effectif écrit s\'il n\'est pas nul, vide muette sauf pendant un glisser', () => {
  const column = (props) =>
    render(kit.DndContext, {
      children: h(kit.ATSDroppableColumn, {
        id: 'Contacté',
        stage: { key: 'Contacté', label: 'Contacté' },
        stages: [{ key: 'Contacté', label: 'Contacté' }],
        candidates: [],
        isOver: false,
        onCandidateClick: () => {},
        onMove: () => {},
        ...props,
      }),
    });
  const empty = column({});
  // Clair : colonne grise (bg-muted) sous des cartes blanches ; sombre : colonne carte (bg-card).
  assert.match(empty, /<section aria-label="Colonne Contacté, 0 candidat" class="[^"]*rounded-xl[^"]*bg-muted dark:bg-card"/);
  assert.doesNotMatch(empty, /<section[^>]*class="[^"]*\bborder\b/, 'pas de bordure');
  assert.doesNotMatch(empty, />0<|Déposer ici/, 'au repos, une colonne vide ne dit rien');
  assert.match(column({ dragActive: true }), /Déposer ici/);
  const full = column({ candidates: [candidate({ stage: 'Contacté' }), candidate({ stage: 'Contacté' })] });
  assert.match(full, /<span class="shrink-0 tabular-nums" aria-hidden="true">2<\/span>/);
  assert.match(column({ isOver: true }), /bg-muted\/60 ring-1 ring-inset ring-brand\/50/);
});

test('Tableau : six colonnes, provenance sous la mission, sans cadre autour', () => {
  const html = render(kit.ATSTable, {
    candidates: [
      candidate({ name: 'Ligne de mission', score: 81 }),
      candidate({ name: 'Inscrit en séquence', source: 'sequence', sequenceName: 'Approche Lead', sequenceStatus: 'active' }),
      candidate({ name: 'Contacté par InMail', source: 'inmail' }),
    ],
    onCandidateClick: () => {},
    onJobClick: () => {},
  });
  assert.equal(count(html, /<th\b/g), 6);
  assert.match(html, /Séquence Approche Lead, en cours/);
  assert.match(html, />InMail</);
  const body = html.slice(html.indexOf('<tbody'));
  assert.doesNotMatch(body, />Mission</, 'une ligne de mission ne répète pas sa provenance');
  assert.match(html, /<span class="sr-only">Note <\/span>81/);
  assert.doesNotMatch(html, /rounded-xl border/, 'pas de cadre autour du tableau');
  // Au doigt, chaque contrôle d'une ligne a 44 px : texte élargi de 12 px en haut et en bas, icône de 28 px élargie de 8 px.
  const src = read('src/components/ats/ATSTable.tsx');
  assert.match(src, /const TEXT_BUTTON =\s*'relative [^']*after:absolute after:inset-x-0 after:-inset-y-1 \[@media\(pointer:coarse\)\]:after:-inset-y-3'/);
  assert.match(src, /const ICON_LINK = 'relative after:absolute after:-inset-2'/);
  assert.equal(count(src, /size="icon-xs" className=\{ICON_LINK\}/g), 2);
  assert.match(src, /after:absolute after:inset-x-0 after:-inset-y-2 hover:text-foreground/, 'en-têtes triables de 44 px');
});

test('Pagination : 25 lignes par page, barre sans cadre sous un filet, boutons discrets de 44 px au doigt', () => {
  const many = Array.from({ length: 26 }, (_, i) => candidate({ name: `Personne ${i + 1}` }));
  const table = render(kit.ATSTable, { candidates: many, onCandidateClick: () => {} });
  assert.equal(count(table.slice(table.indexOf('<tbody')), /<tr\b/g), 25);
  const timeline = render(kit.ATSTimeline, { candidates: many, onCandidateClick: () => {} });
  for (const [name, html] of [['tableau', table], ['chronologie', timeline]]) {
    const nav = html.slice(html.indexOf('<nav aria-label="Pagination de la liste"'));
    assert.match(nav, /^<nav aria-label="Pagination de la liste" class="[^"]*border-t border-border"/, `${name} : barre sous un filet`);
    assert.doesNotMatch(nav, /rounded-lg border|bg-card/, `${name} : barre sans cadre`);
    assert.equal(count(nav, /max-md:h-11/g), 2, `${name} : Précédent et Suivant de 44 px au doigt`);
    assert.match(nav, /1 à 25 sur 26/);
  }
  assert.doesNotMatch(read('src/components/ats/ATSPagination.tsx'), /variant="outline"/, 'boutons discrets (règle 2)');
});

test('Chronologie : une ligne de texte par candidat, sans cadre', () => {
  const html = render(kit.ATSTimeline, {
    candidates: [candidate({ name: 'Maxime Clement', stage: 'ITW en cours', generalStage: 'interviewing', processStepName: 'Pré-qualification', sequenceName: 'Approche Lead' })],
    onCandidateClick: () => {},
    onJobClick: () => {},
  });
  assert.match(html, /<div class="relative rounded-lg px-3 py-2\.5 transition-colors duration-150 hover:bg-muted\/50">/);
  assert.match(html, />Pré-qualification</);
  assert.match(html, /<span class="sr-only">Séquence <\/span><span class="truncate">Approche Lead<\/span>/);
  assert.doesNotMatch(html, /rounded-lg border|rounded-xl border|rounded-full border/, 'ni cadre ni pastille');
  assert.match(html, /\[@media\(pointer:coarse\)\]:after:-inset-y-3/, 'lien de mission de 44 px au doigt');
});

test('Analyse : aucun chiffre à zéro, l\'orange pour les candidats bloqués', () => {
  const figures = (candidates) => render(kit.ATSPipelineAnalytics, { candidates });
  // Personne d'engagé ni de sorti : pas de chiffres, pas de section.
  const fresh = figures([candidate({}), candidate({})]);
  assert.doesNotMatch(fresh, /Jours dans l|Sans mouvement|Taux de réussite|Goulots/);
  assert.doesNotMatch(fresh, />0</);

  const moving = figures([candidate({ stage: 'Contacté', generalStage: 'contacted', stageEnteredAt: daysAgo(2) })]);
  assert.match(moving, /Jours dans l&#x27;étape/);
  assert.doesNotMatch(moving, /Sans mouvement|Taux de réussite/, 'rien de bloqué, personne de sorti');

  const stuck = figures([
    candidate({ stage: 'Contacté', generalStage: 'contacted', stageEnteredAt: daysAgo(12) }),
    candidate({ stage: 'Gagné', generalStage: 'hired', stageEnteredAt: daysAgo(1) }),
  ]);
  assert.match(stuck, /Sans mouvement<\/p>[\s\S]*?<p class="text-2xl font-semibold tabular-nums text-warning">1<\/p>/);
  assert.match(stuck, /Taux de réussite/);
  assert.match(stuck, /Goulots d&#x27;étranglement/);
  assert.doesNotMatch(stuck, /rounded-xl border|bg-card/, 'sections et chiffres sans cadre');
});

test('Bascule d\'affichage : la variante « quiet » du kit, rendu par défaut inchangé', () => {
  const options = [
    { value: 'a', label: 'Colonnes' },
    { value: 'b', label: 'Tableau' },
  ];
  const quiet = render(kit.SegmentedControl, { 'aria-label': 'Affichage', value: 'a', onValueChange: () => {}, options, variant: 'quiet', iconsOnlyOnPhone: true });
  // Contraste (façon Qonto) : rail gris plein, option choisie en carte blanche en clair, creusée en sombre.
  assert.match(quiet, /<div role="group" aria-label="Affichage" class="inline-flex shrink-0 items-center rounded-lg bg-muted p-0\.5 max-md:h-auto">/);
  assert.match(quiet, /aria-pressed="true" class="[^"]*bg-card font-semibold text-foreground dark:bg-background"/);
  assert.doesNotMatch(quiet, /shadow-sm|ring-border-strong/);

  const plain = render(kit.SegmentedControl, { 'aria-label': 'Affichage', value: 'a', onValueChange: () => {}, options });
  assert.match(plain, /class="inline-flex shrink-0 items-center gap-0\.5 rounded-lg bg-muted p-0\.5 h-8 max-md:h-auto"/);
  assert.match(plain, /aria-pressed="true" class="[^"]*bg-background text-foreground shadow-sm ring-1 ring-border-strong"/);
  assert.match(plain, /<span>Colonnes<\/span>/, 'sans icône, le libellé reste visible partout');
});

test('Page : phrase chiffrée, chiffres dans l\'Analyse, aucun bouton plein, plus d\'« Actualiser »', () => {
  const page = read('src/pages/ATS.tsx');
  assert.match(page, /`\$\{plural\(people, 'candidat'\)\} dans \$\{plural\(missions, 'mission'\)\}`/);
  assert.equal(count(page, /<ATSStats\b/g), 1);
  assert.ok(page.indexOf('<ATSStats') > page.indexOf("case 'analytics':"), 'indicateurs dans l\'Analyse seulement');
  assert.doesNotMatch(page, /RefreshCw|ATSStatsSkeleton|<Select\b/);
  assert.match(page, /<SegmentedControl\s+aria-label="Affichage du pipeline"\s+variant="quiet"\s+iconsOnlyOnPhone/);
  // Sans candidat, ni filtres ni bascule d'affichage (règle 8) ; pendant le chargement, la bascule reste.
  assert.match(page, /\{\(loading \|\| hasCandidates\) && \(\s*<div className="mb-5 flex flex-wrap items-center gap-2">/);
  // Chaque bouton de la page a sa variante : aucun bouton plein (l'état vide garde le contour).
  for (const button of page.match(/<Button\b[^>]*>/g) || []) {
    assert.match(button, /variant="(ghost|outline|link)"/, `bouton plein : ${button}`);
  }
  assert.equal(existsSync(join(ROOT, 'src/components/ats/ATSStatsSkeleton.tsx')), false);
});
