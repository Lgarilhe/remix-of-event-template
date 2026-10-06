/**
 * Barre latérale, lot 5 : onglet Missions (spécification §3, §8, §11.2).
 *
 * - modules purs (src/lib/missionViews.ts, src/lib/sidebarMissions.ts),
 *   transpilés en mémoire par esbuild et chargés par une URL data: ;
 * - computeReadiness (src/hooks/useMissionReadiness.ts), empaqueté par
 *   buildSync (React et les alias @/ résolus) ;
 * - hooks, composants, migration et CI : inspection de source.
 *
 * Sans navigateur ni base. La migration se rejoue à part sur une base neuve
 * (supabase/tests/job_favorites_audit.sql, étape de .github/workflows/e2e.yml).
 * Lancer : node --test tests/ux/barre-lot5-missions.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const loadPure = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const views = await loadPure('src/lib/missionViews.ts');
const nav = await loadPure('src/lib/sidebarMissions.ts');

// computeReadiness : empaqueté avec ses dépendances (React, @/lib/missionUtils),
// alias @/ résolus par les chemins de tsconfig.app.json.
const { outputFiles } = buildSync({
  entryPoints: [join(ROOT_PATH, 'src/hooks/useMissionReadiness.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
});
const { computeReadiness } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const walk = (rel) => {
  const dir = join(ROOT_PATH, rel);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(join(rel, name)));
    else if (/\.(ts|tsx)$/.test(name)) out.push(join(rel, name));
  }
  return out;
};

const workspace = read('src/components/missions/v2/MissionWorkspaceV2.tsx');
const stepper = read('src/components/missions/v2/PhaseStepper.tsx');
const pinsHook = read('src/hooks/sidebar/useMissionPins.ts');
const myMissions = read('src/hooks/sidebar/useMyMissions.ts');
const visitsHook = read('src/hooks/sidebar/useMissionVisits.ts');
const tracker = read('src/components/sidebar/missions/MissionVisitTracker.tsx');
const navRow = read('src/components/sidebar/missions/MissionNavRow.tsx');
const panel = read('src/components/sidebar/missions/MissionsPanel.tsx');
const quotaGate = read('src/hooks/useQuotaGate.ts');
const sourcingProjects = read('src/hooks/useSourcingProjects.ts');
const projectsList = read('src/components/outreach/projects/ProjectsListV2.tsx');
const e2eWorkflow = read('.github/workflows/e2e.yml');

// ---------------------------------------------------------------- B5-1
test('B5-1 : missionViews.ts et sidebarMissions.ts sont sans import', () => {
  for (const rel of ['src/lib/missionViews.ts', 'src/lib/sidebarMissions.ts']) {
    assert.doesNotMatch(read(rel), /^\s*import\s/m, `${rel} importe un module`);
  }
});

// ---------------------------------------------------------------- B5-2
test('B5-2 : 8 vues dans l\'ordre de la page, branchées sur missionViews', () => {
  const flat = views.MISSION_PHASES.flatMap((p) => p.views.map((v) => [v.id, v.label]));
  assert.deepEqual(flat, [
    ['overview', "Vue d'ensemble"],
    ['brief', 'Brief'],
    ['process', 'Process'],
    ['config', 'Configuration'],
    ['sourcing', 'Sourcing'],
    ['outreach', 'Outreach'],
    ['pipeline', 'Pipeline'],
    ['insights', 'Insights'],
  ]);
  assert.deepEqual(
    views.MISSION_PHASES.map((p) => [p.id, p.label, p.desc]),
    [
      [1, 'Cadrage', 'Brief & process'],
      [2, 'Sourcing & Outreach', 'Recherche & contact'],
      [3, 'Pipeline', 'Entretiens & embauche'],
    ],
  );
  assert.deepEqual(views.MISSION_VIEW_IDS, flat.map(([id]) => id));
  assert.equal(views.VIEW_TO_PHASE.config, 1);
  assert.equal(views.VIEW_TO_PHASE.outreach, 2);
  assert.equal(views.VIEW_TO_PHASE.insights, 3);

  for (const [name, src] of [['MissionWorkspaceV2', workspace], ['PhaseStepper', stepper]]) {
    assert.match(src, /from '@\/lib\/missionViews'/, `${name} n'importe pas missionViews`);
    assert.doesNotMatch(src, /label: 'Sourcing'/, `${name} garde un libellé en dur`);
    assert.doesNotMatch(src, /'Sourcing & Outreach'/, `${name} garde un libellé de phase en dur`);
  }
  assert.match(workspace, /PHASE_SUBS[^=]*=[\s\S]{0,200}\[\.\.\./, 'PHASE_SUBS doit être construit par copie');
  assert.match(workspace, /parseMissionView\(searchParams\.get\('tab'\)\)/);
  assert.doesNotMatch(workspace, /bouton flottant/);
});

// ---------------------------------------------------------------- B5-3
test('B5-3 : parseMissionView retombe sur la Vue d\'ensemble', () => {
  assert.equal(views.parseMissionView(null), 'overview');
  assert.equal(views.parseMissionView(undefined), 'overview');
  assert.equal(views.parseMissionView(''), 'overview');
  assert.equal(views.parseMissionView('x'), 'overview');
  assert.equal(views.parseMissionView('pipeline'), 'pipeline');
});

// ---------------------------------------------------------------- B5-4
test('B5-4 : verrous d\'une ligne de liste identiques à la page', () => {
  const locked = (r) => ['overview', 'brief', 'process', 'config', 'sourcing', 'outreach', 'pipeline', 'insights']
    .filter((v) => nav.isViewLocked(r, v));
  const empty = computeReadiness({ name: 'A', job_title: null, stats_total_found: 0, stats_messaged: 0 });
  assert.deepEqual(locked(empty), ['pipeline', 'insights']);
  const found = computeReadiness({ name: 'A', job_title: null, stats_total_found: 3, stats_messaged: 0 });
  assert.deepEqual(locked(found), []);
  // Étape absente (overview, config) : jamais verrouillée, comme la page.
  assert.equal(nav.isViewLocked([], 'overview'), false);
});

// ---------------------------------------------------------------- B5-5
test('B5-5 : resolveOpenTarget rouvre la dernière vue, sauf verrou', () => {
  const readiness = computeReadiness({ name: 'A', job_title: null, stats_total_found: 0, stats_messaged: 0 });
  const pipelineMessage = readiness.find((r) => r.id === 'pipeline').blockerMessage;
  assert.ok(pipelineMessage);

  assert.deepEqual(nav.resolveOpenTarget({ projectId: 'p1', lastView: 'pipeline', readiness }),
    { path: '/missions/p1', blocker: pipelineMessage });
  assert.deepEqual(nav.resolveOpenTarget({ projectId: 'p1', lastView: 'brief', readiness }),
    { path: '/missions/p1?tab=brief', blocker: null });
  assert.deepEqual(nav.resolveOpenTarget({ projectId: 'p1', lastView: null, readiness }),
    { path: '/missions/p1', blocker: null });
  assert.deepEqual(nav.resolveOpenTarget({ projectId: 'p1', lastView: 'overview', readiness }),
    { path: '/missions/p1', blocker: null });
});

// ---------------------------------------------------------------- B5-6
test('B5-6 : point « nouveaux profils »', () => {
  assert.equal(nav.hasNewProfiles(5, undefined), false);
  assert.equal(nav.hasNewProfiles(5, { n: 5 }), false);
  assert.equal(nav.hasNewProfiles(6, { n: 5 }), true);
});

test('B5-6 bis : relevé local (clé, lecture tolérante, référence, plafond de 100)', () => {
  assert.equal(nav.missionVisitsStorageKey('u1'), 'konekt:nav:missions:u1');
  assert.deepEqual(nav.parseMissionVisits('pas du json'), {});
  assert.deepEqual(
    nav.parseMissionVisits(JSON.stringify({ a: { v: 'brief', n: 2, t: 'x' }, b: { v: 3, n: 1, t: 'x' }, c: { v: null, n: 'z', t: 'x' } })),
    { a: { v: 'brief', n: 2, t: 'x' } },
  );
  // Une référence n'écrase jamais un relevé existant.
  const v1 = nav.withMissionBaselines({ a: { v: 'brief', n: 2, t: 't0' } }, [{ id: 'a', n: 9 }, { id: 'b', n: 4 }], 't1');
  assert.deepEqual(v1, { a: { v: 'brief', n: 2, t: 't0' }, b: { v: null, n: 4, t: 't1' } });
  const same = { a: { v: 'brief', n: 2, t: 't0' } };
  assert.equal(nav.withMissionBaselines(same, [{ id: 'a', n: 9 }], 't1'), same);
  assert.equal(nav.withMissionVisit(same, 'a', { v: 'brief', n: 2 }, 't1'), same, 'aucune écriture si rien ne change');
  // 100 entrées au plus, les plus anciennes retirées.
  const many = {};
  for (let i = 0; i < 101; i += 1) many[`m${i}`] = { v: null, n: 0, t: new Date(2026, 0, 1, 0, i).toISOString() };
  const pruned = nav.pruneMissionVisits(many);
  assert.equal(Object.keys(pruned).length, 100);
  assert.ok(!('m0' in pruned), 'la plus ancienne doit partir');
});

// ---------------------------------------------------------------- B5-7
const U = 'u-me';
const ORG = 'org-1';
const row = (id, extra = {}) => ({
  id, name: `Mission ${id}`, client_name: null, organization_id: ORG, kind: 'mission', status: 'active',
  job_title: null, created_by: U, updated_at: '2026-09-01T10:00:00Z', stats_total_found: 0, stats_messaged: 0,
  ...extra,
});
const src = (data, extra = {}) => ({ data, isError: false, paused: false, ...extra });

test('B5-7 : fusion « Mes missions »', () => {
  const orgRows = [
    row('mine'),
    row('team', { created_by: 'colleague' }),
    row('colleague', { created_by: 'colleague' }),
    row('done', { status: 'completed' }),
    row('archived', { status: 'archived' }),
    row('search', { kind: 'search' }),
    row('pinned'),
    row('open'),
  ];
  const team = [
    { project_id: 'team', sourcing_projects: row('team', { created_by: 'colleague' }) },
    { project_id: 'partner', sourcing_projects: row('partner', { organization_id: 'org-2', client_name: 'Acme' }) },
    { project_id: 'foreign', sourcing_projects: row('foreign', { organization_id: 'org-3' }) },
    { project_id: 'hidden', sourcing_projects: null },
  ];
  const r = nav.buildMyMissions({
    userId: U,
    organizationId: ORG,
    orgList: src(orgRows),
    team: src(team),
    partners: src([{ id: 'partner', organization_name: 'Entreprise X' }]),
    pins: src([{ job_id: 'pinned' }]),
    openMissionId: 'open',
  });
  assert.equal(r.status, 'ok');
  const ids = r.mine.map((m) => m.id).sort();
  assert.deepEqual(ids, ['mine', 'partner', 'team'], 'créées par moi, équipe et partenaire seulement');
  const partner = r.mine.find((m) => m.id === 'partner');
  assert.equal(partner.sub, 'Acme · Confiée par Entreprise X');
  assert.equal(nav.missionSubtitle(null, 'Entreprise X'), 'Confiée par Entreprise X');
  assert.deepEqual(r.pinned.map((m) => m.id), ['pinned']);
  assert.equal(r.open?.id, 'open');
  assert.equal(r.ownOrgMissionCount, 7, 'missions de l\'organisation, tous statuts, sans les recherches');
  assert.equal(r.partnerMissionCount, 1);
});

test('B5-7 : tri par date décroissante, 15 lignes au plus', () => {
  const orgRows = Array.from({ length: 20 }, (_, i) =>
    row(`m${i}`, { updated_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString() }));
  const r = nav.buildMyMissions({
    userId: U, organizationId: ORG, orgList: src(orgRows), team: src([]), partners: src(undefined), pins: null,
  });
  assert.equal(r.mine.length, 15);
  assert.equal(r.mine[0].id, 'm19');
  assert.equal(r.mine[14].id, 'm5');
  assert.equal(r.partnerMissionCount, 0, 'aucune mission étrangère : RPC inutile');
});

test('B5-7 : jamais 0 ni liste vide pendant un chargement', () => {
  const loading = nav.buildMyMissions({
    userId: U, organizationId: ORG, orgList: src(undefined), team: src([]), partners: src(undefined), pins: null,
  });
  assert.equal(loading.status, 'loading');
  assert.equal(loading.ownOrgMissionCount, null);

  const offline = nav.buildMyMissions({
    userId: U, organizationId: ORG, orgList: src(undefined, { paused: true }), team: src([]), partners: src(undefined), pins: null,
  });
  assert.equal(offline.status, 'offline');

  const error = nav.buildMyMissions({
    userId: U, organizationId: ORG, orgList: src(undefined, { isError: true }), team: src([]), partners: src(undefined), pins: null,
  });
  assert.equal(error.status, 'error');

  const stale = nav.buildMyMissions({
    userId: U, organizationId: ORG, orgList: src([row('a')], { isError: true }), team: src([]), partners: src(undefined), pins: null,
  });
  assert.equal(stale.status, 'ok');
  assert.equal(stale.stale, true);

  // Mission étrangère jointe, RPC pas encore reçue : compte partenaire inconnu.
  const waiting = nav.buildMyMissions({
    userId: U, organizationId: ORG, orgList: src([]),
    team: src([{ project_id: 'x', sourcing_projects: row('x', { organization_id: 'org-2' }) }]),
    partners: src(undefined), pins: null,
  });
  assert.equal(waiting.status, 'loading');
  assert.equal(waiting.partnerMissionCount, null);
});

// ---------------------------------------------------------------- B5-8
test('B5-8 : épingles résolues et plafond de 10', () => {
  assert.equal(nav.PIN_LIMIT, 10);
  const missions = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
  const resolved = nav.resolvePins([{ job_id: 'a' }, { job_id: 'ghost' }, { job_id: 'b' }, { job_id: 'a' }], missions);
  assert.deepEqual(resolved.map((m) => m.id), ['a', 'b'], 'orphelines ignorées, doublons comptés une fois');
  assert.equal(nav.canPin(10), false);
  assert.equal(nav.canPin(9), true);
  assert.equal(nav.PIN_LIMIT_MESSAGE, '10 épingles au plus. Retirez-en une pour épingler cette mission.');

  const pinButton = navRow.slice(navRow.indexOf('const pinButton'), navRow.indexOf('return (', navRow.indexOf('const pinButton')));
  assert.match(pinButton, /aria-disabled/);
  assert.match(pinButton, /aria-pressed/);
  assert.doesNotMatch(pinButton, /(?<!aria-)disabled=\{/, 'disabled ôterait le focus et l\'infobulle');
  assert.match(navRow, /min-h-11/);
  assert.match(navRow, /Afficher les vues de \$\{item\.name\}/);
  assert.match(navRow, /Épingler \$\{item\.name\}/);
  assert.match(navRow, /Retirer \$\{item\.name\} des épinglées/);
  assert.match(navRow, /Nouveaux profils depuis votre dernière visite/);

  assert.match(panel, /Voir toutes les missions/);
  const around = panel.slice(Math.max(0, panel.indexOf('Voir toutes les missions') - 300), panel.indexOf('Voir toutes les missions'));
  assert.doesNotMatch(around, /> ?15|length\s*>/, 'le lien final ne dépend d\'aucune longueur');
  for (const text of ['Mission ouverte', 'Vues globales', 'Candidats de toutes les missions', 'Hors mission',
    'Épinglées', 'Mes missions', 'Aucune mission en cours.', 'Impossible de charger vos épingles.',
    'Impossible de charger vos missions.']) {
    assert.ok(panel.includes(text), `texte absent du panneau : ${text}`);
  }
});

// ---------------------------------------------------------------- B5-9
test('B5-9 : épingles : lecture et écritures de job_favorites', () => {
  const insert = pinsHook.slice(pinsHook.indexOf('.insert('), pinsHook.indexOf(')', pinsHook.indexOf('.insert(')) + 1);
  assert.match(insert, /user_id/);
  assert.match(insert, /job_id/);
  assert.doesNotMatch(pinsHook, /organization_id/);
  assert.match(pinsHook, /'23505'/);
  assert.equal(pinsHook.match(/\.eq\('user_id'/g)?.length, 2, 'lecture et retrait filtrent user_id');
  assert.match(pinsHook, /ascending: false/);
  assert.match(pinsHook, /\.limit\(MISSION_PINS_READ_LIMIT\)/);
  assert.match(pinsHook, /MISSION_PINS_READ_LIMIT = 50/);
  assert.match(pinsHook, /'job-favorites'/);
  assert.match(pinsHook, /L'épingle n'a pas été enregistrée\. Réessayez\./);
  assert.match(pinsHook, /L'épingle n'a pas été retirée\. Réessayez\./);
  assert.match(pinsHook, /onMutate/);
  assert.match(pinsHook, /onError/);
  assert.match(pinsHook, /onSettled/);
});

// ---------------------------------------------------------------- B5-10
test('B5-10 : useQuotaGate compte les missions actives par statut', () => {
  assert.doesNotMatch(quotaGate, /archived_at/);
  assert.match(quotaGate, /\.not\('status', 'in', '\(completed,archived\)'\)/);
  assert.equal(quotaGate.match(/if \(error\) throw error/g)?.length, 2);
  assert.match(quotaGate, /jobQuotaKnown/);
  assert.match(quotaGate, /jobCountLoaded/);
  assert.match(quotaGate, /pendingInvitationsLoaded/);
  assert.doesNotMatch(quotaGate, /if \(error\) return 0/);
});

// ---------------------------------------------------------------- B5-11
test('B5-11 : migration des épingles', () => {
  const files = readdirSync(join(ROOT_PATH, 'supabase/migrations'));
  const mine = files.filter((f) => /_barre_lot5_epingles\.sql$/.test(f));
  assert.equal(mine.length, 1, 'un seul fichier *_barre_lot5_epingles.sql');
  const version = mine[0].split('_')[0];
  assert.match(version, /^\d{14}$/);
  assert.ok(version > '20260923095813', 'version postérieure à la dernière du dépôt au départ');
  assert.equal(files.filter((f) => f.startsWith(`${version}_`)).length, 1, 'version unique');

  const sql = read(`supabase/migrations/${mine[0]}`);
  for (const needle of [
    'DELETE FROM public.job_favorites a',
    'CREATE UNIQUE INDEX IF NOT EXISTS job_favorites_user_id_job_id_key',
    'FROM pg_policies',
    'CREATE POLICY own_rows_all',
    'RAISE EXCEPTION',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user',
    'CREATE INDEX IF NOT EXISTS idx_candidate_reminders_due_at',
  ]) {
    assert.ok(sql.includes(needle), `absent de la migration : ${needle}`);
  }
  const withoutComments = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  assert.doesNotMatch(withoutComments, /organization_id/);
  assert.doesNotMatch(withoutComments, /notion_api_cache/);
});

// ---------------------------------------------------------------- B5-12
test('B5-12 : données de la barre sans skipToken ni useSourcingProject', () => {
  const team = myMissions.slice(myMissions.indexOf("from('mission_team')"), myMissions.indexOf('.limit(100)') + 11);
  assert.match(myMissions, /sourcing_projects\(/);
  assert.match(team, /\.eq\('user_id'/);
  assert.match(team, /\.limit\(100\)/);
  assert.doesNotMatch(myMissions, /useSourcingProject\(/);

  for (const rel of [...walk('src/components/sidebar'), ...walk('src/hooks/sidebar')]) {
    assert.doesNotMatch(read(rel), /skipToken/, `${rel} utilise skipToken`);
  }
  for (const [name, text] of [['MissionVisitTracker', tracker], ['useMyMissions', myMissions]]) {
    assert.match(text, /sourcingProjectQueryOptions\(/, `${name} : options partagées absentes`);
    assert.match(text, /enabled: false/, `${name} : la fiche doit être lue sans être lancée`);
  }
  assert.match(myMissions, /export function useOpenMissionProject/);
  assert.match(myMissions, /export function useMissionNames/);

  assert.match(sourcingProjects, /export function sourcingProjectQueryOptions/);
  const single = sourcingProjects.slice(sourcingProjects.indexOf('export const useSourcingProject ='));
  assert.match(single, /sourcingProjectQueryOptions\(/, 'useSourcingProject doit utiliser les options partagées');
  assert.match(sourcingProjects, /hasData: query\.data !== undefined/);
  assert.match(sourcingProjects, /isError: query\.isError/);
});

// ---------------------------------------------------------------- B5-13
test('B5-13 : la CI joue l\'audit des épingles', () => {
  assert.match(e2eWorkflow, /job_favorites_audit\.sql/);
  assert.ok(existsSync(join(ROOT_PATH, 'supabase/tests/job_favorites_audit.sql')));
});

// ---------------------------------------------------------------- B5-14
test('B5-14 : relevé partagé par useSyncExternalStore, notifié à chaque écriture', () => {
  assert.match(visitsHook, /useSyncExternalStore/);
  const write = visitsHook.slice(visitsHook.indexOf('function writeVisits'), visitsHook.indexOf('function onStorage'));
  assert.match(write, /notifySubscribers\(\)/);
  assert.doesNotMatch(visitsHook, /export (function|const) [A-Z]/, 'aucun composant exporté');
  assert.match(tracker, /export function MissionVisitTracker/);
  assert.match(tracker, /\[projectId, view, seenTotal/);
});

// ---------------------------------------------------------------- B5-15
test('B5-15 : /missions annonce le plafond au lieu de le refuser après le clic', () => {
  assert.doesNotMatch(projectsList, /Quota de missions atteint/);
  assert.doesNotMatch(projectsList, /if \(!canCreateJob\)[\s\S]{0,120}toast\.error/);
  assert.match(projectsList, /MissionQuotaNotice/);
  assert.match(projectsList, /jobQuotaKnown/);
  const effect = projectsList.slice(projectsList.indexOf("const createParam = searchParams.get('create')"));
  const deps = effect.slice(effect.indexOf('}, ['), effect.indexOf(']);') + 1);
  assert.match(deps, /jobQuotaKnown/);
  assert.match(deps, /canCreateJob/);
  assert.equal(nav.missionQuotaMessage(3), 'Plafond de 3 missions en cours atteint (actives ou en pause).');
  assert.equal(nav.missionQuotaMessage(1), 'Plafond de 1 mission en cours atteint (active ou en pause).');
});

// ---------------------------------------------------------------- Textes
test('Textes : aucun nom de fournisseur ni tiret long dans les fichiers du lot 5', () => {
  const VENDORS = /\b(Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|People Data Labs|PDL|Brandfetch|Clearbit|Coresignal|OpenAI)\b/i;
  const files = [
    'src/lib/missionViews.ts',
    'src/lib/sidebarMissions.ts',
    'src/hooks/sidebar/useMyMissions.ts',
    'src/hooks/sidebar/useMissionPins.ts',
    'src/hooks/sidebar/useMissionVisits.ts',
    'src/components/missions/MissionQuotaNotice.tsx',
    ...walk('src/components/sidebar/missions'),
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(text, VENDORS, `${rel} : nom de fournisseur`);
    assert.doesNotMatch(text, /—/, `${rel} : tiret long`);
  }
});
