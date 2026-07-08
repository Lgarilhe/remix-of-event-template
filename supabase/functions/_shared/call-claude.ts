// Passerelle IA multi-provider (drop-in des anciens calls Lovable AI Gateway).
//
// Accepte un payload au format OpenAI Chat Completions (model, messages,
// temperature, max_tokens, tools, tool_choice, response_format) et route vers
// le bon provider selon le MODEL_CATALOG :
//   - provider "anthropic" → Anthropic Messages API (conversion du payload)
//   - provider "scaleway"/"ovh"/"openai"/"google" → Chat Completions (passthrough)
//
// Garde de souveraineté : la résolution du modèle passe par
// resolveModelAndProvider(), qui JETTE sur un modèle inconnu — plus aucun
// fallback silencieux vers Anthropic. Cf. docs/ai-sovereign-mode.md.

import { resolveModelAndProvider, MODEL_CATALOG, PROVIDER_CONFIG, type ResolvedModel } from "./ai-config.ts";
import { ANTI_AI_STYLE_PROMPT, ANTI_AI_STYLE_COMPACT } from "./anti-ai-style.ts";

/**
 * Résout le modèle vers son provider.
 *  - id au catalogue → résolution stricte (route par provider).
 *  - id Claude daté/legacy hors catalogue (ex. "claude-haiku-4-5-20251001")
 *    → passthrough Anthropic (pas de throw, rétrocompat).
 *  - id NON-Claude inconnu → JETTE (garde de souveraineté : pas de fallback
 *    silencieux vers Anthropic).
 */
function resolveModel(requestedModel: string | undefined): ResolvedModel {
  const id = requestedModel ?? "claude-haiku-4-5";
  if (MODEL_CATALOG[id]) return resolveModelAndProvider(id);
  if (id.startsWith("claude-")) {
    return {
      provider: "anthropic",
      kind: "anthropic",
      apiModelId: id,
      baseUrl: PROVIDER_CONFIG.anthropic.baseUrl,
      apiKeyEnv: PROVIDER_CONFIG.anthropic.apiKeyEnv,
    };
  }
  throw new Error(`[call-claude] Modèle inconnu non-Claude '${id}' — refus de fallback silencieux (garde de souveraineté).`);
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolChoice {
  type: "function";
  function: { name: string };
}

export interface ClaudeCompatOptions {
  model?: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice | "auto" | "none";
  response_format?: { type: "json_object" | "text" };
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Injecte les règles anti-IA Konekt dans le system prompt.
   * - "full" : version complète (~250 tokens) — messages user-facing.
   * - "compact" : version condensée (~80 tokens) — analyses internes.
   * - "none" / undefined : aucune règle — classifs, scoring, JSON tools.
   */
  antiAiStyle?: "full" | "compact" | "none";
  /** Bloc de contexte IA user/org pré-formaté (cf _shared/ai-context.ts). */
  aiContext?: string;
}

export interface ClaudeCompatResult {
  content: string;
  toolCall: { name: string; input: Record<string, unknown> } | null;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stop_reason: string;
}

export class ClaudeCompatError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`AI provider ${status}: ${body}`);
    this.name = "ClaudeCompatError";
    this.status = status;
    this.body = body;
  }
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** POST avec retry 429/529 + backoff exponentiel, commun aux providers. */
async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
  maxRetries: number,
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, timeoutMs);

      if (response.ok) return await response.json();

      const status = response.status;
      const errorBody = await response.text().catch(() => "");
      if ((status === 429 || status === 529 || status === 503) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new ClaudeCompatError(status, errorBody);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (
        attempt < maxRetries &&
        (lastError.message.includes("abort") || lastError.message.includes("network") || lastError.message.includes("fetch"))
      ) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("postWithRetry: exhausted retries");
}

/**
 * Drop-in replacement multi-provider. Convertit/route le payload OpenAI vers
 * le provider du modèle et normalise la réponse en ClaudeCompatResult.
 */
export async function callClaudeCompat(opts: ClaudeCompatOptions): Promise<ClaudeCompatResult> {
  const resolved = resolveModel(opts.model);
  const apiKey = Deno.env.get(resolved.apiKeyEnv);
  if (!apiKey) throw new Error(`${resolved.apiKeyEnv} is not configured (provider ${resolved.provider})`);

  const timeoutMs = opts.timeoutMs ?? 45000;
  const maxRetries = opts.maxRetries ?? 2;

  // ── System prompt partagé (mêmes règles quel que soit le provider) ──
  const systemParts: string[] = [];
  const chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of opts.messages) {
    if (m.role === "system") systemParts.push(m.content);
    else chatMessages.push({ role: m.role, content: m.content });
  }
  if (opts.aiContext && opts.aiContext.trim().length > 0) {
    systemParts.unshift(opts.aiContext);
  }
  if (opts.antiAiStyle === "full") systemParts.unshift(ANTI_AI_STYLE_PROMPT);
  else if (opts.antiAiStyle === "compact") systemParts.unshift(ANTI_AI_STYLE_COMPACT);
  if (opts.response_format?.type === "json_object") {
    systemParts.push("Respond ONLY with valid JSON. No markdown code blocks, no prose before or after.");
  }
  const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

  if (resolved.kind === "anthropic") {
    return await callAnthropic(resolved, apiKey, systemPrompt, chatMessages, opts, timeoutMs, maxRetries);
  }
  return await callOpenAICompat(resolved, apiKey, systemPrompt, chatMessages, opts, timeoutMs, maxRetries);
}

// ─── Anthropic Messages API ────────────────────────────────────────────────
async function callAnthropic(
  resolved: ResolvedModel,
  apiKey: string,
  systemPrompt: string | undefined,
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>,
  opts: ClaudeCompatOptions,
  timeoutMs: number,
  maxRetries: number,
): Promise<ClaudeCompatResult> {
  const body: Record<string, unknown> = {
    model: resolved.apiModelId,
    max_tokens: opts.max_tokens ?? 2000,
    messages: chatMessages,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters,
    }));
    if (opts.tool_choice && typeof opts.tool_choice === "object" && opts.tool_choice.type === "function") {
      body.tool_choice = { type: "tool", name: opts.tool_choice.function.name };
    } else if (opts.tool_choice === "auto") {
      body.tool_choice = { type: "auto" };
    } else if (opts.tool_choice === "none") {
      delete body.tools;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "prompt-caching-2024-07-31",
  };

  const data = await postWithRetry(resolved.baseUrl, headers, body, timeoutMs, maxRetries);
  return parseAnthropicResponse(data);
}

function parseAnthropicResponse(data: {
  content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  stop_reason?: string;
}): ClaudeCompatResult {
  const blocks = data.content ?? [];
  const textBlocks = blocks.filter((b) => b.type === "text" && typeof b.text === "string");
  const toolBlocks = blocks.filter((b) => b.type === "tool_use" && b.name && b.input);
  const content = textBlocks.map((b) => b.text as string).join("");
  const toolCall = toolBlocks.length > 0
    ? { name: toolBlocks[0].name as string, input: toolBlocks[0].input as Record<string, unknown> }
    : null;
  return {
    content,
    toolCall,
    usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
    model: data.model ?? "",
    stop_reason: data.stop_reason ?? "",
  };
}

// ─── OpenAI-compatible Chat Completions (Scaleway / OVH / OpenAI / Google) ──
async function callOpenAICompat(
  resolved: ResolvedModel,
  apiKey: string,
  systemPrompt: string | undefined,
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>,
  opts: ClaudeCompatOptions,
  timeoutMs: number,
  maxRetries: number,
): Promise<ClaudeCompatResult> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push(...chatMessages);

  const body: Record<string, unknown> = {
    model: resolved.apiModelId,
    max_tokens: opts.max_tokens ?? 2000,
    messages,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.response_format?.type === "json_object") body.response_format = { type: "json_object" };

  // Tools : déjà au format OpenAI dans opts → passthrough.
  if (opts.tools && opts.tools.length > 0 && opts.tool_choice !== "none") {
    body.tools = opts.tools;
    if (opts.tool_choice && typeof opts.tool_choice === "object") {
      body.tool_choice = opts.tool_choice;
    } else if (opts.tool_choice === "auto") {
      body.tool_choice = "auto";
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  const data = await postWithRetry(resolved.baseUrl, headers, body, timeoutMs, maxRetries);
  return parseOpenAIResponse(data);
}

function parseOpenAIResponse(data: {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}): ClaudeCompatResult {
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const content = typeof msg?.content === "string" ? msg.content : "";

  let toolCall: { name: string; input: Record<string, unknown> } | null = null;
  const tc = msg?.tool_calls?.[0]?.function;
  if (tc?.name) {
    let input: Record<string, unknown> = {};
    try { input = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch { input = {}; }
    toolCall = { name: tc.name, input };
  }

  return {
    content,
    toolCall,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
    model: data.model ?? "",
    stop_reason: choice?.finish_reason ?? "",
  };
}
