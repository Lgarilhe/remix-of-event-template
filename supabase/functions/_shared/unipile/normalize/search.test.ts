// Recherche : résultats v2 vers l'ancienne forme, curseur par licence, et compilateur
// des filtres de l'interface vers les trois corps de recherche (classic, Recruiter,
// Sales Navigator). Les corps ne contiennent que des clés acceptées par les routes
// (additionalProperties false : une clé en trop est un refus 400).
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/normalize/search.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import searchClassic from '../fixtures/search-classic.json' with { type: 'json' };
import searchRecruiter from '../fixtures/search-recruiter.json' with { type: 'json' };
import searchSalesNavigator from '../fixtures/search-sales-navigator.json' with { type: 'json' };
import { isUnipileError } from '../errors.ts';
import {
  type ClassicPeopleFilters,
  type RecruiterPeopleFilters,
  type SalesNavigatorPeopleFilters,
  searchClassicPeople,
  searchRecruiterPeople,
  searchSalesNavigatorPeople,
} from '../linkedin.ts';
import { withMockTransport } from '../testing.ts';
import {
  compileClassicBody,
  compileRecruiterBody,
  compileSalesNavigatorBody,
  encodeOffsetCursor,
  FILTER_LABELS_FR,
  type KonektSearchFilters,
  OFFSET_CURSOR_PREFIX,
  parseKonektCursor,
  type SearchDiagnostic,
  type SearchProduct,
  toKonektFilters,
  toKonektSearchParameters,
  toKonektSearchProfile,
  toKonektSearchResults,
} from './search.ts';

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

Deno.test('toKonektSearchResults : page classic, curseur du fournisseur et total', () => {
  deepStrictEqual(toKonektSearchResults(searchClassic.input, searchClassic.context as { product: SearchProduct }), searchClassic.expected);
});

Deno.test('toKonektSearchResults : page Recruiter, profil complet et profil partiel sans nom ni URL', () => {
  const out = toKonektSearchResults(searchRecruiter.input, searchRecruiter.context as { product: SearchProduct });
  deepStrictEqual(out, searchRecruiter.expected);
  const [full, partial] = out.results;
  strictEqual(full.profile_visibility, 'full');
  strictEqual(partial.profile_visibility, 'partial');
  strictEqual(partial.name, null);
  strictEqual(partial.profile_url, null);
  strictEqual(partial.public_identifier, null);
  strictEqual(partial.recruiter_candidate_id, 'cand_2');
  strictEqual(partial.hiddenCandidate, true);
  strictEqual(partial.headline, 'Ingénieur logiciel');
});

Deno.test('toKonektSearchResults : page Sales Navigator demandée à l’offset 25, curseur offset:27', () => {
  deepStrictEqual(toKonektSearchResults(searchSalesNavigator.input, searchSalesNavigator.context as { product: SearchProduct; offset: number }), searchSalesNavigator.expected);
});

Deno.test('toKonektSearchResults : ce que lisent les cartes, le dédoublonnage et le moteur', () => {
  const { results } = toKonektSearchResults(searchClassic.input, { product: 'classic' });
  const [jean] = results;
  strictEqual(jean.id, 'ACoAAC0001'); // clé de dédoublonnage de la liste
  strictEqual(jean.provider_id, jean.id);
  strictEqual(jean.network_distance, 'DISTANCE_1');
  strictEqual(jean.name, 'Jean Martin');
  strictEqual(jean.first_name, null); // l'interface retombe sur name.split(' ')
  strictEqual(jean.profile_picture_url, 'https://media.licdn.com/jm.jpg');
  strictEqual(jean.member_urn, 'urn:li:member:98765');
  strictEqual(jean.work_experience, null); // la recherche classic n'envoie aucun parcours
  strictEqual(jean.current_positions, null);
  strictEqual(results[1].public_identifier, 'anne-lefevre-42'); // tiré de l'URL, barre finale comprise
});

Deno.test('toKonektSearchResults : le parcours est découpé en postes en cours et passés', () => {
  const { results } = toKonektSearchResults(searchRecruiter.input, { product: 'recruiter' });
  const full = results[0];
  strictEqual(full.work_experience?.length, 2);
  deepStrictEqual(full.current_positions?.map((p) => p.company), ['DataCorp']);
  deepStrictEqual(full.past_positions?.map((p) => p.company), ['Startup X']);
  deepStrictEqual(full.past_positions?.[0].end, { year: 2020, month: 12 });
  deepStrictEqual(full.interests, ['ACTIVE_TALENT']);
});

Deno.test('curseur : classic et Recruiter rendent next_cursor tel quel, null en fin de liste', () => {
  for (const product of ['classic', 'recruiter'] as const) {
    strictEqual(toKonektSearchResults({ data: [{ id: 'a' }], next_cursor: 'abc' }, { product }).cursor, 'abc');
    strictEqual(toKonektSearchResults({ data: [{ id: 'a' }] }, { product }).cursor, null);
    strictEqual(toKonektSearchResults({ data: [{ id: 'a' }], next_cursor: '' }, { product }).cursor, null);
    // L'offset ne sert à rien pour un fournisseur à curseur.
    strictEqual(toKonektSearchResults({ data: [{ id: 'a' }], next_cursor: 'abc' }, { product, offset: 50 }).cursor, 'abc');
  }
});

Deno.test('curseur : Sales Navigator, offset demandé plus éléments reçus tant que total_count dit qu’il en reste', () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const out = (body: Record<string, unknown>, offset?: number) => toKonektSearchResults(body, { product: 'sales_navigator', offset }).cursor;
  strictEqual(out({ data: page(25), total_count: 100 }), 'offset:25');
  strictEqual(out({ data: page(25), total_count: 100 }, 25), 'offset:50');
  strictEqual(out({ data: page(25), total_count: 100 }, 75), null); // 75 + 25 = 100, fin
  strictEqual(out({ data: page(10), total_count: 100 }, 90), null);
  strictEqual(out({ data: page(10), total_count: 100 }, 80), 'offset:90');
});

Deno.test('curseur : Sales Navigator sans total_count, next_cursor est le seul signal ; une page pleine ne suffit pas', () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const out = (body: Record<string, unknown>, offset?: number) => toKonektSearchResults(body, { product: 'sales_navigator', offset }).cursor;
  strictEqual(out({ data: page(25), next_cursor: 'x' }, 0), 'offset:25');
  strictEqual(out({ data: page(25) }, 0), null);
  strictEqual(out({ data: [], next_cursor: 'x' }, 25), null); // page vide : fin, même avec un curseur
  strictEqual(out({ data: [], total_count: 500 }, 25), null);
});

Deno.test('curseur : Sales Navigator sans total_count ni next_cursor, une page pleine continue si la taille demandée est connue', () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const out = (body: Record<string, unknown>, offset: number, limit?: number) =>
    toKonektSearchResults(body, { product: 'sales_navigator', offset, limit }).cursor;
  strictEqual(out({ data: page(25) }, 0, 25), 'offset:25');
  strictEqual(out({ data: page(25) }, 25, 25), 'offset:50');
  strictEqual(out({ data: page(10) }, 50, 25), null); // page courte : fin
  strictEqual(out({ data: [] }, 75, 25), null); // page vide : fin
  strictEqual(out({ data: page(25) }, 0), null); // taille inconnue : pas de supposition
  strictEqual(out({ data: page(25), total_count: 25 }, 0, 25), null); // le total, quand il existe, décide
});

Deno.test('toKonektSearchResults : candidats d’un projet Recruiter (JobApplicant, PipelineCandidate) et prospects enregistrés (SavedLead)', () => {
  const profile = { id: 'ACoAAA1', display_name: 'Claire Roux', visibility: 'full', candidate_id: 'cand_1', is_hidden_candidate: false };
  const diagnostics: unknown[] = [];
  const out = toKonektSearchResults({
    data: [
      { object: 'JobApplicant', product: 'recruiter', id: 'app_1', applied_at: '2026-09-01T00:00:00Z', profile },
      { object: 'PipelineCandidate', profile: { ...profile, id: 'ACoAAA2', display_name: 'Marc Petit' } },
      { object: 'SavedLead', id: 'ACoAAA3', display_name: 'Lina Bos', saved_at: '2026-09-02T00:00:00Z' },
      { object: 'SavedAccount', id: 'acct_1', display_name: 'Acme' },
      { object: 'JobApplicant', id: 'app_2' },
    ],
    next_cursor: 'abc',
  }, { product: 'recruiter', onDiagnostic: (d) => diagnostics.push(d) });
  deepStrictEqual(out.results.map((r) => [r.id, r.name, r.source_object, r.product]), [
    ['ACoAAA1', 'Claire Roux', 'JobApplicant', 'recruiter'],
    ['ACoAAA2', 'Marc Petit', 'PipelineCandidate', 'recruiter'],
    ['ACoAAA3', 'Lina Bos', 'SavedLead', 'recruiter'],
  ]);
  strictEqual(out.results[0].recruiter_candidate_id, 'cand_1');
  strictEqual(out.cursor, 'abc');
  // Un compte enregistré n’est pas une personne : laissé de côté mais signalé, un candidat sans profil aussi.
  deepStrictEqual(diagnostics, [{ kind: 'skipped_items', count: 2, objects: ['SavedAccount', 'JobApplicant'] }]);
  const sales = toKonektSearchResults({ data: [{ object: 'SavedLead', id: 'L1', display_name: 'Lina' }] }, { product: 'sales_navigator' });
  strictEqual(sales.results[0].product, 'sales_navigator');
  strictEqual(sales.results[0].source_object, 'SavedLead');
});

Deno.test('toKonektSearchResults : accepte aussi la page déjà lue par pagination.ts (items, nextCursor, totalCount)', () => {
  const page = { items: [{ object: 'PeopleSearchResult', id: 'a' }], nextCursor: 'nc', totalCount: 9, hasMore: null };
  deepStrictEqual(toKonektSearchResults(page, { product: 'recruiter' }).cursor, 'nc');
  strictEqual(toKonektSearchResults(page, { product: 'recruiter' }).total, 9);
  strictEqual(toKonektSearchResults(page, { product: 'sales_navigator', offset: 0 }).cursor, 'offset:1');
  deepStrictEqual(toKonektSearchParameters({ items: [{ id: '1', name: 'France' }] }), [{ id: '1', title: 'France' }]);
});

Deno.test('parseKonektCursor : curseur du fournisseur pour classic et Recruiter, offset:n pour Sales Navigator', () => {
  deepStrictEqual(parseKonektCursor(undefined, 'classic'), {});
  deepStrictEqual(parseKonektCursor(null, 'sales_navigator'), {});
  deepStrictEqual(parseKonektCursor('', 'recruiter'), {});
  deepStrictEqual(parseKonektCursor('abc', 'classic'), { cursor: 'abc' });
  deepStrictEqual(parseKonektCursor('abc', 'recruiter'), { cursor: 'abc' });
  deepStrictEqual(parseKonektCursor('offset:50', 'sales_navigator'), { offset: 50 });
  deepStrictEqual(parseKonektCursor(encodeOffsetCursor(7), 'sales_navigator'), { offset: 7 });
  strictEqual(encodeOffsetCursor(-3), 'offset:0');
  strictEqual(OFFSET_CURSOR_PREFIX, 'offset:');
});

Deno.test('parseKonektCursor : un curseur illisible pour la licence vaut null, jamais un retour à zéro', () => {
  strictEqual(parseKonektCursor('abc', 'sales_navigator'), null); // curseur du fournisseur donné à une licence à offset
  strictEqual(parseKonektCursor('offset:abc', 'sales_navigator'), null);
  strictEqual(parseKonektCursor('offset:-1', 'sales_navigator'), null);
  strictEqual(parseKonektCursor('offset:5', 'classic'), null); // curseur synthétique donné à une licence à curseur
  strictEqual(parseKonektCursor('offset:5', 'recruiter'), null);
});

Deno.test('toKonektSearchResults : les éléments qui ne sont pas des personnes sont écartés et signalés', () => {
  const seen: SearchDiagnostic[] = [];
  const out = toKonektSearchResults(
    { data: [{ object: 'PeopleSearchResult', id: 'a' }, { object: 'CompanySearchResult', id: 'c' }, { object: 'JobSearchResult', id: 'j' }, { id: 'sans-objet' }, null, 'x'] },
    { product: 'classic', onDiagnostic: (d) => seen.push(d) },
  );
  deepStrictEqual(out.results.map((r) => r.id), ['a', 'sans-objet']);
  deepStrictEqual(seen, [{ kind: 'skipped_items', count: 2, objects: ['CompanySearchResult', 'JobSearchResult'] }]);
});

Deno.test('toKonektSearchResults : corps illisible, liste vide et un rapport qui échoue ne cassent rien', () => {
  for (const body of [null, undefined, 'x', 3, {}, { data: 'x' }, []]) {
    deepStrictEqual(toKonektSearchResults(body, { product: 'recruiter' }), { success: true, results: [], cursor: null, total: null });
  }
  const out = toKonektSearchResults({ data: [{ object: 'JobSearchResult' }] }, {
    product: 'classic',
    onDiagnostic: () => {
      throw new Error('boom');
    },
  });
  deepStrictEqual(out.results, []);
});

Deno.test('toKonektSearchProfile : ne lève jamais, toutes les clés existent', () => {
  const keys = Object.keys(toKonektSearchProfile(searchRecruiter.input.data[0])).sort();
  for (const bad of [null, undefined, 'x', 3, [], { work_experience: 'x', education: [null], skills: 5 }]) {
    deepStrictEqual(Object.keys(toKonektSearchProfile(bad)).sort(), keys);
  }
  strictEqual(toKonektSearchProfile({}, 'classic').product, 'classic');
  strictEqual(toKonektSearchProfile({ product: 'unknown' }, 'recruiter').product, 'recruiter');
});

Deno.test('toKonektSearchParameters : name devient title, les entrées incomplètes sont écartées', () => {
  deepStrictEqual(
    toKonektSearchParameters({ data: [{ object: 'SearchParameter', id: '105015875', name: 'France' }, { id: 'x' }, { name: 'y' }, null], total_count: 4 }),
    [{ id: '105015875', title: 'France' }],
  );
  deepStrictEqual(toKonektSearchParameters(null), []);
  deepStrictEqual(toKonektSearchParameters({ data: 'x' }), []);
});

// ---------------------------------------------------------------------------
// Filtres : clés acceptées par les routes
// ---------------------------------------------------------------------------

const CLASSIC_KEYS = [
  'keywords', 'network_distance', 'location', 'current_company', 'past_company', 'school', 'connections_of', 'followers_of',
  'industry', 'service', 'profile_language', 'open_to_volunteering', 'advanced_keywords',
];
const RECRUITER_KEYS = [
  'keywords', 'spotlights', 'load_saved_search', 'load_custom_filter', 'save_search', 'save_custom_filter', 'network_distance', 'location',
  'postal_code', 'postal_code_radius', 'job_title', 'occupation', 'skills', 'company', 'current_company', 'past_company', 'company_size',
  'years_of_experience', 'years_in_current_position', 'years_in_current_company', 'degree', 'workplace_type', 'school', 'field_of_study',
  'employment_type', 'graduation_year', 'industry', 'seniority', 'spoken_language', 'profile_language', 'project', 'job_function',
  'first_name', 'last_name', 'recently_joined', 'is_military_veteran', 'recruiting_activity', 'hide_previously_viewed', 'group',
  'is_past_applicant', 'notes', 'tags',
];
const SALES_NAVIGATOR_KEYS = [
  'keywords', 'save_search', 'load_saved_search', 'load_recent_search', 'current_company', 'past_company', 'company_headcount', 'company_type',
  'company_location', 'function', 'current_job_title', 'past_job_title', 'seniority', 'years_in_company', 'years_in_position', 'location',
  'postal_code', 'industry', 'first_name', 'last_name', 'profile_language', 'years_of_experience', 'group', 'school', 'following_your_company',
  'viewed_your_profile_recently', 'network_distance', 'connections_of', 'past_colleague', 'shared_experiences', 'changed_jobs',
  'posted_on_linkedin', 'persona', 'account_list', 'lead_list', 'recent_interaction', 'saved_resources',
];
const ALLOWED: Record<SearchProduct, string[]> = { classic: CLASSIC_KEYS, recruiter: RECRUITER_KEYS, sales_navigator: SALES_NAVIGATOR_KEYS };
const FORBIDDEN = ['api', 'category', 'limit', 'cursor', 'offset', 'tenure', 'role', 'past_role', 'hiring_projects', 'saved_search_id', 'recent_search_id'];

function assertBodyKeys(product: SearchProduct, body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    ok(ALLOWED[product].includes(key), `${product}: clé non acceptée par la route : ${key}`);
    ok(!FORBIDDEN.includes(key), `${product}: clé d'une ancienne requête : ${key}`);
  }
}

/** Un état d'interface qui active presque tous les filtres, avec des valeurs que certaines licences ne savent pas porter. */
function richState(): KonektSearchFilters {
  return {
    keywords: 'python AND (senior OR lead)',
    location: [
      { id: '105015875', name: 'France', priority: 'CAN_HAVE', scope: 'CURRENT' },
      { id: '101165590', name: 'Royaume-Uni', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
    ],
    location_within_area: 25,
    company: [
      { id: '1', name: 'Acme', priority: 'CAN_HAVE', scope: 'CURRENT' },
      { id: '2', name: 'Beta', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' },
    ],
    company_keywords: [{ keywords: 'Google', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' }],
    industry: [{ id: '9', name: 'Logiciels' }],
    school: [
      { id: 's1', name: 'HEC', priority: 'MUST_HAVE' },
      { id: 's2', name: 'ESSEC', priority: 'CAN_HAVE' },
      { id: 's3', name: 'X', priority: 'DOESNT_HAVE' },
    ],
    job_title: [{ id: 't1', name: 'Product Manager', priority: 'MUST_HAVE' }],
    skills: [
      { id: '12', name: 'Python', priority: 'MUST_HAVE' },
      { id: 'kw', name: 'Leadership', priority: 'CAN_HAVE' },
    ],
    role: [{ keywords: 'Head of Product', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    function: [{ id: 'f1', name: 'Ingénierie' }],
    degree: [{ id: '100', name: 'Master', priority: 'MUST_HAVE' }, { id: '5', name: 'Autre', priority: 'DOESNT_HAVE' }],
    seniority: ['6', 'senior', 'bogus'],
    network_distance: [1, 2],
    profile_language: ['fr', 'en'],
    years_of_experience_min: 5,
    years_of_experience_max: 12,
    tenure_at_company_min: 2,
    tenure_at_company_max: 4,
    tenure_at_role_min: 0,
    tenure_at_role_max: 3,
    open_to_work: true,
    open_to: ['proBono', 'boardMember'],
    hiring_project: 'hp1',
    spotlight: 'ACTIVE_TALENT',
    company_headcount: ['A', 'C', 'D', 'I'],
    company_type: ['C', 'O', 'weird'],
    company_location: [{ id: 'cl1' }],
    groups: [{ id: 'g1' }],
    past_company: [{ id: 'pc1' }],
    past_job_title: [{ id: 'pt1', name: 'Analyste', priority: 'MUST_HAVE' }],
    first_name: 'Jean',
    last_name: 'Dupont',
    title_keywords: 'Directeur',
    skills_keywords: ['Scrum', 'Kanban'],
    exclude_consulting: true,
    activity_messages: 'with_message',
    activity_messages_days: 30,
    activity_notes: 'without_note',
    activity_notes_days: null,
    tags: ['tag1'],
    changed_jobs: true,
    posted_on_linkedin: true,
    following_your_company: true,
    viewed_your_profile: true,
    past_colleague: true,
    employment_type: ['FULL_TIME', 'FREELANCE'],
    spoken_languages: [{ language: 'fr', priority: 'MUST_HAVE', scope: 'NATIVE_OR_BILINGUAL' }],
    recently_joined_min: 3,
    recently_joined_max: 20,
    graduation_year_min: 2010,
    graduation_year_max: null,
    hide_previously_viewed: 45,
  };
}

const KEYWORDS_WITH_SKILLS = '(python AND (senior OR lead)) AND ("Scrum" OR "Kanban")';

const pairs = (list: Array<{ filter: string; reason: string }>) => list.map((d) => `${d.filter}:${d.reason}`).sort();

Deno.test('les trois corps ne contiennent que des clés acceptées, même avec un état qui active presque tout', () => {
  for (const product of ['classic', 'recruiter', 'sales_navigator'] as const) {
    const compiled = toKonektFilters({ ...richState(), api: product });
    assertBodyKeys(product, compiled.body);
    strictEqual(compiled.product, product);
    strictEqual(compiled.method, 'POST');
  }
});

Deno.test('classic : seuls les filtres pris en charge partent, le reste est rendu dans dropped', () => {
  const { body, dropped, adjusted } = compileClassicBody(richState());
  deepStrictEqual(body, {
    keywords: KEYWORDS_WITH_SKILLS,
    network_distance: [1, 2],
    location: ['105015875'],
    current_company: ['1'],
    past_company: ['pc1'],
    school: ['s1', 's2'],
    industry: ['9'],
    profile_language: ['fr', 'en'],
    open_to_volunteering: true,
    advanced_keywords: { first_name: 'Jean', last_name: 'Dupont', title: 'Directeur' },
  });
  deepStrictEqual(pairs(dropped), [
    'activity_messages:unsupported',
    'activity_notes:unsupported',
    'changed_jobs:unsupported',
    'company:exclusion',
    'company_headcount:unsupported',
    'company_keywords:unsupported',
    'company_location:unsupported',
    'company_type:unsupported',
    'degree:unsupported',
    'employment_type:unsupported',
    'exclude_consulting:exclusion',
    'following_your_company:unsupported',
    'function:unsupported',
    'graduation_year:unsupported',
    'groups:unsupported',
    'hide_previously_viewed:unsupported',
    'hiring_project:unsupported',
    'location:exclusion',
    'location_within_area:unsupported',
    'open_to:value',
    'open_to_work:unsupported',
    'past_colleague:unsupported',
    'past_job_title:unsupported',
    'posted_on_linkedin:unsupported',
    'recently_joined:unsupported',
    'school:exclusion',
    'seniority:unsupported',
    'skills:unsupported',
    'spoken_languages:unsupported',
    'spotlight:unsupported',
    'tags:unsupported',
    'tenure_at_company:unsupported',
    'tenure_at_role:unsupported',
    'viewed_your_profile:unsupported',
    'years_of_experience:unsupported',
  ]);
  deepStrictEqual(adjusted.map((a) => a.filter), ['job_title']); // 3 intitulés, le premier seul est appliqué
  for (const d of dropped) strictEqual(d.label, FILTER_LABELS_FR[d.filter] ?? d.filter);
});

Deno.test('Recruiter : corps complet, valeurs d’avant rendues explicites, filtres sans équivalent signalés', () => {
  const { body, dropped, adjusted } = compileRecruiterBody(richState());
  deepStrictEqual(body, {
    keywords: KEYWORDS_WITH_SKILLS,
    location: [
      { id: '105015875', priority: 'CAN_HAVE', preferences: 'CURRENT' },
      { id: '101165590', priority: 'DOESNT_HAVE', preferences: 'CURRENT' },
    ],
    current_company: [{ id: '1', priority: 'CAN_HAVE' }],
    company: [
      { name: 'Beta', id: '2', priority: 'DOESNT_HAVE', preferences: 'CURRENT_OR_PAST' },
      { name: 'Google', priority: 'DOESNT_HAVE', preferences: 'CURRENT_OR_PAST' },
    ],
    past_company: [{ id: 'pc1', priority: 'CAN_HAVE' }],
    industry: { include: ['9'], exclude: ['96', '4', '104'] },
    school: [{ id: 's1', priority: 'CAN_HAVE' }, { id: 's3', priority: 'DOESNT_HAVE' }],
    job_title: [
      { name: 'Product Manager', id: 't1', priority: 'MUST_HAVE', preferences: 'CURRENT_OR_PAST' },
      { name: 'Head of Product', priority: 'MUST_HAVE', preferences: 'CURRENT' },
      { name: 'Directeur', priority: 'MUST_HAVE', preferences: 'CURRENT_OR_PAST' },
      { name: 'Analyste', id: 'pt1', priority: 'MUST_HAVE', preferences: 'PAST' },
    ],
    skills: [{ name: 'Python', id: '12', priority: 'MUST_HAVE' }, { name: 'Leadership', priority: 'CAN_HAVE' }],
    job_function: ['f1'],
    degree: { include: ['100'] },
    seniority: ['DIRECTOR', 'SENIOR'],
    network_distance: [1, 2],
    profile_language: ['fr', 'en'],
    years_of_experience: { min: 5, max: 12 },
    years_in_current_company: { min: 2, max: 4 },
    years_in_current_position: { min: 0, max: 3 },
    spotlights: ['OPEN_TO_WORK', 'ACTIVE_TALENT'],
    project: { include: [{ id: 'hp1', title: 'hp1' }] },
    recruiting_activity: [
      { type: 'messages', priority: 'MUST_HAVE', preferences: 'PAST_3_MONTHS' },
      { type: 'notes', priority: 'DOESNT_HAVE', preferences: 'ANYTIME' },
    ],
    tags: { include: ['tag1'] },
    spoken_language: [{ id: 'fr', priority: 'MUST_HAVE', proficiency: 'NATIVE_OR_BILINGUAL' }],
    employment_type: ['FULL_TIME'],
    graduation_year: { min: 2010, max: 2100 },
    hide_previously_viewed: { timespan: 'PAST_3_MONTHS' },
    recently_joined: [{ min: 2, max: 30 }],
    company_size: [{ min: 1, max: 10 }, { min: 51, max: 200 }, { min: 10001 }],
    group: ['g1'],
    first_name: ['Jean'],
    last_name: ['Dupont'],
  });
  deepStrictEqual(pairs(dropped), [
    'changed_jobs:unsupported',
    'company_headcount:value',
    'company_location:unsupported',
    'company_type:unsupported',
    'degree:value',
    'employment_type:value',
    'following_your_company:unsupported',
    'location_within_area:unsupported',
    'open_to:unsupported',
    'past_colleague:unsupported',
    'posted_on_linkedin:unsupported',
    'seniority:value',
    'viewed_your_profile:unsupported',
  ]);
  deepStrictEqual(
    adjusted.map((a) => a.filter).sort(),
    ['activity_messages', 'company_headcount', 'hide_previously_viewed', 'recently_joined', 'recently_joined'].sort(),
  );
});

Deno.test('Sales Navigator : paires include/exclude, textes libres pour les sociétés et les postes, paliers fixes', () => {
  const { body, dropped, adjusted } = compileSalesNavigatorBody(richState());
  deepStrictEqual(body, {
    keywords: KEYWORDS_WITH_SKILLS,
    location: { include: ['105015875'], exclude: ['101165590'] },
    current_company: { include: ['1'], exclude: ['2', 'Google'] },
    past_company: { include: ['pc1'] },
    industry: { include: ['9'], exclude: ['96', '4', '104'] },
    school: { include: ['s1', 's2'], exclude: ['s3'] },
    current_job_title: { include: ['t1', 'Head of Product', 'Directeur'] },
    past_job_title: { include: ['pt1'] },
    function: { include: ['f1'] },
    seniority: { include: ['DIRECTOR', 'SENIOR'] },
    network_distance: [1, 2],
    profile_language: ['fr', 'en'],
    years_of_experience: [{ min: 3 }],
    years_in_company: [{ min: 1, max: 5 }],
    years_in_position: [{ max: 5 }],
    company_headcount: [{ min: 1, max: 10 }, { min: 11, max: 50 }, { min: 51, max: 200 }, { min: 10001 }],
    company_type: ['PUBLIC_COMPANY', 'PRIVATELY_HELD'],
    company_location: { include: ['cl1'] },
    group: { include: ['g1'] },
    first_name: ['Jean'],
    last_name: ['Dupont'],
    changed_jobs: true,
    posted_on_linkedin: true,
    following_your_company: true,
    viewed_your_profile_recently: true,
    past_colleague: true,
  });
  deepStrictEqual(pairs(dropped), [
    'activity_messages:unsupported',
    'activity_notes:unsupported',
    'company_type:value',
    'degree:unsupported',
    'employment_type:unsupported',
    'graduation_year:unsupported',
    'hide_previously_viewed:unsupported',
    'hiring_project:unsupported',
    'location_within_area:unsupported',
    'open_to:unsupported',
    'open_to_work:unsupported',
    'recently_joined:unsupported',
    'seniority:value',
    'skills:unsupported',
    'spoken_languages:unsupported',
    'spotlight:unsupported',
    'tags:unsupported',
  ]);
  ok(adjusted.some((a) => a.filter === 'company')); // CURRENT_OR_PAST lu comme société actuelle
  ok(adjusted.some((a) => a.filter === 'years_of_experience'));
});

// ---------------------------------------------------------------------------
// Filtres : comportements isolés
// ---------------------------------------------------------------------------

Deno.test('état par défaut de l’interface : classic et Sales Navigator vides, Recruiter porte seulement l’activité par défaut', () => {
  const defaults: KonektSearchFilters = {
    keywords: '', category: 'people', location: [], location_within_area: null, company: [], company_keywords: [], industry: [], school: [],
    job_title: [], skills: [], role: [], function: [], degree: [], seniority: [], network_distance: [], profile_language: [],
    years_of_experience_min: null, years_of_experience_max: null, tenure_at_company_min: null, tenure_at_role_max: null, open_to_work: null,
    open_to: [], hiring_project: '', spotlight: '', company_headcount: [], company_type: [], company_location: [], groups: [], past_company: [],
    past_job_title: [], first_name: '', last_name: '', title_keywords: '', skills_keywords: [], exclude_consulting: false, company_category: '',
    activity_messages: 'without_message', activity_messages_days: 90, activity_notes: null, activity_notes_days: null, tags: [],
    changed_jobs: null, employment_type: [], spoken_languages: [], recently_joined_min: null, graduation_year_min: null, hide_previously_viewed: null,
  };
  for (const product of ['classic', 'sales_navigator'] as const) {
    const compiled = toKonektFilters({ ...defaults, api: product });
    deepStrictEqual(compiled.body, {});
    deepStrictEqual(compiled.dropped, []); // l'activité par défaut n'est pas un choix de la personne
    deepStrictEqual(compiled.adjusted, []);
  }
  const recruiter = toKonektFilters({ ...defaults, api: 'recruiter' });
  deepStrictEqual(recruiter.body, { recruiting_activity: [{ type: 'messages', priority: 'DOESNT_HAVE', preferences: 'PAST_3_MONTHS' }] });
  deepStrictEqual(recruiter.dropped, []);
});

Deno.test('l’activité choisie (hors défaut) est signalée sur une licence qui ne la porte pas', () => {
  const dropped = (f: KonektSearchFilters) => pairs(toKonektFilters({ ...f, api: 'classic' }).dropped);
  deepStrictEqual(dropped({ activity_messages: 'without_message', activity_messages_days: 30 }), ['activity_messages:unsupported']);
  deepStrictEqual(dropped({ activity_messages: 'with_message', activity_messages_days: 90 }), ['activity_messages:unsupported']);
  deepStrictEqual(dropped({ activity_messages: 'without_message', activity_messages_days: 90 }), []);
  deepStrictEqual(dropped({ activity_messages: 'without_message', activity_messages_days: null }), []);
});

Deno.test('mots-clés : coupés à 200 caractères hors Recruiter et signalés, entiers pour Recruiter', () => {
  const long = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ');
  ok(long.length > 200);
  for (const product of ['classic', 'sales_navigator'] as const) {
    const compiled = toKonektFilters({ api: product, keywords: long });
    const kept = compiled.body.keywords as string;
    ok(kept.length <= 200 && kept.length > 150, `${kept.length}`);
    ok(long.startsWith(kept));
    ok(!kept.endsWith(' '));
    ok(/^mot\d+$/.test(kept.split(' ').pop() as string), 'coupé à une frontière de mot');
    deepStrictEqual(compiled.adjusted.map((a) => a.filter), ['keywords']);
  }
  const recruiter = toKonektFilters({ api: 'recruiter', keywords: long });
  strictEqual(recruiter.body.keywords, long);
  deepStrictEqual(recruiter.adjusted, []);
});

Deno.test('mots-clés : les compétences suggérées ne s’ajoutent que tant que le plafond de 200 caractères le permet', () => {
  const base = 'x'.repeat(180);
  const out = toKonektFilters({ api: 'classic', keywords: base, skills_keywords: ['Scrum', 'Kanban', 'Lean'] });
  strictEqual(out.body.keywords, `(${base}) AND ("Scrum")`); // 196 caractères ; une deuxième compétence dépasserait 200
  deepStrictEqual(out.adjusted.map((a) => a.filter), ['skills_keywords']);
  // Sous le plafond, tout rentre et rien n'est signalé.
  const small = toKonektFilters({ api: 'sales_navigator', keywords: 'abc', skills_keywords: ['Scrum', 'Kanban', 'Lean'] });
  strictEqual(small.body.keywords, '(abc) AND ("Scrum" OR "Kanban" OR "Lean")');
  deepStrictEqual(small.adjusted, []);
  // Sans plafond (Recruiter) : jusqu'à 5 compétences, entre guillemets, sans doublon avec le texte.
  const recruiter = toKonektFilters({ api: 'recruiter', keywords: 'scrum', skills_keywords: ['Scrum', 'Kanban', 'a"b', 'x1', 'x2', 'x3', 'x4'] });
  strictEqual(recruiter.body.keywords, '(scrum) AND ("Kanban" OR "ab" OR "x1" OR "x2" OR "x3")');
  strictEqual(toKonektFilters({ api: 'recruiter', skills_keywords: ['Go'] }).body.keywords, '"Go"');
});

Deno.test('segments, requête et pagination par licence', () => {
  const classic = toKonektFilters({ api: 'classic' }, { cursor: 'abc', limit: 50 });
  deepStrictEqual(classic.segments, ['linkedin', 'search', 'people']);
  deepStrictEqual(classic.query, { cursor: 'abc' }); // pas de limit : la page est fixe
  const recruiter = toKonektFilters({ api: 'recruiter' }, { cursor: 'rec_2', limit: 40 });
  deepStrictEqual(recruiter.segments, ['linkedin', 'recruiter', 'search', 'people']);
  deepStrictEqual(recruiter.query, { cursor: 'rec_2', limit: 40 });
  const sales = toKonektFilters({ api: 'sales_navigator' }, { cursor: 'offset:50' });
  deepStrictEqual(sales.segments, ['linkedin', 'sales-navigator', 'search', 'people']);
  deepStrictEqual(sales.query, { offset: 50, limit: 25 });
  deepStrictEqual(toKonektFilters({ api: 'recruiter' }).query, { limit: 25 });
  deepStrictEqual(toKonektFilters({ api: 'sales_navigator' }).query, { offset: 0, limit: 25 });
  deepStrictEqual(toKonektFilters({ api: 'classic' }).query, {});
});

Deno.test('limit : bornée entre 1 et 100, entière', () => {
  const limit = (value: number) => toKonektFilters({ api: 'recruiter' }, { limit: value }).query.limit;
  strictEqual(limit(0), 1);
  strictEqual(limit(-5), 1);
  strictEqual(limit(1000), 100);
  strictEqual(limit(33.7), 33);
  strictEqual(limit(NaN), 25);
});

Deno.test('options.product l’emporte sur filters.api', () => {
  strictEqual(toKonektFilters({ api: 'classic' }, { product: 'recruiter' }).product, 'recruiter');
});

Deno.test('source retirée, catégorie autre que people, curseur illisible : erreur de validation neutre', () => {
  for (const attempt of [
    () => toKonektFilters({ api: 'database' }),
    () => toKonektFilters({}),
    () => toKonektFilters({ api: 'recruiter', category: 'companies' }),
    () => toKonektFilters({ api: 'sales_navigator' }, { cursor: 'abc' }),
    () => toKonektFilters({ api: 'classic' }, { cursor: 'offset:5' }),
  ]) {
    let thrown: unknown;
    try {
      attempt();
    } catch (error) {
      thrown = error;
    }
    ok(isUnipileError(thrown));
    strictEqual((thrown as { kind: string }).kind, 'validation');
    ok(!/unipile|linkedin|api/i.test((thrown as Error).message), (thrown as Error).message);
  }
});

Deno.test('catégorie people explicite ou absente : acceptée', () => {
  strictEqual(toKonektFilters({ api: 'recruiter', category: 'people' }).product, 'recruiter');
  strictEqual(toKonektFilters({ api: 'recruiter', category: null }).product, 'recruiter');
});

Deno.test('Recruiter : les lieux gardent les valeurs d’avant (MUST_HAVE, mobilité comprise) quand rien n’est précisé', () => {
  const { body } = compileRecruiterBody({ location: ['1', { id: '2' }, { id: '3', priority: 'CAN_HAVE', scope: 'OPEN_TO_RELOCATE_ONLY' }, { id: '4', scope: 'INVENTE' }] });
  deepStrictEqual(body.location, [
    { id: '1', priority: 'MUST_HAVE', preferences: 'CURRENT_OR_OPEN_TO_RELOCATE' },
    { id: '2', priority: 'MUST_HAVE', preferences: 'CURRENT_OR_OPEN_TO_RELOCATE' },
    { id: '3', priority: 'CAN_HAVE', preferences: 'OPEN_TO_RELOCATE_ONLY' },
    { id: '4', priority: 'MUST_HAVE', preferences: 'CURRENT_OR_OPEN_TO_RELOCATE' },
  ]);
});

Deno.test('Recruiter : sociétés par id sur la portée actuelle, par nom avec portée sinon ; les ids numériques sont acceptés', () => {
  const { body } = compileRecruiterBody({ company: [{ id: 11, name: 'Acme', scope: 'CURRENT' }, { id: 12 }, { id: '13', name: 'Gamma', priority: 'MUST_HAVE', scope: 'PAST' }] });
  deepStrictEqual(body.current_company, [{ id: '11', priority: 'CAN_HAVE' }]);
  deepStrictEqual(body.company, [
    { name: '12', id: '12', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: 'Gamma', id: '13', priority: 'MUST_HAVE', preferences: 'PAST' },
  ]);
});

Deno.test('Recruiter : les écoles à revoir (CAN_HAVE) ne sont pas cherchées, les autres le sont en CAN_HAVE ou DOESNT_HAVE', () => {
  deepStrictEqual(compileRecruiterBody({ school: [{ id: 'a' }, { id: 'b', priority: 'CAN_HAVE' }, { id: 'c', priority: 'DOESNT_HAVE' }] }).body.school, [
    { id: 'a', priority: 'CAN_HAVE' },
    { id: 'c', priority: 'DOESNT_HAVE' },
  ]);
});

Deno.test('Recruiter : durées sur 0..30 ans, bornes manquantes complétées, dépassement signalé', () => {
  const { body, adjusted } = compileRecruiterBody({ years_of_experience_min: 5, tenure_at_company_max: 40, graduation_year_max: 2030 });
  deepStrictEqual(body.years_of_experience, { min: 5, max: 30 });
  deepStrictEqual(body.years_in_current_company, { min: 0, max: 30 });
  deepStrictEqual(body.graduation_year, { min: 1900, max: 2030 });
  deepStrictEqual(adjusted.map((a) => a.filter), ['tenure_at_company']);
});

Deno.test('Recruiter : activité de recrutement, la période est toujours élargie jamais réduite', () => {
  const periods = (days: number | null) => {
    const { body, adjusted } = compileRecruiterBody({ activity_messages: 'without_message', activity_messages_days: days });
    return { preferences: (body.recruiting_activity as Array<{ preferences: string }>)[0].preferences, adjusted: adjusted.length };
  };
  deepStrictEqual(periods(7), { preferences: 'PAST_WEEK', adjusted: 0 });
  deepStrictEqual(periods(14), { preferences: 'PAST_2_WEEKS', adjusted: 0 });
  deepStrictEqual(periods(30), { preferences: 'PAST_3_MONTHS', adjusted: 1 });
  deepStrictEqual(periods(60), { preferences: 'PAST_3_MONTHS', adjusted: 1 });
  deepStrictEqual(periods(90), { preferences: 'PAST_3_MONTHS', adjusted: 0 });
  deepStrictEqual(periods(180), { preferences: 'PAST_6_MONTHS', adjusted: 0 });
  deepStrictEqual(periods(365), { preferences: 'PAST_YEAR', adjusted: 0 });
  deepStrictEqual(periods(3650), { preferences: 'ANYTIME', adjusted: 0 });
  deepStrictEqual(periods(null), { preferences: 'ANYTIME', adjusted: 0 });
});

Deno.test('Recruiter : les valeurs inconnues sont écartées et signalées plutôt qu’envoyées', () => {
  const { body, dropped } = compileRecruiterBody({
    spotlight: 'INVENTE',
    employment_type: ['full_time', 'FREELANCE'],
    seniority: ['directeur', 'vp', 'zzz'],
    degree: [{ id: 'abc' }, { id: '50' }],
  });
  strictEqual(body.spotlights, undefined);
  deepStrictEqual(body.employment_type, ['FULL_TIME']);
  deepStrictEqual(body.seniority, ['DIRECTOR', 'VP']);
  deepStrictEqual(body.degree, { include: ['50'] });
  deepStrictEqual(pairs(dropped), ['degree:value', 'employment_type:value', 'seniority:value', 'spotlight:value']);
});

Deno.test('Recruiter : tailles d’entreprise, une tranche dont le minimum n’existe pas est écartée, une borne haute inconnue est élargie', () => {
  const { body, dropped, adjusted } = compileRecruiterBody({ company_headcount: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'Z'] });
  deepStrictEqual(body.company_size, [
    { min: 1, max: 10 },
    { min: 1, max: 10 },
    { min: 51, max: 200 },
    { min: 201, max: 500 },
    { min: 501, max: 1000 },
    { min: 1001, max: 5000 },
    { min: 5001, max: 10000 },
    { min: 10001 },
  ]);
  deepStrictEqual(dropped.map((d) => d.detail).sort(), ['11-50', 'Z']);
  deepStrictEqual(adjusted.map((a) => a.filter), ['company_headcount']);
});

Deno.test('la catégorie d’entreprise donne des tailles seulement si aucune taille n’est choisie', () => {
  deepStrictEqual(compileSalesNavigatorBody({ company_category: 'enterprise' }).body.company_headcount, [{ min: 1001, max: 5000 }, { min: 5001, max: 10000 }, { min: 10001 }]);
  deepStrictEqual(compileSalesNavigatorBody({ company_category: 'enterprise', company_headcount: ['D'] }).body.company_headcount, [{ min: 51, max: 200 }]);
  deepStrictEqual(compileSalesNavigatorBody({ company_category: 'inconnue' }).body, {});
});

Deno.test('Sales Navigator : paliers d’ancienneté arrondis vers le large, une borne hors paliers reste ouverte', () => {
  const years = (min: number | null, max: number | null) => compileSalesNavigatorBody({ tenure_at_role_min: min, tenure_at_role_max: max }).body.years_in_position;
  deepStrictEqual(years(3, 5), [{ min: 3, max: 5 }]);
  deepStrictEqual(years(4, 4), [{ min: 3, max: 5 }]);
  deepStrictEqual(years(7, null), [{ min: 6 }]);
  deepStrictEqual(years(null, 8), [{ max: 10 }]);
  deepStrictEqual(years(0, null), undefined); // 0 n'est pas un palier : aucune borne ne reste
  deepStrictEqual(years(null, 12), undefined);
  deepStrictEqual(years(null, null), undefined);
});

Deno.test('Sales Navigator : séniorité par niveau de l’interface ou par mot, énumération du fournisseur', () => {
  const body = compileSalesNavigatorBody({ seniority: ['1', '2', '5', '7', '8', '9', '10', 'in_training', 'owner/partner', 'experienced_manager'] }).body;
  deepStrictEqual(body.seniority, {
    include: ['ENTRY_LEVEL', 'EXPERIENCED_MANAGER', 'VICE_PRESIDENT', 'CXO', 'OWNER/PARTNER', 'IN_TRAINING'],
  });
});

Deno.test('Sales Navigator : types d’entreprise, lettres de l’interface et énumération, le reste est signalé', () => {
  const { body, dropped } = compileSalesNavigatorBody({ company_type: ['C', 'O', 'E', 'S', 'P', 'G', 'D', 'SELF_OWNED', 'self_owned', 'X'] });
  deepStrictEqual(body.company_type, [
    'PUBLIC_COMPANY',
    'PRIVATELY_HELD',
    'NON_PROFIT',
    'EDUCATIONAL_INSTITUTION',
    'PARTNERSHIP',
    'SELF_EMPLOYED',
    'GOVERNMENT_AGENCY',
    'SELF_OWNED',
  ]);
  deepStrictEqual(dropped.map((d) => d.detail), ['X']);
});

Deno.test('Sales Navigator : un poste exclu ou passé va dans la bonne paire, une société à portée passée dans past_company', () => {
  const { body } = compileSalesNavigatorBody({
    role: [
      { keywords: 'Stagiaire', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
      { keywords: 'Ancien CTO', priority: 'MUST_HAVE', scope: 'PAST' },
    ],
    job_title: [{ id: 'jt1', priority: 'DOESNT_HAVE' }],
    company: [{ id: 'c1', scope: 'PAST' }, { id: 'c2', scope: 'PAST_NOT_CURRENT', priority: 'DOESNT_HAVE' }],
  });
  deepStrictEqual(body.current_job_title, { exclude: ['jt1', 'Stagiaire'] });
  deepStrictEqual(body.past_job_title, { include: ['Ancien CTO'] });
  deepStrictEqual(body.past_company, { include: ['c1'], exclude: ['c2'] });
  strictEqual(body.current_company, undefined);
});

Deno.test('classic : une société à portée passée devient past_company, les exclusions sont retirées et signalées', () => {
  const { body, dropped } = compileClassicBody({
    company: [{ id: 'c1', scope: 'PAST' }, { id: 'c2' }, { id: 'c3', priority: 'DOESNT_HAVE' }],
    past_company: { include: ['p1'], exclude: ['p2'] },
    location: [{ id: 'l1', scope: 'OPEN_TO_RELOCATE_ONLY' }],
  });
  deepStrictEqual(body.current_company, ['c2']);
  deepStrictEqual(body.past_company, ['c1', 'p1']);
  deepStrictEqual(pairs(dropped), ['company:exclusion', 'location:scope', 'past_company:exclusion']);
});

Deno.test('classic : la langue du profil est un code de deux lettres, le reste est signalé', () => {
  const { body, dropped } = compileClassicBody({ profile_language: ['FR', 'en', 'français', 'fr'] });
  deepStrictEqual(body.profile_language, ['fr', 'en']);
  deepStrictEqual(dropped.map((d) => d.detail), ['français']);
});

Deno.test('classic : le degré de relation accepte 1, 2, 3 et les chaînes, pas GROUP ; Recruiter et Sales Navigator acceptent GROUP', () => {
  deepStrictEqual(compileClassicBody({ network_distance: [1, '2', 'GROUP', 4, 3, 1] }).body.network_distance, [1, 2, 3]);
  deepStrictEqual(compileRecruiterBody({ network_distance: [1, 'GROUP', 'group'] }).body.network_distance, [1, 'GROUP']);
  deepStrictEqual(compileSalesNavigatorBody({ network_distance: ['3', 'GROUP'] }).body.network_distance, [3, 'GROUP']);
});

Deno.test('des clés comme constructor ou __proto__ saisies par l’utilisateur ne touchent pas les tables internes', () => {
  const { dropped } = compileSalesNavigatorBody({
    seniority: ['constructor', '__proto__', 'toString'],
    company_headcount: ['constructor', '__proto__'],
    company_type: ['constructor', 'hasOwnProperty'],
    company_category: 'constructor',
  });
  ok(dropped.length >= 5);
  const recruiter = compileRecruiterBody({ seniority: ['constructor'], company_category: '__proto__' });
  deepStrictEqual(recruiter.body, {});
});

Deno.test('entrées illisibles : jamais d’exception, le corps reste vide', () => {
  for (const product of ['classic', 'recruiter', 'sales_navigator'] as const) {
    const bad = {
      api: product,
      location: [null, 5, {}, { name: 'sans id' }, [], 'x'],
      company: 'nope',
      industry: { include: 'x', exclude: [null] },
      seniority: [null, 5, ''],
      network_distance: 'x',
      company_headcount: [null],
      role: [{ keywords: '' }, null],
      spoken_languages: [null, {}],
    } as unknown as KonektSearchFilters;
    const compiled = toKonektFilters(bad);
    assertBodyKeys(product, compiled.body);
  }
});

Deno.test('les libellés des filtres sont en français, vouvoiement ou noms, sans tiret long ni nom de fournisseur', () => {
  for (const [key, label] of Object.entries(FILTER_LABELS_FR)) {
    ok(label.length > 0, key);
    ok(!label.includes('—') && !label.includes('–'), label);
    ok(!/unipile|apollo|people data|anthropic/i.test(label), label);
  }
});

Deno.test('les fixtures de recherche sont marquées : base du schéma, valeurs inventées', () => {
  for (const fixture of [searchClassic, searchRecruiter, searchSalesNavigator]) {
    strictEqual(fixture._meta.basis, 'schema-derived');
    strictEqual(fixture._meta.values, 'synthetic');
  }
  ok(Array.isArray((searchRecruiter._meta as { inferred?: string[] }).inferred));
});

// ---------------------------------------------------------------------------
// Intégration avec les clients de recherche (qui refusent toute clé hors liste)
// ---------------------------------------------------------------------------

Deno.test('intégration : le corps et la requête compilés passent les garde-fous des clients de recherche, chemin et pagination compris', async () => {
  for (const product of ['classic', 'recruiter', 'sales_navigator'] as const) {
    const compiled = toKonektFilters({ ...richState(), api: product }, { cursor: product === 'sales_navigator' ? 'offset:25' : 'cur_2', limit: 40 });
    await withMockTransport(
      () => ({ body: { data: [{ object: 'PeopleSearchResult', id: 'ACoAAx', display_name: 'Test', network_distance: 'FIRST_DEGREE', product }], total_count: 1 } }),
      async (mock) => {
        const page = product === 'classic'
          ? await searchClassicPeople('acc_test', compiled.body as ClassicPeopleFilters, { cursor: compiled.query.cursor as string }, mock.options)
          : product === 'recruiter'
          ? await searchRecruiterPeople('acc_test', compiled.body as RecruiterPeopleFilters, { cursor: compiled.query.cursor as string, limit: compiled.query.limit as number }, mock.options)
          : await searchSalesNavigatorPeople('acc_test', compiled.body as SalesNavigatorPeopleFilters, { offset: compiled.query.offset as number, limit: compiled.query.limit as number }, mock.options);
        strictEqual(mock.calls.length, 1);
        const call = mock.calls[0];
        strictEqual(call.method, 'POST');
        strictEqual(call.path, `/acc_test/${compiled.segments.join('/')}`);
        deepStrictEqual(call.body, compiled.body);
        deepStrictEqual(Object.fromEntries(call.query.entries()), Object.fromEntries(Object.entries(compiled.query).map(([k, v]) => [k, String(v)])));
        // Et la réponse revient dans l'ancienne forme.
        const legacy = toKonektSearchResults(page, { product, offset: Number(compiled.query.offset ?? 0) });
        strictEqual(legacy.results[0].id, 'ACoAAx');
        strictEqual(legacy.results[0].network_distance, 'DISTANCE_1');
        strictEqual(legacy.total, 1);
      },
    );
  }
});
