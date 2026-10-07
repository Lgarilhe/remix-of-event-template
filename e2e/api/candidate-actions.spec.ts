/** Vraies Auth/RLS/RPC/edge functions locales ; tous les prestataires sont simulés. */
import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { E2E } from '../helpers/env';
import { admin, addMember, createOrg, deleteOrg, seedCandidateRow, seedMission, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
import { callFunction, engineAvailable, ENGINE_SKIP_REASON, mockCalls, postJson, rand, setMockMode, setPaidPlan, webhook, WEBHOOK_SECRET } from '../helpers/sequence-engine';
import type { CandidateActionPlan, CandidateActionScope } from '../../supabase/functions/_shared/candidate-actions/types';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(90_000);
const orgs: Array<{ org: TestOrg; members: TestUser[] }> = [];
const mockKeys: string[] = [];
test.afterEach(async () => {
  for (const key of mockKeys.splice(0)) await setMockMode(key, {});
  for (const { org, members } of orgs.splice(0)) await deleteOrg(org, members).catch(() => undefined);
});

async function setup(credits = 60) {
  const org = await createOrg('agency', 'E2E actions réelles');
  const record = { org, members: [] as TestUser[] };
  orgs.push(record);
  await setPaidPlan(org.orgId);
  const missionId = await seedMission(org.orgId, org.owner.userId);
  const candidateId = `ACoAAActions${rand()}`;
  const email = `${rand()}@candidate.konekt.test`;
  const accountId = `email_actions_${rand()}`;
  const marker = `Actions${rand()}`;
  await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId, missionId });
  for (const [table, row] of [
    ['candidate_contacts', { organization_id: org.orgId, candidate_id: candidateId, email, phone: '+33612345678', source: 'manual', updated_by: org.owner.userId }],
    ['member_email_accounts', { organization_id: org.orgId, user_id: org.owner.userId, email_account_id: accountId, email_address: org.owner.email, provider: 'GOOGLE', account_status: 'OK', linked_by: org.owner.userId }],
    ['candidate_notes', { organization_id: org.orgId, candidate_id: candidateId, created_by: org.owner.userId, content: `Disponibilité mardi matin ; le candidat attend les précisions du manager. ${marker}` }],
  ] as const) {
    const { error } = await admin().from(table).insert(row);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { error } = await admin().from('ai_credit_balances').upsert({ organization_id: org.orgId, plan_credits: credits, topup_credits: 0,
    credits_total: credits, credits_remaining: credits, period_start: new Date().toISOString(), period_end: new Date(Date.now() + 20 * 86400000).toISOString() }, { onConflict: 'organization_id' });
  if (error) throw new Error(error.message);
  const token = (await signIn(org.owner.email, org.owner.password)).access_token;
  const scope: CandidateActionScope = { organization_id: org.orgId, candidate_id: candidateId, project_id: missionId };
  mockKeys.push(accountId);
  await setMockMode(accountId, { action_recipes: { [marker]: { effects: [
    { kind: 'document', label: 'Conserver le suivi', content: 'Attendre les précisions du manager et revenir vers le candidat.', documentType: 'follow_up' },
    { kind: 'message', label: 'Réponse candidat', content: 'Bonjour, merci pour vos disponibilités. Je reviens vers vous dès réception des précisions.', subject: 'Suite à notre échange' },
  ] } }, routes: [{ method: 'POST', path: '^/api/v1/emails$', status: 201, body: { id: `mail_${marker}`, provider_id: `provider_${marker}`, thread_id: `thread_${marker}` } }] });
  return { org, record, missionId, candidateId, email, accountId, marker, token, scope };
}

async function action(token: string, scope: CandidateActionScope, extra: Record<string, unknown>) {
  return callFunction('candidate-actions', token, { ...scope, ...extra });
}
async function generate(f: Awaited<ReturnType<typeof setup>>) {
  const res = await action(f.token, f.scope, { action: 'generate' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const plans = res.body.plans as CandidateActionPlan[];
  const plan = plans.find(item => item.status === 'draft');
  expect(plan).toBeDefined();
  return plan!;
}
async function approve(f: Awaited<ReturnType<typeof setup>>, plan: CandidateActionPlan) {
  const res = await action(f.token, f.scope, { action: 'approve', plan_id: plan.id, revision: plan.revision });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.plan as CandidateActionPlan;
}
async function execute(f: Awaited<ReturnType<typeof setup>>, plan: CandidateActionPlan, effectId: string) {
  const res = await action(f.token, f.scope, { action: 'execute_effect', plan_id: plan.id, effect_id: effectId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.plan as CandidateActionPlan;
}
async function sends(accountId: string) { return (await mockCalls(accountId)).filter(c => c.method === 'POST' && c.path === '/api/v1/emails'); }

test('@critical liaison e-mail attestée : revendication REST refusée, callback signé et dissociation exacte', async () => {
  const f = await setup();
  const browserHeaders = { apikey: E2E.anonKey, Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' };
  for (const [method, suffix, body] of [
    ['POST', '', { organization_id: f.org.orgId, user_id: f.org.owner.userId, linked_by: f.org.owner.userId,
      email_account_id: `forged_${rand()}`, account_status: 'OK' }],
    ['PATCH', `?email_account_id=eq.${f.accountId}`, { email_account_id: `forged_${rand()}`, account_status: 'OK' }],
  ] as const) {
    const response = await fetch(`${E2E.supabaseUrl}/rest/v1/member_email_accounts${suffix}`, {
      method, headers: browserHeaders, body: JSON.stringify(body),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(403);
    expect(result.code).toBe('42501');
  }
  const hostedAccountId = `email_hosted_${rand()}`;
  mockKeys.push(hostedAccountId);
  await setMockMode(hostedAccountId, { routes: [{ method: 'GET', unscoped: true, path: `^/api/v1/accounts/${hostedAccountId}$`, body: {
    id: hostedAccountId, type: 'GOOGLE', name: f.org.owner.email, sources: [{ status: 'OK' }],
    connection_params: { mail: { imap_user: f.org.owner.email } },
  } }] });
  const state = `user:${f.org.owner.userId}|org:${f.org.orgId}|providers:GOOGLE|expires:${Date.now() + 10 * 60_000}`;
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(state).digest('hex');
  const payload = { status: 'CREATION_SUCCESS', account_id: hostedAccountId, name: state };
  const rejected = await postJson('/functions/v1/unipile-webhook?hosted_sig=invalid', payload);
  expect(rejected.status).toBe(401);
  const connected = await postJson(`/functions/v1/unipile-webhook?hosted_sig=${signature}`, payload);
  expect(connected.status, JSON.stringify(connected.body)).toBe(200);
  const { data: mapping, error } = await admin().from('member_email_accounts').select('*').eq('email_account_id', hostedAccountId).single();
  expect(error).toBeNull();
  expect(mapping).toMatchObject({ organization_id: f.org.orgId, user_id: f.org.owner.userId,
    linked_by: f.org.owner.userId, email_address: f.org.owner.email, account_status: 'OK' });
  const foreign = await createOrg('agency', 'E2E foreign mailbox');
  orgs.push({ org: foreign, members: [] });
  const { data: foreignMapping, error: foreignError } = await admin().from('member_email_accounts').insert({
    organization_id: foreign.orgId, user_id: foreign.owner.userId, linked_by: foreign.owner.userId, email_account_id: `foreign_${rand()}`,
  }).select('*').single();
  expect(foreignError).toBeNull();
  const remove = (mappingId: string, expectedAccountId: string) => callFunction('unipile-accounts', f.token, {
    action: 'unlink_email_account', organization_id: f.org.orgId, mapping_id: mappingId, expected_account_id: expectedAccountId,
  });
  expect((await remove(foreignMapping!.id, foreignMapping!.email_account_id)).status).toBe(403);
  expect((await remove(mapping!.id, 'previous-account-id')).status).toBe(409);
  const removed = await remove(mapping!.id, hostedAccountId);
  expect(removed.status, JSON.stringify(removed.body)).toBe(200);
  const remaining = await admin().from('member_email_accounts').select('id').eq('id', mapping!.id);
  expect(remaining.data).toEqual([]);
  expect((await mockCalls()).filter(call => call.method === 'DELETE' && call.path === `/api/v1/accounts/${hostedAccountId}`)).toHaveLength(0);
});

test('@critical préparation durable, modification et validation : aucun envoi avant confirmation ; exécution concurrente une seule fois', async () => {
  const f = await setup();
  let plan = await generate(f);
  expect(plan.status).toBe('draft');
  expect(await sends(f.accountId)).toHaveLength(0);
  const before = await action(f.token, f.scope, { action: 'execute_effect', plan_id: plan.id, effect_id: plan.effects[1].id });
  expect(before.status).toBeGreaterThanOrEqual(400);
  const saved = await action(f.token, f.scope, { action: 'save', plan_id: plan.id, revision: plan.revision,
    edits: { [plan.effects[1].id]: { content: 'Bonjour, merci. Je vous confirme la réception de vos disponibilités.', subject: 'Disponibilités reçues' } } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  plan = saved.body.plan as CandidateActionPlan;
  const stale = await action(f.token, f.scope, { action: 'save', plan_id: plan.id, revision: 1, edits: {} });
  expect(stale.status).toBeGreaterThanOrEqual(400);
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect((listed.body.plans as CandidateActionPlan[])[0].effects[1].content).toContain('réception');
  expect(await sends(f.accountId)).toHaveLength(0);
  plan = await approve(f, plan);
  expect(await sends(f.accountId)).toHaveLength(0);
  plan = await execute(f, plan, plan.effects[0].id);
  expect(plan.effects[0].status).toBe('succeeded');
  const results = await Promise.all([execute(f, plan, plan.effects[1].id), execute(f, plan, plan.effects[1].id)]);
  expect(results.some(p => p.status === 'completed')).toBe(true);
  expect(await sends(f.accountId)).toHaveLength(1);
  const durable = await action(f.token, f.scope, { action: 'list' });
  expect(durable.status, JSON.stringify(durable.body)).toBe(200);
  expect((durable.body.plans as CandidateActionPlan[])[0].status).toBe('completed');
  expect(durable.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'outbound', audience: 'candidate', content: expect.stringContaining('réception'), sender: f.org.owner.email, recipient: f.email })]));
  const { count } = await admin().from('candidate_notes').select('id', { count: 'exact', head: true }).eq('id', plan.effects[0].id);
  expect(count).toBe(1);
});

test('@critical résultat partiel : la note reste enregistrée, seul le message refusé peut être repris', async () => {
  const f = await setup();
  let plan = await approve(f, await generate(f));
  await setMockMode(f.accountId, { routes: [{ method: 'POST', path: '^/api/v1/emails$', status: 400, body: { error: 'rejected' }, times: 1 }, { method: 'POST', path: '^/api/v1/emails$', status: 201, body: { id: 'retry_mail' } }] });
  plan = await execute(f, plan, plan.effects[0].id);
  plan = await execute(f, plan, plan.effects[1].id);
  expect(plan.status).toBe('partial');
  expect(plan.effects.map(e => e.status)).toEqual(['succeeded', 'failed']);
  plan = await execute(f, plan, plan.effects[1].id);
  expect(plan.status).toBe('completed');
  expect(await sends(f.accountId)).toHaveLength(2);
  await execute(f, plan, plan.effects[0].id);
  const { count } = await admin().from('candidate_notes').select('id', { count: 'exact', head: true }).eq('id', plan.effects[0].id);
  expect(count).toBe(1);
});

test('@critical réponse ambiguë du service : résultat inconnu durable, jamais renvoyé automatiquement', async () => {
  const f = await setup();
  let plan = await approve(f, await generate(f));
  await setMockMode(f.accountId, { routes: [{ method: 'POST', path: '^/api/v1/emails$', status: 502, body: { error: 'gateway' } }] });
  plan = await execute(f, plan, plan.effects[1].id);
  expect(plan.effects[1].status).toBe('unknown');
  await execute(f, plan, plan.effects[1].id);
  expect(await sends(f.accountId)).toHaveLength(1);
});

test('@critical nouveau contexte, boîte déconnectée, mission ou organisation incorrecte : aucun envoi', async () => {
  const f = await setup();
  const plan = await generate(f);
  const wrong = await action(f.token, { ...f.scope, candidate_id: 'ACoUnknown' }, { action: 'approve', plan_id: plan.id, revision: plan.revision });
  expect(wrong.status).toBeGreaterThanOrEqual(400);
  const foreign = await createOrg('agency', 'E2E foreign');
  orgs.push({ org: foreign, members: [] });
  expect((await action(f.token, { ...f.scope, organization_id: foreign.orgId }, { action: 'list' })).status).toBe(403);
  await admin().from('candidate_notes').insert({ organization_id: f.org.orgId, candidate_id: f.candidateId, created_by: f.org.owner.userId, content: 'Le candidat vient de modifier ses disponibilités.' });
  const changed = await action(f.token, f.scope, { action: 'approve', plan_id: plan.id, revision: plan.revision });
  expect(changed.status).toBe(409);
  expect(changed.body.error_code).toBe('ACTION_CONTEXT_CHANGED');
  const refreshed = await generate(f);
  await admin().from('member_email_accounts').update({ account_status: 'DISCONNECTED' }).eq('email_account_id', f.accountId);
  expect((await action(f.token, f.scope, { action: 'approve', plan_id: refreshed.id, revision: refreshed.revision })).status).toBeGreaterThanOrEqual(400);
  expect(await sends(f.accountId)).toHaveLength(0);
});

test('@critical crédits insuffisants : aucune préparation, aucun appel au modèle', async () => {
  const f = await setup(0);
  const res = await action(f.token, f.scope, { action: 'generate' });
  expect(res.status, JSON.stringify(res.body)).toBe(402);
  expect((await mockCalls()).filter(c => c.path === '/v1/messages' && JSON.stringify(c.body).includes(f.marker))).toHaveLength(0);
  expect(await sends(f.accountId)).toHaveLength(0);
});

test('@critical deux recruteurs : brouillons privés et document métier créé une seule fois', async () => {
  const f = await setup();
  const colleague = await addMember(f.org.orgId, 'member', 'actions-colleague');
  f.record.members.push(colleague);
  const colleagueAccount = `email_colleague_${rand()}`;
  mockKeys.push(colleagueAccount);
  await admin().from('member_email_accounts').insert({ organization_id: f.org.orgId, user_id: colleague.userId, email_account_id: colleagueAccount, email_address: colleague.email, provider: 'OUTLOOK', account_status: 'OK', linked_by: colleague.userId });
  const token = (await signIn(colleague.email, colleague.password)).access_token;
  const first = await generate(f);
  const privatePlan = await action(token, f.scope, { action: 'approve', plan_id: first.id, revision: first.revision });
  expect(privatePlan.status).toBeGreaterThanOrEqual(400);
  const other = { ...f, token, accountId: colleagueAccount };
  const second = await generate(other);
  expect(first.effects[0].dedupeKey).toBe(second.effects[0].dedupeKey);
  const firstApproved = await approve(f, first);
  const secondApproved = await approve(other, second);
  const executions = await Promise.all([action(f.token, f.scope, { action: 'execute_effect', plan_id: firstApproved.id, effect_id: first.effects[0].id }),
    action(other.token, f.scope, { action: 'execute_effect', plan_id: secondApproved.id, effect_id: second.effects[0].id })]);
  expect(executions.some(result => result.status === 200 && (result.body.plan as CandidateActionPlan).effects[0].status === 'succeeded')).toBe(true);
  for (const result of executions) {
    expect([200, 409]).toContain(result.status);
    if (result.status === 409) expect(result.body.error_code).toBe('ACTION_CONTEXT_CHANGED');
  }
  const { count } = await admin().from('candidate_notes').select('id', { count: 'exact', head: true }).in('id', [first.effects[0].id, second.effects[0].id]);
  expect(count).toBe(1);
});

test('@critical e-mail reçu hors séquence : historique candidat durable, idempotent et ancienne réponse invalidée', async () => {
  const f = await setup();
  const plan = await approve(f, await generate(f));
  const providerId = `incoming_${rand()}`;
  await setMockMode(f.accountId, { routes: [{ method: 'GET', path: `^/api/v1/emails/${providerId}$`, body: {
    id: providerId, provider_id: providerId, account_id: f.accountId, date: new Date().toISOString(), thread_id: `thread_${rand()}`,
    from_attendee: { identifier: f.email }, to_attendees: [{ identifier: f.org.owner.email }], subject: 'Nouvelle disponibilité', body_plain: 'Finalement je serai disponible mercredi matin.',
  } }] });
  const event = { event: 'mail_received', account_id: f.accountId, email_id: providerId, provider_id: providerId, from_attendee: { identifier: f.email }, to_attendees: [{ identifier: f.org.owner.email }] };
  await webhook(event);
  await webhook(event);
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'inbound', audience: 'candidate', candidate_id: f.candidateId, project_id: f.missionId, content: 'Finalement je serai disponible mercredi matin.' })]));
  expect((listed.body.messages as unknown[]).length).toBe(1);
  const stale = await action(f.token, f.scope, { action: 'execute_effect', plan_id: plan.id, effect_id: plan.effects[1].id });
  expect(stale.status).toBe(409);
  expect(await sends(f.accountId)).toHaveLength(0);
});

test('@critical WhatsApp personnel : envoi réel vérifié, réponse rattachée et aucune écriture de séquence LinkedIn', async () => {
  const f = await setup();
  const accountId = `wa_actions_${rand()}`;
  mockKeys.push(accountId);
  const { error } = await admin().from('member_whatsapp_accounts').insert({ organization_id: f.org.orgId, user_id: f.org.owner.userId,
    whatsapp_account_id: accountId, phone_number: '+33687654321', name: 'Mon WhatsApp', account_status: 'OK' });
  if (error) throw new Error(error.message);
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { effects: [
    { kind: 'message', channel: 'whatsapp', label: 'Répondre sur WhatsApp', content: 'Bonjour, merci. Je reviens vers vous avec les précisions demandées.' },
  ] } } });
  let plan = await approve(f, await generate(f));
  const chatId = `wa_chat_${rand()}`;
  const providerId = `wa_incoming_${rand()}`;
  await setMockMode(accountId, { routes: [
    { method: 'POST', path: '^/api/v1/chats$', status: 201, body: { message_id: `wa_sent_${rand()}`, chat_id: chatId } },
    { unscoped: true, method: 'GET', path: `^/api/v1/messages/${providerId}$`, body: { id: providerId, provider_id: providerId, account_id: accountId, chat_id: chatId, timestamp: new Date().toISOString(), is_sender: false, text: 'Merci, voici mon portfolio.' } },
    { unscoped: true, method: 'GET', path: `^/api/v1/chats/${chatId}$`, body: { id: chatId, account_id: accountId, type: 0 } },
    { unscoped: true, method: 'GET', path: `^/api/v1/chats/${chatId}/attendees$`, body: { items: [{ is_self: 1, provider_id: '33687654321@s.whatsapp.net' }, { is_self: 0, provider_id: '33612345678@s.whatsapp.net' }] } },
  ] });
  plan = await execute(f, plan, plan.effects[0].id);
  expect(plan.status).toBe('completed');
  const calls = (await mockCalls(accountId)).filter(c => c.method === 'POST' && c.path === '/api/v1/chats');
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ account_id: accountId, attendees_ids: '+33612345678' });
  await webhook({ event: 'message_received', account_type: 'WHATSAPP', account_id: accountId, message_id: providerId, chat_id: chatId });
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'whatsapp', direction: 'inbound', audience: 'candidate', content: 'Merci, voici mon portfolio.', project_id: f.missionId })]));
  const { count } = await admin().from('mission_conversations').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  expect(count).toBe(0);
});

test('@critical retour d’un collègue : coordination distincte et nouvelle réponse proposée, sans envoi automatique', async () => {
  const f = await setup();
  const colleague = await addMember(f.org.orgId, 'member', 'actions-manager');
  f.record.members.push(colleague);
  const candidateProviderId = `candidate_sent_${rand()}`;
  const teamProviderId = `team_sent_${rand()}`;
  const threadId = `team_thread_${rand()}`;
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { effects: [
    { kind: 'message', label: 'Informer le candidat', content: 'Bonjour, je reviens vers vous dès réception des précisions.', subject: 'Suite à vos questions' },
    { kind: 'message', audience: 'team', label: 'Demander les précisions', content: 'Bonjour, pouvez-vous confirmer la taille de l’équipe ?', subject: 'Précisions sur le poste' },
  ] } }, routes: [
    { method: 'POST', path: '^/api/v1/emails$', status: 201, body: { provider_id: candidateProviderId, thread_id: `candidate_thread_${rand()}` }, times: 1 },
    { method: 'POST', path: '^/api/v1/emails$', status: 201, body: { provider_id: teamProviderId, thread_id: threadId }, times: 1 },
  ] });
  let plan = await approve(f, await generate(f));
  plan = await execute(f, plan, plan.effects[0].id);
  plan = await execute(f, plan, plan.effects[1].id);
  expect(plan.status).toBe('completed');
  const incomingId = `team_reply_${rand()}`;
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { sourceType: 'team_message', effects: [
    { kind: 'message', label: 'Partager les précisions', content: 'Bonjour, l’équipe commerciale compte huit personnes.', subject: 'Précisions sur l’équipe' },
  ] } }, routes: [{ method: 'GET', path: `^/api/v1/emails/${incomingId}$`, body: { id: incomingId, provider_id: incomingId,
    account_id: f.accountId, thread_id: threadId, in_reply_to: { message_id: teamProviderId }, date: new Date().toISOString(),
    from_attendee: { identifier: colleague.email }, to_attendees: [{ identifier: f.org.owner.email }],
    subject: 'Re: Précisions sur le poste', body_plain: 'L’équipe commerciale compte huit personnes.',
  } }] });
  await webhook({ event: 'mail_received', account_id: f.accountId, email_id: incomingId, provider_id: incomingId,
    from_attendee: { identifier: colleague.email }, to_attendees: [{ identifier: f.org.owner.email }], in_reply_to: { message_id: teamProviderId } });
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'inbound', audience: 'team', candidate_id: f.candidateId, project_id: f.missionId, sender: colleague.email })]));
  expect(await sends(f.accountId)).toHaveLength(2);
  const next = await generate(f);
  expect(next.effects[0].dedupeKey).not.toBe(plan.effects[0].dedupeKey);
  expect(next.sources.some(source => source.type === 'team_message')).toBe(true);
  expect(await sends(f.accountId)).toHaveLength(2);
});

test('@critical historique Gmail importé : privé, stable après relecture et sans envoi', async () => {
  const f = await setup();
  const colleague = await addMember(f.org.orgId, 'member', 'actions-private');
  f.record.members.push(colleague);
  const at = new Date(Date.now() - 60000).toISOString();
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { sourceType: 'inbound_message', effects: [
    { kind: 'message', label: 'Répondre au candidat', content: 'Bonjour, merci pour votre retour. Je vérifie ces points.', subject: 'Suite à vos questions' },
  ] } }, routes: [{ method: 'GET', path: '^/api/v1/emails$', body: { items: [
    { id: `historical_in_${f.marker}`, provider_id: `historical_in_${f.marker}`, account_id: f.accountId, date: at, thread_id: `old_${f.marker}`, from_attendee: { identifier: f.email }, to_attendees: [{ identifier: f.org.owner.email }], subject: 'Question', body_plain: 'Bonjour, quelle est la taille de l’équipe ?' },
    { id: `historical_out_${f.marker}`, provider_id: `historical_out_${f.marker}`, account_id: f.accountId, date: at, thread_id: `old_${f.marker}`, from_attendee: { identifier: f.org.owner.email }, to_attendees: [{ identifier: f.email }], subject: 'Re: Question', body_plain: 'Je vérifie et je vous tiens au courant.' },
  ], cursor: null } }] });
  const first = await action(f.token, f.scope, { action: 'list' });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.messages).toHaveLength(2);
  const plan = await generate(f);
  const reread = await action(f.token, f.scope, { action: 'list' });
  expect(reread.status, JSON.stringify(reread.body)).toBe(200);
  expect(reread.body.messages).toHaveLength(2);
  expect((reread.body.plans as CandidateActionPlan[])[0].contextVersion).toBe(plan.contextVersion);
  expect((reread.body.plans as CandidateActionPlan[])[0].status).toBe('draft');
  const otherToken = (await signIn(colleague.email, colleague.password)).access_token;
  const privateHistory = await action(otherToken, f.scope, { action: 'list' });
  expect(privateHistory.status, JSON.stringify(privateHistory.body)).toBe(200);
  expect(privateHistory.body.messages).toHaveLength(0);
  expect(privateHistory.body.plans).toHaveLength(0);
  expect(await sends(f.accountId)).toHaveLength(0);
});
