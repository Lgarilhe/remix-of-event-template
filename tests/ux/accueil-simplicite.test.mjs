/**
 * Design simplifié, lot A : l'accueil comme la maquette (docs/design/06-simplicite.md,
 * décision du propriétaire du 04/10/2026).
 *  - « À faire » : une ligne par signal qui demande une action, jamais un zéro
 *    inventé, la bulle qui écrit sur une seule ligne ;
 *  - « Missions en cours » : cinq missions actives au plus, visages des
 *    candidats en entretien, cumuls écrits « au total » ;
 *  - plus de cartes des canaux, de « Cette semaine », d'activité récente ni de
 *    réordonnancement des sections.
 *
 * Rendu statique des deux panneaux empaquetés par esbuild (alias @/ résolus par
 * tsconfig.app.json), lecture des compteurs et client de la base remplacés par
 * des modules vides ; gardes sur le source pour la page et la journée.
 * Lancer : node --test tests/ux/accueil-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /(hooks\/useMissionStageCounts|integrations\/supabase\/client)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'export const supabase = {};',
        'export const useMissionStageCounts = () => ({ data: globalThis.__stageCounts });',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { DashboardFocusPanel } from './src/components/dashboard/DashboardFocusPanel';",
      "export { DashboardMissionsPanel } from './src/components/dashboard/DashboardMissionsPanel';",
      "export { MemoryRouter } from 'react-router-dom';",
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
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const render = (component, props) =>
  kit.renderToStaticMarkup(kit.createElement(kit.MemoryRouter, null, kit.createElement(component, props)));

const people = (...names) => names.map((name) => ({ name }));
const focus = (props) =>
  render(kit.DashboardFocusPanel, { unreadMessages: 0, pendingResponses: 0, stagnantCandidates: 0, ...props });

test('À faire : rien à signaler, aucune ligne', () => {
  assert.equal(focus({}), '');
  assert.match(focus({ isLoading: true }), /role="status" aria-label="Chargement"/);
});

test('À faire : un compteur inconnu dit « Chargement » ou « Indisponible », jamais un chiffre', () => {
  const loading = focus({ unreadMessages: null });
  assert.match(loading, />Réponses de candidats</);
  assert.match(loading, />Chargement</);
  assert.doesNotMatch(loading, />\d/);
  assert.match(focus({ unreadMessages: null, unreadMessagesUnavailable: true }), />Indisponible</);
  // Lecture des candidats en échec : les deux lignes qui en dépendent restent visibles.
  const failed = focus({ pendingResponses: null, stagnantCandidates: null });
  assert.match(failed, />Candidats qui attendent votre réponse</);
  assert.match(failed, />Candidats qui n&#x27;avancent plus</);
  assert.equal((failed.match(/>Indisponible</g) || []).length, 2);
});

test('À faire : réponses et relances, avec les visages et le lien où l\'on agit', () => {
  const html = focus({
    unreadMessages: 2,
    unreadPeople: people('Julie Bonnet', 'Sarah Bonnet'),
    pendingResponses: 4,
    pendingPeople: people('Inès Durand', 'Hugo Clement', 'Léa Martin'),
  });
  assert.match(html, />2 réponses à lire</);
  assert.match(html, />Des candidats vous ont écrit\.</);
  assert.match(html, /aria-label="Julie Bonnet et Sarah Bonnet"/);
  assert.match(html, /href="\/inbox">Lire</);
  assert.match(html, />4 candidats attendent votre réponse</);
  assert.match(html, /aria-label="Inès Durand, Hugo Clement, Léa Martin et 1 autre"/);
  assert.match(html, /href="\/inbox">Répondre</);
  // La bulle qui écrit va à la première ligne de conversation seulement.
  assert.equal((html.match(/animate-typing-dot/g) || []).length, 3, 'une seule bulle (trois points)');

  const one = focus({ pendingResponses: 1 });
  assert.match(one, />1 candidat attend votre réponse</);
  assert.match(one, />Il vous a répondu, sans suite depuis un jour ou plus\.</);
  assert.match(one, /animate-typing-dot/, 'seule ligne de conversation : elle porte la bulle');
});

test('À faire : candidats qui n\'avancent plus, sous le sablier', () => {
  const html = focus({ stagnantCandidates: 1, stagnantPeople: people('Julie Bonnet') });
  assert.match(html, />1 candidat n&#x27;avance plus</);
  assert.match(html, /animate-hourglass-flip/);
  assert.match(html, /href="\/pipeline\?view=analytics">Voir</);
  assert.match(focus({ stagnantCandidates: 3 }), />3 candidats n&#x27;avancent plus</);
});

test('À faire : compte LinkedIn à reconnecter, une ligne au lieu des cartes des canaux', () => {
  const html = focus({ linkedinIssue: true });
  assert.match(html, />Compte LinkedIn à reconnecter</);
  assert.match(html, />Les envois sont en pause jusqu&#x27;à la reconnexion\.</);
  assert.match(html, /href="\/settings\/account\/connections">Reconnecter</);
  assert.doesNotMatch(html, /unipile|whatsapp/i);
});

const project = (id, updatedAt, extra = {}) => ({
  id,
  name: `Mission ${id}`,
  status: 'active',
  updated_at: updatedAt,
  stats_total_found: 140,
  stats_shortlisted: 12,
  stats_messaged: 24,
  ...extra,
});

test('Missions en cours : cinq missions actives au plus, la plus récente d\'abord', () => {
  globalThis.__stageCounts = { m2: { lastStageMoveAt: '2026-10-03T09:00:00Z' } };
  const projects = [
    project('m1', '2026-10-01T09:00:00Z'),
    project('m2', '2026-09-01T09:00:00Z'), // activité récente portée par un candidat
    project('m3', '2026-09-30T09:00:00Z'),
    project('m4', '2026-09-29T09:00:00Z'),
    project('m5', '2026-09-28T09:00:00Z'),
    project('m6', '2026-09-27T09:00:00Z'),
    project('m7', '2026-10-02T09:00:00Z', { status: 'paused' }),
  ];
  const html = render(kit.DashboardMissionsPanel, { projects });
  const order = [...html.matchAll(/href="\/missions\/(m\d)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['m2', 'm1', 'm3', 'm4', 'm5']);
  assert.match(html, /href="\/missions">Toutes les missions</);
  delete globalThis.__stageCounts;
});

test('Missions en cours : cumuls écrits « au total », visages des candidats en entretien', () => {
  const html = render(kit.DashboardMissionsPanel, {
    projects: [project('m1', '2026-10-01T09:00:00Z', { jd_client: 'Qonto' }), project('m2', '2026-09-30T09:00:00Z')],
    interviewing: { m1: { people: people('Julie Bonnet', 'Sarah Bonnet'), total: 2 } },
  });
  for (const label of ['Sourcés', 'Retenus au total', 'Contactés au total']) {
    assert.match(html, new RegExp(`>${label}<`), `en-tête « ${label} »`);
    assert.match(html, new RegExp(`>${label} : <`), `cellule lue seule : « ${label} »`);
  }
  assert.match(html, />140 sourcés · 12 retenus au total · 24 contactés au total</);
  assert.match(html, />Chiffres depuis le début de chaque mission\.</);
  assert.match(html, />En entretien</);
  assert.match(html, /aria-label="Julie Bonnet et Sarah Bonnet"/);
  assert.match(html, />Personne pour l&#x27;instant</);
  assert.match(html, />Qonto</);
  // Plus de « Retenus » ni de « Contactés » nus sous le nom d'une étape (règle « au total »).
  assert.doesNotMatch(html, />(Retenus|Contactés)</);
});

test('Missions en cours : vide, et lecture en échec', () => {
  const empty = render(kit.DashboardMissionsPanel, { projects: [project('m1', '2026-10-01T09:00:00Z', { status: 'paused' })] });
  assert.match(empty, />Aucune mission active</);
  assert.match(empty, /href="\/missions\?create=brief"/);
  const failed = render(kit.DashboardMissionsPanel, { projects: [], error: 'boom', onRetry: () => {} });
  assert.match(failed, />Impossible de charger vos missions</);
});

test('téléphone : titre entier, chiffres sans coupure, visages alignés sur le texte, initiales lisibles', () => {
  // En-tête commun : sous 640 px, les actions prennent leur propre ligne (le titre ne se coupe plus).
  assert.match(read('src/components/layout/PageHeader.tsx'), /<div className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:shrink-0 sm:basis-auto">\{actions\}<\/div>/);

  // Pile : 6 px de chevauchement (plus l'anneau), les deux initiales restent lisibles.
  const row = focus({ pendingResponses: 4, pendingPeople: people('Emma Durand', 'Paul Blanc', 'Romain Blanc') });
  assert.equal((row.match(/-ml-1\.5/g) || []).length, 3, 'deux visages et « +1 »');
  assert.doesNotMatch(row, /-ml-2\b/);
  // Visages et lien dans la colonne du texte : sur téléphone, ils passent sous la phrase, alignés sur elle.
  assert.match(row, /^<ul [^>]*><li class="flex items-start gap-3\.5 py-4 sm:items-center">/);

  const missions = render(kit.DashboardMissionsPanel, { projects: [project('m1', '2026-10-01T09:00:00Z')] });
  const line = missions.match(/<span class="([^"]*)">140 sourcés/);
  assert.ok(line, 'ligne des chiffres sur téléphone');
  assert.doesNotMatch(line[1], /\btruncate\b/, 'la ligne passe à la ligne au lieu de se couper');

  // Cibles tactiles d'au moins 44 px sur téléphone (01-direction.md, § 5).
  assert.match(row, /<a class="[^"]*\bmin-h-11 min-w-11\b[^"]*\bmd:min-h-0 md:min-w-0\b[^"]*" href="\/inbox">Répondre<\/a>/);
  assert.match(missions, /<a class="[^"]*\bmin-h-11\b[^"]*\bmd:min-h-0\b[^"]*" href="\/missions">Toutes les missions<\/a>/);
  assert.match(read('src/pages/Dashboard.tsx'), /className="min-h-11 px-0 text-muted-foreground md:min-h-0">\s*<Link to="\/tasks">Toutes les tâches<\/Link>/);
  const today = read('src/components/dashboard/DashboardTodayPanel.tsx');
  assert.match(today, /aria-label="Ajouter une tâche"\s*className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"/);
  assert.match(today, /className="min-h-11 md:min-h-0">\s*<Link to="\/calendar">/);
  assert.match(today, /onClick=\{\(\) => setCreateTaskOpen\(true\)\} className="min-h-11 md:min-h-0">/, 'journée vide');
  assert.match(today, /className="flex min-h-11 min-w-0 flex-1 flex-col justify-center [^"]*md:min-h-0"/, 'titre d\'une tâche');
  // Case d'une tâche : 16 px à l'écran, 44 px au toucher, la ligne ne bouge pas.
  assert.match(today, /<label className="-m-3\.5 flex shrink-0 items-center justify-center p-3\.5 md:m-0 md:p-0">\s*<Checkbox/);
  assert.match(read('src/components/dashboard/DashboardGreeting.tsx'), /<Button asChild variant="primary" size="lg" className="min-h-11 md:min-h-0">/);
  const empty = render(kit.DashboardMissionsPanel, { projects: [] });
  assert.match(empty, /<a class="[^"]*\bmin-h-11\b[^"]*\bmd:min-h-0\b[^"]*" href="\/missions\?create=brief">/, 'aucune mission');
});

test('page d\'accueil : deux sections, plus de canaux, de semaine, d\'activité ni de réordonnancement', () => {
  const page = read('src/pages/Dashboard.tsx');
  assert.match(page, /<PageLayout maxWidth="md">/);
  assert.match(page, /<h2 id="dashboard-todo"[^>]*>\s*À faire\s*<\/h2>/);
  assert.match(page, /<Link to="\/tasks">Toutes les tâches<\/Link>/);
  assert.match(page, /<DashboardMissionsPanel/);
  // Une seule lecture des photos pour toutes les piles de visages.
  assert.equal((page.match(/useCandidateAvatars\(/g) || []).length, 1);
  for (const gone of [
    'src/components/dashboard/DashboardConnections.tsx',
    'src/components/dashboard/DashboardWeekHighlight.tsx',
    'src/components/dashboard/DashboardActivityFeed.tsx',
    'src/components/dashboard/DashboardSortableItem.tsx',
    'src/components/dashboard/Sparkline.tsx',
    'src/hooks/useDashboardLayout.ts',
  ]) {
    assert.equal(existsSync(join(ROOT, gone)), false, `${gone} retiré`);
  }
  assert.doesNotMatch(page, /\b(DashboardConnections|DashboardWeekHighlight|DashboardActivityFeed|useDashboardLayout)\b|@dnd-kit|Personnaliser/);
  const greeting = read('src/components/dashboard/DashboardGreeting.tsx');
  assert.match(greeting, /<Link to="\/missions\?create=brief">/);
  assert.doesNotMatch(greeting, /Personnaliser|onCustomize|Settings2/);
});

test('journée : tâches en retard sous le réveil, visage ou initiales de mission, hooks avant tout retour', () => {
  const src = read('src/components/dashboard/DashboardTodayPanel.tsx');
  assert.match(src, /<AlarmIcon \/>[\s\S]*?\{plural\(lateTasks\.length, 'tâche'\)\} en retard/);
  assert.match(src, /const taskPhotos = useCandidateAvatarsByCandidateId\(taskCandidateIds\);/);
  assert.match(src, /<CandidateAvatar name=\{r\.candidate_name \|\| 'Candidat'\} avatarUrl=\{r\.candidate_id \? taskPhotos\.get\(r\.candidate_id\) \?\? null : null\}/);
  assert.match(src, /<MissionCompanyLogo company=\{client \|\| r\.job_title\} size=\{36\} \/>/);
  // Règle des hooks : aucun appel après le premier retour anticipé.
  const firstReturn = src.indexOf('if (loading) {');
  assert.ok(firstReturn > 0);
  const body = src.slice(src.indexOf('export const DashboardTodayPanel'), src.indexOf('// ─── Lignes'));
  const lastHook = Math.max(...[...body.matchAll(/\buse[A-Z]\w*\(/g)].map((m) => m.index));
  assert.ok(lastHook < body.indexOf('if (loading) {'), 'hooks avant le chargement');
});
