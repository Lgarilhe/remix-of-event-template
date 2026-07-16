import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildSafeMcpConfiguration,
  normalizeAllowedMcpTools,
} from '../../supabase/functions/_shared/mcp-policy.mjs';

test('normalizes and deduplicates an MCP tool allowlist', () => {
  assert.deepEqual(
    normalizeAllowedMcpTools([' search ', 'search', 'notion.read_page', '', '../bad']),
    ['search', 'notion.read_page'],
  );
});

test('drops tool names that clearly represent mutations', () => {
  assert.deepEqual(
    normalizeAllowedMcpTools([
      'search',
      'notion.read_page',
      'notion.create_page',
      'slack.send_message',
      'calendar.events.delete',
    ]),
    ['search', 'notion.read_page'],
  );
});

test('caps the allowlist to 50 tools', () => {
  const names = Array.from({ length: 75 }, (_, i) => `read_tool_${i}`);
  assert.equal(normalizeAllowedMcpTools(names).length, 50);
});

test('fails closed when a connector has no explicit allowlist', () => {
  assert.equal(buildSafeMcpConfiguration({
    name: 'notion',
    url: 'https://mcp.example.com',
    enabled: true,
    allowed_tools: [],
  }), null);
});

test('fails closed unless the connector is explicitly enabled', () => {
  assert.equal(buildSafeMcpConfiguration({
    name: 'notion',
    url: 'https://mcp.example.com',
    allowed_tools: ['search'],
  }), null);
});

test('rejects non-HTTPS connector URLs', () => {
  assert.equal(buildSafeMcpConfiguration({
    name: 'notion',
    url: 'http://mcp.example.com',
    enabled: true,
    allowed_tools: ['search'],
  }), null);
});

test('builds provider payloads with a deny-by-default toolset allowlist', () => {
  assert.deepEqual(buildSafeMcpConfiguration({
    name: 'notion',
    url: 'https://mcp.example.com',
    authorization_token: ' secret ',
    enabled: true,
    allowed_tools: ['search', 'read_page'],
  }), {
    server: {
      type: 'url',
      name: 'notion',
      url: 'https://mcp.example.com',
      authorization_token: 'secret',
    },
    toolset: {
      type: 'mcp_toolset',
      mcp_server_name: 'notion',
      default_config: { enabled: false },
      configs: {
        search: { enabled: true },
        read_page: { enabled: true },
      },
    },
  });
});

test('the database migration enforces the same fail-closed boundary', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260716120000_mcp_connector_allowlists.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /enabled = false OR cardinality\(allowed_tools\) > 0/);
  assert.match(migration, /create\|write\|update\|delete\|remove\|send/i);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /GRANT SELECT \(allowed_tools\)/);
});
