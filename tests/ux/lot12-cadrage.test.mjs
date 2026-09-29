/**
 * Refonte mission, lot 12 : écran Cadrage de la nouvelle page mission
 * (maquette Cadrage, conception 5.6).
 *  - règles pures (src/components/missions/v3/cadrage/cadrageModel.ts) :
 *    complétude, importance des critères, compétences reprises en critères,
 *    textes de suppression d'étape, réordonnancement ;
 *  - gardes statiques : une seule logique d'enregistrement du poste
 *    (useJobDetailsAutosave), ni « Recalculer », ni IA inexistante, dictée
 *    honnête, écritures d'étape par useMissionStageActions, textes ;
 *  - interrupteur éteint : props facultatives, rendu d'aujourd'hui par défaut.
 *
 * Module empaqueté par esbuild (alias @/ résolus par tsconfig.app.json).
 * Lancer : node --test tests/ux/lot12-cadrage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const DIR = 'src/components/missions/v3/cadrage';
const M = await load(`${DIR}/cadrageModel.ts`);
const FILES = readdirSync(join(ROOT_PATH, DIR)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${DIR}/${f}`);
const NEW_FILES = [
  'cadrageModel.ts',
  'CadrageReadiness.tsx',
  'CriteriaSection.tsx',
  'JobSection.tsx',
  'JobMoreDetails.tsx',
  'InterviewStepsSection.tsx',
  'DeleteStepDialog.tsx',
  'TeamSection.tsx',
].map((f) => `${DIR}/${f}`);

// ─── Règles pures ───────────────────────────────────────────────────────────

const crit = (label, weight) => ({ id: label || 'x', label, description: '', category: 'technical', weight });

test('complétude : quatre repères, un seul calcul', () => {
  const full = {
    title: 'Développeur',
    location: 'Lyon',
    evaluation_criteria: [crit('Go', 3), crit('SQL', 3), crit('Équipe', 3), crit('Anglais', 2)],
    skills_must_have: ['Go'],
  };
  const ok = M.cadrageReadiness(full, 2, 'ready');
  assert.equal(ok.status, 'ready');
  assert.equal(ok.title, 'Poste prêt');
  assert.deepEqual(ok.markers.map((m) => m.id), ['title', 'location', 'criteria', 'step']);
  assert.ok(ok.markers.every((m) => m.state === 'done'));

  const partial = M.cadrageReadiness({ ...full, evaluation_criteria: [crit('Go', 3), crit('  ', 3), crit('SQL', 2)] }, 0, 'ready');
  assert.equal(partial.status, 'incomplete');
  assert.equal(partial.title, 'Poste à compléter');
  assert.equal(partial.markers[2].label, '3 critères indispensables (1 sur 3)', 'libellé vide non compté');
  assert.equal(partial.markers[3].state, 'todo');

  // Étapes en chargement : ni fait ni à compléter ; en échec : jamais « aucune étape ».
  const loading = M.cadrageReadiness(full, 0, 'loading');
  assert.equal(loading.markers[3].state, 'pending');
  assert.equal(loading.status, 'unknown');
  assert.notEqual(loading.title, 'Poste à compléter');
  const failed = M.cadrageReadiness(full, 0, 'error');
  assert.equal(failed.markers[3].state, 'unavailable');
  assert.equal(failed.markers[3].label, 'Étapes indisponibles');
  assert.equal(failed.status, 'unknown');
  assert.equal(M.cadrageReadiness({}, 0, 'ready').markers[0].state, 'todo');
});

test('complétude : jamais « Poste prêt » quand la notation refuserait le poste', () => {
  const base = {
    title: 'Développeur',
    location: 'Lyon',
    evaluation_criteria: [crit('Go', 3), crit('SQL', 3), crit('Équipe', 3)],
  };
  // Ni compétence ni description : même refus que la notation par lot.
  assert.equal(M.canScoreProfiles(base), false);
  const blocked = M.cadrageReadiness(base, 1, 'ready');
  assert.equal(blocked.status, 'incomplete');
  assert.notEqual(blocked.title, 'Poste prêt');
  assert.deepEqual(blocked.markers.map((m) => m.id), ['title', 'location', 'criteria', 'step', 'scoring']);
  assert.equal(blocked.markers[4].state, 'todo');
  // Une compétence souhaitée suffit, une compétence vide non.
  assert.equal(M.canScoreProfiles({ skills_should_have: ['SQL'] }), true);
  assert.equal(M.canScoreProfiles({ skills_must_have: ['  '] }), false);
  // Description des missions et contexte, 30 caractères au moins.
  assert.equal(M.canScoreProfiles({ mission_description: 'Courte' }), false);
  assert.equal(M.canScoreProfiles({ mission_description: 'Piloter la clôture mensuelle', context: 'Groupe' }), true);
  assert.equal(M.cadrageReadiness({ ...base, mission_description: 'x'.repeat(30) }, 1, 'ready').title, 'Poste prêt');
  // Même contrôle que la notation par lot.
  const scoring = read('src/hooks/useLinkedInScoring.ts');
  assert.match(scoring, /selectedJob\.description\.trim\(\)\.length >= 30/);
  assert.match(read('src/hooks/useLinkedInSearch.ts'), /\[jd\.mission_description, jd\.context\]\.filter\(Boolean\)/);
});

test('critères : importance et poids, forme d\'un nouveau critère', () => {
  assert.deepEqual(M.IMPORTANCE_OPTIONS.map((o) => [o.label, o.weight]), [['Indispensable', 3], ['Souhaité', 2], ['Bonus', 1]]);
  assert.equal(M.importanceOfWeight(3), 'indispensable');
  assert.equal(M.importanceOfWeight(2), 'souhaite');
  assert.equal(M.importanceOfWeight(1), 'bonus');
  assert.equal(M.importanceOfWeight(undefined), 'souhaite');
  assert.equal(M.weightOfImportance('bonus'), 1);
  assert.deepEqual(M.newCriterion(42), { id: 'criterion-42', label: '', description: '', category: 'technical', weight: 2 });
});

test('compétences reprises en critères : sans doublon, indispensable 3, souhaité 2, bonus 1', () => {
  const jd = { skills_must_have: ['Go', ' SQL ', ''], skills_should_have: ['go', 'Docker'], skills_nice_to_have: ['Rust'] };
  const out = M.skillsToCriteria(jd, 7);
  assert.deepEqual(out.map((c) => [c.label, c.weight]), [['Go', 3], ['SQL', 3], ['Docker', 2], ['Rust', 1]]);
  assert.equal(new Set(out.map((c) => c.id)).size, out.length, 'identifiants uniques');
  assert.equal(M.convertibleSkillCount(jd), 4);
  assert.equal(M.convertibleSkillCount({}), 0);
});

test('le poste : libellés en français, aide vraie sans valeur', () => {
  assert.equal(M.CONTRACT_OPTIONS.find((o) => o.value === 'freelance').label, 'Indépendant');
  assert.equal(M.SENDER_ROLE_OPTIONS.length, 8, 'les huit rôles connus de la rédaction');
  assert.deepEqual(M.RECRUITMENT_MODE_OPTIONS.map((o) => o.value), ['internal', 'client'], 'deux options, celles que la donnée porte');
  assert.match(M.recruitmentModeHelp(undefined), /^Non précisé/);
  // Sans valeur, les séquences déduisent le mode du type d'organisation.
  assert.match(M.recruitmentModeHelp(undefined), /type de votre organisation/);
  assert.match(read('supabase/functions/process-sequences/index.ts'), /orgRow\.org_type === 'enterprise' \? 'internal' : 'client'/);
  assert.equal(M.anonymizeHelp(false, '', 'Acme'), 'Les messages nomment le client : Acme.');
  assert.equal(M.anonymizeHelp(true, '', 'Acme'), 'Les messages ne nomment pas le client.');
  assert.match(M.anonymizeHelp(true, 'un groupe familial', 'Acme'), /« un groupe familial »/);
  assert.match(M.anonymizeHelp(false, '', ''), /Renseignez le client/);
  assert.equal(M.parseAmount(''), undefined);
  assert.equal(M.parseAmount('65000'), 65000);
  assert.equal(M.parseAmount('-3'), undefined);
  assert.equal(M.parseAmount('4,5'), 4.5);
});

test('étapes : destination par défaut, réordonnancement, textes accordés', () => {
  assert.equal(M.defaultMoveTarget(['a', 'b', 'c'], 'b'), 'c', 'la suivante');
  assert.equal(M.defaultMoveTarget(['a', 'b', 'c'], 'c'), 'b', 'sinon la précédente');
  assert.equal(M.defaultMoveTarget(['a'], 'a'), null, 'sinon aucune');
  assert.deepEqual(M.movedOrder(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(M.movedOrder(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.equal(M.movedOrder(['a', 'b'], 'a', -1), null);
  assert.equal(M.deleteStepText(1, 'Technique', true), "1 candidat est à l'étape « Technique ». Il passera à :");
  assert.equal(M.deleteStepText(3, 'Technique', false), "3 candidats sont à l'étape « Technique ». Ils reviendront à « A répondu ».");
  assert.equal(M.stepCountLabel(0), 'Aucun');
  assert.equal(M.stepCountLabel(2), '2 candidats');
  assert.equal(M.initialsOf('Claire Martin'), 'CM');
  assert.equal(M.TEAM_ROLE_LABELS.lead, 'Responsable');
});

// ─── Gardes statiques ───────────────────────────────────────────────────────

test('fichiers du plan présents', () => {
  for (const rel of NEW_FILES) assert.ok(FILES.includes(rel), `${rel} manquant`);
});

test('une seule logique d\'enregistrement du poste : useJobDetailsAutosave, une instance par écran', () => {
  const hook = code(read('src/hooks/useJobDetailsAutosave.ts'));
  assert.match(hook, /setTimeout\(send, 800\)/, 'envoi 800 ms après la dernière frappe');
  assert.match(hook, /if \(editSeqRef\.current === sentSeq\)/, 'garde de frappe en vol');
  assert.match(hook, /clearTimeout\(saveTimerRef\.current\);\s*\/\/ Flush|clearTimeout\(saveTimerRef\.current\);\s*if \(Object\.keys\(pendingPatchRef\.current\)/, 'envoi au démontage');
  const brief = code(read('src/components/missions/v2/MissionBriefV2.tsx'));
  assert.match(brief, /useJobDetailsAutosave\(project, readOnly\)/, 'ancienne page : même logique, déplacée');
  assert.doesNotMatch(brief, /pendingPatchRef|saveTimerRef/, 'plus de copie de la logique dans MissionBriefV2');

  let instances = 0;
  for (const rel of FILES) {
    const src = code(read(rel));
    instances += (src.match(/useJobDetailsAutosave\(/g) || []).length;
    assert.doesNotMatch(src, /\bjob_details\s*:/, `${rel} : job_details écrit hors du hook`);
    if (!rel.endsWith('CadrageScreen.tsx')) assert.doesNotMatch(src, /updateProject\(/, `${rel} : updateProject hors de l'écran`);
  }
  assert.equal(instances, 1, 'une seule instance du hook dans Cadrage');
  const screen = code(read(`${DIR}/CadrageScreen.tsx`));
  assert.match(screen, /updateProject\(\{ id: projectId, calendly_link: value \|\| null \}\)/, 'seul le lien de rendez-vous hors du hook');
  assert.match(screen, /hideMessageSettings/, 'Réglages sans second chemin vers outreach_config');
});

test('dictée : pas de fermeture pendant l\'écoute, texte de la dernière session seulement', () => {
  const readiness = code(read(`${DIR}/CadrageReadiness.tsx`));
  assert.match(readiness, /onRecordingChange=\{onRecordingChange\}/);
  assert.match(readiness, /if \(active\) setTranscript\(''\);/);
  assert.match(readiness, /if \(dictating && listening\) \{[\s\S]*?return;/);
});

test('rien qui exige une fonction absente : ni Recalculer, ni suggestion IA, dictée honnête', () => {
  for (const rel of FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /Recalculer/, `${rel} : « Recalculer » (pas de renotation)`);
    assert.doesNotMatch(src, /Suggestion IA|Réoptimiser|Analyser avec l'IA/, `${rel} : IA inexistante`);
    assert.doesNotMatch(src, /se remplissent/, `${rel} : la dictée ne remplit pas les champs`);
    assert.doesNotMatch(src, /Partenaires|confidentielle|Changer de responsable/, `${rel} : fonction gelée ou sans donnée`);
  }
  const readiness = read(`${DIR}/CadrageReadiness.tsx`);
  assert.match(readiness, /elle ne remplit pas les champs/);
  assert.match(readiness, /raw_brief: fullText/);
});

test('écritures d\'étape candidat : par useMissionStageActions seulement, étape supprimée ensuite', () => {
  for (const rel of FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /job_candidate_status/, `${rel} : job_candidate_status`);
    assert.doesNotMatch(src, /pipeline_stage/, `${rel} : pipeline_stage`);
    assert.doesNotMatch(src, /setCandidateStages?\(|rpc\(/, `${rel} : écriture d'étape en direct`);
  }
  const dialog = code(read(`${DIR}/DeleteStepDialog.tsx`));
  assert.match(dialog, /useMissionStageActions\(projectId\)/);
  assert.match(dialog, /fromStages: \['interviewing'\]/);
  assert.match(dialog, /\{ stage: 'replied' as const \}/, 'sans autre étape : A répondu');
  const moveAt = dialog.indexOf('await move(');
  const deleteAt = dialog.indexOf('await deleteStep(');
  assert.ok(moveAt > 0 && deleteAt > moveAt, 'déplacement avant suppression');
  assert.match(dialog, /summary\.callFailed \|\| summary\.refused > 0/, 'refus : étape gardée');
  assert.match(dialog, /<AlertDialog\b/, 'confirmation AlertDialog');
});

test('textes : français, sans tiret long, sans emoji, sans prestataire, sans mesure d\'usage', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const rel of [...FILES, 'src/hooks/useJobDetailsAutosave.ts']) {
    const src = read(rel);
    const body = code(src);
    assert.ok(!body.includes('\u2014'), `${rel} : tiret long`);
    assert.ok(!EMOJI.test(src), `${rel} : emoji`);
    assert.ok(!/unipile|apollo|people data labs|\bpdl\b|anthropic|claude|calendly|deepgram/i.test(body.replace(/calendly_link|useCalendlyLinkSave|calendlyLink|onCalendlyCommit/g, '')), `${rel} : nom de prestataire`);
    assert.ok(!/\btrackEvent\b/.test(body), `${rel} : trackEvent`);
    assert.ok(!/window\.confirm/.test(body), `${rel} : window.confirm`);
    assert.ok(!/[A-Za-zÀ-ÿ]\(s\)/.test(body), `${rel} : « (s) »`);
  }
});

test('Équipe : suit les droits, réemploie MissionTeamSection', () => {
  const team = code(read(`${DIR}/TeamSection.tsx`));
  assert.match(team, /hasFeature\(orgType, 'team_management'\)/);
  assert.match(team, /hasPlanFeature\(effectivePlanId, 'team'\)/);
  assert.match(team, /if \(!loading && !allowed\) return null;/, 'sans droit : pas de section');
  assert.match(team, /<MissionTeamSection\s+embedded\s+roleLabels=\{TEAM_ROLE_LABELS\}/);
});

test('interrupteur éteint : props facultatives, rendu d\'aujourd\'hui par défaut', () => {
  const config = code(read('src/components/missions/v2/MissionConfigV2.tsx'));
  assert.match(config, /hideMessageSettings\?: boolean;/);
  assert.match(config, /hideMessageSettings = false/);
  assert.match(config, /embedded\?: boolean;/);
  assert.match(config, /embedded = false \}\) => \{/);
  // Rendu d'aujourd'hui gardé hors rendu intégré.
  assert.match(config, /emoji=\{embedded \? undefined : '⚙️'\}/);
  assert.match(config, /\{!embedded && \(\n\s+<aside/);
  assert.match(config, /\{readOnly && !embedded && \(/);
  const dictation = code(read('src/components/missions/VoiceDictation.tsx'));
  assert.match(dictation, /onRecordingChange\?: \(active: boolean\) => void;/);
  assert.match(dictation, /onRecordingChange\?\.\(active\);/, 'facultatif : rien sans la prop');
  assert.doesNotMatch(code(read('src/components/missions/v2/MissionBriefV2.tsx')), /onRecordingChange/);
  const shared = code(read('src/components/missions/process/shared.tsx'));
  assert.match(shared, /embedded\?: boolean;/);
  assert.match(shared, /embedded = false, roleLabels,/);
  assert.match(shared, /\{embedded \? 'Assigner' : 'OK'\}/, 'bouton d\'aujourd\'hui gardé');
  assert.match(shared, /Équipe mission \(\{team\.length\}\)/, 'en-tête d\'aujourd\'hui gardé');
  // L'ancienne page n'utilise pas les nouvelles props.
  const process = code(read('src/components/missions/v2/MissionProcessV2.tsx'));
  assert.doesNotMatch(process, /embedded|roleLabels/);
  const workspace = code(read('src/components/missions/v2/MissionWorkspaceV2.tsx'));
  assert.doesNotMatch(workspace, /hideMessageSettings|embedded/);
});
