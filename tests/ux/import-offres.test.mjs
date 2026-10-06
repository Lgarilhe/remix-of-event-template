/**
 * Brief IA : offres lues depuis une adresse web (une offre, ou toutes celles d'une
 * société), analyse et création de missions en lot.
 *
 *  - appels à fetch-job-source : succès, refus lisibles, panne ;
 *  - texte de brief et nom de mission ;
 *  - exécuteur de lot : trois à la fois, un échec n'arrête pas les autres, des
 *    crédits épuisés arrêtent les suivantes, annulation ;
 *  - création : seules les offres prêtes, sans toast par mission, adresse source ;
 *  - écran de choix en rendu statique, gardes sur le source.
 *
 * Lancer : node --test tests/ux/import-offres.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const DIR = 'src/components/missions/v2';

// Le client Supabase ne s'initialise pas sans variables d'environnement : l'appel réseau est simulé.
const stubEdge = {
  name: 'stub-edge',
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/invokeEdgeFunction$/ }, () => ({ path: 'edge-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const invokeEdgeFunction = (...a) => globalThis.__edge(...a); export const isInsufficientCreditsError = (e) => e?.status === 402;',
      loader: 'js',
    }));
  },
};
const { outputFiles } = await build({
  stdin: {
    contents: [
      `export * from './${DIR}/jobSource';`,
      `export { JobOffersPicker } from './${DIR}/JobOffersPicker';`,
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.webp': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stubEdge],
});
const k = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const job = (n, over = {}) => ({ id: `j${n}`, title: `Poste ${n}`, company: 'Numspot', location: 'Paris', contract: 'CDI', url: `https://exemple.test/jobs/${n}`, ...over });
const ANALYSIS = { filters: { keywords: 'k' }, analysis: { suggested_title: 'Poste', skills_must_have: ['SIEM'], location_hint: 'Paris' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Appels à la fonction ───────────────────────────────────────────────

test('lecture : réponse de la fonction reprise telle quelle, refus lisibles, panne sans exception', async () => {
  const company = { success: true, kind: 'company', company: { name: 'Numspot', url: 'u' }, jobs: [job(1)], reader: 'firecrawl', truncated: false };
  globalThis.__edge = async (name, body) => {
    globalThis.__seen = [name, body];
    return { data: company, error: null };
  };
  const ok = await k.resolveJobSource('https://exemple.test/jobs');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.data.kind, 'company');
  assert.deepEqual(globalThis.__seen, ['fetch-job-source', { action: 'resolve', url: 'https://exemple.test/jobs' }]);

  // Adresse invalide ou trop de lectures : le serveur écrit en français, on le montre.
  for (const [status, message] of [[400, 'Adresse invalide. Utilisez une adresse https:// publique.'], [429, 'Trop de lectures à la suite, réessayez dans une minute.']]) {
    globalThis.__edge = async () => ({ data: {}, error: Object.assign(new Error(message), { status }) });
    assert.deepEqual(await k.resolveJobSource('x'), { status: 'error', message });
  }
  // Toute autre panne : phrase générique, jamais le message technique.
  globalThis.__edge = async () => ({ data: {}, error: Object.assign(new Error('AI_ERROR_500 stack…'), { status: 500 }) });
  const failed = await k.resolveJobSource('x');
  assert.equal(failed.status, 'error');
  assert.doesNotMatch(failed.message, /AI_ERROR|stack/);
  assert.match(failed.message, /Collez le texte de la fiche/);
  globalThis.__edge = async () => { throw new Error('réseau'); };
  assert.equal((await k.resolveJobSource('x')).status, 'error');
  globalThis.__edge = async () => ({ data: { success: false }, error: null });
  assert.equal((await k.resolveJobSource('x')).status, 'error');
});

test('lecture d\'une offre : fiche présente, sinon le message du serveur', async () => {
  globalThis.__edge = async (_n, body) => ({ data: { success: true, kind: 'job', reader: 'ats_api', job: job(1, { description: 'Fiche entière' }) }, error: null, body });
  const ok = await k.readJobSource('https://exemple.test/jobs/1');
  assert.deepEqual([ok.status, ok.data.description], ['ok', 'Fiche entière']);

  globalThis.__edge = async () => ({ data: { success: true, kind: 'job', job: job(1) }, error: null });
  assert.equal((await k.readJobSource('u')).status, 'error', 'une offre sans fiche n\'est pas une lecture réussie');
  globalThis.__edge = async () => ({ data: { success: true, kind: 'unreadable', message: 'Page illisible.' }, error: null });
  assert.deepEqual(await k.readJobSource('u'), { status: 'error', message: 'Page illisible.' });
  globalThis.__edge = async () => ({ data: { success: true, kind: 'company', jobs: [], company: {} }, error: null });
  assert.equal((await k.readJobSource('u')).status, 'error');
});

// ─── Textes ─────────────────────────────────────────────────────────────

test('brief : l\'intitulé en première ligne, puis société, lieu et contrat, puis la fiche', () => {
  assert.equal(
    k.buildBriefText(job(1, { description: 'Vos missions : détecter.' })),
    'Poste 1\nNumspot · Paris · CDI\n\nVos missions : détecter.',
  );
  assert.equal(k.buildBriefText({ id: 'x', title: 'Seul', url: 'u' }), 'Seul');
  assert.doesNotMatch(k.buildBriefText(job(1, { company: undefined, location: undefined, contract: undefined, description: 'Fiche' })), /\n\n\n|·/);
});

test('nom de mission : le lieu départage deux offres au même intitulé', () => {
  assert.equal(k.missionNameOf(job(1)), 'Poste 1, Paris');
  assert.equal(k.missionNameOf(job(1, { location: undefined })), 'Poste 1');
});

// ─── Analyse en lot ─────────────────────────────────────────────────────

const collect = () => {
  const items = [];
  return { items, onUpdate: (i, patch) => { items[i] = { ...(items[i] ?? {}), ...patch }; } };
};

test('lot : trois offres à la fois, toutes prêtes, texte conservé', async () => {
  const jobs = Array.from({ length: 8 }, (_, i) => job(i + 1));
  let active = 0;
  let peak = 0;
  const deps = {
    read: async (j) => { await sleep(5); return { text: `Fiche de ${j.title}` }; },
    analyze: async () => { active += 1; peak = Math.max(peak, active); await sleep(15); active -= 1; return { analysis: ANALYSIS }; },
  };
  const { items, onUpdate } = collect();
  await k.runBulkAnalysis(jobs, deps, onUpdate);
  assert.equal(peak, 3, 'trois analyses en parallèle, pas plus');
  assert.deepEqual(items.map((i) => i.status), Array(8).fill('done'));
  assert.equal(items[4].text, 'Fiche de Poste 5');
});

test('lot : une offre en échec n\'arrête pas les autres, une exception non plus', async () => {
  const jobs = [job(1), job(2), job(3), job(4)];
  const deps = {
    read: async (j) => (j.id === 'j2' ? { error: 'Page illisible.' } : { text: `Fiche ${j.id}` }),
    analyze: async (_t, j) => {
      if (j.id === 'j3') throw new Error('panne');
      if (j.id === 'j4') return { error: 'failed' };
      return { analysis: ANALYSIS };
    },
  };
  const { items, onUpdate } = collect();
  await k.runBulkAnalysis(jobs, deps, onUpdate);
  assert.deepEqual(items.map((i) => [i.status, i.error]), [
    ['done', undefined],
    ['error', 'Page illisible.'],
    ['error', k.BULK_MESSAGES.failed],
    ['error', k.BULK_MESSAGES.failed],
  ]);
});

test('lot : des crédits épuisés arrêtent les offres suivantes, celles déjà en cours aboutissent', async () => {
  const jobs = Array.from({ length: 6 }, (_, i) => job(i + 1));
  const deps = {
    read: async (j) => { await sleep(5); return { text: j.id }; },
    // Les trois premières analyses démarrent ensemble : l'offre 2 est refusée après 20 ms, les deux
    // autres, déjà parties, durent 60 ms. Les offres encore à lire ou à analyser sont ensuite ignorées.
    analyze: async (_t, j) => {
      if (j.id === 'j2') {
        await sleep(20);
        return { error: 'credits' };
      }
      await sleep(60);
      return { analysis: ANALYSIS };
    },
  };
  const { items, onUpdate } = collect();
  await k.runBulkAnalysis(jobs, deps, onUpdate);
  assert.deepEqual(items.map((i) => i.status), ['done', 'error', 'done', 'skipped', 'skipped', 'skipped']);
  assert.equal(items[1].error, k.BULK_MESSAGES.credits);
  assert.equal(items[3].error, k.BULK_MESSAGES.skipped);
});

test('lot : annulation, les offres non commencées sont marquées non analysées', async () => {
  const jobs = Array.from({ length: 5 }, (_, i) => job(i + 1));
  let cancelled = false;
  const deps = {
    read: async (j) => ({ text: j.id }),
    analyze: async () => { cancelled = true; await sleep(10); return { analysis: ANALYSIS }; },
  };
  const { items, onUpdate } = collect();
  await k.runBulkAnalysis(jobs, deps, onUpdate, { concurrency: 1, isCancelled: () => cancelled });
  assert.equal(items[0].status, 'done');
  assert.deepEqual(items.slice(1).map((i) => i.status), ['skipped', 'skipped', 'skipped', 'skipped']);
  await k.runBulkAnalysis([], deps, () => {}); // liste vide : rien à faire, pas d'exception
});

// ─── Création en lot ────────────────────────────────────────────────────

test('création : une mission par offre prête, avec le brief, l\'adresse source et sans toast', () => {
  const item = { job: job(1, { url: 'https://exemple.test/jobs/1' }), status: 'done', text: 'Poste 1\nFiche', analysis: ANALYSIS };
  const input = k.missionInputFor(item, 'Société du lot');
  assert.equal(input.name, 'Poste 1, Paris');
  assert.equal(input.description, 'Poste 1\nFiche');
  assert.equal(input.client_name, 'Numspot');
  assert.equal(input.silent, true);
  assert.equal(input.job_details.source_url, 'https://exemple.test/jobs/1');
  assert.equal(input.job_details.raw_brief, 'Poste 1\nFiche');
  assert.deepEqual(input.job_details.skills_must_have, ['SIEM']);
  assert.equal(input.filters_snapshot.keywords, 'k');
  assert.equal(input.filters_snapshot.brief_text, 'Poste 1\nFiche');
  // Sans société sur l'offre : celle de la page.
  assert.equal(k.missionInputFor({ ...item, job: job(1, { company: undefined }) }, 'Société du lot').client_name, 'Société du lot');
});

test('création : seules les offres prêtes, un échec n\'empêche pas les autres', async () => {
  const items = [
    { job: job(1), status: 'done', text: 't1', analysis: ANALYSIS },
    { job: job(2), status: 'error', error: 'x' },
    { job: job(3), status: 'done', text: 't3', analysis: ANALYSIS },
    { job: job(4), status: 'skipped' },
    { job: job(5), status: 'done', text: 't5', analysis: ANALYSIS },
  ];
  const seen = [];
  const result = await k.createMissionsFromItems(items, 'Numspot', async (input) => {
    seen.push(input.name);
    if (input.name.startsWith('Poste 3')) throw new Error('refus de la base');
    return { id: `m-${seen.length}` };
  });
  assert.deepEqual(seen, ['Poste 1, Paris', 'Poste 3, Paris', 'Poste 5, Paris'], 'ni offre en erreur, ni offre ignorée');
  assert.deepEqual(result, { created: 2, failed: 1, firstId: 'm-1' });
  assert.deepEqual(await k.createMissionsFromItems([], 'x', async () => ({ id: 'n' })), { created: 0, failed: 0, firstId: undefined });
});

// ─── Écran de choix, rendu statique ─────────────────────────────────────

const render = (props) =>
  k.renderToStaticMarkup(k.createElement(k.JobOffersPicker, {
    company: 'Numspot', jobs: [], truncated: false, importedUrls: new Set(), selected: new Set(),
    maxSelectable: 10, items: null, onToggle: () => {}, onToggleAll: () => {}, ...props,
  }));

test('choix : une ligne par offre avec intitulé, lieu et contrat, case par ligne, aucun cadre', () => {
  const jobs = [job(1), job(2, { contract: undefined }), job(3, { location: undefined, contract: undefined })];
  const html = render({ jobs });
  assert.match(html, /3 offres en cours chez Numspot\. 10 offres au plus à la fois\./);
  assert.equal((html.match(/role="checkbox"/g) || []).length, 3);
  assert.match(html, /Paris · CDI/);
  assert.doesNotMatch(html, /rounded-xl border|bg-card/, 'liste sans cadre');
  assert.match(html, /Tout sélectionner/);
});

test('choix : offre déjà importée non cochable, plafond atteint, bascule « tout »', () => {
  const jobs = Array.from({ length: 12 }, (_, i) => job(i + 1));
  const imported = render({ jobs, importedUrls: new Set([jobs[0].url]) });
  assert.match(imported, /Déjà importée/);
  assert.match(imported, /Sélectionner les 10 premières/);
  // Deux cochées sur un plafond de deux : les autres cases sont grisées.
  const capped = render({ jobs: jobs.slice(0, 4), maxSelectable: 2, selected: new Set([jobs[0].url, jobs[1].url]) });
  assert.equal((capped.match(/aria-checked="true"/g) || []).length, 2);
  // En rendu serveur, Radix ajoute un <input> caché par case : on ne compte que les boutons.
  assert.equal((capped.match(/<button[^>]*role="checkbox"[^>]* disabled=""/g) || []).length, 2, 'les deux cases non cochées sont désactivées');
  assert.match(capped, /Tout désélectionner/);
  assert.match(render({ jobs: jobs.slice(0, 3), truncated: true }), /Seules les premières offres sont affichées/);
  assert.doesNotMatch(render({ jobs: [] }), /Tout sélectionner/);
});

test('analyse : l\'état de chaque offre choisie, sans case à cocher', () => {
  const items = [
    { job: job(1), status: 'done' },
    { job: job(2), status: 'analyzing' },
    { job: job(3), status: 'reading' },
    { job: job(4), status: 'pending' },
    { job: job(5), status: 'error', error: k.BULK_MESSAGES.credits },
    { job: job(6), status: 'skipped', error: k.BULK_MESSAGES.skipped },
  ];
  const html = render({ jobs: items.map((i) => i.job), items });
  assert.equal((html.match(/<li /g) || []).length, 6);
  for (const text of ['Prête', 'Analyse en cours', 'Lecture de la fiche', 'En attente', 'Crédits IA épuisés', 'Non analysée']) {
    assert.match(html, new RegExp(text), text);
  }
  assert.equal((html.match(/animate-spin/g) || []).length, 2, 'un indicateur par offre en cours, pas un de plus');
  assert.doesNotMatch(html, /role="checkbox"/);
});

// ─── Gardes sur le source ───────────────────────────────────────────────

const dialog = read(`${DIR}/CreateMissionV2.tsx`);
const picker = read(`${DIR}/JobOffersPicker.tsx`);
const source = read(`${DIR}/jobSource.ts`);
const NEW = { 'JobOffersPicker.tsx': picker, 'jobSource.ts': source };

test('design et texte : ni emoji, ni tiret long, ni dégradé, ni tutoiement, aucun nom de prestataire', () => {
  for (const [name, src] of Object.entries(NEW)) {
    const c = code(src);
    assert.doesNotMatch(c, /\p{Extended_Pictographic}/u, `${name} : emoji`);
    assert.doesNotMatch(c, /—/, `${name} : tiret long`);
    assert.doesNotMatch(c, /gradient|shimmer|konekt-skalr|font-display|hsl\(\d|#[0-9a-f]{3,6}\b/i, `${name} : décor ou couleur en dur`);
    assert.doesNotMatch(c, /<(button|input|label|textarea)\b/, `${name} : balise native`);
    assert.doesNotMatch(c, /(?<!\p{L})(tu|toi|ton|ta|tes)(?!\p{L})/iu, `${name} : tutoiement`);
    assert.doesNotMatch(c, /text-(muted-foreground|foreground)\/\d+/, `${name} : texte atténué par opacité`);
  }
  // Les noms de prestataires de lecture ne s'affichent jamais, ni dans le dialogue.
  for (const src of [picker, source, dialog]) {
    const strings = [...code(src).matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).join('\n');
    assert.doesNotMatch(strings, /Firecrawl|Unipile|Apollo|Anthropic|Sonnet|Claude/i);
  }
});

test('dialogue : l\'adresse est lue par la fonction, avec repli sur le contenu de l\'adresse', () => {
  const c = code(dialog);
  assert.match(c, /const outcome = await resolveJobSource\(url\);/);
  assert.match(c, /outcome\.status === 'ok' && outcome\.data\.kind === 'job'/);
  assert.match(c, /outcome\.status === 'ok' && outcome\.data\.kind === 'company'/);
  // Lecture impossible : le poste, l'entreprise et le lieu de l'adresse sont repris (comportement d'avant).
  assert.match(c, /parseJobUrl\(url\)/);
  assert.match(c, /La page n'a pas pu être lue/);
  // La consigne de collage n'est plus insérée dans la fiche.
  assert.doesNotMatch(c, /Colle ici le contenu/);
});

test('dialogue : lot plafonné, offre seule ouverte dans le Brief IA, création annoncée une seule fois', () => {
  const c = code(dialog);
  assert.match(c, /next\.size < MAX_BATCH_OFFERS/);
  assert.match(c, /\.slice\(0, MAX_BATCH_OFFERS\)/);
  assert.match(c, /if \(chosen\.length === 1\) \{\s*await openSingleOffer\(chosen\[0\]\);/);
  assert.match(c, /'brief_analysis'/);
  assert.match(c, /isInsufficientCreditsError\(error\) \? \{ error: 'credits' as const \}/);
  assert.match(c, /createMissionsFromItems\(bulkItems, offers\?\.company \?\? '', createProject\)/);
  assert.match(c, /plural\(result\.created, 'mission créée', 'missions créées'\)/);
  // Quitter l'écran des offres arrête l'analyse en cours.
  assert.match(c, /bulkCancelRef\.current = true;/);
  // Le mode « offres » n'a pas d'état à restaurer : le brouillon retombe sur le brief.
  assert.match(c, /mode: mode === 'offers' \? 'brief' : mode/);
  // Le coût annoncé vient du catalogue, pas d'un nombre écrit à la main.
  assert.match(c, /estimateActionCredits\('brief_analysis'\)/);
});

test('doublons : une offre déjà importée est reconnue par l\'adresse source de la mission', () => {
  const hook = read('src/hooks/useSourcingProjects.ts');
  assert.match(hook, /jd_source_url:job_details->>source_url/);
  assert.match(hook, /jd_location:job_details->>location/, 'colonnes existantes de la liste conservées');
  assert.match(hook, /jd_source_url\?: string \| null;/);
  assert.match(read('src/types/jobDetails.ts'), /source_url\?: string;/);
  assert.match(code(dialog), /projects\.map\(\(p\) => p\.jd_source_url\)/);
});

test('création silencieuse : le drapeau n\'est pas une colonne et supprime le toast de confirmation', () => {
  const hook = code(read('src/hooks/useSourcingProjects.ts'));
  assert.match(hook, /const \{ silent, \.\.\.row \} = input;/);
  assert.match(hook, /\.\.\.row,\s*created_by: user\.id/);
  assert.match(hook, /if \(!input\.silent\) toast\.success\(/);
  assert.match(hook, /silent\?: boolean;/);
  // Les créations isolées gardent leur toast : seul le lot est silencieux.
  assert.equal((code(source).match(/silent: true/g) || []).length, 1);
  assert.doesNotMatch(code(dialog), /silent: true/);
});
