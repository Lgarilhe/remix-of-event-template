/**
 * Refonte mission, lots 1 et 2 : garde-fous statiques de la nouvelle page
 * mission (contrat de construction, section 11).
 *
 * Même forme que lot0b-ecrivains.test.mjs : lecture des sources et assertions
 * sur les motifs, sans navigateur, sans base, sans esbuild (Node 20).
 *  - route /missions/:id/* vers MissionEntry, redirections en effet ;
 *  - interrupteur éteint : l'ancienne page et ses fichiers, intacts ;
 *  - nouvelle page : aucune écriture directe de l'étape, listes sur
 *    mission_candidate_rows sans les jamais ouverts, textes (ni confirm natif,
 *    ni mesure d'usage, ni tiret long, ni « (s) », ni nom de prestataire),
 *    stockage local seulement dans missionBeta.ts et sous try ;
 *  - ni migration ni fonction serveur ; CI à jour.
 *
 * Lancer : node --test tests/c1/lot12-mission-v3.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(join(ROOT, rel));

/** Fichiers d'un dossier, récursivement, chemins relatifs à la racine. */
function walk(rel, keep = () => true) {
  const out = [];
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(relative(ROOT, abs), keep));
    else if (keep(name)) out.push(relative(ROOT, abs));
  }
  return out;
}

/**
 * Code sans commentaires : blocs (JSX compris) et fins de ligne. Un « // »
 * n'est un commentaire qu'en début de ligne ou après une espace (les adresses
 * « https:// » restent) ; un « /* » qu'en début de ligne, après une espace,
 * une accolade ou une parenthèse (« image/* » reste).
 */
function stripComments(src) {
  return src
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const code = (rel) => stripComments(read(rel));

/**
 * Chaque requête sur une table : du .from('<table>') au point-virgule suivant
 * (une chaîne supabase tient dans une instruction).
 */
function queriesOn(src, table) {
  const out = [];
  const re = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`](\\s+as\\s+\\w+)?\\s*\\)`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index);
    const end = rest.indexOf(';');
    out.push(end < 0 ? rest : rest.slice(0, end));
  }
  return out;
}

/** Index de la parenthèse ou de l'accolade fermante qui répond à celle de `open`. */
function matching(src, open) {
  const pairs = { '(': ')', '{': '}' };
  const o = src[open];
  const c = pairs[o];
  assert.ok(c, `pas d'ouvrante à ${open}`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === o) depth += 1;
    else if (src[i] === c) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Plages [début, fin] des appels `name(` du code. */
function callRanges(src, name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\(`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matching(src, open);
    assert.ok(close > open, `fin de ${name}( introuvable`);
    out.push([open, close]);
  }
  return out;
}

/** Plages des blocs `try { … }`. */
function tryRanges(src) {
  const out = [];
  const re = /\btry\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    out.push([open, matching(src, open)]);
  }
  return out;
}

const inside = (index, ranges) => ranges.some(([a, b]) => index > a && index < b);

function indexesOf(src, re) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = g.exec(src))) out.push(m.index);
  return out;
}

// ─── Fichiers ───────────────────────────────────────────────────────────────

const APP = 'src/App.tsx';
const ENTRY = 'src/pages/MissionEntry.tsx';
const LAYOUT = 'src/components/AppLayout.tsx';
const NAV_ROW = 'src/components/sidebar/missions/MissionNavRow.tsx';
const VISIT_TRACKER = 'src/components/sidebar/missions/MissionVisitTracker.tsx';
const MISSIONS_PANEL = 'src/components/sidebar/missions/MissionsPanel.tsx';
const BETA = 'src/lib/missionBeta.ts';
const ROWS_HOOK = 'src/hooks/useMissionCandidateRows.ts';
const DETAIL_HOOK = 'src/hooks/useMissionCandidateDetail.ts';
const STAGE_ACTIONS = 'src/hooks/useMissionStageActions.ts';

/** Fichiers de la nouvelle page (contrat, section 11). */
const NEW_PAGE_FILES = [
  BETA,
  'src/hooks/useMissionBeta.ts',
  ROWS_HOOK,
  STAGE_ACTIONS,
  DETAIL_HOOK,
  ENTRY,
  // Lot 3 : carte « Maintenant » (lectures, reports, règle de la prochaine action).
  'src/hooks/useMissionNow.ts',
  'src/hooks/useMissionAttention.ts',
  'src/hooks/useMissionActionSnoozes.ts',
  'src/lib/missionNextAction.ts',
  'src/lib/missionSnooze.ts',
];

function newPageFiles() {
  const v3 = walk('src/components/missions/v3', (name) => /\.(tsx?|mjs|js)$/.test(name));
  assert.ok(v3.length > 0, 'src/components/missions/v3 vide ou absent');
  return [...NEW_PAGE_FILES, ...v3];
}

/** Fichiers d'aujourd'hui, gardés tels quels pour l'interrupteur éteint. */
const LEGACY_FILES = [
  'src/pages/MissionWorkspace.tsx',
  'src/components/missions/v2/MissionWorkspaceV2.tsx',
  'src/components/missions/v2/PhaseStepper.tsx',
  'src/components/missions/v2/MissionOverviewV2.tsx',
  'src/components/missions/MissionInsights.tsx',
  'src/components/missions/MissionOutreach.tsx',
  'src/components/missions/MissionPipeline.tsx',
  'src/hooks/useMissionReadiness.ts',
];

// ─── Route et entrée ────────────────────────────────────────────────────────

test('lots 1-2 : une seule route mission, /missions/:id/*, vers MissionEntry', () => {
  const app = code(APP);
  assert.match(app, /<Route path="\/missions\/:id\/\*" element=\{[^\n]*<MissionEntry \/>/, 'route /missions/:id/* rendant MissionEntry');
  assert.doesNotMatch(app, /path="\/missions\/:id"/, 'plus de route /missions/:id seule');
  assert.match(app, /const MissionEntry = lazy\(\(\) => import\(["']\.\/pages\/MissionEntry["']\)\)/);
  // Mêmes gardes que les autres pages de l'application.
  assert.match(app, /path="\/missions\/:id\/\*" element=\{<ProtectedRoute><OrganizationGuard><AppLayout><MissionEntry \/>/);
});

test('lots 1-2 : MissionEntry garde l\'ancienne page quand l\'interrupteur est éteint', () => {
  const entry = code(ENTRY);
  assert.match(entry, /export default function MissionEntry\(/);
  assert.match(entry, /import\(['"](\.\/MissionWorkspace|@\/pages\/MissionWorkspace)['"]\)|from ['"](\.\/MissionWorkspace|@\/pages\/MissionWorkspace)['"]/, 'MissionWorkspace importé');
  assert.match(entry, /<MissionWorkspace \/>/, 'ancienne page rendue telle quelle');
  assert.match(entry, /<MissionWorkspaceV3 projectId=\{id\} \/>/);
  assert.match(entry, /useMissionBeta\(\)/);
  for (const fn of ['legacyToV3Target', 'v3ToLegacyTarget', 'missionBetaParam', 'withoutMissionBetaParam', 'setMissionBeta']) {
    assert.match(entry, new RegExp(`\\b${fn}\\(`), `${fn} utilisé`);
  }
});

test('lots 1-2 : MissionEntry redirige par remplacement, dans un effet, jamais par <Navigate', () => {
  const entry = code(ENTRY);
  assert.doesNotMatch(entry, /<Navigate\b/, 'aucun composant de redirection rendu à la place de la page');
  assert.doesNotMatch(entry, /\bNavigate\b(?!\w)/, 'Navigate non importé');
  const navigations = indexesOf(entry, /\bnavigate\(/);
  assert.ok(navigations.length >= 2, 'au moins deux redirections (interrupteur, adresses)');
  const effects = callRanges(entry, 'useEffect');
  for (const at of navigations) {
    assert.ok(inside(at, effects), `navigate( hors d'un effet (position ${at})`);
    const call = entry.slice(at, matching(entry, at + 'navigate'.length) + 1);
    assert.match(call, /\{ replace: true \}/, `redirection sans remplacement : ${call}`);
  }
});

test('lots 1-2 : clé de page par mission dans AppLayout', () => {
  const layout = code(LAYOUT);
  assert.match(layout, /import \{ pageTransitionKey \} from ['"]@\/lib\/missionBeta['"]/);
  assert.match(layout, /pageTransitionKey\(location\.pathname\)/);
  assert.match(layout, /key=\{transitionKey\}/);
});

// ─── Barre latérale ─────────────────────────────────────────────────────────

test('lots 1-2 : MissionNavRow n\'affiche le chevron des vues qu\'interrupteur éteint', () => {
  const row = code(NAV_ROW);
  assert.match(row, /beta\?: boolean;/);
  assert.match(row, /beta = false,/, 'éteint par défaut');
  // Le code du chevron reste dans le fichier, rendu seulement !beta.
  assert.match(
    row,
    /\{!beta && \(\s*<Button[\s\S]{0,600}?aria-label=\{`Afficher les vues de \$\{item\.name\}`\}/,
    'chevron sous {!beta && (',
  );
  assert.match(row, /\{!beta && expanded && \(/, 'liste des vues sous !beta');
  assert.equal(row.match(/Afficher les vues de/g)?.length, 1);
});

test('lots 1-2 : relevé des visites et panneau Missions suivent l\'interrupteur', () => {
  const tracker = code(VISIT_TRACKER);
  assert.match(tracker, /const beta = useMissionBeta\(\);/);
  assert.match(tracker, /\[projectId, view, seenTotal, recordVisit\]/, 'tableau de dépendances littéral gardé (barre-lot5 B5)');
  assert.match(tracker, /missionIdFromPath\(/);
  assert.match(tracker, /screenToVisitView\(/);
  assert.match(tracker, /parseMissionView\(/, 'code d\'aujourd\'hui gardé pour l\'interrupteur éteint');

  const panel = code(MISSIONS_PANEL);
  assert.match(panel, /useMissionBeta\(\)/);
  assert.match(panel, /beta=\{beta\}/, 'beta transmis à MissionNavRow');
});

// ─── Rien d'existant supprimé ───────────────────────────────────────────────

test('lots 1-2 : les fichiers de l\'ancienne page sont toujours là', () => {
  for (const rel of LEGACY_FILES) assert.ok(exists(rel), `${rel} manquant`);
  // L'ancienne page reste branchée sur la V2 et son stepper.
  assert.match(code('src/pages/MissionWorkspace.tsx'), /MissionWorkspaceV2/);
  assert.match(code('src/components/missions/v2/MissionWorkspaceV2.tsx'), /<PhaseStepper\b/);
});

test('lots 1-2 : l\'ancienne page propose de passer à la nouvelle en un clic', () => {
  const legacy = code('src/pages/MissionWorkspace.tsx');
  assert.match(legacy, /import \{ setMissionBeta \} from ['"]@\/lib\/missionBeta['"]/);
  assert.match(legacy, /onClick=\{\(\) => setMissionBeta\(true\)\}/);
  assert.match(legacy, /Passer à la nouvelle page/);
});

// ─── Nouvelle page : écritures de l'étape ───────────────────────────────────

test('lots 1-2 : fichiers de la nouvelle page présents', () => {
  for (const rel of NEW_PAGE_FILES) assert.ok(exists(rel), `${rel} manquant`);
  for (const rel of [
    'src/components/missions/v3/MissionWorkspaceV3.tsx',
    'src/components/missions/v3/pipeline/PipelineScreen.tsx',
    'src/components/missions/v3/cadrage/CadrageScreen.tsx',
    'src/components/missions/v3/panels/CandidatePanel.tsx',
    'src/components/missions/v3/panels/ContactPanel.tsx',
  ]) {
    assert.ok(exists(rel), `${rel} manquant`);
  }
});

test('lots 1-2 : aucune écriture directe de job_candidate_status ni de pipeline_stage', () => {
  for (const rel of newPageFiles()) {
    const src = code(rel);
    for (const q of queriesOn(src, 'job_candidate_status')) {
      assert.doesNotMatch(q, /\.(update|upsert|insert|delete)\(/, `${rel} : écriture directe de job_candidate_status`);
      // Seule lecture admise : le repli du profil LinkedIn de la fiche.
      assert.equal(rel, DETAIL_HOOK, `${rel} : lecture de job_candidate_status hors du repli de la fiche`);
      assert.match(q, /\.select\(\s*['"]linkedin_profile_data['"]\s*\)/, `${rel} : seule linkedin_profile_data est lue`);
    }
    assert.doesNotMatch(src, /\brpc\(\s*['"`](set_candidate_stage|undo_candidate_stages)/, `${rel} : RPC d'étape appelée en direct (passer par @/lib/candidateStage)`);
    assert.doesNotMatch(src, /['"]?\bpipeline_stage['"]?\s*:/, `${rel} : pipeline_stage écrit`);
    assert.doesNotMatch(src, /\.(update|upsert|insert)\([^;]*\bpipeline_stage\b/, `${rel} : pipeline_stage écrit`);
    // status: reste permis pour le statut de la mission (sourcing_projects, par updateProject).
    for (const q of queriesOn(src, 'sourcing_projects')) {
      assert.doesNotMatch(q, /general_stage|pipeline_stage/, `${rel} : étape candidat écrite sur la mission`);
    }
  }
});

test('lots 1-2 : les gestes d\'étape passent par setCandidateStages sur tout le groupe', () => {
  const actions = code(STAGE_ACTIONS);
  assert.match(actions, /import \{[^}]*\bsetCandidateStages\b[^}]*\} from ['"]@\/lib\/candidateStage['"]/);
  assert.match(actions, /setCandidateStages\(\s*ids\b|setCandidateStages\(\s*rowWriteIds\(/);
  assert.match(actions, /rowWriteIds\(/, 'toutes les lignes du candidat dans la mission');
  assert.match(actions, /invalidateStageReaders\(/, 'relecture après le geste');
  assert.doesNotMatch(actions, /\bsetCandidateStage\(/, 'appel groupé seulement dans le hook');
});

// ─── Nouvelle page : lectures ───────────────────────────────────────────────

test('lots 1-2 : les listes lisent mission_candidate_rows sans les profils jamais ouverts', () => {
  const rows = code(ROWS_HOOK);
  const queries = queriesOn(rows, 'mission_candidate_rows');
  assert.ok(queries.length >= 1, `${ROWS_HOOK} lit mission_candidate_rows`);
  for (const q of queries) {
    assert.match(q, /\.eq\(\s*['"]is_unopened['"],\s*false\s*\)/, `${ROWS_HOOK} : jamais ouverts exclus`);
    assert.match(q, /\.eq\(\s*['"]project_id['"],/, `${ROWS_HOOK} : filtre par mission`);
  }
  assert.equal(queriesOn(rows, 'job_candidate_status').length, 0, `${ROWS_HOOK} : pas de liste sur job_candidate_status`);
  assert.match(rows, /\['project-candidates', projectId, 'v3-rows'/, 'clé sous le préfixe project-candidates');
  assert.match(rows, /\bPIPELINE_PAGE_SIZE\b/, 'pages de 50');

  // Toute autre lecture de la vue : sans les jamais ouverts, ou une seule ligne
  // (fiche : par identifiant ou par groupe), jamais une liste paginée.
  for (const rel of newPageFiles().filter((f) => f !== ROWS_HOOK)) {
    const src = code(rel);
    const oneRow = /\.(maybeSingle|single)\(\)|\.limit\(1\)/.test(src) && !/\.range\(/.test(src);
    for (const q of queriesOn(src, 'mission_candidate_rows')) {
      assert.ok(
        /\.eq\(\s*['"]is_unopened['"],\s*false\s*\)/.test(q) || oneRow,
        `${rel} : liste de mission_candidate_rows avec les jamais ouverts`,
      );
    }
  }
});

// ─── Nouvelle page : textes et interdits ────────────────────────────────────

const VENDORS = /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude)\b/;

test('lots 1-2 : ni confirm natif, ni mesure d\'usage, ni tiret long, ni « (s) », ni prestataire', () => {
  for (const rel of newPageFiles()) {
    const src = code(rel);
    assert.doesNotMatch(src, /\bwindow\.confirm\b|(^|[^\w.])confirm\(/m, `${rel} : window.confirm (AlertDialog)`);
    assert.doesNotMatch(src, /\btrackEvent\b/, `${rel} : trackEvent (mesure d'usage non décidée)`);
    assert.doesNotMatch(src, /\u2014/, `${rel} : tiret long`);
    assert.doesNotMatch(src, /[A-Za-zÀ-ÿ]\(s\)/, `${rel} : « (s) » (accorder par plural)`);
    const vendor = src.match(VENDORS);
    assert.equal(vendor, null, `${rel} : nom de prestataire « ${vendor?.[0]} »`);
  }
});

test('lots 1-2 : stockage local seulement dans missionBeta.ts, et sous try', () => {
  for (const rel of newPageFiles().filter((f) => f !== BETA)) {
    assert.doesNotMatch(code(rel), /\blocalStorage\b/, `${rel} : localStorage hors de missionBeta.ts`);
  }
  const beta = code(BETA);
  const uses = indexesOf(beta, /\blocalStorage\b/);
  assert.ok(uses.length >= 1, 'missionBeta.ts lit le stockage local');
  const tries = tryRanges(beta);
  for (const at of uses) assert.ok(inside(at, tries), `localStorage hors try dans missionBeta.ts (position ${at})`);
  // Lectures et écritures de l'interrupteur, sous try aussi.
  for (const at of indexesOf(beta, /\bstorage\.(getItem|setItem|removeItem)\(/)) {
    assert.ok(inside(at, tries), `accès au stockage hors try dans missionBeta.ts (position ${at})`);
  }
});

// ─── Ni migration, ni fonction serveur ──────────────────────────────────────

test('lots 1-2 : aucune migration ni fonction serveur ne cite la nouvelle page', () => {
  const files = [
    ...walk('supabase/migrations', (n) => n.endsWith('.sql')),
    ...walk('supabase/functions', (n) => /\.(ts|tsx|js|mjs|json|sql)$/.test(n)),
  ];
  assert.ok(files.length > 0);
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /mission-v3|missionBeta/, `${rel} cite la nouvelle page mission`);
  }
});

// ─── CI ─────────────────────────────────────────────────────────────────────

test('lots 1-2 : la CI joue ces gardes et les fonctions pures de l\'interrupteur', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /run: node --test tests\/c1\/lot12-mission-v3\.test\.mjs/);
  assert.match(ci, /run: node --test tests\/ux\/lot12-mission-beta\.test\.mjs/);
  // L'une lit les fichiers (agent-safety, sans npm ci) ; l'autre empaquette avec esbuild (build, après npm ci).
  const agent = ci.slice(ci.indexOf('  agent-safety:'), ci.indexOf('\n  migrations:'));
  assert.match(agent, /tests\/c1\/lot12-mission-v3\.test\.mjs/, 'garde statique dans agent-safety');
  const build = ci.slice(ci.indexOf('  build:'), ci.indexOf('\n  typecheck:'));
  assert.match(build, /- run: npm ci[\s\S]*tests\/ux\/lot12-mission-beta\.test\.mjs/, 'tests de l\'interrupteur dans build, après npm ci');
});
