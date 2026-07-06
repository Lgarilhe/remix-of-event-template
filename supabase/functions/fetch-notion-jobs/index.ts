// Deno.serve used directly
// Pin + target=deno to reduce cold-start flakiness / upstream bundle changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Must match what the browser sends to functions.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const HAS_AI_KEY = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

/** Per-request Notion credentials — resolved inside handler, passed to helpers. */
interface NotionCreds { notionApiKey: string; postesDatabaseId?: string; shortlistDatabaseId?: string; }

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchWithTimeout(url, options);
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
      await new Promise(r => setTimeout(r, (retryAfter * 1000) + Math.random() * 500));
      continue;
    }
    if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
      continue;
    }
    return res;
  }
  return fetchWithTimeout(url, options);
}

console.log('[fetch-notion-jobs] boot', {
  hasAnthropicKey: HAS_AI_KEY,
  hasSupabaseUrl: Boolean(SUPABASE_URL),
  hasServiceRole: Boolean(SUPABASE_SERVICE_ROLE_KEY),
});

// Resolve per-organization Notion credentials (no global fallback)
async function resolveOrgCredentials(orgId: string) {
  const { data, error } = await supabase
    .from('organization_integrations')
    .select('notion_api_key, notion_postes_db_id, notion_shortlist_db_id, notion_connected')
    .eq('organization_id', orgId)
    .single();

  if (error || !data?.notion_connected || !data.notion_api_key) {
    throw new Error('Intégration Notion non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  console.log('[fetch-notion-jobs] Using org-specific Notion credentials for org:', orgId);
  return {
    notionApiKey: data.notion_api_key,
    postesDatabaseId: data.notion_postes_db_id || undefined,
    shortlistDatabaseId: data.notion_shortlist_db_id || undefined,
  } as NotionCreds;
}

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
}>, settle?: { userId?: string | null; organizationId?: string | null }): Promise<Map<string, string[]>> {
  const skillsMap = new Map<string, string[]>();
  
  if (!HAS_AI_KEY) {
    console.warn('ANTHROPIC_API_KEY not configured, skipping AI skill extraction');
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
    const result = await callClaudeCompat({
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
      max_tokens: 2500,
      timeoutMs: 30000,
    });

    await settleClaudeUsage({ userId: settle?.userId, organizationId: settle?.organizationId, aiAction: "notion_job_skills", usage: result.usage, modelId: result.model });

    const content = result.content;
    
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

async function fetchNotionDatabase(databaseId: string, notionApiKey: string, filter?: any) {
  const body: any = { page_size: 100 };
  if (filter) {
    body.filter = filter;
  }

  const response = await fetchWithRetry(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
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

// Notion database queries return max 100 rows per call. To avoid missing items (e.g. a published job
// that ends up beyond the first page), paginate until has_more=false.
async function fetchNotionDatabaseAll(databaseId: string, notionApiKey: string, filter?: any): Promise<{ results: NotionPage[] }> {
  const results: NotionPage[] = [];
  let startCursor: string | null = null;

  for (let i = 0; i < 50; i++) { // safety cap: 50 * 100 = 5000 rows
    const body: any = { page_size: 100 };
    if (filter) body.filter = filter;
    if (startCursor) body.start_cursor = startCursor;

    const response = await fetchWithRetry(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error: ${error}`);
    }

    const data = await response.json();
    results.push(...(data?.results || []));

    if (!data?.has_more) break;
    startCursor = data?.next_cursor || null;
    if (!startCursor) break;
  }

  return { results };
}

async function getTitlePropertyName(databaseId: string, notionApiKey: string): Promise<string> {
  const response = await fetchWithRetry(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error (database schema): ${error}`);
  }

  const db = await response.json();
  const props = db?.properties || {};
  for (const [name, prop] of Object.entries(props)) {
    if ((prop as any)?.type === 'title') return name;
  }
  // Fallback (should never happen)
  return 'Name';
}

async function fetchCompanyDetails(companyIds: string[], notionApiKey: string): Promise<Map<string, any>> {
  const companies = new Map();

  for (const id of companyIds) {
    try {
      const response = await fetchWithRetry(`https://api.notion.com/v1/pages/${id}`, {
        headers: {
          'Authorization': `Bearer ${notionApiKey}`,
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
  bodyContent: string;
}

// Fetch page body content (blocks/children) and convert to plain text
async function fetchPageBody(pageId: string, notionApiKey: string): Promise<string> {
  const textParts: string[] = [];
  let startCursor: string | undefined;

  for (let i = 0; i < 10; i++) { // safety cap: 10 pages of blocks
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set('page_size', '100');
    if (startCursor) url.searchParams.set('start_cursor', startCursor);

    const response = await fetchWithRetry(url.toString(), {
      headers: {
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch blocks for ${pageId}:`, response.status);
      break;
    }

    const data = await response.json();
    const blocks = data?.results || [];

    for (const block of blocks) {
      const type = block.type;
      const content = block[type];
      if (!content) continue;

      // Extract text from rich_text arrays (most block types have this)
      if (content.rich_text && Array.isArray(content.rich_text)) {
        const text = content.rich_text.map((t: any) => t.plain_text || '').join('');
        if (text.trim()) {
          // Add prefix based on block type
          if (type === 'heading_1') textParts.push(`# ${text}`);
          else if (type === 'heading_2') textParts.push(`## ${text}`);
          else if (type === 'heading_3') textParts.push(`### ${text}`);
          else if (type === 'bulleted_list_item' || type === 'numbered_list_item') textParts.push(`- ${text}`);
          else if (type === 'to_do') textParts.push(`- [${content.checked ? 'x' : ' '}] ${text}`);
          else textParts.push(text);
        }
      }
      // Handle table rows
      if (type === 'table_row' && content.cells) {
        const row = content.cells.map((cell: any[]) => 
          cell.map((t: any) => t.plain_text || '').join('')
        ).join(' | ');
        if (row.trim()) textParts.push(`| ${row} |`);
      }
    }

    if (!data?.has_more) break;
    startCursor = data?.next_cursor;
    if (!startCursor) break;
  }

  return textParts.join('\n');
}

// Batch fetch page bodies with concurrency control
async function fetchPageBodies(pageIds: string[], notionApiKey: string, concurrency = 5): Promise<Map<string, string>> {
  const bodiesMap = new Map<string, string>();
  const uniqueIds = [...new Set(pageIds)];

  // Process in batches to avoid rate limiting
  for (let i = 0; i < uniqueIds.length; i += concurrency) {
    const batch = uniqueIds.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (id) => {
      try {
        const body = await fetchPageBody(id, notionApiKey);
        return { id, body };
      } catch (error) {
        console.error(`Failed to fetch body for ${id}:`, error);
        return { id, body: '' };
      }
    }));
    for (const { id, body } of results) {
      if (body.trim()) bodiesMap.set(id, body);
    }
  }
  
  return bodiesMap;
}

async function fetchTransversalCriteria(criteriaIds: string[], notionApiKey: string): Promise<Map<string, TransversalCriteria>> {
  const criteriaMap = new Map<string, TransversalCriteria>();

  if (criteriaIds.length === 0) return criteriaMap;

  // Batch fetch all unique criteria IDs
  const uniqueIds = [...new Set(criteriaIds)];

  // Fetch properties and bodies in parallel
  const [_, bodiesMap] = await Promise.all([
    Promise.resolve(), // placeholder for parallel structure
    fetchPageBodies(uniqueIds, notionApiKey),
  ]);

  await Promise.all(uniqueIds.map(async (id) => {
    try {
      const response = await fetchWithRetry(`https://api.notion.com/v1/pages/${id}`, {
        headers: {
          'Authorization': `Bearer ${notionApiKey}`,
          'Notion-Version': '2022-06-28',
        },
      });
      
      if (response.ok) {
        const page = await response.json();
        const bodyContent = bodiesMap.get(id) || '';
        
        criteriaMap.set(id, {
          must: getPropertyValue(page.properties['Critères Must']) || '',
          should: getPropertyValue(page.properties['Critères Should']) || '',
          niceToHave: getPropertyValue(page.properties['Critères Nice to have']) || '',
          context: getPropertyValue(page.properties['Contexte']) || '',
          domain: getPropertyValue(page.properties['Domaine']) || '',
          level: getPropertyValue(page.properties['Niveau']) || '',
          bodyContent,
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
    bodyContent: '',
  };
  
  const mustParts: string[] = [];
  const shouldParts: string[] = [];
  const niceToHaveParts: string[] = [];
  const contextParts: string[] = [];
  const domains: string[] = [];
  const levels: string[] = [];
  const bodyParts: string[] = [];
  
  for (const id of criteriaIds) {
    const criteria = criteriaMap.get(id);
    if (criteria) {
      if (criteria.must) mustParts.push(criteria.must);
      if (criteria.should) shouldParts.push(criteria.should);
      if (criteria.niceToHave) niceToHaveParts.push(criteria.niceToHave);
      if (criteria.context) contextParts.push(criteria.context);
      if (criteria.domain) domains.push(criteria.domain);
      if (criteria.level) levels.push(criteria.level);
      if (criteria.bodyContent) bodyParts.push(criteria.bodyContent);
    }
  }
  
  merged.must = mustParts.join('\n\n');
  merged.should = shouldParts.join('\n\n');
  merged.niceToHave = niceToHaveParts.join('\n\n');
  merged.context = contextParts.join('\n\n');
  merged.domain = [...new Set(domains)].join(', ');
  merged.level = [...new Set(levels)].join(', ');
  merged.bodyContent = bodyParts.join('\n\n---\n\n');
  
  // Return null if all fields are empty
  if (!merged.must && !merged.should && !merged.niceToHave && !merged.context) {
    return null;
  }
  
  return merged;
}

async function fetchCandidateCounts(jobIds: string[], creds: NotionCreds): Promise<Map<string, CandidateCounts>> {
  const countsMap = new Map<string, CandidateCounts>();
  
  // Initialize counts for all jobs
  jobIds.forEach(id => {
    countsMap.set(id, { cv: 0, itw: 0, offre: 0, total: 0 });
  });

  try {
    // Fetch all shortlist entries that are in active stages
    const activeStages = ['CV envoyé', 'ITW 1', 'ITW 2', 'ITW 3', 'ITW Final', 'Offre', 'Pré-qualif', 'Contacté', 'Pressenti'];
    
    const shortlistData = await fetchNotionDatabaseAll(creds.shortlistDatabaseId!, creds.notionApiKey, {
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

// Generate embeddings for jobs missing them (fire-and-forget, best-effort)
async function generateJobEmbeddings(jobs: any[]): Promise<void> {
  if (!Deno.env.get("OPENAI_API_KEY")) return; // Skip if no key configured

  // Check which jobs already have embeddings
  const jobIds = jobs.map(j => j.id);
  const { data: existing } = await supabase
    .from('job_profiles')
    .select('job_id')
    .in('job_id', jobIds)
    .not('embedding', 'is', null);

  const existingIds = new Set((existing || []).map(r => r.job_id));
  const jobsToEmbed = jobs.filter(j => !existingIds.has(j.id));

  if (jobsToEmbed.length === 0) return;
  console.log(`[fetch-notion-jobs] Generating embeddings for ${jobsToEmbed.length} jobs`);

  // Process up to 10 jobs per run to avoid timeouts
  for (const job of jobsToEmbed.slice(0, 10)) {
    const text = [
      job.title,
      job.description,
      job.requirements,
      job.mustHave,
      job.shouldHave,
      job.niceToHave,
      job.bodyContent,
      job.transversalCriteria?.context,
      job.transversalCriteria?.must,
      job.transversalCriteria?.should,
    ].filter(Boolean).join(' ');

    if (text.trim().length < 20) continue;

    try {
      const { error } = await supabase.functions.invoke('generate-embedding', {
        body: { text, type: 'job', entityId: job.id },
      });
      if (error) console.error(`Embedding error for job ${job.id}:`, error);
    } catch (e) {
      console.error(`Embedding call failed for job ${job.id}:`, e);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: service role (internal edge→edge calls, ADR 0001) OR JWT + org membership ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isServiceRole = bearerToken === SUPABASE_SERVICE_ROLE_KEY;

    let userId: string | null = null;
    if (!isServiceRole) {
      const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      userId = user.id;
    }

    // Parse request body
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON, use defaults
    }

    // organization_id is mandatory on BOTH paths — resolveOrgCredentials below
    // stays fail-closed (throws if Notion is not connected for this org).
    const organizationId = body?.organization_id || null;
    if (!organizationId) {
      throw new Error('organization_id est requis');
    }
    if (userId) {
      const { data: membership } = await supabase.from('organization_members').select('id').eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    const creds = await resolveOrgCredentials(organizationId);

    // Parse pagination parameters from query string or body
    const url = new URL(req.url);

    // DEBUG MODE: help diagnose “job not visible” by searching in Notion directly
    // Usage: POST body { "debugTitle": "Responsable IT Corporate" }
    if (typeof body?.debugTitle === 'string' && body.debugTitle.trim()) {
      const debugTitle = body.debugTitle.trim();
      const titlePropName = await getTitlePropertyName(creds.postesDatabaseId!, creds.notionApiKey);

      const debugData = await fetchNotionDatabase(creds.postesDatabaseId!, creds.notionApiKey, {
        property: titlePropName,
        title: {
          contains: debugTitle,
        },
      });

      const matches: NotionPage[] = debugData?.results || [];
      const mapped = matches.map((page) => ({
        id: page.id,
        title: getTitleFromProperties(page.properties),
        etat: getPropertyValue(page.properties['État']),
        hasEtat: Boolean(page.properties['État']),
      }));

      return new Response(
        JSON.stringify({
          success: true,
          debug: {
            query: debugTitle,
            titleProperty: titlePropName,
            matches: mapped,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    const jobsData = await fetchNotionDatabaseAll(creds.postesDatabaseId!, creds.notionApiKey, {
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
      // Collect transversal criteria IDs - search by partial match
      const criteriaPropertyName = Object.keys(job.properties).find(k => 
        k.toLowerCase().includes('critères transvers') || 
        k.toLowerCase().includes('criteres transvers')
      );
      if (criteriaPropertyName) {
        const criteriaRelation = job.properties[criteriaPropertyName];
        if (criteriaRelation?.type === 'relation') {
          criteriaRelation.relation?.forEach(r => transversalCriteriaIds.add(r.id));
        }
      }
    });

    // Fetch company details, candidate counts, cached skills, transversal criteria, and job bodies in parallel
    const [companies, candidateCounts, cachedSkills, transversalCriteriaMap, jobBodiesMap] = await Promise.all([
      fetchCompanyDetails(Array.from(companyIds), creds.notionApiKey),
      fetchCandidateCounts(jobIds, creds),
      getCachedSkills(jobIds),
      fetchTransversalCriteria(Array.from(transversalCriteriaIds), creds.notionApiKey),
      fetchPageBodies(jobIds, creds.notionApiKey, 5),
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
      // userId is null on the service_role path → settleClaudeUsage skips
      // silently (settle-usage.ts contract); organizationId is always set.
      aiSkillsMap = await extractSkillsWithAI(jobsNeedingSkills, { userId, organizationId });
      
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

      // Resolve transversal criteria from linked pages - search by partial match
      const criteriaPropertyName = Object.keys(job.properties).find(k => 
        k.toLowerCase().includes('critères transvers') || 
        k.toLowerCase().includes('criteres transvers')
      );
      const criteriaIds = criteriaPropertyName 
        ? (getPropertyValue(job.properties[criteriaPropertyName]) || [])
        : [];
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
        openingDate: (() => {
          const key = Object.keys(job.properties).find(k => k.toLowerCase().includes('ouverture'));
          const val = key ? getPropertyValue(job.properties[key]) : null;
          if (val) return val;
          // Fallback: "Date de création" property
          const creationKey = Object.keys(job.properties).find(k => k.toLowerCase() === 'date de création');
          const creationVal = creationKey ? getPropertyValue(job.properties[creationKey]) : null;
          if (creationVal) return creationVal;
          // Final fallback: page created_time
          return job.created_time || null;
        })(),
        startDate: (() => {
          const key = Object.keys(job.properties).find(k => k.toLowerCase().includes('date') && k.toLowerCase().includes('marrage'));
          return key ? getPropertyValue(job.properties[key]) : null;
        })(),
        channel: getPropertyValue(job.properties['Canal de publication']),
        sourcingCriteria: getPropertyValue(job.properties['Critères sourcing']) || '',
        teamInfo: getPropertyValue(job.properties['Équipe (client)']) || '',
        xpMin: getPropertyValue(job.properties['XP minimum']),
        xpMax: getPropertyValue(job.properties['XP maximum']),
        tjm: getPropertyValue(job.properties['TJM']),
        accompagnement: (() => {
          // Try multiple property name variants
          const variants = [
            "Type d'accompagnement",
            "Type d\u2019accompagnement",
            "Type daccompagnement",
            "Accompagnement",
          ];
          for (const v of variants) {
            if (job.properties[v]) {
              return getPropertyValue(job.properties[v]) || [];
            }
          }
          // Fallback: search by partial match
          const found = Object.entries(job.properties).find(([k]) => 
            k.toLowerCase().includes('accompagnement')
          );
          if (found) {
            console.log('[fetch-notion-jobs] Found accompagnement property:', found[0]);
            return getPropertyValue(found[1] as NotionProperty) || [];
          }
          // Log available properties for debugging (only for first job)
          if (transformedJobs.length === 0) {
            console.log('[fetch-notion-jobs] Available properties:', Object.keys(job.properties).slice(0, 30));
          }
          return [];
        })(),
        jobUrl: getPropertyValue(job.properties['userDefined:URL']),
        // Page body content (free-form text blocks from Notion page)
        bodyContent: jobBodiesMap.get(job.id) || '',
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

    // Generate embeddings for jobs that don't have one yet (fire-and-forget)
    generateJobEmbeddings(transformedJobs).catch(err => 
      console.error('[fetch-notion-jobs] Embedding generation error:', err)
    );

    return new Response(
      JSON.stringify(responsePayload),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching Notion jobs:', errorMessage);

    // Fallback: return stale cache if available to prevent blank screen
    try {
      const staleCache = await getJobsCache();
      if (staleCache.payload) {
        return new Response(
          JSON.stringify({ ...staleCache.payload, cached: true, stale: true, error: errorMessage }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    } catch { /* ignore cache read failure */ }

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs: [],
        error: errorMessage,
        _meta: { rateLimited: true }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  }
});
