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
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ORGS_PER_RUN = 50;

const frDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
const frTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

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

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
  const today = frDate(new Date());
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

  const results: Array<{ org: string; status: string }> = [];

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
      const [missionsRes, interviewsRes, pendingRes] = await Promise.all([
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
      ]);

      const missions = (missionsRes.data ?? []) as Array<Record<string, unknown>>;
      const interviews = (interviewsRes.data ?? []) as Array<Record<string, unknown>>;
      const pending = (pendingRes.data ?? []) as Array<Record<string, unknown>>;

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

      results.push({ org: orgId, status: "sent" });
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
