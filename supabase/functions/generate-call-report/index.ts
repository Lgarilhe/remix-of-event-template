// Deno.serve used directly
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit: 10 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'generate_call_report', p_max_requests: 10, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const {
      session_id,
      full_transcript,
      criteria_with_scores,
      job_context,
      candidate_name,
      job_title,
      call_duration_seconds,
      alerts_log,
    } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: `Tu es un expert recrutement senior. Tu rédiges des comptes-rendus d'entretien factuels et actionnables.
Phrases courtes. Pas de jargon. Cite des verbatims entre guillemets.
Pas de "en conclusion", pas de "en résumé".`,
          messages: [
            {
              role: "user",
              content: `CANDIDAT : ${candidate_name}
POSTE : ${job_title}
DURÉE : ${Math.round((call_duration_seconds || 0) / 60)} minutes

FICHE DE POSTE : ${job_context}

TRANSCRIPTION : ${full_transcript}

CRITÈRES ÉVALUÉS : ${JSON.stringify(criteria_with_scores)}

ALERTES DÉTECTÉES : ${JSON.stringify(alerts_log)}

Retourne UNIQUEMENT ce JSON :
{
  "summary": "Synthèse executive 4 lignes max",
  "criteria_evaluation": [
    {"name": "...", "score": 4, "comment": "...", "verbatim": "..."}
  ],
  "strengths": ["..."],
  "red_flags": ["..."],
  "open_questions": ["..."],
  "recommendation": "GO|NO_GO|A_CREUSER",
  "recommendation_reason": "1 phrase",
  "follow_up_message": "Message candidat 4-5 lignes"
}`,
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const claudeRes = await response.json();
    const text = claudeRes.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let report = null;
    if (jsonMatch) {
      try {
        report = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error("generate-call-report JSON parse error:", e, "Raw:", jsonMatch[0].slice(0, 200));
      }
    }

    // Save report to session
    if (session_id && report) {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      await supabase
        .from("call_coaching_sessions")
        .update({
          report,
          status: "report_generated",
          transcript: full_transcript,
          duration_seconds: call_duration_seconds,
        })
        .eq("id", session_id);

      // ── Fire-and-forget RAG ingestion (call report) ──
      if (report && session_id) {
        // Get session details to find candidate and org
        const { data: session } = await supabase
          .from("call_coaching_sessions")
          .select("candidate_id, organization_id")
          .eq("id", session_id)
          .maybeSingle();

        if (session?.candidate_id && session?.organization_id) {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          fetch(`${supabaseUrl}/functions/v1/ingest-context`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              organization_id: session.organization_id,
              entity_type: 'candidate',
              entity_id: session.candidate_id,
              chunks: [{
                chunk_type: 'evaluation',
                content: `Rapport d'appel: ${report.summary || ''}\nRecommandation: ${report.recommendation || ''} — ${report.recommendation_reason || ''}`,
                source_table: 'call_coaching_sessions',
                source_id: session_id,
                metadata: { candidate_name, job_title, recommendation: report.recommendation, date: new Date().toISOString() },
              }],
            }),
          }).catch(err => console.warn('[generate-call-report] RAG ingest failed (non-blocking):', err));
        }
      }
    }

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-call-report error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
