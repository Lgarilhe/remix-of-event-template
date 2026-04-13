/**
 * Edge function: AI Credits (token-based)
 *
 * Actions:
 * - get_balance       → Returns plan + topup credits breakdown
 * - preauth           → Check estimated credits before an AI call
 * - settle            → Deduct real credits after AI call (tokens-based, FIFO)
 * - get_history       → Transaction history
 * - get_costs         → Action cost catalog
 * - get_models        → Model catalog
 *
 * Credit formula: max(floor, ceil(totalTokens / 1000 × multiplier))
 * FIFO: plan credits consumed first, then topup credits
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import {
  MODEL_CATALOG,
  ACTION_COSTS,
  calculateTokenCredits,
  estimateCredits,
  calculateUSDCost,
  getModel,
} from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validateString(val: unknown, maxLen = 200): string | null {
  if (typeof val !== "string") return null;
  return val.slice(0, maxLen).trim() || null;
}

function validateUUID(val: unknown): string | null {
  if (typeof val !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
    ? val
    : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await (userClient as any).auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const reqAction = validateString(body.action);
    const organization_id = validateUUID(body.organization_id);

    const validActions = [
      "get_balance",
      "preauth",
      "settle",
      "get_history",
      "get_costs",
      "get_models",
      // Legacy compat — map to new actions
      "check_credits",
      "check_and_deduct",
      "deduct",
    ];
    if (!reqAction || !validActions.includes(reqAction)) {
      return json({ error: "Invalid action" }, 400);
    }
    if (!organization_id) {
      return json({ error: "Valid organization_id required" }, 400);
    }

    // ── Rate limit ──────────────────────────────────────────────────────
    const { data: allowed } = await adminClient.rpc("check_rate_limit", {
      p_user_id: user.id,
      p_action: "ai_credits",
      p_max_requests: 60,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return json({ error: "Rate limited" }, 429);
    }

    // ── Membership check ────────────────────────────────────────────────
    const { data: membership } = await adminClient
      .from("organization_members")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .single();
    if (!membership) {
      return json({ error: "Forbidden" }, 403);
    }

    // ── Helper: get balance with auto-reset ─────────────────────────────
    async function getBalance() {
      const { data: bal } = await adminClient
        .from("ai_credit_balances")
        .select("*")
        .eq("organization_id", organization_id)
        .single();

      if (!bal) {
        return {
          organization_id,
          plan_credits: 0,
          topup_credits: 0,
          credits_total: 0,
          period_start: null,
          period_end: null,
          updated_at: new Date().toISOString(),
        };
      }

      // Auto-reset plan credits if period expired
      if (bal.period_end && new Date(bal.period_end) < new Date()) {
        const { data: sub } = await adminClient
          .from("organization_subscriptions")
          .select("plan_id")
          .eq("organization_id", organization_id)
          .single();

        if (sub?.plan_id) {
          const { data: plan } = await adminClient
            .from("subscription_plans")
            .select("limits")
            .eq("id", sub.plan_id)
            .single();

          const planLimits = plan?.limits as { ai_credits?: number } | null;
          const newPlanCredits = planLimits?.ai_credits ?? 0;

          // Calculate new period (1 month from now)
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);

          await adminClient
            .from("ai_credit_balances")
            .update({
              plan_credits: newPlanCredits,
              credits_total: newPlanCredits + (bal.topup_credits ?? 0),
              period_start: now.toISOString(),
              period_end: periodEnd.toISOString(),
              updated_at: now.toISOString(),
            })
            .eq("organization_id", organization_id);

          return {
            organization_id,
            plan_credits: newPlanCredits,
            topup_credits: bal.topup_credits ?? 0,
            credits_total: newPlanCredits + (bal.topup_credits ?? 0),
            period_start: now.toISOString(),
            period_end: periodEnd.toISOString(),
            updated_at: now.toISOString(),
          };
        }
      }

      return {
        organization_id: bal.organization_id,
        plan_credits: bal.plan_credits ?? bal.credits_remaining ?? 0,
        topup_credits: bal.topup_credits ?? 0,
        credits_total: bal.credits_total ?? 0,
        period_start: bal.period_start,
        period_end: bal.period_end,
        updated_at: bal.updated_at,
      };
    }

    // ── Helper: FIFO deduction (plan first, then topup) ─────────────────
    async function deductFIFO(
      credits: number,
      aiAction: string,
      modelId: string,
      tokensIn: number,
      tokensOut: number,
      description: string | null
    ) {
      const bal = await getBalance();
      const total = bal.plan_credits + bal.topup_credits;

      if (total < credits) {
        return { success: false, error: "insufficient_credits", remaining: total };
      }

      let fromPlan = 0;
      let fromTopup = 0;
      let newPlanCredits = bal.plan_credits;
      let newTopupCredits = bal.topup_credits;

      // FIFO: consume plan credits first
      if (bal.plan_credits >= credits) {
        fromPlan = credits;
        newPlanCredits = bal.plan_credits - credits;
      } else {
        fromPlan = bal.plan_credits;
        fromTopup = credits - bal.plan_credits;
        newPlanCredits = 0;
        newTopupCredits = bal.topup_credits - fromTopup;
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
        .eq("organization_id", organization_id);

      // Log transaction with full token details
      const costUsd = calculateUSDCost(tokensIn, tokensOut, modelId);
      await adminClient.from("ai_credit_transactions").insert({
        organization_id,
        user_id: user!.id,
        action: aiAction,
        amount: -credits,
        credits_used: credits,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        model_id: modelId,
        cost_usd: costUsd,
        source,
        balance_after: remainingTotal,
        description,
        metadata: {
          model: modelId,
          tokens_input: tokensIn,
          tokens_output: tokensOut,
          cost_usd: costUsd,
          from_plan: fromPlan,
          from_topup: fromTopup,
        },
      });

      return {
        success: true,
        credits_used: credits,
        source,
        remaining_plan: newPlanCredits,
        remaining_topup: newTopupCredits,
        remaining_total: remainingTotal,
      };
    }

    // ── Route actions ───────────────────────────────────────────────────
    switch (reqAction) {
      // ── GET BALANCE ─────────────────────────────────────────────────
      case "get_balance": {
        const bal = await getBalance();
        return json(bal);
      }

      // ── PRE-AUTH ────────────────────────────────────────────────────
      case "preauth":
      case "check_credits": {
        const aiAction = validateString(body.ai_action) || "scoring";
        const modelId = validateString(body.model) || undefined;

        const action = ACTION_COSTS[aiAction];
        const routingTier = action?.routingTier ?? "default";
        const resolvedModel = getModel(routingTier, modelId);
        const estimated = estimateCredits(aiAction, resolvedModel);

        const bal = await getBalance();
        const remaining = bal.plan_credits + bal.topup_credits;

        return json({
          has_credits: remaining >= estimated,
          estimated_credits: estimated,
          remaining,
          model: resolvedModel,
          cost: estimated, // legacy compat
        });
      }

      // ── SETTLEMENT ──────────────────────────────────────────────────
      case "settle": {
        const aiAction = validateString(body.ai_action) || "scoring";
        const modelId = validateString(body.model) || "claude-sonnet-4-6";
        const tokensIn = typeof body.tokens_input === "number" ? body.tokens_input : 0;
        const tokensOut = typeof body.tokens_output === "number" ? body.tokens_output : 0;
        const description = validateString(body.description);

        const { credits } = calculateTokenCredits(tokensIn, tokensOut, modelId, aiAction);
        const result = await deductFIFO(credits, aiAction, modelId, tokensIn, tokensOut, description);

        if (!result.success) {
          return json(
            {
              error: "insufficient_credits",
              message: "Crédits IA insuffisants.",
              remaining: result.remaining,
              credits_required: credits,
            },
            402
          );
        }

        return json(result);
      }

      // ── LEGACY: check_and_deduct (fixed cost, backward compat) ────
      case "check_and_deduct":
      case "deduct": {
        const aiAction = validateString(body.ai_action) || "scoring";
        const description = validateString(body.description);
        const action = ACTION_COSTS[aiAction];
        const cost = action?.floor ?? 1;

        const bal = await getBalance();
        const remaining = bal.plan_credits + bal.topup_credits;

        if (remaining < cost) {
          return json({
            has_credits: false,
            success: false,
            remaining,
            cost,
            error: "insufficient_credits",
          });
        }

        // Use floor as a rough deduction (legacy — no token data)
        const result = await deductFIFO(
          cost,
          aiAction,
          "claude-sonnet-4-6",
          0,
          0,
          description
        );

        return json({
          has_credits: result.success,
          success: result.success,
          remaining: result.remaining_total ?? remaining - cost,
          cost,
        });
      }

      // ── HISTORY ─────────────────────────────────────────────────────
      case "get_history": {
        const histLimit = typeof body.limit === "number" ? Math.min(body.limit, 200) : 50;
        const { data: transactions } = await adminClient
          .from("ai_credit_transactions")
          .select("*")
          .eq("organization_id", organization_id)
          .order("created_at", { ascending: false })
          .limit(histLimit);

        return json({ transactions: transactions || [] });
      }

      // ── COSTS CATALOG ───────────────────────────────────────────────
      case "get_costs": {
        return json({ costs: ACTION_COSTS, models: MODEL_CATALOG });
      }

      // ── MODELS CATALOG ──────────────────────────────────────────────
      case "get_models": {
        return json({ models: MODEL_CATALOG });
      }

      default:
        return json({ error: `Unknown action: ${reqAction}` }, 400);
    }
  } catch (err) {
    console.error("[ai-credits] Error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
