/**
 * Refonte mission, lot 0b-4 : src/lib/candidateStage.ts, seule porte du
 * navigateur vers l'étape d'un candidat (origine user).
 *
 * - fonctions pures (ATS_LABEL_TO_STAGE, missionColumnToStage, exactTarget,
 *   stageErrorMessage, skippedStageMessage) : module empaqueté par esbuild
 *   (alias @/ résolus par tsconfig.app.json), le client Supabase remplacé par
 *   un faux client dont rpc est scripté par le test ;
 * - tables recoupées avec leurs sources : libellés du /pipeline (ATS_STAGES) et
 *   de l'assistant (ALLOWED_STAGES), liste blanche des libellés hérités de
 *   set_candidate_stage (migration 0a), clés de colonnes du kanban de mission ;
 * - setCandidateStage(s) : paramètres envoyés, lecture des refus, découpage par
 *   200 et cumul des résultats par ligne.
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

// Faux client : chaque appel rpc est journalisé puis confié à globalThis.__stageRpc.
const stubClient = {
  name: 'stub-supabase-client',
  setup(build) {
    build.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const supabase = { rpc: (fn, args) => globalThis.__stageRpc(fn, args) };',
      loader: 'js',
    }));
  },
};
const { outputFiles } = await build({
  entryPoints: [join(ROOT_PATH, 'src/lib/candidateStage.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
  plugins: [stubClient],
});
const stage = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);
const {
  GENERAL_STAGES,
  ATS_LABEL_TO_STAGE,
  LEGACY_LABELS_BY_STAGE,
  STAGE_BATCH_SIZE,
  missionColumnToStage,
  exactTarget,
  stageErrorMessage,
  skippedStageMessage,
  setCandidateStage,
  setCandidateStages,
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
test('0b-4 : missionColumnToStage suit les clés de colonnes de MissionPipeline.tsx', () => {
  const src = code('src/components/missions/MissionPipeline.tsx');
  const keys = new Set([...src.matchAll(/\{ key: '([^']+)', label:/g)].map((m) => m[1]));
  assert.ok(/const REPLIED_KEY = 'Répondu';/.test(src), 'clé de la colonne Répondu');
  keys.add('Répondu');
  assert.deepEqual([...keys].sort(), ['dismissed', 'hired', 'messaged', 'shortlisted', 'sourced', 'untreated', 'Répondu'].sort());
  const none = new Set();
  for (const k of keys) assert.doesNotThrow(() => missionColumnToStage(k, none), k);
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

// ------------------------------------------------------------ exactTarget
test('0b-4 : exactTarget garde un libellé admis pour l\'étape, et lui seul', () => {
  assert.deepEqual(exactTarget({ general_stage: 'interviewing', process_step_id: null, pipeline_stage: 'Offre' }),
    { stage: 'interviewing', processStepId: null, legacyStage: 'Offre' });
  assert.deepEqual(exactTarget({ general_stage: 'hired', process_step_id: null, pipeline_stage: 'Gagné' }),
    { stage: 'hired', processStepId: null, legacyStage: 'Gagné' });
  assert.deepEqual(exactTarget({ general_stage: 'hired', process_step_id: null, pipeline_stage: 'hired' }),
    { stage: 'hired', processStepId: null, legacyStage: 'hired' });
  assert.deepEqual(exactTarget({ general_stage: 'retained', process_step_id: null, pipeline_stage: 'Pressenti' }),
    { stage: 'retained', processStepId: null, legacyStage: 'Pressenti' });
  // Libellé d'une autre étape, ou inconnu : non envoyé (sinon STAGE_LEGACY_MISMATCH).
  assert.deepEqual(exactTarget({ general_stage: 'rejected', process_step_id: null, pipeline_stage: 'Contacté' }),
    { stage: 'rejected', processStepId: null, legacyStage: null });
  assert.deepEqual(exactTarget({ general_stage: 'to_sort', process_step_id: null, pipeline_stage: null }),
    { stage: 'to_sort', processStepId: null, legacyStage: null });
  assert.deepEqual(exactTarget({ general_stage: 'contacted', process_step_id: null, pipeline_stage: 'contacté' }),
    { stage: 'contacted', processStepId: null, legacyStage: null }, 'comparaison exacte, comme la base');
});

test('0b-4 : exactTarget, étape d\'entretien sans libellé, jamais hors entretien', () => {
  const step = '4a1b2c3d-0000-4000-8000-000000000002';
  assert.deepEqual(exactTarget({ general_stage: 'interviewing', process_step_id: step, pipeline_stage: step }),
    { stage: 'interviewing', processStepId: step, legacyStage: null });
  // Une étape d'entretien restée sur une ligne hors entretien n'est pas envoyée (STAGE_STEP_WITHOUT_INTERVIEW).
  assert.deepEqual(exactTarget({ general_stage: 'rejected', process_step_id: step, pipeline_stage: 'Perdu' }),
    { stage: 'rejected', processStepId: null, legacyStage: 'Perdu' });
  assert.throws(() => exactTarget({ general_stage: 'qualification', process_step_id: null, pipeline_stage: null }), /Étape inconnue/);
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
  assert.doesNotMatch(src, /\.from\('job_candidate_status'\)/, 'aucune écriture directe');
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
