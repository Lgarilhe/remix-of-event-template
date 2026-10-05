/**
 * Lot 5c-1 : règles pures de l'éditeur de séquence, sans les fichiers voués au
 * retrait du lot 5j.
 *
 * Copie des cas de seq-audit-f1a, f1b et f1d qui exécutent sequenceGraph.ts,
 * mêmes données et mêmes assertions, privés de leurs lectures de
 * SequenceBuilder, StepEditor, VisualSequenceEditor, WorkflowCanvas, nodes/,
 * SequenceValidationChecklist, VariableInserter et SequenceTemplateSelector.
 * Le lot 5j supprime ces trois fichiers de test : leurs cas sur les autres
 * modules gardés (conditionTypes.ts, messageTypeUtils.ts, useMultiSenderTeam.ts,
 * MultiSenderSettings.tsx, StopConditionsSettings.tsx, SaveAsTemplateModal.tsx)
 * sont copiés ici aussi, mêmes expressions, pour qu'aucune couverture ne se perde.
 *
 * Lancer : node --test tests/ux/seq-v2-graphe.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const graphSrc = read('src/components/outreach/sequence/sequenceGraph.ts');
const teamHook = read('src/components/outreach/sequence/useMultiSenderTeam.ts');
const multiSender = read('src/components/outreach/sequence/MultiSenderSettings.tsx');
const stopConditions = read('src/components/outreach/sequence/StopConditionsSettings.tsx');
const saveAsTemplate = read('src/components/outreach/SaveAsTemplateModal.tsx');

/** Fichiers retirés au lot 5j : ce test n'en lit ni n'en importe aucun. */
const RETIRED = [
  'SequenceBuilder', 'StepEditor', 'VisualSequenceEditor', 'WorkflowCanvas', 'sequence/nodes/', 'sequence/edges/',
  'SequenceWizardStepper', 'SequenceValidationChecklist', 'VariableInserter', 'SequenceTemplateSelector',
];

/**
 * Corps d'une fonction depuis `start` jusqu'à l'accolade fermante. `opener` :
 * texte qui précède l'accolade du corps, quand la signature en contient.
 */
function body(src, start, opener = '{') {
  const i = src.indexOf(start);
  assert.ok(i !== -1, `introuvable : ${start}`);
  const k = src.indexOf(opener, i);
  assert.ok(k !== -1, `ouverture introuvable après : ${start}`);
  let depth = 0;
  for (let j = k + opener.length - 1; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i);
}

async function load(t, rel) {
  try {
    return await import(`../../${rel}`);
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      t.skip('Node sans lecture native du TypeScript (22.18 ou plus requis)');
      return null;
    }
    throw err;
  }
}
const graph = (t) => load(t, 'src/components/outreach/sequence/sequenceGraph.ts');
const conditions = (t) => load(t, 'src/components/outreach/sequence/conditionTypes.ts');
const messageTypes = (t) => load(t, 'src/components/outreach/sequence/messageTypeUtils.ts');

// Données de seq-audit-f1a.
const mkA = (id, order, actionType = 'message', extra = {}) => ({
  id, order, actionType, conditionType: 'always',
  delayDays: 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18, useAiPersonalization: false,
  ...extra,
});

// Données de seq-audit-f1b.
const mkB = (id, order, actionType = 'message', extra = {}) => ({
  id, order, actionType, conditionType: 'always',
  delayDays: 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18, useAiPersonalization: false,
  messageTemplate: 'Bonjour {{first_name}}', subjectTemplate: '',
  ...extra,
});
const seqB = (steps, extra = {}) => ({ name: 'Test', steps, multiSenderEnabled: false, senderAccounts: [], ...extra });

/** Séquence recommandée de l'éditeur, réduite : vérification, deux branches, repli au délai dépassé. */
function recommended() {
  return [
    mkB('visit', 0, 'profile_visit', { messageTemplate: '' }),
    mkB('check', 1, 'check_connection', { ifTrueGotoStep: 't1', ifFalseGotoStep: 'inv', messageTemplate: '' }),
    mkB('t1', 2, 'smart_message', { nextStepId: 't2', useAiPersonalization: true }),
    mkB('t2', 3, 'wait_reply', { nextStepId: 't3', timeoutDays: 3, waitForEvent: 'reply_received' }),
    mkB('t3', 4, 'smart_message', { useAiPersonalization: true }),
    mkB('inv', 5, 'connection_request', { nextStepId: 'wc', messageTemplate: '' }),
    mkB('wc', 6, 'wait_connection', { nextStepId: 'f1', timeoutDays: 3, timeoutBranchStepId: 'im', waitForEvent: 'connection_accepted' }),
    mkB('f1', 7, 'smart_message', { nextStepId: 'f2', useAiPersonalization: true }),
    mkB('f2', 8, 'wait_reply', { nextStepId: 'f3', timeoutDays: 3, waitForEvent: 'reply_received' }),
    mkB('f3', 9, 'smart_message', { useAiPersonalization: true }),
    mkB('im', 10, 'inmail', { useAiPersonalization: true }),
  ];
}

// Données de seq-audit-f1d.
const mkD = (id, order, extra = {}) => ({
  id, order, actionType: 'message', conditionType: 'always',
  delayDays: order === 0 ? 0 : 2, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18,
  messageTemplate: 'Bonjour', useAiPersonalization: false,
  ...extra,
});
const sender = (account_id, extra = {}) => ({ account_id, daily_limit: 50, channel: 'linkedin', ...extra });
const seqD = (senderAccounts, multiSenderEnabled = true) => ({
  name: 'Rotation', steps: [mkD('a', 0)], multiSenderEnabled, senderAccounts,
});

test('ce test ne lit ni n’importe aucun fichier retiré au lot 5j', () => {
  const self = readFileSync(new URL(import.meta.url), 'utf8');
  const targets = [...self.matchAll(/\b(?:read|load|import)\((?:t, )?'([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(targets.length >= 7, 'lectures du test introuvables');
  for (const rel of targets) {
    for (const name of RETIRED) assert.ok(!rel.includes(name), `${rel} est retiré au lot 5j`);
  }
});

// ================================================================ seq-audit-f1a

test('SEQ-015 — « Branchement » : plus proposé, signalé (f1a)', async (t) => {
  assert.match(graphSrc, /'condition_branch'/, 'la vérification doit signaler les Branchements existants');
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.isStepTypeOffered('condition_branch'), false);
  assert.match(g.unsupportedStepNotice('condition_branch'), /ne route rien/);
});

test('SEQ-016 — l’enregistrement bloque une branche vide ou un renvoi mort (f1a)', async (t) => {
  assert.match(body(graphSrc, 'export function validateSequence'), /validateStepGraph\(steps\)/);
  const g = await graph(t);
  if (!g) return;
  const oneBranch = g.validateStepGraph([mkA('c', 0, 'check_connection', { ifTrueGotoStep: 'x' }), mkA('x', 1)]);
  assert.equal(oneBranch.length, 1);
  assert.match(oneBranch[0], /^Étape 1 : la branche Non connecté est vide\. Ajoutez une étape ou choisissez Étape suivante pour les deux cas\.$/);
  // « Étape suivante » explicite pour les deux branches : accepté.
  assert.deepEqual(g.validateStepGraph([mkA('c', 0, 'check_connection'), mkA('x', 1)]), []);
  const dead = g.validateStepGraph([mkA('c', 0, 'check_connection', { ifTrueGotoStep: 'x', ifFalseGotoStep: 'disparue' }), mkA('x', 1)]);
  assert.ok(dead.some((e) => /n'existe plus/.test(e)));
});

test('SEQ-016 — supprimer une étape visée par une branche nettoie la référence (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const steps = [
    mkA('c', 0, 'check_connection', { ifTrueGotoStep: 'm', ifFalseGotoStep: 'inv' }),
    mkA('m', 1, 'smart_message'),
    mkA('inv', 2, 'connection_request'),
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

test('SEQ-017 — la lecture d’une étape garde branches, variantes et fin de séquence (f1a)', async (t) => {
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

test('SEQ-018 — variantes : même ordre après suppression, parties avec l’étape A, orphelines visibles (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const steps = [
    mkA('inv', 0, 'connection_request'),
    mkA('a', 1, 'message', { variantGroup: 'A', variantWeight: 50 }),
    mkA('rel', 2),
    mkA('b', 1, 'message', { variantGroup: 'B', variantWeight: 50 }),
  ];
  const withoutInvite = g.removeStepFromSequence(steps, 'inv');
  const order = Object.fromEntries(withoutInvite.map((s) => [s.id, s.order]));
  assert.equal(order.a, order.b, 'A et B doivent rester sur le même ordre');
  assert.equal(order.rel, order.a + 1);
  assert.deepEqual(g.removeStepFromSequence(steps, 'a').map((s) => s.id).sort(), ['inv', 'rel']);
  // Une variante seule (données déjà abîmées) s’affiche et bloque l’enregistrement.
  const orphan = [mkA('x', 0), mkA('b', 1, 'message', { variantGroup: 'B' })];
  assert.deepEqual(g.getPrimarySteps(orphan).map((s) => s.id), ['x', 'b']);
  assert.ok(g.validateStepGraph(orphan).some((e) => /^Étape 2 : variante B sans étape A/.test(e)));
});

test('SEQ-031 — une attente porte l’événement attendu (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.waitEventFor('wait_reply'), 'reply_received');
  assert.equal(g.waitEventFor('wait_connection'), 'connection_accepted');
  assert.equal(g.waitEventFor('message'), undefined);
});

test('SEQ-032 — une étape ajoutée prend le plus grand ordre + 1, pas le nombre de lignes (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const ab = [mkA('a', 0), mkA('b', 1, 'message', { variantGroup: 'A' }), mkA('c', 1, 'message', { variantGroup: 'B' })];
  assert.equal(g.nextStepOrder(ab), 2);
  assert.equal(g.nextStepOrder([]), 0);
});

test('SEQ-033 — supprimer une étape chaînée relie son prédécesseur à la suivante (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const chain = [
    mkA('v', 0, 'profile_visit', { nextStepId: 'i' }),
    mkA('i', 1, 'connection_request', { nextStepId: 'w' }),
    mkA('w', 2, 'wait_connection', { nextStepId: 'm', waitForEvent: 'connection_accepted', timeoutDays: 3 }),
    mkA('m', 3, 'message', { nextStepId: 'r' }),
    mkA('r', 4),
  ];
  const after = g.removeStepFromSequence(chain, 'w');
  assert.equal(after.find((s) => s.id === 'i').nextStepId, 'm');
  assert.deepEqual(g.findUnreachableSteps(after), []);
  // Ancien comportement (renvoi simplement effacé) : Message et Relance ne partaient jamais.
  const broken = chain.filter((s) => s.id !== 'w').map((s, idx) => ({ ...s, order: idx, nextStepId: s.nextStepId === 'w' ? undefined : s.nextStepId }));
  assert.deepEqual(g.findUnreachableSteps(broken).map((s) => s.id), ['m', 'r']);
});

test('SEQ-033 — ajout chaîné et suite fidèles au moteur (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const visualChain = [mkA('v', 0, 'profile_visit', { nextStepId: 'i' }), mkA('i', 1, 'connection_request')];
  const chained = g.chainAfterLastMainStep(visualChain, 'new');
  assert.equal(chained.find((s) => s.id === 'i').nextStepId, 'new');
  // Séquence linéaire (liste) : rien à chaîner, le moteur suit l’ordre.
  const linear = [mkA('v', 0), mkA('i', 1)];
  assert.equal(g.chainAfterLastMainStep(linear, 'new'), linear);
  assert.equal(g.engineNextStepId(visualChain[1], visualChain), null, 'étape visée sans suite : le moteur s’arrête');
});

test('SEQ-061 — « Attendre visite retour » n’est plus proposé et reste signalé (f1a)', async (t) => {
  assert.match(graphSrc, /'wait_profile_visit'/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.isStepTypeOffered('wait_profile_visit'), false);
  assert.equal(g.unsupportedStepNotice('wait_profile_visit'), "Cette attente n'est pas prise en charge : l'étape suivante part sans attendre.");
  assert.equal(g.isStepTypeOffered('wait_reply'), true);
});

test('SEQ-063 — variables : seulement celles que le moteur remplit (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  // Chaque clé déclarée connue est réellement posée par le moteur.
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

test('SEQ-065 — « Message LinkedIn IA » annonce le repli en InMail payant (f1a)', async (t) => {
  assert.match(graphSrc, /peuvent partir en InMail payant/);
  const g = await graph(t);
  if (!g) return;
  assert.match(g.SMART_MESSAGE_INMAIL_HELP, /InMail \(un crédit consommé\)/);
  const steps = [mkA('a', 0, 'smart_message', { variantGroup: 'A' }), mkA('b', 0, 'smart_message', { variantGroup: 'B' }), mkA('c', 1, 'inmail'), mkA('d', 2, 'message')];
  assert.equal(g.countInmailCapableSteps(steps), 2);
});

test('SEQ-067 — E-mail et WhatsApp masqués tant que le moteur ne sait pas les envoyer (f1a)', async (t) => {
  assert.match(graphSrc, /'email', 'whatsapp_message'/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.isStepTypeOffered('email'), false);
  assert.equal(g.isStepTypeOffered('whatsapp_message'), false);
  assert.equal(g.unsupportedStepNotice('email'), 'Les étapes e-mail ne partent pas encore : elles seront sautées pour tous les candidats.');
  assert.equal(g.isStepTypeOffered('connection_request'), true);
});

test('SEQ-069 — « Si le délai est dépassé » reflète et efface l’étape de repli (f1a)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const skip = g.timeoutActionUpdate('skip');
  assert.ok('timeoutBranchStepId' in skip && skip.timeoutBranchStepId === undefined, 'passer à « Passer » doit effacer la cible');
  assert.equal(g.effectiveTimeoutAction({ timeoutBranchStepId: 'x' }), 'alternative_step', 'une cible enregistrée est affichée comme telle');
  assert.equal(g.effectiveTimeoutAction({ timeoutAction: 'end_sequence' }), 'skip');
  assert.ok(g.validateStepGraph([mkA('w', 0, 'wait_reply', { timeoutAction: 'alternative_step', timeoutDays: 3 })])
    .some((e) => /choisissez l'étape à exécuter si le délai est dépassé/.test(e)));
});

// ================================================================ seq-audit-f1b

test('SEQ-089 — réponse et désinscription toujours vraies dans l’objet écrit (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const fixed = g.withAlwaysOnStops({ on_reply: false, on_click: true, on_unsubscribe: false, on_meeting_booked: false });
  assert.deepEqual(fixed, { on_reply: true, on_click: true, on_unsubscribe: true, on_meeting_booked: false });
});

test('SEQ-093 — Message IA : objet saisi et exigé hors personnalisation IA (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.stepNeedsSubject('smart_message'), true);
  assert.equal(g.stepNeedsSubject('inmail'), true);
  assert.equal(g.stepNeedsSubject('message'), false);
  const manual = g.validateSequence(seqB([mkB('a', 0, 'smart_message')]));
  assert.ok(manual.errors.some((e) => e.check === 'subjects' && /il sert si le message part en InMail/.test(e.message)));
  const ai = g.validateSequence(seqB([mkB('a', 0, 'smart_message', { useAiPersonalization: true, messageTemplate: '' })]));
  assert.deepEqual(ai.errors, []);
});

test('SEQ-094 — plus de personnalisation IA pour l’invitation (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.stepAllowsAi('connection_request'), false);
  assert.equal(g.stepAllowsAi('smart_message'), true);
  const [invite, msg] = g.withoutInvitationAi([
    mkB('i', 0, 'connection_request', { useAiPersonalization: true }),
    mkB('m', 1, 'smart_message', { useAiPersonalization: true }),
  ]);
  assert.equal(invite.useAiPersonalization, false);
  assert.equal(msg.useAiPersonalization, true);
});

test('SEQ-095 — type de message affiché : note d’invitation, relances en Liste, InMail selon la branche (f1b)', async (t) => {
  const m = await messageTypes(t);
  if (!m) return;
  const withNote = m.getStepMessageType(mkB('i', 0, 'connection_request', { messageTemplate: 'Bonjour' }), []);
  const noNote = m.getStepMessageType(mkB('i', 0, 'connection_request', { messageTemplate: '' }), []);
  assert.equal(withNote.label, 'Invitation avec note');
  assert.equal(noNote.label, 'Invitation sans note');

  // Séquence construite en mode Liste : aucun renvoi, l'ordre fait le parcours.
  const linear = [mkB('a', 0), mkB('b', 1), mkB('c', 2)];
  assert.equal(m.getStepMessageType(linear[0], linear).shortLabel, 'Premier message');
  assert.equal(m.getStepMessageType(linear[1], linear).shortLabel, 'Relance 1');
  assert.equal(m.getStepMessageType(linear[2], linear).shortLabel, 'Relance 2');

  const steps = recommended();
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  // Branche « connecté » : message direct, pas un InMail.
  assert.equal(m.getStepMessageType(byId.t1, steps).shortLabel, 'Premier message');
  assert.equal(m.getStepMessageType(byId.t3, steps).shortLabel, 'Relance 1');
  // Invitation acceptée : suite d'invitation.
  assert.equal(m.getStepMessageType(byId.f1, steps).shortLabel, 'Après connexion');
  // Délai de l'attente dépassé : InMail.
  assert.equal(m.getStepMessageType(byId.im, steps).shortLabel, 'Premier InMail');
  // Sans relation garantie, un Message IA annonce son repli.
  assert.match(m.getStepMessageType(mkB('x', 0, 'smart_message'), [mkB('x', 0, 'smart_message')]).label, /InMail si non connecté/);
});

test('SEQ-106 — ouverture et clic annoncés comme indicatifs (f1b)', async (t) => {
  const c = await conditions(t);
  if (!c) return;
  assert.equal(c.engagementConditionHint('if_email_opened'), "L'ouverture est indicative : certaines messageries ouvrent les e-mails automatiquement.");
  assert.match(c.engagementConditionHint('if_link_clicked'), /indicatif/);
  assert.equal(c.engagementConditionHint('always'), null);
});

test('SEQ-107 — « Si l’e-mail est revenu en erreur » retirée et signalée sur les étapes existantes (f1b)', async (t) => {
  const c = await conditions(t);
  if (!c) return;
  assert.ok(!c.getConditionsForActionType('email').some((x) => x.value === 'if_bounced'), 'plus proposée');
  assert.ok(c.getConditionsForActionType('email', 'if_bounced').some((x) => x.value === 'if_bounced'), 'une étape existante l’affiche');
  const g = await graph(t);
  if (!g) return;
  const v = g.validateSequence(seqB([mkB('e', 0, 'email', { conditionType: 'if_bounced', subjectTemplate: 'Objet' })]));
  assert.ok(v.warnings.some((w) => w.check === 'retired_condition' && /n'est jamais vraie/.test(w.message)));
});

test('SEQ-146 — une seule vérification : poids A/B, plage d’envoi, seuil (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const abc = [
    mkB('a', 0, 'message', { variantGroup: 'A', variantWeight: 25 }),
    mkB('b', 0, 'message', { variantGroup: 'B', variantWeight: 25 }),
    mkB('c', 0, 'message', { variantGroup: 'C', variantWeight: 25 }),
  ];
  assert.ok(g.validateSequence(seqB(abc)).errors.some((e) => e.check === 'ab_weights' && /75 %/.test(e.message)));
  const window = g.validateSequence(seqB([mkB('w', 0, 'message', { preferredHourStart: 18, preferredHourEnd: 9 })]));
  assert.ok(window.errors.some((e) => e.check === 'send_window'));
  const score = g.validateSequence(seqB([mkB('s', 0, 'message', { conditionType: 'if_score_above' })]));
  assert.ok(score.errors.some((e) => e.check === 'score'));
  assert.deepEqual(g.validateSequence(seqB(recommended())).errors, []);
});

test('SEQ-147 — délais en heures visibles (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.formatStepDelay({ delayDays: 0, delayHours: 4, delayMinutes: 0 }), '4 h');
  assert.equal(g.formatStepDelay({ delayDays: 2, delayHours: 0, delayMinutes: 30 }), '2 j 30 min');
  assert.equal(g.formatStepDelay({ delayDays: 0, delayHours: 0, delayMinutes: 0 }), '');
});

test('SEQ-148 — invitation sans note acceptée, limite de 300 caractères gardée (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.stepRequiresMessage('connection_request'), false);
  assert.deepEqual(g.validateSequence(seqB([mkB('i', 0, 'connection_request', { messageTemplate: '' })])).errors, []);
  const long = g.validateSequence(seqB([mkB('i', 0, 'connection_request', { messageTemplate: 'x'.repeat(301) })]));
  assert.ok(long.errors.some((e) => e.check === 'invite_length'));
});

test('SEQ-152 — la dernière étape se supprime (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.deepEqual(g.removeStepFromSequence([mkB('seul', 0)], 'seul'), []);
});

test('SEQ-156 — rotation : libellé et canal recopiés (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const [copy] = g.asSenderAccounts([{ account_id: 'acc', daily_limit: 40, label: 'Théo Martin', channel: 'linkedin' }]);
  assert.equal(copy.label, 'Théo Martin');
  assert.equal(copy.channel, 'linkedin');
});

test('SEQ-157 — branche de chaque étape lisible (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const badges = g.branchBadgesByStep(recommended());
  assert.deepEqual(badges.get('t3'), ['Si connecté']);
  assert.deepEqual(badges.get('f3'), ['Si non connecté']);
  assert.deepEqual(badges.get('im'), ['Si délai dépassé', 'Si non connecté']);
  assert.deepEqual(badges.get('visit'), []);
  // Branches qui se rejoignent : pas de badge sur l'étape commune.
  const merge = [
    mkB('c', 0, 'check_connection', { ifTrueGotoStep: 'a', ifFalseGotoStep: 'b' }),
    mkB('a', 1, 'message', { nextStepId: 'z' }),
    mkB('b', 2, 'inmail', { nextStepId: 'z', subjectTemplate: 'Objet' }),
    mkB('z', 3),
  ];
  assert.deepEqual(g.branchBadgesByStep(merge).get('z'), []);
});

test('SEQ-160 — étape de repli limitée aux étapes suivantes (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const steps = [mkB('m', 0), mkB('w', 1, 'wait_reply', { timeoutDays: 3, timeoutBranchStepId: 'm' }), mkB('r', 2)];
  assert.deepEqual(g.timeoutTargetOptions(steps[1], steps).map((s) => s.id), ['r']);
  assert.equal(g.hasBackwardTimeoutTarget(steps[1], steps), true);
  assert.ok(g.validateSequence(seqB(steps)).errors.some((e) => e.check === 'timeout_target'));
});

test('SEQ-231 — brouillon rangé par utilisateur et par organisation (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.sequenceDraftKey('u1', 'o1'), 'sequence-new:u1:o1');
  assert.equal(g.sequenceDraftKey('u1', null), null);
  assert.equal(g.sequenceDraftKey(undefined, 'o1'), null);
});

test('SEQ-233 — troisième variante : 34 / 33 / 33 (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const two = g.addVariantToSteps([mkB('a', 0)], 'a', 'b');
  assert.deepEqual(two.map((s) => [s.id, s.variantGroup, s.variantWeight]), [['a', 'A', 50], ['b', 'B', 50]]);
  const three = g.addVariantToSteps(two, 'a', 'c');
  assert.deepEqual(three.map((s) => [s.variantGroup, s.variantWeight]), [['A', 34], ['B', 33], ['C', 33]]);
  assert.equal(three.reduce((sum, s) => sum + s.variantWeight, 0), 100);
  assert.equal(g.addVariantToSteps(three, 'a', 'd'), three, 'pas de quatrième variante');
});

test('SEQ-234 — délais avec point de départ, week-ends et heures ouvrées annoncés (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.delaySentence({ delayDays: 2, delayHours: 0, delayMinutes: 0 }), "Attendre 2 jours après l'étape précédente.");
  assert.equal(g.delaySentence({ delayDays: 1, delayHours: 4, delayMinutes: 0 }), "Attendre 1 jour et 4 heures après l'étape précédente.");
  assert.equal(g.SEND_WINDOW_HELP, "Envois en semaine uniquement, dans votre fuseau horaire, et dans les heures ouvrées de l'expéditeur.");
});

test('SEQ-245 — un nom par type d’étape (f1b)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.STEP_TYPE_LABELS.smart_message, 'Message IA');
  assert.equal(g.STEP_TYPE_LABELS.email, 'E-mail');
});

// ================================================================ seq-audit-f1d

test('front-editor-list-3 — rotation sans aucun compte relié à l’équipe : bloquant, à l’étape Expéditeurs (f1d)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const mine = new Set(['acc-mine']);
  // Pool copié d'une autre organisation : libellés présents, aucun compte relié.
  const copied = g.validateSequence(seqD([sender('acc-client-1', { label: 'Théo' }), sender('acc-client-2', { label: 'Léa' })]), mine);
  const blocker = copied.errors.find((e) => e.check === 'sender_pool');
  assert.ok(blocker, 'un pool sans compte relié doit bloquer l’enregistrement');
  assert.equal(blocker.area, 'senders');
  assert.match(blocker.message, /Aucun expéditeur n'est relié à un membre de votre équipe/);
  assert.match(blocker.message, /désactivez « Plusieurs expéditeurs »/);
  // Un compte e-mail hérité n'est pas un compte LinkedIn relié : même blocage.
  assert.ok(g.validateSequence(seqD([{ account_id: 'mail-1', email: 'x@y.fr', daily_limit: 50 }]), mine)
    .errors.some((e) => e.check === 'sender_pool'));
});

test('front-editor-list-3 — équipe inconnue, rotation coupée ou pool relié : pas de blocage (f1d)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const mine = new Set(['acc-mine']);
  const pool = [sender('acc-client', { label: 'Théo' })];
  // Équipe pas encore lue (ou lecture en échec) : on ne bloque pas à l'aveugle.
  assert.deepEqual(g.validateSequence(seqD(pool)).errors, []);
  assert.deepEqual(g.validateSequence(seqD(pool), null).errors, []);
  // Rotation désactivée : le pool n'est pas utilisé.
  assert.deepEqual(g.validateSequence(seqD(pool, false), mine).errors, []);
  // Pool vide : les envois partent du compte de chaque inscription (inchangé).
  assert.deepEqual(g.validateSequence(seqD([]), mine).errors, []);
  // Tous reliés : ni blocage ni avertissement d'expéditeur retiré.
  const ok = g.validateSequence(seqD([sender('acc-mine', { label: 'Moi' })]), mine);
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some((w) => /plus relié/.test(w.message)));
});

test('front-editor-list-3 — une partie du pool n’est plus reliée : recommandation « Retirez-le » (f1d)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  const v = g.validateSequence(seqD([sender('acc-mine'), sender('acc-parti', { label: 'Ancien' })]), new Set(['acc-mine']));
  assert.deepEqual(v.errors, []);
  const w = v.warnings.find((x) => x.check === 'senders' && /plus relié/.test(x.message));
  assert.ok(w);
  assert.equal(w.message, "1 expéditeur n'est plus relié à un membre de l'équipe : la rotation ne l'utilise pas. Retirez-le.");
  const two = g.validateSequence(seqD([sender('acc-mine'), sender('b'), sender('c')]), new Set(['acc-mine']));
  assert.ok(two.warnings.some((x) => /^2 expéditeurs ne sont plus reliés/.test(x.message)));
});

test('front-editor-list-3 — linkedSenderIdsOf ne garde que les comptes LinkedIn reliés (f1d)', async (t) => {
  let mod;
  try {
    mod = await import('../../src/components/outreach/sequence/useMultiSenderTeam.ts');
  } catch {
    // Le module importe le client Supabase (alias @/) : non chargeable sous Node.
    const fn = body(teamHook, 'export function linkedSenderIdsOf', ': Set<string> {');
    assert.match(fn, /members\.map\(m => m\.linkedInAccountId\)\.filter\(\(id\): id is string => !!id\)/);
    return;
  }
  assert.deepEqual([...mod.linkedSenderIdsOf([{ linkedInAccountId: 'a' }, { linkedInAccountId: null }])], ['a']);
  t.diagnostic('module chargé directement');
});

test('front-editor-list-12 — une étape est numérotée d’après son ordre (f1d)', async (t) => {
  const g = await graph(t);
  if (!g) return;
  // Variante B ajoutée en fin de tableau, avec l'ordre de A : « Étape 5 (B) » partout.
  assert.equal(g.stepLabel(mkD('b', 4, { variantGroup: 'B' })), 'Étape 5 (B)');
  assert.equal(g.stepLabel(mkD('a', 0)), 'Étape 1');
});

// ================================================ modules gardés lus en texte

test('SEQ-015 — les modèles n’écrivent ni ne relisent plus timeout_action (f1a, SaveAsTemplateModal)', () => {
  assert.doesNotMatch(saveAsTemplate, /timeout_action\s*:/, 'écrit dans steps_config alors qu’aucune colonne ne le porte');
  assert.doesNotMatch(saveAsTemplate, /\.timeout_action\b/, 'relu à l’instanciation d’un modèle');
});

test('SEQ-060 — les modèles gardent l’ordre des variantes et la fin de séquence (f1a, SaveAsTemplateModal)', () => {
  const save = body(saveAsTemplate, 'const handleSave');
  assert.match(save, /step_order: s\.step_order/);
  assert.match(save, /ends_sequence: s\.ends_sequence \?\? false/);
});

test('SEQ-089 — réponse et désinscription : ligne fixe (f1b, StopConditionsSettings)', () => {
  assert.doesNotMatch(stopConditions, /key: 'on_reply'/, 'l’interrupteur « répond » était sans effet');
  assert.doesNotMatch(stopConditions, /key: 'on_unsubscribe'/, 'couper « se désinscrit » laissait partir les étapes LinkedIn');
  assert.match(stopConditions, /La séquence s'arrête toujours quand le candidat répond ou se désinscrit\./);
  assert.match(stopConditions, /onChange\(\{ \.\.\.value, on_reply: true, on_unsubscribe: true, \[item\.key\]: checked \}\)/);
});

test('SEQ-155 — le chiffre par expéditeur n’est plus présenté comme un plafond d’envoi (f1b, MultiSenderSettings)', () => {
  assert.doesNotMatch(multiSender, /actions\/jour/);
  assert.match(multiSender, /Plus de nouveaux candidats au-delà de/);
  assert.match(multiSender, /Les plafonds d'envoi LinkedIn restent ceux du compte \(Paramètres, Équipe\)\./);
});

test('SEQ-156 — rotation réservée aux comptes LinkedIn, libellé et canal enregistrés (f1b, MultiSenderSettings)', () => {
  const select = body(multiSender, 'const handleSelectMember');
  assert.match(select, /const accountId = member\.linkedInAccountId;/);
  assert.doesNotMatch(select, /emailAccountId/);
  assert.match(select, /channel: 'linkedin'/);
  assert.match(select, /label: senderLabelFor\(member\)/);
  assert.match(multiSender, /`LinkedIn · \$\{sender\.label\}`/);
  assert.doesNotMatch(multiSender, /opacity-0 group-hover:opacity-100/, 'bouton de retrait invisible au toucher');
});

test('SEQ-245 — vocabulaire des réglages : sans jargon ni tutoiement (f1b, MultiSenderSettings et StopConditionsSettings)', () => {
  for (const gone of ["'TRIGGER'", '>Multi-sender<', 'Round-robin', 'meeting est booké', 'Ajouter un sender', 'Séquence complète !', "'trigger'"]) {
    for (const [name, src] of Object.entries({ multiSender, stopConditions })) {
      assert.ok(!src.includes(gone), `${gone} encore présent dans ${name}`);
    }
  }
});

test('front-editor-list-3 — la liste des expéditeurs vérifie chaque compte contre l’équipe, libellé ou pas (f1d)', () => {
  const describe = body(multiSender, 'const describeSender', '=> {');
  // Le libellé ne suffit plus à déclarer l'expéditeur valide.
  assert.doesNotMatch(describe, /if \(sender\.label\) return \{ title: `LinkedIn · \$\{sender\.label\}`, kind: 'linkedin' \}/);
  const lookup = describe.indexOf('teamMembers.find(m => m.linkedInAccountId === sender.account_id)');
  const labelOnly = describe.indexOf("if (sender.label) return { title: `LinkedIn · ${sender.label}`, kind: 'unknown' };");
  const pending = describe.indexOf("if (!isSuccess) return");
  assert.ok(lookup !== -1 && pending !== -1 && labelOnly !== -1);
  assert.ok(lookup < pending && pending < labelOnly, 'équipe consultée d’abord, « à retirer » seulement une fois l’équipe lue');
  // Équipe chargée dès que la rotation est active (plus seulement sans libellé).
  assert.match(multiSender, /useMultiSenderTeam\(showPickerModal \|\| enabled\)/);
  assert.doesNotMatch(multiSender, /senderAccounts\.some\(s => !s\.label\)/);
  assert.match(teamHook, /enabled: !!organizationId && active,/);
  // Liaisons illisibles : équipe inconnue, pas de faux « Retirez-le ».
  assert.match(teamHook, /if \(linkedInRes\.error\) throw linkedInRes\.error;/);
  assert.match(multiSender, /unknown: 'Ce compte n\\'est plus relié à un membre de l\\'équipe : la rotation ne l\\'utilise pas\. Retirez-le\.'/);
});

test('front-editor-list-11 — « Enregistrer comme modèle » relit les étapes en base et refuse un modèle vide (f1d)', () => {
  const save = body(saveAsTemplate, 'const handleSave');
  const readAt = save.indexOf(".from('sequence_steps')");
  const insert = save.indexOf(".from('sequence_templates')");
  assert.ok(readAt !== -1 && insert !== -1 && readAt < insert, 'étapes relues avant l’insertion du modèle');
  assert.match(save, /\.eq\('sequence_id', sequenceId\)/);
  assert.match(save, /if \(stepsError\) throw stepsError;/);
  const refuse = save.indexOf('if (!steps || steps.length === 0) {');
  assert.ok(refuse !== -1 && refuse < insert);
  assert.match(save.slice(refuse, insert), /toast\.error\('Le modèle n’a pas été enregistré'[\s\S]*return;/);
  // Les étapes de la liste (vides si leur lecture a échoué, ou périmées) ne servent plus.
  const props = saveAsTemplate.slice(saveAsTemplate.indexOf('export const SaveAsTemplateModal'), saveAsTemplate.indexOf('const { organizationId } = useOrganization();', saveAsTemplate.indexOf('export const SaveAsTemplateModal')));
  assert.doesNotMatch(props, /\bsteps,/);
});
