// Helper drop-in pour remplacer les calls Lovable AI Gateway (format OpenAI
// Chat Completions) par des calls Anthropic Messages API directs.
//
// Accepte le même body qu'envoyait Lovable (model, messages, temperature,
// max_tokens, tools, tool_choice, response_format) et retourne soit le
// contenu texte soit le résultat d'un tool call, avec la même shape que
// celle qu'on extrayait des réponses Lovable/OpenAI.
//
// Mapping modèle : les noms non-Claude (google/gemini-*, openai/*, etc.)
// sont mappés vers Claude Haiku 4.5 par défaut — on perd les modèles tiers
// mais on supprime la dépendance au gateway.

import { getAnthropicModelId } from "./ai-config.ts";
import { ANTI_AI_STYLE_PROMPT, ANTI_AI_STYLE_COMPACT } from "./anti-ai-style.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Résout les env vars à l'appel, pas à l'import — ça rend le code plus
// testable et évite les globals mutables.
function getApiKey(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  return key;
}

function mapModel(requestedModel: string | undefined): string {
  if (!requestedModel) return "claude-haiku-4-5-20251001";
  // Modèles Claude natifs → passer tel quel (après normalisation alias)
  if (requestedModel.startsWith("claude-")) {
    return getAnthropicModelId(requestedModel);
  }
  // Tout le reste (google/gemini-*, openai/*, sonar…) → Haiku par défaut
  return "claude-haiku-4-5-20251001";
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
   * - "full" : version complète (~250 tokens) — pour les messages user-facing
   *            (outreach, replies, descriptions de mission, etc.)
   * - "compact" : version condensée (~80 tokens) — pour les contextes où
   *               l'espace token est précieux (analyses, summaries internes)
   * - "none" / undefined : aucune règle injectée — pour les classifs,
   *                        scoring numérique, JSON tools, etc.
   */
  antiAiStyle?: "full" | "compact" | "none";
  /**
   * Bloc de contexte IA user/org pré-formaté (cf _shared/ai-context.ts).
   * Injecté APRÈS les règles anti-IA Konekt mais AVANT le system prompt
   * spécifique de la fonction. Passe une chaîne vide pour skip — c'est
   * exactement ce que retourne loadAndBuildAiContext() quand aucun contexte
   * n'est configuré.
   */
  aiContext?: string;
}

export interface ClaudeCompatResult {
  // Texte de la réponse (vide si tool call)
  content: string;
  // Résultat du tool call si tools utilisés (null sinon)
  toolCall: { name: string; input: Record<string, unknown> } | null;
  // Usage tokens pour le settle-credits
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stop_reason: string;
}

export class ClaudeCompatError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Anthropic API ${status}: ${body}`);
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

/**
 * Drop-in replacement pour les calls Lovable AI Gateway.
 * Convertit le payload OpenAI Chat Completions → Anthropic Messages API,
 * gère les retries 429/529 avec backoff exponentiel.
 */
export async function callClaudeCompat(opts: ClaudeCompatOptions): Promise<ClaudeCompatResult> {
  const apiKey = getApiKey();
  const model = mapModel(opts.model);
  const timeoutMs = opts.timeoutMs ?? 45000;
  const maxRetries = opts.maxRetries ?? 2;

  // Séparer messages system du reste, les concaténer dans `system`
  const systemParts: string[] = [];
  const chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of opts.messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }

  // Injection du contexte IA user/org (Settings → Contexte IA) APRÈS le
  // system de la fonction mais AVANT les règles anti-IA (qui resteront en
  // priorité absolue via le unshift suivant).
  if (opts.aiContext && opts.aiContext.trim().length > 0) {
    systemParts.unshift(opts.aiContext);
  }

  // Injection des règles anti-IA Konekt selon le flag.
  // En 1re position pour qu'elles soient prioritaires sur le reste du system.
  if (opts.antiAiStyle === "full") {
    systemParts.unshift(ANTI_AI_STYLE_PROMPT);
  } else if (opts.antiAiStyle === "compact") {
    systemParts.unshift(ANTI_AI_STYLE_COMPACT);
  }

  // JSON mode → consigne dans le system prompt (Anthropic n'a pas de mode
  // JSON strict mais c'est fiable avec la bonne consigne)
  if (opts.response_format?.type === "json_object") {
    systemParts.push("Respond ONLY with valid JSON. No markdown code blocks, no prose before or after.");
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.max_tokens ?? 2000,
    messages: chatMessages,
  };

  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }
  if (typeof opts.temperature === "number") {
    body.temperature = opts.temperature;
  }

  // Conversion tools OpenAI → Anthropic
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
      // Anthropic n'a pas d'équivalent direct — on ne set rien et le modèle
      // choisit librement, mais on enlève les tools pour forcer text only.
      delete body.tools;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "prompt-caching-2024-07-31",
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(ANTHROPIC_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, timeoutMs);

      if (response.ok) {
        const data = await response.json();
        return parseResponse(data);
      }

      const status = response.status;
      const errorBody = await response.text().catch(() => "");

      // Retry sur 429 (rate limit) et 529 (overloaded)
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new ClaudeCompatError(status, errorBody);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Retry sur erreur réseau (timeout/abort)
      if (
        attempt < maxRetries &&
        (lastError.message.includes("abort") ||
          lastError.message.includes("network") ||
          lastError.message.includes("fetch"))
      ) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("callClaudeCompat: exhausted retries");
}

function parseResponse(data: {
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
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
    model: data.model ?? "",
    stop_reason: data.stop_reason ?? "",
  };
}
