// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Credit costs per action
const CREDIT_COSTS: Record<string, number> = {
  scoring: 1,
  outreach_message: 1,
  analyze_response: 1,
  screen_candidate: 1,
  generate_scorecard: 2,
  call_report: 2,
  live_coaching: 5,
  agent_search: 3,
  profile_fraud: 1,
  nurturing_analysis: 1,
  filter_assistant: 1,
  refine_search: 1,
};

// Input validation helpers
function validateString(val: unknown, maxLen = 200): string | null {
  if (typeof val !== 'string') return null;
  return val.slice(0, maxLen).trim() || null;
}
function validateUUID(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) ? val : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const reqAction = validateString(body.action);
    const organization_id = validateUUID(body.organization_id);

    if (!reqAction || !['get_balance', 'check_credits', 'check_and_deduct', 'deduct', 'get_history', 'get_costs'].includes(reqAction)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!organization_id) {
      return new Response(JSON.stringify({ error: "Valid organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 60 requests/min per user
    const { data: allowed } = await adminClient.rpc("check_rate_limit", {
      p_user_id: user.id, p_action: "ai_credits", p_max_requests: 60, p_window_seconds: 60,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify membership
    const { data: membership } = await adminClient
      .from("organization_members")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route actions
    switch (reqAction) {
      case "get_balance": {
        const { data: balance } = await adminClient
          .from("ai_credit_balances")
          .select("*")
          .eq("organization_id", organization_id)
          .single();

        if (!balance) {
          return new Response(JSON.stringify({ credits_remaining: 0, credits_total: 0 }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(balance), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check_credits": {
        const { ai_action } = body;
        const cost = CREDIT_COSTS[ai_action] || 1;

        const { data: balance } = await adminClient
          .from("ai_credit_balances")
          .select("credits_remaining")
          .eq("organization_id", organization_id)
          .single();

        const remaining = balance?.credits_remaining ?? 0;
        const hasCredits = remaining >= cost;

        return new Response(JSON.stringify({ has_credits: hasCredits, remaining, cost }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check_and_deduct": {
        const { ai_action, description } = body;
        const cost = CREDIT_COSTS[ai_action] || 1;

        const { data: result } = await adminClient.rpc("deduct_ai_credits", {
          p_organization_id: organization_id,
          p_user_id: user.id,
          p_amount: cost,
          p_action: ai_action,
          p_description: description || null,
        });

        const hasCredits = result?.success === true;
        const remaining = typeof result?.remaining === 'number' ? result.remaining : 0;

        return new Response(JSON.stringify({
          has_credits: hasCredits,
          remaining,
          cost,
          success: hasCredits,
          error: result?.error ?? null,
          message: result?.message ?? null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "deduct": {
        const { ai_action, description } = body;
        const cost = CREDIT_COSTS[ai_action] || 1;

        const { data: result } = await adminClient.rpc("deduct_ai_credits", {
          p_organization_id: organization_id,
          p_user_id: user.id,
          p_amount: cost,
          p_action: ai_action,
          p_description: description || null,
        });

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_history": {
        const { limit: histLimit = 50 } = body;
        const { data: transactions } = await adminClient
          .from("ai_credit_transactions")
          .select("*")
          .eq("organization_id", organization_id)
          .order("created_at", { ascending: false })
          .limit(histLimit);

        return new Response(JSON.stringify({ transactions: transactions || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_costs": {
        return new Response(JSON.stringify({ costs: CREDIT_COSTS }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${reqAction}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
