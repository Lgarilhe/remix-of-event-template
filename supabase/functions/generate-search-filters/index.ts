import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TransversalCriteria {
  must: string;
  should: string;
  niceToHave: string;
  context: string;
  domain: string;
  level: string;
}

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
  remote?: string; // Alternative field name for remote policy
  // Job-specific scoring criteria
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  // Company-wide transversal criteria (resolved from linked Notion pages)
  transversalCriteria?: TransversalCriteria | null;
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
    const systemPrompt = `Tu es un expert en recrutement LinkedIn. À partir d'une fiche de poste, tu génères des filtres de recherche LinkedIn ÉQUILIBRÉS (ni trop larges, ni trop restrictifs).

⚠️ RÈGLE CRITIQUE - SÉPARATION DES FILTRES:
Le champ "keywords" sert UNIQUEMENT à affiner la recherche avec des TECHNOLOGIES/COMPÉTENCES.
Le champ "role_keywords" sert UNIQUEMENT aux TITRES DE POSTE.
NE JAMAIS mélanger titres et technologies dans le même champ !

STRATÉGIE "KEYWORDS" (technologies uniquement):
- Utiliser des OR entre technologies alternatives (ex: "AWS OR Azure OR GCP")
- Limiter à 2-3 groupes de technologies max
- Éviter les AND trop restrictifs sauf si VRAIMENT indispensable
- Exemple BON: "Kubernetes OR K8s" 
- Exemple MAUVAIS: "(AWS AND Kubernetes AND CNI) AND (Network Engineer)" ❌

STRATÉGIE "ROLE_KEYWORDS" (titres uniquement):
- UN SEUL élément avec tous les titres alternatifs en OR
- Inclure français ET anglais
- Exemple: "Cloud Network Engineer OR Network Architect OR Ingénieur Réseau"

⚠️ RÈGLE EXPÉRIENCE - PLAGES LARGES:
- TOUJOURS élargir la plage d'expérience de ±2-3 ans par rapport au besoin strict
- Si le poste demande 7-8 ans → retourner 5-10 ans
- Si le poste demande 5 ans min → retourner 3 ans min
- Si le poste demande 10 ans max → retourner 12 ans max
- Objectif: ne PAS exclure des profils légèrement hors critères qui pourraient convenir
- Le filtrage fin se fera par scoring IA, pas par les filtres de recherche

RÈGLES MÉTIER:
1. Pour un profil RARE, être MOINS restrictif sur les keywords (OR plutôt que AND)
2. Les critères MUST-HAVE vont dans skills_to_search, PAS dans keywords
3. open_to_work = false par défaut (trop restrictif sinon)

Retourne UNIQUEMENT un objet JSON avec:
- keywords: string - Technologies/compétences clés avec OR (PAS de titres de poste ici!)
- role_keywords: string[] - UN élément avec titres FR+EN en OR
- seniority_levels: string[] - Niveaux "1"-"10"
- years_experience_min: number | null - TOUJOURS élargir de -2 ans vs le besoin strict
- years_experience_max: number | null - TOUJOURS élargir de +2 ans vs le besoin strict
- skills_to_search: string[] - Compétences techniques (max 10)
- certifications: string[] - Certifications pertinentes (max 3)
- industry_keywords: string[] - Secteurs (max 3)
- domain_expertise: string[] - Domaines métier (max 3)
- location_hint: string
- job_category: string - "tech", "business", "data", "product", "design", "other"
- suggest_open_to_work: boolean - false sauf si explicitement demandé
- search_rationale: string - Stratégie en 1 phrase

JSON uniquement, sans markdown.`;

    // Build comprehensive job context with all scoring criteria
    const transversal = job.transversalCriteria;
    const remotePolicy = job.remotePolicy || job.remote || '';
    
    const jobContext = `
Titre du poste: ${job.title}
${job.client?.name ? `Client: ${job.client.name}` : ''}
${job.client?.sector ? `Secteur: ${job.client.sector}` : ''}
${job.location ? `Localisation: ${job.location}` : ''}
${job.seniority ? `Séniorité: ${job.seniority}` : ''}
${job.xpMin !== undefined ? `Expérience min: ${job.xpMin} ans` : ''}
${job.xpMax !== undefined ? `Expérience max: ${job.xpMax} ans` : ''}
${job.skills?.length ? `Compétences requises: ${job.skills.join(', ')}` : ''}
${remotePolicy ? `Politique remote: ${remotePolicy}` : ''}
${job.description ? `Description: ${job.description.substring(0, 800)}` : ''}
${job.sourcingCriteria ? `Critères de sourcing: ${job.sourcingCriteria}` : ''}

=== CRITÈRES DU POSTE (pour scoring) ===
${job.mustHave ? `🔴 MUST-HAVE (obligatoire): ${job.mustHave}` : ''}
${job.shouldHave ? `🟡 SHOULD-HAVE (souhaité): ${job.shouldHave}` : ''}
${job.niceToHave ? `🟢 NICE-TO-HAVE (bonus): ${job.niceToHave}` : ''}

${transversal ? `=== CRITÈRES TRANSVERSES (entreprise) ===
${transversal.domain ? `Domaine: ${transversal.domain}` : ''}
${transversal.level ? `Niveau: ${transversal.level}` : ''}
${transversal.must ? `🔴 Must transverse: ${transversal.must}` : ''}
${transversal.should ? `🟡 Should transverse: ${transversal.should}` : ''}
${transversal.niceToHave ? `🟢 Nice-to-have transverse: ${transversal.niceToHave}` : ''}
${transversal.context ? `Contexte: ${transversal.context}` : ''}` : ''}
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
      console.log("[generate-search-filters] Search rationale:", parsed.search_rationale);
    } catch (e) {
      console.error("[generate-search-filters] Failed to parse AI response:", e);
      // Fallback to basic extraction from job
      parsed = {
        keywords: job.title,
        role_keywords: [job.title],
        seniority_levels: [],
        years_experience_min: job.xpMin ?? null,
        years_experience_max: job.xpMax ?? null,
        skills_to_search: job.skills?.slice(0, 10) || [],
        soft_skills: [],
        certifications: [],
        industry_keywords: job.client?.sector ? [job.client.sector] : [],
        domain_expertise: [],
        location_hint: job.location || "",
        job_category: "other",
        suggest_open_to_work: true,
      };
    }

    // Combine skills with certifications and domain expertise for more precise filtering
    const allSkillsKeywords = [
      ...(parsed.skills_to_search || []),
      ...(parsed.certifications || []),
      ...(parsed.domain_expertise || []),
    ].slice(0, 12); // Max 12 combined

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
    const remotePolicyForRadius = (job.remotePolicy || job.remote || '').toLowerCase();
    
    if (remotePolicyForRadius.includes('full') || remotePolicyForRadius.includes('100%') || remotePolicyForRadius.includes('remote')) {
      locationRadius = null; // Pas de limite = recherche nationale
    } else if (remotePolicyForRadius.includes('hybrid') || remotePolicyForRadius.includes('hybride')) {
      locationRadius = 75; // ~120km pour hybrid
    } else if (remotePolicyForRadius.includes('onsite') || remotePolicyForRadius.includes('présentiel')) {
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
      skills_keywords: allSkillsKeywords, // Now includes certifications and domain expertise
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