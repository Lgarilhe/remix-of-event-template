/**
 * AI Credits system types — token-based pricing.
 * Mirrors the backend ai-config.ts catalog for frontend usage.
 *
 * 1 crédit Konekt = 1 000 tokens sur Claude Sonnet 4.6 (baseline)
 */

// ─── Model Types ────────────────────────────────────────────────────────────

export type ModelTier = "budget" | "balanced" | "premium";
export type ModelProvider = "anthropic" | "google";
export type RoutingTier = "fast" | "default" | "thinking";

export interface AIModel {
  id: string;
  name: string;
  provider: ModelProvider;
  tier: ModelTier;
  multiplier: number;
  contextWindow: number;
  supportsThinking: boolean;
  description: string;
}

// ─── Model Catalog (frontend mirror) ────────────────────────────────────────

export const MODEL_CATALOG: Record<string, AIModel> = {
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    tier: "budget",
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
    multiplier: 1.8,
    contextWindow: 1_000_000,
    supportsThinking: true,
    description: "Le plus intelligent",
  },
};

// ─── Action Cost Types ──────────────────────────────────────────────────────

export interface AIActionCost {
  action: string;
  label: string;
  /** Minimum credits charged */
  floor: number;
  /** Typical tokens for estimation */
  typicalTokens: number;
  routingTier: RoutingTier;
  category: "sourcing" | "outreach" | "qualification" | "agent";
  /** Restrict model selection to these providers. If omitted, all providers are available. */
  providers?: ModelProvider[];
  /**
   * Per-action override of the auto-routing default (mirror of backend).
   * Used when the user has NOT explicitly chosen a model. Lets us pick a
   * cheaper model than the tier's default for tasks where it suffices.
   *
   * Priority in resolveModel(): userOverride > orgDefault > autoDefault
   *   > ROUTING_DEFAULTS[tier]
   */
  autoDefault?: string;
}

export const ACTION_COSTS: Record<string, AIActionCost> = {
  scoring: { action: "scoring", label: "Scoring candidat", floor: 2, typicalTokens: 4_000, routingTier: "default", category: "sourcing", autoDefault: "claude-haiku-4-5" },
  outreach_message: { action: "outreach_message", label: "Message d'approche", floor: 2, typicalTokens: 5_000, routingTier: "default", category: "outreach" },
  analyze_response: { action: "analyze_response", label: "Analyse réponse", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "outreach" },
  screen_candidate: { action: "screen_candidate", label: "Screening rapide", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "sourcing" },
  generate_scorecard: { action: "generate_scorecard", label: "Scorecard", floor: 2, typicalTokens: 4_000, routingTier: "fast", category: "qualification" },
  call_report: { action: "call_report", label: "Compte-rendu d'appel", floor: 2, typicalTokens: 4_000, routingTier: "default", category: "qualification" },
  live_coaching: { action: "live_coaching", label: "Coaching live (par minute)", floor: 5, typicalTokens: 10_000, routingTier: "default", category: "qualification" },
  agent_search_calibration: { action: "agent_search_calibration", label: "Agent — calibration", floor: 3, typicalTokens: 6_000, routingTier: "thinking", category: "agent", providers: ["anthropic"] },
  agent_search_run: { action: "agent_search_run", label: "Agent — recherche", floor: 10, typicalTokens: 25_000, routingTier: "default", category: "agent", providers: ["anthropic"] },
  filter_generation: { action: "filter_generation", label: "Filtres IA auto", floor: 2, typicalTokens: 4_000, routingTier: "default", category: "sourcing" },
  filter_assistant_msg: { action: "filter_assistant_msg", label: "Chat filtres", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "sourcing" },
  refine_search: { action: "refine_search", label: "Affiner recherche", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "sourcing" },
  nurturing_analysis: { action: "nurturing_analysis", label: "Analyse nurturing", floor: 1, typicalTokens: 2_500, routingTier: "fast", category: "outreach" },
  vivier_enrichment: { action: "vivier_enrichment", label: "Enrichissement profil", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "sourcing" },
  reply_suggestion: { action: "reply_suggestion", label: "Suggestion de réponse", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "outreach" },
  rewrite_text: { action: "rewrite_text", label: "Reformuler un texte", floor: 1, typicalTokens: 1_500, routingTier: "fast", category: "outreach" },
  translate_text: { action: "translate_text", label: "Traduire un texte", floor: 1, typicalTokens: 1_000, routingTier: "fast", category: "outreach" },
  summarize_conversation: { action: "summarize_conversation", label: "Résumer une conversation", floor: 1, typicalTokens: 1_500, routingTier: "fast", category: "outreach" },
  auto_analyze_message: { action: "auto_analyze_message", label: "Classification message", floor: 1, typicalTokens: 1_000, routingTier: "fast", category: "outreach" },
  scorecard_chat: { action: "scorecard_chat", label: "Chat scorecard", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "qualification" },
  debrief: { action: "debrief", label: "Débrief rapide", floor: 2, typicalTokens: 4_000, routingTier: "default", category: "qualification" },
  meeting_minutes: { action: "meeting_minutes", label: "Compte-rendu réunion", floor: 2, typicalTokens: 5_000, routingTier: "default", category: "qualification" },
  generate_client_competitors: { action: "generate_client_competitors", label: "Concurrents client", floor: 1, typicalTokens: 2_000, routingTier: "fast", category: "sourcing", autoDefault: "claude-haiku-4-5" },
};

// ─── Credit Calculation (frontend) ──────────────────────────────────────────

/**
 * Estimate credits before an API call (for UI badges & pre-auth).
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
 * Get the default model for a given routing tier.
 */
const ROUTING_DEFAULTS: Record<RoutingTier, string> = {
  fast: "claude-haiku-4-5",
  default: "claude-sonnet-4-6",
  thinking: "claude-sonnet-4-5",
};

export function getDefaultModel(routingTier: RoutingTier): string {
  return ROUTING_DEFAULTS[routingTier];
}

/**
 * Resolve model: userOverride > orgDefault > action.autoDefault > tier default.
 * For "fast" tier, orgDefault is ignored.
 */
export function resolveModel(
  routingTier: RoutingTier,
  userOverride?: string | null,
  orgDefault?: string | null,
  actionId?: string | null
): string {
  if (userOverride && MODEL_CATALOG[userOverride]) return userOverride;
  if (routingTier !== "fast" && orgDefault && MODEL_CATALOG[orgDefault]) return orgDefault;
  if (actionId) {
    const auto = ACTION_COSTS[actionId]?.autoDefault;
    if (auto && MODEL_CATALOG[auto]) return auto;
  }
  return ROUTING_DEFAULTS[routingTier];
}

// ─── Balance Types ──────────────────────────────────────────────────────────

export interface CreditBalance {
  organization_id: string;
  plan_credits: number;
  topup_credits: number;
  credits_total: number;
  period_start: string;
  period_end: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  organization_id: string;
  user_id: string;
  action: string;
  amount: number;
  credits_used: number;
  tokens_input: number;
  tokens_output: number;
  model_id: string | null;
  cost_usd: number;
  source: "plan" | "topup" | "mixed";
  balance_after: number;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PreauthResult {
  has_credits: boolean;
  estimated_credits: number;
  remaining: number;
  model: string;
}

export interface SettlementResult {
  success: boolean;
  credits_used: number;
  source: "plan" | "topup" | "mixed";
  remaining_plan: number;
  remaining_topup: number;
  remaining_total: number;
}

// ─── Credit Packs ───────────────────────────────────────────────────────────

export interface CreditPack {
  id: string;
  credits: number;
  price_eur: number;
  price_per_credit_cents: number;
  badge: string | null;
  stripe_price_id: string | null;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack_400", credits: 400, price_eur: 12, price_per_credit_cents: 3.0, badge: null, stripe_price_id: null },
  { id: "pack_1500", credits: 1_500, price_eur: 39, price_per_credit_cents: 2.6, badge: "Populaire", stripe_price_id: null },
  { id: "pack_5000", credits: 5_000, price_eur: 119, price_per_credit_cents: 2.38, badge: "-20%", stripe_price_id: null },
];

// ─── Tier Display Helpers ───────────────────────────────────────────────────

export const TIER_LABELS: Record<ModelTier, string> = {
  budget: "Budget",
  balanced: "Équilibré",
  premium: "Premium",
};

export const TIER_ICONS: Record<ModelTier, string> = {
  budget: "⚡",
  balanced: "🧠",
  premium: "✨",
};
