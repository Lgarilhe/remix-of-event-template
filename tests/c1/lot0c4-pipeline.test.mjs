/**
 * Refonte mission, lot 0c-4 : garde-fous statiques de la page /pipeline
 * (plan final, sections 3.2, 6.5, 8.4, 10.1 et 12.1 points 4, 8 et 9).
 *
 * Même forme que lot0c-lectures.test.mjs : lecture du source (sans les
 * commentaires : on vérifie ce qui s'exécute) et assertions sur les motifs, sans
 * navigateur ni base. Le comportement des fonctions pures est joué par
 * tests/ux/lot7a-pipeline.test.mjs ; celui du module d'étapes, par
 * tests/ux/lot0b4-candidate-stage.test.mjs.
 *
 * Fichiers de l'unité : useATSData, ATS, ATSStats, ATSPipelineAnalytics,
 * ATSCandidateCard, ATSTable, ATSTimeline, ATSFilters, BulkActionsBar,
 * JobDetailSheet, candidate-detail/OverviewTab.
 *
 * Lancer : node --test tests/c1/lot0c4-pipeline.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const HOOK = 'src/hooks/useATSData.ts';
const PAGE = 'src/pages/ATS.tsx';
const STATS = 'src/components/ats/ATSStats.tsx';
const ANALYTICS = 'src/components/ats/ATSPipelineAnalytics.tsx';
const CARD = 'src/components/ats/ATSCandidateCard.tsx';
const TABLE = 'src/components/ats/ATSTable.tsx';
const TIMELINE = 'src/components/ats/ATSTimeline.tsx';
const FILTERS = 'src/components/ats/ATSFilters.tsx';
const BULK = 'src/components/ats/BulkActionsBar.tsx';
const SHEET = 'src/components/ats/JobDetailSheet.tsx';
const OVERVIEW = 'src/components/ats/candidate-detail/OverviewTab.tsx';
const STAGE = 'src/lib/candidateStage.ts';

const UNIT = [HOOK, PAGE, STATS, ANALYTICS, CARD, TABLE, TIMELINE, FILTERS, BULK, SHEET, OVERVIEW,
  'src/components/ats/ATSKanban.tsx', 'src/components/ats/ATSDraggableCard.tsx', 'src/components/ats/ATSDroppableColumn.tsx'];

// Corps d'une fonction : de sa déclaration à la première accolade fermante en colonne 0.
function functionBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const rest = src.slice(start);
  const end = rest.search(/\n\}\n/);
  assert.ok(end > 0, `fin de ${signature} introuvable`);
  return rest.slice(0, end + 2);
}

// ─── Lecture (plan 3.2) ─────────────────────────────────────────────────────

test('0c-4 : le /pipeline lit mission_candidate_rows, sans l\'ancien rangement par status', () => {
  const src = code(HOOK);
  assert.match(src, /\.from\('mission_candidate_rows'\)/);
  assert.doesNotMatch(src, /\.from\('job_candidate_status'\)\s*\.select\(JCS_DISPLAY_COLUMNS/);
  for (const gone of ['computeEffectiveStage', 'STATUS_TO_STAGE', 'displayStage', 'exactTarget', 'GENERAL_STAGE_LABEL', 'fetchJobTitlesMap', 'daysSinceLastAction']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `${HOOK} : ${gone}`);
  }
  for (const gone of ['displayStage', 'computeEffectiveStage', 'STATUS_TO_STAGE', 'GENERAL_STAGE_LABEL']) {
    assert.doesNotMatch(code(PAGE), new RegExp(`\\b${gone}\\b`), `${PAGE} : ${gone}`);
  }
  // Colonnes lues : celles que l'écran affiche, plus project_id, stage_entered_at, mission_name, group_ids.
  const cols = src.match(/const MCR_DISPLAY_COLUMNS = '([^']+)';/)[1].split(',').map((c) => c.trim());
  for (const col of ['project_id', 'stage_entered_at', 'mission_name', 'group_ids', 'general_stage', 'process_step_id', 'is_unopened',
    'contacted_at', 'replied_at', 'first_interview_at', 'hired_at', 'rejected_from_stage']) {
    assert.ok(cols.includes(col), `colonne ${col} lue`);
  }
  // Une lecture en échec remonte, toutes les lignes sont paginées.
  const fetchRows = functionBody(src, 'async function fetchMissionRows(');
  assert.match(fetchRows, /if \(pageError\) throw new Error/);
  assert.match(fetchRows, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
});

test('0c-4 : existingIds est bâti sur toutes les lignes de la vue, avant le filtre is_unopened (E4)', () => {
  const body = functionBody(code(HOOK), 'async function fetchAllCandidates(');
  const ids = body.indexOf('const existingIds = new Set(missionRows.map(r => r.candidate_id));');
  const filter = body.indexOf('.filter(r => !r.is_unopened)');
  assert.ok(ids >= 0, 'existingIds sur missionRows');
  assert.ok(filter >= 0, 'filtre is_unopened');
  assert.ok(ids < filter, 'existingIds avant le filtre is_unopened');
  assert.match(body, /fetchSequenceOnlyCandidates\(existingIds\)/);
  assert.match(body, /fetchInMailOnlyCandidates\(existingIds\)/);
  // Le rapprochement d'une inscription reprend celui de la vue : profil, fournisseur, profil résolu.
  const src = code(HOOK);
  assert.match(src, /provider_id, resolved_profile_id/);
  assert.match(src, /\[e\.profile_id, e\.provider_id, e\.resolved_profile_id\]\.some/);
});

test('0c-4 : la colonne vient de l\'étape générale, les titres reprennent les mots de la mission (E9)', () => {
  const src = code(HOOK);
  assert.match(src, /import \{ atsColumnOf, atsColumnTitle, invalidateStageReaders \} from '@\/lib\/stageDisplay';/);
  assert.match(src, /stage: atsColumnOf\(r\),/);
  assert.match(src, /label: atsColumnTitle\('Nouveau'\)/);
  // Clés d'ATS_STAGES identiques aux clés de ATS_LABEL_TO_STAGE : la liste blanche ne change pas.
  const stagesBody = src.slice(src.indexOf('export const ATS_STAGES = ['), src.indexOf('];', src.indexOf('export const ATS_STAGES = [')));
  const stageKeys = [...stagesBody.matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  const labelBody = functionBody(code(STAGE).replace('export const ATS_LABEL_TO_STAGE: Readonly<Record<string, StageTarget>> = {', 'function labels() {'), 'function labels() {');
  const labelKeys = [...labelBody.matchAll(/^\s*'([^']+)': \{/gm)].map((m) => m[1]);
  assert.deepEqual([...stageKeys].sort(), [...labelKeys].sort());
  assert.equal(stageKeys.length, 10);
  // Un titre par colonne affichée : la clé brute ne s'affiche plus (panneau de mission, fiche).
  assert.match(code(SHEET), /atsColumnTitle\(stage\)/);
  assert.match(code(SHEET), /atsColumnTitle\(candidate\.stage\)/);
  assert.match(code(OVERVIEW), /\{atsColumnTitle\(position\.stage\)\}/);
  assert.doesNotMatch(code(SHEET), /\{candidate\.stage\}|\{count\} \{stage\}/);
});

test('0c-4 : un doublon n\'apparaît qu\'une fois et un geste écrit tout le groupe', () => {
  const src = code(HOOK);
  assert.match(src, /groupIds: r\.group_ids && r\.group_ids\.length > 0 \? r\.group_ids : \[r\.id\],/);
  const move = src.slice(src.indexOf('const moveCandidates'), src.indexOf('// Handle tags update'));
  assert.match(move, /c\.source === 'local' && c\.groupIds\?\.length \? c\.groupIds/);
  // Les lignes d'un groupe en erreur sont comptées, pas ignorées.
  assert.match(move, /partial \+= 1;/);
});

test('0c-4 : titre de mission par mission_name, filtre Mission sur project_id', () => {
  const src = code(HOOK);
  assert.match(src, /jobTitle: r\.mission_name \|\| null,/);
  assert.match(src, /missionName: r\.mission_name,/);
  assert.match(src, /projectId: r\.project_id,/);
  // Séquences et InMails : le nom vient de la mission (vue, puis sourcing_projects), jamais du job_title d'une inscription.
  const names = functionBody(src, 'async function fetchMissionNames(');
  assert.match(names, /\.from\('sourcing_projects'\)\.select\('id, name'\)\.in\('id', missing\)/);
  assert.match(src, /withMissionName/);
  // L'InMail porte la mission de son envoi (inmail_queue.project_id).
  assert.match(src, /recipient_headline, status, sent_at, created_at, project_id/);
  assert.match(src, /projectId: inmail\.project_id \?\? null,/);
  const page = code(PAGE);
  assert.match(page, /filters\.job\.includes\(candidate\.projectId\)/);
  assert.match(page, /candidate\.source === 'local' \|\| !jobsMap\.has\(candidate\.projectId\)/);
});

test('0c-4 : le nom de l\'étape d\'entretien de la mission s\'affiche sous la mission (colonne En entretien)', () => {
  const src = code(HOOK);
  assert.match(src, /\.from\('mission_process_steps'\)\.select\('id, name'\)/);
  assert.match(src, /processStepName\?: string \| null;/);
  assert.match(src, /processStepName: r\.general_stage === 'interviewing' && r\.process_step_id/);
  for (const file of [CARD, TABLE, TIMELINE]) {
    assert.match(code(file), /ITW en cours/, `${file} : sous-titre limité à la colonne En entretien`);
    assert.match(code(file), /processStepName/, `${file} : nom de l'étape`);
  }
});

// ─── Annulation et mesure (plan 8.4 et 7.2) ─────────────────────────────────

test('0c-4 : l\'annulation passe par le module d\'étapes, sans copie locale', () => {
  const src = code(HOOK);
  for (const name of ['readStageSnapshots', 'buildUndoMoves', 'undoCandidateStages', 'undoSummaryMessage']) {
    assert.match(src, new RegExp(`\\b${name}\\b,?\\n`), `${name} importé`);
    assert.match(src, new RegExp(`\\b${name}\\(`), `${name} appelé`);
  }
  assert.match(src, /from '@\/lib\/candidateStage';/);
  for (const file of [HOOK, PAGE, BULK]) {
    assert.doesNotMatch(code(file), /\.rpc\(\s*['"`]undo_candidate_stages['"`]/, `${file} : appel direct de undo_candidate_stages`);
    assert.doesNotMatch(code(file), /\bsetCandidateStage\(/, `${file} : geste unitaire, plus de déplacement inverse`);
  }
  for (const gone of ['runUndo', 'summarizeUndo', 'announceUndo', 'undoMoveOf', 'StageUndoMove', 'StageBeforeRow', 'STAGE_BEFORE_COLUMNS', 'LEGACY_LABELS_BY_STAGE']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `${HOOK} : ${gone}`);
  }
  // Le message est celui du module, rendu tel quel ; les groupes sont faits des identifiants des éléments.
  const undo = src.slice(src.indexOf('const undoStageMoves'), src.indexOf('const moveCandidates'));
  assert.match(undo, /undoSummaryMessage\(result, \{ groups: nonEmpty\.map\(\(g\) => g\.map\(\(m\) => m\.id\)\) \}\)/);
  assert.match(undo, /undoCandidateStages\(nonEmpty\.flat\(\), \{ surface \}\)/);
  assert.match(undo, /toast\.(success|warning|error)\(message\)/);
  // Une annulation ne se propose que s'il y a des éléments à annuler.
  assert.match(src, /result\.undoGroups\.length > 0/);
  assert.match(code(PAGE), /undo: groups\.length > 0 \? undo : undefined/);
});

test('0c-4 : les gestes portent surface « pipeline », un seul geste pour un déplacement groupé', () => {
  const src = code(HOOK);
  assert.match(src, /const PIPELINE_SURFACE = 'pipeline';/);
  assert.match(src, /setCandidateStages\(allRowIds, target, undefined, \{ surface: options\.surface \?\? PIPELINE_SURFACE \}\)/);
  assert.match(src, /surface: string = PIPELINE_SURFACE/);
  assert.match(src, /undoCandidateStages\(nonEmpty\.flat\(\), \{ surface \}\)/);
  assert.equal([...src.matchAll(/await setCandidateStages\(/g)].length, 1, 'un seul appel de setCandidateStages dans le hook');
  // L'état d'avant est lu une fois, avant le geste, pour tous les group_ids.
  assert.ok(src.indexOf('await readStageSnapshots(allRowIds)') < src.indexOf('await setCandidateStages('), 'lecture avant le geste');
  // Page : un seul appel pour le lot, hors de toute boucle.
  const bulk = code(PAGE).slice(code(PAGE).indexOf('const handleBulkStageChange'), code(PAGE).indexOf('const [filters, setFilters]'));
  assert.equal([...bulk.matchAll(/await moveCandidates\(ids, newStage\)/g)].length, 1, 'un seul geste pour le lot');
  assert.doesNotMatch(bulk, /\bfor\s*\(|\.forEach\(|\.map\(async/, 'pas de boucle sur les candidats cochés');
  // Déjà à l'étape : dit à part, jamais compté déplacé.
  assert.match(bulk, /unchanged: result\.unchanged,/);
  assert.match(bulk, /moved: result\.moved,/);
  assert.match(code(BULK), /unchanged: number;/);
});

test('0c-4 : la date d\'entrée dans l\'étape ne passe jamais par Date avant l\'envoi', () => {
  for (const file of [HOOK, PAGE]) {
    const src = code(file);
    assert.doesNotMatch(src, /new Date\([^)]*(stageEnteredAt|stage_entered_at|after_entered_at)/, `${file} : new Date( sur une date d'étape`);
    assert.doesNotMatch(src, /(stageEnteredAt|stage_entered_at|after_entered_at)[^;\n]*\.(toISOString|getTime|valueOf)\(/, `${file} : conversion d'une date d'étape`);
    assert.doesNotMatch(src, /Date\.parse\(/, `${file} : Date.parse`);
  }
  // Seule date fabriquée : l'horodatage provisoire de l'affichage optimiste.
  assert.match(code(HOOK), /const nowIso = new Date\(\)\.toISOString\(\);/);
});

// ─── Écrans ─────────────────────────────────────────────────────────────────

test('0c-4 : les tuiles en tête disent « au total » et ne lisent plus outreachStatus', () => {
  const src = code(STATS);
  assert.doesNotMatch(src, /outreachStatus/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_contacted/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_replied/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_interviewed/);
  assert.match(src, /CUMULATIVE_LABEL\.ever_hired/);
  // Mêmes étapes que les ever_* de get_mission_stage_counts.
  assert.match(src, /CONTACTED_STAGES = \['contacted', 'replied', 'interviewing', 'hired'\]/);
  assert.match(src, /REPLIED_STAGES = \['replied', 'interviewing', 'hired'\]/);
  // Libellés lisibles en entier sur téléphone : deux colonnes, puis trois.
  assert.match(src, /cols=\{\{ base: 2, sm: 3, xl: 6 \}\}/);
  // Le libellé du module d'affichage.
  const display = read('src/lib/stageDisplay.ts');
  assert.match(display, /ever_contacted: \{ title: 'Contactés au total'/);
  assert.match(display, /ever_replied: \{ title: 'Ont répondu au total'/);
});

test('0c-4 : la carte dit « Dans cette étape depuis N j » et montre la mission', () => {
  for (const file of [CARD, TABLE]) {
    assert.match(code(file), /Dans cette étape depuis/, `${file} : phrase de la section 6.4`);
    assert.doesNotMatch(code(file), /Sans mouvement/, `${file} : « Sans mouvement » a disparu`);
  }
  const card = code(CARD);
  assert.match(card, /stagnantDays\(candidate, now\)/);
  assert.match(card, /daysInStage\(candidate, now\)/);
  assert.match(card, /candidate\.repliedAt/);
  assert.match(card, /\{candidate\.jobTitle\}/, 'nom de la mission');
  // Stagnation : pas de délai pour À trier et Retenu (plan 6.4), ni dans la carte, ni dans l'analyse, ni dans la fiche.
  const hook = code(HOOK);
  const table = hook.slice(hook.indexOf('export const STAGNATION_DAYS'), hook.indexOf('};', hook.indexOf('export const STAGNATION_DAYS')));
  assert.doesNotMatch(table, /'Nouveau'|'Pressenti'|'Gagné'|'Perdu'/);
  // La fiche lit la même table que la carte (plus de seuils propres) et range par l'étape générale.
  const overview = code(OVERVIEW);
  assert.doesNotMatch(overview, /STAGNATION_THRESHOLDS_DAYS|TERMINAL_STAGES/, 'seuils propres à la fiche');
  assert.match(overview, /STAGNATION_DAYS\[stageKey\]/);
  assert.match(overview, /stagnantDays\(\{ \.\.\.candidate, stage: stageKey \}\)/);
  assert.equal((overview.match(/candidateColumnKey\(candidate\)/g) || []).length, 3, 'mission ouverte : jamais la clé brute de la colonne de mission');
  assert.doesNotMatch(overview, /stage: candidate\.stage,/);
  assert.match(code(ANALYTICS), /STAGNATION_DAYS\[stage\.key\] \?\? null/);
  // L'ancienneté (stageEnteredAt, à défaut dernière action) est celle de stagnantDays.
  assert.match(code(OVERVIEW), /stagnantDays\(/);
  assert.match(code(ANALYTICS), /daysInStage\(c, now\)/);
});

test('0c-4 : le panneau de mission rapproche les candidats par project_id, les séquences par les deux formes du job_id', () => {
  const src = code(SHEET);
  assert.match(src, /import \{ missionIdOfJob \} from '@\/hooks\/useEnrollmentPreview';/);
  assert.match(src, /const missionId = missionIdOfJob\(jobId\);/);
  assert.match(src, /\(missionId && c\.projectId === missionId\) \|\| c\.jobId === jobId/);
  assert.match(src, /\.in\('job_id', \[\.\.\.\(missionId \? \[missionId, `project:\$\{missionId\}`\] : \[jobId\]\), \.\.\.\(rawJobId \? \[rawJobId\] : \[\]\)\]\)/);
  // Le job_id brut de la mission (sourcing_projects.job_id) garde le poste Airtable et les passages de l'assistant.
  assert.match(src, /const missionJobId = \(proj as \{ job_id\?: string \| null \} \| null\)\?\.job_id \|\| null;/);
  assert.match(src, /\.in\('airtable_id', missionJobId && missionJobId !== jobId \? \[jobId, missionJobId\] : \[jobId\]\)/);
  assert.match(src, /\.in\('entity_id', rawJobId \? \[jobId, rawJobId\] : \[jobId\]\)/);
  assert.doesNotMatch(src, /\.eq\('job_id', jobId\);\s*\n\s*if \(cancelled\)/, 'séquences : plus de job_id seul');
});

test('0c-4 : « Mission » remplace « Poste » dans les filtres et le tableau', () => {
  assert.match(code(FILTERS), /label="Mission"/);
  assert.match(code(FILTERS), /placeholder="Nom, mission, intitulé…"/);
  assert.match(code(TABLE), /sortHeader\('Mission', 'jobTitle'/);
  for (const file of [CARD, TABLE, TIMELINE]) {
    assert.match(code(file), /Voir la mission /, `${file} : libellé du bouton`);
    assert.doesNotMatch(code(file), /Voir le poste/, `${file} : ancien libellé`);
  }
  // Le tri par étape suit l'ordre des colonnes.
  assert.match(code(TABLE), /case 'stage': aVal = stageRank\(a\.stage\); bVal = stageRank\(b\.stage\); break;/);
});

test('0c-4 : état vide : les profils trouvés restent au Sourcing', () => {
  assert.match(read(PAGE), /Les profils trouvés par une recherche restent dans le Sourcing de la mission tant qu'ils ne sont pas triés\./);
});

// ─── Contrat et règles générales ────────────────────────────────────────────

test('0c-4 : le contrat d\'exports avec l\'unité fiches est tenu', () => {
  const src = code(HOOK);
  for (const exported of ['daysInStage', 'stagnantDays', 'ATS_STAGES', 'STAGNATION_DAYS', 'ATS_SOURCE_LABELS', 'candidateOfMissionRow']) {
    assert.match(src, new RegExp(`export (function|const) ${exported}\\b`), `${exported} exporté`);
  }
  const iface = src.slice(src.indexOf('export interface ATSCandidate {'), src.indexOf('\n}\n', src.indexOf('export interface ATSCandidate {')));
  for (const field of ['projectId', 'missionName', 'generalStage', 'processStepId', 'stageEnteredAt', 'groupIds',
    'contactedAt', 'repliedAt', 'firstInterviewAt', 'hiredAt', 'rejectedFromStage', 'outreachStatus']) {
    assert.match(iface, new RegExp(`\\b${field}\\?: `), `ATSCandidate.${field}`);
  }
});

test('0c-4 : plus de lecture de get_project_stats ni de get_multiple_project_stats dans les fichiers de l\'unité', () => {
  for (const file of UNIT) {
    assert.doesNotMatch(code(file), /get_project_stats|get_multiple_project_stats/, file);
  }
});

test('0c-4 : aucun nom de prestataire, aucune confirmation du navigateur dans les fichiers de l\'unité', () => {
  for (const file of UNIT) {
    const src = code(file);
    assert.doesNotMatch(src, /\b(Unipile|Apollo|People Data Labs)\b/, `${file} : nom de prestataire`);
    assert.doesNotMatch(src, /window\.confirm\(/, `${file} : window.confirm`);
  }
});

test('0c-4 (revue) : déplacé se juge sur l\'état d\'avant, annulation et déplacement groupé sans faux bilan', () => {
  const hook = code('src/hooks/useATSData.ts');
  const page = code('src/pages/ATS.tsx');
  const bar = code('src/components/ats/BulkActionsBar.tsx');
  // « Déplacé » : étape, étape d'entretien ou colonne changée (buildUndoMoves), pas result === 'updated'.
  assert.doesNotMatch(hook, /groupRows\.some\(r => r\.result === 'updated'\)\) moved/);
  assert.match(hook, /moves\.length > 0 \|\| writtenRows\.some\(r => !snapshots\.has\(r\.id\)\)/);
  // Pas d'« Annuler » pour un candidat sans ligne avant le geste (état d'avant lu sur la ligne neuve).
  assert.match(hook, /if \(c\.source === 'local' && moves\.length > 0\) undoGroups\.push\(moves\);/);
  // Un candidat qui n'a pas bougé retrouve sa dernière action, sans « maintenant » affiché.
  assert.match(hook, /unchangedIds\.has\(c\.id\) \? previous\.get\(c\.id\)\?\.lastActivity/);
  // Une ligne en double non écrite : dite dans le toast du lot, candidats gardés cochés.
  assert.match(hook, /partialIds,/);
  assert.match(page, /new Set\(\[\.\.\.result\.failedIds, \.\.\.result\.partialIds\]\)/);
  assert.match(page, /partial: result\.partial,/);
  assert.match(bar, /une ligne en double non mise à jour/);
});

test('0c-4 (revue) : la fiche et la carte ne disent pas « dans cette étape » sans date d\'entrée, jamais une clé brute', () => {
  const card = code(CARD);
  assert.match(card, /candidate\.stageEnteredAt \? `Dans cette étape depuis \$\{stagnant\}\\u00a0j` : `Dernière action il y a \$\{stagnant\}\\u00a0j`/);
  assert.match(code(TABLE), /candidate\.stageEnteredAt \? `Dans cette étape depuis/);
  const overview = code('src/components/ats/candidate-detail/OverviewTab.tsx');
  assert.match(overview, /sr\.jobId === candidate\.jobId\s*\? candidateColumnKey\(candidate\)\s*: ATS_STAGES\.some\(st => st\.key === sr\.pipelineStage\) \? sr\.pipelineStage : null/);
  assert.match(overview, /candidate\.stageEnteredAt\s*\? `Stagnation : \$\{daysIdle\} jours à l'étape/);
});
