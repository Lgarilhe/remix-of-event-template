/**
 * Sourcing : « Coller un lien de recherche LinkedIn » et sélecteur « Projet Recruiter ».
 *
 * Statique :
 * - aucun nom de prestataire dans le code ni dans les textes des deux commandes ;
 * - textes en français, vouvoiement, sans tiret cadratin ni mot de remplissage ;
 * - les deux commandes sont montées dans SearchFiltersPanel et passent par le chemin de
 *   l'IA (`setFilters((prev) => ({ ...prev, ...update }))`) ;
 * - le projet choisi est écrit dans `hiring_project`, déjà envoyé par la recherche.
 * Comportement : lecture des réponses du serveur (formes rendues par `search_from_url`
 * et `list_recruiter_projects`), mise à jour de l'état de filtres, options du sélecteur.
 *
 * Lancer : node --test tests/ux/recherche-lien-projet.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const FILES = [
  'src/components/outreach/search/PasteSearchUrl.tsx',
  'src/components/outreach/search/RecruiterProjectPicker.tsx',
  'src/components/outreach/search/searchControlsCopy.ts',
  'src/components/outreach/search/searchUrlFilters.ts',
  'src/components/outreach/search/recruiterProjectOptions.ts',
];

const VENDORS = /\b(?:unipile|apollo(?:\.io)?|people data labs|pdl|brandfetch|clearbit|logo\.dev|anthropic|claude)\b/i;
const RESEND_BRAND = /\bResend\b/;
const FILLER = /\b(?:crucial\w*|essentiel\w*|robuste\w*|riche\w*|fluide\w*|puissant\w*|innovant\w*|explorer|naviguer|garantir|veiller)\b/i;
const TUTOIEMENT = /\b(?:tu|toi|ton|ta|tes|te|t’|t')\b(?!\.)/i;

const search = await loadTs('src/components/outreach/search/searchUrlFilters.ts');
const projects = await loadTs('src/components/outreach/search/recruiterProjectOptions.ts');
const copy = await loadTs('src/components/outreach/search/searchControlsCopy.ts');
const { INITIAL_FILTERS } = await loadTs('src/components/outreach/types.ts');

// ---------------------------------------------------------------------------
// Statique
// ---------------------------------------------------------------------------

test('aucun nom de prestataire dans les fichiers des deux commandes', () => {
  for (const file of FILES) {
    const code = stripComments(read(file));
    assert.doesNotMatch(code, VENDORS, `${file} nomme un prestataire`);
    assert.doesNotMatch(code, RESEND_BRAND, `${file} nomme un prestataire`);
  }
});

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

test('textes : vouvoiement, sans tiret cadratin, sans mot de remplissage ni prestataire', () => {
  const texts = [
    ...collectStrings(copy.PASTE_URL_COPY),
    ...collectStrings(copy.RECRUITER_PROJECT_COPY),
    ...collectStrings(copy.SEARCH_SOURCE_NAME),
    copy.appliedFiltersText(1),
    copy.appliedFiltersText(4),
    copy.sourceKeptText('classic', 'recruiter'),
    copy.unknownProjectLabel('123'),
  ];
  assert.ok(texts.length > 20);
  for (const text of texts) {
    assert.doesNotMatch(text, /[—–]/, `tiret cadratin : ${text}`);
    assert.doesNotMatch(text, FILLER, `mot de remplissage : ${text}`);
    assert.doesNotMatch(text, TUTOIEMENT, `tutoiement : ${text}`);
    assert.doesNotMatch(text, VENDORS, `prestataire : ${text}`);
    assert.doesNotMatch(text, RESEND_BRAND, `prestataire : ${text}`);
  }
});

test('le panneau de filtres monte les deux commandes par le chemin de l’IA', () => {
  const panel = read('src/components/outreach/search/SearchFiltersPanel.tsx');
  assert.match(panel, /<PasteSearchUrl[\s\S]*?onApplyFilters=\{\(update\) => setFilters\(prev => \(\{ \.\.\.prev, \.\.\.update \}\)\)\}/);
  assert.match(panel, /<RecruiterProjectPicker[\s\S]*?value=\{filters\.hiring_project\}/);
  assert.match(panel, /hiring_project: projectId/);
  // Source LinkedIn seulement, projet Recruiter pour un compte qui a le produit.
  assert.match(panel, /searchSource !== 'database' && filters\.api !== 'database'/);
  assert.match(panel, /filters\.api === 'recruiter' && subscriptions\?\.recruiter/);
});

test('le panneau retire le projet Recruiter hors de la source Recruiter ou en changeant de compte, même sans sélecteur monté', () => {
  const panel = stripComments(read('src/components/outreach/search/SearchFiltersPanel.tsx'));
  assert.match(panel, /shouldClearHiringProject\(\{ projectId: filters\.hiring_project, api: filters\.api, previousAccount, account: selectedAccount \}\)/);
  assert.match(panel, /setFilters\(prev => \(prev\.hiring_project \? \{ \.\.\.prev, hiring_project: '' \} : prev\)\)/);
  // Le retrait ne vit plus dans le sélecteur, démonté hors de la source Recruiter.
  const picker = stripComments(read('src/components/outreach/search/RecruiterProjectPicker.tsx'));
  assert.doesNotMatch(picker, /previousAccount|useEffect/);
});

test('projet Recruiter : retiré hors Recruiter et entre deux comptes connus, gardé pendant le chargement du compte', () => {
  const clear = projects.shouldClearHiringProject;
  assert.equal(clear({ projectId: '', api: 'classic', previousAccount: 'a', account: 'b' }), false, 'rien à retirer');
  assert.equal(clear({ projectId: '123', api: 'recruiter', previousAccount: 'a', account: 'a' }), false);
  assert.equal(clear({ projectId: '123', api: 'recruiter', previousAccount: null, account: 'a' }), false, 'compte pas encore chargé');
  assert.equal(clear({ projectId: '123', api: 'recruiter', previousAccount: 'a', account: null }), false);
  assert.equal(clear({ projectId: '123', api: 'recruiter', previousAccount: 'a', account: 'b' }), true);
  for (const api of ['classic', 'sales_navigator', 'database']) {
    assert.equal(clear({ projectId: '123', api, previousAccount: 'a', account: 'a' }), true, api);
  }
});

test('coller un lien : le focus reste au champ ou revient au bouton, le résultat est annoncé dans une zone déjà montée', () => {
  const src = stripComments(read('src/components/outreach/search/PasteSearchUrl.tsx'));
  // Champ en lecture seule pendant la lecture (un champ désactivé perd le focus).
  assert.match(src, /readOnly=\{loading\}/);
  assert.doesNotMatch(src, /disabled=\{loading\}\s*\n\s*placeholder/);
  // Retour au bouton après « Fermer », Échap ou une réussite.
  assert.match(src, /restoreFocusRef\.current = true;\s*\n\s*setOpen\(false\)/);
  assert.match(src, /triggerRef\.current\?\.focus\(\)/);
  assert.match(src, /<Button\s+ref=\{triggerRef\}/);
  // Zone vocale montée avant le message ; erreur reliée au champ.
  assert.match(src, /<div id=\{`\$\{inputId\}-result`\} role="status" aria-live="polite"[^>]*>\s*\{feedback && \(/);
  assert.match(src, /feedback\?\.tone === 'error' \? `\$\{inputId\}-help \$\{inputId\}-result`/);
});

test('projet Recruiter : libellé sans faux lien, nom du choix annoncé, chargement lu', () => {
  const src = stripComments(read('src/components/outreach/search/RecruiterProjectPicker.tsx'));
  assert.doesNotMatch(src, /<label\b/, 'un <label> sans contrôle associé n’a aucun effet');
  assert.match(src, /<span id=\{labelId\}/);
  assert.match(src, /aria-labelledby=\{`\$\{labelId\} \$\{valueId\}`\}/);
  assert.match(src, /<SelectValue id=\{valueId\}/);
  assert.match(src, /<div role="status">[\s\S]*?<span className="sr-only">\{RECRUITER_PROJECT_COPY\.loading\}<\/span>/);
});

test('les actions appelées existent côté serveur et le projet part par hiring_project', () => {
  const paste = read('src/components/outreach/search/PasteSearchUrl.tsx');
  const picker = read('src/components/outreach/search/RecruiterProjectPicker.tsx');
  const server = read('supabase/functions/unipile-search/index.ts');
  assert.match(paste, /action: 'search_from_url'/);
  assert.match(picker, /action: 'list_recruiter_projects'/);
  assert.match(server, /case 'search_from_url':/);
  assert.match(server, /case 'list_recruiter_projects':/);
  assert.match(read('src/hooks/useLinkedInSearchActions.ts'), /if \(filters\.hiring_project\) baseParams\.hiring_project = filters\.hiring_project;/);
});

test('un message du serveur n’est montré que par le filtre de texte sûr', () => {
  const filters = stripComments(read('src/components/outreach/search/searchUrlFilters.ts'));
  const options = stripComments(read('src/components/outreach/search/recruiterProjectOptions.ts'));
  assert.match(filters, /safeServerMessage/);
  assert.match(options, /safeServerMessage/);
  for (const file of ['PasteSearchUrl.tsx', 'RecruiterProjectPicker.tsx']) {
    const code = stripComments(read(`src/components/outreach/search/${file}`));
    assert.doesNotMatch(code, /data\.error|\btoast\b/, `${file} montre un message brut`);
  }
});

// ---------------------------------------------------------------------------
// Lecture de la réponse de search_from_url (formes rendues par le serveur)
// ---------------------------------------------------------------------------

const CLASSIC = {
  success: true,
  kind: 'classic',
  keywords: 'product manager',
  filters: {
    api: 'classic',
    category: 'people',
    keywords: 'product manager',
    network_distance: [1, 2],
    location: [{ id: '105015875', name: 'Lieu n° 105015875', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    company: [{ id: '1441', name: 'Entreprise n° 1441', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    profile_language: ['fr'],
  },
  warnings: ['Catégorie de service'],
};

const SALES = {
  success: true,
  kind: 'sales_navigator',
  keywords: 'python',
  filters: {
    api: 'sales_navigator',
    category: 'people',
    keywords: 'python',
    location: [{ id: '105015875', name: 'France', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    job_title: [
      { id: '9', name: 'Chief Technology Officer', priority: 'CAN_HAVE' },
      { id: '25', name: 'Intern', priority: 'DOESNT_HAVE' },
    ],
    company: [{ id: '1337', name: 'Acme', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    industry: [{ id: '4', name: 'Software Development' }],
    school: [{ id: '12', name: 'Polytechnique', priority: 'MUST_HAVE' }],
    network_distance: [2],
  },
  warnings: ['Lieux (exclusions)', 'Secteurs (exclusions)', 'Séniorité'],
};

const RECRUITER = {
  success: true,
  kind: 'recruiter',
  keywords: 'developpeur react',
  filters: { api: 'recruiter', category: 'people', keywords: 'developpeur react' },
  warnings: ['Filtres de la recherche Recruiter'],
};

const parse = (data) => {
  const outcome = search.parseSearchFromUrlResponse(data);
  assert.ok(!('message' in outcome), `lecture refusée : ${outcome.message}`);
  return outcome.value;
};

test('lecture : réponses Classic, Sales Navigator et Recruiter', () => {
  assert.equal(parse(CLASSIC).kind, 'classic');
  assert.deepEqual(parse(CLASSIC).warnings, ['Catégorie de service']);
  assert.equal(parse(SALES).kind, 'sales_navigator');
  assert.equal(parse(RECRUITER).keywords, 'developpeur react');
});

test('lecture : un refus du serveur donne sa phrase française, un texte de prestataire est remplacé', () => {
  const refused = search.parseSearchFromUrlResponse({
    success: false,
    error: "Cette adresse LinkedIn n'est pas une recherche. Collez l'adresse d'une page de résultats de recherche.",
    errorType: 'INVALID_SEARCH_URL',
  });
  assert.equal(refused.message, "Cette adresse LinkedIn n'est pas une recherche. Collez l'adresse d'une page de résultats de recherche.");
  const leaked = search.parseSearchFromUrlResponse({ success: false, error: 'Unipile responded 500' });
  assert.equal(leaked.message, copy.PASTE_URL_COPY.genericError);
  for (const bad of [null, undefined, 'x', [], { success: true }, { success: true, kind: 'jobs', filters: {} }, { success: true, kind: 'classic' }]) {
    assert.equal(search.parseSearchFromUrlResponse(bad).message !== undefined, true);
  }
  const cleaned = parse({ ...CLASSIC, warnings: ['Séniorité', 'Séniorité', 'Réponse de Unipile', 42] });
  assert.deepEqual(cleaned.warnings, ['Séniorité']);
});

// ---------------------------------------------------------------------------
// Mise à jour de l'état de filtres
// ---------------------------------------------------------------------------

const ALL_APIS = ['classic', 'recruiter', 'sales_navigator'];
const merge = (prev, update) => ({ ...prev, ...update });

test('mise à jour : une adresse Sales Navigator remplit les critères et la source', () => {
  const { update, count, warnings } = search.buildSearchUrlUpdate(parse(SALES), { currentApi: 'recruiter', availableApis: ALL_APIS });
  assert.equal(update.api, 'sales_navigator');
  assert.equal(update.category, 'people');
  assert.equal(update.keywords, 'python');
  assert.equal(update.location.length, 1);
  assert.ok(update.location.every((l) => l.priority !== 'DOESNT_HAVE'), 'aucun lieu exclu : la recherche hors Recruiter le refuserait');
  assert.equal(update.job_title[0].name, 'Chief Technology Officer');
  assert.deepEqual(update.network_distance, [2]);
  assert.equal(update.school[0].priority, 'MUST_HAVE');
  // keywords, location, job_title, company, industry, school, network_distance
  assert.equal(count, 7);
  assert.deepEqual(warnings, ['Lieux (exclusions)', 'Secteurs (exclusions)', 'Séniorité']);
});

test('mise à jour : les critères de l’adresse remplacent ceux de même type, les autres filtres restent', () => {
  const prev = {
    ...INITIAL_FILTERS,
    api: 'recruiter',
    keywords: 'ancien brief',
    location: [{ id: '1', name: 'Lyon', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    school: [{ id: '2', name: 'HEC', priority: 'MUST_HAVE' }],
    skills_keywords: ['react'],
    years_of_experience_min: 5,
    hiring_project: '777',
  };
  const { update } = search.buildSearchUrlUpdate(parse(CLASSIC), { currentApi: 'recruiter', availableApis: ['recruiter'] });
  const next = merge(prev, update);
  assert.equal(next.keywords, 'product manager');
  assert.deepEqual(next.location.map((l) => l.id), ['105015875']);
  assert.deepEqual(next.school, [], 'un critère absent de l’adresse est vidé');
  assert.deepEqual(next.skills_keywords, ['react']);
  assert.equal(next.years_of_experience_min, 5);
  assert.equal(next.hiring_project, '777');
  assert.equal(next.api, 'recruiter', 'Classic non disponible : la source reste');
});

test('mise à jour : source indisponible sur le compte, la source en cours est gardée et dite', () => {
  const { update, warnings } = search.buildSearchUrlUpdate(parse(CLASSIC), { currentApi: 'recruiter', availableApis: ['recruiter'] });
  assert.equal('api' in update, false);
  assert.ok(warnings.includes('Catégorie de service'));
  assert.ok(warnings.some((w) => w.includes('Classic') && w.includes('Recruiter')));
  // Même source : rien à dire.
  const same = search.buildSearchUrlUpdate(parse(RECRUITER), { currentApi: 'recruiter', availableApis: ['recruiter'] });
  assert.equal(same.update.api, 'recruiter');
  assert.deepEqual(same.warnings, [copy.PASTE_URL_COPY.recruiterFilters]);
});

test('mise à jour : adresse Recruiter, mots-clés seulement, les autres critères ne sont pas vidés', () => {
  const { update, count } = search.buildSearchUrlUpdate(parse(RECRUITER), { currentApi: 'recruiter', availableApis: ['recruiter'] });
  assert.equal(count, 1);
  assert.equal(update.keywords, 'developpeur react');
  // L'adresse Recruiter ne dit rien des lieux, écoles, entreprises : ceux de la mission ou de la personne restent.
  const prev = {
    ...INITIAL_FILTERS,
    location: [{ id: '1', name: 'Lyon', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    school: [{ id: '2', name: 'HEC', priority: 'MUST_HAVE' }],
    company: [{ id: '3', name: 'Acme', priority: 'CAN_HAVE', scope: 'CURRENT' }],
    job_title: [{ id: '4', name: 'CTO', priority: 'CAN_HAVE' }],
  };
  const next = merge(prev, update);
  assert.equal(next.keywords, 'developpeur react');
  assert.equal(next.location.length, 1);
  assert.equal(next.school.length, 1);
  assert.equal(next.company.length, 1);
  assert.equal(next.job_title.length, 1);
  assert.deepEqual(Object.keys(update).sort(), ['api', 'category', 'keywords']);
});

test('mise à jour : une adresse Classic vide les critères qu’elle porte, pas ceux de Sales Navigator seul', () => {
  const prev = {
    ...INITIAL_FILTERS,
    job_title: [{ id: '4', name: 'CTO', priority: 'CAN_HAVE' }],
    groups: [{ id: '5', name: 'Groupe' }],
    school: [{ id: '2', name: 'HEC', priority: 'MUST_HAVE' }],
  };
  const classic = merge(prev, search.buildSearchUrlUpdate(parse(CLASSIC), { currentApi: 'classic', availableApis: ['classic'] }).update);
  assert.equal(classic.job_title.length, 1, 'Classic ne dit rien des intitulés');
  assert.equal(classic.groups.length, 1);
  assert.deepEqual(classic.school, [], 'Classic dit les écoles : absentes de l’adresse, elles sont vidées');
  const sales = merge(prev, search.buildSearchUrlUpdate(parse(SALES), { currentApi: 'sales_navigator', availableApis: ALL_APIS }).update);
  assert.equal(sales.groups.length, 0, 'Sales Navigator dit aussi les groupes');
});

test('mise à jour : rien de lisible, rien n’est remplacé', () => {
  const empty = { ...RECRUITER, keywords: null, filters: { api: 'recruiter', category: 'people' } };
  const { update, count, warnings } = search.buildSearchUrlUpdate(parse(empty), { currentApi: 'recruiter', availableApis: ALL_APIS });
  assert.equal(count, 0);
  assert.deepEqual(update, {});
  assert.deepEqual(warnings, [copy.PASTE_URL_COPY.recruiterFilters]);
});

test('mise à jour : les valeurs mal formées sont écartées, jamais corrigées', () => {
  const dirty = parse({
    success: true,
    kind: 'sales_navigator',
    keywords: null,
    filters: {
      location: [{ id: 5, name: 'Nantes', priority: 'WRONG', scope: 'NOPE' }, { id: '', name: 'Vide' }, { name: 'Sans id' }, 'texte', null],
      network_distance: [1, 4, '2', 3],
      profile_language: ['fr', 'x y', 7],
      first_name: '  Ada ',
      title_keywords: 12,
      job_title: 'pas une liste',
    },
    warnings: [],
  });
  const { update, count } = search.buildSearchUrlUpdate(dirty, { currentApi: 'sales_navigator', availableApis: ALL_APIS });
  assert.deepEqual(update.location, [{ id: '5', name: 'Nantes', priority: 'CAN_HAVE', scope: 'CURRENT' }]);
  assert.deepEqual(update.network_distance, [1, 3]);
  assert.deepEqual(update.profile_language, ['fr']);
  // Prénom, nom et intitulé n'ont ni champ ni envoi : jamais écrits dans les filtres, jamais comptés.
  assert.equal('first_name' in update, false);
  assert.equal('last_name' in update, false);
  assert.equal('title_keywords' in update, false);
  assert.deepEqual(update.job_title, []);
  assert.equal(count, 3);
});

test('mise à jour : les listes remises à zéro ne partagent pas celles de l’état initial', () => {
  const { update } = search.buildSearchUrlUpdate(parse(SALES), { currentApi: 'sales_navigator', availableApis: ALL_APIS });
  update.past_company.push({ id: 'x' });
  update.groups.push({ id: 'y' });
  update.location.push({ id: 'z' });
  assert.deepEqual(INITIAL_FILTERS.location, []);
  assert.deepEqual(INITIAL_FILTERS.groups, []);
});

test('sources disponibles : même règle que le sélecteur de source de l’écran', () => {
  assert.deepEqual(search.availableSearchApis(undefined), ['classic']);
  assert.deepEqual(search.availableSearchApis({ recruiter: false, sales_navigator: false }), ['classic']);
  assert.deepEqual(search.availableSearchApis({ recruiter: true }), ['recruiter']);
  assert.deepEqual(search.availableSearchApis({ recruiter: true, sales_navigator: true }), ['recruiter', 'sales_navigator']);
  assert.deepEqual(search.availableSearchApis({ sales_navigator: true }), ['sales_navigator']);
});

// ---------------------------------------------------------------------------
// Projets Recruiter
// ---------------------------------------------------------------------------

test('projets : lecture de la page rendue par le serveur', () => {
  const page = projects.parseRecruiterProjectsResponse({
    success: true,
    projects: [
      { id: '101', name: 'CTO Paris', archived: false, shared: true, owner_name: 'Ada', created_at: null, last_modified_at: null },
      { id: '102', name: ' Ancien projet ', archived: true },
      { id: 'abc', name: 'Identifiant invalide' },
      { id: '103', name: '' },
      { id: 104, name: 'Identifiant numérique' },
      null,
    ],
    cursor: 'offset:100',
    total: 120,
  });
  assert.deepEqual(page.projects.map((p) => [p.id, p.name, p.archived]), [
    ['101', 'CTO Paris', false],
    ['102', 'Ancien projet', true],
    ['104', 'Identifiant numérique', false],
  ]);
  assert.equal(page.cursor, 'offset:100');
  const last = projects.parseRecruiterProjectsResponse({ success: true, projects: [], cursor: null, total: 0 });
  assert.deepEqual(last, { projects: [], cursor: null });
});

test('projets : erreurs, la licence manquante ne se rejoue pas', () => {
  assert.throws(() => projects.parseRecruiterProjectsResponse({
    success: false,
    errorType: 'LICENCE_UNAVAILABLE',
    error: 'Ce compte LinkedIn n’a pas de licence Recruiter : les projets Recruiter ne sont pas disponibles.',
  }), (e) => e.retryable === false && e.message.includes('licence Recruiter'));
  assert.throws(() => projects.parseRecruiterProjectsResponse({ success: false, error: 'Unipile 500' }),
    (e) => e.retryable === true && e.message === copy.RECRUITER_PROJECT_COPY.error);
  assert.throws(() => projects.parseRecruiterProjectsResponse(null), (e) => e.retryable === true);
  assert.throws(() => projects.parseRecruiterProjectsResponse({ success: true }), (e) => e.retryable === true);
  assert.throws(() => projects.parseRecruiterProjectsResponse({
    success: false, errorType: 'LICENCE_UNAVAILABLE', error: 'Réponse de Unipile',
  }), (e) => e.retryable === false && e.message === copy.RECRUITER_PROJECT_COPY.error);
});

test('projets : options, en cours d’abord, archivés ensuite, projet choisi absent gardé', () => {
  const list = [
    { id: '1', name: 'A', archived: true },
    { id: '2', name: 'B', archived: false },
    { id: '2', name: 'B doublon', archived: false },
    { id: '3', name: 'C', archived: false },
  ];
  assert.deepEqual(projects.projectOptions(list, ''), [
    { id: '2', label: 'B' },
    { id: '3', label: 'C' },
    { id: '1', label: 'A (archivé)' },
  ]);
  assert.deepEqual(projects.projectOptions(list, '3').map((o) => o.id), ['2', '3', '1']);
  assert.deepEqual(projects.projectOptions(list, '999').at(-1), { id: '999', label: 'Projet n° 999' });
  assert.deepEqual(projects.projectOptions([], ''), []);
});
