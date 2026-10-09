import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const bundled = buildSync({ entryPoints: ['src/lib/multichannelInbox.ts'], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@': process.cwd() + '/src' } });
const { groupMultichannelConversations: group } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const now = new Date('2026-10-07T12:00:00Z');
const row = (changes = {}) => ({ id: 'message-a', organization_id: 'org-a', candidate_id: 'candidate-a', project_id: 'project-a', owner_user_id: 'user-a', account_id: 'mailbox-a', channel: 'email', service: 'gmail', audience: 'candidate', direction: 'inbound', provider_message_id: 'provider-a', provider_thread_id: 'mail-thread', in_reply_to: null, counterpart: 'candidate@example.test', sender: 'candidate@example.test', recipient: 'recruiter@example.test', subject: 'Question', content: 'Une précision ?', occurred_at: now.toISOString(), action_plan_id: null, effect_id: null, created_at: now.toISOString(), ...changes });
const label = (changes = {}) => ({ candidate_id: 'candidate-a', candidate_name: 'Camille Durand', linkedin_profile_url: null, linkedin_profile_data: { work_experience: [{ company: 'Atlas', company_logo: 'https://example.test/atlas.png', title: 'Développeuse' }] }, project_id: 'project-a', job_id: 'job-a', ...changes });
const project = (changes = {}) => ({ id: 'project-a', name: 'Mission Atlas', job_title: 'Développeuse React', job_id: 'job-a', ...changes });

test('standalone email and WhatsApp keep canonical identity without inventing a LinkedIn chat', () => {
  const [conversation] = group([row()], [label()], [project()], now);
  assert.equal(conversation.candidateId, 'candidate-a');
  assert.equal(conversation.accountId, 'mailbox-a');
  assert.equal(conversation.candidateName, 'Camille Durand');
  assert.equal(conversation.profile.work_experience[0].company_picture_url, 'https://example.test/atlas.png');
  assert.equal(conversation.state, 'to_reply');
  assert.equal(conversation.linkedinUrl, null);
  assert.equal('chat_id' in conversation, false);
  assert.equal('attendees' in conversation, false);
});

test('entries preserve exact organization, project, owner and mailbox instead of merging recipients', () => {
  const rows = [row(), row({ id: 'project-b', provider_message_id: 'provider-b', project_id: 'project-b' }), row({ id: 'account-b', account_id: 'mailbox-b' }), row({ id: 'owner-b', owner_user_id: 'user-b', provider_message_id: 'provider-c' }), row({ id: 'org-b', organization_id: 'org-b' })];
  const conversations = group(rows, [label()], [project()], now);
  assert.equal(conversations.length, 5);
  assert.equal(new Set(conversations.map(conversation => conversation.key)).size, 5);
  assert.equal(conversations.every(conversation => conversation.messages.length === 1), true);
});

test('duplicate provider events are removed only within their actual account and organization', () => {
  const conversations = group([row(), row({ id: 'retry' }), row({ id: 'other', account_id: 'mailbox-b' }), row({ id: 'internal', audience: 'team', provider_message_id: 'internal' }), row({ id: 'linkedin', channel: 'linkedin', provider_message_id: 'linkedin' })], [label()], [project()], now);
  assert.equal(conversations.length, 2);
  assert.equal(conversations.reduce((count, conversation) => count + conversation.messages.length, 0), 2);
});

test('unattributed historical mail keeps its null mission and requires a choice for multiple real missions', () => {
  const candidates = [label(), label({ project_id: 'project-b', job_id: 'job-b' })];
  const projects = [project(), project({ id: 'project-b', name: 'Autre mission', job_title: 'Lead React', job_id: 'job-b' }), project({ id: 'unrelated', job_id: 'job-c' })];
  const [conversation] = group([row({ project_id: null })], candidates, projects, now);
  assert.equal(conversation.projectId, null);
  assert.equal(conversation.ambiguousMission, true);
  assert.deepEqual(conversation.availableProjects.map(item => item.id), ['project-a', 'project-b']);
});

test('ambiguous names and profile URLs are not silently chosen from another mission', () => {
  const [conversation] = group([row()], [label({ candidate_name: 'Camille', linkedin_profile_url: 'https://linkedin.com/in/camille' }), label({ candidate_name: 'Alex', linkedin_profile_url: 'https://linkedin.com/in/alex' })], [project()], now);
  assert.equal(conversation.candidateName, 'candidate@example.test');
  assert.equal(conversation.linkedinUrl, null);
});

test('latest actual direction determines response state and chronological display', () => {
  const [conversation] = group([row({ occurred_at: '2026-10-06T11:00:00Z' }), row({ id: 'reply', provider_message_id: 'reply', direction: 'outbound', occurred_at: '2026-10-07T11:00:00Z' })], [label()], [project()], now);
  assert.equal(conversation.latest.id, 'reply');
  assert.equal(conversation.state, 'waiting');
  assert.deepEqual(conversation.messages.map(message => message.id), ['message-a', 'reply']);
});
