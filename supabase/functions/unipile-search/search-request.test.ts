// Requête de recherche à plat (navigateur, agent de sourcing, run-agent-search) vers la requête de la licence.
// Pure : aucun réseau.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/search-request.test.ts

import { deepStrictEqual, ok, throws } from 'node:assert';
import { compileSearchRequest } from './search-request.ts';
import { UnipileInputError } from './responses.ts';

const run = (params: Record<string, unknown>) => compileSearchRequest({ category: 'people', ...params });
const body = (params: Record<string, unknown>) => run(params).compiled.body;
const droppedNames = (params: Record<string, unknown>) => run(params).dropped.map((d) => d.filter).sort();

function inputError(params: Record<string, unknown>): UnipileInputError {
  try {
    run(params);
  } catch (error) {
    if (error instanceof UnipileInputError) return error;
    throw error;
  }
  throw new Error('une UnipileInputError était attendue');
}

Deno.test('Recruiter : entreprises incluses, exclues et par mots-clés gardent leur priorité et leur périmètre', () => {
  const out = run({
    api: 'recruiter',
    company: { include: ['100', '200'], exclude: ['300'] },
    company_keywords: [{ keywords: 'Client actuel', priority: 'DOESNT_HAVE', scope: 'CURRENT' }],
  });
  deepStrictEqual(out.compiled.segments, ['linkedin', 'recruiter', 'search', 'people']);
  deepStrictEqual(out.compiled.body.company, [
    { name: '100', id: '100', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: '200', id: '200', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: '300', id: '300', priority: 'DOESNT_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: 'Client actuel', priority: 'DOESNT_HAVE', preferences: 'CURRENT' },
  ]);
});

Deno.test('Recruiter : entreprises mêlées, l\'entrée par mots-clés d\'un tableau passe en entreprise nommée sans modifier la requête', () => {
  const params = {
    api: 'recruiter',
    company: [
      { id: '100', priority: 'MUST_HAVE', scope: 'PAST', name: 'Compagnie A' },
      { id: '200', priority: 'CAN_HAVE', scope: 'CURRENT' },
      { id: '300', priority: 'DOESNT_HAVE', scope: 'PAST_NOT_CURRENT' },
      { keywords: '"Conseil (France)"', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    ],
    company_keywords: [{ keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT' }],
  };
  const original = structuredClone(params);
  const out = body(params);
  deepStrictEqual(out.current_company, [{ id: '200', priority: 'CAN_HAVE' }]);
  deepStrictEqual(out.company, [
    { name: 'Compagnie A', id: '100', priority: 'MUST_HAVE', preferences: 'PAST' },
    { name: '300', id: '300', priority: 'DOESNT_HAVE', preferences: 'PAST_NOT_CURRENT' },
    { name: 'Client', priority: 'DOESNT_HAVE', preferences: 'CURRENT' },
    { name: '"Conseil (France)"', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
  ]);
  deepStrictEqual(params, original);
});

Deno.test('entreprises : Classic et Sales Navigator gardent leur forme native, une exclusion Classic est signalée', () => {
  deepStrictEqual(body({ api: 'classic', company: ['100', '200'] }).current_company, ['100', '200']);
  deepStrictEqual(body({ api: 'sales_navigator', company: { include: ['100', '200'], exclude: ['300'] } }).current_company, {
    include: ['100', '200'],
    exclude: ['300'],
  });
  deepStrictEqual(droppedNames({ api: 'classic', company: { include: ['1'], exclude: ['2'] } }), ['company']);
});

Deno.test('entreprises passées : alternatives, exclusions et priorités explicites', () => {
  for (const past_company of [['100', '200'], { include: ['100', '200'], exclude: ['300'] }]) {
    deepStrictEqual(body({ api: 'recruiter', past_company }).past_company, [
      { id: '100', priority: 'CAN_HAVE' },
      { id: '200', priority: 'CAN_HAVE' },
      ...(Array.isArray(past_company) ? [] : [{ id: '300', priority: 'DOESNT_HAVE' }]),
    ]);
  }
  const explicit = [{ id: '100', priority: 'MUST_HAVE' }, { id: '300', priority: 'DOESNT_HAVE' }];
  deepStrictEqual(body({ api: 'recruiter', past_company: explicit }).past_company, explicit);
});

Deno.test('mots-clés : Classic et Sales Navigator refusent plus de 200 caractères avant tout appel', () => {
  for (const api of ['classic', 'sales_navigator']) {
    const keywords = 'Engineer '.repeat(24) + 'NOT "Client actuel"';
    const error = inputError({ api, keywords });
    deepStrictEqual(error.status, 400);
    deepStrictEqual(error.code, 'KEYWORDS_TOO_LONG');
    ok(error.message.includes(String(keywords.length)) && error.message.includes('200'));
  }
  const exact = 'a'.repeat(200);
  for (const api of ['classic', 'sales_navigator']) deepStrictEqual(body({ api, keywords: exact }).keywords, exact);
});

Deno.test('mots-clés : les requêtes booléennes valides ne sont pas réécrites, l\'espace extérieur seul est retiré', () => {
  const queries = [
    '("Solution (Cloud) Engineer" OR "Sales AND support") AND NOT "Client actuel"',
    'NOT "Client actuel"', 'Python AND (Java OR Go)', '"OR" AND "NOT"', '"Ingénieur 🚀" OR "Data (R&D)"',
    'Research and development', 'head of sales or',
  ];
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    for (const keywords of queries) deepStrictEqual(body({ api, keywords }).keywords, keywords, `${api} : ${keywords}`);
    deepStrictEqual(body({ api, keywords: `  ${queries[0]}  ` }).keywords, queries[0]);
  }
  for (const api of ['classic', 'sales_navigator', 'recruiter']) deepStrictEqual(body({ api, company: ['100'] }).keywords, undefined);
});

Deno.test('mots-clés : Recruiter garde une requête longue, y compris celles d\'entreprise et de poste', () => {
  const keywords = '("Solution Engineer" OR "Sales Engineer") AND ' + 'Cloud '.repeat(80) + 'NOT "Client actuel"';
  const out = body({
    api: 'recruiter', keywords,
    company_keywords: [{ keywords, priority: 'DOESNT_HAVE', scope: 'PAST' }],
    role: [{ keywords, priority: 'MUST_HAVE', scope: 'CURRENT' }],
  });
  deepStrictEqual(out.keywords, keywords);
  deepStrictEqual((out.company as Array<Record<string, unknown>>)[0].name, keywords);
  deepStrictEqual((out.job_title as Array<Record<string, unknown>>)[0].name, keywords);
});

Deno.test('requêtes booléennes incomplètes : 400 INVALID_BOOLEAN_QUERY, jamais réparées', () => {
  for (const keywords of ['Python AND', '"Solution Engineer', '(Python OR Java', 'Python OR Java)', 'Python AND (Java OR)', 'Python AND (OR Java)']) {
    for (const api of ['classic', 'sales_navigator', 'recruiter']) {
      const error = inputError({ api, keywords });
      deepStrictEqual(error.status, 400, `${api} : ${keywords}`);
      deepStrictEqual(error.code, 'INVALID_BOOLEAN_QUERY');
      ok(/[Gg]uillemet|[Pp]arenthèse|[Oo]pérateur/.test(error.message));
    }
  }
});

Deno.test('Recruiter : les mots-clés d\'entreprise, de rôle et de poste invalides sont refusés sur chaque chemin', () => {
  for (const params of [
    { company_keywords: [{ keywords: 'Client AND', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] },
    { company: [{ keywords: '(Client', priority: 'DOESNT_HAVE', scope: 'PAST' }] },
    { role: [{ keywords: 'Engineer OR', priority: 'CAN_HAVE', scope: 'CURRENT' }] },
    { job_title: [{ keywords: '(Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] },
    { skills: [{ keywords: 'Go AND', priority: 'MUST_HAVE' }] },
  ]) {
    deepStrictEqual(inputError({ api: 'recruiter', keywords: 'Engineer', ...params }).code, 'INVALID_BOOLEAN_QUERY');
  }
});

Deno.test('Recruiter : identifiants de poste, rôles par mots-clés et postes passés partagent un seul filtre', () => {
  const out = body({
    api: 'recruiter',
    job_title: [
      { id: '100', name: 'Ingénieur', priority: 'CAN_HAVE', scope: 'CURRENT', is_selection: true },
      { keywords: '"Solution (Cloud) Engineer"', priority: 'MUST_HAVE', scope: 'CURRENT' },
    ],
    role: [{ keywords: 'NOT "Sales AND support"', priority: 'DOESNT_HAVE', scope: 'PAST' }],
    past_job_title: [{ id: '200', priority: 'DOESNT_HAVE' }],
  });
  deepStrictEqual(out.job_title, [
    { name: 'Ingénieur', id: '100', priority: 'CAN_HAVE', preferences: 'CURRENT' },
    { name: '"Solution (Cloud) Engineer"', priority: 'MUST_HAVE', preferences: 'CURRENT' },
    { name: 'NOT "Sales AND support"', priority: 'DOESNT_HAVE', preferences: 'PAST' },
    { name: '200', id: '200', priority: 'DOESNT_HAVE', preferences: 'PAST' },
  ]);
});

Deno.test('écoles Recruiter : CAN_HAVE de la requête à plat est une inclusion, DOESNT_HAVE reste une exclusion', () => {
  deepStrictEqual(
    body({ api: 'recruiter', school: [{ id: '1', priority: 'CAN_HAVE' }, { id: '2', priority: 'DOESNT_HAVE' }] }).school,
    [{ id: '1', priority: 'CAN_HAVE' }, { id: '2', priority: 'DOESNT_HAVE' }],
  );
  deepStrictEqual(body({ api: 'classic', school: ['1', '2'] }).school, ['1', '2']);
  deepStrictEqual(body({ api: 'sales_navigator', school: ['1'] }).school, { include: ['1'] });
});

Deno.test('lieux : Recruiter garde priorité et périmètre, les deux autres licences des identifiants', () => {
  deepStrictEqual(body({ api: 'recruiter', location: [{ id: '106383538', name: 'Paris', priority: 'MUST_HAVE', scope: 'CURRENT' }] }).location, [
    { id: '106383538', priority: 'MUST_HAVE', preferences: 'CURRENT' },
  ]);
  deepStrictEqual(body({ api: 'classic', location: ['1', '2'] }).location, ['1', '2']);
  deepStrictEqual(body({ api: 'sales_navigator', location: ['1'] }).location, { include: ['1'] });
  deepStrictEqual(droppedNames({ api: 'recruiter', location: [{ id: '1' }], location_within_area: 35 }), ['location_within_area']);
});

Deno.test('filtres que la licence n\'appliquait pas : ignorés et signalés, jamais appliqués en silence', () => {
  deepStrictEqual(droppedNames({ api: 'sales_navigator', role: [{ keywords: 'Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }], skills: [{ id: '1' }] }), ['role', 'skills']);
  deepStrictEqual(body({ api: 'sales_navigator', role: [{ keywords: 'Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] }).current_job_title, undefined);
  deepStrictEqual(droppedNames({ api: 'classic', job_title: [{ id: '1', name: 'X' }], function: ['3'], seniority: ['senior'] }), ['function', 'job_title', 'seniority']);
  deepStrictEqual(droppedNames({ api: 'recruiter', open_to: ['proBono'], company_type: ['C'] }), ['company_type', 'open_to']);
  deepStrictEqual(droppedNames({ api: 'recruiter', function: { include: ['3'], exclude: ['4'] } }), ['function']);
  deepStrictEqual(body({ api: 'recruiter', function: { include: ['3'], exclude: ['4'] } }).job_function, ['3']);
});

Deno.test('libellés français du signalement', () => {
  const dropped = run({ api: 'classic', skills: [{ id: '1' }] }).dropped;
  deepStrictEqual(dropped.map((d) => d.label), ['Compétences']);
});

Deno.test('activité de recrutement : le choix par défaut n\'est pas signalé hors Recruiter et reste appliqué en Recruiter', () => {
  const activity = [{ id: 'messages', priority: 'DOESNT_HAVE', timespan: 90 }];
  deepStrictEqual(droppedNames({ api: 'classic', recruiting_activity: activity }), []);
  deepStrictEqual(droppedNames({ api: 'sales_navigator', recruiting_activity: activity }), []);
  deepStrictEqual(body({ api: 'recruiter', recruiting_activity: activity }).recruiting_activity, [
    { type: 'messages', priority: 'DOESNT_HAVE', preferences: 'PAST_3_MONTHS' },
  ]);
  deepStrictEqual(body({ api: 'recruiter', recruiting_activity: [{ id: 'notes', priority: 'MUST_HAVE', timespan: 3650 }] }).recruiting_activity, [
    { type: 'notes', priority: 'MUST_HAVE', preferences: 'ANYTIME' },
  ]);
  // Un choix explicite hors Recruiter est signalé.
  deepStrictEqual(droppedNames({ api: 'classic', recruiting_activity: [{ id: 'notes', priority: 'MUST_HAVE', timespan: 30 }] }), ['activity_notes']);
});

Deno.test('étiquettes : sans leurs identifiants elles ne sont pas applicables et le sont avec', () => {
  const activity = [{ id: 'tags', priority: 'MUST_HAVE', timespan: 3650 }];
  deepStrictEqual(droppedNames({ api: 'recruiter', recruiting_activity: activity }), ['tags']);
  deepStrictEqual(body({ api: 'recruiter', recruiting_activity: activity, tags: ['t1', 't2'] }).tags, { include: ['t1', 't2'] });
});

Deno.test('Recruiter : plusieurs spotlights valides, les inconnus écartés', () => {
  deepStrictEqual(
    body({ api: 'recruiter', open_to_work: true, spotlights: ['ACTIVE_TALENT', 'REDISCOVERED_CANDIDATES', 'INVENTED'], spotlight: 'ACTIVE_TALENT' }).spotlights,
    ['ACTIVE_TALENT', 'REDISCOVERED_CANDIDATES', 'OPEN_TO_WORK'],
  );
  deepStrictEqual(body({ api: 'recruiter', spotlights: ['OPEN_TO_WORK'] }).spotlights, ['OPEN_TO_WORK']);
  deepStrictEqual(droppedNames({ api: 'sales_navigator', spotlights: ['OPEN_TO_WORK'] }), ['spotlight']);
});

Deno.test('durées : Recruiter lit years_of_experience puis tenure[0], Sales Navigator tenure puis years_of_experience', () => {
  deepStrictEqual(body({ api: 'recruiter', years_of_experience: { min: 3, max: 8 } }).years_of_experience, { min: 3, max: 8 });
  deepStrictEqual(body({ api: 'recruiter', tenure: [{ min: 2, max: 4 }] }).years_of_experience, { min: 2, max: 4 });
  deepStrictEqual(body({ api: 'sales_navigator', tenure: [{ min: 3, max: 5 }] }).years_of_experience, [{ min: 3, max: 5 }]);
  deepStrictEqual(body({ api: 'sales_navigator', years_of_experience: { min: 6 } }).years_of_experience, [{ min: 6 }]);
  deepStrictEqual(body({ api: 'recruiter', tenure_at_company: [{ min: 1, max: 3 }], tenure_at_role: [{ min: 0, max: 2 }] }).years_in_current_company, { min: 1, max: 3 });
  deepStrictEqual(body({ api: 'recruiter', tenure_in_company: { min: 1, max: 3 } }).years_in_current_company, { min: 1, max: 3 });
  deepStrictEqual(body({ api: 'sales_navigator', tenure_at_company: [{ min: 1, max: 2 }] }).years_in_company, [{ min: 1, max: 2 }]);
});

Deno.test('niveaux de séniorité, taille d\'entreprise, type et groupes selon la licence', () => {
  deepStrictEqual(body({ api: 'recruiter', seniority: ['senior', 'director'] }).seniority, ['SENIOR', 'DIRECTOR']);
  deepStrictEqual(body({ api: 'sales_navigator', seniority: ['senior', 'vice_president'] }).seniority, { include: ['SENIOR', 'VICE_PRESIDENT'] });
  deepStrictEqual(body({ api: 'recruiter', company_headcount: ['D', 'E'] }).company_size, [{ min: 51, max: 200 }, { min: 201, max: 500 }]);
  deepStrictEqual(body({ api: 'sales_navigator', company_headcount: ['D'], company_type: ['C'] }).company_type, ['PUBLIC_COMPANY']);
  deepStrictEqual(body({ api: 'sales_navigator', groups: ['g1'] }).group, { include: ['g1'] });
  deepStrictEqual(body({ api: 'recruiter', groups: ['g1'] }).group, ['g1']);
  deepStrictEqual(body({ api: 'sales_navigator', company_location: { include: ['9'] } }).company_location, { include: ['9'] });
});

Deno.test('Classic : mots-clés avancés, degré de relation et langue ISO', () => {
  const out = body({
    api: 'classic', advanced_keywords: { first_name: 'Ada', last_name: 'Lovelace', title: 'Ingénieure' },
    network_distance: [1, 2], profile_language: ['fr'], open_to: ['proBono'],
  });
  deepStrictEqual(out.advanced_keywords, { first_name: 'Ada', last_name: 'Lovelace', title: 'Ingénieure' });
  deepStrictEqual(out.network_distance, [1, 2]);
  deepStrictEqual(out.profile_language, ['fr']);
  deepStrictEqual(out.open_to_volunteering, true);
  deepStrictEqual(droppedNames({ api: 'classic', advanced_keywords: { company: 'ACME' } }), ['advanced_keywords']);
});

Deno.test('requête : aucune clé de l\'ancienne génération n\'atteint le corps (api, category, limit, cursor)', () => {
  for (const api of ['classic', 'recruiter', 'sales_navigator']) {
    const out = run({ api, keywords: 'Go', limit: 25, cursor: undefined }).compiled;
    for (const key of ['api', 'category', 'limit', 'cursor', 'offset']) ok(!(key in out.body), `${api} : ${key}`);
  }
});

Deno.test('pagination : Classic et Recruiter en curseur, Sales Navigator en décalage', () => {
  deepStrictEqual(run({ api: 'classic', cursor: 'abc' }).compiled.query, { cursor: 'abc' });
  deepStrictEqual(run({ api: 'recruiter', cursor: 'abc', limit: 40 }).compiled.query, { cursor: 'abc', limit: 40 });
  deepStrictEqual(run({ api: 'recruiter' }).compiled.query, { limit: 25 });
  deepStrictEqual(run({ api: 'sales_navigator', cursor: 'offset:50', limit: 25 }).compiled.query, { offset: 50, limit: 25 });
  deepStrictEqual(run({ api: 'sales_navigator' }).compiled.query, { offset: 0, limit: 25 });
  deepStrictEqual(run({ api: 'recruiter', limit: 500 }).compiled.query, { limit: 100 });
});

Deno.test('pagination : un curseur d\'une autre licence est refusé au lieu de repartir de zéro', () => {
  deepStrictEqual(inputError({ api: 'sales_navigator', cursor: 'AbCd' }).code, 'INVALID_CURSOR');
  deepStrictEqual(inputError({ api: 'recruiter', cursor: 'offset:50' }).code, 'INVALID_CURSOR');
});

Deno.test('source et catégorie non prises en charge : refus 400 avant tout appel', () => {
  deepStrictEqual(inputError({ api: 'database' }).code, 'UNSUPPORTED_SEARCH_SOURCE');
  deepStrictEqual(inputError({ api: 'recruiter', category: 'jobs' }).code, 'UNSUPPORTED_SEARCH_CATEGORY');
  deepStrictEqual(run({}).api, 'recruiter', 'Recruiter est la source par défaut, comme avant');
});

Deno.test('recherches enregistrées Sales Navigator : refusées plutôt que d\'être ignorées', () => {
  deepStrictEqual(inputError({ api: 'sales_navigator', saved_search_id: '42' }).code, 'SAVED_SEARCH_UNSUPPORTED');
  deepStrictEqual(inputError({ api: 'sales_navigator', recent_search_id: '42' }).code, 'SAVED_SEARCH_UNSUPPORTED');
  throws(() => run({ api: 'sales_navigator', saved_search_id: '42' }), UnipileInputError);
});
