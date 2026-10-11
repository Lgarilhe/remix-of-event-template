// LinkedIn : recherche par licence (classique, Recruiter, Sales Navigator),
// recherche depuis une adresse collée, paramètres de recherche, crédits InMail,
// contrats et projets Recruiter. Chaque appel est joué contre un transport
// factice qui vérifie l'URL, la méthode, la requête et le corps ; l'analyse des
// adresses collées est testée par table d'exemples.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/linkedin.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { isUnipileError } from './errors.ts';
import { OutdatedAccountIdError } from './ids.ts';
import {
  getInmailCredits,
  listContracts,
  listRecruiterProjects,
  resolveSearchUrl,
  searchClassicCompanies,
  searchClassicJobs,
  searchClassicPeople,
  searchClassicPosts,
  searchFromUrl,
  searchParameters,
  searchRecruiterPeople,
  searchSalesNavigatorCompanies,
  searchSalesNavigatorPeople,
  selectContract,
  type SearchUrlKind,
  type SearchUrlRefusalReason,
} from './linkedin.ts';
import { fixtures, jsonResponse, withMockTransport } from './testing.ts';

const ACC = 'acc_01abc';
const validation = (e: unknown) => isUnipileError(e) && e.kind === 'validation';

// ---------------------------------------------------------------------------
// Recherche classique
// ---------------------------------------------------------------------------

Deno.test('searchClassicPeople : POST /{acc}/linkedin/search/people, filtres en corps, curseur en requête', async () => {
  await withMockTransport(
    () => jsonResponse(fixtures.page([{ object: 'PeopleSearchResult', id: 'ACoAAxxxxxx', display_name: 'Marie D', network_distance: 'SECOND_DEGREE' }], { nextCursor: 'n2' })),
    async (mock) => {
      const page = await searchClassicPeople(
        ACC,
        {
          keywords: 'product manager', network_distance: [2, 3], location: ['105015875'], current_company: ['1337'], past_company: ['42'],
          school: ['9'], connections_of: 'ACoAAyyyyyy', followers_of: 'ACoAAzzzzzz', industry: ['4'], service: ['s1'],
          profile_language: ['fr'], open_to_volunteering: true,
          advanced_keywords: { first_name: 'Marie', last_name: 'Dupont', title: 'PM', company: 'Acme', school: 'HEC' },
        },
        { cursor: 'c1' },
      );
      strictEqual(page.items[0].display_name, 'Marie D');
      strictEqual(page.nextCursor, 'n2');
      strictEqual(mock.calls[0].method, 'POST');
      strictEqual(mock.calls[0].path, `/${ACC}/linkedin/search/people`);
      deepStrictEqual(Object.fromEntries(mock.calls[0].query), { cursor: 'c1' });
      deepStrictEqual(mock.calls[0].body, {
        keywords: 'product manager', network_distance: [2, 3], location: ['105015875'], current_company: ['1337'], past_company: ['42'],
        school: ['9'], connections_of: 'ACoAAyyyyyy', followers_of: 'ACoAAzzzzzz', industry: ['4'], service: ['s1'],
        profile_language: ['fr'], open_to_volunteering: true,
        advanced_keywords: { first_name: 'Marie', last_name: 'Dupont', title: 'PM', company: 'Acme', school: 'HEC' },
      });
    },
  );
});

Deno.test('searchClassicPeople : sans filtre le corps est vide ; les valeurs indéfinies sont retirées', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await searchClassicPeople(ACC, { keywords: undefined, location: ['1'] });
    deepStrictEqual(mock.calls[0].body, { location: ['1'] });
    await searchClassicPeople(ACC);
    deepStrictEqual(mock.calls[1].body, {});
    strictEqual(mock.calls[1].url, `https://api.unipile.com/v2/${ACC}/linkedin/search/people`);
  });
});

Deno.test('searchClassicPeople : une clé inconnue (reste de l\'ancienne génération) est refusée avant tout appel', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    for (const leftover of [{ api: 'classic' }, { category: 'people' }, { cursor: 'x' }, { limit: 10 }, { role: [{ keywords: 'x' }] }, { skills: ['x'] }]) {
      await rejects(() => searchClassicPeople(ACC, leftover as never), validation);
    }
    await rejects(() => searchClassicPeople(ACC, { advanced_keywords: { job: 'x' } as never }), validation);
    await rejects(() => searchClassicPeople(ACC, {}, { limit: 10 } as never), validation);
    await rejects(() => searchClassicPeople(ACC, {}, { offset: 10 } as never), validation);
    await rejects(() => searchClassicPeople('old-id'), OutdatedAccountIdError);
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('searchClassicPeople : une recherche est rejouée après un 503 (lecture sans effet)', async () => {
  let n = 0;
  await withMockTransport(() => (n++ === 0 ? new Response('boom', { status: 503 }) : jsonResponse(fixtures.page([]))), async (mock) => {
    await searchClassicPeople(ACC, { keywords: 'x' });
    strictEqual(mock.calls.length, 2);
  });
});

Deno.test('une recherche qui enregistre (save_search, save_custom_filter) n’est jamais rejouée', async () => {
  for (const [name, call] of [
    ['recruiter save_search', () => searchRecruiterPeople(ACC, { save_search: { name: 'n', project_id: 'p' } })],
    ['recruiter save_custom_filter', () => searchRecruiterPeople(ACC, { save_custom_filter: { name: 'n' } })],
    ['sales navigator save_search', () => searchSalesNavigatorPeople(ACC, { save_search: { name: 'n' } })],
  ] as const) {
    await withMockTransport(() => new Response('boom', { status: 503 }), async (mock) => {
      await rejects(call, (e: unknown) => isUnipileError(e) && e.kind === 'uncertain', name);
      strictEqual(mock.calls.length, 1, name);
    });
  }
  // Une recherche en lecture seule reste rejouée.
  let n = 0;
  await withMockTransport(() => (n++ === 0 ? new Response('boom', { status: 503 }) : jsonResponse(fixtures.page([]))), async (mock) => {
    await searchRecruiterPeople(ACC, { keywords: 'x' });
    strictEqual(mock.calls.length, 2);
  });
});

Deno.test('searchClassicCompanies : POST .../search/companies, curseur seul', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'CompanySearchResult', id: 'c1', display_name: 'Acme' }])), async (mock) => {
    await searchClassicCompanies(ACC, {
      keywords: 'saas', location: ['1'], industry: ['4'], headcount: [{ min: 11, max: 50 }], has_job_postings: true, is_employing_relations: false,
    }, { cursor: 'c2' });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/search/companies`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { cursor: 'c2' });
    deepStrictEqual(mock.calls[0].body, {
      keywords: 'saas', location: ['1'], industry: ['4'], headcount: [{ min: 11, max: 50 }], has_job_postings: true, is_employing_relations: false,
    });
    await rejects(() => searchClassicCompanies(ACC, { company_size: 3 } as never), validation);
  });
});

Deno.test('searchClassicPosts : POST .../search/posts, curseur et limit 1 à 49', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await searchClassicPosts(ACC, {
      keywords: 'recrutement', sort_by: 'DATE', date_posted: 'PAST_WEEK', content_type: 'IMAGES',
      posted_by: { member: ['m1'], me: false }, mentioning: { company: ['c1'] }, author: { keywords: 'rh', industry: ['4'] },
    }, { cursor: 'c3', limit: 49 });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/search/posts`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { cursor: 'c3', limit: '49' });
    deepStrictEqual(mock.calls[0].body, {
      keywords: 'recrutement', sort_by: 'DATE', date_posted: 'PAST_WEEK', content_type: 'IMAGES',
      posted_by: { member: ['m1'], me: false }, mentioning: { company: ['c1'] }, author: { keywords: 'rh', industry: ['4'] },
    });
    await rejects(() => searchClassicPosts(ACC, {}, { limit: 50 }), validation);
    await rejects(() => searchClassicPosts(ACC, {}, { limit: 0 }), validation);
    await rejects(() => searchClassicPosts(ACC, { posted_by: { everyone: true } as never }), validation);
    await rejects(() => searchClassicPosts(ACC, {}, { offset: 3 } as never), validation);
  });
});

Deno.test('searchClassicJobs : POST .../search/jobs, offset et limit en requête', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'JobSearchResult', id: 'j1', title: 'Dev' }])), async (mock) => {
    await searchClassicJobs(ACC, {
      keywords: 'react', workplace_type: ['REMOTE'], seniority: ['ENTRY_LEVEL'], employment_status: ['FULL_TIME'], location: ['1'],
      location_radius: 40, easy_apply: true, salary: { currency: 'GBP', starting_from: 50 },
    }, { offset: 50, limit: 25 });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/search/jobs`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { offset: '50', limit: '25' });
    deepStrictEqual(mock.calls[0].body, {
      keywords: 'react', workplace_type: ['REMOTE'], seniority: ['ENTRY_LEVEL'], employment_status: ['FULL_TIME'], location: ['1'],
      location_radius: 40, easy_apply: true, salary: { currency: 'GBP', starting_from: 50 },
    });
    await rejects(() => searchClassicJobs(ACC, {}, { limit: 101 }), validation);
    await rejects(() => searchClassicJobs(ACC, {}, { limit: 1.5 }), validation);
    await rejects(() => searchClassicJobs(ACC, {}, { cursor: 'x' } as never), validation);
  });
});

// ---------------------------------------------------------------------------
// Recruiter et Sales Navigator
// ---------------------------------------------------------------------------

Deno.test('searchRecruiterPeople : POST .../recruiter/search/people, curseur et limit, filtres structurés', async () => {
  await withMockTransport(
    () => jsonResponse(fixtures.page([{ object: 'PeopleSearchResult', id: 'r1', visibility: 'partial', candidate_id: 'cand1', work_experience: [] }])),
    async (mock) => {
      const page = await searchRecruiterPeople(
        ACC,
        {
          keywords: 'java', spotlights: ['OPEN_TO_WORK'], network_distance: [1, 'GROUP'],
          location: [{ id: 'loc1', priority: 'MUST_HAVE', preferences: 'CURRENT' }],
          job_title: [{ name: 'Développeur', id: 't1', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' }],
          skills: [{ name: 'Java', priority: 'MUST_HAVE' }], current_company: [{ id: 'co1' }],
          years_of_experience: { min: 3, max: 10 }, industry: { include: ['4'], exclude: ['7'] }, seniority: ['SENIOR', 'MANAGER'],
          recruiting_activity: [{ type: 'messages', preferences: 'PAST_WEEK' }], hide_previously_viewed: { timespan: 'PAST_MONTH' },
          load_saved_search: { id: 'ss1', new_results_only: true }, tags: { include: ['t'] },
        },
        { cursor: 'c1', limit: 100 },
      );
      strictEqual(page.items[0].visibility, 'partial');
      strictEqual(mock.calls[0].path, `/${ACC}/linkedin/recruiter/search/people`);
      deepStrictEqual(Object.fromEntries(mock.calls[0].query), { cursor: 'c1', limit: '100' });
      deepStrictEqual((mock.calls[0].body as Record<string, unknown>).location, [{ id: 'loc1', priority: 'MUST_HAVE', preferences: 'CURRENT' }]);
      deepStrictEqual((mock.calls[0].body as Record<string, unknown>).years_of_experience, { min: 3, max: 10 });
      deepStrictEqual(Object.keys(mock.calls[0].body as object).sort(), [
        'hide_previously_viewed', 'industry', 'job_title', 'keywords', 'load_saved_search', 'location', 'network_distance',
        'recruiting_activity', 'seniority', 'skills', 'spotlights', 'tags', 'years_of_experience', 'current_company',
      ].sort());
    },
  );
});

Deno.test('searchRecruiterPeople : « scope », « tenure », offset ou limit 101 refusés', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await rejects(() => searchRecruiterPeople(ACC, { scope: 'x' } as never), validation);
    await rejects(() => searchRecruiterPeople(ACC, { tenure: { min: 1 } } as never), validation);
    await rejects(() => searchRecruiterPeople(ACC, { hiring_projects: { include: ['1'] } } as never), validation);
    await rejects(() => searchRecruiterPeople(ACC, {}, { offset: 3 } as never), validation);
    await rejects(() => searchRecruiterPeople(ACC, {}, { limit: 101 }), validation);
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('searchSalesNavigatorPeople : POST .../sales-navigator/search/people, offset et limit', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'PeopleSearchResult', id: 's1', display_name: 'X', network_distance: 'FIRST_DEGREE' }])), async (mock) => {
    await searchSalesNavigatorPeople(ACC, {
      keywords: 'cto', current_company: { include: ['1'], exclude: ['2'] }, seniority: { include: ['CXO', 'OWNER/PARTNER'] },
      years_in_position: [{ min: 1, max: 2 }], network_distance: [1, 2], recent_interaction: { messaged: false },
      load_saved_search: { id: 'ss', last_viewed_at: 1760000000 },
    }, { offset: 25, limit: 100 });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/sales-navigator/search/people`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { offset: '25', limit: '100' });
    deepStrictEqual(mock.calls[0].body, {
      keywords: 'cto', current_company: { include: ['1'], exclude: ['2'] }, seniority: { include: ['CXO', 'OWNER/PARTNER'] },
      years_in_position: [{ min: 1, max: 2 }], network_distance: [1, 2], recent_interaction: { messaged: false },
      load_saved_search: { id: 'ss', last_viewed_at: 1760000000 },
    });
    await rejects(() => searchSalesNavigatorPeople(ACC, {}, { cursor: 'x' } as never), validation);
    await rejects(() => searchSalesNavigatorPeople(ACC, { tenure_at_role: [] } as never), validation);
    await rejects(() => searchSalesNavigatorPeople(ACC, {}, { limit: 101 }), validation);
  });
});

Deno.test('searchSalesNavigatorCompanies : POST .../sales-navigator/search/companies', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'CompanySearchResult', id: 'c1', display_name: 'Acme' }])), async (mock) => {
    await searchSalesNavigatorCompanies(ACC, {
      keywords: 'fintech', annual_revenue: { currency: 'EUR', min: 1, max: 10 }, headcount: [{ min: 51, max: 200 }],
      headcount_growth: { min: 5, max: 50 }, spotlights: ['RECENT_FUNDING_EVENTS'], department_headcount: { department: 'jf1', min: 1, max: 10 },
    }, { limit: 50 });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/sales-navigator/search/companies`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { limit: '50' });
    deepStrictEqual(Object.keys(mock.calls[0].body as object).sort(), [
      'annual_revenue', 'department_headcount', 'headcount', 'headcount_growth', 'keywords', 'spotlights',
    ]);
    await rejects(() => searchSalesNavigatorCompanies(ACC, { employee_count: 5 } as never), validation);
  });
});

// ---------------------------------------------------------------------------
// Recherche depuis une adresse
// ---------------------------------------------------------------------------

Deno.test('searchFromUrl : classique, POST .../linkedin/search {url}, offset, limit et curseur', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'PeopleSearchResult', id: 'p1' }])), async (mock) => {
    const url = 'https://www.linkedin.com/search/results/people/?keywords=cto';
    const resolved = resolveSearchUrl(url);
    ok(resolved.ok);
    if (!resolved.ok) return;
    const page = await searchFromUrl(ACC, resolved, { cursor: 'c', offset: 10, limit: 100 });
    strictEqual(page.items[0].object, 'PeopleSearchResult');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/search`);
    deepStrictEqual(mock.calls[0].body, { url });
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { cursor: 'c', offset: '10', limit: '100' });
    await rejects(() => searchFromUrl(ACC, resolved, { limit: 101 }), validation);
  });
});

Deno.test('searchFromUrl : Recruiter (curseur, limit jusqu\'à 5000) et Sales Navigator (offset, limit jusqu\'à 50)', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    const recruiter = resolveSearchUrl('https://www.linkedin.com/talent/search?searchContextId=a&searchHistoryId=1&searchRequestId=2');
    const sales = resolveSearchUrl('https://www.linkedin.com/sales/search/people?query=(keywords:cto)');
    if (!recruiter.ok || !sales.ok) throw new Error('urls attendues valides');
    await searchFromUrl(ACC, recruiter, { cursor: 'c', limit: 5000 });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/recruiter/search`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { cursor: 'c', limit: '5000' });
    deepStrictEqual(mock.calls[0].body, { url: recruiter.url });
    await searchFromUrl(ACC, sales, { offset: 10, limit: 50 });
    strictEqual(mock.calls[1].path, `/${ACC}/linkedin/sales-navigator/search`);
    deepStrictEqual(Object.fromEntries(mock.calls[1].query), { offset: '10', limit: '50' });
    await rejects(() => searchFromUrl(ACC, recruiter, { offset: 5 }), validation);
    await rejects(() => searchFromUrl(ACC, recruiter, { limit: 5001 }), validation);
    await rejects(() => searchFromUrl(ACC, sales, { cursor: 'c' }), validation);
    await rejects(() => searchFromUrl(ACC, sales, { limit: 51 }), validation);
    strictEqual(mock.calls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// resolveSearchUrl : table d'exemples
// ---------------------------------------------------------------------------

interface UrlCase {
  name: string;
  input: unknown;
  licence?: 'classic' | 'recruiter' | 'sales_navigator';
  kind?: SearchUrlKind;
  keywords?: string | null;
  filterKeys?: string[];
  projectId?: string | null;
  url?: string;
  refusal?: SearchUrlRefusalReason;
}

const SN_PEOPLE_QUERY = 'https://www.linkedin.com/sales/search/people?query=(recentSearchParam:(id:4172052316,doLogHistory:true),'
  + 'filters:List((type:CURRENT_COMPANY,values:List((id:urn%3Ali%3Aorganization%3A1337,text:Acme,selectionType:INCLUDED))),'
  + '(type:INDUSTRY,values:List((id:6,text:Software,selectionType:INCLUDED)))),keywords:product%20manager)&sessionId=xyz';

const URL_CASES: UrlCase[] = [
  {
    name: 'classique, personnes, mots-clés simples',
    input: 'https://www.linkedin.com/search/results/people/?keywords=product%20manager&origin=GLOBAL_SEARCH_HEADER',
    licence: 'classic', kind: 'classic_people', keywords: 'product manager', filterKeys: [],
  },
  {
    name: 'classique, personnes, filtres géographie et réseau, bruit de suivi ignoré',
    input: 'https://www.linkedin.com/search/results/people/?keywords=ceo&geoUrn=%5B%22105015875%22%5D&network=%5B%22F%22%5D&origin=FACETED_SEARCH&sid=abc&page=2',
    licence: 'classic', kind: 'classic_people', keywords: 'ceo', filterKeys: ['geoUrn', 'network'],
  },
  {
    name: 'classique, sans schéma, la barre oblique finale est facultative',
    input: 'linkedin.com/search/results/people?keywords=cto',
    licence: 'classic', kind: 'classic_people', keywords: 'cto', url: 'https://linkedin.com/search/results/people?keywords=cto',
  },
  {
    name: 'classique, sous-domaine régional, + lu comme une espace, adresse entourée d\'espaces',
    input: '  https://fr.linkedin.com/search/results/people/?keywords=dev+backend  ',
    licence: 'classic', kind: 'classic_people', keywords: 'dev backend', url: 'https://fr.linkedin.com/search/results/people/?keywords=dev+backend',
  },
  {
    name: 'classique, personnes, sans mots-clés',
    input: 'https://www.linkedin.com/search/results/people/?currentCompany=%5B%221337%22%5D&titleFreeText=cto',
    licence: 'classic', kind: 'classic_people', keywords: null, filterKeys: ['currentCompany', 'titleFreeText'],
  },
  {
    name: 'classique, entreprises',
    input: 'https://www.linkedin.com/search/results/companies/?keywords=fintech&industry=%5B%224%22%5D',
    licence: 'classic', kind: 'classic_companies', keywords: 'fintech', filterKeys: ['industry'],
  },
  {
    name: 'classique, publications',
    input: 'https://www.linkedin.com/search/results/content/?keywords=recrutement&datePosted=%22past-week%22',
    licence: 'classic', kind: 'classic_posts', keywords: 'recrutement', filterKeys: ['datePosted'],
  },
  {
    name: 'classique, offres d\'emploi',
    input: 'https://www.linkedin.com/jobs/search/?keywords=data%20engineer&location=Paris&f_TPR=r86400',
    licence: 'classic', kind: 'classic_jobs', keywords: 'data engineer', filterKeys: ['f_TPR', 'location'],
  },
  {
    name: 'classique, offres d\'emploi, nouvelle mise en page',
    input: 'https://www.linkedin.com/jobs/search-results/?keywords=react',
    licence: 'classic', kind: 'classic_jobs', keywords: 'react',
  },
  {
    name: 'Recruiter, recherche libre, sans mots-clés',
    input: 'https://www.linkedin.com/talent/search?searchContextId=abc&searchHistoryId=1&searchRequestId=2&start=0',
    licence: 'recruiter', kind: 'recruiter_search', keywords: null, filterKeys: [], projectId: null,
  },
  {
    name: 'Recruiter, recherche dans un projet',
    input: 'https://www.linkedin.com/talent/hire/1234567/discover/recruiterSearch?searchContextId=abc',
    licence: 'recruiter', kind: 'recruiter_search', projectId: '1234567',
  },
  {
    name: 'Recruiter, candidatures d\'un projet',
    input: 'https://www.linkedin.com/talent/hire/1234567/discover/applicants?searchContextId=abc',
    licence: 'recruiter', kind: 'recruiter_applicants', projectId: '1234567',
  },
  {
    name: 'Recruiter, pipeline d\'un projet',
    input: 'https://www.linkedin.com/talent/hire/1234567/manage/all',
    licence: 'recruiter', kind: 'recruiter_pipeline', projectId: '1234567',
  },
  {
    name: 'Sales Navigator, personnes, requête Rest.li avec mots-clés et deux filtres',
    input: SN_PEOPLE_QUERY,
    licence: 'sales_navigator', kind: 'sales_navigator_people', keywords: 'product manager',
    filterKeys: ['CURRENT_COMPANY', 'INDUSTRY', 'recentSearchParam'],
  },
  {
    name: 'Sales Navigator, entreprises',
    input: 'https://www.linkedin.com/sales/search/company?query=(filters:List((type:INDUSTRY,values:List((id:4,text:Tech,selectionType:INCLUDED)))),keywords:saas)',
    licence: 'sales_navigator', kind: 'sales_navigator_companies', keywords: 'saas', filterKeys: ['INDUSTRY'],
  },
  {
    name: 'Sales Navigator, recherche enregistrée',
    input: 'https://www.linkedin.com/sales/search/people?savedSearchId=555&viewAllFilters=true',
    licence: 'sales_navigator', kind: 'sales_navigator_people', keywords: null, filterKeys: ['savedSearchId'],
  },
  {
    name: 'Sales Navigator, liste de leads',
    input: 'https://www.linkedin.com/sales/lists/people/7654321?sortCriteria=CREATED_TIME',
    licence: 'sales_navigator', kind: 'sales_navigator_lead_list',
  },
  {
    name: 'Sales Navigator, liste de comptes',
    input: 'https://www.linkedin.com/sales/lists/company/123',
    licence: 'sales_navigator', kind: 'sales_navigator_account_list',
  },
  { name: 'refus, recherche « tout » non prise en charge', input: 'https://www.linkedin.com/search/results/all/?keywords=x', refusal: 'unsupported_search' },
  { name: 'refus, recherche de groupes non prise en charge', input: 'https://www.linkedin.com/search/results/groups/?keywords=x', refusal: 'unsupported_search' },
  { name: 'refus, Recruiter, onglet non pris en charge', input: 'https://www.linkedin.com/talent/hire/1234567/discover/automatedsourcing', refusal: 'unsupported_search' },
  { name: 'refus, page de résultats sans catégorie', input: 'https://www.linkedin.com/search/results/', refusal: 'not_a_search' },
  { name: 'refus, profil', input: 'https://www.linkedin.com/in/john-doe/', refusal: 'not_a_search' },
  { name: 'refus, fil d\'actualité', input: 'https://www.linkedin.com/feed/', refusal: 'not_a_search' },
  { name: 'refus, accueil Recruiter', input: 'https://www.linkedin.com/talent/home', refusal: 'not_a_search' },
  { name: 'refus, accueil Sales Navigator', input: 'https://www.linkedin.com/sales/home', refusal: 'not_a_search' },
  { name: 'refus, autre site', input: 'https://www.google.com/search?q=linkedin', refusal: 'not_linkedin' },
  { name: 'refus, domaine déguisé', input: 'https://linkedin.com.exemple.test/search/results/people/?keywords=x', refusal: 'not_linkedin' },
  { name: 'refus, domaine voisin', input: 'https://notlinkedin.com/search/results/people/?keywords=x', refusal: 'not_linkedin' },
  { name: 'refus, texte quelconque', input: 'pas une adresse', refusal: 'invalid_url' },
  { name: 'refus, chaîne vide', input: '   ', refusal: 'invalid_url' },
  { name: 'refus, protocole javascript', input: 'javascript:alert(1)', refusal: 'invalid_url' },
  { name: 'refus, protocole ftp', input: 'ftp://linkedin.com/search/results/people/', refusal: 'invalid_url' },
  { name: 'refus, valeur qui n\'est pas du texte', input: 42, refusal: 'invalid_url' },
];

Deno.test('resolveSearchUrl : table d\'exemples (au moins 10 adresses)', () => {
  ok(URL_CASES.length >= 10);
  for (const c of URL_CASES) {
    const result = resolveSearchUrl(c.input);
    if (c.refusal) {
      strictEqual(result.ok, false, c.name);
      if (!result.ok) {
        strictEqual(result.reason, c.refusal, c.name);
        ok(result.message.length > 20, `${c.name} : message en français`);
        ok(!/unipile/i.test(result.message), `${c.name} : aucun nom de fournisseur`);
        ok(!result.message.includes('—'), `${c.name} : pas de tiret cadratin`);
      }
      continue;
    }
    strictEqual(result.ok, true, c.name);
    if (!result.ok) continue;
    strictEqual(result.licence, c.licence, `${c.name} : licence`);
    strictEqual(result.kind, c.kind, `${c.name} : genre`);
    if (c.keywords !== undefined) strictEqual(result.keywords, c.keywords, `${c.name} : mots-clés`);
    if (c.filterKeys !== undefined) deepStrictEqual([...result.filterKeys], c.filterKeys, `${c.name} : filtres`);
    if (c.projectId !== undefined) strictEqual(result.projectId, c.projectId, `${c.name} : projet`);
    strictEqual(result.url, c.url ?? (c.input as string), `${c.name} : adresse envoyée`);
  }
});

Deno.test('resolveSearchUrl : pure, ne lève jamais, résultat identique à chaque appel', () => {
  for (const weird of [null, undefined, {}, [], 'https://', 'http://[', 'https://www.linkedin.com/%E0%A4%A', '(((', 'https://linkedin.com/sales/search/people?query=((((']) {
    const first = resolveSearchUrl(weird);
    deepStrictEqual(resolveSearchUrl(weird), first);
    strictEqual(typeof first.ok, 'boolean');
  }
});

// ---------------------------------------------------------------------------
// Paramètres de recherche
// ---------------------------------------------------------------------------

Deno.test('searchParameters classique : GET .../search/parameters ?type & keywords & offset & limit', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'SearchParameter', id: '105015875', name: 'France' }])), async (mock) => {
    const page = await searchParameters(ACC, { licence: 'classic', type: 'LOCATION', keywords: 'fra' }, { offset: 0, limit: 10 });
    strictEqual(page.items[0].name, 'France');
    strictEqual(mock.calls[0].method, 'GET');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/search/parameters`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { type: 'LOCATION', keywords: 'fra', offset: '0', limit: '10' });
    strictEqual(mock.calls[0].body, null);
    await rejects(() => searchParameters(ACC, { licence: 'classic', type: 'SENIORITY' as 'LOCATION', keywords: 'x' }), validation);
    await rejects(() => searchParameters(ACC, { licence: 'classic', type: 'LOCATION' } as never), validation);
    await rejects(() => searchParameters(ACC, { licence: 'classic', type: 'LOCATION', keywords: 'x' }, { limit: 101 }), validation);
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('searchParameters Sales Navigator : GET .../sales-navigator/search/parameters', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await searchParameters(ACC, { licence: 'sales_navigator', type: 'SAVED_PEOPLE_SEARCH', keywords: 'dir' }, { limit: 20 });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/sales-navigator/search/parameters`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { type: 'SAVED_PEOPLE_SEARCH', keywords: 'dir', limit: '20' });
    await searchParameters(ACC, { licence: 'sales_navigator', type: 'RECENT_SEARCH' });
    deepStrictEqual(Object.fromEntries(mock.calls[1].query), { type: 'RECENT_SEARCH' });
    await rejects(() => searchParameters(ACC, { licence: 'sales_navigator', type: 'SKILL' as 'GROUP' }), validation);
  });
});

Deno.test('searchParameters Recruiter : POST .../recruiter/search/parameters, corps par source', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'SearchParameter', id: 'sk1', name: 'Java' }])), async (mock) => {
    await searchParameters(ACC, { licence: 'recruiter', source: 'SEARCH', type: 'SKILL', keywords: 'jav' }, { limit: 10 });
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/recruiter/search/parameters`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { limit: '10' });
    deepStrictEqual(mock.calls[0].body, { source: 'SEARCH', type: 'SKILL', keywords: 'jav' });

    await searchParameters(ACC, { licence: 'recruiter', source: 'APPLICANTS', project_id: '42', type: 'TAG', keywords: 'vip' });
    deepStrictEqual(mock.calls[1].body, { source: 'APPLICANTS', project_id: '42', type: 'TAG', keywords: 'vip' });

    await searchParameters(ACC, { licence: 'recruiter', source: 'PIPELINE', project_id: '42', type: 'SEAT', stage_id: 'st1' });
    deepStrictEqual(mock.calls[2].body, { source: 'PIPELINE', project_id: '42', type: 'SEAT', stage_id: 'st1' });

    await searchParameters(ACC, { licence: 'recruiter', source: 'JOBS', type: 'CONTRACT' });
    deepStrictEqual(mock.calls[3].body, { source: 'JOBS', type: 'CONTRACT' });

    await searchParameters(ACC, { licence: 'recruiter', source: 'JOB_POSTING', type: 'SAVED_SEARCH' });
    deepStrictEqual(mock.calls[4].body, { source: 'JOB_POSTING', type: 'SAVED_SEARCH' });
  });
});

Deno.test('searchParameters Recruiter : type hors source, projet manquant ou champ étranger refusés', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await rejects(() => searchParameters(ACC, { licence: 'recruiter', source: 'JOBS', type: 'SKILL' as 'SEAT' }), validation);
    await rejects(() => searchParameters(ACC, { licence: 'recruiter', source: 'APPLICANTS', type: 'SKILL' } as never), validation);
    await rejects(() => searchParameters(ACC, { licence: 'recruiter', source: 'PIPELINE', project_id: '', type: 'SEAT' }), validation);
    await rejects(
      () => searchParameters(ACC, { licence: 'recruiter', source: 'APPLICANTS', project_id: '1', type: 'SKILL', stage_id: 's' } as never),
      validation,
    );
    await rejects(() => searchParameters(ACC, { licence: 'recruiter', source: 'EVERYWHERE', type: 'SKILL' } as never), validation);
    strictEqual(mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Crédits InMail, contrats, projets
// ---------------------------------------------------------------------------

Deno.test('getInmailCredits : GET .../linkedin/inmail-credits, clé « classic » (pas « premium »)', async () => {
  await withMockTransport(() => jsonResponse({ object: 'InmailCredits', credits: { classic: 12, recruiter: 40 } }), async (mock) => {
    deepStrictEqual(await getInmailCredits(ACC), { classic: 12, recruiter: 40, sales_navigator: null });
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/inmail-credits`);
    strictEqual(mock.calls[0].url, `https://api.unipile.com/v2/${ACC}/linkedin/inmail-credits`);
    await getInmailCredits(ACC, 'recruiter');
    strictEqual(mock.calls[1].query.get('service'), 'recruiter');
    await rejects(() => getInmailCredits(ACC, 'premium' as 'classic'), validation);
  });
  await withMockTransport(() => jsonResponse({ object: 'InmailCredits', credits: { premium: 9 } }), async () => {
    deepStrictEqual(await getInmailCredits(ACC), { classic: null, recruiter: null, sales_navigator: null });
  });
  await withMockTransport(() => jsonResponse({ object: 'InmailCredits' }), async () => {
    await rejects(() => getInmailCredits(ACC), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('listContracts : GET .../linkedin/contracts ; selectContract : POST .../contracts/{id}/select', async () => {
  const contract = { object: 'Contract', id: 'ct_1', name: 'Recruiter Lite', product: 'recruiter', selected: true };
  await withMockTransport((req) => {
    if (req.method === 'GET') return jsonResponse({ object: 'AvailableContracts', contracts: [contract, { ...contract, id: 'ct_2', product: 'sales_navigator', selected: false }] });
    return jsonResponse({ object: 'ContractSelected', contract: { ...contract, id: 'ct_2', product: 'sales_navigator', selected: true } });
  }, async (mock) => {
    const contracts = await listContracts(ACC);
    deepStrictEqual(contracts.map((c) => [c.id, c.selected]), [['ct_1', true], ['ct_2', false]]);
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/contracts`);
    const selected = await selectContract(ACC, 'ct_2');
    strictEqual(selected.product, 'sales_navigator');
    strictEqual(mock.calls[1].method, 'POST');
    strictEqual(mock.calls[1].path, `/${ACC}/linkedin/contracts/ct_2/select`);
    strictEqual(mock.calls[1].body, null);
    await rejects(() => selectContract(ACC, ''), validation);
  });
  await withMockTransport(() => jsonResponse({ object: 'ContractSelected' }), async () => {
    await rejects(() => selectContract(ACC, 'ct_2'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('listRecruiterProjects : GET .../recruiter/projects, statuts répétés, tri, mots-clés, offset, limit', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'HiringProject', id: '123', name: 'Dev Java' }], { totalCount: 1 })), async (mock) => {
    const page = await listRecruiterProjects(ACC, { status: ['ACTIVE', 'CLOSED'], sortBy: 'ALPHABETICAL', keywords: 'java', offset: 10, limit: 50 });
    strictEqual(page.items[0].name, 'Dev Java');
    strictEqual(page.totalCount, 1);
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/recruiter/projects`);
    deepStrictEqual(mock.calls[0].query.getAll('status'), ['ACTIVE', 'CLOSED']);
    strictEqual(mock.calls[0].query.get('sort_by'), 'ALPHABETICAL');
    strictEqual(mock.calls[0].query.get('keywords'), 'java');
    strictEqual(mock.calls[0].query.get('offset'), '10');
    strictEqual(mock.calls[0].query.get('limit'), '50');
    await listRecruiterProjects(ACC);
    strictEqual(mock.calls[1].url, `https://api.unipile.com/v2/${ACC}/linkedin/recruiter/projects`);
    await rejects(() => listRecruiterProjects(ACC, { status: ['ARCHIVED' as 'ACTIVE'] }), validation);
    await rejects(() => listRecruiterProjects(ACC, { sortBy: 'RANDOM' as 'ALPHABETICAL' }), validation);
    await rejects(() => listRecruiterProjects(ACC, { limit: 101 }), validation);
  });
});
