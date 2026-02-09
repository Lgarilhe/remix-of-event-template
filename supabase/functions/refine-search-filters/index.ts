import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefineRequest {
  currentFilters: Record<string, unknown>;
  totalResults: number | null;
  resultCount: number;
  jobTitle: string;
  jobLocation?: string;
  direction: 'expand' | 'narrow' | 'auto'; // auto = AI decides based on count
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { currentFilters, totalResults, resultCount, jobTitle, jobLocation, direction } =
      await req.json() as RefineRequest;

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const effectiveTotal = totalResults ?? resultCount;
    const autoDirection = effectiveTotal < 50 ? 'expand' : effectiveTotal > 500 ? 'narrow' : 'expand';
    const finalDirection = direction === 'auto' ? autoDirection : direction;

    const systemPrompt = `Tu es un expert en recrutement LinkedIn. On te donne les filtres actuels d'une recherche LinkedIn et le nombre de résultats obtenus. Tu dois ajuster les filtres pour ${finalDirection === 'expand' ? 'ÉLARGIR la recherche (plus de résultats)' : 'AFFINER la recherche (moins de résultats, plus ciblés)'}.

RÈGLES D'ÉLARGISSEMENT (quand trop peu de résultats):
1. Augmenter le rayon géographique (location_within_area): 25→50→75→100 miles
2. Passer le role de MUST_HAVE à CAN_HAVE ou supprimer des titres trop spécifiques
3. Simplifier les keywords: réduire le nombre de groupes AND, garder 1-2 max
4. Élargir la plage d'expérience: -2 ans sur le min, +3 ans sur le max
5. Supprimer des filtres secondaires (skills, school, spotlight)
6. NE PAS toucher au compte ni au mode API

RÈGLES D'AFFINAGE (quand trop de résultats):
1. Réduire le rayon géographique
2. Ajouter des groupes AND aux keywords
3. Resserrer la plage d'expérience
4. Passer des filtres de CAN_HAVE à MUST_HAVE
5. Ajouter des exclusions NOT dans les keywords

PRIORITÉ DES AJUSTEMENTS (du plus impactant au moins):
1. Keywords (AND/OR structure)
2. Location radius
3. Role priority
4. Years of experience range
5. Autres filtres

Retourne UNIQUEMENT un JSON avec:
- adjustments: tableau d'objets décrivant chaque changement. Chaque objet a:
  - field: string (nom du champ de filtre à modifier, ex: "keywords", "location_within_area", "role", "calculated_experience_min", etc.)
  - value: la nouvelle valeur pour ce champ
  - reason: string (explication courte du pourquoi en français)
- summary: string (résumé en 1 phrase de ce qui a changé, en français)
- expectedImpact: string ("beaucoup_plus" | "plus" | "similaire" | "moins" | "beaucoup_moins")

JSON uniquement, sans markdown.`;

    const userMessage = `Poste: ${jobTitle}
${jobLocation ? `Localisation du poste: ${jobLocation}` : ''}
Nombre de résultats actuels: ${effectiveTotal}
Direction souhaitée: ${finalDirection === 'expand' ? 'ÉLARGIR (plus de résultats)' : 'AFFINER (moins de résultats)'}

Filtres actuels:
${JSON.stringify(currentFilters, null, 2)}`;

    console.log(`[refine-search-filters] Direction: ${finalDirection}, Total: ${effectiveTotal}, Job: ${jobTitle}`);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[refine-search-filters] AI error:", response.status, errText?.slice(0, 300));
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.content?.[0]?.text || "";

    let parsed;
    try {
      const cleanJson = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error("[refine-search-filters] Failed to parse:", content?.slice(0, 500));
      throw new Error("Failed to parse AI response");
    }

    console.log("[refine-search-filters] Adjustments:", JSON.stringify(parsed, null, 2));

    return new Response(
      JSON.stringify({ success: true, ...parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[refine-search-filters] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
