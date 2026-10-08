import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
function compile(source, globals = {}, name = 'continuous-filter-test.ts') {
  const result = ts.transpileModule(source, {
    fileName: name, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  const context = { exports: {}, console: { log() {}, warn() {}, error() {} }, Response, ...globals };
  vm.runInNewContext(result.outputText, context, { filename: name });
  return context.exports;
}
function snippet(path, names) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const statements = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.text)));
  assert.equal(statements.length, names.length, 'all requested production declarations were found');
  return statements.map(node => node.getText(ast)).join('\n');
}
const filters = compile(readFileSync(new URL('supabase/functions/_shared/continuous-sourcing-filters.ts', root), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const base = { keywords: 'Python', activity_messages: null };
const build = (snapshot, api = 'recruiter') => plain(filters.buildContinuousSearchRequest(snapshot, api));
function rejects(snapshot, api, code, reason) {
  assert.throws(() => build(snapshot, api), error => error instanceof filters.ContinuousSearchFilterError
    && error.code === code && reason.test(error.message));
}
const providerSource = snippet('supabase/functions/unipile-search/index.ts', ['handleSearch', 'balanceBooleanKeywords'])
  + '\nexports.handleSearch = handleSearch;';
async function providerBody(request) {
  let body;
  const provider = compile(providerSource, {
    corsHeaders: {},
    fetchWithTimeout: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ items: [], paging: { total_count: 0 } }), { status: 200 });
    },
  });
  const response = await provider.handleSearch('https://local.invalid', 'fake-key', 'account', request);
  assert.equal(response.status, 200);
  return body;
}
const frontend = compile(snippet('src/components/outreach/types.ts', ['INITIAL_FILTERS'])
  + '\n' + snippet('src/hooks/useLinkedInSearchActions.ts', ['buildSearchParams']));
function ui(filtersInput) {
  return frontend.buildSearchParams({ ...plain(frontend.INITIAL_FILTERS), ...filtersInput }, 'account');
}

test('reviewed basic filters have the same provider payload as interactive sourcing', async () => {
  const saved = { ...base, location: [{ id: '106383538', name: 'Paris', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    location_within_area: 35, company: [{ id: '1234', name: 'Cible' }], industry: [{ id: '96', name: 'Logiciels' }],
    school: [{ id: '14034', name: 'École', priority: 'MUST_HAVE' }], function: [{ id: '3', name: 'Engineering' }],
    job_title: [{ id: '900', name: 'Engineer', priority: 'MUST_HAVE' }],
    skills: [{ id: '42', name: 'Python', priority: 'MUST_HAVE' }],
    network_distance: [1, 2], profile_language: ['fr'], company_headcount: ['C'],
    past_company: [{ id: '5678', name: 'Ancienne entreprise' }], past_job_title: [{ id: '901', name: 'Consultant', priority: 'DOESNT_HAVE' }],
  };
  assert.deepEqual(await providerBody(build(saved)), await providerBody(ui(saved)));
});

test('raw AI experience stays calculated and never becomes native tenure', async () => {
  const saved = { ...base, generated_at: '2026-10-08', skills_keywords: [], location_keywords: [],
    years_of_experience_min: 3, years_of_experience_max: 8 };
  const body = await providerBody(build(saved));
  assert.equal(body.tenure, undefined);
  assert.equal(body.years_of_experience, undefined);
});

test('manual snapshots drop the same legacy generated XP and suggestions as the UI loader', async () => {
  const saved = { ...base, last_manual_edit: '2026-10-08', years_of_experience_min: 3, years_of_experience_max: 8,
    calculated_experience_min: 3, calculated_experience_max: 8, skills_keywords: ['legacy suggestion'],
    location_keywords: ['legacy unselected city'] };
  const request = build(saved);
  assert.equal(request.years_of_experience, undefined);
  assert.equal(request.tenure, undefined);
  assert.equal((await providerBody(request)).tenure, undefined);
});

test('Recruiter keeps long reviewed Boolean queries intact through the provider boundary', async () => {
  for (const length of [201, 330, 900]) {
    const prefix = '("Solution Engineer" OR "Sales Engineer") AND ("';
    const suffix = '" OR Kubernetes)';
    const phrase = 'cloud infrastructure architecture '.repeat(40).slice(0, length - prefix.length - suffix.length);
    const keywords = prefix + phrase + suffix;
    assert.equal(keywords.length, length);
    const saved = { ...base, keywords };
    const before = structuredClone(saved);
    const request = build(saved);
    assert.equal(request.keywords, keywords);
    assert.equal((await providerBody(request)).keywords, keywords, 'no last-AND trimming or hard cut');
    assert.deepEqual(saved, before, 'the approved snapshot is immutable');
    assert.deepEqual(await providerBody(request), await providerBody(ui({ ...saved, api: 'recruiter' })));
  }
});

test('Recruiter keyword facets preserve long roles, companies and skills too', async () => {
  const keywords = Array.from({ length: 20 }, (_, i) => `"Cloud expertise ${i}"`).join(' OR ');
  const saved = { ...base,
    role: [{ keywords, priority: 'MUST_HAVE', scope: 'CURRENT' }],
    company_keywords: [{ keywords, priority: 'DOESNT_HAVE', scope: 'PAST' }],
    skills: [{ keywords, priority: 'CAN_HAVE' }],
  };
  const body = await providerBody(build(saved));
  assert.equal(body.role[0].keywords, keywords);
  assert.equal(body.company[0].keywords, keywords);
  assert.equal(body.skills[0].keywords, keywords);
});

test('manual metadata cannot activate an orphan radius or old sector suggestions', async () => {
  const saved = { ...base, api: 'recruiter', last_manual_edit: '2026-10-08',
    location: [], location_within_area: 25, location_keywords: ['Old suggested city'],
    industry: [], industry_keywords: ['Cloud Computing', 'Software Development'],
    role: [{ keywords: 'Solution Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    company_keywords: [{ keywords: 'Consulting', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' }],
    activity_messages: 'without_message', activity_messages_days: 90,
  };
  const before = structuredClone(saved);
  const request = build(saved);
  const { location_keywords, last_manual_edit, ...loaded } = saved;
  assert.deepEqual(await providerBody(request), await providerBody(ui(loaded)));
  assert.equal(request.location_within_area, undefined);
  assert.equal(request.industry, undefined);
  assert.deepEqual(saved, before);

  const selected = { ...saved, location: [{ id: '106383538', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    industry: [{ id: '96', priority: 'MUST_HAVE' }] };
  const body = await providerBody(build(selected));
  assert.equal(body.location_within_area, 25);
  assert.deepEqual(body.industry, { include: ['96'] });
  assert.deepEqual(body.location, [{ id: '106383538', priority: 'MUST_HAVE', scope: 'CURRENT' }]);
  rejects({ ...selected, location_within_area: 17 }, 'recruiter', 'filters_invalid', /rayon/i);
  rejects({ ...base, location_within_area: 25 }, 'recruiter', 'filters_unresolved', /lieu/);
  rejects({ ...base, industry_keywords: saved.industry_keywords }, 'recruiter', 'filters_unresolved', /secteurs/);
});

test('explicit native XP, employer tenure and role tenure retain distinct ranges', async () => {
  const saved = { ...base, years_of_experience_min: 0, years_of_experience_max: 8,
    tenure_at_company_min: 1, tenure_at_company_max: 5, tenure_at_role_min: 0, tenure_at_role_max: 2 };
  const body = await providerBody(build(saved));
  assert.deepEqual(body.tenure, { min: 0, max: 8 });
  assert.deepEqual(body.tenure_in_company, { min: 1, max: 5 });
  assert.deepEqual(body.tenure_in_position, { min: 0, max: 2 });
});

test('company IDs and text exclusions survive together with all supported periods', async () => {
  const saved = { ...base, company: [{ id: '1234', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    company_keywords: [{ keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' },
      { keywords: 'Feeder', priority: 'MUST_HAVE', scope: 'PAST_NOT_CURRENT' }] };
  const request = build(saved);
  assert.equal(request.company_keywords, undefined, 'avoid the existing handler overwrite path');
  assert.deepEqual((await providerBody(request)).company, [
    { id: '1234', priority: 'MUST_HAVE', scope: 'CURRENT' },
    { keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' },
    { keywords: 'Feeder', priority: 'MUST_HAVE', scope: 'PAST_NOT_CURRENT' },
  ]);
});

test('role and location priorities and scopes are preserved instead of dropped', async () => {
  const saved = { ...base, role: [{ keywords: 'Data Engineer', priority: 'CAN_HAVE', scope: 'PAST' },
    { keywords: 'Junior OR Intern', priority: 'DOESNT_HAVE', scope: 'CURRENT' }],
    location: [{ id: '101', priority: 'CAN_HAVE', scope: 'OPEN_TO_RELOCATE_ONLY' },
      { id: '102', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] };
  const body = await providerBody(build(saved));
  assert.deepEqual(body.role, saved.role);
  assert.deepEqual(body.location, saved.location);
});

test('native seniority reaches the provider even with an existing required role', async () => {
  const saved = { ...base, seniority: ['4', '6'], role: [{ keywords: 'Data Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] };
  const body = await providerBody(build(saved));
  assert.deepEqual(body.seniority, { include: ['senior', 'director'] });
  assert.equal(body.role[0].keywords, 'Data Engineer');
  assert.deepEqual((await providerBody(build({ ...base, seniority: ['5', '7', '8'] }, 'sales_navigator'))).seniority,
    { include: ['experienced_manager', 'vice_president', 'cxo'] });
  rejects({ ...base, seniority: ['4'] }, 'classic', 'filters_unsupported', /séniorité/i);
  rejects({ ...base, seniority: ['invalid'] }, 'recruiter', 'filters_invalid', /séniorité/i);
});

test('Recruiter groups, degree, graduation, joined and viewed fields use handler formats', async () => {
  const saved = { ...base, groups: [{ id: '77', name: 'Groupe' }],
    degree: [{ id: '101', priority: 'MUST_HAVE' }, { id: '102', priority: 'DOESNT_HAVE' }],
    graduation_year_min: 2015, graduation_year_max: 2020, recently_joined_min: 0, recently_joined_max: 30,
    hide_previously_viewed: 90, employment_type: ['FULL_TIME'],
    spoken_languages: [{ language: 'en', priority: 'MUST_HAVE', scope: 'PROFESSIONAL_WORKING' }] };
  const body = await providerBody(build(saved));
  assert.deepEqual(body.groups, ['77']);
  assert.deepEqual(body.degree, { include: ['101'], exclude: ['102'] });
  assert.deepEqual(body.graduation_year, { min: 2015, max: 2020 });
  assert.deepEqual(body.recently_joined, [{ min: 0, max: 30 }]);
  assert.deepEqual(body.hide_previously_viewed, { timespan: 90 });
  assert.deepEqual(body.employment_type, ['FULL_TIME']);
  assert.deepEqual(body.spoken_languages, saved.spoken_languages);
  rejects({ ...base, degree: [{ id: '3', priority: 'MUST_HAVE' }] }, 'recruiter', 'filters_unresolved', /diplômes/);
});

test('contact and note activity preserves the selected period and UI default', async () => {
  const saved = { keywords: 'Python', activity_messages: 'without_message', activity_messages_days: 90,
    activity_notes: 'with_note', activity_notes_days: 30 };
  assert.deepEqual((await providerBody(build(saved))).recruiting_activity, [
    { id: 'messages', priority: 'DOESNT_HAVE', timespan: 90 },
    { id: 'notes', priority: 'MUST_HAVE', timespan: 30 },
  ]);
  assert.deepEqual(build({ keywords: 'Python' }).recruiting_activity,
    [{ id: 'messages', priority: 'DOESNT_HAVE', timespan: 90 }]);
  assert.equal(build(base).recruiting_activity, undefined, 'explicitly cleared means no default');
  assert.equal(build({ ...base, activity_messages: 'without_message', activity_messages_days: null })
    .recruiting_activity[0].timespan, 3650);
  rejects(saved, 'sales_navigator', 'filters_unsupported', /Activités/);
});

test('Sales Navigator preserves exact allowed tenure buckets and never rounds silently', async () => {
  const body = await providerBody(build({ ...base, tenure_at_role_min: 3, tenure_at_role_max: 5 }, 'sales_navigator'));
  assert.deepEqual(body.tenure_at_role, [{ min: 3, max: 5 }]);
  rejects({ ...base, tenure_at_role_min: 2, tenure_at_role_max: 4 }, 'sales_navigator', 'filters_unsupported', /ancienneté/);
});

test('Classic uses its supported array facets and reviewed advanced keywords', async () => {
  const saved = { ...base, location: [{ id: '101', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    company: [{ id: '102' }], industry: [{ id: '103' }], past_company: [{ id: '104' }],
    school: [{ id: '105', priority: 'CAN_HAVE' }], first_name: 'Alice', title_keywords: 'Engineer OR Ingénieur',
    open_to: ['boardMember'] };
  const body = await providerBody(build(saved, 'classic'));
  assert.deepEqual(body.location, ['101']);
  assert.deepEqual(body.company, ['102']);
  assert.deepEqual(body.industry, ['103']);
  assert.deepEqual(body.past_company, ['104']);
  assert.deepEqual(body.school, ['105']);
  assert.deepEqual(body.advanced_keywords, { first_name: 'Alice', title: 'Engineer OR Ingénieur' });
  assert.deepEqual(body.open_to, ['boardMember']);
});

test('unsupported constraints fail before a provider request with an actionable reason', () => {
  const cases = [
    [{ ...base, role: [{ keywords: 'Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] }, 'classic', /Rôle/],
    [{ ...base, role: [{ keywords: 'Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] }, 'sales_navigator', /Rôle/],
    [{ ...base, company_keywords: [{ keywords: 'Client', priority: 'DOESNT_HAVE' }] }, 'sales_navigator', /Entreprises/],
    [{ ...base, location: [{ id: '101', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] }, 'classic', /exclusions/],
    [{ ...base, location: [{ id: '101', scope: 'OPEN_TO_RELOCATE_ONLY' }] }, 'sales_navigator', /mobilité/],
    [{ ...base, school: [{ id: '101', priority: 'DOESNT_HAVE' }] }, 'sales_navigator', /exclusion/],
    [{ ...base, skills: [{ id: '101', priority: 'MUST_HAVE' }] }, 'sales_navigator', /Compétences/],
    [{ ...base, tags: ['101'] }, 'recruiter', /Tags/],
    [{ ...base, changed_jobs: true }, 'sales_navigator', /Changement/],
    [{ ...base, posted_on_linkedin: true }, 'sales_navigator', /Publication/],
    [{ ...base, company_category: 'startup' }, 'recruiter', /Catégorie/],
    [{ ...base, company_revenue: ['1M'] }, 'sales_navigator', /Chiffre/],
    [{ ...base, talent_pool: '101' }, 'recruiter', /Vivier/],
    [{ ...base, db_email_verified: true }, 'recruiter', /Base Konekt/],
    [{ ...base, open_to: ['boardMember'] }, 'recruiter', /Open to/],
  ];
  for (const [snapshot, api, reason] of cases) rejects(snapshot, api, 'filters_unsupported', reason);
});

test('unresolved suggestions cannot be silently lost behind unrelated resolved filters', () => {
  rejects({ ...base, location_keywords: ['Paris'] }, 'recruiter', 'filters_unresolved', /lieux/);
  rejects({ ...base, skills_keywords: ['Kubernetes'], skills: [{ id: '42', name: 'Python', priority: 'MUST_HAVE' }] },
    'recruiter', 'filters_unresolved', /compétences/);
  rejects({ ...base, industry_keywords: ['Financial Services'] }, 'recruiter', 'filters_unresolved', /secteurs/);
  rejects({ ...base, location: [{ id: 'Paris', priority: 'MUST_HAVE' }] }, 'recruiter', 'filters_unresolved', /suggestions/);
});

test('provider query repair and truncation cannot change an approved unattended query', () => {
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    for (const keywords of [' ', '(Python OR SQL', 'Python AND', '"Python']) {
      rejects({ ...base, keywords }, api, 'filters_invalid', /requête|guillemets|parenthèses/);
    }
    if (api !== 'recruiter') rejects({ ...base, keywords: 'x'.repeat(201) }, api, 'filters_invalid', /201.*200/);
  }
  rejects({ ...base, spotlight: 'UNKNOWN' }, 'recruiter', 'filters_invalid', /Signaux/);
  rejects({ ...base, company_headcount: ['UNKNOWN'] }, 'recruiter', 'filters_invalid', /Taille/);
  rejects({ ...base, tenure_at_role_min: 5, tenure_at_role_max: 2 }, 'recruiter', 'filters_invalid', /minimale/);
  rejects({ ...base, location: [{ id: '101' }], location_within_area: 500 }, 'recruiter', 'filters_invalid', /rayon/);
});

test('no criteria and other search categories are refused', () => {
  rejects({}, 'recruiter', 'filters_invalid', /au moins/);
  rejects({ generated_at: '2026-10-08', suggestions: {}, memory_context: { notes: [] } }, 'recruiter', 'filters_invalid', /au moins/);
  rejects({ ...base, category: 'companies' }, 'recruiter', 'filters_unsupported', /personnes/);
  rejects(base, 'database', 'filters_unsupported', /licence/);
});

test('legacy native request shapes and malformed lists cannot disappear silently', () => {
  for (const key of ['years_of_experience', 'tenure', 'tenure_at_role', 'tenure_at_company', 'tenure_in_position', 'tenure_in_company']) {
    rejects({ ...base, [key]: [{ min: 3, max: 5 }] }, 'recruiter', 'filters_unsupported', /Retirez|enregistrez/);
  }
  rejects({ ...base, profile_language: 'en' }, 'recruiter', 'filters_invalid', /listes/);
  rejects({ ...base, open_to_work: 'true' }, 'recruiter', 'filters_invalid', /interrupteurs/);
  rejects({ ...base, graduation_year_min: 2015, graduation_year: { min: 2020 } },
    'recruiter', 'filters_invalid', /Harmonisez/);
});
