// brief-interview : un tour de parole du brief vocal guidé (écran Cadrage).
//
// Le navigateur envoie le brief actuel, l'état des sujets, l'historique et la
// dernière réponse du recruteur. Le modèle renvoie ce que cette réponse ajoute
// au brief (champs validés par sanitizeTurn) et la question suivante. Rien n'est
// écrit en base ici : c'est le navigateur qui fusionne dans job_details, par le
// même chemin d'enregistrement que le reste de l'écran.
//
// Sans réponse (première question, ou question passée), le tour ne fait que
// choisir la question suivante.
//
// Conventions CLAUDE.md : requireAuth, check_rate_limit, assertCredits avant
// l'appel, callClaudeCompat (passerelle unique vers le modèle), settleCredits
// après.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";
import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
import { getAnthropicModelId } from "../_shared/ai-config.ts";
import { resolveOrgIdFromUser } from "../_shared/resolve-org-credentials.ts";
import { callClaudeCompat, ClaudeCompatError } from "../_shared/call-claude.ts";
import {
  BRIEF_TURN_TOOL,
  SYSTEM_PROMPT,
  buildUserContent,
  parseTurnInput,
  sanitizeTurn,
} from "../_shared/brief-interview.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    if (!userId) return json(400, { error: "Utilisateur requis" });

    const body = await req.json().catch(() => null);
    const input = parseTurnInput(body);
    if (!input) return json(400, { error: "Brief requis" });

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );
    const { data: allowed } = await svc.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "brief_interview",
      p_max_requests: 40,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return json(429, { error: "Trop de requêtes, réessayez dans un instant" });
    }

    const aiParams = extractAIParams(body as Record<string, unknown>, "brief_interview");
    const model = getAnthropicModelId(aiParams.modelId);

    // Refus avant l'appel : une organisation sans crédit ne déclenche aucun appel au modèle.
    const gate = await assertCredits({
      userId,
      aiAction: aiParams.aiAction,
      modelId: aiParams.modelId,
      adminClient: svc,
    });
    if (!gate.ok) return creditGateResponse(gate, corsHeaders);

    let result;
    try {
      result = await callClaudeCompat({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(input) },
        ],
        max_tokens: 1500,
        tools: [BRIEF_TURN_TOOL],
        tool_choice: { type: "function", function: { name: BRIEF_TURN_TOOL.function.name } },
        antiAiStyle: "compact",
        timeoutMs: 25000,
        maxRetries: 1,
      });
    } catch (err) {
      if (err instanceof ClaudeCompatError) {
        console.error("[brief-interview] AI error:", err.status, err.body?.slice(0, 300));
        if (err.status === 429) return json(429, { error: "Trop de requêtes, réessayez dans quelques secondes" });
        if (err.status === 529 || err.status === 503) {
          return json(503, { error: "Service IA temporairement surchargé, réessayez dans 30 secondes" });
        }
        return json(500, { error: "Erreur du service IA" });
      }
      throw err;
    }

    if (!result.toolCall) {
      console.error("[brief-interview] no tool call:", result.content?.slice(0, 300));
      return json(200, { success: false, error: "Réponse IA illisible, réessayez en reformulant." });
    }
    const turn = sanitizeTurn(result.toolCall.input);

    // Débit des crédits : au mieux, sans jamais retenir la réponse.
    try {
      const orgId = await resolveOrgIdFromUser(userId, svc);
      if (orgId && (await verifyOrgMembership(svc, userId, orgId))) {
        settleCredits(svc, {
          organizationId: orgId,
          userId,
          aiAction: aiParams.aiAction,
          modelId: model,
          tokensInput: result.usage.input_tokens,
          tokensOutput: result.usage.output_tokens,
          description: aiParams.description || "Brief vocal guidé",
        }).catch((e: unknown) => console.error("[brief-interview] settle error:", e));
      }
    } catch (e) {
      console.warn("[brief-interview] settle skipped:", e);
    }

    return json(200, { success: true, ...turn });
  } catch (error) {
    console.error("[brief-interview] Error:", error);
    return json(500, { error: error instanceof Error ? error.message : "Erreur interne" });
  }
});
