/**
 * Mesures d'usage du pilote des séquences (src/lib/usageEvents.ts).
 *
 *   1. Le module, transpilé par esbuild et exécuté : liste fermée
 *      d'événements ; propriétés filtrées (clé hors liste retirée, chaîne hors
 *      des valeurs admises remplacée par « autre » ou retirée, nombre qui
 *      n'est pas un compte retiré) ; aucune erreur quand la mesure est absente
 *      (pas de fenêtre, pas de script de mesure, script qui lève, propriétés
 *      illisibles).
 *   2. Chaque geste du pilote appelle trackUsage avec un nom de la liste
 *      fermée, au moment où il réussit : après l'écriture ou la réponse du
 *      serveur qui le prouve, jamais au clic seul quand le geste peut échouer.
 *   3. Aucune propriété interdite : les clés de la liste ne désignent ni
 *      identifiant, ni nom, ni texte, ni adresse, ni organisation ; les valeurs
 *      admises sont des catégories ; chaque appel de src/ n'utilise que des
 *      clés et des valeurs littérales admises ; trackEvent n'est appelé
 *      directement que par les modules qui le font déjà.
 *
 * Sur le code d'origine (sans usageEvents.ts ni appels), la transpilation du
 * module échoue et le fichier entier échoue.
 *
 * Lancer : node --test tests/ux/mesures-usage.test.mjs
 * UX_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(process.env.UX_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Le code sans ses commentaires : un commentaire peut nommer ce que le code fait.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ─── Module réel, alias @/ résolu vers src/ ─────────────────────────────────

const aliasPlugin = {
  name: 'alias-src',
  setup(builder) {
    builder.onResolve({ filter: /^@\// }, ({ path }) => {
      const base = join(ROOT, 'src', path.slice(2));
      const file = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((candidate) => existsSync(candidate));
      return file ? { path: file } : undefined;
    });
  },
};
const { outputFiles } = await build({
  entryPoints: [join(ROOT, 'src/lib/usageEvents.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [aliasPlugin],
});
const usage = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { USAGE_EVENTS, ASSISTANT_PROPOSAL_TOOLS, trackUsage } = usage;
const EVENT_NAMES = Object.keys(USAGE_EVENTS);

/** Installe un faux script de mesure sur une page de séquence ; rend les appels reçus. */
const PAGE = { origin: 'https://app.exemple', pathname: '/sequences/7f9c2e10-aaaa-bbbb-cccc-000000000001' };
const U = 'https://app.exemple/sequences/:id';
function recordPlausible() {
  const calls = [];
  globalThis.window = { location: PAGE, plausible: (name, options) => { calls.push([name, options]); } };
  return calls;
}

test.afterEach(() => { delete globalThis.window; });

// ─── 1. Le module ───────────────────────────────────────────────────────────

test('module — liste fermée : un événement inconnu n’est jamais envoyé', () => {
  const calls = recordPlausible();
  trackUsage('Evenement inconnu', { count: 1 });
  trackUsage('toString');
  trackUsage('__proto__');
  assert.deepEqual(calls, []);
  trackUsage('Enrollment Stopped', { count: 2 });
  assert.deepEqual(calls, [['Enrollment Stopped', { u: U, props: { count: 2 } }]]);
});

test('module — propriétés filtrées : clés hors liste, textes libres et nombres qui ne sont pas des comptes', () => {
  const calls = recordPlausible();
  trackUsage('Candidates Enrolled', { surface: 'preparation', count: 3.4, candidate_name: 'Claire Dubois', organization_id: 'org-1' });
  // Un nom passé à la place d'une catégorie sans « autre » : retiré ; compte négatif : retiré.
  trackUsage('Candidates Enrolled', { surface: 'Claire Dubois', count: -1 });
  // Un texte de message à la place d'un type de suggestion : ramené à « autre ».
  trackUsage('Reply Suggestion Used', { kind: 'Bonjour Claire, merci pour votre retour', place: 'bandeau' });
  // Nombre non fini, valeur nulle, nombre à la place d'une catégorie.
  trackUsage('Sequence Saved', { steps: Number.NaN, start: null, mode: 3 });
  trackUsage('Assistant Proposal', { tool: 'outil_futur', decision: 'approuvee', surface: 'journal' });
  assert.deepEqual(calls, [
    ['Candidates Enrolled', { u: U, props: { surface: 'preparation', count: 3 } }],
    ['Candidates Enrolled', { u: U }],
    ['Reply Suggestion Used', { u: U, props: { kind: 'autre', place: 'bandeau' } }],
    ['Sequence Saved', { u: U }],
    ['Assistant Proposal', { u: U, props: { tool: 'autre', decision: 'approuvee', surface: 'journal' } }],
  ]);
});

test('module — ne lève jamais quand la mesure est absente ou en panne', () => {
  // Pas de fenêtre (rendu hors navigateur), pas de script de mesure (variable absente).
  delete globalThis.window;
  assert.doesNotThrow(() => trackUsage('Enrollment Stopped', { count: 1 }));
  globalThis.window = {};
  assert.doesNotThrow(() => trackUsage('Enrollment Stopped', { count: 1 }));
  // Script de mesure qui lève.
  globalThis.window = { location: PAGE, plausible: () => { throw new Error('mesure en panne'); } };
  assert.doesNotThrow(() => trackUsage('Enrollment Stopped', { count: 1 }));
  // Propriétés illisibles.
  const hostile = {};
  Object.defineProperty(hostile, 'count', { enumerable: true, get() { throw new Error('illisible'); } });
  assert.doesNotThrow(() => trackUsage('Enrollment Stopped', hostile));
  assert.doesNotThrow(() => trackUsage('Enrollment Stopped', null));
});

// ─── 3. Liste des propriétés ────────────────────────────────────────────────

const FORBIDDEN_KEY = /(^|_)ids?$|name|nom|text|message|mail|adress|address|url|org|user|candidat|profil|phone|token|email/i;

test('liste — aucune clé ne désigne un identifiant, un nom, un texte, une adresse ou l’organisation', () => {
  for (const [event, rules] of Object.entries(USAGE_EVENTS)) {
    for (const [key, rule] of Object.entries(rules)) {
      assert.doesNotMatch(key, FORBIDDEN_KEY, `${event}.${key} : clé interdite`);
      if (rule === 'count') continue;
      assert.ok(Array.isArray(rule) && rule.length > 0, `${event}.${key} : liste de valeurs attendue`);
      for (const value of rule) assert.match(value, /^[a-z][a-z_]*$/, `${event}.${key} : « ${value} » n’est pas une catégorie`);
    }
  }
});

test('liste — les outils de la carte d’approbation sont tous nommés (sinon comptés « autre »)', () => {
  const card = read('src/components/agent/AgentToolApprovalCard.tsx');
  const block = card.slice(card.indexOf('const TOOL_LABEL'), card.indexOf('};', card.indexOf('const TOOL_LABEL')));
  const keys = [...code(block).matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 20, 'TOOL_LABEL introuvable');
  for (const key of keys) assert.ok(ASSISTANT_PROPOSAL_TOOLS.includes(key), `outil ${key} absent de ASSISTANT_PROPOSAL_TOOLS`);
});

// ─── 2 et 3. Appels dans src/ ───────────────────────────────────────────────

/** Appels trackUsage('Nom', { … }) d'un code sans commentaires : nom, clés, valeurs littérales par clé, position. */
function usageCalls(source) {
  const calls = [];
  for (const match of source.matchAll(/trackUsage\(\s*'([^']+)'\s*(?:,\s*\{([^{}]*)\})?\s*\)/g)) {
    const entries = (match[2] ?? '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const colon = part.indexOf(':');
      const key = (colon === -1 ? part : part.slice(0, colon)).trim();
      const expression = colon === -1 ? '' : part.slice(colon + 1);
      // Valeurs possibles : les chaînes littérales, sauf l'opérande d'une comparaison (action === 'approve' ? … : …).
      const literals = [...expression.matchAll(/(===|!==)?\s*'([^']*)'/g)].filter((m) => !m[1]).map((m) => m[2]);
      return { key, literals };
    });
    calls.push({ name: match[1], entries, index: match.index, text: match[0] });
  }
  return calls;
}

function assertAdmitted(file, call) {
  assert.ok(EVENT_NAMES.includes(call.name), `${file} : « ${call.name} » hors de la liste fermée`);
  const rules = USAGE_EVENTS[call.name];
  for (const { key, literals } of call.entries) {
    assert.ok(Object.hasOwn(rules, key), `${file} : propriété « ${key} » non admise pour ${call.name}`);
    if (rules[key] === 'count') {
      assert.deepEqual(literals, [], `${file} : ${call.name}.${key} est un compte`);
    } else {
      for (const literal of literals) assert.ok(rules[key].includes(literal), `${file} : « ${literal} » non admise pour ${call.name}.${key}`);
    }
  }
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test('src — chaque appel de trackUsage nomme un événement de la liste, avec des clés et des valeurs admises', () => {
  let count = 0;
  for (const full of sourceFiles(join(ROOT, 'src'))) {
    const file = relative(ROOT, full);
    if (file.endsWith('usageEvents.ts')) continue;
    const source = code(readFileSync(full, 'utf8'));
    if (!source.includes('trackUsage(')) continue;
    const calls = usageCalls(source);
    // Tout appel est lisible par le contrôle (pas d'objet construit ailleurs, pas de nom calculé).
    assert.equal(calls.length, (source.match(/trackUsage\(/g) ?? []).length, `${file} : appel de trackUsage illisible pour le contrôle`);
    for (const call of calls) assertAdmitted(file, call);
    count += calls.length;
  }
  assert.ok(count >= 20, `appels trouvés : ${count}`);
});

test('src — trackEvent n’est appelé directement que par les modules qui le faisaient déjà', () => {
  const allowed = new Set(['src/lib/analytics.ts', 'src/lib/candidateStage.ts', 'src/lib/usageEvents.ts']);
  for (const full of sourceFiles(join(ROOT, 'src'))) {
    const file = relative(ROOT, full).split('\\').join('/');
    if (allowed.has(file)) continue;
    assert.doesNotMatch(code(readFileSync(full, 'utf8')), /\btrackEvent\(/, `${file} : passer par trackUsage (liste fermée)`);
  }
});

// ─── 2. Gestes du pilote, au moment où ils réussissent ──────────────────────

/** Appel du fichier qui porte ce nom d'événement et cette valeur littérale, s'il y en a une. */
function callOf(file, name, literal) {
  const source = code(read(file));
  const found = usageCalls(source).filter((c) => c.name === name && (!literal || c.text.includes(`'${literal}'`)));
  assert.equal(found.length >= 1, true, `${file} : trackUsage('${name}'${literal ? `, … '${literal}'` : ''}) introuvable`);
  for (const call of found) assertAdmitted(file, call);
  assert.match(source, /import \{ trackUsage \} from '@\/lib\/usageEvents';/, `${file} : import du module`);
  return { source, call: found[0], all: found };
}

/** L'appel vient après chaque repère (écriture ou contrôle de la réponse). */
function after(source, call, ...markers) {
  for (const marker of markers) {
    const at = typeof marker === 'string' ? source.indexOf(marker) : source.search(marker);
    assert.ok(at !== -1, `repère introuvable : ${marker}`);
    assert.ok(call.index > at, `${call.text} doit venir après ${marker}`);
  }
}

test('geste — séquence créée ou enregistrée : après l’écriture des étapes, départ de /sequences/nouvelle', () => {
  const file = 'src/hooks/useSequenceSave.ts';
  const { source, call } = callOf(file, 'Sequence Saved');
  after(source, call, "supabase.rpc('save_sequence_steps'", 'if (stepsError) {', 'throw sequenceSaveError(stepsError);');
  assert.match(call.text, /mode: sequence\.id \? 'modification' : 'creation'/);
  assert.match(call.text, /start: sequence\.id \? undefined : startKind/);
  assert.match(call.text, /steps: sequence\.steps\.length/);
  // La page de création passe son départ (zero, modele, copie, ia).
  const page = code(read('src/components/sequences/SequenceCreatePage.tsx'));
  assert.match(page, /useSequenceSave\(\{[\s\S]*?startKind: start\.kind,[\s\S]*?\}\);/);
});

test('geste — rédaction par l’IA : séquence entière ou texte d’une étape, chaque issue avec son niveau, « ok » seulement pour un texte affiché', () => {
  // Le crochet partagé ne mesure pas : il ne sait ni quel geste l'appelle, ni si le texte rendu est utilisable.
  assert.doesNotMatch(code(read('src/hooks/useSequenceAI.ts')), /trackUsage/, 'mesure dans les écrans, pas dans useSequenceAI');
  {
    // « Rédiger la séquence » : une mesure par rédaction lancée, juste après la réponse ; réussite = séquence rendue à l'éditeur.
    const file = 'src/components/sequences/ai/AIDraftWizard.tsx';
    const { source, all } = callOf(file, 'Sequence AI Draft', 'sequence');
    assert.equal(all.length, 1);
    const call = all[0];
    after(source, call, 'const outcome = await runDraft(draftRequestBody(organizationId, missionId, prepare, settings));');
    assert.ok(call.index < source.indexOf('onDrafted(outcome.result, settings);'), 'mesure avant toute sortie de la fonction');
    assert.match(call.text, /level: settings\.level/);
    assert.match(call.text, /result: outcome\.status === 'ok' \? 'ok' : outcome\.error\.kind/);
  }
  {
    // « Rédiger à partir du poste » (une étape) : refus du serveur, texte retiré, ou proposition affichée.
    const file = 'src/components/sequences/ai/AskAIMenu.tsx';
    const { source, all } = callOf(file, 'Sequence AI Draft', 'etape');
    assert.equal(all.length, 3, 'refus, texte retiré, proposition affichée');
    const draftAt = source.indexOf('const outcome = await draft(briefDraftRequestBody(');
    for (const call of all) {
      assert.ok(call.index > draftAt, `${call.text} après la réponse`);
      assert.match(call.text, /level: writing\?\.level/);
    }
    const refused = all.find((c) => c.text.includes('outcome.error.kind'));
    after(source, refused, "if (outcome.status === 'error') {");
    assert.ok(refused.index < source.indexOf("settle({ versionId, label, status: 'error', message });"));
    const withdrawn = all.find((c) => c.text.includes("'texte_retire'"));
    after(source, withdrawn, 'if (!picked || !picked.body.trim()) {');
    assert.ok(withdrawn.index < source.indexOf("message: briefRefusalMessage(picked?.toWrite ?? [])"));
    // « ok » : seulement après le contrôle du texte de l'étape, avant la proposition prête.
    const ok = all.find((c) => /result: 'ok'/.test(c.text));
    assert.ok(ok, "issue 'ok' introuvable");
    after(source, ok, 'if (!picked || !picked.body.trim()) {', "message: briefRefusalMessage(picked?.toWrite ?? []) });");
    const readyAt = source.search(/status: 'ready',\s*text: picked\.body,/);
    assert.ok(readyAt !== -1 && ok.index < readyAt, '« ok » avant la proposition prête');
  }
});

test('geste — candidats inscrits : nombre réellement inscrits, par écran', () => {
  {
    const file = 'src/components/outreach/EnrollmentPreviewModal.tsx';
    const { call } = callOf(file, 'Candidates Enrolled', 'preparation');
    assert.match(call.text, /count: results\.success/);
    assert.match(code(read(file)), /if \(results\.success > 0\) \{[^}]*?trackUsage\('Candidates Enrolled', \{ surface: 'preparation', count: results\.success \}\);/);
  }
  {
    const file = 'src/components/outreach/SequenceEnrollModal.tsx';
    const { source, call } = callOf(file, 'Candidates Enrolled', 'inscription');
    assert.match(call.text, /count: enrollmentResults\.success/);
    // Après le refus, l'échec et l'échec de planification de la première étape
    // (enrollCandidates : sinon les inscriptions sont retirées ou incomplètes).
    after(source, call, "if (outcome.status === 'refused') {", "if (outcome.status === 'failed') {", 'if (outcome.schedulingFailure) {');
    assert.match(code(source), /if \(enrollmentResults\.success > 0\) \{[^}]*trackUsage\('Candidates Enrolled', \{ surface: 'inscription'/);
  }
  {
    const file = 'src/components/outreach/BulkInMailModal.tsx';
    const { source, call } = callOf(file, 'Candidates Enrolled', 'inmail_groupe');
    assert.match(call.text, /count: queued/);
    after(source, call, "invokeEdgeFunction<{ queued?: number", 'if (queued === 0) {');
  }
});

test('geste — message rédigé par l’IA relu : compté à l’enregistrement d’une relecture, jamais le texte', () => {
  const file = 'src/components/outreach/activity-log/EditScheduledMessageModal.tsx';
  const { source, call } = callOf(file, 'AI Message Reviewed');
  after(source, call, ".eq('status', 'scheduled')", 'if (!updated || updated.length === 0) {', 'if (aiReview) {');
  assert.match(call.text, /source: proposalUsedRef\.current \? 'proposition_ia' : 'sans_proposition'/);
  // La proposition ne compte qu'une fois reçue, et repart de zéro à chaque message ouvert.
  assert.match(source, /setMessage\(proposal\.message\);[\s\S]{0,120}proposalUsedRef\.current = true;/);
  assert.match(source, /useEffect\(\(\) => \{\s*proposalUsedRef\.current = false;/);
});

test('geste — pause, arrêt et leur annulation : comptés sur le résultat du serveur ou de l’écriture', () => {
  const file = 'src/hooks/useUndoableEnrollmentAction.ts';
  const source = code(read(file));
  // Arrêt : inscriptions arrêtées rendues par stop_enrollments.
  const stopped = callOf(file, 'Enrollment Stopped').call;
  after(source, stopped, "action: 'stop_enrollments'", 'summary = summarizeStopResponse(payload, ids, options.candidateName);');
  assert.match(source, /if \(summary\.stoppedIds\.length > 0\) trackUsage\('Enrollment Stopped', \{ count: summary\.stoppedIds\.length \}\);/);
  // Annulation d'un arrêt : seulement sur une réponse acceptée, inscriptions dont l'arrêt est défait.
  const undoStop = callOf(file, 'Enrollment Undo', 'arret').call;
  after(source, undoStop, "action: 'undo_stop_enrollments'", 'if (error || data?.success !== true) {');
  assert.match(source, /if \(undone > 0\) trackUsage\('Enrollment Undo', \{ gesture: 'arret', count: undone \}\);/);
  // Pause : offerUndoPause n'est appelée qu'après une pause réussie, avec les inscriptions touchées.
  const paused = callOf(file, 'Enrollment Paused', 'candidats').call;
  after(source, paused, 'const offerUndoPause = useCallback(');
  assert.match(source, /if \(ids\.length > 0\) trackUsage\('Enrollment Paused', \{ scope: 'candidats', count: ids\.length \}\);/);
  // Annulation d'une pause : inscriptions reprises par resume_enrollments.
  const undoPause = callOf(file, 'Enrollment Undo', 'pause').call;
  after(source, undoPause, 'const result = await resumeEnrollmentIds(ids, orgRef.current);');
  assert.match(source, /if \(result\.counts\.resumed > 0\) trackUsage\('Enrollment Undo', \{ gesture: 'pause', count: result\.counts\.resumed \}\);/);
  // Pause de la séquence entière et son annulation (interrupteur, sequenceActions.ts).
  const actionsFile = 'src/lib/sequenceActions.ts';
  const actions = code(read(actionsFile));
  const seqPause = callOf(actionsFile, 'Enrollment Paused', 'sequence').call;
  after(actions, seqPause, ".update({ is_active: false })", 'if (seqError || !updated || updated.length === 0) {');
  const seqUndo = callOf(actionsFile, 'Enrollment Undo', 'pause_sequence').all;
  assert.equal(seqUndo.length, 2, 'annulation sans candidat et avec candidats repris');
  for (const call of seqUndo) after(actions, call, ".update({ is_active: true })", "toast.error(PAUSE_UNDO_FAILED_MESSAGE, {");
  // Toute pause manuelle passe par offerUndoPause : la mesure du crochet les couvre toutes.
  for (const caller of ['src/lib/sequenceActions.ts', 'src/hooks/useCandidateEnrollments.ts', 'src/components/outreach/inbox/MessageView.tsx']) {
    assert.match(code(read(caller)), /offerUndoPause\(\{/, `${caller} : pause annoncée par offerUndoPause`);
  }
});

test('geste — réponse proposée utilisée dans la messagerie : type de la suggestion, jamais son texte', () => {
  {
    const file = 'src/components/outreach/inbox/SmartReplies.tsx';
    const { source, call } = callOf(file, 'Reply Suggestion Used', 'bandeau');
    assert.match(call.text, /kind: s\.type/);
    after(source, call, 'onPick(s.text);');
  }
  {
    const file = 'src/components/outreach/inbox/InlineAIPanel.tsx';
    const { source, call } = callOf(file, 'Reply Suggestion Used', 'panneau');
    assert.match(call.text, /\{ kind, tone, place: 'panneau' \}/);
    after(source, call, 'onSuggestionSelect(text);');
    assert.match(source, /onInsert=\{\(text\) => insert\(text, s\.type, 'positive'\)\}/);
    assert.match(source, /onInsert=\{\(text\) => insert\(text, s\.type, 'negative'\)\}/);
    assert.match(source, /onClick=\{\(\) => insert\(q, 'question'\)\}/);
    assert.doesNotMatch(source, /onInsert=\{insert\}/, 'chaque insertion passe son type');
  }
});

test('geste — proposition de l’assistant approuvée ou rejetée : nom de l’outil, après la réponse acceptée', () => {
  {
    const file = 'src/components/agent/AgentToolApprovalCard.tsx';
    const { source, all } = callOf(file, 'Assistant Proposal');
    assert.equal(all.length, 3, 'approuver ou rejeter, approuver après modification, reprendre dans l’éditeur');
    const decided = all.find((c) => c.text.includes("'rejetee'"));
    after(source, decided, "{ execution_id: executionId, action },", 'if (error || !data?.success) {');
    assert.match(decided.text, /tool: toolName/);
    const edited = all.find((c) => c.text.includes("'approuvee_modifiee'"));
    after(source, edited, "console.warn('[AgentToolApprovalCard] approve after edit'");
    const reopened = all.find((c) => c.text.includes("'reprise_editeur'"));
    after(source, reopened, "console.warn('[AgentToolApprovalCard] open in editor'");
    // Chaque bouton passe le nom de l'outil de la ligne.
    assert.match(source, /handleAction\(row\.id, 'reject', row\.tool_name\)/);
    assert.match(source, /handleAction\(row\.id, 'approve', row\.tool_name\)/);
    assert.match(source, /handleAction\(confirmDialogId, 'approve', pending\.find\(\(p\) => p\.id === confirmDialogId\)\?\.tool_name\)/);
    assert.match(source, /handleSaveAndApprove\(row\.id, row\.tool_name\)/);
  }
  {
    const file = 'src/components/settings/AgentActionsSettings.tsx';
    const { source, all } = callOf(file, 'Assistant Proposal');
    assert.equal(all.length, 2, 'approuver ou rejeter, reprendre dans l’éditeur');
    for (const call of all) {
      assert.match(call.text, /tool: row\.tool_name/);
      assert.match(call.text, /surface: 'journal'/);
    }
    const decided = all.find((c) => c.text.includes("'rejetee'"));
    after(source, decided, "('agent-tool-action', { execution_id: row.id, action })", 'if (error || !data?.success) {');
    const reopened = all.find((c) => c.text.includes("'reprise_editeur'"));
    after(source, reopened, "action: 'reject', reason: PROPOSAL_EDITOR_NOTE");
  }
});
