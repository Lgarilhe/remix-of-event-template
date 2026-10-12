import { candidateActionStoredEmailSource, loadCandidateActionTargets, readCandidateActionChatContext, readCandidateActionEmailContext, sendCandidateActionMessage, validateCandidateActionChat } from './transport.ts';
import { captureCandidateActionIncoming } from './incoming.ts';
import type { CandidateActionMessageEffect, CandidateActionScope } from './types.ts';
import { jsonResponse, networkError, withMockTransport, type MockReply, type RecordedRequest } from '../unipile/testing.ts';

type Row = Record<string, unknown>;
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

const MAIL = 'acc_own_mail';
const WA = 'acc_own_wa';
const LI = 'acc_own_li';

/** The shape of a v2 e-mail: recipients are arrays of { email }, there is no account, direction or in_reply_to field. */
function v2Email(fields: Row): Row {
  return { object: 'Email', id: 'mail-id', date: '2026-10-07T10:00:00Z', subject: 'Sujet', from: [{ email: 'candidate@example.test' }], to: [{ email: 'recruiter@example.test' }], body_plain: 'Bonjour.', headers: [], ...fields };
}
/** A v2 one-to-one chat: no account id, a string type, the other participant under `user`. */
function v2Chat(fields: Row = {}): Row {
  return { object: 'Chat', id: 'chat-1', type: '1to1', is_1to1: true, user_id: 'ACo-candidate', user: { id: 'ACo-candidate', display_name: 'Candidat Test', public_identifier: 'candidat-test', profile_url: 'https://www.linkedin.com/in/candidat-test' }, ...fields };
}

/** In-memory query adapter: production modules run unmodified, every provider request is intercepted by the shared mock transport. */
function fixture() {
  const org = crypto.randomUUID();
  const user = crypto.randomUUID();
  const member = crypto.randomUUID();
  const scope: CandidateActionScope = { organization_id: org, candidate_id: 'ACo-candidate' };
  const tables: Record<string, Row[]> = {
    organization_members: [{ id: 'own-member', organization_id: org, user_id: user }, { id: 'team-member', organization_id: org, user_id: member }],
    member_email_accounts: [{ organization_id: org, user_id: user, email_account_id: MAIL, email_address: 'recruiter@example.test', provider: 'OUTLOOK', account_status: 'OK' }],
    member_linkedin_accounts: [], member_whatsapp_accounts: [], mission_conversations: [], sequence_enrollments: [],
    candidate_contacts: [{ organization_id: org, candidate_id: scope.candidate_id, email: 'candidate@example.test', phone: '+33600000001' }],
    candidate_action_messages: [], candidate_action_effects: [], job_candidate_status: [], sourcing_projects: [], gdpr_erasures: [], suppressed_emails: [],
  };
  const quotaCalls: Row[] = [];
  const flags = { throwJournal: false, suppressReadError: false, quotaAllowed: true };
  class Query {
    filters: Array<(row: Row) => boolean> = [];
    mode = 'select'; payload: Row | Row[] | null = null; one = false; ignoreDuplicates = false;
    constructor(readonly table: string) {}
    select(_columns?: string) { return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this; }
    is(key: string, value: unknown) { this.filters.push(row => value === null ? row[key] == null : row[key] === value); return this; }
    // PostgREST JSON paths (`result->providerReceipt->>message_id`) are read the way the database reads them.
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(key.includes('->') ? key.split(/->>?/).reduce<unknown>((value, part, index) => index === 0 ? row[part] : (value as Row | undefined)?.[part], null) : row[key])); return this; }
    contains(key: string, values: unknown[]) { this.filters.push(row => Array.isArray(row[key]) && values.every(value => (row[key] as unknown[]).includes(value))); return this; }
    ilike(key: string, value: string) { this.filters.push(row => String(row[key] ?? '').toLowerCase() === value.replace(/\\([%_\\])/g, '$1').toLowerCase()); return this; }
    or(_value: string) { return this; }
    limit(_value: number) { return this; }
    order(_key: string, _options?: unknown) { return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    insert(value: Row | Row[]) { this.mode = 'insert'; this.payload = value; return this; }
    upsert(value: Row | Row[], options?: { ignoreDuplicates?: boolean }) { this.mode = 'insert'; this.payload = value; this.ignoreDuplicates = options?.ignoreDuplicates ?? false; return this; }
    update(value: Row) { this.mode = 'update'; this.payload = value; return this; }
    then(resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      if (this.table === 'candidate_action_messages' && this.mode === 'insert' && flags.throwJournal) return Promise.reject(new Error('journal disconnected')).then(resolve, reject);
      if (this.table === 'suppressed_emails' && flags.suppressReadError) return Promise.resolve({ data: null, error: { message: 'unreadable' } }).then(resolve, reject);
      const rows = (tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)));
      if (this.mode === 'insert') {
        const values = Array.isArray(this.payload) ? this.payload : [this.payload];
        const duplicate = (row: Row | null) => tables[this.table].some(existing => existing.account_id === row?.account_id && existing.provider_message_id === row?.provider_message_id);
        if (!this.ignoreDuplicates && this.table === 'candidate_action_messages' && values.some(duplicate)) return Promise.resolve({ data: null, error: { code: '23505', message: 'Duplicate provider message' } }).then(resolve, reject);
        const inserted = values.filter(row => !this.ignoreDuplicates || !duplicate(row)).map(row => ({ ...row, id: crypto.randomUUID() }));
        tables[this.table].push(...inserted);
        return Promise.resolve({ data: this.one ? inserted[0] : inserted, error: null }).then(resolve, reject);
      }
      if (this.mode === 'update') for (const row of rows) Object.assign(row, this.payload);
      return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    rpc: (name: string, params: Row) => {
      if (name === 'get_org_member_emails') return Promise.resolve({ data: [{ user_id: member, email: 'colleague@example.test' }], error: null });
      if (name === 'check_linkedin_action_quota') { quotaCalls.push(params); return Promise.resolve({ data: { allowed: flags.quotaAllowed, count: 0 }, error: null }); }
      return Promise.resolve({ data: {}, error: null });
    },
    auth: { admin: { getUserById: (id: string) => Promise.resolve({ data: { user: { email: id === member ? 'colleague@example.test' : 'recruiter@example.test' } }, error: null }) } },
  };
  const effect: CandidateActionMessageEffect = { id: crypto.randomUUID(), kind: 'message', label: 'Réponse', content: 'Bonjour, voici notre réponse relue.', status: 'prepared', dedupeKey: 'test-message', targetId: 'mail-target', audience: 'candidate', channel: 'email', service: 'outlook', recipient: 'candidate@example.test', senderAccountId: MAIL, senderAddress: 'recruiter@example.test', subject: 'Suite à votre question' };
  // Scriptable provider: `reads` answers a GET by path, `sends` a POST. The defaults answer a normal send and
  // the read of the mail just sent (its thread is read once, the send answer carries none).
  const state = {
    reads: (request: RecordedRequest): MockReply => request.path === `/${MAIL}/emails/sent-email-id`
      ? jsonResponse(v2Email({ id: 'sent-email-id', thread_id: 'candidate-thread', from: [{ email: 'recruiter@example.test' }], to: [{ email: 'candidate@example.test' }] }))
      : { status: 404, body: { error: 'not found' } },
    sends: (request: RecordedRequest): MockReply => request.path.endsWith('/emails/send')
      ? { body: { object: 'EmailSent', id: 'sent-email-id', message_id: '<rfc-sent@example.test>' } }
      : request.path.endsWith('/chats/send') ? { body: { object: 'ChatStarted', chat_id: 'new-chat', message_id: 'sent-message-id' } } : { body: { object: 'MessageSent', message_id: 'sent-message-id' } },
  };
  const mock = withMockTransport(request => request.method === 'POST' ? state.sends(request) : state.reads(request));
  const posts = () => mock.calls.filter(call => call.method === 'POST');
  return {
    org, user, member, scope, tables, quotaCalls, flags, client, effect, mock, posts,
    reads: (handler: (request: RecordedRequest) => MockReply) => { state.reads = handler; },
    sends: (handler: (request: RecordedRequest) => MockReply) => { state.sends = handler; },
    close: () => mock.restore(),
  };
}

Deno.test('targets only use own active accounts, stored contacts and real member emails', async () => {
  const f = fixture();
  try {
    f.tables.member_email_accounts.push({ organization_id: f.org, user_id: 'colleague', email_account_id: 'acc_other_mail', email_address: 'other@example.test', provider: 'GOOGLE', account_status: 'OK' });
    f.tables.member_whatsapp_accounts.push({ organization_id: f.org, user_id: f.user, whatsapp_account_id: WA, phone_number: '+33600000002', account_status: 'OK' });
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, [{ id: f.member, name: 'Collègue' }]);
    equal(targets.map(target => [target.channel, target.audience, target.recipient]), [['email', 'candidate', 'candidate@example.test'], ['email', 'team', 'colleague@example.test'], ['whatsapp', 'candidate', '+33600000001']]);
    assert(targets.every(target => target.senderAccountId !== 'acc_other_mail'));
    equal(targets[0].service, 'outlook');
    equal(f.mock.calls.length, 0);
  } finally { f.close(); }
});

Deno.test('a degraded, locked or disconnected account is never a target', async () => {
  const f = fixture();
  try {
    for (const status of ['DEGRADED', 'PARTIAL', 'LOCKED', 'CREDENTIALS', 'ERROR']) {
      f.tables.member_email_accounts[0].account_status = status;
      equal(await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []), []);
    }
    equal(f.mock.calls.length, 0);
  } finally { f.close(); }
});

Deno.test('candidate and team identity changes, and unreadable suppression, prevent all sends', async () => {
  const f = fixture();
  try {
    for (const patch of [{ recipient: 'invented@example.test' }, { senderAddress: 'changed@example.test' }, { audience: 'team' as const, memberId: f.member, recipient: 'invented@example.test' }]) {
      const outcome = await sendCandidateActionMessage(f.client, f.user, f.scope, { ...f.effect, ...patch });
      equal(outcome.status, 'failed');
    }
    f.flags.suppressReadError = true;
    const blocked = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
    equal(blocked.result.errorCode, 'SUPPRESSION_UNVERIFIED');
    equal(f.mock.calls.length, 0);
  } finally { f.close(); }
});

Deno.test('real approved email is one JSON request on the account path, records the Email id and its thread', async () => {
  const f = fixture();
  try {
    const effect = { ...f.effect, audience: 'team' as const, memberId: f.member, recipient: 'colleague@example.test' };
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, effect, { planId: 'plan-id' });
    equal(result.status, 'succeeded');
    equal(result.result.providerId, 'sent-email-id');
    equal(result.result.providerThreadId, 'candidate-thread');
    equal(result.result.providerReceipt, { object: 'EmailSent', id: 'sent-email-id', message_id: '<rfc-sent@example.test>' });
    const [post] = f.posts();
    equal(f.posts().length, 1);
    equal(post.path, `/${MAIL}/emails/send`);
    equal(Object.keys(post.body as Row).sort(), ['html', 'subject', 'to']);
    const body = post.body as Row;
    equal(body.to, [{ email: 'colleague@example.test', display_name: 'colleague@example.test' }]);
    equal(body.subject, effect.subject);
    assert(String(body.html).includes('Bonjour'));
    assert(!('body' in body) && !('account_id' in body));
    assert(!('idempotency-key' in post.headers));
    equal(f.tables.candidate_action_messages[0].provider_message_id, 'sent-email-id');
    equal(f.tables.candidate_action_messages[0].provider_thread_id, 'candidate-thread');
    equal(f.tables.candidate_action_messages[0].audience, 'team');
    equal(f.tables.candidate_action_messages[0].action_plan_id, 'plan-id');
    equal(f.tables.candidate_action_messages[0].content, effect.content);
    equal(f.tables.candidate_contacts.length, 1);
  } finally { f.close(); }
});

Deno.test('a send whose thread cannot be read still succeeds without a thread', async () => {
  const f = fixture();
  try {
    f.reads(() => ({ status: 500, body: { error: 'boom' } }));
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
    equal(result.status, 'succeeded');
    equal(result.result.providerId, 'sent-email-id');
    equal(result.result.providerThreadId, undefined);
    equal(f.tables.candidate_action_messages[0].provider_thread_id, null);
  } finally { f.close(); }
});

Deno.test('the RFC Message-ID of a sent mail is kept in the receipt even when the send answer has none', async () => {
  const f = fixture();
  try {
    f.sends(request => request.path.endsWith('/emails/send') ? { body: { object: 'EmailSent', id: 'sent-email-id' } } : { body: {} });
    f.reads(request => request.path === `/${MAIL}/emails/sent-email-id` ? jsonResponse(v2Email({ id: 'sent-email-id', message_id: '<read-back@example.test>', thread_id: 'candidate-thread' })) : { status: 404, body: {} });
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
    equal(result.status, 'succeeded');
    equal(result.result.providerReceipt, { object: 'EmailSent', id: 'sent-email-id', message_id: '<read-back@example.test>' });
  } finally { f.close(); }
});

Deno.test('ambiguous network and server failures are unknown with exactly one POST; rejection is failed', async () => {
  const cases: Array<[string, (request: RecordedRequest) => MockReply, string]> = [
    ['connection lost', () => networkError('Connection lost'), 'unknown'],
    ['503', () => ({ status: 503, body: { error: 'down' } }), 'unknown'],
    ['unreadable success body', () => ({ status: 200, text: 'not json' }), 'unknown'],
    ['an answer without id', () => ({ status: 200, body: { object: 'EmailSent' } }), 'unknown'],
    ['422', () => ({ status: 422, body: { error: 'invalid' } }), 'failed'],
    ['429', () => ({ status: 429, body: { error: 'too many' } }), 'failed'],
  ];
  for (const [label, sends, expected] of cases) {
    const f = fixture();
    try {
      f.sends(sends);
      const result = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
      equal([label, result.status], [label, expected]);
      equal(f.posts().length, 1);
      equal(f.mock.sleeps, []);
      equal(f.tables.candidate_action_messages.length, 0);
      assert(!/unipile|v2|api\//i.test(String(result.result.message)), 'the message names the provider');
    } finally { f.close(); }
  }
});

Deno.test('journal transport exception after confirmed send preserves successful receipt', async () => {
  const f = fixture();
  try {
    f.flags.throwJournal = true;
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
    equal(result.status, 'succeeded');
    equal(result.result.providerId, 'sent-email-id');
    assert(result.result.message?.includes('historique'));
    equal(f.posts().length, 1);
  } finally { f.close(); }
});

Deno.test('an outdated (non acc_) sending account is refused before any provider call', async () => {
  const f = fixture();
  try {
    f.tables.member_email_accounts[0].email_account_id = 'v1-style-id';
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, { ...f.effect, senderAccountId: 'v1-style-id' });
    equal(result.status, 'failed');
    equal(f.mock.calls.length, 0);
    assert(!/unipile|v1/i.test(String(result.result.message)));
  } finally { f.close(); }
});

Deno.test('a colleague chat is refused even when the account is in the same organization', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.member, linkedin_account_id: 'acc_colleague_li', account_status: 'OK' });
    let code = '';
    try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat', account_id: 'acc_colleague_li' }); } catch (error) { code = (error as { code?: string }).code ?? ''; }
    equal(code, 'CHAT_NOT_OWNED');
    equal(f.mock.calls.length, 0);
    equal(f.posts().length, 0);
  } finally { f.close(); }
});

Deno.test('a plan account that nobody carries any more is a changed sender, a limited own account says what is wrong with it', async () => {
  const f = fixture();
  try {
    let code = '';
    let message = '';
    const attempt = async (scope: Partial<CandidateActionScope>) => {
      code = ''; message = '';
      try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat', ...scope }); } catch (error) { code = (error as { code?: string }).code ?? ''; message = (error as Error).message; }
    };
    // The account of the plan was replaced or unlinked: nothing is of a colleague, the sender changed.
    await attempt({ account_id: 'acc_gone_li' });
    equal(code, 'SENDER_CHANGED');
    // A linked account that is only limited is not "another account", whatever the plan names.
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'DEGRADED' });
    for (const [status, expected] of [['DEGRADED', 'temporairement limité'], ['PARTIAL', 'reconnecté'], ['LOCKED', 'verrouillé'], ['CREDENTIALS', 'reconnecté']] as const) {
      f.tables.member_linkedin_accounts[0].account_status = status;
      await attempt({ account_id: LI });
      equal(code, 'SENDER_CHANGED');
      assert(message.includes(expected), `${status}: ${message}`);
      await attempt({});
      equal(code, 'SENDER_CHANGED');
      // The same wording stops the send itself, with no provider call.
      const outcome = await sendCandidateActionMessage(f.client, f.user, f.scope, { ...f.effect, channel: 'linkedin', service: 'linkedin', chatId: 'chat', recipient: 'ACo-candidate', recipientProviderId: 'ACo-candidate', senderAccountId: LI, senderAddress: 'Mon LinkedIn' });
      equal([outcome.status, outcome.result.errorCode], ['failed', 'SENDER_CHANGED']);
      assert(String(outcome.result.message).includes(expected), `${status}: ${outcome.result.message}`);
    }
    equal(f.mock.calls.length, 0);
  } finally { f.close(); }
});

Deno.test('chat ownership is the member own account that the provider answers for, a foreign chat is not reachable', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push(
      { organization_id: f.org, user_id: f.user, linkedin_account_id: 'acc_first_li', account_status: 'OK', linked_at: '2026-10-02' },
      { organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linked_at: '2026-10-01' },
    );
    f.reads(request => request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat()) : { status: 404, body: { error: 'not found' } });
    const verified = await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat-1' });
    equal(verified.accountId, LI);
    assert(verified.candidateIds.includes('ACo-candidate') && verified.candidateIds.includes('candidat-test'));
    equal(verified.candidateName, 'Candidat Test');
    equal(f.mock.calls.map(call => call.path), ['/acc_first_li/chats/chat-1', `/${LI}/chats/chat-1`]);
    // Every own account answers 404/403: the chat is not the member's.
    for (const status of [404, 403]) {
      f.reads(() => ({ status, body: { error: 'nope' } }));
      let code = '';
      try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat-x' }); } catch (error) { code = (error as { code?: string }).code ?? ''; }
      equal(code, 'CHAT_NOT_OWNED');
    }
    // A server fault is not an answer about ownership: retryable, not "not yours".
    f.reads(() => ({ status: 503, body: { error: 'down' } }));
    let code = '';
    try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat-x' }); } catch (error) { code = (error as { code?: string }).code ?? ''; }
    equal(code, 'CHAT_UNVERIFIED');
  } finally { f.close(); }
});

Deno.test('group chats and chats without a readable participant are refused', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK' });
    for (const [chat, expected] of [[v2Chat({ type: 'group', is_1to1: false, is_group: true }), 'GROUP_CHAT_NOT_ALLOWED'], [v2Chat({ type: undefined, is_1to1: undefined }), 'GROUP_CHAT_NOT_ALLOWED'], [v2Chat({ user: undefined, user_id: undefined }), 'RECIPIENT_UNVERIFIED']] as const) {
      f.reads(() => jsonResponse(chat));
      let code = '';
      try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat-1', account_id: LI }); } catch (error) { code = (error as { code?: string }).code ?? ''; }
      equal(code, expected);
    }
  } finally { f.close(); }
});

Deno.test('the candidate of a chat is proven by the stored conversation when the provider id differs', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK' });
    f.reads(() => jsonResponse(v2Chat({ user_id: 'ACo-other', user: { id: 'ACo-other', display_name: 'Autre', public_identifier: 'autre' } })));
    let code = '';
    try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat-1', account_id: LI }); } catch (error) { code = (error as { code?: string }).code ?? ''; }
    equal(code, 'CANDIDATE_MISMATCH');
    f.tables.mission_conversations.push({ organization_id: f.org, account_id: LI, chat_id: 'chat-1', candidate_id: 'ACo-other', candidate_ids: ['ACo-other', 'ACo-candidate'] });
    equal((await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat-1', account_id: LI })).accountId, LI);
  } finally { f.close(); }
});

Deno.test('LinkedIn discovery finds the existing chat of the person under the own account', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn' });
    f.reads(request => request.path === `/${LI}/users/ACo-candidate/chat` ? jsonResponse({ object: 'ChatLookup', data: [{ chat_id: 'empty-chat', has_history: false }, { chat_id: 'chat-1', has_history: true }] })
      : request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat()) : { status: 404, body: {} });
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, [], []);
    equal(targets.map(target => [target.channel, target.chatId, target.senderAccountId, target.recipientProviderId]), [['linkedin', 'chat-1', LI, 'ACo-candidate']]);
    equal(f.mock.calls.map(call => call.method), ['GET', 'GET']);
  } finally { f.close(); }
});

Deno.test('a LinkedIn reply goes through the verified chat of the own account as one JSON message', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn' });
    f.reads(request => request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat()) : { status: 404, body: {} });
    f.sends(() => ({ body: { object: 'MessageSent', message_id: ['li-message-1', 'li-message-2'] } }));
    const effect: CandidateActionMessageEffect = { ...f.effect, channel: 'linkedin', service: 'linkedin', recipient: 'ACo-candidate', recipientProviderId: 'ACo-candidate', chatId: 'chat-1', senderAccountId: LI, senderAddress: 'Mon LinkedIn' };
    delete effect.subject;
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, effect);
    equal(result.status, 'succeeded');
    const [post] = f.posts();
    equal(f.posts().length, 1);
    equal(post.path, `/${LI}/chats/chat-1/messages/send`);
    equal(post.body, { text: effect.content });
    // message_id may be a list: the first id is the journal key, nothing becomes empty.
    equal(result.result.providerId, 'li-message-1');
    equal(result.result.providerThreadId, 'chat-1');
    equal(f.tables.candidate_action_messages[0].provider_message_id, 'li-message-1');
    equal(f.quotaCalls.length, 2);
  } finally { f.close(); }
});

Deno.test('a LinkedIn reply with an unconfirmed outcome is unknown and never repeated', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn' });
    f.reads(request => request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat()) : { status: 404, body: {} });
    f.sends(() => ({ status: 504, body: {} }));
    const effect: CandidateActionMessageEffect = { ...f.effect, channel: 'linkedin', service: 'linkedin', recipient: 'ACo-candidate', recipientProviderId: 'ACo-candidate', chatId: 'chat-1', senderAccountId: LI, senderAddress: 'Mon LinkedIn' };
    delete effect.subject;
    equal((await sendCandidateActionMessage(f.client, f.user, f.scope, effect)).status, 'unknown');
    equal(f.posts().length, 1);
    equal(f.tables.candidate_action_messages.length, 0);
  } finally { f.close(); }
});

Deno.test('LinkedIn chat history is read under the account that owns the chat', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK' });
    f.reads(request => request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat())
      : request.path === `/${LI}/chats/chat-1/messages` ? jsonResponse({ data: [
        { id: 'm2', chat_id: 'chat-1', text: 'Merci pour votre message.', timestamp: '2026-10-07T10:00:00Z', is_sender: false, sender_id: 'ACo-candidate' },
        { id: 'm1', chat_id: 'chat-1', text: 'Bonjour.', timestamp: '2026-10-07T09:00:00Z', is_sender: true, sender_id: 'ACo-me' },
        { id: 'm0', chat_id: 'chat-1', timestamp: '2026-10-07T08:00:00Z', is_sender: false, is_event: true },
      ], next_cursor: 'more' }) : { status: 404, body: {} });
    const history = await readCandidateActionChatContext(f.client, f.user, { ...f.scope, chat_id: 'chat-1', account_id: LI });
    equal(history.messages.map(message => [message.id, message.type, message.author]), [[`linkedin-${LI}-m2`, 'inbound_message', 'Candidat Test'], [`linkedin-${LI}-m1`, 'outbound_message', 'Vous']]);
    equal(history.complete, false);
  } finally { f.close(); }
});

Deno.test('email reply outside any sequence persists full content on its exact candidate', async () => {
  const f = fixture();
  try {
    const mission = crypto.randomUUID();
    f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: 'ats-job' });
    f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: mission, job_id: 'ats-job' });
    f.reads(request => request.path === `/${MAIL}/emails/incoming-id` ? jsonResponse(v2Email({ id: 'incoming-id', message_id: '<rfc-incoming@example.test>', body_plain: 'Mes disponibilités sont mardi.', subject: 'Réponse', thread_id: 'candidate-thread' })) : { status: 404, body: {} });
    const result = await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'incoming-id' });
    equal(result.audience, 'candidate');
    equal(f.tables.candidate_action_messages[0].direction, 'inbound');
    equal(f.tables.candidate_action_messages[0].candidate_id, f.scope.candidate_id);
    equal(f.tables.candidate_action_messages[0].content, 'Mes disponibilités sont mardi.');
    equal(f.tables.candidate_action_messages[0].project_id, mission);
    // The journal key is the Email id, never the RFC Message-ID header.
    equal(f.tables.candidate_action_messages[0].provider_message_id, 'incoming-id');
    equal(f.tables.candidate_action_messages[0].provider_thread_id, 'candidate-thread');
    equal(f.tables.sequence_enrollments.length, 0);
    equal(f.mock.calls.map(call => `${call.method} ${call.path}`), [`GET /${MAIL}/emails/incoming-id`]);
  } finally { f.close(); }
});

Deno.test('incoming WhatsApp binds exact phone and legacy job to a real mission; revoked account is ignored', async () => {
  const f = fixture();
  try {
    const mission = crypto.randomUUID();
    f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: 'ats-external-job' });
    f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: null, job_id: 'ats-external-job' });
    const account = { organization_id: f.org, user_id: f.user, whatsapp_account_id: WA, phone_number: '+33600000002', account_status: 'OK' };
    f.tables.member_whatsapp_accounts.push(account);
    f.reads(request => request.path === `/${WA}/chats/wa-thread/messages/wa-message` ? jsonResponse({ id: 'wa-message', chat_id: 'wa-thread', is_sender: false, text: 'Je suis disponible jeudi.', timestamp: '2026-10-07T10:00:00Z' })
      : request.path === `/${WA}/chats/wa-thread` ? jsonResponse({ id: 'wa-thread', type: '1to1', is_1to1: true, user_id: '33600000001@s.whatsapp.net', user: { id: '33600000001@s.whatsapp.net' } }) : { status: 404, body: {} });
    // The chat id comes from the delivery: a flattened message.new carries it under data.message.
    const delivery = { account_id: WA, message_id: 'wa-message', data: { message: { id: 'wa-message', chat_id: 'wa-thread' } } };
    const result = await captureCandidateActionIncoming(f.client, delivery);
    equal(result.captured, true);
    equal(f.tables.candidate_action_messages[0].project_id, mission);
    equal(f.tables.candidate_action_messages[0].counterpart, '+33600000001');
    equal(f.tables.candidate_action_messages[0].content, 'Je suis disponible jeudi.');
    equal(f.tables.candidate_action_messages[0].provider_thread_id, 'wa-thread');
    account.account_status = 'DELETED';
    equal((await captureCandidateActionIncoming(f.client, { ...delivery, message_id: 'second-wa-message' })).captured, false);
  } finally { f.close(); }
});

Deno.test('an incoming LinkedIn message is bound through the mission conversation link of its chat', async () => {
  const f = fixture();
  try {
    const mission = crypto.randomUUID();
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn' });
    f.tables.mission_conversations.push({ organization_id: f.org, account_id: LI, chat_id: 'chat-1', candidate_id: 'ACo-candidate', candidate_ids: ['ACo-candidate'], project_id: mission });
    f.reads(request => request.path === `/${LI}/chats/chat-1/messages/li-in` ? jsonResponse({ id: 'li-in', chat_id: 'chat-1', is_sender: false, text: 'Bonjour, je suis intéressé.', timestamp: '2026-10-07T10:00:00Z', sender_id: 'ACo-candidate' })
      : request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat()) : { status: 404, body: {} });
    const result = await captureCandidateActionIncoming(f.client, { account_id: LI, message_id: 'li-in', data: { message: { id: 'li-in', chat_id: 'chat-1' }, chat: { id: 'chat-1' } } });
    equal(result.captured, true);
    const row = f.tables.candidate_action_messages[0];
    equal([row.direction, row.counterpart, row.candidate_id, row.project_id, row.channel, row.provider_message_id], ['inbound', 'ACo-candidate', 'ACo-candidate', mission, 'linkedin', 'li-in']);
  } finally { f.close(); }
});

Deno.test('an incoming group chat message is not captured and an unreadable one is replayed', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn' });
    const delivery = { account_id: LI, message_id: 'li-in', data: { message: { id: 'li-in', chat_id: 'chat-1' } } };
    f.reads(request => request.path.endsWith('/messages/li-in') ? jsonResponse({ id: 'li-in', chat_id: 'chat-1', is_sender: false, text: 'Salut.', timestamp: '2026-10-07T10:00:00Z' })
      : jsonResponse(v2Chat({ type: 'group', is_1to1: false, is_group: true })));
    equal((await captureCandidateActionIncoming(f.client, delivery)).captured, false);
    equal(f.tables.candidate_action_messages.length, 0);
    f.reads(() => ({ status: 503, body: {} }));
    let failed = false;
    try { await captureCandidateActionIncoming(f.client, delivery); } catch { failed = true; }
    assert(failed, 'a provider failure must fail the delivery so that it is replayed');
    // A delivery without any chat id cannot be read: replayed as well, never guessed.
    failed = false;
    try { await captureCandidateActionIncoming(f.client, { account_id: LI, message_id: 'li-in' }); } catch { failed = true; }
    assert(failed);
  } finally { f.close(); }
});

Deno.test('a chat that definitively does not answer is not captured, a transient fault still replays the delivery', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn' });
    const delivery = { account_id: LI, message_id: 'li-in', data: { message: { id: 'li-in', chat_id: 'chat-1' } } };
    for (const status of [404, 403]) {
      f.reads(request => request.path.endsWith('/messages/li-in') ? jsonResponse({ id: 'li-in', chat_id: 'chat-1', is_sender: false, text: 'Salut.', timestamp: '2026-10-07T10:00:00Z' }) : { status, body: { error: 'gone' } });
      equal((await captureCandidateActionIncoming(f.client, delivery)).captured, false);
    }
    equal(f.tables.candidate_action_messages.length, 0);
    f.reads(request => request.path.endsWith('/messages/li-in') ? jsonResponse({ id: 'li-in', chat_id: 'chat-1', is_sender: false, text: 'Salut.', timestamp: '2026-10-07T10:00:00Z' }) : { status: 503, body: {} });
    let failed = false;
    try { await captureCandidateActionIncoming(f.client, delivery); } catch { failed = true; }
    assert(failed, 'a transient fault must fail the delivery so that it is replayed');
  } finally { f.close(); }
});

Deno.test('multiple actual missions remain unassigned and raw external job IDs are never used as UUIDs', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 2; index++) {
      const mission = crypto.randomUUID();
      f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: `ats-${index}` });
      f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: mission, job_id: `ats-${index}` });
    }
    f.reads(() => jsonResponse(v2Email({ id: 'ambiguous-mission', body_plain: 'Bonjour.' })));
    equal((await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'ambiguous-mission' })).captured, true);
    equal(f.tables.candidate_action_messages[0].project_id, null);
    f.tables.job_candidate_status = [];
    f.tables.sourcing_projects = [];
    f.tables.sequence_enrollments.push({ organization_id: f.org, profile_id: f.scope.candidate_id, email_used: 'candidate@example.test', job_id: 'external-ats-id' });
    f.reads(() => jsonResponse(v2Email({ id: 'different-message', body_plain: 'Autre réponse.', date: '2026-10-07T10:01:00Z' })));
    equal((await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'different-message' })).captured, true);
    equal(f.tables.candidate_action_messages[1].project_id, null);
  } finally { f.close(); }
});

Deno.test('exact reply identity wins over reused thread; ambiguous thread does not infer a mission', async () => {
  const f = fixture();
  try {
    const missionA = crypto.randomUUID();
    const missionB = crypto.randomUUID();
    const effectA = crypto.randomUUID();
    const effectB = crypto.randomUUID();
    // The v2 reality: the journal key is the provider Email id, the RFC Message-ID lives in the receipt of the effect.
    const base = { organization_id: f.org, owner_user_id: f.user, account_id: MAIL, channel: 'email', direction: 'outbound', counterpart: 'candidate@example.test', provider_thread_id: 'reused-thread', candidate_id: f.scope.candidate_id, audience: 'candidate' };
    f.tables.candidate_action_messages.push({ ...base, provider_message_id: 'email-id-B', project_id: missionB, effect_id: effectB }, { ...base, provider_message_id: 'email-id-A', project_id: missionA, effect_id: effectA });
    f.tables.candidate_action_effects.push({ id: effectA, result: { providerReceipt: { object: 'EmailSent', id: 'email-id-A', message_id: '<rfc-A@example.test>' } } }, { id: effectB, result: { providerReceipt: { object: 'EmailSent', id: 'email-id-B', message_id: '<rfc-B@example.test>' } } });
    const message: Row = v2Email({ id: 'reply-to-A', body_plain: 'Réponse pour la mission A.', thread_id: 'reused-thread', headers: [{ name: 'In-Reply-To', value: '<rfc-A@example.test>' }] });
    f.reads(() => jsonResponse(message));
    equal((await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'reply-A' })).captured, true);
    equal(f.tables.candidate_action_messages[2].project_id, missionA);
    // The other mission of the same thread is answered by its own RFC id, not by recency.
    message.headers = [{ name: 'In-Reply-To', value: 'rfc-B@example.test' }];
    message.id = 'reply-to-B';
    equal((await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'reply-B' })).captured, true);
    equal(f.tables.candidate_action_messages[3].project_id, missionB);
    // No reference to a known send: the reused thread is ambiguous and nothing is guessed.
    message.headers = [];
    message.id = 'ambiguous-reply';
    equal((await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'ambiguous-reply' })).captured, false);
    equal(f.tables.candidate_action_messages.length, 4);
  } finally { f.close(); }
});

Deno.test('WhatsApp sends through its own verified conversation and never retries a lost POST', async () => {
  const f = fixture();
  try {
    f.tables.member_whatsapp_accounts.push({ organization_id: f.org, user_id: f.user, whatsapp_account_id: WA, phone_number: '+33600000002', account_status: 'OK' });
    const effect: CandidateActionMessageEffect = { ...f.effect, channel: 'whatsapp', service: 'whatsapp', recipient: '+33600000001', recipientProviderId: '+33600000001', senderAccountId: WA, senderAddress: '+33600000002' };
    delete effect.subject;
    f.reads(request => request.path.endsWith('/chat') ? jsonResponse({ object: 'ChatLookup', data: [{ chat_id: 'existing-wa' }] })
      : request.path === `/${WA}/chats/existing-wa` ? jsonResponse({ id: 'existing-wa', type: '1to1', user_id: '33600000001@s.whatsapp.net', user: { id: '33600000001@s.whatsapp.net' } }) : { status: 404, body: {} });
    f.sends(() => networkError('Connection lost'));
    equal((await sendCandidateActionMessage(f.client, f.user, f.scope, effect)).status, 'unknown');
    equal(f.posts().length, 1);
    equal(f.posts()[0].path, `/${WA}/chats/existing-wa/messages/send`);
    equal(f.posts()[0].body, { text: effect.content });
  } finally { f.close(); }
});

Deno.test('WhatsApp without any chat starts one by the phone number, and refuses a chat it cannot prove', async () => {
  const f = fixture();
  try {
    f.tables.member_whatsapp_accounts.push({ organization_id: f.org, user_id: f.user, whatsapp_account_id: WA, phone_number: '+33600000002', account_status: 'OK' });
    const effect: CandidateActionMessageEffect = { ...f.effect, channel: 'whatsapp', service: 'whatsapp', recipient: '+33600000001', recipientProviderId: '+33600000001', senderAccountId: WA, senderAddress: '+33600000002' };
    delete effect.subject;
    f.reads(request => request.path.endsWith('/chat') ? jsonResponse({ object: 'ChatLookup', data: [] }) : { status: 404, body: {} });
    const started = await sendCandidateActionMessage(f.client, f.user, f.scope, effect);
    equal(started.status, 'succeeded');
    equal(f.posts()[0].path, `/${WA}/chats/send`);
    equal(f.posts()[0].body, { text: effect.content, users_ids: '+33600000001' });
    equal(started.result.providerThreadId, 'new-chat');
    // A chat exists with this number but belongs to somebody else: no second chat is started.
    const g = fixture();
    try {
      g.tables.member_whatsapp_accounts.push({ organization_id: g.org, user_id: g.user, whatsapp_account_id: WA, phone_number: '+33600000002', account_status: 'OK' });
      g.reads(request => request.path.endsWith('/chat') ? jsonResponse({ data: [{ chat_id: 'someone-else' }] })
        : jsonResponse({ id: 'someone-else', type: '1to1', user_id: '33699999999@s.whatsapp.net', user: { id: '33699999999@s.whatsapp.net' } }));
      const refused = await sendCandidateActionMessage(g.client, g.user, g.scope, { ...effect, id: crypto.randomUUID() });
      equal([refused.status, refused.result.errorCode], ['failed', 'RECIPIENT_CHANGED']);
      equal(g.posts().length, 0);
    } finally { g.close(); }
  } finally { f.close(); }
});

Deno.test('team reply requires the exact known thread and stays outside candidate exchanges', async () => {
  const f = fixture();
  try {
    f.tables.candidate_action_messages.push({ organization_id: f.org, owner_user_id: f.user, account_id: MAIL, channel: 'email', direction: 'outbound', counterpart: 'colleague@example.test', provider_message_id: 'request-id', provider_thread_id: 'team-thread', candidate_id: f.scope.candidate_id, project_id: null, audience: 'team' });
    const incoming = v2Email({ id: 'team-response', from: [{ email: 'colleague@example.test' }], body_plain: 'Le manager confirme une équipe de six personnes.', thread_id: 'unrelated-thread' });
    f.reads(() => jsonResponse(incoming));
    const unrelated = await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'team-response' });
    equal(unrelated.captured, false);
    incoming.thread_id = 'team-thread';
    const result = await captureCandidateActionIncoming(f.client, { account_id: MAIL, email_id: 'team-response' });
    equal(result.audience, 'team');
    equal(f.tables.candidate_action_messages[1].audience, 'team');
    equal(f.tables.candidate_contacts.length, 1);
  } finally { f.close(); }
});

Deno.test('opening real email history privately hydrates one bounded page with stable provider sources', async () => {
  const f = fixture();
  try {
    const mission = crypto.randomUUID();
    f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: 'historic-mission' });
    f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: mission, job_id: 'historic-mission' });
    const base = { date: '2026-10-06T14:00:00+02:00', thread_id: 'real-thread', subject: 'Mon expérience', body_plain: 'Voici mes disponibilités et mon parcours.' };
    f.reads(request => request.path === `/${MAIL}/emails` ? jsonResponse({ data: [
      v2Email({ ...base, id: 'real-inbound', from: [{ email: 'candidate@example.test', display_name: 'Candidat' }], to: [{ email: 'recruiter@example.test' }] }),
      v2Email({ ...base, id: 'real-outbound', from: [{ email: 'recruiter@example.test' }], to: [{ email: 'candidate@example.test' }] }),
      v2Email({ ...base, id: 'unrelated-message', from: [{ email: 'unrelated@example.test' }], to: [{ email: 'recruiter@example.test' }] }),
    ] }) : { status: 404, body: {} });
    f.tables.member_email_accounts[0].provider = 'GOOGLE';
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []);
    const first = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(f.tables.candidate_action_messages.length, 2);
    assert(f.tables.candidate_action_messages.every(row => row.owner_user_id === f.user && row.account_id === MAIL && row.audience === 'candidate' && row.project_id === mission && !row.action_plan_id));
    equal(first.messages[0].reference, { table: 'provider_emails', id: 'real-inbound', version: '2026-10-06T12:00:00.000Z' });
    equal(first.messages[0].author, 'candidate@example.test');
    equal(first.messages[0], candidateActionStoredEmailSource(f.tables.candidate_action_messages[0]));
    const second = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(second.messages, first.messages);
    equal(f.tables.candidate_action_messages.length, 2);
    equal(f.posts().length, 0);
    equal(first.complete, true);
    const query = f.mock.calls[0].query;
    equal([query.get('any_email'), query.get('limit'), query.get('meta_only')], ['candidate@example.test', '50', 'false']);
    assert(!query.has('account_id') && !query.has('search') && !query.has('thread_id'));
  } finally { f.close(); }
});

Deno.test('a history with a next cursor, or a larger total, is reported incomplete', async () => {
  for (const extra of [{ next_cursor: 'more' }, { total_count: 120 }]) {
    const f = fixture();
    try {
      f.reads(() => jsonResponse({ data: [v2Email({ id: 'one-message' })], ...extra }));
      const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []);
      const result = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
      equal(result.messages.length, 1);
      equal(result.complete, false);
    } finally { f.close(); }
  }
});

Deno.test('a full page, a has_more flag or an Outlook search never claim a complete history', async () => {
  const mails = (count: number) => Array.from({ length: count }, (_value, index) => v2Email({ id: `message-${index}`, date: `2026-10-0${1 + (index % 9)}T10:00:00Z`, body_plain: `Message ${index}.` }));
  const cases: Array<{ provider: string; body: Row; complete: boolean; label: string }> = [
    { provider: 'GOOGLE', body: { data: mails(2) }, complete: true, label: 'a short page without any sign of more' },
    { provider: 'GOOGLE', body: { data: mails(50) }, complete: false, label: 'a page that is exactly full' },
    { provider: 'GOOGLE', body: { data: mails(2), has_more: true }, complete: false, label: 'has_more' },
    { provider: 'OUTLOOK', body: { data: mails(2) }, complete: false, label: 'an Outlook address search, approximate by nature' },
  ];
  for (const { provider, body, complete, label } of cases) {
    const f = fixture();
    try {
      f.tables.member_email_accounts[0].provider = provider;
      f.reads(() => jsonResponse(body));
      const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []);
      const result = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
      assert(result.messages.length > 0, label);
      equal([label, result.complete], [label, complete]);
    } finally { f.close(); }
  }
});

Deno.test('a chat history is complete only on a short page without cursor, has_more or larger total', async () => {
  const page = (count: number, extra: Row = {}) => ({ data: Array.from({ length: count }, (_value, index) => ({ id: `m${index}`, chat_id: 'chat-1', text: `Message ${index}.`, timestamp: `2026-10-07T0${index % 9}:00:00Z`, is_sender: index % 2 === 0, sender_id: 'x' })), ...extra });
  const cases: Array<[Row, boolean]> = [[page(3), true], [page(50), false], [page(3, { has_more: true }), false], [page(3, { total_count: 80 }), false], [page(3, { next_cursor: 'more' }), false]];
  for (const [body, complete] of cases) {
    const f = fixture();
    try {
      f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.user, linkedin_account_id: LI, account_status: 'OK' });
      f.reads(request => request.path === `/${LI}/chats/chat-1` ? jsonResponse(v2Chat()) : request.path === `/${LI}/chats/chat-1/messages` ? jsonResponse(body) : { status: 404, body: {} });
      const history = await readCandidateActionChatContext(f.client, f.user, { ...f.scope, chat_id: 'chat-1', account_id: LI });
      equal(history.complete, complete);
    } finally { f.close(); }
  }
});

Deno.test('historical emails keep ambiguous missions null and import at most fifty messages', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 2; index++) {
      const mission = crypto.randomUUID();
      f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: `multi-mission-${index}` });
      f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: mission, job_id: `multi-mission-${index}` });
      if (!index) f.scope.project_id = mission;
    }
    f.reads(() => jsonResponse({ data: Array.from({ length: 51 }, (_, index) => v2Email({ id: `historic-${index}`, date: '2026-10-06T14:00:00Z', body_plain: 'Historique réel.' })) }));
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []);
    const result = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(result.messages.length, 50);
    equal(f.tables.candidate_action_messages.length, 50);
    assert(result.messages.every(source => source.projectId === null));
    assert(f.tables.candidate_action_messages.every(row => row.project_id === null));
    equal(result.complete, false);
    equal(f.posts().length, 0);
  } finally { f.close(); }
});

Deno.test('shared candidate address never imports a guessed candidate history', async () => {
  const f = fixture();
  try {
    f.tables.candidate_contacts.push({ organization_id: f.org, candidate_id: 'other-candidate', email: 'candidate@example.test' });
    f.reads(() => jsonResponse({ data: [v2Email({ id: 'shared-address-message', date: '2026-10-06T14:00:00Z', body_plain: 'Une réponse dont l’identité reste ambiguë.' })] }));
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, [f.tables.candidate_contacts[0]], []);
    const result = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(result.messages, []);
    equal(result.complete, false);
    equal(f.tables.candidate_action_messages.length, 0);
    equal(f.posts().length, 0);
  } finally { f.close(); }
});

Deno.test('confirmed outbound webhook race links its exact private row without publishing it', async () => {
  const f = fixture();
  try {
    const existing = { id: crypto.randomUUID(), organization_id: f.org, owner_user_id: f.user, account_id: MAIL, provider_message_id: 'sent-email-id', provider_thread_id: 'candidate-thread', candidate_id: f.scope.candidate_id, project_id: null, channel: 'email', service: 'outlook', audience: 'candidate', direction: 'outbound', counterpart: f.effect.recipient, sender: f.effect.senderAddress, recipient: f.effect.recipient, subject: f.effect.subject, content: f.effect.content, occurred_at: new Date().toISOString(), action_plan_id: null, effect_id: null, action_completed_at: null };
    f.tables.candidate_action_messages.push(existing);
    const planId = crypto.randomUUID();
    const outcome = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect, { planId });
    equal(outcome.status, 'succeeded');
    equal(outcome.result.referenceId, existing.id);
    equal(f.tables.candidate_action_messages.length, 1);
    equal(existing.action_plan_id, planId);
    equal(existing.effect_id, f.effect.id);
    equal(existing.action_completed_at, null);
    equal(f.posts().length, 1);
  } finally { f.close(); }
});

Deno.test('a collided historical or other-scope row is never reassigned to an approved send', async () => {
  for (const mismatch of [{ project_id: crypto.randomUUID() }, { candidate_id: 'different-candidate' }, { owner_user_id: crypto.randomUUID() }, { content: 'Autre message.' }, { action_plan_id: crypto.randomUUID() }, { effect_id: crypto.randomUUID() }, { audience: 'team' }, { direction: 'inbound' }, { subject: 'Autre objet' }, { occurred_at: '2026-01-01T00:00:00Z' }]) {
    const f = fixture();
    try {
      const existing: Row = { id: crypto.randomUUID(), organization_id: f.org, owner_user_id: f.user, account_id: MAIL, provider_message_id: 'sent-email-id', provider_thread_id: 'candidate-thread', candidate_id: f.scope.candidate_id, project_id: null, channel: 'email', service: 'outlook', audience: 'candidate', direction: 'outbound', counterpart: f.effect.recipient, sender: f.effect.senderAddress, recipient: f.effect.recipient, subject: f.effect.subject, content: f.effect.content, occurred_at: new Date().toISOString(), action_plan_id: null, effect_id: null, action_completed_at: null, ...mismatch };
      const before = { ...existing };
      f.tables.candidate_action_messages.push(existing);
      const outcome = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect, { planId: crypto.randomUUID() });
      equal(outcome.status, 'succeeded');
      equal(outcome.result.referenceId, undefined);
      assert(outcome.result.message?.includes('historique'));
      equal(existing, before);
      equal(f.posts().length, 1);
    } finally { f.close(); }
  }
});
