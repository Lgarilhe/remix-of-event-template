/**
 * Audit des séquences (2026-09-25), lot F3, dernière passe : relecture ciblée
 * de la vague finale.
 *  - Journal : refus D3 (403) de skip_execution affiché avec la phrase du
 *    serveur, sans « Réessayez » ; « Ne pas envoyer » masqué à un
 *    collaborateur pour les candidats d'un collègue.
 *  - Fiche candidat et pipeline : pause de séquence restée en place alors que
 *    la séquence est de nouveau active, reprise proposée.
 *  - Fiche candidat : « Marquer comme ayant répondu », même dialogue et même
 *    bilan (stopped_siblings) que le suivi des inscrits.
 *
 * Fonctions extraites des fichiers, transpilées en mémoire par esbuild et
 * exécutées avec de fausses dépendances.
 * Lancer : node --test tests/ux/seq-audit-f3-last.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const importTs = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const lib = await importTs('src/lib/sequenceErrorMessages.ts');
const labels = await importTs('src/lib/sequenceLabels.ts');

/** Retire les commentaires de bloc, JSX et de ligne (hors chaînes d'URL). */
const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;{}),])\s*\/\/[^\n'"`]*$/gm, '$1');

const activityLog = stripComments(read('src/components/outreach/SequenceActivityLog.tsx'));
const candidatePanel = stripComments(read('src/components/outreach/CandidateSequencesPanel.tsx'));
const candidateHook = stripComments(read('src/hooks/useCandidateEnrollments.ts'));
const pipelineTable = stripComments(read('src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx'));
const enrollmentsPanel = stripComments(read('src/components/outreach/SequenceEnrollmentsPanel.tsx'));
const engine = read('supabase/functions/process-sequences/index.ts');
const invoke = read('src/lib/invokeEdgeFunction.ts');

/** Corps entre accolades équilibrées à partir de la première `{` qui suit `from`. */
function braced(src, from) {
  const open = src.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('fin de bloc introuvable');
}

/** `const name = (async)? (...) => { ... }` (le cas échéant enveloppé dans useCallback), rendu comme flèche nue. */
function arrow(src, name) {
  const start = src.search(new RegExp(`const ${name} = (useCallback\\()?(async )?\\(`));
  assert.ok(start !== -1, `fonction ${name} introuvable`);
  const head = src.slice(start, src.indexOf('=>', start) + 2).replace('useCallback(', '');
  return `${head} ${braced(src, src.indexOf('=>', start))}`;
}

function load(code, name, deps) {
  const { code: js } = transformSync(`${code}\nmodule.exports = ${name};`, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  const names = Object.keys(deps);
  new Function(...names, 'module', 'exports', js)(...names.map((n) => deps[n]), module, module.exports);
  return module.exports;
}
const extract = (src, name, deps = {}) => load(`${arrow(src, name)};`, name, deps);

/** Faux toast : chaque appel est noté { kind, title, options }. */
function fakeToast() {
  const calls = [];
  const record = (kind) => (title, options) => { calls.push({ kind, title, options }); return kind; };
  return {
    calls,
    toast: {
      success: record('success'), error: record('error'), warning: record('warning'),
      info: record('info'), loading: record('loading'), dismiss: record('dismiss'),
    },
  };
}
const quiet = { error: () => {}, warn: () => {}, log: () => {} };

/** Réponse d'invokeEdgeFunction pour un refus non-2xx : même construction que le helper. */
const refusal = (status, payload, friendly) => ({
  data: { ...payload, success: false, error: friendly },
  error: Object.assign(new Error(friendly), { status, ...(payload.error_code ? { code: payload.error_code } : {}) }),
});

const COLLABORATOR_ACTION_MESSAGE = 'Vous ne pouvez agir que sur les candidats que vous avez inscrits.';

// ---------------------------------------------------------------- 1-2. Journal : refus D3 de skip_execution
test('front-enroll-follow-4 / integration-5 — contrat : le 403 D3 porte sa phrase dans `message`, gardée par invokeEdgeFunction', () => {
  const skip = engine.slice(engine.indexOf('async function handleSkipExecution'), engine.indexOf('async function', engine.indexOf('async function handleSkipExecution') + 10));
  assert.match(skip, /return memberError\('forbidden', COLLABORATOR_ACTION_MESSAGE, 403\);/);
  assert.ok(engine.includes(`const COLLABORATOR_ACTION_MESSAGE = '${COLLABORATOR_ACTION_MESSAGE}';`));
  assert.match(engine, /function memberError\(code: string, message: string, status: number\): Response \{\s*return json200\(\{ success: false, error: code, error_code: code, message \}, status\);/);
  // Sur un non-2xx, le corps du serveur reste dans `data` (message compris), `error` est humanisé.
  assert.match(invoke, /const errorData = \{ \.\.\.\(payload \?\? \{\}\), success: false, error: friendlyMsg \};/);
});

test('front-enroll-follow-4 / integration-5 — un refus 403 affiche la phrase du serveur, sans inviter à réessayer', async () => {
  const run = async (response) => {
    const { toast, calls } = fakeToast();
    let refreshed = 0;
    const handleSkipExecution = extract(activityLog, 'handleSkipExecution', {
      toast, console: quiet, skipConflictMessage: lib.skipConflictMessage,
      setSkippingId: () => {}, fetchExecutions: () => { refreshed += 1; },
      invokeEdgeFunction: async () => response,
    });
    await handleSkipExecution('x1', 'Julie');
    return { calls, refreshed };
  };

  const forbidden = await run(refusal(403, { error: 'forbidden', error_code: 'forbidden', message: COLLABORATOR_ACTION_MESSAGE },
    "Accès refusé. Vous n'avez pas les permissions nécessaires."));
  assert.deepEqual(forbidden.calls, [{ kind: 'error', title: COLLABORATOR_ACTION_MESSAGE, options: undefined }]);
  assert.equal(forbidden.refreshed, 1, 'le Journal est relu');

  // 403 sans phrase (organisation introuvable) : le message humanisé, toujours sans « Réessayez ».
  const noMessage = await run(refusal(403, { error: 'Organisation introuvable pour cette étape' }, 'Organisation introuvable pour cette étape'));
  assert.deepEqual(noMessage.calls, [{ kind: 'error', title: 'Organisation introuvable pour cette étape', options: undefined }]);

  // Les autres cas ne changent pas : 409 et erreur passagère.
  const conflict = await run(refusal(409, { error: "Ce candidat n'est plus actif dans la séquence : reprenez-le avant de sauter une étape.", error_code: 'enrollment_not_active' },
    "Ce candidat n'est plus actif dans la séquence : reprenez-le avant de sauter une étape."));
  assert.equal(conflict.calls[0].title, "Ce candidat n'est plus actif dans la séquence : reprenez-le avant de sauter une étape.");
  const transient = await run(refusal(500, { error: 'Erreur serveur' }, 'Erreur serveur temporaire. Réessayez dans quelques instants.'));
  assert.equal(transient.calls[0].title, "L'étape n'a pas pu être retirée. Réessayez.");
  const ok = await run({ data: { success: true, next_step_order: 3 }, error: null });
  assert.deepEqual(ok.calls.map((c) => c.kind), ['success']);
});

test('front-enroll-follow-4 — « Ne pas envoyer » masqué à un collaborateur sur les candidats d’un collègue', () => {
  assert.match(activityLog, /sequence_enrollments!inner\(status, created_by, profile_name, profile_headline, profile_url, job_id, outreach_sequences\(name, is_active\)\)/);
  assert.match(activityLog, /created_by: enrollmentRel\.created_by,/);
  assert.match(activityLog, /const \{ isCollaborator \} = useOrganization\(\);\s*const \{ user \} = useAuthReady\(\);\s*const userId = user\?\.id \?\? null;/);
  // Même règle que le serveur (canActOnEnrollment) et que le suivi des inscrits.
  assert.match(activityLog, /const ownRow = !isCollaborator \|\| \(!!userId && exec\.enrollment\?\.created_by === userId\);/);
  assert.match(activityLog, /const canSkip = SKIPPABLE_STATUSES\.has\(exec\.status\) && !held && ownRow;/);
  assert.match(activityLog, /\{canSkip && \(\s*<Button[\s\S]*?Ne pas envoyer cette étape/);
});

// ---------------------------------------------------------------- 3. Pause de séquence dans une séquence de nouveau active
test('integration-6 — une pause de séquence dans une séquence active se reprend', () => {
  // Même liste que sequenceLabels (module sans import).
  for (const reason of labels.SEQUENCE_LEVEL_PAUSE_REASONS) {
    assert.equal(lib.isSequencePauseResumable('paused', reason, true), true, reason);
    assert.equal(lib.isSequencePauseResumable('paused', reason, false), false, `${reason}, séquence inactive (D1)`);
    assert.equal(lib.isSequencePauseResumable('paused', reason, null), false, `${reason}, état inconnu`);
    assert.equal(lib.isSequencePauseResumable('active', reason, true), false, `${reason}, pas en pause`);
  }
  for (const reason of ['manual', 'send_failed', 'account_disconnected', 'quota_reached', 'subscription_required', 'blocked_by_candidate', null]) {
    assert.equal(lib.isSequencePauseResumable('paused', reason, true), false, String(reason));
  }
  // Même phrase que le suivi des inscrits.
  assert.ok(enrollmentsPanel.includes(`const SEQUENCE_ACTIVE_AGAIN_HINT = '${lib.SEQUENCE_ACTIVE_AGAIN_HINT}';`));
  assert.equal(lib.SEQUENCE_ACTIVE_AGAIN_HINT, 'La séquence est de nouveau active : reprenez ce candidat.');
});

test('integration-6 — fiche candidat : is_active lu, aide juste et « Reprendre » proposé', () => {
  assert.match(candidateHook, /outreach_sequences \(id, name, is_active\),/);
  assert.match(candidateHook, /sequence_active: typeof sequence\?\.is_active === 'boolean' \? sequence\.is_active : null,/);
  assert.match(candidatePanel, /const sequencePauseResumable = isSequencePauseResumable\(enrollment\.status, enrollment\.pause_reason, enrollment\.sequence_active\);/);
  assert.match(candidatePanel, /: isPaused \? \(sequencePauseResumable \? SEQUENCE_ACTIVE_AGAIN_HINT : pauseReasonHint\(enrollment\.pause_reason\)\) : null;/);
  // Décision 31 : reprise possible calculée à part, réservée à l'auteur pour un collaborateur.
  assert.match(candidatePanel, /const resumable = isPaused && !gdprErased && \(!pauseReason \|\| RESUMABLE_PAUSE_REASONS\.has\(pauseReason\) \|\| sequencePauseResumable\);/);
  // Le bouton « Reprendre » (hors échec d'envoi) dépend de canResume.
  assert.match(candidatePanel, /\{canResume && pauseReason !== 'send_failed' && \(\s*<Button[\s\S]*?onClick=\{onResume\}/);
});

test('integration-6 — pipeline : is_active lu et pause de séquence reprise', () => {
  assert.match(pipelineTable, /\.select\('id, profile_id, status, pause_reason, created_at, outreach_sequences\(name, is_active\)'\)/);
  assert.match(pipelineTable, /sequence_active: typeof e\.outreach_sequences\?\.is_active === 'boolean' \? e\.outreach_sequences\.is_active : null,/);
  const start = pipelineTable.indexOf('const isResumableFromPipeline = (');
  assert.ok(start !== -1);
  const isResumableFromPipeline = load(pipelineTable.slice(start, pipelineTable.indexOf(';\n', start) + 1), 'isResumableFromPipeline', {
    isSequencePauseResumable: lib.isSequencePauseResumable,
  });
  const row = (pause_reason, sequence_active) => ({ id: 'e', status: 'paused', pause_reason, sequence_active, sequence_name: 'S', created_at: '' });
  assert.equal(isResumableFromPipeline(row('manual', true)), true);
  assert.equal(isResumableFromPipeline(row(null, false)), true, 'pause héritée sans raison');
  assert.equal(isResumableFromPipeline(row('sequence_inactive', true)), true);
  assert.equal(isResumableFromPipeline(row('auto_paused', true)), true);
  assert.equal(isResumableFromPipeline(row('sequence_inactive', false)), false, 'séquence toujours désactivée');
  assert.equal(isResumableFromPipeline(row('sequence_inactive', null)), false);
  assert.equal(isResumableFromPipeline(row('account_disconnected', true)), false);
});

// ---------------------------------------------------------------- Décision : « Marquer comme ayant répondu »
test('Décision — fiche candidat : même bilan que le suivi des inscrits (stopped_siblings)', async () => {
  const runHook = async (response) => {
    const { toast, calls } = fakeToast();
    const markReplied = extract(candidateHook, 'markReplied', {
      toast, console: quiet, setPendingId: () => {}, fetchEnrollments: async () => {},
      enrollments: [{ id: 'e1', profile_name: 'Alice' }],
      invokeEdgeFunction: async () => response,
    });
    await markReplied('e1');
    return calls;
  };
  const runPanel = async (response) => {
    const { toast, calls } = fakeToast();
    const markReplied = extract(enrollmentsPanel, 'markReplied', {
      toast, console: quiet, nameOf: () => 'Alice', fetchEnrollments: async () => {},
      invokeEdgeFunction: async () => response,
    });
    await markReplied('e1');
    return calls;
  };

  const cases = [
    { data: { success: true, changed: true, stopped_siblings: 2 }, error: null },
    { data: { success: true, changed: true, stopped_siblings: 1 }, error: null },
    { data: { success: true, changed: true, stopped_siblings: 0 }, error: null },
    { data: { success: true, changed: true, stopped_siblings: 1, warning: 'Réponse enregistrée.' }, error: null },
    { data: { success: true, changed: false, stopped_siblings: 0 }, error: null },
    refusal(403, { error: 'forbidden', error_code: 'forbidden', message: COLLABORATOR_ACTION_MESSAGE }, "Accès refusé. Vous n'avez pas les permissions nécessaires."),
  ];
  for (const response of cases) {
    assert.deepEqual(await runHook(response), await runPanel(response), JSON.stringify(response.data));
  }

  assert.deepEqual(await runHook(cases[0]), [{ kind: 'success', title: 'Réponse enregistrée pour Alice', options: { description: 'Les étapes restantes ont été annulées. Ses 2 autres séquences en cours ou en pause ont été arrêtées.' } }]);
  assert.equal((await runHook(cases[1]))[0].options.description, 'Les étapes restantes ont été annulées. Son autre séquence en cours ou en pause a été arrêtée.');
  assert.deepEqual(await runHook(cases[5]), [{ kind: 'error', title: 'La réponse n’a pas pu être enregistrée pour Alice', options: { description: COLLABORATOR_ACTION_MESSAGE } }]);
});

test('Décision — fiche candidat : même dialogue que le suivi des inscrits', () => {
  const sentences = [
    ' passera en « A répondu » et ses étapes restantes seront annulées. ',
    'Ses autres séquences encore en cours ou en pause, commencées avant la fin de celle-ci, seront aussi arrêtées.',
    'Ses autres séquences encore en cours ou en pause seront aussi arrêtées.',
    ' Utile si le candidat a répondu hors de Konekt (téléphone, en personne, etc.).',
  ];
  for (const s of sentences) {
    assert.ok(enrollmentsPanel.includes(s), `suivi des inscrits : ${s}`);
    assert.ok(candidatePanel.includes(s), `fiche candidat : ${s}`);
  }
  assert.match(candidatePanel, /<AlertDialogTitle>Marquer \{replyName\} comme ayant répondu \?<\/AlertDialogTitle>/);
  assert.match(candidatePanel, /confirmReply\?\.status === 'completed'/);
  assert.doesNotMatch(candidatePanel, /s'arrête définitivement pour ce candidat/, 'ancien texte retiré');
  assert.match(candidateHook, /profile_name: e\.profile_name \?\? null,/);
  // Décision 31 : l'auteur de l'inscription est lu avec elle.
  assert.match(candidateHook, /id, sequence_id, status, profile_name, created_by, pause_reason,/);
});
