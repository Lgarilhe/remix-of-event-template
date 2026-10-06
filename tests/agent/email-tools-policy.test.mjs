import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildEmailSearchQuery,
  buildEmailThreadQuery,
  normalizeEmailAddress,
  sanitizeEmailBody,
  stripEmailHtml,
} from '../../supabase/functions/_shared/email-tool-policy.mjs';
import {
  isReservedConnectorName,
  normalizeEnabledConnectorNames,
} from '../../supabase/functions/_shared/connector-selection.mjs';

const emailTools = readFileSync(
  new URL('../../supabase/functions/_shared/agent-tools-email.ts', import.meta.url),
  'utf8',
);
const chatFunction = readFileSync(
  new URL('../../supabase/functions/search-agent-chat/index.ts', import.meta.url),
  'utf8',
);
const toolRegistry = readFileSync(
  new URL('../../supabase/functions/_shared/agent-tools.ts', import.meta.url),
  'utf8',
);
const emailStatusHook = readFileSync(
  new URL('../../src/hooks/useEmailConnectorStatus.ts', import.meta.url),
  'utf8',
);
const toolUis = readFileSync(
  new URL('../../src/components/assistant-ui/tool-uis.tsx', import.meta.url),
  'utf8',
);
const mutationTools = readFileSync(
  new URL('../../supabase/functions/_shared/agent-tools-mutations.ts', import.meta.url),
  'utf8',
);
const unipileAccounts = readFileSync(
  new URL('../../supabase/functions/unipile-accounts/index.ts', import.meta.url),
  'utf8',
);
const unipileWebhook = readFileSync(
  new URL('../../supabase/functions/unipile-webhook/index.ts', import.meta.url),
  'utf8',
);
const emailRlsMigration = readFileSync(
  new URL('../../supabase/migrations/20260716130000_harden_member_email_account_writes.sql', import.meta.url),
  'utf8',
);

test('free-text email search avoids Microsoft-incompatible combined filters', () => {
  const { params, outputLimit, localFilters } = buildEmailSearchQuery({
    accountId: 'server-resolved-account',
    query: '  projet   Numspot  ',
    participantEmail: 'Laurent@Example.com',
    after: '2026-07-01',
    before: '2026-08-01',
    limit: 999,
  });
  assert.equal(params.get('account_id'), 'server-resolved-account');
  assert.equal(params.get('search'), 'projet Numspot');
  assert.equal(params.has('any_email'), false);
  assert.equal(params.has('after'), false);
  assert.equal(params.has('before'), false);
  assert.equal(outputLimit, 20);
  assert.deepEqual(localFilters, {
    participantEmail: 'laurent@example.com',
    after: '2026-07-01T00:00:00.000Z',
    before: '2026-08-01T00:00:00.000Z',
  });
});

test('email search uses provider-side participant and date filters without free text', () => {
  const { params, outputLimit } = buildEmailSearchQuery({
    accountId: 'private-account',
    participantEmail: 'contact@example.com',
    after: '2026-07-10T10:15:00Z',
    before: 'invalid',
    limit: 0,
  });
  assert.equal(params.get('any_email'), 'contact@example.com');
  assert.equal(params.get('after'), '2026-07-10T10:15:00.000Z');
  assert.equal(params.has('before'), false);
  assert.equal(params.has('search'), false);
  assert.equal(outputLimit, 1);
  assert.equal(normalizeEmailAddress('not an email'), null);
});

test('thread reads are bounded and always scoped to the server account', () => {
  const { params, threadId, limit } = buildEmailThreadQuery({
    accountId: 'private-account',
    threadId: '  opaque-thread  ',
    limit: 500,
  });
  assert.equal(params.get('account_id'), 'private-account');
  assert.equal(params.get('thread_id'), 'opaque-thread');
  assert.equal(threadId, 'opaque-thread');
  assert.equal(limit, 20);
});

test('email bodies are converted to bounded plain text before reaching the model', () => {
  const html = '<style>.secret{display:none}</style><script>steal()</script><p>Bonjour&nbsp;&amp; bienvenue</p><div>Suite</div>';
  assert.equal(stripEmailHtml(html, 200), 'Bonjour & bienvenue\nSuite');
  assert.equal(sanitizeEmailBody('  Texte\r\n simple  ', html, 200), 'Texte\nsimple');
  assert.equal(stripEmailHtml(`<p>${'x'.repeat(200)}</p>`, 25).length, 25);
});

test('personal email tools are server-scoped and never expose account_id as model input', () => {
  assert.match(emailTools, /name: 'search_email_threads'/);
  assert.match(emailTools, /name: 'get_email_thread'/);
  assert.match(emailTools, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(emailTools, /\.eq\('user_id', ctx\.userId\)/);
  assert.match(emailTools, /resolveUnipileCredentials\(ctx\.organizationId, ctx\.adminClient\)/);
  assert.match(emailTools, /\/api\/v1\/emails\?/);
  assert.match(emailTools, /method: 'GET'/);
  assert.match(emailTools, /untrusted_external_content: true/);
  assert.doesNotMatch(emailTools, /account_id:\s*\{\s*type:/);
  assert.doesNotMatch(emailTools, /resolveOrgLinkedInAccounts/);
});

test('email tools require an explicit email connector on exposure and execution', () => {
  assert.match(chatFunction, /const emailToolsEnabled = enabledConnectorNames !== null/);
  assert.match(chatFunction, /connectorSelectedForRequest\("email", enabledConnectorNames\)/);
  assert.match(chatFunction, /emailToolsEnabled \|\| !isEmailToolName\(tool\.name\)/);
  assert.match(chatFunction, /isEmailToolName\(tc\.name\) && !emailToolsEnabled/);
  assert.match(chatFunction, /emailToolProvider/);
  assert.match(chatFunction, /\\u00b7/);
});

test('personal email output is redacted from audit storage', () => {
  assert.match(emailTools, /redactResultInAudit: true/g);
  assert.match(toolRegistry, /tool\.redactResultInAudit/);
  assert.match(toolRegistry, /data: \{ redacted: true \}/);
});

test('email status and existing send path never fall back to a teammate mailbox', () => {
  assert.match(emailStatusHook, /\.eq\('organization_id', organizationId!\)/);
  assert.match(emailStatusHook, /\.eq\('user_id', userId!\)/);
  assert.match(mutationTools, /\.eq\('user_id', ctx\.userId\)/);
  assert.doesNotMatch(mutationTools, /\?\? ok\[0\]/);
  assert.match(unipileAccounts, /\.eq\('user_id', user\.id\)/);
  assert.doesNotMatch(unipileAccounts, /keyPrefix=/);
});

test('email mappings are self-write-only and hosted auth routes email accounts correctly', () => {
  assert.match(emailRlsMigration, /user_id = auth\.uid\(\)/g);
  assert.match(emailRlsMigration, /linked_by = auth\.uid\(\)/g);
  assert.match(emailRlsMigration, /WITH CHECK/);
  assert.match(unipileWebhook, /EMAIL_ACCOUNT_TYPES/);
  assert.match(unipileWebhook, /\.from\('member_email_accounts'\)/);
  assert.match(unipileWebhook, /Refusing to reassign an email account to another user/);
});

test('email tool activity renders the provider logo and stays transient on success', () => {
  assert.match(toolUis, /search_email_threads/);
  assert.match(toolUis, /get_email_thread/);
  assert.match(toolUis, /EmailProviderLogo/);
  assert.match(toolUis, /if \(emailInfo && successful\) return null/);
});

test('built-in email names are reserved from generic MCP connectors and selection caps at seven', () => {
  for (const name of ['notion', 'email', 'gmail', 'outlook']) {
    assert.equal(isReservedConnectorName(name), true);
  }
  assert.equal(isReservedConnectorName('slack'), false);
  assert.deepEqual(
    normalizeEnabledConnectorNames(['notion', 'email', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff']),
    ['notion', 'email', 'aa', 'bb', 'cc', 'dd', 'ee'],
  );
  assert.match(chatFunction, /!isReservedConnectorName\(name\)/);
  assert.match(chatFunction, /!isReservedConnectorName\(row\.name\)/);
});
