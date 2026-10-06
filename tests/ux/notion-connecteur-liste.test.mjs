/**
 * Notion, un connecteur parmi d'autres (décision du 04/10/2026) : une ligne de
 * la liste « Applications connectées », rien de plus.
 *
 * Lancer : node --test tests/ux/notion-connecteur-liste.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  assert.ok(i >= 0, `repère absent : ${a}`);
  const j = s.indexOf(b, i + a.length);
  assert.ok(j >= 0, `repère de fin absent : ${b}`);
  return s.slice(i, j);
};

test('Connexions : Notion n’a plus de carte à part, il est une ligne de la liste', () => {
  const connections = between(read('src/components/settings/shell/sections.tsx'), 'function ConnectionsSection()', '\n}\n');
  assert.match(connections, /<SettingsAnchor id="applications"><AssistantConnectorsCard \/><\/SettingsAnchor>/);
  assert.doesNotMatch(connections, /id="notion"|NotionConnector/);
  const card = read('src/components/settings/AssistantConnectorsCard.tsx');
  assert.match(card, /<NotionConnectorRow \/>/);
  // Les connecteurs de l'organisation sont dans la même liste, noms réservés exclus.
  assert.match(card, /from\('organization_mcp_servers'\)/);
  assert.match(card, /RESERVED_BUILTIN_CONNECTORS\.has\(server\.name\.toLowerCase\(\)\)/);
  // Lignes sous le titre de la carte (CardTitle est un h3).
  assert.match(read('src/components/settings/NotionConnectorRow.tsx'), /<h4 className="text-sm font-medium text-foreground">Notion<\/h4>/);
});

test('retour de connexion : l’adresse nettoyée pose #applications', () => {
  const row = read('src/components/settings/NotionConnectorRow.tsx');
  assert.match(row, /navigate\(\{ search: search \? `\?\$\{search\}` : '', hash: '#applications' \}, \{ replace: true \}\)/);
  assert.match(read('src/lib/settingsRoutes.ts'), /hash: '#applications' \}/);
});

test('menu du chat : « Connecter » pour une application non connectée, jamais sur un statut illisible', () => {
  const menu = read('src/components/assistant-ui/connector-menu.tsx');
  const rule = between(menu, 'const canConnect =', ';');
  assert.match(rule, /connector\.kind !== 'mcp'/);
  assert.match(rule, /connector\.status === 'disconnected'/);
  assert.doesNotMatch(rule, /isEmailConnector/, 'Notion propose « Connecter » comme l’e-mail');
  assert.match(menu, /href = '\/settings\/account\/connections#applications'/);
  assert.match(read('src/components/agent/AgentChatPanel.tsx'), /manageHref: '\/settings\/account\/connections#applications'/);
});

test('connecteur d’organisation : un nom réservé est refusé à l’ajout', () => {
  const settings = read('src/components/settings/AgentConnectorsSettings.tsx');
  const add = between(settings, 'const handleAdd = async () => {', 'setSaving(true);');
  assert.match(add, /if \(RESERVED_BUILTIN_CONNECTORS\.has\(slug\)\) \{/);
  assert.match(add, /Ce nom est réservé : Notion et l’e-mail se connectent dans Paramètres › Connexions/);
  assert.match(read('src/lib/assistantConnectors.ts'), /new Set\(\['notion', 'email', 'gmail', 'outlook'\]\)/);
});

test('prompt de l’assistant : les exemples de connecteurs ne citent plus Notion', () => {
  const block = between(read('supabase/functions/search-agent-chat/index.ts'), 'Des CONNECTEURS EXTERNES', 'connecteur MCP.');
  assert.doesNotMatch(block, /Notion/);
  assert.doesNotMatch(block, /liste blanche validée par un administrateur\. /, 'une connexion personnelle a une liste fixée par Konekt');
});

test('connexion Notion : les erreurs montrées à l’écran sont en français, au vouvoiement', () => {
  const source = read('supabase/functions/notion-mcp-oauth/index.ts');
  const messages = [...source.matchAll(/new HttpError\(\d+, (['`])([^'`]*)\1\)/g)].map((m) => m[2]);
  assert.ok(messages.length >= 8, 'messages d’erreur relevés');
  for (const message of messages) {
    assert.doesNotMatch(message, /\bTu\b|\bta\b|\bton\b|\btes\b/, `tutoiement : « ${message} »`);
    assert.doesNotMatch(message, /\b(?:failed|refused|did not|does not|metadata|discovery|exchange)\b/i, `anglais : « ${message} »`);
  }
});
