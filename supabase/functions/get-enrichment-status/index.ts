/**
 * get-enrichment-status — Polling de l'état d'un enrichment Better Contact
 *
 * Workflow :
 *   1. Auth + org check
 *   2. GET Better Contact /api/v2/async/{request_id}
 *   3. Si status='terminated' → UPDATE candidate_enrichments avec contact_data,
 *      incrément du compteur mensuel (statistiques), débit de crédits seulement
 *      si la ligne n'est pas couverte par le forfait (included = false), puis retour
 *   4. Si encore en cours → return status='pending'
 *
 * Corps : { request_id, candidate_id? } — si candidate_id (identifiant d'un
 * candidat du pipeline) est fourni et qu'un contact est trouvé, le résultat est
 * gardé sur la fiche pipeline (candidate_contacts, source 'enriched').
 *
 * Réponse : `included` = demande couverte par le forfait (aucun crédit débité).
 *
 * Frontend appelle ce endpoint toutes les 5s tant que status='pending'.
 *
 * Naming règle CLAUDE.md : aucun message user-facing ne mentionne "Better Contact".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";
import { settleCredits } from "../_shared/settle-credits.ts";

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

/**
 * Garde le résultat sur la fiche pipeline : candidate_contacts, une ligne par
 * (organisation, candidat). Seuls les champs trouvés sont écrits : un email ou
 * un téléphone saisi à la main pour l'autre champ n'est pas effacé.
 */
async function saveCandidateContact(
  client: ReturnType<typeof createClient>,
  input: { organizationId: string; candidateId: string; userId: string; email: string | null; phone: string | null },
): Promise<void> {
  if (!input.email && !input.phone) return;
  // Une fiche saisie à la main garde son étiquette « Saisi » quand un seul
  // champ est enrichi ; « Enrichi » seulement si la ligne est neuve ou déjà enrichie.
  const { data: existing } = await client
    .from("candidate_contacts")
    .select("source")
    .eq("organization_id", input.organizationId)
    .eq("candidate_id", input.candidateId)
    .maybeSingle();
  const source = !existing || !existing.source || String(existing.source).startsWith("enriched") ? "enriched" : existing.source;
  const { error } = await client
    .from("candidate_contacts")
    .upsert({
      organization_id: input.organizationId,
      candidate_id: input.candidateId,
      source,
      updated_by: input.userId,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    }, { onConflict: "organization_id,candidate_id" });
  if (error) {
    console.warn("[get-enrichment-status] candidate_contacts upsert failed:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ──
    const auth = await requireAuth(req, corsHeaders);
    if (!auth.userId) return json({ success: false, error: "Authentification utilisateur requise" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(
      supabaseUrl,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    const body = await req.json();
    const requestId = body.request_id || body.id;
    // Identifiant pipeline optionnel (job_candidate_status.candidate_id, texte)
    const candidateIdRaw = typeof body.candidate_id === "string" ? body.candidate_id.trim() : "";
    const candidateId = candidateIdRaw.length > 0 && candidateIdRaw.length <= 200 ? candidateIdRaw : null;

    if (!requestId) {
      return json({ success: false, error: "request_id requis" }, 400);
    }

    // ── Rate limit (cette fonction est polled toutes les 5s — protection brute force) ──
    try {
      const { data: rlAllowed } = await serviceClient.rpc("check_rate_limit", {
        p_user_id: auth.userId,
        p_action: "enrichment_status_poll",
        p_max_requests: 60,
        p_window_seconds: 60,
      });
      if (rlAllowed === false) {
        return json({ success: false, error: "Trop de requêtes.", error_code: "RATE_LIMITED" }, 429);
      }
    } catch { /* RPC indispo, on laisse passer */ }

    // ── Lookup en DB pour vérifier ownership (CRITIQUE multi-tenant) ──
    let cached: any = null;
    try {
      const { data } = await serviceClient
        .from("candidate_enrichments")
        .select("*")
        .eq("provider_request_id", requestId)
        .maybeSingle();
      cached = data;
    } catch (e) {
      console.warn("[get-enrichment-status] DB lookup error:", e);
    }

    // ── SÉCURITÉ : refuser si row introuvable ──
    // Avant on faisait un fallback BC direct mais ça permettait à un user de
    // récupérer les contacts d'un request_id d'une autre org en brute-forçant
    // les UUIDs BC. Maintenant on refuse strictement (la migration DOIT être
    // appliquée — si elle ne l'est pas, l'user verra une erreur claire).
    if (!cached) {
      console.warn(`[get-enrichment-status] Row introuvable pour request_id=${requestId} — refus pour sécurité multi-tenant`);
      return json({
        success: false,
        error: "Demande d'enrichissement introuvable",
        error_code: "ENRICHMENT_NOT_FOUND",
      }, 404);
    }

    if (cached) {
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
        if (candidateId) {
          await saveCandidateContact(serviceClient, {
            organizationId: cached.organization_id,
            candidateId,
            userId: auth.userId,
            email: cached.contact_email || null,
            phone: cached.contact_phone || null,
          });
        }
        return json({
          success: true,
          status: "terminated",
          included: cached.included === true,
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
    } else {
      // Pas de row en DB — fallback : on tente quand même BC direct
      // (cas où la migration n'est pas appliquée mais l'enrichment a démarré)
      console.warn(`[get-enrichment-status] No DB row for request_id=${requestId}, fallback BC direct`);
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

    const isIncluded = cached?.included === true;

    if (cached?.id) {
      // Update la row existante
      const { error: updateError } = await serviceClient
        .from("candidate_enrichments")
        .update(updatePayload)
        .eq("id", cached.id);

      if (updateError) {
        console.warn("[get-enrichment-status] UPDATE failed:", updateError.message);
      }

      // ── SETTLE CREDITS Konekt ──
      // Débite uniquement si :
      //  - la demande n'est pas couverte par le forfait (included = false)
      //  - on n'a pas déjà settle pour cette row (credits_consumed était 0 avant)
      //  - BC a réellement trouvé email ou phone (sinon BC ne facture rien non plus)
      // L'idempotence est garantie par : on settle UNE FOIS par transition pending→terminated.
      // Si l'user re-clique enrich sur ce profil dans 30j, c'est servi par le cache (pas de re-settle).
      const alreadySettled = (cached.credits_consumed ?? 0) > 0;
      if (!alreadySettled && cached.organization_id) {
        const ownerUserId = cached.requested_by_user_id || auth.userId;
        let creditsUsed = 0;

        if (!isIncluded) {
          if (contact.email) {
            await settleCredits(serviceClient, {
              organizationId: cached.organization_id,
              userId: ownerUserId,
              aiAction: "enrich_contact_email",
              modelId: "claude-haiku-4-5", // dummy, floor=1 utilisé car tokens=0
              tokensInput: 0,
              tokensOutput: 0,
              description: `Contact enrichi (email) : ${cached.linkedin_url}`,
            });
            creditsUsed += 1;
          }
          if (contact.phone) {
            await settleCredits(serviceClient, {
              organizationId: cached.organization_id,
              userId: ownerUserId,
              aiAction: "enrich_contact_phone",
              modelId: "claude-haiku-4-5",
              tokensInput: 0,
              tokensOutput: 0,
              description: `Contact enrichi (téléphone) : ${cached.linkedin_url}`,
            });
            creditsUsed += 10;
          }
        }

        // Compteur mensuel par membre (statistiques, y compris sous forfait),
        // incrémenté AVANT de renvoyer le contact (atomique via RPC).
        if (contact.email || contact.phone) {
          const { error: quotaError } = await serviceClient.rpc("increment_enrichment_quota", {
            p_user_id: ownerUserId,
            p_org_id: cached.organization_id,
            p_emails: contact.email ? 1 : 0,
            p_phones: contact.phone ? 1 : 0,
            p_credits: creditsUsed,
          });
          if (quotaError) console.warn("[get-enrichment-status] quota increment failed:", quotaError.message);
        }
      }

      // Fiche pipeline : garder le contact trouvé
      if (candidateId && cached.organization_id) {
        await saveCandidateContact(serviceClient, {
          organizationId: cached.organization_id,
          candidateId,
          userId: auth.userId,
          email: contact.email,
          phone: contact.phone,
        });
      }
    } else {
      // Pas de row → on n'écrit pas en DB ni settle (dégradé, pas de cache).
      console.warn("[get-enrichment-status] No row to update, returning result without caching/settle");
    }

    return json({
      success: true,
      status: "terminated",
      included: isIncluded,
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
    if (err instanceof Response) return err;
    console.error("[get-enrichment-status] Error:", err);
    return json({ success: false, error: "Erreur serveur" }, 500);
  }
});
