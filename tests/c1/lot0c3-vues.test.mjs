/**
 * Refonte mission, lot 0c-3 : garde-fous statiques des écrans de vue (plan
 * final, sections 3.2, 6.3, 4.1 et 10.1, ligne 0c-3) : liste des missions,
 * Vue d'ensemble, Analyses, tableau de bord.
 *
 * Même forme que lot0c-lectures.test.mjs : lecture du source et assertions sur
 * les motifs, sans navigateur ni base. Le kanban et le tableau de mission
 * (MissionPipeline, ProjectCandidatesTableEnhanced) ont leurs propres
 * assertions dans l'unité qui les porte.
 *
 * Lancer : node --test tests/c1/lot0c3-vues.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const LIST = 'src/components/outreach/projects/ProjectsListV2.tsx';
const OVERVIEW = 'src/components/missions/v2/MissionOverviewV2.tsx';
const INSIGHTS = 'src/components/missions/MissionInsights.tsx';
const FUNNEL = 'src/components/outreach/projects/ProjectFunnel.tsx';
const DASHBOARD = 'src/components/dashboard/DashboardMissionsPanel.tsx';
const ADAPTER = 'src/lib/missionStatsAdapter.ts';

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

test('0c-3 : plus de prochaine étape ni de « Brief incomplet » dans src/components/outreach/projects', () => {
  const files = walk('src/components/outreach/projects').filter((f) => f.endsWith('.tsx'));
  assert.ok(files.includes(LIST), 'ProjectsListV2.tsx attendu');
  for (const f of files) {
    assert.doesNotMatch(code(f), /computeNextStep|getNarrativeBucket|NextStep|Brief incomplet/, f);
  }
});

test('0c-3 : la liste lit les compteurs d\'étapes, pas les anciennes statistiques', () => {
  const src = code(LIST);
  assert.match(src, /useMissionStageCounts/);
  assert.match(src, /missionActivityAt/);
  assert.doesNotMatch(src, /useProjectStats|useMultipleProjectStats|get_project_stats|get_multiple_project_stats/);
  assert.doesNotMatch(src, /last_search_at|lastSearchAt/);
});

test('0c-3 : la liste a deux groupes, des effectifs sous le nom des étapes et « N profils trouvés »', () => {
  const src = code(LIST);
  assert.match(src, /En cours/);
  assert.match(src, /Terminées, archivées/);
  // Noms des étapes : ceux du module d'affichage, jamais recopiés à la main.
  for (const stage of ['to_sort', 'contacted', 'replied', 'interviewing']) {
    assert.match(src, new RegExp(`GENERAL_STAGE_LABEL\\.${stage}\\b`), stage);
  }
  assert.match(src, /c\.toSort/);
  assert.match(src, /c\.interviewing/);
  assert.match(src, /counts\.unopened/);
  assert.match(src, /profil trouvé/);
});

test('0c-3 : la liste ouvre la mission sans ?tab= et rend une erreur de lecture comme une erreur', () => {
  const src = code(LIST);
  // Ouverture d'une ligne : un seul argument, donc /missions/:id nu.
  assert.match(src, /onOpen=\{\(\) => navigateToWorkspace\(project\)\}/);
  assert.doesNotMatch(src, /\?tab=/);
  // Erreur des effectifs : état d'erreur, jamais des zéros.
  assert.match(src, /countsQuery\.isError/);
  assert.match(src, /role="alert"/);
  assert.match(src, /counts\?\.\[project\.sourcingProject\.id\] \?\? null/);
  // Erreur ou attente de la liste elle-même : jamais l'état vide à tort.
  assert.match(src, /hasData/);
  assert.match(src, /isError: listError/);
  assert.match(src, /<ErrorState/);
  assert.match(src, /if \(hasData && unifiedProjects\.length === 0\)/);
});

test('0c-3 : bandeau limité aux missions En cours, date et tri sur la dernière activité', () => {
  const src = code(LIST);
  assert.match(src, /const ongoingProjects = useMemo\(\(\) => unifiedProjects\.filter\(p => isOngoing\(p\.status\)\)/);
  assert.match(src, /ongoingProjects\.map\(countsOf\)/);
  assert.match(src, /missionActivityAt\(project\.updatedAt, countsOf\(project\)\?\.lastStageMoveAt \?\? null\)/);
  // La date reste lisible sous 1024 px.
  assert.match(src, /Activité \{activity\}/);
});

test('0c-3 : aucune promesse de la liste sans gestion du rejet', () => {
  const src = code(LIST);
  const awaits = src.match(/await (updateProject|deleteProject)\(/g) ?? [];
  assert.equal(awaits.length, 2);
  const tries = src.match(/try \{\s*await (updateProject|deleteProject)\(/g) ?? [];
  assert.equal(tries.length, 2, 'chaque await de mutation est dans un try/catch');
});

test('0c-3 : la liste lit le poste, le client et le lieu du brief', () => {
  const hook = read('src/hooks/useSourcingProjects.ts');
  assert.match(hook, /jd_title:job_details->>title/);
  assert.match(hook, /jd_client:job_details->client->>name/);
  assert.match(hook, /jd_location:job_details->>location/);
  const types = code('src/types/projects.ts');
  assert.match(types, /sp\.jd_title/);
  assert.match(types, /sp\.jd_client/);
  assert.match(types, /sp\.jd_location/);
});

test('0c-3 : plus aucune lecture de stats_replied, stats_qualified, stats_hired dans src', () => {
  const offenders = walk('src')
    .filter((f) => f !== join('src', 'integrations', 'supabase', 'types.ts'))
    .filter((f) => /stats_replied|stats_qualified|stats_hired/.test(read(f)));
  assert.deepEqual(offenders, []);
});

test('0c-3 : Vue d\'ensemble, cumuls lus dans get_mission_stage_counts et écrits « au total »', () => {
  const src = code(OVERVIEW);
  assert.match(src, /useMissionStageCounts\(\[project\.id\]\)/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_replied, value: counts \? counts\.everReplied : null/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_interviewed, value: counts \? counts\.everInterviewed : null/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_hired, value: counts \? counts\.everHired : null/);
  assert.match(src, /label: 'Contactés au total', value: project\.stats_messaged/);
  // Un échec de lecture est dit, pas rendu en zéros.
  assert.match(src, /countsQuery\.isError/);
  assert.doesNotMatch(src, /Funnel/);
});

test('0c-3 : Analyses et entonnoir sans get_project_stats ni last_search_at, par l\'adaptateur', () => {
  for (const f of [INSIGHTS, FUNNEL]) {
    const src = code(f);
    assert.doesNotMatch(src, /get_project_stats|get_multiple_project_stats|useProjectStats|last_search_at|lastSearchAt/, f);
  }
  const insights = code(INSIGHTS);
  assert.match(insights, /import \{ toProjectStats \} from '@\/lib\/missionStatsAdapter'/);
  assert.match(insights, /toProjectStats\(countsQuery\.data\?\.\[project\.id\]\)/);
  assert.doesNotMatch(insights, /InsightsStats|toInsightsStats/);
  // Une erreur de lecture et l'attente ont leur écran : jamais « pas encore de données » à tort.
  assert.match(insights, /countsQuery\.isError/);
  assert.match(insights, /countsQuery\.isPending/);
});

test('0c-3 : adaptateur pur, cumuls pour Contactés et Retenus, effectif pour Écartés et À trier', () => {
  const src = code(ADAPTER);
  assert.doesNotMatch(src, /supabase/);
  assert.match(src, /export interface ProjectStats/);
  assert.match(src, /export function toProjectStats/);
  assert.match(src, /messaged: c\.everContacted/);
  assert.match(src, /shortlisted: c\.everRetained/);
  assert.match(src, /dismissed: c\.rejected/);
  // À trier du Pipeline, jamais ouverts exclus : ils ne comptent pas comme « sans décision ».
  assert.match(src, /untreated: c\.toSort\b(?! \+)/);
});

test('0c-3 : un mot, un nombre : mêmes définitions dans l\'entonnoir et dans les cartes', () => {
  const funnel = code(FUNNEL);
  assert.match(funnel, /label: 'Sourcés'/);
  assert.match(funnel, /Retenus au total/);
  assert.match(funnel, /Contactés au total/);
  assert.doesNotMatch(funnel, /Profils trouvés|des profils trouvés/);
  // Les trois tuiles du bas doublaient « Taux de contact » et « Conversion globale » avec d'autres nombres.
  assert.doesNotMatch(funnel, /Taux de contact|Conversion globale|Part des retenus/);
  const insights = code(INSIGHTS);
  assert.match(insights, /label="Taux de contact"/);
  assert.match(insights, /label="Conversion globale"/);
  assert.match(insights, /cumulativeText\('ever_contacted', stats\.messaged\)/);
  assert.match(insights, /cumulativeText\('ever_retained', stats\.shortlisted\)/);
});

test('0c-3 : Analyses, motifs de fiabilité des séquences conservés', () => {
  const src = code(INSIGHTS);
  assert.match(src, /response\.contacted >= RESPONSE_RATE_MIN_CONTACTED/);
  assert.match(src, /\.in\('job_id', missionEnrollmentJobIds\(/);
  assert.match(src, /setEnrollmentStatsError\(true\)/);
  assert.match(src, /Chiffre indisponible/);
});

test('0c-3 : tableau de bord, date d\'activité par missionActivityAt et plus de last_search_at', () => {
  const src = code(DASHBOARD);
  assert.match(src, /useMissionStageCounts\(/);
  assert.match(src, /missionActivityAt\(p\.updated_at, counts\?\.\[p\.id\]\?\.lastStageMoveAt \?\? null\)/);
  assert.doesNotMatch(src, /last_search_at|lastSearchAt/);
  assert.match(src, /plural\(total, 'sourcé'\)/);
  assert.match(src, /plural\(shortlisted, 'retenu'\)\} au total/);
  assert.match(src, /plural\(messaged, 'contacté'\)\} au total/);
});

test('0c-3 : aucun libellé de cumul sans « au total » dans les vues', () => {
  for (const f of [LIST, OVERVIEW, INSIGHTS, FUNNEL, DASHBOARD]) {
    const src = code(f);
    assert.doesNotMatch(src, /label=['"]Contactés['"]|label=['"]Retenus['"]|label: ['"]Contactés['"]|label: ['"]Retenus['"]/, f);
  }
});

test('0c-3 : liste, le menu d\'une ligne n\'ouvre pas la mission et la recherche garde les archives dépliées', () => {
  const src = code(LIST);
  // Le contenu du menu est dans un portail : l'évènement remonte jusqu'au <tr onClick>.
  assert.match(src, /<DropdownMenuContent[^>]*onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  // Pendant une recherche, le bouton des archives ne touche pas à l'état mémorisé.
  assert.match(src, /if \(!searchActive\) setShowArchive/);
});

test('0c-3 : une mission non rendue par la base est « indisponible », jamais un état vide ni des cases muettes', () => {
  const insights = code(INSIGHTS);
  assert.match(insights, /countsQuery\.isError \|\| \(!countsQuery\.isPending && !stats\)/);
  assert.doesNotMatch(insights, /\$\{response\.replied\}\/\$\{response\.contacted\} contactés`/);
  assert.match(insights, /contactés par séquence/);
  const overview = code(OVERVIEW);
  assert.match(overview, /countsQuery\.isError \|\| \(!countsQuery\.isPending && !counts\)/);
  // Un Skeleton est un <div> : jamais dans un <p>.
  assert.doesNotMatch(overview, /<p\s[^>]*>\s*\{s\.value === null/);
});

test('0c-3 : Analyses sans emoji d\'interface', () => {
  assert.doesNotMatch(code(INSIGHTS), /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u);
});
