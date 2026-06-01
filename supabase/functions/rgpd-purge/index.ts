/**
 * Edge function: RGPD automatic data purge
 *
 * Designed to run on a schedule (pg_cron or Supabase scheduled function).
 * Call via: POST /functions/v1/rgpd-purge with service role key.
 *
 * Purges:
 * 1. Candidates with no activity for > 24 months
 * 2. Coaching audio recordings older than 6 months (keeps transcript)
 * 3. Refused/withdrawn candidates after 12 months
 *
 * Logs all deletions for audit trail.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Only allow service-role (scheduled/cron) calls. This purge performs
    // cross-org destructive DELETEs, so it must never be reachable with a user
    // JWT or the anon key — require the service-role key explicitly.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token || token !== serviceKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const adminClient = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const stats = {
      candidates_purged: 0,
      audio_purged: 0,
      refused_purged: 0,
      errors: [] as string[],
    };

    // ── 1. Candidates with no activity for > 24 months ──────────────
    const cutoff24m = new Date(now);
    cutoff24m.setMonth(cutoff24m.getMonth() - 24);

    try {
      // Find candidates with last activity > 24 months ago
      const { data: staleCandidates, error: staleError } = await adminClient
        .from("job_candidate_status")
        .select("id, candidate_id, organization_id, candidate_name")
        .lt("updated_at", cutoff24m.toISOString())
        .is("status", null) // No active status = inactive
        .limit(500);

      if (staleError) {
        stats.errors.push(`stale candidates query: ${staleError.message}`);
      } else if (staleCandidates && staleCandidates.length > 0) {
        const ids = staleCandidates.map((c) => c.id);

        // Delete related data first
        await adminClient
          .from("knowledge_chunks")
          .delete()
          .in("entity_id", staleCandidates.map((c) => c.candidate_id).filter(Boolean));

        // Delete the candidate records
        const { error: deleteError } = await adminClient
          .from("job_candidate_status")
          .delete()
          .in("id", ids);

        if (deleteError) {
          stats.errors.push(`delete stale candidates: ${deleteError.message}`);
        } else {
          stats.candidates_purged = ids.length;
        }

        console.log(`[rgpd-purge] Purged ${ids.length} inactive candidates (> 24 months)`);
      }
    } catch (e) {
      stats.errors.push(`candidates purge: ${e}`);
    }

    // ── 2. Refused/withdrawn candidates after 12 months ─────────────
    const cutoff12m = new Date(now);
    cutoff12m.setMonth(cutoff12m.getMonth() - 12);

    try {
      const { data: refusedCandidates, error: refusedError } = await adminClient
        .from("job_candidate_status")
        .select("id, candidate_id")
        .in("status", ["refused", "withdrawn", "rejected", "declined"])
        .lt("updated_at", cutoff12m.toISOString())
        .limit(500);

      if (refusedError) {
        stats.errors.push(`refused candidates query: ${refusedError.message}`);
      } else if (refusedCandidates && refusedCandidates.length > 0) {
        const ids = refusedCandidates.map((c) => c.id);

        await adminClient
          .from("knowledge_chunks")
          .delete()
          .in("entity_id", refusedCandidates.map((c) => c.candidate_id).filter(Boolean));

        const { error: deleteError } = await adminClient
          .from("job_candidate_status")
          .delete()
          .in("id", ids);

        if (deleteError) {
          stats.errors.push(`delete refused candidates: ${deleteError.message}`);
        } else {
          stats.refused_purged = ids.length;
        }

        console.log(`[rgpd-purge] Purged ${ids.length} refused/withdrawn candidates (> 12 months)`);
      }
    } catch (e) {
      stats.errors.push(`refused purge: ${e}`);
    }

    // ── 3. Coaching audio older than 6 months ───────────────────────
    const cutoff6m = new Date(now);
    cutoff6m.setMonth(cutoff6m.getMonth() - 6);

    try {
      // List audio files in storage older than 6 months
      const { data: audioFiles, error: audioError } = await adminClient
        .storage
        .from("coaching-audio")
        .list("", { limit: 200 });

      if (audioError) {
        stats.errors.push(`audio list: ${audioError.message}`);
      } else if (audioFiles && audioFiles.length > 0) {
        const oldFiles = audioFiles.filter((f) => {
          const created = new Date(f.created_at);
          return created < cutoff6m;
        });

        if (oldFiles.length > 0) {
          const paths = oldFiles.map((f) => f.name);
          const { error: deleteError } = await adminClient
            .storage
            .from("coaching-audio")
            .remove(paths);

          if (deleteError) {
            stats.errors.push(`delete audio: ${deleteError.message}`);
          } else {
            stats.audio_purged = oldFiles.length;
          }

          console.log(`[rgpd-purge] Purged ${oldFiles.length} coaching audio files (> 6 months)`);
        }
      }
    } catch (e) {
      stats.errors.push(`audio purge: ${e}`);
    }

    // ── Summary ─────────────────────────────────────────────────────
    console.log(`[rgpd-purge] Summary:`, JSON.stringify(stats));

    return new Response(JSON.stringify({
      success: true,
      purge_date: now.toISOString(),
      ...stats,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[rgpd-purge] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
