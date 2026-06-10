import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HAS_AI_KEY = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await svc.rpc('check_rate_limit', {
      p_user_id: userId,
      p_action: 'process_debrief',
      p_max_requests: 20,
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }

    if (!HAS_AI_KEY) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const { transcript, candidate_name, job_title, current_stage, criteria } = await req.json();

    if (!transcript || transcript.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: "Transcript too short" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const systemPrompt = `Tu es un assistant IA expert en recrutement. Analyse le debrief post-entretien et extrais un verdict structuré.

Candidat : ${candidate_name || 'N/A'}
Poste : ${job_title || 'N/A'}
Étape actuelle : ${current_stage || 'N/A'}
${criteria ? `Critères d'évaluation : ${JSON.stringify(criteria)}` : ''}

Analyse le transcript/debrief et retourne un JSON avec :
- verdict: "go" (avancer le candidat), "no_go" (écarter), ou "maybe" (à revoir)
- summary: résumé en 2-3 phrases
- strengths: array de 2-3 points forts identifiés
- concerns: array de 2-3 points de vigilance
- next_steps: prochaine action recommandée
- suggested_stage: l'étape suivante suggérée si verdict = go
- follow_up_message: message de suivi suggéré pour le candidat

Réponds UNIQUEMENT en JSON valide.`;

    let content = "";
    try {
      const aiResult = await callClaudeCompat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        timeoutMs: 30000,
      });
      content = aiResult.content;
      await settleClaudeUsage({ userId, aiAction: "debrief", usage: aiResult.usage, modelId: aiResult.model });
    } catch (e) {
      console.error("[process-debrief] Claude error:", e);
      throw new Error("Debrief analysis timeout or network error");
    }

    // Parse JSON from response
    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : {
        verdict: "maybe",
        summary: content,
        strengths: [],
        concerns: [],
        next_steps: "À déterminer",
      };
    } catch {
      result = {
        verdict: "maybe",
        summary: content,
        strengths: [],
        concerns: [],
        next_steps: "À déterminer",
      };
    }

    // Store debrief in DB
    try {
      const orgId = await getOrgId(svc, userId);
      if (orgId) {
        await svc.from('candidate_notes').insert({
          candidate_id: transcript.candidate_id || candidate_name,
          content: `[Debrief IA] Verdict: ${result.verdict}\n${result.summary}\nForces: ${(result.strengths || []).join(', ')}\nVigilance: ${(result.concerns || []).join(', ')}`,
          created_by: userId,
          organization_id: orgId,
        });
      }
    } catch (e) {
      console.warn("Failed to store debrief note:", e);
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("process-debrief error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getOrgId(svc: any, userId: string): Promise<string | null> {
  const { data } = await svc.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle();
  return data?.active_organization_id || null;
}
