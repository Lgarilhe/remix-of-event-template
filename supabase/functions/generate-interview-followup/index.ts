import { requireOrgAccess } from "../_shared/require-auth.ts";
import { loadAndBuildAiContext } from "../_shared/ai-context.ts";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";
import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";
import {
  FOLLOW_UP_ACTIONS,
  FOLLOW_UP_KINDS,
  buildDraftPrompt,
  canPresentToManager,
  parseDraft,
  type FollowUpAction,
  type FollowUpKind,
} from "../_shared/interview-followup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Rédige un e-mail à partir du compte rendu d'entretien : message de suivi au
 * candidat (suite positive, précisions, refus) ou présentation du candidat au
 * manager. Ne persiste rien et n'envoie rien : l'envoi est send-candidate-email,
 * après relecture. La présentation au manager n'est rédigée que pour un cabinet
 * ou un freelance, et le modèle ne reçoit ni points d'alerte ni verbatims
 * (_shared/interview-followup.ts).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "Requête illisible.", error_code: "INVALID_BODY" }, 400);

    let access;
    try {
      access = await requireOrgAccess(req, body, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const { userId, organizationId, adminClient } = access;

    const { data: allowed } = await adminClient.rpc("check_rate_limit", {
      p_user_id: userId, p_action: "generate_interview_followup", p_max_requests: 20, p_window_seconds: 60,
    });
    if (allowed === false) return json({ error: "Trop de demandes. Patientez quelques secondes.", error_code: "RATE_LIMIT" }, 429);

    const kind = body.kind as FollowUpKind;
    const action = body.action as FollowUpAction;
    if (!FOLLOW_UP_KINDS.includes(kind)) return json({ error: "Ce type de message n'existe pas.", error_code: "INVALID_KIND" }, 400);
    if (!FOLLOW_UP_ACTIONS.includes(action)) return json({ error: "Cette suite n'existe pas.", error_code: "INVALID_ACTION" }, 400);

    if (kind === "manager_presentation") {
      const { data: org } = await adminClient.from("organizations").select("org_type").eq("id", organizationId).maybeSingle();
      if (!canPresentToManager((org as { org_type?: string } | null)?.org_type)) {
        return json({ error: "La présentation au manager est réservée aux cabinets et aux freelances.", error_code: "ORG_TYPE_NOT_ALLOWED" }, 403);
      }
    }

    // Refus avant l'appel au modèle : une organisation à sec ne reçoit pas de message sans déduction.
    // modelId : l'appel passe par callClaudeCompat sans champ model, donc Haiku (cf _shared/call-claude.ts).
    const gate = await assertCredits({
      userId, organizationId, aiAction: "interview_followup", modelId: "claude-haiku-4-5", systemCall: false, adminClient,
    });
    if (!gate.ok) return creditGateResponse(gate, corsHeaders);

    const { data: profile } = await adminClient.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
    const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    const prompt = buildDraftPrompt({
      kind,
      action,
      candidateName: str(body.candidate_name, 200),
      jobTitle: str(body.job_title, 200),
      clientName: str(body.client_name, 200),
      managerName: str(body.manager_name, 200),
      senderName: str((profile as { display_name?: string } | null)?.display_name, 200),
      nextStepName: str(body.next_step_name, 200),
      report: body.report,
    });

    const aiContext = await loadAndBuildAiContext(adminClient, { userId, orgId: organizationId });
    const result = await callClaudeCompat({
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1200,
      timeoutMs: 30000,
      antiAiStyle: "full",
      aiContext,
    });

    await settleClaudeUsage({ userId, organizationId, aiAction: "interview_followup", usage: result.usage, modelId: result.model });

    const draft = parseDraft(result.content);
    if (!draft) {
      console.error("[generate-interview-followup] réponse illisible:", (result.content ?? "").slice(0, 200));
      return json({ error: "Le message n'a pas pu être rédigé. Réessayez.", error_code: "DRAFT_UNREADABLE" }, 502);
    }
    return json(draft);
  } catch (error) {
    // Le détail reste dans les journaux : il peut citer le fournisseur du modèle.
    console.error("[generate-interview-followup] erreur:", error);
    return json({ error: "Le message n'a pas pu être rédigé. Réessayez dans un instant.", error_code: "INTERNAL" }, 500);
  }
});
