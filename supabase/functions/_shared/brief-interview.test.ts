// Tests du tour de parole du brief vocal guidé : ce que le modèle renvoie est
// validé avant d'atteindre le brief, et l'entrée de la requête est bornée.
//
//   deno test --no-check supabase/functions/_shared/brief-interview.test.ts
//
// Aucun import distant : le test tourne hors réseau.

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  BRIEF_TURN_TOOL,
  TOPICS,
  buildUserContent,
  parseTurnInput,
  sanitizeTurn,
  sanitizeUpdates,
} from './brief-interview.ts';

Deno.test('sanitizeUpdates : valeurs hors liste, hors bornes ou vides écartées', () => {
  const out = sanitizeUpdates({
    title: '  Lead   Developer  ',
    location: '',
    contract_type: 'portage',
    remote_policy: 'hybrid',
    remote_days: 9,
    experience_min: -2,
    seniority: 'senior',
    unknown_field: 'x',
  });
  deepStrictEqual(out, { title: 'Lead Developer', remote_policy: 'hybrid', seniority: 'senior' });
});

Deno.test('sanitizeUpdates : télétravail arrondi, expérience remise dans l\'ordre', () => {
  const out = sanitizeUpdates({ remote_days: 2.4, experience_min: 8, experience_max: 5 });
  strictEqual(out.remote_days, 2);
  strictEqual(out.experience_min, 5);
  strictEqual(out.experience_max, 8);
});

Deno.test('sanitizeUpdates : rémunération, k€ ramenés en euros, plages plausibles seulement', () => {
  deepStrictEqual(
    sanitizeUpdates({ salary_min: 60, salary_max: 70 }),
    { salary_min: 60000, salary_max: 70000, salary_type: 'annual' },
  );
  deepStrictEqual(
    sanitizeUpdates({ salary_min: 70000, salary_max: 60000 }),
    { salary_min: 60000, salary_max: 70000, salary_type: 'annual' },
  );
  // Un tarif journalier lu comme un salaire annuel est écarté, pas écrit faux.
  deepStrictEqual(sanitizeUpdates({ salary_min: 550 }), {});
  deepStrictEqual(sanitizeUpdates({ salary_min: 550, salary_max: 650, salary_type: 'daily' }), {
    salary_min: 550,
    salary_max: 650,
    salary_type: 'daily',
  });
  deepStrictEqual(sanitizeUpdates({ salary_min: 30, salary_type: 'daily' }), {});
});

Deno.test('sanitizeUpdates : compétences nettoyées, sans doublon, bornées', () => {
  const out = sanitizeUpdates({
    skills_must_have: ['React', ' react ', 'Node.js', '', 42, 'x'.repeat(200)],
    skills_nice_to_have: Array.from({ length: 30 }, (_, i) => `Skill ${i}`),
  });
  strictEqual(out.skills_must_have?.length, 3);
  deepStrictEqual(out.skills_must_have?.slice(0, 2), ['React', 'Node.js']);
  strictEqual(out.skills_must_have?.[2].length, 60);
  strictEqual(out.skills_nice_to_have?.length, 12);
});

Deno.test('sanitizeUpdates : critères sans libellé ou sans importance valide écartés', () => {
  const out = sanitizeUpdates({
    criteria: [
      { label: '5 ans de Go en production', importance: 'indispensable', category: 'experience' },
      { label: '5 ans de GO en production', importance: 'bonus' },
      { label: 'Anglais courant', importance: 'critique' },
      { label: '', importance: 'souhaite' },
      { label: 'Aime le travail en équipe', importance: 'souhaite', category: 'autre', description: 'Esprit d\'équipe' },
    ],
  });
  deepStrictEqual(out.criteria, [
    { label: '5 ans de Go en production', importance: 'indispensable', category: 'experience' },
    { label: 'Aime le travail en équipe', importance: 'souhaite', category: 'technical', description: 'Esprit d\'équipe' },
  ]);
});

Deno.test('sanitizeUpdates : langues, entreprises cibles et étapes d\'entretien', () => {
  const out = sanitizeUpdates({
    languages: [{ language: 'Anglais', level: 'courant' }, { language: 'anglais' }, { level: 'natif' }],
    target_companies: [
      { category: 'Concurrents', companies: ['Qonto', 'qonto', 'Alan'] },
      { category: 'Vide', companies: [] },
      { companies: ['Doctolib'] },
    ],
    interview_steps: [
      { name: 'Entretien RH', duration_minutes: 30 },
      { name: 'entretien rh' },
      { name: 'Test technique', duration_minutes: 9999 },
    ],
  });
  deepStrictEqual(out.languages, [{ language: 'Anglais', level: 'courant' }]);
  deepStrictEqual(out.target_companies, [
    { category: 'Concurrents', companies: ['Qonto', 'Alan'] },
    { category: 'Entreprises cibles', companies: ['Doctolib'] },
  ]);
  deepStrictEqual(out.interview_steps, [{ name: 'Entretien RH', duration_minutes: 30 }, { name: 'Test technique' }]);
});

Deno.test('sanitizeUpdates : entrée absurde sans erreur', () => {
  deepStrictEqual(sanitizeUpdates(null), {});
  deepStrictEqual(sanitizeUpdates('texte'), {});
  deepStrictEqual(sanitizeUpdates([1, 2]), {});
  deepStrictEqual(sanitizeUpdates({ criteria: 'non', languages: 3, target_companies: {}, interview_steps: null }), {});
});

Deno.test('sanitizeTurn : une question, pas de tiret long ni de point-virgule', () => {
  const turn = sanitizeTurn({
    updates: { title: 'CTO' },
    next_question: 'Où se situe le poste — ville ou région ; avec télétravail ?',
    next_topic: 'location',
    done: false,
  });
  strictEqual(turn.next_question, 'Où se situe le poste, ville ou région, avec télétravail ?');
  strictEqual(turn.next_topic, 'location');
  strictEqual(turn.done, false);
  deepStrictEqual(turn.updates, { title: 'CTO' });
});

Deno.test('sanitizeTurn : pas de question ou done vrai termine l\'entretien', () => {
  for (const raw of [
    { updates: {}, done: true, next_question: 'Encore ?' },
    { updates: {}, done: false },
    { updates: {}, done: false, next_question: '   ' },
    null,
  ]) {
    const turn = sanitizeTurn(raw);
    strictEqual(turn.done, true);
    strictEqual(turn.next_question, null);
    strictEqual(turn.next_topic, null);
  }
});

Deno.test('sanitizeTurn : sujet inconnu écarté, question gardée', () => {
  const turn = sanitizeTurn({ updates: {}, done: false, next_question: 'Quel budget ?', next_topic: 'budget' });
  strictEqual(turn.next_question, 'Quel budget ?');
  strictEqual(turn.next_topic, null);
});

Deno.test('parseTurnInput : brief obligatoire, sujets et historique bornés', () => {
  strictEqual(parseTurnInput(null), null);
  strictEqual(parseTurnInput({ answer: 'x' }), null);
  strictEqual(parseTurnInput({ brief: [] }), null);

  const input = parseTurnInput({
    brief: { title: 'CTO' },
    topics: [
      { id: 'title', state: 'done' },
      { id: 'inconnu', state: 'done' },
      { id: 'location', state: 'perdu' },
      { id: 'criteria', state: 'todo' },
    ],
    steps: ['Entretien RH', '', 3],
    history: Array.from({ length: 20 }, (_, i) => ({ question: `Q${i}`, answer: `R${i}` })),
    question: '  Où   se situe le poste ?  ',
    answer: '   ',
  });
  ok(input);
  deepStrictEqual(input.topics, [{ id: 'title', state: 'done' }, { id: 'criteria', state: 'todo' }]);
  deepStrictEqual(input.steps, ['Entretien RH']);
  strictEqual(input.history.length, 8);
  strictEqual(input.history[7].question, 'Q19');
  strictEqual(input.answer, null);
  strictEqual(input.question, 'Où se situe le poste ?');
});

Deno.test('parseTurnInput : réponse tronquée à 2 000 caractères', () => {
  const input = parseTurnInput({ brief: {}, answer: 'a'.repeat(5000) });
  strictEqual(input?.answer?.length, 2000);
});

Deno.test('buildUserContent : première question, réponse, question passée', () => {
  const first = buildUserContent({ brief: { title: 'CTO' }, topics: [{ id: 'title', state: 'done' }], steps: [], history: [], answer: null });
  ok(first.includes('c\'est la première question'));
  ok(first.includes('title : fait'));
  ok(first.includes('{"title":"CTO"}'));

  const answered = buildUserContent({ brief: {}, topics: [], steps: ['Test technique'], history: [{ question: 'Où ?', answer: 'Lyon' }], question: 'Télétravail ?', answer: 'Hybride, deux jours' });
  ok(answered.includes('« Hybride, deux jours »'));
  ok(answered.includes('DERNIÈRE QUESTION POSÉE : Télétravail ?'));
  ok(answered.includes('Question : Où ?\nRéponse : Lyon'));
  ok(answered.includes('Test technique'));

  const skipped = buildUserContent({ brief: {}, topics: [], steps: [], history: [{ question: 'Où ?', answer: '' }], question: 'Salaire ?', answer: null });
  ok(skipped.includes('a passé cette question'));
  ok(skipped.includes('Réponse : (passée)'));
});

Deno.test('outil du modèle : sujets et réponse obligatoires', () => {
  const params = BRIEF_TURN_TOOL.function.parameters as {
    required: string[];
    properties: { next_topic: { enum: string[] } };
  };
  deepStrictEqual(params.required, ['updates', 'done']);
  deepStrictEqual(params.properties.next_topic.enum, [...TOPICS]);
});
