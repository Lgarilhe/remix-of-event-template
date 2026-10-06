/**
 * Lecture d'offres depuis une adresse web : fonction fetch-job-source.
 *
 *  - garde SSRF (guard.ts) : seules des adresses https publiques sont lues ;
 *  - classification des adresses (Greenhouse, Lever, Ashby, Recruitee, Welcome to
 *    the Jungle, LinkedIn, autres) ;
 *  - lecteurs des interfaces publiques, des données JobPosting, du texte et des
 *    cartes d'offres, sur des réponses simulées ;
 *  - conventions du handler (auth, appartenance, limite de débit, redirections).
 *
 * Les formats des interfaces des logiciels de recrutement sont ceux de leur
 * documentation publique ; ils n'ont pas été vérifiés contre l'interface réelle.
 *
 * Lancer : node --test tests/ux/lecture-offres-serveur.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
// Commentaires de bloc en début de ligne seulement : « */* » d'un en-tête Accept n'en ouvre pas un.
const code = (src) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const DIR = 'supabase/functions/fetch-job-source';
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './${DIR}/guard.ts'; export * from './${DIR}/readers.ts'; export * from './${DIR}/resolve.ts';`,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const k = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const url = (s) => new URL(s);

// ─── Garde SSRF ────────────────────────────────────────────────────────

test('SSRF : une adresse https publique est admise', () => {
  for (const ok of [
    'https://www.welcometothejungle.com/fr/companies/numspot/jobs',
    'https://boards.greenhouse.io/acme',
    'https://jobs.lever.co/acme/5f2a6c7e-1111-4222-8333-444455556666?lever-source=x',
    'https://carrières.exemple.fr/offres/ingenieur',
  ]) {
    assert.equal(k.checkPublicHttpsUrl(ok).ok, true, ok);
  }
});

test('SSRF : http, identifiants, ports, noms internes et adresses IP sont refusés', () => {
  const refused = {
    'http://example.com/jobs': 'not_https',
    'ftp://example.com/jobs': 'not_https',
    'https://user:secret@example.com/jobs': 'credentials',
    'https://example.com:8443/jobs': 'port',
    'https://localhost/admin': 'private_host',
    'https://intranet/offres': 'private_host',
    'https://metadata.google.internal/computeMetadata/v1/': 'private_host',
    'https://service.local/': 'private_host',
    'https://printer.lan/': 'private_host',
    'https://127.0.0.1/': 'private_host',
    'https://10.0.0.5/': 'private_host',
    'https://192.168.1.10/': 'private_host',
    'https://169.254.169.254/latest/meta-data/': 'private_host',
    'https://8.8.8.8/': 'private_host',
    'https://[::1]/': 'private_host',
    'https://[fd00::1]/': 'private_host',
    // Écritures détournées d'une adresse de loopback : new URL les ramène à 127.0.0.1.
    'https://2130706433/': 'private_host',
    'https://0x7f.1/': 'private_host',
    'https://0177.0.0.1/': 'private_host',
  };
  for (const [raw, reason] of Object.entries(refused)) {
    const check = k.checkPublicHttpsUrl(raw);
    assert.equal(check.ok, false, `${raw} doit être refusée`);
    assert.equal(check.reason, reason, raw);
  }
  for (const bad of ['', 'pas une adresse', 'https://', `https://example.com/${'a'.repeat(2100)}`, undefined, 42]) {
    assert.equal(k.checkPublicHttpsUrl(bad).ok, false);
  }
});

test('SSRF : adresses privées, réservées et IPv6 locales', () => {
  for (const ip of [
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '[::1]',
  ]) {
    assert.equal(k.isPrivateIp(ip), true, `${ip} est privée`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(k.isPrivateIp(ip), false, `${ip} est publique`);
  }
});

// ─── Classification ────────────────────────────────────────────────────

test('classification : logiciels de recrutement', () => {
  assert.deepEqual(k.classifyUrl(url('https://boards.greenhouse.io/acme')), { source: 'greenhouse', kind: 'company', org: 'acme' });
  assert.deepEqual(k.classifyUrl(url('https://job-boards.greenhouse.io/acme/jobs/4001')), { source: 'greenhouse', kind: 'job', org: 'acme', jobRef: '4001' });
  assert.deepEqual(k.classifyUrl(url('https://boards.greenhouse.io/embed/job_board?for=acme')), { source: 'greenhouse', kind: 'company', org: 'acme' });
  const leverJob = '5f2a6c7e-1111-4222-8333-444455556666';
  assert.deepEqual(k.classifyUrl(url(`https://jobs.lever.co/acme/${leverJob}`)), { source: 'lever', kind: 'job', org: 'acme', jobRef: leverJob, eu: false });
  assert.deepEqual(k.classifyUrl(url('https://jobs.eu.lever.co/acme')), { source: 'lever', kind: 'company', org: 'acme', eu: true });
  assert.deepEqual(k.classifyUrl(url('https://jobs.ashbyhq.com/acme')), { source: 'ashby', kind: 'company', org: 'acme' });
  assert.equal(k.classifyUrl(url(`https://jobs.ashbyhq.com/acme/${leverJob}`)).kind, 'job');
  assert.deepEqual(k.classifyUrl(url('https://acme.recruitee.com/')), { source: 'recruitee', kind: 'company', org: 'acme' });
  assert.deepEqual(k.classifyUrl(url('https://acme.recruitee.com/o/data-engineer')), { source: 'recruitee', kind: 'job', org: 'acme', jobRef: 'data-engineer' });
  assert.equal(k.classifyUrl(url('https://api.recruitee.com/x')).source, 'generic');
});

test('classification : Welcome to the Jungle, LinkedIn et pages quelconques', () => {
  const wttj = (p) => k.classifyUrl(url(`https://www.welcometothejungle.com${p}`));
  assert.deepEqual(wttj('/fr/companies/numspot/jobs'), { source: 'wttj', kind: 'company', org: 'numspot' });
  assert.deepEqual(wttj('/fr/companies/numspot'), { source: 'wttj', kind: 'company', org: 'numspot' });
  assert.deepEqual(wttj('/fr/companies/numspot/jobs/expert-securite_courbevoie'), {
    source: 'wttj', kind: 'job', org: 'numspot', jobRef: 'expert-securite_courbevoie',
  });
  assert.equal(wttj('/en/companies/numspot/jobs/x').kind, 'job');
  assert.equal(wttj('/fr/pages/emploi-developpeur').source, 'generic');
  assert.equal(k.classifyUrl(url('https://www.linkedin.com/jobs/view/123456')).source, 'linkedin');
  assert.equal(k.classifyUrl(url('https://fr.linkedin.com/company/acme/jobs')).source, 'linkedin');
  assert.equal(k.classifyUrl(url('https://acme.com/careers/senior-engineer')).kind, 'job');
  assert.equal(k.classifyUrl(url('https://acme.com/careers')).kind, 'company');
  assert.equal(k.classifyUrl(url('https://acme.com/recrutement/')).kind, 'company');
  assert.equal(k.classifyUrl(url('https://acme.com/a-propos')).kind, 'unknown');
});

test('interfaces des logiciels de recrutement : hôtes fixes, jeton validé et encodé', () => {
  assert.equal(
    k.atsApiUrls({ source: 'greenhouse', kind: 'job', org: 'acme', jobRef: '4001' }).single,
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs/4001',
  );
  assert.equal(k.atsApiUrls({ source: 'lever', kind: 'company', org: 'acme', eu: true }).list, 'https://api.eu.lever.co/v0/postings/acme?mode=json');
  assert.equal(k.atsApiUrls({ source: 'ashby', kind: 'company', org: 'acme' }).list, 'https://api.ashbyhq.com/posting-api/job-board/acme');
  assert.equal(k.atsApiUrls({ source: 'recruitee', kind: 'company', org: 'acme' }).list, 'https://acme.recruitee.com/api/offers/');
  // Un jeton qui n'est pas un simple identifiant ne construit aucune adresse.
  for (const org of ['a/b', 'a b', '../x', 'a@evil.com', 'x'.repeat(81), '']) {
    assert.equal(k.atsApiUrls({ source: 'greenhouse', kind: 'company', org }), null, org);
  }
  assert.equal(k.atsApiUrls({ source: 'wttj', kind: 'company', org: 'numspot' }), null);
});

// ─── Texte ─────────────────────────────────────────────────────────────

test('texte : HTML encodé en entités (Greenhouse), listes, paragraphes et accents', () => {
  const encoded = '&lt;h3&gt;Vos missions&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;D&amp;eacute;tecter&lt;/li&gt;&lt;li&gt;R&eacute;pondre&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Poste &agrave; Paris &#8211; CDI&lt;/p&gt;';
  const text = k.htmlToText(encoded);
  assert.match(text, /^Vos missions\n\n- /);
  assert.match(text, /- Répondre/);
  assert.match(text, /Poste à Paris – CDI$/);
  assert.doesNotMatch(text, /[<>]|&[a-z#]+;/);
  // HTML ordinaire : scripts, styles et menus retirés.
  const page = k.htmlToText('<nav>Menu</nav><script>alert(1)</script><style>p{}</style><p>Première<br>ligne</p><p>Seconde</p>');
  assert.equal(page, 'Première\nligne\n\nSeconde');
});

test('texte : Markdown rendu, titre et liens', () => {
  const md = '# Expert Sécurité\n\n![logo](https://x/y.png)\n**Vos missions** : voir [le détail](https://x/z).\n* Détecter\n* Répondre';
  assert.equal(k.firstMarkdownHeading(md), 'Expert Sécurité');
  const text = k.markdownToText(md);
  assert.doesNotMatch(text, /!\[|\]\(|\*\*/);
  assert.match(text, /Vos missions : voir le détail\./);
  assert.match(text, /- Détecter\n- Répondre/);
  assert.deepEqual(k.extractMarkdownLinks(md).map((l) => l.url), ['https://x/z'], 'les images ne sont pas des liens');
});

test('texte : contenu mince et mur de cookies', () => {
  assert.equal(k.looksThin('court'), true);
  assert.equal(k.looksThin('x'.repeat(700)), false);
  assert.equal(k.looksThin(`Nous utilisons des cookies pour améliorer. ${'x'.repeat(900)}`), true);
  assert.equal(k.looksThin(`${'x'.repeat(900)} cookies`), false);
});

// ─── Données JobPosting ────────────────────────────────────────────────

const JSON_LD_PAGE = `<html><head>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Numspot Carrières' },
    {
      '@type': 'JobPosting',
      title: 'Expert Sécurité Opérationnelle',
      description: '&lt;p&gt;Vos missions&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Gérer les incidents&lt;/li&gt;&lt;/ul&gt;',
      datePosted: '2026-09-20',
      employmentType: 'FULL_TIME',
      hiringOrganization: { '@type': 'Organization', name: 'Numspot' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Courbevoie', addressCountry: 'FR' } },
      jobLocationType: 'TELECOMMUTE',
      baseSalary: { '@type': 'MonetaryAmount', currency: 'EUR', value: { '@type': 'QuantitativeValue', minValue: 60000, maxValue: 75000, unitText: 'YEAR' } },
      identifier: { '@type': 'PropertyValue', value: 'SEC-12' },
    },
  ],
})}</script>
<script type="application/ld+json">{ ceci n'est pas du json</script>
</head><body></body></html>`;

test('JobPosting : titre, société, lieu, contrat, salaire et description lisibles', () => {
  const jobs = k.extractJsonLdJobs(JSON_LD_PAGE, 'https://carrieres.numspot.com/offres/securite');
  assert.equal(jobs.length, 1, 'le bloc illisible est ignoré sans erreur');
  const [job] = jobs;
  assert.equal(job.title, 'Expert Sécurité Opérationnelle');
  assert.equal(job.company, 'Numspot');
  assert.equal(job.location, 'Courbevoie, FR, télétravail');
  assert.equal(job.contract, 'Temps plein');
  assert.equal(job.id, 'SEC-12');
  assert.equal(job.posted_at, '2026-09-20');
  assert.match(job.description, /Vos missions\n\n- Gérer les incidents/);
  assert.match(job.description, /Rémunération : 60000 à 75000 EUR par an$/);
});

test('JobPosting : plusieurs offres dans une liste, doublons retirés, aucune offre sans titre', () => {
  const list = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'JobPosting', title: 'Dev', url: '/jobs/dev', description: 'a' },
    { '@type': 'JobPosting', title: 'Dev', url: '/jobs/dev', description: 'a' },
    { '@type': ['JobPosting'], title: 'Ops', url: 'https://acme.com/jobs/ops', description: '<b>b</b>' },
    { '@type': 'JobPosting', description: 'sans titre' },
    { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'JobPosting', title: 'QA', url: '/jobs/qa' } }] },
  ])}</script>`;
  const jobs = k.extractJsonLdJobs(list, 'https://acme.com/careers');
  assert.deepEqual(jobs.map((j) => j.title), ['Dev', 'Ops', 'QA']);
  assert.equal(jobs[0].url, 'https://acme.com/jobs/dev', 'adresse relative résolue');
  assert.equal(k.extractJsonLdJobs('<html></html>', 'https://acme.com').length, 0);
});

// ─── Interfaces publiques des logiciels de recrutement ─────────────────

test('Greenhouse : liste sans fiche, fiche avec contenu encodé', () => {
  const list = k.parseGreenhouseList({
    jobs: [
      { id: 4001, title: 'Ingénieur Sécurité', updated_at: '2026-10-01', location: { name: 'Paris' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/4001', content: '&lt;p&gt;texte&lt;/p&gt;' },
      { id: 4002, title: 'SRE', location: { name: 'Remote' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/4002' },
      { id: 4003 },
    ],
  }, 'acme');
  assert.deepEqual(list.map((j) => [j.id, j.title, j.location, j.company]), [
    ['4001', 'Ingénieur Sécurité', 'Paris', 'Acme'],
    ['4002', 'SRE', 'Remote', 'Acme'],
  ]);
  assert.ok(list.every((j) => j.description === undefined), 'la liste reste légère');
  const job = k.parseGreenhouseJob({
    id: 4001, title: 'Ingénieur Sécurité', absolute_url: 'https://boards.greenhouse.io/acme/jobs/4001', location: { name: 'Paris' },
    content: '&lt;h3&gt;Vos missions&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Détecter&lt;/li&gt;&lt;li&gt;Répondre&lt;/li&gt;&lt;/ul&gt;',
  }, 'acme');
  assert.match(job.description, /^Vos missions\n\n- Détecter\n- Répondre$/);
  assert.equal(k.parseGreenhouseJob({ id: 1 }, 'acme'), null);
  assert.deepEqual(k.parseGreenhouseList('n importe quoi', 'acme'), []);
});

test('Lever : fiche assemblée (description, listes, complément), lieu et contrat', () => {
  const id = '5f2a6c7e-1111-4222-8333-444455556666';
  const posting = {
    id, text: 'Staff Engineer', categories: { commitment: 'CDI', location: 'Paris', team: 'Plateforme' },
    descriptionPlain: 'Nous construisons la plateforme.',
    lists: [{ text: 'Vos missions', content: '<li>Concevoir</li><li>Livrer</li>' }],
    additionalPlain: 'Télétravail partiel.',
    hostedUrl: `https://jobs.lever.co/acme/${id}`, createdAt: 1759300000000,
  };
  const job = k.parseLeverPosting(posting, 'acme');
  assert.equal(job.title, 'Staff Engineer');
  assert.equal(job.contract, 'CDI');
  assert.equal(job.location, 'Paris');
  assert.match(job.posted_at, /^2025-/);
  assert.equal(job.description, 'Nous construisons la plateforme.\n\nVos missions\n- Concevoir\n- Livrer\n\nTélétravail partiel.');
  const list = k.parseLeverList([posting, { text: 'sans adresse' }], 'acme');
  assert.equal(list.length, 1);
  assert.equal(list[0].description, undefined);
});

test('Ashby et Recruitee : fiches et listes', () => {
  const ashby = k.parseAshbyList({
    jobs: [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', title: 'Product Designer', location: 'Paris', isRemote: true, employmentType: 'FullTime', publishedAt: '2026-09-30', jobUrl: 'https://jobs.ashbyhq.com/acme/a1b2c3d4-0000-4000-8000-000000000001', descriptionHtml: '<p>Concevez le produit.</p>' }, { title: 'Sans adresse' }],
  }, 'acme');
  assert.equal(ashby.length, 1);
  assert.equal(ashby[0].location, 'Paris, télétravail');
  assert.equal(ashby[0].contract, 'Temps plein');
  assert.equal(ashby[0].description, 'Concevez le produit.');

  const recruitee = k.parseRecruiteeList({
    offers: [{ id: 77, title: 'Data Engineer', location: 'Lyon, France', employment_type_code: 'fulltime', careers_url: 'https://acme.recruitee.com/o/data-engineer', published_at: '2026-09-01', description: '<p>Vos missions</p>', requirements: '<p>Python</p>' }],
  }, 'acme');
  assert.equal(recruitee[0].title, 'Data Engineer');
  assert.equal(recruitee[0].description, 'Vos missions\n\nPython');
  assert.equal(recruitee[0].company, 'Acme');
  assert.ok(k.withoutDescriptions(recruitee).every((j) => j.description === undefined));
});

// ─── Cartes d'offres d'une page société ────────────────────────────────

test('Welcome to the Jungle : offres de la société, carte complète, sans doublon ni autre société', () => {
  const md = [
    '# Numspot',
    '[Voir l\'offre](https://www.welcometothejungle.com/fr/companies/numspot/jobs/expert-securite-operationnelle_courbevoie)',
    '[Expert Sécurité Opérationnelle\n\nCDI\n\nCourbevoie](https://www.welcometothejungle.com/fr/companies/numspot/jobs/expert-securite-operationnelle_courbevoie?q=abc&o=123)',
    '[DevOps Senior Kubernetes\n\nCDI\n\nParis](https://www.welcometothejungle.com/fr/companies/numspot/jobs/devops-senior-kubernetes_paris)',
    '[Développeur](https://www.welcometothejungle.com/fr/companies/autre-societe/jobs/dev_paris)',
    '[Mentions légales](https://www.welcometothejungle.com/fr/pages/legal)',
    '[Postuler](https://www.welcometothejungle.com/fr/companies/numspot/jobs/stage-data_lyon-3)',
  ].join('\n');
  const jobs = k.wttjJobsFromLinks(k.extractMarkdownLinks(md), 'numspot');
  assert.deepEqual(jobs.map((j) => [j.title, j.contract, j.location]), [
    ['Expert Sécurité Opérationnelle', 'CDI', 'Courbevoie'],
    ['DevOps Senior Kubernetes', 'CDI', 'Paris'],
    ['Stage Data', undefined, 'Lyon'],
  ]);
  assert.equal(jobs[0].url, 'https://www.welcometothejungle.com/fr/companies/numspot/jobs/expert-securite-operationnelle_courbevoie', 'sans paramètres de recherche');
  assert.ok(jobs.every((j) => j.company === 'Numspot'));
});

test('pages société quelconques : liens d\'offres du même site, sans doublon ni la page elle-même', () => {
  const links = [
    { url: 'https://acme.com/careers/senior-engineer', text: 'Senior Engineer\n\nCDI\n\nParis' },
    { url: 'https://acme.com/careers/senior-engineer?utm_source=x' },
    { url: 'https://acme.com/careers/' },
    { url: 'https://autre.com/careers/ailleurs' },
    { url: 'https://acme.com/a-propos' },
    { url: 'https://www.acme.com/jobs/data-analyst-paris', text: 'Data Analyst' },
  ];
  const jobs = k.genericJobLinks(links, 'https://acme.com/careers');
  assert.deepEqual(jobs.map((j) => [j.title, j.contract, j.location]), [
    ['Senior Engineer', 'CDI', 'Paris'],
    ['Data Analyst', undefined, undefined],
  ]);
  assert.equal(k.companyFromHost('www.acme-corp.com'), 'Acme Corp');
  assert.equal(k.companyFromHost('carrieres.acme.fr'), 'Acme');
});

// ─── Flux de lecture, réseau simulé ────────────────────────────────────

const LONG = (n = 900) => `Vos missions : ${'gérer les incidents de sécurité, '.repeat(Math.ceil(n / 32))}`.slice(0, n);
const WTTJ_JOB = 'https://www.welcometothejungle.com/fr/companies/numspot/jobs/expert-securite_courbevoie';
const WTTJ_COMPANY = 'https://www.welcometothejungle.com/fr/companies/numspot/jobs';
const WTTJ_MD = [
  '# Numspot',
  '[Expert Sécurité Opérationnelle\n\nCDI\n\nCourbevoie](https://www.welcometothejungle.com/fr/companies/numspot/jobs/expert-securite_courbevoie)',
  '[DevOps Senior Kubernetes\n\nCDI\n\nParis](https://www.welcometothejungle.com/fr/companies/numspot/jobs/devops-senior-kubernetes_paris)',
].join('\n');

/** Réseau simulé : pages, JSON et rendus par adresse ; une adresse absente lève une exception, comme un échec réel. */
function fakeNet({ pages = {}, json = {}, rendered = {}, firecrawl = true } = {}) {
  const calls = { pages: [], json: [], scrape: [] };
  const deps = {
    async fetchPage(u) { calls.pages.push(u); if (u in pages) return pages[u]; throw new Error('HTTP 403'); },
    async fetchJson(u) { calls.json.push(u); if (u in json) return json[u]; throw new Error('HTTP 404'); },
    async allowFirecrawl() { return firecrawl; },
    async scrape(u, mainOnly) { calls.scrape.push([u, mainOnly]); if (u in rendered) return rendered[u]; throw new Error('Firecrawl 500'); },
  };
  return { deps, calls };
}
const silently = async (fn) => {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, warn }); }
};
const resolve = (net, u, expectJob = false) => silently(() => k.resolveUrl(url(u), net.deps, expectJob));

test('flux : la liste d\'une société sur un logiciel de recrutement ne lit aucune page', async () => {
  const net = fakeNet({ json: { 'https://boards-api.greenhouse.io/v1/boards/acme/jobs': {
    jobs: [{ id: 1, title: 'SRE', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Paris' } }, { id: 2, title: 'QA', absolute_url: 'https://boards.greenhouse.io/acme/jobs/2' }],
  } } });
  const r = await resolve(net, 'https://boards.greenhouse.io/acme');
  assert.equal(r.kind, 'company');
  assert.equal(r.reader, 'ats_api');
  assert.deepEqual(r.jobs.map((j) => j.title), ['SRE', 'QA']);
  assert.equal(r.company.name, 'Acme');
  assert.deepEqual([net.calls.pages, net.calls.scrape], [[], []], 'ni page lue, ni Firecrawl facturé');
});

test('flux : une offre Greenhouse arrive entière par l\'interface, une fiche trop courte passe au niveau suivant', async () => {
  const api = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/9';
  const page = 'https://boards.greenhouse.io/acme/jobs/9';
  const full = fakeNet({ json: { [api]: { id: 9, title: 'SRE', absolute_url: page, content: `&lt;p&gt;${LONG()}&lt;/p&gt;` } } });
  const ok = await resolve(full, page);
  assert.deepEqual([ok.kind, ok.reader, ok.job.title], ['job', 'ats_api', 'SRE']);
  assert.ok(ok.job.description.length >= 300);
  assert.equal(full.calls.pages.length, 0);

  const short = fakeNet({
    json: { [api]: { id: 9, title: 'SRE', absolute_url: page, content: '&lt;p&gt;Trop court&lt;/p&gt;' } },
    pages: { [page]: `<html><head><title>SRE | Acme</title></head><body><h1>SRE</h1>${`<p>${LONG(1200)}</p>`}</body></html>` },
  });
  const fallback = await resolve(short, page);
  assert.deepEqual([fallback.kind, fallback.reader, fallback.job.title], ['job', 'direct_text', 'SRE']);
});

test('flux : une interface en panne laisse la lecture de la page prendre le relais', async () => {
  const page = 'https://jobs.lever.co/acme';
  const html = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'JobPosting', title: 'Dev', url: 'https://jobs.lever.co/acme/a', description: LONG() },
    { '@type': 'JobPosting', title: 'Ops', url: 'https://jobs.lever.co/acme/b', description: LONG() },
  ])}</script>`;
  const net = fakeNet({ pages: { [page]: html } }); // fetchJson lève : l'interface est en panne
  const r = await resolve(net, page);
  assert.deepEqual([r.kind, r.reader, r.jobs.length], ['company', 'json_ld', 2]);
  assert.ok(r.jobs.every((j) => j.description === undefined));
});

test('flux : Welcome to the Jungle, page société vide sans rendu, puis avec Firecrawl', async () => {
  const shell = '<html><body><div id="__next"></div><script>window.__DATA__={}</script></body></html>';
  const withFirecrawl = fakeNet({ pages: { [WTTJ_COMPANY]: shell }, rendered: { [WTTJ_COMPANY]: { markdown: WTTJ_MD, links: k.extractMarkdownLinks(WTTJ_MD) } } });
  const r = await resolve(withFirecrawl, WTTJ_COMPANY);
  assert.deepEqual([r.kind, r.reader, r.company.name, r.jobs.map((j) => j.title)], [
    'company', 'firecrawl', 'Numspot', ['Expert Sécurité Opérationnelle', 'DevOps Senior Kubernetes'],
  ]);
  assert.deepEqual(withFirecrawl.calls.scrape, [[WTTJ_COMPANY, false]], 'page entière, pour ne pas perdre les cartes d\'offres');

  const without = fakeNet({ pages: { [WTTJ_COMPANY]: shell }, firecrawl: false });
  const refused = await resolve(without, WTTJ_COMPANY);
  assert.equal(refused.kind, 'unreadable');
  assert.match(refused.message, /Collez le texte de la fiche/);
  assert.equal(without.calls.scrape.length, 0, 'plafond atteint ou clé absente : Firecrawl n\'est pas appelé');
});

test('flux : une offre Welcome to the Jungle avec JobPosting seul garde ce JobPosting si rien de plus complet ne se lit', async () => {
  const withLongDescription = JSON_LD_PAGE.replace(
    /"description":"[^"]*"/,
    `"description":${JSON.stringify(`<p>${LONG(1200)}</p>`)}`,
  );
  // Firecrawl tenté (le JobPosting du site n'a que le descriptif) mais en échec : le JobPosting reste.
  const failing = fakeNet({ pages: { [WTTJ_JOB]: withLongDescription } });
  const r = await resolve(failing, WTTJ_JOB);
  assert.deepEqual([r.kind, r.reader, r.job.title, r.job.company], ['job', 'json_ld', 'Expert Sécurité Opérationnelle', 'Numspot']);
  assert.ok(r.job.description.length >= 1000);
  assert.equal(failing.calls.scrape.length, 1);

  // Clé absente ou plafond atteint : aucun appel facturé.
  const noKey = fakeNet({ pages: { [WTTJ_JOB]: withLongDescription }, firecrawl: false });
  assert.equal((await resolve(noKey, WTTJ_JOB)).reader, 'json_ld');
  assert.equal(noKey.calls.scrape.length, 0);
});

// Page d'offre Welcome to the Jungle : le JobPosting n'a que le descriptif, la page porte le reste.
const wttjLd = (description) => `<script type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting',
  title: 'Expert Sécurité Opérationnelle',
  description,
  employmentType: 'FULL_TIME',
  hiringOrganization: { name: 'Numspot' },
  jobLocation: { address: { addressLocality: 'Courbevoie' } },
})}</script>`;
const WTTJ_FULL_PAGE = `<html><head>${wttjLd(`<p>${LONG(320)}</p>`)}</head><body>
<nav>Menu Emploi Entreprises Connexion</nav>
<main>
<header><h1>Expert Sécurité Opérationnelle</h1><ul><li>CDI</li><li>Courbevoie</li></ul>
<h2>Compétences et expertises</h2><ul><li>SOC</li><li>SIEM</li><li>Kubernetes</li></ul></header>
<section><h2>Résumé du poste</h2><p>Rattaché au RSSI, vous pilotez la détection et la réponse aux incidents.</p></section>
<section><h2>Descriptif du poste</h2><p>${LONG(700)}</p></section>
<section><h2>Profil recherché</h2><p>Cinq ans d'expérience en sécurité opérationnelle.</p></section>
<section><h2>Déroulement des entretiens</h2><p>Un échange RH, un entretien technique, une rencontre avec le RSSI.</p></section>
<section><h2>Offres similaires</h2><p>Ingénieur Cloud Senior, Paris</p></section>
</main>
<footer>Mentions légales</footer></body></html>`;

test('flux : Welcome to the Jungle, la fiche reprend résumé, compétences, profil et entretiens de la page, pas seulement le JobPosting', async () => {
  const net = fakeNet({ pages: { [WTTJ_JOB]: WTTJ_FULL_PAGE } });
  const r = await resolve(net, WTTJ_JOB);
  assert.deepEqual(
    [r.kind, r.reader, r.job.title, r.job.company, r.job.location, r.job.contract],
    ['job', 'direct_text', 'Expert Sécurité Opérationnelle', 'Numspot', 'Courbevoie', 'Temps plein'],
    'champs du JobPosting conservés',
  );
  for (const part of ['Compétences et expertises', 'SIEM', 'Résumé du poste', 'Profil recherché', 'Déroulement des entretiens', 'RSSI']) {
    assert.match(r.job.description, new RegExp(part), `« ${part} » dans la fiche`);
  }
  assert.doesNotMatch(r.job.description, /Offres similaires|Ingénieur Cloud|Mentions légales|Menu Emploi/, 'ni offres voisines, ni menu, ni pied de page');
  assert.equal(net.calls.scrape.length, 0, 'la page lue directement suffit : rien de facturé');
});

test('flux : Welcome to the Jungle, page vide en lecture directe, la fiche vient du rendu Firecrawl de la page entière', async () => {
  const shell = `<html><head>${wttjLd(`<p>${LONG(320)}</p>`)}</head><body><div id="__next"></div></body></html>`;
  const md = [
    '[Menu](https://www.welcometothejungle.com/fr)',
    '# Expert Sécurité Opérationnelle',
    '## Compétences et expertises', 'SOC · SIEM · Kubernetes',
    '## Profil recherché', LONG(500),
    '## Déroulement des entretiens', LONG(300),
    '## Offres similaires', 'Ingénieur Cloud Senior',
  ].join('\n\n');
  const net = fakeNet({ pages: { [WTTJ_JOB]: shell }, rendered: { [WTTJ_JOB]: { markdown: md, links: [] } } });
  const r = await resolve(net, WTTJ_JOB);
  assert.deepEqual([r.kind, r.reader, r.job.title, r.job.company], ['job', 'firecrawl', 'Expert Sécurité Opérationnelle', 'Numspot']);
  assert.deepEqual(net.calls.scrape, [[WTTJ_JOB, false]], 'page entière : le contenu principal seul peut perdre les tags');
  assert.match(r.job.description, /Compétences et expertises/);
  assert.match(r.job.description, /Déroulement des entretiens/);
  assert.doesNotMatch(r.job.description, /Menu|Ingénieur Cloud|^#/m, 'repart du premier titre, coupe avant les offres similaires');

  // Rendu plus court que le JobPosting : le JobPosting reste.
  const poor = fakeNet({ pages: { [WTTJ_JOB]: shell }, rendered: { [WTTJ_JOB]: { markdown: '# Titre\n\nTrop court', links: [] } } });
  assert.equal((await resolve(poor, WTTJ_JOB)).reader, 'json_ld');
});

test('flux : un site quelconque dont le JobPosting suffit n\'est pas relu, même si sa page est plus longue', async () => {
  const page = 'https://carrieres.numspot.com/offres/securite';
  const html = `<html><head>${wttjLd(`<p>${LONG(900)}</p>`)}</head><body><main>${`<p>${LONG(3000)}</p>`}</main></body></html>`;
  const net = fakeNet({ pages: { [page]: html } });
  const r = await resolve(net, page);
  assert.equal(r.reader, 'json_ld');
  assert.ok(r.job.description.length < 1000, 'description du JobPosting, pas le texte de la page');
  assert.equal(net.calls.scrape.length, 0);
});

test('texte de page d\'offre : contenu principal avec son en-tête, sans menu ni pied, coupé avant les offres similaires', () => {
  const text = k.jobPageText(WTTJ_FULL_PAGE);
  assert.match(text, /^Expert Sécurité Opérationnelle/, 'l\'en-tête <header> de <main> est gardé');
  assert.match(text, /SIEM/);
  assert.doesNotMatch(text, /Menu Emploi|Mentions légales|Offres similaires/);
  // Sans <main> : la page entière, comme avant.
  assert.match(k.jobPageText(`<html><body><h1>Titre</h1><p>${LONG(400)}</p></body></html>`), /^Titre/);
  // « Offres similaires » en tête de texte : jamais de fiche amputée de son début.
  assert.equal(k.trimTrailingSections('Offres similaires\nUne offre'), 'Offres similaires\nUne offre');
  assert.equal(k.trimTrailingSections(`${LONG(700)}\nOffres similaires\nUne offre`), LONG(700));
  // L'en-tête reste retiré hors de <main>.
  assert.doesNotMatch(k.htmlToText('<header>Menu</header><p>Fiche</p>'), /Menu/);
  assert.match(k.htmlToText('<header>Titre</header><p>Fiche</p>', { keepHeader: true }), /Titre/);
});

// Offres suggérées d'autres sociétés sous un titre que le lecteur ne connaît pas : c'est leurs liens qui les trahissent.
const WTTJ_WITH_SUGGESTIONS = `<html><head>${wttjLd(`<p>${LONG(320)}</p>`)}</head><body>
<main>
<header><h1>Expert Sécurité Opérationnelle</h1><a href="/fr/companies/numspot/jobs/expert-securite_courbevoie/apply">Postuler</a>
<h2>Compétences et expertises</h2><ul><li>SOC</li><li>SIEM</li></ul></header>
<section><h2>Descriptif du poste</h2><p>${LONG(700)}</p></section>
<section><h2>Profil recherché</h2><p>Cinq ans d'expérience en sécurité opérationnelle.</p></section>
<section><h2>Déroulement des entretiens</h2><p>Un échange RH et un entretien technique.</p></section>
<section><h2>Ils recrutent aussi</h2><ul>
<li><a href="https://www.welcometothejungle.com/fr/companies/autre-societe/jobs/devops-senior_paris"><h3>DevOps Senior</h3><p>Autre Société, Paris, kubernetes terraform</p></a></li>
<li><a href="/fr/companies/encore/jobs/data-engineer_lyon"><h3>Data Engineer</h3></a></li></ul></section>
</main></body></html>`;

test('flux : Welcome to the Jungle, les offres suggérées d\'autres sociétés ne s\'ajoutent pas à la fiche', async () => {
  const net = fakeNet({ pages: { [WTTJ_JOB]: WTTJ_WITH_SUGGESTIONS } });
  const r = await resolve(net, WTTJ_JOB);
  assert.equal(r.reader, 'direct_text');
  for (const part of ['Compétences et expertises', 'Profil recherché', 'Déroulement des entretiens', 'entretien technique']) {
    assert.match(r.job.description, new RegExp(part), `« ${part} » gardé`);
  }
  assert.doesNotMatch(r.job.description, /DevOps Senior|Data Engineer|Ils recrutent aussi|kubernetes/i, 'ni offres voisines, ni leur titre de bloc');
  assert.match(r.job.description, /entretien technique/, 'le lien « postuler » de l\'offre elle-même ne coupe rien');

  // Un lien vers une autre offre tout en haut (fil d'Ariane) ne doit pas vider la fiche : le texte entier est gardé.
  const breadcrumb = WTTJ_WITH_SUGGESTIONS.replace('<main>', '<main><p>Vous êtes ici : accueil, emplois, sécurité.</p><a href="/fr/companies/numspot/jobs/autre-offre_paris">Autre offre</a>');
  const kept = await resolve(fakeNet({ pages: { [WTTJ_JOB]: breadcrumb } }), WTTJ_JOB);
  assert.match(kept.job.description, /Déroulement des entretiens/);
});

test('flux : Welcome to the Jungle, le rendu Firecrawl est coupé avant les liens vers d\'autres offres', async () => {
  const shell = `<html><head>${wttjLd(`<p>${LONG(320)}</p>`)}</head><body><div id="__next"></div></body></html>`;
  const md = [
    '# Expert Sécurité Opérationnelle',
    '[Postuler](https://www.welcometothejungle.com/fr/companies/numspot/jobs/expert-securite_courbevoie/apply)',
    '## Profil recherché', LONG(700),
    '## Déroulement des entretiens', 'Un échange RH et un entretien technique.',
    '## Ils recrutent aussi',
    '[DevOps Senior\n\nParis](https://www.welcometothejungle.com/fr/companies/autre-societe/jobs/devops-senior_paris)',
  ].join('\n\n');
  const net = fakeNet({ pages: { [WTTJ_JOB]: shell }, rendered: { [WTTJ_JOB]: { markdown: md, links: [] } } });
  const r = await resolve(net, WTTJ_JOB);
  assert.equal(r.reader, 'firecrawl');
  assert.match(r.job.description, /Déroulement des entretiens/);
  assert.doesNotMatch(r.job.description, /DevOps Senior|Ils recrutent aussi/);
});

test('flux : une adresse Welcome to the Jungle que le lecteur ne reconnaît pas dit quelle adresse utiliser', async () => {
  const search = 'https://www.welcometothejungle.com/fr/jobs?query=product';
  const net = fakeNet({ firecrawl: false });
  const r = await resolve(net, search);
  assert.equal(r.kind, 'unreadable');
  assert.equal(r.message, k.MSG_WTTJ_ADDRESS);
  assert.match(r.message, /companies\/<société>\/jobs/);
  // Ailleurs, le message général reste.
  assert.equal((await resolve(fakeNet({ firecrawl: false }), 'https://example.com/')).message, k.MSG_UNREADABLE);
});

test('Welcome to the Jungle : une adresse « companies-v1 » se lit comme une adresse « companies »', async () => {
  assert.deepEqual(k.classifyUrl(url('https://www.welcometothejungle.com/fr/companies-v1/numspot/jobs')), { source: 'wttj', kind: 'company', org: 'numspot' });
  assert.deepEqual(
    k.classifyUrl(url('https://www.welcometothejungle.com/fr/companies-v1/numspot/jobs/expert-securite_courbevoie')),
    { source: 'wttj', kind: 'job', org: 'numspot', jobRef: 'expert-securite_courbevoie' },
  );

  // La liste d'offres d'une page « companies-v1 » : les cartes rendues par Firecrawl sont reconnues.
  const page = 'https://www.welcometothejungle.com/fr/companies-v1/numspot/jobs';
  const md = WTTJ_MD.replaceAll('/companies/', '/companies-v1/');
  const listing = fakeNet({
    pages: { [page]: '<html><body><div id="__next"></div></body></html>' },
    rendered: { [page]: { markdown: md, links: k.extractMarkdownLinks(md) } },
  });
  const r = await resolve(listing, page);
  assert.deepEqual([r.kind, r.reader, r.company.name, r.jobs.length], ['company', 'firecrawl', 'Numspot', 2]);

  // Une offre « companies-v1 » : les offres suggérées, elles aussi en « companies-v1 », sont coupées.
  const job = 'https://www.welcometothejungle.com/fr/companies-v1/numspot/jobs/expert-securite_courbevoie';
  const withV1 = WTTJ_WITH_SUGGESTIONS.replaceAll('/companies/', '/companies-v1/');
  const offer = await resolve(fakeNet({ pages: { [job]: withV1 } }), job);
  assert.match(offer.job.description, /entretien technique/);
  assert.doesNotMatch(offer.job.description, /DevOps Senior|Data Engineer|Ils recrutent aussi/);
});

test('flux : Welcome to the Jungle, les offres écrites dans les données de la page (sans lien) sont lues sans Firecrawl', async () => {
  const page = 'https://www.welcometothejungle.com/fr/companies-v1/numspot/jobs';
  const data = JSON.stringify({ jobs: [
    { path: '/fr/companies-v1/numspot/jobs/expert-securite_courbevoie' },
    { path: '/fr/companies-v1/numspot/jobs/devops-senior-kubernetes_paris' },
    { path: '/fr/companies-v1/numspot/jobs/expert-securite_courbevoie' },
    { path: '/fr/companies/autre-societe/jobs/data-engineer_lyon' },
  ] }).replaceAll('/', '\\u002F');
  const html = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${data}</script></body></html>`;
  const net = fakeNet({ pages: { [page]: html } });
  const r = await resolve(net, page);
  assert.deepEqual([r.kind, r.reader, r.company.name], ['company', 'direct_text', 'Numspot']);
  assert.deepEqual(r.jobs.map((j) => j.title), ['Expert Securite', 'Devops Senior Kubernetes'], 'sans doublon ni autre société');
  assert.deepEqual(r.jobs.map((j) => j.location), ['Courbevoie', 'Paris']);
  assert.equal(net.calls.scrape.length, 0);

  // Même liste écrite avec des « \/ » (JSON échappé) : lue aussi.
  const escaped = fakeNet({ pages: { [page]: html.replaceAll('\\u002F', '\\/') } });
  assert.equal((await resolve(escaped, page)).jobs.length, 2);

  // Rien pour cette société dans la page : toujours illisible, sans invention.
  const other = fakeNet({ pages: { [page]: '<html><body><script>{"p":"/fr/companies/autre-societe/jobs/data-engineer_lyon"}</script></body></html>' }, firecrawl: false });
  assert.equal((await resolve(other, page)).kind, 'unreadable');
});

test('flux : un JobPosting réduit à un résumé ne suffit pas, la page est lue plus loin', async () => {
  // La description de JSON_LD_PAGE fait une quarantaine de caractères : un résumé, pas une fiche.
  const md = `# Expert Sécurité Opérationnelle\n\n${LONG(1500)}`;
  const net = fakeNet({ pages: { [WTTJ_JOB]: JSON_LD_PAGE }, rendered: { [WTTJ_JOB]: { markdown: md, links: [] } } });
  const r = await resolve(net, WTTJ_JOB);
  assert.deepEqual([r.kind, r.reader], ['job', 'firecrawl']);
});

test('flux : page bloquée en lecture directe, la fiche vient de Firecrawl avec son titre', async () => {
  const md = `# Expert Sécurité Opérationnelle\n\n${LONG(1500)}`;
  const net = fakeNet({ rendered: { [WTTJ_JOB]: { markdown: md, links: [] } } }); // fetchPage lève : accès refusé
  const r = await resolve(net, WTTJ_JOB);
  assert.deepEqual([r.kind, r.reader, r.job.title, r.job.company], ['job', 'firecrawl', 'Expert Sécurité Opérationnelle', 'Numspot']);
  assert.deepEqual(net.calls.scrape, [[WTTJ_JOB, true]], 'contenu principal seulement');
  assert.doesNotMatch(r.job.description, /^#/m);
});

test('flux : LinkedIn n\'est jamais lu, aucun appel réseau', async () => {
  const net = fakeNet();
  for (const u of ['https://www.linkedin.com/jobs/view/123', 'https://fr.linkedin.com/company/acme/jobs']) {
    const r = await resolve(net, u);
    assert.deepEqual([r.kind, r.message], ['unreadable', k.MSG_LINKEDIN]);
  }
  assert.deepEqual([net.calls.pages, net.calls.json, net.calls.scrape], [[], [], []]);
});

test('flux : page quelconque, offre en texte seulement si la page parle d\'un poste', async () => {
  const job = 'https://acme.com/a-propos';
  const jobText = `<html><head><title>Ingénieur data | Acme</title></head><body><h1>Ingénieur data</h1><p>${LONG(1500)}</p></body></html>`;
  const r = await resolve(fakeNet({ pages: { [job]: jobText } }), job);
  assert.deepEqual([r.kind, r.reader, r.job.title, r.job.company], ['job', 'direct_text', 'Ingénieur data', 'Acme']);

  const marketing = `<html><body><h1>Acme</h1><p>${'Notre histoire et nos valeurs. '.repeat(60)}</p></body></html>`;
  const net = fakeNet({ pages: { [job]: marketing }, firecrawl: false });
  assert.equal((await resolve(net, job)).kind, 'unreadable', 'une page sans rapport avec un poste n\'est pas prise pour une fiche');
});

test('flux : read_job sur une adresse de société, ou un rendu en échec, ne plante pas', async () => {
  const net = fakeNet({ pages: { [WTTJ_COMPANY]: '<html></html>' } });
  const onCompany = await resolve(net, WTTJ_COMPANY, true);
  assert.equal(onCompany.kind, 'unreadable');
  const failing = fakeNet({ pages: { [WTTJ_COMPANY]: '<html></html>' } }); // scrape lève
  assert.equal((await resolve(failing, WTTJ_COMPANY)).kind, 'unreadable');
});

test('flux : une liste de plus de 100 offres est tronquée et le dit', async () => {
  const jobs = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, title: `Poste ${i + 1}`, absolute_url: `https://boards.greenhouse.io/acme/jobs/${i + 1}` }));
  const net = fakeNet({ json: { 'https://boards-api.greenhouse.io/v1/boards/acme/jobs': { jobs } } });
  const r = await resolve(net, 'https://boards.greenhouse.io/acme');
  assert.deepEqual([r.jobs.length, r.truncated], [100, true]);
});

// ─── Conventions du handler ────────────────────────────────────────────

const handler = read(`${DIR}/index.ts`);
const handlerCode = code(handler);
const resolveCode = code(read(`${DIR}/resolve.ts`));

test('handler : authentification, appartenance à l\'organisation et limite de débit', () => {
  assert.match(handlerCode, /requireAuth\(req, corsHeaders\)/);
  assert.match(handlerCode, /verifyOrgMembership\(svc, auth\.userId, organizationId\)/);
  assert.match(handlerCode, /p_action: "fetch_job_source",\s*p_max_requests: 30,\s*p_window_seconds: 60/);
  // Chaque page lue par Firecrawl est facturée au projet : plafond quotidien par utilisateur.
  assert.match(handlerCode, /p_action: "fetch_job_source_firecrawl",\s*p_max_requests: 60,\s*p_window_seconds: 86400/);
  assert.match(read('supabase/config.toml'), /\[functions\.fetch-job-source\]\s*verify_jwt = false/);
});

test('handler : aucune lecture sans garde SSRF, redirections manuelles et revalidées', () => {
  assert.match(handlerCode, /checkPublicHttpsUrl\(typeof body\?\.url === "string" \? body\.url : ""\)/);
  assert.match(handlerCode, /const check = checkPublicHttpsUrl\(current\);\s*if \(!check\.ok\) throw/);
  assert.match(handlerCode, /ips\.some\(isPrivateIp\)/);
  assert.match(handlerCode, /redirect: "manual"/);
  assert.doesNotMatch(handlerCode, /redirect: "follow"/);
  assert.match(handlerCode, /MAX_REDIRECTS/);
  // Tout appel sortant passe par fetchWithTimeout, et la taille lue est bornée.
  const bareFetch = handlerCode.match(/[^.\w]fetch\(/g) ?? [];
  assert.equal(bareFetch.length, 1, 'un seul fetch nu : celui de fetchWithTimeout');
  assert.match(handlerCode, /readLimited\(res, MAX_PAGE_BYTES\)/);
});

test('handler : LinkedIn jamais lu, aucun modèle appelé, pas d\'adresse complète dans les journaux', () => {
  assert.match(resolveCode, /classified\.source === "linkedin"\) return \{ kind: "unreadable"/);
  assert.doesNotMatch(handlerCode + resolveCode, /anthropic|settleCredits|callClaude/i);
  const logs = [...(handlerCode + resolveCode).matchAll(/console\.(log|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[2]).join('\n');
  assert.doesNotMatch(logs, /url\.toString\(\)|\burl\b(?!\.hostname)\s*[,)]/, 'les journaux nomment l\'hôte, jamais l\'adresse (jetons possibles dans la requête)');
});

test('handler : Firecrawl seulement si la clé est posée, lue dans la requête et non en variable globale', () => {
  assert.match(handlerCode, /if \(!Deno\.env\.get\("FIRECRAWL_API_KEY"\)\) return false;/);
  assert.doesNotMatch(handler, /^(let|var) \w*API_KEY/m);
  assert.match(handlerCode, /formats: \["markdown", "links"\]/);
});
