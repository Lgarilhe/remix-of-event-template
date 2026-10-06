/**
 * Refonte mission, lot 2 : écran Pipeline de la nouvelle page mission.
 * - ordre figé pour la session et étapes connues après un geste
 *   (src/components/missions/v3/pipeline/frozenOrder.ts) ;
 * - gestes d'étape (src/hooks/useMissionStageActions.ts) : écriture par
 *   set_candidate_stages sur tout le groupe, annonces après la réponse ;
 * - textes de l'écran (lecture des fichiers).
 *
 * Modules empaquetés par esbuild (alias @/ résolus par tsconfig.app.json),
 * React, React Query, sonner et le client Supabase remplacés par des doublures.
 * Lancer : node --test tests/ux/lot12-pipeline.test.mjs
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

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /^(react|@tanstack\/react-query|sonner)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      const byPath = {
        client: 'export const supabase = { rpc: (name, args) => globalThis.__rpc(name, args) };',
        react: [
          'export const useCallback = (f) => f;',
          'export const useMemo = (f) => f();',
          'export const useRef = (v) => ({ current: v });',
          'export const useState = (v) => [typeof v === "function" ? v() : v, () => {}];',
          'export const useSyncExternalStore = (s, g) => g();',
          'export const createContext = (v) => ({ v });',
          'export const useContext = (c) => c.v;',
        ].join('\n'),
        '@tanstack/react-query': [
          'export const useQueryClient = () => globalThis.__qc;',
          'export const useQuery = (o) => o;',
          'export const useInfiniteQuery = (o) => o;',
        ].join('\n'),
        sonner: [
          'const push = (kind) => (text) => globalThis.__toasts.push([kind, text]);',
          'export const toast = { success: push("success"), error: push("error"), message: push("message") };',
        ].join('\n'),
      };
      return { contents: byPath[args.path], loader: 'js' };
    });
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

const frozen = await load('src/components/missions/v3/pipeline/frozenOrder.ts');
const actionsModule = await load('src/hooks/useMissionStageActions.ts');

const row = (id, extra = {}) => ({
  id,
  groupIds: [id],
  groupSize: 1,
  candidateId: `c-${id}`,
  name: `Candidat ${id}`,
  headline: null,
  linkedinUrl: null,
  stage: 'retained',
  processStepId: null,
  stageEnteredAt: '2026-09-20T10:00:00Z',
  decisionSource: 'user',
  score: 70,
  recommendation: null,
  skipReason: null,
  contactedAt: null,
  repliedAt: null,
  firstInterviewAt: null,
  presentedAt: null,
  hiredAt: null,
  rejectedAt: null,
  rejectedFromStage: null,
  replySummary: null,
  tags: [],
  jobId: null,
  projectId: 'p1',
  createdBy: null,
  createdAt: null,
  updatedAt: null,
  ...extra,
});
const ids = (rows) => rows.map((r) => r.id);
const inProgress = (r) => ['retained', 'contacted', 'replied', 'interviewing', 'hired'].includes(r.stage);

// ------------------------------------------------------------ ordre figé

test('première lecture : ordre de la base, rien à actualiser', () => {
  const store = new Map();
  const out = frozen.arrangeFrozen('p1|en-cours', [row('a'), row('b'), row('c')], inProgress, store, new Map());
  assert.deepEqual(ids(out.rows), ['a', 'b', 'c']);
  assert.equal(out.orderDiffers, false);
  assert.equal(out.outOfFilter.size, 0);
});

test("relecture : les lignes gardent leur place, les nouvelles vont en fin, l'écart est signalé", () => {
  const store = new Map();
  frozen.arrangeFrozen('k', [row('a'), row('b'), row('c')], inProgress, store, new Map());
  const out = frozen.arrangeFrozen('k', [row('b'), row('d'), row('a'), row('c', { stage: 'contacted' })], inProgress, store, new Map());
  assert.deepEqual(ids(out.rows), ['a', 'b', 'c', 'd']);
  assert.equal(out.rows[2].stage, 'contacted', 'contenu relu, place gardée');
  assert.equal(out.orderDiffers, true);
});

test('même ordre relu : pas de lien « Actualiser l’ordre »', () => {
  const store = new Map();
  frozen.arrangeFrozen('k', [row('a'), row('b')], inProgress, store, new Map());
  const out = frozen.arrangeFrozen('k', [row('a'), row('b'), row('c')], inProgress, store, new Map());
  assert.deepEqual(ids(out.rows), ['a', 'b', 'c']);
  assert.equal(out.orderDiffers, false);
});

test('ligne déplacée par un geste et absente de la relecture : gardée à sa place, nouvelle étape, atténuée', () => {
  const store = new Map();
  const known = new Map();
  frozen.arrangeFrozen('k', [row('a', { stage: 'to_sort' }), row('b', { stage: 'to_sort' })], (r) => r.stage === 'to_sort', store, known, 500);
  frozen.rememberStageMoves(
    [{ id: 'a', groupIds: ['a', 'a2'] }],
    { rows: [{ id: 'a2', result: 'updated', generalStage: 'retained', processStepId: null, stageEnteredAt: '2026-09-29T08:00:00Z' }] },
    1000,
    known,
  );
  const out = frozen.arrangeFrozen('k', [row('b', { stage: 'to_sort' })], (r) => r.stage === 'to_sort', store, known, 1500);
  assert.deepEqual(ids(out.rows), ['a', 'b']);
  assert.equal(out.rows[0].stage, 'retained');
  assert.ok(out.outOfFilter.has('a'));
  assert.equal(out.orderDiffers, true);
});

test('ligne absente, geste antérieur à la dernière lecture qui la contenait : retirée (changée ailleurs depuis)', () => {
  const store = new Map();
  const known = new Map();
  frozen.arrangeFrozen('k', [row('a', { stage: 'to_sort' })], (r) => r.stage === 'to_sort', store, known, 500);
  frozen.rememberStageMoves(
    [{ id: 'a', groupIds: ['a'] }],
    { rows: [{ id: 'a', result: 'updated', generalStage: 'retained', processStepId: null, stageEnteredAt: null }] },
    1000,
    known,
  );
  // Relue après le geste (toujours là), puis écartée ailleurs : absente de la lecture suivante.
  frozen.arrangeFrozen('k', [row('a', { stage: 'retained' })], (r) => r.stage === 'to_sort', store, known, 2000);
  const out = frozen.arrangeFrozen('k', [], (r) => r.stage === 'to_sort', store, known, 3000);
  assert.deepEqual(ids(out.rows), []);
});

test('doublon : la nouvelle ligne canonique prend la place de l\'ancienne, jamais une seconde place', () => {
  const store = new Map();
  const known = new Map();
  frozen.arrangeFrozen('k', [row('x', { groupIds: ['x', 'y'] }), row('b')], inProgress, store, known, 500);
  frozen.rememberStageMoves(
    [{ id: 'x', groupIds: ['x', 'y'] }],
    { rows: [
      { id: 'x', result: 'updated', generalStage: 'replied', processStepId: null, stageEnteredAt: null },
      { id: 'y', result: 'updated', generalStage: 'replied', processStepId: null, stageEnteredAt: null },
    ] },
    1000,
    known,
  );
  const out = frozen.arrangeFrozen('k', [row('b'), row('y', { groupIds: ['y', 'x'], stage: 'replied' })], inProgress, store, known, 2000);
  assert.deepEqual(ids(out.rows), ['y', 'b']);
  assert.equal(out.rows[0].stage, 'replied');
});

test('étape connue jugée sur la ligne canonique : un doublon qui avance seul ne change pas l\'étape affichée', () => {
  const known = new Map();
  const n = frozen.rememberStageMoves(
    [{ id: 'x', groupIds: ['x', 'y'] }],
    { rows: [
      { id: 'x', result: 'skipped', generalStage: 'contacted', processStepId: null, stageEnteredAt: null },
      { id: 'y', result: 'updated', generalStage: 'retained', processStepId: null, stageEnteredAt: null },
    ] },
    1000,
    known,
  );
  assert.equal(n, 0);
  assert.equal(known.size, 0);
});

test('ligne absente sans geste connu : retirée', () => {
  const store = new Map();
  frozen.arrangeFrozen('k', [row('a'), row('b')], inProgress, store, new Map());
  const out = frozen.arrangeFrozen('k', [row('b')], inProgress, store, new Map());
  assert.deepEqual(ids(out.rows), ['b']);
  assert.equal(out.orderDiffers, false);
});

test('« Actualiser l’ordre » reprend l’ordre de la base', () => {
  const store = new Map();
  frozen.arrangeFrozen('k', [row('a'), row('b')], inProgress, store, new Map());
  frozen.resetFrozenOrder('k', store);
  const out = frozen.arrangeFrozen('k', [row('b'), row('a')], inProgress, store, new Map());
  assert.deepEqual(ids(out.rows), ['b', 'a']);
  assert.equal(out.orderDiffers, false);
});

test('étapes connues : appliquées seulement aux lectures antérieures au geste', () => {
  const known = new Map([['a', { stage: 'rejected', processStepId: null, stageEnteredAt: null, at: 2000 }]]);
  assert.equal(frozen.applyKnownStages([row('a')], 1000, known)[0].stage, 'rejected');
  assert.equal(frozen.applyKnownStages([row('a')], 3000, known)[0].stage, 'retained');
});

test('étape connue : rien retenu sans ligne changée', () => {
  const known = new Map();
  const n = frozen.rememberStageMoves([{ id: 'a', groupIds: ['a'] }], { rows: [{ id: 'a', result: 'unchanged', generalStage: 'retained' }] }, 1, known);
  assert.equal(n, 0);
  assert.equal(known.size, 0);
});

// ------------------------------------------------------------ gestes

const setup = (rpcResult) => {
  const calls = [];
  const invalidated = [];
  globalThis.__toasts = [];
  globalThis.__qc = { invalidateQueries: (o) => (invalidated.push(o.queryKey), Promise.resolve()) };
  globalThis.__rpc = (name, args) => {
    calls.push([name, args]);
    return Promise.resolve(typeof rpcResult === 'function' ? rpcResult(args) : rpcResult);
  };
  return { calls, invalidated };
};

test('Retenir : tout le groupe écrit en origine user, annonce accordée après la réponse', async () => {
  const { calls, invalidated } = setup((args) => ({
    data: args.p_ids.map((id) => ({ id, result: 'updated', changed: true, general_stage: 'retained' })),
    error: null,
  }));
  const { move } = actionsModule.useMissionStageActions('p1');
  const rows = [
    { id: 'a', groupIds: ['a', 'a2'] },
    { id: 'b', groupIds: ['b'] },
  ];
  const summary = await move({ rows, target: { stage: 'retained' }, fromStages: ['to_sort', 'rejected'], verb: 'retenu' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'set_candidate_stages');
  assert.deepEqual(calls[0][1].p_ids, ['a', 'a2', 'b']);
  assert.equal(calls[0][1].p_source, 'user');
  assert.deepEqual(calls[0][1].p_from_stages, ['to_sort', 'rejected']);
  assert.equal(summary.changed, 2);
  assert.deepEqual(globalThis.__toasts, [['success', '2 candidats retenus.']]);
  assert.ok(invalidated.some((k) => k[0] === 'project-candidates'));
  assert.ok(invalidated.some((k) => k[0] === 'mission-stage-counts'));
});

test('échec d’appel : aucun succès annoncé, message de réessai, rien d’invalidé', async () => {
  const { invalidated } = setup({ data: null, error: { message: 'boom', hint: null, code: '500' } });
  const { move } = actionsModule.useMissionStageActions('p1');
  const summary = await move({ rows: [{ id: 'a', groupIds: ['a'] }], target: { stage: 'rejected' }, verb: 'écarté' });
  assert.equal(summary.callFailed, true);
  assert.deepEqual(globalThis.__toasts, [['error', "Le changement d'étape n'a pas été enregistré. Réessayez."]]);
  assert.equal(invalidated.length, 0);
});

test('laissés à leur étape et refus par ligne : annoncés, sans succès inventé', async () => {
  setup({
    data: [
      { id: 'a', result: 'skipped' },
      { id: 'b', result: 'error', hint: 'STAGE_STEP_REQUIRED' },
    ],
    error: null,
  });
  const { move } = actionsModule.useMissionStageActions('p1');
  await move({
    rows: [
      { id: 'a', groupIds: ['a'] },
      { id: 'b', groupIds: ['b'] },
    ],
    target: { stage: 'interviewing' },
    verb: 'déplacé',
  });
  assert.deepEqual(globalThis.__toasts, [
    ['message', '1 candidat déjà plus loin, laissé à son étape.'],
    ['error', "Choisissez l'étape d'entretien de cette mission."],
  ]);
});

test('textes des gestes accordés', () => {
  assert.equal(actionsModule.stageMoveSuccessText(1, 'écarté'), '1 candidat écarté.');
  assert.equal(actionsModule.stageMoveSuccessText(3, 'déplacé'), '3 candidats déplacés.');
  assert.equal(actionsModule.stageUnchangedText(2), '2 candidats déjà à cette étape.');
});

test('aucune ligne : aucun appel', async () => {
  const { calls } = setup({ data: [], error: null });
  const { move } = actionsModule.useMissionStageActions('p1');
  await move({ rows: [], target: { stage: 'retained' }, verb: 'retenu' });
  assert.equal(calls.length, 0);
  assert.deepEqual(globalThis.__toasts, []);
});

// ------------------------------------------------------------ textes et règles

const PIPELINE_FILES = [
  'src/components/missions/v3/pipeline/PipelineScreen.tsx',
  'src/components/missions/v3/pipeline/StageBar.tsx',
  'src/components/missions/v3/pipeline/PipelineToolbar.tsx',
  'src/components/missions/v3/pipeline/CandidateList.tsx',
  'src/components/missions/v3/pipeline/CandidateListRow.tsx',
  'src/components/missions/v3/pipeline/ToSortSection.tsx',
  'src/components/missions/v3/pipeline/BulkActionBar.tsx',
  'src/components/missions/v3/pipeline/RejectConfirmDialog.tsx',
  'src/components/missions/v3/pipeline/ContactSelectionButton.tsx',
  'src/components/missions/v3/pipeline/MissionBoard.tsx',
  'src/components/missions/v3/pipeline/BilanCard.tsx',
  'src/components/missions/v3/pipeline/PipelineEmptyStates.tsx',
  'src/components/missions/v3/pipeline/frozenOrder.ts',
  // Lot 3 : carte « Maintenant », ligne « Ensuite » et leurs lectures.
  'src/components/missions/v3/pipeline/NowCard.tsx',
  'src/components/missions/v3/pipeline/ThenLine.tsx',
  'src/hooks/useMissionNow.ts',
  'src/hooks/useMissionAttention.ts',
  'src/hooks/useMissionActionSnoozes.ts',
  'src/hooks/useMissionCandidateRows.ts',
  'src/hooks/useMissionStageActions.ts',
];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('textes du contrat présents', () => {
  const all = PIPELINE_FILES.map(read).join('\n');
  for (const text of [
    'Maintenant',
    'Ensuite</p>',
    'data-testid="now-card"',
    'data-testid="then-line"',
    'En ce moment',
    'Sourcing et contact',
    'Suivi',
    'Écartés',
    "Effectifs indisponibles pour l'instant.",
    'Actions sur la sélection',
    'Retenir',
    'Déplacer vers',
    'Tout désélectionner',
    'Ils restent visibles dans Écartés, et vous pourrez les remettre à une autre étape.',
    'Reliez votre compte LinkedIn pour contacter.',
    "Afficher {PIPELINE_PAGE_SIZE} de plus",
    "Actualiser l'ordre",
    'Bilan indisponible pour l\'instant.',
    'Poste décrit',
    'Première recherche',
    "Séquence d'approche, facultatif",
    "Aucun candidat retenu pour l'instant.",
    'Aucun candidat à cette étape.',
    'Voir tous les candidats en cours',
    'Impossible de charger les candidats.',
    'Affichage limité aux 2 000 premiers candidats. Utilisez la liste.',
    'data-testid="stage-bar"',
    'data-testid="unopened-link"',
    'data-testid="bilan"',
    'data-testid="candidate-row"',
  ]) {
    assert.ok(all.includes(text), `texte absent : ${text}`);
  }
});

test('règles : aucune écriture directe, ni confirm, ni mesure, ni tiret long, ni « (s) », ni prestataire', () => {
  for (const rel of PIPELINE_FILES) {
    const code = stripComments(read(rel));
    assert.doesNotMatch(code, /from\(['"]job_candidate_status['"]\)/, `${rel} : job_candidate_status lu ou écrit en direct`);
    assert.doesNotMatch(code, /pipeline_stage/, `${rel} : pipeline_stage`);
    assert.doesNotMatch(code, /rpc\(['"]set_candidate_stage/, `${rel} : appel direct de set_candidate_stage`);
    assert.doesNotMatch(code, /window\.confirm|trackEvent|localStorage/, rel);
    assert.doesNotMatch(code, /\u2014/, `${rel} : tiret long`);
    assert.doesNotMatch(code, /[a-zà-ÿ]\(s\)/i, `${rel} : « (s) »`);
    assert.doesNotMatch(code, /Unipile|Apollo|People Data Labs|\bPDL\b|Anthropic|Claude/, `${rel} : nom de prestataire`);
  }
});

test('listes sur mission_candidate_rows, jamais ouverts exclus', () => {
  const src = read('src/hooks/useMissionCandidateRows.ts');
  assert.match(src, /\.from\('mission_candidate_rows'\)/);
  assert.match(src, /\.eq\('is_unopened', false\)/);
  assert.match(src, /\['project-candidates', projectId, 'v3-rows'/);
  assert.match(src, /\['project-candidates', projectId, 'v3-board'\]/);
});

test('visages : liste, kanban et fiche passent la photo enregistrée à PersonAvatar', () => {
  for (const rel of [
    'src/components/missions/v3/pipeline/CandidateListRow.tsx',
    'src/components/missions/v3/pipeline/MissionBoard.tsx',
    'src/components/missions/v3/panels/CandidatePanelHeader.tsx',
  ]) {
    const src = stripComments(read(rel));
    assert.match(src, /<PersonAvatar [^>]*src=\{(row\.)?pictureUrl\}/, `${rel} : la photo n'est pas passée à PersonAvatar`);
  }
});

test('gestes : setCandidateStages sur rowWriteIds, puis invalidateStageReaders', () => {
  const src = stripComments(read('src/hooks/useMissionStageActions.ts'));
  assert.match(src, /setCandidateStages\(ids, request\.target, request\.fromStages\)/);
  assert.match(src, /rowWriteIds\(request\.rows\)/);
  assert.ok(src.indexOf('setCandidateStages(') < src.indexOf('toast.success('), 'annonce après l’écriture');
  assert.match(src, /invalidateStageReaders\(queryClient\)/);
});
