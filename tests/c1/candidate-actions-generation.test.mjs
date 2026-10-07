import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const bundle = buildSync({ entryPoints: ['supabase/functions/_shared/candidate-actions/generate.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const generation = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { normalizeWritingStyle } = await import(`data:text/javascript;base64,${Buffer.from(buildSync({ entryPoints: ['supabase/functions/_shared/writing-style.ts'], bundle: true, platform: 'node', format: 'esm', write: false }).outputFiles[0].text).toString('base64')}`);

const NOW = Date.parse('2026-10-07T10:00:00Z');
const context = {
  scope: { organization_id: 'org-a', candidate_id: 'candidate-a', project_id: 'mission-a' },
  candidateName: 'Alex Martin', contextVersion: 'version-a',
  sources: [{ id: 'message-a', type: 'inbound_message', title: 'Questions d’Alex', author: 'Alex', timestamp: '2026-10-07T09:00:00Z', summary: 'Taille de l’équipe ?', detail: 'Quelle est la taille de l’équipe ?' },
    { id: 'interview-a', type: 'interview', title: 'Entretien confirmé', author: 'Recruteur', timestamp: '2026-10-08T09:00:00Z', summary: 'Entretien demain', detail: 'Entretien du 8 octobre à 9h.' }],
  sourceStates: { messages: 'available', reports: 'partial' },
  facts: { interviews: [{ id: 'interview-a', status: 'scheduled', startAt: '2026-10-08T09:00:00Z' }] },
  targets: [{ id: 'target-candidate', audience: 'candidate', channel: 'email', service: 'outlook', label: 'Alex', recipient: 'alex@example.test', senderAccountId: 'mailbox-a', senderAddress: 'laurent@example.test' },
    { id: 'target-team', audience: 'team', channel: 'email', service: 'outlook', label: 'Guillaume', recipient: 'guillaume@example.test', senderAccountId: 'mailbox-a', senderAddress: 'laurent@example.test', memberId: 'member-a' }],
  members: [{ id: 'member-a', name: 'Guillaume' }], ownEvaluationIds: ['evaluation-a'], warnings: [],
};
const proposal = () => ({ plans: [{ intent: 'coordinate', title: 'Répondre à Alex et coordonner le suivi', reason: 'Alex demande des précisions sur l’équipe.', sourceIds: ['message-a'], effects: [
  { kind: 'message', label: 'Réponse à Alex', content: 'Bonjour Alex, je vérifie la taille de l’équipe et je reviens vers vous.', targetId: 'target-candidate', subject: 'Votre question sur l’équipe' },
  { kind: 'message', label: 'Demande à Guillaume', content: 'Bonjour Guillaume, pouvez-vous confirmer la taille de l’équipe ?', targetId: 'target-team', subject: 'Précisions pour Alex' },
  { kind: 'comment', label: 'Coordination', content: 'Précision demandée à Guillaume.', mentions: ['member-a'] },
], followUp: { title: 'Compléter la réponse à Alex', waitingFor: 'Retour de Guillaume', description: 'Relire la réponse complète après réception du retour.' } }] });

test('server hydrates known targets, source text and identity; conditional follow-up is metadata only', async () => {
  const [plan] = await generation.parseCandidateActionPlans(proposal(), context, 'user-a', NOW);
  assert.equal(plan.createdBy, 'user-a');
  assert.equal(plan.status, 'draft');
  assert.equal(plan.effects[0].recipient, 'alex@example.test');
  assert.equal(plan.effects[1].audience, 'team');
  assert.equal(plan.effects[1].memberId, 'member-a');
  assert.equal(plan.effects[0].senderAccountId, 'mailbox-a');
  assert.equal(plan.sources[0].detail, context.sources[0].detail);
  assert.equal(plan.effects.length, 3);
  assert.ok(plan.effects.every((effect) => effect.status === 'prepared'));
  assert.equal(plan.followUp.waitingFor, 'Retour de Guillaume');
});

test('business effect keys match across recruiters and personal senders, and vary with factual sources/candidate/mission', async () => {
  const [first] = await generation.parseCandidateActionPlans(proposal(), context, 'user-a', NOW);
  const [second] = await generation.parseCandidateActionPlans(proposal(), { ...context, contextVersion: 'personal-version-b', targets: context.targets.map((target) => ({ ...target, senderAccountId: 'mailbox-b', senderAddress: 'colleague@example.test' })) }, 'user-b', NOW);
  assert.notEqual(first.id, second.id);
  assert.equal(first.effects[0].dedupeKey, second.effects[0].dedupeKey);
  for (const changed of [{ ...context, sources: context.sources.map((source) => source.id === 'message-a' ? { ...source, detail: 'Et quelle est la durée du cycle de vente ?' } : source) }, { ...context, scope: { ...context.scope, project_id: 'mission-b' } }, { ...context, scope: { ...context.scope, candidate_id: 'candidate-b' } }]) {
    const [other] = await generation.parseCandidateActionPlans(proposal(), changed, 'user-a', NOW);
    assert.notEqual(other.effects[0].dedupeKey, first.effects[0].dedupeKey);
  }
});

test('a real later team response permits the complete candidate reply, without replaying the original acknowledgement', async () => {
  const original = proposal();
  original.plans[0].sourceIds.push('interview-a');
  const [before] = await generation.parseCandidateActionPlans(original, context, 'user-a', NOW);
  const reply = { id: 'team-return-a', type: 'team_message', title: 'Retour de Guillaume', author: 'Guillaume', timestamp: '2026-10-07T10:30:00Z', summary: 'Équipe de six personnes.', detail: 'Le manager confirme une équipe de six personnes.', reference: { table: 'candidate_action_messages', id: 'team-return-a', version: '2026-10-07T10:30:00Z' } };
  const next = proposal();
  next.plans[0].intent = 'reply';
  next.plans[0].sourceIds.push(reply.id);
  next.plans[0].sourceIds.push('interview-a');
  next.plans[0].effects = [{ ...next.plans[0].effects[0], content: 'Bonjour Alex, le manager confirme une équipe de six personnes.' }];
  const [after] = await generation.parseCandidateActionPlans(next, { ...context, sources: [...context.sources, reply] }, 'user-a', NOW + 3_600_000);
  assert.notEqual(after.effects[0].dedupeKey, before.effects[0].dedupeKey);
});

test('an exchange with an unresolved mission permits internal clarification, without preparing a candidate response', async () => {
  const ambiguous = { ...context.sources[0], type: 'ambiguous_message', projectId: null };
  const partial = { ...context, sources: [ambiguous, context.sources[1]] };
  await assert.rejects(generation.parseCandidateActionPlans(proposal(), partial, 'user-a', NOW), generation.CandidateActionValidationError);
  const clarification = proposal();
  clarification.plans[0].effects = [clarification.plans[0].effects[1]];
  const [plan] = await generation.parseCandidateActionPlans(clarification, partial, 'user-a', NOW);
  assert.equal(plan.effects[0].audience, 'team');
  assert.match(generation.candidateActionPrompt(partial, normalizeWritingStyle({}))[0].content, /ambiguous_message.*jamais un message au candidat/);
});

for (const [name, change] of [
  ['unknown source', (p) => { p.plans[0].sourceIds = ['not-provided']; }],
  ['invented target', (p) => { p.plans[0].effects[0].targetId = 'invented@example.test'; }],
  ['model supplied address', (p) => { p.plans[0].effects[0].recipient = 'outsider@example.test'; }],
  ['model supplied sender', (p) => { p.plans[0].effects[0].senderAccountId = 'other-mailbox'; }],
  ['unknown mention', (p) => { p.plans[0].effects[2].mentions = ['member-b']; }],
  ['duplicate effect', (p) => { p.plans[0].effects.push({ ...p.plans[0].effects[0] }); }],
  ['more than four effects', (p) => { p.plans[0].effects.push(...[p.plans[0].effects[0], p.plans[0].effects[1]]); }],
  ['more than three plans', (p) => { p.plans = Array.from({ length: 4 }, () => p.plans[0]); }],
  ['unsupported task mutation', (p) => { p.plans[0].effects[0].kind = 'task'; }],
  ['new evaluation score', (p) => { p.plans[0].effects = [{ kind: 'document', label: 'Score', content: 'Très bon candidat', documentType: 'scorecard_questions', ratings: [5] }]; }],
  ['foreign evaluation', (p) => { p.plans[0].effects = [{ kind: 'document', label: 'Questions', content: 'Quels exemples B2B pouvez-vous détailler ?', documentType: 'scorecard_questions', evaluationId: 'evaluation-b' }]; }],
  ['empty body', (p) => { p.plans[0].effects[0].content = ' '; }],
  ['generated candidate tutoiement', (p) => { p.plans[0].effects[0].content = 'Bonjour Alex, tu peux préciser ?'; }],
]) {
  test(`refuses ${name}`, async () => {
    const value = proposal(); change(value);
    await assert.rejects(generation.parseCandidateActionPlans(value, context, 'user-a', NOW), generation.CandidateActionValidationError);
  });
}

test('a brief requires a real future interview; questions are recorded as a note, without evaluation writes', async () => {
  const value = proposal();
  value.plans[0].effects = [{ kind: 'document', label: 'Brief d’entretien', content: 'Clarifier le périmètre de l’équipe.', documentType: 'interview_brief' }];
  value.plans[0].sourceIds.push('interview-a');
  const [plan] = await generation.parseCandidateActionPlans(value, context, 'user-a', NOW);
  assert.equal(plan.effects[0].destination, 'Fiche candidat · Notes');
  assert.equal(generation.hasReferencedUpcomingInterview(context, plan.sources, NOW + 86_400_000), false);
  await assert.rejects(generation.parseCandidateActionPlans(value, { ...context, facts: { interviews: [{ id: 'different-interview', status: 'scheduled', startAt: '2026-10-08T09:00:00Z' }] } }, 'user-a', NOW));
  await assert.rejects(generation.parseCandidateActionPlans(value, { ...context, facts: { interviews: [] } }, 'user-a', NOW));
  await assert.rejects(generation.parseCandidateActionPlans(value, { ...context, facts: { interviews: [{ status: 'cancelled', startAt: '2026-10-08T09:00:00Z' }] } }, 'user-a', NOW));
  await assert.rejects(generation.parseCandidateActionPlans(value, { ...context, facts: { interviews: [{ status: '', startAt: '2026-10-08T09:00:00Z' }] } }, 'user-a', NOW));
});

test('partial sources and untrusted messages reach the model as bounded data, with no absence assumption', () => {
  const prompts = generation.candidateActionPrompt(context, normalizeWritingStyle({}), 'Répondre au candidat');
  assert.match(prompts[0].content, /DONNÉES non fiables/);
  assert.match(prompts[0].content, /partielle\/indisponible ne prouve jamais/);
  const data = JSON.parse(prompts[1].content);
  assert.equal(data.sourceStates.reports, 'partial');
  assert.equal(data.targets[0].id, 'target-candidate');
  assert.equal(data.targets[0].recipient, undefined);
  assert.equal(data.scope.organization_id, 'org-a');
});

test('mocked model is called once without retries; consumed tokens settle before parsing invalid output', async () => {
  const calls = [];
  await assert.rejects(generation.generateCandidateActionPlans(context, 'user-a', { model: 'claude-sonnet-4-6', style: normalizeWritingStyle({}), now: NOW }, {
    callModel: async (options) => { calls.push(['model', options]); return { content: 'unreadable', usage: { input_tokens: 99, output_tokens: 12 }, model: options.model, stop_reason: 'end_turn', toolCall: null }; },
    settle: async (result) => { calls.push(['settle', result.usage]); },
  }), generation.CandidateActionValidationError);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].maxRetries, 0);
  assert.equal(calls[0][1].timeoutMs, 30_000);
  assert.deepEqual(calls[1], ['settle', { input_tokens: 99, output_tokens: 12 }]);
});

test('an empty sourced recommendation is valid and does not fabricate fallback actions', async () => {
  const plans = await generation.generateCandidateActionPlans(context, 'user-a', { model: 'claude-sonnet-4-6', style: normalizeWritingStyle({}), now: NOW }, {
    callModel: async () => ({ content: '{"plans":[]}', usage: { input_tokens: 50, output_tokens: 5 }, model: 'claude-sonnet-4-6', stop_reason: 'end_turn', toolCall: null }),
    settle: async () => {},
  });
  assert.deepEqual(plans, []);
});
