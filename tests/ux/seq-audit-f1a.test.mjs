/**
 * Audit du module séquences (2026-09-25), lot F1a : éditeur de séquence.
 *
 * Deux sortes de contrôles :
 *  - lecture du code des composants (ce qui est proposé, ce qui est enregistré) ;
 *  - comportement des règles pures de src/components/outreach/sequence/sequenceGraph.ts,
 *    importé directement (Node lit le TypeScript sans compilation depuis la 22.18).
 *
 * Lancer : node --test tests/ux/seq-audit-f1a.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const builder = read('src/components/outreach/SequenceBuilder.tsx');
const stepEditor = read('src/components/outreach/sequence/StepEditor.tsx');
const visual = read('src/components/outreach/sequence/VisualSequenceEditor.tsx');
const canvas = read('src/components/outreach/sequence/WorkflowCanvas.tsx');
const checklist = read('src/components/outreach/sequence/SequenceValidationChecklist.tsx');
const inserter = read('src/components/outreach/sequence/VariableInserter.tsx');
const selector = read('src/components/outreach/SequenceTemplateSelector.tsx');
// Lot F1b (SEQ-146) : la liste de vérification et l'enregistrement lisent une
// seule fonction, validateSequence (sequenceGraph.ts). Les règles vérifiées
// ci-dessous y ont été déplacées.
const graphSrc = read('src/components/outreach/sequence/sequenceGraph.ts');
const verification = `${checklist}\n${graphSrc}`;

/** Extrait le corps d'une fonction déclarée `const nom = ... => {` jusqu'à `};` au même niveau. */
function body(src, start) {
  const i = src.indexOf(start);
  assert.ok(i !== -1, `introuvable : ${start}`);
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i);
}

let graphModule;
async function graph(t) {
  if (graphModule) return graphModule;
  try {
    graphModule = await import('../../src/components/outreach/sequence/sequenceGraph.ts');
    return graphModule;
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      t.skip('Node sans lecture native du TypeScript (22.18 ou plus requis)');
      return null;
    }
    throw err;
  }
}

const mk = (id, order, actionType = 'message', extra = {}) => ({
  id, order, actionType, conditionType: 'always',
  delayDays: 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18, useAiPersonalization: false,
  ...extra,
});

// ---------------------------------------------------------------- SEQ-015
test('SEQ-015 — « Terminer » au délai dépassé n’est plus proposé (liste et visuel)', () => {
  assert.doesNotMatch(builder, /value: 'end_sequence'/);
  assert.doesNotMatch(stepEditor, /value: 'end_sequence'/);
});

test('SEQ-015 — « Branchement » : plus proposé, plus de « Si faux », signalé', async (t) => {
  assert.doesNotMatch(stepEditor, />Si faux</, 'le « Si faux » n’était jamais enregistré');
  assert.match(visual, /TRIGGERS\.filter\(t => isStepTypeOffered\(t\.value\)\)/, 'le sélecteur du Visuel doit filtrer les types non pris en charge');
  assert.match(checklist, /validateSequence\(sequence\)/, 'la liste de vérification lit la vérification unique');
  assert.match(verification, /'condition_branch'/, 'la vérification doit signaler les Branchements existants');
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.isStepTypeOffered('condition_branch'), false);
  assert.match(g.unsupportedStepNotice('condition_branch'), /ne route rien/);
});

test('SEQ-015 — les modèles n’écrivent ni ne relisent plus timeout_action', () => {
  assert.doesNotMatch(selector, /timeout_action\s*:/, 'écrit dans steps_config alors qu’aucune colonne ne le porte');
  assert.doesNotMatch(selector, /\.timeout_action\b/, 'relu à l’instanciation d’un modèle');
});

// ---------------------------------------------------------------- SEQ-016
test('SEQ-016 — l’enregistrement bloque une branche vide ou un renvoi mort', async (t) => {
  assert.match(builder, /const errors: string\[\] = validateSequence\(sequence\)\.errors/);
  assert.match(body(graphSrc, 'export function validateSequence'), /validateStepGraph\(steps\)/);
  const g = await graph(t);
  if (!g) return;
  const oneBranch = g.validateStepGraph([mk('c', 0, 'check_connection', { ifTrueGotoStep: 'x' }), mk('x', 1)]);
  assert.equal(oneBranch.length, 1);
  assert.match(oneBranch[0], /^Étape 1 : la branche Non connecté est vide\. Ajoutez une étape ou choisissez Étape suivante pour les deux cas\.$/);
  // « Étape suivante » explicite pour les deux branches : accepté.
  assert.deepEqual(g.validateStepGraph([mk('c', 0, 'check_connection'), mk('x', 1)]), []);
  const dead = g.validateStepGraph([mk('c', 0, 'check_connection', { ifTrueGotoStep: 'x', ifFalseGotoStep: 'disparue' }), mk('x', 1)]);
  assert.ok(dead.some((e) => /n'existe plus/.test(e)));
});

test('SEQ-016 — supprimer une étape visée par une branche nettoie la référence (liste)', async (t) => {
  const removeStep = body(builder, 'const applyRemoveStep');
  assert.match(removeStep, /removeStepFromSequence\(prev\.steps, stepId\)/);
  const g = await graph(t);
  if (!g) return;
  const steps = [
    mk('c', 0, 'check_connection', { ifTrueGotoStep: 'm', ifFalseGotoStep: 'inv' }),
    mk('m', 1, 'smart_message'),
    mk('inv', 2, 'connection_request'),
  ];
  const after = g.removeStepFromSequence(steps, 'inv');
  const ids = new Set(after.map((s) => s.id));
  for (const s of after) {
    for (const ref of [s.ifTrueGotoStep, s.ifFalseGotoStep, s.nextStepId, s.timeoutBranchStepId]) {
      assert.ok(!ref || ids.has(ref), `référence morte vers ${ref}`);
    }
  }
  // La branche vidée est ensuite bloquée à l’enregistrement.
  assert.ok(g.validateStepGraph(after).some((e) => /branche Non connecté est vide/.test(e)));
});

// ---------------------------------------------------------------- SEQ-017
test('SEQ-017 — « Dupliquer une existante » garde branches, variantes et fin de séquence', async (t) => {
  const dup = body(selector, 'const handleDuplicate');
  assert.doesNotMatch(dup, /timeoutAction: 'skip'/, 'le délai dépassé était forcé à « Passer »');
  assert.doesNotMatch(dup, /crypto\.randomUUID\(\)/, 'de nouveaux ids sans remappage cassaient tous les renvois');
  assert.match(dup, /rowToSequenceStep/);
  const g = await graph(t);
  if (!g) return;
  const step = g.rowToSequenceStep({
    id: 'orig', step_order: 4, action_type: 'wait_connection',
    if_true_goto_step: 'a', if_false_goto_step: 'b', next_step_id: 'n', timeout_branch_step_id: 'tb',
    variant_group: 'B', variant_weight: 30, condition_type: 'if_score_above', condition_value: '70',
    wait_for_event: 'connection_accepted', timeout_days: 5, cc_emails: ['x@y.fr'], include_unsubscribe: true,
    signature_id: 'sig', ends_sequence: false,
  });
  assert.equal(step.id, 'orig', 'id d’origine gardé : la sauvegarde remappe elle-même les renvois');
  assert.equal(step.order, 4);
  assert.equal(step.ifTrueGotoStep, 'a');
  assert.equal(step.ifFalseGotoStep, 'b');
  assert.equal(step.nextStepId, 'n');
  assert.equal(step.timeoutBranchStepId, 'tb');
  assert.equal(step.timeoutAction, 'alternative_step');
  assert.equal(step.variantGroup, 'B');
  assert.equal(step.conditionValue, '70');
  assert.equal(step.includeUnsubscribe, true);
  assert.equal(g.rowToSequenceStep({ id: 'e', step_order: 0, action_type: 'message', ends_sequence: true, next_step_id: null }).nextStepId, '__end__');
});

// ---------------------------------------------------------------- SEQ-018
test('SEQ-018 — la suppression ne renumérote plus par position', () => {
  for (const src of [builder, visual]) {
    assert.doesNotMatch(src, /\.map\(\(s, idx\) => \(\{\s*\.\.\.s,\s*order: idx/);
  }
  assert.match(visual, /removeStepFromSequence\(steps, stepId\)/);
});

test('SEQ-018 — variantes : même ordre après suppression, parties avec l’étape A, orphelines visibles', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const steps = [
    mk('inv', 0, 'connection_request'),
    mk('a', 1, 'message', { variantGroup: 'A', variantWeight: 50 }),
    mk('rel', 2),
    mk('b', 1, 'message', { variantGroup: 'B', variantWeight: 50 }),
  ];
  const withoutInvite = g.removeStepFromSequence(steps, 'inv');
  const order = Object.fromEntries(withoutInvite.map((s) => [s.id, s.order]));
  assert.equal(order.a, order.b, 'A et B doivent rester sur le même ordre');
  assert.equal(order.rel, order.a + 1);
  assert.deepEqual(g.removeStepFromSequence(steps, 'a').map((s) => s.id).sort(), ['inv', 'rel']);
  // Une variante seule (données déjà abîmées) s’affiche et bloque l’enregistrement.
  const orphan = [mk('x', 0), mk('b', 1, 'message', { variantGroup: 'B' })];
  assert.deepEqual(g.getPrimarySteps(orphan).map((s) => s.id), ['x', 'b']);
  assert.ok(g.validateStepGraph(orphan).some((e) => /^Étape 2 : variante B sans étape A/.test(e)));
});

// ---------------------------------------------------------------- SEQ-019
test('SEQ-019 — les conditions d’arrêt affichées par défaut sont celles enregistrées', () => {
  assert.match(builder, /stopConditions: base\.stopConditions \?\? DEFAULT_STOP_CONDITIONS/);
  assert.match(builder, /const DEFAULT_STOP_CONDITIONS: StopConditions = \{ on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: false \}/);
});

// ---------------------------------------------------------------- SEQ-031
test('SEQ-031 — le Visuel crée ses attentes avec l’événement attendu', async (t) => {
  const create = body(visual, 'const createEmptyStep');
  assert.match(create, /waitForEvent: waitEventFor\(actionType\)/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.waitEventFor('wait_reply'), 'reply_received');
  assert.equal(g.waitEventFor('wait_connection'), 'connection_accepted');
  assert.equal(g.waitEventFor('message'), undefined);
});

// ---------------------------------------------------------------- SEQ-032
test('SEQ-032 — une étape ajoutée prend le plus grand ordre + 1, pas le nombre de lignes', async (t) => {
  assert.match(body(builder, 'const addStep'), /createEmptyStep\(nextStepOrder\(sequence\.steps\), actionType\)/);
  assert.match(body(visual, 'const handleAddStep'), /createEmptyStep\(nextStepOrder\(steps\), actionType\)/);
  assert.doesNotMatch(visual, /createEmptyStep\(steps\.length/);
  const g = await graph(t);
  if (!g) return;
  const ab = [mk('a', 0), mk('b', 1, 'message', { variantGroup: 'A' }), mk('c', 1, 'message', { variantGroup: 'B' })];
  assert.equal(g.nextStepOrder(ab), 2);
  assert.equal(g.nextStepOrder([]), 0);
});

// ---------------------------------------------------------------- SEQ-033
test('SEQ-033 — supprimer une étape chaînée relie son prédécesseur à la suivante', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const chain = [
    mk('v', 0, 'profile_visit', { nextStepId: 'i' }),
    mk('i', 1, 'connection_request', { nextStepId: 'w' }),
    mk('w', 2, 'wait_connection', { nextStepId: 'm', waitForEvent: 'connection_accepted', timeoutDays: 3 }),
    mk('m', 3, 'message', { nextStepId: 'r' }),
    mk('r', 4),
  ];
  const after = g.removeStepFromSequence(chain, 'w');
  assert.equal(after.find((s) => s.id === 'i').nextStepId, 'm');
  assert.deepEqual(g.findUnreachableSteps(after), []);
  // Ancien comportement (renvoi simplement effacé) : Message et Relance ne partaient jamais.
  const broken = chain.filter((s) => s.id !== 'w').map((s, idx) => ({ ...s, order: idx, nextStepId: s.nextStepId === 'w' ? undefined : s.nextStepId }));
  assert.deepEqual(g.findUnreachableSteps(broken).map((s) => s.id), ['m', 'r']);
});

test('SEQ-033 — ajout en liste chaîné, canevas et avertissement fidèles au moteur', async (t) => {
  assert.match(body(builder, 'const addStep'), /chainAfterLastMainStep\(prev\.steps, newStep\.id\)/);
  assert.match(canvas, /engineNextStepId\(step, steps\)/, 'le canevas doit dessiner les arêtes que suivra le moteur');
  assert.doesNotMatch(canvas, /const prev = mainSteps\[idx - 1\]/, 'les étapes principales étaient reliées par simple position');
  assert.match(body(builder, 'const computeSaveWarnings'), /findUnreachableSteps\(sequence\.steps\)/);
  const g = await graph(t);
  if (!g) return;
  const visualChain = [mk('v', 0, 'profile_visit', { nextStepId: 'i' }), mk('i', 1, 'connection_request')];
  const chained = g.chainAfterLastMainStep(visualChain, 'new');
  assert.equal(chained.find((s) => s.id === 'i').nextStepId, 'new');
  // Séquence linéaire (liste) : rien à chaîner, le moteur suit l’ordre.
  const linear = [mk('v', 0), mk('i', 1)];
  assert.equal(g.chainAfterLastMainStep(linear, 'new'), linear);
  assert.equal(g.engineNextStepId(visualChain[1], visualChain), null, 'étape visée sans suite : le moteur s’arrête');
});

// ---------------------------------------------------------------- SEQ-059
test('SEQ-059 — une étape déjà exécutée n’est pas supprimée sans explication', () => {
  const request = body(builder, 'const requestRemoveStep');
  assert.match(request, /\.from\('sequence_step_executions'\)/);
  assert.match(request, /\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(request, /\.in\('status', HISTORY_EXECUTION_STATUSES\)/);
  assert.match(request, /`Supprimer l'étape \$\{target\.order \+ 1\} \?`/);
  assert.match(request, /if \(error\) throw error;/, 'en cas d’échec de la vérification, rien n’est supprimé');
  assert.match(builder, /ne pourra pas être supprimée à l'enregistrement/);
  // Le Visuel passe par la même vérification.
  assert.equal((builder.match(/onRemoveStep=\{requestRemoveStep\}/g) || []).length, 2);
});

// ---------------------------------------------------------------- SEQ-060
test('SEQ-060 — les modèles gardent l’ordre des variantes et la fin de séquence', () => {
  const save = body(selector, 'const handleSave');
  assert.match(save, /step_order: s\.step_order/);
  assert.match(save, /ends_sequence: s\.ends_sequence \?\? false/);
  const select = body(selector, 'const handleSelectTemplate');
  assert.match(select, /order: typeof s\.step_order === 'number' \? s\.step_order : idx/);
  assert.match(select, /nextStepId: s\.ends_sequence \? '__end__' : remap\(/);
  assert.doesNotMatch(select, /order: idx,/);
});

// ---------------------------------------------------------------- SEQ-061
test('SEQ-061 — « Attendre visite retour » n’est plus proposé et reste signalé', async (t) => {
  assert.match(body(builder, 'const getAvailableStepTypes'), /if \(!isStepTypeOffered\(trigger\.value\)\) return false;/);
  assert.match(verification, /'wait_profile_visit'/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.isStepTypeOffered('wait_profile_visit'), false);
  assert.equal(g.unsupportedStepNotice('wait_profile_visit'), "Cette attente n'est pas prise en charge : l'étape suivante part sans attendre.");
  assert.equal(g.isStepTypeOffered('wait_reply'), true);
});

// ---------------------------------------------------------------- SEQ-063
test('SEQ-063 — le menu Variables ne propose que ce que le moteur remplit', async (t) => {
  for (const gone of ['{{city}}', '{{ai_snippet}}', '{{signature}}']) {
    assert.ok(!inserter.includes(gone), `${gone} encore proposé`);
  }
  assert.ok(!builder.includes('{{firstName}}'), 'modèle de variante avec une clé inconnue du moteur');
  assert.ok(!builder.includes('[snippet IA'), 'l’aperçu montrait une fausse valeur');
  assert.match(builder, /renderTemplatePreview\(step\.messageTemplate \|\| '', customValues\)/);
  const g = await graph(t);
  if (!g) return;
  // Chaque variable du menu est remplie par le moteur.
  const offered = [...inserter.matchAll(/code: '\{\{(\w+)\}\}'/g)].map((m) => m[1]);
  assert.ok(offered.length >= 4);
  for (const key of offered) assert.ok(g.SEQUENCE_TEMPLATE_KEYS.includes(key), `{{${key}}} inconnue du moteur`);
  // Et chaque clé déclarée connue est réellement posée par le moteur.
  const engine = read('supabase/functions/_shared/template-interpolation.ts');
  for (const key of g.SEQUENCE_TEMPLATE_KEYS) {
    assert.match(engine, new RegExp(`ctx\\.${key}\\s*=`), `le moteur ne pose pas ${key}`);
  }
  assert.deepEqual(
    g.findUnknownTemplateVariables('{{first_name}} {{city}} {{ ai_snippet }} {{signature}} {{client | fallback:"x"}} {{Prenom}} {{full_name}}'),
    ['{{city}}', '{{ai_snippet}}', '{{signature}}', '{{full_name}}'],
  );
  assert.equal(g.renderTemplatePreview('Basé à {{city}}'), "Basé à (vide à l'envoi)");
  assert.equal(g.renderTemplatePreview('{{lien_demo}}', { lien_demo: 'https://demo' }), 'https://demo');
});

test('SEQ-063 — alerte à l’enregistrement pour les variables inconnues', () => {
  const warnings = body(builder, 'const computeSaveWarnings');
  assert.match(warnings, /findUnknownTemplateVariables\(s\.messageTemplate, customKeys\)/);
  assert.match(builder, /Enregistrer malgré ces points \?/);
});

// ---------------------------------------------------------------- SEQ-065
test('SEQ-065 — « Message LinkedIn IA » annonce le repli en InMail payant', async (t) => {
  for (const src of [builder, visual]) {
    assert.match(src, /value: 'smart_message'[^\n]*description: 'Message IA, InMail si non connecté'/);
  }
  assert.match(builder, /SMART_MESSAGE_INMAIL_HELP/);
  assert.match(stepEditor, /SMART_MESSAGE_INMAIL_HELP/);
  assert.match(verification, /peuvent partir en InMail payant/);
  const g = await graph(t);
  if (!g) return;
  assert.match(g.SMART_MESSAGE_INMAIL_HELP, /InMail \(un crédit consommé\)/);
  const steps = [mk('a', 0, 'smart_message', { variantGroup: 'A' }), mk('b', 0, 'smart_message', { variantGroup: 'B' }), mk('c', 1, 'inmail'), mk('d', 2, 'message')];
  assert.equal(g.countInmailCapableSteps(steps), 2);
});

// ---------------------------------------------------------------- SEQ-067
test('SEQ-067 — E-mail et WhatsApp masqués tant que le moteur ne sait pas les envoyer', async (t) => {
  assert.match(body(builder, 'const getAvailableStepTypes'), /if \(!isStepTypeOffered\(action\.value\)\) return false;/);
  assert.match(visual, /ACTIONS\.filter\(a => isStepTypeOffered\(a\.value\)\)/);
  assert.ok(!builder.includes('seront automatiquement skippés'), 'l’alerte laissait croire que seuls les candidats sans adresse seraient sautés');
  assert.match(verification, /'email', 'whatsapp_message'/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.isStepTypeOffered('email'), false);
  assert.equal(g.isStepTypeOffered('whatsapp_message'), false);
  assert.equal(g.unsupportedStepNotice('email'), 'Les étapes e-mail ne partent pas encore : elles seront sautées pour tous les candidats.');
  assert.equal(g.isStepTypeOffered('connection_request'), true);
});

// ---------------------------------------------------------------- SEQ-068
test('SEQ-068 — un modèle ou une copie est une création, « Retour » demande en modification', () => {
  assert.match(builder, /const isEditing = !!initialSequence\?\.id;/);
  // Lot F1b (SEQ-231) : la clé du brouillon dépend de l'utilisateur et de l'organisation, lue si elle est connue.
  assert.match(builder, /const brouillonInitial = isEditing \? null : initialSequence \? null : (draftKey \? )?loadEditorDraft/);
  assert.doesNotMatch(builder, /onClick=\{onClose\}\s*\n\s*className="flex items-center gap-1\.5/, 'le bouton Retour fermait sans rien demander');
  const back = body(builder, 'const handleBack');
  assert.match(back, /isEditing && JSON\.stringify\(sequence\) !== etatInitialRef\.current/);
  assert.match(builder, /Quitter sans enregistrer \?/);
  assert.match(builder, /<AlertDialogCancel>Continuer la modification<\/AlertDialogCancel>/);
});

// ---------------------------------------------------------------- SEQ-069
test('SEQ-069 — « Si le délai est dépassé » reflète et efface l’étape de repli', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /value=\{effectiveTimeoutAction\(step\)\}/);
    assert.match(src, /timeoutActionUpdate\(value\)/);
  }
  assert.match(body(selector, 'const handleSelectTemplate'), /timeoutAction: remap\(s\.timeout_branch_step_id \|\| s\.timeoutBranchStepId\) \? 'alternative_step' : 'skip'/);
  const g = await graph(t);
  if (!g) return;
  const skip = g.timeoutActionUpdate('skip');
  assert.ok('timeoutBranchStepId' in skip && skip.timeoutBranchStepId === undefined, 'passer à « Passer » doit effacer la cible');
  assert.equal(g.effectiveTimeoutAction({ timeoutBranchStepId: 'x' }), 'alternative_step', 'une cible enregistrée est affichée comme telle');
  assert.equal(g.effectiveTimeoutAction({ timeoutAction: 'end_sequence' }), 'skip');
  assert.ok(g.validateStepGraph([mk('w', 0, 'wait_reply', { timeoutAction: 'alternative_step', timeoutDays: 3 })])
    .some((e) => /choisissez l'étape à exécuter si le délai est dépassé/.test(e)));
});
