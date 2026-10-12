// Provider-facing parts of the assistant mutating tools: chat ownership and e-mail send.
// Run: deno test --no-check --allow-env --allow-read --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/agent-tools-mutations.provider.test.ts
import { getTool } from './agent-tools.ts';
import type { ToolContext } from './agent-tools.ts';
import { registerMutatingTools } from './agent-tools-mutations.ts';
import { jsonResponse, networkError, withMockTransport, type MockReply, type RecordedRequest } from './unipile/testing.ts';

type Row = Record<string, unknown>;
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }

const ORG = 'org-1';
const USER = 'user-1';

/** Chainable fake of the Supabase query builder: `eq` and `in` filter, every other method keeps the chain. */
function fakeAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let single = false;
      const query: Record<string, unknown> = new Proxy({}, {
        get(_target, method: string) {
          if (method === 'then') {
            return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
              const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
              return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            if (method === 'eq') filters.push(row => row[args[0] as string] === args[1]);
            else if (method === 'in') filters.push(row => (args[1] as unknown[]).includes(row[args[0] as string]));
            else if (method === 'maybeSingle' || method === 'single') single = true;
            return query;
          };
        },
      });
      return query;
    },
    rpc: () => Promise.resolve({ data: {}, error: null }),
  };
}

function linkedinRow(accountId: string, extra: Row = {}): Row {
  return { organization_id: ORG, user_id: USER, linkedin_account_id: accountId, account_status: 'OK', linkedin_account_name: 'Mon LinkedIn', linked_at: '2026-10-01', ...extra };
}

function context(extraTables: Record<string, Row[]> = {}, accounts: Row[] = [linkedinRow('acc_a'), linkedinRow('acc_b')]): ToolContext {
  const tables = {
    organization_members: [{ organization_id: ORG, user_id: USER, role: 'owner' }],
    member_linkedin_accounts: accounts,
    member_email_accounts: [{ organization_id: ORG, user_id: USER, email_account_id: 'acc_mail', email_address: 'recruiter@example.test', account_status: 'OK', linked_at: '2026-10-01' }],
    ...extraTables,
  };
  return { userId: USER, organizationId: ORG, conversationId: null, messageId: null, adminClient: fakeAdmin(tables) as unknown as ToolContext['adminClient'] };
}

function tool(name: string) {
  registerMutatingTools();
  const found = getTool(name);
  assert(found, `${name} is not registered`);
  return found;
}

const oneToOne = (fields: Row = {}): Row => ({ object: 'Chat', id: 'chat-1', type: '1to1', is_1to1: true, user_id: 'ACo-recipient', user: { id: 'ACo-recipient', display_name: 'Candidat' }, ...fields });

Deno.test('a reply is allowed under the own account that carries the chat, found by trying the own accounts in order', async () => {
  const mock = withMockTransport((request: RecordedRequest): MockReply => request.path === '/acc_b/chats/chat-1' ? jsonResponse(oneToOne()) : { status: 404, body: { error: 'nope' } });
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context());
    equal(verdict.allowed, true);
    equal(mock.calls.map(call => `${call.method} ${call.path}`), ['GET /acc_a/chats/chat-1', 'GET /acc_b/chats/chat-1']);
  } finally { mock.restore(); }
});

Deno.test('the recipient of the chat is the other participant, and an erased candidate stops the send', async () => {
  const mock = withMockTransport(request => request.path === '/acc_a/chats/chat-1' ? jsonResponse(oneToOne()) : { status: 404, body: {} });
  try {
    const erased = context({ candidate_photos: [{ organization_id: ORG, candidate_id: 'ACo-recipient', status: 'erased' }] });
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, erased);
    equal(verdict.allowed, false);
    assert(String(verdict.reason).includes('effacement'));
  } finally { mock.restore(); }
});

Deno.test('a chat that no own account carries is refused with the organization wording, never the provider text', async () => {
  for (const status of [404, 403]) {
    const mock = withMockTransport(() => ({ status, body: { message: 'Unipile says the chat belongs to account acc_colleague' } }));
    try {
      const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context());
      equal(verdict.allowed, false);
      assert(String(verdict.reason).includes("n'appartient pas à un compte LinkedIn de votre organisation"));
      assert(!/unipile|acc_colleague/i.test(String(verdict.reason)));
      // Only the member's own accounts were asked; a colleague's account is never read.
      assert(mock.calls.every(call => call.path.startsWith('/acc_a/') || call.path.startsWith('/acc_b/')));
    } finally { mock.restore(); }
  }
});

Deno.test('a provider fault is retryable, not "not yours"; an outdated own account id is not probed', async () => {
  const mock = withMockTransport(() => ({ status: 503, body: {} }));
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context());
    equal(verdict.allowed, false);
    assert(String(verdict.reason).includes('réessayez'));
  } finally { mock.restore(); }
  const quiet = withMockTransport(() => oneToOne() as unknown as MockReply);
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context({}, [linkedinRow('legacy-account-id')]));
    equal(verdict.allowed, false);
    equal(quiet.calls.length, 0);
  } finally { quiet.restore(); }
});

Deno.test('an explicit account_id must be the account that carries the chat', async () => {
  const mock = withMockTransport(request => request.path === '/acc_a/chats/chat-1' ? jsonResponse(oneToOne()) : { status: 404, body: {} });
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour', account_id: 'acc_b' }, context());
    equal(verdict.allowed, false);
    equal(verdict.reason, "Cette conversation n'appartient pas au compte LinkedIn indiqué.");
  } finally { mock.restore(); }
});

Deno.test('a degraded, partial or locked account stops the send with a sentence that fits its state', async () => {
  const mock = withMockTransport(() => jsonResponse(oneToOne()));
  try {
    // Only a degraded account recovers by itself. A partial one has a product that needs authentication again: reconnecting is its remedy.
    for (const [status, expected] of [['DEGRADED', 'sans reconnecter'], ['PARTIAL', 'reconnectez-le'], ['LOCKED', 'verrouillé'], ['CREDENTIALS', 'reconnectez-le']] as const) {
      const verdict = await tool('send_linkedin_message').verifyAccess({ recipient_provider_id: 'ACoAAxxxxxxxxxx', text: 'Bonjour' }, context({}, [linkedinRow('acc_a', { account_status: status })]));
      equal(verdict.allowed, false);
      assert(String(verdict.reason).includes(expected), `${status}: ${verdict.reason}`);
      if (status !== 'DEGRADED') assert(!String(verdict.reason).includes('sans reconnecter'), `${status}: ${verdict.reason}`);
    }
    equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

Deno.test('the erasure check of a reply uses every identity of the chat recipient, not only the provider id', async () => {
  // The id the chat gives is not proven equal to the one the pipeline stored: the profile address and the public identifier decide too.
  const chat = oneToOne({ user_id: 'ACo-v2-other', user: { id: 'ACo-v2-other', display_name: 'Candidat', public_identifier: 'candidat-test', profile_url: 'https://www.linkedin.com/in/candidat-test' } });
  const mock = withMockTransport(request => request.path === '/acc_a/chats/chat-1' ? jsonResponse(chat) : { status: 404, body: {} });
  try {
    const tables = {
      job_candidate_status: [{ organization_id: ORG, candidate_id: 'ACo-stored', linkedin_profile_url: 'https://www.linkedin.com/in/candidat-test' }],
      candidate_photos: [{ organization_id: ORG, candidate_id: 'ACo-stored', status: 'erased' }],
    };
    const erased = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context(tables));
    equal(erased.allowed, false);
    assert(String(erased.reason).includes('effacement'));
    // Control: the same chat with nobody erased is allowed.
    equal((await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context())).allowed, true);
  } finally { mock.restore(); }
  // A one-to-one chat that names nobody cannot be checked: refused, never sent blindly.
  const anonymous = withMockTransport(request => request.path === '/acc_a/chats/chat-1' ? jsonResponse({ object: 'Chat', id: 'chat-1', type: '1to1', is_1to1: true }) : { status: 404, body: {} });
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context());
    equal(verdict.allowed, false);
    assert(String(verdict.reason).includes('effacement'));
  } finally { anonymous.restore(); }
});

Deno.test('the accounts in good standing are probed first and a truncated probe set is never reported as "not yours"', async () => {
  const oldRow = linkedinRow('acc_old', { account_status: 'CREDENTIALS' });
  // The chat lives on the fourth account of the member: a limited old account must not use up a probe.
  const mock = withMockTransport(request => request.path === '/acc_c/chats/chat-1' ? jsonResponse(oneToOne()) : { status: 404, body: {} });
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context({}, [oldRow, linkedinRow('acc_a'), linkedinRow('acc_b'), linkedinRow('acc_c')]));
    equal(verdict.allowed, true);
    equal(mock.calls.map(call => call.path), ['/acc_a/chats/chat-1', '/acc_b/chats/chat-1', '/acc_c/chats/chat-1']);
  } finally { mock.restore(); }
  // Four accounts in good standing and the chat is on the fourth: the answer says the check is bounded, not that the chat is foreign.
  const bounded = withMockTransport(request => request.path === '/acc_d/chats/chat-1' ? jsonResponse(oneToOne()) : { status: 404, body: {} });
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context({}, ['acc_a', 'acc_b', 'acc_c', 'acc_d'].map(id => linkedinRow(id))));
    equal(verdict.allowed, false);
    assert(String(verdict.reason).includes('plus de comptes LinkedIn'), String(verdict.reason));
    assert(!String(verdict.reason).includes("n'appartient pas"));
    equal(bounded.calls.length, 3);
  } finally { bounded.restore(); }
});

Deno.test('a chat carried by a disconnected account asks to reconnect instead of a retry that never succeeds', async () => {
  const mock = withMockTransport(() => ({ status: 401, body: { message: 'account disconnected' } }));
  try {
    const verdict = await tool('send_linkedin_message').verifyAccess({ chat_id: 'chat-1', text: 'Bonjour' }, context({}, [linkedinRow('acc_a')]));
    equal(verdict.allowed, false);
    assert(String(verdict.reason).includes('reconnectez-le'), String(verdict.reason));
    assert(!String(verdict.reason).includes('réessayez'));
  } finally { mock.restore(); }
});

Deno.test('send_email is one JSON send on the account path and keeps the Email id', async () => {
  const mock = withMockTransport(() => ({ body: { object: 'EmailSent', id: 'email-9', message_id: '<rfc@example.test>' } }));
  try {
    const result = await tool('send_email').execute({ to_email: 'Marie@Example.test', recipient_name: 'Marie', subject: 'Bonjour', body: 'Ligne 1\nLigne <2>' }, context());
    assert(result.success, JSON.stringify(result));
    equal((result.data as Row).email_id, 'email-9');
    equal(mock.calls.length, 1);
    const [call] = mock.calls;
    equal([call.method, call.path], ['POST', '/acc_mail/emails/send']);
    const body = call.body as Row;
    equal(Object.keys(body).sort(), ['html', 'subject', 'to']);
    equal(body.to, [{ email: 'marie@example.test', display_name: 'Marie' }]);
    assert(String(body.html).includes('Ligne 1<br>Ligne &lt;2&gt;'));
  } finally { mock.restore(); }
});

Deno.test('send_email: an uncertain outcome is a failure that says so and is never repeated; a refusal names no provider', async () => {
  const cases: Array<[MockReply, string]> = [
    [networkError('Connection lost'), 'pas confirmé'],
    [{ status: 502, body: { message: 'Unipile gateway error' } }, 'pas confirmé'],
    [{ status: 422, body: { message: 'Unipile: invalid recipient' } }, "Échec de l'envoi (422)"],
  ];
  for (const [reply, expected] of cases) {
    const mock = withMockTransport(() => reply);
    try {
      const result = await tool('send_email').execute({ to_email: 'marie@example.test', subject: 'Bonjour', body: 'Texte' }, context());
      assert(!result.success);
      assert(String(result.error).includes(expected), String(result.error));
      assert(!/unipile/i.test(String(result.error)));
      equal(mock.calls.length, 1);
    } finally { mock.restore(); }
  }
});

Deno.test('send_email: a mailbox with an outdated id sends nothing and asks to reconnect', async () => {
  const mock = withMockTransport(() => ({ body: { object: 'EmailSent', id: 'x' } }));
  try {
    const ctx = context({ member_email_accounts: [{ organization_id: ORG, user_id: USER, email_account_id: 'legacy-mail-id', email_address: 'recruiter@example.test', account_status: 'OK', linked_at: '2026-10-01' }] });
    const result = await tool('send_email').execute({ to_email: 'marie@example.test', subject: 'Bonjour', body: 'Texte' }, ctx);
    assert(!result.success);
    assert(String(result.error).includes('reconnectée'));
    equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});
