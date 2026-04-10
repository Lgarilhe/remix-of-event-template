// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

interface TransversalCriteria {
  must: string;
  should: string;
  niceToHave: string;
  context: string;
  domain: string;
  level: string;
  bodyContent?: string;
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
  // Page body content (free-form text from the Notion page)
  bodyContent?: string;
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

// TOP French Engineering Schools - used when job explicitly requires "top X" schools
// Top French engineering schools
const TOP_ENGINEERING_SCHOOLS = [
  { id: "14034", name: "École Polytechnique" },
  { id: "14803", name: "CentraleSupélec" },
  { id: "15092675", name: "Mines Paris - PSL" },
  { id: "24772587", name: "École des Ponts ParisTech" },
  { id: "163637", name: "Télécom Paris" },
  { id: "12442", name: "Centrale Lyon" },
  { id: "163631", name: "Centrale Lille" },
  { id: "12429", name: "Centrale Nantes" },
  { id: "27158163", name: "ENSTA Paris" },
  { id: "12463", name: "IMT Atlantique" },
  { id: "12444", name: "Grenoble INP - Ensimag" },
  { id: "12437", name: "Arts et Métiers" },
  { id: "12443", name: "INP-ENSEEIHT" },
  { id: "12467", name: "UTC" },
  { id: "12446", name: "ISAE-SUPAERO" },
  { id: "12451", name: "ISEP" },
  { id: "12440", name: "EPITA" },
  { id: "12435", name: "INSA Lyon" },
  { id: "12460", name: "INSA Toulouse" },
  { id: "12456", name: "Polytech Nice" },
  { id: "167703", name: "ENSAE Paris" },
];

// Top French business schools
const TOP_BUSINESS_SCHOOLS = [
  { id: "14304", name: "HEC Paris" },
  { id: "14296", name: "ESSEC Business School" },
  { id: "14298", name: "ESCP Business School" },
  { id: "14310", name: "EM Lyon Business School" },
  { id: "14302", name: "EDHEC Business School" },
  { id: "166993", name: "Sciences Po" },
  { id: "14312", name: "Grenoble École de Management" },
  { id: "14316", name: "SKEMA Business School" },
  { id: "14306", name: "Audencia Business School" },
  { id: "14314", name: "Neoma Business School" },
  { id: "14318", name: "Kedge Business School" },
  { id: "14300", name: "Toulouse Business School" },
  { id: "166675", name: "Paris-Dauphine University" },
  { id: "14308", name: "IESEG School of Management" },
];

// Combined list — used when job mentions "top schools" / "grandes écoles"
const TOP_SCHOOLS = [...TOP_ENGINEERING_SCHOOLS, ...TOP_BUSINESS_SCHOOLS];

// ESN companies to deprioritize
const ESN_KEYWORDS = [
  "Capgemini", "Accenture", "Sopra Steria", "Atos", "CGI", "Altran",
  "Alten", "Assystem", "Aubay", "Devoteam", "Extia", "Wavestone",
  "Talan", "Onepoint", "Publicis Sapient", "Sword Group"
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit: 20 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'generate_search_filters', p_max_requests: 20, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const _body = await req.json();
    const { job, search_source } = _body as { job: Job; search_source?: string };
    const isDatabase = search_source === 'database';

    // Lazy import to avoid crashing the function if _shared modules have issues
    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "filter_generation", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(_body, "filter_generation");
    } catch (e) {
      console.warn("[generate-search-filters] Failed to load settle-credits, using defaults:", e);
    }
    // Resolve Anthropic model ID from user selection
    let resolvedModel = "claude-sonnet-4-6";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const candidate = getAnthropicModelId(_aiParams.modelId);
      if (candidate && candidate.startsWith("claude-")) resolvedModel = candidate;
    } catch (e) {
      console.warn("[generate-search-filters] Failed to resolve model, using default:", e);
    }

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
    const databaseAddon = isDatabase ? `

⚠️ MODE BASE DE DONNÉES (pas LinkedIn) :
La recherche utilise une base de données de profils (pas LinkedIn). Les différences :
- Le champ "keywords" doit contenir des MOTS SIMPLES séparés par des espaces (PAS de syntaxe Boolean, PAS de AND/OR/NOT, PAS de guillemets, PAS de parenthèses)
- Exemple BON : "Python Kubernetes MLOps Data Engineer"
- Exemple MAUVAIS : "(Python OR Python3) AND (Kubernetes OR K8s)"
- Le champ "role_keywords" doit contenir des TITRES DE POSTE en texte simple, séparés par des virgules
- Pas de filtre école (school) — utilise les mots-clés à la place
- Pas de filtre skills structuré — inclus dans les mots-clés
- Privilégie des mots-clés LARGES pour avoir plus de résultats
` : '';

    const systemPrompt = `Tu es un expert en recrutement ${isDatabase ? '' : 'LinkedIn et en Boolean Search avancé. '}À partir d'une fiche de poste, tu génères des filtres de recherche ${isDatabase ? 'SIMPLES et LARGES' : 'LinkedIn ÉQUILIBRÉS'} (ni trop larges, ni trop restrictifs).${databaseAddon}

⚠️ RÈGLE CRITIQUE - SÉPARATION DES FILTRES:
Le champ "keywords" sert UNIQUEMENT à affiner la recherche avec des TECHNOLOGIES/COMPÉTENCES (= le "Work").
Le champ "role_keywords" sert UNIQUEMENT aux TITRES DE POSTE (= le "Role").
NE JAMAIS mélanger titres et technologies dans le même champ !

=== FRAMEWORK DE RECHERCHE: Role → Work → Context ===
Chaque recherche doit couvrir 3 dimensions:
1. ROLE: La famille de titres de poste (→ role_keywords)
2. WORK: Les outils, technologies, compétences clés (→ keywords)
3. CONTEXT: Industrie, type d'entreprise, domaine (→ industry_keywords, company feeder)

=== STRATÉGIE "KEYWORDS" (LAYERED + EXHAUSTIF + RACINES - OBLIGATOIRE) ===
Structurer les keywords en GROUPES LOGIQUES avec AND entre groupes et OR au sein de chaque groupe.

⚠️ RÈGLE CRITIQUE 1 - SYNONYMES EXHAUSTIFS (Synonym Rings):
Pour CHAQUE technologie, inclure TOUS les synonymes, abréviations et variantes LinkedIn:

MAPPING TECHNOS (exemples obligatoires):
- Java → "Java OR JEE OR J2EE OR J2E OR \\"Java EE\\" OR \\"Jakarta EE\\""
- Spring → "Spring OR \\"Spring Boot\\" OR SpringBoot OR \\"Spring Batch\\""
- Kubernetes → "Kubernetes OR K8s OR K8"
- AWS → "AWS OR \\"Amazon Web Services\\""
- GCP → "GCP OR \\"Google Cloud\\" OR \\"Google Cloud Platform\\""
- Azure → "Azure OR \\"Microsoft Azure\\""
- Docker → "Docker OR Container"
- Python → "Python OR Python3"
- JavaScript → "JavaScript OR JS"
- TypeScript → "TypeScript OR TS"
- React → "React OR ReactJS"
- Angular → "Angular OR AngularJS"
- Vue → "Vue OR VueJS"
- Node → "Node OR NodeJS"
- PostgreSQL → "PostgreSQL OR Postgres"
- MongoDB → "MongoDB OR Mongo"
- Terraform → "Terraform OR IaC"
- Kafka → "Kafka OR \\"Apache Kafka\\""
- Spark → "Spark OR PySpark"
- .NET → ".NET OR DotNet OR \\"C#\\" OR CSharp"
- SQL → "SQL OR MySQL OR MariaDB OR MSSQL"

⚠️ RÈGLE CRITIQUE 2 - WILDCARDS ET RACINES INTELLIGENTES:
L'opérateur * (wildcard) capture les variantes d'un mot:
- cloud* → cloud, clouding, cloudstack, cloudops
- Agil* → Agile, Agilité, Agiliste
Utiliser UNIQUEMENT quand c'est pertinent et sans collision sémantique.

RACINES SÛRES (peu de collision):
- "Eng" → Engineer, Engineering, Ingénieur (OK)
- "Archi" → Architect, Architecture, Architecte (OK)
- "Admin" → Administrator, SysAdmin (OK si contexte infra)
- "Infra" → Infrastructure (OK)
- "Micro" → Microservices (OK)
- "Full" → Fullstack, Full-stack (OK)
- "Front" → Frontend, Front-end (OK)
- "Back" → Backend, Back-end (OK)

RACINES DANGEREUSES (collision sémantique) - ÉVITER:
- "Dev" → Developer vs DevOps → préciser selon le poste
- "Data" → Data Engineer vs Data Scientist vs Data Analyst → préciser
- "Lead" → Tech Lead vs Team Lead → peut capturer des non-tech
- "Go" → mot commun → utiliser "Golang"
- "C" seul → utiliser "C++" ou "C#" explicitement

⚠️ RÈGLE CRITIQUE 3 - NEGATIVE FILTERING (EXCLUSIONS):
Ajouter des exclusions NOT pour éliminer le bruit. Parfois ce qu'on exclut est PLUS IMPORTANT que ce qu'on inclut.

Exclusions recommandées par séniorité:
- Poste senior → NOT ("junior" OR "intern" OR "stagiaire" OR "alternant" OR "apprenti")
- Poste IC → NOT ("manager" OR "director" OR "VP")
- Poste non-freelance → NOT ("freelance" OR "consultant indépendant" OR "auto-entrepreneur")

RÈGLES DE CONSTRUCTION:
1. Identifier 2-3 catégories technologiques DISTINCTES du poste
2. Pour CHAQUE techno: ajouter synonymes + racines pertinentes + wildcards
3. Combiner les catégories avec AND (parenthèses obligatoires)
4. MAX 2-3 groupes AND - au-delà c'est trop restrictif !
5. Ajouter un groupe NOT pour les exclusions pertinentes

EXEMPLES BONS (synonymes + racines + exclusions):
- Backend Java: "(Java OR JEE OR J2EE) AND (Spring OR SpringBoot) NOT (junior OR intern OR stagiaire)"
- Fullstack: "(Full OR Fullstack) AND (React OR Angular OR Vue)"
- DevOps: "(DevOps OR SRE OR Infra) AND (Kubernetes OR K8s OR Docker OR Terraform)"
- Data: "(Data OR \\"Big Data\\") AND (Spark OR Kafka OR Airflow)"
- Datacenter: "(DCIM OR \\"power management\\" OR cooling OR cabling) NOT (freelance OR consultant)"

EXEMPLES MAUVAIS:
- Sans synonymes: "(Java) AND (Spring)" ❌
- AND entre synonymes: "(Java AND JEE)" ❌
- Racine trop courte: "(J)" ❌
- Trop de groupes AND: "(A) AND (B) AND (C) AND (D)" ❌

⚠️ RÈGLE - LIMITE DE CARACTÈRES:
La limite est d'environ 200 caractères par champ. Répartir les requêtes complexes:
- Les titres vont dans role_keywords (PAS dans keywords)
- Les technos/compétences vont dans keywords
- Les compétences secondaires vont dans skills_to_search

=== STRATÉGIE "ROLE_KEYWORDS" (titres uniquement) ===
- UN SEUL élément avec tous les titres alternatifs en OR
- Inclure français ET anglais
- Utiliser des synonym rings exhaustifs pour les titres
- Exemple: "\\"Cloud Network Engineer\\" OR \\"Network Architect\\" OR \\"Ingénieur Réseau\\" OR \\"Network Engineer\\""

=== STRATÉGIE CONTEXTUELLE - FEEDER COMPANIES ===
Quand le contexte le permet, identifier les "feeder companies" (entreprises qui forment le type de talent recherché) et les suggérer dans industry_keywords ou domain_expertise.
Exemple pour un poste datacenter: OVH, Equinix, Scaleway, Digital Realty, Interxion

⚠️ RÈGLE EXPÉRIENCE - INFÉRENCE OBLIGATOIRE:
Tu DOIS TOUJOURS retourner years_experience_min ET years_experience_max avec des valeurs numériques cohérentes.
Si le poste ne précise pas l'expérience, DÉDUIS-LA du contexte:

INFÉRENCE PAR TITRE/SÉNIORITÉ:
- "Junior", "Débutant", "Entry-level" → 0-3 ans
- "Confirmé", "Mid-level", "Expérimenté" → 3-7 ans  
- "Senior", "Lead", "Principal" → 5-12 ans
- "Staff", "Expert", "Architecte" → 8-15 ans
- "Director", "VP", "C-Level", "Head of" → 10-20 ans

INFÉRENCE PAR MOTS-CLÉS DESCRIPTION:
- "Autonomie", "leadership technique" → ajouter +2 ans au min
- "Encadrement d'équipe", "management" → min 5 ans
- "Stratégie", "vision" → min 8 ans
- "Première expérience OK", "profil évolutif" → max 5 ans

PLAGES PAR DÉFAUT (si aucun indice):
- Poste technique standard → 2-8 ans
- Poste avec "Senior" dans le titre → 5-12 ans
- Poste management → 7-15 ans

PRÉCISION OBLIGATOIRE:
- Retourner la plage EXACTE déduite du poste, SANS élargissement
- L'élargissement sera fait côté code, pas par toi
- Si le poste dit "3-5 ans", retourner exactement 3 et 5
- Si tu infères depuis le titre/séniorité, retourner la plage naturelle (ex: Senior → 5-10)
- Le scoring IA fera le filtrage fin ensuite

⚠️ FILTRES À ÉVITER (PEU FIABLES):
- Le filtre Secteur/Industrie LinkedIn est TRÈS peu fiable (30%+ de profils perdus). Préfère les feeder companies.
- Le filtre Année de diplôme est trompeur (bootcamps/MOOCs faussent les résultats).
- Les filtres à sélection préformatée (titres, compétences, taille) sont souvent imprécis → préfère le Boolean direct.

=== VARIABLES D'AJUSTEMENT (SPOTLIGHTS & OPEN TO WORK) ===
LinkedIn Recruiter propose des "spotlights" qui filtrent les profils par signal comportemental.
Valeurs VALIDES pour l'API Unipile:
- OPEN_TO_WORK: Profils déclarés ouverts aux opportunités → utile mais réduit le vivier
- ACTIVE_TALENT: Profils actifs sur LinkedIn récemment → NE PAS utiliser par défaut (réduit trop le vivier)
- REDISCOVERED_CANDIDATES: Candidats déjà identifiés/contactés → utile pour relance
- INTERNAL_CANDIDATES: Candidats internes à l'entreprise → rarement pertinent en sourcing externe
- INTERESTED_IN_YOUR_COMPANY: Profils ayant montré un intérêt pour l'entreprise → bon signal
- HAVE_COMPANY_CONNECTIONS: Profils avec des connexions dans l'entreprise → bon pour approche réseau

STRATÉGIE RECOMMANDÉE:
- suggest_spotlight: "" par défaut (ne PAS filtrer par spotlight, cela réduit trop le vivier)
- suggest_open_to_work: false par défaut (trop restrictif, réduit le vivier de 80%+)
- N'utiliser un spotlight que si l'utilisateur le demande explicitement

RÈGLES MÉTIER:
1. Pour un profil RARE, réduire à 1-2 groupes AND (moins restrictif)
2. Les critères MUST-HAVE techniques vont dans keywords, les soft-skills dans skills_to_search
3. open_to_work = false par défaut (trop restrictif sinon)
4. Toujours inclure des exclusions NOT pertinentes
5. suggest_spotlight = "" par défaut (JAMAIS ACTIVE_TALENT automatiquement)

⚠️ RÈGLE CRITIQUE - EXTRACTION LOCALISATION ET ENTREPRISE:
Tu DOIS extraire la localisation et le nom de l'entreprise/client depuis le texte du brief, même s'ils ne sont pas fournis dans des champs structurés.
- Si le brief mentionne une ville, région ou pays → retourner dans location_hint (ex: "Paris", "Lyon", "Île-de-France", "Remote France")
- Si le brief mentionne une entreprise cliente, un nom de société pour laquelle on recrute → retourner dans detected_company (le nom exact de l'entreprise)
- L'entreprise détectée sera EXCLUE de la recherche (on ne veut pas sourcer des gens qui y travaillent déjà)

Retourne UNIQUEMENT un objet JSON avec:
- keywords: string - Booléen LAYERED: "(catégorie1 OR alt1) AND (catégorie2 OR alt2) NOT (exclusion1 OR exclusion2)"
- role_keywords: string[] - UN élément avec titres FR+EN en OR (synonym ring exhaustif)
- years_experience_min: number - Expérience MIN en années (OBLIGATOIRE, jamais null)
- years_experience_max: number - Expérience MAX en années (OBLIGATOIRE, jamais null)
- skills_to_search: string[] - Soft-skills et compétences secondaires (max 10)
- certifications: string[] - Certifications pertinentes (max 3)
- industry_keywords: string[] - Secteurs (max 3) - ATTENTION: peu fiable, préférer feeder companies
- domain_expertise: string[] - Domaines métier + feeder companies (max 5)
- location_hint: string - Localisation extraite du brief ou des champs structurés. OBLIGATOIRE si mentionnée dans le texte.
- detected_company: string | null - Nom de l'entreprise/client détecté dans le brief. Sera exclu de la recherche.
- job_category: string - "tech", "business", "data", "product", "design", "other"
- suggest_open_to_work: boolean - false sauf si explicitement demandé
- suggest_spotlight: string - "" par défaut (ne jamais mettre ACTIVE_TALENT automatiquement). Valeurs valides: OPEN_TO_WORK, ACTIVE_TALENT, REDISCOVERED_CANDIDATES, INTERNAL_CANDIDATES, INTERESTED_IN_YOUR_COMPANY, HAVE_COMPANY_CONNECTIONS. Utiliser uniquement si demandé explicitement.
- suggested_title: string - Titre COURT de mission (max 50 chars), format: "Rôle — Entreprise" ou "Rôle — Ville". Ex: "Lead Dev React — Paris", "SRE Senior — Doctolib". PAS le texte brut du brief !
- keyword_rationale: string - Explication de la structure layered choisie (1 phrase)
- experience_rationale: string - Explication de la plage d'expérience (1 phrase)
- search_rationale: string - Stratégie globale en 1 phrase (mentionner Role/Work/Context)

=== POWER FILTERS (OBLIGATOIRE) ===
En plus des filtres de base, tu DOIS retourner ces champs avancés:
- tenure_at_role_max: number|null - Durée MAX dans le poste actuel en années. Si le recruteur cherche des profils "prêts à bouger", mettre 2-3 ans (les gens restent en moyenne 2.5 ans). Si le poste nécessite de la stabilité (management), mettre null.
- company_category: "startup"|"scaleup"|"enterprise"|null - Type d'entreprise cible. Déduis du contexte: startup funded, scale-up en croissance, grand groupe, ou null si pas de préférence.
- exclude_consulting: boolean - true si le poste est chez un client final (pas ESN/SSII). false par défaut. Déduis du contexte.
- feeder_companies: string[] - Entreprises "pépinières" où trouver ce type de profil (max 8). Exemples: pour un SRE → ["Datadog", "OVH", "Scaleway", "HashiCorp"]. Pour un PM → ["Google", "Meta", "Doctolib", "Alan"].
- seniority_levels: string[] - Niveaux de séniorité LinkedIn à cibler. Valeurs: "entry", "senior", "manager", "director", "vp", "c_suite", "owner". Déduis du titre + expérience.
- expanded_titles: string[] - Titres de poste ALTERNATIFS que l'IA recommande d'ajouter (max 6). Expansion intelligente basée sur le contexte. Ex: "SRE" → ["Platform Engineer", "Cloud Engineer", "Infrastructure Engineer", "DevOps Lead"].
- likely_to_switch_signals: string[] - Signaux que le candidat est ouvert au changement (pour le scoring, pas le filtrage). Ex: ["tenure courte au poste actuel", "promotion récente", "entreprise en restructuration"].

=== SUGGESTIONS D'AFFINAGE (OBLIGATOIRE) ===
En plus des filtres, tu DOIS retourner un objet "suggestions" avec des alternatives que l'utilisateur peut ajouter en un clic pour affiner sa recherche:
- alt_skills: string[] - Technologies/compétences ALTERNATIVES non incluses dans les filtres principaux mais pertinentes (max 8). Ex: si le filtre a "Kubernetes", suggérer "Docker", "Helm", "Rancher"
- alt_titles: string[] - Titres de poste alternatifs non inclus dans role_keywords (max 5). Ex: si le filtre a "SRE", suggérer "Platform Engineer", "Cloud Engineer"
- alt_locations: string[] - Villes ou régions proches ou alternatives (max 4). Ex: si le filtre a "Paris", suggérer "Île-de-France", "Lyon", "Remote France"
- alt_companies: string[] - Feeder companies ciblées où trouver ce type de profil (max 6). Ex: pour un SRE, suggérer "Datadog", "OVH", "Scaleway"
- alt_certifications: string[] - Certifications complémentaires pertinentes (max 4). Ex: "CKA", "AWS Solutions Architect"

NOTE: Ne PAS retourner de champ "seniority_levels" - utiliser uniquement years_experience_min/max.
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
${job.bodyContent ? `Contenu détaillé de la page du poste:\n${job.bodyContent.substring(0, 1000)}` : ''}
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
${transversal.context ? `Contexte: ${transversal.context}` : ''}
${transversal.bodyContent ? `Contenu détaillé critères transverses:\n${transversal.bodyContent.substring(0, 800)}` : ''}` : ''}
`.trim();

    console.log("[generate-search-filters] Calling AI with job:", job.title);

    // Helper function to call AI with retry logic for 529 errors
    const callAIWithRetry = async (maxRetries = 3): Promise<Response> => {
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
            method: "POST",
             headers: {
              "x-api-key": ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "prompt-caching-2024-07-31",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: resolvedModel,
              max_tokens: 2048,
              system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
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
          if (response.status === 529 || response.status === 503 || response.status === 500 || response.status === 502) {
            // Service overloaded or internal error - retry with exponential backoff
            const errorText = await response.text();
            console.warn(`[generate-search-filters] AI error ${response.status} (attempt ${attempt}/${maxRetries}):`, errorText?.slice(0, 500));
            
            if (attempt < maxRetries) {
              const delay = Math.pow(2, attempt) * 3000; // 6s, 12s, 24s — generous backoff for overloaded gateway
              console.log(`[generate-search-filters] Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw new Error("SERVICE_OVERLOADED");
          }

          // Other errors (4xx that shouldn't be retried)
          const errorText = await response.text();
          console.error("[generate-search-filters] AI error:", response.status, errorText?.slice(0, 500));
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
    const _tokensIn = aiResult.usage?.input_tokens || 0;
    const _tokensOut = aiResult.usage?.output_tokens || 0;
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
    // Priority: explicit job.client.name > AI-detected company from brief text
    const companyToExclude = job.client?.name || parsed.detected_company || null;
    if (companyToExclude) {
      companyKeywords.push({
        keywords: companyToExclude,
        priority: 'DOESNT_HAVE',
        scope: 'CURRENT_OR_PAST', // Exclure sur toutes les expériences
      });
      console.log(`[generate-search-filters] Excluding company: ${companyToExclude}`);
    }

    // === RÈGLE 2: Dé-prioriser les ESN (optionnel - on les exclut pas, on les note moins) ===
    // Note: On n'exclut pas les ESN car certains bons profils y sont, mais on peut les signaler
    // Pour l'instant on ne les ajoute pas en DOESNT_HAVE pour ne pas être trop restrictif

    // === RÈGLE 3: Écoles TOP X si demandé explicitement ===
    // Détecter si le poste mentionne "top 5", "top 10", "top 15", "top école", etc.
    const jobTextForSchools = `${job.description || ''} ${job.requirements || ''} ${job.sourcingCriteria || ''} ${job.mustHave || ''} ${job.shouldHave || ''}`.toLowerCase();
    
    // Regex pour détecter "top X" avec X = nombre ou "écoles"
    // Detect school requirements: "top X schools", "grandes écoles", "école de commerce", "business school", "école d'ingénieur"
    const topMatch = jobTextForSchools.match(/top\s*(\d+|écoles?|schools?|ingé|engineering|commerce|business)/i);
    const wantsEngineering = /ingé|engineering|technique|polytechnique/i.test(jobTextForSchools);
    const wantsBusiness = /commerce|business\s*school|gestion|management|MBA|finance/i.test(jobTextForSchools);
    const wantsGrandesEcoles = /grandes?\s*écoles?/i.test(jobTextForSchools);
    let schoolFilters: SchoolFilter[] = [];

    if (topMatch || wantsGrandesEcoles) {
      let topCount = TOP_SCHOOLS.length;
      const matchValue = topMatch?.[1]?.toLowerCase();

      if (matchValue && /^\d+$/.test(matchValue)) {
        topCount = Math.min(parseInt(matchValue, 10), TOP_SCHOOLS.length);
      } else if (matchValue?.includes('5') || matchValue === '5') {
        topCount = 5;
      } else if (matchValue?.includes('10') || matchValue === '10') {
        topCount = 10;
      }

      // Select the right school list based on context
      let selectedSchools;
      if (wantsBusiness && !wantsEngineering) {
        selectedSchools = TOP_BUSINESS_SCHOOLS.slice(0, topCount);
        console.log(`[generate-search-filters] Detected business school requirement (${selectedSchools.length} schools)`);
      } else if (wantsEngineering && !wantsBusiness) {
        selectedSchools = TOP_ENGINEERING_SCHOOLS.slice(0, topCount);
        console.log(`[generate-search-filters] Detected engineering school requirement (${selectedSchools.length} schools)`);
      } else {
        // Both or "grandes écoles" → all schools
        selectedSchools = TOP_SCHOOLS.slice(0, topCount);
        console.log(`[generate-search-filters] Detected TOP ${selectedSchools.length} schools requirement (all types)`);
      }

      schoolFilters = selectedSchools.map(school => ({
        id: school.id,
        name: school.name,
        priority: 'CAN_HAVE' as const,
      }));
    }

    // === RÈGLE 4: Adapter le rayon de recherche selon la politique remote ===
    // Default: 40km (~25 miles) - même pour hybrid car les gens ne déménagent pas pour du partiel
    let locationRadius: number | null = 25; // 25 miles ≈ 40km
    const remotePolicyForRadius = (job.remotePolicy || job.remote || '').toLowerCase();
    
    if (remotePolicyForRadius.includes('full') || remotePolicyForRadius.includes('100%') || remotePolicyForRadius === 'remote') {
      locationRadius = null; // Pas de limite = recherche nationale uniquement pour full remote
    }
    // Hybrid, partiel, présentiel → tous à 40km par défaut

    // === RÈGLE 5: Spotlight et Open to Work comme leviers d'ajustement ===
    const openToWork = parsed.suggest_open_to_work === true; // Default false (trop restrictif)
    const spotlight = parsed.suggest_spotlight || ''; // No default spotlight

    // === RÈGLE 6: Utiliser les valeurs de l'IA avec élargissement léger ===
    // L'IA retourne la plage EXACTE, on applique un léger élargissement côté code
    // Priorité: valeurs Notion (xpMin/xpMax) > valeurs IA (inférées)
    const rawXpMin = job.xpMin ?? parsed.years_experience_min ?? null;
    const rawXpMax = job.xpMax ?? parsed.years_experience_max ?? null;
    
    // Élargissement minimal: -1 an sur min, +2 ans sur max
    const widenedXpMin = rawXpMin !== null ? Math.max(0, rawXpMin - 1) : null;
    const widenedXpMax = rawXpMax !== null ? rawXpMax + 2 : null;
    
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
      seniority: [], // Ne pas remplir - on utilise years_of_experience à la place
      years_of_experience_min: finalXpMin,
      years_of_experience_max: finalXpMax,
      skills_keywords: allSkillsKeywords, // Now includes certifications and domain expertise
      industry_keywords: parsed.industry_keywords || [],
      location_keywords: job.location ? [job.location] : (parsed.location_hint ? [parsed.location_hint] : []),
      location_within_area: locationRadius,
      company_keywords: companyKeywords,
      school: schoolFilters,
      spotlight: spotlight,
      open_to_work: openToWork,
    };

    console.log("[generate-search-filters] Generated filters:", JSON.stringify(filters, null, 2));

    // Settle credits (fire-and-forget)
    if (_tokensIn + _tokensOut > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const svcSettle = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const orgId = auth.userId ? await resolveOrgIdFromUser(auth.userId, svcSettle) : null;
        if (orgId && auth.userId) {
          // Verify user still belongs to the resolved org before billing credits
          const { verifyOrgMembership } = await import("../_shared/require-auth.ts");
          const isMember = await verifyOrgMembership(svcSettle, auth.userId, orgId);
          if (!isMember) {
            console.warn("[generate-search-filters] settle skipped: user is not a member of org", orgId);
          } else {
            const { settleCredits } = await import("../_shared/settle-credits.ts");
            await settleCredits(svcSettle, {
              organizationId: orgId, userId: auth.userId!,
              aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
              tokensInput: _tokensIn, tokensOutput: _tokensOut,
              description: _aiParams.description,
            }).catch((e: unknown) => console.error("[generate-search-filters] settle error:", e));
          }
        }
      } catch (e) { console.warn("[generate-search-filters] settle skipped:", e); }
    }

    return new Response(
      JSON.stringify({
        success: true,
        filters,
        analysis: {
          search_rationale: parsed.search_rationale || null,
          keyword_rationale: parsed.keyword_rationale || null,
          experience_rationale: parsed.experience_rationale || null,
          role_keywords: parsed.role_keywords || [],
          skills_to_search: parsed.skills_to_search || [],
          certifications: parsed.certifications || [],
          domain_expertise: parsed.domain_expertise || [],
          location_hint: parsed.location_hint || null,
          job_category: parsed.job_category || 'other',
          years_experience_min: parsed.years_experience_min ?? null,
          years_experience_max: parsed.years_experience_max ?? null,
          suggested_title: parsed.suggested_title || null,
        },
        suggestions: {
          alt_skills: parsed.alt_skills || [],
          alt_titles: parsed.alt_titles || [],
          alt_locations: parsed.alt_locations || [],
          alt_companies: parsed.alt_companies || [],
          alt_certifications: parsed.alt_certifications || [],
        },
        power_filters: {
          tenure_at_role_max: parsed.tenure_at_role_max ?? null,
          company_category: parsed.company_category || null,
          exclude_consulting: parsed.exclude_consulting === true,
          feeder_companies: parsed.feeder_companies || [],
          seniority_levels: parsed.seniority_levels || [],
          expanded_titles: parsed.expanded_titles || [],
          likely_to_switch_signals: parsed.likely_to_switch_signals || [],
        },
      }),
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