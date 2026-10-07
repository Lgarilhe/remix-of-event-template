/**
 * Refonte mission, lot 0c-4 (fiches et lectures par project_id) : garde-fous
 * statiques (plan final, section 10.1, ligne 0c-4, fichiers de l'unité fiches).
 *
 * Même forme que lot0c-lectures.test.mjs : lecture du source et assertions sur
 * les motifs, sans navigateur ni base. Le code est lu sans ses commentaires,
 * qui citent parfois les formes proscrites.
 *
 * Lancer : node --test tests/c1/lot0c4-fiches.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const count = (src, re) => (src.match(re) || []).length;

// ─── Fiche candidat : grille IA et notes de mission ─────────────────────────

test('0c-4 : ScorecardTab lit le poste par l\'id de la mission, plus par job_id seul', () => {
  const src = code('src/components/ats/ScorecardTab.tsx');
  assert.doesNotMatch(src, /\.eq\('job_id', candidate\.jobId\)/, 'lecture du poste par job_id seul');
  assert.match(src, /candidate\.projectId \?\? missionIdOfJob\(candidate\.jobId\)/);
  assert.match(src, /projectQuery\.or\(`id\.eq\.\$\{missionKey\},job_id\.eq\.\$\{missionKey\}`\)/);
  // Une seule lecture de sourcing_projects : les étapes partent de project.id.
  assert.equal(count(src, /\.from\('sourcing_projects'\)/g), 1, 'une seule lecture de sourcing_projects');
  assert.match(src, /projectId = project\.id/);
  assert.doesNotMatch(src, /filters_snapshot/, 'filters_snapshot volumineux et inutilisé');
});

test('0c-4 : la grille IA reçoit le poste et les étapes, étape courante par process_step_id', () => {
  const src = code('src/components/ats/ScorecardTab.tsx');
  assert.match(src, /\.from\('mission_process_steps'\)[\s\S]*?\.eq\('project_id', projectId\)/);
  // Les étapes sont lues dès que la mission est connue, sans type d'entretien choisi.
  assert.doesNotMatch(src, /if \(projectId && stage\)/);
  assert.match(src, /if \(projectId\) \{/);
  assert.match(src, /candidate\.processStepId/);
  assert.match(src, /s\.id === candidate\.processStepId/);
  assert.match(src, /jobContext\.processSteps = /);
  assert.match(src, /jobContext\.currentStepObjectives = /);
  // Clé lue par generate-scorecard : compétences recherchées.
  assert.match(src, /jobContext\.skills = \[/);
  // Critères du manager : la fonction ne lit que « requirements ».
  assert.match(src, /jobContext\.requirements = /);
});

test('0c-4 : generate-scorecard lit les étapes d\'entretien que la fiche envoie', () => {
  const tab = code('src/components/ats/ScorecardTab.tsx');
  const fn = code('supabase/functions/generate-scorecard/index.ts');
  // Chaque clé envoyée par la fiche pour situer l'entretien est lue par la fonction.
  for (const key of ['processSteps', 'currentStepName', 'currentStepObjectives', 'currentStepIsEliminatory']) {
    assert.match(tab, new RegExp(`jobContext\\.${key} = `), `${key} envoyée par la fiche`);
    assert.match(fn, new RegExp(`jobContext\\.${key}`), `${key} lue par la fonction`);
  }
  assert.match(fn, /Étapes du process/);
  // Texte borné : nombre d'étapes et longueur de chaque champ.
  assert.match(fn, /processSteps\.slice\(0, 10\)/);
  assert.match(fn, /clip\(jobContext\.currentStepObjectives, 300\)/);
});

test('0c-4 : le plein écran garde la mission de la fiche (?mission=)', () => {
  const tab = code('src/components/ats/ScorecardTab.tsx');
  // Même repli que buildJobContext : une fiche sans projectId garde sa mission par le job_id.
  assert.match(tab, /const missionKey = candidate\.projectId \?\? missionIdOfJob\(candidate\.jobId\) \?\? null;\s*if \(missionKey\) params\.set\('mission', missionKey\)/);
  assert.match(tab, /if \(qualificationSessionId\) params\.set\('session', qualificationSessionId\)/);
  assert.match(tab, /\[activeKey, flush, navigate, candidate\.candidateId, candidate\.projectId, candidate\.jobId, qualificationSessionId\]/);
  const page = code('src/pages/ScorecardFullPage.tsx');
  assert.match(page, /missionIdOfJob\(searchParams\.get\('mission'\)\)/);
  assert.match(page, /\.eq\('project_id', mission\)/);
  // Le repli ancien ne peut sélectionner que le job externe de cette mission,
  // jamais la dernière candidature du même profil dans une autre mission.
  assert.doesNotMatch(page, /readRow\(null\)/);
  assert.match(page, /\.select\('job_id'\)\.eq\('id', requestedMission\)/);
  assert.match(page, /\.eq\('job_id', mission\.job_id\)\s*\.is\('project_id', null\)/);
  // Le calendrier rattache l'entretien par son ID vérifié et le candidat exact.
  assert.match(page, /\.from\('qualification_sessions'\)[\s\S]*?\.eq\('id', sessionParam\)[\s\S]*?\.eq\('candidate_profile_id', candidateId\)/);
  assert.match(page, /missionParam && event\.project_id !== missionParam/);
  assert.match(page, /\[candidateId, missionParam, sessionParam, reloadTick\]/);
});

test('0c-4 : CandidateDetailModal ne lit plus de notes de mission que rien n\'affiche', () => {
  const src = code('src/components/ats/CandidateDetailModal.tsx');
  assert.doesNotMatch(src, /\.eq\('job_id', candidate\.jobId\)/);
  assert.doesNotMatch(src, /projectNotes|setProjectNotes/, 'état écrit et jamais lu');
  assert.doesNotMatch(src, /from\('sourcing_projects'\)/, 'lecture inutile qui retardait la liste des notes');
  assert.match(src, /\[candidate\.candidateId, interactionReload\]\);/);
  assert.match(src, /let cancelled = false/);
  assert.doesNotMatch(src, /recharge la page/i, 'vouvoiement');
});

test('0c-4 : ScorecardFullPage range par l\'étape générale et porte la mission', () => {
  const src = code('src/pages/ScorecardFullPage.tsx');
  assert.match(src, /stage: atsColumnOf\(src\)/);
  assert.doesNotMatch(src, /pipeline_stage \|\| 'Nouveau'/);
  assert.match(src, /generalStage: isGeneralStage\(src\.general_stage\)/);
  // Ligne canonique du groupe de doublons (vue), comme la fiche d'origine.
  assert.match(src, /\.from\('mission_candidate_rows'\)/);
  assert.match(src, /const src = canon \?\? data;/);
  assert.match(src, /processStepId: src\.process_step_id/);
  assert.match(src, /score: src\.score/);
  assert.match(src, /projectId: data\.project_id/);
  assert.match(src, /jd\.title \|\| proj\.job_title \|\| proj\.name/);
  assert.doesNotMatch(src, /Télétravail/, 'mode de travail écrit en mot, jamais « Télétravail : true »');
  assert.match(src, /REMOTE_LABELS\[jd\.remote_policy\]/);
});

// ─── Messagerie : lien de rendez-vous ───────────────────────────────────────

test('0c-4 : useMessagesInbox retrouve la mission du rendez-vous par id ou job_id', () => {
  const src = code('src/hooks/useMessagesInbox.ts');
  assert.match(src, /enrollment\.job_id\.replace\(\/\^project:\/, ''\)/);
  assert.match(src, /UUID_PATTERN\.test\(jobKey\)/);
  assert.match(src, /projectQuery\.or\(`id\.eq\.\$\{jobKey\},job_id\.eq\.\$\{jobKey\}`\)/);
  // Le .or ne reçoit jamais qu'un uuid validé.
  assert.match(src, /UUID_PATTERN\.test\(jobKey\)\s*\? projectQuery\.or/);
});

// ─── Aperçu d'inscription et détail du score ────────────────────────────────

test('0c-4 : EnrollmentPreviewModal lit la note par project_id et organization_id', () => {
  const src = code('src/components/outreach/EnrollmentPreviewModal.tsx');
  assert.match(src, /missionIdOfJob\(job\.id\) && !organizationId/, 'la lecture attend l\'organisation');
  assert.match(src, /\.eq\(column, value\)/);
  assert.match(src, /column === 'project_id' && organizationId\) query = query\.eq\('organization_id', organizationId\)/);
  assert.match(src, /readBy\('project_id', missionId\)/);
  assert.match(src, /readBy\('job_id', job!\.id\)/, 'repli sur le poste pour un job_id ancien');
  assert.match(src, /i \+= 100/, 'lots de 100 identifiants');
  // Doublons : la ligne notée la plus récente (lignes lues de la plus récente).
  assert.match(src, /query\.order\('updated_at', \{ ascending: false \}\)/);
  assert.match(src, /prev && !\(prev\.score == null && r\.score != null\)/);
  assert.match(src, /<ScoringPopover[\s\S]*?projectId=\{missionIdOfJob\(job\?\.id\)\}[\s\S]*?organizationId=\{organizationId\}/);
});

test('0c-4 : ScoringPopover lit la note par mission et organisation, ligne notée d\'abord', () => {
  const src = code('src/components/outreach/enrollment-preview/ScoringPopover.tsx');
  assert.match(src, /projectId\?: string/);
  assert.match(src, /organizationId\?: string \| null/);
  assert.match(src, /\.eq\(column, value\)/);
  assert.match(src, /query\.eq\('organization_id', organizationId\)/);
  assert.match(src, /readBy\('project_id', projectId\)/);
  // Règle de la vue : la ligne notée la plus récente, pas la note la plus haute.
  assert.doesNotMatch(src, /order\('score'/);
  assert.match(src, /order\('updated_at', \{ ascending: false \}\)/);
  assert.match(src, /found\?\.find\(\(r\) => r\.score != null\) \?\? found\?\.\[0\]/);
  // Plus de requête à résultat ignoré ni de colonnes inutilisées.
  assert.doesNotMatch(src, /if \(jobId\) query\.eq/);
  assert.doesNotMatch(src, /pipeline_stage, status/);
  assert.match(src, /if \(projectId && !organizationId\) return/, 'attend l\'organisation en mission');
});

// ─── Tableau de bord ────────────────────────────────────────────────────────

test('0c-4 : Dashboard compte la stagnation comme le /pipeline (stage_entered_at)', () => {
  const src = code('src/pages/Dashboard.tsx');
  assert.doesNotMatch(src, /STAGE_GUIDE_TIMES/, 'table de délais dupliquée');
  assert.doesNotMatch(src, /differenceInDays|parseISO/);
  assert.doesNotMatch(src, /\.lastActivity/, 'plus de date d\'étape tirée de updated_at');
  // La fiche ne s'ouvre plus depuis l'accueil : l'activité récente en est
  // retirée (design simplifié, décision du propriétaire du 04/10/2026).
  assert.doesNotMatch(src, /CandidateDetailModal/);
  assert.match(src, /import \{[^}]*\bstagnantDays\b[^}]*\} from '@\/hooks\/useATSData'/);
  assert.match(src, /import \{[^}]*\bdaysInStage\b[^}]*\} from '@\/hooks\/useATSData'/);
  assert.match(src, /STALE_EXEMPT_STAGES\.has\(c\.generalStage\)/, 'À trier et Retenu exemptés');
  // Les candidats viennent de useATSData (jamais ouverts exclus), pas d'une lecture directe.
  assert.match(src, /useATSData\(\)/);
  assert.doesNotMatch(src, /\.from\('job_candidate_status'\)/);
});

// ─── Suggestions de tâches ──────────────────────────────────────────────────

test('0c-4 : useAutoTaskSuggestions lit l\'étape générale et la date d\'entrée dans l\'étape', () => {
  const src = code('src/hooks/useAutoTaskSuggestions.ts');
  assert.doesNotMatch(src, /\.neq\('pipeline_stage'/, 'un .neq sur pipeline_stage NULL écarte la ligne');
  assert.doesNotMatch(src, /\.neq\('status', 'dismissed'\)/, 'status est une colonne de compatibilité');
  assert.match(src, /\.from\('mission_candidate_rows'\)/);
  assert.doesNotMatch(src, /\.from\('job_candidate_status'\)/);
  assert.match(src, /\.eq\('organization_id', orgId\)/);
  assert.match(src, /\.not\('general_stage', 'in', '\([^)]*\bhired\b[^)]*\brejected\b[^)]*\bto_sort\b[^)]*\)'\)/);
  assert.match(src, /order\('stage_entered_at'/);
  assert.match(src, /stageAgeDays\(c, now\)/);
  assert.doesNotMatch(src, /differenceInDays/);
  assert.doesNotMatch(src, /projectId: null/);
  assert.match(src, /projectId: c\.project_id/);
  // Titres des étapes en mots de la mission, jamais la clé de colonne.
  assert.match(src, /atsColumnTitle\(column\)/);
  // À trier et Retenu : aucun délai de relance.
  const guide = src.slice(src.indexOf('const GUIDE_TIMES'), src.indexOf('const STAGNANT_TOLERANCE_DAYS'));
  assert.doesNotMatch(guide, /Nouveau|Pressenti/);
});
