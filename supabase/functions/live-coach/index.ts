import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      session_id,
      full_transcript,
      latest_chunk,
      criteria,
      job_context,
      elapsed_seconds,
      pending_signals,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate transcript to last ~3000 chars for speed
    const truncatedTranscript = full_transcript.length > 3000
      ? '...' + full_transcript.slice(-3000)
      : full_transcript;

    const pendingSignalsContext = pending_signals?.length
      ? `\nSIGNAUX EN ATTENTE (questions suggérées précédemment, pas encore traitées) :\n${JSON.stringify(pending_signals)}\n\nPour chaque signal en attente, vérifie dans la transcription si la question a été posée ET si le candidat y a répondu. Si oui, ajoute le signal exact dans "resolved_signals". Ne propose PAS de nouveaux signaux sur le même sujet qu'un signal en attente non résolu.`
      : '';

    const systemPrompt = `Tu es un coach de recrutement senior en temps réel.
Tu analyses un entretien en cours et tu aides le recruteur.

CONTEXTE DU POSTE :
${job_context}

CRITÈRES DE LA SCORECARD À ÉVALUER :
${JSON.stringify(criteria)}
${pendingSignalsContext}

RÈGLES :
- Ne marque "covered" que si le sujet a été CLAIREMENT et SUBSTANTIELLEMENT abordé
- Extrais le verbatim le plus pertinent (1 phrase max du candidat)
- auto_score : 5=parfait, 4=bon, 3=correct, 2=faible, 1=red flag

SECTION "dig_deeper" — TRÈS IMPORTANT :
- Retourne des items UNIQUEMENT quand tu détectes quelque chose de concret qui mérite d'être creusé :
  • Hésitation ou réponse évasive du candidat
  • Contradiction avec ce qui a été dit avant
  • Red flag (gap inexpliqué, salaire hors range, contre-offre)
  • Opportunité de creuser un point fort
  • Information manquante critique
- Maximum 3 items
- Si rien d'intéressant ou de nouveau à signaler, retourne dig_deeper VIDE []
- NE GÉNÈRE PAS d'items juste pour en générer
- NE DUPLIQUE PAS un signal déjà en attente (pending_signals)
- Chaque item = { "signal": "observation courte", "question": "question à poser" }

SECTION "resolved_signals" :
- Liste des signaux (valeurs exactes du champ "signal") des pending_signals qui ont été traités dans la conversation
- Un signal est résolu quand la question a été posée ET le candidat a donné une réponse substantielle
- Si aucun signal résolu, retourne []

IMPORTANT : Sois CONCIS et RAPIDE. Réponds uniquement en JSON valide.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 512,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `CALL EN COURS (${elapsed_seconds}s écoulées)

TRANSCRIPTION RÉCENTE :
${truncatedTranscript}

DERNIER SEGMENT :
${latest_chunk}

Retourne UNIQUEMENT ce JSON (pas de texte avant/après) :
{
  "resolved_signals": [],
  "dig_deeper": [],
  "criteria_updates": {}
}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Lovable AI error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }

    const aiRes = await response.json();
    const text = aiRes.choices?.[0]?.message?.content || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : { resolved_signals: [], dig_deeper: [], criteria_updates: {} };

    // Save to DB (fire-and-forget for speed)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    supabase
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
