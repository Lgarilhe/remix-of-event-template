/**
 * Lot 5d-2 : parité de la charge envoyée à save_sequence_steps.
 *
 * Jeux de référence : tests/fixtures/sequence-editor-payloads.json (une
 * séquence par type d'étape, la Séquence recommandée de l'ancien éditeur, une
 * vérification de la connexion à deux branches, des versions B et C, des
 * replis au délai dépassé, une ligne héritée aux colonnes vides).
 *
 * Invariants épinglés :
 *   - la sérialisation réelle de l'enregistrement (buildStepsPayload de
 *     src/hooks/useSequenceSave.ts, extraite du fichier et exécutée) écrit
 *     chaque colonne lue par l'éditeur (SequenceStepRow), et rien d'autre ;
 *   - lecture par rowToSequenceStep puis sérialisation : une ligne canonique
 *     revient à l'identique (cc, signature, délais dépassés, poids A/B, fin de
 *     séquence, renvois compris) ; une ligne héritée revient avec les seules
 *     normalisations documentées ; la charge est un point fixe de l'aller-retour ;
 *   - ouverture de l'ancien éditeur (corps réel de handleEdit dans
 *     src/lib/sequenceActions.ts, puis withoutInvitationAi de SequenceBuilder) :
 *     même charge ;
 *   - Séquence recommandée (generateRecommendedSequence) : charge identique à
 *     celle relevée sur l'ancien éditeur.
 *
 * Éditeur unique (lot 5d-2) : le vrai hook useSequenceEditor tourne sous un
 * React minimal (esbuild, sonner et le client de la base simulés) ; son état
 * est sérialisé par buildStepsPayload, comme la page l'enregistre :
 *   - ouverture de chaque jeu (handleEdit puis reset) et création depuis chaque
 *     modèle Konekt : charge de SequenceBuilder, rien à enregistrer ;
 *   - gestes communs (texte, délai et créneau, version B, ajout au bout du fil,
 *     suppression, abandon) : même charge que les gestes de SequenceBuilder,
 *     épinglés sur son code. Écarts voulus, listés et prouvés : l'ajout au bout
 *     du fil rend jouable une étape que l'ancienne liste laissait hors du
 *     parcours ; un réglage commun s'écrit sur chaque version ;
 *   - suppression d'une étape enregistrée : historique lu, refus sans rien
 *     changer ; brouillon repris par JSON : même charge.
 *
 * Sans navigateur ni base. Lancer : node --test tests/ux/seq-v2-charge-utile.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build, buildSync, transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Module TypeScript empaqueté avec ses imports relatifs, chargé par une URL data:. */
async function loadBundle(rel) {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const graph = await loadBundle('src/components/outreach/sequence/sequenceGraph.ts');
const editorModel = await loadBundle('src/lib/sequenceEditor.ts');
const starters = await loadBundle('src/lib/sequenceStarterTemplates.ts');
const fixtures = JSON.parse(read('tests/fixtures/sequence-editor-payloads.json'));

// ── Hook d'édition réel (useSequenceEditor), sans navigateur ──────────────
//
// React est remplacé par un rendu minimal (useState, useRef, useMemo,
// useCallback, un rendu après chaque geste) ; sonner et le client de la base
// sont simulés (comptage de l'historique d'une étape avant sa suppression).

const STUBS = {
  react: `
    let current = null;
    function slot(init) {
      if (!current) throw new Error('hook appelé hors rendu');
      const k = current.i++;
      if (!(k in current.slots)) current.slots[k] = init();
      return current.slots[k];
    }
    export function useState(initial) {
      const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      if (!cell.set) cell.set = (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; };
      return [cell.value, cell.set];
    }
    export function useRef(initial) { return slot(() => ({ current: initial })); }
    export function useMemo(factory, deps) {
      const cell = slot(() => ({ deps: null, value: undefined }));
      const same = cell.deps && deps && deps.length === cell.deps.length && deps.every((d, n) => Object.is(d, cell.deps[n]));
      if (!same) { cell.value = factory(); cell.deps = deps; }
      return cell.value;
    }
    export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
    /** Monte un hook ; chaque geste est suivi d'un rendu, comme après un setState. */
    export function mount(hook) {
      const inst = { slots: [], i: 0, value: undefined };
      const render = () => { current = inst; inst.i = 0; try { inst.value = hook(); } finally { current = null; } };
      render();
      return {
        get result() { return inst.value; },
        act(fn) { const out = fn(inst.value); render(); return out; },
        async actAsync(fn) { const out = await fn(inst.value); render(); return out; },
      };
    }
  `,
  sonner: `
    const push = (kind) => (...args) => { (globalThis.__editorToasts ??= []).push([kind, ...args]); };
    export const toast = { error: push('error'), success: push('success'), info: push('info'), warning: push('warning') };
  `,
  supabase: `
    export const supabase = {
      from(table) {
        const call = { table, select: null, filters: [] };
        (globalThis.__editorQueries ??= []).push(call);
        const query = {
          select(...args) { call.select = args; return query; },
          in(column, values) { call.filters.push([column, values]); return query; },
          then(resolve, reject) { return Promise.resolve({ count: globalThis.__historyCount ?? 0, error: null }).then(resolve, reject); },
        };
        return query;
      },
    };
  `,
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: 'sonner', namespace: 'stub' }));
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};
const hookModule = await (async () => {
  // Greffons : API asynchrone d'esbuild seulement.
  const { outputFiles } = await build({
    stdin: {
      contents: "export { useSequenceEditor } from './src/hooks/useSequenceEditor.ts'; export { mount } from 'react';",
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
    plugins: [stubPlugin],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
})();

/** useSequenceEditor monté, ouvert comme la page (reset des étapes relues) ou la création (reset, aucune étape en base). */
function mountEditor(steps, persistedStepIds) {
  const editor = hookModule.mount(() => hookModule.useSequenceEditor());
  editor.act((e) => e.reset(editorModel.openEditorSteps(steps), persistedStepIds));
  return editor;
}

/** Identifiants des nouvelles étapes et versions, fixés pour comparer les deux éditeurs. */
function withIds(ids, fn) {
  const original = crypto.randomUUID;
  const queue = [...ids];
  crypto.randomUUID = () => {
    assert.ok(queue.length > 0, 'identifiant inattendu demandé');
    return queue.shift();
  };
  try {
    return fn();
  } finally {
    crypto.randomUUID = original;
  }
}

// ── Code réel extrait des fichiers ─────────────────────────────────────────

/** Retire les commentaires de ligne entière (ils citent des apostrophes et des parenthèses). */
const stripLineComments = (src) => src.replace(/^\s*\/\/.*$/gm, '');

/** Texte de `start` jusqu'au `;` de même profondeur (parenthèses, crochets, accolades, chaînes). */
function statementFrom(src, start) {
  assert.ok(start >= 0, 'déclaration introuvable');
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('fin de déclaration introuvable');
}

/** Expression `start(...)` complète, parenthèses équilibrées. */
function callFrom(src, start) {
  assert.ok(start >= 0, 'appel introuvable');
  const open = src.indexOf('(', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('fin d’appel introuvable');
}

const js = (code) => transformSync(code, { loader: 'ts', format: 'cjs' }).code;

const saveHook = stripLineComments(read('src/hooks/useSequenceSave.ts'));
const actions = stripLineComments(read('src/lib/sequenceActions.ts'));
const builder = read('src/components/outreach/SequenceBuilder.tsx');

const implicitWaitEvent = new Function(
  `${js(statementFrom(actions, actions.indexOf('export const implicitWaitEvent = ')).replace(/^export /, ''))}; return implicitWaitEvent;`,
)();

const payloadSource = statementFrom(saveHook, saveHook.indexOf('const buildStepsPayload = () =>'));
const buildStepsPayload = new Function('sequence', 'implicitWaitEvent', `${js(payloadSource)}; return buildStepsPayload();`);

/** Charge que useSequenceSave envoie à save_sequence_steps pour ces étapes. */
const serialize = (steps) => buildStepsPayload({ steps }, implicitWaitEvent);

// Corps réel de handleEdit : `steps.map(s => ({ ...rowToSequenceStep(s), … }))`.
const handleEditSource = statementFrom(actions, actions.indexOf('const handleEdit = async'));
const editMapSource = callFrom(handleEditSource, handleEditSource.indexOf('steps.map(s => ({'));
const constant = (name) => {
  const m = actions.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(m, `${name} introuvable dans sequenceActions.ts`);
  return new Function(`return ${m[1]};`)();
};
const openWithHandleEdit = new Function(
  'steps', 'rowToSequenceStep', 'DEFAULT_SCORE_THRESHOLD', 'TIMEOUT_REQUIRED_ACTIONS', 'DEFAULT_WAIT_TIMEOUT_DAYS',
  `return ${js(`(${editMapSource})`).replace(/;\s*$/, '')};`,
);

/**
 * Ouvertures d'une séquence enregistrée, une par éditeur. `key` : attente
 * propre au modèle dans `expected` d'un jeu (sinon les lignes à l'identique).
 */
const EDITOR_MODELS = [
  {
    key: 'lecture',
    name: 'lecture par rowToSequenceStep',
    open: (rows) => rows.map(graph.rowToSequenceStep),
  },
  {
    key: 'ancien_editeur',
    name: 'ouverture de l’ancien éditeur (handleEdit puis SequenceBuilder)',
    open: (rows) => graph.withoutInvitationAi(openWithHandleEdit(
      rows,
      graph.rowToSequenceStep,
      constant('DEFAULT_SCORE_THRESHOLD'),
      constant('TIMEOUT_REQUIRED_ACTIONS'),
      constant('DEFAULT_WAIT_TIMEOUT_DAYS'),
    )),
  },
  {
    // Éditeur unique (lot 5d-2) : étapes relues par handleEdit, ouvertes dans le hook comme la page
    // (resetEditor(openEditorSteps(next.steps))), puis l'état du hook tel que la page l'enregistre.
    key: 'ancien_editeur',
    name: 'état du hook de l’éditeur unique (handleEdit, puis reset d’useSequenceEditor)',
    open: (rows) => {
      const editor = mountEditor(openOld(rows));
      assert.equal(editor.result.dirty, false, 'ouverture : aucune modification à enregistrer');
      return editor.result.steps;
    },
  },
];

/** Étapes relues par handleEdit (sequenceActions.ts), avant la transformation propre à chaque éditeur. */
function openOld(rows) {
  return openWithHandleEdit(
    rows,
    graph.rowToSequenceStep,
    constant('DEFAULT_SCORE_THRESHOLD'),
    constant('TIMEOUT_REQUIRED_ACTIONS'),
    constant('DEFAULT_WAIT_TIMEOUT_DAYS'),
  );
}

// Gestes de SequenceBuilder, épinglés sur son code (dernier test) puis rejoués ici.
const builderCode = stripLineComments(builder);
const oldCreateEmptyStep = new Function('STEP_TYPE_LABELS', 'crypto', `${js([
  statementFrom(builderCode, builderCode.indexOf('const TRIGGERS = [')),
  statementFrom(builderCode, builderCode.indexOf('const createEmptyStep = (')),
].join('\n'))}; return createEmptyStep;`);
const OLD = {
  /** updateStep : la seule ligne visée. */
  updateStep: (steps, stepId, updates) => steps.map((step) => (step.id === stepId ? { ...step, ...updates } : step)),
  /** addVariant. */
  addVariant: (steps, stepId, newId) => graph.addVariantToSteps(steps, stepId, newId),
  /** addStep (liste) : étape vide à l'ordre suivant, reliée par chainAfterLastMainStep. */
  addStep: (steps, actionType, newId) => {
    const newStep = oldCreateEmptyStep(graph.STEP_TYPE_LABELS, { randomUUID: () => newId })(graph.nextStepOrder(steps), actionType);
    return [...graph.chainAfterLastMainStep(steps, newStep.id), newStep];
  },
  /** applyRemoveStep. */
  removeStep: (steps, stepId) => graph.removeStepFromSequence(steps, stepId),
};
const TEXT_TYPES = new Set(['message', 'inmail', 'smart_message', 'connection_request', 'email', 'whatsapp_message']);

/** Colonnes de l'interface SequenceStepRow (sequenceGraph.ts). */
function rowColumns() {
  const src = read('src/components/outreach/sequence/sequenceGraph.ts');
  const start = src.indexOf('export interface SequenceStepRow {');
  assert.ok(start !== -1, 'SequenceStepRow introuvable');
  const block = src.slice(start, src.indexOf('}', start));
  return [...block.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort();
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('la charge écrit chaque colonne lue par l’éditeur, et rien d’autre', () => {
  const columns = rowColumns();
  assert.equal(columns.length, 27);
  const steps = fixtures.sequences.flatMap((s) => s.rows).map(graph.rowToSequenceStep);
  for (const payload of serialize(steps)) {
    assert.deepEqual(Object.keys(payload).sort(), columns);
  }
  for (const seq of fixtures.sequences) {
    for (const row of seq.rows) assert.deepEqual(Object.keys(row).sort(), columns, `${seq.name} : colonnes du jeu`);
  }
});

test('les jeux couvrent chaque type d’étape et les formes à risque', () => {
  const covered = new Set(fixtures.sequences.flatMap((s) => s.rows.map((r) => r.action_type)));
  for (const type of Object.keys(graph.STEP_TYPE_LABELS)) assert.ok(covered.has(type), `type sans jeu : ${type}`);
  const rows = fixtures.sequences.flatMap((s) => s.rows);
  const has = (predicate, what) => assert.ok(rows.some(predicate), `aucun jeu avec ${what}`);
  has((r) => r.action_type === 'check_connection' && r.if_true_goto_step && r.if_false_goto_step, 'vérification à deux branches');
  has((r) => r.variant_group === 'B', 'une version B');
  has((r) => r.variant_group === 'C', 'une version C');
  has((r) => r.action_type === 'wait_connection' && r.timeout_branch_step_id, 'repli d’une attente de connexion');
  has((r) => r.action_type === 'wait_reply' && r.timeout_branch_step_id, 'repli d’une attente de réponse');
  has((r) => r.ends_sequence === true, 'fin de séquence');
  has((r) => Array.isArray(r.cc_emails) && r.cc_emails.length > 0, 'copie (cc)');
  has((r) => Array.isArray(r.bcc_emails) && r.bcc_emails.length > 0, 'copie cachée');
  has((r) => typeof r.signature_id === 'string', 'signature');
  has((r) => r.include_unsubscribe === true, 'lien de désinscription');
  has((r) => r.include_unsubscribe === false, 'désinscription refusée');
  has((r) => r.preferred_hour_start !== 9 && r.preferred_hour_start !== null, 'créneau d’envoi');
  has((r) => r.condition_type === 'if_score_above' && r.condition_value, 'seuil de note');
  has((r) => r.use_ai_personalization === true && r.ai_tone && r.ai_tone !== 'professional', 'ton de l’IA');
  has((r) => r.delay_hours > 0 && r.delay_minutes > 0, 'délai en heures et minutes');
  assert.equal(fixtures.recommended.payload.length, 17);
});

for (const model of EDITOR_MODELS) {
  test(`charge identique aux jeux de référence : ${model.name}`, () => {
    for (const seq of fixtures.sequences) {
      const expected = seq.expected?.[model.key] ?? seq.rows;
      assert.deepEqual(serialize(model.open(seq.rows)), expected, seq.name);
    }
  });
}

test('aller-retour par rowToSequenceStep : une ligne canonique revient à l’identique, la charge est un point fixe', () => {
  for (const seq of fixtures.sequences) {
    const once = serialize(seq.rows.map(graph.rowToSequenceStep));
    const twice = serialize(once.map(graph.rowToSequenceStep));
    assert.deepEqual(twice, once, `${seq.name} : point fixe`);
    if (!seq.expected) assert.deepEqual(once, seq.rows, `${seq.name} : sans perte`);
  }
});

test('ligne héritée : seules les normalisations documentées changent la charge', () => {
  const legacy = fixtures.sequences.find((s) => s.expected);
  assert.ok(legacy, 'jeu de ligne héritée absent');
  const read1 = serialize(legacy.rows.map(graph.rowToSequenceStep));
  const [invite, wait, message] = read1;
  // Défauts de lecture : condition, délais, créneau 9 h-18 h, ton, poids 100, textes vides, IA non.
  assert.equal(invite.condition_type, 'always');
  assert.deepEqual([invite.delay_days, invite.delay_hours, invite.delay_minutes], [0, 0, 0]);
  assert.deepEqual([invite.preferred_hour_start, invite.preferred_hour_end], [9, 18]);
  assert.equal(invite.ai_tone, 'professional');
  assert.equal(invite.variant_weight, 100);
  assert.equal(invite.subject_template, '');
  assert.equal(wait.use_ai_personalization, false);
  // Attente : événement implicite écrit (sinon le moteur la franchit aussitôt).
  assert.equal(wait.wait_for_event, 'reply_received');
  // Fin de séquence : le renvoi conservé à côté n'est pas réécrit (le moteur s'arrête).
  assert.equal(message.ends_sequence, true);
  assert.equal(message.next_step_id, null);
  // L'ancien éditeur ajoute ses défauts d'ouverture : invitation sans IA, attente de 3 jours, seuil 70.
  const [oldInvite, oldWait, oldMessage] = serialize(EDITOR_MODELS[1].open(legacy.rows));
  assert.equal(oldInvite.use_ai_personalization, false);
  assert.equal(oldWait.timeout_days, 3);
  assert.equal(oldMessage.condition_value, '70');
});

test('Séquence recommandée : charge identique à celle de l’ancien éditeur', () => {
  // L'ancien éditeur charge les étapes telles quelles (loadRecommendedSequence).
  assert.match(builder, /const steps = generateRecommendedSequence\(\);\s*setSequence\(prev => \(\{ \.\.\.prev, steps \}\)\);/);
  const steps = starters.generateRecommendedSequence();
  const names = new Map(steps.map((s, i) => [s.id, `etape-${String(i + 1).padStart(2, '0')}`]));
  const normalized = serialize(steps).map((p) => Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, typeof v === 'string' && names.has(v) ? names.get(v) : v]),
  ));
  assert.deepEqual(normalized, fixtures.recommended.payload);
  // Enregistrée puis rouverte : même charge, aux textes absents près (null relu en '').
  const reread = serialize(serialize(steps).map(graph.rowToSequenceStep));
  const blankTexts = (p) => ({ ...p, subject_template: p.subject_template ?? '', message_template: p.message_template ?? '' });
  assert.deepEqual(reread, serialize(steps).map(blankTexts));
});

test('création par l’éditeur unique (modèles Konekt, Séquence recommandée comprise) : charge de SequenceBuilder', () => {
  for (const template of starters.STARTER_TEMPLATES) {
    const built = template.build();
    // /sequences/nouvelle?depart=modele:<clé> : reset sans étape en base ; SequenceBuilder : withoutInvitationAi(initial.steps).
    const editor = mountEditor(built, []);
    assert.equal(editor.result.dirty, false, `${template.key} : rien de modifié à l’ouverture`);
    assert.deepEqual(serialize(editor.result.steps), serialize(graph.withoutInvitationAi(built)), template.key);
  }
  // Séquence recommandée (modèle « sequence-longue ») : la charge relevée sur l'ancien éditeur.
  const recommended = starters.STARTER_TEMPLATES.find((t) => t.key === 'sequence-longue');
  assert.equal(recommended.build, starters.generateRecommendedSequence);
  const steps = recommended.build();
  const names = new Map(steps.map((s, i) => [s.id, `etape-${String(i + 1).padStart(2, '0')}`]));
  const normalized = serialize(mountEditor(steps, []).result.steps).map((p) => Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, typeof v === 'string' && names.has(v) ? names.get(v) : v]),
  ));
  assert.deepEqual(normalized, fixtures.recommended.payload);
});

test('gestes communs aux deux éditeurs, sur chaque jeu : même charge (texte, délai, version, ajout, suppression)', () => {
  let gestures = 0;
  const corrected = [];
  for (const seq of fixtures.sequences) {
    const start = graph.withoutInvitationAi(openOld(seq.rows));
    const before = serialize(start);
    const editor = mountEditor(openOld(seq.rows));
    const same = (old, what) => {
      assert.deepEqual(serialize(editor.result.steps), serialize(old), `${seq.name} : ${what}`);
      gestures += 1;
    };
    let old = start;
    const single = (predicate) => old.find((s) => !s.variantGroup && predicate(s));

    // Texte d'une étape sans versions : « Je rédige ».
    const text = single((s) => TEXT_TYPES.has(s.actionType));
    if (text) {
      editor.act((e) => e.updateVersion(text.id, { messageTemplate: 'Bonjour {{prenom}}, texte modifié.', subjectTemplate: 'Objet modifié' }));
      old = OLD.updateStep(old, text.id, { messageTemplate: 'Bonjour {{prenom}}, texte modifié.', subjectTemplate: 'Objet modifié' });
      same(old, 'texte');
      assert.equal(editor.result.dirty, true);
    }
    // Délai et créneau d'une étape sans versions (« Plus d'options »).
    const timed = single((s) => s.order > 0);
    if (timed) {
      editor.act((e) => e.updateStep(timed.id, { delayDays: 6, delayHours: 1, preferredHourStart: 10, preferredHourEnd: 17 }));
      old = OLD.updateStep(old, timed.id, { delayDays: 6, delayHours: 1, preferredHourStart: 10, preferredHourEnd: 17 });
      same(old, 'délai et créneau');
    }
    // Version B d'une étape qui en accepte.
    const versioned = single((s) => editorModel.canHaveVersions(s.actionType));
    if (versioned) {
      const id = withIds(['version-b'], () => editor.act((e) => e.addVersion(versioned.id)));
      assert.equal(id, 'version-b');
      old = OLD.addVariant(old, versioned.id, 'version-b');
      same(old, 'version B');
    }
    // Ajout au bout du fil principal, puis suppression de l'étape ajoutée (pas encore en base : aussitôt retirée).
    const add = editor.result.flow.add;
    if (add) {
      const beforeAdd = serialize(editor.result.steps);
      const id = withIds(['ajoutee'], () => editor.act((e) => e.add(add, 'profile_visit')));
      assert.equal(id, 'ajoutee');
      assert.equal(editor.result.selectedId, 'ajoutee', 'ouverte dans le panneau');
      const withAdded = OLD.addStep(old, 'profile_visit', 'ajoutee');
      const diff = payloadDiff(serialize(editor.result.steps), serialize(withAdded));
      if (diff.length === 0) {
        same(withAdded, 'ajout au bout du fil');
      } else {
        // Seul écart admis (addStepAt de sequenceEditor.ts) : la dernière étape est reliée à la nouvelle, qui
        // prend sa place dans le parcours. L'ancienne liste la laissait hors du parcours dans deux cas : dernière
        // étape cible d'un repli ou d'une branche (le moteur s'arrête après une cible de renvoi sans suite), et
        // dernière étape « Fin de la séquence » (la nouvelle venait après la fin).
        const last = getLastPrimary(old);
        const group = new Set(old.filter((s) => s.order === last.order).map((s) => s.id));
        for (const d of diff) {
          const endMoved = d.id === 'ajoutee' && d.column === 'ends_sequence' && d.mine === true && d.old === false;
          assert.ok(endMoved || group.has(d.id), `${seq.name} : écart hors de la dernière étape (${d.id}, ${d.column})`);
          assert.ok(
            endMoved || (d.column === 'next_step_id' && d.mine === 'ajoutee' && d.old === null) || (d.column === 'ends_sequence' && d.mine === false && d.old === true),
            `${seq.name} : écart non admis ${JSON.stringify(d)}`,
          );
        }
        assert.ok(diff.some((d) => d.column === 'next_step_id'), `${seq.name} : la dernière étape mène à la nouvelle`);
        // « Fin de la séquence » : elle passe à la nouvelle étape, jamais perdue.
        assert.equal(
          diff.some((d) => d.column === 'ends_sequence' && d.id !== 'ajoutee'),
          diff.some((d) => d.column === 'ends_sequence' && d.id === 'ajoutee'),
          `${seq.name} : fin de la séquence déplacée sur la nouvelle étape`,
        );
        assert.equal(graph.engineNextStepId(withAdded.find((s) => s.id === last.id), withAdded), null, `${seq.name} : ancien éditeur, le moteur s’arrête avant la nouvelle étape`);
        assert.ok(editorModel.buildEditorFlow(withAdded).orphans.some((n) => n.id === 'ajoutee'), `${seq.name} : ancien éditeur, étape hors du parcours`);
        assert.ok(!editorModel.buildEditorFlow(editor.result.steps).orphans.some((n) => n.id === 'ajoutee'), `${seq.name} : étape jouée`);
        corrected.push(seq.name);
      }
      editor.act((e) => { void e.requestRemove('ajoutee'); });
      assert.deepEqual(serialize(editor.result.steps), beforeAdd, `${seq.name} : étape ajoutée retirée, rien d’autre ne change`);
      same(old, 'suppression de l’étape ajoutée');
    }
    // « Quitter sans enregistrer » : retour exact à l'état enregistré.
    editor.act((e) => e.discard());
    assert.equal(editor.result.dirty, false);
    assert.deepEqual(serialize(editor.result.steps), before, `${seq.name} : abandon`);
  }
  assert.ok(gestures >= fixtures.sequences.length * 3, `trop peu de gestes comparés : ${gestures}`);
  // Jeux où l'ajout corrige l'ancien éditeur : la liste est fermée (un nouvel écart fait échouer le test).
  assert.deepEqual(corrected, ['Attente de réponse avec repli au délai dépassé', 'Ligne héritée : colonnes vides, invitation marquée IA, fin de séquence avec renvoi']);
});

/** Colonnes qui diffèrent entre deux charges de mêmes lignes (par identifiant). */
function payloadDiff(mine, old) {
  assert.deepEqual(mine.map((p) => p.id).sort(), old.map((p) => p.id).sort(), 'mêmes lignes');
  const out = [];
  for (const row of [...mine].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const other = old.find((p) => p.id === row.id);
    for (const column of Object.keys(row)) {
      if (!isDeepStrictEqual(row[column], other[column])) out.push({ id: row.id, column, mine: row[column], old: other[column] });
    }
  }
  return out;
}

test('suppression d’une étape enregistrée : historique lu comme l’ancien éditeur ; sans envoi, même charge ; avec envoi, rien ne change', async () => {
  const seq = fixtures.sequences.find((s) => s.rows.length >= 3 && !s.expected);
  const start = graph.withoutInvitationAi(openOld(seq.rows));
  const target = getLastPrimary(start);
  // Aucun envoi : retirée, comme applyRemoveStep.
  globalThis.__historyCount = 0;
  globalThis.__editorQueries = [];
  let editor = mountEditor(openOld(seq.rows));
  await editor.actAsync((e) => e.requestRemove(target.id));
  assert.deepEqual(serialize(editor.result.steps), serialize(OLD.removeStep(start, target.id)));
  const versions = start.filter((s) => s.order === target.order && (target.variantGroup ? s.variantGroup : s.id === target.id)).map((s) => s.id);
  assert.deepEqual(globalThis.__editorQueries, [{
    table: 'sequence_step_executions',
    select: ['id', { count: 'exact', head: true }],
    filters: [['step_id', versions], ['status', ['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped']]],
  }]);
  // Déjà envoyée : expliquée, jamais retirée (l'enregistrement serait refusé, STEP_HAS_HISTORY).
  globalThis.__historyCount = 3;
  globalThis.__editorToasts = [];
  editor = mountEditor(openOld(seq.rows));
  await editor.actAsync((e) => e.requestRemove(target.id));
  assert.deepEqual(serialize(editor.result.steps), serialize(start));
  assert.equal(editor.result.dirty, false);
  assert.equal(editor.result.removalBlock?.count, 3);
  // Titre affirmatif : la fenêtre n'a que « Garder l'étape », elle ne pose pas une question sans réponse.
  assert.match(editor.result.removalBlock?.title ?? '', /^L’étape \d+ ne peut pas être supprimée$/);
  assert.deepEqual(globalThis.__editorToasts, []);
  // Création (aucune étape en base) : retirée sans rien lire.
  globalThis.__editorQueries = [];
  editor = mountEditor(openOld(seq.rows), []);
  await editor.actAsync((e) => e.requestRemove(target.id));
  assert.deepEqual(globalThis.__editorQueries, []);
  assert.deepEqual(serialize(editor.result.steps), serialize(OLD.removeStep(start, target.id)));
  globalThis.__historyCount = 0;
});

test('brouillon repris (passé par JSON, comme editorDraft) : même charge que l’état modifié', () => {
  for (const seq of fixtures.sequences) {
    const editor = mountEditor(openOld(seq.rows));
    const text = editor.result.steps.find((s) => !s.variantGroup && TEXT_TYPES.has(s.actionType)) ?? editor.result.steps[0];
    editor.act((e) => e.updateVersion(text.id, { messageTemplate: 'Texte du brouillon {{prenom}}' }));
    const modified = serialize(editor.result.steps);
    // Rechargement : la page rouvre la séquence enregistrée, puis reprend le brouillon.
    const reopened = mountEditor(openOld(seq.rows));
    reopened.act((e) => e.restore(JSON.parse(JSON.stringify(editor.result.steps))));
    assert.deepEqual(serialize(reopened.result.steps), modified, seq.name);
    assert.equal(reopened.result.dirty, true, `${seq.name} : brouillon à enregistrer`);
  }
});

test('réglage commun d’une étape à versions : écrit sur chaque version (l’ancien éditeur ne changeait que la version A)', () => {
  // Écart voulu (lot 5d-2) : la version tirée au sort garde le délai et le créneau de l'étape.
  const seq = fixtures.sequences.find((s) => s.rows.some((r) => r.variant_group === 'B'));
  const start = graph.withoutInvitationAi(openOld(seq.rows));
  const b = start.find((s) => s.variantGroup === 'B');
  const a = start.find((s) => s.order === b.order && s.variantGroup === 'A');
  const editor = mountEditor(openOld(seq.rows));
  editor.act((e) => e.updateStep(a.id, { delayDays: 9 }));
  const group = editor.result.steps.filter((s) => s.order === a.order);
  assert.ok(group.length >= 2 && group.every((s) => s.delayDays === 9));
  // Champ propre à une version : seule la version visée change, comme l'ancien updateStep.
  editor.act((e) => e.updateVersion(b.id, { messageTemplate: 'Version B seule' }));
  const old = OLD.updateStep(start.map((s) => (s.order === a.order ? { ...s, delayDays: 9 } : s)), b.id, { messageTemplate: 'Version B seule' });
  assert.deepEqual(serialize(editor.result.steps), serialize(old));
});

function getLastPrimary(steps) {
  const primaries = graph.getPrimarySteps(steps);
  return primaries[primaries.length - 1];
}

test('les ouvertures modélisées sont celles du code (handleEdit, SequenceBuilder, éditeur unique)', () => {
  assert.match(editMapSource, /\.\.\.rowToSequenceStep\(s\),/);
  assert.match(editMapSource, /s\.condition_type === 'if_score_above' \? DEFAULT_SCORE_THRESHOLD : undefined/);
  assert.match(editMapSource, /TIMEOUT_REQUIRED_ACTIONS\.includes\(s\.action_type\) \? DEFAULT_WAIT_TIMEOUT_DAYS : undefined/);
  assert.match(builder, /steps: withoutInvitationAi\(initial\.steps\),/);
  assert.match(saveHook, /p_steps: buildStepsPayload\(\),/);
  // Éditeur unique : la page ouvre les étapes relues par handleEdit avec openEditorSteps.
  const detail = read('src/pages/SequenceDetailPage.tsx');
  assert.match(detail, /setEditingSequence: openInEditor,/);
  assert.match(detail, /resetEditor\(openEditorSteps\(next\.steps\)\);/);
  // Création : reset sans étape en base ; un modèle Konekt donne ses étapes telles quelles.
  const create = read('src/components/sequences/SequenceCreatePage.tsx');
  assert.match(create, /resetEditor\(openEditorSteps\(readySequence\.steps\), \[\]\);/);
  assert.match(create, /done\(starterTemplateToSequence\(starter\)\);/);
  assert.match(read('src/lib/sequenceStarterTemplates.ts'), /return \{ name: template\.name, description: template\.description, steps: template\.build\(\), isActive: true \};/);
  // Les deux pages enregistrent l'état du hook tel quel : `steps: editor.steps` dans l'appel à handleSaveSequence.
  for (const page of [detail, create]) {
    assert.match(page, /const editor = useSequenceEditor\(\);/);
    assert.match(page, /steps: editor\.steps,/);
  }
  // Brouillon : étapes reprises par restore (useSequenceEditorDraft passe par editorDraft, en JSON).
  assert.match(read('src/lib/editorDraft.ts'), /localStorage\.setItem\(PREFIX \+ key, JSON\.stringify\(payload\)\);/);
  // Gestes rejoués : ceux de SequenceBuilder.
  assert.match(builder, /const updateStep = useCallback\(\(stepId: string, updates: Partial<SequenceStep>\) => \{\s*setSequence\(prev => \(\{\s*\.\.\.prev,\s*steps: prev\.steps\.map\(step =>\s*step\.id === stepId \? \{ \.\.\.step, \.\.\.updates \} : step\s*\),\s*\}\)\);\s*\}, \[\]\);/);
  assert.match(builder, /setSequence\(prev => \(\{ \.\.\.prev, steps: addVariantToSteps\(prev\.steps, sourceStep\.id, newId\) \}\)\);/);
  assert.match(builder, /const newStep = createEmptyStep\(nextStepOrder\(sequence\.steps\), actionType\);[\s\S]{0,400}steps: \[\.\.\.chainAfterLastMainStep\(prev\.steps, newStep\.id\), newStep\],/);
  assert.match(builder, /setSequence\(prev => \(\{ \.\.\.prev, steps: removeStepFromSequence\(prev\.steps, stepId\) \}\)\);/);
  // Champ de délai de l'ancienne liste : la ligne affichée seulement (version A).
  assert.match(builder, /onChange=\{\(e\) => updateStep\(step\.id, \{ delayDays: Math\.max\(0, parseInt\(e\.target\.value\) \|\| 0\) \}\)\}/);
});
