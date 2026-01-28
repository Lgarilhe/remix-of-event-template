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
  remotePolicy?: string; // "full", "hybrid", "onsite"
}

interface CompanyKeywordFilter {
  keywords: string;
  priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
  scope: 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT';
}

interface SchoolFilter {
  id: string;
  name: string;
  priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
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
  location_within_area: number | null;
  company_keywords: CompanyKeywordFilter[];
  school: SchoolFilter[];
  spotlight: string;
  open_to_work: boolean;
}

// École IDs from LinkedIn - TOP schools reference
const TOP_SCHOOLS = {
  // TOP 10 Ingénierie / Tech
  engineering: [
    { id: "10245", name: "École Polytechnique" },
    { id: "301127", name: "CentraleSupélec" },
    { id: "12468", name: "Mines Paris - PSL" },
    { id: "12421", name: "École normale supérieure" },
    { id: "19099", name: "École normale supérieure Paris-Saclay" },
    { id: "12453", name: "École des Ponts ParisTech" },
    { id: "12462", name: "Télécom Paris" },
    { id: "12439", name: "ENSAE Paris" },
    { id: "12446", name: "ISAE-SUPAERO" },
    { id: "12396", name: "Arts et Métiers" },
  ],
  // TOP 10 Commerce / Business
  business: [
    { id: "10219", name: "HEC Paris" },
    { id: "10213", name: "ESSEC Business School" },
    { id: "10212", name: "ESCP Business School" },
    { id: "10214", name: "emlyon business school" },
    { id: "10207", name: "EDHEC Business School" },
    { id: "10199", name: "Audencia" },
    { id: "166963", name: "SKEMA Business School" },
    { id: "10218", name: "Grenoble Ecole de Management" },
    { id: "2929644", name: "NEOMA Business School" },
    { id: "2756953", name: "KEDGE Business School" },
  ],
  // Profils atypiques valorisés
  atypical: [
    { id: "10309954", name: "42" },
    { id: "12440", name: "Epitech" },
    { id: "5143435", name: "Le Wagon" },
    { id: "12438", name: "EPITA" },
  ],
  // International TOP
  international: [
    { id: "10290", name: "Massachusetts Institute of Technology" },
    { id: "10373", name: "Stanford University" },
    { id: "12442", name: "École Polytechnique Fédérale de Lausanne" },
    { id: "10204", name: "ETH Zurich" },
    { id: "10453", name: "University of Cambridge" },
    { id: "10457", name: "University of Oxford" },
    { id: "10251", name: "Imperial College London" },
  ],
};

// ESN companies to deprioritize
const ESN_KEYWORDS = [
  "Capgemini", "Accenture", "Sopra Steria", "Atos", "CGI", "Altran",
  "Alten", "Assystem", "Aubay", "Devoteam", "Extia", "Wavestone",
  "Talan", "Onepoint", "Publicis Sapient", "Sword Group"
];

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

IMPORTANT: Les mots-clés de rôle seront utilisés dans une recherche booléenne. 
- Le champ "keywords" doit contenir TOUS les titres alternatifs combinés avec OR (ex: "Data Engineer" OR "ML Engineer" OR "MLOps")
- Le champ "role_keywords" doit contenir UN SEUL élément avec tous les titres combinés en OR (pas plusieurs éléments séparés)

RÈGLES MÉTIER IMPORTANTES:
1. Privilégier les startups et scale-ups, moins valoriser les ESN/SSII (sociétés de conseil)
2. Valoriser les candidats "Open to Work" 
3. Pour les postes tech/data, valoriser les écoles d'ingénieur TOP (X, Centrale, Mines, etc.)
4. Pour les postes business, valoriser les écoles de commerce TOP (HEC, ESSEC, ESCP, etc.)
5. Valoriser également les profils atypiques (42, Epitech, Le Wagon) pour les postes tech

Retourne UNIQUEMENT un objet JSON valide avec les champs suivants:
- keywords: string - Mots-clés principaux combinés avec OR (ex: "Data Engineer" OR "ML Engineer")
- role_keywords: string[] - UN SEUL élément contenant tous les titres combinés avec OR (ex: ["Data Engineer OR ML Engineer OR MLOps Engineer"])
- seniority_levels: string[] - Niveaux hiérarchiques parmi: "1" (Entry), "2" (Associate), "3" (Mid), "4" (Senior), "5" (Manager), "6" (Director), "7" (VP), "8" (CXO), "9" (Partner), "10" (Owner)
- years_experience_min: number | null - Années d'expérience minimum
- years_experience_max: number | null - Années d'expérience maximum
- skills_to_search: string[] - Compétences clés à rechercher (max 8, les plus pertinentes)
- industry_keywords: string[] - Secteurs d'activité pertinents (max 3)
- location_hint: string - Zone géographique suggérée
- job_category: string - Catégorie du poste parmi: "tech", "business", "data", "product", "design", "other"
- suggest_open_to_work: boolean - true si on doit filtrer sur les candidats Open to Work

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
${job.remotePolicy ? `Politique remote: ${job.remotePolicy}` : ''}
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
        job_category: "other",
        suggest_open_to_work: true,
      };
    }

    // Transform to filter format
    // IMPORTANT: Role keywords should be combined into a SINGLE role filter with OR logic
    // Multiple MUST_HAVE roles are AND'ed together by LinkedIn, which returns 0 results
    const roleKeywords = parsed.role_keywords || [];
    const combinedRoleKeywords = roleKeywords.length > 1 
      ? roleKeywords.join(' OR ')  // Combine all into one OR query
      : roleKeywords[0] || job.title;

    // === RÈGLE 1: Exclure le client des expériences actuelles ET passées ===
    const companyKeywords: CompanyKeywordFilter[] = [];
    if (job.client?.name) {
      companyKeywords.push({
        keywords: job.client.name,
        priority: 'DOESNT_HAVE',
        scope: 'CURRENT_OR_PAST', // Exclure sur toutes les expériences
      });
    }

    // === RÈGLE 2: Dé-prioriser les ESN (optionnel - on les exclut pas, on les note moins) ===
    // Note: On n'exclut pas les ESN car certains bons profils y sont, mais on peut les signaler
    // Pour l'instant on ne les ajoute pas en DOESNT_HAVE pour ne pas être trop restrictif

    // === RÈGLE 3: Sélectionner les écoles selon la catégorie du poste ===
    const schoolFilters: SchoolFilter[] = [];
    const jobCategory = parsed.job_category || "other";
    
    // Toujours ajouter les écoles internationales TOP
    TOP_SCHOOLS.international.forEach(school => {
      schoolFilters.push({ ...school, priority: 'CAN_HAVE' });
    });

    // Ajouter les écoles selon la catégorie
    if (jobCategory === "tech" || jobCategory === "data" || jobCategory === "product") {
      TOP_SCHOOLS.engineering.forEach(school => {
        schoolFilters.push({ ...school, priority: 'CAN_HAVE' });
      });
      TOP_SCHOOLS.atypical.forEach(school => {
        schoolFilters.push({ ...school, priority: 'CAN_HAVE' });
      });
    } else if (jobCategory === "business") {
      TOP_SCHOOLS.business.forEach(school => {
        schoolFilters.push({ ...school, priority: 'CAN_HAVE' });
      });
    } else {
      // Pour les autres catégories, ajouter un mix
      TOP_SCHOOLS.engineering.slice(0, 5).forEach(school => {
        schoolFilters.push({ ...school, priority: 'CAN_HAVE' });
      });
      TOP_SCHOOLS.business.slice(0, 5).forEach(school => {
        schoolFilters.push({ ...school, priority: 'CAN_HAVE' });
      });
    }

    // === RÈGLE 4: Adapter le rayon de recherche selon la politique remote ===
    let locationRadius: number | null = 50; // Default 50 miles (~80km)
    const remotePolicy = job.remotePolicy?.toLowerCase() || '';
    
    if (remotePolicy.includes('full') || remotePolicy.includes('100%') || remotePolicy.includes('remote')) {
      locationRadius = null; // Pas de limite = recherche nationale
    } else if (remotePolicy.includes('hybrid') || remotePolicy.includes('hybride')) {
      locationRadius = 75; // ~120km pour hybrid
    } else if (remotePolicy.includes('onsite') || remotePolicy.includes('présentiel')) {
      locationRadius = 35; // ~56km pour présentiel
    }

    // === RÈGLE 5: Valoriser les candidats Open to Work ===
    const openToWork = parsed.suggest_open_to_work !== false; // Default true

    const filters: GeneratedFilters = {
      keywords: parsed.keywords || job.title,
      // Single role filter with all titles combined via OR
      role: [{
        keywords: combinedRoleKeywords,
        priority: "MUST_HAVE",
        scope: "CURRENT",
      }],
      seniority: parsed.seniority_levels || [],
      years_of_experience_min: parsed.years_experience_min ?? job.xpMin ?? null,
      years_of_experience_max: parsed.years_experience_max ?? job.xpMax ?? null,
      skills_keywords: parsed.skills_to_search || job.skills?.slice(0, 8) || [],
      industry_keywords: parsed.industry_keywords || [],
      location_keywords: parsed.location_hint ? [parsed.location_hint] : (job.location ? [job.location] : []),
      location_within_area: locationRadius,
      company_keywords: companyKeywords,
      school: schoolFilters,
      spotlight: openToWork ? 'OPEN_TO_WORK' : '',
      open_to_work: openToWork,
    };

    console.log("[generate-search-filters] Generated filters:", JSON.stringify(filters, null, 2));

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