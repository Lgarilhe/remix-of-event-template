/**
 * Audit séquences 2026-09-25, lot F2, vague finale — relecture contradictoire
 * de la liste des séquences et du suivi des inscrits, décisions D3, D5 et D6
 * du contrat.
 *
 * Les fonctions du composant sont extraites du fichier, transpilées en mémoire
 * par esbuild et exécutées avec un faux client Supabase : on vérifie ce
 * qu'elles écrivent et ce qu'elles affichent, pas seulement leur texte.
 * Lancer : node --test tests/ux/seq-audit-f2d.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Retire les commentaires de bloc, JSX et de ligne (hors chaînes d'URL). */
const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;{}),])\s*\/\/[^\n'"`]*$/gm, '$1');

const list = stripComments(read('src/components/outreach/SequencesList.tsx'));
const panel = stripComments(read('src/components/outreach/SequenceEnrollmentsPanel.tsx'));

/** Déclaration `const name = (async)? (...) => { ... }` complète (accolades équilibrées). */
function body(src, name) {
  const start = src.search(new RegExp(`const ${name} = (async )?\\(`));
  assert.ok(start !== -1, `fonction ${name} introuvable`);
  const open = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`fin de ${name} introuvable`);
}

/**
 * Transpile une fonction du composant et la renvoie, ses dépendances libres
 * (supabase, toast, setters…) fournies par `deps`.
 */
function extract(src, name, deps = {}) {
  const { code } = transformSync(`${body(src, name)};\nmodule.exports = ${name};`, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  const names = Object.keys(deps);
  new Function(...names, 'module', 'exports', code)(...names.map((n) => deps[n]), module, module.exports);
  return module.exports;
}

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

/**
 * Faux client Supabase : chaque requête garde la liste de ses appels
 * (`ops`) ; `resolve(chain)` donne le résultat quand elle est attendue.
 */
function fakeSupabase(resolve, extra = {}) {
  const calls = [];
  const builderFor = (chain) => {
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const result = resolve(chain);
          return (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
        }
        return (...args) => { chain.ops.push([prop, ...args]); return builder; };
      },
    });
    return builder;
  };
  const from = (table) => {
    const chain = { table, ops: [] };
    calls.push(chain);
    return builderFor(chain);
  };
  const rpc = (fn, args) => {
    const chain = { table: `rpc:${fn}`, ops: [['rpc', args]] };
    calls.push(chain);
    return builderFor(chain);
  };
  return { calls, supabase: { from, rpc, ...extra } };
}

const op = (chain, name) => chain.ops.find((o) => o[0] === name);
const candidats = (n) => `${n} candidat${n > 1 ? 's' : ''}`;
const quiet = { error: () => {}, log: () => {}, warn: () => {} };

// ---------------------------------------------------------------- 1. front-editor-list-1 (critical, D3)
test('front-editor-list-1 — désactivation : pause partielle, la séquence reste active et le dit', async () => {
  const { supabase, calls } = fakeSupabase((chain) => {
    const update = op(chain, 'update');
    if (chain.table === 'sequence_enrollments' && update) {
      return { data: Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` })), count: 5, error: null };
    }
    if (chain.table === 'sequence_enrollments') return { count: 35, error: null };
    return { data: [{ id: 'seq-1' }], error: null };
  });
  const { toast, calls: toasts } = fakeToast();
  const setSequences = () => assert.fail('la séquence ne doit pas être affichée désactivée');
  const deactivate = extract(list, 'deactivateSequence', {
    supabase, toast, candidats, setSequences, console: quiet,
    setTogglingId: () => {}, fetchSequences: () => {},
    enrollmentsPanelAction: (id) => ({ action: { label: 'Voir les inscrits', id } }),
  });
  await deactivate('seq-1');

  // Recompte systématique, même quand une partie des candidats a été mise en pause.
  const recount = calls.find((c) => c.table === 'sequence_enrollments' && !op(c, 'update'));
  assert.ok(recount, 'les candidats encore en cours doivent être recomptés');
  assert.deepEqual(op(recount, 'select'), ['select', 'id', { count: 'exact', head: true }]);
  // 35 candidats restent en cours : is_active n'est jamais écrit à false.
  assert.equal(calls.filter((c) => c.table === 'outreach_sequences').length, 0);
  assert.equal(toasts.filter((t) => t.kind === 'success').length, 0);
  const error = toasts.find((t) => t.kind === 'error');
  assert.equal(error.title, 'La séquence reste active');
  assert.match(error.options.description, /5 candidats sont bien en pause\. 35 candidats restent en cours et recevront encore des messages/);
  assert.deepEqual(error.options.action, { label: 'Voir les inscrits', id: 'seq-1' }, 'les candidats mis en pause se reprennent depuis la liste des inscrits');
});

test('front-editor-list-1 — désactivation : tout est en pause, is_active passe à false avec preuve', async () => {
  const { supabase, calls } = fakeSupabase((chain) => {
    if (chain.table === 'sequence_enrollments' && op(chain, 'update')) return { data: [{ id: 'e1' }], count: 1, error: null };
    if (chain.table === 'sequence_enrollments') return { count: 0, error: null };
    return { data: [{ id: 'seq-1' }], error: null };
  });
  const { toast, calls: toasts } = fakeToast();
  // Lot 5b : le succès est annoncé par le toast « Annuler » (offerUndo), dont
  // l'annulation ne reprend que les inscriptions rendues par l'écriture.
  const undoToasts = [];
  const undone = [];
  const deactivate = extract(list, 'deactivateSequence', {
    supabase, toast, candidats, console: quiet,
    setSequences: () => {}, setTogglingId: () => {}, fetchSequences: () => {},
    enrollmentsPanelAction: () => ({}),
    sequences: [{ id: 'seq-1', project_id: 'p1' }],
    sequencePauseToastTitle: (n) => `Séquence mise en pause : ${candidats(n)} en pause.`,
    offerUndo: (options) => { undoToasts.push(options); },
    undoSequencePause: async (...args) => { undone.push(args); },
  });
  await deactivate('seq-1');
  const seqUpdate = calls.find((c) => c.table === 'outreach_sequences');
  assert.deepEqual(op(seqUpdate, 'update'), ['update', { is_active: false }]);
  assert.ok(op(seqUpdate, 'select'), '.select(\'id\') pour détecter un refus');
  assert.equal(toasts.filter((t) => t.kind === 'error').length, 0);
  assert.equal(undoToasts.length, 1);
  assert.equal(undoToasts[0].title, 'Séquence mise en pause : 1 candidat en pause.');
  assert.equal(undoToasts[0].description, null, 'séquence de la mission : pas d’avis de partage');
  await undoToasts[0].onUndo();
  assert.deepEqual(undone, [['seq-1', ['e1']]], '« Annuler » ne reprend que les inscriptions mises en pause');
});

test('front-editor-list-1 — D3 : ni désactivation ni pause groupée proposées à un collaborateur', () => {
  assert.match(list, /const \{ organizationId, isCollaborator \} = useOrganization\(\);/);
  assert.match(list, /const deactivationLocked = \(seq: SequenceWithStats\) => seq\.is_active && isCollaborator;/);
  const toggle = body(list, 'requestToggle');
  assert.ok(toggle.indexOf('deactivationLocked(seq)') < toggle.indexOf('if (seq.is_active)'), 'refus avant tout comptage');
  // Plus de recompte conditionnel à « 0 ligne touchée ».
  assert.doesNotMatch(body(list, 'deactivateSequence'), /pausedCount === 0 && expectedActive/);
  // Panneau : pause (et reprise) groupées masquées pour un collaborateur.
  assert.match(panel, /const canBulkManage = !isCollaborator;/);
  assert.match(panel, /\{canBulkManage && activeCount > 0 && \(/);
});

test('front-editor-list-1 — pause groupée : il en reste en cours, jamais de succès', async () => {
  const { supabase } = fakeSupabase((chain) => {
    if (op(chain, 'update')) return { data: [{ id: 'e1' }, { id: 'e2' }], count: 2, error: null };
    return { count: 3, error: null };
  });
  const { toast, calls: toasts } = fakeToast();
  const offers = [];
  const bulkStop = extract(panel, 'bulkStopActive', {
    supabase, toast, sequenceId: 'seq-1', fetchEnrollments: async () => {}, console: quiet,
    offerUndoPause: (options) => { offers.push(options); },
  });
  await bulkStop();
  assert.equal(toasts.filter((t) => t.kind === 'success').length, 0);
  // Lot 5b : le résultat partiel est dit en avertissement, avec « Annuler » pour
  // les seules inscriptions mises en pause.
  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, '2 candidats mis en pause, 3 encore en cours');
  assert.equal(offers[0].tone, 'warning');
  assert.match(offers[0].description, /3 candidats en cours recevront encore des messages/);
  assert.deepEqual(offers[0].enrollmentIds, ['e1', 'e2']);
});

test('front-editor-list-1 — pause groupée sans aucune mise en pause : erreur, ni succès ni « Annuler »', async () => {
  const { supabase } = fakeSupabase((chain) => {
    if (op(chain, 'update')) return { data: [], count: 0, error: null };
    return { count: 3, error: null };
  });
  const { toast, calls: toasts } = fakeToast();
  const offers = [];
  const bulkStop = extract(panel, 'bulkStopActive', {
    supabase, toast, sequenceId: 'seq-1', fetchEnrollments: async () => {}, console: quiet,
    offerUndoPause: (options) => { offers.push(options); },
  });
  await bulkStop();
  assert.equal(toasts.filter((t) => t.kind === 'success').length, 0);
  assert.deepEqual(offers, []);
  const error = toasts.find((t) => t.kind === 'error');
  assert.equal(error.title, 'Aucun candidat n’a été mis en pause');
  assert.match(error.options.description, /3 candidats en cours recevront encore des messages/);
});

// ---------------------------------------------------------------- 2, 7, 9. Dupliquer
function duplicateHarness({ stepsCreateError = null, manage = true } = {}) {
  const { supabase, calls } = fakeSupabase((chain) => {
    if (chain.table === 'sequence_steps') {
      return { data: [{ id: 's1', step_order: 0, action_type: 'wait_reply', timeout_days: null, wait_for_event: null }], error: null };
    }
    if (chain.table === 'rpc:save_sequence_steps') return { error: stepsCreateError };
    if (chain.table === 'outreach_sequences' && op(chain, 'insert')) return { data: { id: 'copy-1', name: 'Relance (copie)' }, error: null };
    return { error: null };
  }, { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } });
  const { toast, calls: toasts } = fakeToast();
  const duplicatingRef = { current: false };
  const handleDuplicate = extract(list, 'handleDuplicate', {
    supabase, toast, duplicatingRef, console: quiet,
    canManage: () => manage,
    setDuplicatingId: () => {},
    organizationId: 'org-1',
    projectId: null,
    sequenceSaveError: (e) => new Error(`traduit : ${e?.message ?? ''}`),
    TIMEOUT_REQUIRED_ACTIONS: ['wait_connection', 'wait_reply', 'wait_profile_visit'],
    DEFAULT_WAIT_TIMEOUT_DAYS: 3,
    implicitWaitEvent: (type, event) => event || (type === 'wait_reply' ? 'reply_received' : null),
    fetchSequences: async () => {},
  });
  const seq = { id: 'src-1', name: 'Relance', description: null, organization_id: 'org-1', sender_accounts: null, multi_sender_enabled: false };
  return { handleDuplicate, seq, calls, toasts, duplicatingRef };
}

test('front-editor-list-2 — « Dupliquer » réservé aux séquences de mon organisation', async () => {
  const { handleDuplicate, seq, calls } = duplicateHarness({ manage: false });
  await handleDuplicate(seq);
  assert.equal(calls.length, 0, 'aucune lecture ni copie pour une séquence d’une autre organisation');
  // Revue design : une seule ligne responsive par séquence, donc une seule entrée de
  // menu, sous canManage, pour le téléphone et l'ordinateur (plus de copie séparée pour téléphone).
  assert.equal((list.match(/\{canManage\(seq\) && \(\s*<DropdownMenuItem disabled=\{!!duplicatingId\} onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleDuplicate\(seq\); \}\}>/g) || []).length, 1);
  assert.equal((list.match(/handleDuplicate\(seq\);/g) || []).length, 1, 'aucune autre entrée « Dupliquer »');
  assert.equal((list.match(/filteredSequences\.map\(/g) || []).length, 1, 'une seule liste de lignes');
  assert.doesNotMatch(list, /key=\{`mobile-|sm:hidden/, 'plus de copie pour téléphone');
});

test('engine-conditions-channels-14 — la copie d’une attente sans délai reçoit le délai par défaut', async () => {
  const { handleDuplicate, seq, calls, toasts } = duplicateHarness();
  await handleDuplicate(seq);
  const rpc = calls.find((c) => c.table === 'rpc:save_sequence_steps');
  const [step] = op(rpc, 'rpc')[1].p_steps;
  assert.equal(step.timeout_days, 3);
  assert.equal(step.wait_for_event, 'reply_received');
  assert.equal(toasts.find((t) => t.kind === 'success')?.title, 'Séquence dupliquée : "Relance (copie)"');
});

test('front-editor-list-9 — copie des étapes en échec : l’en-tête créé est supprimé, un seul appel à la fois', async () => {
  const { handleDuplicate, seq, calls, toasts, duplicatingRef } = duplicateHarness({ stepsCreateError: { message: 'boom' } });
  await handleDuplicate(seq);
  const cleanup = calls.find((c) => c.table === 'outreach_sequences' && op(c, 'delete'));
  assert.ok(cleanup, 'la séquence vide doit être supprimée');
  assert.deepEqual(op(cleanup, 'eq'), ['eq', 'id', 'copy-1']);
  assert.equal(toasts.find((t) => t.kind === 'error')?.options.description, 'traduit : boom');
  assert.equal(duplicatingRef.current, false, 'verrou relâché après l’échec');

  const again = duplicateHarness();
  again.duplicatingRef.current = true;
  await again.handleDuplicate(again.seq);
  assert.equal(again.calls.length, 0, 'double clic : pas de seconde copie');
});

// ---------------------------------------------------------------- 3. front-editor-list-4
test('front-editor-list-4 — pause de séquence restée alors que la séquence est active : « Reprendre » et aide juste', () => {
  // État de la séquence relu à chaque chargement du panneau.
  const readActive = body(panel, 'fetchSequenceActive');
  assert.match(readActive, /\.from\('outreach_sequences'\)\s*\.select\('is_active'\)\s*\.eq\('id', sequenceId\)/);
  assert.match(readActive, /setSequenceActive\(error \|\| !data \? null : !!data\.is_active\)/);
  // Reprise individuelle proposée seulement si la séquence est active (sinon le serveur refuse).
  assert.match(panel, /const sequencePauseResumable = enrollment\.status === 'paused'\s*&& isSequenceLevelPause\(enrollment\.pause_reason\)\s*&& sequenceActive === true;/);
  assert.match(panel, /RESUMABLE_PAUSE_REASONS\.has\(enrollment\.pause_reason\) \|\| sequencePauseResumable\)/);
  // « Réactivez la séquence » remplacé quand l'interrupteur est déjà actif.
  assert.match(panel, /const SEQUENCE_ACTIVE_AGAIN_HINT = 'La séquence est de nouveau active : reprenez ce candidat\.';/);
  assert.match(panel, /sequencePauseResumable \? SEQUENCE_ACTIVE_AGAIN_HINT : pauseReasonHint\(enrollment\.pause_reason\)/);
  // La liste renvoie vers le panneau depuis les toasts de réactivation.
  assert.match(list, /action: \{ label: 'Voir les inscrits', onClick: \(\) => setEnrollmentsPanelSequence\(seq\) \}/);
  assert.match(body(list, 'activateSequence'), /\.\.\.enrollmentsPanelAction\(sequenceId\)/);
});

// ---------------------------------------------------------------- 4. front-editor-list-5 (D6)
test('front-editor-list-5 — « Reprendre tous les candidats en pause » : toute la séquence, par lots, via le serveur', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
  const { supabase, calls } = fakeSupabase(() => ({ data: ids.map((id) => ({ id })), error: null }));
  const invokes = [];
  const invokeEdgeFunction = async (fn, payload) => {
    invokes.push({ fn, payload });
    const n = payload.enrollment_ids.length;
    return { data: { success: true, results: payload.enrollment_ids.map((id) => ({ enrollment_id: id, outcome: 'resumed' })), counts: { resumed: n, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 } }, error: null };
  };
  const { toast, calls: toasts } = fakeToast();
  const reasons = ['manual', 'sequence_inactive', 'auto_paused'];
  const bulkResume = extract(panel, 'bulkResumePaused', {
    supabase, toast, invokeEdgeFunction, console: quiet,
    setBulkResuming: () => {}, sequenceId: 'seq-1', fetchEnrollments: async () => {},
    EXECUTION_PAGE_SIZE: 1000, BULK_RESUME_PAUSE_REASONS: reasons, BULK_RESUME_CHUNK: 25,
  });
  await bulkResume();
  const read = calls[0];
  assert.deepEqual(op(read, 'in'), ['in', 'pause_reason', reasons]);
  assert.ok(read.ops.some((o) => o[0] === 'eq' && o[1] === 'status' && o[2] === 'paused'));
  assert.deepEqual(invokes.map((i) => [i.fn, i.payload.action, i.payload.enrollment_ids.length]), [
    ['process-sequences', 'resume_enrollments', 25],
    ['process-sequences', 'resume_enrollments', 5],
  ]);
  assert.equal(toasts.find((t) => t.kind === 'success')?.title, '30 candidats repris');

  // Pauses héritées de l'ancienne désactivation (manual) comprises ; séquence active, pas de collaborateur.
  assert.match(panel, /const BULK_RESUME_PAUSE_REASONS: string\[\] = \['manual', \.\.\.SEQUENCE_LEVEL_PAUSE_REASONS\];/);
  assert.match(panel, /\{canBulkManage && sequenceActive === true && bulkResumableCount > 0 && \(/);
  assert.match(panel, /`Reprendre tous les candidats en pause \(\$\{bulkResumableCount\}\)`/);
  // Confirmée par un AlertDialog, compteur lu en base sur toute la séquence.
  assert.match(panel, /setConfirmAction\(\{ type: 'bulkResume' \}\)/);
  assert.match(panel, /confirmAction\.type === 'bulkResume'\) \{\s*await bulkResumePaused\(\);/);
  assert.match(body(panel, 'fetchStatusCounts'), /countFor\(\['paused'\]\)\.in\('pause_reason', BULK_RESUME_PAUSE_REASONS\)/);
});

test('front-editor-list-5 — reprise groupée : un appel refusé laisse le reste en pause et le dit', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
  const { supabase } = fakeSupabase(() => ({ data: ids.map((id) => ({ id })), error: null }));
  let n = 0;
  const invokeEdgeFunction = async (_fn, payload) => {
    n += 1;
    if (n === 2) return { data: { success: false, error: 'server_error', message: 'Réessayez.' }, error: null };
    return { data: { success: true, counts: { resumed: payload.enrollment_ids.length } }, error: null };
  };
  const { toast, calls: toasts } = fakeToast();
  const bulkResume = extract(panel, 'bulkResumePaused', {
    supabase, toast, invokeEdgeFunction, console: quiet,
    setBulkResuming: () => {}, sequenceId: 'seq-1', fetchEnrollments: async () => {},
    EXECUTION_PAGE_SIZE: 1000, BULK_RESUME_PAUSE_REASONS: ['manual'], BULK_RESUME_CHUNK: 25,
  });
  await bulkResume();
  assert.equal(toasts.filter((t) => t.kind === 'success').length, 0);
  const warning = toasts.find((t) => t.kind === 'warning');
  assert.equal(warning.title, '25 candidats repris');
  assert.match(warning.options.description, /5 non traités : Réessayez\./);
});

// ---------------------------------------------------------------- 5, 6. Reprise d'un échec d'envoi, relance
test('front-editor-list-7 / integration-8 — pause « échec d’envoi » : c’est l’étape en échec qui est retentée', () => {
  const retries = extract(panel, 'resumeRetriesFailedStep', {
    isPendingStatus: (s) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(s),
    isDoneStatus: (s) => ['sent', 'opened', 'clicked', 'replied', 'skipped'].includes(s),
    UNCERTAIN_FAILURE_PREFIXES: ['Interrompu pendant l’envoi', "Interrompu pendant l'envoi", 'Envoi incertain'],
  });
  const paused = (executions) => ({ status: 'paused', pause_reason: 'send_failed', executions });
  // InMail refusé à l'étape 2 : la reprise le rejoue (planResume ne compte pas un échec comme fait).
  assert.equal(retries(paused([{ status: 'sent', step_order: 0 }, { status: 'failed', step_order: 1, error_message: 'refusé' }])), true);
  // Une étape encore en attente est gardée : ce n'est pas un nouvel essai.
  assert.equal(retries(paused([{ status: 'failed', step_order: 1 }, { status: 'scheduled', step_order: 2 }])), false);
  // Échec incertain : compté comme fait, la reprise repart après lui.
  assert.equal(retries(paused([{ status: 'failed', step_order: 1, error_message: 'Envoi incertain : délai dépassé' }])), false);
  // Échec ancien, étape suivante déjà partie.
  assert.equal(retries(paused([{ status: 'failed', step_order: 1 }, { status: 'sent', step_order: 2 }])), false);
  // Autres pauses : jamais.
  assert.equal(retries({ status: 'paused', pause_reason: 'manual', executions: [{ status: 'failed', step_order: 1 }] }), false);

  assert.doesNotMatch(panel, /Reprendre à l’étape suivante/);
  assert.match(panel, /\{retriesFailedStep \? 'Réessayer l’étape en échec' : 'Reprendre la séquence'\}/);
  assert.match(panel, /`Réessayer l’étape en échec pour \$\{confirmName\} \?`/);
  assert.match(panel, /'L’étape en échec sera retentée après son délai habituel, pendant vos heures d’envoi\./);
  // « Chaque étape garde sa date prévue ; celles déjà passées partiront… » était faux sur le chemin schedule_next.
  assert.doesNotMatch(panel, /celles déjà passées partiront dans les prochaines minutes/);
  assert.match(panel, /'Une étape déjà programmée garde sa date \(au plus tôt dans une minute\) ; sinon, l’étape suivante est programmée selon son délai habituel, pendant vos heures d’envoi\.'/);
});

test('integration-8 / front-editor-list-8 — « Relancer » ne promet plus d’envoi dans les prochaines minutes', () => {
  assert.doesNotMatch(panel, /partira dans les prochaines minutes/);
  assert.match(panel, /`La séquence reprend à l’étape suivante, selon ses délais habituels\$\{confirmNextAction \? ` \(prochaine action estimée : \$\{confirmNextAction\}\)` : ', s’il en reste une'\}\./);
  assert.match(body(panel, 'reEnroll'), /'La prochaine action est programmée selon les délais de la séquence, pendant vos heures d’envoi\.'/);
  // L'estimation ne prend plus une étape annulée par la réponse pour « réarmable ».
  assert.doesNotMatch(body(panel, 'nextActionLabel'), /rearmable/);
});

// ---------------------------------------------------------------- D5 : effacement RGPD
test('D5 — effacement RGPD : ni « Reprendre » ni « Relancer »', () => {
  const prefix = panel.match(/const GDPR_ERASURE_SKIP_PREFIX = '([^']+)';/)[1];
  const erased = extract(panel, 'isGdprErased', { GDPR_ERASURE_SKIP_PREFIX: prefix });
  assert.equal(erased({ tracking_data: { gdpr_erased_at: '2026-09-26T10:00:00Z' }, executions: [] }), true);
  // Même motif que le moteur (GDPR_ERASURE_SKIP_REASON de _shared/get-or-fetch-contact.ts).
  const engine = read('supabase/functions/_shared/get-or-fetch-contact.ts').match(/GDPR_ERASURE_SKIP_REASON = '([^']+)'/)[1];
  assert.ok(engine.startsWith(prefix));
  assert.equal(erased({ tracking_data: null, executions: [{ skip_reason: engine }] }), true);
  assert.equal(erased({ tracking_data: { pause_reason: 'x' }, executions: [{ skip_reason: 'Arrêt manuel' }] }), false);
  assert.equal(erased({ tracking_data: ['x'], executions: undefined }), false);

  assert.match(panel, /const canResume = enrollment\.status === 'paused' && !gdprErased/);
  // « Relancer » : ni après un effacement (D5), ni sur la ligne d'un autre membre pour un collaborateur (D3).
  assert.match(panel, /\{ownRow && !gdprErased && \(enrollment\.status === 'replied' \|\| enrollment\.status === 'completed' \|\| enrollment\.status === 'cancelled' \|\| enrollment\.status === 'stopped'\) && \(/);
  assert.match(panel, /const pauseHint = gdprErased\s*\? GDPR_ERASED_NOTICE/);
  assert.match(panel, /const GDPR_ERASED_NOTICE = 'Ce candidat a demandé l’effacement de ses données : il ne peut plus être relancé\.';/);
});

// ---------------------------------------------------------------- 10. front-editor-list-10
test('front-editor-list-10 — erreurs d’enregistrement traduites, étape refusée nommée par son type', () => {
  const sequenceSaveError = extract(list, 'sequenceSaveError', {
    console: quiet,
    sequenceWriteRefusal: (e) => (e?.hint === 'SEQUENCE_ORG_MISMATCH' ? 'Action refusée : cet élément appartient à une autre séquence ou organisation.' : null),
  });
  assert.equal(sequenceSaveError({ message: 'new row violates row-level security policy for table "sequence_steps"', code: '42501' }).message,
    'Vous n’avez pas les droits nécessaires pour enregistrer cette séquence.');
  assert.equal(sequenceSaveError({ message: 'Sequence 123 not found or not accessible' }).message,
    'Cette séquence n’existe plus ou vous n’y avez plus accès. Actualisez la liste des séquences.');
  assert.equal(sequenceSaveError({ hint: 'SEQUENCE_ORG_MISMATCH', message: 'x' }).message,
    'Action refusée : cet élément appartient à une autre séquence ou organisation.');
  assert.doesNotMatch(sequenceSaveError({ message: 'duplicate key value violates unique constraint' }).message, /duplicate key/);

  const blockedStepsNotice = extract(list, 'blockedStepsNotice');
  const labels = new Map([[2, 'Message IA']]);
  assert.equal(blockedStepsNotice('Étape(s) concernée(s) : 2', labels), ' Étape concernée : « Message IA » (étape 3 avant vos modifications).');
  const save = body(list, 'handleSaveSequence');
  assert.match(save, /\.select\('id, step_order, action_type'\)/);
  assert.match(save, /baseStepLabels\.set\(s\.step_order, actionTypeLabel\(s\.action_type\)\)/);
  assert.doesNotMatch(save, /throw (stepsError|updateError|createError);/);
});

// ---------------------------------------------------------------- 11. front-editor-list-13
test('front-editor-list-13 — « Envoyer les actions du jour » dit ce qui ne bouge pas', () => {
  assert.match(list, /Hors invitations LinkedIn et hors séquences partagées\s*entre missions\./);
});

// ---------------------------------------------------------------- 12. SEQ-165 (B6)
test('SEQ-165 — compteurs par groupe : chaque ligne compte pour `count` candidats', () => {
  const fetch = list.slice(list.indexOf('const fetchSequences = React.useCallback('), list.indexOf('}, [projectId]);'));
  assert.match(fetch, /\.rpc\('get_sequence_enrollment_counts', \{ p_sequence_ids: sequenceIds \}\)/);
  assert.match(fetch, /const n = Number\(group\.count\) \|\| 0;/);
  assert.match(fetch, /stats\.total \+= n;/);
  assert.match(fetch, /const reason = group\.pause_reason \|\| 'manual';/);
  assert.doesNotMatch(fetch, /stats\.total \+= 1;/);
});
