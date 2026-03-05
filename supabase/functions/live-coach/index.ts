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
    } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `Tu es un coach de recrutement senior en temps réel.
Tu analyses un entretien en cours et tu aides le recruteur.

CONTEXTE DU POSTE :
${job_context}

CRITÈRES DE LA SCORECARD À ÉVALUER :
${JSON.stringify(criteria)}

RÈGLES :
- Ultra concis : 1 phrase par alerte ou suggestion
- Ne marque "covered" que si le sujet a été clairement abordé
- Extrais le verbatim le plus pertinent (1 phrase max du candidat)
- Détecte : contre-offre, salaire hors range, red flags, hésitations, questions candidat
- auto_score : 5=parfait, 4=bon, 3=correct, 2=faible, 1=red flag
- Si rien de nouveau à signaler, retourne alerts et suggestions vides`,
        messages: [
          {
            role: "user",
            content: `CALL EN COURS (${elapsed_seconds}s écoulées)

TRANSCRIPTION COMPLÈTE :
${full_transcript}

DERNIER SEGMENT :
${latest_chunk}

Retourne UNIQUEMENT ce JSON (pas de texte avant/après) :
{
  "alerts": [{"type": "danger|warning|info", "message": "..."}],
  "suggestions": [{"question": "...", "why": "..."}],
  "criteria_updates": {
    "CRITERIA_ID": {
      "covered": true,
      "signal": "positive|negative|neutral",
      "verbatim": "...",
      "auto_score": 4
    }
  }
}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const claudeRes = await response.json();
    const text = claudeRes.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : { alerts: [], suggestions: [], criteria_updates: {} };

    // Save to DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabase
      .from("call_coaching_sessions")
      .update({
        transcript: full_transcript,
        criteria_detected: analysis.criteria_updates,
        duration_seconds: elapsed_seconds,
      })
      .eq("id", session_id);

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
