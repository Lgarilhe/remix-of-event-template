import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  connectorSelectedForRequest,
  normalizeEnabledConnectorNames,
} from '../../supabase/functions/_shared/connector-selection.mjs';

const thread = readFileSync(
  new URL('../../src/components/assistant-ui/thread.tsx', import.meta.url),
  'utf8',
);
const toolUis = readFileSync(
  new URL('../../src/components/assistant-ui/tool-uis.tsx', import.meta.url),
  'utf8',
);
const chatFunction = readFileSync(
  new URL('../../supabase/functions/search-agent-chat/index.ts', import.meta.url),
  'utf8',
);
const chatAdapter = readFileSync(
  new URL('../../src/components/assistant-ui/chat-adapter.ts', import.meta.url),
  'utf8',
);
const connectorMenu = readFileSync(
  new URL('../../src/components/assistant-ui/connector-menu.tsx', import.meta.url),
  'utf8',
);
const agentPanel = readFileSync(
  new URL('../../src/components/agent/AgentChatPanel.tsx', import.meta.url),
  'utf8',
);

test('assistant messages render GFM tables in a keyboard-scrollable container', () => {
  assert.match(thread, /import remarkGfm from 'remark-gfm'/);
  assert.match(thread, /remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(thread, /overflow-x-auto/);
  assert.match(thread, /aria-label="Tableau de résultats/);
  assert.match(thread, /tabIndex=\{0\}/);
});

test('successful Notion reads hide technical MCP chips after completion', () => {
  assert.match(toolUis, /Recherche dans Notion/);
  assert.match(toolUis, /Lecture d’une page Notion/);
  assert.match(toolUis, /notion-logo\.webp/);
  assert.match(toolUis, /data-testid="notion-tool-logo"/);
  assert.match(toolUis, /if \(notionKind && successful\) return null/);
  assert.match(chatFunction, /cb\.is_error === true \? "error" : "ok"/);
  assert.match(toolUis, /outcome === 'error'/);
});

test('read tools are silent and narrow chat results avoid markdown tables', () => {
  assert.match(chatFunction, /n'écris aucun texte avant ou entre les appels/);
  assert.match(chatFunction, /n'utilise JAMAIS de tableau/);
});

test('connector selection accepts only explicit safe connector slugs', () => {
  assert.deepEqual(normalizeEnabledConnectorNames(undefined), []);
  assert.deepEqual(normalizeEnabledConnectorNames({ notion: true }), []);
  assert.deepEqual(
    normalizeEnabledConnectorNames([' Notion ', 'notion', 'slack', 'bad slug', 42, 'x']),
    ['notion', 'slack'],
  );
  assert.deepEqual(
    normalizeEnabledConnectorNames(['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg']),
    ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'],
  );
  assert.equal(connectorSelectedForRequest('Notion', ['notion']), true);
  assert.equal(connectorSelectedForRequest('slack', ['notion']), false);
});

test('the composer sends an explicit selection and exposes accessible connector toggles', () => {
  assert.match(chatAdapter, /enabled_connectors: config\.getEnabledConnectors\?\.\(\) \?\? \[\]/);
  assert.match(connectorMenu, /Ajouter un fichier ou gérer les connecteurs/);
  assert.match(connectorMenu, /aria-label=\{`Utiliser \$\{connector\.label\} dans le chat`\}/);
  assert.match(connectorMenu, /notion-logo\.webp/);
  assert.match(agentPanel, /queryKey: \['assistant-chat-mcp-servers', organizationId\]/);
  assert.doesNotMatch(agentPanel, /queryKey: \['org-mcp-servers', organizationId\]/);
});

test('the server resolves only selected connectors and never falls back to legacy Notion', () => {
  assert.match(chatFunction, /normalizeEnabledConnectorNames\(enabled_connectors\)/);
  assert.match(chatFunction, /const notionConnectorPromise = notionSelected/);
  assert.match(chatFunction, /row\.name !== "notion"/);
  assert.match(chatFunction, /connectorSelectedForRequest\(row\.name, enabledConnectorNames\)/);
});
