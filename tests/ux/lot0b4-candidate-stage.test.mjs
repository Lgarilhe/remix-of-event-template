/**
 * Refonte mission, lot 0b-4 : src/lib/candidateStage.ts, seule porte du
 * navigateur vers l'étape d'un candidat (origine user).
 *
 * - fonctions pures (ATS_LABEL_TO_STAGE, missionColumnToStage,
 *   stageErrorMessage, skippedStageMessage) : module empaqueté par esbuild
 *   (alias @/ résolus par tsconfig.app.json), le client Supabase remplacé par
 *   un faux client dont rpc est scripté par le test ;
 * - tables recoupées avec leurs sources : libellés du /pipeline (ATS_STAGES) et
 *   de l'assistant (ALLOWED_STAGES), liste blanche des libellés hérités de
 *   set_candidate_stage (migration 0a), clés de colonnes du kanban de mission ;
 * - setCandidateStage(s) : paramètres envoyés, lecture des refus, découpage par
 *   200 et cumul des résultats par ligne ;
 * - lot 0c : mesure du geste (option surface, événement « Stage Change » sans
 *   donnée personnelle) et annulation (readStageSnapshots, buildUndoMoves,
 *   undoCandidateStages, undoSummaryMessage), contrat de undo_candidate_stages.
 *
 * Lancer : node --test tests/ux/lot0b4-candidate-stage.test.mjs (ou npm run test:ux)
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

// Faux client : chaque appel rpc est confié à globalThis.__stageRpc, chaque
// lecture from(table).select(colonnes).in(colonne, valeurs) à globalThis.__stageFrom.
// Fausse mesure : trackEvent range ses appels dans globalThis.__events
// (analytics.ts lit import.meta.env au chargement, indéfini hors de Vite).
const stubClient = {
  name: 'stub-supabase-client',
  setup(build) {
    build.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub-client' }));
    build.onResolve({ filter: /lib\/analytics$/ }, () => ({ path: 'analytics', namespace: 'stub-analytics' }));
    build.onLoad({ filter: /.*/, namespace: 'stub-client' }, () => ({
      contents: [
        'export const supabase = {',
        '  rpc: (fn, args) => globalThis.__stageRpc(fn, args),',
        '  from: (table) => ({ select: (cols) => ({ in: (col, values) => globalThis.__stageFrom(table, cols, col, values) }) }),',
        '};',
      ].join('\n'),
      loader: 'js',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-analytics' }, () => ({
      contents: 'export const trackEvent = (name, props) => { globalThis.__events.push({ name, props }); };',
      loader: 'js',
    }));
  },
};
globalThis.__events = [];
const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubClient],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};
const stage = await load('src/lib/candidateStage.ts');
const display = await load('src/lib/stageDisplay.ts');
const {
  GENERAL_STAGES,
  ATS_LABEL_TO_STAGE,
  LEGACY_LABELS_BY_STAGE,
  STAGE_BATCH_SIZE,
  missionColumnToStage,
  stageErrorMessage,
  skippedStageMessage,
  setCandidateStage,
  setCandidateStages,
  readStageSnapshots,
  buildUndoMoves,
  undoCandidateStages,
  undoSummaryMessage,
} = stage;

/** Scripte rpc et rend le journal des appels. */
const scriptRpc = (handler) => {
  const calls = [];
  globalThis.__stageRpc = async (fn, args) => {
    calls.push({ fn, args });
    return handler(fn, args, calls.length);
  };
  return calls;
};

const MIGRATION_0A = 'supabase/migrations/20260928201409_refonte_mission_lot0a_modele_etapes.sql';

// ------------------------------------------------------------- libellés
test('0b-4 : ATS_LABEL_TO_STAGE couvre exactement les libellés de l\'assistant (ALLOWED_STAGES)', () => {
  const src = read('supabase/functions/_shared/agent-tools-mutations.ts');
  const block = src.match(/const ALLOWED_STAGES = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'ALLOWED_STAGES introuvable');
  const assistant = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(ATS_LABEL_TO_STAGE).sort(), [...assistant].sort());
});

test('0b-4 : ATS_LABEL_TO_STAGE couvre exactement les colonnes du /pipeline (ATS_STAGES)', () => {
  const src = read('src/hooks/useATSData.ts');
  const block = src.match(/export const ATS_STAGES = \[([\s\S]*?)\];/);
  assert.ok(block, 'ATS_STAGES introuvable');
  const keys = [...block[1].matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(ATS_LABEL_TO_STAGE).sort(), [...keys].sort());
});

test('0b-4 : cibles des libellés (décision 20 : libellé hérité seulement quand l\'étape ne suffit pas)', () => {
  assert.deepEqual(ATS_LABEL_TO_STAGE['Nouveau'], { stage: 'to_sort' });
  assert.deepEqual(ATS_LABEL_TO_STAGE['Contacté'], { stage: 'contacted' });
  assert.deepEqual(ATS_LABEL_TO_STAGE['Répondu'], { stage: 'replied' });
  assert.deepEqual(ATS_LABEL_TO_STAGE['Pressenti'], { stage: 'retained' });
  for (const l of ['Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre']) {
    assert.deepEqual(ATS_LABEL_TO_STAGE[l], { stage: 'interviewing', legacyStage: l }, l);
  }
  assert.deepEqual(ATS_LABEL_TO_STAGE['Gagné'], { stage: 'hired', legacyStage: 'Gagné' });
  assert.deepEqual(ATS_LABEL_TO_STAGE['Perdu'], { stage: 'rejected' });
});

test('0b-4 : LEGACY_LABELS_BY_STAGE est la liste blanche v_allowed de set_candidate_stage', () => {
  const sql = read(MIGRATION_0A);
  const block = sql.match(/v_allowed := CASE p_stage([\s\S]*?)END;/);
  assert.ok(block, 'v_allowed introuvable dans la migration 0a');
  const server = {};
  for (const m of block[1].matchAll(/WHEN '([a-z_]+)'\s+THEN ARRAY\[([^\]]*)\]/g)) {
    server[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  const elseMatch = block[1].match(/ELSE\s+ARRAY\[([^\]]*)\]/);
  server.rejected = [...elseMatch[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(Object.keys(server).sort(), [...GENERAL_STAGES].sort());
  for (const s of GENERAL_STAGES) {
    assert.deepEqual([...LEGACY_LABELS_BY_STAGE[s]].sort(), [...server[s]].sort(), s);
  }
  // Tout libellé hérité envoyé par la table du /pipeline est admis pour son étape.
  for (const [label, t] of Object.entries(ATS_LABEL_TO_STAGE)) {
    if (t.legacyStage) assert.ok(server[t.stage].includes(t.legacyStage), label);
  }
});

// ------------------------------------------------------ kanban de mission
// Lot 0c (plan, section 6.3) : les colonnes du kanban ne sont plus écrites en
// dur dans MissionPipeline.tsx, elles viennent de MISSION_COLUMN_KEY
// (src/lib/stageDisplay.ts), dont missionColumnToStage est le chemin inverse.
test('0b-4 : missionColumnToStage accepte chaque clé de colonne du kanban de mission (MISSION_COLUMN_KEY)', () => {
  const keys = Object.values(display.MISSION_COLUMN_KEY);
  assert.deepEqual([...keys].sort(), ['dismissed', 'hired', 'interviewing', 'messaged', 'shortlisted', 'untreated', 'Répondu'].sort());
  const none = new Set();
  for (const k of keys) assert.doesNotThrow(() => missionColumnToStage(k, none), k);
  const src = code('src/components/missions/MissionPipeline.tsx');
  assert.match(src, /MISSION_COLUMN_KEY/, 'MissionPipeline.tsx lit les clés de stageDisplay.ts');
  assert.doesNotMatch(src, /\{ key: '(sourced|untreated|messaged|shortlisted|hired|dismissed)', label:/, 'aucune clé de colonne écrite en dur');
});

test('0b-4 : missionColumnToStage, colonnes fixes et étapes d\'entretien', () => {
  const step = '4a1b2c3d-0000-4000-8000-000000000001';
  const steps = new Set([step]);
  assert.deepEqual(missionColumnToStage('sourced', steps), { stage: 'to_sort' });
  assert.deepEqual(missionColumnToStage('untreated', steps), { stage: 'to_sort' });
  assert.deepEqual(missionColumnToStage('messaged', steps), { stage: 'contacted' });
  assert.deepEqual(missionColumnToStage('Répondu', steps), { stage: 'replied' });
  assert.deepEqual(missionColumnToStage('shortlisted', steps), { stage: 'retained' });
  assert.deepEqual(missionColumnToStage('hired', steps), { stage: 'hired' });
  assert.deepEqual(missionColumnToStage('dismissed', steps), { stage: 'rejected' });
  assert.deepEqual(missionColumnToStage(step, steps), { stage: 'interviewing', processStepId: step });
  // Aucune cible ne porte de libellé hérité : le kanban n'en a pas.
  for (const k of ['sourced', 'messaged', 'Répondu', 'shortlisted', 'hired', 'dismissed', step]) {
    assert.equal(missionColumnToStage(k, steps).legacyStage, undefined, k);
  }
  assert.throws(() => missionColumnToStage('qualification', steps), /Colonne inconnue/);
  assert.throws(() => missionColumnToStage(step, new Set()), /Colonne inconnue/);
});

// --------------------------------------------------------------- messages
test('0b-4 : stageErrorMessage, un message par indice, repli générique', () => {
  assert.equal(stageErrorMessage('STAGE_STEP_REQUIRED'), "Choisissez l'étape d'entretien de cette mission.");
  assert.equal(stageErrorMessage('STAGE_STEP_NOT_IN_MISSION'), "Cette étape n'appartient pas à la mission du candidat. Rechargez la page.");
  assert.equal(stageErrorMessage('STAGE_ROW_NOT_FOUND'), "Ce candidat n'est plus dans cette mission, ou vous n'y avez pas accès. Rechargez la page.");
  assert.equal(stageErrorMessage('STAGE_DIRECT_WRITE'), "Ce changement d'étape a été refusé. Rechargez la page, puis réessayez.");
  for (const h of [undefined, null, '', 'STAGE_LEGACY_MISMATCH', 'STAGE_SOURCE_FORBIDDEN']) {
    assert.equal(stageErrorMessage(h), "Le changement d'étape n'a pas été enregistré. Réessayez.", String(h));
  }
});

test('0b-4 : skippedStageMessage accorde le nombre, sans « (s) » ni tiret long', () => {
  assert.equal(skippedStageMessage(0), null);
  assert.equal(skippedStageMessage(1), '1 candidat déjà plus loin, laissé à son étape.');
  assert.equal(skippedStageMessage(3), '3 candidats déjà plus loin, laissés à leur étape.');
  assert.equal(skippedStageMessage(1200), `${(1200).toLocaleString('fr-FR')} candidats déjà plus loin, laissés à leur étape.`);
});

test('0b-4 : textes du module en français, sans tiret long ni nom de prestataire', () => {
  const src = code('src/lib/candidateStage.ts');
  const strings = [...src.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]);
  for (const s of strings) {
    assert.doesNotMatch(s, /—/, s);
    assert.doesNotMatch(s, /unipile|apollo|\bpdl\b|anthropic|claude|resend|notion/i, s);
  }
});

// ------------------------------------------------- origine user seulement
test('0b-4 : le module n\'envoie que l\'origine user', () => {
  const src = code('src/lib/candidateStage.ts');
  assert.match(src, /p_source: 'user'/);
  assert.doesNotMatch(src, /'system'|"system"|'ai'|"ai"/);
  assert.doesNotMatch(src, /p_organization_id/, 'la RLS fixe l\'organisation');
  // Lot 0c : une seule lecture directe (état d'avant d'une annulation), jamais d'écriture.
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, 'aucune écriture directe');
  assert.equal([...src.matchAll(/\.from\(/g)].length, 1, 'une seule lecture directe');
  assert.equal([...src.matchAll(/\.from\('job_candidate_status'\)\s*\.select\(/g)].length, 1, 'lecture de job_candidate_status');
});

// ------------------------------------------------------ setCandidateStage
test('0b-4 : setCandidateStage envoie la cible et lit la réponse', async () => {
  const step = '4a1b2c3d-0000-4000-8000-000000000003';
  const calls = scriptRpc(() => ({
    data: { id: 'r1', changed: true, result: 'updated', general_stage: 'interviewing', process_step_id: step,
            stage_entered_at: '2026-09-29T11:28:27.123456+00:00' },
    error: null,
  }));
  const out = await setCandidateStage('r1', { stage: 'interviewing', processStepId: step });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'set_candidate_stage');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)),
    { p_id: 'r1', p_stage: 'interviewing', p_source: 'user', p_process_step_id: step });
  // Lot 0c : date d'entrée gardée en chaîne, à la microseconde (annulation).
  assert.deepEqual(out, { ok: true, id: 'r1', changed: true, result: 'updated', generalStage: 'interviewing', processStepId: step,
    stageEnteredAt: '2026-09-29T11:28:27.123456+00:00' });

  const calls2 = scriptRpc(() => ({ data: { id: 'r2', changed: false, result: 'unchanged', general_stage: 'hired' }, error: null }));
  await setCandidateStage('r2', ATS_LABEL_TO_STAGE['Gagné']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls2[0].args)),
    { p_id: 'r2', p_stage: 'hired', p_source: 'user', p_legacy_stage: 'Gagné' });
});

test('0b-4 : setCandidateStage rend l\'indice et le code d\'un refus, sans lever', async () => {
  scriptRpc(() => ({ data: null, error: { message: "Choisissez l'étape d'entretien", code: '22023', hint: 'STAGE_STEP_REQUIRED', details: null } }));
  const refused = await setCandidateStage('r1', { stage: 'interviewing' });
  assert.deepEqual(refused, { ok: false, hint: 'STAGE_STEP_REQUIRED', code: '22023', message: "Choisissez l'étape d'entretien" });
  assert.equal(stageErrorMessage(refused.hint), "Choisissez l'étape d'entretien de cette mission.");

  globalThis.__stageRpc = async () => { throw new Error('Failed to fetch'); };
  const thrown = await setCandidateStage('r1', { stage: 'retained' });
  assert.deepEqual(thrown, { ok: false, hint: null, code: null, message: 'Failed to fetch' });
});

// ----------------------------------------------------- setCandidateStages
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('0b-4 : setCandidateStages découpe par 200, retire doublons et vides, cumule par ligne', async () => {
  assert.equal(STAGE_BATCH_SIZE, 200);
  const ids = Array.from({ length: 450 }, (_, i) => uuid(i));
  const calls = scriptRpc((fn, args) => ({
    data: args.p_ids.map((id, k) => {
      if (k % 50 === 0) return { id, changed: false, result: 'skipped', general_stage: 'replied' };
      if (k % 50 === 1) return { id, changed: false, result: 'error', code: 'P0002', hint: 'STAGE_ROW_NOT_FOUND', message: 'Ligne candidat introuvable' };
      if (k % 50 === 2) return { id, changed: false, result: 'unchanged', general_stage: 'retained' };
      return { id, changed: true, result: 'updated', general_stage: 'retained', process_step_id: null };
    }),
    error: null,
  }));
  const out = await setCandidateStages([...ids, ids[3], '', ids[10]], { stage: 'retained' }, ['to_sort', 'retained', 'rejected']);
  assert.deepEqual(calls.map((c) => c.args.p_ids.length), [200, 200, 50]);
  for (const c of calls) {
    assert.equal(c.fn, 'set_candidate_stages');
    assert.equal(c.args.p_source, 'user');
    assert.equal(c.args.p_stage, 'retained');
    assert.deepEqual(c.args.p_from_stages, ['to_sort', 'retained', 'rejected']);
    assert.equal(c.args.p_organization_id, undefined);
  }
  assert.deepEqual(calls.flatMap((c) => c.args.p_ids), ids);
  assert.equal(out.rows.length, 450);
  assert.equal(out.skipped, 9);
  assert.equal(out.refused, 9);
  assert.equal(out.unchanged, 9);
  assert.equal(out.updated, 450 - 27);
  assert.equal(out.kept, 0);
  assert.equal(out.notContacted, 0);
  assert.equal(out.error, null);
  assert.deepEqual(out.untreatedIds, []);
  const refusedRow = out.rows.find((r) => r.result === 'error');
  assert.equal(refusedRow.hint, 'STAGE_ROW_NOT_FOUND');
  assert.equal(refusedRow.code, 'P0002');
  assert.equal(skippedStageMessage(out.skipped), '9 candidats déjà plus loin, laissés à leur étape.');
});

test('0b-4 : setCandidateStages sans étapes de départ n\'envoie pas p_from_stages ; liste vide sans appel', async () => {
  const calls = scriptRpc((fn, args) => ({ data: args.p_ids.map((id) => ({ id, changed: true, result: 'updated', general_stage: 'rejected' })), error: null }));
  const out = await setCandidateStages([uuid(1), uuid(2)], { stage: 'rejected' });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)),
    { p_ids: [uuid(1), uuid(2)], p_stage: 'rejected', p_source: 'user' });
  assert.equal(out.updated, 2);

  const none = scriptRpc(() => { throw new Error('ne doit pas être appelé'); });
  const empty = await setCandidateStages([], { stage: 'rejected' });
  assert.equal(none.length, 0);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.error, null);
});

test('0b-4 : setCandidateStages, un appel en échec arrête les lots suivants et les annonce', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => uuid(i));
  const calls = scriptRpc((fn, args, n) => (n === 2
    ? { data: null, error: { message: 'canceling statement due to lock timeout', code: '55P03', hint: null } }
    : { data: args.p_ids.map((id) => ({ id, changed: true, result: 'updated', general_stage: 'to_sort' })), error: null }));
  const out = await setCandidateStages(ids, { stage: 'to_sort' });
  assert.equal(calls.length, 2);
  assert.equal(out.updated, 200);
  assert.deepEqual(out.error, { hint: null, code: '55P03', message: 'canceling statement due to lock timeout' });
  assert.deepEqual(out.untreatedIds, ids.slice(200));
  assert.equal(stageErrorMessage(out.error.hint), "Le changement d'étape n'a pas été enregistré. Réessayez.");
});

// ------------------------------------------------ lot 0c : mesure du geste
const takeEvents = () => globalThis.__events.splice(0);

test('0c : sans surface, aucun événement (les appelants actuels ne changent pas)', async () => {
  takeEvents();
  scriptRpc(() => ({ data: { id: 'r1', changed: true, result: 'updated', general_stage: 'retained' }, error: null }));
  await setCandidateStage('r1', { stage: 'retained' });
  scriptRpc((fn, args) => ({ data: args.p_ids.map((id) => ({ id, changed: true, result: 'updated', general_stage: 'retained' })), error: null }));
  await setCandidateStages([uuid(1), uuid(2)], { stage: 'retained' });
  await setCandidateStages([uuid(1)], { stage: 'retained' }, ['to_sort'], {});
  assert.deepEqual(takeEvents(), []);
});

test('0c : setCandidateStage avec surface émet un seul « Stage Change » (surface, to, count, result)', async () => {
  takeEvents();
  scriptRpc(() => ({ data: { id: 'r1', changed: true, result: 'updated', general_stage: 'contacted' }, error: null }));
  const out = await setCandidateStage('r1', { stage: 'contacted' }, { surface: 'fiche' });
  assert.equal(out.ok, true);
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'fiche', to: 'contacted', count: 1, result: 'updated' } }]);

  scriptRpc(() => ({ data: { id: 'r1', changed: false, result: 'unchanged', general_stage: 'contacted' }, error: null }));
  await setCandidateStage('r1', { stage: 'contacted' }, { surface: 'fiche' });
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'fiche', to: 'contacted', count: 0, result: 'unchanged' } }]);

  scriptRpc(() => ({ data: null, error: { message: 'refus', code: '22023', hint: 'STAGE_STEP_REQUIRED' } }));
  const refused = await setCandidateStage('r1', { stage: 'interviewing' }, { surface: 'pipeline' });
  assert.equal(refused.ok, false);
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'pipeline', to: 'interviewing', count: 0, result: 'error' } }]);

  globalThis.__stageRpc = async () => { throw new Error('Failed to fetch'); };
  await setCandidateStage('r1', { stage: 'retained' }, { surface: 'fiche' });
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'fiche', to: 'retained', count: 0, result: 'error' } }]);
});

test('0c : setCandidateStages émet un seul événement pour tout le geste, issue updated, partial, unchanged ou error', async () => {
  takeEvents();
  const ids = Array.from({ length: 450 }, (_, i) => uuid(i));
  const calls = scriptRpc((fn, args) => ({
    data: args.p_ids.map((id) => ({ id, changed: true, result: 'updated', general_stage: 'retained' })),
    error: null,
  }));
  await setCandidateStages(ids, { stage: 'retained' }, undefined, { surface: 'mission-kanban' });
  assert.equal(calls.length, 3);
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'mission-kanban', to: 'retained', count: 450, result: 'updated' } }]);

  // Un refus par ligne : partial (des lignes changées, une refusée).
  scriptRpc((fn, args) => ({
    data: args.p_ids.map((id, k) => (k === 0
      ? { id, changed: false, result: 'error', code: 'P0002', hint: 'STAGE_ROW_NOT_FOUND' }
      : { id, changed: true, result: 'updated', general_stage: 'rejected' })),
    error: null,
  }));
  await setCandidateStages([uuid(1), uuid(2), uuid(3)], { stage: 'rejected' }, undefined, { surface: 'mission-table' });
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'mission-table', to: 'rejected', count: 2, result: 'partial' } }]);

  // Rien de changé, rien de refusé : unchanged (lignes déjà à l'étape ou laissées par p_from_stages).
  scriptRpc((fn, args) => ({
    data: args.p_ids.map((id, k) => ({ id, changed: false, result: k === 0 ? 'unchanged' : 'skipped', general_stage: 'hired' })),
    error: null,
  }));
  await setCandidateStages([uuid(1), uuid(2)], { stage: 'retained' }, ['to_sort'], { surface: 'sourcing' });
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'sourcing', to: 'retained', count: 0, result: 'unchanged' } }]);

  // Appel en échec sans rien d'écrit : error ; après un premier lot passé : partial, count du lot passé.
  scriptRpc(() => ({ data: null, error: { message: 'lock timeout', code: '55P03', hint: null } }));
  await setCandidateStages([uuid(1)], { stage: 'retained' }, undefined, { surface: 'pipeline' });
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'pipeline', to: 'retained', count: 0, result: 'error' } }]);
  scriptRpc((fn, args, n) => (n === 2
    ? { data: null, error: { message: 'lock timeout', code: '55P03', hint: null } }
    : { data: args.p_ids.map((id) => ({ id, changed: true, result: 'updated', general_stage: 'to_sort' })), error: null }));
  await setCandidateStages(ids, { stage: 'to_sort' }, undefined, { surface: 'pipeline' });
  assert.deepEqual(takeEvents(), [{ name: 'Stage Change', props: { surface: 'pipeline', to: 'to_sort', count: 200, result: 'partial' } }]);

  // Aucun identifiant : pas de geste, pas d'événement.
  scriptRpc(() => { throw new Error('ne doit pas être appelé'); });
  await setCandidateStages([], { stage: 'rejected' }, undefined, { surface: 'pipeline' });
  assert.deepEqual(takeEvents(), []);
});

test('0c : la surface est un mot court, jamais un nom, une adresse ni un identifiant', async () => {
  takeEvents();
  scriptRpc(() => ({ data: { id: 'r1', changed: true, result: 'updated', general_stage: 'retained' }, error: null }));
  for (const bad of ['', 'Marie Dupont', 'marie.dupont@example.com', uuid(7), 'Fiche', '1fiche', 'a'.repeat(33)]) {
    await setCandidateStage('r1', { stage: 'retained' }, { surface: bad });
  }
  assert.deepEqual(takeEvents(), []);
  for (const good of ['mission-kanban', 'mission-table', 'pipeline', 'fiche', 'sourcing']) {
    await setCandidateStage('r1', { stage: 'retained' }, { surface: good });
  }
  assert.deepEqual(takeEvents().map((e) => e.props.surface), ['mission-kanban', 'mission-table', 'pipeline', 'fiche', 'sourcing']);
});

test('0c : les propriétés d\'un événement ne portent ni identifiant ni donnée personnelle', async () => {
  takeEvents();
  const id = uuid(42);
  scriptRpc(() => ({ data: { id, changed: true, result: 'updated', general_stage: 'interviewing',
    process_step_id: uuid(43), stage_entered_at: '2026-09-29T11:28:27.123456+00:00' }, error: null }));
  await setCandidateStage(id, { stage: 'interviewing', processStepId: uuid(43) }, { surface: 'mission-kanban' });
  scriptRpc((fn, args) => ({ data: args.p_ids.map((i) => ({ id: i, changed: true, result: 'updated', general_stage: 'retained' })), error: null }));
  await setCandidateStages([id, uuid(44)], { stage: 'retained' }, undefined, { surface: 'mission-kanban' });
  scriptRpc(() => ({ data: { rows: [{ id, result: 'updated' }] }, error: null }));
  await undoCandidateStages([{ id, after_entered_at: '2026-09-29T11:28:27.123456+00:00',
    before: { general_stage: 'contacted', process_step_id: null, legacy_stage: null, stage_entered_at: null,
      decision_source: null, rejected_at: null, rejected_from_stage: null, presented_at: null } }], { surface: 'mission-kanban' });
  const events = takeEvents();
  assert.deepEqual(events.map((e) => e.name), ['Stage Change', 'Stage Change', 'Stage Undo']);
  const allowed = { 'Stage Change': ['count', 'result', 'surface', 'to'], 'Stage Undo': ['count', 'surface'] };
  for (const e of events) {
    assert.deepEqual(Object.keys(e.props).sort(), allowed[e.name], e.name);
    for (const v of Object.values(e.props)) assert.ok(typeof v === 'string' || typeof v === 'number', e.name);
    assert.doesNotMatch(JSON.stringify(e.props), /[0-9a-f]{8}-[0-9a-f]{4}-|@|2026-/, `${e.name} : pas d'identifiant, d'adresse ni de date`);
  }
});

// ------------------------------------------ lot 0c : état d'avant du geste
const DATE_A = '2026-09-20T08:00:00.123456+00:00';
const snap = (id, over = {}) => ({
  id, general_stage: 'contacted', process_step_id: null, pipeline_stage: null, stage_entered_at: DATE_A,
  decision_source: 'ai', rejected_at: null, rejected_from_stage: null, presented_at: null, ...over,
});

test('0c : readStageSnapshots lit par lots de 100 au plus, dates gardées en chaînes', async () => {
  const ids = Array.from({ length: 450 }, (_, i) => uuid(i));
  const reads = [];
  globalThis.__stageFrom = async (table, cols, col, values) => {
    reads.push({ table, cols, col, values });
    return { data: values.map((id) => snap(id, { stage_entered_at: '2026-09-20T08:00:00.123456+00:00' })), error: null };
  };
  const map = await readStageSnapshots([...ids, ids[5], '', ids[6]]);
  assert.deepEqual(reads.map((r) => r.values.length), [100, 100, 100, 100, 50]);
  assert.ok(reads.every((r) => r.values.length <= 200));
  assert.ok(reads.every((r) => r.table === 'job_candidate_status' && r.col === 'id'));
  assert.equal(reads[0].cols, 'id, general_stage, process_step_id, pipeline_stage, stage_entered_at, decision_source, rejected_at, rejected_from_stage, presented_at');
  assert.deepEqual(reads.flatMap((r) => r.values), ids);
  assert.equal(map.size, 450);
  assert.equal(map.get(ids[7]).stage_entered_at, DATE_A, 'date rendue telle quelle, microsecondes comprises');
  assert.equal(typeof map.get(ids[7]).stage_entered_at, 'string');
});

test('0c : readStageSnapshots ne lève pas, ignore une étape inconnue, laisse absent un lot illisible', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i));
    let n = 0;
    globalThis.__stageFrom = async (table, cols, col, values) => {
      n += 1;
      if (n === 2) return { data: null, error: { message: 'timeout', code: '57014' } };
      if (n === 3) throw new Error('Failed to fetch');
      return { data: values.map((id, k) => snap(id, k === 0 ? { general_stage: 'qualification' } : {})), error: null };
    };
    const map = await readStageSnapshots(ids);
    assert.equal(n, 3);
    assert.equal(map.size, 99, 'premier lot : 100 lignes dont une d\'étape inconnue');
    assert.ok(map.has(ids[1]) && !map.has(ids[0]) && !map.has(ids[150]) && !map.has(ids[249]));
    assert.equal(errors.length, 2);
    assert.equal((await readStageSnapshots([])).size, 0);
  } finally {
    console.error = realError;
  }
});

// -------------------------------------------- lot 0c : éléments d'annulation
const STEP_1 = '4a1b2c3d-0000-4000-8000-0000000000a1';
const STEP_2 = '4a1b2c3d-0000-4000-8000-0000000000a2';
const DATE_B = '2026-09-29T11:28:27.654321+00:00';
const row = (id, over = {}) => ({ id, result: 'updated', generalStage: 'retained', processStepId: null, stageEnteredAt: DATE_B, ...over });

test('0c : buildUndoMoves, kanban de mission : tous les champs du contrat, dates en chaînes', () => {
  const before = snap('a', {
    general_stage: 'rejected', decision_source: 'user', rejected_at: '2026-09-25T10:00:00.111111+00:00',
    rejected_from_stage: 'replied', presented_at: null, pipeline_stage: 'Perdu',
  });
  const moves = buildUndoMoves(new Map([['a', before]]), [row('a', { generalStage: 'retained' })]);
  assert.deepEqual(moves, [{
    id: 'a',
    after_entered_at: DATE_B,
    before: {
      general_stage: 'rejected', process_step_id: null, legacy_stage: null, stage_entered_at: DATE_A,
      decision_source: 'user', rejected_at: '2026-09-25T10:00:00.111111+00:00', rejected_from_stage: 'replied', presented_at: null,
    },
  }]);
  // Toutes les clés de before sont présentes, valeurs nulles comprises (la base remet l'origine d'avant, même vide).
  const sent = JSON.parse(JSON.stringify(moves[0]));
  assert.deepEqual(Object.keys(sent.before).sort(),
    ['decision_source', 'general_stage', 'legacy_stage', 'presented_at', 'process_step_id', 'rejected_at', 'rejected_from_stage', 'stage_entered_at']);
  assert.equal('after_pipeline_stage' in sent, false);
  const fromAi = buildUndoMoves(new Map([['b', snap('b', { decision_source: null })]]), [row('b')]);
  assert.equal(JSON.parse(JSON.stringify(fromAi[0])).before.decision_source, null);
});

test('0c : buildUndoMoves ne garde que les lignes updated dont l\'étape ou l\'étape d\'entretien a changé', () => {
  const snaps = new Map([
    ['moved', snap('moved')],
    ['same', snap('same', { general_stage: 'retained' })],
    ['unch', snap('unch')],
    ['skip', snap('skip')],
    ['err', snap('err')],
    ['nodate', snap('nodate')],
    ['step', snap('step', { general_stage: 'interviewing', process_step_id: STEP_1, pipeline_stage: STEP_1 })],
  ]);
  const moves = buildUndoMoves(snaps, [
    row('moved'),
    row('same'),                                               // confirmation : ni étape ni étape d'entretien
    row('unch', { result: 'unchanged' }),
    row('skip', { result: 'skipped', stageEnteredAt: null }),
    row('err', { result: 'error', stageEnteredAt: null }),
    row('nodate', { stageEnteredAt: null }),
    row('ghost'),                                              // état d'avant jamais lu
    row('step', { generalStage: 'interviewing', processStepId: STEP_2 }),
  ]);
  assert.deepEqual(moves.map((m) => m.id), ['moved', 'step']);
  const step = moves.find((m) => m.id === 'step');
  assert.equal(step.before.general_stage, 'interviewing');
  assert.equal(step.before.process_step_id, STEP_1);
  assert.equal(step.before.legacy_stage, null, 'avec une étape de mission, pas de libellé hérité');
});

test('0c : buildUndoMoves, /pipeline : colonne visée, after_pipeline_stage, libellé d\'avant seulement pour En entretien', () => {
  const target = { stage: 'interviewing', legacyStage: 'Offre' };
  // Entre deux colonnes d'entretien : l'étape générale ne change pas, la date non plus.
  const between = buildUndoMoves(
    new Map([['a', snap('a', { general_stage: 'interviewing', pipeline_stage: 'Pré-qualif' })]]),
    [row('a', { generalStage: 'interviewing', stageEnteredAt: DATE_A })],
    { target },
  );
  assert.equal(between.length, 1);
  assert.equal(between[0].after_pipeline_stage, 'Offre');
  assert.equal(between[0].after_entered_at, DATE_A);
  assert.equal(between[0].before.legacy_stage, 'Pré-qualif');
  assert.equal(between[0].before.general_stage, 'interviewing');

  // Déjà dans la colonne visée : rien à annuler.
  assert.deepEqual(buildUndoMoves(
    new Map([['a', snap('a', { general_stage: 'interviewing', pipeline_stage: 'Offre' })]]),
    [row('a', { generalStage: 'interviewing' })], { target }), []);

  // Vers une colonne d'entretien depuis une autre étape : libellé d'avant nul (Contacté n'en porte pas).
  const into = buildUndoMoves(new Map([['b', snap('b', { pipeline_stage: 'Contacté' })]]),
    [row('b', { generalStage: 'interviewing' })], { target: { stage: 'interviewing', legacyStage: 'CV envoyé' } });
  assert.equal(into[0].after_pipeline_stage, 'CV envoyé');
  assert.equal(into[0].before.legacy_stage, null);

  // Depuis Embauché ou Retenu : le libellé d'avant reste hors de l'élément, même admis pour leur étape.
  const fromHired = buildUndoMoves(new Map([['c', snap('c', { general_stage: 'hired', pipeline_stage: 'Gagné' })]]),
    [row('c', { generalStage: 'interviewing' })], { target });
  assert.equal(fromHired[0].before.legacy_stage, null);
  assert.equal(fromHired[0].before.general_stage, 'hired');

  // Depuis En entretien avec un libellé hors liste blanche : pas de libellé.
  const odd = buildUndoMoves(new Map([['d', snap('d', { general_stage: 'interviewing', pipeline_stage: 'qualification' })]]),
    [row('d', { generalStage: 'retained' })]);
  assert.equal(odd[0].before.legacy_stage, null);

  // Colonne sans libellé hérité (Contacté, Écarté...) : pas d'after_pipeline_stage.
  const plain = buildUndoMoves(new Map([['e', snap('e')]]), [row('e', { generalStage: 'rejected' })], { target: { stage: 'rejected' } });
  assert.equal('after_pipeline_stage' in plain[0], false);
});

test('0c : buildUndoMoves lit la ligne rendue par setCandidateStage (ok: true) comme celle d\'un lot', async () => {
  scriptRpc(() => ({ data: { id: 'a', changed: true, result: 'updated', general_stage: 'retained',
    stage_entered_at: DATE_B }, error: null }));
  const out = await setCandidateStage('a', { stage: 'retained' });
  const moves = buildUndoMoves(new Map([['a', snap('a')]]), [out]);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].after_entered_at, DATE_B);
});

// -------------------------------------------------- lot 0c : annulation
const moveOf = (id) => ({
  id, after_entered_at: DATE_B,
  before: { general_stage: 'contacted', process_step_id: null, legacy_stage: null, stage_entered_at: DATE_A,
    decision_source: 'ai', rejected_at: null, rejected_from_stage: null, presented_at: null },
});

test('0c : undoCandidateStages appelle undo_candidate_stages par lots de 200, éléments envoyés tels quels', async () => {
  takeEvents();
  const moves = Array.from({ length: 450 }, (_, i) => moveOf(uuid(i)));
  const calls = scriptRpc((fn, args) => ({
    data: { rows: args.p_moves.map((m, k) => ({ id: m.id, result: k % 5 === 0 ? 'unchanged' : 'updated', general_stage: 'contacted' })) },
    error: null,
  }));
  const out = await undoCandidateStages([...moves, moves[3], moves[9]]);
  assert.deepEqual(calls.map((c) => c.args.p_moves.length), [200, 200, 50]);
  assert.ok(calls.every((c) => c.fn === 'undo_candidate_stages' && Object.keys(c.args).join() === 'p_moves'));
  assert.deepEqual(calls.flatMap((c) => c.args.p_moves), moves);
  assert.equal(calls[0].args.p_moves[0].after_entered_at, DATE_B);
  assert.equal(out.rows.length, 450);
  assert.equal(out.unchanged, 90);
  assert.equal(out.updated, 360);
  assert.equal(out.movedSince, 0);
  assert.equal(out.refused, 0);
  assert.equal(out.error, null);
  assert.deepEqual(out.untreatedIds, []);
  assert.deepEqual(takeEvents(), [], 'sans surface, pas de « Stage Undo »');
});

test('0c : undoCandidateStages rend un résultat par ligne, refus avec indice, ligne sans réponse en refus', async () => {
  takeEvents();
  const calls = scriptRpc(() => ({
    data: { rows: [
      { id: 'a', result: 'updated', general_stage: 'contacted' },
      { id: 'b', result: 'moved_since' },
      { id: 'c', result: 'error', hint: 'STAGE_ROW_NOT_FOUND' },
      { id: 'd', result: 'error', hint: 'STAGE_UNDO_INVALID' },
      { id: 'e', result: 'unchanged' },
      { id: 'f', result: 'kept' },
    ] },
    error: null,
  }));
  const out = await undoCandidateStages(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(moveOf), { surface: 'pipeline' });
  assert.equal(calls.length, 1);
  assert.deepEqual(out.rows, [
    { id: 'a', result: 'updated', hint: null },
    { id: 'b', result: 'moved_since', hint: null },
    { id: 'c', result: 'error', hint: 'STAGE_ROW_NOT_FOUND' },
    { id: 'd', result: 'error', hint: 'STAGE_UNDO_INVALID' },
    { id: 'e', result: 'unchanged', hint: null },
    { id: 'f', result: 'error', hint: null },
    { id: 'g', result: 'error', hint: null },
  ]);
  assert.equal(out.updated, 1);
  assert.equal(out.unchanged, 1);
  assert.equal(out.movedSince, 1);
  assert.equal(out.refused, 4);
  assert.deepEqual(takeEvents(), [{ name: 'Stage Undo', props: { surface: 'pipeline', count: 1 } }]);
});

test('0c : undoCandidateStages, un appel en échec arrête les lots suivants et ne lève pas', async () => {
  takeEvents();
  const moves = Array.from({ length: 450 }, (_, i) => moveOf(uuid(i)));
  const calls = scriptRpc((fn, args, n) => (n === 2
    ? { data: null, error: { message: 'canceling statement due to lock timeout', code: '55P03', hint: null } }
    : { data: { rows: args.p_moves.map((m) => ({ id: m.id, result: 'updated' })) }, error: null }));
  const out = await undoCandidateStages(moves, { surface: 'pipeline' });
  assert.equal(calls.length, 2);
  assert.equal(out.updated, 200);
  assert.equal(out.rows.length, 200);
  assert.deepEqual(out.error, { hint: null, code: '55P03', message: 'canceling statement due to lock timeout' });
  assert.deepEqual(out.untreatedIds, moves.slice(200).map((m) => m.id));
  assert.deepEqual(takeEvents(), [{ name: 'Stage Undo', props: { surface: 'pipeline', count: 200 } }]);

  globalThis.__stageRpc = async () => { throw new Error('Failed to fetch'); };
  const thrown = await undoCandidateStages([moveOf('a')]);
  assert.deepEqual(thrown.error, { hint: null, code: null, message: 'Failed to fetch' });
  assert.deepEqual(thrown.untreatedIds, ['a']);

  const none = scriptRpc(() => { throw new Error('ne doit pas être appelé'); });
  const empty = await undoCandidateStages([], { surface: 'pipeline' });
  assert.equal(none.length, 0);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(takeEvents(), [], 'aucun élément : pas d\'annulation, pas d\'événement');
});

// ------------------------------------------ lot 0c : message d'annulation
const outcomeOf = (results, extra = {}) => ({
  rows: results.map(([id, result], i) => ({ id, result, hint: result === 'error' ? 'STAGE_UNDO_INVALID' : null })),
  updated: 0, unchanged: 0, movedSince: 0, refused: 0, error: null, untreatedIds: [], ...extra,
});

test('0c : undoSummaryMessage, phrases françaises, nombres accordés', () => {
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'updated']])), '1 candidat est revenu à son étape précédente.');
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'updated'], ['b', 'unchanged'], ['c', 'updated']])),
    '3 candidats sont revenus à leur étape précédente.');
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'moved_since']])),
    "1 candidat a changé d'étape depuis : il reste où il est.");
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'updated'], ['b', 'moved_since'], ['c', 'moved_since']])),
    "1 candidat est revenu à son étape précédente. 2 candidats ont changé d'étape depuis : ils restent où ils sont.");
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'updated'], ['b', 'updated'], ['c', 'error']])),
    "2 candidats sont revenus à leur étape précédente. 1 candidat n'a pas pu être remis à son étape. Réessayez.");
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'error'], ['b', 'error']])), "L'annulation n'a pas été enregistrée. Réessayez.");
  assert.equal(undoSummaryMessage(outcomeOf([])), "Il n'y avait rien à annuler.");
  // Appel en échec : les identifiants non traités comptent comme non remis.
  assert.equal(undoSummaryMessage(outcomeOf([], { error: { hint: null, code: null, message: 'x' }, untreatedIds: ['a', 'b'] })),
    "L'annulation n'a pas été enregistrée. Réessayez.");
  assert.equal(undoSummaryMessage(outcomeOf([['a', 'updated']], { untreatedIds: ['b', 'c'] })),
    "1 candidat est revenu à son étape précédente. 2 candidats n'ont pas pu être remis à leur étape. Réessayez.");
  // Grand nombre écrit à la française.
  const many = Array.from({ length: 1200 }, (_, i) => [`x${i}`, 'updated']);
  assert.equal(undoSummaryMessage(outcomeOf(many)), `${(1200).toLocaleString('fr-FR')} candidats sont revenus à leur étape précédente.`);
});

test('0c : undoSummaryMessage compte par candidat quand on donne les groupes de lignes', () => {
  // Deux doublons du même candidat, remis : un candidat, pas deux.
  const both = outcomeOf([['a1', 'updated'], ['a2', 'updated']]);
  assert.equal(undoSummaryMessage(both), '2 candidats sont revenus à leur étape précédente.');
  assert.equal(undoSummaryMessage(both, { groups: [['a1', 'a2']] }), '1 candidat est revenu à son étape précédente.');
  // Une ligne du groupe a bougé depuis : le candidat est « déplacé depuis », pas remis.
  const mixed = outcomeOf([['a1', 'updated'], ['a2', 'moved_since'], ['b1', 'updated'], ['c1', 'error']]);
  assert.equal(undoSummaryMessage(mixed, { groups: [['a1', 'a2'], ['b1'], ['c1']] }),
    "1 candidat est revenu à son étape précédente. 1 candidat a changé d'étape depuis : il reste où il est. 1 candidat n'a pas pu être remis à son étape. Réessayez.");
  // Identifiant de groupe sans réponse : non remis.
  assert.equal(undoSummaryMessage(outcomeOf([['a1', 'updated']]), { groups: [['a1'], ['zz']] }),
    "1 candidat est revenu à son étape précédente. 1 candidat n'a pas pu être remis à son étape. Réessayez.");
});

test('0c : les textes d\'annulation sans « (s) », sans tiret long, sans jargon', () => {
  const samples = [
    outcomeOf([['a', 'updated']]), outcomeOf([['a', 'moved_since'], ['b', 'moved_since']]),
    outcomeOf([['a', 'error'], ['b', 'updated']]), outcomeOf([]),
  ];
  for (const s of samples) {
    const msg = undoSummaryMessage(s);
    assert.doesNotMatch(msg, /\(s\)|—|–|moved_since|STAGE_|RPC|undo_/i, msg);
  }
});
