/** Vraies Auth/RLS/RPC/edge functions locales ; tous les prestataires sont simulés. */
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import { admin, addMember, createOrg, deleteOrg, seedCandidateRow, seedLinkedInAccount, seedMission, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
import { callBody, callFunction, callsOf, engineAvailable, ENGINE_SKIP_REASON, expectNoV1Calls, expectNoViolations, mockCalls, rand, setMockMode, setPaidPlan, v2, webhook, type MockRoute } from '../helpers/sequence-engine';
import type { CandidateActionPlan, CandidateActionScope } from '../../supabase/functions/_shared/candidate-actions/types';
import { candidateActionExecutionOrder } from '../../src/lib/candidateActions';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(90_000);
const orgs: Array<{ org: TestOrg; members: TestUser[] }> = [];
const mockKeys: string[] = [];
test.afterEach(async () => {
  // Every provider call of a scenario goes through the v2 surface: a call of the previous API is a failure of the scenario.
  await expectNoV1Calls();
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
  const accountId = `acc_${rand()}`;
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
  ] } }, routes: [sendEmailRoute({ id: `mail_${marker}` })] });
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
async function sends(accountId: string) { return callsOf(accountId, 'sendEmail'); }
/** Answer of a scripted e-mail send: the v2 `EmailSent` (the Email id, and the RFC Message-ID the provider may add). */
function sendEmailRoute(sent: { id: string }, extra: Partial<MockRoute> = {}): MockRoute {
  return { method: 'POST', op: 'sendEmail', status: 200, body: { object: 'EmailSent', id: sent.id, message_id: `<${sent.id}@mock.invalid>` }, ...extra };
}
/** A v2 `Email` as the mailbox reads return it: recipients are lists of { email }, there is no account, direction or in_reply_to field. */
function v2Email(fields: { id: string; from: string; to: string; subject: string; body: string; threadId: string; at?: string; headers?: { name: string; value: string }[] }) {
  return { object: 'Email', id: fields.id, message_id: `<${fields.id}@mock.invalid>`, thread_id: fields.threadId, subject: fields.subject, body_plain: fields.body,
    body: `<p>${fields.body}</p>`, snippet: fields.body, headers: fields.headers ?? [], from: [{ email: fields.from }], to: [{ email: fields.to }], cc: [], bcc: [], reply_to: [],
    date: fields.at ?? new Date().toISOString(), attachments: [], folders: ['INBOX'], is_unread: true };
}

test('@critical préparation via tool_use sans texte : proposition persistée, un seul débit et aucun envoi avant validation', async () => {
  const f = await setup();
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { responseMode: 'tool_use', effects: [
    { kind: 'document', label: 'Conserver le suivi', content: 'Attendre les précisions du manager.', documentType: 'follow_up' },
    { kind: 'message', label: 'Répondre au candidat', content: 'Bonjour, merci. Je vous confirme la réception de vos disponibilités.', subject: 'Disponibilités reçues' },
  ] } } });
  const plan = await generate(f);
  expect(plan.status).toBe('draft');
  expect(plan.effects.map(effect => effect.status)).toEqual(['prepared', 'prepared']);
  expect(await sends(f.accountId)).toHaveLength(0);

  const modelCalls = (await mockCalls()).filter(call => call.path === '/v1/messages' && JSON.stringify(call.body).includes(f.marker));
  expect(modelCalls).toHaveLength(1);
  const modelRequest = modelCalls[0].body as Record<string, unknown>;
  expect(modelRequest.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'prepare_candidate_actions', input_schema: expect.objectContaining({ type: 'object' }) })]));
  expect(modelRequest.tool_choice).toMatchObject({ type: 'tool', name: 'prepare_candidate_actions' });

  const persisted = await admin().from('candidate_action_plans').select('id,status,user_id,candidate_id')
    .eq('organization_id', f.org.orgId).eq('candidate_id', f.candidateId);
  expect(persisted.error).toBeNull();
  expect(persisted.data).toEqual([{ id: plan.id, status: 'draft', user_id: f.org.owner.userId, candidate_id: f.candidateId }]);
  const noInternalWrite = await admin().from('candidate_notes').select('id').eq('id', plan.effects[0].id);
  expect(noInternalWrite.error).toBeNull();
  expect(noInternalWrite.data).toEqual([]);

  // Reopening the same preparation uses its receipt and does not call or bill
  // the provider again. Approval is still required before any outbound effect.
  const repeated = await generate(f);
  expect(repeated.id).toBe(plan.id);
  const beforeApproval = await action(f.token, f.scope, { action: 'execute_effect', plan_id: plan.id, effect_id: plan.effects[1].id });
  expect(beforeApproval.status).toBeGreaterThanOrEqual(400);
  expect(await sends(f.accountId)).toHaveLength(0);
  expect((await mockCalls()).filter(call => call.path === '/v1/messages' && JSON.stringify(call.body).includes(f.marker))).toHaveLength(1);

  const transactions = await admin().from('ai_credit_transactions').select('user_id,amount,credits_used,tokens_input,tokens_output')
    .eq('organization_id', f.org.orgId).eq('action', 'candidate_actions');
  expect(transactions.error).toBeNull();
  expect(transactions.data).toEqual([{ user_id: f.org.owner.userId, amount: -2, credits_used: 2, tokens_input: 10, tokens_output: 10 }]);
  const balance = await admin().from('ai_credit_balances').select('plan_credits,topup_credits,credits_total').eq('organization_id', f.org.orgId).single();
  expect(balance.error).toBeNull();
  expect(balance.data).toEqual({ plan_credits: 58, topup_credits: 0, credits_total: 58 });
});

for (const variant of [
  { label: 'titre LinkedIn et objet WhatsApp null', linkedinSubject: 'Suite à notre échange', whatsappSubject: null, execute: true },
  { label: 'objet LinkedIn blanc et titre WhatsApp', linkedinSubject: ' \t\n ', whatsappSubject: 'Précisions demandées', execute: false },
]) {
  test(`@critical préparation multicanal native : ${variant.label}, seul l’e-mail conserve son objet`, async () => {
    const f = await setup();
    const linkedinId = await seedLinkedInAccount(f.org.orgId, f.org.owner.userId, `acc_${rand()}`);
    const whatsappId = `acc_${rand()}`;
    const chatId = `li_subject_${rand()}`;
    mockKeys.push(linkedinId, whatsappId);
    const { error } = await admin().from('member_whatsapp_accounts').insert({ organization_id: f.org.orgId, user_id: f.org.owner.userId,
      whatsapp_account_id: whatsappId, phone_number: '+33687654321', name: 'Mon WhatsApp', account_status: 'OK' });
    if (error) throw new Error(error.message);
    f.scope = { ...f.scope, account_id: linkedinId, chat_id: chatId };
    // A v2 chat has no account of its own and no attendee list: the other participant of the one-to-one
    // chat is its `user`, which the mock builds from the candidate id of the account.
    await setMockMode(linkedinId, { candidate_provider_id: f.candidateId });
    const linkedinContent = 'Bonjour, merci pour votre retour. Je vérifie les précisions demandées.';
    const whatsappContent = 'Bonjour, je vous confirme la réception de vos disponibilités.';
    const emailSubject = '  Précisions sur le poste  ';
    await setMockMode(f.accountId, { action_recipes: { [f.marker]: { responseMode: 'tool_use', effects: [
      { kind: 'message', channel: 'linkedin', label: 'Répondre sur LinkedIn', content: linkedinContent, subject: variant.linkedinSubject },
      { kind: 'message', channel: 'whatsapp', label: 'Répondre sur WhatsApp', content: whatsappContent, subject: variant.whatsappSubject },
      { kind: 'message', channel: 'email', label: 'Envoyer les précisions', content: 'Bonjour, voici les précisions que vous avez demandées.', subject: emailSubject },
    ] } }, routes: [sendEmailRoute({ id: `mail_subject_${rand()}` })] });

    let plan = await generate(f);
    expect(plan.effects).toEqual([
      expect.objectContaining({ kind: 'message', channel: 'linkedin', content: linkedinContent, recipient: f.candidateId, senderAccountId: linkedinId, chatId }),
      expect.objectContaining({ kind: 'message', channel: 'whatsapp', content: whatsappContent, recipient: '+33612345678', senderAccountId: whatsappId }),
      expect.objectContaining({ kind: 'message', channel: 'email', subject: emailSubject.trim(), recipient: f.email, senderAccountId: f.accountId }),
    ]);
    for (const effect of plan.effects.slice(0, 2)) expect(effect).not.toHaveProperty('subject');
    const listed = await action(f.token, f.scope, { action: 'list' });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect((listed.body.plans as CandidateActionPlan[]).find(item => item.id === plan.id)?.effects).toEqual(plan.effects);
    expect((await generate(f)).id).toBe(plan.id);

    const accounts = [linkedinId, whatsappId, f.accountId];
    const outbound = () => mockCalls().then(calls => calls.filter(call => call.method === 'POST' && accounts.includes(call.account_id ?? '')
      && ['sendEmail', 'startChat', 'startChatFromInbox', 'sendMessage'].includes(call.op ?? '')));
    expect(await outbound()).toHaveLength(0);
    const premature = await action(f.token, f.scope, { action: 'execute_effect', plan_id: plan.id, effect_id: plan.effects[0].id });
    expect(premature.status).toBeGreaterThanOrEqual(400);
    expect(await outbound()).toHaveLength(0);
    const modelCalls = (await mockCalls()).filter(call => call.path === '/v1/messages' && JSON.stringify(call.body).includes(f.marker));
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].body).toMatchObject({ tool_choice: { type: 'tool', name: 'prepare_candidate_actions' } });
    const transactions = await admin().from('ai_credit_transactions').select('amount,credits_used,tokens_input,tokens_output')
      .eq('organization_id', f.org.orgId).eq('action', 'candidate_actions');
    expect(transactions.error).toBeNull();
    expect(transactions.data).toEqual([{ amount: -2, credits_used: 2, tokens_input: 10, tokens_output: 10 }]);

    if (variant.execute) {
      plan = await approve(f, plan);
      expect(await outbound()).toHaveLength(0);
      // Match the real client: LinkedIn runs last because its confirmed send
      // can move the candidate into the contacted stage of the pipeline.
      for (const effect of candidateActionExecutionOrder(plan.effects)) plan = await execute(f, plan, effect.id);
      expect(plan.status).toBe('completed');
      const calls = await outbound();
      expect(calls).toHaveLength(3);
      expect(calls.map(call => call.account_id)).toEqual([whatsappId, f.accountId, linkedinId]);
      // The account is in the path, never in the body; a reply in a chat is one JSON message with a text only.
      const linkedinSend = calls.find(call => call.account_id === linkedinId)!;
      expect(linkedinSend.op).toBe('sendMessage');
      expect(linkedinSend.path).toBe(`/v2/${linkedinId}/chats/${chatId}/messages/send`);
      expect(callBody(linkedinSend)).toEqual({ text: linkedinContent });
      // No conversation with this number yet: a new one is started with the phone number as the user.
      const whatsappSend = calls.find(call => call.account_id === whatsappId)!;
      expect(whatsappSend.op).toBe('startChat');
      expect(whatsappSend.path).toBe(`/v2/${whatsappId}/chats/send`);
      expect(callBody(whatsappSend)).toEqual({ text: whatsappContent, users_ids: '+33612345678' });
      const mailSend = calls.find(call => call.account_id === f.accountId)!;
      expect(mailSend.op).toBe('sendEmail');
      expect(callBody(mailSend)).toMatchObject({ subject: emailSubject.trim(), to: [expect.objectContaining({ email: f.email })], html: expect.any(String) });
      for (const key of ['body', 'account_id', 'attendees_ids']) expect(callBody(mailSend)).not.toHaveProperty(key);
      await expectNoViolations(...accounts);
    }
  });
}

test('@critical liaison e-mail attestée : revendication REST refusée, rattachement par la tentative de connexion et dissociation exacte', async () => {
  const f = await setup();
  const browserHeaders = { apikey: E2E.anonKey, Authorization: `Bearer ${f.token}`, 'Content-Type': 'application/json' };
  for (const [method, suffix, body] of [
    ['POST', '', { organization_id: f.org.orgId, user_id: f.org.owner.userId, linked_by: f.org.owner.userId,
      email_account_id: `acc_forged_${rand()}`, account_status: 'OK' }],
    ['PATCH', `?email_account_id=eq.${f.accountId}`, { email_account_id: `acc_forged_${rand()}`, account_status: 'OK' }],
  ] as const) {
    const response = await fetch(`${E2E.supabaseUrl}/rest/v1/member_email_accounts${suffix}`, {
      method, headers: browserHeaders, body: JSON.stringify(body),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(403);
    expect(result.code).toBe('42501');
  }
  // Hosted connection: the member and the organization come from the attempt row (written by the server for the
  // signed-in member), never from the payload. The callback carries the attempt id as `state`.
  const hostedAccountId = `acc_${rand()}`;
  mockKeys.push(hostedAccountId);
  const { data: attempt, error: attemptError } = await admin().from('connection_attempts')
    .insert({ organization_id: f.org.orgId, user_id: f.org.owner.userId, provider: 'google', purpose: 'link', mode: 'hosted' }).select('id').single();
  expect(attemptError).toBeNull();
  const added = (state: string, id?: string) => v2.envelope('account.add', hostedAccountId,
    { object: 'Account', id: hostedAccountId, status: 'running', provider: 'google', name: f.org.owner.email, state },
    { id, name: f.org.owner.email, provider: 'google' });
  // An unknown state links nothing; the real one links the mailbox of the member who started the attempt.
  await webhook(added(crypto.randomUUID()));
  expect((await admin().from('member_email_accounts').select('id').eq('email_account_id', hostedAccountId)).data).toEqual([]);
  await webhook(added(attempt!.id));
  await webhook(added(attempt!.id));
  const { data: mapping, error } = await admin().from('member_email_accounts').select('*').eq('email_account_id', hostedAccountId).single();
  expect(error).toBeNull();
  expect(mapping).toMatchObject({ organization_id: f.org.orgId, user_id: f.org.owner.userId,
    linked_by: f.org.owner.userId, email_address: f.org.owner.email, account_status: 'OK' });
  const foreign = await createOrg('agency', 'E2E foreign mailbox');
  orgs.push({ org: foreign, members: [] });
  const { data: foreignMapping, error: foreignError } = await admin().from('member_email_accounts').insert({
    organization_id: foreign.orgId, user_id: foreign.owner.userId, linked_by: foreign.owner.userId, email_account_id: `acc_foreign_${rand()}`,
  }).select('*').single();
  expect(foreignError).toBeNull();
  const remove = (mappingId: string, expectedAccountId: string) => callFunction('unipile-accounts', f.token, {
    action: 'unlink_email_account', organization_id: f.org.orgId, mapping_id: mappingId, expected_account_id: expectedAccountId,
  });
  expect((await remove(foreignMapping!.id, foreignMapping!.email_account_id)).status).toBe(403);
  expect((await remove(mapping!.id, 'acc_previous')).status).toBe(409);
  const removed = await remove(mapping!.id, hostedAccountId);
  expect(removed.status, JSON.stringify(removed.body)).toBe(200);
  const remaining = await admin().from('member_email_accounts').select('id').eq('id', mapping!.id);
  expect(remaining.data).toEqual([]);
  // Dissociating never closes the mailbox session at the provider.
  expect(await callsOf(hostedAccountId, 'removeAccount')).toHaveLength(0);
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
  await setMockMode(f.accountId, { routes: [{ method: 'POST', op: 'sendEmail', preset: 'validation', times: 1 }, sendEmailRoute({ id: 'retry_mail' })] });
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
  await setMockMode(f.accountId, { routes: [{ method: 'POST', op: 'sendEmail', preset: 'bad_gateway' }] });
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
  const colleagueAccount = `acc_${rand()}`;
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
  // The delivery names the mail; the mail itself is read under the account of the delivery.
  await setMockMode(f.accountId, { routes: [{ method: 'GET', op: 'getEmail', body: v2Email({
    id: providerId, from: f.email, to: f.org.owner.email, threadId: `thread_${rand()}`, subject: 'Nouvelle disponibilité', body: 'Finalement je serai disponible mercredi matin.' }) }] });
  const event = () => v2.emailNew({ accountId: f.accountId, emailId: providerId, from: f.email, to: f.org.owner.email, provider: 'google' });
  await webhook(event());
  await webhook(event());
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'inbound', audience: 'candidate', candidate_id: f.candidateId, project_id: f.missionId, content: 'Finalement je serai disponible mercredi matin.' })]));
  expect((listed.body.messages as unknown[]).length).toBe(1);
  const stale = await action(f.token, f.scope, { action: 'execute_effect', plan_id: plan.id, effect_id: plan.effects[1].id });
  expect(stale.status).toBe(409);
  expect(await sends(f.accountId)).toHaveLength(0);
  await expectNoViolations(f.accountId);
});

test('@critical WhatsApp personnel : envoi réel vérifié, réponse rattachée et aucune écriture de séquence LinkedIn', async () => {
  const f = await setup();
  const accountId = `acc_${rand()}`;
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
  const candidatePhoneId = '33612345678@s.whatsapp.net';
  const user = { object: 'User', id: candidatePhoneId, type: 'individual', display_name: 'Candidat WhatsApp' };
  await setMockMode(accountId, { routes: [
    // No conversation with this number yet: the send starts one and learns its id.
    { method: 'POST', op: 'startChat', status: 200, body: { object: 'ChatStarted', chat_id: chatId, message_id: `wa_sent_${rand()}` } },
    { method: 'GET', op: 'getMessage', body: { object: 'Message', id: providerId, chat_id: chatId, sender_id: candidatePhoneId, sender: user, timestamp: new Date().toISOString(),
      is_sender: false, is_hidden: false, is_seen: false, is_deleted: false, is_event: false, text: 'Merci, voici mon portfolio.', attachments: [], specifics: { type: 'MESSAGE' } } },
    { method: 'GET', op: 'getChat', body: { object: 'Chat', id: chatId, type: '1to1', is_1to1: true, is_group: false, is_readonly: false, user_id: candidatePhoneId, user, provider: 'whatsapp' } },
  ] });
  plan = await execute(f, plan, plan.effects[0].id);
  expect(plan.status).toBe('completed');
  const calls = await callsOf(accountId, 'startChat');
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe(`/v2/${accountId}/chats/send`);
  expect(callBody(calls[0])).toMatchObject({ users_ids: '+33612345678' });
  expect(callBody(calls[0])).not.toHaveProperty('account_id');
  expect(callBody(calls[0])).not.toHaveProperty('attendees_ids');
  // The reply arrives as a message.new of the WhatsApp account; the chat id comes from the delivery.
  await webhook({ ...v2.messageNew({ accountId, chatId, messageId: providerId, senderId: candidatePhoneId, text: 'Merci, voici mon portfolio.' }), account_provider: 'whatsapp' });
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'whatsapp', direction: 'inbound', audience: 'candidate', content: 'Merci, voici mon portfolio.', project_id: f.missionId })]));
  const { count } = await admin().from('mission_conversations').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  expect(count).toBe(0);
  await expectNoViolations(accountId, f.accountId);
});

test('@critical retour d’un collègue : coordination distincte et nouvelle réponse proposée, sans envoi automatique', async () => {
  const f = await setup();
  const colleague = await addMember(f.org.orgId, 'member', 'actions-manager');
  f.record.members.push(colleague);
  const candidateProviderId = `candidate_sent_${rand()}`;
  const teamProviderId = `team_sent_${rand()}`;
  // A v2 send answer carries no thread: the thread of a mail we sent is read from the mail itself (the mock derives it from its id).
  const threadId = `thread_${teamProviderId}`;
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { effects: [
    { kind: 'message', label: 'Informer le candidat', content: 'Bonjour, je reviens vers vous dès réception des précisions.', subject: 'Suite à vos questions' },
    { kind: 'message', audience: 'team', label: 'Demander les précisions', content: 'Bonjour, pouvez-vous confirmer la taille de l’équipe ?', subject: 'Précisions sur le poste' },
  ] } }, routes: [
    sendEmailRoute({ id: candidateProviderId }, { times: 1 }),
    sendEmailRoute({ id: teamProviderId }, { times: 1 }),
  ] });
  let plan = await approve(f, await generate(f));
  plan = await execute(f, plan, plan.effects[0].id);
  plan = await execute(f, plan, plan.effects[1].id);
  expect(plan.status).toBe('completed');
  const incomingId = `team_reply_${rand()}`;
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { sourceType: 'team_message', effects: [
    { kind: 'message', label: 'Partager les précisions', content: 'Bonjour, l’équipe commerciale compte huit personnes.', subject: 'Précisions sur l’équipe' },
  ] } }, routes: [{ method: 'GET', op: 'getEmail', body: v2Email({
    id: incomingId, from: colleague.email, to: f.org.owner.email, threadId, subject: 'Re: Précisions sur le poste', body: 'L’équipe commerciale compte huit personnes.',
    headers: [{ name: 'In-Reply-To', value: `<${teamProviderId}@mock.invalid>` }] }) }] });
  await webhook(v2.emailNew({ accountId: f.accountId, emailId: incomingId, from: colleague.email, to: f.org.owner.email, provider: 'google', threadId,
    headers: [{ name: 'In-Reply-To', value: `<${teamProviderId}@mock.invalid>` }] }));
  const listed = await action(f.token, f.scope, { action: 'list' });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  expect(listed.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'inbound', audience: 'team', candidate_id: f.candidateId, project_id: f.missionId, sender: colleague.email })]));
  expect(await sends(f.accountId)).toHaveLength(2);
  const next = await generate(f);
  expect(next.effects[0].dedupeKey).not.toBe(plan.effects[0].dedupeKey);
  expect(next.sources.some(source => source.type === 'team_message')).toBe(true);
  expect(await sends(f.accountId)).toHaveLength(2);
  await expectNoViolations(f.accountId);
});

test('@critical historique Gmail importé : privé, stable après relecture et sans envoi', async () => {
  const f = await setup();
  const colleague = await addMember(f.org.orgId, 'member', 'actions-private');
  f.record.members.push(colleague);
  const at = new Date(Date.now() - 60000).toISOString();
  await setMockMode(f.accountId, { action_recipes: { [f.marker]: { sourceType: 'inbound_message', effects: [
    { kind: 'message', label: 'Répondre au candidat', content: 'Bonjour, merci pour votre retour. Je vérifie ces points.', subject: 'Suite à vos questions' },
  ] } }, routes: [{ method: 'GET', op: 'getEmailsList', body: { data: [
    v2Email({ id: `historical_in_${f.marker}`, from: f.email, to: f.org.owner.email, threadId: `old_${f.marker}`, at, subject: 'Question', body: 'Bonjour, quelle est la taille de l’équipe ?' }),
    v2Email({ id: `historical_out_${f.marker}`, from: f.org.owner.email, to: f.email, threadId: `old_${f.marker}`, at, subject: 'Re: Question', body: 'Je vérifie et je vous tiens au courant.' }),
  ] } }] });
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
  // The history is read on the path of the member's own mailbox, never on a colleague's.
  const reads = await callsOf(f.accountId, 'getEmailsList');
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(call => call.path === `/v2/${f.accountId}/emails` && call.query.any_email === f.email)).toBe(true);
  await expectNoViolations(f.accountId);
});
