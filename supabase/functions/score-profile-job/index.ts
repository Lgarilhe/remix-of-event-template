import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: {
    retries?: number;
    baseDelayMs?: number;
    retryStatusCodes?: number[];
  }
): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 600;
  const retryStatusCodes = opts?.retryStatusCodes ?? [500, 502, 503, 504, 529, 408];

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);
    lastResponse = res;

    // Success
    if (res.ok) return res;

    // Retry only on transient upstream issues
    const shouldRetry = retryStatusCodes.includes(res.status);
    if (!shouldRetry || attempt === retries) return res;

    const delay = Math.round(baseDelayMs * Math.pow(2, attempt));
    console.warn(`[score-profile-job] transient AI error ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
    await sleep(delay);
  }

  // Should be unreachable
  return lastResponse!;
}

interface WorkExperienceItem {
  role: string;
  company: string;
  duration?: string;
  durationMonths?: number;
  description?: string;
  skills?: string[];
}

interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  summary?: string;                      // LinkedIn "About" section
  workExperience?: WorkExperienceItem[]; // Enriched work history
  pastPositions?: string[];              // Legacy format for backward compatibility
  education?: string[];
  yearsOfExperience?: number;
  // NEW: Tenure analysis
  averageTenureMonths?: number | null;   // Average time at each position
  // NEW: Receptivity signals
  openToWork?: boolean;                  // Actively looking
  openProfile?: boolean;                 // Can receive free InMail
  networkDistance?: number | null;       // 1st, 2nd, 3rd degree
}

// Skill synonyms for semantic matching
const SKILL_SYNONYMS: Record<string, string[]> = {
  'kubernetes': ['k8s', 'kube', 'container orchestration'],
  'javascript': ['js', 'ecmascript', 'es6', 'es2015'],
  'typescript': ['ts'],
  'python': ['py', 'python3'],
  'react': ['reactjs', 'react.js'],
  'vue': ['vuejs', 'vue.js'],
  'angular': ['angularjs', 'angular.js'],
  'node': ['nodejs', 'node.js'],
  'postgres': ['postgresql', 'psql', 'pg'],
  'mongodb': ['mongo'],
  'redis': ['redis cache'],
  'elasticsearch': ['elastic', 'es'],
  'docker': ['containers', 'containerization'],
  'aws': ['amazon web services', 'amazon aws'],
  'gcp': ['google cloud', 'google cloud platform'],
  'azure': ['microsoft azure'],
  'ci/cd': ['cicd', 'continuous integration', 'continuous deployment', 'devops'],
  'machine learning': ['ml', 'deep learning', 'ai'],
  'api': ['rest api', 'restful', 'graphql'],
  'agile': ['scrum', 'kanban'],
  'sql': ['mysql', 'mariadb', 'sqlite'],
  'java': ['jvm', 'spring', 'spring boot'],
  'go': ['golang'],
  'rust': ['rustlang'],
  'terraform': ['iac', 'infrastructure as code'],
  'kafka': ['event streaming', 'message queue'],
  'rabbitmq': ['message broker', 'amqp'],
};

interface JobData {
  id: string;
  title: string;
  client?: { name: string; sector: string } | null;
  skills: string[];
  requirements?: string;
  description?: string;
  seniority?: string;
  location?: string;
  remote?: string;
  xpMin?: number;
  xpMax?: number;
  // Salary information
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string; // CDI, Freelance, etc.
  // Scoring criteria from job
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  // Transversal criteria (company-wide requirements)
  transversalCriteria?: {
    must?: string;
    should?: string;
    niceToHave?: string;
    context?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile, job, profiles } = await req.json() as {
      profile?: ProfileData;
      job: JobData;
      profiles?: ProfileData[];
    };
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Handle batch scoring
    const profilesToScore = profiles || (profile ? [profile] : []);
    
    if (profilesToScore.length === 0) {
      throw new Error("No profile(s) provided");
    }

    // Format salary info for prompt
    const formatSalaryInfo = (job: JobData): string => {
      const parts: string[] = [];
      
      if (job.salaryMin || job.salaryMax) {
        if (job.salaryMin && job.salaryMax) {
          parts.push(`Salaire: ${job.salaryMin}k€ - ${job.salaryMax}k€ brut/an`);
        } else if (job.salaryMin) {
          parts.push(`Salaire minimum: ${job.salaryMin}k€ brut/an`);
        } else if (job.salaryMax) {
          parts.push(`Salaire maximum: ${job.salaryMax}k€ brut/an`);
        }
      }
      
      if (job.tjmMin || job.tjmMax) {
        if (job.tjmMin && job.tjmMax) {
          parts.push(`TJM: ${job.tjmMin}€ - ${job.tjmMax}€/jour`);
        } else if (job.tjmMin) {
          parts.push(`TJM minimum: ${job.tjmMin}€/jour`);
        } else if (job.tjmMax) {
          parts.push(`TJM maximum: ${job.tjmMax}€/jour`);
        }
      }
      
      if (job.contractType) {
        parts.push(`Type de contrat: ${job.contractType}`);
      }
      
      return parts.length > 0 ? parts.join('\n') : 'Rémunération: Non spécifiée (à estimer)';
    };

    // Batch processing to avoid rate limits: 3 profiles at a time with 1.5s delay
    const BATCH_SIZE = 3;
    const DELAY_BETWEEN_BATCHES_MS = 1500;
    const results: any[] = [];

    for (let i = 0; i < profilesToScore.length; i += BATCH_SIZE) {
      const batch = profilesToScore.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (p) => {
        try {
          const profileSkills = (p.skills || []).map(s => s.toLowerCase());
          const jobSkills = (job.skills || []).map(s => s.toLowerCase());
          
          // Semantic skill matching function
          const skillsMatch = (profileSkill: string, jobSkill: string): boolean => {
            // Direct match (partial)
            if (profileSkill.includes(jobSkill) || jobSkill.includes(profileSkill)) {
              return true;
            }
            // Check synonyms
            for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
              const allVariants = [canonical, ...synonyms];
              const profileMatches = allVariants.some(v => profileSkill.includes(v) || v.includes(profileSkill));
              const jobMatches = allVariants.some(v => jobSkill.includes(v) || v.includes(jobSkill));
              if (profileMatches && jobMatches) {
                return true;

    // Return single result or array based on input
    const responseData = profiles ? { results } : { result: results[0] };

    return new Response(
      JSON.stringify({ success: true, ...responseData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in score-profile-job:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
