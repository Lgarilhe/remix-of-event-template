// ============================================================================
// process-agent-tasks — worker des tâches de fond du copilot (P5, 2026-07-15)
// ============================================================================
// Invoqué chaque minute par cron (migration 20260715130000) avec Bearer
// PROCESS_SEQUENCES_SECRET (même pattern qu'agent-daily-digest). Réclame UNE
// tâche via claim_agent_background_task() puis en traite UN morceau borné
// (timeout edge 60s → 1 lot/tick + re-tick), met à jour la progression (visible
// en realtime), et à la fin notifie l'utilisateur.
//
// v1 : kind 'score_mission_profiles' — score les profils sourcés NON scorés
// d'une mission. Auto-drainant : score-profile-job écrit job_candidate_status.score
// pour chaque profil traité → la requête "score IS NULL" rétrécit à chaque lot.
//
// Fail-soft : une tâche en erreur ne bloque pas les autres (une tâche/tick).
// Aucune donnée fournisseur exposée : ce worker n'émet aucun texte user-facing
// (les libellés viennent de la notification/message, tous en français).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { buildProfileData, buildJobFromBrief } from "../_shared/profile-data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Any = any;

// ─── Bornage par tick (rester sous le timeout edge 60s) ─────────────────────
const BATCH_SIZE = 10;              // limite de score-profile-job (10 profils/appel)
const MAX_BATCHES_PER_TICK = 3;     // jusqu'à 30 profils/tick
const TICK_BUDGET_MS = 45_000;      // marge sous les 60s
const MAX_ATTEMPTS = 5;             // échecs tolérés avant abandon (status='error')

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 50_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ===== AUTH (cron secret ou service role) =====
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const serviceRoleKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const cronSecret = Deno.env.get("PROCESS_SEQUENCES_SECRET") || "";
  if (!token || (token !== serviceRoleKey && token !== cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const startedAt = Date.now();

  // ===== Claim d'UNE tâche =====
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_agent_background_task", { p_lock_ttl_minutes: 5 });
  if (claimErr) {
    console.error("[agent-tasks] claim error:", claimErr);
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const task = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!task) {
    return new Response(JSON.stringify({ processed: 0, reason: "no task" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[agent-tasks] claimed task=${task.id} kind=${task.kind} status→running done=${task.progress_done}/${task.progress_total}`);

  try {
    if (task.kind === "score_mission_profiles") {
      await runScoreMissionProfiles(supabase, supabaseUrl, serviceRoleKey, task, startedAt);
    } else {
      // Kind inconnu → erreur définitive (pas de retry).
      await failTask(supabase, task, `Type de tâche inconnu : ${task.kind}`, true);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agent-tasks] task=${task.id} error:`, msg);
    // Transient : re-queue avec incrément d'échec (gate MAX_ATTEMPTS).
    await failTask(supabase, task, msg, false);
  }

  return new Response(JSON.stringify({ processed: 1, task: task.id }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ─── kind: score_mission_profiles ───────────────────────────────────────────
async function runScoreMissionProfiles(
  supabase: Any,
  supabaseUrl: string,
  serviceRoleKey: string,
  task: Any,
  startedAt: number,
): Promise<void> {
  const params = (task.params || {}) as { project_id?: string; scoring_instructions?: string };
  const projectId = params.project_id;
  if (!projectId) {
    await failTask(supabase, task, "project_id manquant dans la tâche", true);
    return;
  }

  // Mission + brief (pour construire le payload de scoring, identique au front).
  const { data: project, error: projErr } = await supabase
    .from("sourcing_projects")
    .select("id, name, organization_id, job_details, client_name")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw new Error(`lecture mission : ${projErr.message}`);
  if (!project) {
    await failTask(supabase, task, "Mission introuvable (supprimée ?)", true);
    return;
  }
  // Garde anti-IDOR : la mission doit appartenir à l'org de la tâche.
  if (project.organization_id !== task.organization_id) {
    await failTask(supabase, task, "Mission hors de l'organisation de la tâche", true);
    return;
  }

  const jd = project.job_details || {};
  // job.id DOIT correspondre au job_id RÉELLEMENT stocké sur les lignes
  // job_candidate_status (score-profile-job réécrit par candidate_id + job_id).
  // On le lit depuis une ligne existante (fallback 'project:{id}', format
  // synthétique standard des missions).
  const { data: sampleRow } = await supabase
    .from("job_candidate_status")
    .select("job_id")
    .eq("project_id", projectId)
    .not("job_id", "is", null)
    .limit(1)
    .maybeSingle();
  const jobId = sampleRow?.job_id || `project:${projectId}`;
  const jobPayload = buildJobFromBrief(jd, {
    id: jobId,
    title: jd.title || project.name || "Mission sans titre",
    client: project.client_name ? { name: project.client_name, sector: jd.client?.sector } : undefined,
  });

  // Total figé au premier tick (profils non scorés avec données exploitables).
  let progressTotal = task.progress_total || 0;
  if (progressTotal === 0) {
    const { count, error: cntErr } = await supabase
      .from("job_candidate_status")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("score", null)
      .not("linkedin_profile_data", "is", null);
    if (cntErr) throw new Error(`comptage profils : ${cntErr.message}`);
    progressTotal = count ?? 0;
    await supabase.from("agent_background_tasks").update({ progress_total: progressTotal }).eq("id", task.id);
    if (progressTotal === 0) {
      await completeTask(supabase, task, { scored: 0, note: "Aucun profil à scorer." });
      return;
    }
  }

  let done = task.progress_done || 0;
  let failed = task.progress_failed || 0;
  let batchesThisTick = 0;

  while (batchesThisTick < MAX_BATCHES_PER_TICK && Date.now() - startedAt < TICK_BUDGET_MS) {
    // Annulation utilisateur en cours de route → on s'arrête proprement.
    const { data: fresh } = await supabase
      .from("agent_background_tasks").select("status").eq("id", task.id).maybeSingle();
    if (fresh?.status === "canceled") {
      console.log(`[agent-tasks] task=${task.id} annulée par l'utilisateur → stop`);
      return;
    }

    // Lot suivant de profils non scorés (auto-drainant : les scorés sortent).
    const { data: rows, error: rowsErr } = await supabase
      .from("job_candidate_status")
      .select("candidate_id, candidate_name, linkedin_profile_data")
      .eq("project_id", projectId)
      .is("score", null)
      .not("linkedin_profile_data", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (rowsErr) throw new Error(`lecture profils : ${rowsErr.message}`);
    if (!rows || rows.length === 0) break; // plus rien → terminé

    const profiles = (rows as Any[]).map((r) => ({
      ...buildProfileData(r.linkedin_profile_data),
      // id stable = candidate_id (clé de réécriture job_candidate_status).
      id: r.candidate_id,
      name: buildProfileData(r.linkedin_profile_data).name || r.candidate_name || "Candidat",
    }));

    // Appel score-profile-job (persiste job_candidate_status + settle crédits).
    const resp = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/score-profile-job`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          profiles,
          job: jobPayload,
          customScoringInstructions: params.scoring_instructions || undefined,
          // Contexte de confiance (service-role) pour l'imputation crédits + org.
          organization_id: task.organization_id,
          user_id: task.created_by,
          _ai_action: "scoring",
        }),
      },
      50_000,
    );

    if (resp.status === 429) {
      // Rate limit : on relâche, le prochain tick reprendra (pas un échec dur).
      console.warn(`[agent-tasks] task=${task.id} rate-limited → re-queue`);
      break;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`score-profile-job ${resp.status}: ${body.slice(0, 300)}`);
    }
    const payload = await resp.json().catch(() => ({}));
    const results = Array.isArray(payload?.results) ? payload.results : [];
    // Progression = profils réellement traités par ce lot.
    const processedInBatch = rows.length;
    done += processedInBatch;
    // Un profil sans résultat exploitable est compté comme "échoué" (informatif).
    if (results.length < processedInBatch) failed += processedInBatch - results.length;
    batchesThisTick++;

    await supabase.from("agent_background_tasks")
      .update({ progress_done: Math.min(done, progressTotal), progress_failed: failed })
      .eq("id", task.id);
    console.log(`[agent-tasks] task=${task.id} lot ${batchesThisTick} : +${processedInBatch} (${done}/${progressTotal})`);
  }

  // Reste-t-il des profils à scorer ?
  const { count: remaining } = await supabase
    .from("job_candidate_status")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("score", null)
    .not("linkedin_profile_data", "is", null);

  if ((remaining ?? 0) > 0) {
    // Encore du travail → re-queue pour le prochain tick (pas un échec).
    await supabase.from("agent_background_tasks")
      .update({ status: "queued", locked_at: null })
      .eq("id", task.id);
    console.log(`[agent-tasks] task=${task.id} re-queue (${remaining} restants)`);
  } else {
    await completeTask(supabase, task, { scored: done, failed });
  }
}

// ─── Fin de tâche : notification + trace chat ───────────────────────────────
async function completeTask(supabase: Any, task: Any, result: Any): Promise<void> {
  const scored = result.scored ?? 0;
  await supabase.from("agent_background_tasks").update({
    status: "done",
    locked_at: null,
    finished_at: new Date().toISOString(),
    result,
  }).eq("id", task.id);

  const missionLabel = task.title || "ta mission";
  const body = scored > 0
    ? `${scored} profil${scored > 1 ? "s" : ""} scoré${scored > 1 ? "s" : ""}. Ouvre le pipeline pour voir les meilleurs.`
    : "Aucun profil à scorer.";

  // Notification cloche (canal existant, realtime).
  await supabase.from("notifications").insert({
    user_id: task.created_by,
    organization_id: task.organization_id,
    type: "success",
    title: `Scoring terminé — ${missionLabel}`,
    body,
    link: task.params?.project_id ? `/missions/${task.params.project_id}?tab=pipeline` : "/pipeline",
    metadata: { source: "agent_background_task", task_id: task.id, kind: task.kind },
  }).then(undefined, (e: Any) => console.warn("[agent-tasks] notif insert failed:", e?.message));

  // Trace dans la conversation d'origine (si le chat est ouvert, elle apparaît).
  if (task.conversation_id) {
    await supabase.from("agent_messages").insert({
      conversation_id: task.conversation_id,
      role: "assistant",
      content: `✅ Tâche de fond terminée : ${body}`,
      metadata: { agent_background_task: { task_id: task.id, status: "done", scored } },
    }).then(undefined, (e: Any) => console.warn("[agent-tasks] trace insert failed:", e?.message));
  }
  console.log(`[agent-tasks] task=${task.id} DONE scored=${scored}`);
}

// ─── Échec : retry (transient) ou abandon (fatal / trop d'échecs) ────────────
async function failTask(supabase: Any, task: Any, error: string, fatal: boolean): Promise<void> {
  const attempts = (task.attempts || 0) + 1;
  const giveUp = fatal || attempts >= MAX_ATTEMPTS;

  await supabase.from("agent_background_tasks").update({
    status: giveUp ? "error" : "queued",
    locked_at: null,
    attempts,
    last_error: error.slice(0, 1000),
    ...(giveUp ? { finished_at: new Date().toISOString() } : {}),
  }).eq("id", task.id);

  if (giveUp) {
    await supabase.from("notifications").insert({
      user_id: task.created_by,
      organization_id: task.organization_id,
      type: "error",
      title: `Tâche de fond interrompue — ${task.title || "mission"}`,
      body: "Une erreur a empêché de terminer le scoring. Réessaie ou contacte le support.",
      link: task.params?.project_id ? `/missions/${task.params.project_id}?tab=pipeline` : "/pipeline",
      metadata: { source: "agent_background_task", task_id: task.id, error: error.slice(0, 300) },
    }).then(undefined, (e: Any) => console.warn("[agent-tasks] fail notif failed:", e?.message));
    console.error(`[agent-tasks] task=${task.id} ERROR (giveUp) attempts=${attempts}: ${error}`);
  } else {
    console.warn(`[agent-tasks] task=${task.id} retry ${attempts}/${MAX_ATTEMPTS}: ${error}`);
  }
}
