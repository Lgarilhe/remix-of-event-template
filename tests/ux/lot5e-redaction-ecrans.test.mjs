/**
 * Lot 5e, partie 3 : écrans de la rédaction par l'IA (interrupteur
 * konekt.sequences-v2), modules purs et gardes statiques.
 *
 * Invariants épinglés (docs/refonte-mission/lot5-plan.md, 5e ; spec-cible 2.6 et 4) :
 *   - src/lib/sequenceDraft.ts : lecture défensive de prepare, draft et de la
 *     proposition de l'assistant ; étapes sans rédaction par l'IA à l'envoi ;
 *     notes « À rédiger » (tant que le texte manque) et « À relire » (tant que
 *     le texte rédigé n'a pas changé) ; emplacement de texte d'une étape ;
 *     corps de text-action toujours en contexte séquence, jamais le tutoiement ;
 *     textes d'erreur exacts de la spécification ;
 *   - validateSequence, option aiDraft : une note d'invitation retirée bloque
 *     l'enregistrement, une formulation signalée est une recommandation ; sans
 *     l'option, rien ne change (ancien éditeur) ;
 *   - appels serveur dans src/hooks/useSequenceAI.ts seulement (draft-sequence
 *     prepare et draft, text-action) ; aucun stockage local hors du brouillon
 *     de l'éditeur ; aucun nom de prestataire, aucun `any`, aucun tiret long ;
 *   - portes derrière l'interrupteur ; un seul bouton plein ; « Ouvrir la
 *     séquence » relit la proposition sans rien écrire.
 *
 * Sans navigateur ni base. Lancer : node --test tests/ux/lot5e-redaction-ecrans.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

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

const draft = await loadBundle('src/lib/sequenceDraft.ts');
const graph = await loadBundle('src/components/outreach/sequence/sequenceGraph.ts');

const AI_DIR = 'src/components/sequences/ai';
const AI_FILES = readdirSync(join(ROOT, AI_DIR)).filter((n) => /\.tsx?$/.test(n)).map((n) => `${AI_DIR}/${n}`);
const VENDORS = /\b(?:Unipile|Apollo|PDL|People Data Labs|Calendly|Brandfetch|Clearbit|Resend|Anthropic|Claude|Notion)\b/i;

const step = (id, order, actionType, extra = {}) => ({
  id, order, actionType, conditionType: 'always', delayDays: 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18, subjectTemplate: '', messageTemplate: '', useAiPersonalization: false,
  aiTone: 'professional', timeoutAction: 'skip', ...extra,
});
const DRAFT_STEPS = [
  step('v', 0, 'profile_visit'),
  step('i', 1, 'connection_request'),
  step('w', 2, 'wait_connection', { waitForEvent: 'connection_accepted', timeoutDays: 14 }),
  step('m1', 3, 'message', { conditionType: 'if_connected', messageTemplate: 'Bonjour {{prenom}}, jeune diplômé bienvenu. {{mon_prenom}}' }),
  step('m2', 4, 'message', { conditionType: 'if_connected', delayDays: 4, messageTemplate: 'Bonjour {{prenom}}, je reviens vers vous. {{mon_prenom}}' }),
];
const FLAGS = [
  { step_id: 'i', order: 1, kind: 'a_rediger', messages: ['Texte retiré : il citait une rémunération.'] },
  { step_id: 'm1', order: 3, kind: 'a_relire', messages: ['À relire : « jeune diplômé » peut être lu comme un critère lié à l’âge.'] },
  { step_id: 'inconnue', order: 9, kind: 'a_relire', messages: ['ignorée'] },
];

test('textes de la spécification, exacts', () => {
  assert.equal(draft.AI_DRAFT_BANNER, 'Rédigée par l’IA Konekt à partir du poste : relisez chaque message sur un vrai candidat, puis enregistrez. Rien ne part avant l’inscription.');
  assert.equal(draft.AI_DRAFT_NOTICE, 'Rien ne part avant que vous inscriviez des candidats.');
  assert.equal(draft.AI_DRAFT_FREE_PLAN, 'Votre formule permet de préparer cette séquence. L’envoi automatique fait partie des formules payantes.');
  assert.equal(draft.AI_DRAFT_NOT_DESCRIBED, 'Décrivez d’abord le poste dans le Cadrage pour que l’IA puisse rédiger.');
  assert.equal(draft.AI_DRAFT_ERRORS.credits, 'Crédits IA insuffisants pour rédiger la séquence.');
  assert.equal(draft.AI_DRAFT_ERRORS.thin, 'Le poste est trop peu décrit pour proposer des angles. Ajoutez au moins le titre et deux points forts dans le Cadrage.');
  assert.equal(draft.AI_DRAFT_ERRORS.unavailable, 'La rédaction est indisponible pour l’instant. Vos réglages sont gardés.');
  assert.equal(draft.ASK_AI_UNAVAILABLE, 'Proposition indisponible pour l’instant. Votre texte n’a pas changé.');
  assert.equal(draft.ASK_AI_NO_CREDITS, 'Crédits insuffisants');
  assert.deepEqual(draft.ASK_AI_ACTIONS.map((a) => a.label), ['Raccourcir', 'Plus direct', 'Plus chaleureux', 'Ajouter une accroche sur le parcours', 'Corriger l’orthographe', 'Rédiger à partir du poste']);
  assert.equal(draft.aboutCreditsLabel(7), 'environ 7 crédits');
  assert.equal(draft.aboutCreditsLabel(1), 'environ 1 crédit');
  assert.equal(draft.draftCostEstimate(), 7, 'clé sequence_draft, modèle par défaut');
  assert.equal(draft.askAiCostEstimate(), 1, 'clé rewrite_text, modèle rapide');
});

test('prepare : lecture défensive, réglages gardés d’une rédaction à l’autre', () => {
  assert.equal(draft.readPrepare(null), null);
  assert.equal(draft.readPrepare({ ok: true, angles: [] }), null, 'sans angle : illisible');
  const prepare = draft.readPrepare({
    ok: true,
    mission: { id: 'm', title: 'Directeur financier' },
    facts: [{ id: 'mission', label: 'Missions : piloter deux acquisitions' }, { id: 'location', label: 'Lieu : Lyon' }, { id: '', label: 'x' }],
    messages: ['Vous recrutez pour un client.', 3],
    angles: [{ id: 'role', label: 'Le rôle', description: 'd', why: 'Pourquoi : …', recommended: true }, { id: 'autre', label: 'x' }],
    defaults: { angle: 'role', relances: 9, first_contact: 'inmail', profile_visit: false },
    cost: { estimated: 7, sufficient: false },
  });
  assert.equal(prepare.missionTitle, 'Directeur financier');
  assert.deepEqual(prepare.facts.map((f) => f.id), ['mission', 'location']);
  assert.deepEqual(prepare.messages, ['Vous recrutez pour un client.']);
  assert.deepEqual(prepare.angles.map((a) => a.id), ['role']);
  assert.deepEqual(prepare.defaults, { angle: 'role', relances: 3, firstContact: 'inmail', profileVisit: false });
  assert.deepEqual(prepare.cost, { estimated: 7, sufficient: false });

  const settings = { removedFactIds: ['location', 'disparu'], extraArguments: ['Création du poste'], relances: 1, firstContact: 'invitation', angle: 'environnement' };
  assert.deepEqual(draft.settingsForPrepare(prepare, settings), { removedFactIds: ['location'], extraArguments: ['Création du poste'], relances: 1, firstContact: 'invitation', angle: 'role' });
  assert.equal(draft.hasArguments(prepare, { ...settings, removedFactIds: ['mission', 'location'], extraArguments: [] }), false);
  // Le poste est relu par le serveur : seuls les identifiants des arguments gardés partent.
  const body = draft.draftRequestBody('org', 'mission', prepare, { ...settings, removedFactIds: ['location'] });
  assert.deepEqual(body, {
    action: 'draft', organization_id: 'org', mission_id: 'mission', angle: 'environnement', kept_fact_ids: ['mission'],
    extra_arguments: ['Création du poste'], relances: 1, profile_visit: false, first_contact: 'invitation',
  });
  assert.equal(draft.readStoredSettings({ angle: 'inconnu' }), null);
  assert.deepEqual(draft.readStoredSettings({ angle: 'trajectoire', relances: 7, firstContact: 'x', extraArguments: ['a'.repeat(300)] }), {
    removedFactIds: [], extraArguments: ['a'.repeat(160)], relances: 3, firstContact: 'invitation', angle: 'trajectoire',
  });
});

test('draft : étapes au format de l’éditeur, jamais de rédaction par l’IA à l’envoi ; notes de la rédaction', () => {
  const result = draft.readDraftResult({
    ok: true,
    draft: { name: 'Approche Directeur financier', description: 'Rédigée…', steps: DRAFT_STEPS.map((s) => ({ ...s, useAiPersonalization: true, aiTone: 'casual' })) },
    flags: FLAGS,
    credits: { used: 7, remaining: 40 },
  });
  assert.equal(result.creditsUsed, 7);
  assert.ok(result.steps.every((s) => s.useAiPersonalization === false && s.aiTone === 'professional'));
  assert.equal(result.steps[2].timeoutDays, 14);
  assert.equal(result.steps[2].waitForEvent, 'connection_accepted');
  assert.deepEqual(result.notes.toWrite, { i: ['Texte retiré : il citait une rémunération.'] });
  assert.deepEqual(Object.keys(result.notes.toReview), ['m1']);
  assert.equal(result.notes.toReview.m1.text, DRAFT_STEPS[3].messageTemplate);
  // Un type d'étape hors de la forme de la rédaction : réponse refusée.
  assert.equal(draft.readDraftSteps([{ ...DRAFT_STEPS[0], actionType: 'email' }]), null);
  assert.equal(draft.readDraftSteps([]), null);
  assert.equal(draft.readDraftResult({ ok: false }), null);

  // « À rédiger » tant que le texte manque ; « À relire » tant que le texte rédigé n'a pas changé.
  const invite = result.steps[1];
  assert.deepEqual(draft.stepNotes(result.notes, invite).toWrite, ['Texte retiré : il citait une rémunération.']);
  assert.deepEqual(draft.stepNotes(result.notes, { ...invite, messageTemplate: 'Bonjour' }).toWrite, []);
  const first = result.steps[3];
  assert.equal(draft.stepNotes(result.notes, first).toReview.length, 1);
  assert.deepEqual(draft.stepNotes(result.notes, { ...first, messageTemplate: `${first.messageTemplate} ` }).toReview, []);
  const stored = draft.readStoredNotes(JSON.parse(JSON.stringify(result.notes)));
  assert.deepEqual(stored, result.notes);
  assert.deepEqual(draft.readStoredNotes('n’importe quoi'), { toWrite: {}, toReview: {} });
});

test('validateSequence, option aiDraft : note retirée bloquante, formulation signalée en recommandation ; sans option, inchangé', () => {
  const notes = draft.notesFromFlags(FLAGS, DRAFT_STEPS);
  const sequence = { name: 'Approche', steps: DRAFT_STEPS, multiSenderEnabled: false, senderAccounts: [] };
  const plain = graph.validateSequence(sequence, null, { unknownVariables: 'block' });
  assert.ok(!plain.errors.some((e) => e.check === 'ai_to_write'), 'ancien éditeur : note facultative');
  assert.ok(!plain.warnings.some((w) => w.check === 'ai_to_review'));
  const ai = graph.validateSequence(sequence, null, { unknownVariables: 'block', aiDraft: draft.validationOptionOf(notes) });
  assert.deepEqual(ai.errors.filter((e) => e.check === 'ai_to_write').map((e) => e.message), ["Étape 2 : note d'invitation à rédiger."]);
  assert.deepEqual(ai.warnings.filter((w) => w.check === 'ai_to_review').map((w) => w.message), ['Étape 4 : À relire : « jeune diplômé » peut être lu comme un critère lié à l’âge.']);
  // Note écrite, texte retouché : plus rien.
  const edited = DRAFT_STEPS.map((s) => (s.id === 'i' ? { ...s, messageTemplate: 'Bonjour {{prenom}}' } : s.id === 'm1' ? { ...s, messageTemplate: 'Bonjour {{prenom}}.' } : s));
  const after = graph.validateSequence({ ...sequence, steps: edited }, null, { aiDraft: draft.validationOptionOf(notes) });
  assert.ok(!after.errors.some((e) => e.check === 'ai_to_write'));
  assert.ok(!after.warnings.some((w) => w.check === 'ai_to_review'));
  // Les messages et objets vides restaient déjà bloquants (« message à rédiger »).
  const emptyMessage = DRAFT_STEPS.map((s) => (s.id === 'm2' ? { ...s, messageTemplate: '' } : s));
  assert.ok(graph.validateSequence({ ...sequence, steps: emptyMessage }).errors.some((e) => e.message === 'Étape 5 : message à rédiger.'));
});

test('emplacement de texte d’une étape et « Rédiger à partir du poste »', () => {
  assert.deepEqual(draft.stepSlot(DRAFT_STEPS, 'i'), { slot: 'invitation_note', firstContact: 'invitation', relances: 1, isFirstMessage: false });
  assert.deepEqual(draft.stepSlot(DRAFT_STEPS, 'm1'), { slot: 'first_message', firstContact: 'invitation', relances: 1, isFirstMessage: true });
  assert.deepEqual(draft.stepSlot(DRAFT_STEPS, 'm2'), { slot: 'relance_1', firstContact: 'invitation', relances: 1, isFirstMessage: false });
  assert.equal(draft.stepSlot(DRAFT_STEPS, 'w'), null);
  const inmails = [step('a', 0, 'inmail'), step('b', 1, 'inmail'), step('c', 2, 'inmail'), step('d', 3, 'inmail'), step('e', 4, 'inmail')];
  assert.deepEqual(draft.stepSlot(inmails, 'e'), { slot: 'relance_3', firstContact: 'inmail', relances: 3, isFirstMessage: false });
  assert.deepEqual(draft.briefDraftRequestBody('org', 'mission', draft.stepSlot(inmails, 'c')), {
    action: 'draft', organization_id: 'org', mission_id: 'mission', first_contact: 'inmail', relances: 2, profile_visit: false,
  });
  const result = { name: 'x', description: '', steps: DRAFT_STEPS, notes: draft.notesFromFlags(FLAGS, DRAFT_STEPS), creditsUsed: 7 };
  assert.deepEqual(draft.draftTextForSlot(result, 'invitation_note'), { body: '', subject: '', toWrite: ['Texte retiré : il citait une rémunération.'], toReview: [] });
  assert.equal(draft.draftTextForSlot(result, 'relance_1').body, DRAFT_STEPS[4].messageTemplate);
  assert.equal(draft.draftTextForSlot(result, 'relance_3'), null);
  assert.equal(draft.briefRefusalMessage(['Texte retiré : il citait une rémunération.']), 'Proposition retirée : il citait une rémunération. Votre texte n’a pas changé.');
  assert.equal(draft.briefRefusalMessage([]), draft.ASK_AI_UNAVAILABLE);
});

test('« Demander à l’IA » : text-action en contexte séquence, vouvoiement imposé ; erreurs de la spécification', () => {
  const input = { organizationId: 'org', missionId: 'mission', text: 'Bonjour', actionType: 'message', isFirstMessage: true };
  assert.deepEqual(draft.textActionBody('direct', input), { action: 'rewrite', tone: 'direct', context: 'sequence', organization_id: 'org', text: 'Bonjour', step: { action_type: 'message', is_first_message: true }, mission_id: 'mission' });
  assert.equal(draft.textActionBody('warm', input).tone, 'empathetic');
  for (const action of ['shorten', 'hook', 'proofread']) {
    const body = draft.textActionBody(action, { ...input, missionId: null });
    assert.equal(body.action, action);
    assert.equal(body.context, 'sequence');
    assert.equal('mission_id' in body, false);
  }
  for (const action of ['shorten', 'direct', 'warm', 'hook', 'proofread']) assert.notEqual(draft.textActionBody(action, input).tone, 'casual');
  assert.deepEqual(draft.askAiErrorOf({ status: 402 }, {}), { kind: 'credits', message: 'Crédits insuffisants' });
  assert.deepEqual(draft.askAiErrorOf({ status: 422, code: 'PROPOSAL_NOT_COMPLIANT' }, { error: 'Proposition retirée : elle citait une rémunération. Votre texte n’a pas changé.' }), { kind: 'refused', message: 'Proposition retirée : elle citait une rémunération. Votre texte n’a pas changé.' });
  assert.deepEqual(draft.askAiErrorOf({ status: 503, code: 'PROPOSAL_UNAVAILABLE' }, {}), { kind: 'unavailable', message: draft.ASK_AI_UNAVAILABLE });
  assert.deepEqual(draft.draftErrorOf({ status: 402, code: 'INSUFFICIENT_CREDITS' }, {}), { kind: 'credits', message: draft.AI_DRAFT_ERRORS.credits });
  assert.deepEqual(draft.draftErrorOf({ status: 422, code: 'DRAFT_JOB_TOO_THIN' }, {}), { kind: 'thin', message: draft.AI_DRAFT_ERRORS.thin });
  assert.deepEqual(draft.draftErrorOf({ status: 422, code: 'DRAFT_ARGUMENT_REFUSED' }, { error: 'Argument refusé : il cite une rémunération.', argument_index: 1 }), { kind: 'argument', message: 'Argument refusé : il cite une rémunération.', argumentIndex: 1 });
  assert.deepEqual(draft.draftErrorOf({ status: 503 }, {}), { kind: 'unavailable', message: draft.AI_DRAFT_ERRORS.unavailable });
  assert.deepEqual(draft.draftErrorOf(null, null), { kind: 'unavailable', message: draft.AI_DRAFT_ERRORS.unavailable });
});

test('proposition de l’assistant : create_sequence ouverte seulement, identifiants renouvelés, notes suivies', () => {
  let n = 0;
  const newId = () => `nouveau-${(n += 1)}`;
  const row = { tool_name: 'create_sequence', status: 'rejected', dry_run_result: { details: { name: 'Approche', mission_id: 'mission', steps: DRAFT_STEPS, flags: FLAGS } } };
  const proposal = draft.readProposal(row, newId);
  assert.equal(proposal.missionId, 'mission');
  assert.equal(proposal.steps.length, 5);
  assert.ok(proposal.steps.every((s) => s.id.startsWith('nouveau-')));
  assert.deepEqual(Object.keys(proposal.notes.toWrite), [proposal.steps[1].id]);
  assert.deepEqual(Object.keys(proposal.notes.toReview), [proposal.steps[3].id]);
  for (const status of ['approved', 'executed', 'failed']) assert.equal(draft.readProposal({ ...row, status }, newId), null, status);
  assert.equal(draft.readProposal({ ...row, tool_name: 'enroll_in_sequence' }, newId), null);
  assert.equal(draft.readProposal({ ...row, dry_run_result: null }, newId), null);
});

test('gardes : appels serveur dans useSequenceAI seulement, rien en stockage local, ni prestataire, ni any, ni tiret long', () => {
  assert.ok(AI_FILES.length >= 4, AI_FILES.join(', '));
  for (const name of ['AIDraftWizard', 'AskAIMenu', 'AIProposal', 'AIDraftDoor']) assert.ok(existsSync(join(ROOT, `${AI_DIR}/${name}.tsx`)), `${name}.tsx absent`);
  for (const rel of [...AI_FILES, 'src/lib/sequenceDraft.ts', 'src/hooks/useSequenceAI.ts']) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|editorDraft/, `${rel} : stockage local`);
    assert.doesNotMatch(code, VENDORS, `${rel} : nom de prestataire`);
    assert.doesNotMatch(code, /:\s*any\b|as any\b|<any>/, `${rel} : any`);
    assert.doesNotMatch(read(rel), /—/, `${rel} : tiret long`);
    assert.doesNotMatch(code, /<(?:button|input|select|textarea)\b/, `${rel} : contrôle brut`);
    assert.doesNotMatch(code, /\btu\b|\btoi\b|\bton\b poste/i, `${rel} : tutoiement`);
  }
  for (const rel of AI_FILES) assert.doesNotMatch(codeOf(rel), /invokeEdgeFunction|supabase|fetch\(/, `${rel} : appel serveur hors useSequenceAI`);
  const hook = codeOf('src/hooks/useSequenceAI.ts');
  const calls = [...hook.matchAll(/invokeEdgeFunction(?:<[^>(]*>)?\(\s*'([\w-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['draft-sequence', 'draft-sequence', 'text-action']);
  assert.match(hook, /invokeEdgeFunction\('draft-sequence', \{ action: 'prepare', organization_id: organizationId, mission_id: missionId \}\)/);
  assert.doesNotMatch(hook, /\.from\(|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/, 'aucune écriture : la rédaction va dans l’éditeur');
  // Après un appel payant, le solde affiché est relu.
  assert.equal((hook.match(/refreshCredits\(\);/g) ?? []).length, 2);
  // Rédaction : jusqu'aux 60 s de la fonction, sans coupure du navigateur à 55 s.
  assert.match(read('src/lib/invokeEdgeFunction.ts'), /'draft-sequence',\n\]\);/);
});

test('page de création : depart=ia, proposition relue sans écriture, bandeau, gratuit, « Rédiger à nouveau », option aiDraft', () => {
  const page = read('src/components/sequences/SequenceCreatePage.tsx');
  const code = codeOf('src/components/sequences/SequenceCreatePage.tsx');
  assert.match(page, /const aiMode = start\.kind === 'ia';/);
  assert.match(page, /const propositionParam = aiMode \? searchParams\.get\('proposition'\) \|\| null : null;/);
  assert.match(code, /\.from\('agent_tool_executions'\)\s*\.select\('tool_name, status, dry_run_result'\)\s*\.eq\('id', propositionParam\)\s*\.maybeSingle\(\)/);
  assert.equal((code.match(/agent_tool_executions/g) ?? []).length, 1, 'une seule lecture, aucune écriture');
  assert.match(page, /\{AI_DRAFT_BANNER\}/);
  assert.match(page, /Rédiger à nouveau/);
  assert.match(page, /\{AI_DRAFT_FREE_PLAN\}/);
  assert.match(page, /aiDraft: aiValidation,/);
  assert.match(page, /const aiValidation = useMemo\(\(\) => \(aiFilled \? validationOptionOf\(aiNotes\) : undefined\), \[aiFilled, aiNotes\]\);/);
  // Rédaction remplie et non enregistrée : par-dessus un départ vide (restore, jamais reset).
  assert.match(page, /const applyAi = useCallback\(\(seed: AiSeed, keepName = false\) => \{\s*restoreEditor\(seed\.steps\);/);
  assert.match(page, /<AIDraftWizard\s+open=\{wizardOpen\}/);
  assert.match(page, /if \(!aiFilledRef\.current\) navigate\(back\);/, 'annuler la première rédaction : retour d’où l’on vient');
  // Enregistrement : toujours useSequenceSave (save_sequence_steps).
  assert.match(code, /await handleSaveSequence\(sequence\);/);
  assert.doesNotMatch(code, /save_sequence_steps|from\('sequence_steps'\)\s*\.(?:insert|update|upsert|delete)/);
  // Vocabulaire figé : jamais « désactivée ».
  assert.doesNotMatch(code, /[Dd]ésactiv/);
  const beta = read('src/lib/sequencesBeta.ts');
  assert.match(beta, /if \(raw === 'ia'\) return \{ kind: 'ia' \};/);
  assert.match(read('src/hooks/useSequenceEditorSession.ts'), /aiDraft\?: SequenceValidationOptions\['aiDraft'\];/);
});

test('panneau d’étape : « Demander à l’IA » seulement avec son contexte, texte remplacé au seul clic sur « Remplacer »', () => {
  const panel = read('src/components/sequences/editor/StepPanel.tsx');
  assert.match(panel, /const askMenu = askAI && ASK_AI_STEP_TYPES\.has\(type\) && !usesAi \? \(/);
  assert.match(panel, /onReplace=\{\(\{ text, subject \}\) => \{\s*updateActive\(subject !== null \? \{ messageTemplate: text, subjectTemplate: subject \} : \{ messageTemplate: text \}\);\s*closeProposal\(\);/);
  // « Remplacer » ou « Garder ma version » : la proposition se ferme et le focus revient au texte de l'étape.
  assert.match(panel, /const closeProposal = \(\) => \{\s*focusMessageRef\.current = true;\s*setProposal\(null\);\s*\};/);
  assert.match(panel, /panelRef\.current\?\.querySelector<HTMLElement>\('#message'\)\?\.focus\(\);/);
  assert.match(panel, /onDismiss=\{closeProposal\}/);
  // Étape « À rédiger » : aide cohérente sous la note, la ligne générique de la vérification n'est pas répétée.
  assert.match(panel, /\(toWrite \? 'Note à rédiger avant d’enregistrer\.' : 'Note facultative\. Sans note, l’invitation part seule\.'\)/);
  assert.match(panel, /const TO_WRITE_CHECKS = new Set\(\['message à rédiger\.', "note d'invitation à rédiger\.", 'objet à renseigner\.'\]\);/);
  // Le fil dit « À rédiger » et sa raison à la place de « Invitation sans note… ».
  const card = read('src/components/sequences/editor/StepCard.tsx');
  assert.match(card, /const aiToWrite = toWrite && toWrite\.length > 0 \? `À rédiger · \$\{toWrite\.join\(' '\)\}` : null;/);
  assert.match(card, /\{node\.description && !aiToWrite && /);
  assert.match(read('src/components/sequences/editor/SequenceFlow.tsx'), /toWrite=\{props\.aiNotes \? stepNotes\(props\.aiNotes, step\)\.toWrite : undefined\}/);
  assert.match(panel, /const shownProposal = proposal && proposal\.versionId === active\.id \? proposal : null;/, 'proposition de la version affichée seulement');
  assert.match(panel, /<p className="font-medium">À rédiger<\/p>/);
  assert.match(panel, /<p className="font-medium">À relire<\/p>/);
  const proposal = read(`${AI_DIR}/AIProposal.tsx`);
  for (const label of ['Proposition de l’IA', 'Remplacer', 'Garder ma version']) assert.ok(proposal.includes(label), label);
  assert.match(proposal, /\{creditsLabel\(proposal\.credits\)\}/);
  // Un seul bouton plein par écran : rien de plein dans la proposition ni dans le menu.
  for (const rel of [`${AI_DIR}/AIProposal.tsx`, `${AI_DIR}/AskAIMenu.tsx`]) assert.doesNotMatch(read(rel), /variant="primary"/, rel);
  const menu = read(`${AI_DIR}/AskAIMenu.tsx`);
  assert.match(menu, /\{ASK_AI_NO_CREDITS\}/);
  assert.match(menu, /Écrivez d’abord un texte à retoucher\./);
  assert.match(menu, /AI_DRAFT_NOT_DESCRIBED/);
  // Les deux pages Séquences passent le contexte ; l'ancien éditeur n'a pas de menu.
  assert.match(read('src/components/sequences/SequenceCreatePage.tsx'), /askAI=\{askAI\}/);
  assert.match(read('src/pages/SequenceDetailPage.tsx'), /askAI=\{askAI\}/);
  assert.doesNotMatch(read('src/components/outreach/SequenceBuilder.tsx'), /AskAIMenu|sequences\/ai\//);
});

test('portes : derrière l’interrupteur, poste non décrit désactivé, un seul bouton plein', () => {
  const list = read('src/components/outreach/SequencesList.tsx');
  assert.match(list, /const showMissionDoor = sequencesBeta && !!projectId && !loading && !loadError && sequences\.length === 0;/);
  assert.match(list, /\) : showMissionDoor && projectId \? \(\s*\/\/ [^\n]*\n\s*<MissionSequencesEmpty/);
  // Porte affichée : l'état vide porte seul les départs, sans « Créer une séquence », « Journal » ni « Envoyer les actions du jour ».
  assert.match(list, /\{!showMissionDoor && \(\s*<Button type="button" variant="primary" size="sm" onClick=\{handleCreateNew\}/, 'un seul bouton plein quand la porte est affichée');
  assert.match(list, /\{!isMobile && !showMissionDoor && \(/);
  assert.match(list, /\{isMobile && !showMissionDoor && \(/);
  // À côté de la page, qui a déjà son bouton plein : porte en bouton discret.
  assert.match(list, /quiet=\{besidePage\}/);
  assert.match(read('src/components/missions/v3/panels/ContactPanel.tsx'), /besidePage=\{!fullscreen\}/);
  // Interrupteur éteint : l'état vide d'avant, inchangé.
  assert.match(list, /title="Aucune séquence pour cette mission"/);
  assert.match(list, /Créer ma première séquence/);
  const door = read(`${AI_DIR}/AIDraftDoor.tsx`);
  assert.match(door, /Cette mission n’a pas encore de séquence\./);
  assert.match(door, /Une séquence envoie la visite, l’invitation, le message et les relances à votre place, depuis votre compte LinkedIn, et s’arrête dès qu’un candidat répond\./);
  for (const label of ['Rédiger une séquence pour cette mission', 'Depuis un modèle', 'Partir de zéro', 'Décrire le poste', 'Rédiger avec l’IA à partir du poste']) assert.ok(door.includes(label), label);
  assert.match(door, /disabled=\{loading \|\| !described\}/);
  assert.equal((door.match(/variant=\{quiet \? 'outline' : 'primary'\}/g) ?? []).length, 1);
  assert.doesNotMatch(door, /variant="primary"/);
  const readiness = read('src/hooks/useSequenceAI.ts');
  assert.match(readiness, /described: !!jobDetails && canScoreProfiles\(jobDetails\),/);
  assert.match(readiness, /missionV3Path\(missionId, 'cadrage', \{ \[V3_PARAM\.section\]: 'poste' \}\)/);
  // Aucune garde d'offre sur les portes (décision 6) : la formule gratuite rédige dans la limite de ses crédits.
  for (const rel of [`${AI_DIR}/AIDraftDoor.tsx`, `${AI_DIR}/AIDraftWizard.tsx`]) assert.doesNotMatch(codeOf(rel), /hasPlanFeature|sequences_send/, rel);
  // Assistant de rédaction : un seul bouton plein par écran, cibles de 44 px au doigt.
  const wizard = read(`${AI_DIR}/AIDraftWizard.tsx`);
  assert.equal((wizard.match(/variant="primary"/g) ?? []).length, 2, '« Choisir l’angle » sur « Le poste », « Rédiger la séquence » sur « L’angle »');
  assert.match(wizard, /const TOUCH = 'max-md:h-11';/);
  for (const text of ['Ce que l’IA retient du poste', 'Ajouter un argument', 'Vos messages (repris du Cadrage)', 'Recommandé', 'Rédiger la séquence', 'Choisir l’angle', 'Voir les offres', 'Depuis un modèle', 'Ouvrir le Cadrage', 'Réessayer']) {
    assert.ok(wizard.includes(text), text);
  }
});

test('assistant de rédaction : un double clic ou un second Entrée ne lance jamais la rédaction payante ; 360 px ; focus', () => {
  const wizard = read(`${AI_DIR}/AIDraftWizard.tsx`);
  // Boutons du pied à clés distinctes : « Choisir l'angle » n'est jamais réutilisé par « Rédiger la séquence ».
  for (const key of ['cancel', 'next', 'back', 'draft']) assert.match(wizard, new RegExp(`<Button key="${key}"`), key);
  // Second clic d'un double clic ignoré ; Entrée au clavier ignorée pendant 500 ms après un changement d'écran.
  assert.match(wizard, /const SCREEN_GUARD_MS = 500;/);
  assert.match(wizard, /event\.detail > 1 \|\| \(event\.detail === 0 && Date\.now\(\) - screenChangedAtRef\.current < SCREEN_GUARD_MS\)/);
  assert.match(wizard, /onClick=\{\(event\) => \{ if \(!ignored\(event\)\) goTo\('angle'\); \}\}/);
  assert.match(wizard, /onClick=\{\(event\) => \{ if \(!ignored\(event\)\) void draft\(\); \}\}/);
  // Hauteur stable une fois le poste lu ; chaque écran s'ouvre en haut, focus sur l'angle choisi ou le titre des arguments.
  assert.match(wizard, /prepare && 'h-\[min\(90vh,46rem\)\]'/);
  assert.match(wizard, /scrollRef\.current\?\.scrollTo\?\.\(\{ top: 0 \}\);/);
  assert.match(wizard, /document\.getElementById\(`\$\{id\}-angle-\$\{angle\}`\)\?\.focus\(\);/);
  // Erreurs et phrase de remplacement au-dessus des angles, bandeau amené dans la vue et focalisé.
  const angle = wizard.slice(wizard.indexOf("screen === 'angle' && ("));
  assert.ok(angle.indexOf('AI_DRAFT_REPLACES_EDITS') < angle.indexOf('<RadioGroup'), 'remplacement annoncé avant les angles');
  assert.ok(angle.indexOf('ref={errorRef}') < angle.indexOf('<RadioGroup'), 'erreur avant les angles');
  assert.match(wizard, /errorRef\.current\?\.scrollIntoView\?\.\(\{ block: 'nearest' \}\);\s*errorRef\.current\?\.focus\(\);/);
  // Après un refus faute de crédits, « Rédiger la séquence » est désactivé.
  assert.match(wizard, /const canDraft = canContinue && draftError\?\.kind !== 'credits';/);
  assert.match(wizard, /disabled=\{!canDraft \|\| drafting\}/);
  // Bandeaux : actions sous le texte sous 640 px.
  assert.match(wizard, /<span className="flex shrink-0 flex-wrap items-center gap-4 max-sm:hidden">\{actions\}<\/span>/);
  assert.match(wizard, /\{actions && <span className="mt-1 flex flex-wrap items-center gap-x-4 sm:hidden">\{actions\}<\/span>\}/);
  // Cinq arguments d'emblée, les autres sous « Voir les N autres ».
  assert.match(wizard, /const VISIBLE_FACTS = 5;/);
  assert.match(wizard, /Voir \{hiddenFactCount > 1 \? `les \$\{hiddenFactCount\} autres` : 'l’autre'\}/);
  // Focus après un ajout ou un retrait d'argument, et après la rédaction.
  assert.match(wizard, /focusArgumentRef\.current = 'add';/);
  assert.match(wizard, /focusArgumentRef\.current = rank;/);
  assert.match(wizard, /const target = draftedRef\.current \? focusAfterDraft\?\.\(\) : null;/);
  assert.match(read('src/components/sequences/SequenceCreatePage.tsx'), /focusAfterDraft=\{\(\) => aiBannerRef\.current\}/);
  // « Décrire le poste » sur sa propre ligne.
  const door = read(`${AI_DIR}/AIDraftDoor.tsx`);
  assert.match(door, /<p className="text-sm text-muted-foreground">\{AI_DRAFT_NOT_DESCRIBED\}<\/p>/);
});

test('« Demander à l’IA » : « Crédits insuffisants » levé par la recharge, coût des retouches sous elles ; aperçu de l’assistant en puces', () => {
  const menu = read(`${AI_DIR}/AskAIMenu.tsx`);
  assert.doesNotMatch(menu, /setNoCredits\(true\)/, 'plus de drapeau figé');
  assert.match(menu, /const noCredits = creditsNeeded !== null && \(creditsFetching \|\| !hasBalance \|\| creditsRemaining < creditsNeeded\);/);
  const cost = menu.indexOf('Retouches : {aboutCreditsLabel(askAiCostEstimate())} par proposition.');
  const brief = menu.indexOf("run('brief', 'Rédiger à partir du poste')");
  assert.ok(cost > 0 && cost < brief, 'coût des retouches avant la rédaction à partir du poste');
  // Carte de la conversation et Journal : variables en puces françaises, jamais en syntaxe brute.
  const preview = read('src/components/agent/SequenceDraftPreview.tsx');
  assert.match(preview, /templateSegments\(text\)/);
  assert.match(preview, /<TemplateText text=\{step\.body\} \/>/);
  assert.match(preview, /<TemplateText text=\{step\.subject\} \/>/);
  // « Ouvrir la séquence » de la carte de la conversation : cible de 44 px au doigt.
  const card = read('src/components/agent/AgentToolApprovalCard.tsx');
  assert.match(card, /onClick=\{\(\) => handleOpenInEditor\(row\.id\)\}\s*disabled=\{loading != null\}\s*className="max-md:h-11"/);
});
