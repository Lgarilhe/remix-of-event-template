/**
 * Refonte mission, lot 5f-1 : un seul chemin d'inscription côté navigateur.
 *
 * Deux blocs :
 * - garde statique : `src/lib/enrollCandidates.ts` est le seul fichier de `src/`
 *   qui écrit `sequence_enrollments` (insertion, upsert, suppression) et qui
 *   insère `sequence_step_executions` ; il n'écrit rien du pipeline lui-même
 *   (la règle Retenu passe par `src/lib/retainCandidates.ts`, seul écrivain des
 *   lignes de mission, et par `setCandidateStages`, jamais vers Contacté) ; les
 *   deux fenêtres l'appellent chacune dans son mode ;
 * - comportement : la bibliothèque est transpilée en mémoire et jouée contre un
 *   faux client, pour les deux écrivains (groupé, un candidat après l'autre).
 *
 * Lancer : node --test tests/c1/lot5f-inscription.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const LIB = 'src/lib/enrollCandidates.ts';
const SIMPLE = 'src/components/outreach/SequenceEnrollModal.tsx';
const PREVIEW = 'src/components/outreach/EnrollmentPreviewModal.tsx';

// ---------------------------------------------------------------- garde statique
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && rel !== 'src/integrations/supabase/types.ts') out.push(rel);
  }
  return out;
}

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Fichiers de src/ qui ouvrent une requête sur `table` autrement que pour la
 * lire ou la mettre à jour (`.select(`, `.update(`) : tout appel suivi d'autre
 * chose (insertion, upsert, suppression, requête gardée dans une variable),
 * et tout `.from(` dont l'argument est une constante qui désigne la table.
 */
function writersOf(table) {
  const files = [];
  for (const rel of sourceFiles('src')) {
    const source = withoutComments(read(rel));
    if (!source.includes(table)) continue;
    const aliases = [...source.matchAll(new RegExp(`const\\s+(\\w+)\\s*(?::[^=]+)?=\\s*['"\`]${table}['"\`]`, 'g'))].map((m) => m[1]);
    const arg = `(?:['"\`]${table}['"\`]${aliases.map((a) => `|${a}`).join('')})`;
    const from = new RegExp(`\\.from\\(\\s*${arg}(?:\\s+as\\s+[\\w.<>'"]+)*\\s*\\)`, 'g');
    const readOrUpdate = /^\s*\.(select|update)\s*[<(]/;
    for (const match of source.matchAll(from)) {
      if (!readOrUpdate.test(source.slice(match.index + match[0].length, match.index + match[0].length + 80))) {
        files.push(rel);
        break;
      }
    }
  }
  return files;
}

test('5F1-S1 un seul fichier de src/ crée ou retire des inscriptions', () => {
  assert.deepEqual(writersOf('sequence_enrollments'), [LIB]);
});

test('5F1-S2 un seul fichier de src/ insère des exécutions d’étape', () => {
  assert.deepEqual(writersOf('sequence_step_executions'), [LIB]);
});

test('5F1-S3 la bibliothèque n’écrit rien dans le pipeline', () => {
  const lib = read(LIB);
  for (const word of ['job_candidate_status', 'Contacté', 'messaged', 'setCandidateStage', 'candidateStage']) {
    assert.ok(!lib.includes(word), `${LIB} ne doit pas contenir « ${word} »`);
  }
  assert.doesNotMatch(lib, /from ['"]sonner['"]/, 'la bibliothèque ne parle pas à l’écran');
  assert.doesNotMatch(lib, /from ['"]react['"]/);
  assert.doesNotMatch(lib, /@\/integrations\/supabase\/client/, 'le client est passé en paramètre');
  // Import de type seulement : le hook lui-même alourdirait les chunks de la messagerie et du Pipeline.
  assert.doesNotMatch(lib, /^import (?!type)[^;]*@\/hooks\/useEnrollmentPreview/m);
});

test('5F1-S4 les deux fenêtres appellent la bibliothèque, chacune dans son mode', () => {
  const simple = read(SIMPLE);
  const preview = read(PREVIEW);
  for (const [name, source] of [['modale simple', simple], ['aperçu', preview]]) {
    assert.doesNotMatch(source, /\.from\(\s*['"]sequence_enrollments['"]/, `${name} : plus d’accès direct aux inscriptions`);
    assert.doesNotMatch(source, /\.from\(\s*['"]sequence_step_executions['"]/, `${name} : plus d’accès direct aux exécutions`);
    assert.match(source, /import \{ enrollCandidates, type EnrollResults \} from '@\/lib\/enrollCandidates';/, name);
    assert.doesNotMatch(source, /interface EnrollResults/, `${name} : le type n’est plus dupliqué`);
  }
  assert.match(simple, /mode: 'batch',\s*firstStepTiming: 'business_hours',/);
  assert.match(preview, /mode: 'one_by_one',\s*firstStepTiming: 'raw',/);
  assert.match(preview, /messageOverridesFor: getMessageOverrides,\s*stepConfigOverrides: getStepConfigOverrides,/);
  // Contrats côté fenêtre, repris ici parce que tests/ux n'est pas joué par la CI.
  assert.match(simple, /outcome\.schedulingFailure\.rolledBack \? 'Inscription impossible' : 'Inscription incomplète'/);
  assert.match(simple, /isOtherMemberAccountError\(outcome\.error\)/);
  assert.match(preview, /isOtherMemberAccountError\(outcome\.error\)/);
  assert.match(preview, /discardSessionPreviews\(outcome\.enrolledIds\)/);
  for (const [name, source] of [['modale simple', simple], ['aperçu', preview]]) {
    assert.match(source, /setRecentEnrollments\(outcome\.recentEnrollments\)/, name);
    assert.match(source, /if \(outcome\.status === 'refused'\) \{\s*toast\.error\(outcome\.message\);\s*return;/, name);
  }
  // Les gardes qui dépendent de l'écran restent dans les fenêtres, avant l'écriture.
  for (const source of [simple, preview]) {
    const body = source.slice(source.indexOf('const handleEnroll = async () => {'), source.indexOf('await enrollCandidates({'));
    assert.match(body, /if \(sendingAccount\.blockReason\)/);
    assert.match(body, /if \(recipients\.blocked/);
    assert.match(body, /setIsEnrolling\(true\);/);
  }
});

test('5F1-S5 job_id sans « project: », provider_id, email_used et phone_used posés par un seul constructeur', () => {
  const lib = read(LIB);
  assert.equal((lib.match(/\.\.\.enrollmentRowFields\(/g) || []).length, 1);
  assert.match(lib, /job\.id\.slice\('project:'\.length\)/);
  assert.equal((lib.match(/\.from\('sequence_enrollments'\)\s*\.upsert\(/g) || []).length, 3, 'groupé, repli candidat par candidat, boucle un par un');
});

test('5F1-S6 la règle Retenu : un seul module écrit les lignes de mission, l\'étape ne va jamais au-delà de Retenu', () => {
  const retain = read('src/lib/retainCandidates.ts');
  // L'étape ne s'écrit que par setCandidateStages, vers « retained », origine user (posée par candidateStage).
  assert.match(retain, /setCandidateStages\(\s*ids, \{ stage: 'retained' \}, params\.fromStages, \{ surface: params\.surface \},/);
  assert.equal((retain.match(/stage: '/g) || []).length, 1, 'une seule étape cible dans le module');
  for (const word of ['Contacté', "'contacted'", 'pipeline_stage', 'general_stage', 'p_source', '.rpc(']) {
    assert.ok(!retain.includes(word), `retainCandidates.ts ne doit pas contenir « ${word} »`);
  }
  assert.doesNotMatch(retain, /\bstatus:/, 'aucune colonne d\'étape dans la ligne créée');
  // La règle de l'inscription part d'étapes de départ fermées : jamais de recul depuis Contacté ou plus loin.
  assert.match(read(LIB), /fromStages: \['to_sort', 'rejected'\],/);
  // Deux appelants, pas un de plus : l'inscription et « Présélectionner sans message ».
  const callers = sourceFiles('src').filter((rel) => rel !== 'src/lib/retainCandidates.ts' && /retainCandidates\(/.test(withoutComments(read(rel))));
  assert.deepEqual(callers.sort(), [LIB, PREVIEW].sort());
  // Les deux fenêtres rafraîchissent les lectures d'étape et disent un échec de Retenu sans défaire l'inscription.
  for (const rel of [SIMPLE, PREVIEW]) {
    const source = read(rel);
    assert.match(source, /outcome\.retained\.saved > 0\) void invalidateStageReaders\(queryClient\)/, rel);
    assert.match(source, /retainFailedLabel\(outcome\.retained\.failed\)/, rel);
  }
});

// ---------------------------------------------------------------- comportement
async function loadLib() {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await build({
    stdin: { contents: read(LIB), resolveDir: path.join(ROOT, 'src/lib'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [{
      name: 'alias',
      setup(b) {
        // L'étape passe par setCandidateStages, qui parle au client global : remplacé par un enregistreur.
        const stubs = {
          '@/integrations/supabase/client': 'export const supabase = { rpc: (fn, args) => globalThis.__stageRpc(fn, args) };',
          '@/lib/analytics': 'export const trackEvent = () => {};',
        };
        b.onResolve({ filter: /^@\// }, (args) => (args.path in stubs
          ? { path: args.path, namespace: 'stub' }
          : { path: resolveSrc(args.path) }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// Appels à set_candidate_stages (client global du navigateur), et réponse par défaut : toutes les lignes changent.
const stageCalls = [];
let stageResponder = (args) => ({ data: args.p_ids.map((id) => ({ id, result: 'updated', changed: true, general_stage: 'retained' })), error: null });
globalThis.__stageRpc = async (fn, args) => { stageCalls.push({ fn, args }); return stageResponder(args); };
const resetStage = (responder) => {
  stageCalls.length = 0;
  stageResponder = responder ?? ((args) => ({ data: args.p_ids.map((id) => ({ id, result: 'updated', changed: true, general_stage: 'retained' })), error: null }));
};

const lib = await loadLib();

/**
 * Faux client : enregistre chaque requête (table, opération, charge, filtres) et
 * répond par `handle(call)`. Les lectures rendent `[]`, sauf la séquence (active).
 */
function fakeClient(handle = () => undefined, { user = { id: 'user-1' } } = {}) {
  const calls = [];
  const rpcCalls = [];
  const filters = (call) => ({
    select: (cols) => { call.cols = cols; return call.chain; },
  });
  const from = (table) => {
    const call = { table, op: 'select', payload: null, options: null, eq: [], in: [], single: false };
    calls.push(call);
    const chain = {
      select: (cols) => { call.cols = cols; return chain; },
      upsert: (payload, options) => { call.op = 'upsert'; call.payload = payload; call.options = options; return chain; },
      insert: (payload) => { call.op = 'insert'; call.payload = payload; return chain; },
      delete: () => { call.op = 'delete'; return chain; },
      update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
      eq: (c, v) => { call.eq.push([c, v]); return chain; },
      in: (c, v) => { call.in.push([c, v]); return chain; },
      or: () => chain, gte: () => chain, neq: () => chain, order: () => chain, limit: () => chain, is: () => chain,
      maybeSingle: () => { call.single = true; return chain; },
      then: (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject),
    };
    void filters;
    return chain;
  };
  const respond = (call) => {
    const scripted = handle(call);
    if (scripted !== undefined) return scripted;
    // Comme PostgREST : sans .select() chaîné, une écriture ne rend aucune ligne.
    if ((call.op === 'upsert' || call.op === 'delete') && call.cols === undefined) return { data: null, error: null };
    if (call.table === 'outreach_sequences') return { data: { is_active: true }, error: null };
    if (call.op === 'upsert') {
      const rows = Array.isArray(call.payload) ? call.payload : [call.payload];
      const out = rows.map((r) => (call.table === 'job_candidate_status'
        ? { id: `jcs-${r.candidate_id}` }
        : { id: `enr-${r.profile_id}`, profile_id: r.profile_id }));
      return { data: call.single ? out[0] ?? null : out, error: null };
    }
    if (call.op === 'delete') {
      const ids = call.in.find(([c]) => c === 'id')?.[1] ?? [call.eq.find(([c]) => c === 'id')?.[1]];
      return { data: ids.map((id) => ({ id })), error: null };
    }
    if (call.op === 'insert') return { data: null, error: null };
    return { data: [], error: null };
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user } }) },
    from,
    rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return { data: [], error: null }; },
  };
  return { supabase, calls, rpcCalls };
}

const writes = (calls, table, op) => calls.filter((c) => c.table === table && c.op === op);

const person = (n, extra = {}) => ({
  id: `ACo${n}`,
  provider_id: `ACw${n}`,
  name: `Candidat ${n}`,
  headline: `Poste ${n}`,
  profile_url: `https://www.linkedin.com/in/candidat-${n}`,
  network_distance: 2,
  contact_info: { emails: [`  Candidat${n}@Exemple.FR `], phones: [] },
  ...extra,
});

const STEP = { id: 'step-1', step_order: 0, action_type: 'connection_request', delay_days: 0, delay_hours: 0, delay_minutes: 0 };
const MISSION = '11111111-1111-4111-8111-111111111111';

function options(supabase, overrides = {}) {
  const candidates = overrides.candidates ?? [person(1), person(2), person(3)];
  return {
    supabase,
    organizationId: 'org-1',
    accountId: 'acc-1',
    sequence: { id: 'seq-1', steps: [STEP] },
    job: { id: `project:${MISSION}`, title: 'Poste cible' },
    allProfiles: candidates,
    candidates,
    recentEnrollments: new Map(),
    allowDuplicates: false,
    noCandidatesMessage: 'AUCUN CANDIDAT',
    mode: 'batch',
    firstStepTiming: 'raw',
    ...overrides,
  };
}

const silent = async (fn) => {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
};

test('5F1-B1 groupé : une écriture des inscriptions, une des premières exécutions, puis Retenu', async () => {
  const { supabase, calls } = fakeClient();
  const outcome = await lib.enrollCandidates(options(supabase));
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.results.success, 3);
  assert.deepEqual(outcome.enrolledIds, ['ACo1', 'ACo2', 'ACo3']);

  const upserts = writes(calls, 'sequence_enrollments', 'upsert');
  assert.equal(upserts.length, 1, 'une seule écriture groupée');
  assert.deepEqual(upserts[0].options, { onConflict: 'sequence_id,profile_id', ignoreDuplicates: true });
  assert.equal(upserts[0].cols, 'id, profile_id');
  const rows = upserts[0].payload;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].job_id, MISSION, 'sans le préfixe project:');
  assert.equal(rows[0].job_title, 'Poste cible');
  assert.equal(rows[0].created_by, 'user-1');
  assert.equal(rows[0].account_id, 'acc-1');
  assert.equal(rows[0].organization_id, 'org-1');
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].current_step_order, 0);
  assert.equal(rows[0].network_distance, 'SECOND_DEGREE');
  assert.equal(rows[0].provider_id, 'ACw1');
  assert.equal(rows[0].email_used, 'candidat1@exemple.fr');
  assert.equal(rows[0].phone_used, null);
  assert.ok(rows.every((r) => !('tracking_data' in r)), 'aucune retouche en écriture groupée');

  const executions = writes(calls, 'sequence_step_executions', 'insert');
  assert.equal(executions.length, 1);
  assert.equal(executions[0].payload.length, 3, 'une première exécution par inscription');
  assert.deepEqual(executions[0].payload.map((e) => e.enrollment_id), ['enr-ACo1', 'enr-ACo2', 'enr-ACo3']);
  assert.ok(executions[0].payload.every((e) => e.step_id === 'step-1' && e.status === 'scheduled' && e.organization_id === 'org-1' && e.step_order === 0));
  // Seule écriture dans le pipeline : la règle Retenu (voir 5F1-RT1).
  assert.deepEqual(
    calls.filter((c) => c.op !== 'select').map((c) => `${c.table}:${c.op}`),
    ['sequence_enrollments:upsert', 'sequence_step_executions:insert', 'job_candidate_status:upsert'],
    'aucune autre écriture',
  );
});

test('5F1-B2 groupé : un refus de la base reprend candidat par candidat, les autres sont inscrits', async () => {
  const people = [person(1), person(2), person(3), person(4)];
  const { supabase, calls } = fakeClient((call) => {
    if (call.table !== 'sequence_enrollments' || call.op !== 'upsert') return undefined;
    if (Array.isArray(call.payload)) return { data: null, error: { code: '23505', hint: 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE' } };
    if (call.payload.profile_id === 'ACo2') return { data: null, error: { code: '42501', hint: 'ENROLLMENT_GDPR_ERASED' } };
    if (call.payload.profile_id === 'ACo3') return { data: null, error: { code: '23505', hint: 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE' } };
    if (call.payload.profile_id === 'ACo4') return { data: null, error: { code: '500', message: 'brut' } };
    return undefined;
  });
  const outcome = await silent(() => lib.enrollCandidates(options(supabase, { candidates: people })));
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.results.success, 1);
  assert.deepEqual(outcome.results.gdprErased, ['Candidat 2']);
  assert.deepEqual(outcome.results.samePerson, ['Candidat 3']);
  assert.deepEqual(outcome.results.errors, ['Inscription impossible pour Candidat 4. Réessayez ou contactez le support.']);
  assert.equal(outcome.results.skipped, 0, 'un refusé n’est pas compté « déjà dans la séquence »');
  assert.equal(writes(calls, 'sequence_enrollments', 'upsert').length, 5, 'groupé, puis un par candidat');
  assert.equal(writes(calls, 'sequence_step_executions', 'insert')[0].payload.length, 1);
});

test('5F1-B3 groupé : le compte d’un collègue arrête tout, une erreur du groupe sans refus aussi', async () => {
  const other = fakeClient((call) => {
    if (call.table !== 'sequence_enrollments' || call.op !== 'upsert') return undefined;
    if (Array.isArray(call.payload)) return { data: null, error: { code: '23505', hint: 'ENROLLMENT_GDPR_ERASED' } };
    return { data: null, error: { code: '42501', hint: 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' } };
  });
  const first = await silent(() => lib.enrollCandidates(options(other.supabase)));
  assert.equal(first.status, 'failed');
  assert.equal(first.error.hint, 'ENROLL_ACCOUNT_OF_OTHER_MEMBER');
  assert.equal(writes(other.calls, 'sequence_enrollments', 'upsert').length, 2, 'arrêt au premier refus du compte');
  assert.equal(writes(other.calls, 'sequence_step_executions', 'insert').length, 0);

  const generic = fakeClient((call) => (call.op === 'upsert' ? { data: null, error: { code: '08006', message: 'réseau' } } : undefined));
  const second = await silent(() => lib.enrollCandidates(options(generic.supabase)));
  assert.equal(second.status, 'failed');
  assert.equal(writes(generic.calls, 'sequence_enrollments', 'upsert').length, 1, 'pas de reprise sans refus typé');
});

test('5F1-B4 groupé : première exécution refusée, tout le lot est retiré et aucun succès n’est annoncé', async () => {
  const { supabase, calls } = fakeClient((call) => (call.table === 'sequence_step_executions' ? { error: { code: '42501' } } : undefined));
  const outcome = await silent(() => lib.enrollCandidates(options(supabase)));
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.results.success, 0);
  assert.deepEqual(outcome.schedulingFailure, { rolledBack: true });
  assert.deepEqual(outcome.enrolledIds, []);
  assert.equal(outcome.results.errors[0], "L'inscription a échoué : aucune étape n'a pu être planifiée. Aucun message ne partira. Réessayez.");
  const removal = writes(calls, 'sequence_enrollments', 'delete');
  assert.equal(removal.length, 1);
  assert.deepEqual(removal[0].in, [['id', ['enr-ACo1', 'enr-ACo2', 'enr-ACo3']]]);

  const partial = fakeClient((call) => {
    if (call.table === 'sequence_step_executions') return { error: { code: '42501' } };
    if (call.op === 'delete') return { data: [{ id: 'enr-ACo1' }], error: null };
    return undefined;
  });
  const kept = await silent(() => lib.enrollCandidates(options(partial.supabase)));
  assert.deepEqual(kept.schedulingFailure, { rolledBack: false });
  assert.equal(kept.results.errors[0], "Des inscriptions ont été créées sans étape ; elles démarreront dans l'heure.");
});

test('5F1-B4b groupé : un retrait complet ne laisse aucune réinscription à signaler', async () => {
  const longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
  const former = { profile_id: 'ancien', provider_id: 'ACw1', resolved_profile_id: null, profile_url: null, status: 'completed', completed_at: longAgo, replied_at: null, updated_at: longAgo };
  const script = (removed) => (call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [former], error: null };
    if (call.table === 'sequence_step_executions') return { error: { code: '42501' } };
    if (call.op === 'delete') return { data: removed(call), error: null };
    return undefined;
  };
  const ok = fakeClient(script((call) => call.in[0][1].map((id) => ({ id }))));
  const gone = await silent(() => lib.enrollCandidates(options(ok.supabase)));
  assert.deepEqual(gone.schedulingFailure, { rolledBack: true });
  assert.equal(gone.results.formerPassages, 0);

  // Retrait impossible : les inscriptions existent, la réinscription reste signalée.
  const stuck = fakeClient(script(() => []));
  const kept = await silent(() => lib.enrollCandidates(options(stuck.supabase)));
  assert.deepEqual(kept.schedulingFailure, { rolledBack: false });
  assert.equal(kept.results.formerPassages, 1);
});

test('5F1-B5 sans première étape à planifier, l’inscription est retirée (groupé et un par un)', async () => {
  const noStep = { sequence: { id: 'seq-1', steps: [] } };
  const batch = fakeClient();
  const b = await silent(() => lib.enrollCandidates(options(batch.supabase, noStep)));
  assert.deepEqual(b.schedulingFailure, { rolledBack: true });
  assert.equal(writes(batch.calls, 'sequence_step_executions', 'insert').length, 0, 'aucune ligne d’exécution à écrire');
  assert.equal(writes(batch.calls, 'sequence_enrollments', 'delete').length, 1);

  const single = fakeClient();
  const s = await silent(() => lib.enrollCandidates(options(single.supabase, {
    ...noStep, mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}),
  })));
  assert.equal(s.status, 'done');
  assert.equal(s.results.success, 0);
  assert.equal(s.results.errors.length, 3);
  assert.equal(writes(single.calls, 'sequence_enrollments', 'delete').length, 3, 'chaque inscription créée est retirée');
});

test('5F1-B6 groupé : déjà inscrits, déjà passés et course comptés sans erreur', async () => {
  const existing = (status) => ({
    profile_id: 'ACo1', provider_id: 'ACw1', resolved_profile_id: null, profile_url: null, status,
    completed_at: new Date().toISOString(), replied_at: null, updated_at: new Date().toISOString(),
  });
  const people = [person(1), person(2), person(3)];
  const all = fakeClient((call) => {
    if (call.table !== 'sequence_enrollments' || call.op !== 'select') return undefined;
    return { data: people.map((p, i) => ({ ...existing(i === 0 ? 'completed' : 'active'), profile_id: p.id, provider_id: p.provider_id })), error: null };
  });
  const out = await lib.enrollCandidates(options(all.supabase, { candidates: people }));
  assert.equal(out.status, 'done');
  assert.equal(out.results.success, 0);
  assert.equal(out.results.alreadyPassed, 1);
  assert.equal(out.results.skipped, 2);
  assert.equal(all.calls.filter((c) => c.op !== 'select').length, 0, 'aucune écriture');

  const race = fakeClient((call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'upsert') {
      return { data: [{ id: 'enr-ACo1', profile_id: 'ACo1' }, { id: 'enr-ACo2', profile_id: 'ACo2' }], error: null };
    }
    return undefined;
  });
  const raced = await silent(() => lib.enrollCandidates(options(race.supabase)));
  assert.equal(raced.results.success, 2);
  assert.equal(raced.results.skipped, 1, 'inscrit entre-temps par une autre session');
  assert.equal(writes(race.calls, 'sequence_step_executions', 'insert')[0].payload.length, 2);
});

test('5F1-B7 refus sans écriture : session, séquence désactivée, aucun candidat, tous déjà contactés', async () => {
  const noUser = fakeClient(() => undefined, { user: null });
  const a = await lib.enrollCandidates(options(noUser.supabase));
  assert.deepEqual([a.status, a.message], ['refused', lib.SESSION_EXPIRED_MESSAGE]);

  const inactive = fakeClient((call) => (call.table === 'outreach_sequences' ? { data: { is_active: false }, error: null } : undefined));
  const b = await lib.enrollCandidates(options(inactive.supabase));
  assert.equal(b.status, 'refused');
  assert.equal(b.message, "Cette séquence est désactivée. Réactivez-la avant d'inscrire des candidats.");

  const missing = fakeClient((call) => (call.table === 'outreach_sequences' ? { data: null, error: null } : undefined));
  const c = await lib.enrollCandidates(options(missing.supabase));
  assert.equal(c.message, 'Cette séquence est introuvable. Rechargez la page, puis réessayez.');

  const none = fakeClient();
  const d = await lib.enrollCandidates(options(none.supabase, { candidates: [] }));
  assert.deepEqual([d.status, d.message], ['refused', 'AUCUN CANDIDAT']);

  const recent = new Map([['ACo1', { createdAt: new Date().toISOString() }], ['ACo2', {}], ['ACo3', {}]]);
  const e = await lib.enrollCandidates(options(none.supabase, { recentEnrollments: recent }));
  assert.deepEqual([e.status, e.message], ['refused', 'Tous les candidats ont déjà été contactés par votre organisation']);
  assert.equal(e.recentEnrollments, recent);

  const forced = await lib.enrollCandidates(options(none.supabase, { recentEnrollments: recent, allowDuplicates: true }));
  assert.equal(forced.status, 'done', 'la dérogation d’un administrateur passe l’anti-doublon de l’organisation');
  for (const client of [noUser, inactive, missing]) assert.equal(client.calls.filter((x) => x.op !== 'select').length, 0);
});

test('5F1-B8 anti-doublon relu ici quand l’écran ne l’a pas obtenu, échec fermé', async () => {
  const ok = fakeClient();
  const read = await lib.enrollCandidates(options(ok.supabase, { recentEnrollments: null }));
  assert.equal(read.status, 'done');
  assert.ok(read.recentEnrollments instanceof Map, 'rendu à l’écran pour son état');

  const failing = fakeClient((call) => (call.table === 'sequence_enrollments' && call.op === 'select' ? { data: null, error: { code: '500' } } : undefined));
  failing.supabase.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'absente' } });
  const failed = await silent(() => lib.enrollCandidates(options(failing.supabase, { recentEnrollments: null })));
  assert.equal(failed.status, 'failed', 'on n’inscrit jamais sans cette vérification');
  assert.equal(failed.recentEnrollments, null);
  assert.equal(failing.calls.filter((c) => c.op !== 'select').length, 0);
});

test('5F1-B9 même personne sous deux identifiants : une inscription, l’autre comptée déjà dans la séquence', async () => {
  const a = person(1);
  const b = person(2, { provider_id: a.provider_id });
  for (const mode of ['batch', 'one_by_one']) {
    const { supabase, calls } = fakeClient();
    const extra = mode === 'one_by_one' ? { messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}) } : {};
    const out = await lib.enrollCandidates(options(supabase, { candidates: [a, b], mode, ...extra }));
    assert.equal(out.results.success, 1, mode);
    assert.equal(out.results.skipped, 1, mode);
    assert.equal(writes(calls, 'sequence_step_executions', 'insert').length, 1, mode);
  }
});

test('5F1-O1 un par un : retouches lues au moment du candidat, tracking_data seulement s’il y en a, progression', async () => {
  const { supabase, calls } = fakeClient();
  const log = [];
  const base = options(supabase, {
    mode: 'one_by_one',
    messageOverridesFor: (id) => {
      log.push(`overrides:${id}`);
      return id === 'ACo2' ? { 'step-1': { subject: 's', message: 'm', isEdited: true } } : {};
    },
    stepConfigOverrides: () => ({}),
    onProgress: (done, total) => log.push(`progress:${done}/${total}`),
  });
  const original = supabase.from;
  supabase.from = (table) => {
    const chain = original(table);
    const last = calls[calls.length - 1];
    if (table === 'sequence_enrollments' || table === 'sequence_step_executions') log.push(`from:${table}`);
    void last;
    return chain;
  };
  const out = await lib.enrollCandidates(base);
  assert.equal(out.status, 'done');
  assert.equal(out.results.success, 3);

  const upserts = writes(calls, 'sequence_enrollments', 'upsert');
  assert.equal(upserts.length, 3, 'une écriture par candidat');
  assert.ok(upserts.every((u) => u.single && u.cols === 'id, profile_id'));
  assert.ok(!('tracking_data' in upserts[0].payload), 'pas de retouche : colonne non envoyée');
  assert.deepEqual(upserts[1].payload.tracking_data, { message_overrides: { 'step-1': { subject: 's', message: 'm', isEdited: true } } });
  assert.ok(!('tracking_data' in upserts[2].payload));
  assert.equal(writes(calls, 'sequence_step_executions', 'insert').length, 3, 'une exécution par candidat');

  assert.deepEqual(log.filter((l) => l.startsWith('progress:')), ['progress:1/3', 'progress:2/3', 'progress:3/3']);
  const order = log.filter((l) => l.startsWith('overrides:') || l.startsWith('from:sequence_step_executions'));
  assert.deepEqual(order, [
    'overrides:ACo1', 'from:sequence_step_executions',
    'overrides:ACo2', 'from:sequence_step_executions',
    'overrides:ACo3', 'from:sequence_step_executions',
  ], 'la retouche d’un candidat est lue après l’inscription du précédent');
});

test('5F1-O2 un par un : réglages de délai par étape écrits et appliqués à la première exécution', async () => {
  const { supabase, calls } = fakeClient();
  const step = { ...STEP, delay_days: 1, delay_hours: 2, delay_minutes: 30 };
  const before = Date.now();
  await lib.enrollCandidates(options(supabase, {
    candidates: [person(1)],
    sequence: { id: 'seq-1', steps: [step] },
    mode: 'one_by_one',
    messageOverridesFor: () => ({}),
    stepConfigOverrides: () => ({ 'step-1': { delayDays: 3, delayHours: 0 }, 'autre': { delayDays: 9 } }),
  }));
  const upsert = writes(calls, 'sequence_enrollments', 'upsert')[0];
  assert.deepEqual(upsert.payload.tracking_data.step_config_overrides, { 'step-1': { delayDays: 3, delayHours: 0 }, 'autre': { delayDays: 9 } });
  const at = new Date(writes(calls, 'sequence_step_executions', 'insert')[0].payload.scheduled_at).getTime();
  const expected = 3 * 86400000 + 30 * 60000;
  assert.ok(at >= before + expected - 1000 && at <= Date.now() + expected + 1000, 'maintenant + 3 jours + 30 minutes, sans fenêtre horaire');
});

test('5F1-O3 un par un : l’exécution refusée retire ce candidat seul, les autres restent inscrits', async () => {
  const { supabase, calls } = fakeClient((call) => {
    if (call.table === 'sequence_step_executions' && call.payload.enrollment_id === 'enr-ACo2') return { error: { code: '42501' } };
    if (call.op === 'delete' && call.eq.some(([, v]) => v === 'enr-ACo2')) return { data: [], error: null };
    return undefined;
  });
  const out = await silent(() => lib.enrollCandidates(options(supabase, {
    mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}),
  })));
  assert.equal(out.results.success, 2);
  assert.deepEqual(out.enrolledIds, ['ACo1', 'ACo3']);
  assert.deepEqual(out.results.errors, ["Candidat 2 : les étapes n'ont pas pu être planifiées et l'inscription n'a pas pu être retirée. Retirez-la depuis le suivi de la séquence."]);
  assert.equal(out.schedulingFailure, undefined, 'pas d’échec global pour un échec par candidat');

  const removed = fakeClient((call) => (call.table === 'sequence_step_executions' && call.payload.enrollment_id === 'enr-ACo1' ? { error: { code: '42501' } } : undefined));
  const again = await silent(() => lib.enrollCandidates(options(removed.supabase, {
    mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}),
  })));
  assert.deepEqual(again.results.errors, ["Candidat 1 : les étapes n'ont pas pu être planifiées, candidat non inscrit."]);
  assert.deepEqual(writes(removed.calls, 'sequence_enrollments', 'delete').map((d) => d.eq), [[['id', 'enr-ACo1']]]);
});

test('5F1-O4 un par un : refus propres au candidat comptés à part, compte d’un collègue arrête la boucle', async () => {
  const people = [person(1), person(2), person(3), person(4)];
  const refusals = fakeClient((call) => {
    if (call.table !== 'sequence_enrollments' || call.op !== 'upsert') return undefined;
    if (call.payload.profile_id === 'ACo2') return { data: null, error: { code: '42501', hint: 'ENROLLMENT_GDPR_ERASED' } };
    if (call.payload.profile_id === 'ACo3') return { data: null, error: { code: '23505', hint: 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE' } };
    if (call.payload.profile_id === 'ACo4') return { data: null, error: { code: '500' } };
    return undefined;
  });
  const out = await silent(() => lib.enrollCandidates(options(refusals.supabase, {
    candidates: people, mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}),
  })));
  assert.equal(out.results.success, 1);
  assert.deepEqual(out.results.gdprErased, ['Candidat 2']);
  assert.deepEqual(out.results.samePerson, ['Candidat 3']);
  assert.deepEqual(out.results.errors, ['Inscription impossible pour Candidat 4. Réessayez ou contactez le support.']);

  const other = fakeClient((call) => (call.op === 'upsert' && call.payload.profile_id === 'ACo2'
    ? { data: null, error: { code: '42501', hint: 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' } } : undefined));
  const stopped = await silent(() => lib.enrollCandidates(options(other.supabase, {
    mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}),
  })));
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.results.success, 1, 'ce qui était inscrit avant l’arrêt reste compté');
  assert.deepEqual(stopped.enrolledIds, ['ACo1']);
  assert.equal(writes(other.calls, 'sequence_enrollments', 'upsert').length, 2, 'le troisième candidat n’est pas tenté');
});

test('5F1-O5 un par un : déjà dans la séquence, déjà passé, conflit absorbé, ancien passage signalé', async () => {
  const row = (p, status, extra = {}) => ({
    profile_id: p.id, provider_id: p.provider_id, resolved_profile_id: null, profile_url: null, status,
    completed_at: new Date().toISOString(), replied_at: null, updated_at: new Date().toISOString(), ...extra,
  });
  const people = [person(1), person(2), person(3), person(4)];
  const longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
  const { supabase } = fakeClient((call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'select') {
      const clause = String(call.cols);
      void clause;
      return { data: [row(people[0], 'active'), row(people[1], 'completed'), row({ id: 'ancien', provider_id: people[3].provider_id }, 'completed', { completed_at: longAgo, updated_at: longAgo })], error: null };
    }
    if (call.op === 'upsert' && call.payload.profile_id === 'ACo3') return { data: null, error: null };
    return undefined;
  });
  const out = await lib.enrollCandidates(options(supabase, {
    candidates: people, mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}),
  }));
  assert.equal(out.results.skipped, 2, 'une inscription en cours, un conflit absorbé');
  assert.equal(out.results.alreadyPassed, 1);
  assert.equal(out.results.success, 1);
  assert.equal(out.results.formerPassages, 1, 'sortie de la séquence il y a plus de 90 jours sous un autre identifiant');
});

test('5F1-T1 première exécution : fenêtre d’envoi du candidat ou délai brut, selon le mode choisi', async () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hourIn = (iso) => parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(iso)), 10) % 24;
  const step = { ...STEP, delay_hours: 5, preferred_hour_start: 10, preferred_hour_end: 12 };
  const windowed = fakeClient();
  await lib.enrollCandidates(options(windowed.supabase, { sequence: { id: 'seq-1', steps: [step] }, firstStepTiming: 'business_hours' }));
  for (const e of writes(windowed.calls, 'sequence_step_executions', 'insert')[0].payload) {
    const hour = hourIn(e.scheduled_at);
    assert.ok(hour >= 10 && hour < 12, `heure locale ${hour} dans la fenêtre 10-12`);
  }
  const raw = fakeClient();
  const before = Date.now();
  await lib.enrollCandidates(options(raw.supabase, { sequence: { id: 'seq-1', steps: [step] }, firstStepTiming: 'raw' }));
  for (const e of writes(raw.calls, 'sequence_step_executions', 'insert')[0].payload) {
    const at = new Date(e.scheduled_at).getTime();
    assert.ok(at >= before + 5 * 3600000 - 1000 && at <= Date.now() + 5 * 3600000 + 1000);
  }
});

test('5F1-T2 chaque inscription tire sa première étape (test A/B en première position)', async () => {
  const steps = [
    { id: 'A', step_order: 0, variant_group: 'A', variant_weight: 50, action_type: 'message' },
    { id: 'B', step_order: 0, variant_group: 'B', variant_weight: 50, action_type: 'message' },
  ];
  const seen = new Set();
  const realRandom = Math.random;
  let n = 0;
  Math.random = () => (n++ % 2 === 0 ? 0.1 : 0.9);
  try {
    const { supabase, calls } = fakeClient();
    await lib.enrollCandidates(options(supabase, { sequence: { id: 'seq-1', steps } }));
    for (const e of writes(calls, 'sequence_step_executions', 'insert')[0].payload) seen.add(`${e.step_id}:${e.variant_assigned}`);
  } finally {
    Math.random = realRandom;
  }
  assert.ok(seen.has('A:A') && seen.has('B:B'), `les deux variantes sont tirées : ${[...seen].join(', ')}`);
});

// ---------------------------------------------------------------- revue indépendante : contrôles ajoutés
const KEYS = ['sequence_id','account_id','profile_id','profile_name','profile_headline','profile_url','job_id','job_title','created_by','user_timezone','current_step_order','status','network_distance','organization_id','provider_id','email_used','phone_used'];
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const expectedRow = (n) => ({
  sequence_id: 'seq-1', account_id: 'acc-1', profile_id: `ACo${n}`, profile_name: `Candidat ${n}`, profile_headline: `Poste ${n}`,
  profile_url: `https://www.linkedin.com/in/candidat-${n}`, job_id: MISSION, job_title: 'Poste cible', created_by: 'user-1', user_timezone: tz,
  current_step_order: 0, status: 'active', network_distance: 'SECOND_DEGREE', organization_id: 'org-1',
  provider_id: `ACw${n}`, email_used: `candidat${n}@exemple.fr`, phone_used: null,
});
const OPTS = { onConflict: 'sequence_id,profile_id', ignoreDuplicates: true };
const oneByOne = { mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}) };

test('5F1-R1 ligne d’inscription complète, identique dans les deux modes', async () => {
  for (const extra of [{}, oneByOne]) {
    const { supabase, calls } = fakeClient();
    await lib.enrollCandidates(options(supabase, { candidates: [person(1), person(2)], ...extra }));
    const rows = writes(calls, 'sequence_enrollments', 'upsert').flatMap((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]));
    assert.equal(rows.length, 2);
    rows.forEach((r, i) => assert.deepEqual(r, expectedRow(i + 1), extra.mode ?? 'batch'));
  }
});

test('5F1-R2 chaque écriture d’inscription porte onConflict + ignoreDuplicates et relit ses lignes (.select)', async () => {
  const people = [person(1), person(2), person(3)];
  const refuse = fakeClient((call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'upsert' && Array.isArray(call.payload)) return { data: null, error: { code: '23505', hint: 'ENROLLMENT_GDPR_ERASED' } };
    return undefined;
  });
  await silent(() => lib.enrollCandidates(options(refuse.supabase, { candidates: people })));
  const batch = fakeClient();
  await lib.enrollCandidates(options(batch.supabase, { candidates: people }));
  const single = fakeClient();
  await lib.enrollCandidates(options(single.supabase, { candidates: people, ...oneByOne }));
  for (const { calls } of [refuse, batch, single]) {
    const upserts = writes(calls, 'sequence_enrollments', 'upsert');
    assert.ok(upserts.length >= 1);
    for (const u of upserts) {
      assert.deepEqual(u.options, OPTS);
      assert.equal(u.cols, 'id, profile_id');
    }
  }
});

test('5F1-R3 retrait vérifié : chaque suppression d’inscription relit les lignes retirées (.select)', async () => {
  const fail = (call) => (call.table === 'sequence_step_executions' ? { error: { code: '42501' } } : undefined);
  const batch = fakeClient(fail);
  const b = await silent(() => lib.enrollCandidates(options(batch.supabase)));
  assert.deepEqual(b.schedulingFailure, { rolledBack: true });
  const single = fakeClient(fail);
  await silent(() => lib.enrollCandidates(options(single.supabase, oneByOne)));
  for (const { calls } of [batch, single]) {
    const deletes = writes(calls, 'sequence_enrollments', 'delete');
    assert.ok(deletes.length >= 1);
    for (const d of deletes) assert.equal(d.cols, 'id');
  }
});

test('5F1-R4 groupé : une sélection partiellement inscrite n’envoie à l’écriture que les nouveaux', async () => {
  const people = [person(1), person(2), person(3), person(4)];
  const existing = (p, status) => ({ profile_id: p.id, provider_id: p.provider_id, resolved_profile_id: null, profile_url: null, status, completed_at: new Date().toISOString(), replied_at: null, updated_at: new Date().toISOString() });
  const { supabase, calls } = fakeClient((call) => (call.table === 'sequence_enrollments' && call.op === 'select'
    ? { data: [existing(people[0], 'active'), existing(people[1], 'completed')], error: null } : undefined));
  const out = await lib.enrollCandidates(options(supabase, { candidates: people }));
  assert.deepEqual(writes(calls, 'sequence_enrollments', 'upsert')[0].payload.map((r) => r.profile_id), ['ACo3', 'ACo4']);
  assert.equal(out.results.success, 2);
  assert.equal(out.results.skipped, 1);
  assert.equal(out.results.alreadyPassed, 1);
  assert.deepEqual(writes(calls, 'sequence_step_executions', 'insert')[0].payload.map((e) => e.enrollment_id), ['enr-ACo3', 'enr-ACo4']);
});

test('5F1-R5 groupé : tous refusés par la base ou perdus à la course, aucune exécution écrite et aucun échec de planification', async () => {
  const refused = fakeClient((call) => {
    if (call.table !== 'sequence_enrollments' || call.op !== 'upsert') return undefined;
    return { data: null, error: { code: '42501', hint: 'ENROLLMENT_GDPR_ERASED' } };
  });
  const a = await silent(() => lib.enrollCandidates(options(refused.supabase)));
  assert.equal(a.results.gdprErased.length, 3);
  assert.equal(a.schedulingFailure, undefined);
  assert.equal(writes(refused.calls, 'sequence_step_executions', 'insert').length, 0);
  const raced = fakeClient((call) => (call.table === 'sequence_enrollments' && call.op === 'upsert' ? { data: [], error: null } : undefined));
  const b = await silent(() => lib.enrollCandidates(options(raced.supabase)));
  assert.equal(b.schedulingFailure, undefined);
  assert.equal(b.results.skipped, 3);
  assert.equal(writes(raced.calls, 'sequence_step_executions', 'insert').length, 0);
  assert.equal(writes(raced.calls, 'sequence_enrollments', 'delete').length, 0);
});

test('5F1-R6 mission : identifiant sans préfixe gardé, absence de mission = colonnes vides', async () => {
  const plain = fakeClient();
  await lib.enrollCandidates(options(plain.supabase, { job: { id: MISSION, title: 'T' } }));
  assert.equal(writes(plain.calls, 'sequence_enrollments', 'upsert')[0].payload[0].job_id, MISSION);
  const none = fakeClient();
  await lib.enrollCandidates(options(none.supabase, { job: null }));
  const row = writes(none.calls, 'sequence_enrollments', 'upsert')[0].payload[0];
  assert.equal(row.job_id, undefined);
  assert.equal(row.job_title, undefined);
});

test('5F1-R7 la bibliothèque n’appelle aucune fonction serveur (rpc) hors lectures d’anti-doublon', async () => {
  for (const extra of [{}, oneByOne]) {
    const { supabase, rpcCalls } = fakeClient();
    await lib.enrollCandidates(options(supabase, { recentEnrollments: null, ...extra }));
    assert.deepEqual(rpcCalls.map((c) => c.fn).filter((fn) => fn !== 'find_recent_org_contacts'), []);
  }
  assert.doesNotMatch(read(LIB), /\.rpc\(/);
});

test('5F1-R8 un par un : les réglages de délai sont relus pour chaque candidat', async () => {
  const log = [];
  const { supabase } = fakeClient();
  await lib.enrollCandidates(options(supabase, { ...oneByOne, stepConfigOverrides: () => { log.push('config'); return {}; }, messageOverridesFor: (id) => { log.push(id); return {}; } }));
  assert.deepEqual(log, ['ACo1', 'config', 'ACo2', 'config', 'ACo3', 'config']);
});

test('5F1-R9 anti-doublon relu sur toute la sélection, pas seulement les compatibles', async () => {
  const all = [person(1), person(2), person(3), person(9)];
  const seen = [];
  const { supabase } = fakeClient();
  const original = supabase.rpc;
  supabase.rpc = async (fn, args) => { seen.push(JSON.stringify(args)); return original(fn, args); };
  await lib.enrollCandidates(options(supabase, { allProfiles: all, candidates: all.slice(0, 3), recentEnrollments: null }));
  assert.ok(seen.some((s) => s.includes('ACw9') || s.includes('candidat-9')), seen.join(' | '));
});

// ---------------------------------------------------------------- règle Retenu
const jcsRows = (calls) => writes(calls, 'job_candidate_status', 'upsert').flatMap((c) => c.payload);
const asBatch = {};
const asSingle = { mode: 'one_by_one', messageOverridesFor: () => ({}), stepConfigOverrides: () => ({}) };

test('5F1-RT1 les candidats inscrits passent en Retenu : lignes créées sans colonne d\'étape, étape par set_candidate_stages', async () => {
  for (const extra of [asBatch, asSingle]) {
    resetStage();
    const { supabase, calls } = fakeClient();
    const out = await lib.enrollCandidates(options(supabase, extra));
    const mode = extra.mode ?? 'batch';
    assert.equal(out.status, 'done', mode);
    assert.deepEqual(out.retained, { saved: 3, failed: 0 }, mode);

    // Lecture sous les deux formes de job_id, sur les lignes de l'organisation, quel qu'en soit l'auteur :
    // jamais de seconde ligne à profil réduit pour un candidat que la mission a déjà (sourcé par un collègue).
    const read = calls.find((c) => c.table === 'job_candidate_status' && c.op === 'select');
    assert.deepEqual(read.in[0], ['job_id', [`project:${MISSION}`, MISSION]], mode);
    assert.deepEqual(read.eq, [['organization_id', 'org-1']], mode);
    assert.ok(!read.eq.some(([column]) => column === 'created_by'), `${mode} : aucune lecture réduite à mes lignes`);
    assert.deepEqual(read.in[1], ['candidate_id', ['ACo1', 'ACo2', 'ACo3']], mode);

    const rows = jcsRows(calls);
    assert.equal(rows.length, 3, mode);
    for (const row of rows) {
      assert.equal(row.job_id, `project:${MISSION}`, 'clé du Sourcing de mission, telle quelle');
      assert.equal(row.created_by, 'user-1');
      assert.equal(row.organization_id, 'org-1');
      for (const key of ['status', 'pipeline_stage', 'general_stage', 'project_id', 'score']) assert.ok(!(key in row), `${mode} : pas de colonne « ${key} »`);
    }
    const upsert = writes(calls, 'job_candidate_status', 'upsert')[0];
    assert.deepEqual(upsert.options, { onConflict: 'job_id,candidate_id,created_by' });
    assert.equal(upsert.cols, 'id');

    assert.equal(stageCalls.length, 1, mode);
    assert.equal(stageCalls[0].fn, 'set_candidate_stages');
    assert.equal(stageCalls[0].args.p_stage, 'retained');
    assert.equal(stageCalls[0].args.p_source, 'user');
    assert.deepEqual(stageCalls[0].args.p_from_stages, ['to_sort', 'rejected']);
    assert.deepEqual(stageCalls[0].args.p_ids, ['jcs-ACo1', 'jcs-ACo2', 'jcs-ACo3']);
  }
});

test('5F1-RT2 seuls les candidats réellement inscrits passent en Retenu, une ligne existante est reprise', async () => {
  resetStage();
  const people = [person(1), person(2), person(3), person(4)];
  const existing = (p, status) => ({ profile_id: p.id, provider_id: p.provider_id, resolved_profile_id: null, profile_url: null, status, completed_at: new Date().toISOString(), replied_at: null, updated_at: new Date().toISOString() });
  const { supabase, calls } = fakeClient((call) => {
    // ACo1 est déjà dans la séquence, ACo2 est refusé par la base (profil effacé).
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [existing(people[0], 'active')], error: null };
    if (call.table === 'sequence_enrollments' && call.op === 'upsert' && Array.isArray(call.payload)) return { data: null, error: { code: '42501', hint: 'ENROLLMENT_GDPR_ERASED' } };
    if (call.table === 'sequence_enrollments' && call.op === 'upsert' && call.payload.profile_id === 'ACo2') return { data: null, error: { code: '42501', hint: 'ENROLLMENT_GDPR_ERASED' } };
    // ACo3 a déjà une ligne dans la mission : reprise, jamais doublée.
    if (call.table === 'job_candidate_status' && call.op === 'select') return { data: [{ id: 'jcs-existante', candidate_id: 'ACo3' }], error: null };
    return undefined;
  });
  const out = await silent(() => lib.enrollCandidates(options(supabase, { candidates: people })));
  assert.deepEqual(out.enrolledIds, ['ACo3', 'ACo4']);
  assert.deepEqual(jcsRows(calls).map((r) => r.candidate_id), ['ACo4'], 'ni l\'inscrit d\'avant, ni le refusé, ni la ligne reprise');
  assert.deepEqual(stageCalls[0].args.p_ids, ['jcs-existante', 'jcs-ACo4']);
  assert.deepEqual(out.retained, { saved: 2, failed: 0 });
});

test('5F1-RT3 sans mission ou sans inscription réussie, aucune écriture dans le pipeline', async () => {
  resetStage();
  const noJob = fakeClient();
  const a = await lib.enrollCandidates(options(noJob.supabase, { job: null }));
  assert.equal(a.status, 'done');
  assert.equal(a.retained, undefined);

  const failedExec = fakeClient((call) => (call.table === 'sequence_step_executions' ? { error: { code: '42501' } } : undefined));
  const b = await silent(() => lib.enrollCandidates(options(failedExec.supabase)));
  assert.deepEqual(b.schedulingFailure, { rolledBack: true });
  assert.equal(b.retained, undefined, 'un lot retiré ne devient pas Retenu');

  const alreadyIn = fakeClient((call) => (call.table === 'sequence_enrollments' && call.op === 'select'
    ? { data: [person(1), person(2), person(3)].map((p) => ({ profile_id: p.id, provider_id: p.provider_id, resolved_profile_id: null, profile_url: null, status: 'active', completed_at: null, replied_at: null, updated_at: new Date().toISOString() })), error: null }
    : undefined));
  const c = await lib.enrollCandidates(options(alreadyIn.supabase));
  assert.equal(c.retained, undefined);
  for (const client of [noJob, failedExec, alreadyIn]) {
    assert.ok(client.calls.every((x) => x.table !== 'job_candidate_status'), 'aucune lecture ni écriture de ligne de mission');
  }
  assert.equal(stageCalls.length, 0);
});

test('5F1-RT4 un échec de Retenu ne défait pas l\'inscription et se dit', async () => {
  // Étape refusée par la base.
  resetStage(() => ({ data: null, error: { code: '42501', hint: 'STAGE_SOURCE_FORBIDDEN', message: 'refus' } }));
  const refused = fakeClient();
  const a = await silent(() => lib.enrollCandidates(options(refused.supabase)));
  assert.equal(a.status, 'done');
  assert.equal(a.results.success, 3);
  assert.deepEqual(a.retained, { saved: 0, failed: 3 });
  assert.equal(writes(refused.calls, 'sequence_enrollments', 'delete').length, 0, 'aucun retrait');

  // Création des lignes refusée.
  resetStage();
  const rowsRefused = fakeClient((call) => (call.table === 'job_candidate_status' && call.op === 'upsert' ? { data: null, error: { code: '42501' } } : undefined));
  const b = await silent(() => lib.enrollCandidates(options(rowsRefused.supabase, asSingle)));
  assert.equal(b.status, 'done');
  assert.equal(b.results.success, 3);
  assert.deepEqual(b.retained, { saved: 0, failed: 3 });
  assert.equal(stageCalls.length, 0, 'sans ligne, pas d\'appel d\'étape');

  // Candidats déjà plus loin que Retenu : laissés à leur étape, ni compté retenu ni compté en échec.
  resetStage((args) => ({ data: args.p_ids.map((id) => ({ id, result: 'skipped', changed: false })), error: null }));
  const further = fakeClient();
  const c = await lib.enrollCandidates(options(further.supabase));
  assert.deepEqual(c.retained, { saved: 0, failed: 0 });
});

test('5F1-RT5 un par un : un candidat dont la planification échoue (retiré) n\'est pas retenu', async () => {
  resetStage();
  const { supabase, calls } = fakeClient((call) => (call.table === 'sequence_step_executions' && call.payload.enrollment_id === 'enr-ACo2' ? { error: { code: '42501' } } : undefined));
  const out = await silent(() => lib.enrollCandidates(options(supabase, asSingle)));
  assert.deepEqual(out.enrolledIds, ['ACo1', 'ACo3']);
  assert.deepEqual(jcsRows(calls).map((r) => r.candidate_id), ['ACo1', 'ACo3']);
  assert.deepEqual(out.retained, { saved: 2, failed: 0 });
});
