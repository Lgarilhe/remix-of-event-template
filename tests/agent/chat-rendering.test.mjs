import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.match(toolUis, /if \(notionKind && successful\) return null/);
  assert.match(chatFunction, /cb\.is_error === true \? "error" : "ok"/);
  assert.match(toolUis, /outcome === 'error'/);
});

test('read tools are silent and narrow chat results avoid markdown tables', () => {
  assert.match(chatFunction, /n'écris aucun texte avant ou entre les appels/);
  assert.match(chatFunction, /n'utilise JAMAIS de tableau/);
});
