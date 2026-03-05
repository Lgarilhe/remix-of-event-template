import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { candidateProfile, jobContext, scoringDetails } = await req.json();

    if (!candidateProfile || !jobContext) {
      return new Response(
        JSON.stringify({ error: "candidateProfile and jobContext are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Tu es un expert en recrutement tech/digital. Tu dois générer une grille d'évaluation (scorecard) sur mesure pour un entretien de qualification.

RÈGLES:
- Génère exactement 6 à 8 critères d'évaluation
- Chaque critère doit être SPÉCIFIQUE au poste et au profil, pas générique
- Utilise les compétences réelles du poste et du candidat pour formuler les critères
- Inclus un mix de : compétences techniques, soft skills, adéquation culturelle, motivation
- Pour chaque critère, fournis une description courte qui guide l'évaluateur sur quoi observer
- Ordonne les critères du plus critique au moins critique

FORMAT DE SORTIE (JSON strict):
{
  "criteria": [
    {
      "id": "crit_1",
      "label": "Nom du critère (ex: Maîtrise de React dans un contexte SaaS B2B)",
      "description": "Ce qu'il faut évaluer pendant l'entretien (ex: Demander des exemples de projets React complexes, patterns utilisés, gestion d'état)",
      "category": "technical" | "soft_skill" | "culture_fit" | "motivation",
      "weight": 1-3
    }
  ]
}

weight: 1 = nice-to-have, 2 = important, 3 = critique/éliminatoire`;

    const userPrompt = `CONTEXTE DU POSTE:
- Titre: ${jobContext.title || 'Non spécifié'}
- Client: ${jobContext.client || 'Non spécifié'}
- Description: ${jobContext.description || 'Non disponible'}
- Critères/Requirements: ${jobContext.requirements || 'Non disponible'}
- Compétences recherchées: ${(jobContext.skills || []).join(', ') || 'Non spécifié'}

PROFIL DU CANDIDAT:
- Nom: ${candidateProfile.name || 'Non spécifié'}
- Headline: ${candidateProfile.headline || 'Non spécifié'}
- Résumé: ${candidateProfile.summary || 'Non disponible'}
- Compétences: ${(candidateProfile.skills || []).join(', ') || 'Non spécifié'}
- Expériences: ${(candidateProfile.experiences || []).map((e: any) => `${e.title} chez ${e.company}`).join(' | ') || 'Non disponible'}
- Formation: ${(candidateProfile.education || []).map((e: any) => `${e.school} - ${e.degree}`).join(' | ') || 'Non disponible'}
- Années d'expérience: ${candidateProfile.yearsOfExperience || 'Non spécifié'}

${scoringDetails ? `SCORING IA EXISTANT:
- Score: ${scoringDetails.match_score || 'N/A'}/100
- Forces: ${(scoringDetails.matching_skills || []).join(', ')}
- Lacunes potentielles: ${(scoringDetails.missing_skills || []).join(', ')}
- Recommandation: ${scoringDetails.recommendation || 'N/A'}
- Résumé: ${scoringDetails.summary || 'N/A'}` : ''}

Génère la scorecard d'évaluation sur mesure.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_scorecard",
              description: "Generate a custom evaluation scorecard with criteria",
              parameters: {
                type: "object",
                properties: {
                  criteria: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", description: "Unique identifier for the criterion" },
                        label: { type: "string", description: "Short label for the criterion" },
                        description: { type: "string", description: "Detailed description of what to evaluate" },
                        category: { type: "string", description: "Category: technical, soft_skill, culture_fit, or motivation" },
                        weight: { type: "number", description: "Weight 1 to 3" },
                      },
                    },
                  },
                },
                required: ["criteria"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_scorecard" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call response from AI");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ success: true, criteria: parsed.criteria }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-scorecard error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
