/**
 * enrich-candidate-contact — Démarre un enrichment de contact via Better Contact
 *
 * Workflow :
 *   1. Auth + org resolution
 *   2. Cache lookup : si déjà enrichi récemment pour cet org+linkedin_url → retour direct ($0)
 *   3. POST Better Contact /api/v2/async → récupère request_id
 *   4. INSERT dans candidate_enrichments status='pending'
 *   5. Retourne { request_id, status: 'pending' } → frontend poll get-enrichment-status
 *
 * IMPORTANT : Better Contact est ASYNC (la cascade prend 30s à 5min). On ne
 * peut PAS bloquer dans cette edge function (timeout 60s Supabase). Le frontend
 * doit poll get-enrichment-status après réception du request_id.
 *
 * Naming règle CLAUDE.md : aucun message user-facing ne mentionne "Better Contact".
 * On dit "service d'enrichment Konekt" ou similaire.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { ACTION_COSTS } from "../_shared/ai-config.ts";
import { getOrFetchContact, normalizeLinkedInUrl as normalizeLinkedInUrlShared } from "../_shared/get-or-fetch-contact.ts";

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

/** Normalise un linkedin_url pour le matching cache. */
function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return String(url)
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .trim() || null;
}

/** Extrait un domaine depuis une URL/email/website pour BC company_domain. */
function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;
  // Si c'est un email, prendre la partie après @
  if (raw.includes('@')) return raw.split('@')[1].toLowerCase();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (/(?:^|\.)(?:linkedin|facebook|twitter|x|instagram)\.com$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
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
    const {
      linkedin_url,
      first_name,
      last_name,
      company,
      company_domain: providedDomain,
      organization_id: bodyOrgId,
      with_email,
      with_phone,
    } = body;

    // Default : email seul si rien spécifié (10× moins cher que phone)
    const enrichEmail = with_email !== false;
    const enrichPhone = with_phone === true;

    if (!enrichEmail && !enrichPhone) {
      return json({
        success: false,
        error: "Au moins email ou téléphone doit être demandé",
      }, 400);
    }

    // ── Validation input ──
    if (!linkedin_url) {
      return json({ success: false, error: "linkedin_url requis" }, 400);
    }

    const normalizedUrl = normalizeLinkedInUrl(linkedin_url);
    if (!normalizedUrl) {
      return json({ success: false, error: "linkedin_url invalide" }, 400);
    }

    // BC veut au minimum first_name + (company OR company_domain) pour bien fonctionner
    if (!first_name && !last_name) {
      return json({
        success: false,
        error: "Au moins le prénom est requis pour l'enrichment",
      }, 400);
    }

    // ── Org resolution + verify membership ──
    let orgId = bodyOrgId;
    if (!orgId) {
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("active_organization_id")
        .eq("user_id", auth.userId)
        .single();
      orgId = profile?.active_organization_id;
    }
    if (!orgId) {
      return json({ success: false, error: "Organisation non trouvée" }, 403);
    }
    const isMember = await verifyOrgMembership(serviceClient, auth.userId, orgId);
    if (!isMember) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    // ── Rate limit (enrichment est payant, throttle agressif) ──
    try {
      const { data: rlAllowed } = await serviceClient.rpc("check_rate_limit", {
        p_user_id: auth.userId,
        p_action: "enrich_contact",
        p_max_requests: 30,
        p_window_seconds: 60,
      });
      if (rlAllowed === false) {
        return json({
          success: false,
          error: "Trop de demandes d'enrichment. Patientez 1 minute.",
        }, 429);
      }
    } catch { /* RPC indispo, on laisse passer */ }

    // ── Cascade lookup PRE-BC : check RGPD + sources gratuites avant payer ──
    // (Unipile contact_info, candidate_enrichments cache, job_candidate_status,
    //  airtable_candidates → si trouvé, on évite l'appel BC payant)
    const cascade = await getOrFetchContact(serviceClient, {
      organizationId: orgId,
      linkedinUrl: linkedin_url,
      contactInfoFromProfile: body.contact_info_hint || undefined,
    });

    if (cascade.gdprBlocked) {
      console.log(`[enrich-candidate-contact] RGPD blocked for ${normalizedUrl}`);
      return json({
        success: false,
        error: "Ce candidat a exercé son droit à l'effacement (RGPD). Enrichment refusé.",
        error_code: "GDPR_ERASED",
      }, 403);
    }

    if (cascade.email || cascade.phone) {
      console.log(`[enrich-candidate-contact] Cascade hit (source=${cascade.source}) — pas d'appel BC, pas de débit crédit`);
      return json({
        success: true,
        cached: true,
        source: cascade.source,
        provider_source: cascade.providerSource || null,
        request_id: null,
        status: "terminated",
        contact: {
          email: cascade.email,
          email_status: cascade.email ? 'deliverable' : null,
          phone: cascade.phone,
          phone_type: cascade.phone ? 'unknown' : null,
          email_provider_source: cascade.providerSource || cascade.source,
          phone_provider_source: cascade.providerSource || cascade.source,
        },
      });
    }

    // ── Pre-auth crédits Konekt : refus si solde insuffisant ──
    // Coût max = somme des floors des actions demandées (1 cr email + 10 cr phone)
    const emailCost = enrichEmail ? (ACTION_COSTS.enrich_contact_email?.floor ?? 1) : 0;
    const phoneCost = enrichPhone ? (ACTION_COSTS.enrich_contact_phone?.floor ?? 10) : 0;
    const maxCost = emailCost + phoneCost;

    const { data: balance } = await serviceClient
      .from("ai_credit_balances")
      .select("plan_credits, topup_credits")
      .eq("organization_id", orgId)
      .maybeSingle();
    const totalCredits = (balance?.plan_credits ?? 0) + (balance?.topup_credits ?? 0);

    if (totalCredits < maxCost) {
      return json({
        success: false,
        error: `Crédits Konekt insuffisants (${totalCredits} disponibles, ${maxCost} requis). Achetez un pack dans Paramètres > Crédits.`,
        error_code: "INSUFFICIENT_CREDITS",
        balance: totalCredits,
        required: maxCost,
      }, 402);
    }

    // ── Cache lookup : si déjà enrichi récemment, retour direct ──
    const { data: cached } = await serviceClient
      .from("candidate_enrichments")
      .select("*")
      .eq("organization_id", orgId)
      .eq("linkedin_url", normalizedUrl)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      console.log(`[enrich-candidate-contact] CACHE HIT for ${normalizedUrl} (status=${cached.status})`);
      return json({
        success: true,
        cached: true,
        request_id: cached.provider_request_id,
        status: cached.status,
        contact: cached.status === "terminated" ? {
          email: cached.contact_email,
          email_status: cached.contact_email_status,
          phone: cached.contact_phone,
          phone_type: cached.contact_phone_type,
          email_provider_source: cached.email_provider_source,
          phone_provider_source: cached.phone_provider_source,
        } : null,
      });
    }

    // ── BC API key (env global d'abord, per-org plus tard si besoin) ──
    const BC_API_KEY = Deno.env.get("BETTERCONTACT_API_KEY");
    if (!BC_API_KEY) {
      console.error("[enrich-candidate-contact] BETTERCONTACT_API_KEY not configured");
      return json({
        success: false,
        error: "Service d'enrichment non configuré. Contactez l'administrateur.",
      }, 500);
    }

    // ── Domain auto-extract si pas fourni ──
    const companyDomain = providedDomain || (company ? extractDomain(company) : null);

    // ── POST Better Contact ──
    const bcPayload = {
      data: [{
        first_name: first_name || "",
        last_name: last_name || "",
        company: company || "",
        ...(companyDomain ? { company_domain: companyDomain } : {}),
        linkedin_url,
        custom_fields: {
          konekt_org_id: orgId,
          konekt_linkedin_url_norm: normalizedUrl,
        },
      }],
      enrich_email_address: enrichEmail,
      enrich_phone_number: enrichPhone,
    };

    console.log("[enrich-candidate-contact] POST BC payload:", JSON.stringify(bcPayload).slice(0, 300));

    const bcResp = await fetchWithTimeout(`${BC_BASE}/async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": BC_API_KEY,
      },
      body: JSON.stringify(bcPayload),
    }, 15000);

    const bcText = await bcResp.text();

    if (!bcResp.ok) {
      console.error("[enrich-candidate-contact] BC error", bcResp.status, bcText.slice(0, 200));
      if (bcResp.status === 401) {
        return json({ success: false, error: "Service d'enrichment authentification invalide" }, 500);
      }
      if (bcResp.status === 429) {
        return json({ success: false, error: "Service d'enrichment surchargé. Réessayez dans 1 min." }, 429);
      }
      return json({ success: false, error: "Erreur lors du démarrage de l'enrichment" }, 500);
    }

    let bcData: any;
    try { bcData = JSON.parse(bcText); } catch {
      return json({ success: false, error: "Réponse invalide du service d'enrichment" }, 500);
    }

    if (!bcData?.success || !bcData?.id) {
      console.error("[enrich-candidate-contact] BC unexpected response:", bcText.slice(0, 300));
      return json({ success: false, error: "Réponse inattendue du service d'enrichment" }, 500);
    }

    const requestId = String(bcData.id);
    console.log(`[enrich-candidate-contact] BC request_id=${requestId}`);

    // ── INSERT dans candidate_enrichments status='pending' ──
    const { error: insertError } = await serviceClient
      .from("candidate_enrichments")
      .upsert({
        organization_id: orgId,
        linkedin_url: normalizedUrl,
        first_name: first_name || null,
        last_name: last_name || null,
        company: company || null,
        company_domain: companyDomain,
        provider: "bettercontact",
        provider_request_id: requestId,
        status: "pending",
        requested_at: new Date().toISOString(),
        requested_by_user_id: auth.userId,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "organization_id,linkedin_url" });

    if (insertError) {
      // CRITIQUE : si l'INSERT échoue, get-enrichment-status ne pourra pas
      // retrouver la row → "Enrichment introuvable" → user bloqué.
      // Cas typique : table candidate_enrichments pas encore créée
      // (migration 20260427180000_candidate_enrichments.sql non appliquée).
      console.error("[enrich-candidate-contact] CRITICAL INSERT failed:", insertError.message);
      return json({
        success: false,
        error: "Service d'enrichment non initialisé. Contactez l'administrateur.",
        // Détails techniques pour debug (pas affiché à l'user via Konekt UI mais
        // visible dans F12 Network → Response)
        _debug: insertError.message,
      }, 500);
    }

    return json({
      success: true,
      cached: false,
      request_id: requestId,
      status: "pending",
      message: "Enrichment démarré. Patientez quelques secondes.",
    });
  } catch (err) {
    console.error("[enrich-candidate-contact] Error:", err);
    return json({ success: false, error: "Erreur serveur" }, 500);
  }
});
