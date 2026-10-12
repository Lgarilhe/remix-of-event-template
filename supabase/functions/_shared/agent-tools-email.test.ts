// Run: deno test --no-check --allow-env --allow-read --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/agent-tools-email.test.ts
import { getTool } from './agent-tools.ts';
import type { ToolContext } from './agent-tools.ts';
import { registerEmailTools } from './agent-tools-email.ts';
import { jsonResponse, withMockTransport, type MockReply, type RecordedRequest } from './unipile/testing.ts';

type Row = Record<string, unknown>;
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

const ORG = 'org-1';
const USER = 'user-1';
const ACCOUNT = 'acc_mailbox';

/** Chainable fake of the Supabase query builder: filters rows by every `eq`, ignores the rest. */
function fakeAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let single = false;
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        or: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => { single = true; return query; },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function context(accountId = ACCOUNT, extra: Row[] = []): ToolContext {
  const tables = {
    member_email_accounts: [{ organization_id: ORG, user_id: USER, email_account_id: accountId, email_address: 'recruiter@example.test', provider: 'google', account_status: 'OK' }, ...extra],
  };
  return { userId: USER, organizationId: ORG, conversationId: null, messageId: null, adminClient: fakeAdmin(tables) as unknown as ToolContext['adminClient'] };
}

const v2Mail = (fields: Row): Row => ({
  object: 'Email', id: 'mail-1', thread_id: 'thread-1', date: '2026-10-07T10:00:00Z', subject: 'Projet', from: [{ email: 'Candidat@Example.test', display_name: 'Candidat' }],
  to: [{ email: 'recruiter@example.test' }], cc: [], bcc: [], body_plain: 'Bonjour, voici mon parcours.', attachments: [{ id: 'att-1', type: 'file', filename: 'cv.pdf' }], headers: [], ...fields,
});

function tool(name: string) {
  registerEmailTools();
  const found = getTool(name);
  assert(found, `${name} is not registered`);
  return found;
}

Deno.test('search reads the mailbox of the member on the account path, with the v2 parameter names', async () => {
  const mock = withMockTransport((request: RecordedRequest): MockReply => jsonResponse({ data: [
    v2Mail({ id: 'm-new', date: '2026-10-08T10:00:00Z' }),
    v2Mail({ id: 'm-old', date: '2026-10-01T10:00:00Z', subject: 'Ancien' }),
    v2Mail({ id: 'm-other', thread_id: 'thread-2', subject: 'Autre fil', attachments: [] }),
    v2Mail({ id: 'm-nothread', thread_id: undefined }),
  ] }));
  try {
    const result = await tool('search_email_threads').execute({ query: '  projet   Numspot ', limit: 5 }, context());
    equal(mock.calls.length, 1);
    const [call] = mock.calls;
    equal([call.method, call.path], ['GET', `/${ACCOUNT}/emails`]);
    equal(call.query.get('q'), 'projet Numspot');
    equal(call.query.get('limit'), '15');
    assert(!call.query.has('search') && !call.query.has('account_id') && !call.query.has('thread_id'));
    assert(result.success);
    const data = result.data as { threads: Array<Row>; thread_count: number; provider: string; unthreaded_messages?: number; unthreaded_notice?: string };
    equal(data.provider, 'gmail');
    // A message without thread (IMAP) is listed alone, flagged, never silently dropped.
    equal(data.thread_count, 3);
    equal([data.threads[2].thread_id, data.threads[2].matched_messages], [null, 1]);
    equal(data.unthreaded_messages, 1);
    assert(String(data.unthreaded_notice).includes('get_email_thread'));
    const first = data.threads[0];
    equal([first.thread_id, first.matched_messages, first.has_attachments], ['thread-1', 2, true]);
    equal(first.from, { name: 'Candidat', email: 'candidat@example.test' });
    assert(String(first.preview).includes('parcours'));
    equal(data.threads[1].thread_id, 'thread-2');
    equal(data.threads[1].has_attachments, false);
  } finally { mock.restore(); }
});

Deno.test('a participant and date search without free text uses the provider side filters', async () => {
  const mock = withMockTransport(() => jsonResponse({ data: [v2Mail({}), v2Mail({ id: 'stranger', from: [{ email: 'stranger@example.test' }], to: [{ email: 'someone@example.test' }] })] }));
  try {
    const result = await tool('search_email_threads').execute({ participant_email: 'Candidat@example.test', after: '2026-10-01', before: '2026-10-31' }, context());
    const [call] = mock.calls;
    equal([call.query.get('any_email'), call.query.get('after'), call.query.get('before'), call.query.get('limit')], ['candidat@example.test', '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z', '30']);
    assert(!call.query.has('q'));
    assert(result.success);
    // The participant is also checked locally: a mail that merely came back from the provider is not enough.
    equal((result.data as { thread_count: number }).thread_count, 1);
  } finally { mock.restore(); }
});

Deno.test('a thread is read by id on the thread endpoint, chronologically, with bounded bodies', async () => {
  const mock = withMockTransport(request => request.path === `/${ACCOUNT}/threads/thread-1`
    ? jsonResponse({ object: 'Thread', id: 'thread-1', emails: [
      v2Mail({ id: 'a2', date: '2026-10-02T10:00:00Z', body_plain: '', body: '<p>Réponse <b>HTML</b></p><script>x()</script>' }),
      v2Mail({ id: 'a1', date: '2026-10-01T10:00:00Z', subject: undefined }),
    ] })
    : { status: 404, body: {} });
  try {
    const result = await tool('get_email_thread').execute({ thread_id: ' thread-1 ', limit: 10 }, context());
    equal(mock.calls.map(call => `${call.method} ${call.path}`), [`GET /${ACCOUNT}/threads/thread-1`]);
    assert(!mock.calls[0].query.has('thread_id') && !mock.calls[0].query.has('account_id'));
    assert(result.success);
    const data = result.data as { messages: Row[]; thread_id: string; untrusted_external_content: boolean };
    equal(data.thread_id, 'thread-1');
    equal(data.untrusted_external_content, true);
    equal(data.messages.map(message => message.subject), ['(Sans objet)', 'Projet']);
    equal(data.messages[1].body, 'Réponse HTML');
    equal(data.messages[0].attachment_names, ['cv.pdf']);
    equal(data.messages[0].has_attachments, true);
    assert(!('role' in data.messages[0]));
  } finally { mock.restore(); }
});

Deno.test('provider failures become neutral French messages and the provider text is never returned', async () => {
  for (const [status, expected] of [[404, 'introuvable'], [403, 'Vérifie sa connexion'], [503, 'Vérifie sa connexion']] as const) {
    const mock = withMockTransport(() => ({ status, body: { message: 'Unipile account abc failed with secret details' } }));
    try {
      const result = await tool('get_email_thread').execute({ thread_id: 'thread-1' }, context());
      assert(!result.success);
      assert(String(result.error).includes(expected), String(result.error));
      assert(!/unipile|secret/i.test(String(result.error)));
    } finally { mock.restore(); }
  }
});

Deno.test('a mailbox stored with an outdated account id is refused before any request', async () => {
  const mock = withMockTransport(() => jsonResponse({ data: [] }));
  try {
    const result = await tool('search_email_threads').execute({ query: 'x' }, context('legacy-mailbox-id'));
    assert(!result.success);
    assert(String(result.error).includes('Vérifie sa connexion'));
    equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

Deno.test('a mailbox of another member is never used, and the model cannot choose the account', async () => {
  const mock = withMockTransport(() => jsonResponse({ data: [] }));
  try {
    const foreign = fakeAdmin({ member_email_accounts: [{ organization_id: ORG, user_id: 'colleague', email_account_id: 'acc_colleague', email_address: 'colleague@example.test', provider: 'outlook', account_status: 'OK' }] });
    const ctx = { ...context(), adminClient: foreign as unknown as ToolContext['adminClient'] };
    const result = await tool('search_email_threads').execute({ query: 'x', account_id: 'acc_colleague' }, ctx);
    assert(!result.success);
    equal(mock.calls.length, 0);
    const schema = JSON.stringify(tool('search_email_threads').inputSchema) + JSON.stringify(tool('get_email_thread').inputSchema);
    assert(!schema.includes('account_id'));
  } finally { mock.restore(); }
});
