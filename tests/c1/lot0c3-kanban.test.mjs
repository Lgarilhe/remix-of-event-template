/**
 * Refonte mission, lot 0c-3 : garde-fous statiques du kanban et du tableau de
 * l'ancienne page mission (plan final, sections 3.2 et 10.1, ligne 0c-3).
 *
 * Fichiers couverts : MissionPipeline.tsx, ProjectCandidatesTableEnhanced.tsx,
 * useMissionProcess.ts, useSourcingProjects.ts, types/projects.ts,
 * useMyMissions.ts. Même forme que lot0c-lectures.test.mjs : lecture du source
 * sans commentaires, assertions sur les motifs.
 *
 * Lancer : node --test tests/c1/lot0c3-kanban.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Source sans commentaires : une assertion de présence ne se contente pas d'un
// commentaire, une assertion d'absence ne se déclenche pas sur un commentaire.
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const PIPELINE = 'src/components/missions/MissionPipeline.tsx';
const TABLE = 'src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx';
const PROCESS = 'src/hooks/useMissionProcess.ts';
const PROJECTS = 'src/hooks/useSourcingProjects.ts';
const TYPES = 'src/types/projects.ts';
const MY_MISSIONS = 'src/hooks/sidebar/useMyMissions.ts';

const SURFACE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

// Corps de useProjectCandidates : de sa déclaration à la fin de la fonction
// de lecture de page qui la suit.
function projectCandidatesSource() {
  const src = code(PROJECTS);
  const start = src.indexOf('export const useProjectCandidates');
  assert.ok(start >= 0, 'useProjectCandidates introuvable');
  return src.slice(start);
}

test('0c-3 MissionPipeline : rangement par l\'étape générale, sans ancien repli', () => {
  const src = code(PIPELINE);
  for (const banned of [/columnKeyOf/, /convRate/, /\breached\b/, /useProjectStats/, /\.status\s*===/, /pipeline_stage/]) {
    assert.doesNotMatch(src, banned, `MissionPipeline.tsx ne doit plus contenir ${banned}`);
  }
  assert.match(src, /missionColumnOf\(/);
  assert.match(src, /stageAgeDays\(/);
  assert.match(src, /isStale\(/);
  assert.match(src, /MISSION_COLUMN_KEY/);
  assert.match(src, /invalidateStageReaders\(/);
  assert.match(src, /useMissionStageCounts\(/);
});

test('0c-3 MissionPipeline : le candidat porte stage_entered_at et group_ids (type de la vue)', () => {
  const projects = code(PROJECTS);
  const iface = projects.slice(projects.indexOf('export interface ProjectCandidateRow'));
  assert.match(iface.slice(0, iface.indexOf('\n}')), /stage_entered_at/);
  assert.match(iface.slice(0, iface.indexOf('\n}')), /group_ids/);
  assert.match(code(PIPELINE), /type ProjectCandidate = ProjectCandidateRow/);
});

test('0c-3 MissionPipeline : un geste écrit tout le groupe, par set_candidate_stages, surface mission-kanban', () => {
  const src = code(PIPELINE);
  assert.match(src, /setCandidateStages\(ids, target, undefined, \{ surface \}\)/);
  assert.match(src, /updateStage\(groupIdsOf\(candidate\), targetColumn, 'mission-kanban'\)/);
  assert.match(src, /updateStage\(row \? groupIdsOf\(row\) : \[rowId\], newStage, 'fiche'\)/);
  assert.match(src, /patchProjectCandidateStages\(queryClient, project\.id, outcome\.rows\)/);
  // Une réponse sans aucune ligne changée ni déjà à l'étape n'est pas un succès.
  assert.match(src, /outcome\.updated \+ outcome\.unchanged === 0/);
});

test('0c-3 MissionPipeline : aucune écriture directe de job_candidate_status', () => {
  const src = code(PIPELINE);
  assert.doesNotMatch(src, /\.from\(['"]job_candidate_status['"]\)/);
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
});

test('0c-3 MissionPipeline : textes de l\'en-tête, de l\'état vide et des profils trouvés', () => {
  const src = code(PIPELINE);
  assert.match(src, /profils? trouvés?/);
  assert.match(src, /dans le Pipeline/);
  assert.match(src, /à trier dans le Sourcing/);
  assert.doesNotMatch(src, /Aucun candidat sourcé/);
  assert.doesNotMatch(src, /dans le Pipeline[\s\S]{0,200}plural\(steps\.length/);
});

test('0c-3 MissionPipeline : une lecture en échec ne passe pas pour un pipeline vide', () => {
  const src = code(PIPELINE);
  assert.match(src, /candidatesQuery\.isError/);
  assert.match(src, /stepsError/);
  assert.match(src, /stageCountsQuery\.isError/);
  assert.match(src, /Réessayer/);
  // L'état vide n'est rendu qu'une fois les compteurs lus.
  assert.match(src, /!hasCandidates && !countsKnown/);
});

test('0c-3 MissionPipeline : plafond de lecture signalé', () => {
  const src = code(PIPELINE);
  assert.match(src, /PROJECT_CANDIDATES_MAX_ROWS/);
  assert.match(src, /Affichage limité aux/);
});

test('0c-3 MissionPipeline : jetons sémantiques seulement (ancienne palette et couleurs en dur retirées)', () => {
  const src = code(PIPELINE);
  assert.doesNotMatch(src, /brand-(purple|blue|cyan|pink|green)/);
  assert.doesNotMatch(src, /\b(bg|text|ring|border)-(teal|indigo|emerald|amber|red|blue|green|purple|pink|cyan|orange|yellow)-\d/);
  const table = code(TABLE);
  assert.doesNotMatch(table, /brand-(purple|blue|cyan|pink|green)/);
  assert.doesNotMatch(table, /\b(bg|text|ring|border)-(teal|indigo|emerald|amber|red|blue|green|purple|pink|cyan|orange|yellow)-\d/);
});

test('0c-3 MissionPipeline : « Tableau » et « Kanban », pas de tiret long dans les textes', () => {
  const src = code(PIPELINE);
  assert.doesNotMatch(src, /Board générique/);
  assert.doesNotMatch(src, /> Table\b/);
  assert.doesNotMatch(src, /[—–]/);
});

test('0c-3 useProjectCandidates : lit la vue, sans profils jamais ouverts, par pages', () => {
  const src = projectCandidatesSource();
  assert.match(src, /\.from\('mission_candidate_rows'\)/);
  assert.match(src, /\.eq\('is_unopened', false\)/);
  assert.doesNotMatch(src, /\.from\('job_candidate_status'\)/);
  // Pagination : plus de select unique coupé à 1 000 lignes, ordre stable.
  assert.match(src, /\.range\(from, from \+ PROJECT_CANDIDATES_PAGE_SIZE - 1\)/);
  assert.match(src, /\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: true \}\)/);
  assert.match(code(PROJECTS), /PROJECT_CANDIDATES_PAGE_SIZE = 1000/);
  assert.match(code(PROJECTS), /PROJECT_CANDIDATES_MAX_ROWS = \d+/);
});

test('0c-3 useProjectCandidates : fraîcheur des compteurs (30 s et retour sur l\'onglet)', () => {
  const src = projectCandidatesSource();
  assert.match(src, /staleTime: 30 \* 1000/);
  assert.match(src, /refetchOnWindowFocus: true/);
});

test('0c-3 useProjectCandidates : ni profil LinkedIn ni détail de note dans la liste', () => {
  const src = code(PROJECTS);
  const cols = src.match(/PROJECT_CANDIDATE_COLUMNS: string =\s*'([^']+)'/);
  assert.ok(cols, 'PROJECT_CANDIDATE_COLUMNS introuvable');
  assert.doesNotMatch(cols[1], /linkedin_profile_data|scoring_details/);
  for (const needed of ['id', 'group_ids', 'candidate_id', 'general_stage', 'process_step_id', 'stage_entered_at', 'created_at', 'updated_at']) {
    assert.match(cols[1], new RegExp(`(^|, )${needed}(,|$)`), `colonne ${needed} manquante`);
  }
});

test('0c-3 patchProjectCandidateStages : la carte suit l\'écriture confirmée, par groupe', () => {
  const src = code(PROJECTS);
  const fn = src.slice(src.indexOf('export function patchProjectCandidateStages'));
  assert.match(fn, /setQueryData<ProjectCandidateRow\[\]>\(\['project-candidates', projectId\]/);
  assert.match(fn, /group_ids/);
  assert.match(fn, /general_stage: shown\.generalStage/);
  assert.match(fn, /process_step_id: shown\.processStepId/);
  assert.match(fn, /stage_entered_at/);
});

test('0c-3 liste des missions : poste, client et lieu du brief (jd_*)', () => {
  const src = code(PROJECTS);
  assert.match(src, /jd_title:job_details->>title/);
  assert.match(src, /jd_client:job_details->client->>name/);
  assert.match(src, /jd_location:job_details->>location/);
  const my = code(MY_MISSIONS);
  const select = my.match(/TEAM_SELECT: string =\s*'([^']+)'/);
  assert.ok(select, 'TEAM_SELECT introuvable');
  assert.match(select[1], /jd_title:job_details->>title/);
  assert.match(select[1], /jd_client:job_details->client->>name/);
  assert.match(select[1], /jd_location:job_details->>location/);
});

test('0c-3 types/projects : client et lieu du brief, plus de valeurs en dur', () => {
  const src = code(TYPES);
  assert.match(src, /jd_client/);
  assert.match(src, /jd_location/);
  assert.match(src, /client_name/);
  assert.doesNotMatch(src, /location:\s*null/);
  assert.doesNotMatch(src, /skills:\s*\[\]/);
});

test('0c-3 tableau : étape générale, libellés du module, plus de « Non traité »', () => {
  const src = code(TABLE);
  assert.doesNotMatch(src, /untreated/);
  assert.doesNotMatch(src, /statusConfig/);
  assert.doesNotMatch(src, /status\s*===\s*['"]untreated['"]/);
  assert.match(src, /GENERAL_STAGE_LABEL/);
  assert.match(src, /stageOf\(c\) === statusFilter/);
});

test('0c-3 tableau : les écritures et le retrait passent par group_ids', () => {
  const src = code(TABLE);
  assert.match(src, /setCandidateStages\(eligible\.flatMap\(groupIdsOf\), target, from, \{ surface: 'mission-table' \}\)/);
  assert.match(src, /\.update\(\{ project_id: null \}\)\s*\.in\('id', groupIds\)/);
  assert.doesNotMatch(src, /\.eq\('id', candidate\.id\)/);
  assert.match(src, /patchProjectCandidateStages\(queryClient, projectId, outcome\.rows\)/);
  assert.match(src, /invalidateStageReaders\(queryClient\)/);
});

test('0c-3 tableau : aucune action visible sans effet, pas de tiret long', () => {
  const src = code(TABLE);
  assert.match(src, /stage !== 'contacted' && onOpenMessage && \(/);
  assert.doesNotMatch(src, /[—–]/);
});

test('0c-3 useMissionProcess : effectifs par process_step_id sur la vue', () => {
  const src = code(PROCESS);
  assert.match(src, /\.from\('mission_candidate_rows'\)/);
  assert.match(src, /\.in\('process_step_id', steps\.map/);
  assert.doesNotMatch(src, /\.in\('pipeline_stage'/);
  // Suppression d'une étape : les candidats perdent leur étape (SET NULL), lecteurs relus.
  const del = src.slice(src.indexOf('const deleteStepMutation'), src.indexOf('const reorderStepsMutation'));
  assert.match(del, /invalidateStageReaders\(queryClient\)/);
});

test('0c-3 surfaces de mesure : format fermé, noms attendus', () => {
  const pipeline = code(PIPELINE);
  const table = code(TABLE);
  const surfaces = [
    ...pipeline.matchAll(/'(mission-kanban|fiche)'/g),
    ...table.matchAll(/surface: '([^']+)'/g),
  ].map((m) => m[1]);
  assert.ok(surfaces.length >= 3, 'surfaces introuvables');
  for (const s of new Set(surfaces)) assert.match(s, SURFACE_PATTERN, `surface ${s} hors format`);
  assert.match(pipeline, /surface: 'mission-kanban' \| 'fiche'/);
  assert.match(table, /surface: 'mission-table'/);
});

test('0c-3 src : plus aucun compteur stats_replied, stats_qualified ni stats_hired', () => {
  for (const file of walk('src')) {
    const src = read(file);
    assert.doesNotMatch(src, /stats_replied|stats_qualified|stats_hired/, `${file} lit un compteur qui n'existe pas`);
  }
});

test('0c-3 MissionPipeline : la carte déposée reste dans la colonne visée pendant l\'écriture', () => {
  const src = code(PIPELINE);
  assert.match(src, /pendingMoves/);
  assert.match(src, /pendingMoves\[c\.id\] \?\? baseColumnOf\(c\)/);
  // Posé avant l'attente de l'écriture, retiré au retour (succès, refus ou exception).
  assert.match(src, /setPendingMoves\(prev => \(\{ \.\.\.prev, \[candidateId\]: targetColumn \}\)\)[\s\S]*await updateStage[\s\S]*finally[\s\S]*setPendingMoves/);
  // Une carte en cours de déplacement ne se reprend pas.
  assert.match(src, /pendingMoves\[candidateId\]/);
});

test('0c-3 MissionPipeline : mission sans ligne de compteurs = lecture réussie, pas un chargement sans fin', () => {
  const src = code(PIPELINE);
  assert.match(src, /countsKnown = stageCountsQuery\.isSuccess/);
  assert.doesNotMatch(src, /countsKnown = stageCountsQuery\.data/);
});

test('0c-3 MissionPipeline : l\'erreur des étapes ne remplace l\'écran que sans étape lue', () => {
  const src = code(PIPELINE);
  assert.match(src, /stepsError && steps\.length === 0/);
});

test('0c-3 MissionPipeline : l\'ancienneté de la carte est un texte visible', () => {
  const src = code(PIPELINE);
  assert.match(src, /stageAgeText\(days\)/);
  assert.match(src, /dans la même étape depuis/);
});

test('0c-3 recommandations : les valeurs écrites par la notation ont un libellé (tableau et carte)', () => {
  const types = code(TYPES);
  for (const v of ['STRONG_MATCH', 'GOOD_MATCH', 'POSSIBLE_MATCH', 'WEAK_MATCH', 'NO_MATCH']) {
    assert.match(types, new RegExp(`'${v}'`), `${v} sans libellé`);
  }
  assert.match(code(TABLE), /recommendationLabel\(/);
  assert.match(code(PIPELINE), /recommendationLabel\(/);
});

test('0c-3 useMissionProcess : le toast ne reprend pas le nombre brut de lignes remappées', () => {
  const src = code(PROCESS);
  assert.doesNotMatch(src, /\$\{remapped\} candidat/);
});
