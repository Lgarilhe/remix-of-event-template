// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const _authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await _authClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.claims.sub;

    // Rate limit: 30 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'live_coach', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === INTRO GENERATION MODE ===
    if (body.action === 'generate_intro') {
      const { candidate_name, candidate_headline, candidate_profile_summary, job_title, job_context, criteria } = body;
      
      const introPrompt = `Tu es un coach de recrutement. Génère une introduction d'appel personnalisée et chaleureuse.

CANDIDAT : ${candidate_name}
HEADLINE : ${candidate_headline || 'N/A'}
RÉSUMÉ PROFIL : ${candidate_profile_summary || 'N/A'}
POSTE : ${job_title}
CONTEXTE : ${job_context}
CRITÈRES À ÉVALUER : ${JSON.stringify(criteria)}

Génère une intro de 3-4 phrases que le recruteur peut dire mot pour mot au début de l'appel :
- Commence par une accroche personnalisée basée sur le parcours/headline du candidat (pas générique)
- Mentionne brièvement pourquoi tu l'appelles (le poste)
- Donne le cadre de l'échange (durée ~30min, objectif : se connaître mutuellement)
- Termine par une question ouverte pour lancer la conversation

Sois naturel, humain, pas corporate. Tutoie si le contexte s'y prête (tech/startup).`;

      const introController = new AbortController();
      const introTimeout = setTimeout(() => introController.abort(), 15000);
      let introResponse: Response;
      try {
        introResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            max_tokens: 300,
            messages: [
              { role: "user", content: introPrompt },
            ],
          }),
          signal: introController.signal,
        });
      } finally {
        clearTimeout(introTimeout);
      }

      if (!introResponse.ok) {
        const errText = await introResponse.text();
        console.error("Intro AI error:", introResponse.status, errText);
        return new Response(JSON.stringify({ intro: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const introRes = await introResponse.json();
      const intro = introRes.choices?.[0]?.message?.content?.trim() || null;
      
      return new Response(JSON.stringify({ intro }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

SECTION "next_topic" — PROACTIVITÉ :
- Analyse quels critères n'ont PAS encore été couverts et le contexte de la conversation
- Suggère LE prochain sujet à aborder avec :
  • "topic" : le nom du critère ou sujet à aborder ensuite
  • "transition" : une phrase de transition naturelle que le recruteur peut utiliser mot pour mot pour enchaîner
  • "why" : pourquoi aborder ce sujet maintenant (1 phrase max)
- Choisis le sujet le plus pertinent en fonction du flow naturel de la conversation (pas forcément le premier critère non couvert)
- Si tous les critères sont couverts, suggère de passer aux questions du candidat ou de conclure

IMPORTANT : Sois CONCIS et RAPIDE.`;

    const coachController = new AbortController();
    const coachTimeout = setTimeout(() => coachController.abort(), 15000);
    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          max_tokens: 512,
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
        }),
        signal: coachController.signal,
      });
    } finally {
      clearTimeout(coachTimeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Lovable AI error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }

    const aiRes = await response.json();
    let analysis = { resolved_signals: [] as string[], dig_deeper: [] as any[], criteria_updates: {} };

    // Try tool_calls first (structured output), fall back to content parsing
    const toolCall = aiRes.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        analysis = JSON.parse(toolCall.function.arguments);
      } catch {
        console.warn("Tool call JSON parse failed, trying content fallback");
      }
    }
    
    // Fallback: parse from content if tool_calls didn't work
    if (!toolCall?.function?.arguments || !analysis.criteria_updates) {
      const text = aiRes.choices?.[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: sessionRow } = await supabaseAdmin
      .from("call_coaching_sessions")
      .select("created_by")
      .eq("id", session_id)
      .single();

    if (sessionRow?.created_by !== userId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    supabaseAdmin
      .from("call_coaching_sessions")
      .update({
        transcript: full_transcript,
        criteria_detected: analysis.criteria_updates,
        duration_seconds: elapsed_seconds,
      })
      .eq("id", session_id)
      .then(() => {});

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
