// ============================================================================
// process-enrichment-queue — worker throttlé pour l'enrichissement de profils
// ============================================================================
// Conformité LinkedIn warning #260513-007211. Le scoring ne fetch plus aucun
// profil en direct : il met en file (profile_enrichment_queue). Ce worker
// dépile LENTEMENT (peu d'items/run, espacés, heures ouvrées, gated par le
// ledger profile_view) → aucune vue de profil en burst. Après enrichissement,
// il invalide le score caché (match_scores) → re-score lazy au prochain affichage.
//
// Invoqué par pg_cron toutes les 2 min via invoke_process_enrichment_queue()
// (Authorization: Bearer <PROCESS_SEQUENCES_SECRET>). verify_jwt=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { enrichProfileToCache } from "../_shared/profile-enrichment.ts";
import { getUserQuotas, isWithinBusinessHours, nextBusinessHoursStart } from "../_shared/linkedin-quotas.ts";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PER_RUN = 3;          // peu d'items par run (cadence cron = 2 min → ~1 profil/40s)
const INTER_ITEM_DELAY_MS = 12000;  // espacement anti micro-burst entre 2 items du même run
const MAX_ATTEMPTS = 4;

// Sérialisation par compte : ne JAMAIS enrichir un compte utilisé
// interactivement dans les N dernières minutes (recherche / vue de profil /
// message manuels = linkedin_action_log.source manual_*). Un profile_view de
// fond pendant une recherche Recruiter manuelle = multiple_sessions garanti.
const INTERACTIVE_COOLDOWN_MS = 5 * 60 * 1000;

// ⏸️ PAUSE (2026-06-02) — l'enrichissement de fond consommait la session
// LinkedIn Recruiter EN MÊME TEMPS que les recherches manuelles de l'utilisateur →
// « conflit de session » (multiple_sessions, sensible sur comptes Recruiter).
// 2026-07-06 : sérialisation par compte en place (check linkedin_action_log
// manual_* < INTERACTIVE_COOLDOWN_MS avant chaque item) ; no-op vérifié en prod.
// 2026-07-07 : DÉCISION LAURENT — le worker reste ÉTEINT malgré les garde-fous
// (compte post-suspension, warning #260513-007211). Ne repasser à false que sur
// sa demande explicite (cf. LOGBOOK 2026-07-07). La file profile_enrichment_queue
// continue d'accumuler sans effet.
const ENRICHMENT_PAUSED = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface QueueItem {
  id: string;
  organization_id: string | null;
  account_id: string;
  provider_id: string | null;
  profile_url: string | null;
  candidate_id: string | null;
  job_id: string;
  user_id: string | null;
  attempts: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Kill-switch : worker en pause → no-op (le cron continue de tirer mais ne fait
  // AUCUN appel LinkedIn, donc plus aucune collision avec l'usage interactif).
  if (ENRICHMENT_PAUSED) {
    return new Response(JSON.stringify({ success: true, processed: 0, paused: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth : secret cron (Bearer) OU service-role key ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = Deno.env.get("PROCESS_SEQUENCES_SECRET");
  const serviceKey = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorized = !!token && (token === cronSecret || token === serviceKey);
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceKey!);

  try {
    const now = new Date();
    const { data: items, error } = await supabase
      .from("profile_enrichment_queue")
      .select("id, organization_id, account_id, provider_id, profile_url, candidate_id, job_id, user_id, attempts")
      .eq("status", "pending")
      .lte("scheduled_at", now.toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) throw error;
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx] as QueueItem;

      // Inter-item spacing (anti micro-burst) — pas avant le 1er.
      if (idx > 0) await sleep(INTER_ITEM_DELAY_MS);

      // 1. Business hours (timezone de l'user) — sinon, reporter à l'ouverture.
      const quotas = await getUserQuotas(supabase, item.user_id);
      if (!isWithinBusinessHours(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end)) {
        const next = nextBusinessHoursStart(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end);
        await supabase.from("profile_enrichment_queue")
          .update({ scheduled_at: next, updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ id: item.id, ok: false, reason: "outside business hours, rescheduled" });
        continue;
      }

      // 2. Sérialisation par compte : compte utilisé interactivement il y a
      // moins de INTERACTIVE_COOLDOWN_MS → on reporte SANS consommer de
      // tentative. L'usage manuel (recherche en cours) a toujours priorité.
      const { data: recentManual } = await supabase
        .from("linkedin_action_log")
        .select("id")
        .eq("account_id", item.account_id)
        .like("source", "manual%")
        .gte("created_at", new Date(Date.now() - INTERACTIVE_COOLDOWN_MS).toISOString())
        .limit(1);
      if (recentManual && recentManual.length > 0) {
        await supabase.from("profile_enrichment_queue")
          .update({ scheduled_at: new Date(Date.now() + INTERACTIVE_COOLDOWN_MS).toISOString(), updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ id: item.id, ok: false, reason: "account in interactive use, rescheduled" });
        continue;
      }

      // 3. Résoudre les credentials Unipile de l'org.
      const creds = await resolveUnipileCredentials(item.organization_id ?? undefined, supabase);
      if (!creds) {
        await supabase.from("profile_enrichment_queue")
          .update({ status: "failed", last_error: "no Unipile credentials", updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ id: item.id, ok: false, reason: "no credentials" });
        continue;
      }

      // 4. Enrichissement gated (1 vue de profil, throttlée).
      const res = await enrichProfileToCache({
        supabase,
        apiKey: creds.apiKey,
        dsn: creds.dsn,
        accountId: item.account_id,
        organizationId: item.organization_id,
        userId: item.user_id,
        providerId: item.provider_id,
        profileUrl: item.profile_url,
        profileName: item.candidate_id || item.provider_id || undefined,
      });

      if (res.ok) {
        await supabase.from("profile_enrichment_queue")
          .update({ status: "done", last_error: null, updated_at: new Date().toISOString() })
          .eq("id", item.id);

        // Re-score lazy : invalider le score caché → re-scoré au prochain scoring.
        if (item.candidate_id && item.job_id) {
          await supabase.from("match_scores")
            .delete()
            .eq("candidate_id", item.candidate_id)
            .eq("job_id", item.job_id);
        }
        results.push({ id: item.id, ok: true });
        continue;
      }

      // Gate bloqué (cap atteint / pause fournisseur) → reporter SANS consommer
      // de tentative (ce n'est pas une erreur de l'item).
      if (res.scope === "provider_pause" || res.scope === "daily_visible" || res.scope === "profile_view") {
        const backoffMs = res.scope === "provider_pause" ? 6 * 60 * 60 * 1000 : 60 * 60 * 1000;
        await supabase.from("profile_enrichment_queue")
          .update({ scheduled_at: new Date(Date.now() + backoffMs).toISOString(), last_error: res.reason ?? res.scope, updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ id: item.id, ok: false, reason: `quota: ${res.scope}` });
        continue;
      }

      // Échec réel → incrémenter les tentatives ; failed au-delà du max.
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await supabase.from("profile_enrichment_queue")
          .update({ status: "failed", attempts, last_error: res.reason ?? "enrichment failed", updated_at: new Date().toISOString() })
          .eq("id", item.id);
      } else {
        await supabase.from("profile_enrichment_queue")
          .update({ attempts, scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), last_error: res.reason ?? "enrichment failed", updated_at: new Date().toISOString() })
          .eq("id", item.id);
      }
      results.push({ id: item.id, ok: false, reason: res.reason });
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[process-enrichment-queue] error:", err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
