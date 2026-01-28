import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const prompt = `Analyse ce profil LinkedIn pour un recruteur tech:

Nom: ${profile.name}
Titre: ${profile.headline || 'Non spécifié'}
Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
Localisation: ${profile.location || 'Non spécifié'}
Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
Expériences: ${profile.pastPositions?.join('; ') || 'Non spécifiées'}
Formation: ${profile.education?.join('; ') || 'Non spécifiée'}

Réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "summary": "Une phrase résumant le profil (max 15 mots)",
  "strengths": ["Point fort 1", "Point fort 2", "Point fort 3"],
  "concerns": ["Point à vérifier 1", "Point à vérifier 2"],
  "fit_score": 75,
  "recommendation": "Phrase courte: action recommandée pour le recruteur"
}

Règles:
- strengths: 2-4 points forts OBJECTIFS basés sur les données (compétences rares, parcours cohérent, entreprises connues, etc.)
- concerns: 1-3 points à vérifier ou potentielles faiblesses (gaps dans le CV, changements fréquents, compétences manquantes, etc.)
- fit_score: score de 0-100 basé sur l'attractivité du profil pour un recruteur tech
- Sois factuel, pas de flatterie. Base-toi uniquement sur les données fournies.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { 
            role: "system", 
            content: "Tu es un expert en recrutement tech. Tu analyses des profils LinkedIn et fournis des insights structurés. Tu réponds TOUJOURS en JSON valide, sans markdown, sans code blocks." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 400,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte, réessayez plus tard." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    
    // Clean up potential markdown code blocks
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const analysis = JSON.parse(content);
      return new Response(
        JSON.stringify({ analysis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Content:", content);
      // Fallback to simple text response
      return new Response(
        JSON.stringify({ 
          analysis: {
            summary: content.slice(0, 100),
            strengths: ["Analyse non structurée disponible"],
            concerns: ["Veuillez réessayer"],
            fit_score: 50,
            recommendation: "Voir le profil complet"
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error analyzing profile:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
