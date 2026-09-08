/**
 * Shared credit settlement helper for edge functions.
 *
 * Usage in any edge function:
 *
 *   import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
 *   import { getAnthropicModelId, getAnthropicHeaders, getModel, ACTION_COSTS } from "../_shared/ai-config.ts";
 *
 *   // 1. Extract AI params from request body
 *   const { modelId, aiAction, description } = extractAIParams(body, "scoring");
 *
 *   // 2. Call Anthropic with the resolved model
 *   const anthropicModel = getAnthropicModelId(modelId);
 *   const response = await fetch("https://api.anthropic.com/v1/messages", { ... model: anthropicModel ... });
 *   const result = await response.json();
 *
 *   // 3. Settle credits (fire-and-forget, never blocks the response)
 *   await settleCredits(adminClient, {
 *     organizationId, userId, aiAction, modelId,
 *     tokensInput: result.usage.input_tokens,
 *     tokensOutput: result.usage.output_tokens,
 *     description,
 *   });
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;
import { calculateTokenCredits, calculateUSDCost, getModel, ACTION_COSTS } from "./ai-config.ts";

// ─── Extract AI params from frontend request body ───────────────────────────

export interface AIParams {
  /** Resolved model ID (e.g. "claude-sonnet-4-6") */
  modelId: string;
  /** Action ID (e.g. "scoring") */
  aiAction: string;
  /** Human-readable description for transaction log */
  description: string | null;
  /**
   * True si le modèle a été résolu depuis l'autoDefault de l'action (ou
   * le ROUTING_DEFAULTS du tier) — c'est-à-dire l'user n'a PAS choisi
   * explicitement de modèle (ni via le ModelPicker, ni via le default org).
   *
   * Utilisé par les edge functions pour décider d'activer un tiered routing
   * (ex: scoring qui escalade Haiku → Sonnet sur les profils borderline)
   * uniquement quand l'user fait confiance au routing automatique.
   *
   * Si false : l'user a choisi explicitement (Sonnet ou Opus) → on respecte
   * son choix sans tiered routing surprise.
   */
  wasAutoRouted: boolean;
}

/**
 * Extract AI parameters from the request body sent by invokeWithCredits.
 * Falls back to defaults if params are missing (backward compat).
 */
export function extractAIParams(
  body: Record<string, unknown>,
  defaultAction: string,
  orgModelDefault?: string | null
): AIParams {
  // _ai_action vient du corps de la requête, donc de l'appelant, y compris d'un
  // appel direct à l'edge function. Une action hors catalogue ramènerait
  // estimateCredits (seuil du garde) et le plancher de facturation à 1 crédit :
  // on ne retient la valeur reçue que si elle existe dans ACTION_COSTS, sinon on
  // garde l'action déclarée par la fonction appelante.
  const requestedAction = typeof body._ai_action === "string" ? body._ai_action : null;
  const aiAction = requestedAction && ACTION_COSTS[requestedAction] ? requestedAction : defaultAction;
  const action = ACTION_COSTS[aiAction];
  const routingTier = action?.routingTier ?? "default";

  const userModel = typeof body._ai_model === "string" ? body._ai_model : undefined;
  const modelId = getModel(routingTier, userModel, orgModelDefault, aiAction);

  // wasAutoRouted = true si on n'a NI userModel valide NI orgModelDefault valide.
  // (cf. getModel : on tombe alors sur action.autoDefault ou ROUTING_DEFAULTS)
  const userOverrideValid = !!(userModel && userModel.length > 0);
  const orgDefaultValid = !!(orgModelDefault && orgModelDefault.length > 0 && routingTier !== "fast");
  const wasAutoRouted = !userOverrideValid && !orgDefaultValid;

  const description = typeof body._ai_description === "string"
    ? body._ai_description.slice(0, 200)
    : null;

  return { modelId, aiAction, description, wasAutoRouted };
}

// ─── Settle credits after an AI call ────────────────────────────────────────

export interface SettleParams {
  organizationId: string;
  userId: string;
  aiAction: string;
  modelId: string;
  tokensInput: number;
  tokensOutput: number;
  description: string | null;
  /**
   * Coût forfaitaire (en crédits) qui REMPLACE le calcul par tokens.
   * Pour les actions sans tokens LLM propres : recherches web (1 crédit/
   * recherche), enrichments à l'unité, etc.
   */
  flatCredits?: number;
  /** Coût USD réel à logger quand le calcul par tokens ne s'applique pas. */
  costUsd?: number;
}

/** Résultat d'un settle, lu par les fonctions qui journalisent leur facturation. */
export interface SettleResult {
  /** Coût réel de l'appel, calculé sur les jetons ou sur le forfait de l'action. */
  credits: number;
  /** Montant réellement débité : min(coût, solde disponible). */
  charged: number;
  /** Part du coût que le solde ne couvrait pas. 0 quand tout a été payé. */
  shortfall: number;
  /** Vrai dès que le solde a été écrit et la transaction journalisée, même partiellement. */
  success: boolean;
}

/**
 * Répartition FIFO d'un débit sur un solde lu : crédits du plan d'abord, puis
 * recharges achetées.
 *
 * Quand le solde ne couvre pas le coût, on débite tout ce qui reste au lieu de
 * ne rien débiter. L'ancien refus en bloc laissait un résidu (entre 1 crédit et
 * le coût du dernier appel) que plus rien ne consommait : le solde ne tombait
 * jamais à zéro, et le garde d'avant appel (credit-guard.ts), dont l'estimation
 * vaut 1 ou 2 crédits, laissait donc passer indéfiniment. Le manque est
 * journalisé et écrit dans la transaction.
 */
function planDeduction(planCredits: number, topupCredits: number, credits: number) {
  const total = planCredits + topupCredits;
  const charged = Math.max(0, Math.min(credits, total));

  let fromPlan = 0;
  let fromTopup = 0;
  let newPlanCredits = planCredits;
  let newTopupCredits = topupCredits;

  if (planCredits >= charged) {
    fromPlan = charged;
    newPlanCredits = planCredits - charged;
  } else {
    fromPlan = planCredits;
    fromTopup = charged - planCredits;
    newPlanCredits = 0;
    newTopupCredits = topupCredits - fromTopup;
  }

  return {
    charged,
    shortfall: credits - charged,
    fromPlan,
    fromTopup,
    newPlanCredits,
    newTopupCredits,
    source: fromPlan > 0 && fromTopup > 0 ? "mixed" : fromTopup > 0 ? "topup" : "plan",
    remainingTotal: newPlanCredits + newTopupCredits,
  };
}

/**
 * Settle (deduct) credits after an AI API call.
 * Uses the ai-credits edge function's settle action internally via RPC-like logic.
 *
 * This function is fire-and-forget safe — it logs warnings but never throws,
 * so it doesn't block the main response to the user.
 */
export async function settleCredits(
  adminClient: SupabaseClient,
  params: SettleParams
): Promise<SettleResult> {
  try {
    const { organizationId, userId, aiAction, modelId, tokensInput, tokensOutput, description } = params;

    // Calculate credits from actual tokens — sauf coût forfaitaire explicite
    // (actions sans tokens propres : web_search, enrichments à l'unité).
    const credits = params.flatCredits != null && params.flatCredits > 0
      ? Math.ceil(params.flatCredits)
      : calculateTokenCredits(tokensInput, tokensOutput, modelId, aiAction).credits;
    const costUsd = params.costUsd ?? calculateUSDCost(tokensInput, tokensOutput, modelId);

    // --- Atomic settle via optimistic concurrency control ---
    // Read-then-conditional-write: the UPDATE's WHERE clause includes the
    // exact plan_credits and topup_credits we read, so if another request
    // modified the row between our SELECT and UPDATE, 0 rows match and we retry.
    //
    // Une seule implémentation pour la première passe et pour le retry : les
    // deux branches avaient la même règle de débit recopiée, et corriger l'une
    // sans l'autre laissait le défaut en place sur la moitié des appels.
    const attempt = async (suffix: string): Promise<SettleResult | null> => {
      const { data: bal } = await adminClient
        .from("ai_credit_balances")
        .select("plan_credits, topup_credits")
        .eq("organization_id", organizationId)
        .single();

      const planCredits = Number(bal?.plan_credits ?? 0);
      const topupCredits = Number(bal?.topup_credits ?? 0);
      const deduction = planDeduction(planCredits, topupCredits, credits);

      // Solde déjà vide : l'UPDATE réécrirait les mêmes valeurs et trouverait sa
      // ligne, donc la passe serait comptée comme réussie et l'historique se
      // remplirait de débits à zéro crédit. On sort avant, sans retry : relire
      // le même zéro ne changerait rien.
      if (deduction.charged === 0) {
        console.warn(
          `[settle-credits] solde vide org=${organizationId} action=${aiAction}: ` +
          `dû=${credits} débité=0${suffix}`
        );
        return { credits, charged: 0, shortfall: credits, success: false };
      }

      // Conditional UPDATE: only succeeds if the balance has not changed since
      // the read above.
      const { data: writeResult } = await adminClient
        .from("ai_credit_balances")
        .update({
          plan_credits: deduction.newPlanCredits,
          topup_credits: deduction.newTopupCredits,
          credits_total: deduction.remainingTotal,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("plan_credits", planCredits)
        .eq("topup_credits", topupCredits)
        .select("organization_id");

      // 0 ligne : une autre requête a modifié le solde entre le SELECT et
      // l'UPDATE. L'appelant relance une passe.
      if (!writeResult || writeResult.length === 0) return null;

      // La transaction porte le montant réellement débité, pas le coût dû :
      // l'historique et la somme consommée de la période resteraient sinon
      // supérieurs à ce qui a quitté le solde.
      await adminClient.from("ai_credit_transactions").insert({
        organization_id: organizationId,
        user_id: userId,
        action: aiAction,
        amount: -deduction.charged,
        credits_used: deduction.charged,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        model_id: modelId,
        cost_usd: costUsd,
        source: deduction.source,
        balance_after: deduction.remainingTotal,
        description,
        metadata: {
          model: modelId,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cost_usd: costUsd,
          from_plan: deduction.fromPlan,
          from_topup: deduction.fromTopup,
          credits_due: credits,
          shortfall: deduction.shortfall,
        },
      });

      if (deduction.shortfall > 0) {
        console.warn(
          `[settle-credits] solde insuffisant org=${organizationId} action=${aiAction}: ` +
          `dû=${credits} débité=${deduction.charged} manque=${deduction.shortfall}${suffix}`
        );
      }

      console.log(
        `[settle-credits] org=${organizationId} action=${aiAction} model=${modelId} ` +
        `tokens=${tokensInput}+${tokensOutput} credits=${deduction.charged}/${credits} ` +
        `remaining=${deduction.remainingTotal}${suffix}`
      );

      // success reste le signal « le coût a été couvert ». Trois appelants le
      // lisent ainsi pour alerter d'un non-débit (coresignal-search,
      // score-profile-job) : un débit partiel doit donc les réveiller.
      return {
        credits,
        charged: deduction.charged,
        shortfall: deduction.shortfall,
        success: deduction.shortfall === 0,
      };
    };

    const first = await attempt("");
    if (first) return first;

    console.warn(`[settle-credits] Concurrent modification detected for org ${organizationId}, retrying...`);
    const retried = await attempt(" (after retry)");
    if (retried) return retried;

    console.warn(`[settle-credits] Retry failed for org ${organizationId}, aborting settle`);
    return { credits, charged: 0, shortfall: credits, success: false };
  } catch (err) {
    console.warn("[settle-credits] Failed to settle credits (non-blocking):", err);
    return { credits: 0, charged: 0, shortfall: 0, success: false };
  }
}
