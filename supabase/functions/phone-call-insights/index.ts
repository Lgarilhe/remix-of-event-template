/**
 * Transcription d'un appel Aircall, résumé et tâches proposées.
 *
 * POST { phone_call_id, organization_id?, force? }
 *
 * Deux appelants :
 *   - aircall-webhook, avec la clé de service, quand Aircall annonce qu'une
 *     transcription est prête. organization_id est alors repris du corps (la
 *     fonction qui appelle l'a retrouvé par le jeton de webhook) ;
 *   - le navigateur, avec le JWT d'un membre, pour « Récupérer » ou
 *     « Régénérer » depuis la fiche. L'organisation est celle de l'appel, et
 *     l'appelant doit en être membre.
 *
 * Déroulé, rejouable à tout moment :
 *   1. une ligne phone_call_insights par appel ;
 *   2. transcription : lue chez Aircall avec les identifiants de l'organisation
 *      (jamais renvoyés au navigateur), mise en forme, gardée ;
 *   3. résumé et tâches proposées par l'IA Konekt, sortie structurée, bornée ;
 *      crédits vérifiés avant, débités après, imputés à la personne qui a relié
 *      Aircall (sinon au propriétaire) quand l'appelant est le serveur.
 *
 * Le contenu de la conversation n'est jamais écrit dans les journaux.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";
import { extractAIParams } from "../_shared/settle-credits.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";
import { AIRCALL_API_BASE } from "../_shared/telephony.ts";
import {
  INSIGHTS_TOOL,
  INSIGHTS_TOOL_NAME,
  MIN_TRANSCRIPT_CHARS,
  aircallTranscriptionUrl,
  buildInsightsMessages,
  normalizeAircallTranscription,
  parseInsightsToolInput,
  transcriptCharCount,
  transcriptToText,
  type TranscriptUtterance,
} from "../_shared/aircall-transcript.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un résumé commencé depuis moins de 3 minutes est considéré en cours chez un autre appelant. */
const CLAIM_TTL_MS = 3 * 60_000;

type Admin = ReturnType<typeof createClient>;

interface CallRow {
  id: string;
  organization_id: string;
  provider: string;
  external_id: string;
  direction: "inbound" | "outbound" | null;
  answered_at: string | null;
  started_at: string | null;
  talk_seconds: number;
  contact_name: string | null;
  agent_name: string | null;
}

interface InsightRow {
  id: string;
  status: string;
  transcript: TranscriptUtterance[] | null;
  summary: string | null;
}

/** Écrit l'état d'une ligne de transcription. */
async function patchInsight(admin: Admin, id: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("phone_call_insights")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Personne à qui imputer les crédits quand le serveur appelle : celle qui a
 * relié Aircall si elle est encore membre, sinon un propriétaire.
 */
async function resolveBillingUser(admin: Admin, organizationId: string): Promise<string | null> {
  const { data: connection } = await admin
    .from("telephony_connections")
    .select("connected_by")
    .eq("organization_id", organizationId)
    .eq("provider", "aircall")
    .maybeSingle();
  const connectedBy = connection?.connected_by as string | null | undefined;
  if (connectedBy && (await verifyOrgMembership(admin, connectedBy, organizationId))) return connectedBy;

  const { data: owner } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  return (owner?.user_id as string | undefined) ?? null;
}

type TranscriptResult =
  | { kind: "ok"; language: string | null; utterances: TranscriptUtterance[] }
  | { kind: "unavailable" }
  | { kind: "failed"; code: string };

/** Lit la transcription chez Aircall avec les identifiants de l'organisation. */
async function fetchAircallTranscript(admin: Admin, call: CallRow): Promise<TranscriptResult> {
  const { data: integration, error } = await admin
    .from("organization_integrations")
    .select("aircall_api_id, aircall_api_token")
    .eq("organization_id", call.organization_id)
    .maybeSingle();
  if (error) throw error;
  const apiId = integration?.aircall_api_id as string | null | undefined;
  const apiToken = integration?.aircall_api_token as string | null | undefined;
  if (!apiId || !apiToken) return { kind: "failed", code: "no_credentials" };

  let res: Response;
  try {
    res = await fetchWithTimeout(aircallTranscriptionUrl(AIRCALL_API_BASE, call.external_id), {
      headers: { Authorization: `Basic ${btoa(`${apiId}:${apiToken}`)}` },
    });
  } catch {
    return { kind: "failed", code: "aircall_error" };
  }
  // 403 : module AI Assist absent du forfait ; 404 : pas (encore) de transcription,
  // appel non enregistré ou trop court. Ni l'un ni l'autre n'est une panne.
  if (res.status === 403 || res.status === 404) return { kind: "unavailable" };
  if (!res.ok) {
    console.warn("[phone-call-insights] Aircall a répondu HTTP", res.status);
    return { kind: "failed", code: "aircall_error" };
  }

  const payload = await res.json().catch(() => null);
  const normalized = normalizeAircallTranscription(payload);
  if (!normalized) {
    // Forme à connaître pour adapter la lecture : les noms de champs seulement, jamais le contenu.
    const keys = payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).slice(0, 12) : typeof payload;
    console.warn("[phone-call-insights] forme de transcription inconnue, champs :", keys);
    return { kind: "failed", code: "format" };
  }
  return { kind: "ok", language: normalized.language, utterances: normalized.utterances };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let auth;
  try {
    auth = await requireAuth(req, corsHeaders);
  } catch (authResponse) {
    return authResponse as Response;
  }
  const isService = auth.method === "service_role";

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps vide : refusé ci-dessous */ }
  const phoneCallId = typeof body.phone_call_id === "string" ? body.phone_call_id : "";
  if (!UUID_RE.test(phoneCallId)) return json({ error: "phone_call_id invalide" }, 400);
  const force = body.force === true;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
  );

  try {
    // 1. L'appel, et l'organisation à laquelle il appartient.
    const { data: callData, error: callError } = await admin
      .from("phone_calls")
      .select("id, organization_id, provider, external_id, direction, answered_at, started_at, talk_seconds, contact_name, agent_name")
      .eq("id", phoneCallId)
      .maybeSingle();
    if (callError) throw callError;
    const call = callData as CallRow | null;
    if (!call) return json({ error: "Appel introuvable" }, 404);
    if (call.provider !== "aircall") return json({ error: "Opérateur non pris en charge" }, 400);

    const organizationId = call.organization_id;
    let billingUserId: string | null;
    if (isService) {
      // Appelant de confiance : l'organisation du corps doit être celle de l'appel.
      if (body.organization_id !== organizationId) return json({ error: "Forbidden" }, 403);
      billingUserId = await resolveBillingUser(admin, organizationId);
    } else {
      if (!auth.userId || !(await verifyOrgMembership(admin, auth.userId, organizationId))) {
        return json({ error: "Forbidden" }, 403);
      }
      const { data: allowed } = await admin.rpc("check_rate_limit", {
        p_user_id: auth.userId, p_action: "phone_call_insights", p_max_requests: 20, p_window_seconds: 60,
      });
      if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);
      billingUserId = auth.userId;
    }

    // 2. Une ligne par appel.
    const { error: upsertError } = await admin
      .from("phone_call_insights")
      .upsert({ organization_id: organizationId, phone_call_id: call.id }, { onConflict: "phone_call_id", ignoreDuplicates: true });
    if (upsertError) throw upsertError;
    const { data: rowData, error: rowError } = await admin
      .from("phone_call_insights")
      .select("id, status, transcript, summary")
      .eq("phone_call_id", call.id)
      .single();
    if (rowError) throw rowError;
    const row = rowData as InsightRow;

    if (row.summary && !force) return json({ ok: true, status: row.status, already: true });

    // Un appel que personne n'a décroché n'a pas de transcription : pas d'appel à Aircall.
    if (!call.answered_at && call.talk_seconds === 0) {
      await patchInsight(admin, row.id, { status: "unavailable", error_code: "unavailable" });
      return json({ ok: true, status: "unavailable", error_code: "unavailable" });
    }

    // 3. Transcription.
    let utterances = Array.isArray(row.transcript) ? row.transcript : null;
    if (!utterances || utterances.length === 0 || force) {
      const fetched = await fetchAircallTranscript(admin, call);
      if (fetched.kind === "unavailable") {
        await patchInsight(admin, row.id, { status: "unavailable", error_code: "unavailable" });
        return json({ ok: true, status: "unavailable", error_code: "unavailable" });
      }
      if (fetched.kind === "failed") {
        await patchInsight(admin, row.id, { status: "failed", error_code: fetched.code });
        return json({ ok: false, status: "failed", error_code: fetched.code }, isService ? 200 : 502);
      }
      utterances = fetched.utterances;
      await patchInsight(admin, row.id, {
        status: "transcribed", transcript: utterances, language: fetched.language, error_code: null,
      });
    }

    // 4. Appel trop court : la transcription est gardée, pas de résumé.
    if (transcriptCharCount(utterances) < MIN_TRANSCRIPT_CHARS) {
      await patchInsight(admin, row.id, { status: "ready", error_code: "too_short" });
      return json({ ok: true, status: "ready", error_code: "too_short" });
    }

    // 5. Verrou doux : un seul résumé à la fois pour un même appel.
    const claimCutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
    let claim = admin
      .from("phone_call_insights")
      .update({ summary_started_at: new Date().toISOString() })
      .eq("id", row.id)
      .or(`summary_started_at.is.null,summary_started_at.lt.${claimCutoff}`);
    if (!force) claim = claim.is("summary", null);
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) return json({ ok: true, status: "in_progress" });

    const release = (patch: Record<string, unknown>) =>
      patchInsight(admin, row.id, { summary_started_at: null, ...patch });

    // 6. Crédits : refus avant l'appel au modèle.
    if (!billingUserId) {
      await release({ status: "transcribed", error_code: "no_user" });
      return json({ ok: true, status: "transcribed", error_code: "no_user" });
    }
    const aiParams = extractAIParams({}, "call_summary");
    const gate = await assertCredits({
      userId: billingUserId,
      organizationId,
      aiAction: "call_summary",
      modelId: aiParams.modelId,
      adminClient: admin as never,
    });
    if (!gate.ok) {
      await release({ status: "transcribed", error_code: "credits" });
      return isService ? json({ ok: true, status: "transcribed", error_code: "credits" }) : creditGateResponse(gate, corsHeaders);
    }

    // 7. Résumé et tâches par l'IA Konekt.
    let result;
    try {
      result = await callClaudeCompat({
        model: aiParams.modelId,
        messages: buildInsightsMessages({
          transcriptText: transcriptToText(utterances),
          direction: call.direction,
          talkSeconds: call.talk_seconds,
          startedAt: call.started_at,
          contactName: call.contact_name,
          agentName: call.agent_name,
        }),
        tools: [INSIGHTS_TOOL],
        tool_choice: { type: "function", function: { name: INSIGHTS_TOOL_NAME } },
        max_tokens: 1500,
        timeoutMs: 45000,
        antiAiStyle: "compact",
      });
    } catch (err) {
      console.error("[phone-call-insights] appel au modèle en échec :", (err as { message?: string })?.message ?? err);
      await release({ status: "transcribed", error_code: "llm" });
      return json({ ok: false, status: "transcribed", error_code: "llm" }, isService ? 200 : 502);
    }
    await settleClaudeUsage({
      userId: billingUserId,
      organizationId,
      aiAction: "call_summary",
      usage: result.usage,
      modelId: result.model,
      description: "Résumé d'un appel téléphonique",
    });

    const insights = parseInsightsToolInput(result.toolCall?.name === INSIGHTS_TOOL_NAME ? result.toolCall.input : null);
    if (!insights) {
      await release({ status: "transcribed", error_code: "llm" });
      return json({ ok: false, status: "transcribed", error_code: "llm" }, isService ? 200 : 502);
    }

    // 8. Tâches proposées une seule fois par appel, écrites AVANT de marquer le résumé
    //    prêt : un échec ici laisse l'appel relançable, jamais un résumé sans tâches.
    let proposed = 0;
    const { count: existing, error: countError } = await admin
      .from("phone_call_task_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("phone_call_id", call.id);
    if (countError) throw countError;
    if ((existing ?? 0) === 0 && insights.tasks.length > 0) {
      const { error: insertError } = await admin.from("phone_call_task_suggestions").insert(
        insights.tasks.map((t) => ({
          organization_id: organizationId,
          phone_call_id: call.id,
          title: t.title,
          reason: t.reason,
          due_in_days: t.dueInDays,
        })),
      );
      if (insertError) throw insertError;
      proposed = insights.tasks.length;
    }
    await release({ status: "ready", summary: insights.summary, error_code: null });
    return json({ ok: true, status: "ready", suggestions: proposed });
  } catch (err) {
    // 500 : aircall-webhook ignore la réponse ; le navigateur propose « Réessayer ».
    console.error("[phone-call-insights] erreur :", (err as { message?: string })?.message ?? err);
    return json({ ok: false, error: "Erreur interne. Réessayez." }, 500);
  }
});
