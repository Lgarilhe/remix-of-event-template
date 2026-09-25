/**
 * Chantier design, lot 7a : pipeline global (/pipeline).
 *
 * Invariants épinglés :
 *   - un seul barème et un seul rendu du score, ScoreBadge (E-11, E-15) ;
 *   - une seule table de stagnation et un seul libellé, « Sans mouvement
 *     depuis 6 j », en texte warning (E-17) ;
 *   - la provenance d'un candidat écrite en mots, jamais « local » (E-18) ;
 *   - carte à trois lignes, sans badge de source ni statut brut ; statut de
 *     séquence traduit par le catalogue (E-19, E-43) ;
 *   - « Avec rappel » dans les filtres, « Rappels » dans l'en-tête (E-20) ;
 *   - Rappels dans un panneau latéral, « Déplacer vers… » sur chaque carte (E-21) ;
 *   - glisser-déposer au clavier, annonces et consignes en français (E-22) ;
 *   - un seul toast pour un déplacement groupé, échecs comptés, retour
 *     arrière sur échec (E-23) ;
 *   - en-tête, vues, indicateurs et état vide du registre calme (E-14, E-24) ;
 *   - tableau, chronologie, analyse, shortlist client (E-25 à E-28) ;
 *   - une lecture en échec s'affiche comme une erreur (E-44) ; texte (E-46 à E-53).
 *
 * `useATSData` est chargé en mémoire, ses dépendances d'exécution (base,
 * requêtes, toasts) remplacées par des modules vides. Sans navigateur ni base.
 * Lancer : node --test tests/ux/lot7a-pipeline.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const STUBS = [
  'export const supabase = {};',
  'export const invokeEdgeFunction = () => {};',
  'export const toast = {};',
  'export const useQuery = () => ({});',
  'export const useQueryClient = () => ({});',
  'export const useMemo = (f) => f();',
  'export const useCallback = (f) => f;',
].join('\n');

const loadATSData = async () => {
  const stubs = {
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /^(@\/|react$|@tanstack\/react-query$|sonner$)/ }, (args) => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUBS, loader: 'js' }));
    },
  };
  const out = await build({
    entryPoints: [join(ROOT, 'src/hooks/useATSData.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [stubs],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};

const ats = await loadATSData();

const PAGE = read('src/pages/ATS.tsx');
const CARD = read('src/components/ats/ATSCandidateCard.tsx');
const TABLE = read('src/components/ats/ATSTable.tsx');
const TIMELINE = read('src/components/ats/ATSTimeline.tsx');
const ANALYTICS = read('src/components/ats/ATSPipelineAnalytics.tsx');
const KANBAN = read('src/components/ats/ATSKanban.tsx');
const COLUMN = read('src/components/ats/ATSDroppableColumn.tsx');
const FILTERS = read('src/components/ats/ATSFilters.tsx');
const BULK = read('src/components/ats/BulkActionsBar.tsx');
const REMINDERS = read('src/components/ats/RemindersSidebar.tsx');
const HOOK = read('src/hooks/useATSData.ts');

const PERIMETER = [
  'src/pages/ATS.tsx',
  'src/components/ats/ATSKanban.tsx',
  'src/components/ats/ATSDraggableCard.tsx',
  'src/components/ats/ATSDroppableColumn.tsx',
  'src/components/ats/ATSCandidateCard.tsx',
  'src/components/ats/ATSTable.tsx',
  'src/components/ats/ATSTimeline.tsx',
  'src/components/ats/ATSPipelineAnalytics.tsx',
  'src/components/ats/ATSStats.tsx',
  'src/components/ats/ATSFilters.tsx',
  'src/components/ats/ATSKanbanSkeleton.tsx',
  'src/components/ats/ATSStatsSkeleton.tsx',
  'src/components/ats/ATSTableSkeleton.tsx',
  'src/components/ats/BulkActionsBar.tsx',
  'src/components/ats/RemindersSidebar.tsx',
  'src/components/candidates/CandidatePipeline.tsx',
  'src/components/candidates/DroppableColumn.tsx',
  'src/components/candidates/DraggableCandidateCard.tsx',
  'src/components/candidates/CandidateFilters.tsx',
  'src/components/candidates/PipelineStats.tsx',
  'src/components/candidates/CandidateList.tsx',
  'src/components/candidates/CandidateCard.tsx',
];

/** Littéraux de chaîne et textes JSX, sans commentaires ni chemins d'import. */
const visibleStrings = (src) => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '');
  return [
    ...[...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...code.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ];
};

const DAY = 86_400_000;
const NOW = new Date('2026-09-25T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

test('E-11, E-15 : un seul rendu du score, ScoreBadge, sans barème local', () => {
  for (const [name, src] of [['carte', CARD], ['tableau', TABLE]]) {
    assert.match(src, /<ScoreBadge score=\{candidate\.score\}/, `${name} : ScoreBadge absent`);
    assert.doesNotMatch(src, /score >= (70|40)/, `${name} : barème local`);
  }
});

test('E-17 : une seule table de stagnation, dans useATSData', () => {
  assert.deepEqual(ats.STAGNATION_DAYS, {
    'Nouveau': 3, 'Contacté': 5, 'Répondu': 3, 'Pressenti': 5,
    'Pré-qualif': 7, 'CV envoyé': 5, 'ITW en cours': 10, 'Offre': 7,
  });
  const candidate = (stage, days) => ({ stage, lastActivity: ago(days * DAY), createdAt: ago(40 * DAY) });
  assert.equal(ats.stagnantDays(candidate('Contacté', 6), NOW), 6);
  assert.equal(ats.stagnantDays(candidate('Contacté', 5), NOW), null, 'le délai lui-même ne compte pas');
  assert.equal(ats.stagnantDays(candidate('Gagné', 30), NOW), null, 'étape terminale');
  assert.equal(ats.stagnantDays(candidate('sourced', 30), NOW), null, 'étape inconnue');
  for (const [name, src] of [['carte', CARD], ['tableau', TABLE], ['analyse', ANALYTICS]]) {
    assert.doesNotMatch(src, /GUIDE_TIMES\s*[:=]/, `${name} : seuils recopiés`);
  }
  assert.match(CARD, /Sans mouvement depuis \$\{stagnant\}\\u00a0j/);
  assert.match(CARD, /'font-medium text-warning'/);
  assert.doesNotMatch(CARD, /border-l-destructive|Inactif depuis/, 'plus de bordure rouge ni d’ancien libellé');
});

test('E-25 : même format de date sur la carte et dans le tableau', () => {
  const label = (ms) => ats.timeAgoLabel(ago(ms), NOW);
  assert.equal(label(30_000), "à l'instant");
  assert.equal(label(5 * 60_000), 'il y a 5\u00a0min');
  assert.equal(label(3 * 3_600_000), 'il y a 3\u00a0h');
  assert.equal(label(6 * DAY), 'il y a 6\u00a0j');
  assert.doesNotMatch(label(45 * DAY), /il y a/, 'date courte au-delà de 30 jours');
  assert.equal(ats.timeAgoLabel(null, NOW), null);
  assert.match(CARD, /timeAgoLabel\(/);
  assert.match(TABLE, /timeAgoLabel\(activity, now\)/);
});

test('E-18 : la provenance s’écrit en mots, jamais « local »', () => {
  assert.deepEqual(ats.ATS_SOURCE_LABELS, { local: 'Mission', sequence: 'Séquence', inmail: 'InMail' });
  assert.match(FILTERS, /ATS_SOURCE_LABELS\[source\]/);
  assert.match(TABLE, /ATS_SOURCE_LABELS\[candidate\.source\]/);
  assert.doesNotMatch(CARD, /SOURCE_CONFIG|'Pipeline'/, 'plus de badge de source sur la carte');
});

test('E-19, E-43 : carte à trois lignes, statut de séquence traduit', () => {
  assert.match(CARD, /EnrollmentStatusBadge/);
  assert.doesNotMatch(CARD, /\{candidate\.sequenceStatus\}/, 'statut brut affiché');
  assert.doesNotMatch(CARD, /expertise|candidate\.tags/, 'plus d’expertise ni d’étiquettes sur la carte');
  assert.match(CARD, /'A répondu'/);
  // Un seul arrêt de tabulation pour la carte : le nom, relié au glisser.
  assert.match(CARD, /ref=\{drag\?\.setActivatorNodeRef\}/);
  assert.doesNotMatch(CARD, /role="button"|tabIndex=\{0\}/);
  assert.doesNotMatch(read('src/components/ats/ATSDraggableCard.tsx'), /\{\.\.\.attributes\}/, 'plus d’enveloppe focusable');
  // La puce du poste est un bouton.
  assert.match(CARD, /onClick=\{\(\) => onJobClick\?\.\(candidate\.jobId as string\)\}/);
});

test('E-20 : « Avec rappel » dans les filtres, « Rappels » dans l’en-tête', () => {
  assert.match(FILTERS, /Avec rappel/);
  assert.match(FILTERS, /aria-pressed=\{filters\.hasReminder\}/);
  assert.doesNotMatch(FILTERS, /Bell|>\s*Rappels\s*</);
  assert.match(PAGE, /<Bell aria-hidden="true" \/>\s*Rappels/);
});

test('E-21 : Rappels en panneau latéral, « Déplacer vers… » sur chaque carte', () => {
  assert.match(REMINDERS, /<Sheet open=\{open\} onOpenChange=\{onOpenChange\}>/);
  assert.match(REMINDERS, /w-full max-w-none/, 'plein écran sous 768 px');
  assert.match(CARD, /Déplacer \$\{candidate\.name\} vers une autre étape/);
  assert.match(CARD, /DropdownMenuRadioGroup/);
  assert.match(read('src/components/candidates/DraggableCandidateCard.tsx'), /Déplacer \$\{name\} vers une autre étape/);
});

test('E-22 : glisser-déposer au clavier, en français', () => {
  for (const [name, src] of [['pipeline', KANBAN], ['shortlist', read('src/components/candidates/CandidatePipeline.tsx')]]) {
    assert.match(src, /useSensor\(KeyboardSensor/, `${name} : KeyboardSensor absent`);
    assert.match(src, /screenReaderInstructions: SCREEN_READER_INSTRUCTIONS/, `${name} : consignes`);
    assert.match(src, /saisi, dans la colonne/, `${name} : annonce de saisie`);
    assert.match(src, /déposé dans \$\{stageLabel\(over\.id\)\}/, `${name} : annonce de dépôt`);
    assert.doesNotMatch(src, /To pick up|Picked up/);
  }
  assert.match(read('src/components/ats/ATSDraggableCard.tsx'), /roleDescription: 'carte déplaçable'/);
  // Case de sélection visible au focus.
  assert.match(CARD, /focus-visible:opacity-100/);
});

test('E-23 : survol sobre, un seul toast groupé, retour arrière sur échec', () => {
  assert.doesNotMatch(COLUMN, /scale-\[|shadow-lg|⬇️/);
  assert.match(COLUMN, /'border-brand bg-muted'/);
  assert.match(PAGE, /handleStageChange\(id, newStage, \{ silent: true \}\)/);
  assert.match(BULK, /plural\(failed, 'échec'\)/);
  assert.equal((BULK.match(/toast\.(success|error|warning)\(/g) || []).length, 4, 'un toast par issue, pas par candidat');
  assert.match(HOOK, /if \(upsertError\) throw upsertError;/);
  assert.match(HOOK, /if \(!options\.silent\)/);
});

test('E-14, E-24 : en-tête, vues et état vide du registre calme', () => {
  assert.equal(existsSync(join(ROOT, 'src/components/ui/AnimatedFunnel.tsx')), false);
  assert.doesNotMatch(PAGE, /AnimatedFunnel|-3d\.webp|Sync…|animate-pulse/);
  assert.match(PAGE, /title="Pipeline \| Konekt"/);
  for (const label of ['Colonnes', 'Tableau', 'Chronologie', 'Analyse', 'Shortlist client']) {
    assert.ok(PAGE.includes(`label: '${label}'`), `vue « ${label} » absente`);
  }
  assert.match(PAGE, /Aucun candidat pour l'instant/);
  assert.match(PAGE, /<Link to="\/missions">Aller aux missions<\/Link>/);
  assert.match(read('src/components/ats/ATSStats.tsx'), /<StatTile label="Candidats"/);
  assert.doesNotMatch(read('src/components/ats/ATSStats.tsx'), /hover:|emerald|Trophy/);
});

test('E-25 : tableau accessible', () => {
  assert.match(TABLE, /aria-sort=\{active \? \(sortDirection === 'asc' \? 'ascending' : 'descending'\) : 'none'\}/);
  assert.match(TABLE, /Écrire un e-mail à \$\{candidate\.name\}/);
  assert.doesNotMatch(TABLE, /window\.open/);
  const headers = (TABLE.match(/sortHeader\('|<TableHead className/g) || []).length;
  const widths = read('src/components/ats/ATSTableSkeleton.tsx').match(/HEADER_WIDTHS = \[([^\]]*)\]/);
  const skeletonCols = widths ? widths[1].split(',').filter((w) => w.trim()).length : 0;
  assert.equal(headers, 8, 'huit colonnes');
  assert.equal(skeletonCols, 8, 'squelette à huit colonnes');
});

test('E-26 : chronologie datée hors « Aujourd’hui », état vide dû aux filtres', () => {
  assert.match(TIMELINE, /"d MMM 'à' HH:mm"/);
  assert.match(TIMELINE, /export const ATSTimelineSkeleton/);
  assert.match(PAGE, /Aucun candidat ne correspond aux filtres/);
  assert.match(PAGE, /Effacer les filtres/);
});

test('E-27 : analyse nommée selon ce qu’elle mesure, barres monochromes', () => {
  for (const label of ['Jours depuis la dernière action', 'Répartition par étape', 'Taux de réussite']) {
    assert.ok(ANALYTICS.includes(label), `« ${label} » absent`);
  }
  assert.doesNotMatch(ANALYTICS, /Taux de win|Cycle moyen|Temps moyen|bg-gradient|emerald/);
  assert.match(ANALYTICS, /bg-muted-foreground/);
  assert.match(ANALYTICS, /export const ATSPipelineAnalyticsSkeleton/);
});

test('E-28 : shortlist client sur les primitives et le registre calme', () => {
  const column = read('src/components/candidates/DroppableColumn.tsx');
  assert.match(column, /rounded-xl/);
  assert.match(column, /Voir plus \(\{remainingCount\}\)/);
  assert.doesNotMatch(column, /uppercase|restants/);
  assert.match(read('src/components/candidates/CandidateFilters.tsx'), /FilterPill/);
  const card = read('src/components/candidates/DraggableCandidateCard.tsx');
  assert.doesNotMatch(card, /green-700|purple-700|brand-purple/);
  assert.match(card, /aria-expanded=\{isExpanded\}/);
});

test('E-44 : une lecture en échec s’affiche comme une erreur', () => {
  assert.match(HOOK, /if \(pageError\) throw new Error/);
  assert.doesNotMatch(HOOK, /Failed to load data/);
  assert.match(PAGE, /Impossible de charger le pipeline/);
  assert.match(REMINDERS, /Impossible de charger les rappels/);
  assert.doesNotMatch(REMINDERS, /toast\.error\('Erreur lors du chargement/);
});

test('E-46 à E-53 : texte français, sans emoji ni tiret long, pourcentages espacés', () => {
  const offenders = [];
  for (const rel of PERIMETER) {
    const src = read(rel);
    for (const s of visibleStrings(src)) {
      if (/\p{Extended_Pictographic}/u.test(s)) offenders.push(`${rel} : emoji « ${s} »`);
      if (s.includes('—')) offenders.push(`${rel} : tiret long « ${s} »`);
      if (/\b(tu|ton|ta|tes)\b/i.test(s) && /\b(tu|tes)\b/.test(s)) offenders.push(`${rel} : tutoiement « ${s} »`);
      // « 25 % » : espace insécable (\u00a0) avant le signe ; une largeur CSS calculée n'est pas un texte.
      const text = s.replace(/\\u00a0%/g, '');
      if (/(\d|\})%/.test(text) && !/Math\.m(ax|in)\(/.test(s)) offenders.push(`${rel} : pourcentage collé « ${s} »`);
    }
    assert.doesNotMatch(src, /animate-(pulse|ping|bounce)/, `${rel} : animation en boucle`);
  }
  assert.deepEqual(offenders, []);
});
