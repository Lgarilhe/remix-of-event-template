import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";
import { callClaudeCompat, ClaudeCompatError } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";
import { loadAndBuildAiContext } from "../_shared/ai-context.ts";
import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit: 30 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await svc.rpc('check_rate_limit', {
      p_user_id: userId,
      p_action: 'ai_chat_completion',
      p_max_requests: 30,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }

    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Load AI context (Settings → Contexte IA) — user + org
    // Resolve user's active org from profiles for the agency-level layer.
    let orgId: string | null = null;
    if (userId) {
      const { data: prof } = await svc
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', userId)
        .maybeSingle();
      orgId = (prof?.active_organization_id as string) || null;
    }
    let aiContext = await loadAndBuildAiContext(svc, { userId, orgId });

    // Mémoires confirmées : la lecture conserve le JWT de l'utilisateur
    // pour appliquer la portée personnelle et la RLS de l'organisation.
    if (userId && orgId) {
      try {
        const { getRelevantInsights, formatInsightsForPrompt } = await import("../_shared/user-memory.ts");
        const memoryClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: req.headers.get('authorization')! } },
        });
        const insights = await getRelevantInsights(memoryClient, { userId, organizationId: orgId });
        aiContext = (aiContext || "") + formatInsightsForPrompt(insights);
      } catch (e) {
        console.error("[ai-chat-completion] memory context unavailable:", e);
        return new Response(JSON.stringify({
          success: false,
          error: "La mémoire de l’assistant n’a pas pu être lue. Réessayez dans un instant.",
          error_code: "MEMORY_CONTEXT_UNAVAILABLE",
        }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Le solde est vérifié avant l'appel : après, le fournisseur a déjà
    // facturé. callClaudeCompat ne reçoit aucun champ model, donc mapModel
    // route sur le modèle rapide : c'est lui qu'il faut estimer, pas le défaut
    // du tier. L'exemption ne joue que sans utilisateur identifiable.
    const gate = await assertCredits({
      userId,
      organizationId: orgId,
      aiAction: "ai_chat",
      modelId: "claude-haiku-4-5",
      systemCall: auth.method === "service_role" && !userId,
      adminClient: svc,
    });
    if (!gate.ok) return creditGateResponse(gate, corsHeaders);

    const result = await callClaudeCompat({
      messages,
      temperature: 0.7,
      max_tokens: 2000,
      timeoutMs: 45000,
      maxRetries: 1,
      aiContext,
    });

    await settleClaudeUsage({ userId, organizationId: orgId, aiAction: "ai_chat", usage: result.usage, modelId: result.model });

    return new Response(
      JSON.stringify({ success: true, response: result.content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ai-chat-completion error:", error);
    const status = error instanceof ClaudeCompatError ? error.status : 500;
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
