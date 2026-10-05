/**
 * Refonte mission, lot 5b : « Arrêter » et « Pause » immédiats, avec
 * « Annuler » (décision 3 du plan docs/refonte-mission/lot5-plan.md).
 *
 * - Plus d'AlertDialog sur la pause d'un candidat (suivi, fiche, messagerie),
 *   la pause groupée, la mise en pause de la séquence et l'arrêt ; les autres
 *   fenêtres restent.
 * - Toast « Annuler » : 8 000 ms prolongées au survol ou au focus, fermé
 *   d'office à 110 000 ms au plus (et 10 s avant la fin du jeton), Échap le
 *   ferme sans annuler, `role="status"`.
 * - Annulation par process-sequences (resume_enrollments, undo_stop_enrollments),
 *   jamais d'écriture de statut 'active' ou 'completed', ni d'exécution, depuis
 *   le navigateur.
 * - Textes exacts du plan ; aide « Vous pourrez le relancer plus tard » ;
 *   aucun « Définitif ».
 *
 * Les modules purs et le crochet sont transpilés par esbuild et exécutés
 * (React, sonner et le client serveur remplacés par des doublures) ; les
 * écrans sont vérifiés par inspection du code source.
 *
 * Lancer : node --test tests/ux/lot5b-arret-pause.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build, transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Retire les commentaires de bloc, JSX et de ligne (hors chaînes d'URL). */
const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;{}),])\s*\/\/[^\n'"`]*$/gm, '$1');

const HOOK = 'src/hooks/useUndoableEnrollmentAction.ts';
const panel = stripComments(read('src/components/outreach/SequenceEnrollmentsPanel.tsx'));
const fiche = stripComments(read('src/components/outreach/CandidateSequencesPanel.tsx'));
const ficheHook = stripComments(read('src/hooks/useCandidateEnrollments.ts'));
const inbox = stripComments(read('src/components/outreach/inbox/MessageView.tsx'));
const list = stripComments(read('src/components/outreach/SequencesList.tsx'));
// Lot 5c-1 : fonctions de la liste et du suivi sorties dans sequenceActions.ts,
// enregistrement de l'éditeur dans useSequenceSave.ts.
const actions = stripComments(read('src/lib/sequenceActions.ts'));
const saveHook = stripComments(read('src/hooks/useSequenceSave.ts'));
const hookSrc = stripComments(read(HOOK));
const badges = read('src/components/outreach/SequenceBadges.tsx');
const claude = read('CLAUDE.md');

const loadTs = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const msgs = await loadTs('src/lib/sequenceErrorMessages.ts');
const labels = await loadTs('src/lib/sequenceLabels.ts');

/** Transpile et charge un module TypeScript ; les imports « @/ » sont résolus dans src/, sauf `stubs`. */
async function loadModule(rel, stubs = {}) {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [{
      name: 'alias-and-stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stubs) return { path: args.path, namespace: 'stub' };
          if (args.path.startsWith('@/')) return { path: resolveSrc(args.path) };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// Doublures partagées par le crochet chargé : toast, appels serveur, document.
const harness = globalThis.__lot5bHarness = {
  toasts: [],
  invokes: [],
  respond: async () => ({ data: { success: true }, error: null }),
  listeners: new Map(),
};
globalThis.window = globalThis;
// Classes DOM lues par le gestionnaire d'Échap (aucun élément n'a le focus ici).
globalThis.Element ??= class Element {};
globalThis.HTMLElement ??= class HTMLElement extends globalThis.Element {};
// Lu à la sortie du focus du toast (relatedTarget).
globalThis.Node ??= class Node {};
globalThis.document = {
  activeElement: null,
  addEventListener: (type, fn) => { harness.listeners.set(type, fn); },
  removeEventListener: (type, fn) => { if (harness.listeners.get(type) === fn) harness.listeners.delete(type); },
};

const STUBS = {
  react: `
    const createElement = (type, props, ...children) => ({ type, props: props || {}, children });
    export const useCallback = (fn) => fn;
    export const useRef = (value) => ({ current: value });
    export const useEffect = () => {};
    export default { createElement };
  `,
  sonner: `
    const h = globalThis.__lot5bHarness;
    let n = 0;
    const record = (kind) => (title, options) => { const id = options?.id ?? ('t' + (++n)); h.toasts.push({ kind, title, options, id }); return id; };
    const toast = Object.assign(record('default'), {
      success: record('success'), error: record('error'), warning: record('warning'), info: record('info'),
      loading: record('loading'),
      dismiss: (id) => { h.toasts.push({ kind: 'dismiss', id }); return id; },
      custom: (render, options) => { h.toasts.push({ kind: 'custom', render, options, id: options?.id }); return options?.id; },
    });
    export { toast };
  `,
  'lucide-react': 'export const X = () => null;',
  '@/components/ui/button': 'export const Button = () => null;',
  '@/hooks/useOrganization': "export const useOrganization = () => ({ organizationId: 'org-1' });",
  '@/lib/invokeEdgeFunction': `
    const h = globalThis.__lot5bHarness;
    export async function invokeEdgeFunction(fn, body) { h.invokes.push({ fn, body }); return h.respond(body); }
  `,
};
const hookModule = await loadModule(HOOK, STUBS);

const reset = () => {
  harness.toasts.length = 0;
  harness.invokes.length = 0;
  harness.listeners.clear();
  harness.respond = async () => ({ data: { success: true }, error: null });
};
const customToasts = () => harness.toasts.filter((t) => t.kind === 'custom');
const dismissed = () => harness.toasts.filter((t) => t.kind === 'dismiss').map((t) => t.id);
/** Élément rendu par le toast « Annuler » (doublure de createElement). */
const renderUndo = (entry) => entry.render(entry.id);
const flush = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- Toast « Annuler »
test('toast « Annuler » : 8 000 ms prolongées au survol et au focus, fermeture d’office à 110 000 ms au plus', () => {
  assert.equal(hookModule.UNDO_TOAST_DURATION_MS, 8000);
  assert.ok(hookModule.UNDO_TOAST_MAX_MS <= 110000);
  assert.equal(hookModule.UNDO_TOAST_MAX_MS, 110000);
  // Minuterie du contenu : suspendue au survol et au focus, reprise ensuite.
  for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) {
    assert.match(hookSrc, new RegExp(`host\\.addEventListener\\('${event}'`), event);
  }
  assert.match(hookSrc, /timer = window\.setTimeout\(\(\) => callbacks\.current\.onClose\(\), remaining\);/);
  // Sonner ne ferme rien seul ; role="status" sur le contenu.
  assert.match(hookSrc, /\{ id, duration: Infinity, onDismiss:/);
  assert.match(hookSrc, /role: 'status'/);
  // Modèle ApprovalsSection : « Annuler » comme action du toast.
  assert.match(hookSrc, /'Annuler'\)/);
});

// Crochet rechargé avec une doublure de React qui exécute l'effet du contenu
// du toast sur un hôte factice (écouteurs de survol et de focus).
const effectStubs = {
  ...STUBS,
  react: `
    const h = globalThis.__lot5bHarness;
    const createElement = (type, props, ...children) => ({ type, props: props || {}, children });
    export const useCallback = (fn) => fn;
    export const useRef = (value) => ({ current: value === null ? (h.fakeRoot ?? null) : value });
    export const useEffect = (fn) => { h.effects.push(fn); };
    export default { createElement };
  `,
};
const effectHook = await loadModule(HOOK, effectStubs);
/** Hôte factice : écouteurs par type, rien d'autre n'a le focus. */
function fakeHost() {
  const handlers = new Map();
  return {
    closest: () => null,
    contains: () => false,
    addEventListener: (type, fn) => { handlers.set(type, fn); },
    removeEventListener: (type) => { handlers.delete(type); },
    fire: (type, event = {}) => handlers.get(type)?.(event),
    handlers,
  };
}
/** Ouvre un toast « Annuler » et exécute l'effet de son contenu. */
function mountUndoToast(title) {
  harness.effects = [];
  harness.fakeRoot = fakeHost();
  const id = effectHook.showUndoToast({ title, onUndo: () => {} });
  const entry = customToasts().find((x) => x.id === id);
  const element = entry.render(entry.id);
  element.type(element.props);
  assert.equal(harness.effects.length, 1, 'un effet : la minuterie du contenu');
  harness.effects[0]();
  return { id, host: harness.fakeRoot };
}

test('toast « Annuler » : la minuterie du contenu ferme à 8 000 ms, pas avant ; survol et focus la suspendent, elle reprend sur le temps restant', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  reset();
  // Sans survol ni focus : fermé à 8 000 ms.
  const plain = mountUndoToast('Séquence mise en pause pour Claire Dubois.');
  for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) assert.ok(plain.host.handlers.has(event), event);
  t.mock.timers.tick(7_999);
  assert.deepEqual(dismissed(), [], 'pas avant 8 000 ms');
  t.mock.timers.tick(1);
  assert.deepEqual(dismissed(), [plain.id], 'fermé à 8 000 ms');

  // Survol à 3 s : suspendu ; repris au départ du pointeur sur les 5 s restantes.
  reset();
  const hovered = mountUndoToast('Séquence arrêtée pour Claire Dubois.');
  t.mock.timers.tick(3_000);
  hovered.host.fire('mouseenter');
  t.mock.timers.tick(30_000);
  assert.deepEqual(dismissed(), [], 'survol : jamais fermé');
  hovered.host.fire('mouseleave');
  t.mock.timers.tick(4_999);
  assert.deepEqual(dismissed(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(dismissed(), [hovered.id], 'temps restant après le survol');

  // Focus à 2 s : suspendu ; repris à la sortie du focus sur les 6 s restantes.
  reset();
  const focused = mountUndoToast('Séquence arrêtée pour Claire Dubois.');
  t.mock.timers.tick(2_000);
  focused.host.fire('focusin');
  t.mock.timers.tick(50_000);
  assert.deepEqual(dismissed(), [], 'focus : jamais fermé');
  focused.host.fire('focusout', { relatedTarget: null });
  t.mock.timers.tick(5_999);
  assert.deepEqual(dismissed(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(dismissed(), [focused.id], 'temps restant après le focus');
  harness.fakeRoot = null;
  harness.listeners.clear();
});

test('toast « Annuler » : fermé d’office par toast.dismiss programmé, 10 s avant la fin du jeton', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  reset();
  const undone = [];
  const id = hookModule.showUndoToast({ title: 'Séquence arrêtée pour Claire Dubois.', onUndo: () => { undone.push(1); } });
  assert.equal(customToasts().length, 1);
  t.mock.timers.tick(109_999);
  assert.deepEqual(dismissed(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(dismissed(), [id], 'fermé à 1 min 50 s');
  assert.deepEqual(undone, [], 'la fermeture n’annule rien');

  // Jeton rendu avec 60 s restantes : fermeture à 50 s.
  reset();
  const short = hookModule.showUndoToast({ title: 'x', onUndo: () => {}, validForMs: 60_000 });
  t.mock.timers.tick(49_999);
  assert.deepEqual(dismissed(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(dismissed(), [short]);

  // Jeton déjà trop court : le geste est annoncé sans « Annuler ».
  reset();
  hookModule.showUndoToast({ title: 'Séquence arrêtée pour Claire Dubois.', onUndo: () => {}, validForMs: 5_000 });
  assert.equal(customToasts().length, 0);
  assert.equal(harness.toasts[0].title, 'Séquence arrêtée pour Claire Dubois.');
});

test('toast « Annuler » : Échap le ferme sans annuler, sauf si une autre couche a traité la touche', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  reset();
  const undone = [];
  const id = hookModule.showUndoToast({ title: 'Séquence mise en pause pour Claire Dubois.', onUndo: () => { undone.push(1); } });
  const onKey = harness.listeners.get('keydown');
  assert.equal(typeof onKey, 'function', 'Échap écouté tant que le toast est ouvert');
  onKey({ key: 'Escape', defaultPrevented: true, target: null });
  assert.deepEqual(dismissed(), [], 'menu ou fenêtre fermés d’abord');
  onKey({ key: 'Enter', defaultPrevented: false, target: null });
  assert.deepEqual(dismissed(), []);
  onKey({ key: 'Escape', defaultPrevented: false, target: null });
  assert.deepEqual(dismissed(), [id]);
  assert.deepEqual(undone, []);
  assert.equal(harness.listeners.has('keydown'), false, 'écoute retirée');
});

test('toast « Annuler » : le bouton ferme le toast puis annule, une seule fois', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  reset();
  const undone = [];
  const id = hookModule.showUndoToast({ title: 'Séquence mise en pause pour Claire Dubois.', onUndo: () => { undone.push(1); } });
  const element = renderUndo(customToasts()[0]);
  assert.equal(element.props.title, 'Séquence mise en pause pour Claire Dubois.');
  element.props.onUndo();
  element.props.onUndo();
  t.mock.timers.reset();
  await flush();
  assert.deepEqual(dismissed(), [id]);
  assert.deepEqual(undone, [1]);
});

// ---------------------------------------------------------------- Arrêter et annuler un arrêt
test('« Arrêter » : stop_enrollments, toast « Séquence arrêtée pour Claire Dubois. », « Annuler » par undo_stop_enrollments avec le jeton', async () => {
  reset();
  harness.respond = async (body) => {
    if (body.action === 'stop_enrollments') {
      return {
        data: {
          success: true, token: 'tok-1', stopped_at: '2026-10-05T10:00:00Z', expires_at: '2026-10-05T10:02:00Z', expires_in_ms: 119_000,
          results: [{ enrollment_id: 'e1', outcome: 'stopped' }],
          counts: { stopped: 1 },
        },
        error: null,
      };
    }
    return { data: { success: true, results: [{ enrollment_id: 'e1', outcome: 'resumed', message: 'Arrêt annulé : le candidat reprend la séquence là où il en était.' }], counts: { resumed: 1 } }, error: null };
  };
  const settled = [];
  const { stopEnrollments } = hookModule.useUndoableEnrollmentAction();
  const summary = await stopEnrollments({ enrollmentIds: ['e1'], candidateName: 'Claire Dubois', onSettled: () => { settled.push('stop'); } });
  assert.deepEqual(summary.stoppedIds, ['e1']);
  assert.deepEqual(harness.invokes[0], { fn: 'process-sequences', body: { action: 'stop_enrollments', organization_id: 'org-1', enrollment_ids: ['e1'] } });
  const undoToast = customToasts()[0];
  assert.equal(renderUndo(undoToast).props.title, 'Séquence arrêtée pour Claire Dubois.');
  renderUndo(undoToast).props.onUndo();
  await flush();
  await flush();
  assert.deepEqual(harness.invokes[1].body, { action: 'undo_stop_enrollments', organization_id: 'org-1', enrollment_ids: ['e1'], token: 'tok-1' });
  const result = harness.toasts.find((x) => x.kind === 'success');
  assert.equal(result.title, 'Arrêt annulé : Claire Dubois reprend la séquence là où elle en était.');
  assert.equal(harness.toasts.find((x) => x.kind === 'loading').id, result.id, 'le bilan remplace « Annulation de l’arrêt… »');
  assert.deepEqual(settled, ['stop', 'stop'], 'écran relu après l’arrêt et après l’annulation');
  harness.listeners.clear();
});

test('« Arrêter » : écriture concurrente, « Arrêt impossible pour l’instant : rien n’a changé. » avec « Réessayer »', async () => {
  reset();
  let calls = 0;
  harness.respond = async (body) => {
    calls += 1;
    if (calls === 1) {
      return { data: { success: true, token: 'tok-2', expires_in_ms: 120_000, results: [{ enrollment_id: 'e1', outcome: 'changed', message: "Arrêt impossible pour l'instant : rien n'a changé." }], counts: { changed: 1 } }, error: null };
    }
    return { data: { success: true, token: 'tok-3', expires_in_ms: 120_000, results: body.enrollment_ids.map((id) => ({ enrollment_id: id, outcome: 'stopped' })), counts: { stopped: 1 } }, error: null };
  };
  const { stopEnrollments } = hookModule.useUndoableEnrollmentAction();
  await stopEnrollments({ enrollmentIds: ['e1'], candidateName: 'Claire Dubois' });
  assert.equal(customToasts().length, 0, 'rien d’arrêté : pas d’« Annuler »');
  const error = harness.toasts.find((x) => x.kind === 'error');
  assert.equal(error.title, "Arrêt impossible pour l'instant : rien n'a changé.");
  assert.equal(error.options.action.label, 'Réessayer');
  error.options.action.onClick();
  await flush();
  await flush();
  assert.deepEqual(harness.invokes.map((i) => [i.body.action, i.body.enrollment_ids]), [['stop_enrollments', ['e1']], ['stop_enrollments', ['e1']]]);
  assert.equal(renderUndo(customToasts()[0]).props.title, 'Séquence arrêtée pour Claire Dubois.');
  harness.listeners.clear();
});

test('« Arrêter » : réponse illisible (réseau), aucune promesse que rien n’a changé', () => {
  const s = msgs.summarizeStopResponse({ success: false, error: 'Problème de connexion réseau.' }, ['e1'], 'Claire Dubois');
  assert.deepEqual(s.retryIds, ['e1']);
  assert.equal(s.retryMessage, msgs.STOP_UNCONFIRMED_MESSAGE);
  assert.doesNotMatch(s.retryMessage, /rien n'a changé/);
  // Refus de la demande (201 identifiants) : la phrase du serveur, sans « Réessayer ».
  const tooMany = msgs.summarizeStopResponse({ success: false, error_code: 'too_many', message: '200 candidats au plus par demande.' }, ['e1'], null);
  assert.deepEqual([tooMany.retryIds, tooMany.refusal], [[], { tone: 'error', message: '200 candidats au plus par demande.' }]);
  // Erreur de lecture du serveur : rien n'a changé, « Réessayer ».
  const server = msgs.summarizeStopResponse({ success: false, error_code: 'server_error', message: "Arrêt impossible pour l'instant : rien n'a changé." }, ['e1', 'e2'], null);
  assert.deepEqual(server.retryIds, ['e1', 'e2']);
  assert.equal(server.retryMessage, "Arrêt impossible pour l'instant : rien n'a changé.");
});

test('« Arrêter » groupé : bilan des autres résultats, seuls les arrêtés sont annulables', () => {
  const s = msgs.summarizeStopResponse({
    success: true, token: 't',
    results: [
      { enrollment_id: 'a', outcome: 'stopped' }, { enrollment_id: 'b', outcome: 'stopped' },
      { enrollment_id: 'c', outcome: 'not_eligible', message: 'x' }, { enrollment_id: 'd', outcome: 'gdpr_erased', message: 'y' },
      { enrollment_id: 'e', outcome: 'error', message: 'z' },
    ],
  }, ['a', 'b', 'c', 'd', 'e'], null);
  assert.deepEqual(s.stoppedIds, ['a', 'b']);
  assert.deepEqual(s.retryIds, ['e']);
  assert.equal(s.title, 'Séquence arrêtée pour 2 candidats.');
  assert.equal(s.description, "1 n'était plus en cours dans la séquence ; 1 a demandé l'effacement de ses données.");
  // Un seul candidat refusé : la phrase du serveur.
  const one = msgs.summarizeStopResponse({ success: true, results: [{ enrollment_id: 'a', outcome: 'not_eligible', message: "Ce candidat n'est plus en cours dans la séquence : il n'y a rien à arrêter." }] }, ['a'], 'Claire Dubois');
  assert.deepEqual(one.refusal, { tone: 'info', message: "Ce candidat n'est plus en cours dans la séquence : il n'y a rien à arrêter." });
});

test('messages de retour exacts du plan pour l’annulation d’un arrêt', () => {
  const one = (outcome, extra = {}) => msgs.summarizeUndoStopResponse({ success: true, results: [{ enrollment_id: 'e1', outcome, ...extra }] }, 'Claire Dubois').message;
  assert.equal(one('resumed'), 'Arrêt annulé : Claire Dubois reprend la séquence là où elle en était.');
  assert.equal(one('resume_refused', { reason: 'account_unlinked' }), 'Arrêt annulé : Claire Dubois reste en pause (compte LinkedIn non relié).');
  assert.equal(one('resume_refused', { reason: 'sequence_inactive' }), 'Arrêt annulé : Claire Dubois reste en pause (séquence en pause).');
  assert.equal(one('resume_refused', { reason: 'gdpr_registry_unavailable' }), 'Arrêt annulé : Claire Dubois reste en pause (vérification des effacements indisponible).');
  assert.equal(one('replied'), 'Annulation impossible : Claire Dubois a répondu entre-temps.');
  assert.equal(one('moved_since'), 'Annulation impossible : la séquence de Claire Dubois a changé entre-temps.');
  assert.equal(one('expired'), 'Annulation impossible : le délai est passé.');
  assert.equal(one('not_author'), "Annulation impossible : seule la personne qui a arrêté la séquence peut l'annuler.");
  assert.equal(one('paused'), 'Arrêt annulé : Claire Dubois est de nouveau en pause.');
  assert.equal(msgs.summarizeUndoStopResponse({ success: true, results: [{ enrollment_id: 'e1', outcome: 'resumed' }] }, 'Claire Dubois').tone, 'success');
  assert.equal(msgs.summarizeUndoStopResponse({ success: true, results: [{ enrollment_id: 'e1', outcome: 'replied' }] }, 'Claire Dubois').tone, 'error');
  // Sans nom : la phrase reste juste.
  assert.equal(msgs.summarizeUndoStopResponse({ success: true, results: [{ enrollment_id: 'e1', outcome: 'moved_since' }] }).message, 'Annulation impossible : la séquence du candidat a changé entre-temps.');
  // Groupe : tout annulé, ou en partie avec le détail.
  const group = msgs.summarizeUndoStopResponse({ success: true, results: [
    { enrollment_id: 'a', outcome: 'resumed' }, { enrollment_id: 'b', outcome: 'replied' }, { enrollment_id: 'c', outcome: 'resume_refused', reason: 'account_unlinked' },
  ] });
  assert.equal(group.message, 'Arrêt annulé pour 2 candidats sur 3.');
  assert.equal(group.description, 'Reste en pause (compte LinkedIn non relié) : 1 candidat ; réponse reçue entre-temps : 1 candidat.');
  assert.equal(msgs.summarizeUndoStopResponse({ success: true, results: [{ enrollment_id: 'a', outcome: 'expired' }, { enrollment_id: 'b', outcome: 'expired' }] }).message, 'Annulation impossible : le délai est passé.');
});

// ---------------------------------------------------------------- Pause et annulation d'une pause
test('« Annuler » une pause : resume_enrollments sur les seules inscriptions rendues, par lots de 25, « Pause annulée. »', async () => {
  reset();
  harness.respond = async (body) => ({ data: { success: true, counts: { resumed: body.enrollment_ids.length } }, error: null });
  const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
  const settled = [];
  const { offerUndoPause } = hookModule.useUndoableEnrollmentAction();
  offerUndoPause({ title: '30 candidats mis en pause', enrollmentIds: ids, onSettled: () => { settled.push(1); } });
  renderUndo(customToasts()[0]).props.onUndo();
  await flush();
  await flush();
  await flush();
  assert.deepEqual(harness.invokes.map((i) => [i.body.action, i.body.enrollment_ids.length]), [['resume_enrollments', 25], ['resume_enrollments', 5]]);
  assert.deepEqual(harness.invokes.flatMap((i) => i.body.enrollment_ids), ids, 'jamais par séquence ni par raison');
  assert.equal(harness.toasts.find((x) => x.kind === 'success').title, 'Pause annulée.');
  assert.deepEqual(settled, [1]);
  harness.listeners.clear();
});

test('bilans d’une pause et d’un arrêt : textes exacts', () => {
  assert.equal(msgs.pauseToastTitle('Claire Dubois'), 'Séquence mise en pause pour Claire Dubois.');
  assert.equal(msgs.stopToastTitle(1, 'Claire Dubois'), 'Séquence arrêtée pour Claire Dubois.');
  assert.equal(msgs.sequencePauseToastTitle(6), 'Séquence mise en pause : 6 candidats en pause.');
  assert.equal(msgs.sequencePauseToastTitle(0), "Séquence mise en pause : aucun candidat n'était en cours.");
  assert.equal(msgs.PAUSE_UNDONE_MESSAGE, 'Pause annulée.');
  assert.equal(msgs.STOP_FAILED_MESSAGE, "Arrêt impossible pour l'instant : rien n'a changé.");
  assert.deepEqual(msgs.summarizeUndoPause({ counts: { resumed: 2 }, total: 2 }), { tone: 'success', message: 'Pause annulée.' });
  const partial = msgs.summarizeUndoPause({ counts: { resumed: 1, account_unlinked: 1 }, total: 2 });
  assert.equal(partial.message, 'Pause annulée pour 1 candidat sur 2.');
  assert.equal(partial.description, 'Reste en pause (compte LinkedIn non relié) : 1 candidat.');
  const none = msgs.summarizeUndoPause({ counts: { not_paused: 1 }, total: 1, name: 'Claire Dubois' });
  assert.deepEqual([none.tone, none.message, none.description], ['error', "La pause n'a pas pu être annulée.", "Cette séquence n'était plus en pause."]);
  // Une étape annulée par l'arrêt se lit comme telle dans le parcours, si
  // l'inscription porte la trace de l'arrêt ; sans elle, « Arrêt manuel » est
  // l'ancien motif d'une simple pause (navigateur d'avant le 28/09).
  assert.equal(msgs.formatSkipReason('Arrêt manuel', { manualStop: true }), 'Séquence arrêtée pour ce candidat');
  assert.equal(msgs.formatSkipReason('Arrêt manuel'), 'Candidat mis en pause');
  assert.equal(msgs.formatSkipReason('Arrêt manuel', { manualStop: false }), 'Candidat mis en pause');
  assert.equal(msgs.formatSkipReason('Stoppé depuis Inbox', { manualStop: true }), 'Candidat mis en pause');
  assert.equal(msgs.formatSkipReason('Stoppé depuis Inbox'), 'Candidat mis en pause');
});

test('motif « Arrêt manuel » : « arrêtée » seulement sur une inscription qui porte la trace de l’arrêt, dans le suivi, la fiche et le Journal', () => {
  assert.equal(labels.hasManualStopTrace({ manual_stop: { token: 't', by: 'u1', at: '2026-10-05T10:00:00Z' } }), true);
  assert.equal(labels.hasManualStopTrace({ completion_reason: 'manual_stop' }), false);
  assert.equal(labels.hasManualStopTrace({ manual_stop_undone_at: '2026-10-05T10:01:00Z' }), false, 'arrêt annulé : retour à une pause');
  assert.equal(labels.hasManualStopTrace(null), false);
  assert.equal(labels.isManualStopTrace({ by: 'u1' }), true, 'réponse tardive : statut « répondu », trace gardée');
  assert.equal(labels.isManualStopTrace('x'), false);
  assert.match(panel, /formatSkipReason\(exec\.skip_reason, \{ manualStop: hasManualStopTrace\(enrollment\.tracking_data\) \}\)/);
  assert.match(fiche, /formatSkipReason\(execution\.skip_reason, \{ manualStop: stoppedManually \}\)/);
  assert.match(fiche, /stoppedManually=\{enrollment\.stopped_manually\}/);
  assert.match(ficheHook, /stopped_manually: isManualStopTrace\(e\.manual_stop\),/);
  const journal = stripComments(read('src/components/outreach/SequenceActivityLog.tsx'));
  assert.match(journal, /formatSkipReason\(exec\.skip_reason, \{ manualStop: exec\.enrollment\?\.stoppedManually \}\)/);
  assert.match(journal, /\.select<string, \{ id: string; manual_stop: unknown \}>\('id, manual_stop:tracking_data->manual_stop'\)/);
  assert.match(journal, /stoppedManually: stoppedManually\.has\(exec\.enrollment_id\),/);
});

// ---------------------------------------------------------------- Plus de fenêtre sur ces gestes
test('plus d’AlertDialog sur la pause, la pause groupée, la mise en pause de la séquence et l’arrêt', () => {
  // Suivi des inscrits.
  assert.doesNotMatch(panel, /type: 'stop'|type: 'bulkStop'/);
  assert.doesNotMatch(panel, /Mettre en pause la séquence pour \$\{confirmName\} \?|Mettre en pause tous les candidats actifs \(\$\{statusCounts\.active\}\) \?/);
  assert.match(panel, /onClick=\{\(\) => \{ void stopEnrollment\(enrollment\.id\); \}\}/);
  assert.match(panel, /onClick=\{\(\) => \{ void stopForCandidate\(enrollment\.id\); \}\}/);
  assert.match(panel, /onClick=\{\(\) => \{ void runBulk\('pause', bulkStopActive\); \}\}/);
  assert.match(panel, /onClick=\{\(\) => \{ void runBulk\('stop', bulkManualStop\); \}\}/);
  // Fiche candidat.
  assert.doesNotMatch(fiche, /confirmStop|Mettre en pause « \{sequenceName/);
  assert.match(fiche, /onStop=\{\(\) => \{ void stop\(enrollment\.id\); \}\}/);
  assert.match(fiche, /onManualStop=\{\(\) => \{ void manualStop\(enrollment\.id\); \}\}/);
  // Messagerie.
  assert.doesNotMatch(inbox, /stopSeqConfirm|Mettre la séquence en pause \?/);
  assert.match(inbox, /onSelect=\{\(\) => \{ void handleStopSequence\(\); \}\}/);
  // Interrupteur de la séquence.
  assert.doesNotMatch(list, /toggleConfirm|Désactiver cette séquence \?/);
});

test('les autres gestes gardent leur fenêtre', () => {
  assert.match(list, /Réactiver cette séquence \?/);
  assert.match(list, /Supprimer cette séquence \?/);
  assert.match(read('src/components/outreach/SequenceActivityLog.tsx'), /Ne pas envoyer cette étape \?/);
  assert.match(panel, /`Marquer \$\{confirmName\} comme ayant répondu \?`/);
  assert.match(fiche, /Marquer \{replyName\} comme ayant répondu \?/);
  // L'ancien tableau de mission garde sa fenêtre jusqu'aux lots de retrait.
  assert.match(read('src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx'), /AlertDialog/);
});

// ---------------------------------------------------------------- Annulation par le serveur, aucune écriture interdite
test('annulation par process-sequences : resume_enrollments et undo_stop_enrollments, arrêt par stop_enrollments', () => {
  assert.match(hookSrc, /action: 'stop_enrollments'/);
  assert.match(hookSrc, /action: 'undo_stop_enrollments'/);
  assert.match(hookSrc, /action: 'resume_enrollments'/);
  assert.match(hookSrc, /invokeEdgeFunction<StopResponse>\('process-sequences'/);
  assert.match(hookSrc, /export const UNDO_RESUME_CHUNK = 25;/);
  // Pause de séquence annulée : interrupteur avec les contrôles d'offre de
  // « Réactiver » (décision 32), puis reprise des seuls identifiants rendus.
  const undo = actions.slice(actions.indexOf('const undoSequencePause = async'), actions.indexOf('const activateSequence = async'));
  assert.ok(undo.indexOf('plan.unknown') < undo.indexOf(".update({ is_active: true })"), 'contrôle d’abonnement avant l’écriture');
  assert.ok(undo.indexOf('plan.canSend') < undo.indexOf(".update({ is_active: true })"));
  assert.match(undo, /\.update\(\{ is_active: true \}\)\s*\.eq\('id', sequenceId\)\s*\.select\('id'\)/);
  assert.match(undo, /await resumeIds\(enrollmentIds\)/);
  assert.doesNotMatch(undo, /pause_reasons|sequence_id:/, 'jamais par séquence et raisons');
  assert.match(actions, /onUndo: \(\) => undoSequencePause\(sequenceId, undoIds\)/);
});

test('aucune écriture de statut « active » ni « completed », ni d’exécution, depuis le navigateur', () => {
  for (const [name, src] of Object.entries({ panel, fiche, ficheHook, inbox, list, hookSrc, actions, saveHook })) {
    assert.doesNotMatch(src, /\.update\(\{[^}]*status: '(active|completed)'/, `${name} : statut écrit par le navigateur`);
    assert.doesNotMatch(src, /from\('sequence_step_executions'\)\s*\.(update|insert|upsert|delete)\(/, `${name} : exécution écrite par le navigateur`);
  }
  // Les pauses restent des écritures bornées et relues.
  assert.match(actions, /\.update\(\{ status: 'paused', pause_reason: 'manual' \}\)\s*\.eq\('id', enrollmentId\)\s*\.eq\('status', 'active'\)\s*\.select\('id'\)/);
  assert.match(ficheHook, /\.eq\('status', 'active'\)\s*\.select\('id'\)/);
  assert.match(inbox, /\.in\('id', ids\)\s*\.eq\('status', 'active'\)\s*\.select\('id'\);/);
  // « Annuler » ne reprend que les identifiants rendus par l'écriture de pause.
  assert.match(actions, /enrollmentIds: data\.map\(row => row\.id\)/);
  assert.match(actions, /const pausedIds = \(data \?\? \[\]\)\.map\(row => row\.id\);/);
  assert.match(ficheHook, /enrollmentIds: data\.map\(row => row\.id\)/);
  assert.match(inbox, /enrollmentIds: \(paused \?\? \[\]\)\.map\(e => e\.id\)/);
  assert.match(actions, /pausedIds = \(paused \?\? \[\]\)\.map\(row => row\.id\);/);
});

// ---------------------------------------------------------------- Arrêt : aide, statut, relance
test('aide exacte sous « Arrêter pour ce candidat », aucun « Définitif »', () => {
  assert.equal(labels.MANUAL_STOP_HELP, 'Le candidat reste compté comme contacté pendant 90 jours. Vous pourrez le relancer plus tard.');
  assert.equal(labels.STOP_FOR_CANDIDATE_LABEL, 'Arrêter pour ce candidat');
  for (const [name, src] of Object.entries({ panel, fiche })) {
    assert.match(src, /\{STOP_FOR_CANDIDATE_LABEL\}/, `${name} : élément de menu`);
    assert.match(src, /\{MANUAL_STOP_HELP\}/, `${name} : aide sous l'élément`);
    assert.match(src, /aria-describedby=\{`stop-help-\$\{enrollment\.id\}`\}/, `${name} : aide reliée`);
  }
  // « Actions pour X » (suivi) et « Actions de l'inscription » (fiche).
  assert.match(panel, /aria-label=\{`Actions pour \$\{enrollment\.profile_name \|\| 'ce candidat'\}`\}/);
  assert.match(fiche, /aria-label="Actions de l'inscription"/);
  for (const [name, src] of Object.entries({ panel, fiche, ficheHook, inbox, hookSrc })) {
    assert.doesNotMatch(src, /[Dd]éfinitif/, `${name} : « Définitif »`);
  }
  for (const value of [labels.MANUAL_STOP_HELP, msgs.stopToastTitle(3), msgs.STOP_FAILED_MESSAGE]) {
    assert.doesNotMatch(value, /[Dd]éfinitif/);
  }
});

test('arrêt groupé : 200 au plus, en cours ou en pause, masqué au collaborateur', () => {
  assert.match(panel, /const BULK_STOP_MAX = 200;/);
  const bulk = panel.slice(panel.indexOf('const bulkManualStop = async'), panel.indexOf('const runBulk = async'));
  assert.match(bulk, /\.in\('status', \['active', 'paused'\]\)/);
  assert.match(bulk, /\.limit\(BULK_STOP_MAX \+ 1\)/);
  assert.match(bulk, /if \(ids\.length > BULK_STOP_MAX\)/);
  assert.match(bulk, /await stopEnrollments\(\{ enrollmentIds: ids/);
  assert.match(panel, /\{canBulkManage && stoppableCount > 0 && \(/);
  assert.match(panel, /const canBulkManage = !isCollaborator;/);
  // Arrêt d'un candidat : ses propres inscriptions pour un collaborateur, jamais après un effacement.
  assert.match(panel, /\{ownRow && !gdprErased && \(enrollment\.status === 'active' \|\| enrollment\.status === 'paused'\) && \(\s*<DropdownMenuItem\s*onClick=\{\(\) => \{ void stopForCandidate/);
  assert.match(fiche, /const canManualStop = \(isActive \|\| isPaused\) && ownRow && !gdprErased;/);
});

test('après un arrêt : « Arrêtée par Guillaume Martin le 29/09 » et « Relancer la séquence » (re_enroll)', () => {
  const info = labels.readManualStop('completed', 'manual_stop', { token: 't', by: 'u1', at: '2026-09-29T10:00:00', previous_status: 'active' });
  assert.deepEqual(info, { by: 'u1', at: '2026-09-29T10:00:00' });
  assert.equal(labels.manualStopLabel(info, 'Guillaume Martin'), 'Arrêtée par Guillaume Martin le 29/09');
  assert.equal(labels.manualStopLabel(info, null), 'Arrêtée le 29/09');
  assert.equal(labels.readManualStop('completed', 'meeting_booked', {}), null, 'fin pour rendez-vous : pas un arrêt');
  assert.equal(labels.readManualStop('active', 'manual_stop', {}), null, 'relancée : plus un arrêt');
  assert.deepEqual(labels.readManualStopFromTracking('completed', { completion_reason: 'manual_stop', manual_stop: { by: 'u2', at: '2026-09-29T10:00:00' } }), { by: 'u2', at: '2026-09-29T10:00:00' });
  assert.equal(labels.RELAUNCH_AFTER_STOP_LABEL, 'Relancer la séquence');
  // Suivi : statut et relance.
  assert.match(panel, /const manualStop = readManualStopFromTracking\(enrollment\.status, enrollment\.tracking_data\);/);
  assert.match(panel, /\{manualStop \? RELAUNCH_AFTER_STOP_LABEL : 'Relancer depuis l’étape suivante'\}/);
  // Fiche : statut lu dans tracking_data, relance par re_enroll après confirmation.
  assert.match(ficheHook, /completion_reason:tracking_data->>completion_reason,/);
  assert.match(ficheHook, /manual_stop:tracking_data->manual_stop,/);
  assert.match(ficheHook, /action: 're_enroll'/);
  assert.match(fiche, /\{RELAUNCH_AFTER_STOP_LABEL\}/);
  assert.match(fiche, /if \(target\) await reEnroll\(target\.id\);/);
  // Badge commun : statut d'un arrêt manuel.
  assert.match(badges, /manualStop \? manualStopLabel\(manualStop, stoppedByName\)/);
});

test('statut « Arrêtée par … le … » aussi dans la messagerie, le Pipeline et la chronologie du profil', () => {
  const inboxHook = read('src/hooks/useMessagesInbox.ts');
  assert.match(inboxHook, /completion_reason:tracking_data->>completion_reason, manual_stop:tracking_data->manual_stop'\)/);
  assert.match(inbox, /const enrollmentManualStop = jobInfo \? readManualStop\(enrollmentStatus, jobInfo\.completion_reason, jobInfo\.manual_stop\) : null;/);
  assert.match(inbox, /manualStop=\{enrollmentManualStop\}\s*stoppedByName=\{memberName\(enrollmentManualStop\?\.by\)\}/);
  const ats = read('src/hooks/useATSData.ts');
  assert.equal((ats.match(/completion_reason:tracking_data->>completion_reason, manual_stop:tracking_data->manual_stop/g) || []).length, 2, 'inscriptions des lignes de mission et inscriptions seules');
  assert.equal((ats.match(/sequenceManualStop: readManualStop\(/g) || []).length, 2);
  for (const rel of ['src/components/ats/ATSCandidateCard.tsx', 'src/components/ats/ATSTable.tsx']) {
    const src = read(rel);
    assert.match(src, /manualStop=\{candidate\.sequenceManualStop\}\s*stoppedByName=\{memberName\(candidate\.sequenceManualStop\?\.by\)\}/, rel);
    assert.match(src, /const memberName = useMemberName\(\);/, rel);
  }
  const profile = read('src/hooks/useCandidateFullProfile.ts');
  assert.match(profile, /manualStop: readManualStopFromTracking\(e\.status, e\.tracking_data\),/);
  assert.match(profile, /detail: se\.manualStop \? manualStopLabel\(se\.manualStop, memberName\(se\.manualStop\.by\)\)\s*: se\.status === 'completed' \? 'Séquence terminée'/);
  // Badge commun : seulement pour une inscription terminée.
  assert.match(badges, /const manualStop = status === 'completed' \? manualStopInfo \?\? null : null;/);
  const team = read('src/hooks/useTeamMembers.ts');
  assert.match(team, /export function useMemberName\(\)/);
  assert.match(team, /member\?\.displayName \|\| member\?\.email \|\| \(userId === currentUserId \? 'vous' : null\)/);
});

test('pause partielle : « Annuler » offert pour les seules inscriptions mises en pause (suivi et messagerie)', () => {
  // Lot 5c-1 : dans sequenceActions.ts, bulkStopActive est suivi de bulkResumePaused.
  const bulk = actions.slice(actions.indexOf('const bulkStopActive = async'), actions.indexOf('const bulkResumePaused = async'));
  assert.match(bulk, /const offerPartialUndo = \(title: string, description: string\) => offerUndoPause\(\{\s*title, description, tone: 'warning', enrollmentIds: pausedIds,/);
  assert.equal((bulk.match(/if \(paused > 0 && pausedIds\.length > 0\) offerPartialUndo\(/g) || []).length, 2, 'recompte illisible, et candidats encore en cours');
  // Toast sans « Annuler » seulement quand rien n'a été mis en pause.
  assert.match(bulk, /else toast\.warning\(paused > 0 \? pausedText : 'Aucun candidat n’a été mis en pause', \{ description \}\);/);
  assert.match(bulk, /else toast\.error\(title, \{ description \}\);/);
  const pause = inbox.slice(inbox.indexOf('const partial = pausedCount < ids.length;'), inbox.indexOf("console.error('[MessageView] pause sequence error:'"));
  assert.match(pause, /offerUndoPause\(\{/);
  assert.match(pause, /\.\.\.\(partial \? \{ description: 'Les autres n’ont pas pu être mises en pause\. Réessayez\.', tone: 'warning' as const \} : \{\}\)/);
  assert.match(pause, /enrollmentIds: \(paused \?\? \[\]\)\.map\(e => e\.id\)/);
  assert.doesNotMatch(pause, /toast\.warning\(/);
});

test('libellés du plan : « Mettre en pause pour ce candidat » partout, « Arrêter (N) » groupé ; déclencheur de la fiche jamais désactivé', () => {
  for (const [name, src] of Object.entries({ panel, fiche, inbox })) {
    assert.match(src, /[>}]\s*Mettre en pause pour ce candidat\s*</, name);
  }
  assert.doesNotMatch(inbox, /Mettre la séquence en pause/);
  assert.doesNotMatch(fiche, /[>}]\s*Mettre en pause\s*</);
  assert.match(panel, /\{`Arrêter \(\$\{stoppableCount\}\)`\}/);
  assert.doesNotMatch(panel, /Arrêter pour tous les candidats/);
  // Focus rendu au déclencheur après « Arrêter pour ce candidat » : il n'est jamais désactivé.
  assert.match(fiche, /<Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions de l'inscription">/);
  assert.match(fiche, /onClick=\{onManualStop\}\s*disabled=\{isBusy\}/);
  assert.match(fiche, /<DropdownMenuItem onClick=\{onReEnroll\} disabled=\{isBusy\}>/);
  assert.match(fiche, /<DropdownMenuItem onClick=\{onMarkReplied\} disabled=\{isBusy\}>/);
});

test('interrupteur « Mettre en pause la séquence » : plus de vocabulaire « désactiver » dans ses messages ni dans le statut', () => {
  for (const legacy of [/Désactivation réservée/, /Désactivation impossible/, /pas pu être désactivée/, /Désactivez puis réactivez/, /de désactiver la séquence/, /Préférez la désactivation/, /Désactiver une séquence/]) {
    assert.doesNotMatch(`${list}\n${actions}\n${saveHook}`, legacy, String(legacy));
  }
  assert.match(actions, /toast\.error\('Mise en pause réservée', \{ description: COLLABORATOR_DEACTIVATION_HINT \}\)/);
  assert.match(actions, /toast\.error\('Mise en pause impossible', \{ description: 'Vous n’avez pas les droits sur cette séquence\.' \}\)/);
  assert.equal(labels.PAUSE_REASON_LABELS.sequence_inactive, 'En pause (séquence en pause)');
  assert.equal(msgs.formatSkipReason('Séquence désactivée'), 'Séquence mise en pause');
});

test('CLAUDE.md porte l’exception à la règle AlertDialog et les écrans de l’arrêt', () => {
  assert.match(claude, /\*\*Exception écrite \(lot 5b, décision 3/);
  assert.match(claude, /\*\*Écrans de l'arrêt et de la pause \(lot 5b\)\*\*/);
  assert.match(claude, /tests\/ux\/lot5b-arret-pause\.test\.mjs/);
});

test('textes visibles : vouvoiement, sans tiret long ni nom de prestataire', () => {
  const visible = [
    labels.MANUAL_STOP_HELP, labels.STOP_FOR_CANDIDATE_LABEL, labels.RELAUNCH_AFTER_STOP_LABEL,
    msgs.STOP_FAILED_MESSAGE, msgs.STOP_UNCONFIRMED_MESSAGE, msgs.UNDO_FAILED_MESSAGE, msgs.UNDO_EXPIRED_MESSAGE,
    msgs.PAUSE_UNDONE_MESSAGE, msgs.PAUSE_UNDO_FAILED_MESSAGE,
  ];
  for (const text of visible) {
    assert.doesNotMatch(text, /—/, text);
    assert.doesNotMatch(text, /Unipile|Apollo|PDL|Anthropic|Claude|\btu\b|\bton\b|\bta\b/, text);
  }
  assert.doesNotMatch(hookSrc, /—/);
});
