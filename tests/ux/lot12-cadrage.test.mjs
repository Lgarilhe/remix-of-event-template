/**
 * Refonte mission, lot 12 : écran Cadrage de la nouvelle page mission
 * (maquette Cadrage, conception 5.6).
 *  - règles pures (src/components/missions/v3/cadrage/cadrageModel.ts) :
 *    complétude, importance des critères, compétences reprises en critères,
 *    textes de suppression d'étape, réordonnancement ;
 *  - gardes statiques : une seule logique d'enregistrement du poste
 *    (useJobDetailsAutosave), ni « Recalculer », ni IA inexistante, dictée
 *    honnête, écritures d'étape par useMissionStageActions, textes ;
 *  - interrupteur éteint : props facultatives, rendu d'aujourd'hui par défaut ;
 *  - design simplifié (04/10/2026) : bandeau d'état d'une phrase, sections sans
 *    carte, éléments discrets qui restent atteignables, « Qui recrute » en une
 *    ligne, colonne « En ce moment » conditionnelle, aucun zéro affiché.
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
  'SectionHeader.tsx',
  'sectionUi.ts',
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
  assert.equal(ok.sentence, 'Tout est en place pour chercher et noter des profils.');
  assert.deepEqual([ok.done, ok.total], [4, 4]);
  assert.deepEqual(ok.markers.map((m) => m.id), ['title', 'location', 'criteria', 'step']);
  assert.ok(ok.markers.every((m) => m.state === 'done'));

  const partial = M.cadrageReadiness({ ...full, evaluation_criteria: [crit('Go', 3), crit('  ', 3), crit('SQL', 2)] }, 0, 'ready');
  assert.equal(partial.status, 'incomplete');
  assert.equal(partial.title, 'Poste à compléter');
  assert.equal(partial.markers[2].label, '3 critères indispensables (1 sur 3)', 'libellé vide non compté');
  assert.equal(partial.markers[3].state, 'todo');
  assert.deepEqual([partial.done, partial.total], [2, 4]);
  // Plusieurs repères manquent : une phrase qui les nomme tous.
  assert.equal(partial.sentence, "Il reste à compléter : 2 critères indispensables et une étape d'entretien.");
  assert.equal(
    M.cadrageReadiness({}, 0, 'ready').sentence,
    "Il reste à compléter : l'intitulé du poste, le lieu, 3 critères indispensables, une étape d'entretien et les compétences ou la description des missions.",
  );

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

test('complétude : « presque prêt » quand un seul repère manque, une phrase qui dit lequel', () => {
  const base = {
    title: 'Développeur',
    location: 'Lyon',
    evaluation_criteria: [crit('Go', 3), crit('SQL', 3), crit('Équipe', 3)],
    skills_must_have: ['Go'],
  };
  const one = (patch, steps = 1) => M.cadrageReadiness({ ...base, ...patch }, steps, 'ready');
  const criteria = one({ evaluation_criteria: [crit('Go', 3)] });
  assert.equal(criteria.title, 'Poste presque prêt');
  assert.equal(criteria.sentence, 'Ajoutez 2 critères indispensables pour fiabiliser la notation.');
  assert.equal(one({ evaluation_criteria: [crit('Go', 3), crit('SQL', 3)] }).sentence, 'Ajoutez 1 critère indispensable pour fiabiliser la notation.');
  assert.equal(one({ title: '' }).sentence, "Ajoutez l'intitulé du poste.");
  assert.equal(one({ location: ' ' }).sentence, 'Précisez le lieu du poste.');
  assert.equal(one({}, 0).sentence, "Ajoutez une étape d'entretien pour suivre les candidats.");
  assert.match(one({ skills_must_have: [] }).sentence, /^Décrivez les missions ou ajoutez des compétences/);
  // Deux repères : « à compléter », pas « presque prêt ».
  assert.equal(one({ title: '', location: '' }).title, 'Poste à compléter');
  // Étapes en chargement ou en échec : la phrase le dit, jamais « à compléter ».
  assert.equal(M.cadrageReadiness(base, 0, 'loading').sentence, "Vérification des étapes d'entretien en cours.");
  assert.equal(M.cadrageReadiness(base, 0, 'error').sentence, "Les étapes d'entretien sont indisponibles pour l'instant.");
  // Jamais d'accent mis sur un zéro : la phrase ne compte que ce qui manque (de 1 à 3).
  for (const must of [0, 1, 2]) {
    const list = Array.from({ length: must }, (_, i) => crit(`C${i}`, 3));
    assert.doesNotMatch(M.cadrageReadiness({ ...base, evaluation_criteria: list }, 1, 'ready').sentence, /\b0\b/);
  }
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
  // « Qui recrute » en une ligne ; sans valeur, les séquences déduisent le mode du type d'organisation.
  assert.equal(M.recruitmentModeLine('internal', 'agency'), 'Qui recrute : vous, en interne.');
  assert.equal(M.recruitmentModeLine('client', 'enterprise'), 'Qui recrute : vous, pour un client.');
  assert.equal(
    M.recruitmentModeLine(undefined, 'agency'),
    'Qui recrute : non précisé. Les messages suivent le type de votre organisation, donc pour un client.',
  );
  assert.equal(M.recruitmentModeLine(undefined, 'freelance'), M.recruitmentModeLine(undefined, 'agency'));
  assert.equal(
    M.recruitmentModeLine(undefined, 'enterprise'),
    'Qui recrute : non précisé. Les messages suivent le type de votre organisation, donc en interne.',
  );
  assert.equal(M.recruitmentModeLine(undefined, null), 'Qui recrute : non précisé. Les messages suivent le type de votre organisation.');
  assert.match(read('supabase/functions/process-sequences/index.ts'), /orgRow\.org_type === 'enterprise' \? 'internal' : 'client'/);
  assert.equal(M.recruitmentModeHelp(undefined), null, 'rien à expliquer tant qu\'aucun choix n\'est fait');
  assert.match(M.recruitmentModeHelp('internal'), /au nom de votre entreprise/);
  assert.match(M.recruitmentModeHelp('client'), /pour le compte de votre client/);
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
  assert.equal(M.stepCountLabel(0), null, 'jamais de zéro ni de « Aucun » écrit');
  assert.equal(M.stepCountLabel(1), '1 candidat');
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

// ─── Design simplifié (04/10/2026) ──────────────────────────────────────────

const REVEAL = /REVEAL_ON_ROW =\s*'([^']*)'/;

test('design simplifié : paliers nommés, pas de titre en capitales, pas de carte, au plus un bouton plein', () => {
  let primary = 0;
  for (const rel of FILES) {
    const body = code(read(rel));
    assert.doesNotMatch(body, /text-\[\d/, `${rel} : taille de texte écrite à la main`);
    assert.doesNotMatch(body, /\buppercase\b/, `${rel} : texte en capitales`);
    assert.doesNotMatch(body, /\bbg-card\b|rounded-xl border|border border-border bg-/, `${rel} : carte à bordure`);
    primary += (body.match(/variant="primary"/g) || []).length;
  }
  assert.ok(primary <= 1, `un seul bouton plein par écran au plus (trouvé : ${primary})`);
  // Les titres de section sont de vrais titres : 18 px, une phrase d'aide dessous, un filet fin entre sections.
  const header = code(read(`${DIR}/sectionUi.ts`) + read(`${DIR}/SectionHeader.tsx`));
  assert.match(header, /<h2 id=\{id\} className="text-lg font-semibold text-foreground">/);
  assert.match(header, /<p className="text-sm text-muted-foreground">\{help\}<\/p>/);
  const section = header.match(/SECTION_CLASS = '([^']*)'/)[1];
  assert.match(section, /\bborder-t border-border\b/);
  assert.doesNotMatch(section, /\brounded|\bbg-|(^| )border( |$)/, 'filet fin, ni cadre ni fond');
  for (const file of ['CriteriaSection.tsx', 'JobSection.tsx', 'InterviewStepsSection.tsx', 'TeamSection.tsx', 'CadrageScreen.tsx']) {
    const src = code(read(`${DIR}/${file}`));
    assert.match(src, /className=\{SECTION_CLASS\}/, `${file} : section sans carte`);
  }
  for (const file of ['CriteriaSection.tsx', 'JobSection.tsx', 'InterviewStepsSection.tsx', 'TeamSection.tsx']) {
    assert.match(code(read(`${DIR}/${file}`)), /<SectionHeader\b/, `${file} : titre et phrase d'aide`);
  }
});

test('éléments discrets : l\'opacité seule change, ils restent atteignables au clavier et au toucher', () => {
  const header = code(read(`${DIR}/sectionUi.ts`) + read(`${DIR}/SectionHeader.tsx`));
  const reveal = header.match(REVEAL)[1];
  for (const part of ['opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100', '[@media(hover:none)]:opacity-100']) {
    assert.ok(reveal.includes(part), `REVEAL_ON_ROW sans ${part}`);
  }
  assert.doesNotMatch(reveal, /\bhidden\b|\binvisible\b|display|sr-only|pointer-events-none/, 'jamais retiré de la tabulation');
  // Critères : « Rédhibitoire » (visible quand il est coché) et la corbeille ; Étapes : poignée et corbeille.
  const criteria = code(read(`${DIR}/CriteriaSection.tsx`));
  assert.ok((criteria.match(/REVEAL_ON_ROW/g) || []).length >= 3, 'case Rédhibitoire et corbeille');
  assert.match(criteria, /dealBreaker \? 'text-foreground' : REVEAL_ON_ROW/, 'un critère rédhibitoire garde sa case visible');
  assert.match(criteria, /'group flex flex-wrap/, 'la ligne est le groupe du survol');
  const steps = code(read(`${DIR}/InterviewStepsSection.tsx`));
  assert.ok((steps.match(/REVEAL_ON_ROW/g) || []).length >= 2, 'poignée et corbeille');
  assert.match(steps, /moving \? 'text-foreground' : cn\('text-muted-foreground', REVEAL_ON_ROW\)/, 'la poignée reste visible pendant le réordonnancement');
  assert.match(steps, /'group -mx-2 rounded-lg px-2/, 'la ligne est le groupe du survol');
  // Équipe (rendu embedded de MissionTeamSection) : même règle, écrite en toutes lettres.
  const shared = code(read('src/components/missions/process/shared.tsx'));
  assert.match(shared, /opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 \[@media\(hover:none\)\]:opacity-100/);
});

test('bandeau d\'état : un anneau, un titre, une phrase ; « Dicter » discret ; plus de coches', () => {
  const r = code(read(`${DIR}/CadrageReadiness.tsx`));
  assert.match(r, /<ProgressRing done=\{done\} total=\{total\} ready=\{status === 'ready'\} \/>/);
  assert.match(r, /\{title\}<\/p>/);
  assert.match(r, /\{sentence\}<\/p>/);
  assert.match(r, /<Button\s+type="button"\s+variant="ghost"\s+size="sm"\s+aria-expanded=\{dictating\}/, '« Dicter » en bouton discret');
  assert.doesNotMatch(r, /CircleDashed|CheckCircle2/, 'plus de repères en coches');
  assert.match(r, /<ul aria-label="Repères de complétude" className="sr-only">/, 'la liste des repères reste pour les lecteurs d\'écran');
  assert.match(r, /\{share > 0 && \(/, 'pas de point de départ quand rien n\'est fait');
  // Aucun zéro écrit dans l'anneau.
  assert.match(r, /done > 0 \? \(/);
});

test('Qui recrute : une ligne, deux choix sous « Préciser » ou « Modifier », même écriture en base', () => {
  const job = code(read(`${DIR}/JobSection.tsx`));
  assert.match(job, /recruitmentModeLine\(mode, orgType\)/);
  assert.match(job, /'Modifier' : 'Préciser'/);
  assert.match(job, /onChange=\{\(mode\) => setConfig\(\{ recruitment_mode: mode \}\)\}/, 'outreach_config.recruitment_mode, comme avant');
  assert.match(job, /\{choosing && !readOnly && \(/, 'les deux choix n\'apparaissent qu\'à la demande');
  assert.match(job, /aria-label="Qui recrute \?"/);
  assert.match(job, /RECRUITMENT_MODE_OPTIONS\.map/);
  assert.match(job, /aria-expanded=\{choosing\}/);
  // Le choix fait, les choix se referment et le focus revient au lien.
  assert.match(job, /onValueChange=\{\(v\) => \{\s*onChange\(v as 'internal' \| 'client'\);\s*close\(\);/);
  assert.match(job, /trigger\.current\?\.focus\(\)/);
});

test('étapes : colonne « En ce moment » seulement si une étape a des candidats, jamais de zéro', () => {
  const steps = code(read(`${DIR}/InterviewStepsSection.tsx`));
  assert.match(steps, /const withCounts = counts\.kind === 'ready' && .*n > 0/);
  assert.match(steps, /\{withCounts && <span>En ce moment<\/span>\}/);
  assert.match(steps, /\{withCounts && \(\s*<span/, 'cellule d\'effectif seulement avec la colonne');
  assert.match(steps, /const countLabel = counts\.kind === 'ready' \? stepCountLabel\(counts\.byStep\[step\.id\] \?\? 0\) : null;/);
  assert.doesNotMatch(steps, /indisponible['"<]/, 'pas de mot à la place d\'un effectif inconnu');
  assert.match(steps, /useMissionStageCounts\(\[project\.id\]\)/, 'même lecture que la barre d\'étapes du Pipeline');
  // L'ordre et la suppression ne changent pas : Monter, Descendre, DeleteStepDialog.
  assert.match(steps, /<DeleteStepDialog\b/);
  assert.match(steps, /await reorderSteps\(next\)/);
  assert.match(steps, /aria-label=\{`Supprimer l'étape \$\{name\}`\}/);
  assert.match(steps, /aria-label=\{`Réordonner l'étape \$\{name\}`\}/);
});

test('critères : mêmes noms accessibles et même écriture en base qu\'avant', () => {
  const criteria = code(read(`${DIR}/CriteriaSection.tsx`));
  for (const needle of [
    'aria-label={`Libellé du critère ${i + 1}`}',
    'aria-label={`Importance du critère ${name}`}',
    'aria-pressed={pressed}',
    'aria-label={`Rédhibitoire : ${name}`}',
    'aria-label={`Supprimer le critère ${name}`}',
    'patch(c.id, { weight: weightOfImportance(o.value) })',
    'patch(c.id, { deal_breaker: v === true })',
    'updateField({ evaluation_criteria: next })',
    'Ajouter un critère',
  ]) {
    assert.ok(criteria.includes(needle), needle);
  }
  // Cibles de 44 px sur téléphone pour les contrôles de la ligne.
  assert.match(criteria, /max-sm:h-11/);
  assert.match(criteria, /max-sm:min-h-11 max-sm:min-w-11/);
});

test('Équipe : « Assigner » discret, état vide sur une ligne, ancien rendu gardé hors embedded', () => {
  const team = code(read(`${DIR}/TeamSection.tsx`));
  assert.doesNotMatch(team, /rounded-xl border|bg-card/);
  const shared = code(read('src/components/missions/process/shared.tsx'));
  assert.match(shared, /<Button\s+type="button"\s+variant="ghost"\s+size="sm"\s+onClick=\{\(\) => setShowAssign\(true\)\}/);
  assert.match(shared, /\{canAssign && assignButton\}/, 'état vide : le texte et « Assigner » sur une ligne');
  assert.match(shared, /\{embedded && canAssign && <div/, 'liste : « Assigner » sous la dernière ligne');
  assert.match(shared, /<PersonAvatar name=\{memberName\(member\.user_id\)\} size=\{32\} \/>/, 'chaque ligne montre de qui elle parle');
  // Rendu d'aujourd'hui (ancienne page) : en-tête, bouton encadré, cartes, texte vide.
  assert.match(shared, /\{!embedded && \(\s*<div className="flex items-center justify-between mb-4">/);
  assert.match(shared, /inline-flex items-center gap-1\.5 h-8 px-3 rounded-full text-2xs font-medium border border-border bg-background text-foreground hover:bg-accent transition-colors/);
  assert.match(shared, /'flex items-center gap-3 px-4 py-2\.5 rounded-lg border border-border bg-card'/);
  assert.match(shared, /<p className="text-xs text-muted-foreground">Aucun membre assigné à cette mission\.<\/p>/);
  assert.match(shared, /'space-y-2'/);
});

test('lecture seule : bande douce, mêmes testid et texte', () => {
  const banner = code(read(`${DIR}/CadrageReadOnlyBanner.tsx`));
  assert.match(banner, /data-testid="cadrage-read-only"/);
  assert.match(banner, /rounded-xl bg-muted\/50/);
  assert.doesNotMatch(banner, /\bborder\b/);
});

test('défilement vers une section : les quatre ancres et Réglages gardent leur identifiant', () => {
  const screen = code(read(`${DIR}/CadrageScreen.tsx`));
  for (const id of ['cadrage-criteres', 'cadrage-poste', 'cadrage-etapes', 'cadrage-equipe', 'cadrage-reglages']) {
    assert.ok(screen.includes(`'${id}'`), id);
  }
  assert.match(screen, /document\s*\.getElementById\(SECTION_ID\[section\]\)\s*\?\.scrollIntoView\(/);
  for (const [file, id] of [
    ['CriteriaSection.tsx', 'cadrage-criteres'],
    ['JobSection.tsx', 'cadrage-poste'],
    ['InterviewStepsSection.tsx', 'cadrage-etapes'],
    ['TeamSection.tsx', 'cadrage-equipe'],
  ]) {
    assert.ok(code(read(`${DIR}/${file}`)).includes(`<section id="${id}"`), `${file} : #${id}`);
  }
  assert.match(screen, /<MissionConfigV2 project=\{project\} readOnly=\{!canEditBrief\} hideStatus hideMessageSettings embedded \/>/);
});

// ─── Après relecture (04/10/2026) : Réglages, téléphone, dictée, focus ───────

/** Chaque ligne qui écrit « uppercase » le fait dans la branche d'aujourd'hui, jamais dans le rendu intégré. */
function uppercaseOnlyOnOldBranch(src, rel) {
  for (const line of src.split('\n')) {
    if (!/\buppercase\b/.test(line)) continue;
    assert.ok(/embedded \?|!embedded/.test(line), `${rel} : capitales hors branche d'aujourd'hui : ${line.trim()}`);
    assert.doesNotMatch(line, /embedded \? '[^']*uppercase/, `${rel} : capitales dans le rendu intégré : ${line.trim()}`);
  }
}

test('Réglages dépliés : sans carte ni capitales, états sans objet muets, rendu d\'aujourd\'hui gardé', () => {
  const config = code(read('src/components/missions/v2/MissionConfigV2.tsx'));
  assert.match(config, /<MissionHuntMode project=\{project\} embedded=\{embedded\} \/>/);
  assert.match(config, /<MissionClientPortal project=\{project\} embedded=\{embedded\} \/>/);
  assert.match(config, /bare=\{embedded\}/, 'Infos mission sans carte ni titre');
  assert.match(config, /=> bare \? \(\s*<div className="space-y-4">\{children\}<\/div>\s*\) : \(\s*<div className="bg-card border border-border rounded-xl overflow-hidden">/, 'carte d\'aujourd\'hui gardée');
  assert.ok((config.match(/plain=\{embedded\}/g) || []).length >= 5, 'libellés et aides en 14 px, sans capitales');
  assert.match(config, /plain \? 'text-sm text-muted-foreground' : 'text-2xs uppercase tracking-wider text-muted-foreground font-semibold'/);
  assert.match(config, /touch && 'max-sm:h-11'/);

  const hunt = code(read('src/components/missions/MissionHuntMode.tsx'));
  assert.match(hunt, /embedded = false \}\) => \{/, 'défaut : le rendu d\'aujourd\'hui');
  assert.match(hunt, /if \(!canPublish\) \{\s*if \(embedded\) return null;\s*return \(\s*<div className="rounded-lg border border-border p-6 text-center">/, 'carte « réservé aux entreprises » : muette ici, gardée ailleurs');
  assert.match(hunt, /Le mode chasse est réservé aux entreprises\./);
  assert.match(hunt, /if \(embedded && frozen && !isEnabled\) return null;/, 'rien à faire pendant le gel');
  assert.match(hunt, /'rounded-xl border border-border p-5 space-y-5 bg-card'/, 'carte d\'aujourd\'hui gardée');
  uppercaseOnlyOnOldBranch(hunt, 'MissionHuntMode.tsx');
  for (const name of ['EMB_BTN', 'EMB_BTN_DANGER', 'EMB_INPUT', 'EMB_LABEL', 'EMB_HEADING']) {
    const value = hunt.match(new RegExp(`const ${name} = '([^']*)'`))?.[1];
    assert.ok(value, name);
    assert.doesNotMatch(value, /uppercase|rounded-full|\bborder-border\b.*\bbg-foreground|bg-foreground|text-xs|text-2xs/, `${name} : ni capitales, ni pilule, ni bouton plein, ni micro-texte`);
  }
  assert.doesNotMatch(hunt.match(/const EMB_BTN = '([^']*)'/)[1], /\bborder\b/, 'bouton discret : sans cadre');

  const portal = code(read('src/components/missions/MissionClientPortal.tsx'));
  assert.match(portal, /embedded = false \}\) => \{/);
  assert.match(portal, /if \(!canUse\) \{\s*if \(embedded\) return null;\s*return \(\s*<div className="rounded-lg border border-border p-6 text-center">/);
  assert.match(portal, /<Button\s+type="button"\s+variant="ghost"\s+size="sm"\s+onClick=\{\(\) => setShowForm\(true\)\}/, '« Créer un accès » discret');
  assert.match(portal, /h-9 px-3 rounded-full inline-flex items-center gap-1\.5 text-xs font-medium border border-border hover:bg-accent transition-colors flex-shrink-0/, 'bouton d\'aujourd\'hui gardé');
  assert.match(portal, /'rounded-xl border border-border p-5 space-y-4 bg-card'/, 'carte d\'aujourd\'hui gardée');
  assert.doesNotMatch(portal, /variant="primary"/, 'aucun bouton plein');
  uppercaseOnlyOnOldBranch(portal, 'MissionClientPortal.tsx');

  // L'ancienne page n'utilise toujours pas le rendu intégré.
  assert.doesNotMatch(code(read('src/components/missions/v2/MissionWorkspaceV2.tsx')), /embedded/);
  for (const rel of ['MissionHuntMode.tsx', 'MissionClientPortal.tsx']) {
    const src = code(read(`src/components/missions/${rel}`));
    assert.doesNotMatch(src, /\bwindow\.confirm\b/, rel);
  }
});

test('téléphone : champs et menus de 44 px dans tout le Cadrage, assignation comprise', () => {
  const header = code(read(`${DIR}/sectionUi.ts`) + read(`${DIR}/SectionHeader.tsx`));
  assert.match(header, /TOUCH_FIELD = 'max-sm:h-11'/);
  const job = code(read(`${DIR}/JobSection.tsx`));
  assert.match(job, /export const FieldInput = forwardRef<HTMLInputElement, InputProps>/);
  assert.match(job, /className=\{cn\(TOUCH_FIELD, className\)\}/);
  assert.match(job, /appearance-none[^']*',\s*TOUCH_FIELD,/, 'menu natif');
  assert.equal((job.match(/<Input\b/g) || []).length, 1, 'JobSection : un seul <Input>, celui de FieldInput');
  for (const file of ['JobMoreDetails.tsx', 'CriteriaSection.tsx']) {
    const src = code(read(`${DIR}/${file}`));
    assert.doesNotMatch(src, /<Input\b/, `${file} : champs par FieldInput`);
    assert.match(src, /<FieldInput\b/, file);
  }
  // Étapes : chaque champ porte sa hauteur tactile.
  const steps = code(read(`${DIR}/InterviewStepsSection.tsx`));
  const inputs = steps.split(/<Input\b/).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('/>')));
  assert.equal(inputs.length, 3);
  for (const chunk of inputs) assert.match(chunk, /max-sm:h-11|TOUCH_FIELD/);
  // Équipe : menus et croix de 44 px (rendu intégré seulement), glyphe lisible.
  const shared = code(read('src/components/missions/process/shared.tsx'));
  assert.match(shared, /embedded && 'max-sm:h-11'/, 'menu des membres');
  assert.match(shared, /embedded && 'text-sm font-normal max-sm:h-11'/, 'menu du rôle');
  assert.match(shared, /\{embedded \? <X className="h-4 w-4" aria-hidden="true" \/> : '×'\}/, 'croix : icône à 16 px, « × » gardé hors rendu intégré');
  assert.match(shared, /max-sm:h-11 max-sm:w-11'\s*:\s*'inline-flex items-center justify-center gap-1\.5 h-9 px-3 rounded-full text-2xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'/, 'cible de 44 px, bouton d\'aujourd\'hui gardé');
});

test('dictée : variante de la nouvelle page sans capitales ni rouge écrit, ancien rendu gardé', () => {
  const dictation = code(read('src/components/missions/VoiceDictation.tsx'));
  assert.match(dictation, /variant\?: 'default' \| 'mission-v3';/);
  assert.match(dictation, /variant = 'default'/);
  const afterV3 = dictation.split('if (v3) {')[1];
  const [v3Branch, defaultBranch] = afterV3.split(/\n  return \(\n    <div className=\{cn\("space-y-3", className\)\}>/);
  assert.ok(v3Branch && defaultBranch, 'deux rendus');
  assert.doesNotMatch(v3Branch, /uppercase|tracking-wider|bg-red|border-red|text-red|text-xs|text-2xs|\u2014/, 'variante : casse normale, 14 px, jetons du système, sans tiret long');
  assert.match(v3Branch, /<Button type="button" variant="primary" onClick=\{startRecording\} loading=\{isConnecting\} className="max-sm:h-11">/);
  assert.match(v3Branch, /<Button type="button" variant="destructive" onClick=\{stopRecording\} className="max-sm:h-11">/);
  assert.match(v3Branch, /Dicter le brief/);
  assert.match(v3Branch, /Arrêter/);
  assert.match(v3Branch, /motion-safe:animate-ping/, 'le mouvement réduit est respecté');
  // Ancien rendu (brief de l'ancienne page) : même classes, même texte.
  assert.match(defaultBranch, /relative overflow-hidden flex items-center gap-2 h-9 px-5 text-xs font-medium uppercase tracking-wider border border-border group/);
  assert.match(defaultBranch, /border border-red-600 bg-red-600 text-white/);
  assert.match(defaultBranch, /En écoute \u2014 parlez naturellement\.\.\./);
  assert.doesNotMatch(code(read('src/components/missions/v2/MissionBriefV2.tsx')), /mission-v3/);
  assert.match(code(read(`${DIR}/CadrageReadiness.tsx`)), /<VoiceDictation\s+variant="mission-v3"/);
});

test('confirmation de suppression : le focus revient à la corbeille, jamais à la page', () => {
  const header = code(read(`${DIR}/sectionUi.ts`) + read(`${DIR}/SectionHeader.tsx`));
  assert.match(header, /export function useReturnFocus\(\)/);
  assert.match(header, /opener\.current = document\.activeElement instanceof HTMLElement \? document\.activeElement : null;/);
  assert.match(header, /\(el && el\.isConnected \? el : fallback\?\.\(\)\)\?\.focus\(\);/, 'élément disparu : repli');
  assert.match(header, /window\.requestAnimationFrame/, 'après la fermeture de la fenêtre');

  const criteria = code(read(`${DIR}/CriteriaSection.tsx`));
  assert.match(criteria, /returnFocus\.remember\(\);\s*setConfirm\(\{ id: c\.id, label: c\.label\.trim\(\) \}\);/, 'mémorisé au clic');
  assert.match(criteria, /onCancel=\{\(\) => \{\s*setConfirm\(null\);\s*returnFocus\.restore\(\);\s*\}\}/, 'Annuler ou Échap');
  assert.match(criteria, /onConfirm=\{\(\) => \{\s*returnFocus\.forget\(\);\s*if \(confirm\) remove\(confirm\.id\);/, 'supprimé : le focus va à l\'ajout, comme avant');
  assert.match(criteria, /window\.requestAnimationFrame\(\(\) => addButton\.current\?\.focus\(\)\)/);

  const steps = code(read(`${DIR}/InterviewStepsSection.tsx`));
  assert.match(steps, /returnFocus\.remember\(\);\s*setDeleting\(step\);/);
  assert.match(steps, /setDeleting\(null\);\s*returnFocus\.restore\(\(\) => addStepButton\.current\);/, 'repli : « Ajouter une étape »');
  assert.match(steps, /<Button\s+ref=\{addStepButton\}/);
  assert.match(steps, /onDeleted=\{returnFocus\.forget\}/, 'étape supprimée : plus de retour à une corbeille qui disparaît');
  assert.match(code(read(`${DIR}/DeleteStepDialog.tsx`)), /onDeleted\?\.\(\);\s*onClose\(\);/);
  // La confirmation reste une AlertDialog (jamais window.confirm).
  assert.match(code(read(`${DIR}/DeleteStepDialog.tsx`)), /<AlertDialog\b/);
  assert.match(code(read('src/components/missions/v3/panels/ConfirmDeleteDialog.tsx')), /<AlertDialog\b/);
});
