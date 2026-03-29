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

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { calculateTokenCredits, calculateUSDCost, getModel, ACTION_COSTS } from "./ai-config.ts";

// ─── Extract AI params from frontend request body ───────────────────────────

export interface AIParams {
  /** Resolved model ID (e.g. "claude-sonnet-4-6") */
  modelId: string;
  /** Action ID (e.g. "scoring") */
  aiAction: string;
  /** Human-readable description for transaction log */
  description: string | null;
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
  const aiAction = typeof body._ai_action === "string" ? body._ai_action : defaultAction;
  const action = ACTION_COSTS[aiAction];
  const routingTier = action?.routingTier ?? "default";

  const userModel = typeof body._ai_model === "string" ? body._ai_model : undefined;
  const modelId = getModel(routingTier, userModel, orgModelDefault);

  const description = typeof body._ai_description === "string"
    ? body._ai_description.slice(0, 200)
    : null;

  return { modelId, aiAction, description };
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
): Promise<{ credits: number; success: boolean }> {
  try {
    const { organizationId, userId, aiAction, modelId, tokensInput, tokensOutput, description } = params;

    // Calculate credits from actual tokens
    const { credits } = calculateTokenCredits(tokensInput, tokensOutput, modelId, aiAction);
    const costUsd = calculateUSDCost(tokensInput, tokensOutput, modelId);

    // Get current balance
    const { data: bal } = await adminClient
      .from("ai_credit_balances")
      .select("plan_credits, topup_credits")
      .eq("organization_id", organizationId)
      .single();

    const planCredits = bal?.plan_credits ?? 0;
    const topupCredits = bal?.topup_credits ?? 0;
    const total = planCredits + topupCredits;

    if (total < credits) {
      console.warn(`[settle-credits] Insufficient credits for org ${organizationId}: ${total} < ${credits}`);
      return { credits, success: false };
    }

    // FIFO: plan first, then topup
    let fromPlan = 0;
    let fromTopup = 0;
    let newPlanCredits = planCredits;
    let newTopupCredits = topupCredits;

    if (planCredits >= credits) {
      fromPlan = credits;
      newPlanCredits = planCredits - credits;
    } else {
      fromPlan = planCredits;
      fromTopup = credits - planCredits;
      newPlanCredits = 0;
      newTopupCredits = topupCredits - fromTopup;
    }

    const source = fromPlan > 0 && fromTopup > 0 ? "mixed" : fromTopup > 0 ? "topup" : "plan";
    const remainingTotal = newPlanCredits + newTopupCredits;

    // Update balance
    await adminClient
      .from("ai_credit_balances")
      .update({
        plan_credits: newPlanCredits,
        topup_credits: newTopupCredits,
        credits_total: remainingTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    // Log transaction
    await adminClient.from("ai_credit_transactions").insert({
      organization_id: organizationId,
      user_id: userId,
      action: aiAction,
      amount: -credits,
      credits_used: credits,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      model_id: modelId,
      cost_usd: costUsd,
      source,
      balance_after: remainingTotal,
      description,
      metadata: {
        model: modelId,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        cost_usd: costUsd,
        from_plan: fromPlan,
        from_topup: fromTopup,
      },
    });

    console.log(
      `[settle-credits] org=${organizationId} action=${aiAction} model=${modelId} ` +
      `tokens=${tokensInput}+${tokensOutput} credits=${credits} remaining=${remainingTotal}`
    );

    return { credits, success: true };
  } catch (err) {
    console.warn("[settle-credits] Failed to settle credits (non-blocking):", err);
    return { credits: 0, success: false };
  }
}
