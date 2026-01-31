import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// Pin + target=deno to reduce cold-start flakiness / upstream bundle changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Must match what the browser sends to functions.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 5 min cache to protect Notion + make ATS instant on refresh.
const CACHE_TTL_MS = 5 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  const res = await fetch(input, init);

  // Notion rate limit
  if (res.status === 429 && attempt < 5) {
    const backoffMs = Math.min(10_000, 500 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 250);
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
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

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

async function queryNotionDatabase(databaseId: string, filter?: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    page_size: 100,
  };
  if (filter) {
    body.filter = filter;
  }

  const response = await pacedFetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
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
    console.error('Notion API error:', error);
    throw new Error(`Failed to query Notion database: ${error}`);
  }

  return response.json();
}

async function getNotionPage(pageId: string) {
  const response = await pacedFetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'shortlist'; // 'candidates' or 'shortlist'

    const cacheKey = type === 'candidates' ? 'notion:candidates:v1' : 'notion:shortlist:v1';
    const cached = await getCache(cacheKey);

    // Serve from cache when fresh
    // If we stored a "rateLimited" payload, keep it for a shorter period to avoid hiding data for too long.
    const cachedTtlMs = (cached.payload as any)?._meta?.rateLimited ? 30_000 : CACHE_TTL_MS;
    if (cached.payload && cached.ageMs !== null && cached.ageMs < cachedTtlMs) {
      return new Response(
        JSON.stringify({ ...(cached.payload as any), cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'candidates') {
      // Fetch all candidates
      const data = await queryNotionDatabase(CANDIDATS_DATABASE_ID);
      
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
      const data = await queryNotionDatabase(SHORTLIST_DATABASE_ID);
      
      // Cache for Notion pages/positions to avoid duplicate fetches
      const positionCache: Record<string, string> = {};
      const pageCache = new Map<string, any>();

      async function getNotionPageCached(id: string) {
        if (pageCache.has(id)) return pageCache.get(id);
        const page = await getNotionPage(id);
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
      const cacheKey = type === 'candidates' ? 'notion:candidates:v1' : 'notion:shortlist:v1';
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
