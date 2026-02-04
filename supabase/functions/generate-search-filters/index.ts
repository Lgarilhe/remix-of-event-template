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

// TOP_SCHOOLS removed - schools are now selected manually via "TOP Écoles" button

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

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
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

    // Helper function to call AI with retry logic for 529 errors
    const callAIWithRetry = async (maxRetries = 3): Promise<Response> => {
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 2048,
              system: systemPrompt,
              messages: [
                { role: "user", content: jobContext },
              ],
            }),
          });

          if (response.ok) {
            return response;
          }

          // Handle specific error codes
          if (response.status === 429) {
            throw new Error("RATE_LIMIT");
          }
          if (response.status === 402) {
            throw new Error("CREDITS_EXHAUSTED");
          }
          if (response.status === 529 || response.status === 503) {
            // Service overloaded - retry with exponential backoff
            const errorText = await response.text();
            console.warn(`[generate-search-filters] AI overloaded (attempt ${attempt}/${maxRetries}):`, errorText);
            
            if (attempt < maxRetries) {
              const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
              console.log(`[generate-search-filters] Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw new Error("SERVICE_OVERLOADED");
          }

          // Other errors
          const errorText = await response.text();
          console.error("[generate-search-filters] AI error:", response.status, errorText);
          throw new Error(`AI_ERROR_${response.status}`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.message === "RATE_LIMIT" || 
              lastError.message === "CREDITS_EXHAUSTED" ||
              lastError.message === "SERVICE_OVERLOADED" ||
              lastError.message.startsWith("AI_ERROR_")) {
            throw lastError;
          }
          // Network error - retry
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[generate-search-filters] Network error (attempt ${attempt}/${maxRetries}):`, lastError.message);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      throw lastError || new Error("Unknown error after retries");
    };

    let response: Response;
    try {
      response = await callAIWithRetry(3);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      if (errorMessage === "RATE_LIMIT") {
        return new Response(
          JSON.stringify({ error: "Trop de requêtes, réessayez dans quelques secondes" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (errorMessage === "CREDITS_EXHAUSTED") {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (errorMessage === "SERVICE_OVERLOADED") {
        return new Response(
          JSON.stringify({ error: "Service IA temporairement surchargé, réessayez dans 30 secondes" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.error("[generate-search-filters] AI call failed:", errorMessage);
      throw new Error(`AI gateway error: ${errorMessage}`);
    }

    const aiResult = await response.json();
    // Claude API returns content as array of blocks
    const content = aiResult.content?.[0]?.text || "";
    
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

    // === RÈGLE 3: Pas de filtre école automatique ===
    // Les écoles ne sont plus auto-générées - l'utilisateur les sélectionne manuellement via le bouton "TOP Écoles"
    const schoolFilters: SchoolFilter[] = [];

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

    // === RÈGLE 6: Élargir PROGRAMMATIQUEMENT la plage d'expérience (PROPORTIONNEL) ===
    // Plus le niveau est senior, plus on élargit la plage
    // Junior (0-2 ans) → 0-5 ans | Senior (10 ans) → 8-null (pas de max)
    // Philosophie: être junior est bloquant, être senior ne l'est pas (le scoring gère)
    const rawXpMin = parsed.years_experience_min ?? job.xpMin ?? null;
    const rawXpMax = parsed.years_experience_max ?? job.xpMax ?? null;
    
    // Réduction proportionnelle sur le min: ~25% avec min 1 an, max 3 ans
    const minReduction = rawXpMin !== null 
      ? Math.min(3, Math.max(1, Math.round(rawXpMin * 0.25))) 
      : 0;
    
    // Pour le max: très généreux car les seniors ne sont pas un problème
    // - Si le job demande <5 ans max → on met +3 ans
    // - Si le job demande 5-10 ans max → on met +10 ans  
    // - Si le job demande >10 ans max → pas de max (null)
    const maxAddition = rawXpMax !== null 
      ? (rawXpMax < 5 ? 3 : (rawXpMax <= 10 ? 10 : null))
      : null;
    
    const widenedXpMin = rawXpMin !== null ? Math.max(0, rawXpMin - minReduction) : null;
    // Si maxAddition est null, on ne met pas de max du tout (ouvert aux seniors)
    const widenedXpMax = (rawXpMax !== null && maxAddition !== null) ? rawXpMax + maxAddition : null;
    
    // S'assurer que min <= max
    const finalXpMin = (widenedXpMin !== null && widenedXpMax !== null && widenedXpMin > widenedXpMax) 
      ? widenedXpMax 
      : widenedXpMin;
    const finalXpMax = (widenedXpMin !== null && widenedXpMax !== null && widenedXpMin > widenedXpMax) 
      ? widenedXpMin 
      : widenedXpMax;

    console.log(`[generate-search-filters] XP: raw=${rawXpMin}-${rawXpMax} → widened=${finalXpMin}-${finalXpMax}`);

    const filters: GeneratedFilters = {
      keywords: parsed.keywords || job.title,
      // Single role filter with all titles combined via OR
      role: [{
        keywords: combinedRoleKeywords,
        priority: "MUST_HAVE",
        scope: "CURRENT",
      }],
      seniority: parsed.seniority_levels || [],
      years_of_experience_min: finalXpMin,
      years_of_experience_max: finalXpMax,
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