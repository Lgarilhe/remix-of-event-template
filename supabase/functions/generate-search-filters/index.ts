import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Job {
  id: string;
  title: string;
  client?: {
    name?: string;
    sector?: string;
  } | null;
  location?: string;
  skills?: string[];
  seniority?: string;
  xpMin?: number;
  xpMax?: number;
  description?: string;
  requirements?: string;
  sourcingCriteria?: string;
}

interface GeneratedFilters {
  keywords: string;
  role: Array<{ keywords: string; priority: string; scope: string }>;
  seniority: string[];
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  skills_keywords: string[];
  industry_keywords: string[];
  location_keywords: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job } = await req.json() as { job: Job };
    
    if (!job) {
      return new Response(
        JSON.stringify({ error: "Job is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build the prompt for AI
    const systemPrompt = `Tu es un expert en recrutement LinkedIn. À partir d'une fiche de poste, tu génères des filtres de recherche LinkedIn optimaux.

Retourne UNIQUEMENT un objet JSON valide avec les champs suivants:
- keywords: string - Mots-clés principaux pour la recherche (titre de poste + variations)
- role_keywords: string[] - Liste de titres/intitulés de poste alternatifs (max 5)
- seniority_levels: string[] - Niveaux hiérarchiques parmi: "1" (Entry), "2" (Associate), "3" (Mid), "4" (Senior), "5" (Manager), "6" (Director), "7" (VP), "8" (CXO), "9" (Partner), "10" (Owner)
- years_experience_min: number | null - Années d'expérience minimum
- years_experience_max: number | null - Années d'expérience maximum
- skills_to_search: string[] - Compétences clés à rechercher (max 8, les plus pertinentes)
- industry_keywords: string[] - Secteurs d'activité pertinents (max 3)
- location_hint: string - Zone géographique suggérée

Réponds UNIQUEMENT avec le JSON, sans markdown ni explication.`;

    const jobContext = `
Titre du poste: ${job.title}
${job.client?.name ? `Client: ${job.client.name}` : ''}
${job.client?.sector ? `Secteur: ${job.client.sector}` : ''}
${job.location ? `Localisation: ${job.location}` : ''}
${job.seniority ? `Séniorité: ${job.seniority}` : ''}
${job.xpMin !== undefined ? `Expérience min: ${job.xpMin} ans` : ''}
${job.xpMax !== undefined ? `Expérience max: ${job.xpMax} ans` : ''}
${job.skills?.length ? `Compétences requises: ${job.skills.join(', ')}` : ''}
${job.description ? `Description: ${job.description.substring(0, 500)}` : ''}
${job.requirements ? `Prérequis: ${job.requirements.substring(0, 300)}` : ''}
${job.sourcingCriteria ? `Critères de sourcing: ${job.sourcingCriteria}` : ''}
`.trim();

    console.log("[generate-search-filters] Calling AI with job:", job.title);

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
          { role: "user", content: jobContext },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted, please add funds" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("[generate-search-filters] AI error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";
    
    console.log("[generate-search-filters] AI response:", content);

    // Parse JSON from response (handle potential markdown code blocks)
    let parsed;
    try {
      // Remove potential markdown code blocks
      const cleanJson = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error("[generate-search-filters] Failed to parse AI response:", e);
      // Fallback to basic extraction from job
      parsed = {
        keywords: job.title,
        role_keywords: [job.title],
        seniority_levels: [],
        years_experience_min: job.xpMin ?? null,
        years_experience_max: job.xpMax ?? null,
        skills_to_search: job.skills?.slice(0, 8) || [],
        industry_keywords: job.client?.sector ? [job.client.sector] : [],
        location_hint: job.location || "",
      };
    }

    // Transform to filter format
    const filters: GeneratedFilters = {
      keywords: parsed.keywords || job.title,
      role: (parsed.role_keywords || []).slice(0, 5).map((kw: string) => ({
        keywords: kw,
        priority: "MUST_HAVE",
        scope: "CURRENT",
      })),
      seniority: parsed.seniority_levels || [],
      years_of_experience_min: parsed.years_experience_min ?? job.xpMin ?? null,
      years_of_experience_max: parsed.years_experience_max ?? job.xpMax ?? null,
      skills_keywords: parsed.skills_to_search || job.skills?.slice(0, 8) || [],
      industry_keywords: parsed.industry_keywords || [],
      location_keywords: parsed.location_hint ? [parsed.location_hint] : (job.location ? [job.location] : []),
    };

    console.log("[generate-search-filters] Generated filters:", filters);

    return new Response(
      JSON.stringify({ success: true, filters }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[generate-search-filters] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
