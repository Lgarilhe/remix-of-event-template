// ============================================================================
// process-agent-tasks — worker des tâches de fond du copilot (P5, 2026-07-15)
// ============================================================================
// Invoqué chaque minute par cron (migration 20260715130000) avec Bearer
// PROCESS_SEQUENCES_SECRET (même pattern qu'agent-daily-digest). ⚠️ Exige
// l'entrée [functions.process-agent-tasks] verify_jwt = false dans
// supabase/config.toml : sans elle, le gateway rejette le Bearer secret du
// cron en 401 AVANT ce code (récidive du 2026-06-10, revécu au déploiement
// initial du 2026-07-15). Réclame UNE
// tâche via claim_agent_background_task() puis en traite UN morceau borné
// (timeout edge 60s → quelques lots/tick + re-tick), met à jour la progression
// (visible en realtime), et à la fin notifie l'utilisateur.
//
// v1 : kind 'score_mission_profiles' — score les profils sourcés NON scorés
// d'une mission. Auto-drainant : score-profile-job écrit job_candidate_status
// .score pour chaque profil traité → la requête "score IS NULL" rétrécit.
//
// Invariants durcis (review adversariale 2026-07-15, 11 findings) :
//  - TOUTES les requêtes profils sont scopées (project_id, job_id) — le même
//    couple que score-profile-job utilise pour ÉCRIRE. Sinon des lignes
//    sélectionnées mais jamais écrites bouclent à l'infini.
//  - Progression mesurée par le DRAIN réel (remaining avant/après), pas par
//    les envois : un profil envoyé mais non persisté compte en "failed".
//  - Anti-boucle : un tick avec ≥1 lot envoyé mais AUCUN drain = stall →
//    attempts++ ; au bout de MAX_ATTEMPTS sans progrès → fin partielle
//    honnête (ou erreur si rien n'a jamais été scoré). Un tick AVEC progrès
//    remet attempts à 0 (une tâche longue légitime n'est jamais tuée).
//  - Toute écriture de statut du worker est gardée par .eq('status','running')
//    → une annulation utilisateur concurrente gagne TOUJOURS (jamais
//    ressuscitée en 'queued'/'done', jamais de fausse notification).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { buildProfileData, buildJobFromBrief } from "../_shared/profile-data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Any = any;

// ─── Bornage par tick (rester sous la limite edge ~150s wall-clock) ─────────
// Leçons prod 2026-07-15 (1er scoring réel, deux incidents successifs) :
// 1. Un lot de 10 profils prend souvent >100s côté LLM (batch Haiku +
//    escalation Sonnet des borderline + couches sémantiques).
// 2. ⚠️ Quand le client coupe (timeout), le runtime edge TUE score-profile-job
//    en plein travail : RIEN n'est persisté (les seules écritures qui
//    survivent sont les KO hard-filter, écrits tôt au fil de l'eau). Un lot
//    interrompu = crédit temps perdu, PAS un lot « qui finira tout seul ».
// D'où : lots de 5 profils (≈35-70s, tiennent dans le délai), réduits à 3 en
// mode rattrapage (attempts>0), timeout client 120s, et on ne DÉMARRE un lot
// que dans les 20 premières secondes du tick (pire cas ≈ 140s < 150s).
// 3. Un profil « toxique » (données qui font planter le moteur de scoring →
//    500) en tête de file bloque TOUTE la file (elle reprend toujours au même
//    endroit). Isolation automatique : lots dégressifs 5 → 3 → 1 selon
//    attempts ; un échec sur un lot d'UN SEUL profil met ce profil de côté
//    (result.skip_candidate_ids, compté en progress_failed) et la file avance.
const BATCH_SIZE = 5;               // profils par appel scoring (10 = trop long, tué)
const RETRY_BATCH_SIZE = 3;         // après 1-2 cycles sans progrès
const ISOLATE_BATCH_SIZE = 1;       // après 3+ cycles : isoler le profil fautif
const MAX_SKIPPED = 50;             // garde-fou : au-delà, un vrai souci systémique
const MAX_BATCHES_PER_TICK = 3;     // plafond dur (rarement atteint avec le budget)
const BATCH_START_BUDGET_MS = 20_000;  // ne pas DÉMARRER de lot au-delà
const BATCH_TIMEOUT_MS = 120_000;   // durée max d'UN lot côté client
const MAX_ATTEMPTS = 5;             // cycles consécutifs SANS progrès avant abandon

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

  console.log(`[agent-tasks] claimed task=${task.id} kind=${task.kind} done=${task.progress_done}/${task.progress_total} attempts=${task.attempts}`);

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

// ─── Update de statut gardé : n'écrase JAMAIS une annulation concurrente ────
// Renvoie true si la ligne était encore 'running' (write appliqué), false si
// le statut a changé sous nos pieds (ex. user → 'canceled') : on n'y touche pas.
async function guardedStatusUpdate(supabase: Any, taskId: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data } = await supabase
    .from("agent_background_tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("status", "running")
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

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
  // job_candidate_status : score-profile-job écrit par (candidate_id, job_id).
  // TOUTES les requêtes de ce worker sont ensuite scopées sur CE job_id — on
  // ne sélectionne jamais une ligne qu'on ne saurait pas mettre à jour (sinon
  // elle resterait score IS NULL pour toujours → boucle infinie).
  const { data: sampleRow } = await supabase
    .from("job_candidate_status")
    .select("job_id")
    .eq("project_id", projectId)
    .not("job_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const jobId = sampleRow?.job_id || `project:${projectId}`;

  // Profils mis de côté (toxiques : le moteur de scoring 500 dessus, isolés
  // par lot de 1). Persistés dans result.skip_candidate_ids pour survivre aux
  // re-ticks. Exclus du scope de drain → la file avance malgré eux.
  const skippedIds: string[] = Array.isArray((task.result as Any)?.skip_candidate_ids)
    ? [...(task.result as Any).skip_candidate_ids]
    : [];
  const skipFilter = () =>
    skippedIds.length > 0 ? `(${skippedIds.map((id) => `"${String(id).replace(/"/g, "")}"`).join(",")})` : null;

  // Compteur "restants" — le scope EXACT du travail de cette tâche.
  const countRemaining = async (): Promise<number> => {
    let q = supabase
      .from("job_candidate_status")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("job_id", jobId)
      .is("score", null)
      .not("linkedin_profile_data", "is", null);
    const sf = skipFilter();
    if (sf) q = q.not("candidate_id", "in", sf);
    const { count, error } = await q;
    if (error) throw new Error(`comptage profils : ${error.message}`);
    return count ?? 0;
  };

  // Concurrents du client — même signal que le scoring premier plan
  // (useLinkedInSearch::enabledCompetitors). Fail-soft : bonus, jamais bloquant.
  let clientCompetitors: Any[] | undefined;
  let restrictSearchToCompetitors = false;
  try {
    const clientName = (jd?.client?.name || project.client_name || "").toLowerCase().trim();
    if (clientName) {
      const { data: comps } = await supabase
        .from("client_competitors")
        .select("competitor_name, relation_kind, country, domain, linkedin_company_id, enabled")
        .eq("organization_id", task.organization_id)
        .eq("client_company_name_normalized", clientName);
      const enabled = ((comps as Any[]) || []).filter((c) => c.enabled);
      if (enabled.length > 0) {
        clientCompetitors = enabled.slice(0, 20).map((c) => ({
          name: c.competitor_name,
          relationKind: c.relation_kind,
          country: c.country,
          domain: c.domain,
          linkedinCompanyId: c.linkedin_company_id,
        }));
        restrictSearchToCompetitors = !!jd?.restrict_search_to_competitors;
      }
    }
  } catch (e) {
    console.warn("[agent-tasks] client_competitors skipped:", e instanceof Error ? e.message : e);
  }

  const jobPayload = {
    ...buildJobFromBrief(jd, {
      id: jobId,
      title: jd.title || project.name || "Mission sans titre",
      client: project.client_name ? { name: project.client_name, sector: jd.client?.sector } : undefined,
    }),
    ...(clientCompetitors ? { clientCompetitors, restrictSearchToCompetitors } : {}),
  };

  // Référence de progression : le « restant » mesuré au TOUT PREMIER tick,
  // figé dans result.initial_remaining (le tool insère un total project-wide
  // potentiellement plus large que le scope réel (project_id, job_id)).
  // done = initial - remaining : reste juste même quand un lot a été coupé
  // côté client (timeout) mais a abouti côté serveur — le drain « en retard »
  // est automatiquement compté au tick suivant.
  let remaining = await countRemaining();
  let initialRemaining = Number((task.result as Any)?.initial_remaining ?? NaN);
  if (!Number.isFinite(initialRemaining)) {
    initialRemaining = remaining;
    await guardedStatusUpdate(supabase, task.id, {
      progress_total: initialRemaining,
      result: { initial_remaining: initialRemaining },
    });
    if (remaining === 0) {
      await completeTask(supabase, task, { scored: 0, note: "Aucun profil à scorer." });
      return;
    }
  }
  const progressTotal = initialRemaining;

  let done = Math.max(0, initialRemaining - remaining);
  let failed = task.progress_failed || 0;
  let batchesThisTick = 0;
  let lastBatchError: string | null = null;
  // Drain arrivé ENTRE les ticks (lot du tick précédent terminé après coupure) :
  // c'est du progrès, il doit remettre le compteur de stall à zéro.
  const progressedSinceLastTick = done > (task.progress_done || 0);
  if (progressedSinceLastTick) {
    await guardedStatusUpdate(supabase, task.id, { progress_done: Math.min(done, progressTotal) });
  }

  while (batchesThisTick < MAX_BATCHES_PER_TICK && remaining > 0 && Date.now() - startedAt < BATCH_START_BUDGET_MS) {
    // Annulation utilisateur en cours de route → on s'arrête proprement.
    const { data: fresh } = await supabase
      .from("agent_background_tasks").select("status").eq("id", task.id).maybeSingle();
    if (fresh?.status !== "running") {
      console.log(`[agent-tasks] task=${task.id} statut=${fresh?.status} (annulée ?) → stop`);
      return;
    }

    // Lot suivant de profils non scorés — MÊME scope que countRemaining.
    // Taille dégressive en rattrapage : cycle(s) sans progrès → lots plus
    // courts (timeout) puis lot de 1 (isolement d'un profil toxique).
    const attemptsSoFar = task.attempts || 0;
    const batchSize = attemptsSoFar >= 3 ? ISOLATE_BATCH_SIZE : attemptsSoFar > 0 ? RETRY_BATCH_SIZE : BATCH_SIZE;
    let batchQuery = supabase
      .from("job_candidate_status")
      .select("candidate_id, candidate_name, linkedin_profile_data")
      .eq("project_id", projectId)
      .eq("job_id", jobId)
      .is("score", null)
      .not("linkedin_profile_data", "is", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);
    const sf = skipFilter();
    if (sf) batchQuery = batchQuery.not("candidate_id", "in", sf);
    const { data: rows, error: rowsErr } = await batchQuery;
    if (rowsErr) throw new Error(`lecture profils : ${rowsErr.message}`);
    if (!rows || rows.length === 0) break; // plus rien → terminé

    const profiles = (rows as Any[]).map((r) => {
      const pd = buildProfileData(r.linkedin_profile_data);
      return {
        ...pd,
        // id stable = candidate_id (clé de réécriture job_candidate_status).
        id: r.candidate_id,
        name: pd.name || r.candidate_name || "Candidat",
      };
    });

    // Appel score-profile-job (persiste job_candidate_status + settle crédits).
    // ⚠️ Un timeout client TUE le travail côté serveur (rien n'est persisté,
    // constaté en prod) : on clôt le tick sans throw, le garde anti-stall
    // (attempts + lots réduits) prend le relais au cycle suivant.
    let resp: Response;
    try {
      resp = await fetchWithTimeout(
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
        BATCH_TIMEOUT_MS,
      );
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
      if (!aborted) throw e;
      console.warn(`[agent-tasks] task=${task.id} lot ${batchesThisTick + 1} : délai client dépassé — le scoring continue côté serveur, drain compté au prochain tick`);
      batchesThisTick++;
      break;
    }

    if (resp.status === 429) {
      // Rate limit : on sort du tick. Si RIEN n'a drainé sur ce tick, le bloc
      // final route en stall (attempts++) → un 429 permanent (crédits épuisés)
      // finit par s'arrêter au lieu de retenter chaque minute pour toujours.
      console.warn(`[agent-tasks] task=${task.id} rate-limited → fin de tick`);
      batchesThisTick++;
      break;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const errInfo = `scoring ${resp.status}: ${body.slice(0, 200)}`;
      batchesThisTick++;
      if (rows.length === 1) {
        // Lot d'UN profil en échec → profil toxique identifié : on le met de
        // côté définitivement pour CETTE tâche et la file avance. Compté en
        // "failed" (l'utilisateur voit « X n'ont pas pu être traités »).
        skippedIds.push(rows[0].candidate_id);
        failed += 1;
        await guardedStatusUpdate(supabase, task.id, {
          progress_failed: failed,
          result: { initial_remaining: initialRemaining, skip_candidate_ids: skippedIds },
        });
        console.warn(`[agent-tasks] task=${task.id} profil isolé (${errInfo}) — ${skippedIds.length} mis de côté, la file continue`);
        if (skippedIds.length >= MAX_SKIPPED) {
          await failTask(supabase, task, `Trop de profils en échec de scoring (${skippedIds.length}) — problème systémique probable. Dernière erreur : ${errInfo}`, true);
          return;
        }
        lastBatchError = null;
        remaining = await countRemaining(); // le skip sort du scope → recompte
        done = Math.max(0, initialRemaining - remaining);
        continue; // le profil isolé est hors scope → le prochain select avance
      }
      // Lot multi-profils en échec : fin de tick. Le garde anti-stall réduit
      // la taille des lots aux cycles suivants (5 → 3 → 1) jusqu'à isoler.
      lastBatchError = errInfo;
      console.warn(`[agent-tasks] task=${task.id} lot de ${rows.length} en échec (${errInfo}) → fin de tick, lots réduits au prochain cycle`);
      break;
    }
    await resp.json().catch(() => ({}));
    batchesThisTick++;

    // Progression = drain RÉEL (lignes passées de score NULL → non-NULL).
    // Un profil envoyé mais non persisté (échec LLM, ligne non réécrite)
    // compte en "failed" — et surtout ne compte PAS comme progrès.
    const remainingAfter = await countRemaining();
    const drained = Math.max(0, remaining - remainingAfter);
    done = Math.max(0, initialRemaining - remainingAfter);
    failed += Math.max(0, rows.length - drained);
    remaining = remainingAfter;

    await guardedStatusUpdate(supabase, task.id, {
      progress_done: Math.min(done, progressTotal),
      progress_failed: failed,
    });
    console.log(`[agent-tasks] task=${task.id} lot ${batchesThisTick} : ${drained}/${rows.length} drainés (${done}/${progressTotal}, reste ${remaining})`);

    // Si ce lot n'a RIEN drainé, re-sélectionner immédiatement les mêmes
    // lignes bloquées ne fera que re-payer du LLM pour rien → fin de tick.
    if (drained === 0) break;
  }

  if (remaining === 0) {
    // done inclut les profils mis de côté (sortis du scope) — le récap les
    // décompte et les affiche comme « non traités ».
    await completeTask(supabase, task, {
      scored: Math.max(0, done - failed),
      failed,
      ...(failed > 0 ? { stuck: failed } : {}),
      ...(skippedIds.length > 0 ? { skip_candidate_ids: skippedIds } : {}),
      initial_remaining: initialRemaining,
    });
    return;
  }

  // Progrès de CE cycle = done a augmenté depuis la valeur stockée avant le
  // tick — couvre le drain observé PENDANT le tick ET le drain arrivé ENTRE
  // les ticks (lot du tick précédent terminé côté serveur après la coupure).
  const progressedThisCycle = done > (task.progress_done || 0);

  if (!progressedThisCycle && batchesThisTick > 0) {
    // STALL : du travail envoyé, aucun progrès constaté. attempts++ ; au bout
    // de MAX_ATTEMPTS cycles consécutifs sans progrès → fin honnête.
    const attempts = (task.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      if (done > 0) {
        // Fin partielle : une partie scorée, le reste non-drainable.
        await completeTask(supabase, task, { initial_remaining: initialRemaining, scored: done, failed, stuck: remaining, partial: true });
      } else {
        await failTask(supabase, task, `Aucun profil n'a pu être scoré (${remaining} restants non traitables)`, true);
      }
      return;
    }
    const okStall = await guardedStatusUpdate(supabase, task.id, {
      status: "queued",
      locked_at: null,
      attempts,
      last_error: lastBatchError
        ? `Cycle sans progression — ${lastBatchError}`
        : `Cycle sans progression (${remaining} profils non drainés)`,
    });
    if (okStall) console.warn(`[agent-tasks] task=${task.id} stall ${attempts}/${MAX_ATTEMPTS} → re-queue`);
    return;
  }

  // Encore du travail, et ce cycle a progressé (ou n'a rien envoyé : budget
  // temps épuisé avant le 1er lot) → re-queue. Le progrès remet attempts à 0 :
  // une tâche longue légitime n'est jamais tuée par le gate.
  const ok = await guardedStatusUpdate(supabase, task.id, {
    status: "queued",
    locked_at: null,
    ...(progressedThisCycle ? { attempts: 0, last_error: null } : {}),
  });
  if (ok) console.log(`[agent-tasks] task=${task.id} re-queue (${remaining} restants)`);
  else console.log(`[agent-tasks] task=${task.id} statut modifié pendant le tick (annulée ?) — pas de re-queue`);
}

// ─── Fin de tâche : notification + trace chat ───────────────────────────────
// Gardé par status='running' : si l'utilisateur a annulé entre-temps, on ne
// marque PAS 'done' et on n'émet AUCUNE notification.
async function completeTask(supabase: Any, task: Any, result: Any): Promise<void> {
  const scored = result.scored ?? 0;
  const stuck = result.stuck ?? 0;
  const ok = await guardedStatusUpdate(supabase, task.id, {
    status: "done",
    locked_at: null,
    finished_at: new Date().toISOString(),
    result,
  });
  if (!ok) {
    console.log(`[agent-tasks] task=${task.id} annulée avant la clôture — pas de notification`);
    return;
  }

  const missionLabel = task.title || "ta mission";
  const body = scored > 0
    ? `${scored} profil${scored > 1 ? "s" : ""} scoré${scored > 1 ? "s" : ""}${stuck > 0 ? ` (${stuck} n'ont pas pu être traités)` : ""}. Ouvre le pipeline pour voir les meilleurs.`
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
      metadata: { agent_background_task: { task_id: task.id, status: "done", scored, stuck } },
    }).then(undefined, (e: Any) => console.warn("[agent-tasks] trace insert failed:", e?.message));
  }
  console.log(`[agent-tasks] task=${task.id} DONE scored=${scored} stuck=${stuck}`);
}

// ─── Échec : retry (transient) ou abandon (fatal / trop d'échecs) ────────────
// Gardé par status='running' lui aussi : une annulation concurrente gagne.
async function failTask(supabase: Any, task: Any, error: string, fatal: boolean): Promise<void> {
  const attempts = (task.attempts || 0) + 1;
  const giveUp = fatal || attempts >= MAX_ATTEMPTS;

  const ok = await guardedStatusUpdate(supabase, task.id, {
    status: giveUp ? "error" : "queued",
    locked_at: null,
    attempts,
    last_error: error.slice(0, 1000),
    ...(giveUp ? { finished_at: new Date().toISOString() } : {}),
  });
  if (!ok) {
    console.log(`[agent-tasks] task=${task.id} statut modifié pendant le tick — échec non enregistré (annulée ?)`);
    return;
  }

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
