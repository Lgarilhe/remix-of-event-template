/**
 * Refonte mission, lot 0c (socle) : src/lib/stageDisplay.ts et
 * src/hooks/useMissionStageCounts.ts, fonctions pures.
 *
 * - libellés : nom de l'étape pour un effectif, « au total » pour un cumul,
 *   nombres accordés, sans « (s) » ni tiret long ;
 * - kanban de mission : missionColumnOf et missionColumnToStage font l'aller
 *   et le retour, étape générale et étape d'entretien seulement ;
 * - /pipeline : atsColumnOf (plan 0c, section 6.5), clés de ATS_STAGES,
 *   titres alignés sur la mission (décision 3), ancien nom provisoire gardé ;
 * - ancienneté dans l'étape (stage_entered_at d'abord), « sans mouvement » ;
 * - compteurs de mission : jamais de zéros inventés, clé de requête stable ;
 * - candidateStage.ts : clé « interviewing », date d'entrée gardée en chaîne.
 *
 * Modules empaquetés par esbuild (alias @/ résolus par tsconfig.app.json),
 * client Supabase et React Query remplacés par des modules vides.
 * Lancer : node --test tests/ux/lot0c-stage-display.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /^(react|@tanstack\/react-query)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'export const supabase = { rpc: (fn, args) => globalThis.__rpc(fn, args) };',
        'export const useMemo = (f) => f();',
        'export const useQuery = (o) => o;',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const display = await load('src/lib/stageDisplay.ts');
const counts = await load('src/hooks/useMissionStageCounts.ts');
const stage = await load('src/lib/candidateStage.ts');

const {
  GENERAL_STAGE_LABEL,
  STAGE_ORDER,
  stageLabel,
  CUMULATIVE_LABEL,
  cumulativeText,
  MISSION_COLUMN_KEY,
  MISSION_STEP_MISSING_LABEL,
  missionColumnOf,
  ATS_COLUMN_BY_STAGE,
  ATS_INTERVIEW_COLUMNS,
  atsColumnOf,
  atsColumnTitle,
  stageAgeDays,
  STALE_AFTER_DAYS,
  isStale,
  missionActivityAt,
  STAGE_READER_KEYS,
  invalidateStageReaders,
} = display;

const STEP_A = '4a1b2c3d-0000-4000-8000-00000000000a';
const STEP_B = '4a1b2c3d-0000-4000-8000-00000000000b';

// ------------------------------------------------------------- libellés
test('0c : un libellé par étape générale, dans l\'ordre de l\'entonnoir', () => {
  assert.deepEqual([...STAGE_ORDER], [...stage.GENERAL_STAGES]);
  assert.deepEqual(Object.keys(GENERAL_STAGE_LABEL), [...stage.GENERAL_STAGES]);
  assert.deepEqual(Object.values(GENERAL_STAGE_LABEL),
    ['À trier', 'Retenu', 'Contacté', 'A répondu', 'En entretien', 'Embauché', 'Écarté']);
  assert.equal(stageLabel('replied'), 'A répondu');
  assert.equal(stageLabel('shortlisted'), null, 'ancien statut : aucun libellé inventé');
  assert.equal(stageLabel(null), null);
});

test('0c : cumuls écrits « au total », nombre accordé', () => {
  for (const [key, title] of Object.entries(CUMULATIVE_LABEL)) {
    assert.match(title, / au total$/, key);
    assert.match(cumulativeText(key, 2), / au total$/, key);
  }
  assert.equal(CUMULATIVE_LABEL.ever_contacted, 'Contactés au total');
  assert.equal(CUMULATIVE_LABEL.ever_replied, 'Ont répondu au total');
  assert.equal(CUMULATIVE_LABEL.ever_hired, 'Embauchés au total');
  assert.equal(cumulativeText('ever_contacted', 0), '0 contacté au total');
  assert.equal(cumulativeText('ever_contacted', 1), '1 contacté au total');
  assert.equal(cumulativeText('ever_contacted', 1200), `${(1200).toLocaleString('fr-FR')} contactés au total`);
  assert.equal(cumulativeText('ever_replied', 1), '1 a répondu au total');
  assert.equal(cumulativeText('ever_replied', 3), '3 ont répondu au total');
  assert.equal(cumulativeText('ever_interviewed', 2), '2 passés en entretien au total');
  assert.equal(cumulativeText('ever_retained', 5), '5 retenus au total');
});

test('0c : aucun « (s) », tiret long ni nom de prestataire dans les nouveaux modules', () => {
  for (const rel of ['src/lib/stageDisplay.ts', 'src/hooks/useMissionStageCounts.ts']) {
    const src = read(rel);
    assert.doesNotMatch(src, /\(s\)|—/, rel);
    assert.doesNotMatch(src, /unipile|apollo|people data labs|\bpdl\b|anthropic|claude/i, rel);
  }
});

// ------------------------------------------------------ kanban de mission
test('0c : missionColumnOf range par l\'étape générale et l\'étape d\'entretien seulement', () => {
  const steps = new Set([STEP_A, STEP_B]);
  const none = new Set();
  assert.equal(missionColumnOf({ general_stage: 'to_sort' }, steps), 'untreated');
  assert.equal(missionColumnOf({ general_stage: 'retained' }, steps), 'shortlisted');
  assert.equal(missionColumnOf({ general_stage: 'contacted' }, steps), 'messaged');
  assert.equal(missionColumnOf({ general_stage: 'replied' }, steps), 'Répondu');
  assert.equal(missionColumnOf({ general_stage: 'hired' }, steps), 'hired');
  assert.equal(missionColumnOf({ general_stage: 'rejected', process_step_id: STEP_A }, steps), 'dismissed');
  assert.equal(missionColumnOf({ general_stage: 'interviewing', process_step_id: STEP_B }, steps), STEP_B);
  // Sans étape (ou étape d'une autre mission) : colonne « interviewing ».
  assert.equal(missionColumnOf({ general_stage: 'interviewing', process_step_id: null }, steps), 'interviewing');
  assert.equal(missionColumnOf({ general_stage: 'interviewing', process_step_id: STEP_A }, none), 'interviewing');
  // Étape inconnue ou absente : À trier, jamais un ancien statut.
  assert.equal(missionColumnOf({ general_stage: 'shortlisted' }, steps), 'untreated');
  assert.equal(missionColumnOf({}, steps), 'untreated');
  assert.equal(MISSION_STEP_MISSING_LABEL, 'Étape à choisir');
});

test('0c : missionColumnOf puis missionColumnToStage rendent l\'étape de départ', () => {
  const steps = new Set([STEP_A]);
  for (const g of stage.GENERAL_STAGES) {
    const row = g === 'interviewing' ? { general_stage: g, process_step_id: STEP_A } : { general_stage: g };
    const back = stage.missionColumnToStage(missionColumnOf(row, steps), steps);
    assert.equal(back.stage, g, g);
    assert.equal(back.legacyStage, undefined, `${g} : le kanban n'envoie aucun libellé hérité`);
  }
  // Mission sans étapes : « En entretien » sans étape d'entretien.
  const none = new Set();
  assert.deepEqual(stage.missionColumnToStage(missionColumnOf({ general_stage: 'interviewing' }, none), none),
    { stage: 'interviewing' });
  assert.deepEqual(Object.keys(MISSION_COLUMN_KEY), [...stage.GENERAL_STAGES]);
});

// ------------------------------------------------------------- /pipeline
test('0c : atsColumnOf suit la table de la section 6.5', () => {
  assert.equal(atsColumnOf({ general_stage: 'to_sort', pipeline_stage: 'Contacté' }), 'Nouveau');
  assert.equal(atsColumnOf({ general_stage: 'retained', pipeline_stage: null }), 'Pressenti');
  assert.equal(atsColumnOf({ general_stage: 'contacted', pipeline_stage: 'messaged' }), 'Contacté');
  assert.equal(atsColumnOf({ general_stage: 'replied' }), 'Répondu');
  assert.equal(atsColumnOf({ general_stage: 'hired', pipeline_stage: 'hired' }), 'Gagné');
  assert.equal(atsColumnOf({ general_stage: 'rejected', pipeline_stage: 'Offre' }), 'Perdu');
  for (const col of ['Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre']) {
    assert.equal(atsColumnOf({ general_stage: 'interviewing', pipeline_stage: col }), col, col);
  }
  // En entretien sur une étape de mission (identifiant) ou sans libellé : ITW en cours.
  assert.equal(atsColumnOf({ general_stage: 'interviewing', pipeline_stage: STEP_A }), 'ITW en cours');
  assert.equal(atsColumnOf({ general_stage: 'interviewing', pipeline_stage: null }), 'ITW en cours');
  assert.equal(atsColumnOf({ general_stage: null, pipeline_stage: 'Offre' }), 'Nouveau');
});

test('0c : colonnes et titres du /pipeline, clés de ATS_STAGES inchangées', () => {
  const src = read('src/hooks/useATSData.ts');
  const block = src.match(/export const ATS_STAGES = \[([\s\S]*?)\];/);
  assert.ok(block, 'ATS_STAGES introuvable');
  const keys = [...block[1].matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  for (const col of [...Object.values(ATS_COLUMN_BY_STAGE), ...ATS_INTERVIEW_COLUMNS]) {
    assert.ok(keys.includes(col), `${col} absente de ATS_STAGES`);
    // L'aller et retour : la colonne rendue vise la même étape générale.
    assert.ok(stage.ATS_LABEL_TO_STAGE[col], col);
  }
  for (const g of stage.GENERAL_STAGES) {
    assert.equal(stage.ATS_LABEL_TO_STAGE[ATS_COLUMN_BY_STAGE[g]].stage, g, g);
  }
  assert.deepEqual(keys.map(atsColumnTitle),
    ['À trier', 'Contacté', 'A répondu', 'Retenu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Embauché', 'Écarté']);
  // Titre d'une colonne de mission égal au nom de l'étape (décision 3).
  for (const g of ['to_sort', 'retained', 'contacted', 'replied', 'hired', 'rejected']) {
    assert.equal(atsColumnTitle(ATS_COLUMN_BY_STAGE[g]), GENERAL_STAGE_LABEL[g], g);
  }
});

test('0c : clés du /pipeline par étape générale (ATS_COLUMN_BY_STAGE)', () => {
  assert.deepEqual({ ...ATS_COLUMN_BY_STAGE }, {
    to_sort: 'Nouveau', retained: 'Pressenti', contacted: 'Contacté', replied: 'Répondu',
    interviewing: 'ITW en cours', hired: 'Gagné', rejected: 'Perdu',
  });
});

// ------------------------------------------------------------- ancienneté
test('0c : stageAgeDays compte depuis l\'entrée dans l\'étape', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(stageAgeDays({ stage_entered_at: '2026-09-19T11:00:00.123456+00:00', updated_at: '2026-09-29T11:00:00Z' }, now), 10);
  assert.equal(stageAgeDays({ stage_entered_at: null, updated_at: '2026-09-26T13:00:00Z', created_at: '2026-01-01T00:00:00Z' }, now), 2);
  assert.equal(stageAgeDays({ stage_entered_at: 'pas une date', created_at: '2026-09-22T12:00:00Z' }, new Date(now)), 7);
  assert.equal(stageAgeDays({ stage_entered_at: '2026-09-30T12:00:00Z' }, now), 0, 'jamais négatif');
  assert.equal(stageAgeDays({}, now), null);
});

test('0c : isStale, étapes engagées seulement, à partir de 7 jours', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const at = (d) => new Date(now - d * 86_400_000).toISOString();
  assert.equal(STALE_AFTER_DAYS, 7);
  for (const g of ['contacted', 'replied', 'interviewing']) {
    assert.equal(isStale({ general_stage: g, stage_entered_at: at(7) }, now), true, g);
    assert.equal(isStale({ general_stage: g, stage_entered_at: at(6) }, now), false, g);
  }
  for (const g of ['to_sort', 'retained', 'hired', 'rejected']) {
    assert.equal(isStale({ general_stage: g, stage_entered_at: at(90) }, now), false, g);
  }
  // updated_at récent (note, enrichissement) : l'étape, elle, n'a pas bougé.
  assert.equal(isStale({ general_stage: 'contacted', stage_entered_at: at(12), updated_at: at(0) }, now), true);
  assert.equal(isStale({ general_stage: 'messaged', stage_entered_at: at(30) }, now), false);
  assert.equal(isStale({ general_stage: 'contacted' }, now), false, 'sans date');
});

test('0c : missionActivityAt rend la plus récente des deux dates, chaîne d\'origine', () => {
  const u = '2026-09-20T10:00:00+00:00';
  const m = '2026-09-28T09:15:01.654321+00:00';
  assert.equal(missionActivityAt(u, m), m);
  assert.equal(missionActivityAt(m, u), m);
  assert.equal(missionActivityAt(u, null), u);
  assert.equal(missionActivityAt(null, m), m);
  assert.equal(missionActivityAt(undefined, undefined), null);
  assert.equal(missionActivityAt('invalide', u), u);
});

// --------------------------------------------------------- rafraîchissement
test('0c : invalidateStageReaders invalide chaque lecture d\'étape', async () => {
  const seen = [];
  await invalidateStageReaders({ invalidateQueries: async (f) => { seen.push(f.queryKey); } });
  assert.deepEqual(seen, STAGE_READER_KEYS.map((k) => [...k]));
  for (const k of ['mission-stage-counts', 'project-candidates', 'ats-candidates', 'sourcing-projects']) {
    assert.ok(seen.some((q) => q.length === 1 && q[0] === k), k);
  }
  // La clé du /pipeline est bien celle de useATSData.
  assert.match(read('src/hooks/useATSData.ts'), /queryKey: \['ats-candidates'\]/);
  assert.match(read('src/hooks/useSourcingProjects.ts'), /queryKey: \['project-candidates', projectId\]/);
});

// ------------------------------------------------------ compteurs de mission
test('0c : parseMissionStageCounts, aucune mission ni zéro inventé', () => {
  const { parseMissionStageCounts } = counts;
  assert.deepEqual(parseMissionStageCounts(null), {});
  assert.deepEqual(parseMissionStageCounts([]), {});
  const out = parseMissionStageCounts([
    {
      project_id: 'p1', unopened: 12, to_sort: 3, retained: 2, contacted: 4, replied: 1, interviewing: 2,
      hired: 0, rejected: 5, interviewing_by_step: { [STEP_A]: 1, none: 1 }, scored: 9,
      ever_retained: 8, ever_contacted: 7, ever_replied: 3, ever_interviewed: 2, ever_presented: 1, ever_hired: 0,
      triaged_by_user: 6, last_stage_move_at: '2026-09-28T09:15:01.654321+00:00',
    },
    { project_id: 'p2', interviewing_by_step: {}, last_stage_move_at: null },
    { project_id: '' },
    null,
  ]);
  assert.deepEqual(Object.keys(out), ['p1', 'p2'], 'une mission non rendue reste absente');
  assert.deepEqual(out.p1, {
    projectId: 'p1', unopened: 12, toSort: 3, retained: 2, contacted: 4, replied: 1, interviewing: 2,
    hired: 0, rejected: 5, interviewingByStep: { [STEP_A]: 1, none: 1 }, scored: 9,
    everRetained: 8, everContacted: 7, everReplied: 3, everInterviewed: 2, everPresented: 1, everHired: 0,
    triagedByUser: 6, lastStageMoveAt: '2026-09-28T09:15:01.654321+00:00',
  });
  assert.equal(out.p2.lastStageMoveAt, null);
  assert.deepEqual(out.p2.interviewingByStep, {});
});

test('0c : useMissionStageCounts, clé stable, 30 s, retour sur l\'onglet, erreur levée', async () => {
  const { useMissionStageCounts, missionStageCountIds, MISSION_STAGE_COUNTS_STALE_TIME } = counts;
  assert.deepEqual(missionStageCountIds(['b', 'a', '', null, undefined, 'b']), ['a', 'b']);
  const opts = useMissionStageCounts(['b', 'a', 'b']);
  assert.deepEqual(opts.queryKey, ['mission-stage-counts', ['a', 'b']]);
  assert.equal(opts.enabled, true);
  assert.equal(opts.staleTime, 30_000);
  assert.equal(MISSION_STAGE_COUNTS_STALE_TIME, 30_000);
  assert.equal(opts.refetchOnWindowFocus, true);
  assert.equal(useMissionStageCounts([]).enabled, false);

  const calls = [];
  globalThis.__rpc = async (fn, args) => {
    calls.push({ fn, args });
    return { data: [{ project_id: 'a', to_sort: 1 }], error: null };
  };
  const data = await opts.queryFn();
  assert.deepEqual(calls, [{ fn: 'get_mission_stage_counts', args: { p_project_ids: ['a', 'b'] } }]);
  assert.deepEqual(Object.keys(data), ['a'], 'b non rendue : absente, pas à zéro');

  globalThis.__rpc = async () => ({ data: null, error: { message: 'permission denied', code: '42501' } });
  await assert.rejects(opts.queryFn(), (e) => e.message === 'permission denied', 'une erreur donne l\'état d\'erreur');
});

// ------------------------------------------------------------ candidateStage
test('0c : setCandidateStages garde la date d\'entrée en chaîne, par ligne', async () => {
  // candidateStage.ts lit le même faux client.
  globalThis.__rpc = async (fn, args) => ({
    data: args.p_ids.map((id, k) => (k === 0
      ? { id, changed: true, result: 'updated', general_stage: 'retained', stage_entered_at: '2026-09-29T11:28:27.100001+00:00' }
      : { id, changed: false, result: 'skipped', general_stage: 'replied' })),
    error: null,
  });
  const out = await stage.setCandidateStages(['r1', 'r2'], { stage: 'retained' });
  assert.equal(out.rows[0].stageEnteredAt, '2026-09-29T11:28:27.100001+00:00');
  assert.equal(out.rows[1].stageEnteredAt, null);
  assert.doesNotMatch(code('src/lib/candidateStage.ts'), /new Date\(/, 'date jamais repassée par Date');
});
