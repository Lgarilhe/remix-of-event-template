import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
const bundled = buildSync({ entryPoints: ['src/lib/candidateActions.ts'], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@': process.cwd() + '/src' } });
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const at = '2026-10-07T10:00:00Z';
const record = (changes = {}) => ({ id: 'ledger-a', organization_id: 'org-a', candidate_id: 'candidate-a', project_id: 'project-a', owner_user_id: 'user-a', account_id: 'account-a', channel: 'email', service: 'gmail', audience: 'candidate', direction: 'inbound', provider_message_id: 'provider-a', provider_thread_id: 'thread-a', in_reply_to: null, counterpart: 'candidate@example.test', sender: 'candidate@example.test', recipient: 'recruiter@example.test', subject: 'Question', content: '<p>Une précision ?</p>', occurred_at: at, action_plan_id: null, effect_id: null, created_at: at, ...changes });
const message = (changes = {}) => ({ id: 'reply', kind: 'message', audience: 'candidate', channel: 'email', service: 'outlook', recipient: 'candidate@example.test', senderAccountId: 'account-a', senderAddress: 'recruiter@example.test', content: 'Réponse vérifiée', status: 'succeeded', result: { completedAt: at, providerId: 'provider-a' }, ...changes });
const plan = (effects) => ({ id: 'plan-a', status: 'partial', effects });

test('candidate history includes real inbound mail but excludes internal replies', () => {
  const events = ui.mergeCandidateActionEvents([], [], [], [record(), record({ id: 'team', audience: 'team', content: 'Commentaire interne' })], 'account-a');
  assert.equal(events.length, 1);
  assert.equal(events[0].direction, 'inbound');
  assert.equal(events[0].recipient, 'candidate@example.test');
  assert.equal(events[0].service, 'gmail');
  assert.equal(events[0].finalMessage, 'Une précision ?');
});

test('historical messages without a known mission keep that distinction in the shared timeline', () => {
  const [event] = ui.mergeCandidateActionEvents([], [], [], [record({ project_id: null })]);
  assert.equal(event.missionUnidentified, true);
});

test('provider IDs deduplicate within a sending account without erasing another recruiter’s mail', () => {
  const ledger = [record({ channel: 'linkedin' }), record({ id: 'other-account', account_id: 'account-b', channel: 'linkedin', owner_user_id: 'user-b', direction: 'outbound', content: 'Autre échange' })];
  const events = ui.mergeCandidateActionEvents([], [], [{ id: 'provider-a', text: 'Une précision ?', is_sender: false, timestamp: at }], ledger, 'account-a', id => id === 'user-b' ? 'Claire' : 'Laurent');
  assert.equal(events.length, 1);
  assert.equal(events[0].finalMessage, 'Autre échange');
  assert.equal(events[0].authorName, 'Claire');
});

test('successful plan and normalized ledger produce one copy of the same sent message', () => {
  const sent = message();
  const row = record({ direction: 'outbound', content: sent.content, action_plan_id: 'plan-a', effect_id: 'reply' });
  assert.equal(ui.mergeCandidateActionEvents([], [plan([sent])], [], [row], 'account-a').length, 1);
  assert.equal(ui.mergeCandidateActionEvents([], [plan([sent])], [{ id: 'provider-a', is_sender: true, timestamp: at, text: sent.content }], [row], 'account-a').length, 0);
});

test('unknown, running and failed sends never appear as delivered candidate history', () => {
  const effects = ['unknown', 'running', 'failed', 'prepared'].map(status => message({ id: status, status }));
  assert.deepEqual(ui.mergeCandidateActionEvents([], [plan(effects)], [], [], 'account-a'), []);
  assert.equal(ui.candidateActionCompleted(plan(effects)), false);
  assert.equal(ui.candidateActionCanResume(plan([message({ status: 'failed' })])), true);
  assert.equal(ui.candidateActionCanResume(plan([message({ status: 'unknown' }), message({ status: 'failed' })])), false);
});

test('explicit confirmation counts only effects still to execute after a partial result', () => {
  const effects = [message(), message({ id: 'team', audience: 'team', status: 'failed' }), { id: 'note', kind: 'document', status: 'prepared' }];
  assert.equal(ui.candidateActionConfirmLabel(plan(effects)), 'Envoyer 1 message et enregistrer 1 contenu');
  assert.equal(ui.candidateActionConfirmLabel(plan([{ id: 'note', kind: 'document', status: 'prepared' }])), 'Enregistrer 1 contenu');
});

test('stage-changing candidate LinkedIn sends run after internal writes and other messages', () => {
  const effects = [message({ id: 'linkedin', channel: 'linkedin' }), message({ id: 'email' }), { id: 'note', kind: 'document' }, message({ id: 'team', audience: 'team' })];
  assert.deepEqual(ui.candidateActionExecutionOrder(effects).map(effect => effect.id), ['note', 'email', 'team', 'linkedin']);
  assert.equal(effects[0].id, 'linkedin');
});

test('compact source warnings retain unavailable sources, actual limits and unknown business risks', () => {
  const limited = 'Historique limité aux informations chargées (Notes internes, Historique des échanges).';
  const unavailable = 'E-mails : ces informations n’ont pas pu être chargées. Réessayez pour compléter le contexte.';
  const unknown = 'Deux missions actives correspondent à ce candidat : vérifiez la mission avant de continuer.';
  assert.deepEqual(ui.candidateActionWarningLabels([limited, unavailable, unavailable, unknown]), [
    'Historique limité aux informations chargées (Notes internes, Historique des échanges)',
    'E-mails : informations indisponibles', unknown,
  ]);
});
