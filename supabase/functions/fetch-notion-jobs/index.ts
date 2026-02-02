import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// Pin + target=deno to reduce cold-start flakiness / upstream bundle changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Must match what the browser sends to functions.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POSTES_DATABASE_ID = "2787e1816fb481d2a0e8d4b2c1dd38f9";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

console.log('[fetch-notion-jobs] boot', {
  hasNotionKey: Boolean(NOTION_API_KEY),
  hasLovableKey: Boolean(LOVABLE_API_KEY),
  hasSupabaseUrl: Boolean(SUPABASE_URL),
  hasServiceRole: Boolean(SUPABASE_SERVICE_ROLE_KEY),
});

// Cache expiry for skills: 24 hours
// Cache expiry for jobs list: 5 minutes (with stale-while-revalidate)
const JOBS_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Initialize Supabase client with service role for cache operations
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Get cached skills from database
async function getCachedSkills(jobIds: string[]): Promise<Map<string, string[]>> {
  const skillsMap = new Map<string, string[]>();
  
  try {
    const { data, error } = await supabase
      .from('job_skills_cache')
      .select('job_id, skills, updated_at')
      .in('job_id', jobIds);
    
    if (error) {
      console.error('Failed to fetch cached skills:', error);
      return skillsMap;
    }
    
    const now = new Date().getTime();
    for (const row of data || []) {
      const updatedAt = new Date(row.updated_at).getTime();
      // Only use cache if not expired
      if (now - updatedAt < CACHE_TTL_MS) {
        skillsMap.set(row.job_id, row.skills || []);
      }
    }
  } catch (error) {
    console.error('Cache fetch error:', error);
  }
  
  return skillsMap;
}

// Save skills to cache
async function cacheSkills(skillsMap: Map<string, string[]>): Promise<void> {
  try {
    const records = Array.from(skillsMap.entries()).map(([jobId, skills]) => ({
      job_id: jobId,
      skills: skills,
      source: 'ai',
      updated_at: new Date().toISOString(),
    }));
    
    if (records.length === 0) return;
    
    const { error } = await supabase
      .from('job_skills_cache')
      .upsert(records, { onConflict: 'job_id' });
    
    if (error) {
      console.error('Failed to cache skills:', error);
    }
  } catch (error) {
    console.error('Cache save error:', error);
  }
}

// Extract technical skills using Lovable AI
async function extractSkillsWithAI(jobs: Array<{
  id: string;
  title: string;
  description: string;
  requirements: string;
}>): Promise<Map<string, string[]>> {
  const skillsMap = new Map<string, string[]>();
  
  if (!LOVABLE_API_KEY) {
    console.warn('LOVABLE_API_KEY not configured, skipping AI skill extraction');
    return skillsMap;
  }

  // Build a batch prompt for all jobs
  const jobsContext = jobs
    .filter(job => job.title || job.requirements || job.description)
    .map(job => `
[Job ID: ${job.id}]
Titre: ${job.title}
Requirements: ${job.requirements}
Description: ${job.description}
`).join('\n---\n');

  if (!jobsContext.trim()) {
    return skillsMap;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Tu es un expert en recrutement tech. Extrais les compétences techniques de chaque offre d'emploi.
Retourne UNIQUEMENT un JSON valide avec ce format exact:
{
  "job_id_1": ["skill1", "skill2"],
  "job_id_2": ["skill1", "skill2"]
}

Règles:
- Extrais uniquement les technologies, langages, frameworks, outils (ex: Python, React, Kubernetes, AWS, SQL, Git)
- Normalise les noms (ex: "JS" -> "JavaScript", "K8s" -> "Kubernetes")
- Maximum 10 skills par poste, les plus importants
- Pas de soft skills, pas de descriptions de poste
- Retourne un objet JSON valide, rien d'autre`
          },
          {
            role: 'user',
            content: `Extrais les compétences techniques de ces offres:\n\n${jobsContext}`
          }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error('Lovable AI error:', response.status, await response.text());
      return skillsMap;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse the JSON response
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      const skillsData = JSON.parse(cleanContent);
      
      for (const [jobId, skills] of Object.entries(skillsData)) {
        if (Array.isArray(skills)) {
          skillsMap.set(jobId, skills.filter((s): s is string => typeof s === 'string'));
        }
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, content);
    }
  } catch (error) {
    console.error('AI skill extraction failed:', error);
  }

  return skillsMap;
}

interface NotionProperty {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  select?: { name: string };
  multi_select?: Array<{ name: string }>;
  number?: number;
  url?: string;
  relation?: Array<{ id: string }>;
  status?: { name: string };
  date?: { start: string; end?: string };
}

interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

interface CandidateCounts {
  cv: number;
  itw: number;
  offre: number;
  total: number;
}

function getPropertyValue(property: NotionProperty): any {
  if (!property) return null;
  
  switch (property.type) {
    case 'title':
      return property.title?.[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text?.map(t => t.plain_text).join('') || '';
    case 'select':
      return property.select?.name || null;
    case 'multi_select':
      return property.multi_select?.map(s => s.name) || [];
    case 'number':
      return property.number;
    case 'url':
      return property.url;
    case 'relation':
      return property.relation?.map(r => r.id) || [];
    case 'status':
      return property.status?.name || null;
    case 'date':
      return property.date?.start || null;
    default:
      return null;
  }
}

function getTitleFromProperties(properties: Record<string, NotionProperty>): string {
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'title') {
      return prop.title?.[0]?.plain_text || 'Sans titre';
    }
  }
  return 'Sans titre';
}

async function fetchNotionDatabase(databaseId: string, filter?: any) {
  const body: any = { page_size: 100 };
  if (filter) {
    body.filter = filter;
  }
  
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${error}`);
  }

  return response.json();
}

async function fetchCompanyDetails(companyIds: string[]): Promise<Map<string, any>> {
  const companies = new Map();
  
  for (const id of companyIds) {
    try {
      const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        headers: {
          'Authorization': `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
        },
      });
      
      if (response.ok) {
        const page = await response.json();
        const name = getTitleFromProperties(page.properties);
        
        companies.set(id, {
          id,
          name,
          sector: getPropertyValue(page.properties['Secteur']),
          size: getPropertyValue(page.properties['Taille']),
          website: getPropertyValue(page.properties['Site web']),
          linkedin: getPropertyValue(page.properties['LinkedIn']),
        });
      }
    } catch (error) {
      console.error(`Failed to fetch company ${id}:`, error);
    }
  }
  
  return companies;
}

// Fetch transversal criteria from linked Notion pages
interface TransversalCriteria {
  must: string;
  should: string;
  niceToHave: string;
  context: string;
  domain: string;
  level: string;
}

async function fetchTransversalCriteria(criteriaIds: string[]): Promise<Map<string, TransversalCriteria>> {
  const criteriaMap = new Map<string, TransversalCriteria>();
  
  if (criteriaIds.length === 0) return criteriaMap;
  
  // Batch fetch all unique criteria IDs
  const uniqueIds = [...new Set(criteriaIds)];
  
  await Promise.all(uniqueIds.map(async (id) => {
    try {
      const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        headers: {
          'Authorization': `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
        },
      });
      
      if (response.ok) {
        const page = await response.json();
        
        criteriaMap.set(id, {
          must: getPropertyValue(page.properties['Critères Must']) || '',
          should: getPropertyValue(page.properties['Critères Should']) || '',
          niceToHave: getPropertyValue(page.properties['Critères Nice to have']) || '',
          context: getPropertyValue(page.properties['Contexte']) || '',
          domain: getPropertyValue(page.properties['Domaine']) || '',
          level: getPropertyValue(page.properties['Niveau']) || '',
        });
      }
    } catch (error) {
      console.error(`Failed to fetch transversal criteria ${id}:`, error);
    }
  }));
  
  return criteriaMap;
}

// Merge multiple transversal criteria into one object
function mergeTransversalCriteria(
  criteriaIds: string[], 
  criteriaMap: Map<string, TransversalCriteria>
): TransversalCriteria | null {
  if (criteriaIds.length === 0) return null;
  
  const merged: TransversalCriteria = {
    must: '',
    should: '',
    niceToHave: '',
    context: '',
    domain: '',
    level: '',
  };
  
  const mustParts: string[] = [];
  const shouldParts: string[] = [];
  const niceToHaveParts: string[] = [];
  const contextParts: string[] = [];
  const domains: string[] = [];
  const levels: string[] = [];
  
  for (const id of criteriaIds) {
    const criteria = criteriaMap.get(id);
    if (criteria) {
      if (criteria.must) mustParts.push(criteria.must);
      if (criteria.should) shouldParts.push(criteria.should);
      if (criteria.niceToHave) niceToHaveParts.push(criteria.niceToHave);
      if (criteria.context) contextParts.push(criteria.context);
      if (criteria.domain) domains.push(criteria.domain);
      if (criteria.level) levels.push(criteria.level);
    }
  }
  
  merged.must = mustParts.join('\n\n');
  merged.should = shouldParts.join('\n\n');
  merged.niceToHave = niceToHaveParts.join('\n\n');
  merged.context = contextParts.join('\n\n');
  merged.domain = [...new Set(domains)].join(', ');
  merged.level = [...new Set(levels)].join(', ');
  
  // Return null if all fields are empty
  if (!merged.must && !merged.should && !merged.niceToHave && !merged.context) {
    return null;
  }
  
  return merged;
}

async function fetchCandidateCounts(jobIds: string[]): Promise<Map<string, CandidateCounts>> {
  const countsMap = new Map<string, CandidateCounts>();
  
  // Initialize counts for all jobs
  jobIds.forEach(id => {
    countsMap.set(id, { cv: 0, itw: 0, offre: 0, total: 0 });
  });

  try {
    // Fetch all shortlist entries that are in active stages
    const activeStages = ['CV envoyé', 'ITW 1', 'ITW 2', 'ITW 3', 'ITW Final', 'Offre', 'Pré-qualif', 'Contacté', 'Pressenti'];
    
    const shortlistData = await fetchNotionDatabase(SHORTLIST_DATABASE_ID, {
      property: 'Etape',
      select: {
        is_not_empty: true
      }
    });

    const shortlistEntries: NotionPage[] = shortlistData.results;

    for (const entry of shortlistEntries) {
      const etape = getPropertyValue(entry.properties['Etape']);
      const posteIds = getPropertyValue(entry.properties['💼 Postes']) || [];

      for (const posteId of posteIds) {
        const current = countsMap.get(posteId) || { cv: 0, itw: 0, offre: 0, total: 0 };
        
        // Count by stage category
        if (['CV envoyé', 'Pré-qualif', 'Contacté', 'Pressenti'].includes(etape)) {
          current.cv++;
        } else if (['ITW 1', 'ITW 2', 'ITW 3', 'ITW Final'].includes(etape)) {
          current.itw++;
        } else if (etape === 'Offre') {
          current.offre++;
        }
        
        // Only count active stages in total
        if (activeStages.includes(etape)) {
          current.total++;
        }
        
        countsMap.set(posteId, current);
      }
    }
  } catch (error) {
    console.error('Failed to fetch candidate counts:', error);
  }

  return countsMap;
}

// Helper to get/set jobs cache
async function getJobsCache(): Promise<{ payload: any | null; ageMs: number | null }> {
  try {
    const { data, error } = await supabase
      .from('notion_api_cache')
      .select('cache_key, payload, updated_at')
      .eq('cache_key', 'notion:jobs:v1')
      .maybeSingle();

    if (error || !data) return { payload: null, ageMs: null };
    const updatedAtMs = new Date(data.updated_at).getTime();
    const ageMs = Date.now() - updatedAtMs;
    return { payload: data.payload, ageMs };
  } catch {
    return { payload: null, ageMs: null };
  }
}

async function setJobsCache(payload: unknown): Promise<void> {
  try {
    await supabase
      .from('notion_api_cache')
      .upsert({
        cache_key: 'notion:jobs:v1',
        payload,
        updated_at: new Date().toISOString(),
      });
  } catch (e) {
    console.error('Jobs cache write error:', e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    // Parse pagination parameters from query string or body
    const url = new URL(req.url);
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON, use defaults
    }
    
    const page = parseInt(url.searchParams.get('page') || body.page || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || body.limit || '20', 10);
    const skipPagination = url.searchParams.get('all') === 'true' || body.all === true;
    const forceRefresh = url.searchParams.get('refresh') === 'true' || body.refresh === true;

    // STALE-WHILE-REVALIDATE: Return cached data immediately if available
    const cached = await getJobsCache();
    const isFresh = cached.payload && cached.ageMs !== null && cached.ageMs < JOBS_CACHE_TTL_MS;
    
    if (cached.payload && !forceRefresh) {
      // If cache is fresh, just return it
      if (isFresh) {
        return new Response(
          JSON.stringify({ ...cached.payload, cached: true, stale: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // If cache is stale but exists, return it with stale flag
      return new Response(
        JSON.stringify({ 
          ...cached.payload, 
          cached: true, 
          stale: true,
          ageMs: cached.ageMs 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch jobs from Notion - only active ones (Publié status)
    const jobsData = await fetchNotionDatabase(POSTES_DATABASE_ID, {
      property: 'État',
      status: {
        equals: 'Publié'
      }
    });
    const jobs: NotionPage[] = jobsData.results;

    // Collect all company IDs, job IDs, and transversal criteria IDs
    const companyIds = new Set<string>();
    const transversalCriteriaIds = new Set<string>();
    const jobIds: string[] = [];
    
    jobs.forEach((job) => {
      jobIds.push(job.id);
      const clientRelation = job.properties['Client'];
      if (clientRelation?.type === 'relation') {
        clientRelation.relation?.forEach(r => companyIds.add(r.id));
      }
      // Collect transversal criteria IDs
      const criteriaRelation = job.properties['Critères Transverses Numspot'];
      if (criteriaRelation?.type === 'relation') {
        criteriaRelation.relation?.forEach(r => transversalCriteriaIds.add(r.id));
      }
    });

    // Fetch company details, candidate counts, cached skills, and transversal criteria in parallel
    const [companies, candidateCounts, cachedSkills, transversalCriteriaMap] = await Promise.all([
      fetchCompanyDetails(Array.from(companyIds)),
      fetchCandidateCounts(jobIds),
      getCachedSkills(jobIds),
      fetchTransversalCriteria(Array.from(transversalCriteriaIds))
    ]);

    // Find jobs that need AI skill extraction (not in cache)
    const jobsNeedingSkills = jobs
      .filter((job) => !cachedSkills.has(job.id))
      .map((job) => ({
        id: job.id,
        title: getTitleFromProperties(job.properties),
        description: getPropertyValue(job.properties['RAG — Synthèse']) || '',
        requirements: getPropertyValue(job.properties['🔴 Must-have poste']) || '',
      }));

    // Extract skills using AI only for uncached jobs
    let aiSkillsMap = new Map<string, string[]>();
    if (jobsNeedingSkills.length > 0) {
      console.log(`Extracting skills for ${jobsNeedingSkills.length} jobs via AI...`);
      aiSkillsMap = await extractSkillsWithAI(jobsNeedingSkills);
      
      // Cache the newly extracted skills
      if (aiSkillsMap.size > 0) {
        await cacheSkills(aiSkillsMap);
      }
    }

    // Merge cached and new AI skills
    const allSkillsMap = new Map([...cachedSkills, ...aiSkillsMap]);

    // Transform jobs data
    const transformedJobs = jobs.map((job) => {
      const clientIds = getPropertyValue(job.properties['Client']) || [];
      const clientDetails = clientIds.map((id: string) => companies.get(id)).filter(Boolean);
      
      const contractTypeValue = getPropertyValue(job.properties['Type de contrat']);
      const contractType = Array.isArray(contractTypeValue) 
        ? contractTypeValue.join(', ') 
        : contractTypeValue;

      const counts = candidateCounts.get(job.id) || { cv: 0, itw: 0, offre: 0, total: 0 };

      // Get skills: prefer Notion field, fallback to AI-extracted/cached
      const notionSkills = getPropertyValue(job.properties['Skills sourcing'])?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
      const aiSkills = allSkillsMap.get(job.id) || [];
      const skills = notionSkills.length > 0 ? notionSkills : aiSkills;

      // Resolve transversal criteria from linked pages
      const criteriaIds = getPropertyValue(job.properties['Critères Transverses Numspot']) || [];
      const transversalCriteria = mergeTransversalCriteria(criteriaIds, transversalCriteriaMap);

      return {
        id: job.id,
        title: getTitleFromProperties(job.properties),
        client: clientDetails[0] || null,
        status: getPropertyValue(job.properties['État']),
        seniority: getPropertyValue(job.properties['Séniorité']),
        contractType: contractType,
        location: getPropertyValue(job.properties['Localisation']),
        remote: getPropertyValue(job.properties['Politique de remote']),
        salaryMin: getPropertyValue(job.properties['Salaire budget']),
        salaryMax: getPropertyValue(job.properties['Salaire maximum']),
        priority: getPropertyValue(job.properties['Priorité']),
        skills: skills,
        entity: getPropertyValue(job.properties['Entité']),
        description: getPropertyValue(job.properties['RAG — Synthèse']) || '',
        interviewProcess: getPropertyValue(job.properties['Process']) || '',
        // Scoring criteria from job
        mustHave: getPropertyValue(job.properties['🔴 Must-have poste']) || '',
        shouldHave: getPropertyValue(job.properties['🟡 Should-have poste']) || '',
        niceToHave: getPropertyValue(job.properties['🟢 Nice-to-have poste']) || '',
        // Keep requirements for backward compatibility
        requirements: getPropertyValue(job.properties['🔴 Must-have poste']) || '',
        openingDate: getPropertyValue(job.properties['Date d\'ouverture']),
        startDate: getPropertyValue(job.properties['Date de démarrage espérée']),
        channel: getPropertyValue(job.properties['Canal de publication']),
        sourcingCriteria: getPropertyValue(job.properties['Critères sourcing']) || '',
        teamInfo: getPropertyValue(job.properties['Équipe (client)']) || '',
        xpMin: getPropertyValue(job.properties['XP minimum']),
        xpMax: getPropertyValue(job.properties['XP maximum']),
        tjm: getPropertyValue(job.properties['TJM']),
        accompagnement: getPropertyValue(job.properties['Type d\'accompagnement']) || [],
        jobUrl: getPropertyValue(job.properties['userDefined:URL']),
        // Resolved transversal criteria (company-wide requirements)
        transversalCriteria: transversalCriteria,
        // Candidate counts by stage
        candidateCounts: counts,
      };
    });

    // Apply pagination
    const total = transformedJobs.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedJobs = skipPagination 
      ? transformedJobs 
      : transformedJobs.slice(startIndex, startIndex + limit);

    const responsePayload = { 
      success: true, 
      jobs: paginatedJobs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      }
    };

    // Cache the response (full jobs list for maximum cache efficiency)
    if (skipPagination || page === 1) {
      await setJobsCache({ success: true, jobs: transformedJobs, pagination: { total, totalPages: 1 } });
    }

    return new Response(
      JSON.stringify(responsePayload),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching Notion jobs:', errorMessage);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
