/**
 * Sourcing : avis sur les filtres que le compte LinkedIn n'a pas appliqués (visite du 12/10/2026, F10),
 * lien de recherche collé lisible (F15).
 *
 * F10 : `unipile-search` rend `filters_dropped` et `filters_adjusted` ; une ligne discrète au-dessus des
 *   résultats les dit. L'avis vit avec la recherche exécutée (`ExecutedSourcingSearch.filtersNotice`, déjà
 *   gardée par le cache de mission) : il revient avec les résultats après un changement d'onglet et disparaît
 *   avec une nouvelle recherche qui n'écarte rien.
 * F15 : « Lieu n° 105015875 » devient « Lieu choisi sur LinkedIn » ; l'avertissement d'une adresse Recruiter
 *   dit ce qui n'est pas repris.
 *
 * Lancer : node --test tests/ux/avis-filtres-recherche.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const VENDORS = /\b(?:unipile|apollo(?:\.io)?|people data labs|pdl|brandfetch|clearbit|logo\.dev|anthropic|claude)\b/i;
const FILLER = /\b(?:crucial\w*|essentiel\w*|robuste\w*|riche\w*|fluide\w*|puissant\w*|innovant\w*|explorer|naviguer|garantir|veiller)\b/i;
const TUTOIEMENT = /\b(?:tu|toi|ton|ta|tes|te|t’|t')\b(?!\.)/i;

const notice = await loadTs('src/lib/searchFilterNotice.ts');
const urlFilters = await loadTs('src/components/outreach/search/searchUrlFilters.ts');
const copy = await loadTs('src/components/outreach/search/searchControlsCopy.ts');

const assertCleanText = (text) => {
  assert.doesNotMatch(text, /[—–]/, `tiret cadratin : ${text}`);
  assert.doesNotMatch(text, FILLER, `mot de remplissage : ${text}`);
  assert.doesNotMatch(text, TUTOIEMENT, `tutoiement : ${text}`);
  assert.doesNotMatch(text, VENDORS, `prestataire : ${text}`);
  assert.doesNotMatch(text, /[a-z]+_[a-z_]+/, `clé brute : ${text}`);
};

// ---------------------------------------------------------------------------
// F10 : le mot de chaque critère
// ---------------------------------------------------------------------------

/** Clés d'un objet littéral `{ clé: 'texte', … }` d'un fichier du serveur. */
function tableKeys(file, declaration) {
  const src = read(file);
  const start = src.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} introuvable dans ${file}`);
  const open = src.indexOf('{', src.indexOf('=', start));
  const close = src.indexOf('\n};', open);
  return [...src.slice(open, close).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
}

const SERVER_LABELS = tableKeys('supabase/functions/_shared/unipile/normalize/search.ts', 'export const FILTER_LABELS_FR');
const SERVER_EXTRA = tableKeys('supabase/functions/unipile-search/search-request.ts', 'const EXTRA_LABELS');

test('libellés : chaque critère que le serveur nomme (FILTER_LABELS_FR, EXTRA_LABELS) a son mot', () => {
  assert.ok(SERVER_LABELS.length > 40, 'table du serveur lue');
  assert.deepEqual(SERVER_EXTRA.sort(), ['advanced_keywords', 'recent_search_id', 'recruiting_activity', 'saved_search_id']);
  for (const key of [...SERVER_LABELS, ...SERVER_EXTRA]) {
    assert.ok(notice.knownFilterLabel(key), `aucun mot pour « ${key} »`);
  }
});

test('libellés : les paramètres que le serveur signale (APPLIED_PARAMS) sont tous couverts, après leur correspondance', () => {
  const src = read('supabase/functions/unipile-search/search-request.ts');
  const block = src.slice(src.indexOf('const COMMON'), src.indexOf('const EXTRA_LABELS'));
  const mapped = Object.fromEntries([...block.slice(block.indexOf('const FILTER_OF_PARAM')).matchAll(/^\s{2}(\w+): '(\w+)'/gm)].map((m) => [m[1], m[2]]));
  const applied = block.slice(0, block.indexOf('const FILTER_OF_PARAM'));
  const params = new Set([...applied.matchAll(/'(\w+)'/g)].map((m) => m[1]));
  for (const skipped of ['classic', 'sales_navigator', 'recruiter']) params.delete(skipped);
  assert.ok(params.size > 40, `${params.size} paramètres lus`);
  for (const param of params) {
    const filter = mapped[param] ?? param;
    assert.ok(notice.knownFilterLabel(filter), `le paramètre « ${param} » (filtre « ${filter} ») n'a pas de mot`);
  }
});

test('libellés : mots en minuscules, français, sans clé brute ni prestataire', () => {
  for (const [key, label] of Object.entries(notice.SEARCH_FILTER_LABELS)) {
    assert.equal(label.replace(/\bESN\b/g, 'esn'), label.replace(/\bESN\b/g, 'esn').toLowerCase(), `${key} : minuscules`);
    assertCleanText(label);
  }
});

test('libellés : une clé inconnue devient « autre critère », jamais la clé ; le prototype n’est pas lu', () => {
  assert.equal(notice.knownFilterLabel('skills'), 'compétences');
  for (const key of ['nouveau_critere', 'constructor', '__proto__', 'toString', '']) {
    assert.equal(notice.knownFilterLabel(key), null, key);
  }
  const text = notice.droppedFiltersText({ dropped: [{ filter: 'nouveau_critere', reason: 'unsupported' }], adjusted: [] });
  assert.equal(text, 'Votre compte LinkedIn ne sait pas appliquer ce filtre : autre critère. La recherche a été faite sans lui.');
  assert.doesNotMatch(text, /nouveau_critere/);
  const several = notice.droppedFiltersText({
    dropped: [{ filter: 'x_un', reason: 'unsupported' }, { filter: 'skills', reason: 'unsupported' }, { filter: 'x_deux', reason: 'unsupported' }],
    adjusted: [],
  });
  assert.match(several, /: compétences, autres critères\. La recherche a été faite sans eux\.$/);
});

// ---------------------------------------------------------------------------
// F10 : lecture de la réponse et phrases
// ---------------------------------------------------------------------------

test('lecture : rien d’écarté ni d’approché, pas d’avis', () => {
  for (const data of [undefined, null, 'x', [], {}, { success: true, results: [] }, { filters_dropped: [], filters_adjusted: [] },
    { filters_dropped: 'skills', filters_adjusted: { filter: 'x' } }, { filters_dropped: [null, 3, {}, { filter: 7 }, { filter: '  ' }] }]) {
    assert.equal(notice.readSearchFiltersNotice(data), null, JSON.stringify(data));
  }
});

test('lecture : seule la clé est gardée (jamais le libellé du serveur), un doublon est réuni, une forme douteuse est écartée', () => {
  const read = notice.readSearchFiltersNotice({
    success: true,
    filters_dropped: [
      { filter: 'skills', label: 'skills_brut', reason: 'unsupported' },
      { filter: 'skills', label: 'Compétences', reason: 'unsupported' },
      { filter: 'location', reason: 'scope' },
      { filter: 'role' },
      { filter: 'x'.repeat(65), reason: 'unsupported' },
      'texte',
    ],
    filters_adjusted: [{ filter: 'years_of_experience', label: 'Années', change: 'minimum 3 became 2' }, { filter: 'years_of_experience' }],
  });
  assert.deepEqual(read.dropped, [
    { filter: 'skills', reason: 'unsupported' },
    { filter: 'location', reason: 'scope' },
    { filter: 'role', reason: 'unsupported' },
  ]);
  assert.deepEqual(read.adjusted, [{ filter: 'years_of_experience' }]);
  assert.ok(!JSON.stringify(read).includes('skills_brut'));
  assert.ok(!JSON.stringify(read).includes('minimum 3'));
});

test('phrases : le cas de la visite (compte Classic, compétences et poste)', () => {
  const read = notice.readSearchFiltersNotice({
    success: true,
    filters_dropped: [{ filter: 'skills', label: 'Compétences', reason: 'unsupported' }, { filter: 'role', label: 'Postes (mots-clés)', reason: 'unsupported' }],
  });
  assert.deepEqual(notice.searchFiltersNoticeLines(read), [
    'Votre compte LinkedIn ne sait pas appliquer ces filtres : compétences, poste. La recherche a été faite sans eux.',
  ]);
});

test('phrases : un seul filtre au singulier, raison écrite quand le filtre n’est écarté qu’en partie', () => {
  assert.equal(
    notice.droppedFiltersText({ dropped: [{ filter: 'location_within_area', reason: 'unsupported' }], adjusted: [] }),
    'Votre compte LinkedIn ne sait pas appliquer ce filtre : rayon autour du lieu. La recherche a été faite sans lui.',
  );
  assert.equal(
    notice.droppedFiltersText({
      dropped: [{ filter: 'job_title', reason: 'exclusion' }, { filter: 'location', reason: 'scope' }, { filter: 'seniority', reason: 'value' }],
      adjusted: [],
    }),
    'Votre compte LinkedIn ne sait pas appliquer ces filtres : intitulé de poste (exclusions), lieu (en partie), séniorité (certaines valeurs). La recherche a été faite sans eux.',
  );
  // Une raison inconnue se lit comme « non appliqué », sans suffixe.
  assert.match(notice.droppedFiltersText({ dropped: [{ filter: 'skills', reason: 'constructor' }], adjusted: [] }), /: compétences\./);
});

test('phrases : filtres approchés, sur leur propre ligne', () => {
  const read = notice.readSearchFiltersNotice({
    filters_dropped: [{ filter: 'skills', reason: 'unsupported' }],
    filters_adjusted: [{ filter: 'years_of_experience' }, { filter: 'keywords' }],
  });
  assert.deepEqual(notice.searchFiltersNoticeLines(read), [
    'Votre compte LinkedIn ne sait pas appliquer ce filtre : compétences. La recherche a été faite sans lui.',
    'Filtres appliqués de façon approchée : années d’expérience, mots-clés.',
  ]);
  const adjustedOnly = notice.readSearchFiltersNotice({ filters_adjusted: [{ filter: 'company' }] });
  assert.deepEqual(notice.searchFiltersNoticeLines(adjustedOnly), ['Filtres appliqués de façon approchée : entreprise.']);
  assert.deepEqual(notice.searchFiltersNoticeLines(null), []);
  assert.deepEqual(notice.searchFiltersNoticeLines(undefined), []);
});

test('phrases : vouvoiement, sans tiret cadratin, sans mot de remplissage, sans clé brute ni prestataire, pour chaque critère', () => {
  const every = Object.keys(notice.SEARCH_FILTER_LABELS);
  for (const reason of ['unsupported', 'exclusion', 'scope', 'value']) {
    for (const line of notice.searchFiltersNoticeLines({
      dropped: every.map((filter) => ({ filter, reason })),
      adjusted: every.map((filter) => ({ filter })),
    })) assertCleanText(line);
  }
  for (const filter of every) {
    for (const line of notice.searchFiltersNoticeLines({ dropped: [{ filter, reason: 'unsupported' }], adjusted: [{ filter }] })) assertCleanText(line);
  }
});

// ---------------------------------------------------------------------------
// F10 : l'avis vit avec la recherche exécutée
// ---------------------------------------------------------------------------

test('avis : lu sur la première page d’une nouvelle recherche, gardé dans la recherche exécutée, jamais sur « Charger plus »', () => {
  const hook = stripComments(read('src/hooks/useLinkedInSearchActions.ts'));
  assert.match(hook, /import \{ readSearchFiltersNotice, type SearchFiltersNotice \} from '@\/lib\/searchFilterNotice';/);
  // Un avis par appel de handleSearch : une nouvelle recherche qui n'écarte rien repart sans avis.
  assert.match(hook, /let filtersNotice: SearchFiltersNotice \| null = null;/);
  assert.equal((hook.match(/filtersNotice = readSearchFiltersNotice\(data\)/g) || []).length, 1);
  assert.match(hook, /if \(!appendMode && round === 0\) filtersNotice = readSearchFiltersNotice\(data\);/);
  // Les deux écritures de la recherche exécutée (succès, page déjà servie puis erreur) portent l'avis.
  assert.equal((hook.match(/setExecutedSearch\(filtersNotice \? \{ \.\.\.execution, filtersNotice \} : execution\)/g) || []).length, 2);
  assert.doesNotMatch(hook, /setExecutedSearch\(execution\)/);
  // « Charger plus » reprend la recherche exécutée (avis compris) : aucune relecture.
  assert.match(hook, /execution = appendMode \? previousExecution : \{/);
});

test('avis : champ de ExecutedSourcingSearch, donc gardé par le cache de mission et rendu avec les résultats après un changement d’onglet', () => {
  const lifecycle = stripComments(read('src/lib/sourcingSearchLifecycle.ts'));
  assert.match(lifecycle, /import type \{ SearchFiltersNotice \} from '@\/lib\/searchFilterNotice';/);
  assert.match(lifecycle, /export interface ExecutedSourcingSearch \{[\s\S]*?filtersNotice\?: SearchFiltersNotice;\s*\}/);
  const search = stripComments(read('src/components/outreach/LinkedInSearch.tsx'));
  // Le cache écrit et relit la recherche exécutée entière.
  assert.match(search, /executedSearch: ExecutedSourcingSearch \| null;/);
  assert.match(search, /executedSearch: search\.executedSearch,/);
  assert.match(search, /search\.setExecutedSearch\(cached\.executedSearch\);/);
  // Une recherche d'une autre mission ou un cache périmé la remet à zéro.
  assert.ok((search.match(/search\.setExecutedSearch\(null\);/g) || []).length >= 2);
  // L'écran la lit à cet endroit seulement.
  assert.match(search, /filtersNotice=\{search\.executedSearch\?\.filtersNotice \?\? null\}/);
});

test('avis : une ligne au-dessus des résultats, sur la nouvelle page comme sur l’ancienne, seulement après une recherche et jamais pendant une nouvelle', () => {
  const panel = stripComments(read('src/components/outreach/search/SearchResultsPanel.tsx'));
  assert.match(panel, /\{hasSearched && !loading && <FiltersNoticeLines notice=\{filtersNotice\} bordered=\{!isV3\} \/>\}\s*\n\s*\{isV3 && onSetSelection/);
  const line = stripComments(read('src/components/outreach/search/FiltersNoticeLines.tsx'));
  assert.match(line, /if \(lines\.length === 0\) return null;/);
  assert.match(line, /role="status"/);
  // Pas un toast : l'avis reste affiché avec les résultats.
  assert.doesNotMatch(line, /toast/);
  assert.doesNotMatch(line, VENDORS);
});

test('avis : masqué pendant une nouvelle recherche (loading), gardé pendant « Charger plus » (loadingMore seul)', () => {
  // `loading` ne passe à vrai que pour une nouvelle recherche, `loadingMore` que pour « Charger plus ».
  const hook = stripComments(read('src/hooks/useLinkedInSearchActions.ts'));
  assert.match(hook, /if \(appendMode\) \{\s*setLoadingMore\(true\);\s*\} else \{\s*setLoading\(true\);\s*setLoadingMore\(false\);\s*\}/);
  assert.equal((hook.match(/setLoading\(true\)/g) || []).length, 1);
  // La ligne de l'avis suit `loading` et ne regarde pas `loadingMore`.
  const panel = stripComments(read('src/components/outreach/search/SearchResultsPanel.tsx'));
  const mounts = panel.split('\n').filter((l) => l.includes('<FiltersNoticeLines'));
  assert.equal(mounts.length, 1, 'un seul endroit affiche l’avis');
  assert.match(mounts[0], /hasSearched && !loading &&/);
  assert.doesNotMatch(mounts[0], /loadingMore/);
});

// ---------------------------------------------------------------------------
// F15 : lien collé lisible
// ---------------------------------------------------------------------------

const CLASSIC = {
  success: true,
  kind: 'classic',
  keywords: 'product designer figma',
  filters: {
    api: 'classic',
    category: 'people',
    keywords: 'product designer figma',
    location: [{ id: '105015875', name: 'Lieu n° 105015875', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    company: [{ id: '1441', name: 'Entreprise n° 1441', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    past_company: [{ id: '7', name: 'Entreprise n° 7' }],
    industry: [{ id: '4', name: 'Secteur n° 4' }],
    school: [{ id: '12', name: 'École n° 12', priority: 'MUST_HAVE' }],
  },
  warnings: [],
};
const CONTEXT = { currentApi: 'classic', availableApis: ['classic', 'recruiter', 'sales_navigator'] };
const update = (data, context = CONTEXT) => {
  const outcome = urlFilters.parseSearchFromUrlResponse(data);
  assert.ok(outcome.ok, 'lecture refusée');
  return urlFilters.buildSearchUrlUpdate(outcome.value, context);
};

test('lien collé : « Lieu n° 105015875 » devient « Lieu choisi sur LinkedIn », l’identifiant est gardé', () => {
  const { update: next } = update(CLASSIC);
  assert.deepEqual(next.location, [{ id: '105015875', name: 'Lieu choisi sur LinkedIn', priority: 'CAN_HAVE', scope: 'CURRENT' }]);
  assert.deepEqual(next.company.map((c) => [c.id, c.name]), [['1441', 'Entreprise choisie sur LinkedIn']]);
  assert.deepEqual(next.past_company, [{ id: '7', name: 'Entreprise passée choisie sur LinkedIn' }]);
  assert.deepEqual(next.industry, [{ id: '4', name: 'Secteur choisi sur LinkedIn' }]);
  assert.deepEqual(next.school, [{ id: '12', name: 'École choisie sur LinkedIn', priority: 'MUST_HAVE' }]);
  const names = [next.location, next.company, next.past_company, next.industry, next.school].flat().map((x) => x.name);
  for (const name of names) {
    assert.doesNotMatch(name, /n°|\d/, `numéro visible : ${name}`);
    assertCleanText(name);
  }
});

test('lien collé : plusieurs éléments sans nom se distinguent par un rang, un nom lu dans l’adresse n’est jamais touché', () => {
  const { update: next } = update({
    ...CLASSIC,
    filters: {
      api: 'classic',
      location: [
        { id: '1', name: 'Lieu n° 1' },
        { id: '2', name: 'Paris' },
        { id: '3', name: 'Lieu n° 3' },
        { id: '4', name: 'n° 4' },
      ],
    },
  });
  assert.deepEqual(next.location.map((l) => l.name), [
    'Lieu choisi sur LinkedIn (1)', 'Paris', 'Lieu choisi sur LinkedIn (2)', 'Lieu choisi sur LinkedIn (3)',
  ]);
  const sales = update({
    success: true,
    kind: 'sales_navigator',
    keywords: null,
    filters: { location: [{ id: '105015875', name: 'France' }], job_title: [{ id: '9', name: 'n° 9' }] },
    warnings: [],
  }).update;
  assert.equal(sales.location[0].name, 'France');
  // Un nom lu dans l'adresse n'est jamais touché, quel que soit le critère.
  const named = update({
    success: true,
    kind: 'sales_navigator',
    keywords: null,
    filters: { job_title: [{ id: '9', name: 'Product Designer' }], function: [{ id: '8', name: 'Design' }] },
    warnings: [],
  }).update;
  assert.equal(named.job_title[0].name, 'Product Designer');
  assert.equal(named.function[0].name, 'Design');
});

test('lien collé : un nom réduit à un numéro est lisible pour tous les critères Sales Navigator, jamais le numéro', () => {
  // Avant ce correctif, « n° 9 » restait à l'écran pour l'intitulé, la fonction, le lieu du siège et les groupes.
  const { update: next } = update({
    success: true,
    kind: 'sales_navigator',
    keywords: null,
    filters: {
      location: [{ id: '105015875', name: 'n° 105015875' }],
      company: [{ id: '1441', name: 'n° 1441' }],
      job_title: [{ id: '9', name: 'n° 9', priority: 'CAN_HAVE' }],
      past_job_title: [{ id: '10', name: 'n° 10', priority: 'DOESNT_HAVE' }],
      school: [{ id: '12', name: 'n° 12' }],
      past_company: [{ id: '7', name: 'n° 7' }],
      industry: [{ id: '4', name: 'n° 4' }],
      function: [{ id: '8', name: 'n° 8' }],
      company_location: [{ id: '5', name: 'n° 5' }],
      groups: [{ id: '6', name: 'n° 6' }],
    },
    warnings: [],
  });
  assert.deepEqual(next.job_title, [{ id: '9', name: 'Intitulé choisi sur LinkedIn', priority: 'CAN_HAVE' }]);
  assert.deepEqual(next.past_job_title, [{ id: '10', name: 'Ancien intitulé choisi sur LinkedIn', priority: 'DOESNT_HAVE' }]);
  assert.deepEqual(next.function, [{ id: '8', name: 'Fonction choisie sur LinkedIn' }]);
  assert.deepEqual(next.company_location, [{ id: '5', name: 'Lieu du siège choisi sur LinkedIn' }]);
  assert.deepEqual(next.groups, [{ id: '6', name: 'Groupe choisi sur LinkedIn' }]);
  const all = ['location', 'company', 'job_title', 'past_job_title', 'school', 'past_company', 'industry', 'function', 'company_location', 'groups']
    .flatMap((key) => next[key].map((entry) => entry.name));
  assert.equal(all.length, 10);
  for (const name of all) {
    assert.doesNotMatch(name, /n°|\d/, `numéro visible : ${name}`);
    assertCleanText(name);
  }
  // Plusieurs éléments sans nom d'un même critère se distinguent par un rang.
  const several = update({
    success: true,
    kind: 'sales_navigator',
    keywords: null,
    filters: { job_title: [{ id: '1', name: 'n° 1' }, { id: '2', name: 'Data Analyst' }, { id: '3', name: 'n° 3' }] },
    warnings: [],
  }).update;
  assert.deepEqual(several.job_title.map((t) => t.name), [
    'Intitulé choisi sur LinkedIn (1)', 'Data Analyst', 'Intitulé choisi sur LinkedIn (2)',
  ]);
});

test('lien collé : un critère sans libellé propre prend « Critère choisi sur LinkedIn », le prototype n’est pas lu', () => {
  assert.equal(urlFilters.CHOSEN_FALLBACK, 'Critère choisi sur LinkedIn');
  assert.equal(urlFilters.chosenOnLinkedinLabel('seniority'), 'Critère choisi sur LinkedIn');
  for (const key of ['constructor', '__proto__', 'toString', '']) {
    assert.equal(urlFilters.chosenOnLinkedinLabel(key), 'Critère choisi sur LinkedIn', key);
  }
  // Les critères de l'adresse Classic gardent leur libellé, ceux de Sales Navigator ont le leur.
  for (const key of Object.keys(copy.CHOSEN_ON_LINKEDIN)) assert.equal(urlFilters.chosenOnLinkedinLabel(key), copy.CHOSEN_ON_LINKEDIN[key]);
  for (const key of Object.keys(urlFilters.CHOSEN_ON_LINKEDIN_SALES)) {
    assert.equal(urlFilters.chosenOnLinkedinLabel(key), urlFilters.CHOSEN_ON_LINKEDIN_SALES[key]);
  }
  // Chaque critère que le serveur nomme par son numéro (SALES_TARGETS) a un libellé propre : le repli n'est qu'un filet.
  const server = read('supabase/functions/unipile-search/search-url.ts');
  const targets = server.slice(server.indexOf('const SALES_TARGETS'), server.indexOf('/** Libellés des types Sales Navigator'));
  const keys = [...targets.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `${keys.length} critères lus`);
  for (const key of keys) {
    const own = Object.hasOwn(copy.CHOSEN_ON_LINKEDIN, key) || Object.hasOwn(urlFilters.CHOSEN_ON_LINKEDIN_SALES, key);
    assert.ok(own, `« ${key} » n'a pas de libellé propre`);
  }
});

test('lien collé : l’avertissement d’une adresse Recruiter dit ce qui n’est pas repris', () => {
  const { warnings } = update({
    success: true,
    kind: 'recruiter',
    keywords: 'backend engineer',
    filters: { api: 'recruiter', category: 'people', keywords: 'backend engineer' },
    warnings: ['Filtres de la recherche Recruiter'],
  }, { currentApi: 'recruiter', availableApis: ['recruiter'] });
  assert.deepEqual(warnings, [
    'Filtres de la recherche Recruiter : l’adresse ne les contient pas, LinkedIn les garde de son côté. Seuls les mots-clés peuvent être repris.',
  ]);
  assertCleanText(warnings[0]);
});

test('lien collé : les autres avertissements du serveur passent tels quels', () => {
  assert.equal(copy.readableWarning('Entreprise (texte libre)'), 'Entreprise (texte libre)');
  assert.equal(copy.readableWarning('Lieux (exclusions)'), 'Lieux (exclusions)');
  for (const key of ['constructor', '__proto__', 'toString', '']) assert.equal(copy.readableWarning(key), key);
  const { warnings } = update({ ...CLASSIC, warnings: ['Catégorie de service', 'Prénom'] });
  assert.deepEqual(warnings, ['Catégorie de service', 'Prénom']);
});

test('lien collé : tous les textes ajoutés sont propres', () => {
  const texts = [
    copy.PASTE_URL_COPY.recruiterFilters, ...Object.values(copy.CHOSEN_ON_LINKEDIN),
    ...Object.values(urlFilters.CHOSEN_ON_LINKEDIN_SALES), urlFilters.CHOSEN_FALLBACK,
  ];
  for (const text of texts) assertCleanText(text);
  // Le texte du serveur reconnu est celui que le serveur écrit.
  const server = read('supabase/functions/unipile-search/search-url.ts');
  assert.match(server, /warnings\.add\('Filtres de la recherche Recruiter'\)/);
  // Le serveur écrit encore les noms « X n° id » que l'écran remplace.
  assert.match(server, /name: `Lieu n° \$\{id\}`/);
});
