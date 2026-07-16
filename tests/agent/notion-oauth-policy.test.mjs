import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildNotionAuthorizationUrl,
  buildNotionReturnUrl,
  normalizeNotionReturnUrl,
  selectNotionReadScopes,
} from '../../supabase/functions/_shared/notion-oauth-policy.mjs';

test('Notion OAuth return URLs are limited to Konekt and local development', () => {
  assert.equal(
    normalizeNotionReturnUrl(
      'https://konekt-app-navy.vercel.app/settings?tab=agent-actions&code=secret#fragment',
      undefined,
      undefined,
    ),
    'https://konekt-app-navy.vercel.app/settings?tab=agent-actions',
  );

  assert.equal(
    normalizeNotionReturnUrl(
      'https://konekt-mofldfeum-lgarilhe-konektfrs-projects.vercel.app/settings?tab=agent-actions',
      undefined,
      undefined,
    ),
    'https://konekt-mofldfeum-lgarilhe-konektfrs-projects.vercel.app/settings?tab=agent-actions',
  );

  assert.equal(
    normalizeNotionReturnUrl('http://localhost:5173/settings?tab=agent-actions', undefined, undefined),
    'http://localhost:5173/settings?tab=agent-actions',
  );

  assert.equal(normalizeNotionReturnUrl('https://evil.example/callback', undefined, undefined), null);
  assert.equal(normalizeNotionReturnUrl('javascript:alert(1)', undefined, undefined), null);
  assert.equal(normalizeNotionReturnUrl('https://user:pass@konekt-app-navy.vercel.app/', undefined, undefined), null);
});

test('Notion OAuth requests only advertised read scopes', () => {
  assert.deepEqual(
    selectNotionReadScopes(['mcp:read', 'mcp:write', 'read', 'write', 'mcp:read']),
    ['mcp:read', 'read'],
  );
  assert.deepEqual(selectNotionReadScopes(undefined), []);
});

test('Notion authorization URL contains PKCE and never the verifier', () => {
  const url = new URL(buildNotionAuthorizationUrl({
    authorizationEndpoint: 'https://mcp.notion.com/oauth/authorize',
    clientId: 'client-123',
    redirectUri: 'https://project.supabase.co/functions/v1/notion-oauth',
    codeChallenge: 'challenge-123',
    state: 'state-123',
    scopes: ['mcp:read'],
    resource: 'https://mcp.notion.com/mcp',
  }));

  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-123');
  assert.equal(url.searchParams.get('scope'), 'mcp:read');
  assert.equal(url.searchParams.get('resource'), 'https://mcp.notion.com/mcp');
  assert.equal(url.searchParams.has('code_verifier'), false);
});

test('Notion callback outcome is appended without losing the settings tab', () => {
  const success = new URL(buildNotionReturnUrl(
    'https://konekt-app-navy.vercel.app/settings?tab=agent-actions',
    'connected',
  ));
  assert.equal(success.searchParams.get('tab'), 'agent-actions');
  assert.equal(success.searchParams.get('notion_oauth'), 'connected');
  assert.equal(success.searchParams.has('notion_error'), false);

  const failure = new URL(buildNotionReturnUrl(success.toString(), 'error', 'access_denied'));
  assert.equal(failure.searchParams.get('notion_oauth'), 'error');
  assert.equal(failure.searchParams.get('notion_error'), 'access_denied');
});

test('Notion OAuth tokens stay server-only and refreshes are serialized', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260716113136_notion_oauth_connections.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /ALTER TABLE public\.organization_notion_connections ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.organization_notion_connections FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /claim_notion_token_refresh/);
  assert.match(migration, /PRIMARY KEY \(organization_id, user_id\)/);
  assert.match(migration, /token_ciphertext text/);
  assert.match(migration, /code_verifier_ciphertext text/);
  assert.match(migration, /refresh_lease_id uuid/);
  assert.doesNotMatch(migration, /\b(?:access_token|refresh_token|code_verifier) text/);
  assert.doesNotMatch(migration, /GRANT SELECT[^;]+organization_notion_connections[^;]+authenticated/i);
});

test('the chat only exposes Notion search and fetch through the managed connector', () => {
  const resolver = readFileSync(
    new URL('../../supabase/functions/_shared/notion-mcp-connection.ts', import.meta.url),
    'utf8',
  );
  const chat = readFileSync(
    new URL('../../supabase/functions/search-agent-chat/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(resolver, /\['notion-search', 'notion-fetch'\]/);
  assert.doesNotMatch(resolver, /notion-(?:create|update|move|duplicate|delete)/);
  assert.match(resolver, /\.eq\('user_id', userId\)/);
  assert.match(resolver, /encryptNotionTokens/);
  assert.match(resolver, /\.eq\('grant_id', grantId\)/);
  assert.match(chat, /resolveNotionMcpConnectorRow/);
  assert.match(chat, /resolveNotionMcpConnectorRow\(supabase, orgId, user\.id\)/);
});
