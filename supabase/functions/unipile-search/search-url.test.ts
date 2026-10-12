// Action search_from_url : une adresse de recherche LinkedIn collée devient les filtres de l'interface.
// Lecture pure (10 adresses types et leurs refus), puis l'action avec un transport factice (licence, forme,
// aucune recherche lancée).
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/search-url.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { withMockTransport, type MockReply, type RecordedRequest } from '../_shared/unipile/testing.ts';
import { clearLicenceCache } from './licence.ts';
import { classicList, filtersFromSearchUrl, handleSearchFromUrl, salesFilters, splitTopLevel, tupleEntries } from './search-url.ts';

const ACC = 'acc_test1';
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = () => {};
addEventListener('unload', () => Object.assign(console, originalConsole));

const classic = (query: string, path = 'search/results/people/') => `https://www.linkedin.com/${path}?${query}`;
const json = (value: unknown) => encodeURIComponent(JSON.stringify(value));

function read(url: unknown) {
  const outcome = filtersFromSearchUrl(url);
  if (!outcome.ok) throw new Error(`refusée : ${outcome.reason}`);
  return outcome.value;
}

function refusal(url: unknown) {
  const outcome = filtersFromSearchUrl(url);
  if (outcome.ok) throw new Error('acceptée');
  return outcome;
}

const SALES_QUERY = '(recentSearchParam:(id:3918290946,doLogHistory:true),filters:List('
  + '(type:REGION,values:List((id:105015875,text:France,selectionType:INCLUDED),(id:90009659,text:Paris%2C%20%C3%8Ele-de-France,selectionType:EXCLUDED))),'
  + '(type:CURRENT_TITLE,values:List((id:9,text:Chief%20Technology%20Officer,selectionType:INCLUDED),(id:25,text:Intern,selectionType:EXCLUDED))),'
  + '(type:CURRENT_COMPANY,values:List((id:1337,text:Acme,selectionType:INCLUDED))),'
  + '(type:INDUSTRY,values:List((id:4,text:Software%20Development,selectionType:INCLUDED),(id:6,text:Banking,selectionType:EXCLUDED))),'
  + '(type:SCHOOL,values:List((id:12,text:Polytechnique,selectionType:INCLUDED))),'
  + '(type:SENIORITY_LEVEL,values:List((id:310,text:CXO,selectionType:INCLUDED))),'
  + '(type:RELATIONSHIP,values:List((id:S,text:2nd%20degree%20connections,selectionType:INCLUDED)))'
  + '),keywords:python)';
const salesUrl = (query = SALES_QUERY) => `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(query)}&viewAllFilters=true`;

// ---------------------------------------------------------------------------
// Lecture pure : dix adresses types
// ---------------------------------------------------------------------------

Deno.test('adresse 1, Classic complète : mots-clés, lieu, relation, entreprise, secteur, école, langue ; prénom, nom, intitulé signalés', () => {
  const url = classic(
    `keywords=${encodeURIComponent('ingénieur data')}&origin=GLOBAL_SEARCH_HEADER&geoUrn=${json(['105015875'])}&network=${json(['F', 'S'])}`
      + `&currentCompany=${json(['1337'])}&pastCompany=${json(['42'])}&industry=${json(['4'])}&schoolFilter=${json(['12'])}`
      + `&profileLanguage=${json(['fr'])}&firstName=Ada&lastName=Lovelace&title=CTO&sid=abc`,
  );
  const value = read(url);
  strictEqual(value.kind, 'classic');
  strictEqual(value.keywords, 'ingénieur data');
  // Prénom, nom et intitulé n'ont ni champ à l'écran ni équivalent dans la recherche : signalés, jamais repris.
  deepStrictEqual(value.warnings, ['Prénom', 'Nom', 'Titre (texte libre)']);
  deepStrictEqual(value.filters, {
    api: 'classic',
    category: 'people',
    keywords: 'ingénieur data',
    network_distance: [1, 2],
    location: [{ id: '105015875', name: 'Lieu n° 105015875', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    company: [{ id: '1337', name: 'Entreprise n° 1337', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    past_company: [{ id: '42', name: 'Entreprise n° 42' }],
    industry: [{ id: '4', name: 'Secteur n° 4' }],
    school: [{ id: '12', name: 'École n° 12', priority: 'MUST_HAVE' }],
    profile_language: ['fr'],
  });
});

Deno.test('adresse 2, Classic sans schéma ni filtre : les mots-clés seuls', () => {
  const value = read('linkedin.com/search/results/people/?keywords=go%20developer&origin=SWITCH_SEARCH_VERTICAL');
  deepStrictEqual(value.filters, { api: 'classic', category: 'people', keywords: 'go developer' });
  deepStrictEqual(value.warnings, []);
});

Deno.test('adresse 3, Classic : texte libre et paramètres inconnus signalés, jamais repris', () => {
  const value = read(classic(`keywords=cto&company=Acme&school=HEC&connectionOf=${json(['ACoAAx'])}&serviceCategory=${json(['602'])}&foo=1&sortBy=relevance`));
  deepStrictEqual(value.filters, { api: 'classic', category: 'people', keywords: 'cto' });
  // Dans l'ordre alphabétique des paramètres de l'adresse.
  deepStrictEqual(value.warnings, ['Entreprise (texte libre)', 'Relations de', 'Autres critères de l’adresse', 'École (texte libre)', 'Catégorie de service']);
});

Deno.test('adresse 4, Classic : un identifiant illisible est signalé et n\'est jamais gardé', () => {
  const value = read(classic(`geoUrn=${json(['fr:0'])}&network=${json(['F', 'A'])}&currentCompany=${json(['1337', 'x'])}`));
  strictEqual(value.filters.location, undefined);
  deepStrictEqual(value.filters.network_distance, [1]);
  deepStrictEqual((value.filters.company as Array<{ id: string }>).map((c) => c.id), ['1337']);
  strictEqual(value.warnings.length, 3);
  for (const label of ['Lieux', 'Degré de relation', 'Entreprises']) ok(value.warnings.includes(label), label);
});

Deno.test('adresse 5, Classic ancienne forme facet : relation, entreprise et langue lues', () => {
  const value = read(classic(`facetNetwork=${json(['O'])}&facetCurrentCompany=${json(['77'])}&facetProfileLanguage=${json(['en'])}&facetGeoRegion=${json(['fr:0'])}`));
  deepStrictEqual(value.filters.network_distance, [3]);
  deepStrictEqual(value.filters.profile_language, ['en']);
  deepStrictEqual(value.warnings, ['Lieux']);
});

Deno.test('adresse 6, Sales Navigator : région, poste, entreprise, secteur, école, relation et mots-clés', () => {
  const value = read(salesUrl());
  strictEqual(value.kind, 'sales_navigator');
  strictEqual(value.keywords, 'python');
  const f = value.filters;
  strictEqual(f.api, 'sales_navigator');
  strictEqual(f.keywords, 'python');
  // Le lieu exclu n'est pas repris : hors Recruiter, la recherche refuse une exclusion de lieu.
  deepStrictEqual(f.location, [{ id: '105015875', name: 'France', priority: 'CAN_HAVE', scope: 'CURRENT' }]);
  deepStrictEqual(f.job_title, [
    { id: '9', name: 'Chief Technology Officer', priority: 'CAN_HAVE' },
    { id: '25', name: 'Intern', priority: 'DOESNT_HAVE' },
  ]);
  deepStrictEqual(f.company, [{ id: '1337', name: 'Acme', priority: 'CAN_HAVE', scope: 'CURRENT' }]);
  deepStrictEqual(f.industry, [{ id: '4', name: 'Software Development' }]);
  deepStrictEqual(f.school, [{ id: '12', name: 'Polytechnique', priority: 'MUST_HAVE' }]);
  deepStrictEqual(f.network_distance, [2]);
  // Le lieu et le secteur exclus et la séniorité ne sont pas repris : signalés.
  deepStrictEqual(value.warnings, ['Lieux (exclusions)', 'Secteurs (exclusions)', 'Séniorité']);
  ok(!('seniority' in f));
});

Deno.test('adresse 6 bis, Sales Navigator : une école exclue est signalée, jamais reprise comme critère actif', () => {
  const query = '(filters:List((type:SCHOOL,values:List((id:12,text:Polytechnique,selectionType:INCLUDED),(id:34,text:HEC,selectionType:EXCLUDED)))))';
  const value = read(salesUrl(query));
  deepStrictEqual(value.filters.school, [{ id: '12', name: 'Polytechnique', priority: 'MUST_HAVE' }]);
  deepStrictEqual(value.warnings, ['Écoles (exclusions)']);
  ok(!JSON.stringify(value.filters).includes('DOESNT_HAVE'), 'aucune exclusion de lieu ou d\'école dans les filtres');
});

Deno.test('adresse 6 ter, Sales Navigator : une région exclue seule ne laisse aucun lieu exclu', () => {
  const query = '(filters:List((type:REGION,values:List((id:105015875,text:France,selectionType:EXCLUDED)))))';
  const value = read(salesUrl(query));
  strictEqual(value.filters.location, undefined);
  deepStrictEqual(value.warnings, ['Lieux (exclusions)']);
});

Deno.test('adresse 6 quater, Sales Navigator : un texte encodé une seule fois garde ses virgules', () => {
  // Le paramètre `query` est encodé une fois : la virgule d'un texte devient un séparateur après le premier décodage.
  const query = '(filters:List((type:REGION,values:List((id:105015875,text:Paris%2C%20%C3%8Ele-de-France%2C%20France,selectionType:INCLUDED,parent:(id:0))))))';
  const value = read(`https://www.linkedin.com/sales/search/people?query=${query}`);
  deepStrictEqual(value.filters.location, [
    { id: '105015875', name: 'Paris, Île-de-France, France', priority: 'CAN_HAVE', scope: 'CURRENT' },
  ]);
  deepStrictEqual(value.warnings, []);
  // Un fragment sans clé ne se rattache qu'au texte : le reste du tuple reste lu.
  const entries = tupleEntries('(id:1,text:Paris, Île-de-France, France,selectionType:EXCLUDED)');
  strictEqual(entries.get('text'), 'Paris, Île-de-France, France');
  strictEqual(entries.get('selectionType'), 'EXCLUDED');
});

Deno.test('adresse 7, Sales Navigator sans filtre lisible : recherche enregistrée signalée', () => {
  const value = read('https://www.linkedin.com/sales/search/people?savedSearchId=123456');
  deepStrictEqual(value.filters, { api: 'sales_navigator', category: 'people' });
  deepStrictEqual(value.warnings, ['Recherche enregistrée']);
});

Deno.test('adresse 8, Recruiter : mots-clés repris, filtres gardés chez LinkedIn signalés', () => {
  const value = read('https://www.linkedin.com/talent/search?searchContextId=a1&searchHistoryId=b2&searchRequestId=c3&keywords=developpeur%20react&start=0');
  strictEqual(value.kind, 'recruiter');
  deepStrictEqual(value.filters, { api: 'recruiter', category: 'people', keywords: 'developpeur react' });
  deepStrictEqual(value.warnings, ['Filtres de la recherche Recruiter']);
});

Deno.test('adresse 9, Recruiter dans un projet : le projet de l\'adresse est signalé, pas appliqué', () => {
  const value = read('https://www.linkedin.com/talent/hire/1234567890/discover/recruitersearch?keywords=cto');
  strictEqual(value.kind, 'recruiter');
  deepStrictEqual(value.filters, { api: 'recruiter', category: 'people', keywords: 'cto' });
  deepStrictEqual(value.warnings, ['Projet Recruiter de l’adresse']);
  ok(!('hiring_project' in value.filters));
});

Deno.test('adresse 10, recherche Recruiter sans mots-clés : filtres vides, aucun avertissement', () => {
  const value = read('https://www.linkedin.com/talent/search');
  deepStrictEqual(value.filters, { api: 'recruiter', category: 'people' });
  strictEqual(value.keywords, null);
  deepStrictEqual(value.warnings, []);
});

// ---------------------------------------------------------------------------
// Refus : texte français neutre
// ---------------------------------------------------------------------------

Deno.test('adresses refusées : invalide, pas LinkedIn, pas une recherche', () => {
  for (const [input, reason] of [
    ['', 'invalid_url'],
    [42, 'invalid_url'],
    [null, 'invalid_url'],
    ['pas une adresse', 'invalid_url'],
    [`https://www.linkedin.com/search/results/people/?keywords=${'a'.repeat(9000)}`, 'invalid_url'],
    ['https://exemple.com/search/results/people/?keywords=go', 'not_linkedin'],
    ['https://www.linkedin.com/in/ada-lovelace/', 'not_a_search'],
    ['https://www.linkedin.com/feed/', 'not_a_search'],
  ] as const) {
    const out = refusal(input);
    strictEqual(out.status, 400);
    strictEqual(out.errorType, 'INVALID_SEARCH_URL');
    strictEqual(out.reason, reason, String(input));
    ok(/LinkedIn|adresse/.test(out.error), out.error);
    ok(!/unipile/i.test(out.error));
  }
});

Deno.test('adresses qui ne sont pas une recherche de personnes : refusées avec le même texte', () => {
  const urls = [
    classic('keywords=acme', 'search/results/companies/'),
    classic('keywords=acme', 'search/results/content/'),
    'https://www.linkedin.com/jobs/search/?keywords=cto',
    'https://www.linkedin.com/talent/hire/123/manage/all',
    'https://www.linkedin.com/talent/hire/123/discover/applicants',
    'https://www.linkedin.com/sales/search/company?query=(filters:List())',
    'https://www.linkedin.com/sales/lists/people/6789',
  ];
  for (const url of urls) {
    const out = refusal(url);
    strictEqual(out.errorType, 'UNSUPPORTED_SEARCH_URL', url);
    strictEqual(out.error, "Seules les recherches de personnes peuvent être reprises. Collez l'adresse d'une recherche de personnes.");
  }
});

// ---------------------------------------------------------------------------
// Lecteurs
// ---------------------------------------------------------------------------

Deno.test('classicList lit les formes de liste d\'une adresse Classic', () => {
  deepStrictEqual(classicList('["F","S"]'), ['F', 'S']);
  deepStrictEqual(classicList('F,S'), ['F', 'S']);
  deepStrictEqual(classicList('[ "105015875" ]'), ['105015875']);
  deepStrictEqual(classicList('105015875'), ['105015875']);
  deepStrictEqual(classicList("['a', 'b']"), ['a', 'b']);
  deepStrictEqual(classicList('   '), []);
  deepStrictEqual(classicList(null), []);
});

Deno.test('tuples Sales Navigator : virgules et parenthèses imbriquées', () => {
  deepStrictEqual(splitTopLevel('a:(b,c),d:e,f'), ['a:(b,c)', 'd:e', 'f']);
  const entries = tupleEntries('(id:9,text:Chief%20Officer,parent:(id:1,text:x))');
  strictEqual(entries.get('id'), '9');
  strictEqual(entries.get('parent'), '(id:1,text:x)');
  const filters = salesFilters('(filters:List((type:REGION,values:List((id:1,text:France,selectionType:INCLUDED)))))');
  deepStrictEqual(filters, [{ type: 'REGION', values: [{ id: '1', text: 'France', excluded: false }] }]);
  deepStrictEqual(salesFilters('(keywords:go)'), []);
  deepStrictEqual(salesFilters(''), []);
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

type Routes = Record<string, MockReply | ((request: RecordedRequest) => MockReply)>;
function router(routes: Routes) {
  return (request: RecordedRequest): MockReply => {
    const entry = routes[`${request.method} ${request.path}`];
    if (entry === undefined) return { status: 404, body: { error: 'route inconnue' } };
    return typeof entry === 'function' ? entry(request) : entry;
  };
}
const contracts = (...list: Array<[string, boolean]>) => ({
  object: 'AvailableContracts',
  contracts: list.map(([product, selected], i) => ({ object: 'Contract', id: `c${i}`, name: product, product, selected })),
});

Deno.test('search_from_url : forme de la réponse, aucun appel pour Classic, aucune recherche lancée', async () => {
  clearLicenceCache();
  await withMockTransport(router({}), async (mock) => {
    const response = await handleSearchFromUrl(ACC, { url: classic(`keywords=cto&network=${json(['F'])}`) });
    strictEqual(response.status, 200);
    const body = await response.json();
    deepStrictEqual(body, {
      success: true,
      kind: 'classic',
      keywords: 'cto',
      filters: { api: 'classic', category: 'people', keywords: 'cto', network_distance: [1] },
      warnings: [],
    });
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('search_from_url : une adresse Recruiter demande la licence Recruiter, sans lancer de recherche', async () => {
  clearLicenceCache();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts(['recruiter', true]) } }), async (mock) => {
    const response = await handleSearchFromUrl(ACC, { url: 'https://www.linkedin.com/talent/search?keywords=cto' });
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.kind, 'recruiter');
    deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), [`GET /${ACC}/linkedin/contracts`]);
  });
});

Deno.test('search_from_url : licence absente ou contrat inactif refusés en français, avant tout filtre', async () => {
  clearLicenceCache();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts() } }), async () => {
    const response = await handleSearchFromUrl(ACC, { url: 'https://www.linkedin.com/talent/search?keywords=cto' });
    strictEqual(response.status, 400);
    const body = await response.json();
    strictEqual(body.errorType, 'LICENCE_UNAVAILABLE');
    strictEqual(body.error, 'Ce compte LinkedIn n’a pas de licence Recruiter. Choisissez une autre source de recherche.');
    ok(!('filters' in body));
  });
  clearLicenceCache();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts(['recruiter', false], ['sales_navigator', true]) } }), async () => {
    const response = await handleSearchFromUrl(ACC, { url: 'https://www.linkedin.com/talent/search?keywords=cto' });
    strictEqual(response.status, 400);
    strictEqual((await response.json()).errorType, 'LICENCE_UNAVAILABLE');
  });
});

Deno.test('search_from_url : la lecture des contrats impossible pour une raison passagère n\'empêche pas la lecture', async () => {
  clearLicenceCache();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { status: 500, body: { error: 'x' } } }), async () => {
    const response = await handleSearchFromUrl(ACC, { url: salesUrl() });
    strictEqual(response.status, 200);
    strictEqual((await response.json()).kind, 'sales_navigator');
  });
});

Deno.test('search_from_url : adresse refusée = 400 avec un texte français, sans appel', async () => {
  clearLicenceCache();
  await withMockTransport(router({}), async (mock) => {
    const response = await handleSearchFromUrl(ACC, { url: 'https://exemple.com/x' });
    strictEqual(response.status, 400);
    const body = await response.json();
    strictEqual(body.success, false);
    strictEqual(body.errorType, 'INVALID_SEARCH_URL');
    strictEqual(body.error_code, 'not_linkedin');
    ok(!/unipile/i.test(JSON.stringify(body)));
    const missing = await handleSearchFromUrl(ACC, {});
    strictEqual(missing.status, 400);
    strictEqual(mock.calls.length, 0);
  });
});
