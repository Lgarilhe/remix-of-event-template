// Passerelle Anthropic : paramètres des modèles génération 5 (Sonnet 5.x, Opus 5.x).
// Aucun appel réseau : fetch est remplacé et le corps envoyé est inspecté.
//
//   deno test --no-check --allow-env supabase/functions/_shared/call-claude.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { callClaudeCompat, type OpenAITool } from './call-claude.ts';

Deno.env.set('ANTHROPIC_API_KEY', 'test-key');

// Les champs du corps que les tests lisent.
type SentBody = {
  model: string;
  system: string;
  max_tokens: number;
  temperature?: number;
  output_config?: unknown;
  tool_choice?: unknown;
  tools: Array<{ name: string; strict?: boolean }>;
};

const closedTool = (name: string): OpenAITool => ({
  type: 'function',
  function: {
    name,
    description: 'test',
    parameters: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } } },
      required: ['items'],
      additionalProperties: false,
    },
  },
});

// Schéma hors du sous-ensemble strict : minItems 5 et maxItems 5, objet interne sans additionalProperties.
const looseTool = (name: string): OpenAITool => ({
  type: 'function',
  function: {
    name,
    parameters: {
      type: 'object',
      properties: { rubric: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 5 }, extra: { type: 'object' } },
      required: ['rubric'],
      additionalProperties: false,
    },
  },
});

async function sentBody(model: string, extra: Record<string, unknown>, response: unknown = { content: [], usage: {}, model, stop_reason: 'end_turn' }) {
  const realFetch = globalThis.fetch;
  let body = {} as SentBody;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
  }) as typeof fetch;
  try {
    const result = await callClaudeCompat({ model, messages: [{ role: 'system', content: 'Consigne.' }, { role: 'user', content: 'Texte.' }], ...extra });
    return { body, result };
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test('Haiku : temperature et tool_choice forcé inchangés', async () => {
  const { body } = await sentBody('claude-haiku-4-5', {
    temperature: 0.2, max_tokens: 1500, tools: [closedTool('rank')], tool_choice: { type: 'function', function: { name: 'rank' } },
  });
  strictEqual(body.temperature, 0.2);
  deepStrictEqual(body.tool_choice, { type: 'tool', name: 'rank' });
  strictEqual(body.max_tokens, 1500);
  strictEqual(body.output_config, undefined);
  strictEqual(body.tools[0].strict, undefined);
  strictEqual(body.system, 'Consigne.');
});

for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5']) {
  Deno.test(`${model} : pas de temperature, tool_choice auto, consigne, effort bas, marge de réflexion`, async () => {
    const { body } = await sentBody(model, {
      temperature: 0.7, max_tokens: 1500, tools: [closedTool('rank')], tool_choice: { type: 'function', function: { name: 'rank' } },
    });
    strictEqual(body.model, model);
    strictEqual('temperature' in body, false);
    deepStrictEqual(body.tool_choice, { type: 'auto' });
    ok(body.system.startsWith('Consigne.'));
    ok(body.system.includes('"rank"'), 'la consigne nomme l\'outil');
    deepStrictEqual(body.output_config, { effort: 'low' });
    strictEqual(body.max_tokens, 3500);
    strictEqual(body.tools[0].strict, true);
  });
}

Deno.test('génération 5 : sans system d\'origine, la consigne devient le system', async () => {
  const realFetch = globalThis.fetch;
  let body = {} as SentBody;
  globalThis.fetch = ((_u: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({ content: [], usage: {} }), { status: 200 }));
  }) as typeof fetch;
  try {
    await callClaudeCompat({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'Texte.' }], tools: [closedTool('t')], tool_choice: { type: 'function', function: { name: 't' } } });
  } finally {
    globalThis.fetch = realFetch;
  }
  ok(body.system.includes('"t"'));
});

Deno.test('génération 5 : schéma hors sous-ensemble strict, pas de strict', async () => {
  const { body } = await sentBody('claude-sonnet-5-5', { tools: [looseTool('gen')], tool_choice: { type: 'function', function: { name: 'gen' } } });
  deepStrictEqual(body.tool_choice, { type: 'auto' });
  strictEqual(body.tools[0].strict, undefined);
});

Deno.test('génération 5 : strict seulement sur l\'outil imposé', async () => {
  const { body } = await sentBody('claude-opus-5-5', { tools: [closedTool('a'), closedTool('b')], tool_choice: { type: 'function', function: { name: 'b' } } });
  strictEqual(body.tools[0].strict, undefined);
  strictEqual(body.tools[1].strict, true);
});

Deno.test('génération 5 : strict refusé au-delà de 24 paramètres optionnels', async () => {
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < 25; i++) properties[`p${i}`] = { type: 'string' };
  const wide: OpenAITool = { type: 'function', function: { name: 'wide', parameters: { type: 'object', properties, additionalProperties: false } } };
  const { body } = await sentBody('claude-sonnet-5-5', { tools: [wide], tool_choice: { type: 'function', function: { name: 'wide' } } });
  strictEqual(body.tools[0].strict, undefined);
});

Deno.test('génération 5 : tool_choice auto ou absent, rien n\'est ajouté à la consigne ni forcé', async () => {
  const auto = await sentBody('claude-sonnet-5-5', { tools: [closedTool('t')], tool_choice: 'auto' });
  deepStrictEqual(auto.body.tool_choice, { type: 'auto' });
  strictEqual(auto.body.system, 'Consigne.');
  strictEqual(auto.body.tools[0].strict, undefined);
  const none = await sentBody('claude-sonnet-5-5', {});
  strictEqual('tool_choice' in none.body, false);
  strictEqual(none.body.max_tokens, 4000);
});

Deno.test('génération 5 : le bloc texte est lu après un bloc thinking', async () => {
  const { result } = await sentBody('claude-sonnet-5-5', {}, {
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Réponse.' }],
    usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  });
  strictEqual(result.content, 'Réponse.');
  strictEqual(result.toolCall, null);
});

Deno.test('génération 5 : le tool_use est lu après un bloc thinking', async () => {
  const { result } = await sentBody('claude-opus-5-5', { tools: [closedTool('rank')], tool_choice: { type: 'function', function: { name: 'rank' } } }, {
    content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', name: 'rank', input: { items: [] } }],
    usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-opus-5-5', stop_reason: 'tool_use',
  });
  deepStrictEqual(result.toolCall, { name: 'rank', input: { items: [] } });
  strictEqual(result.content, '');
});
