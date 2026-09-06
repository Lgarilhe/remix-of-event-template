/**
 * enrich-candidate-contact — Démarre un enrichment de contact via Better Contact
 *
 * Workflow :
 *   1. Auth + org resolution
 *   2. Abonnement : plan effectif free → 403 PLAN_REQUIRED (subscription-gate)
 *   3. Forfait (lot P0-D) : N contacts inclus par mois et par organisation
 *      (limits.contacts_included, RPC get_org_contact_usage). Un email = 1,
 *      un téléphone = 1. Tant que le reste couvre la demande → included = true,
 *      pas de pré-autorisation ni de débit de crédits. Au-delà : crédits (1 / 10).
 *   4. Cache lookup : si déjà enrichi récemment pour cet org+linkedin_url → retour direct ($0)
 *   5. POST Better Contact /api/v2/async → récupère request_id
 *   6. INSERT dans candidate_enrichments status='pending', included
 *   7. Retourne { request_id, status: 'pending', included, included_remaining }
 *      → frontend poll get-enrichment-status
 *
 * Réponse : `included` = aucun crédit débité pour cette demande (forfait, ou
 * résultat déjà connu) ; `included_remaining` = reste du forfait du mois au
 * moment de la demande (les demandes en cours ne sont pas encore décomptées).
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
import { getSubscriptionGate } from "../_shared/subscription-gate.ts";
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

/**
 * Forfait de contacts inclus du mois pour l'organisation (RPC
 * get_org_contact_usage, appelée en service role). En cas d'échec de la RPC,
 * on retourne 0 restant : la demande passe alors par les crédits, jamais gratis.
 */
async function getOrgContactUsage(
  client: ReturnType<typeof createClient>,
  orgId: string,
): Promise<{ included_monthly: number; included_remaining: number }> {
  const { data, error } = await client.rpc("get_org_contact_usage", { p_organization_id: orgId });
  if (error) {
    console.warn("[enrich-candidate-contact] get_org_contact_usage failed:", error.message);
    return { included_monthly: 0, included_remaining: 0 };
  }
  const monthly = Number(data?.included_monthly ?? 0);
  let remaining = Number(data?.included_remaining ?? 0);
  if (!Number.isFinite(remaining)) remaining = 0;

  // Les demandes incluses encore en cours (moins de 10 minutes) ne sont pas
  // comptées par la RPC : elles réservent une unité chacune pour qu'un lot ne
  // dépasse pas le forfait.
  const periodStart = typeof data?.period_start === "string" ? data.period_start : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: pendingIncluded } = await client
    .from("candidate_enrichments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("included", true)
    .eq("status", "pending")
    .gte("requested_at", periodStart > tenMinutesAgo ? periodStart : tenMinutesAgo);
  remaining = Math.max(0, remaining - (pendingIncluded ?? 0));

  return {
    included_monthly: Number.isFinite(monthly) ? monthly : 0,
    included_remaining: remaining,
  };
}

/**
 * Fiche pipeline : conserve le contact trouvé dans candidate_contacts (une
 * ligne par organisation et candidat). Seuls les champs trouvés sont écrits.
 */
async function saveCandidateContact(
  client: ReturnType<typeof createClient>,
  input: { organizationId: string; candidateId: string; userId: string; email: string | null; phone: string | null },
): Promise<void> {
  if (!input.email && !input.phone) return;
  const { error } = await client
    .from("candidate_contacts")
    .upsert({
      organization_id: input.organizationId,
      candidate_id: input.candidateId,
      source: "enriched",
      updated_by: input.userId,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    }, { onConflict: "organization_id,candidate_id" });
  if (error) {
    console.warn("[enrich-candidate-contact] candidate_contacts upsert failed:", error.message);
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
    // Fiche pipeline : identifiant du candidat pour conserver le résultat dans candidate_contacts.
    const candidateId = typeof body.candidate_id === "string" && body.candidate_id.trim().length > 0 && body.candidate_id.length <= 200
      ? body.candidate_id.trim()
      : null;

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
          error_code: "RATE_LIMITED",
        }, 429);
      }
    } catch { /* RPC indispo, on laisse passer */ }

    // ── Permissions + quota mensuel par-user ──
    // Check si l'user a la permission can_enrich_contacts + quota restant
    const { data: membership } = await serviceClient
      .from("organization_members")
      .select("can_enrich_contacts, enrichment_quota_monthly, role")
      .eq("organization_id", orgId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (membership && membership.can_enrich_contacts === false) {
      return json({
        success: false,
        error: "Vous n'avez pas la permission d'enrichir des contacts. Demandez à votre administrateur d'activer cette fonctionnalité dans Paramètres > Équipe.",
        error_code: "PERMISSION_DENIED",
      }, 403);
    }

    // ── Abonnement : l'enrichissement de contact est réservé aux plans payants (lot P0-D) ──
    let canEnrichContacts = false;
    try {
      const gate = await getSubscriptionGate(serviceClient, orgId);
      canEnrichContacts = gate.canEnrichContacts;
    } catch (e) {
      console.error("[enrich-candidate-contact] subscription gate failed:", e);
      return json({ success: false, error: "Impossible de vérifier l'abonnement de l'organisation" }, 500);
    }
    if (!canEnrichContacts) {
      return json({
        success: false,
        error: "L'enrichissement de contact nécessite un abonnement.",
        error_code: "PLAN_REQUIRED",
      }, 403);
    }

    // ── Plafond mensuel par membre : appliqué seulement s'il est posé ──
    // (NULL = illimité ; le forfait est par organisation depuis le lot P0-D)
    const quotaMonthly = membership?.enrichment_quota_monthly;
    if (typeof quotaMonthly === "number") {
      // Lookup compteur du mois en cours
      const periodMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const { data: quotaRow } = await serviceClient
        .from("enrichment_user_quotas")
        .select("emails_consumed, phones_consumed")
        .eq("user_id", auth.userId)
        .eq("organization_id", orgId)
        .eq("period_month", periodMonth)
        .maybeSingle();

      const quotaUsed = (quotaRow?.emails_consumed ?? 0) + (quotaRow?.phones_consumed ?? 0);
      if (quotaUsed >= quotaMonthly) {
        return json({
          success: false,
          error: `Quota mensuel d'enrichments atteint (${quotaUsed}/${quotaMonthly}). Demandez à votre admin d'augmenter votre quota dans Paramètres > Équipe.`,
          error_code: "QUOTA_EXCEEDED",
          quota_used: quotaUsed,
          quota_limit: quotaMonthly,
        }, 403);
      }
    }

    // ── Forfait de contacts inclus (par organisation et par mois) ──
    // Unité : un email = 1, un téléphone = 1. Couvert → pas de pré-auth ni de
    // débit de crédits ; sinon comportement crédits habituel (1 / 10).
    const requestedUnits = (enrichEmail ? 1 : 0) + (enrichPhone ? 1 : 0);
    const usage = await getOrgContactUsage(serviceClient, orgId);
    const included = usage.included_remaining >= requestedUnits;

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
      if (candidateId) {
        await saveCandidateContact(serviceClient, {
          organizationId: orgId, candidateId, userId: auth.userId,
          email: cascade.email ?? null, phone: cascade.phone ?? null,
        });
      }
      return json({
        success: true,
        cached: true,
        included: true,
        included_remaining: usage.included_remaining,
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

    // ── Pre-auth crédits Konekt : refus si solde insuffisant (hors forfait) ──
    // Coût max = somme des floors des actions demandées (1 cr email + 10 cr phone)
    if (!included) {
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
          included_remaining: usage.included_remaining,
        }, 402);
      }
    }

    // ── Demande déjà en vol (moins de 10 minutes) : même request_id, pas de
    //    second appel fournisseur ni d'écrasement de provider_request_id ──
    const { data: existing } = await serviceClient
      .from("candidate_enrichments")
      .select("status, provider_request_id, requested_at, included")
      .eq("organization_id", orgId)
      .eq("linkedin_url", normalizedUrl)
      .maybeSingle();
    if (
      existing?.status === "pending" && existing.provider_request_id &&
      existing.requested_at && Date.now() - new Date(existing.requested_at).getTime() < 10 * 60 * 1000
    ) {
      console.log(`[enrich-candidate-contact] Demande en cours réutilisée pour ${normalizedUrl}`);
      return json({
        success: true,
        cached: false,
        request_id: existing.provider_request_id,
        status: "pending",
        included: existing.included === true,
        included_remaining: usage.included_remaining,
      });
    }

    // ── Cache lookup : réutilisé seulement si terminé ET un contact trouvé ──
    // (une ligne en erreur, terminée sans contact ou périmée est relancée ;
    //  la cascade ci-dessus sert normalement ce cas, ceci est un second filet)
    const { data: cached } = await serviceClient
      .from("candidate_enrichments")
      .select("*")
      .eq("organization_id", orgId)
      .eq("linkedin_url", normalizedUrl)
      .eq("status", "terminated")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached && (cached.contact_email || cached.contact_phone)) {
      console.log(`[enrich-candidate-contact] CACHE HIT for ${normalizedUrl} (status=${cached.status})`);
      if (candidateId) {
        await saveCandidateContact(serviceClient, {
          organizationId: orgId, candidateId, userId: auth.userId,
          email: cached.contact_email ?? null, phone: cached.contact_phone ?? null,
        });
      }
      return json({
        success: true,
        cached: true,
        included: true,
        included_remaining: usage.included_remaining,
        request_id: cached.provider_request_id,
        status: "terminated",
        contact: {
          email: cached.contact_email,
          email_status: cached.contact_email_status,
          phone: cached.contact_phone,
          phone_type: cached.contact_phone_type,
          email_provider_source: cached.email_provider_source,
          phone_provider_source: cached.phone_provider_source,
        },
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
        included,
        // Relance d'une ligne existante (en erreur, sans contact ou expirée) :
        // on repart d'un état propre pour le settle et le compteur.
        credits_consumed: 0,
        error_message: null,
        completed_at: null,
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
      included,
      included_remaining: usage.included_remaining,
      request_id: requestId,
      status: "pending",
      message: "Enrichment démarré. Patientez quelques secondes.",
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[enrich-candidate-contact] Error:", err);
    return json({ success: false, error: "Erreur serveur" }, 500);
  }
});
