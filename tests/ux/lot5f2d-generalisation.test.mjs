/**
 * Refonte mission, lot 5f-2d, chantier A : ContactFlow sans mission du Pipeline
 * (src/components/sequences/contact/).
 *
 * Les entrées hors Pipeline (profils de recherche, fiches, messagerie, page d'une séquence)
 * donnent à ContactFlow des candidats sans ligne de mission (rowId nul), parfois sans mission
 * ni poste (missionId et job nuls), sans « Réessayer » ni fiche à ouvrir. `strict` est faux
 * dans tsconfig.app.json : tsc ne voit aucun accès nul. Ces sites ne sont donc protégés que
 * par ce fichier, en comportement :
 *
 *  - ContactFlow est empaqueté par esbuild avec des doublures des hooks et des écrans voisins,
 *    puis rendu par un mini-moteur de hooks (états, mémos, effets, sans DOM) : on lit l'arbre
 *    d'éléments rendu et on appelle les gestes (clic sur « Inscrire », fin de la fenêtre de
 *    relecture, choix d'une séquence) comme le ferait la page ;
 *  - SequencePicker et RecipientGroups sont rendus par react-dom/server (menu du kit remplacé
 *    par une doublure ouverte, comme dans lot5f2c-composants) ;
 *  - flowCandidates et useContactSequences sont empaquetés tels quels ;
 *  - ContactFlowSheet est rendu par le même mini-moteur, ContactFlow y étant une doublure
 *    dont on lit les props.
 *
 * Lancer : node --test tests/ux/lot5f2d-generalisation.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Sans commentaires : les gardes de code lisent le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const EM_DASH = String.fromCharCode(0x2014);

let esbuild = null;
try {
  esbuild = await import('esbuild');
} catch {
  esbuild = null;
}

let ts = null;
try {
  ts = (await import('typescript')).default;
} catch {
  ts = null;
}

const DIR = 'src/components/sequences/contact';
const FLOW = `${DIR}/ContactFlow.tsx`;
const SHEET = `${DIR}/ContactFlowSheet.tsx`;
const CANDIDATES = `${DIR}/flowCandidates.ts`;
const PICKER = `${DIR}/SequencePicker.tsx`;
const GROUPS = `${DIR}/RecipientGroups.tsx`;
const SEQUENCES = `${DIR}/useContactSequences.ts`;
const TYPES = `${DIR}/types.ts`;
const NEW_FILES = [SHEET, CANDIDATES];
const MY_FILES = [FLOW, SHEET, CANDIDATES, PICKER, GROUPS, SEQUENCES, TYPES];

const flow = read(FLOW);
const flowCode = code(flow);

/** Textes que la personne peut lire : texte JSX, phrases entre guillemets (hors imports). */
function visibleTexts(rel) {
  const file = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text) out.push(text);
    } else if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      if (/\s/.test(node.text) && /[A-Za-zÀ-ÿ]/.test(node.text)) out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

// ─── Chargement : esbuild, alias « @/ » dans src/, doublures par chemin d'import ─────────────

/** Transpile un module (TSX compris) et le charge ; les chemins listés dans `stubs` sont remplacés. */
async function loadBundled(rel, stubs = {}) {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [{
      name: 'alias-and-stubs-5f2d',
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

/** Composants doublures : une fonction vide marquée, que le test retrouve dans l'arbre rendu. */
const markers = (...names) => names.map((name) => `export const ${name} = Object.assign(() => null, { __tag: '${name}' });`).join('\n');

// Hooks et fabrique d'éléments : le mini-moteur de ce fichier (globalThis.__rt) les sert.
const REACT_STUB = [
  'const rt = () => globalThis.__rt;',
  'export const useState = (initial) => rt().useState(initial);',
  'export const useRef = (initial) => rt().useRef(initial);',
  'export const useMemo = (factory, deps) => rt().useMemo(factory, deps);',
  'export const useCallback = (fn, deps) => rt().useCallback(fn, deps);',
  'export const useEffect = (effect, deps) => rt().useEffect(effect, deps);',
  'export default {};',
].join('\n');
const JSX_STUB = [
  'export const jsx = (type, props, key) => ({ type, props, key });',
  'export const jsxs = jsx;',
  "export const Fragment = 'Fragment';",
].join('\n');
const BASE_STUBS = {
  react: REACT_STUB,
  'react/jsx-runtime': JSX_STUB,
  'react/jsx-dev-runtime': JSX_STUB.replace('export const jsxs = jsx;', 'export const jsxDEV = jsx;'),
};

// ─── Mini-moteur de rendu : états, mémos, effets, nouveau rendu après un changement d'état ──────

const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

class Instance {
  constructor(component, props) {
    this.component = component;
    this.props = props;
    this.slots = [];
    this.cursor = 0;
    this.hookCount = 0;
    this.pending = [];
    this.tree = null;
    this.dirty = false;
    this.unmounted = false;
  }

  render() {
    const previous = globalThis.__rt;
    globalThis.__rt = this;
    this.cursor = 0;
    this.pending = [];
    try {
      this.tree = this.component(this.props);
    } finally {
      globalThis.__rt = previous;
    }
    this.hookCount = this.cursor;
    for (const run of this.pending) run();
    return this.tree;
  }

  setProps(next) {
    this.props = { ...this.props, ...next };
    return this.render();
  }

  schedule() {
    if (this.dirty || this.unmounted) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      if (!this.unmounted) this.render();
    });
  }

  useState(initial) {
    const i = this.cursor++;
    if (!this.slots[i]) {
      const slot = { value: typeof initial === 'function' ? initial() : initial };
      slot.set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        this.schedule();
      };
      this.slots[i] = slot;
    }
    return [this.slots[i].value, this.slots[i].set];
  }

  useRef(initial) {
    const i = this.cursor++;
    if (!this.slots[i]) this.slots[i] = { current: initial };
    return this.slots[i];
  }

  useMemo(factory, deps) {
    const i = this.cursor++;
    const slot = this.slots[i];
    if (slot && deps && sameDeps(slot.deps, deps)) return slot.value;
    const value = factory();
    this.slots[i] = { deps, value };
    return value;
  }

  useCallback(fn, deps) {
    return this.useMemo(() => fn, deps);
  }

  useEffect(effect, deps) {
    const i = this.cursor++;
    const known = this.slots[i];
    if (known && deps && sameDeps(known.deps, deps)) return;
    const slot = known ?? { cleanup: undefined };
    slot.deps = deps;
    this.slots[i] = slot;
    this.pending.push(() => {
      if (typeof slot.cleanup === 'function') slot.cleanup();
      const cleanup = effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    });
  }

  unmount() {
    this.unmounted = true;
    for (const slot of this.slots) if (slot && typeof slot.cleanup === 'function') slot.cleanup();
  }
}

function mount(component, props) {
  const instance = new Instance(component, props);
  instance.render();
  return instance;
}

/** Laisse passer les nouveaux rendus et les promesses en attente. */
async function settle(turns = 4) {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ─── Lecture de l'arbre d'éléments rendu ────────────────────────────────────

function* walk(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  if (typeof node !== 'object') {
    yield node;
    return;
  }
  yield node;
  // Composant local du fichier rendu (LeaveButton) : sans doublure ni hook, on le déroule ; les doublures marquées restent des feuilles.
  if (typeof node.type === 'function' && !node.type.__tag) {
    yield* walk(node.type(node.props));
    return;
  }
  yield* walk(node.props?.children);
}
const elementsOf = (tree) => [...walk(tree)].filter((node) => typeof node === 'object');
const textOf = (tree) => [...walk(tree)].filter((node) => typeof node !== 'object').join('');
const byTag = (tree, tag) => elementsOf(tree).filter((element) => element.type?.__tag === tag);
const labelOf = (button) => textOf(button.props.children).replace(/\s+/g, ' ').trim();
const buttons = (tree) => byTag(tree, 'Button');
const buttonLabeled = (tree, label) => buttons(tree).find((button) => labelOf(button) === label);
const buttonStarting = (tree, start) => buttons(tree).find((button) => labelOf(button).startsWith(start));
const withAria = (tree, label) => elementsOf(tree).find((element) => element.props?.['aria-label'] === label);
const notes = (tree) => elementsOf(tree).filter((element) => element.props?.role === 'note').map((element) => textOf(element.props.children));

// ═══════════════════════════════════════════════════════════════════════════
// 1. ContactFlow : sept sites nuls, en comportement
// ═══════════════════════════════════════════════════════════════════════════

const MISSION = '5b1c2d3e-0000-4000-8000-000000000001';

const FLOW_STUBS = {
  ...BASE_STUBS,
  'react-router-dom': `${markers('Link')}\nexport const useNavigate = () => globalThis.__cf.navigate;`,
  '@tanstack/react-query': 'export const useQueryClient = () => ({});',
  sonner: 'const record = (kind) => (...args) => globalThis.__cf.calls.toasts.push([kind, ...args]);\nexport const toast = Object.assign(record("message"), { error: record("error"), success: record("success"), warning: record("warning"), info: record("info") });',
  '@/components/ui/button': markers('Button'),
  '@/components/ui/skeleton': markers('Skeleton'),
  '@/components/ui/UpgradePrompt': markers('UpgradePrompt'),
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/components/outreach/EnrollmentPreviewModal': markers('EnrollmentPreviewModal'),
  '@/components/outreach/enrollment-preview/SendingAccountNotice': markers('SendingAccountNotice'),
  '@/components/outreach/enrollment-preview/useSendingAccount': 'export const useSendingAccount = (accountId) => { globalThis.__cf.calls.sendingAccount.push(accountId); return globalThis.__cf.sendingAccount; };',
  '@/components/outreach/enrollment-preview/RecipientsConfirm': markers('FirstMessagePreviewBlock', 'RecipientsConfirm'),
  '@/components/outreach/enrollment-preview/useRecipientsConfirm': 'export const useRecipientsConfirm = () => globalThis.__cf.recipients;',
  '@/components/outreach/enrollment-preview/firstMessagePath': 'export const firstMessagePath = () => ({ messages: [], firstAction: null });',
  '@/components/outreach/enrollment-preview/enrollmentHelpers': [
    "export const DUPLICATE_CHECK_FAILED_MESSAGE = 'Vérification impossible.';",
    "export const NO_LINKEDIN_ACCOUNT_DESCRIPTION = 'Reliez un compte.';",
    "export const NO_LINKEDIN_ACCOUNT_TITLE = 'Aucun compte LinkedIn';",
    "export const SEQUENCES_PLAN_REQUIRED_MESSAGE = 'Plan requis.';",
    'export const findBlockingSequenceEnrollments = async (...args) => { globalThis.__cf.calls.blocking.push(args); return globalThis.__cf.blockingResult; };',
    "export const firstActionSummary = () => 'Première action : message.';",
  ].join('\n'),
  '@/hooks/useFilteredLinkedInAccounts': 'export const useFilteredLinkedInAccounts = () => globalThis.__cf.accounts;',
  '@/hooks/useLinkedInQuotaStatus': 'export const useLinkedInQuotaStatus = () => ({ data: undefined, isError: false });',
  '@/hooks/useOrganization': 'export const useOrganization = () => globalThis.__cf.organization;',
  '@/hooks/useSubscriptionState': 'export const useSubscriptionState = () => globalThis.__cf.subscription;',
  '@/hooks/usePreviewValues': [
    'export const previewDisplayText = () => "";',
    'export const usePreviewValues = (args) => { globalThis.__cf.calls.previewValues.push(args); return globalThis.__cf.previewValues; };',
  ].join('\n'),
  '@/lib/enrollCandidates': 'export const enrollCandidates = async (args) => { globalThis.__cf.calls.enroll.push(args); await new Promise((resolve) => setImmediate(resolve)); return globalThis.__cf.enrollOutcome(args); };',
  '@/lib/sequenceCatalog': "export const sequenceActionLabel = (type) => type;",
  '@/lib/sequenceCompatibility': 'export const normalizeNetworkDistance = () => null;\nexport const pickFirstStep = (steps) => ({ step: steps[0] ?? null });',
  '@/lib/stageDisplay': 'export const invalidateMissionContacted = async () => {};\nexport const invalidateStageReaders = async () => {};',
  '@/lib/utils': "export const cn = (...parts) => parts.filter(Boolean).join(' ');",
  './announceEnrollOutcome': 'export const announceEnrollOutcome = (outcome, context) => { globalThis.__cf.calls.announce.push({ outcome, context }); };',
  './flowSteps': [
    'export const toFlowSteps = (rows) => rows.map((row) => ({ ...row, stepId: row.id, actionType: row.action_type, messageTemplate: row.message_template ?? "", subjectTemplate: "" }));',
    "export const flowSequenceInfo = (steps) => ({ aiReview: false, messageSteps: steps.filter((step) => step.actionType === 'message'), hasWrittenSteps: true });",
    'export const isPreviewedMessageStep = () => true;',
  ].join('\n'),
  './QuotaGauge': markers('QuotaGauge'),
  './RecipientGroups': markers('RecipientGroups'),
  './SequencePicker': markers('SequencePicker'),
  './useContactEligibility': 'export const useContactEligibility = () => globalThis.__cf.eligibility;',
  './useContactSequences': 'export const useContactSequences = (missionId) => { globalThis.__cf.calls.sequences.push(missionId); return globalThis.__cf.sequencesRead; };',
  './useSequenceSteps': "export const useSequenceSteps = (sequenceId) => { globalThis.__cf.calls.steps.push(sequenceId); return sequenceId ? globalThis.__cf.stepsRead : { steps: null, status: 'loading', refetch() {} }; };",
};

const flowModule = esbuild ? await loadBundled(FLOW, FLOW_STUBS) : null;

const SEQ = (id, extra = {}) => ({
  id,
  name: `Séquence ${id}`,
  is_active: true,
  project_id: MISSION,
  created_at: '2026-10-01T10:00:00Z',
  stepCount: 1,
  created_by: 'user-1',
  multi_sender_enabled: false,
  sender_accounts: null,
  ...extra,
});
const STEP = { id: 'step-1', step_order: 1, action_type: 'message', message_template: 'Bonjour' };
const profile = (id) => ({ id, name: `Candidat ${id}`, profile_url: `https://www.linkedin.com/in/${id}` });
const candidate = (id, extra = {}) => ({
  id,
  name: `Candidat ${id}`,
  hasLinkedIn: true,
  rowId: `row-${id}`,
  candidateId: `cand-${id}`,
  headline: null,
  pictureUrl: null,
  profile: profile(id),
  ...extra,
});

/** Réglages des doublures de ContactFlow, un jeu neuf par test. */
function scenario(overrides = {}) {
  const calls = { navigate: [], enroll: [], previewValues: [], sendingAccount: [], sequences: [], steps: [], blocking: [], announce: [], toasts: [], retry: 0, refetch: 0 };
  const cf = {
    calls,
    organization: { organizationId: 'org-1', isAdmin: true },
    subscription: { effectivePlanId: 'solo', isLoading: false, isLoadingError: false },
    accounts: { selectedAccount: 'acc_own', accountsLoading: false },
    sendingAccount: { blockReason: null, belongsToOtherMember: false },
    sequencesRead: { sequences: [SEQ('seq-1')], status: 'ready', refetch: () => { calls.refetch += 1; } },
    stepsRead: { steps: [STEP], status: 'ready', refetch() {} },
    eligibility: {
      status: 'ready',
      blocking: new Map(),
      recent: new Map(),
      incompatible: new Map(),
      warnings: new Map(),
      recentMap: new Map(),
      retry: () => { calls.retry += 1; },
    },
    previewValues: { request: async () => {}, entryOf: () => undefined, sendTime: null, retry() {} },
    recipients: { blocked: false, confirmed: true, setConfirmed() {} },
    navigate: (to) => { calls.navigate.push(to); },
    enrollOutcome: (args) => ({
      status: 'done',
      results: { success: args.candidates.length, skipped: 0, alreadyPassed: 0, gdprErased: [], samePerson: [], formerPassages: 0, errors: [] },
      enrolledIds: args.candidates.map((p) => p.id),
    }),
    blockingResult: { blocking: new Set() },
    ...overrides,
  };
  globalThis.__cf = cf;
  return cf;
}

/** Props de base de ContactFlow : dans la mission, deux candidats avec ligne. */
function flowProps(extra = {}) {
  const log = [];
  return {
    props: {
      missionId: MISSION,
      job: { id: `project:${MISSION}`, title: 'Ingénieur data' },
      candidates: [candidate('p1'), candidate('p2')],
      candidatesStatus: 'ready',
      onEnrolled: (ids) => { log.push(['enrolled', ids]); },
      onLeave: () => { log.push(['leave']); },
      ...extra,
    },
    log,
  };
}

const mountFlow = (extra = {}) => {
  const { props, log } = flowProps(extra);
  const instance = mount(flowModule.ContactFlow, props);
  return { instance, log, props };
};

const pickerOf = (instance) => byTag(instance.tree, 'SequencePicker')[0];

/** Hors mission, aucune séquence n'est choisie d'avance : la personne en choisit une. */
async function choose(instance, sequenceId) {
  pickerOf(instance).props.onSelect(sequenceId);
  await settle();
}

test('5F2D-G1 rowId nul : « Inscrire » rend l\'identifiant du profil, avec une ligne la ligne, les deux mêlés chacun la sienne', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  // Sans ligne : hors mission, sans poste ; la séquence est choisie à la main.
  let cf = scenario({ sequencesRead: { sequences: [SEQ('seq-1', { project_id: null })], status: 'ready', refetch() {} } });
  let { instance, log } = mountFlow({ missionId: null, job: null, candidates: [candidate('p1', { rowId: null }), candidate('p2', { rowId: null })] });
  assert.equal(pickerOf(instance).props.selectedId, null, 'hors mission, aucune séquence présélectionnée');
  assert.equal(buttonStarting(instance.tree, 'Inscrire'), undefined, 'sans séquence, pas de pied');
  await choose(instance, 'seq-1');
  const enroll = buttonStarting(instance.tree, 'Inscrire');
  assert.ok(enroll, 'une fois la séquence choisie, « Inscrire » est là');
  assert.equal(labelOf(enroll), 'Inscrire 2 candidats');
  enroll.props.onClick();
  await settle();
  assert.deepEqual(log, [['enrolled', ['p1', 'p2']]], 'la fenêtre se ferme : onEnrolled est appelé, avec les identifiants de profil');
  assert.equal(cf.calls.enroll.length, 1);
  assert.equal(cf.calls.enroll[0].job, null, 'rien à écrire dans le Pipeline : job nul transmis tel quel');
  assert.equal(cf.calls.retry, 0, 'rien n\'est relu après un succès');

  // Avec ligne : la ligne du Pipeline, comme au lot 5f-2c.
  cf = scenario();
  ({ instance, log } = mountFlow());
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(log, [['enrolled', ['row-p1', 'row-p2']]]);

  // Mêlés : une clé par candidat, dans l'ordre des candidats.
  cf = scenario();
  ({ instance, log } = mountFlow({ candidates: [candidate('p1'), candidate('p2', { rowId: null }), candidate('p3')] }));
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(log, [['enrolled', ['row-p1', 'p2', 'row-p3']]]);

  // Un candidat refusé par l'inscription ne sort pas : seuls les inscrits sont rendus.
  cf = scenario({
    enrollOutcome: () => ({
      status: 'done',
      results: { success: 1, skipped: 1, alreadyPassed: 0, gdprErased: [], samePerson: [], formerPassages: 0, errors: [] },
      enrolledIds: ['p2'],
    }),
  });
  ({ instance, log } = mountFlow({ candidates: [candidate('p1', { rowId: null }), candidate('p2', { rowId: null })] }));
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(log, [['enrolled', ['p2']]]);

  // Rien d'inscrit : le panneau reste, les lectures sont relancées, aucune sortie.
  cf = scenario({
    enrollOutcome: () => ({
      status: 'done',
      results: { success: 0, skipped: 2, alreadyPassed: 0, gdprErased: [], samePerson: [], formerPassages: 0, errors: [] },
      enrolledIds: [],
    }),
  });
  ({ instance, log } = mountFlow({ candidates: [candidate('p1', { rowId: null })] }));
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(log, []);
  assert.equal(cf.calls.retry, 1);
  assert.equal(cf.calls.refetch, 1);
});

test('5F2D-G2 rowId nul : la fenêtre « Relire les messages » rend aussi l\'identifiant du profil ; rien d\'inscrit : lectures relancées et appelant prévenu', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  // Deux candidats sans ligne, l'un entré dans la séquence pendant la fenêtre.
  let cf = scenario({
    sequencesRead: { sequences: [SEQ('seq-1', { project_id: null })], status: 'ready', refetch() {} },
    blockingResult: { blocking: new Set(['p2']) },
  });
  const changes = [];
  let { instance, log } = mountFlow({
    missionId: null,
    job: null,
    candidates: [candidate('p1', { rowId: null }), candidate('p2', { rowId: null })],
    onChanged: () => { changes.push('changed'); },
  });
  await choose(instance, 'seq-1');
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  const modal = byTag(instance.tree, 'EnrollmentPreviewModal')[0];
  assert.ok(modal, 'la fenêtre de relecture est ouverte');
  assert.equal(modal.props.job, null, 'hors mission, la fenêtre ne reçoit pas de poste');
  assert.equal(modal.props.accountId, 'acc_own');
  modal.props.onSuccess();
  await settle();
  assert.deepEqual(log, [['enrolled', ['p2']]], 'le profil entré dans la séquence sort, par son identifiant');
  assert.deepEqual(changes, [], 'un succès n\'est pas un « changé »');
  assert.equal(cf.calls.blocking.length, 1);
  assert.equal(cf.calls.blocking[0][1], 'seq-1');

  // Avec ligne : la ligne.
  cf = scenario({ blockingResult: { blocking: new Set(['p1']) } });
  ({ instance, log } = mountFlow());
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.onSuccess();
  await settle();
  assert.deepEqual(log, [['enrolled', ['row-p1']]]);

  // « Retenir sans contacter » : personne n'est entré dans la séquence. Le panneau reste, les groupes sont
  // relus, l'appelant est prévenu une fois (pour relire ses statuts), et la fenêtre est fermée.
  cf = scenario({ blockingResult: { blocking: new Set() } });
  const changed = [];
  ({ instance, log } = mountFlow({ onChanged: () => { changed.push(cf.calls.retry); } }));
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.onSuccess();
  await settle();
  assert.deepEqual(log, [], 'aucune sortie');
  assert.equal(cf.calls.retry, 1, 'les groupes sont relus');
  assert.deepEqual(changed, [1], 'onChanged vient après la relecture, une seule fois');
  assert.equal(byTag(instance.tree, 'EnrollmentPreviewModal').length, 0, 'la fenêtre est fermée');

  // Sans onChanged (panneau du Pipeline) : rien d'autre que la relecture.
  cf = scenario({ blockingResult: { blocking: new Set() } });
  ({ instance, log } = mountFlow());
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.onSuccess();
  await settle();
  assert.equal(cf.calls.retry, 1);
  assert.deepEqual(log, []);
});

test('5F2D-G3 job nul : le titre du poste n\'est jamais lu ; avec un poste, son titre est transmis à l\'aperçu', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  let cf = scenario({ sequencesRead: { sequences: [SEQ('seq-1', { project_id: null })], status: 'ready', refetch() {} } });
  const { instance } = mountFlow({ missionId: null, job: null, candidates: [candidate('p1', { rowId: null })] });
  assert.ok(instance.tree, 'le rendu ne lève rien sans poste');
  assert.ok(cf.calls.previewValues.length > 0);
  for (const call of cf.calls.previewValues) {
    assert.equal(call.jobTitle, null);
    assert.equal(call.missionId, null);
  }

  cf = scenario();
  mountFlow();
  assert.equal(cf.calls.previewValues.at(-1).jobTitle, 'Ingénieur data');
  assert.equal(cf.calls.previewValues.at(-1).missionId, MISSION);

  // Dans la mission, le poste part à l'inscription tel quel.
  cf = scenario();
  const mounted = mountFlow();
  buttonStarting(mounted.instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(cf.calls.enroll[0].job, { id: `project:${MISSION}`, title: 'Ingénieur data' });
});

test('5F2D-G4 missionId nul : séquences lues sans mission, « Ouvrir la séquence » mène à l\'onglet des candidats sans « & » orphelin', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  let cf = scenario({ sequencesRead: { sequences: [SEQ('seq-1', { project_id: null })], status: 'ready', refetch() {} } });
  let { instance } = mountFlow({ missionId: null, job: null, candidates: [candidate('p1', { rowId: null })] });
  assert.equal(cf.calls.sequences.at(-1), null, 'useContactSequences reçoit missionId nul');
  assert.equal(pickerOf(instance).props.missionId, null, 'SequencePicker aussi');
  await choose(instance, 'seq-1');
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.equal(cf.calls.announce.length, 1);
  cf.calls.announce[0].context.onOpenSequence();
  assert.deepEqual(cf.calls.navigate, ['/sequences/seq-1?onglet=candidats']);
  assert.ok(!cf.calls.navigate[0].includes('&onglet'), 'jamais « &onglet » sans « ? » devant');

  // Dans la mission : l'adresse du lot 5f-2c, depuis la mission.
  cf = scenario();
  ({ instance } = mountFlow());
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  cf.calls.announce[0].context.onOpenSequence();
  assert.deepEqual(cf.calls.navigate, [`/sequences/seq-1?depuis=mission:${MISSION}&onglet=candidats`]);

  // Un identifiant de séquence est encodé comme partout ailleurs.
  cf = scenario({ sequencesRead: { sequences: [SEQ('a b', { project_id: null })], status: 'ready', refetch() {} } });
  ({ instance } = mountFlow({ missionId: null, job: null, candidates: [candidate('p1', { rowId: null })] }));
  await choose(instance, 'a b');
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  cf.calls.announce[0].context.onOpenSequence();
  assert.deepEqual(cf.calls.navigate, ['/sequences/a%20b?onglet=candidats']);
});

test('5F2D-G5 onOpenCandidate absent : la prop n\'est jamais inventée, elle traverse telle quelle jusqu\'aux groupes', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  scenario();
  let { instance } = mountFlow();
  const groups = byTag(instance.tree, 'RecipientGroups')[0];
  assert.ok(groups, 'les groupes sont rendus');
  assert.equal(groups.props.onOpenCandidate, undefined);

  const open = () => {};
  scenario();
  ({ instance } = mountFlow({ onOpenCandidate: open }));
  assert.equal(byTag(instance.tree, 'RecipientGroups')[0].props.onOpenCandidate, open);
});

test('5F2D-G6 onRetryCandidates absent : la porte d\'erreur n\'a pas de « Réessayer » ; fourni, le bouton l\'appelle', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  scenario();
  let { instance } = mountFlow({ candidatesStatus: 'error' });
  assert.match(textOf(instance.tree), /Les candidats sélectionnés n'ont pas pu être chargés\./);
  assert.equal(buttonLabeled(instance.tree, 'Réessayer'), undefined, 'aucun bouton qui appellerait undefined');
  assert.ok(buttonLabeled(instance.tree, 'Voir les contactés'), 'la sortie reste');

  const retry = () => {};
  scenario();
  ({ instance } = mountFlow({ candidatesStatus: 'error', onRetryCandidates: retry }));
  assert.equal(buttonLabeled(instance.tree, 'Réessayer').props.onClick, retry);
});

test('5F2D-G7 accountId imposé : c\'est le compte de l\'aperçu, du contrôle d\'envoi, de l\'inscription et de la fenêtre', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  // Le compte du point d'entrée l'emporte sur le compte propre.
  let cf = scenario();
  let { instance } = mountFlow({ accountId: 'acc_inbox' });
  assert.equal(cf.calls.sendingAccount.at(-1), 'acc_inbox');
  assert.equal(cf.calls.previewValues.at(-1).accountId, 'acc_inbox');
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.equal(cf.calls.enroll[0].accountId, 'acc_inbox');
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  assert.equal(byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.accountId, 'acc_inbox');

  // Absent ou nul : le compte propre de la personne, comme au Pipeline.
  for (const accountId of [undefined, null]) {
    cf = scenario();
    ({ instance } = mountFlow({ accountId }));
    assert.equal(cf.calls.sendingAccount.at(-1), 'acc_own', `accountId ${accountId} : compte propre`);
    assert.equal(cf.calls.previewValues.at(-1).accountId, 'acc_own');
  }

  // Compte imposé : la lecture des comptes de la personne ne retient pas le flux, et rien n'est demandé de relier.
  cf = scenario({ accounts: { selectedAccount: null, accountsLoading: true } });
  ({ instance } = mountFlow({ accountId: 'acc_inbox' }));
  assert.equal(withAria(instance.tree, 'Chargement des comptes LinkedIn'), undefined);
  assert.ok(byTag(instance.tree, 'SequencePicker')[0], 'le flux est rendu');
  assert.doesNotMatch(textOf(instance.tree), /Reliez votre compte LinkedIn/);

  // Sans compte imposé, la lecture en cours garde la porte de chargement, puis la porte « relier ».
  cf = scenario({ accounts: { selectedAccount: null, accountsLoading: true } });
  ({ instance } = mountFlow());
  assert.ok(withAria(instance.tree, 'Chargement des comptes LinkedIn'));
  cf = scenario({ accounts: { selectedAccount: null, accountsLoading: false } });
  ({ instance } = mountFlow());
  assert.match(textOf(instance.tree), /Reliez votre compte LinkedIn pour contacter\./);
  assert.equal(byTag(instance.tree, 'Link')[0].props.to, '/settings/account/connections');

  // Un compte de collègue reste refusé par le contrôle d'envoi, imposé ou non.
  cf = scenario({ sendingAccount: { blockReason: 'Ce compte LinkedIn est relié à un autre membre de l\'équipe.', belongsToOtherMember: true } });
  ({ instance } = mountFlow({ accountId: 'acc_colleague' }));
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.equal(cf.calls.enroll.length, 0, 'aucune inscription depuis le compte d\'un autre');
  assert.deepEqual(cf.calls.toasts.at(-1), ['error', 'Ce compte LinkedIn est relié à un autre membre de l\'équipe.']);
  assert.equal(cf.calls.previewValues.at(-1).accountId, 'acc_colleague');
});

test('5F2D-G8 leaveLabel nul : aucun bouton de sortie dans aucune porte ni dans le panneau ; défaut et libellé propre inchangés', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  const gates = {
    'formule gratuite': () => scenario({ subscription: { effectivePlanId: 'free', isLoading: false, isLoadingError: false } }) && { candidatesStatus: 'ready' },
    'candidats en échec': () => { scenario(); return { candidatesStatus: 'error', onRetryCandidates() {} }; },
    'aucun candidat': () => { scenario(); return { candidates: [] }; },
    'compte à relier': () => { scenario({ accounts: { selectedAccount: null, accountsLoading: false } }); return {}; },
    panneau: () => { scenario(); return {}; },
  };
  for (const [name, setup] of Object.entries(gates)) {
    const extra = setup();
    let { instance } = mountFlow(extra);
    assert.ok(buttonLabeled(instance.tree, 'Voir les contactés'), `${name} : libellé par défaut`);
    setup();
    ({ instance } = mountFlow({ ...extra, leaveLabel: 'Fermer ici' }));
    assert.ok(buttonLabeled(instance.tree, 'Fermer ici'), `${name} : libellé propre`);
    assert.equal(buttonLabeled(instance.tree, 'Voir les contactés'), undefined, `${name} : l'ancien libellé a disparu`);
    // Le bouton de sortie est celui qui appelle onLeave : par défaut il y en a un, sans libellé aucun, même vide.
    let mounted = mountFlow(extra);
    assert.equal(buttons(mounted.instance.tree).filter((button) => button.props.onClick === mounted.props.onLeave).length, 1, `${name} : un bouton de sortie`);
    setup();
    mounted = mountFlow({ ...extra, leaveLabel: null });
    assert.doesNotMatch(textOf(mounted.instance.tree), /Voir les contactés/, `${name} : aucun texte de sortie`);
    assert.deepEqual(
      buttons(mounted.instance.tree).filter((button) => button.props.onClick === mounted.props.onLeave).map(labelOf),
      [],
      `${name} : aucun bouton de sortie, même sans texte`,
    );
  }

  // Le bouton de sortie appelle onLeave.
  scenario();
  const { instance, log } = mountFlow({ candidates: [] });
  buttonLabeled(instance.tree, 'Voir les contactés').props.onClick();
  assert.deepEqual(log, [['leave']]);
});

test('5F2D-G9 emptyHint : la deuxième phrase de la porte « aucun candidat » est celle de l\'appelant, sinon le défaut du Pipeline', (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  scenario();
  let { instance } = mountFlow({ candidates: [] });
  let text = textOf(instance.tree);
  assert.match(text, /Aucun candidat sélectionné\./);
  assert.ok(text.includes('Cochez des candidats dans la liste, puis « Contacter ».'));

  scenario();
  ({ instance } = mountFlow({ candidates: [], emptyHint: 'Aucun profil à contacter pour cette recherche.' }));
  text = textOf(instance.tree);
  assert.match(text, /Aucun candidat sélectionné\./);
  assert.ok(text.includes('Aucun profil à contacter pour cette recherche.'));
  assert.ok(!text.includes('Cochez des candidats'));
});

test('5F2D-G10 onBusyChange : faux au départ, vrai pendant l\'écriture, faux ensuite, et l\'appelant n\'est prévenu qu\'une fois l\'écriture lancée', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  const cf = scenario();
  const events = [];
  const { instance } = mountFlow({
    onBusyChange: (busy) => { events.push(`busy:${busy}`); },
    onEnrolled: () => { events.push('enrolled'); },
  });
  assert.deepEqual(events, ['busy:false']);
  buttonStarting(instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(events, ['busy:false', 'busy:true', 'enrolled', 'busy:false']);
  assert.equal(cf.calls.enroll.length, 1);

  // Sans onBusyChange (panneau du Pipeline) : rien à appeler, rien ne lève.
  scenario();
  const plain = mountFlow();
  buttonStarting(plain.instance.tree, 'Inscrire').props.onClick();
  await settle();
  assert.deepEqual(plain.log, [['enrolled', ['row-p1', 'row-p2']]]);
});

test('5F2D-G11 notice : texte fixe ou calculé sur les étapes de la séquence choisie, montré sous le choix et transmis à la fenêtre', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  // Texte fixe.
  scenario();
  let { instance } = mountFlow({ notice: 'Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l\'invitation sera sautée.' });
  assert.deepEqual(notes(instance.tree), ['Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l\'invitation sera sautée.']);
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  assert.equal(byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.notice, 'Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l\'invitation sera sautée.');

  // Fonction des étapes : elle reçoit les lignes brutes de la séquence choisie.
  const seen = [];
  scenario();
  ({ instance } = mountFlow({ notice: (steps) => { seen.push(steps); return `Étapes : ${steps.length}`; } }));
  assert.deepEqual(notes(instance.tree), ['Étapes : 1']);
  assert.equal(seen.at(-1)[0], STEP, 'les lignes brutes, jamais une copie transformée');
  buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
  await settle();
  assert.equal(byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.notice, 'Étapes : 1');

  // La fonction ne s'appelle pas tant que les étapes ne sont pas lues (aucune séquence choisie hors mission).
  const calledWith = [];
  scenario({ sequencesRead: { sequences: [SEQ('seq-1', { project_id: null })], status: 'ready', refetch() {} } });
  ({ instance } = mountFlow({ missionId: null, job: null, candidates: [candidate('p1', { rowId: null })], notice: (steps) => { calledWith.push(steps); return 'Avertissement'; } }));
  assert.deepEqual(calledWith, []);
  assert.deepEqual(notes(instance.tree), []);
  await choose(instance, 'seq-1');
  assert.deepEqual(notes(instance.tree), ['Avertissement']);

  // Une fonction qui ne trouve rien à dire, ou une absence d'avertissement : aucune note, aucune prop de fenêtre.
  for (const notice of [() => null, null, undefined]) {
    scenario();
    ({ instance } = mountFlow({ notice }));
    assert.deepEqual(notes(instance.tree), []);
    buttonLabeled(instance.tree, 'Relire les messages').props.onClick();
    await settle();
    assert.ok(!byTag(instance.tree, 'EnrollmentPreviewModal')[0].props.notice, 'pas d\'avertissement transmis');
  }
});

test('5F2D-G12 séquence demandée : choisie d\'avance, et absente du menu elle n\'est jamais remplacée par une autre', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  const newest = SEQ('seq-new', { created_at: '2026-10-05T10:00:00Z' });
  const older = SEQ('seq-old', { created_at: '2026-09-01T10:00:00Z', project_id: null });

  // Sans demande : la plus récente de la mission.
  let cf = scenario({ sequencesRead: { sequences: [newest, older], status: 'ready', refetch() {} } });
  let { instance } = mountFlow();
  assert.equal(pickerOf(instance).props.selectedId, 'seq-new');

  // Demandée et présente, même si ce n'est pas le choix d'avance.
  cf = scenario({ sequencesRead: { sequences: [newest, older], status: 'ready', refetch() {} } });
  ({ instance } = mountFlow({ preferredSequenceId: 'seq-old' }));
  assert.equal(pickerOf(instance).props.selectedId, 'seq-old');
  assert.equal(cf.calls.steps.at(-1), 'seq-old');
  assert.ok(buttonStarting(instance.tree, 'Inscrire'), 'le pied est là');
  assert.deepEqual(notes(instance.tree), []);

  // Demandée et présente, hors mission : choisie d'avance aussi (c'est le cas de la page d'une séquence sans mission).
  cf = scenario({ sequencesRead: { sequences: [older], status: 'ready', refetch() {} } });
  ({ instance } = mountFlow({ missionId: null, job: null, candidates: [candidate('p1', { rowId: null })], preferredSequenceId: 'seq-old' }));
  assert.equal(pickerOf(instance).props.selectedId, 'seq-old');

  // Demandée mais absente du menu (en pause, sans étape, hors de la vue) : aucune séquence choisie et une phrase.
  cf = scenario({ sequencesRead: { sequences: [newest, older], status: 'ready', refetch() {} } });
  ({ instance } = mountFlow({ preferredSequenceId: 'seq-paused' }));
  assert.equal(pickerOf(instance).props.selectedId, null, 'jamais le choix d\'avance à la place');
  assert.equal(cf.calls.steps.at(-1), null, 'aucune étape lue : aucune séquence');
  assert.equal(buttonStarting(instance.tree, 'Inscrire'), undefined, 'pas d\'inscription possible');
  assert.equal(buttonLabeled(instance.tree, 'Relire les messages'), undefined);
  const [phrase] = notes(instance.tree);
  assert.ok(phrase, 'une phrase le dit');
  assert.match(phrase, /séquence demandée n'est pas disponible/);
  assert.doesNotMatch(phrase, /\b(tu|ton|ta|tes|toi)\b/i, 'vouvoiement');
  assert.ok(!phrase.includes(EM_DASH));
  assert.equal(cf.calls.enroll.length, 0);

  // La personne en choisit une autre : le flux reprend, la phrase s'efface.
  await choose(instance, 'seq-new');
  assert.equal(pickerOf(instance).props.selectedId, 'seq-new');
  assert.deepEqual(notes(instance.tree), []);
  assert.ok(buttonStarting(instance.tree, 'Inscrire'));

  // Lecture des séquences en cours ou en échec : pas de phrase, la demande n'est pas encore jugée.
  for (const status of ['loading', 'error']) {
    scenario({ sequencesRead: { sequences: [], status, refetch() {} } });
    ({ instance } = mountFlow({ preferredSequenceId: 'seq-paused' }));
    assert.equal(pickerOf(instance).props.selectedId, null);
    assert.deepEqual(notes(instance.tree), [], `lecture ${status} : pas de phrase`);
  }

  // Une demande vide vaut aucune demande.
  for (const preferredSequenceId of [null, undefined, '']) {
    scenario({ sequencesRead: { sequences: [newest, older], status: 'ready', refetch() {} } });
    ({ instance } = mountFlow({ preferredSequenceId }));
    assert.equal(pickerOf(instance).props.selectedId, 'seq-new', `demande ${JSON.stringify(preferredSequenceId)}`);
    assert.deepEqual(notes(instance.tree), []);
  }
});

test('5F2D-G13 overflow : absent, aucun message ; au-delà du plafond, les autres restent sélectionnés', (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  scenario();
  let { instance } = mountFlow();
  assert.doesNotMatch(textOf(instance.tree), /candidats au plus par inscription/);
  scenario();
  ({ instance } = mountFlow({ overflow: 0 }));
  assert.doesNotMatch(textOf(instance.tree), /candidats au plus par inscription/);
  scenario();
  ({ instance } = mountFlow({ overflow: 3 }));
  assert.match(textOf(instance.tree), /400 candidats au plus par inscription : les 3 autres restent sélectionnés\./);
  scenario();
  ({ instance } = mountFlow({ overflow: 1 }));
  assert.match(textOf(instance.tree), /400 candidats au plus par inscription : l'autre reste sélectionné\./);
});

test('5F2D-G14 tous les hooks sont appelés à chaque rendu, quelle que soit la porte : le nombre de hooks ne change pas', (t) => {
  if (!esbuild) return t.skip('esbuild absent');

  scenario();
  const { props } = flowProps();
  const instance = mount(flowModule.ContactFlow, props);
  const expected = instance.hookCount;
  assert.ok(expected >= 15, `hooks comptés : ${expected}`);

  const doors = {
    chargement: () => { scenario(); return { candidatesStatus: 'loading' }; },
    échec: () => { scenario(); return { candidatesStatus: 'error' }; },
    vide: () => { scenario(); return { candidates: [] }; },
    'sans compte': () => { scenario({ accounts: { selectedAccount: null, accountsLoading: false } }); return {}; },
    'compte en lecture': () => { scenario({ accounts: { selectedAccount: null, accountsLoading: true } }); return {}; },
    'formule gratuite': () => { scenario({ subscription: { effectivePlanId: 'free', isLoading: false, isLoadingError: false } }); return {}; },
    'hors mission': () => { scenario({ sequencesRead: { sequences: [], status: 'ready', refetch() {} } }); return { missionId: null, job: null, candidates: [candidate('p1', { rowId: null })] }; },
    'séquence demandée absente': () => { scenario(); return { preferredSequenceId: 'seq-paused' }; },
  };
  for (const [name, setup] of Object.entries(doors)) {
    const extra = setup();
    const next = instance.setProps({ ...props, ...extra });
    assert.ok(next, name);
    assert.equal(instance.hookCount, expected, `porte « ${name} » : même nombre de hooks`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. useContactSequences : lue aussi hors mission
// ═══════════════════════════════════════════════════════════════════════════

test('5F2D-G15 useContactSequences : activée dès qu\'il y a une organisation, mission ou non ; la clé garde la mission', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const module = await loadBundled(SEQUENCES, {
    ...BASE_STUBS,
    '@tanstack/react-query': 'export const useQuery = (options) => { globalThis.__cf.queries.push(options); return globalThis.__cf.queryResult; };',
    '@/integrations/supabase/client': 'export const supabase = {};',
    '@/hooks/useOrganization': 'export const useOrganization = () => globalThis.__cf.organization;',
  });
  const run = (organizationId, missionId, queryResult = { data: [], isError: false, fetchStatus: 'idle', refetch: async () => {} }) => {
    globalThis.__cf = { queries: [], organization: { organizationId }, queryResult };
    const instance = mount(() => module.useContactSequences(missionId), {});
    return { options: globalThis.__cf.queries[0], result: instance.tree };
  };

  const hors = run('org-1', null);
  assert.equal(hors.options.enabled, true, 'sans mission, la lecture a lieu (sinon squelette éternel)');
  assert.deepEqual(hors.options.queryKey, [module.CONTACT_SEQUENCES_KEY, 'org-1', null]);
  assert.equal(hors.result.status, 'ready');

  const dans = run('org-1', MISSION);
  assert.equal(dans.options.enabled, true);
  assert.deepEqual(dans.options.queryKey, [module.CONTACT_SEQUENCES_KEY, 'org-1', MISSION]);

  assert.equal(run(null, MISSION).options.enabled, false, 'sans organisation, rien n\'est lu');
  assert.equal(run('', null).options.enabled, false);
  assert.equal(run(undefined, null).options.enabled, false);

  // Le statut ne change pas : en lecture, en échec, hors ligne.
  assert.equal(run('org-1', null, { data: undefined, isError: false, fetchStatus: 'fetching', refetch() {} }).result.status, 'loading');
  assert.equal(run('org-1', null, { data: undefined, isError: true, fetchStatus: 'idle', refetch() {} }).result.status, 'error');
  assert.equal(run('org-1', null, { data: undefined, isError: false, fetchStatus: 'paused', refetch() {} }).result.status, 'error');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SequencePicker et RecipientGroups : rendu statique (doublures de lot5f2c-composants)
// ═══════════════════════════════════════════════════════════════════════════

const STATIC_STUBS = {
  avatar: [
    "import { createElement } from 'react';",
    "export const PersonAvatar = (props) => createElement('span', { 'data-avatar': props.candidateId ?? '' });",
  ].join('\n'),
  readiness: 'export const useMissionDraftReadiness = () => globalThis.__readiness ?? { loading: false, described: true, cadrageHref: "/missions/m-1/cadrage?section=poste" };',
  menu: [
    "import { createElement, cloneElement } from 'react';",
    "const box = (tag) => ({ children, className }) => createElement(tag, { className }, children);",
    'export const DropdownMenu = ({ children }) => createElement("div", { "data-menu": "" }, children);',
    'export const DropdownMenuTrigger = ({ children }) => children;',
    'export const DropdownMenuContent = box("div");',
    'export const DropdownMenuLabel = box("p");',
    'export const DropdownMenuSeparator = () => createElement("hr");',
    'export const DropdownMenuItem = ({ asChild, disabled, children, className, ...rest }) => asChild',
    '  ? cloneElement(children, { role: "menuitem", className })',
    '  : createElement("div", { role: "menuitem", "aria-disabled": disabled ? "true" : undefined, "aria-current": rest["aria-current"], "data-sequence-id": rest["data-sequence-id"], className }, children);',
  ].join('\n'),
};

async function buildKit() {
  const table = { 'person-avatar': STATIC_STUBS.avatar, useSequenceAI: STATIC_STUBS.readiness, 'dropdown-menu': STATIC_STUBS.menu };
  const { outputFiles } = await esbuild.build({
    stdin: {
      contents: [
        "export { RecipientGroups } from './src/components/sequences/contact/RecipientGroups';",
        "export { SequencePicker } from './src/components/sequences/contact/SequencePicker';",
        "export { classifyContactEntries } from './src/lib/contactFlowGroups';",
        "export { missionSequenceMenu } from './src/lib/missionSequencePick';",
        "export { createElement } from 'react';",
        "export { renderToStaticMarkup } from 'react-dom/server.browser';",
        "export { MemoryRouter } from 'react-router-dom';",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: path.join(ROOT, 'tsconfig.app.json'),
    plugins: [{
      name: 'stubs-5f2d-static',
      setup(b) {
        b.onResolve({ filter: /(?:person-avatar|\/useSequenceAI|ui\/dropdown-menu)$/ }, (args) => {
          const key = Object.keys(table).find((k) => args.path.endsWith(k));
          return key ? { path: key, namespace: 'stub-5f2d' } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'stub-5f2d' }, (args) => ({ contents: table[args.path], loader: 'js', resolveDir: ROOT }));
      },
    }],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const kit = esbuild ? await buildKit() : null;

const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const count = (haystack, needle) => haystack.split(needle).length - 1;

const sequence = (id, extra = {}) => ({
  id,
  name: `Séquence ${id}`,
  is_active: true,
  project_id: MISSION,
  created_at: '2026-10-01T10:00:00Z',
  stepCount: 3,
  multi_sender_enabled: false,
  sender_accounts: null,
  ...extra,
});
const renderPicker = (props) =>
  kit.renderToStaticMarkup(kit.createElement(kit.MemoryRouter, null, kit.createElement(kit.SequencePicker, {
    menu: { mission: [], others: [], pick: null },
    selectedId: null,
    status: 'ready',
    onRetry() {},
    onSelect() {},
    missionId: MISSION,
    ...props,
  })));
const withReadiness = (readiness, fn) => {
  globalThis.__readiness = readiness;
  try {
    return fn();
  } finally {
    delete globalThis.__readiness;
  }
};

test('5F2D-G16 SequencePicker sans mission, aucune séquence : une phrase sur l\'organisation, ni porte « Rédiger » ni lien vers une nouvelle séquence', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  // Même avec un poste « décrit » (la doublure le dit) : sans mission, il n'y a pas de poste dont rédiger.
  for (const readiness of [undefined, { loading: false, described: true, cadrageHref: '/missions/m-1/cadrage?section=poste' }, { loading: false, described: false, cadrageHref: '/missions/m-1/cadrage?section=poste' }]) {
    const html = withReadiness(readiness, () => renderPicker({ missionId: null, menu: kit.missionSequenceMenu([], null) }));
    assert.ok(html.includes('data-sequence-picker="empty"'));
    assert.equal(plain(html), "Aucune séquence prête à l'emploi dans votre organisation.");
    assert.ok(!html.includes('<a '), 'aucun lien');
    assert.ok(!html.includes('<button'), 'aucun bouton, pas même désactivé');
    assert.ok(!html.includes('/sequences/nouvelle'), 'aucun lien vers /sequences/nouvelle');
    assert.ok(!html.includes('target="_blank"'));
    assert.ok(!/Rédiger une séquence|cette mission|Décrire le poste|Décrivez/.test(plain(html)));
  }

  // Séquences inactives ou vides : même phrase.
  const unusable = renderPicker({ missionId: null, menu: kit.missionSequenceMenu([sequence('a', { is_active: false, project_id: null }), sequence('b', { stepCount: 0, project_id: null })], null) });
  assert.equal(plain(unusable), "Aucune séquence prête à l'emploi dans votre organisation.");

  // Dans la mission : l'état vide du lot 5f-2c, porte comprise.
  const inMission = renderPicker({ menu: kit.missionSequenceMenu([], MISSION) });
  assert.match(plain(inMission), /Cette mission n'a pas de séquence prête à l'emploi\./);
  assert.ok(inMission.includes(`href="/sequences/nouvelle?mission=${MISSION}&amp;depart=ia" target="_blank" rel="noreferrer"`));
});

test('5F2D-G17 SequencePicker sans mission, avec des séquences : « Séquences de l\'organisation », aucune porte, aucune séparation orpheline', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const list = [
    sequence('o1', { name: 'Partagée', project_id: null, created_at: '2026-09-20T10:00:00Z', stepCount: 2 }),
    sequence('x1', { name: 'D\'une mission', project_id: '5b1c2d3e-0000-4000-8000-000000000002', created_at: '2026-09-10T10:00:00Z' }),
  ];
  const menu = kit.missionSequenceMenu(list, null);
  assert.equal(menu.mission.length, 0, 'sans mission, tout est « autre »');
  assert.equal(menu.pick, null, 'et rien n\'est choisi d\'avance');
  const html = renderPicker({ missionId: null, menu, selectedId: 'o1' });
  const text = plain(html);
  assert.ok(text.includes("Séquences de l'organisation"));
  assert.ok(!text.includes('Autres séquences de l\'organisation'), 'pas d\'« autres » sans séquences de la mission');
  assert.ok(!text.includes('Séquences de la mission'));
  assert.ok(text.includes('Partagée') && text.includes("D'une mission"));
  assert.ok(text.includes('2 étapes'));
  assert.equal(count(html, 'aria-current="true"'), 1, 'la séquence choisie est marquée');
  assert.equal(count(html, '<hr'), 0, 'ni séparation ni porte');
  assert.ok(!html.includes('<a '));
  assert.ok(!html.includes('/sequences/nouvelle'));
  assert.ok(!/Rédiger une séquence|nouvel onglet|Décrire le poste/.test(text));
  assert.match(text, /^Séquence Partagée/);

  // Rien de choisi : l'invite.
  assert.match(plain(renderPicker({ missionId: null, menu, selectedId: null })), /^Séquence Choisir une séquence/);

  // Chargement et échec : ceux du lot 5f-2c.
  assert.ok(renderPicker({ missionId: null, status: 'loading' }).includes('aria-busy="true"'));
  const failed = renderPicker({ missionId: null, status: 'error' });
  assert.match(plain(failed), /Les séquences n'ont pas pu être chargées\./);
  assert.ok(failed.includes('>Réessayer</button>'));

  // Dans la mission : les deux titres et la porte, inchangés.
  const withMission = kit.missionSequenceMenu([sequence('m1', { name: 'Mission' }), ...list], MISSION);
  const missionText = plain(renderPicker({ menu: withMission, selectedId: 'm1' }));
  assert.ok(missionText.includes('Séquences de la mission'));
  assert.ok(missionText.includes("Autres séquences de l'organisation"));
  assert.ok(missionText.includes('Rédiger une séquence pour cette mission'));
});

const candidateOf = (id, extra = {}) => ({
  id,
  name: `Candidat ${id}`,
  hasLinkedIn: true,
  rowId: `row-${id}`,
  candidateId: `cand-${id}`,
  headline: `Poste de ${id}`,
  pictureUrl: null,
  profile: {},
  ...extra,
});
const eligibility = () => ({ blocking: new Map(), erased: new Set(), recent: new Map(), incompatible: new Map(), warnings: new Map() });
const classify = (entries) => kit.classifyContactEntries(entries, eligibility(), { aiReview: false, canOverrideRecent: true, overrides: new Set() });
const renderGroups = (groups, extra = {}) =>
  kit.renderToStaticMarkup(kit.createElement(kit.RecipientGroups, {
    groups,
    canOverrideRecent: true,
    overrides: new Set(),
    onToggleOverride() {},
    ...extra,
  }));

test('5F2D-G18 RecipientGroups : « Ouvrir la fiche » seulement pour un candidat avec ligne ET un geste fourni', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const opened = [];
  const onOpenCandidate = (rowId) => { opened.push(rowId); };

  // Sans ligne : pas de bouton, mais la raison reste écrite.
  const noRow = renderGroups(classify([candidateOf('a', { hasLinkedIn: false, rowId: null }), candidateOf('b', { hasLinkedIn: false, rowId: null })]), { onOpenCandidate });
  assert.match(plain(noRow), /À compléter \(2\)/);
  assert.match(plain(noRow), /Sans profil LinkedIn/);
  assert.equal(count(noRow, 'Ouvrir la fiche'), 0);

  // Sans geste (la feuille n'ouvre pas de fiche) : pas de bouton non plus, et le rendu ne lève rien.
  const noHandler = renderGroups(classify([candidateOf('a', { hasLinkedIn: false })]), { onOpenCandidate: undefined });
  assert.match(plain(noHandler), /Sans profil LinkedIn/);
  assert.equal(count(noHandler, 'Ouvrir la fiche'), 0);
  const omitted = renderGroups(classify([candidateOf('a', { hasLinkedIn: false })]));
  assert.equal(count(omitted, 'Ouvrir la fiche'), 0);

  // Avec ligne et un geste : le bouton du lot 5f-2c, nommé par le candidat. Mêlés : un seul bouton, pour la ligne.
  const mixed = renderGroups(
    classify([candidateOf('a', { hasLinkedIn: false }), candidateOf('b', { hasLinkedIn: false, rowId: null }), candidateOf('c', { hasLinkedIn: false })]),
    { onOpenCandidate },
  );
  assert.equal(count(mixed, '>Ouvrir la fiche</button>'), 2);
  assert.ok(mixed.includes('aria-label="Ouvrir la fiche de Candidat a"'));
  assert.ok(mixed.includes('aria-label="Ouvrir la fiche de Candidat c"'));
  assert.ok(!mixed.includes('aria-label="Ouvrir la fiche de Candidat b"'));

  // Le reste des groupes ne dépend ni de la ligne ni du geste.
  const ready = renderGroups(classify([candidateOf('a', { rowId: null }), candidateOf('b', { rowId: null })]));
  assert.match(plain(ready), /Prêts \(2\)/);
  assert.equal(count(ready, '<li data-contact-row='), 2);
  assert.ok(ready.includes('data-avatar="cand-a"'));
  // Un candidat sans identifiant de photo (profil sans ligne ni candidat) : l'avatar se rend quand même.
  const noPhotoId = renderGroups(classify([candidateOf('z', { rowId: null, candidateId: null })]));
  assert.equal(count(noPhotoId, '<li data-contact-row="z"'), 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. flowCandidates : des profils vivants vers les candidats du flux
// ═══════════════════════════════════════════════════════════════════════════

const candidatesModule = esbuild ? await loadBundled(CANDIDATES) : null;
const lp = (id, extra = {}) => ({ id, name: `Profil ${id}`, ...extra });

test('5F2D-G19 profileToFlowCandidate : identifiants, ligne, lien LinkedIn, nom de repli', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { profileToFlowCandidate } = candidatesModule;

  const full = lp('ACo1', {
    headline: 'Ingénieur data',
    profile_picture_url: 'https://media.licdn.com/p.jpg',
    profile_url: 'https://www.linkedin.com/in/alice',
    network_distance: 2,
    provider_id: 'ACo1',
  });
  const result = profileToFlowCandidate(full);
  assert.equal(result.id, 'ACo1');
  assert.equal(result.candidateId, 'ACo1', 'la copie privée de la photo se cherche par le profil');
  assert.equal(result.rowId, null, 'pas de ligne par défaut');
  assert.equal(result.name, 'Profil ACo1');
  assert.equal(result.headline, 'Ingénieur data');
  assert.equal(result.pictureUrl, 'https://media.licdn.com/p.jpg');
  assert.equal(result.hasLinkedIn, true);
  assert.equal(result.profile, full, 'le profil vivant, sans copie : distance de réseau et fournisseur compris');
  assert.equal(result.profile.network_distance, 2);

  // Ligne fournie, y compris pour un profil réhydraté.
  assert.equal(profileToFlowCandidate(full, { rowId: 'row-9' }).rowId, 'row-9');
  assert.equal(profileToFlowCandidate(full, { rowId: null }).rowId, null);
  assert.equal(profileToFlowCandidate(full, {}).rowId, null);

  // Lien LinkedIn : l'une ou l'autre adresse, comme l'inscription la lit.
  assert.equal(profileToFlowCandidate(lp('a', { public_profile_url: 'https://www.linkedin.com/in/a' })).hasLinkedIn, true);
  assert.equal(profileToFlowCandidate(lp('a', { profile_url: 'https://www.linkedin.com/in/a' })).hasLinkedIn, true);
  assert.equal(profileToFlowCandidate(lp('a')).hasLinkedIn, false);
  assert.equal(profileToFlowCandidate(lp('a', { profile_url: '', public_profile_url: '' })).hasLinkedIn, false);
  assert.equal(profileToFlowCandidate(lp('a'), { hasLinkedIn: true }).hasLinkedIn, true, 'l\'appelant peut l\'affirmer');
  assert.equal(profileToFlowCandidate(lp('a', { profile_url: 'https://www.linkedin.com/in/a' }), { hasLinkedIn: false }).hasLinkedIn, false);

  // Nom : le nom, sinon prénom et nom, sinon « Profil sans nom ».
  assert.equal(profileToFlowCandidate(lp('a', { name: '  Alice Martin ' })).name, 'Alice Martin');
  assert.equal(profileToFlowCandidate({ id: 'a', first_name: 'Alice', last_name: 'Martin' }).name, 'Alice Martin');
  assert.equal(profileToFlowCandidate({ id: 'a', name: '', first_name: 'Alice' }).name, 'Alice');
  assert.equal(profileToFlowCandidate({ id: 'a', last_name: 'Martin' }).name, 'Martin');
  assert.equal(profileToFlowCandidate({ id: 'a' }).name, 'Profil sans nom');
  assert.equal(profileToFlowCandidate({ id: 'a', name: '   ', first_name: ' ', last_name: '' }).name, 'Profil sans nom');

  // Sans titre ni photo : nuls, jamais « undefined ».
  const bare = profileToFlowCandidate({ id: 'a' });
  assert.equal(bare.headline, null);
  assert.equal(bare.pictureUrl, null);
});

test('5F2D-G20 profilesToFlowCandidates : une fois chaque profil, ordre gardé, plafond de 400, reste annoncé', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { profilesToFlowCandidates, FLOW_MAX } = candidatesModule;
  assert.equal(FLOW_MAX, 400);
  // Même plafond que le flux et que le panneau du Pipeline.
  assert.match(flowCode, /const CONTACT_FLOW_MAX = 400;/);
  assert.match(code(read('src/components/missions/v3/pipeline/useContactCandidates.ts')), /CONTACT_FLOW_MAX = 400/);

  // Dédoublonnage par identifiant : le premier gagne, l'ordre est celui de la liste.
  const first = lp('a', { name: 'Premier' });
  const result = profilesToFlowCandidates([first, lp('b'), lp('a', { name: 'Doublon' }), lp('c'), lp('b')]);
  assert.deepEqual(result.candidates.map((c) => c.id), ['a', 'b', 'c']);
  assert.equal(result.candidates[0].name, 'Premier');
  assert.equal(result.candidates[0].profile, first);
  assert.equal(result.overflow, 0);
  assert.ok(result.candidates.every((c) => c.rowId === null && c.candidateId === c.id));

  // Vide.
  assert.deepEqual(profilesToFlowCandidates([]), { candidates: [], overflow: 0 });

  // Un profil sans identifiant ne peut ni s'inscrire ni se retrouver : il est écarté, sans compter dans le reste.
  const noId = profilesToFlowCandidates([lp('a'), { name: 'Sans identifiant' }, lp('b')]);
  assert.deepEqual(noId.candidates.map((c) => c.id), ['a', 'b']);
  assert.equal(noId.overflow, 0);

  // Plafond : exactement 400, 401, 405.
  const many = (n) => Array.from({ length: n }, (_, i) => lp(`p${i}`));
  let capped = profilesToFlowCandidates(many(400));
  assert.equal(capped.candidates.length, 400);
  assert.equal(capped.overflow, 0);
  capped = profilesToFlowCandidates(many(401));
  assert.equal(capped.candidates.length, 400);
  assert.equal(capped.overflow, 1);
  assert.equal(capped.candidates.at(-1).id, 'p399', 'les 400 premiers, dans l\'ordre');
  capped = profilesToFlowCandidates(many(405));
  assert.equal(capped.overflow, 5);

  // Les doublons ne comptent pas dans le reste : 410 profils dont 10 doublons font 400 candidats, aucun reste.
  const withDuplicates = [...many(400), ...many(10)];
  capped = profilesToFlowCandidates(withDuplicates);
  assert.equal(capped.candidates.length, 400);
  assert.equal(capped.overflow, 0);

  // L'entrée n'est pas modifiée.
  const input = many(3);
  const copy = [...input];
  profilesToFlowCandidates(input);
  assert.deepEqual(input, copy);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ContactFlowSheet : la feuille latérale
// ═══════════════════════════════════════════════════════════════════════════

const SHEET_STUBS = {
  ...BASE_STUBS,
  'lucide-react': markers('X'),
  '@/components/ui/button': markers('Button'),
  '@/components/ui/sheet': markers('Sheet', 'SheetClose', 'SheetContent', 'SheetDescription', 'SheetTitle'),
  '@/components/SectionErrorBoundary': markers('SectionErrorBoundary'),
  './ContactFlow': markers('ContactFlow'),
};
const sheetModule = esbuild ? await loadBundled(SHEET, SHEET_STUBS) : null;

function mountSheet(extra = {}) {
  const log = [];
  const props = {
    open: true,
    onOpenChange: (open) => { log.push(['open', open]); },
    missionId: null,
    job: null,
    candidates: [candidate('p1', { rowId: null })],
    onEnrolled: (ids) => { log.push(['enrolled', ids]); },
    ...extra,
  };
  const instance = mount(sheetModule.ContactFlowSheet, props);
  return { instance, log, props };
}
const sheetOf = (instance) => byTag(instance.tree, 'Sheet')[0];
const contentOf = (instance) => byTag(instance.tree, 'SheetContent')[0];
const flowOf = (instance) => byTag(instance.tree, 'ContactFlow')[0];
const closeButtonOf = (instance) => byTag(byTag(instance.tree, 'SheetClose')[0], 'Button')[0];

test('5F2D-G21 ContactFlowSheet : feuille à droite sans croix du kit, flux sans sortie propre, candidats et réglages transmis tels quels', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const candidates = [candidate('p1', { rowId: null }), candidate('p2', { rowId: null })];
  const notice = () => 'Avertissement';
  const onOpenCandidate = () => {};
  const { instance } = mountSheet({
    candidates,
    overflow: 7,
    missionId: MISSION,
    job: { id: `project:${MISSION}`, title: 'Ingénieur data' },
    accountId: 'acc_inbox',
    notice,
    preferredSequenceId: 'seq-1',
    emptyHint: 'Rien à contacter.',
    onOpenCandidate,
  });

  const sheet = sheetOf(instance);
  assert.equal(sheet.props.open, true);
  const content = contentOf(instance);
  assert.equal(content.props.side, 'right');
  assert.equal(content.props.hideClose, true, 'la croix du kit n\'est pas rendue : la feuille a la sienne');
  assert.match(content.props.className, /\bw-full\b/);
  assert.match(content.props.className, /\bsm:max-w-md\b/);
  assert.match(content.props.className, /\bp-0\b/);
  assert.equal(typeof content.props.onOpenAutoFocus, 'function');

  const flowElement = flowOf(instance);
  assert.ok(flowElement, 'le flux est monté');
  const p = flowElement.props;
  assert.equal(p.candidates, candidates, 'la liste figée par l\'appelant, sans copie');
  assert.equal(p.candidatesStatus, 'ready');
  assert.equal(p.leaveLabel, null, 'la croix de la feuille suffit : un seul bouton de sortie');
  assert.equal(p.overflow, 7);
  assert.equal(p.missionId, MISSION);
  assert.deepEqual(p.job, { id: `project:${MISSION}`, title: 'Ingénieur data' });
  assert.equal(p.accountId, 'acc_inbox');
  assert.equal(p.notice, notice);
  assert.equal(p.preferredSequenceId, 'seq-1');
  assert.equal(p.emptyHint, 'Rien à contacter.');
  assert.equal(p.onOpenCandidate, onOpenCandidate);
  assert.equal(p.onRetryCandidates, undefined, 'les candidats sont en mémoire : jamais d\'échec de lecture');
  assert.equal(p.refreshing, undefined);

  // Défauts : hors mission, rien d'inventé.
  const bare = mountSheet();
  const bareProps = flowOf(bare.instance).props;
  assert.equal(bareProps.missionId, null);
  assert.equal(bareProps.job, null);
  assert.equal(bareProps.accountId, undefined);
  assert.equal(bareProps.onOpenCandidate, undefined);

  // Le flux est dans une zone qui défile et sous une barrière d'erreur.
  assert.ok(byTag(instance.tree, 'SectionErrorBoundary')[0], 'une erreur du flux ne vide pas la page');
  const scrolling = elementsOf(instance.tree).find((element) => typeof element.type === 'string' && /overflow-y-auto/.test(element.props?.className ?? ''));
  assert.ok(scrolling, 'le pied collé de ContactFlow a un ancêtre qui défile');
  assert.ok(byTag(scrolling, 'ContactFlow')[0]);
});

test('5F2D-G22 ContactFlowSheet : titre qui reçoit le focus à l\'ouverture, sous-titre ou phrase pour les lecteurs d\'écran, croix de 44 px sur téléphone', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { instance } = mountSheet({ subtitle: 'Ingénieur data · Acme' });

  const title = byTag(instance.tree, 'SheetTitle')[0];
  assert.equal(textOf(title.props.children).trim(), 'Prise de contact', 'titre par défaut');
  assert.equal(title.props.tabIndex, -1, 'focalisable sans entrer dans l\'ordre de tabulation');
  const focused = [];
  title.props.ref.current = { focus: (options) => { focused.push(options); } };
  const prevented = [];
  contentOf(instance).props.onOpenAutoFocus({ preventDefault: () => { prevented.push(true); } });
  assert.deepEqual(prevented, [true], 'le focus du premier bouton est écarté');
  assert.deepEqual(focused, [{ preventScroll: true }], 'le focus va au titre');

  // Sans titre monté (cas limite) : rien ne lève.
  title.props.ref.current = null;
  assert.doesNotThrow(() => contentOf(instance).props.onOpenAutoFocus({ preventDefault() {} }));

  const description = byTag(instance.tree, 'SheetDescription');
  assert.equal(description.length, 1);
  assert.equal(textOf(description[0].props.children), 'Ingénieur data · Acme');
  assert.equal(description[0].props.title, 'Ingénieur data · Acme');
  assert.ok(!/sr-only/.test(description[0].props.className ?? ''));

  // Titre propre ; sous-titre absent : une phrase pour les lecteurs d'écran, pour que la feuille garde sa description.
  const custom = mountSheet({ title: 'Contacter depuis la recherche' });
  assert.equal(textOf(byTag(custom.instance.tree, 'SheetTitle')[0].props.children).trim(), 'Contacter depuis la recherche');
  const silent = byTag(custom.instance.tree, 'SheetDescription')[0];
  assert.match(silent.props.className, /sr-only/);
  assert.match(textOf(silent.props.children), /^Choisissez une séquence/);

  // Croix : 44 px sur téléphone, même nom que le panneau de la mission.
  const close = closeButtonOf(instance);
  assert.equal(close.props['aria-label'], 'Fermer le panneau');
  assert.match(close.props.className, /\bmin-h-11\b/);
  assert.match(close.props.className, /\bmin-w-11\b/);
  assert.match(close.props.className, /\blg:min-h-0\b/);
  assert.equal(close.props.disabled, false);
  assert.equal(byTag(instance.tree, 'SheetClose')[0].props.asChild, true);
});

test('5F2D-G23 ContactFlowSheet : fermeture refusée pendant l\'écriture (Échap, croix, sortie du flux), permise avant et après', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { instance, log } = mountSheet();

  // Au repos : fermer et rouvrir passent à l'appelant.
  sheetOf(instance).props.onOpenChange(false);
  sheetOf(instance).props.onOpenChange(true);
  assert.deepEqual(log.splice(0), [['open', false], ['open', true]]);
  assert.equal(closeButtonOf(instance).props.disabled, false);

  // L'écriture démarre : le flux le dit.
  flowOf(instance).props.onBusyChange(true);
  await settle();
  assert.equal(closeButtonOf(instance).props.disabled, true, 'la croix est désactivée');
  sheetOf(instance).props.onOpenChange(false);
  flowOf(instance).props.onLeave();
  assert.deepEqual(log, [], 'Échap, clic à côté et sortie du flux ne ferment rien');
  sheetOf(instance).props.onOpenChange(true);
  assert.deepEqual(log.splice(0), [['open', true]], 'une ouverture reste permise');

  // L'écriture finit : la fermeture est de nouveau permise.
  flowOf(instance).props.onBusyChange(false);
  await settle();
  assert.equal(closeButtonOf(instance).props.disabled, false);
  sheetOf(instance).props.onOpenChange(false);
  assert.deepEqual(log.splice(0), [['open', false]]);

  // La sortie du flux (même sans bouton) ferme la feuille hors écriture.
  flowOf(instance).props.onLeave();
  assert.deepEqual(log.splice(0), [['open', false]]);
});

test('5F2D-G24 ContactFlowSheet : après une inscription l\'appelant est informé puis la feuille se ferme, même si l\'écriture n\'est pas encore marquée finie', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { instance, log } = mountSheet();

  // Cas réel : handleEnroll appelle onEnrolled avant que son « finally » ne marque la fin de l'écriture.
  flowOf(instance).props.onBusyChange(true);
  await settle();
  flowOf(instance).props.onEnrolled(['p1']);
  assert.deepEqual(log, [['enrolled', ['p1']], ['open', false]], 'informé d\'abord, fermé ensuite, sans passer par le garde');

  // Fermée, la feuille ne retient plus rien : rouverte, elle se ferme à la demande.
  instance.setProps({ open: false });
  await settle();
  log.length = 0;
  instance.setProps({ open: true });
  await settle();
  sheetOf(instance).props.onOpenChange(false);
  assert.deepEqual(log, [['open', false]], 'l\'occupation de la fois précédente a été oubliée');
  assert.equal(closeButtonOf(instance).props.disabled, false);

  // « Retenir sans contacter » : l'appelant relit ses statuts, la feuille reste ouverte.
  const changed = [];
  const kept = mountSheet({ onChanged: () => { changed.push('changed'); } });
  flowOf(kept.instance).props.onChanged();
  assert.deepEqual(changed, ['changed']);
  assert.deepEqual(kept.log, [], 'aucune fermeture');

  // Sans onChanged : le flux reçoit undefined et n'appelle rien.
  assert.equal(flowOf(mountSheet().instance).props.onChanged, undefined);
});

test('5F2D-G25 ContactFlowSheet : « above » entre l\'en-tête et le flux, seulement s\'il est fourni', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const marker = { type: 'div', props: { 'data-above': '', children: 'Choix de la mission' }, key: null };
  const { instance } = mountSheet({ above: marker });
  const order = elementsOf(instance.tree).map((element) => (element === marker ? 'above' : element.type?.__tag ?? ''));
  const title = order.indexOf('SheetTitle');
  const above = order.indexOf('above');
  const flowIndex = order.indexOf('ContactFlow');
  assert.ok(title >= 0 && above > title && flowIndex > above, `ordre : ${order.filter(Boolean).join(' > ')}`);

  const without = mountSheet();
  assert.ok(!elementsOf(without.instance.tree).some((element) => element.props?.['data-above'] !== undefined));
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Gardes de source
// ═══════════════════════════════════════════════════════════════════════════

test('5F2D-G26 sites nuls de ContactFlow : plus de lecture directe du poste, de la ligne ni du compte', () => {
  assert.doesNotMatch(flowCode, /\bjob\.(?!\?)/, 'job est lu par job?.');
  assert.match(flowCode, /jobTitle: job\?\.title \?\? null,/);
  assert.equal((flowCode.match(/candidate\.rowId \?\? candidate\.id/g) ?? []).length, 2, 'la clé de sortie aux deux endroits');
  assert.doesNotMatch(flowCode, /\.map\(\(candidate\) => candidate\.rowId\)/, 'jamais la ligne seule');
  assert.match(flowCode, /const accountId = imposedAccountId \?\? selectedAccount;/);
  assert.match(flowCode, /useState<string \| null>\(preferredSequenceId\)/);
  assert.match(flowCode, /\{onRetryCandidates && \(/);
  assert.match(flowCode, /if \(!label\) return null;/);
  assert.match(code(read(SEQUENCES)), /enabled: !!organizationId,/);
  assert.doesNotMatch(code(read(SEQUENCES)), /!!missionId/);
  // Les props de 5f-2d ont, absentes, la valeur du lot 5f-2c.
  assert.match(flowCode, /overflow = 0,/);
  assert.match(flowCode, /leaveLabel = 'Voir les contactés',/);
  assert.match(flowCode, /emptyHint = 'Cochez des candidats dans la liste, puis « Contacter ».',/);
  assert.match(flowCode, /notice = null,/);
  assert.match(flowCode, /preferredSequenceId = null,/);
  // ContactPanel garde sa balise du lot 5f-2c : le panneau du Pipeline ne passe aucune prop nouvelle ici.
  const panel = code(read('src/components/missions/v3/panels/ContactPanel.tsx'));
  const tag = panel.slice(panel.indexOf('<ContactFlow'), panel.indexOf('/>', panel.indexOf('<ContactFlow')));
  for (const added of ['accountId', 'notice', 'leaveLabel', 'emptyHint', 'onBusyChange', 'onChanged']) {
    assert.ok(!tag.includes(added), `ContactPanel ne passe pas ${added}`);
  }
});

test('5F2D-G27 ContactFlowSheet, flowCandidates et le reste du dossier : aucune écriture, aucune étape de candidat, aucun stockage local', () => {
  for (const rel of MY_FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /sequence_enrollments|sequence_step_executions|job_candidate_status|mission_candidate_rows/, `${rel} ne touche pas ces tables`);
    assert.doesNotMatch(src, /\.from\([^)]*\)[\s\S]{0,300}?\.(insert|upsert|delete|update)\(/, `${rel} n'écrit dans aucune table`);
    assert.doesNotMatch(src, /\.rpc\(/, `${rel} n'appelle aucune fonction de la base`);
    assert.doesNotMatch(src, /retainCandidates\(|setCandidateStages?\(|set_candidate_stage|pipeline_stage/, `${rel} ne pose aucune étape`);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, `${rel} : aucun stockage local`);
  }
  for (const rel of NEW_FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /supabase|enrollCandidates|useQuery|invokeEdgeFunction|fetch\(/, `${rel} : ni lecture ni écriture`);
    assert.doesNotMatch(src, /['"`]\/sequences|sequencePath|navigate\(/, `${rel} : aucun lien vers /sequences, c'est ContactFlow qui navigue`);
  }
  // Les seuls écrivains restent ceux du lot 5f-2c : enrollCandidates depuis ContactFlow, retainCandidates ailleurs.
  assert.equal((flowCode.match(/await enrollCandidates\(/g) ?? []).length, 1);
});

test('5F2D-G28 ContactFlowSheet : composants du kit, un seul export, hooks avant tout retour, textes du lot', () => {
  const src = code(read(SHEET));
  assert.match(src, /import \{ Button \} from '@\/components\/ui\/button';/);
  assert.match(src, /import \{ Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle \} from '@\/components\/ui\/sheet';/);
  assert.match(src, /import \{ SectionErrorBoundary \} from '@\/components\/SectionErrorBoundary';/);
  assert.doesNotMatch(src, /<button\b|<input\b|<select\b|<textarea\b/, 'pas de balise brute');
  assert.match(src, /<SheetContent\b[\s\S]*?hideClose/);
  assert.match(src, /side="right"/);
  assert.match(src, /aria-label="Fermer le panneau"/);
  assert.match(src, /candidatesStatus="ready"/);
  assert.match(src, /leaveLabel=\{null\}/);
  assert.match(src, /onBusyChange=\{setBusy\}/);
  assert.match(src, /if \(!next && busy\) return;/);
  assert.match(src, /disabled=\{busy\}/);
  assert.match(src, /tabIndex=\{-1\}/);
  assert.match(src, /preventScroll: true/);
  // Un seul composant exporté (react-refresh) ; le type des props peut l'être aussi.
  assert.deepEqual([...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map((m) => m[1]), ['ContactFlowSheet']);
  // Aucun retour anticipé avant les hooks du composant.
  const body = src.slice(src.indexOf('export function ContactFlowSheet('));
  const lastHook = Math.max(...[...body.matchAll(/\buse(?:State|Ref|Effect)\(/g)].map((m) => m.index));
  assert.doesNotMatch(body.slice(0, lastHook), /^  (if \(.*\) )?return\b/m);
  for (const text of ['Prise de contact', 'Fermer le panneau', "Le panneau Contacter n'a pas pu s'afficher", 'Choisissez une séquence, puis inscrivez les candidats.']) {
    assert.ok(read(SHEET).includes(text), `texte « ${text} »`);
  }
});

test('5F2D-G29 hygiène des fichiers du lot : aucun tiret long, aucun « (s) », aucun nom de prestataire, vouvoiement, pas de jargon anglais visible', () => {
  for (const rel of [...MY_FILES, 'tests/ux/lot5f2d-generalisation.test.mjs']) {
    const raw = read(rel);
    assert.ok(!raw.includes(EM_DASH), `${rel} : aucun tiret long, commentaires compris`);
    assert.doesNotMatch(raw, /[A-Za-zÀ-ÿ]\(s\)/, `${rel} : aucun « (s) » collé à un mot`);
  }
  for (const rel of MY_FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /\b(Unipile|Apollo|People Data Labs|PDL|Anthropic|Claude|Notion|Resend|Brandfetch)\b/, `${rel} : aucun nom de prestataire`);
    assert.doesNotMatch(src, /:\s*any\b|<any>|\bas any\b|@ts-ignore|@ts-expect-error/, `${rel} : aucun any ni commentaire TS`);
    assert.doesNotMatch(src, /window\.confirm|trackEvent/, `${rel} : ni confirm ni suivi`);
  }
  if (!ts) return;
  for (const rel of [FLOW, SHEET, CANDIDATES, PICKER, GROUPS]) {
    const visible = visibleTexts(rel).join('\n');
    assert.doesNotMatch(visible, /\b(step|steps|preview|enrollment|enrollments|template|sender|batch|workflow)\b/i, `${rel} : pas de jargon anglais`);
    assert.doesNotMatch(visible, /\b(Unipile|Apollo|PDL|Anthropic|Claude|Notion)\b/, `${rel} : pas de nom de prestataire`);
    assert.doesNotMatch(visible, /\b(tu|ton|ta|tes|toi)\b/i, `${rel} : vouvoiement`);
    assert.doesNotMatch(visible, /\bListe\b|\bExpert\b|\bGuidé\b|\bVisuel\b/, `${rel} : mots d'éditeur réservés`);
  }
});
