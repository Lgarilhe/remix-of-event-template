/**
 * Design simplifié, lot T : la page Tâches comme la maquette (docs/design/06-simplicite.md).
 *  - une ligne par tâche : la case (44 px au toucher sur téléphone), le visage du
 *    candidat ou les initiales du client, le titre, la mission, l'échéance ;
 *  - « En retard » en rouge sous le réveil qui sonne, les dates des lignes sans couleur ;
 *  - la corbeille au survol, toujours visible sur un écran tactile ;
 *  - un seul bouton plein, les filtres dans un seul menu, pas de zéro ;
 *  - les suggestions sous la liste, trois au plus, les autres à la demande.
 *
 * Rendu statique des listes et de la barre de filtres empaquetées par esbuild
 * (alias @/ résolus par tsconfig.app.json) ; gardes sur le source pour la page.
 * Lancer : node --test tests/ux/taches-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { TaskSection, TaskSuggestions } from './src/components/tasks/TaskList';",
      "export { TasksFiltersBar, DEFAULT_TASKS_FILTERS } from './src/components/tasks/TasksFiltersBar';",
      "export { TooltipProvider } from './src/components/ui/tooltip';",
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
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const render = (component, props) =>
  kit.renderToStaticMarkup(
    kit.createElement(kit.MemoryRouter, null, kit.createElement(kit.TooltipProvider, null, kit.createElement(component, props))),
  );

const MISSION = '22222222-2222-4222-8222-000000000001';
const task = (over) => ({
  id: 't1',
  candidate_id: null,
  candidate_name: null,
  job_id: null,
  job_title: null,
  title: 'Tâche',
  description: null,
  // Heure locale (sans « Z ») : l'échéance s'écrit pareil quel que soit le fuseau du runner.
  due_at: '2026-09-22T11:29:00',
  completed_at: null,
  created_at: '2026-09-01T09:00:00.000Z',
  created_by: 'u1',
  category: 'general',
  auto_generated: false,
  source_event_id: null,
  ...over,
});
const LOGO_MISSION = '22222222-2222-4222-8222-000000000003';
const missionOf = (jobId) =>
  jobId === `project:${MISSION}`
    ? { id: MISSION, client: 'Nova Pay', logo: null }
    : jobId === LOGO_MISSION
      ? { id: LOGO_MISSION, client: 'Médicis Santé', logo: 'https://exemple.test/medicis.png' }
      : null;
const section = (props) =>
  render(kit.TaskSection, {
    bucket: 'overdue',
    label: 'En retard',
    items: [],
    photos: new Map(),
    missionOf,
    onToggle: () => {},
    onDelete: () => {},
    ...props,
  });
const rowsOf = (html) => html.split('<li ').slice(1);

test('En retard : titre rouge sous le réveil qui sonne, nombre à côté, dates sans couleur', () => {
  const html = section({ items: [task({ id: 'a' }), task({ id: 'b' })] });
  assert.match(html, /<h2 id="taches-overdue" class="[^"]*text-danger[^"]*">/);
  assert.match(html, /animate-alarm-ring/);
  assert.match(html, />En retard<span class="font-medium text-muted-foreground">2<\/span><\/h2>/);
  assert.match(html, /aria-labelledby="taches-overdue"/);
  // La couleur reste au titre : aucune date en rouge sur les lignes.
  for (const row of rowsOf(html)) assert.doesNotMatch(row, /(?<![:\w-])text-danger\b/, 'seule la corbeille rougit, au survol');

  const today = section({ bucket: 'today', label: "Aujourd'hui", items: [task({})] });
  assert.doesNotMatch(today, /animate-alarm-ring|(?<![:\w-])text-danger\b/);
  assert.match(today, /<h2 id="taches-today" class="[^"]*text-foreground[^"]*">Aujourd&#x27;hui<span/);
});

test('Ligne : visage du candidat, photo enregistrée sinon initiales, lien vers sa fiche', () => {
  const html = section({
    items: [
      task({ id: 'a', title: 'Relancer Inès Durand après l’entretien', candidate_id: 'cand-0', candidate_name: 'Inès Durand', job_id: `project:${MISSION}`, job_title: 'Lead Developer Backend' }),
      task({ id: 'b', title: 'Préparer le debrief client', candidate_id: 'cand-1', candidate_name: 'Thomas Blanc', job_id: `project:${MISSION}`, job_title: 'Lead Developer Backend' }),
    ],
    photos: new Map([['cand-0', 'https://exemple.test/ines.jpg'], ['cand-1', null]]),
  });
  const [ines, thomas] = rowsOf(html);
  assert.match(ines, /<img src="https:\/\/exemple\.test\/ines\.jpg"/);
  assert.match(ines, /href="\/pipeline\?candidate=cand-0"/);
  // Le nom est déjà dans le titre : la ligne dit la mission et le client.
  assert.match(ines, />Lead Developer Backend, Nova Pay</);
  assert.doesNotMatch(ines, /Inès Durand · /);
  assert.match(thomas, />TB</, 'sans photo : les initiales');
  assert.match(thomas, />Thomas Blanc · Lead Developer Backend, Nova Pay</);
});

test('Ligne : tâche de mission, initiales du client et lien vers la mission sans « project: »', () => {
  const html = section({
    bucket: 'week',
    label: 'Cette semaine',
    items: [task({ title: 'Envoyer la shortlist', job_id: `project:${MISSION}`, job_title: 'Lead Developer Backend' })],
  });
  assert.match(html, />NP</, 'initiales de Nova Pay');
  assert.match(html, new RegExp(`href="/missions/${MISSION}"`));
  assert.doesNotMatch(html, /project:/);
  // Le client déjà dans l'intitulé n'est pas répété.
  const named = section({ items: [task({ job_id: `project:${MISSION}`, job_title: 'Lead Developer Backend · Nova Pay' })] });
  assert.match(named, />Lead Developer Backend · Nova Pay</);
  assert.doesNotMatch(named, /Nova Pay, Nova Pay/);
});

test('Ligne : le logo enregistré du client quand il existe, et l\'identifiant nu accepté', () => {
  const html = section({ items: [task({ title: 'Lancer une nouvelle recherche', job_id: LOGO_MISSION, job_title: 'Head of Sales' })] });
  assert.match(html, /<img src="https:\/\/exemple\.test\/medicis\.png"/);
  assert.doesNotMatch(html, />MS</, 'pas d\'initiales quand le logo existe');
  assert.match(html, new RegExp(`href="/missions/${LOGO_MISSION}"`));
  assert.match(html, />Head of Sales, Médicis Santé</);
});

test('Ligne : sans candidat ni mission, une pastille et pas de lien', () => {
  const html = section({ bucket: 'later', label: 'Plus tard', items: [task({ title: 'Mettre à jour mes notes' })] });
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /lucide-list-checks/);
});

test('Ligne : échéance à droite sur ordinateur, sous le titre sur téléphone', () => {
  const html = section({ items: [task({ job_id: `project:${MISSION}`, job_title: 'Lead Developer Backend' })] });
  const due = '22 sept. à 11:29';
  assert.match(html, new RegExp(`<span class="hidden shrink-0 text-sm tabular-nums text-muted-foreground md:block">${due}</span>`));
  assert.match(html, new RegExp(`<span class="tabular-nums md:hidden">${due} · </span>Lead Developer Backend, Nova Pay`));
  // Sans mission ni candidat : la ligne de l'échéance n'existe que sur téléphone.
  assert.match(section({ items: [task({})] }), /<span class="block text-pretty text-sm text-muted-foreground md:truncate md:hidden">/);
});

test('Ligne : case touchable sur 44 px, corbeille au survol et sur écran tactile', () => {
  const html = section({ items: [task({ title: 'Relancer Hugo' })] });
  assert.match(html, /<label class="-m-3\.5 flex shrink-0 items-center justify-center p-3\.5 md:m-0 md:p-0"><button type="button" role="checkbox"/);
  assert.match(html, /aria-label="Marquer la tâche « Relancer Hugo » comme faite"/);
  assert.match(html, /aria-label="Supprimer la tâche « Relancer Hugo »"/);
  const trash = html.match(/<button[^>]*aria-label="Supprimer la tâche[^>]*>/)[0];
  for (const cls of ['opacity-0', 'group-hover:opacity-100', 'focus-visible:opacity-100', 'data-[state=open]:opacity-100', '[@media(hover:none)]:opacity-100', 'min-h-11', 'min-w-11']) {
    assert.ok(trash.includes(cls), `corbeille : ${cls}`);
  }
  assert.match(html, /<li class="group flex items-center gap-3\.5 py-3">/);
  assert.match(html, /class="flex min-h-11 min-w-0 flex-1 flex-col justify-center[^"]*md:min-h-0"/);
});

test('Terminées : barrées, atténuées, la case rouvre la tâche', () => {
  const html = section({ bucket: 'done', label: 'Terminées', items: [task({ title: 'Vérifier les références', completed_at: '2026-09-28T10:00:00Z' })] });
  assert.match(html, /<li class="group flex items-center gap-3\.5 py-3 opacity-60">/);
  assert.match(html, /line-through">Vérifier les références</);
  assert.match(html, /aria-label="Rouvrir la tâche « Vérifier les références »"/);
});

const suggestion = (n, over) => ({
  key: `s${n}`,
  category: 'follow_up',
  title: `Relancer Candidat ${n}`,
  description: '',
  dueAt: new Date('2026-10-06T09:00:00Z'),
  candidate: { candidateId: `cand-${n}`, name: `Candidat ${n}`, avatarUrl: null, headline: null },
  projectId: null,
  sourceEventId: null,
  reason: 'Dans l’étape « A répondu » depuis 10 jours',
  ...over,
});
const suggestions = (list, photos = new Map()) =>
  render(kit.TaskSuggestions, { suggestions: list, photos, creatingKey: null, onAccept: () => {}, onDismiss: () => {} });

test('Suggestions : rien à proposer, rien d\'affiché', () => {
  assert.equal(suggestions([]), '');
});

test('Suggestions : trois au plus, les autres à la demande', () => {
  const five = suggestions([1, 2, 3, 4, 5].map((n) => suggestion(n)));
  assert.match(five, />Suggestions<span class="font-medium text-muted-foreground">5<\/span><\/h2>/);
  assert.equal(rowsOf(five).length, 3);
  assert.match(five, /aria-expanded="false"[^>]*>Afficher 2 autres suggestions</);
  assert.match(suggestions([1, 2, 3, 4].map((n) => suggestion(n))), />Afficher 1 autre suggestion</);
  assert.doesNotMatch(suggestions([1, 2, 3].map((n) => suggestion(n))), /Afficher/);
});

test('Suggestions : le visage du candidat, une action en texte et « Ignorer »', () => {
  const html = suggestions([suggestion(1)], new Map([['cand-1', 'https://exemple.test/c1.jpg']]));
  assert.match(html, /<img src="https:\/\/exemple\.test\/c1\.jpg"/);
  assert.match(html, />Relancer Candidat 1</);
  assert.match(html, />Dans l’étape « A répondu » depuis 10 jours</);
  assert.match(html, /<button[^>]*class="[^"]*underline-offset-4[^"]*font-semibold[^"]*"[^>]*>Créer la tâche<\/button>/);
  assert.match(html, /aria-label="Ignorer la suggestion « Relancer Candidat 1 »"/);
  assert.doesNotMatch(html, /bg-primary/, 'pas de bouton plein dans les suggestions');
});

test('Filtres : deux choix visibles et un seul menu, sans zéro', () => {
  const bar = (filters) =>
    render(kit.TasksFiltersBar, {
      filters,
      onFiltersChange: () => {},
      scope: 'mine',
      onScopeChange: () => {},
      view: 'active',
      onViewChange: () => {},
      allReminders: [],
    });
  const html = bar(kit.DEFAULT_TASKS_FILTERS);
  assert.match(html, /aria-label="Périmètre des tâches"/);
  assert.match(html, />En cours</);
  assert.match(html, />Toutes</);
  assert.doesNotMatch(html, /Actives|\(\d+\)/);
  assert.match(html, /aria-label="Filtres"/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) || []).length, 1, 'un seul menu');
  assert.match(bar({ categories: ['follow_up'], jobTitles: ['Lead Developer Backend'], autoOnly: null }), /aria-label="Filtres : 2 choisis"/);

  const src = read('src/components/tasks/TasksFiltersBar.tsx');
  for (const group of ['tasks-filter-category', 'tasks-filter-mission', 'tasks-filter-origin']) {
    assert.match(src, new RegExp(`<div role="group" aria-labelledby="${group}"`));
  }
  assert.doesNotMatch(src, /activeCount/);
});

test('Page : un seul bouton plein, plus d\'« Actualiser », liste puis suggestions', () => {
  const src = read('src/pages/Tasks.tsx');
  assert.equal((src.match(/variant="primary"/g) || []).length, 1);
  assert.doesNotMatch(src, /Actualiser|RefreshCw|<Section\b/);
  assert.ok(src.indexOf('<TaskSection') < src.indexOf('<TaskSuggestions'), 'les suggestions viennent après la liste');
  assert.match(src, /useCandidateAvatarsByCandidateId\(candidateIds\)/);
  assert.match(src, /jobId\.replace\(\/\^project:\/, ''\)/);
  assert.match(src, /logo: p\.jd_client_logo \?\? null/);
  // Pas de zéro : sans tâche en cours, l'état vide parle ; « terminée » seulement s'il y en a.
  assert.match(src, /counts\.active === 0\s*\? undefined/);
  assert.match(src, /counts\.done > 0 \? `, \$\{plural\(counts\.done, 'terminée'\)\}` : ''/);
  // La liste se relit au retour sur l'onglet, faute de bouton « Actualiser ».
  assert.match(read('src/hooks/useAllReminders.ts'), /refetchOnWindowFocus: true,/);
});
