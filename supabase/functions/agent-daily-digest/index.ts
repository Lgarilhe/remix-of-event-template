// ============================================================================
// agent-daily-digest — agent proactif : digest matinal par organisation (P2.3)
// ============================================================================
// Appelé par cron (migration 20260714121000) chaque matin de semaine, avec
// Bearer PROCESS_SEQUENCES_SECRET (même pattern que process-scheduled-actions).
//
// Pour chaque org OPT-IN (agent_tool_policies : tool_name='daily_digest',
// policy='auto'), génère une conversation Copilot « Digest du {date} » avec :
//   - missions actives (+ compteurs pipeline)
//   - entretiens des prochaines 24h
//   - actions IA en attente d'approbation
// Texte DÉTERMINISTE (aucun appel LLM : zéro coût, zéro hallucination).
// Idempotent : une seule conversation digest par org et par jour.
//
// P0-D : le même contenu part aussi par email au destinataire (owner, sinon
// premier admin) via send-transactional-email (template 'daily-digest',
// idempotencyKey par org et par jour), et une notification type 'digest'
// est insérée pour lui. Un échec d'envoi est loggé, jamais bloquant.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ORGS_PER_RUN = 50;
const APP_URL = (Deno.env.get("APP_URL") || "https://konekt-app-navy.vercel.app").replace(/\/+$/, "");

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const frDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
// « JJ/MM » pour le titre de la notification
const frShortDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" });
// « AAAA-MM-JJ » (heure de Paris) pour la clé d'idempotence de l'email
const parisIsoDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const frTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

interface DigestMission { label: string; client?: string; found: number; messaged: number; shortlisted: number }
interface DigestInterview { time: string; candidateName: string; jobTitle?: string; eventName?: string }
interface DigestAction { summary: string }

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
  const runDate = new Date();
  const today = frDate(runDate);
  const todayShort = frShortDate(runDate);
  const todayIso = parisIsoDate(runDate);
  const digestTitle = `Digest du ${today}`;

  // ===== Orgs opt-in =====
  const { data: optIns, error: optErr } = await supabase
    .from("agent_tool_policies")
    .select("organization_id")
    .eq("tool_name", "daily_digest")
    .eq("policy", "auto")
    .limit(MAX_ORGS_PER_RUN);
  if (optErr) {
    return new Response(JSON.stringify({ error: optErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ org: string; status: string; email?: string }> = [];

  for (const { organization_id: orgId } of (optIns ?? []) as Array<{ organization_id: string }>) {
    try {
      // Idempotence : déjà un digest aujourd'hui → skip
      const { data: existing } = await supabase
        .from("agent_conversations")
        .select("id")
        .eq("organization_id", orgId)
        .eq("title", digestTitle)
        .limit(1)
        .maybeSingle();
      if (existing) { results.push({ org: orgId, status: "already_sent" }); continue; }

      // Destinataire : owner (sinon admin) de l'org
      const { data: members } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", orgId)
        .in("role", ["owner", "admin"])
        .limit(10);
      const recipient =
        (members ?? []).find((m: { role: string }) => m.role === "owner")?.user_id ??
        (members ?? [])[0]?.user_id;
      if (!recipient) { results.push({ org: orgId, status: "no_recipient" }); continue; }

      // ── Données du digest (requêtes parallèles, toutes fail-soft) ──
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 3600_000);
      const [missionsRes, interviewsRes, pendingRes, orgRes] = await Promise.all([
        supabase
          .from("sourcing_projects")
          .select("id, name, job_title, client_name, stats_total_found, stats_messaged, stats_shortlisted")
          .eq("organization_id", orgId)
          .eq("kind", "mission")
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(8),
        supabase
          .from("qualification_sessions")
          .select("candidate_name, event_name, event_start_at, job_title")
          .eq("organization_id", orgId)
          .eq("status", "scheduled")
          .gte("event_start_at", now.toISOString())
          .lte("event_start_at", in24h.toISOString())
          .order("event_start_at", { ascending: true })
          .limit(10),
        supabase
          .from("agent_tool_executions")
          .select("tool_name, dry_run_result, proposed_at")
          .eq("organization_id", orgId)
          .eq("status", "proposed")
          .gte("proposed_at", new Date(now.getTime() - 7 * 864e5).toISOString())
          .order("proposed_at", { ascending: false })
          .limit(10),
        supabase
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle(),
      ]);

      const missions = (missionsRes.data ?? []) as Array<Record<string, unknown>>;
      const interviews = (interviewsRes.data ?? []) as Array<Record<string, unknown>>;
      const pending = (pendingRes.data ?? []) as Array<Record<string, unknown>>;
      const organizationName = ((orgRes.data as { name?: string } | null)?.name || "").trim();

      // Même contenu, structuré pour le template email 'daily-digest'
      const emailMissions: DigestMission[] = [];
      const emailInterviews: DigestInterview[] = [];
      const emailActions: DigestAction[] = [];

      // ── Rédaction déterministe ──
      const lines: string[] = [`☀️ **${digestTitle}**`, ""];

      lines.push(`**Missions actives (${missions.length})**`);
      if (missions.length === 0) {
        lines.push("Aucune mission active. Dis-moi « crée une mission » pour en lancer une.");
      } else {
        for (const m of missions.slice(0, 5)) {
          const label = (m.name as string) || (m.job_title as string) || "Mission";
          const client = m.client_name ? ` — ${m.client_name}` : "";
          const found = Number(m.stats_total_found) || 0;
          const messaged = Number(m.stats_messaged) || 0;
          const shortlisted = Number(m.stats_shortlisted) || 0;
          lines.push(`- **${label}**${client} : ${found} sourcés, ${messaged} contactés, ${shortlisted} shortlistés`);
          emailMissions.push({ label, client: (m.client_name as string) || undefined, found, messaged, shortlisted });
        }
        if (missions.length > 5) lines.push(`- … et ${missions.length - 5} autre(s)`);
      }
      lines.push("");

      lines.push(`**Entretiens dans les prochaines 24h (${interviews.length})**`);
      if (interviews.length === 0) {
        lines.push("Aucun entretien programmé.");
      } else {
        for (const it of interviews) {
          lines.push(`- ${frTime(String(it.event_start_at))} — **${it.candidate_name || "?"}**${it.job_title ? ` (${it.job_title})` : ""}${it.event_name ? ` · ${it.event_name}` : ""}`);
          emailInterviews.push({
            time: frTime(String(it.event_start_at)),
            candidateName: (it.candidate_name as string) || "Candidat",
            jobTitle: (it.job_title as string) || undefined,
            eventName: (it.event_name as string) || undefined,
          });
        }
      }
      lines.push("");

      lines.push(`**Actions IA en attente d'approbation (${pending.length})**`);
      if (pending.length === 0) {
        lines.push("Rien en attente.");
      } else {
        for (const p of pending.slice(0, 5)) {
          const summary = (p.dry_run_result as Record<string, unknown> | null)?.summary;
          lines.push(`- ${summary || p.tool_name}`);
          emailActions.push({ summary: String(summary || p.tool_name || "Action à valider") });
        }
        if (pending.length > 5) lines.push(`- … et ${pending.length - 5} autre(s)`);
        lines.push("→ À valider dans Réglages → Actions de l'agent, ou depuis le chat.");
      }
      lines.push("");
      lines.push("Pose-moi une question pour creuser un point (« où en est la mission X ? », « qui m'a répondu ? »).");

      // ── Conversation + message ──
      const { data: conv, error: convErr } = await supabase
        .from("agent_conversations")
        .insert({
          organization_id: orgId,
          created_by: recipient,
          title: digestTitle,
          status: "completed",
        })
        .select("id")
        .single();
      if (convErr || !conv) throw new Error(convErr?.message || "conversation insert failed");

      const { error: msgErr } = await supabase.from("agent_messages").insert({
        conversation_id: conv.id,
        role: "assistant",
        content: lines.join("\n"),
        metadata: { daily_digest: true },
      });
      if (msgErr) throw new Error(msgErr.message);

      // ── Email au destinataire (owner, sinon admin) : fail-soft ──
      // send-transactional-email accepte la service-role (Bearer + apikey), rend
      // le template et met en file ; la clé d'idempotence est par org et par jour.
      let emailStatus = "failed";
      try {
        const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(recipient);
        const recipientEmail: string | undefined = userData?.user?.email || undefined;
        if (userErr || !recipientEmail) {
          emailStatus = "no_email";
          console.warn(`[agent-daily-digest] org ${orgId}: destinataire ${recipient} sans email`, userErr?.message ?? "");
        } else {
          const emailResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/send-transactional-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
              apikey: serviceRoleKey,
            },
            body: JSON.stringify({
              templateName: "daily-digest",
              recipientEmail,
              idempotencyKey: `daily-digest-${orgId}-${todayIso}`,
              templateData: {
                dateLabel: today,
                organizationName,
                missions: emailMissions,
                missionsTotal: missions.length,
                interviews: emailInterviews,
                actions: emailActions,
                actionsTotal: pending.length,
                appUrl: `${APP_URL}/dashboard`,
                settingsUrl: `${APP_URL}/settings?tab=agent-actions`,
              },
            }),
          });
          const payload = await emailResponse.json().catch(() => null) as
            { success?: boolean; reason?: string; error?: string; details?: string } | null;
          if (!emailResponse.ok) {
            emailStatus = "failed";
            console.error(`[agent-daily-digest] org ${orgId}: email refusé (${emailResponse.status})`, payload?.error, payload?.details);
          } else if (payload?.success) {
            emailStatus = "queued";
          } else {
            emailStatus = payload?.reason || "not_sent";
            console.warn(`[agent-daily-digest] org ${orgId}: email non envoyé (${emailStatus})`);
          }
        }
      } catch (emailErr) {
        emailStatus = "failed";
        console.error(`[agent-daily-digest] org ${orgId}: envoi email échoué:`, emailErr);
      }

      // ── Notification cloche pour le destinataire (fail-soft) ──
      const summaryBody =
        `${plural(missions.length, "mission active", "missions actives")}, ` +
        `${plural(interviews.length, "entretien", "entretiens")} dans les 24 h, ` +
        `${plural(pending.length, "action IA en attente", "actions IA en attente")}.`;
      const { error: notifErr } = await supabase.from("notifications").insert({
        user_id: recipient,
        organization_id: orgId,
        type: "digest",
        title: `Digest du ${todayShort}`,
        body: summaryBody,
        link: "/dashboard",
        metadata: { source: "agent_daily_digest", conversation_id: conv.id, date: todayIso, email: emailStatus },
      });
      if (notifErr) console.warn(`[agent-daily-digest] org ${orgId}: notification non insérée:`, notifErr.message);

      results.push({ org: orgId, status: "sent", email: emailStatus });
    } catch (e) {
      console.error(`[agent-daily-digest] org ${orgId} failed:`, e);
      results.push({ org: orgId, status: `error: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }

  return new Response(
    JSON.stringify({ success: true, date: today, processed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
