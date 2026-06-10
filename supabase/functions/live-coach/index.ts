// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/require-auth.ts";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";
import { loadAndBuildAiContext } from "../_shared/ai-context.ts";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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

    // Rate limit: 30 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'live_coach', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();

    if (!Deno.env.get("ANTHROPIC_API_KEY")) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load AI context (Settings → Contexte IA) — resolves user's active org
    let liveCoachOrgId: string | null = null;
    if (userId) {
      const { data: prof } = await svc.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle();
      liveCoachOrgId = (prof?.active_organization_id as string) || null;
    }
    const aiContext = await loadAndBuildAiContext(svc, { userId, orgId: liveCoachOrgId });

    // === INTRO GENERATION MODE ===
    if (body.action === 'generate_intro') {
      const { candidate_name, candidate_headline, candidate_profile_summary, job_title, job_context, criteria } = body;
      
      const introPrompt = `Tu es un coach de recrutement. Génère des bullet-points pour l'intro d'appel.

CANDIDAT : ${candidate_name}
HEADLINE : ${candidate_headline || 'N/A'}
POSTE : ${job_title}

Retourne EXACTEMENT 3 bullet-points ultra-courts (max 8 mots chacun) :
1. Accroche perso (basée sur le parcours du candidat)
2. Pourquoi on appelle (le poste, 5 mots max)
3. Question d'ouverture

Format : juste les 3 lignes avec "•" devant, rien d'autre. Pas de phrase complète, pas de guillemets.`;

      try {
        const result = await callClaudeCompat({
          messages: [{ role: "user", content: introPrompt }],
          max_tokens: 150,
          timeoutMs: 15000,
          aiContext,
        });
        const intro = result.content.trim() || null;
        await settleClaudeUsage({ userId, aiAction: "live_coaching", usage: result.usage, modelId: result.model });
        return new Response(JSON.stringify({ intro }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("Intro AI error:", e);
        return new Response(JSON.stringify({ intro: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // === NORMAL COACHING MODE ===
    const {
      session_id,
      full_transcript,
      latest_chunk,
      criteria,
      job_context,
      elapsed_seconds,
      pending_signals,
    } = body;

    // Truncate transcript to last ~2000 chars for speed
    const truncatedTranscript = full_transcript.length > 2000
      ? '...' + full_transcript.slice(-2000)
      : full_transcript;

    const pendingSignalsContext = pending_signals?.length
      ? `\nSIGNAUX EN ATTENTE (questions suggérées précédemment, pas encore traitées) :\n${JSON.stringify(pending_signals)}\n\nPour chaque signal en attente, vérifie dans la transcription si la question a été posée ET si le candidat y a répondu. Si oui, ajoute le signal exact dans "resolved_signals". Ne propose PAS de nouveaux signaux sur le même sujet qu'un signal en attente non résolu.`
      : '';

    const systemPrompt = `Tu es un coach de recrutement senior en temps réel.
Tu analyses un entretien en cours et tu GUIDES PROACTIVEMENT le recruteur.

CONTEXTE DU POSTE :
${job_context}

CRITÈRES DE LA SCORECARD À ÉVALUER :
${JSON.stringify(criteria)}
${pendingSignalsContext}

RÈGLES :
- Ne marque "covered" que si le sujet a été CLAIREMENT et SUBSTANTIELLEMENT abordé
- Extrais le verbatim le plus pertinent (1 phrase max du candidat)
- auto_score : 5=parfait, 4=bon, 3=correct, 2=faible, 1=red flag

SECTION "dig_deeper" — FORMAT BULLET-POINT ULTRA-CONCIS :
- Retourne des items UNIQUEMENT quand tu détectes quelque chose de concret à creuser
- SIGNAL = observation en 3-5 mots max (ex: "Hésite sur sa dispo", "Contre-offre mentionnée", "Gap 2022-2023")
- QUESTION = bullet-point actionnable en 5-8 mots max, PAS une phrase complète (ex: "Demander date exacte", "Creuser montant et timeline", "Vérifier raison du gap")
- Maximum 3 items, 0 si RAS
- NE GÉNÈRE PAS d'items juste pour en générer
- NE DUPLIQUE PAS un signal déjà en attente (pending_signals)
- Chaque item = { "signal": "3-5 mots", "question": "bullet-point action 5-8 mots" }

SECTION "resolved_signals" :
- Liste des signaux (valeurs exactes du champ "signal") des pending_signals qui ont été traités dans la conversation
- Un signal est résolu quand la question a été posée ET le candidat a donné une réponse substantielle
- Si aucun signal résolu, retourne []

SECTION "next_topic" — PROACTIVITÉ ULTRA-CONCISE :
- "topic" : nom du critère (3-5 mots max)
- "transition" : question de transition en 1 phrase courte (max 12 mots), pas un paragraphe
- "why" : pourquoi maintenant (5 mots max)
- Choisis le sujet le plus naturel par rapport au flow de la conversation

IMPORTANT : Sois CONCIS et RAPIDE.`;

    let aiResult;
    try {
      aiResult = await callClaudeCompat({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `CALL EN COURS (${elapsed_seconds}s écoulées)\n\nTRANSCRIPTION RÉCENTE :\n${truncatedTranscript}\n\nDERNIER SEGMENT :\n${latest_chunk}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "coach_analysis",
              description: "Return live coaching analysis for the ongoing interview",
              parameters: {
                type: "object",
                properties: {
                  resolved_signals: {
                    type: "array",
                    items: { type: "string" },
                    description: "Signals from pending_signals that have been addressed"
                  },
                  dig_deeper: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        signal: { type: "string" },
                        question: { type: "string" }
                      },
                      required: ["signal", "question"],
                      additionalProperties: false
                    },
                    description: "0-3 items worth digging into"
                  },
                  criteria_updates: {
                    type: "object",
                    description: "Map of criterion ID to update object with covered, verbatim, auto_score, sentiment fields"
                  },
                  next_topic: {
                    type: "object",
                    properties: {
                      topic: { type: "string", description: "Next criterion or subject to cover" },
                      transition: { type: "string", description: "Natural transition phrase the recruiter can use verbatim" },
                      why: { type: "string", description: "Why this topic now (1 sentence)" }
                    },
                    required: ["topic", "transition", "why"],
                    additionalProperties: false,
                    description: "Proactive suggestion for the next interview topic"
                  }
                },
                required: ["resolved_signals", "dig_deeper", "criteria_updates", "next_topic"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "coach_analysis" } },
        max_tokens: 1024,
        timeoutMs: 20000,
        aiContext,
      });
      await settleClaudeUsage({ userId, aiAction: "live_coaching", usage: aiResult.usage, modelId: aiResult.model });
    } catch (e) {
      console.error("[live-coach] Claude error:", e);
      throw new Error("Coach analysis timeout or network error");
    }

    let analysis = { resolved_signals: [] as string[], dig_deeper: [] as any[], criteria_updates: {} };
    if (aiResult.toolCall?.input) {
      analysis = aiResult.toolCall.input as any;
    } else if (aiResult.content) {
      // Fallback: parse from content if tool call didn't come back
      const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
        } catch {
          console.warn("Content JSON parse also failed, using defaults");
        }
      }
    }

    // Save to DB (fire-and-forget for speed)
    // Verify session belongs to the authenticated user before updating
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    const { data: sessionRow } = await supabaseAdmin
      .from("call_coaching_sessions")
      .select("created_by")
      .eq("id", session_id)
      .single();

    if (sessionRow?.created_by !== userId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    Promise.resolve(supabaseAdmin
      .from("call_coaching_sessions")
      .update({
        transcript: full_transcript,
        criteria_detected: analysis.criteria_updates,
        duration_seconds: elapsed_seconds,
      })
      .eq("id", session_id))
      .then(() => {})
      .catch((e: unknown) => console.error('[live-coach] Transcript update failed:', e));

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("live-coach error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
