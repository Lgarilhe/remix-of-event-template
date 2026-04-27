/**
 * get-enrichment-status — Polling de l'état d'un enrichment Better Contact
 *
 * Workflow :
 *   1. Auth + org check
 *   2. GET Better Contact /api/v2/async/{request_id}
 *   3. Si status='terminated' → UPDATE candidate_enrichments avec contact_data + retour
 *   4. Si encore en cours → return status='pending'
 *
 * Frontend appelle ce endpoint toutes les 5s tant que status='pending'.
 *
 * Naming règle CLAUDE.md : aucun message user-facing ne mentionne "Better Contact".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BC_BASE = "https://app.bettercontact.rocks/api/v2";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Mappe le résultat BC vers le format Konekt.
 * BC renvoie data[] (1 entry par lead soumis), on prend la première.
 */
function extractContactFromBcResult(bcData: any): {
  email: string | null;
  email_status: string | null;
  phone: string | null;
  phone_type: string | null;
  email_provider: string | null;
  phone_provider: string | null;
  credits_consumed: number;
} {
  const dataArray = Array.isArray(bcData?.data) ? bcData.data : [];
  const first = dataArray[0] || {};
  return {
    email: first.contact_email_address || null,
    email_status: first.contact_email_address_status || null,
    phone: first.contact_phone_number || null,
    phone_type: first.contact_phone_number_type || null,
    email_provider: first.email_provider || null,
    phone_provider: first.phone_provider || null,
    credits_consumed: Number(bcData?.credits_consumed ?? 0),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ──
    const auth = await requireAuth(req, corsHeaders);
    if (!auth.userId) return auth.response!;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(
      supabaseUrl,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    const body = await req.json();
    const requestId = body.request_id || body.id;

    if (!requestId) {
      return json({ success: false, error: "request_id requis" }, 400);
    }

    // ── Lookup en DB pour vérif ownership + status local ──
    const { data: cached } = await serviceClient
      .from("candidate_enrichments")
      .select("*")
      .eq("provider_request_id", requestId)
      .maybeSingle();

    if (!cached) {
      return json({ success: false, error: "Enrichment introuvable" }, 404);
    }

    // Vérif ownership : user doit être membre de l'org
    const { data: membership } = await serviceClient
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", cached.organization_id)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (!membership) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    // ── Si déjà terminé en DB, retour direct (pas besoin de re-call BC) ──
    if (cached.status === "terminated") {
      return json({
        success: true,
        status: "terminated",
        contact: {
          email: cached.contact_email,
          email_status: cached.contact_email_status,
          phone: cached.contact_phone,
          phone_type: cached.contact_phone_type,
          email_provider_source: cached.email_provider_source,
          phone_provider_source: cached.phone_provider_source,
        },
        credits_consumed: cached.credits_consumed,
      });
    }

    if (cached.status === "error") {
      return json({
        success: false,
        status: "error",
        error: cached.error_message || "Erreur lors de l'enrichment",
      });
    }

    // ── Sinon, GET Better Contact pour vérifier ──
    const BC_API_KEY = Deno.env.get("BETTERCONTACT_API_KEY");
    if (!BC_API_KEY) {
      return json({ success: false, error: "Service d'enrichment non configuré" }, 500);
    }

    const bcResp = await fetchWithTimeout(`${BC_BASE}/async/${requestId}`, {
      method: "GET",
      headers: { "X-API-Key": BC_API_KEY },
    }, 10000);

    const bcText = await bcResp.text();

    if (!bcResp.ok) {
      console.error("[get-enrichment-status] BC GET error", bcResp.status, bcText.slice(0, 200));
      if (bcResp.status === 406) {
        // request_id invalide côté BC → marquer en error
        await serviceClient
          .from("candidate_enrichments")
          .update({ status: "error", error_message: "Request ID invalide" })
          .eq("id", cached.id);
        return json({ success: false, status: "error", error: "Enrichment invalide" });
      }
      return json({ success: false, error: "Erreur lors de la vérification" }, 500);
    }

    let bcData: any;
    try { bcData = JSON.parse(bcText); } catch {
      return json({ success: false, error: "Réponse invalide" }, 500);
    }

    // ── Encore en cours côté BC ──
    if (bcData?.status !== "terminated") {
      return json({
        success: true,
        status: "pending",
        message: "Enrichment en cours, patientez encore...",
      });
    }

    // ── BC a terminé → extraire contact + UPDATE en DB ──
    const contact = extractContactFromBcResult(bcData);
    console.log(`[get-enrichment-status] TERMINATED for ${requestId}: email=${!!contact.email}, phone=${!!contact.phone}, credits=${contact.credits_consumed}`);

    const updatePayload = {
      status: "terminated",
      contact_email: contact.email,
      contact_email_status: contact.email_status,
      contact_phone: contact.phone,
      contact_phone_type: contact.phone_type,
      email_provider_source: contact.email_provider,
      phone_provider_source: contact.phone_provider,
      credits_consumed: contact.credits_consumed,
      raw_response: bcData,
      completed_at: new Date().toISOString(),
    };

    const { error: updateError } = await serviceClient
      .from("candidate_enrichments")
      .update(updatePayload)
      .eq("id", cached.id);

    if (updateError) {
      console.warn("[get-enrichment-status] UPDATE failed:", updateError.message);
    }

    return json({
      success: true,
      status: "terminated",
      contact: {
        email: contact.email,
        email_status: contact.email_status,
        phone: contact.phone,
        phone_type: contact.phone_type,
        email_provider_source: contact.email_provider,
        phone_provider_source: contact.phone_provider,
      },
      credits_consumed: contact.credits_consumed,
    });
  } catch (err) {
    console.error("[get-enrichment-status] Error:", err);
    return json({ success: false, error: "Erreur serveur" }, 500);
  }
});
