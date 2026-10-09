import { candidateActionStoredEmailSource, loadCandidateActionTargets, readCandidateActionEmailContext, sendCandidateActionMessage, validateCandidateActionChat } from './transport.ts';
import { captureCandidateActionIncoming } from './incoming.ts';
import type { CandidateActionMessageEffect, CandidateActionScope } from './types.ts';

type Row = Record<string, unknown>;
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

/** In-memory query adapter: production modules run unmodified, every external request is intercepted. */
function fixture() {
  const org = crypto.randomUUID();
  const user = crypto.randomUUID();
  const member = crypto.randomUUID();
  const scope: CandidateActionScope = { organization_id: org, candidate_id: 'ACo-candidate' };
  const tables: Record<string, Row[]> = {
    organization_integrations: [{ organization_id: org, unipile_connected: true, unipile_api_key: 'test-key', unipile_dsn: 'https://channel.invalid' }],
    organization_members: [{ id: 'own-member', organization_id: org, user_id: user }, { id: 'team-member', organization_id: org, user_id: member }],
    member_email_accounts: [{ organization_id: org, user_id: user, email_account_id: 'own-mail', email_address: 'recruiter@example.test', provider: 'OUTLOOK', account_status: 'OK' }],
    member_linkedin_accounts: [], member_whatsapp_accounts: [], mission_conversations: [], sequence_enrollments: [],
    candidate_contacts: [{ organization_id: org, candidate_id: scope.candidate_id, email: 'candidate@example.test', phone: '+33600000001' }],
    candidate_action_messages: [], job_candidate_status: [], sourcing_projects: [], gdpr_erasures: [], suppressed_emails: [],
  };
  const requests: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
  const quotaCalls: Row[] = [];
  const flags = { sendStatus: 201, throwSend: false, throwJournal: false, suppressReadError: false, quotaAllowed: true };
  let provider: (url: string) => unknown = () => ({});
  class Query {
    filters: Array<(row: Row) => boolean> = [];
    mode = 'select'; payload: Row | Row[] | null = null; one = false; ignoreDuplicates = false;
    constructor(readonly table: string) {}
    select(_columns?: string) { return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    is(key: string, value: unknown) { this.filters.push(row => value === null ? row[key] == null : row[key] === value); return this; }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
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
  const effect: CandidateActionMessageEffect = { id: crypto.randomUUID(), kind: 'message', label: 'Réponse', content: 'Bonjour, voici notre réponse relue.', status: 'prepared', dedupeKey: 'test-message', targetId: 'mail-target', audience: 'candidate', channel: 'email', service: 'outlook', recipient: 'candidate@example.test', senderAccountId: 'own-mail', senderAddress: 'recruiter@example.test', subject: 'Suite à votre question' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body, headers: new Headers(init?.headers) });
    if (method === 'POST') {
      if (flags.throwSend) return Promise.reject(new TypeError('Connection lost'));
      return Promise.resolve(new Response(JSON.stringify({ object: 'EmailSent', provider_id: 'sent-provider-id', thread_id: 'candidate-thread', tracking_id: 'tracking' }), { status: flags.sendStatus }));
    }
    return Promise.resolve(new Response(JSON.stringify(provider(url)), { status: 200 }));
  }) as typeof fetch;
  return { org, user, member, scope, tables, requests, quotaCalls, flags, client, effect, provider: (handler: (url: string) => unknown) => { provider = handler; }, close: () => { globalThis.fetch = originalFetch; } };
}

Deno.test('targets only use own active accounts, stored contacts and real member emails', async () => {
  const f = fixture();
  try {
    f.tables.member_email_accounts.push({ organization_id: f.org, user_id: 'colleague', email_account_id: 'other-mail', email_address: 'other@example.test', provider: 'GOOGLE', account_status: 'OK' });
    f.tables.member_whatsapp_accounts.push({ organization_id: f.org, user_id: f.user, whatsapp_account_id: 'own-wa', phone_number: '+33600000002', account_status: 'OK' });
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, [{ id: f.member, name: 'Collègue' }]);
    equal(targets.map(target => [target.channel, target.audience, target.recipient]), [['email', 'candidate', 'candidate@example.test'], ['email', 'team', 'colleague@example.test'], ['whatsapp', 'candidate', '+33600000001']]);
    assert(targets.every(target => target.senderAccountId !== 'other-mail'));
    equal(targets[0].service, 'outlook');
    equal(f.requests.length, 0);
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
    equal(f.requests.length, 0);
  } finally { f.close(); }
});

Deno.test('real approved email uses multipart + stable operation key and records team separately', async () => {
  const f = fixture();
  try {
    const effect = { ...f.effect, audience: 'team' as const, memberId: f.member, recipient: 'colleague@example.test' };
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, effect, { planId: 'plan-id' });
    equal(result.status, 'succeeded');
    equal(result.result.providerId, 'sent-provider-id');
    equal(result.result.providerThreadId, 'candidate-thread');
    assert(f.requests[0].body instanceof FormData);
    equal(f.requests[0].headers.get('Idempotency-Key'), effect.id);
    equal((f.requests[0].body as FormData).get('account_id'), 'own-mail');
    equal(f.tables.candidate_action_messages[0].audience, 'team');
    equal(f.tables.candidate_action_messages[0].action_plan_id, 'plan-id');
    equal(f.tables.candidate_action_messages[0].content, effect.content);
    equal(f.tables.candidate_contacts.length, 1);
  } finally { f.close(); }
});

Deno.test('ambiguous network and server failures are unknown with exactly one POST; rejection is failed', async () => {
  for (const [status, throws, expected] of [[201, true, 'unknown'], [503, false, 'unknown'], [422, false, 'failed']] as const) {
    const f = fixture();
    try {
      f.flags.sendStatus = status; f.flags.throwSend = throws;
      const result = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
      equal(result.status, expected);
      equal(f.requests.filter(request => request.method === 'POST').length, 1);
      equal(f.tables.candidate_action_messages.length, 0);
    } finally { f.close(); }
  }
});

Deno.test('journal transport exception after confirmed send preserves successful receipt', async () => {
  const f = fixture();
  try {
    f.flags.throwJournal = true;
    const result = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect);
    equal(result.status, 'succeeded');
    equal(result.result.providerId, 'sent-provider-id');
    assert(result.result.message?.includes('historique'));
    equal(f.requests.filter(request => request.method === 'POST').length, 1);
  } finally { f.close(); }
});

Deno.test('a colleague chat is refused even when the account is in the same organization', async () => {
  const f = fixture();
  try {
    f.tables.member_linkedin_accounts.push({ organization_id: f.org, user_id: f.member, linkedin_account_id: 'colleague-li', account_status: 'OK' });
    f.provider(() => ({ account_id: 'colleague-li', type: 0 }));
    let rejected = false;
    try { await validateCandidateActionChat(f.client, f.user, { ...f.scope, chat_id: 'chat', account_id: 'colleague-li' }); } catch { rejected = true; }
    assert(rejected);
    equal(f.requests.filter(request => request.method === 'POST').length, 0);
  } finally { f.close(); }
});

Deno.test('email reply outside any sequence persists full content on its exact candidate', async () => {
  const f = fixture();
  try {
    const mission = crypto.randomUUID();
    f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: 'ats-job' });
    f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: mission, job_id: 'ats-job' });
    f.provider(() => ({ id: 'incoming-id', provider_id: 'received-provider', account_id: 'own-mail', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Mes disponibilités sont mardi.', subject: 'Réponse', date: '2026-10-07T10:00:00Z', thread_id: 'candidate-thread' }));
    const result = await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'incoming-id' });
    equal(result.audience, 'candidate');
    equal(f.tables.candidate_action_messages[0].direction, 'inbound');
    equal(f.tables.candidate_action_messages[0].candidate_id, f.scope.candidate_id);
    equal(f.tables.candidate_action_messages[0].content, 'Mes disponibilités sont mardi.');
    equal(f.tables.candidate_action_messages[0].project_id, mission);
    equal(f.tables.sequence_enrollments.length, 0);
  } finally { f.close(); }
});

Deno.test('incoming WhatsApp binds exact phone and legacy job to a real mission; revoked account is ignored', async () => {
  const f = fixture();
  try {
    const mission = crypto.randomUUID();
    f.tables.sourcing_projects.push({ id: mission, organization_id: f.org, job_id: 'ats-external-job' });
    f.tables.job_candidate_status.push({ organization_id: f.org, candidate_id: f.scope.candidate_id, project_id: null, job_id: 'ats-external-job' });
    const account = { organization_id: f.org, user_id: f.user, whatsapp_account_id: 'own-wa', phone_number: '+33600000002', account_status: 'OK' };
    f.tables.member_whatsapp_accounts.push(account);
    f.provider(url => url.includes('/attendees') ? { items: [{ provider_id: '33600000001@s.whatsapp.net', is_self: false }] }
      : url.includes('/chats/') ? { id: 'wa-thread', account_id: 'own-wa', type: 0 }
      : { id: 'wa-message', provider_id: 'wa-provider', account_id: 'own-wa', chat_id: 'wa-thread', is_sender: false, text: 'Je suis disponible jeudi.', timestamp: '2026-10-07T10:00:00Z' });
    const result = await captureCandidateActionIncoming(f.client, { account_id: 'own-wa', message_id: 'wa-message' });
    equal(result.captured, true);
    equal(f.tables.candidate_action_messages[0].project_id, mission);
    equal(f.tables.candidate_action_messages[0].counterpart, '+33600000001');
    equal(f.tables.candidate_action_messages[0].content, 'Je suis disponible jeudi.');
    account.account_status = 'DELETED';
    equal((await captureCandidateActionIncoming(f.client, { account_id: 'own-wa', message_id: 'second-wa-message' })).captured, false);
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
    f.provider(() => ({ provider_id: 'ambiguous-mission', account_id: 'own-mail', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Bonjour.', date: '2026-10-07T10:00:00Z' }));
    equal((await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'ambiguous-mission' })).captured, true);
    equal(f.tables.candidate_action_messages[0].project_id, null);
    f.tables.job_candidate_status = [];
    f.tables.sourcing_projects = [];
    f.tables.sequence_enrollments.push({ organization_id: f.org, profile_id: f.scope.candidate_id, email_used: 'candidate@example.test', job_id: 'external-ats-id' });
    f.provider(() => ({ provider_id: 'different-message', account_id: 'own-mail', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Autre réponse.', date: '2026-10-07T10:01:00Z' }));
    equal((await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'different-message' })).captured, true);
    equal(f.tables.candidate_action_messages[1].project_id, null);
  } finally { f.close(); }
});

Deno.test('exact reply identity wins over reused thread; ambiguous thread does not infer a mission', async () => {
  const f = fixture();
  try {
    const missionA = crypto.randomUUID();
    const missionB = crypto.randomUUID();
    const base = { organization_id: f.org, owner_user_id: f.user, account_id: 'own-mail', channel: 'email', direction: 'outbound', counterpart: 'candidate@example.test', provider_thread_id: 'reused-thread', candidate_id: f.scope.candidate_id, audience: 'candidate' };
    f.tables.candidate_action_messages.push({ ...base, provider_message_id: 'newer-other-mission', project_id: missionB }, { ...base, provider_message_id: 'specific-message', project_id: missionA });
    const message: Row = { provider_id: 'reply-to-A', account_id: 'own-mail', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Réponse pour la mission A.', date: '2026-10-07T10:00:00Z', thread_id: 'reused-thread', in_reply_to: 'specific-message' };
    f.provider(() => message);
    equal((await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'reply-A' })).captured, true);
    equal(f.tables.candidate_action_messages[2].project_id, missionA);
    delete message.in_reply_to;
    message.provider_id = 'ambiguous-reply';
    equal((await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'ambiguous-reply' })).captured, false);
    equal(f.tables.candidate_action_messages.length, 3);
  } finally { f.close(); }
});

Deno.test('WhatsApp sends through its own verified conversation and never retries a lost POST', async () => {
  const f = fixture();
  try {
    f.tables.member_whatsapp_accounts.push({ organization_id: f.org, user_id: f.user, whatsapp_account_id: 'own-wa', phone_number: '+33600000002', account_status: 'OK' });
    const effect: CandidateActionMessageEffect = { ...f.effect, channel: 'whatsapp', service: 'whatsapp', recipient: '+33600000001', recipientProviderId: '+33600000001', senderAccountId: 'own-wa', senderAddress: '+33600000002' };
    f.provider(url => url.includes('/attendees') ? { items: [{ provider_id: '33600000001@s.whatsapp.net', is_self: false }] }
      : url.includes('/chat_attendees/') ? { items: [{ id: 'existing-wa', account_id: 'own-wa', type: 0 }] }
      : { id: 'existing-wa', account_id: 'own-wa', type: 0 });
    f.flags.throwSend = true;
    equal((await sendCandidateActionMessage(f.client, f.user, f.scope, effect)).status, 'unknown');
    const post = f.requests.filter(request => request.method === 'POST');
    equal(post.length, 1);
    assert(post[0].url.endsWith('/chats/existing-wa/messages'));
    equal((post[0].body as FormData).get('account_id'), 'own-wa');
    equal((post[0].body as FormData).get('text'), effect.content);
  } finally { f.close(); }
});

Deno.test('team reply requires the exact known thread and stays outside candidate exchanges', async () => {
  const f = fixture();
  try {
    f.tables.candidate_action_messages.push({ organization_id: f.org, owner_user_id: f.user, account_id: 'own-mail', channel: 'email', direction: 'outbound', counterpart: 'colleague@example.test', provider_message_id: 'request-id', provider_thread_id: 'team-thread', candidate_id: f.scope.candidate_id, project_id: null, audience: 'team' });
    const incoming = { id: 'team-response', provider_id: 'team-provider', account_id: 'own-mail', from_attendee: { identifier: 'colleague@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Le manager confirme une équipe de six personnes.', date: '2026-10-07T10:00:00Z', thread_id: 'unrelated-thread' };
    f.provider(() => incoming);
    const unrelated = await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'team-response' });
    equal(unrelated.captured, false);
    incoming.thread_id = 'team-thread';
    const result = await captureCandidateActionIncoming(f.client, { account_id: 'own-mail', email_id: 'team-response' });
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
    const date = '2026-10-06T14:00:00+02:00';
    const base = { account_id: 'own-mail', date, thread_id: 'real-thread', subject: 'Mon expérience', body_plain: 'Voici mes disponibilités et mon parcours.' };
    f.provider(() => ({ items: [
      { ...base, provider_id: 'real-inbound', from_attendee: { identifier: 'candidate@example.test', display_name: 'Candidat' }, to_attendees: [{ identifier: 'recruiter@example.test' }] },
      { ...base, provider_id: 'real-outbound', from_attendee: { identifier: 'recruiter@example.test' }, to_attendees: [{ identifier: 'candidate@example.test' }] },
      { ...base, account_id: 'colleague-mail', provider_id: 'colleague-private', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }] },
      { ...base, provider_id: 'unrelated-message', from_attendee: { identifier: 'unrelated@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }] },
    ] }));
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []);
    const first = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(f.tables.candidate_action_messages.length, 2);
    assert(f.tables.candidate_action_messages.every(row => row.owner_user_id === f.user && row.account_id === 'own-mail' && row.audience === 'candidate' && row.project_id === mission && !row.action_plan_id));
    equal(first.messages[0].reference, { table: 'provider_emails', id: 'real-inbound', version: '2026-10-06T12:00:00.000Z' });
    equal(first.messages[0].author, 'candidate@example.test');
    equal(first.messages[0], candidateActionStoredEmailSource(f.tables.candidate_action_messages[0]));
    const second = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(second.messages, first.messages);
    equal(f.tables.candidate_action_messages.length, 2);
    equal(f.requests.filter(request => request.method === 'POST').length, 0);
    equal(first.complete, false);
  } finally { f.close(); }
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
    f.provider(() => ({ items: Array.from({ length: 51 }, (_, index) => ({ account_id: 'own-mail', provider_id: `historic-${index}`, date: '2026-10-06T14:00:00Z', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Historique réel.' })) }));
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, f.tables.candidate_contacts, []);
    const result = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(result.messages.length, 50);
    equal(f.tables.candidate_action_messages.length, 50);
    assert(result.messages.every(source => source.projectId === null));
    assert(f.tables.candidate_action_messages.every(row => row.project_id === null));
    equal(result.complete, false);
    equal(f.requests.filter(request => request.method === 'POST').length, 0);
  } finally { f.close(); }
});

Deno.test('shared candidate address never imports a guessed candidate history', async () => {
  const f = fixture();
  try {
    f.tables.candidate_contacts.push({ organization_id: f.org, candidate_id: 'other-candidate', email: 'candidate@example.test' });
    f.provider(() => ({ items: [{ account_id: 'own-mail', provider_id: 'shared-address-message', date: '2026-10-06T14:00:00Z', from_attendee: { identifier: 'candidate@example.test' }, to_attendees: [{ identifier: 'recruiter@example.test' }], body_plain: 'Une réponse dont l’identité reste ambiguë.' }] }));
    const targets = await loadCandidateActionTargets(f.client, f.client, f.user, f.scope, [f.tables.candidate_contacts[0]], []);
    const result = await readCandidateActionEmailContext(f.client, f.user, f.scope, targets);
    equal(result.messages, []);
    equal(result.complete, false);
    equal(f.tables.candidate_action_messages.length, 0);
    equal(f.requests.filter(request => request.method === 'POST').length, 0);
  } finally { f.close(); }
});

Deno.test('confirmed outbound webhook race links its exact private row without publishing it', async () => {
  const f = fixture();
  try {
    const existing = { id: crypto.randomUUID(), organization_id: f.org, owner_user_id: f.user, account_id: 'own-mail', provider_message_id: 'sent-provider-id', provider_thread_id: 'candidate-thread', candidate_id: f.scope.candidate_id, project_id: null, channel: 'email', service: 'outlook', audience: 'candidate', direction: 'outbound', counterpart: f.effect.recipient, sender: f.effect.senderAddress, recipient: f.effect.recipient, subject: f.effect.subject, content: f.effect.content, occurred_at: new Date().toISOString(), action_plan_id: null, effect_id: null, action_completed_at: null };
    f.tables.candidate_action_messages.push(existing);
    const planId = crypto.randomUUID();
    const outcome = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect, { planId });
    equal(outcome.status, 'succeeded');
    equal(outcome.result.referenceId, existing.id);
    equal(f.tables.candidate_action_messages.length, 1);
    equal(existing.action_plan_id, planId);
    equal(existing.effect_id, f.effect.id);
    equal(existing.action_completed_at, null);
    equal(f.requests.filter(request => request.method === 'POST').length, 1);
  } finally { f.close(); }
});

Deno.test('a collided historical or other-scope row is never reassigned to an approved send', async () => {
  for (const mismatch of [{ project_id: crypto.randomUUID() }, { candidate_id: 'different-candidate' }, { owner_user_id: crypto.randomUUID() }, { content: 'Autre message.' }, { action_plan_id: crypto.randomUUID() }, { effect_id: crypto.randomUUID() }, { audience: 'team' }, { direction: 'inbound' }, { subject: 'Autre objet' }, { occurred_at: '2026-01-01T00:00:00Z' }]) {
    const f = fixture();
    try {
      const existing: Row = { id: crypto.randomUUID(), organization_id: f.org, owner_user_id: f.user, account_id: 'own-mail', provider_message_id: 'sent-provider-id', provider_thread_id: 'candidate-thread', candidate_id: f.scope.candidate_id, project_id: null, channel: 'email', service: 'outlook', audience: 'candidate', direction: 'outbound', counterpart: f.effect.recipient, sender: f.effect.senderAddress, recipient: f.effect.recipient, subject: f.effect.subject, content: f.effect.content, occurred_at: new Date().toISOString(), action_plan_id: null, effect_id: null, action_completed_at: null, ...mismatch };
      const before = { ...existing };
      f.tables.candidate_action_messages.push(existing);
      const outcome = await sendCandidateActionMessage(f.client, f.user, f.scope, f.effect, { planId: crypto.randomUUID() });
      equal(outcome.status, 'succeeded');
      equal(outcome.result.referenceId, undefined);
      assert(outcome.result.message?.includes('historique'));
      equal(existing, before);
      equal(f.requests.filter(request => request.method === 'POST').length, 1);
    } finally { f.close(); }
  }
});
