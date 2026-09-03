// Deno.serve used directly
// Pin + target=deno to reduce cold-start flakiness / upstream bundle changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Must match what the browser sends to functions.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

/** Per-request Notion credentials — resolved inside handler, passed to helpers. */
interface NotionCreds { notionApiKey: string; candidatsDatabaseId?: string; shortlistDatabaseId?: string; }

// 5 min cache to protect Notion + make ATS instant on refresh.
const CACHE_TTL_MS = 5 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

// Per-invocation pacing to avoid bursts (Notion rate limits quickly on page fetches)
let lastNotionCallAt = 0;
async function pacedFetch(input: string, init: RequestInit): Promise<Response> {
  const now = Date.now();
  const waitMs = Math.max(0, 350 - (now - lastNotionCallAt));
  if (waitMs > 0) await sleep(waitMs);
  lastNotionCallAt = Date.now();
  return fetchWithRetry(input, init);
}

async function fetchWithRetry(input: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetchWithTimeout(input, init);

  // Notion rate limit
  if (res.status === 429 && attempt < 1) {
    const backoffMs = Math.min(2_000, 400 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 150);
    await sleep(backoffMs + jitter);
    return fetchWithRetry(input, init, attempt + 1);
  }

  // transient upstream errors
  if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3) {
    const backoffMs = Math.min(5_000, 300 * Math.pow(2, attempt));
    await sleep(backoffMs);
    return fetchWithRetry(input, init, attempt + 1);
  }

  return res;
}

type CacheRow = { cache_key: string; payload: unknown; updated_at: string };

// Clé PAR ORGANISATION : les clés globales 'notion:candidates:v1' et
// 'notion:shortlist:v1' servaient les candidats Notion (emails, téléphones)
// d'une org à toutes les autres (audit 2026-09-01, cache cross-org).
function notionCacheKey(type: string, organizationId: string): string {
  return `notion:${type === 'candidates' ? 'candidates' : 'shortlist'}:v2:${organizationId}`;
}

async function getCache(cacheKey: string): Promise<{ payload: any | null; ageMs: number | null }> {
  try {
    const { data, error } = await supabase
      .from('notion_api_cache')
      .select('cache_key, payload, updated_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (error || !data) return { payload: null, ageMs: null };
    const updatedAtMs = new Date((data as CacheRow).updated_at).getTime();
    const ageMs = Date.now() - updatedAtMs;
    return { payload: (data as CacheRow).payload, ageMs };
  } catch {
    return { payload: null, ageMs: null };
  }
}

async function setCache(cacheKey: string, payload: unknown): Promise<void> {
  try {
    await supabase
      .from('notion_api_cache')
      .upsert({
        cache_key: cacheKey,
        payload,
        updated_at: new Date().toISOString(),
      });
  } catch (e) {
    console.error('Cache write error:', e);
  }
}
async function resolveOrgNotionCredentials(orgId: string): Promise<NotionCreds> {
  const { data } = await supabase
    .from('organization_integrations')
    .select('notion_api_key, notion_candidats_db_id, notion_shortlist_db_id, notion_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.notion_connected || !data.notion_api_key) {
    throw new Error('Intégration Notion non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  console.log('[fetch-notion-candidates] Using org-specific Notion credentials');
  return {
    notionApiKey: data.notion_api_key,
    candidatsDatabaseId: data.notion_candidats_db_id || undefined,
    shortlistDatabaseId: data.notion_shortlist_db_id || undefined,
  };
}

interface NotionRichText {
  plain_text: string;
}

interface NotionRelation {
  id: string;
}

interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  email?: string;
  phone_number?: string;
  url?: string;
  select?: { name: string; color?: string };
  multi_select?: { name: string; color?: string }[];
  relation?: NotionRelation[];
  date?: { start: string; end?: string };
  number?: number;
  created_time?: string;
  last_edited_time?: string;
  people?: { id: string; name?: string }[];
  rollup?: { array?: NotionProperty[] };
  formula?: { string?: string; number?: number; boolean?: boolean; date?: { start: string } };
}

function extractText(prop: NotionProperty | undefined): string {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

function extractEmail(prop: NotionProperty | undefined): string | null {
  return prop?.email || null;
}

function extractPhone(prop: NotionProperty | undefined): string | null {
  return prop?.phone_number || null;
}

function extractUrl(prop: NotionProperty | undefined): string | null {
  return prop?.url || null;
}

function extractSelect(prop: NotionProperty | undefined): string | null {
  return prop?.select?.name || null;
}

function extractMultiSelect(prop: NotionProperty | undefined): string[] {
  return prop?.multi_select?.map(s => s.name) || [];
}

function extractRelations(prop: NotionProperty | undefined): string[] {
  return prop?.relation?.map(r => r.id) || [];
}

function extractDate(prop: NotionProperty | undefined): string | null {
  return prop?.date?.start || null;
}

function extractNumber(prop: NotionProperty | undefined): number | null {
  return prop?.number ?? null;
}

function extractCreatedTime(prop: NotionProperty | undefined): string | null {
  return prop?.created_time || null;
}

function extractFormula(prop: NotionProperty | undefined): string | number | null {
  if (!prop?.formula) return null;
  if (prop.formula.string !== undefined) return prop.formula.string;
  if (prop.formula.number !== undefined) return prop.formula.number;
  if (prop.formula.date?.start) return prop.formula.date.start;
  return null;
}

async function queryNotionDatabase(
  databaseId: string,
  notionApiKey: string,
  options?: { filter?: Record<string, unknown>; fetchAll?: boolean }
) {
  const allResults: any[] = [];
  let startCursor: string | undefined;
  let hasMore = true;
  let pages = 0;

  while (hasMore) {
    const body: Record<string, unknown> = {
      page_size: 100,
    };

    if (options?.filter) {
      body.filter = options.filter;
    }

    if (startCursor) {
      body.start_cursor = startCursor;
    }

    const response = await pacedFetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
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
      console.error('Notion API error:', error);
      throw new Error(`Failed to query Notion database: ${error}`);
    }

    const data: { results?: any[]; has_more?: boolean; next_cursor?: string | null } = await response.json();
    allResults.push(...(data.results || []));

    pages += 1;
    const shouldContinue = Boolean(options?.fetchAll && data.has_more && data.next_cursor && pages < 50);
    hasMore = shouldContinue;
    startCursor = shouldContinue ? data.next_cursor || undefined : undefined;
  }

  return { results: allResults };
}

async function getNotionPage(pageId: string, notionApiKey: string) {
  const response = await pacedFetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.max(1, limit)).fill(null).map(async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Organisation vérifiée, pour le repli cache du bloc catch.
  let cacheOrgId: string | null = null;

  try {
    // --- Auth: validate JWT and org membership ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve org credentials from body or query param
    let orgId: string | null = null;
    try {
      const body = await req.clone().json();
      orgId = body?.organization_id || null;
    } catch {}
    const url = new URL(req.url);
    if (!orgId) orgId = url.searchParams.get('organization_id');

    if (orgId) {
      const { data: membership } = await supabase.from('organization_members').select('id').eq('user_id', user.id).eq('organization_id', orgId).maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    if (!orgId) {
      throw new Error('organization_id est requis');
    }
    cacheOrgId = orgId;
    const creds = await resolveOrgNotionCredentials(orgId);

    const type = url.searchParams.get('type') || 'shortlist';
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    const cacheKey = notionCacheKey(type, orgId);
    const cached = await getCache(cacheKey);

    // STALE-WHILE-REVALIDATE pattern:
    // If we have ANY cached data (even stale), return it immediately for instant UI
    // The client can request a refresh in background if needed
    const isRateLimited = (cached.payload as any)?._meta?.rateLimited;
    const cachedTtlMs = isRateLimited ? 10 * 60 * 1000 : CACHE_TTL_MS;
    const isFresh = cached.payload && cached.ageMs !== null && cached.ageMs < cachedTtlMs;
    
    // Return cached data immediately (unless force refresh requested)
    if (cached.payload && !forceRefresh) {
      // If cache is fresh, just return it
      if (isFresh) {
        return new Response(
          JSON.stringify({ ...(cached.payload as any), cached: true, stale: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // If cache exists but is stale, still return it immediately to avoid blocking UI
      return new Response(
        JSON.stringify({ 
          ...(cached.payload as any), 
          cached: true, 
          stale: true,
          ageMs: cached.ageMs 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'candidates') {
      // Fetch all candidates
      const data = await queryNotionDatabase(creds.candidatsDatabaseId!, creds.notionApiKey, { fetchAll: true });
      
      const candidates = data.results.map((page: { id: string; properties: Record<string, NotionProperty> }) => {
        const props = page.properties;
        return {
          id: page.id,
          name: extractText(props['Nom']),
          email: extractEmail(props['E-mail']),
          phone: extractPhone(props['Téléphone']),
          linkedin: extractUrl(props['URL Linkedin']),
          expertise: extractMultiSelect(props['Domaine d\'expertise']),
          seniority: extractSelect(props['Séniorité']),
          source: extractSelect(props['Source']),
          sourceUrl: extractUrl(props['Lien source']),
          location: extractText(props['Localisation']),
          availability: extractSelect(props['Dispo']),
          salaryMin: extractNumber(props['Salaire min']),
          salaryMax: extractNumber(props['Salaire max']),
          tjm: extractNumber(props['TJM']),
          firstContactDate: extractDate(props['Date 1er échange']),
          createdAt: extractCreatedTime(props['Date de création']),
          positionIds: extractRelations(props['💼 Postes']),
          shortlistIds: extractRelations(props['Shortlist']),
        };
      });

      const payload = { success: true, candidates };
      await setCache(cacheKey, payload);

      return new Response(
        JSON.stringify({ ...payload, cached: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Fetch shortlist (candidatures with pipeline)
      const data = await queryNotionDatabase(creds.shortlistDatabaseId!, creds.notionApiKey, { fetchAll: true });
      
      // Cache for Notion pages/positions to avoid duplicate fetches
      const positionCache: Record<string, string> = {};
      const pageCache = new Map<string, any>();

      async function getNotionPageCached(id: string) {
        if (pageCache.has(id)) return pageCache.get(id);
        const page = await getNotionPage(id, creds.notionApiKey);
        if (page) pageCache.set(id, page);
        return page;
      }
      
      // Get candidate and position details for each shortlist entry
      const shortlistWithCandidates = await mapWithConcurrency(
        data.results,
        2,
        async (page: { id: string; properties: Record<string, NotionProperty> }) => {
          const props = page.properties;
          const candidateIds = extractRelations(props['Candidats']);
          const positionIds = extractRelations(props['💼 Postes']);
          
          // Fetch candidate info if available
          let candidateInfo = null;
          if (candidateIds.length > 0) {
            const candidatePage = await getNotionPageCached(candidateIds[0]);
            if (candidatePage) {
              const candProps = candidatePage.properties;
              candidateInfo = {
                id: candidatePage.id,
                name: extractText(candProps['Nom']),
                email: extractEmail(candProps['E-mail']),
                phone: extractPhone(candProps['Téléphone']),
                linkedin: extractUrl(candProps['URL Linkedin']),
                expertise: extractMultiSelect(candProps['Domaine d\'expertise']),
                seniority: extractSelect(candProps['Séniorité']),
              };
            }
          }

          // Fetch position names
          const positions: { id: string; name: string }[] = [];
          
          // Try to extract position name from the shortlist entry name (format: "Candidat X Poste")
          const entryName = extractText(props['Nom']);
          const extractedPositionFromName = entryName.includes(' X ') 
            ? entryName.split(' X ').slice(1).join(' X ').trim() 
            : null;
          
          for (const posId of positionIds) {
            if (positionCache[posId]) {
              positions.push({ id: posId, name: positionCache[posId] });
            } else {
              const positionPage = await getNotionPageCached(posId);
              if (positionPage) {
                // Try multiple property names that might contain the position title
                const posName = extractText(positionPage.properties['Intitulé du poste']) || 
                               extractText(positionPage.properties['Name']) ||
                               extractText(positionPage.properties['Nom']) ||
                               extractText(positionPage.properties['Titre']) ||
                               extractText(positionPage.properties['Title']) ||
                               extractText(positionPage.properties['Poste']) ||
                               extractedPositionFromName ||
                               null;
                
                if (posName) {
                  positionCache[posId] = posName;
                  positions.push({ id: posId, name: posName });
                }
              }
            }
          }
          
          // If no positions found but we have an extracted name, use it
          if (positions.length === 0 && extractedPositionFromName) {
            positions.push({ id: 'extracted', name: extractedPositionFromName });
          }

          return {
            id: page.id,
            name: extractText(props['Nom']),
            stage: extractSelect(props['Etape']),
            entity: extractSelect(props['Entité']),
            presentiComments: extractText(props['Commentaires pressenti']),
            cycle: extractText(props['Cycle']),
            preQualifDate: extractDate(props['Date pré-qualif']),
            cvPresentationDate: extractDate(props['Date présentation CV manager']),
            managerReturnDate: extractDate(props['Date retour manager CV']),
            managerDecisionDate: extractDate(props['Date décision manager']),
            offerValidationDate: extractDate(props['Date validation offre']),
            startDate: extractDate(props['Date de démarrage']),
            createdAt: extractCreatedTime(props['Date de création']),
            positionIds,
            positions,
            candidate: candidateInfo,
          };
        }
      );

      const payload = { success: true, shortlist: shortlistWithCandidates };
      await setCache(cacheKey, payload);

      return new Response(
        JSON.stringify({ ...payload, cached: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching candidates:', errorMessage);

    // If we have stale cache, return it instead of a hard error (prevents blank screen)
    try {
      const url = new URL(req.url);
      const type = url.searchParams.get('type') || 'shortlist';
      if (!cacheOrgId) throw new Error('organisation non résolue : pas de repli cache');
      const cacheKey = notionCacheKey(type, cacheOrgId);
      const cached = await getCache(cacheKey);
      if (cached.payload) {
        return new Response(
          JSON.stringify({ ...(cached.payload as any), cached: true, stale: true, error: errorMessage }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // No cache yet: return a non-blocking empty payload + short-lived "negative cache"
      // so the UI doesn't crash and we avoid hammering Notion while rate-limited.
      const isCandidates = type === 'candidates';
      const emptyPayload = isCandidates
        ? { success: true, candidates: [], _meta: { rateLimited: true, error: errorMessage } }
        : { success: true, shortlist: [], _meta: { rateLimited: true, error: errorMessage } };
      await setCache(cacheKey, emptyPayload);
      return new Response(
        JSON.stringify({ ...emptyPayload, cached: true, stale: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch {
      // ignore
    }

    return new Response(
      JSON.stringify({ success: true, shortlist: [], _meta: { rateLimited: true, error: errorMessage } }),
      // IMPORTANT: keep 200 to prevent supabase-js from surfacing it as a transport error.
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
