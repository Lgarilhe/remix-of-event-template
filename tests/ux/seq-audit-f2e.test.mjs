/**
 * Audit séquences 2026-09-25, lot F2, dernière passe — relecture ciblée de la
 * vague finale, contrat §8 : droits d'édition d'un collaborateur, candidats
 * d'autres membres laissés en pause à la réactivation (other_members), filet
 * de recompte, interrupteur verrouillé qui dit pourquoi, textes de pause,
 * « Marquer comme ayant répondu » qui annonce l'arrêt des autres séquences.
 *
 * Les fonctions du composant sont extraites du fichier, transpilées en mémoire
 * par esbuild et exécutées avec un faux client Supabase.
 * Lancer : node --test tests/ux/seq-audit-f2e.test.mjs
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

/** Déclaration `const name = (...) => expression;` (flèche sans accolades). */
function expression(src, name) {
  const start = src.search(new RegExp(`const ${name} = \\(`));
  assert.ok(start !== -1, `fonction ${name} introuvable`);
  return src.slice(start, src.indexOf(';\n', start) + 1);
}

function load(code, name, deps) {
  const { code: js } = transformSync(`${code}\nmodule.exports = ${name};`, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  const names = Object.keys(deps);
  new Function(...names, 'module', 'exports', js)(...names.map((n) => deps[n]), module, module.exports);
  return module.exports;
}
const extract = (src, name, deps = {}) => load(`${body(src, name)};`, name, deps);
const extractExpression = (src, name, deps = {}) => load(expression(src, name), name, deps);

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

/** Faux client Supabase : chaque requête garde ses appels (`ops`) ; `resolve(chain)` donne le résultat. */
function fakeSupabase(resolve) {
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
  return { calls, supabase: { from } };
}

const op = (chain, name) => chain.ops.find((o) => o[0] === name);
const hasOp = (chain, name, ...args) => chain.ops.some((o) => o[0] === name && args.every((a, i) => JSON.stringify(o[i + 1]) === JSON.stringify(a)));
const candidats = (n) => `${n} candidat${n > 1 ? 's' : ''}`;
const quiet = { error: () => {}, log: () => {}, warn: () => {} };
const SEQUENCE_LEVEL_PAUSE_REASONS = ['sequence_inactive', 'auto_paused'];
const NOT_AUTHOR_HINT = list.match(/const NOT_AUTHOR_READ_ONLY_HINT = '([^']+)';/)?.[1];
const OTHER_ORG_HINT = list.match(/const OTHER_ORG_READ_ONLY_HINT = '([^']+)';/)?.[1];

// ---------------------------------------------------------------- 1. front-editor-list-1 (medium, §8)
test('front-editor-list-1 — un collaborateur ne modifie que les séquences qu’il a créées', () => {
  const canManage = (seq) => seq.organization_id === 'org-1';
  const canEditFor = (isCollaborator, userId) => extractExpression(list, 'canEdit', { canManage, isCollaborator, userId });
  const mine = { organization_id: 'org-1', created_by: 'u1' };
  const colleague = { organization_id: 'org-1', created_by: 'u2' };
  const legacy = { organization_id: 'org-1', created_by: null };
  const otherOrg = { organization_id: 'org-2', created_by: 'u1' };
  // Collaborateur : ses séquences seulement (même règle que org_members_update et SEQUENCE_NOT_OWNER).
  assert.equal(canEditFor(true, 'u1')(mine), true);
  assert.equal(canEditFor(true, 'u1')(colleague), false);
  assert.equal(canEditFor(true, 'u1')(legacy), false);
  assert.equal(canEditFor(true, null)(mine), false, 'utilisateur inconnu : rien de modifiable');
  // Owner, admin, membre : toutes les séquences de l'organisation.
  assert.equal(canEditFor(false, 'u1')(colleague), true);
  assert.equal(canEditFor(false, 'u1')(otherOrg), false);
  assert.match(list, /created_by: string \| null;/, 'created_by lu avec la séquence (select \'*\')');
  assert.match(list, /const \{ user \} = useAuthReady\(\);\s*const userId = user\?\.id \?\? null;/);

  // « Lecture seule » expliqué selon le cas.
  assert.equal(NOT_AUTHOR_HINT, 'Seul l’auteur de cette séquence peut la modifier : dupliquez-la pour l’adapter.');
  const readOnlyHint = extractExpression(list, 'readOnlyHint', {
    canManage, NOT_AUTHOR_READ_ONLY_HINT: NOT_AUTHOR_HINT, OTHER_ORG_READ_ONLY_HINT: OTHER_ORG_HINT,
  });
  assert.equal(readOnlyHint(colleague), NOT_AUTHOR_HINT);
  assert.equal(readOnlyHint(otherOrg), OTHER_ORG_HINT);
  // Revue design : une seule ligne responsive par séquence (plus de copie séparée
  // pour téléphone) ; « Lecture seule » est un badge près du nom, avec son explication.
  assert.equal((list.match(/filteredSequences\.map\(/g) || []).length, 1, 'une seule liste de lignes');
  assert.doesNotMatch(list, /key=\{`mobile-|sm:hidden/, 'plus de copie pour téléphone');
  assert.equal((list.match(/title=\{readOnlyHint\(seq\)\}/g) || []).length, 1, 'ligne unique');
  assert.match(list, /\{!canEdit\(seq\) && \(\s*<Badge variant="outline" title=\{readOnlyHint\(seq\)\}>Lecture seule<\/Badge>/);

  // Interrupteur, « Modifier » et « Supprimer » sous canEdit ; « Dupliquer » reste sous canManage.
  assert.equal((list.match(/\{canEdit\(seq\) \? \(\s*<Switch/g) || []).length, 1);
  assert.equal((list.match(/\{canEdit\(seq\) && \(\s*<DropdownMenuItem onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleEdit\(seq\); \}\}>/g) || []).length, 1);
  assert.equal((list.match(/\{canEdit\(seq\) && \(\s*<>\s*<DropdownMenuSeparator \/>/g) || []).length, 1);
  assert.equal((list.match(/\{canManage\(seq\) && \(\s*<DropdownMenuItem disabled=\{!!duplicatingId\}/g) || []).length, 1);
});

test('front-editor-list-1 — l’éditeur ne s’ouvre pas sur la séquence d’un collègue', async () => {
  const { supabase, calls } = fakeSupabase(() => assert.fail('aucune lecture attendue'));
  const { toast, calls: toasts } = fakeToast();
  let opened = false;
  const handleEdit = extract(list, 'handleEdit', {
    supabase, toast, console: quiet,
    canEdit: () => false,
    readOnlyHint: () => NOT_AUTHOR_HINT,
    setEditingActiveCount: () => {}, setEditingSequence: () => {}, setShowBuilder: () => { opened = true; },
    editorBaseStepIdsRef: { current: null },
  });
  await handleEdit({ id: 'seq-1', organization_id: 'org-1', created_by: 'u2' });
  assert.equal(calls.length, 0, 'ni étapes lues ni éditeur ouvert');
  assert.equal(opened, false);
  assert.deepEqual(toasts, [{ kind: 'error', title: 'Modification impossible', options: { description: NOT_AUTHOR_HINT } }]);
});

// ---------------------------------------------------------------- 2 / 3. other_members à la réactivation
test('front-editor-list-2 / integration-3 — collaborateur : les pauses des autres membres sont comptées à part', async () => {
  const { supabase, calls } = fakeSupabase((chain) => {
    const withReason = hasOp(chain, 'in', 'pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS);
    const own = hasOp(chain, 'eq', 'created_by', 'u1');
    if (withReason && own) return { count: 3, error: null };
    if (withReason) return { count: 8, error: null };
    return { count: 10, error: null };
  });
  const { toast } = fakeToast();
  let confirm = null;
  const requestToggle = extract(list, 'requestToggle', {
    supabase, toast, console: quiet, SEQUENCE_LEVEL_PAUSE_REASONS,
    togglingId: null, canEdit: () => true, readOnlyHint: () => '', deactivationLocked: () => false,
    COLLABORATOR_DEACTIVATION_HINT: '', setTogglingId: () => {},
    deactivateSequence: async () => assert.fail('pas de désactivation'),
    // Décision 32 : état d'abonnement lu.
    canSendSequences: true, planStateUnknown: false, navigate: () => {},
    isCollaborator: true, userId: 'u1',
    setActivateConfirm: (value) => { confirm = value; },
    activateSequence: async () => assert.fail('confirmation attendue'),
  });
  await requestToggle({ id: 'seq-1', is_active: false, project_id: 'p1' });
  // Le dialogue n'annonce que les 3 candidats que le serveur reprendra pour ce collaborateur.
  assert.deepEqual(confirm, { id: 'seq-1', resumable: 3, otherPaused: 2, otherMembers: 5 });
  assert.ok(calls.some((c) => hasOp(c, 'eq', 'created_by', 'u1')), 'compte filtré sur l’auteur des inscriptions');

  // Owner, admin, membre : aucun filtre d'auteur, tout est repris.
  const admin = fakeSupabase((chain) => (hasOp(chain, 'in', 'pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS) ? { count: 8, error: null } : { count: 10, error: null }));
  let adminConfirm = null;
  const adminToggle = extract(list, 'requestToggle', {
    supabase: admin.supabase, toast, console: quiet, SEQUENCE_LEVEL_PAUSE_REASONS,
    togglingId: null, canEdit: () => true, readOnlyHint: () => '', deactivationLocked: () => false,
    COLLABORATOR_DEACTIVATION_HINT: '', setTogglingId: () => {},
    // Décision 32 : état d'abonnement lu.
    deactivateSequence: async () => {}, canSendSequences: true, planStateUnknown: false, navigate: () => {},
    isCollaborator: false, userId: 'u1',
    setActivateConfirm: (value) => { adminConfirm = value; }, activateSequence: async () => {},
  });
  await adminToggle({ id: 'seq-1', is_active: false, project_id: 'p1' });
  assert.deepEqual(adminConfirm, { id: 'seq-1', resumable: 8, otherPaused: 2, otherMembers: 0 });
  assert.ok(!admin.calls.some((c) => op(c, 'eq') && hasOp(c, 'eq', 'created_by', 'u1')));

  // Le dialogue le dit.
  assert.match(list, /d’autres membres \{\(activateConfirm\?\.otherMembers \?\? 0\) > 1 \? 'resteront' : 'restera'\} en pause/);
  assert.match(list, /activateConfirm\.otherPaused, activateConfirm\.otherMembers\);/);
});

/** Réactivation : l'interrupteur passe, le serveur répond `serverPayload`, le recompte donne `stillPaused`. */
async function runActivation({ resumable, otherPaused = 0, otherMembers = 0, serverPayload, stillPaused = 0, recountError = null }) {
  const { supabase, calls } = fakeSupabase((chain) => {
    if (chain.table === 'outreach_sequences') return { data: [{ id: 'seq-1' }], error: null };
    return { count: stillPaused, error: recountError };
  });
  const { toast, calls: toasts } = fakeToast();
  const invokes = [];
  const activateSequence = extract(list, 'activateSequence', {
    supabase, toast, console: quiet, candidats, SEQUENCE_LEVEL_PAUSE_REASONS, MAX_RESUME_ROUNDS: 10,
    setTogglingId: () => {}, setSequences: () => {}, fetchSequences: () => {},
    enrollmentsPanelAction: (id) => ({ action: { label: 'Voir les inscrits', id } }),
    invokeEdgeFunction: async (fn, payload) => { invokes.push({ fn, payload }); return { data: serverPayload, error: null }; },
  });
  await activateSequence('seq-1', resumable, otherPaused, otherMembers);
  const final = toasts.filter((t) => t.kind !== 'dismiss' && t.kind !== 'loading');
  return { calls, invokes, final };
}
const resumedPayload = (n, extra = {}) => ({
  success: true,
  results: Array.from({ length: n }, (_, i) => ({ enrollment_id: `e${i}`, outcome: 'resumed' })),
  counts: { resumed: n, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 },
  remaining: 0,
  ...extra,
});

test('integration-3 — réactivation partielle d’un collaborateur : avertissement, jamais un succès complet', async () => {
  const { final, invokes } = await runActivation({
    resumable: 3, otherMembers: 5, stillPaused: 5, serverPayload: resumedPayload(3, { other_members: 5 }),
  });
  assert.equal(invokes[0].payload.action, 'resume_enrollments');
  assert.equal(final.length, 1);
  assert.equal(final[0].kind, 'warning');
  assert.equal(final[0].title, 'Séquence réactivée : 3 candidats repris');
  assert.match(final[0].options.description, /5 candidats inscrits par d’autres membres restent en pause : un administrateur ou le membre qui les a inscrits peut les reprendre depuis la liste des inscrits\./);
  assert.deepEqual(final[0].options.action, { label: 'Voir les inscrits', id: 'seq-1' });
  assert.doesNotMatch(final[0].options.description, /sans avoir été repris/, 'les 5 sont expliqués, pas comptés deux fois');
});

test('integration-3 — serveur sans other_members : le compte fait au clic sert de repli', async () => {
  const { final } = await runActivation({
    resumable: 3, otherMembers: 5, stillPaused: 5, serverPayload: resumedPayload(3),
  });
  assert.equal(final[0].kind, 'warning');
  assert.match(final[0].options.description, /5 candidats inscrits par d’autres membres restent en pause/);
});

test('integration-3 — collaborateur sans candidat à lui : aucun appel, avertissement sur les autres', async () => {
  const { final, invokes } = await runActivation({ resumable: 0, otherMembers: 1, serverPayload: null });
  assert.equal(invokes.length, 0);
  assert.equal(final[0].kind, 'warning');
  assert.equal(final[0].title, 'Séquence réactivée');
  assert.match(final[0].options.description, /^1 candidat inscrit par d’autres membres reste en pause : un administrateur ou le membre qui l’a inscrit peut le reprendre/);
});

test('front-editor-list-2 — filet, tous rôles : des pauses de séquence inexpliquées empêchent le succès', async () => {
  // Serveur : 3 repris, rien d'autre ; mais 2 pauses de séquence restent en base.
  const left = await runActivation({ resumable: 5, stillPaused: 2, serverPayload: resumedPayload(3, { other_members: 0 }) });
  const recount = left.calls.find((c) => c.table === 'sequence_enrollments');
  assert.ok(recount, 'les pauses de séquence sont recomptées après la reprise');
  assert.ok(hasOp(recount, 'eq', 'status', 'paused'));
  assert.ok(hasOp(recount, 'in', 'pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS));
  assert.equal(left.final.filter((t) => t.kind === 'success').length, 0);
  assert.equal(left.final[0].kind, 'warning');
  assert.match(left.final[0].options.description, /2 candidats restent en pause sans avoir été repris : la liste des inscrits indique comment les reprendre\./);

  // Recompte en échec : pas de preuve, pas de succès.
  const unknown = await runActivation({ resumable: 3, recountError: { message: 'boom' }, serverPayload: resumedPayload(3, { other_members: 0 }) });
  assert.equal(unknown.final[0].kind, 'warning');
  assert.match(unknown.final[0].options.description, /Les candidats encore en pause n’ont pas pu être recomptés/);

  // Candidats restés en pause mais expliqués (compte non relié) : pas de doublon « sans avoir été repris ».
  const unlinked = await runActivation({
    resumable: 3, stillPaused: 1,
    serverPayload: {
      success: true, remaining: 0, other_members: 0,
      results: [{ enrollment_id: 'a', outcome: 'resumed' }, { enrollment_id: 'b', outcome: 'resumed' }, { enrollment_id: 'c', outcome: 'account_unlinked' }],
      counts: { resumed: 2, nothing_to_resume: 0, account_unlinked: 1, not_paused: 0, error: 0 },
    },
  });
  assert.doesNotMatch(unlinked.final[0].options.description, /sans avoir été repris/);

  // Tout est repris et le recompte le confirme : succès.
  const ok = await runActivation({ resumable: 3, stillPaused: 0, serverPayload: resumedPayload(3, { other_members: 0 }) });
  assert.equal(ok.final.length, 1);
  assert.equal(ok.final[0].kind, 'success');
  assert.equal(ok.final[0].title, 'Séquence réactivée. 3 candidats repris.');
});

// ---------------------------------------------------------------- 4. front-editor-list-3 (low)
test('front-editor-list-3 — interrupteur verrouillé d’un collaborateur : cliquable, il dit pourquoi', async () => {
  const switches = [...list.matchAll(/<Switch[\s\S]*?\/>/g)].map((m) => m[0]);
  // Revue design : une seule ligne responsive par séquence, un seul interrupteur
  // (plus de copie séparée pour téléphone).
  assert.equal(switches.length, 1);
  assert.doesNotMatch(list, /key=\{`mobile-|sm:hidden/, 'plus de copie pour téléphone');
  for (const s of switches) {
    assert.doesNotMatch(s, /\sdisabled=\{[^}]*deactivationLocked/, 'Radix n’appelle pas onCheckedChange sur un interrupteur désactivé');
    assert.match(s, /aria-disabled=\{deactivationLocked\(seq\) \|\| undefined\}/);
  }
  const { toast, calls: toasts } = fakeToast();
  const requestToggle = extract(list, 'requestToggle', {
    toast, togglingId: null, canEdit: () => true, readOnlyHint: () => '',
    deactivationLocked: () => true, COLLABORATOR_DEACTIVATION_HINT: 'réservé',
  });
  await requestToggle({ id: 'seq-1', is_active: true });
  // Lot 5b : l'interrupteur s'appelle « Mettre en pause la séquence ».
  assert.deepEqual(toasts, [{ kind: 'error', title: 'Mise en pause réservée', options: { description: 'réservé' } }]);
});

// ---------------------------------------------------------------- 5. front-editor-list-4 (low)
test('front-editor-list-4 — pauses pour une autre raison : le texte ne promet pas une reprise depuis la liste', async () => {
  const { final } = await runActivation({ resumable: 0, otherPaused: 4, serverPayload: null });
  assert.equal(final[0].kind, 'success');
  assert.equal(final[0].options.description, '4 candidats restent en pause pour une autre raison (pause manuelle, compte déconnecté, limite d’envoi…) : la liste des inscrits indique comment les reprendre.');
  assert.doesNotMatch(body(list, 'activateSequence'), /reprenez-les depuis la liste des inscrits\.`\s*:\s*undefined/);
});

// ---------------------------------------------------------------- Panneau : D3 par ligne et stopped_siblings
test('front-editor-list-2 — panneau : « Reprendre » masqué à un collaborateur sur le candidat d’un autre membre', () => {
  assert.match(panel, /const \{ user \} = useAuthReady\(\);\s*const userId = user\?\.id \?\? null;/);
  assert.match(panel, /const ownRow = !isCollaborator \|\| \(!!userId && enrollment\.created_by === userId\);/);
  assert.match(panel, /const canResume = enrollment\.status === 'paused' && !gdprErased && ownRow\s*&& \(/);
  // L'aide ne dit plus « reprenez ce candidat » quand un autre doit le faire.
  assert.match(panel, /const OTHER_MEMBER_RESUME_HINT = 'Candidat inscrit par un autre membre : un administrateur ou ce membre peut reprendre sa séquence\.';/);
  assert.match(panel, /: resumeReservedToOthers && !pauseDetail\s*\? OTHER_MEMBER_RESUME_HINT/);
  assert.match(panel, /const resumeReservedToOthers = !ownRow && enrollment\.status === 'paused' && !gdprErased/);
});

test('§8 — « Marquer comme ayant répondu » annonce l’arrêt des autres séquences du candidat', async () => {
  const run = async (payload) => {
    const { toast, calls } = fakeToast();
    const markReplied = extract(panel, 'markReplied', {
      toast, console: quiet, nameOf: () => 'Alice', fetchEnrollments: async () => {},
      invokeEdgeFunction: async () => ({ data: payload, error: null }),
    });
    await markReplied('e1');
    return calls;
  };
  const two = await run({ success: true, changed: true, stopped_siblings: 2 });
  assert.deepEqual(two, [{ kind: 'success', title: 'Réponse enregistrée pour Alice', options: { description: 'Les étapes restantes ont été annulées. Ses 2 autres séquences en cours ou en pause ont été arrêtées.' } }]);
  const one = await run({ success: true, changed: true, stopped_siblings: 1, warning: 'Réponse enregistrée.' });
  assert.equal(one[0].kind, 'warning');
  assert.equal(one[0].options.description, 'Réponse enregistrée. Son autre séquence en cours ou en pause a été arrêtée.');
  const none = await run({ success: true, changed: true, stopped_siblings: 0 });
  assert.equal(none[0].options.description, 'Les étapes restantes ont été annulées.');

  // Dialogue : arrêt annoncé, borné à celles commencées avant la fin pour une séquence terminée.
  assert.match(panel, /Ses autres séquences encore en cours ou en pause, commencées avant la fin de celle-ci, seront aussi arrêtées\./);
  assert.match(panel, /: 'Ses autres séquences encore en cours ou en pause seront aussi arrêtées\.'/);
});

test('D3 — sur la ligne d’un autre membre, un collaborateur ne voit ni pause, ni réponse, ni relance, ni saut', () => {
  const src = readFileSync(new URL('../../src/components/outreach/SequenceEnrollmentsPanel.tsx', import.meta.url), 'utf8');
  // Lot 5b : pause immédiate (plus de confirmation), même garde.
  assert.match(src, /\{enrollment\.status === 'active' && ownRow \? \(\s*<DropdownMenuItem\s*onClick=\{\(\) => \{ void stopEnrollment\(enrollment\.id\); \}\}/);
  assert.match(src, /\{ownRow && \(enrollment\.status === 'active' \|\| enrollment\.status === 'paused' \|\| enrollment\.status === 'completed'\) && \(\s*<DropdownMenuItem\s*onClick=\{\(\) => setConfirmAction\(\{ type: 'markReplied'/);
  assert.match(src, /\{ownRow && !gdprErased && \(enrollment\.status === 'replied'/);
  // Revue design : « Sauter » est un bouton du kit (<Button>), même garde.
  assert.match(src, /\{enrollment\.status === 'active' && ownRow && \(\s*<Button\b[\s\S]{0,400}type: 'skipStep'/);
});
