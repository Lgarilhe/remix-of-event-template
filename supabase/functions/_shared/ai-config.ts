/**
 * Shared AI configuration for all edge functions.
 * Centralized model catalog, credit calculation, and API helpers.
 *
 * 1 crédit Konekt = 1 000 tokens sur Claude Sonnet 4.6 (baseline)
 *
 * Crédits facturés = max(PLANCHER_ACTION, ceil(total_tokens / 1000 × multiplicateur_modèle))
 */

// ─── Model Catalog ──────────────────────────────────────────────────────────

export type ModelTier = "budget" | "balanced" | "premium";
export type ModelProvider = "anthropic" | "google";
export type RoutingTier = "fast" | "default" | "thinking";

export interface AIModel {
  id: string;
  name: string;
  provider: ModelProvider;
  tier: ModelTier;
  /** USD per million input tokens */
  inputPricePerMTok: number;
  /** USD per million output tokens */
  outputPricePerMTok: number;
  /** Credit multiplier relative to Sonnet 4.6 baseline (×1.0) */
  multiplier: number;
  /** Max context window in tokens */
  contextWindow: number;
  /** Supports extended thinking */
  supportsThinking: boolean;
  /** Display description for the UI */
  description: string;
}

export const MODEL_CATALOG: Record<string, AIModel> = {
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    tier: "budget",
    inputPricePerMTok: 0.30,
    outputPricePerMTok: 2.50,
    multiplier: 0.15,
    contextWindow: 1_000_000,
    supportsThinking: true,
    description: "Ultra rapide, économique",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "budget",
    inputPricePerMTok: 1.00,
    outputPricePerMTok: 5.00,
    multiplier: 0.35,
    contextWindow: 200_000,
    supportsThinking: true,
    description: "Rapide, bon marché",
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    tier: "balanced",
    inputPricePerMTok: 1.25,
    outputPricePerMTok: 10.00,
    multiplier: 0.55,
    contextWindow: 1_000_000,
    supportsThinking: true,
    description: "Bon raisonnement, compétitif",
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    tier: "balanced",
    inputPricePerMTok: 3.00,
    outputPricePerMTok: 15.00,
    multiplier: 1.0,
    contextWindow: 1_000_000,
    supportsThinking: true,
    description: "Extended thinking avancé",
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    tier: "balanced",
    inputPricePerMTok: 3.00,
    outputPricePerMTok: 15.00,
    multiplier: 1.0,
    contextWindow: 1_000_000,
    supportsThinking: true,
    description: "Équilibré (recommandé)",
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    tier: "premium",
    inputPricePerMTok: 5.00,
    outputPricePerMTok: 25.00,
    multiplier: 1.8,
    contextWindow: 1_000_000,
    supportsThinking: true,
    description: "Le plus intelligent",
  },
};

// ─── Action Cost Catalog ────────────────────────────────────────────────────

export interface AIActionCost {
  /** Action identifier */
  action: string;
  /** Display name for UI */
  label: string;
  /** Minimum credits charged even if tokens are below */
  floor: number;
  /** Typical token count (input + output) for estimation */
  typicalTokens: number;
  /** Default routing tier */
  routingTier: RoutingTier;
  /** Category for grouping in UI */
  category: "sourcing" | "outreach" | "qualification" | "agent";
  /** Restrict model selection to these providers. If omitted, all providers are available. */
  providers?: ModelProvider[];
}

export const ACTION_COSTS: Record<string, AIActionCost> = {
  scoring: {
    action: "scoring",
    label: "Scoring candidat",
    floor: 2,
    typicalTokens: 4_000,
    routingTier: "default",
    category: "sourcing",
  },
  outreach_message: {
    action: "outreach_message",
    label: "Message d'approche",
    floor: 2,
    typicalTokens: 5_000,
    routingTier: "default",
    category: "outreach",
  },
  analyze_response: {
    action: "analyze_response",
    label: "Analyse réponse candidat",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "outreach",
  },
  screen_candidate: {
    action: "screen_candidate",
    label: "Screening rapide",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "sourcing",
  },
  generate_scorecard: {
    action: "generate_scorecard",
    label: "Génération scorecard",
    floor: 2,
    typicalTokens: 4_000,
    routingTier: "default",
    category: "qualification",
  },
  call_report: {
    action: "call_report",
    label: "Compte-rendu d'appel",
    floor: 2,
    typicalTokens: 4_000,
    routingTier: "default",
    category: "qualification",
  },
  live_coaching: {
    action: "live_coaching",
    label: "Coaching live (par minute)",
    floor: 5,
    typicalTokens: 10_000,
    routingTier: "default",
    category: "qualification",
  },
  agent_search_calibration: {
    action: "agent_search_calibration",
    label: "Agent — calibration",
    floor: 3,
    typicalTokens: 6_000,
    routingTier: "thinking",
    category: "agent",
    providers: ["anthropic"],
  },
  agent_search_run: {
    action: "agent_search_run",
    label: "Agent — recherche complète",
    floor: 10,
    typicalTokens: 25_000,
    routingTier: "default",
    category: "agent",
    providers: ["anthropic"],
  },
  filter_generation: {
    action: "filter_generation",
    label: "Filtres IA automatiques",
    floor: 2,
    typicalTokens: 4_000,
    routingTier: "default",
    category: "sourcing",
  },
  filter_assistant_msg: {
    action: "filter_assistant_msg",
    label: "Chat filtres (par message)",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "sourcing",
  },
  refine_search: {
    action: "refine_search",
    label: "Affiner/élargir recherche",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "sourcing",
  },
  nurturing_analysis: {
    action: "nurturing_analysis",
    label: "Analyse nurturing",
    floor: 1,
    typicalTokens: 2_500,
    routingTier: "fast",
    category: "outreach",
  },
  vivier_enrichment: {
    action: "vivier_enrichment",
    label: "Enrichissement profil",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "sourcing",
  },
  reply_suggestion: {
    action: "reply_suggestion",
    label: "Suggestion de réponse",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "outreach",
  },
  rewrite_text: {
    action: "rewrite_text",
    label: "Reformuler un texte",
    floor: 1,
    typicalTokens: 1_500,
    routingTier: "fast",
    category: "outreach",
  },
  translate_text: {
    action: "translate_text",
    label: "Traduire un texte",
    floor: 1,
    typicalTokens: 1_000,
    routingTier: "fast",
    category: "outreach",
  },
  summarize_conversation: {
    action: "summarize_conversation",
    label: "Résumer une conversation",
    floor: 1,
    typicalTokens: 1_500,
    routingTier: "fast",
    category: "outreach",
  },
  cta_reply: {
    action: "cta_reply",
    label: "Suggérer une réponse + CTA",
    floor: 1,
    // CTA "job_details" peut générer ~2k tokens (message long + JSON wrap),
    // les autres CTA sont autour de 800-1200 tokens. On part sur 1.5k typique.
    typicalTokens: 1_500,
    routingTier: "fast",
    category: "outreach",
  },
  auto_analyze_message: {
    action: "auto_analyze_message",
    label: "Classification message",
    floor: 1,
    typicalTokens: 1_000,
    routingTier: "fast",
    category: "outreach",
  },
  scorecard_chat: {
    action: "scorecard_chat",
    label: "Chat scorecard",
    floor: 1,
    typicalTokens: 2_000,
    routingTier: "fast",
    category: "qualification",
  },
  debrief: {
    action: "debrief",
    label: "Débrief rapide",
    floor: 2,
    typicalTokens: 4_000,
    routingTier: "default",
    category: "qualification",
  },
  meeting_minutes: {
    action: "meeting_minutes",
    label: "Compte-rendu réunion",
    floor: 2,
    typicalTokens: 5_000,
    routingTier: "default",
    category: "qualification",
  },
  // ─── Enrichment de contact (Better Contact) ─────────────────────────────
  // Pas de tokens consommés (c'est un appel API externe, pas Anthropic).
  // Le floor est le coût réel facturé à l'user, calculateTokenCredits avec
  // tokens=0 retournera donc exactement le floor.
  enrich_contact_email: {
    action: "enrich_contact_email",
    label: "Email pro candidat",
    floor: 1,           // 1 crédit Konekt si email trouvé
    typicalTokens: 0,
    routingTier: "fast",
    category: "sourcing",
  },
  enrich_contact_phone: {
    action: "enrich_contact_phone",
    label: "Téléphone mobile candidat",
    floor: 10,          // 10 crédits Konekt si phone trouvé (plus rare et cher)
    typicalTokens: 0,
    routingTier: "fast",
    category: "sourcing",
  },
};

// ─── Routing Defaults ───────────────────────────────────────────────────────

const ROUTING_DEFAULTS: Record<RoutingTier, string> = {
  fast: "claude-haiku-4-5",
  default: "claude-sonnet-4-6",
  thinking: "claude-sonnet-4-5",
};

// ─── Credit Calculation ─────────────────────────────────────────────────────

/**
 * Calculate credits from actual token usage.
 * Formula: max(floor, ceil(totalTokens / 1000 × multiplier))
 * Thinking tokens count as output tokens (per Anthropic billing).
 */
export function calculateTokenCredits(
  tokensInput: number,
  tokensOutput: number,
  modelId: string,
  actionId: string
): { credits: number; breakdown: { totalTokens: number; multiplier: number; floor: number; raw: number } } {
  const model = MODEL_CATALOG[modelId];
  const action = ACTION_COSTS[actionId];

  const multiplier = model?.multiplier ?? 1.0;
  const floor = action?.floor ?? 1;
  const totalTokens = tokensInput + tokensOutput;

  const raw = Math.ceil((totalTokens / 1000) * multiplier);
  const credits = Math.max(floor, raw);

  return {
    credits,
    breakdown: { totalTokens, multiplier, floor, raw },
  };
}

/**
 * Estimate credits BEFORE an API call (for UI display and pre-auth).
 * Uses typical token count for the action.
 */
export function estimateCredits(actionId: string, modelId: string): number {
  const action = ACTION_COSTS[actionId];
  const model = MODEL_CATALOG[modelId];

  if (!action) return 1;

  const multiplier = model?.multiplier ?? 1.0;
  const raw = Math.ceil((action.typicalTokens / 1000) * multiplier);
  return Math.max(action.floor, raw);
}

/**
 * Calculate the real USD cost of an API call (for internal P&L tracking).
 */
export function calculateUSDCost(
  tokensInput: number,
  tokensOutput: number,
  modelId: string
): number {
  const model = MODEL_CATALOG[modelId];
  if (!model) return 0;

  const inputCost = (tokensInput / 1_000_000) * model.inputPricePerMTok;
  const outputCost = (tokensOutput / 1_000_000) * model.outputPricePerMTok;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal precision
}

// ─── Model Resolution ───────────────────────────────────────────────────────

/**
 * Resolve which model to use.
 * Priority: userOverride > orgDefault > routing tier default
 *
 * For "fast" tier actions, orgDefault is ignored (always use budget models
 * to protect margin and speed).
 */
export function getModel(
  routingTier: RoutingTier,
  userOverride?: string | null,
  orgDefault?: string | null
): string {
  // User explicitly chose a model — always respect
  if (userOverride && MODEL_CATALOG[userOverride]) {
    return userOverride;
  }

  // Org default — skip for "fast" tier (always stay on budget models)
  if (routingTier !== "fast" && orgDefault && MODEL_CATALOG[orgDefault]) {
    return orgDefault;
  }

  return ROUTING_DEFAULTS[routingTier];
}

/**
 * Get the Anthropic model ID string for API calls.
 * Translates our internal IDs to Anthropic's expected format.
 */
export function getAnthropicModelId(modelId: string): string {
  const mapping: Record<string, string> = {
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-opus-4-6": "claude-opus-4-6",
  };
  return mapping[modelId] || modelId;
}

// ─── API Helpers ────────────────────────────────────────────────────────────

/**
 * Standard Anthropic API headers with prompt caching enabled.
 */
export function getAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "prompt-caching-2024-07-31",
  };
}

/**
 * Call Anthropic API with retry + exponential backoff on 429/529.
 * Returns the full response body including usage.input_tokens & usage.output_tokens.
 */
export async function callAnthropicWithRetry(
  apiKey: string,
  body: Record<string, unknown>,
  maxRetries = 3
): Promise<{
  content: unknown[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stop_reason: string;
}> {
  const headers = getAnthropicHeaders(apiKey);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return await response.json();
      }

      const status = response.status;

      // Rate limited (429) or overloaded (529) — retry with backoff
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, baseDelay + jitter));
        continue;
      }

      // Other errors — don't retry
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${status}: ${errorBody}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries && (lastError.message.includes("fetch") || lastError.message.includes("network"))) {
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, baseDelay + jitter));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/**
 * Map AI errors to structured HTTP responses.
 */
export function aiErrorToResponse(
  err: unknown,
  corsHeaders: Record<string, string>
): Response {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("402") || message.includes("insufficient_credits")) {
    return new Response(
      JSON.stringify({
        error: "insufficient_credits",
        message: "Crédits IA insuffisants. Achetez un pack de crédits ou passez à un plan supérieur.",
      }),
      { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (message.includes("429")) {
    return new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "Trop de requêtes. Réessayez dans quelques secondes.",
      }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: "ai_error", message }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
