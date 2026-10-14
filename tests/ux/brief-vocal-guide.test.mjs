/**
 * Brief vocal guidé (écran Cadrage de la nouvelle page mission) :
 *  - règles pures (briefInterviewModel.ts) : sujets à compléter, fusion d'une
 *    réponse dans job_details, étapes d'entretien, phrases « noté dans le brief » ;
 *  - cohérence avec l'edge function brief-interview : mêmes sujets des deux
 *    côtés, action de crédits déclarée au serveur et au navigateur ;
 *  - gardes statiques : l'edge function suit les conventions (auth, crédits
 *    refusés avant l'appel, passerelle unique vers le modèle).
 *
 * Modules empaquetés par esbuild (alias @/ résolus par tsconfig.app.json).
 * Lancer : node --test tests/ux/brief-vocal-guide.test.mjs
 * Côté serveur : deno test --no-check supabase/functions/_shared/brief-interview.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const M = await load(`${DIR}/briefInterviewModel.ts`);
const SERVER = await load('supabase/functions/_shared/brief-interview.ts');

const ready = { stepCount: 0, stepsAvailable: true, skipped: [] };
const stateOf = (topics, id) => topics.find((t) => t.id === id).state;

// ─── Sujets ─────────────────────────────────────────────────────────────────

test('sujets : un poste vide a tout à compléter, dans l\'ordre de la recherche', () => {
  const topics = M.interviewTopics({}, ready);
  assert.deepEqual(topics.map((t) => t.id), [...M.TOPIC_IDS]);
  assert.ok(topics.every((t) => t.state === 'todo'));
  assert.deepEqual(topics.filter((t) => t.required).map((t) => t.id), ['title', 'location', 'criteria', 'steps', 'scoring']);
  assert.equal(M.firstQuestion(topics).topic, 'title');
});

test('sujets : les mêmes des deux côtés (navigateur et edge function)', () => {
  assert.deepEqual([...M.TOPIC_IDS], [...SERVER.TOPICS]);
  for (const id of M.TOPIC_IDS) assert.ok(M.TOPIC_QUESTIONS[id], `question de repli pour ${id}`);
});

test('sujets : fait, passé, étapes impossibles', () => {
  const jd = {
    title: 'CTO',
    location: 'Lyon',
    evaluation_criteria: [
      { id: 'a', label: 'Go', description: '', category: 'technical', weight: 3 },
      { id: 'b', label: 'Kafka', description: '', category: 'technical', weight: 3 },
    ],
    skills_must_have: ['Go', 'Kafka', 'Docker'],
  };
  const topics = M.interviewTopics(jd, { stepCount: 0, stepsAvailable: false, skipped: ['salary', 'title'] });
  assert.equal(stateOf(topics, 'title'), 'done', 'un sujet fait le reste même passé');
  assert.equal(stateOf(topics, 'location'), 'done');
  assert.equal(stateOf(topics, 'criteria'), 'todo');
  assert.equal(topics.find((t) => t.id === 'criteria').label, '3 critères indispensables (2 sur 3)');
  assert.equal(stateOf(topics, 'steps'), 'skipped', 'étapes illisibles ou non modifiables : pas demandées');
  assert.equal(stateOf(topics, 'scoring'), 'done');
  assert.equal(stateOf(topics, 'skills'), 'done');
  assert.equal(stateOf(topics, 'salary'), 'skipped');
  assert.equal(M.firstQuestion(topics).topic, 'criteria');
});

test('sujets : aucun zéro affiché dans le libellé des critères', () => {
  const topics = M.interviewTopics({}, ready);
  assert.equal(topics.find((t) => t.id === 'criteria').label, '3 critères indispensables');
});

test('sujets : chaque champ compte quand il est rempli', () => {
  const jd = {
    seniority: 'senior',
    target_companies: [{ category: 'Concurrents', companies: [{ name: 'Qonto' }] }],
    salary_max: 90000,
    remote_policy: 'hybrid',
    contract_type: 'cdi',
    languages: [{ language: 'Anglais', level: 'courant' }],
    context: 'Le poste est ouvert pour structurer une équipe de dix développeurs.',
  };
  const topics = M.interviewTopics(jd, { stepCount: 2, stepsAvailable: true, skipped: [] });
  for (const id of ['seniority', 'companies', 'salary', 'remote', 'contract', 'languages', 'context', 'steps']) {
    assert.equal(stateOf(topics, id), 'done', id);
  }
  assert.equal(stateOf(M.interviewTopics({ experience_min: 0 }, ready), 'seniority'), 'done', 'zéro année d\'expérience est une réponse');
});

test('avancement : obligatoires faits ou impossibles, plus rien à demander', () => {
  assert.equal(M.interviewProgress(M.interviewTopics({}, ready)).requiredComplete, false);
  const jd = {
    title: 'CTO',
    location: 'Paris',
    evaluation_criteria: ['a', 'b', 'c'].map((label, i) => ({ id: `${i}`, label, description: '', category: 'technical', weight: 3 })),
    mission_description: 'Piloter la plateforme de paiement et encadrer les équipes techniques.',
  };
  const partial = M.interviewProgress(M.interviewTopics(jd, { stepCount: 1, stepsAvailable: true, skipped: [] }));
  assert.equal(partial.requiredComplete, true);
  assert.equal(partial.nothingLeft, false);
  assert.equal(partial.requiredDone, 5);
  const everySkipped = M.interviewProgress(M.interviewTopics({}, { stepCount: 0, stepsAvailable: true, skipped: [...M.TOPIC_IDS] }));
  assert.equal(everySkipped.nothingLeft, true);
});

// ─── Fusion d'une réponse dans le brief ─────────────────────────────────────

test('fusion : valeurs simples écrites, rien d\'autre touché, rien à écrire = correctif vide', () => {
  assert.deepEqual(M.applyBriefUpdates({ title: 'Dev' }, {}, 1), {});
  const patch = M.applyBriefUpdates(
    { title: 'Dev', location: 'Paris' },
    { title: 'Lead Dev', contract_type: 'cdi', remote_policy: 'hybrid', remote_days: 2, seniority: 'senior', experience_min: 5 },
    1,
  );
  assert.deepEqual(patch, {
    title: 'Lead Dev',
    contract_type: 'cdi',
    remote_policy: 'hybrid',
    remote_days: 2,
    seniority: 'senior',
    experience_min: 5,
  });
});

test('fusion : rémunération avec devise, entreprise dans client', () => {
  const patch = M.applyBriefUpdates({}, { salary_min: 60000, salary_max: 70000, salary_type: 'annual', client_name: 'Acme', client_sector: 'Fintech' }, 1);
  assert.equal(patch.salary_currency, 'EUR');
  assert.equal(patch.salary_min, 60000);
  assert.deepEqual(patch.client, { name: 'Acme', sector: 'Fintech' });
  assert.equal(M.applyBriefUpdates({ salary_currency: 'GBP' }, { salary_min: 50000 }, 1).salary_currency, 'GBP', 'devise déjà choisie gardée');
});

test('fusion : compétences sans doublon, déplacées dans la dernière catégorie citée', () => {
  const jd = { skills_must_have: ['React', 'Node.js'], skills_should_have: ['Docker'], skills_nice_to_have: [] };
  const patch = M.applyBriefUpdates(jd, { skills_must_have: ['docker', 'TypeScript'], skills_nice_to_have: ['react', 'GraphQL'] }, 1);
  assert.deepEqual(patch.skills_must_have, ['Node.js', 'docker', 'TypeScript']);
  assert.deepEqual(patch.skills_should_have, []);
  assert.deepEqual(patch.skills_nice_to_have, ['react', 'GraphQL']);
  assert.deepEqual(M.applyBriefUpdates(jd, { skills_must_have: ['REACT'] }, 1), {}, 'déjà là : rien à écrire');
});

test('fusion : critères ajoutés, importance mise à jour sans doublon', () => {
  const jd = {
    evaluation_criteria: [{ id: 'old', label: '5 ans de Go', description: '', category: 'technical', weight: 2 }],
  };
  const patch = M.applyBriefUpdates(
    jd,
    {
      criteria: [
        { label: '5 ans de GO', importance: 'indispensable', category: 'experience' },
        { label: 'Anglais courant', importance: 'bonus', category: 'soft_skill', description: 'Échanges avec les équipes de Londres' },
      ],
    },
    42,
  );
  assert.equal(patch.evaluation_criteria.length, 2);
  assert.equal(patch.evaluation_criteria[0].id, 'old');
  assert.equal(patch.evaluation_criteria[0].weight, 3, 'passé en indispensable');
  assert.deepEqual(patch.evaluation_criteria[1], {
    id: 'criterion-42-2',
    label: 'Anglais courant',
    description: 'Échanges avec les équipes de Londres',
    category: 'soft_skill',
    weight: 1,
  });
  assert.equal(M.applyBriefUpdates(jd, { criteria: [{ label: '5 ans de go', importance: 'souhaite', category: 'technical' }] }, 1).evaluation_criteria, undefined);
});

test('fusion : trois critères indispensables dits en une réponse font passer le repère', () => {
  const patch = M.applyBriefUpdates(
    {},
    {
      criteria: ['Go en production', 'Architecture distribuée', 'Encadrement de 5 personnes'].map((label) => ({
        label,
        importance: 'indispensable',
        category: 'technical',
      })),
    },
    7,
  );
  const topics = M.interviewTopics(patch, ready);
  assert.equal(stateOf(topics, 'criteria'), 'done');
});

test('fusion : langues et entreprises cibles enrichies, jamais remplacées', () => {
  const jd = {
    languages: [{ language: 'Anglais', level: 'intermédiaire' }],
    target_companies: [{ category: 'Concurrents', companies: [{ name: 'Qonto' }] }],
  };
  const patch = M.applyBriefUpdates(
    jd,
    {
      languages: [{ language: 'anglais', level: 'courant' }, { language: 'Allemand', level: '' }],
      target_companies: [
        { category: 'concurrents', companies: ['qonto', 'Alan'] },
        { category: 'Scale-ups', companies: ['Doctolib'] },
      ],
    },
    1,
  );
  assert.deepEqual(patch.languages, [{ language: 'Anglais', level: 'courant' }, { language: 'Allemand', level: '' }]);
  assert.deepEqual(patch.target_companies, [
    { category: 'Concurrents', companies: [{ name: 'Qonto' }, { name: 'Alan' }] },
    { category: 'Scale-ups', companies: [{ name: 'Doctolib' }] },
  ]);
});

test('fusion : le brief d\'origine n\'est jamais modifié sur place', () => {
  const jd = { skills_must_have: ['React'], evaluation_criteria: [], languages: [], target_companies: [{ category: 'A', companies: [{ name: 'X' }] }] };
  const before = JSON.stringify(jd);
  M.applyBriefUpdates(jd, {
    skills_nice_to_have: ['React', 'Vue'],
    criteria: [{ label: 'x', importance: 'bonus', category: 'technical' }],
    languages: [{ language: 'fr', level: '' }],
    target_companies: [{ category: 'a', companies: ['Y'] }],
  }, 1);
  assert.equal(JSON.stringify(jd), before);
});

// ─── Étapes d'entretien et textes ───────────────────────────────────────────

test('étapes : seulement celles qui n\'existent pas déjà', () => {
  const steps = M.newInterviewSteps(
    { interview_steps: [{ name: 'Entretien RH', duration_minutes: 30 }, { name: 'test technique' }, { name: 'Entretien final' }] },
    ['entretien rh', 'Test Technique'],
  );
  assert.deepEqual(steps, [{ name: 'Entretien final' }]);
  assert.deepEqual(M.newInterviewSteps({}, []), []);
});

test('texte libre : les réponses s\'ajoutent, ligne vide entre deux', () => {
  assert.equal(M.appendAnswers(undefined, ['Lyon']), 'Lyon');
  assert.equal(M.appendAnswers('Offre importée', [' Hybride ', '']), 'Offre importée\n\nHybride');
});

test('« noté dans le brief » : phrases courtes, sans tiret long ni zéro', () => {
  const lines = M.describeUpdates(
    {
      title: 'CTO',
      location: 'Lyon',
      contract_type: 'freelance',
      remote_policy: 'hybrid',
      remote_days: 2,
      seniority: 'senior',
      experience_min: 8,
      salary_min: 60000,
      salary_max: 70000,
      client_name: 'Acme',
      client_sector: 'Fintech',
      skills_must_have: ['Go', 'Kafka'],
      criteria: [{ label: 'Go en production', importance: 'indispensable', category: 'technical' }],
      languages: [{ language: 'Anglais', level: 'courant' }],
      target_companies: [{ category: 'Concurrents', companies: ['Qonto', 'Alan'] }],
      mission_description: 'Piloter la plateforme.',
    },
    [{ name: 'Entretien RH', duration_minutes: 30 }],
  );
  assert.deepEqual(lines, [
    'Intitulé : CTO',
    'Lieu : Lyon',
    'Contrat : Indépendant',
    'Télétravail : Hybride, 2 j par semaine',
    'Expérience : senior, 8 ans et plus',
    'Rémunération : 60 k€ à 70 k€ brut par an',
    'Entreprise : Acme (Fintech)',
    'Compétences indispensables : Go, Kafka',
    'Critère indispensable : Go en production',
    'Langues : Anglais (courant)',
    'Entreprises cibles : Qonto, Alan',
    "Étape d'entretien : Entretien RH (30 min)",
    'Description des missions',
  ]);
  assert.ok(lines.every((l) => !l.includes('—') && !l.includes(';')));
  assert.deepEqual(M.describeUpdates({}), []);
  assert.deepEqual(M.describeUpdates({ salary_min: 550, salary_max: 650, salary_type: 'daily' }), ['Rémunération : 550 € à 650 € par jour']);
  assert.deepEqual(M.describeUpdates({ salary_min: 55000 }), ['Rémunération : À partir de 55 k€ brut par an']);
});

test('résumé envoyé au modèle : borné, sans champ vide', () => {
  const payload = M.briefPayload({
    title: ' CTO ',
    location: '',
    skills_must_have: [],
    context: 'x'.repeat(900),
    evaluation_criteria: [
      { id: '1', label: 'Go', description: '', category: 'technical', weight: 3 },
      { id: '2', label: '', description: '', category: 'technical', weight: 3 },
    ],
    raw_brief: 'texte brut jamais envoyé',
    voice_transcript: 'idem',
  });
  assert.equal(payload.title, 'CTO');
  assert.equal('location' in payload, false);
  assert.equal('skills_must_have' in payload, false);
  assert.equal(payload.context.length, 400);
  assert.deepEqual(payload.criteria, [{ label: 'Go', importance: 'indispensable' }]);
  assert.equal('raw_brief' in payload, false);
  assert.equal('voice_transcript' in payload, false);
});

// ─── Gardes statiques ───────────────────────────────────────────────────────

test('crédits : l\'action existe au serveur et au navigateur, modèle rapide, plancher d\'un crédit', () => {
  const server = read('supabase/functions/_shared/ai-config.ts');
  const client = read('src/types/aiCredits.ts');
  assert.match(server, /brief_interview: \{\s+action: "brief_interview",[\s\S]*?floor: 1,[\s\S]*?routingTier: "fast",/);
  assert.match(client, /brief_interview: \{ action: "brief_interview",[^}]*floor: 1,[^}]*routingTier: "fast"/);
});

test('edge function : auth, crédits refusés avant l\'appel, passerelle unique vers le modèle, débit après', () => {
  const fn = code(read('supabase/functions/brief-interview/index.ts'));
  assert.match(fn, /requireAuth\(req, corsHeaders\)/);
  assert.match(fn, /check_rate_limit/);
  const guard = fn.indexOf('assertCredits(');
  const call = fn.indexOf('callClaudeCompat({');
  const settle = fn.indexOf('settleCredits(svc');
  assert.ok(guard > 0 && call > guard && settle > call, 'garde, puis appel, puis débit');
  assert.match(fn, /if \(!gate\.ok\) return creditGateResponse\(gate, corsHeaders\);/);
  assert.doesNotMatch(fn, /api\.anthropic\.com/, 'jamais d\'appel direct : passerelle call-claude');
  assert.match(fn, /sanitizeTurn\(result\.toolCall\.input\)/, 'sortie du modèle toujours validée');
  assert.match(fn, /tool_choice: \{ type: "function", function: \{ name: BRIEF_TURN_TOOL\.function\.name \} \}/);
  // Rien n'est écrit en base ici : le navigateur fusionne par l'enregistrement du brief.
  assert.doesNotMatch(fn, /\.from\(["']/, 'aucune lecture ni écriture de table');
});

test('fenêtre : appel avec crédits, erreur de crédits sans second message, étapes sans collision de rang', () => {
  const dialog = code(read(`${DIR}/BriefInterviewDialog.tsx`));
  assert.match(dialog, /invokeWithCredits<TurnResponse>\(\s*'brief-interview',\s*'brief_interview'/);
  assert.match(dialog, /if \(!isInsufficientCreditsError\(error\)\) \{/);
  const screen = code(read(`${DIR}/CadrageScreen.tsx`));
  assert.match(screen, /step_order: order/, 'rang explicite');
  assert.match(screen, /onAddSteps=\{canEditProcess \? addInterviewSteps : undefined\}/, 'étapes seulement si le process est modifiable');
  assert.match(screen, /stepNames=\{steps\.map\(\(s\) => s\.name\)\}/);
});

test('fenêtre : le bouton du bandeau n\'existe que si le brief est modifiable', () => {
  const readiness = code(read(`${DIR}/CadrageReadiness.tsx`));
  assert.match(readiness, /\{canDictate && \(\s*<Button[\s\S]*?Brief vocal/);
  assert.match(readiness, /\{canDictate && \(\s*<BriefInterviewDialog/);
});

// ─── Présentation de la fenêtre : règles pures ──────────────────────────────

test('question : l\'exemple « par exemple » est séparé, rien d\'autre ne l\'est', () => {
  assert.deepEqual(
    M.splitQuestion('Où se situe le poste ? (par exemple : Lyon, ou Paris avec deux jours de télétravail)'),
    { question: 'Où se situe le poste ?', hint: 'Par exemple : Lyon, ou Paris avec deux jours de télétravail' },
  );
  assert.deepEqual(M.splitQuestion('  Quel est l\'intitulé exact du poste ?  '), { question: 'Quel est l\'intitulé exact du poste ?', hint: null });
  // Une parenthèse qui n'est pas un exemple reste dans la question.
  assert.deepEqual(M.splitQuestion('Quelle équipe (la vôtre) ?'), { question: 'Quelle équipe (la vôtre) ?', hint: null });
  // Toutes les questions de repli se découpent sans parenthèse restante.
  for (const [id, text] of Object.entries(M.TOPIC_QUESTIONS)) {
    const { question, hint } = M.splitQuestion(text);
    assert.ok(!question.includes('('), `${id} : parenthèse restante dans la question`);
    assert.ok(hint === null || /^Par exemple/.test(hint), `${id} : exemple mal formé`);
  }
});

test('le poste : seulement ce qui est renseigné, jamais de zéro ni de champ vide', () => {
  assert.deepEqual(M.briefRecapRows({}, []), []);
  // Valeurs null venues de la base : aucune ligne, aucun « 0 ».
  const rows = M.briefRecapRows(
    { salary_min: null, salary_max: null, experience_min: null, experience_max: null, remote_days: null, title: '   ' },
    [],
  );
  assert.deepEqual(rows, []);
  const all = JSON.stringify(M.briefRecapRows({ experience_min: 0, remote_policy: 'hybrid', remote_days: 0 }, []));
  assert.match(all, /débutant accepté/, 'zéro année d\'expérience est une vraie réponse, écrite en mots');
  assert.doesNotMatch(all, /0 ans|0 j par semaine/, 'aucun zéro affiché');
  assert.deepEqual(M.describeUpdates({ experience_min: 0, experience_max: 3 }), ["Expérience : jusqu'à 3 ans"]);
});

test('le poste : critères avec importance, précision avant trois, étapes et listes', () => {
  const crit = (label, weight) => ({ id: label, label, description: '', category: 'technical', weight });
  const two = M.briefRecapRows({ evaluation_criteria: [crit('Go', 3), crit('Kafka', 3), crit('Anglais', 1)] }, ['Entretien RH']);
  const criteria = two.find((r) => r.id === 'criteria');
  assert.deepEqual(criteria.items, [
    { text: 'Go', note: 'indispensable' },
    { text: 'Kafka', note: 'indispensable' },
    { text: 'Anglais', note: 'bonus' },
  ]);
  assert.equal(criteria.hint, '2 sur 3 critères indispensables');
  assert.deepEqual(two.find((r) => r.id === 'steps').chips, ['Entretien RH']);
  const three = M.briefRecapRows({ evaluation_criteria: [crit('A', 3), crit('B', 3), crit('C', 3)] }, []);
  assert.equal(three.find((r) => r.id === 'criteria').hint, undefined, 'plus de précision à trois');
  const text = JSON.stringify(M.briefRecapRows({ title: 'CTO', location: 'Lyon', skills_must_have: ['Go'], languages: [{ language: 'Anglais', level: 'courant' }] }, []));
  assert.ok(!text.includes('—') && !text.includes(';') && !/[A-Za-zÀ-ÿ]\(s\)/.test(text));
});

test('lignes notées : chaque phrase de describeUpdates retrouve sa ligne du poste', () => {
  assert.deepEqual(
    [...M.freshRowIds(['Lieu : Lyon', 'Critère indispensable : 5 ans de Go', "Étape d'entretien : Entretien RH (30 min)", 'Contexte du poste'])].sort(),
    ['context', 'criteria', 'location', 'steps'],
  );
  assert.equal(M.freshRowIds([]).size, 0);
  // Cohérence : aucune dérive entre les libellés écrits d'un côté et lus de l'autre.
  const updates = {
    title: 'CTO',
    location: 'Lyon',
    contract_type: 'cdi',
    remote_policy: 'hybrid',
    remote_days: 2,
    seniority: 'senior',
    experience_min: 8,
    salary_min: 60000,
    salary_max: 70000,
    start_date: 'Dès que possible',
    mission_description: 'Piloter la plateforme.',
    context: 'Le poste est ouvert pour structurer une équipe de dix personnes.',
    client_name: 'Acme',
    client_sector: 'Fintech',
    skills_must_have: ['Go'],
    skills_should_have: ['Kafka'],
    skills_nice_to_have: ['Rust'],
    skills_to_avoid: ['PHP'],
    criteria: [
      { label: 'Go en production', importance: 'indispensable', category: 'technical' },
      { label: 'Aime le contact', importance: 'souhaite', category: 'soft_skill' },
      { label: 'Anglais', importance: 'bonus', category: 'soft_skill' },
    ],
    languages: [{ language: 'Anglais', level: 'courant' }],
    target_companies: [{ category: 'Concurrents', companies: ['Qonto'] }],
    interview_steps: [{ name: 'Entretien RH', duration_minutes: 30 }],
  };
  const merged = { ...M.applyBriefUpdates({}, updates, 1) };
  const rowIds = new Set(M.briefRecapRows(merged, ['Entretien RH']).map((r) => r.id));
  for (const line of M.describeUpdates(updates)) {
    const ids = [...M.freshRowIds([line])];
    assert.ok(ids.length > 0, `« ${line} » ne retrouve aucune ligne du poste`);
    for (const id of ids) assert.ok(rowIds.has(id), `« ${line} » : la ligne « ${id} » n'existe pas dans le poste`);
  }
});

// ─── Présentation de la fenêtre : gardes statiques ──────────────────────────

test('fenêtre : un seul plein à tout instant, écrit en ternaires, jamais deux variant="primary" littéraux', () => {
  const dialog = code(read(`${DIR}/BriefInterviewDialog.tsx`));
  assert.match(dialog, /startVariant=\{hasAnswer \? 'secondary' : 'primary'\}/);
  assert.match(dialog, /variant=\{sendIsMain \? 'primary' : 'secondary'\}/);
  assert.match(dialog, /const sendIsMain = hasAnswer && !listening;/);
  assert.match(dialog, /variant=\{ready \? 'primary' : 'secondary'\}/, 'fin : plein seulement quand le bandeau dit « Poste prêt »');
  const literal = (src) => (src.match(/variant="primary"/g) ?? []).length;
  assert.equal(literal(dialog), 0);
  assert.equal(literal(code(read(`${DIR}/BriefRecapPanel.tsx`))), 0);
  // Plus de rouge plein ni de pulsation dans cette fenêtre : le point d'écoute est fixe.
  assert.doesNotMatch(dialog, /animate-pulse|animate-ping|variant="destructive"[\s\S]{0,40}Arrêter/);
});

test('fenêtre : trois bandes, deux colonnes dès md, hauteur fixe, confirmation d\'un brouillon', () => {
  const dialog = code(read(`${DIR}/BriefInterviewDialog.tsx`));
  assert.match(dialog, /overflow-hidden p-0 sm:h-\[min\(34rem,90dvh\)\]/);
  assert.match(dialog, /grid-cols-\[minmax\(0,1fr\)\] grid-rows-\[minmax\(0,1fr\)\] md:grid-cols-\[minmax\(0,1fr\)_16rem\]/, 'colonne contrainte sur téléphone');
  assert.match(dialog, /max-sm:\[&>button:last-child\]:min-h-11/, 'croix à 44 px sans toucher la primitive');
  assert.match(dialog, /onInteractOutside=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(dialog, /<AlertDialog open=\{leaving\}/);
  assert.match(dialog, /if \(!next && guardRef\.current\.busy\) \{/, 'pas de fermeture pendant l\'envoi');
  assert.match(dialog, /if \(!next && guardRef\.current\.draft\) \{/, 'pas de réponse jetée en silence');
  assert.match(dialog, /readOnly=\{listening \|\| thinking\}/, 'jamais disabled : le texte reste lisible');
  assert.match(dialog, /aria-labelledby=\{qid\}/);
  assert.match(dialog, /<div role="status" aria-live="polite" className="sr-only">/);
  assert.doesNotMatch(dialog, /TopicList|Terminer/, 'plus de liste des 13 sujets ni de « Terminer » orphelin');
  // Le lien de la colonne ne double pas le bouton du pied à l'écran de fin.
  assert.match(dialog, /const posteContinue = phase === 'done' \? undefined : leaveToSourcing;/);
});

test('fenêtre : l\'anneau et l\'enregistrement sont ceux du bandeau', () => {
  const readiness = code(read(`${DIR}/CadrageReadiness.tsx`));
  assert.match(readiness, /ring=\{<ProgressRing done=\{done\} total=\{total\} ready=\{status === 'ready'\} \/>\}/);
  assert.match(readiness, /saveStatus=\{saveStatus\}/);
  assert.match(readiness, /onRetrySave=\{onRetry\}/);
  assert.doesNotMatch(readiness, /export function ProgressRing/, 'l\'anneau reste local au bandeau');
  const dialog = code(read(`${DIR}/BriefInterviewDialog.tsx`));
  assert.match(dialog, /cadrageReadiness\(jd, stepNames\.length, stepsState\)/, 'même calcul que la page derrière la fenêtre');
});

test('colonne du poste : région nommée, lignes en liste de définitions, badge « Noté »', () => {
  const panel = code(read(`${DIR}/BriefRecapPanel.tsx`));
  assert.match(panel, /<aside aria-label="Le poste" className="hidden [^"]*md:flex">/);
  assert.match(panel, /<dl className="divide-y divide-border">/);
  assert.match(panel, /<Badge variant="brand">Noté<\/Badge>/);
  assert.match(panel, /data-fresh=\{fresh \|\| undefined\}/);
  assert.match(panel, /className="md:hidden"/, 'la ligne repliée ne double pas la colonne');
  assert.doesNotMatch(panel, /bg-card|bg-muted/, 'creux en bg-background, jamais une carte');
});

test('micro en barre : seulement la commande, le texte provisoire sort vers la zone de réponse', () => {
  const dictation = code(read('src/components/missions/VoiceDictation.tsx'));
  assert.match(dictation, /layout\?: 'stack' \| 'bar';/);
  assert.match(dictation, /variant\?: 'default' \| 'mission-v3';/, 'l\'union reste à deux membres');
  const barAt = dictation.indexOf('if (bar) {');
  const v3At = dictation.indexOf('if (v3) {');
  assert.ok(barAt > 0 && v3At > barAt, 'la branche « bar » précède la branche v3 (que les tests lisent à partir de là)');
  const barBranch = dictation.slice(barAt, v3At);
  assert.match(barBranch, /variant=\{startVariant\}/);
  assert.doesNotMatch(barBranch, /animate-ping|animate-pulse|variant="destructive"|italic|uppercase/);
  assert.match(dictation, /onInterimRef\.current\?\.\(transcript\)/);
  assert.match(dictation, /if \(keepPartialRef\.current && socketRef\.current\) socketRef\.current\.onmessage = null;/);
});
