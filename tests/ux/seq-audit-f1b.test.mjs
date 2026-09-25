/**
 * Audit du module séquences (2026-09-25), lot F1b : éditeur de séquence
 * (défauts medium et low).
 *
 * Deux sortes de contrôles :
 *  - comportement des règles pures (sequenceGraph.ts, conditionTypes.ts,
 *    messageTypeUtils.ts), importées directement (Node lit le TypeScript
 *    sans compilation depuis la 22.18) ;
 *  - lecture du code des composants (ce qui est proposé, affiché, enregistré).
 *
 * Lancer : node --test tests/ux/seq-audit-f1b.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const builder = read('src/components/outreach/SequenceBuilder.tsx');
const stepEditor = read('src/components/outreach/sequence/StepEditor.tsx');
const visual = read('src/components/outreach/sequence/VisualSequenceEditor.tsx');
const canvas = read('src/components/outreach/sequence/WorkflowCanvas.tsx');
const stepNode = read('src/components/outreach/sequence/nodes/WorkflowStepNode.tsx');
const addNode = read('src/components/outreach/sequence/nodes/WorkflowAddNode.tsx');
const checklist = read('src/components/outreach/sequence/SequenceValidationChecklist.tsx');
const stopConditions = read('src/components/outreach/sequence/StopConditionsSettings.tsx');
const multiSender = read('src/components/outreach/sequence/MultiSenderSettings.tsx');
const selector = read('src/components/outreach/SequenceTemplateSelector.tsx');

/** Texte compris entre deux repères (composant ou fonction dont la signature contient des accolades). */
function between(src, start, end) {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  assert.ok(i !== -1 && j !== -1, `introuvable : ${start} … ${end}`);
  return src.slice(i, j);
}

/** Extrait le corps d'une fonction `const nom = ... => {` jusqu'à l'accolade fermante. */
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

const mk = (id, order, actionType = 'message', extra = {}) => ({
  id, order, actionType, conditionType: 'always',
  delayDays: 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18, useAiPersonalization: false,
  messageTemplate: 'Bonjour {{first_name}}', subjectTemplate: '',
  ...extra,
});
const seq = (steps, extra = {}) => ({ name: 'Test', steps, multiSenderEnabled: false, senderAccounts: [], ...extra });

/** Séquence recommandée de l'éditeur, réduite : vérification, deux branches, repli au délai dépassé. */
function recommended() {
  return [
    mk('visit', 0, 'profile_visit', { messageTemplate: '' }),
    mk('check', 1, 'check_connection', { ifTrueGotoStep: 't1', ifFalseGotoStep: 'inv', messageTemplate: '' }),
    mk('t1', 2, 'smart_message', { nextStepId: 't2', useAiPersonalization: true }),
    mk('t2', 3, 'wait_reply', { nextStepId: 't3', timeoutDays: 3, waitForEvent: 'reply_received' }),
    mk('t3', 4, 'smart_message', { useAiPersonalization: true }),
    mk('inv', 5, 'connection_request', { nextStepId: 'wc', messageTemplate: '' }),
    mk('wc', 6, 'wait_connection', { nextStepId: 'f1', timeoutDays: 3, timeoutBranchStepId: 'im', waitForEvent: 'connection_accepted' }),
    mk('f1', 7, 'smart_message', { nextStepId: 'f2', useAiPersonalization: true }),
    mk('f2', 8, 'wait_reply', { nextStepId: 'f3', timeoutDays: 3, waitForEvent: 'reply_received' }),
    mk('f3', 9, 'smart_message', { useAiPersonalization: true }),
    mk('im', 10, 'inmail', { useAiPersonalization: true }),
  ];
}

// ---------------------------------------------------------------- SEQ-089
test('SEQ-089 — réponse et désinscription : ligne fixe, toujours vraies dans l’objet écrit', async (t) => {
  assert.doesNotMatch(stopConditions, /key: 'on_reply'/, 'l’interrupteur « répond » était sans effet');
  assert.doesNotMatch(stopConditions, /key: 'on_unsubscribe'/, 'couper « se désinscrit » laissait partir les étapes LinkedIn');
  assert.match(stopConditions, /La séquence s'arrête toujours quand le candidat répond ou se désinscrit\./);
  assert.match(stopConditions, /onChange\(\{ \.\.\.value, on_reply: true, on_unsubscribe: true, \[item\.key\]: checked \}\)/);
  assert.match(builder, /stopConditions: withAlwaysOnStops\(initial\.stopConditions\)/, 'une séquence chargée avec on_reply à faux est corrigée');
  const g = await graph(t);
  if (!g) return;
  const fixed = g.withAlwaysOnStops({ on_reply: false, on_click: true, on_unsubscribe: false, on_meeting_booked: false });
  assert.deepEqual(fixed, { on_reply: true, on_click: true, on_unsubscribe: true, on_meeting_booked: false });
});

// ---------------------------------------------------------------- SEQ-093
test('SEQ-093 — Message IA : objet saisi et exigé hors personnalisation IA', async (t) => {
  assert.match(stepEditor, /const needsSubject = stepNeedsSubject;/);
  assert.match(builder, /const needsSubject = stepNeedsSubject;/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.stepNeedsSubject('smart_message'), true);
  assert.equal(g.stepNeedsSubject('inmail'), true);
  assert.equal(g.stepNeedsSubject('message'), false);
  const manual = g.validateSequence(seq([mk('a', 0, 'smart_message')]));
  assert.ok(manual.errors.some((e) => e.check === 'subjects' && /il sert si le message part en InMail/.test(e.message)));
  const ai = g.validateSequence(seq([mk('a', 0, 'smart_message', { useAiPersonalization: true, messageTemplate: '' })]));
  assert.deepEqual(ai.errors, []);
});

// ---------------------------------------------------------------- SEQ-094
test('SEQ-094 — plus de personnalisation IA pour l’invitation, la note reste éditable', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /const aiAllowed = stepAllowsAi\(step\.actionType\);/);
    assert.match(src, /\{aiAllowed && \(/, 'le toggle IA doit dépendre du type');
  }
  assert.match(builder, /steps: withoutInvitationAi\(initial\.steps\)/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.stepAllowsAi('connection_request'), false);
  assert.equal(g.stepAllowsAi('smart_message'), true);
  const [invite, msg] = g.withoutInvitationAi([
    mk('i', 0, 'connection_request', { useAiPersonalization: true }),
    mk('m', 1, 'smart_message', { useAiPersonalization: true }),
  ]);
  assert.equal(invite.useAiPersonalization, false);
  assert.equal(msg.useAiPersonalization, true);
});

// ---------------------------------------------------------------- SEQ-095
test('SEQ-095 — type de message affiché : note d’invitation, relances en Liste, InMail selon la branche', async (t) => {
  const m = await messageTypes(t);
  if (!m) return;
  const withNote = m.getStepMessageType(mk('i', 0, 'connection_request', { messageTemplate: 'Bonjour' }), []);
  const noNote = m.getStepMessageType(mk('i', 0, 'connection_request', { messageTemplate: '' }), []);
  assert.equal(withNote.label, 'Invitation avec note');
  assert.equal(noNote.label, 'Invitation sans note');

  // Séquence construite en mode Liste : aucun renvoi, l'ordre fait le parcours.
  const linear = [mk('a', 0), mk('b', 1), mk('c', 2)];
  assert.equal(m.getStepMessageType(linear[0], linear).shortLabel, '1er message');
  assert.equal(m.getStepMessageType(linear[1], linear).shortLabel, 'Relance 1');
  assert.equal(m.getStepMessageType(linear[2], linear).shortLabel, 'Relance 2');

  const steps = recommended();
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  // Branche « connecté » : message direct, pas un InMail.
  assert.equal(m.getStepMessageType(byId.t1, steps).shortLabel, '1er message');
  assert.equal(m.getStepMessageType(byId.t3, steps).shortLabel, 'Relance 1');
  // Invitation acceptée : suite d'invitation.
  assert.equal(m.getStepMessageType(byId.f1, steps).shortLabel, 'Post-connexion');
  // Délai de l'attente dépassé : InMail.
  assert.equal(m.getStepMessageType(byId.im, steps).shortLabel, 'InMail initial');
  // Sans relation garantie, un Message IA annonce son repli.
  assert.match(m.getStepMessageType(mk('x', 0, 'smart_message'), [mk('x', 0, 'smart_message')]).label, /InMail si non connecté/);
});

// ---------------------------------------------------------------- SEQ-106
test('SEQ-106 — ouverture et clic annoncés comme indicatifs dans l’éditeur de conditions', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /engagementConditionHint\(step\.conditionType\)/);
  }
  const c = await conditions(t);
  if (!c) return;
  assert.equal(c.engagementConditionHint('if_email_opened'), "L'ouverture est indicative : certaines messageries ouvrent les e-mails automatiquement.");
  assert.match(c.engagementConditionHint('if_link_clicked'), /indicatif/);
  assert.equal(c.engagementConditionHint('always'), null);
});

// ---------------------------------------------------------------- SEQ-107
test('SEQ-107 — « Si l’e-mail est revenu en erreur » retirée et signalée sur les étapes existantes', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /getConditionsForActionType\(step\.actionType, step\.conditionType\)/);
  }
  assert.match(body(builder, 'const computeSaveWarnings'), /issue\.check === 'retired_condition'/);
  const c = await conditions(t);
  if (!c) return;
  assert.ok(!c.getConditionsForActionType('email').some((x) => x.value === 'if_bounced'), 'plus proposée');
  assert.ok(c.getConditionsForActionType('email', 'if_bounced').some((x) => x.value === 'if_bounced'), 'une étape existante l’affiche');
  const g = await graph(t);
  if (!g) return;
  const v = g.validateSequence(seq([mk('e', 0, 'email', { conditionType: 'if_bounced', subjectTemplate: 'Objet' })]));
  assert.ok(v.warnings.some((w) => w.check === 'retired_condition' && /n'est jamais vraie/.test(w.message)));
});

// ---------------------------------------------------------------- SEQ-146
test('SEQ-146 — une seule vérification pour la liste, le mode Guidé et l’enregistrement', async (t) => {
  assert.match(checklist, /const \{ errors, warnings \} = validateSequence\(sequence\);/);
  assert.match(builder, /const errors: string\[\] = validateSequence\(sequence\)\.errors/);
  assert.match(builder, /for \(const issue of validation\.errors\)/, 'le fil du mode Guidé lit la même vérification');
  assert.doesNotMatch(builder, /setValidationErrors/, 'plus de liste d’erreurs figée entre deux enregistrements');
  assert.match(builder, /className="lg:hidden border border-border rounded-lg"/, 'vérification repliable sous 1024 px');
  assert.doesNotMatch(checklist, /description: hasStopConditions \? 'Configurées' : 'Aucune'/);
  const g = await graph(t);
  if (!g) return;
  const abc = [
    mk('a', 0, 'message', { variantGroup: 'A', variantWeight: 25 }),
    mk('b', 0, 'message', { variantGroup: 'B', variantWeight: 25 }),
    mk('c', 0, 'message', { variantGroup: 'C', variantWeight: 25 }),
  ];
  assert.ok(g.validateSequence(seq(abc)).errors.some((e) => e.check === 'ab_weights' && /75 %/.test(e.message)));
  const window = g.validateSequence(seq([mk('w', 0, 'message', { preferredHourStart: 18, preferredHourEnd: 9 })]));
  assert.ok(window.errors.some((e) => e.check === 'send_window'));
  const score = g.validateSequence(seq([mk('s', 0, 'message', { conditionType: 'if_score_above' })]));
  assert.ok(score.errors.some((e) => e.check === 'score'));
  assert.deepEqual(g.validateSequence(seq(recommended())).errors, []);
});

// ---------------------------------------------------------------- SEQ-147
test('SEQ-147 — seuil 70 et délai d’attente : valeur affichée = valeur enregistrée ; délais en heures visibles', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /\{ conditionType: 'if_score_above', conditionValue: '70' \}/);
    assert.match(src, /value=\{step\.conditionValue \?\? ''\}/);
    assert.doesNotMatch(src, /step\.conditionValue \|\| '70'/);
    assert.doesNotMatch(src, /step\.timeoutDays \|\| 3/);
  }
  assert.match(builder, /Après \{delayLabel\}/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.formatStepDelay({ delayDays: 0, delayHours: 4, delayMinutes: 0 }), '4 h');
  assert.equal(g.formatStepDelay({ delayDays: 2, delayHours: 0, delayMinutes: 30 }), '2 j 30 min');
  assert.equal(g.formatStepDelay({ delayDays: 0, delayHours: 0, delayMinutes: 0 }), '');
});

// ---------------------------------------------------------------- SEQ-148
test('SEQ-148 — invitation sans note acceptée, limite de 300 caractères gardée', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /Note facultative\. Sans note, l'invitation part seule\./);
  }
  assert.match(builder, /stepRequiresMessage\(row\.actionType\)/, 'le badge Incomplet suit la même règle');
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.stepRequiresMessage('connection_request'), false);
  assert.deepEqual(g.validateSequence(seq([mk('i', 0, 'connection_request', { messageTemplate: '' })])).errors, []);
  const long = g.validateSequence(seq([mk('i', 0, 'connection_request', { messageTemplate: 'x'.repeat(301) })]));
  assert.ok(long.errors.some((e) => e.check === 'invite_length'));
});

// ---------------------------------------------------------------- SEQ-150
test('SEQ-150 — modification avec candidats en cours : bandeau et confirmation de suppression', () => {
  assert.match(builder, /activeEnrollmentCount\?: number;/);
  assert.match(builder, /candidats sont en cours dans cette séquence\.`\}/);
  assert.match(builder, /Un texte modifié s'applique à leurs prochains envois\. Un délai modifié ne s'applique qu'aux étapes pas encore programmées\. Supprimer une étape annule les envois prévus sur cette étape\./);
  assert.match(builder, /if \(!options\?\.removalConfirmed && removedPersistedStepCount > 0 && \(activeEnrollmentCount \?\? 1\) > 0\)/);
  assert.match(builder, /onClick=\{\(\) => \{ void handleSave\(\{ removalConfirmed: true \}\); \}\}/);
});

// ---------------------------------------------------------------- SEQ-152
test('SEQ-152 — « Repartir de zéro » depuis le toast, et la dernière étape se supprime', async (t) => {
  assert.match(builder, /action: \{ label: 'Repartir de zéro', onClick: resetToBlank \}/);
  const reset = body(builder, 'const resetToBlank');
  assert.match(reset, /clearEditorDraft\(draftKey\)/);
  assert.match(reset, /setSequence\(blank\)/);
  assert.doesNotMatch(builder, /disabled=\{primarySteps\.length <= 1/);
  assert.match(canvas, /canRemove: true,/);
  const g = await graph(t);
  if (!g) return;
  assert.deepEqual(g.removeStepFromSequence([mk('seul', 0)], 'seul'), []);
});

// ---------------------------------------------------------------- SEQ-153
test('SEQ-153 — brouillon écrit au fil de la saisie et avertissement avant de quitter la page', () => {
  assert.match(builder, /window\.setTimeout\(writeDraftNow, 1000\)/);
  assert.match(builder, /window\.addEventListener\('beforeunload', onBeforeUnload\)/);
  const writer = body(builder, 'const writeDraftNow');
  assert.match(writer, /if \(enregistreeRef\.current\) return;/, 'rien n’est réécrit après un enregistrement réussi');
});

// ---------------------------------------------------------------- SEQ-154
test('SEQ-154 — un seul geste « Enregistrer », offre sans envoi annoncée', () => {
  assert.doesNotMatch(builder, /Activer<\/>/, 'l’ancien « Activer » faisait la même chose qu’« Enregistrer »');
  assert.match(builder, /canSendSequences\?: boolean;/);
  assert.match(builder, /la séquence sera enregistrée désactivée/);
});

// ---------------------------------------------------------------- SEQ-155
test('SEQ-155 — le chiffre par expéditeur n’est plus présenté comme un plafond d’envoi', () => {
  assert.doesNotMatch(multiSender, /actions\/jour/);
  assert.match(multiSender, /Plus de nouveaux candidats au-delà de/);
  assert.match(multiSender, /Les plafonds d'envoi LinkedIn restent ceux du compte \(Paramètres, Équipe\)\./);
});

// ---------------------------------------------------------------- SEQ-156
test('SEQ-156 — rotation réservée aux comptes LinkedIn, libellé et canal enregistrés', async (t) => {
  const select = body(multiSender, 'const handleSelectMember');
  assert.match(select, /const accountId = member\.linkedInAccountId;/);
  assert.doesNotMatch(select, /emailAccountId/);
  assert.match(select, /channel: 'linkedin'/);
  assert.match(select, /label: senderLabelFor\(member\)/);
  assert.match(multiSender, /`LinkedIn · \$\{sender\.label\}`/);
  assert.doesNotMatch(multiSender, /opacity-0 group-hover:opacity-100/, 'bouton de retrait invisible au toucher');
  const g = await graph(t);
  if (!g) return;
  const [copy] = g.asSenderAccounts([{ account_id: 'acc', daily_limit: 40, label: 'Théo Martin', channel: 'linkedin' }]);
  assert.equal(copy.label, 'Théo Martin');
  assert.equal(copy.channel, 'linkedin');
});

// ---------------------------------------------------------------- SEQ-157
test('SEQ-157 — branche de chaque étape lisible en Liste et en vérification', async (t) => {
  assert.match(builder, /const badges = branchBadges\.get\(step\.id\) \?\? \[\];/);
  assert.match(builder, /\(branchBadges\.get\(step\.id\) \?\? \[\]\)\.map/, 'le parcours de la vérification montre les branches');
  assert.match(builder, /Variante \{step\.variantGroup\}<\/span>/);
  const g = await graph(t);
  if (!g) return;
  const badges = g.branchBadgesByStep(recommended());
  assert.deepEqual(badges.get('t3'), ['Si connecté']);
  assert.deepEqual(badges.get('f3'), ['Si non connecté']);
  assert.deepEqual(badges.get('im'), ['Si délai dépassé', 'Si non connecté']);
  assert.deepEqual(badges.get('visit'), []);
  // Branches qui se rejoignent : pas de badge sur l'étape commune.
  const merge = [
    mk('c', 0, 'check_connection', { ifTrueGotoStep: 'a', ifFalseGotoStep: 'b' }),
    mk('a', 1, 'message', { nextStepId: 'z' }),
    mk('b', 2, 'inmail', { nextStepId: 'z', subjectTemplate: 'Objet' }),
    mk('z', 3),
  ];
  assert.deepEqual(g.branchBadgesByStep(merge).get('z'), []);
});

// ---------------------------------------------------------------- SEQ-158
test('SEQ-158 — mode Liste : l’étape s’ouvre au clavier, sans boutons imbriqués', () => {
  const list = body(builder, 'const renderStepsList');
  assert.match(list, /aria-expanded=\{isExpanded\}/);
  assert.match(list, /aria-controls=\{isExpanded \? panelId : undefined\}/);
  assert.match(list, /<div id=\{panelId\}/);
  assert.doesNotMatch(list, /cursor-pointer"\s*\n\s*onClick=\{\(\) => setExpandedStepId/);
});

// ---------------------------------------------------------------- SEQ-159
test('SEQ-159 — canevas : sélection au clavier, suppression visible, boutons nommés, plein écran sur téléphone', () => {
  assert.match(canvas, /onSelectionChange=\{handleSelectionChange\}/);
  assert.match(stepNode, /\[@media\(hover:none\)\]:opacity-100/);
  assert.match(stepNode, /aria-label=\{`Supprimer l'étape \$\{index \+ 1\}`\}/);
  assert.match(addNode, /: 'Ajouter une étape'\}/);
  assert.match(visual, /<SheetContent side="bottom"/);
  assert.doesNotMatch(visual, /max-h-\[200px\]/);
});

// ---------------------------------------------------------------- SEQ-160
test('SEQ-160 — étape de repli limitée aux étapes suivantes', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /timeoutTargetOptions\(step, (allSteps|sequence\.steps)\)/);
    assert.doesNotMatch(src, /\.filter\(s => s\.id !== step\.id\)\.map/, 'toutes les étapes étaient proposées, antérieures comprises');
  }
  const g = await graph(t);
  if (!g) return;
  const steps = [mk('m', 0), mk('w', 1, 'wait_reply', { timeoutDays: 3, timeoutBranchStepId: 'm' }), mk('r', 2)];
  assert.deepEqual(g.timeoutTargetOptions(steps[1], steps).map((s) => s.id), ['r']);
  assert.equal(g.hasBackwardTimeoutTarget(steps[1], steps), true);
  assert.ok(g.validateSequence(seq(steps)).errors.some((e) => e.check === 'timeout_target'));
});

// ---------------------------------------------------------------- SEQ-175
test('SEQ-175 — variantes A/B : syntaxe {{first_name}} et menu Variables', () => {
  const variant = between(builder, 'const VariantEditor', 'export const SequenceBuilder');
  assert.match(variant, /placeholder="Bonjour \{\{first_name\}\}, \.\.\."/);
  assert.match(variant, /<VariableInserter targetRef=\{messageRef\}/);
  assert.ok(!builder.includes('{{firstName}}'));
});

// ---------------------------------------------------------------- SEQ-231
test('SEQ-231 — brouillon rangé par utilisateur et par organisation', async (t) => {
  assert.match(builder, /useState\(\(\) => sequenceDraftKey\(user\?\.id, organizationId\)\)/);
  assert.match(builder, /clearEditorDraft\(LEGACY_SEQUENCE_DRAFT_KEY\)/);
  assert.doesNotMatch(builder, /const SEQUENCE_DRAFT_KEY = 'sequence-new'/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.sequenceDraftKey('u1', 'o1'), 'sequence-new:u1:o1');
  assert.equal(g.sequenceDraftKey('u1', null), null);
  assert.equal(g.sequenceDraftKey(undefined, 'o1'), null);
});

// ---------------------------------------------------------------- SEQ-233
test('SEQ-233 — troisième variante : 34 / 33 / 33', async (t) => {
  assert.match(body(builder, 'const addVariant'), /addVariantToSteps\(prev\.steps, sourceStep\.id, newId\)/);
  const g = await graph(t);
  if (!g) return;
  const two = g.addVariantToSteps([mk('a', 0)], 'a', 'b');
  assert.deepEqual(two.map((s) => [s.id, s.variantGroup, s.variantWeight]), [['a', 'A', 50], ['b', 'B', 50]]);
  const three = g.addVariantToSteps(two, 'a', 'c');
  assert.deepEqual(three.map((s) => [s.variantGroup, s.variantWeight]), [['A', 34], ['B', 33], ['C', 33]]);
  assert.equal(three.reduce((sum, s) => sum + s.variantWeight, 0), 100);
  assert.equal(g.addVariantToSteps(three, 'a', 'd'), three, 'pas de quatrième variante');
});

// ---------------------------------------------------------------- SEQ-234
test('SEQ-234 — délais avec point de départ, week-ends et heures ouvrées annoncés', async (t) => {
  for (const src of [builder, stepEditor]) {
    assert.match(src, /\{delaySentence\(step\)\}/);
    assert.match(src, /\{SEND_WINDOW_HELP\}/);
  }
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.delaySentence({ delayDays: 2, delayHours: 0, delayMinutes: 0 }), "Attendre 2 jours après l'étape précédente.");
  assert.equal(g.delaySentence({ delayDays: 1, delayHours: 4, delayMinutes: 0 }), "Attendre 1 jour et 4 heures après l'étape précédente.");
  assert.equal(g.SEND_WINDOW_HELP, "Envois en semaine uniquement, dans votre fuseau horaire, et dans les heures ouvrées de l'expéditeur.");
});

// ---------------------------------------------------------------- SEQ-235
test('SEQ-235 — échec de chargement des modèles distinct d’une liste vide', () => {
  const fetch = body(selector, 'const fetchTemplates');
  assert.match(fetch, /setLoadError\(true\)/);
  assert.match(selector, /Impossible de charger les modèles\./);
  assert.match(selector, /onClick=\{\(\) => \{ void fetchTemplates\(\); \}\}/);
});

// ---------------------------------------------------------------- SEQ-236
test('SEQ-236 — un seul toast de réussite (celui de la liste)', () => {
  assert.doesNotMatch(builder, /toast\.success\('Séquence enregistrée'\)/);
  // Le toast d'erreur de l'éditeur reste : sans lui, un échec passerait inaperçu.
  assert.match(between(builder, 'const handleSave', 'const goNextWizardStep'), /toast\.error\('Erreur à l\\'enregistrement'/);
});

// ---------------------------------------------------------------- SEQ-237
test('SEQ-237 — ni poignée de glisser en Liste, ni nœud déplaçable en Visuel', () => {
  assert.doesNotMatch(builder, /GripVertical/);
  assert.match(canvas, /nodesDraggable=\{false\}/);
});

// ---------------------------------------------------------------- SEQ-239
test('SEQ-239 — téléphone : vérification repliable et réglages en plein écran', () => {
  assert.match(builder, /: 'Vérification : prête à être enregistrée'/);
  assert.match(visual, /const SMALL_SCREEN_QUERY = '\(max-width: 639px\)';/);
});

// ---------------------------------------------------------------- SEQ-240
test('SEQ-240 — boutons icône nommés, libellés reliés aux champs', () => {
  assert.match(builder, /aria-label="Retour à la liste"/);
  assert.match(builder, /<Label htmlFor=\{fieldId\('delay-days'\)\}>Jours<\/Label>/);
  assert.match(builder, /aria-label=\{`Aller à l'étape \$\{WIZARD_STEPS\.find/);
});

// ---------------------------------------------------------------- SEQ-245
test('SEQ-245 — vocabulaire de l’éditeur : un nom par type d’étape, sans jargon ni tutoiement', async (t) => {
  for (const gone of ["'TRIGGER'", '>Multi-sender<', 'Round-robin', 'meeting est booké', 'Ajouter un sender', 'Séquence complète !', "'trigger'"]) {
    for (const [name, src] of Object.entries({ builder, stepEditor, multiSender, stopConditions })) {
      assert.ok(!src.includes(gone), `${gone} encore présent dans ${name}`);
    }
  }
  assert.match(visual, />\s*Parcours\s*</);
  assert.match(stepNode, /STEP_TYPE_LABELS\[step\.actionType\]/);
  assert.match(builder, /label: STEP_TYPE_LABELS\.smart_message/);
  assert.match(visual, /label: STEP_TYPE_LABELS\.smart_message/);
  const g = await graph(t);
  if (!g) return;
  assert.equal(g.STEP_TYPE_LABELS.smart_message, 'Message IA');
  assert.equal(g.STEP_TYPE_LABELS.email, 'E-mail');
});
