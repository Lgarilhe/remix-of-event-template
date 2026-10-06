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
 * 4. Closed sequence enrollments (and their step executions, by cascade) and
 *    finished InMails with no activity for > 24 months — never active or
 *    paused enrollments, never pending InMails
 * 5. Conversation–mission links (lot 0b) with no event for > 24 months
 * 6. Transcription, résumé et tâches proposées d'un appel (téléphonie) pour un
 *    appel de plus de 12 mois ; la ligne de l'appel et les tâches déjà créées
 *    restent (fonction SQL rgpd_purge_phone_call_insights, fenêtre minimale de
 *    6 mois, date de l'appel)
 *
 * Lignes candidat (1 et 3) : sélection et suppression par la fonction SQL
 * rgpd_purge_candidate_rows (lot 0c-2), sur l'étape générale : 24 mois sans
 * activité hors Embauché, 12 mois après un écart. Fenêtres plus courtes
 * refusées en SQL (HINT PURGE_WINDOW_TOO_SHORT). Fragments de connaissance
 * (knowledge_chunks) : par organisation, seulement pour un candidat qui n'a
 * plus aucune ligne dans l'organisation.
 *
 * « Compte seulement » par défaut (décision 5 du lot 0c) : sans
 * {"dry_run": false} dans le corps, rien n'est supprimé, à aucune étape ;
 * chaque étape compte et journalise ce qu'elle supprimerait. Planification et
 * règles restent à décider après avis juridique.
 *
 * Logs all deletions (or would-be deletions) for audit trail.
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

    // Passage réel seulement sur demande explicite ; tout autre corps (vide,
    // illisible, dry_run absent ou vrai) compte sans rien supprimer.
    const body = await req.json().catch(() => null) as { dry_run?: unknown } | null;
    const dryRun = body?.dry_run !== false;
    const mode = dryRun ? "compte seulement" : "suppression";

    const now = new Date();
    const stats = {
      candidates_purged: 0,
      audio_purged: 0,
      refused_purged: 0,
      sequence_enrollments_purged: 0,
      inmails_purged: 0,
      conversation_links_purged: 0,
      phone_call_insights_purged: 0,
      knowledge_chunks_purged: 0,
      errors: [] as string[],
    };

    // ── 1 et 3. Lignes candidat : 24 mois sans activité, 12 mois après un écart ──
    const cutoff24m = new Date(now);
    cutoff24m.setMonth(cutoff24m.getMonth() - 24);
    const cutoff12m = new Date(now);
    cutoff12m.setMonth(cutoff12m.getMonth() - 12);
    // Un jour de marge pour la fonction SQL : l'arithmétique des mois de JS
    // (29 février) ne doit jamais tomber au-delà de la borne qu'elle vérifie.
    const candidateInactiveBefore = new Date(cutoff24m);
    candidateInactiveBefore.setDate(candidateInactiveBefore.getDate() - 1);
    const candidateRejectedBefore = new Date(cutoff12m);
    candidateRejectedBefore.setDate(candidateRejectedBefore.getDate() - 1);

    try {
      const { data: purgedRows, error: purgeError } = await adminClient.rpc("rgpd_purge_candidate_rows", {
        p_inactive_before: candidateInactiveBefore.toISOString(),
        p_rejected_before: candidateRejectedBefore.toISOString(),
        p_dry_run: dryRun,
        p_limit: 500,
      });

      if (purgeError) {
        stats.errors.push(`candidate rows purge: ${purgeError.message}`);
      } else {
        const rows = (purgedRows ?? []) as Array<{
          row_id: string;
          organization_id: string | null;
          candidate_id: string | null;
          reason: string;
        }>;
        stats.candidates_purged = rows.filter((r) => r.reason === "inactive_24m").length;
        stats.refused_purged = rows.filter((r) => r.reason === "rejected_12m").length;

        // Fragments de connaissance : par organisation, seulement pour un
        // candidat sans autre ligne dans l'organisation (hors lignes purgées).
        const pickedIds = new Set(rows.map((r) => r.row_id));
        const byOrg = new Map<string, Set<string>>();
        for (const r of rows) {
          if (!r.organization_id || !r.candidate_id) continue;
          if (!byOrg.has(r.organization_id)) byOrg.set(r.organization_id, new Set());
          byOrg.get(r.organization_id)!.add(r.candidate_id);
        }
        for (const [orgId, candidateSet] of byOrg) {
          const candidates = [...candidateSet];
          for (let i = 0; i < candidates.length; i += 100) {
            const batch = candidates.slice(i, i + 100);
            const { data: remaining, error: remainingError } = await adminClient
              .from("job_candidate_status")
              .select("id, candidate_id")
              .eq("organization_id", orgId)
              .in("candidate_id", batch);
            if (remainingError) {
              stats.errors.push(`knowledge chunks check: ${remainingError.message}`);
              continue;
            }
            const stillPresent = new Set(
              ((remaining ?? []) as Array<{ id: string; candidate_id: string }>)
                .filter((r) => !pickedIds.has(r.id))
                .map((r) => r.candidate_id),
            );
            const orphans = batch.filter((c) => !stillPresent.has(c));
            if (orphans.length === 0) continue;
            if (dryRun) {
              const { count, error: countError } = await adminClient
                .from("knowledge_chunks")
                .select("id", { count: "exact", head: true })
                .eq("organization_id", orgId)
                .in("entity_id", orphans);
              if (countError) stats.errors.push(`knowledge chunks count: ${countError.message}`);
              else stats.knowledge_chunks_purged += count ?? 0;
            } else {
              const { data: deletedChunks, error: chunksError } = await adminClient
                .from("knowledge_chunks")
                .delete()
                .eq("organization_id", orgId)
                .in("entity_id", orphans)
                .select("id");
              if (chunksError) stats.errors.push(`delete knowledge chunks: ${chunksError.message}`);
              else stats.knowledge_chunks_purged += (deletedChunks ?? []).length;
            }
          }
        }

        console.log(
          `[rgpd-purge] (${mode}) ${stats.candidates_purged} inactive candidate rows (> 24 months), ` +
            `${stats.refused_purged} rejected candidate rows (> 12 months), ${stats.knowledge_chunks_purged} knowledge chunks`,
        );
      }
    } catch (e) {
      stats.errors.push(`candidate rows purge: ${e}`);
    }

    // ── 2. Coaching audio older than 6 months ───────────────────────
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

        if (oldFiles.length > 0 && dryRun) {
          stats.audio_purged = oldFiles.length;
          console.log(`[rgpd-purge] (${mode}) ${oldFiles.length} coaching audio files (> 6 months)`);
        } else if (oldFiles.length > 0) {
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

    // ── 4. Sequence data after 24 months (SEQ-116) ─────────────────
    // Même durée que les candidats inactifs (étape 1). Les inscriptions closes
    // portent nom, titre, adresse, téléphone du candidat ; leurs exécutions
    // (textes envoyés) suivent par ON DELETE CASCADE. Jamais une inscription
    // active ou en pause, jamais un InMail encore à envoyer.
    const CLOSED_ENROLLMENT_STATUSES = ["replied", "completed", "bounced", "cancelled", "stopped"];
    const FINISHED_INMAIL_STATUSES = ["sent", "replied", "failed", "cancelled"];
    try {
      const { data: closedEnrollments, error: closedError } = await adminClient
        .from("sequence_enrollments")
        .select("id")
        .in("status", CLOSED_ENROLLMENT_STATUSES)
        .lt("updated_at", cutoff24m.toISOString())
        .limit(500);
      if (closedError) {
        stats.errors.push(`closed enrollments query: ${closedError.message}`);
      } else {
        const ids = (closedEnrollments ?? []).map((e: { id: string }) => e.id);
        if (dryRun) stats.sequence_enrollments_purged = ids.length;
        for (let i = 0; !dryRun && i < ids.length; i += 100) {
          const { data: deleted, error: deleteError } = await adminClient
            .from("sequence_enrollments")
            .delete()
            .in("id", ids.slice(i, i + 100))
            .in("status", CLOSED_ENROLLMENT_STATUSES)
            .select("id");
          if (deleteError) {
            stats.errors.push(`delete closed enrollments: ${deleteError.message}`);
            break;
          }
          stats.sequence_enrollments_purged += (deleted ?? []).length;
        }
        if (stats.sequence_enrollments_purged > 0) {
          console.log(`[rgpd-purge] (${mode}) ${stats.sequence_enrollments_purged} closed sequence enrollments (> 24 months)`);
        }
      }
    } catch (e) {
      stats.errors.push(`sequence enrollments purge: ${e}`);
    }

    try {
      const { data: oldInmails, error: inmailError } = await adminClient
        .from("inmail_queue")
        .select("id")
        .in("status", FINISHED_INMAIL_STATUSES)
        .lt("updated_at", cutoff24m.toISOString())
        .limit(500);
      if (inmailError) {
        stats.errors.push(`finished inmails query: ${inmailError.message}`);
      } else {
        const ids = (oldInmails ?? []).map((m: { id: string }) => m.id);
        if (dryRun) stats.inmails_purged = ids.length;
        for (let i = 0; !dryRun && i < ids.length; i += 100) {
          const { data: deleted, error: deleteError } = await adminClient
            .from("inmail_queue")
            .delete()
            .in("id", ids.slice(i, i + 100))
            .in("status", FINISHED_INMAIL_STATUSES)
            .select("id");
          if (deleteError) {
            stats.errors.push(`delete finished inmails: ${deleteError.message}`);
            break;
          }
          stats.inmails_purged += (deleted ?? []).length;
        }
        if (stats.inmails_purged > 0) {
          console.log(`[rgpd-purge] (${mode}) ${stats.inmails_purged} finished InMails (> 24 months)`);
        }
      }
    } catch (e) {
      stats.errors.push(`inmails purge: ${e}`);
    }

    // ── 5. Liens conversation–mission après 24 mois (lot 0b) ─────────
    // Un lien porte les identifiants LinkedIn du candidat et de la
    // conversation. Il est inactif quand aucun de ses événements (envoi en cours, envoi, envoi
    // attribué, réception) ni sa création n'a moins de 24 mois. updated_at
    // n'est pas un critère : un rattrapage ou un rejeu le repose sans
    // événement nouveau. Le même filtre est rejoué à la suppression, pour
    // garder un lien touché entre la lecture et la suppression.
    const cutoff24mIso = cutoff24m.toISOString();
    const LINK_EVENT_FILTERS = ["outbound_pending_at", "last_outbound_at", "last_mission_send_at", "last_inbound_at"]
      .map((column) => `${column}.is.null,${column}.lt."${cutoff24mIso}"`);
    try {
      let oldLinksQuery = adminClient
        .from("mission_conversations")
        .select("id")
        .lt("created_at", cutoff24mIso);
      for (const filter of LINK_EVENT_FILTERS) oldLinksQuery = oldLinksQuery.or(filter);
      const { data: oldLinks, error: linksError } = await oldLinksQuery.limit(500);
      if (linksError) {
        stats.errors.push(`conversation links query: ${linksError.message}`);
      } else {
        const ids = (oldLinks ?? []).map((l: { id: string }) => l.id);
        if (dryRun) stats.conversation_links_purged = ids.length;
        for (let i = 0; !dryRun && i < ids.length; i += 100) {
          let deleteQuery = adminClient
            .from("mission_conversations")
            .delete()
            .in("id", ids.slice(i, i + 100))
            .lt("created_at", cutoff24mIso);
          for (const filter of LINK_EVENT_FILTERS) deleteQuery = deleteQuery.or(filter);
          const { data: deleted, error: deleteError } = await deleteQuery.select("id");
          if (deleteError) {
            stats.errors.push(`delete conversation links: ${deleteError.message}`);
            break;
          }
          stats.conversation_links_purged += (deleted ?? []).length;
        }
        if (stats.conversation_links_purged > 0) {
          console.log(`[rgpd-purge] (${mode}) ${stats.conversation_links_purged} conversation links (> 24 months)`);
        }
      }
    } catch (e) {
      stats.errors.push(`conversation links purge: ${e}`);
    }

    // ── 6. Transcriptions d'appels après 12 mois (téléphonie) ────────
    // Transcription, résumé et tâches proposées portent le contenu d'une
    // conversation avec un candidat. L'âge est celui de l'appel ; la fonction SQL
    // refuse toute fenêtre sous 6 mois et ne touche ni la ligne de l'appel ni les
    // tâches déjà créées. Même marge d'un jour que pour les lignes candidat.
    const callInsightsBefore = new Date(cutoff12m);
    callInsightsBefore.setDate(callInsightsBefore.getDate() - 1);
    try {
      const { data: purgedInsights, error: insightsError } = await adminClient.rpc("rgpd_purge_phone_call_insights", {
        p_before: callInsightsBefore.toISOString(),
        p_dry_run: dryRun,
        p_limit: 500,
      });
      if (insightsError) {
        stats.errors.push(`phone call insights purge: ${insightsError.message}`);
      } else {
        stats.phone_call_insights_purged = (purgedInsights ?? []).length;
        if (stats.phone_call_insights_purged > 0) {
          console.log(`[rgpd-purge] (${mode}) ${stats.phone_call_insights_purged} call transcriptions (> 12 months)`);
        }
      }
    } catch (e) {
      stats.errors.push(`phone call insights purge: ${e}`);
    }

    // ── Summary ─────────────────────────────────────────────────────
    console.log(`[rgpd-purge] Summary (${mode}):`, JSON.stringify(stats));

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
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
