import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";
const NOTION_VERSION = '2022-06-28';
const CACHE_KEY = 'ats_shortlist';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Rate-limit handling ----
let notionRequestChain: Promise<unknown> = Promise.resolve();
let lastNotionRequestAt = 0;
const NOTION_MIN_INTERVAL_MS = 400; // ~2.5 req/s max

async function pacedFetch(url: string, init: RequestInit): Promise<Response> {
  const run = notionRequestChain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, NOTION_MIN_INTERVAL_MS - (now - lastNotionRequestAt));
    if (waitMs) await sleep(waitMs);
    lastNotionRequestAt = Date.now();
    return await fetch(url, init);
  });
  notionRequestChain = run.then(() => undefined).catch(() => undefined);
  return await run;
}

function getRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return null;
}

async function notionFetch(url: string, init: RequestInit, opts?: { maxRetries?: number }) {
  const maxRetries = opts?.maxRetries ?? 6;
  let attempt = 0;
  while (true) {
    const response = await pacedFetch(url, init);
    if ([429, 503, 502].includes(response.status) && attempt < maxRetries) {
      await response.text(); // consume body
      const retryAfterMs = getRetryAfterMs(response);
      const backoff = Math.min(12000, 400 * Math.pow(2, attempt));
      const waitMs = retryAfterMs ?? backoff;
      await sleep(waitMs);
      attempt += 1;
      continue;
    }
    return response;
  }
}

// ---- Notion property helpers ----
interface NotionRichText { plain_text: string; }
interface NotionRelation { id: string; }
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
}

function extractText(prop: NotionProperty | undefined): string {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}
const extractEmail = (prop?: NotionProperty) => prop?.email || null;
const extractPhone = (prop?: NotionProperty) => prop?.phone_number || null;
const extractUrl = (prop?: NotionProperty) => prop?.url || null;
const extractSelect = (prop?: NotionProperty) => prop?.select?.name || null;
const extractMultiSelect = (prop?: NotionProperty) => prop?.multi_select?.map(s => s.name) || [];
const extractRelations = (prop?: NotionProperty) => prop?.relation?.map(r => r.id) || [];
const extractDate = (prop?: NotionProperty) => prop?.date?.start || null;
const extractCreatedTime = (prop?: NotionProperty) => prop?.created_time || null;

// ---- Notion API calls ----
async function queryNotionDatabase(databaseId: string) {
  const response = await notionFetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to query Notion database: ${error}`);
  }
  return response.json();
}

async function getNotionPage(pageId: string) {
  const response = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

// ---- Cache helpers ----
async function getCache(key: string): Promise<{ payload: unknown; updatedAt: Date } | null> {
  const { data, error } = await supabase
    .from('notion_api_cache')
    .select('payload, updated_at')
    .eq('cache_key', key)
    .maybeSingle();
  if (error || !data) return null;
  return { payload: data.payload, updatedAt: new Date(data.updated_at) };
}

async function setCache(key: string, payload: unknown) {
  await supabase.from('notion_api_cache').upsert({
    cache_key: key,
    payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'cache_key' });
}

// ---- Main: build shortlist from Notion (heavy) ----
async function buildShortlist() {
  const data = await queryNotionDatabase(SHORTLIST_DATABASE_ID);
  const positionCache: Record<string, string> = {};
  const pageCache = new Map<string, unknown>();

  const getPage = async (pageId: string) => {
    if (pageCache.has(pageId)) return pageCache.get(pageId);
    const page = await getNotionPage(pageId);
    pageCache.set(pageId, page);
    return page;
  };

  const results: unknown[] = [];
  for (const page of data.results as { id: string; properties: Record<string, NotionProperty> }[]) {
    const props = page.properties;
    const candidateIds = extractRelations(props['Candidats']);
    const positionIds = extractRelations(props['💼 Postes']);

    let candidateInfo = null;
    if (candidateIds.length > 0) {
      const candPage = await getPage(candidateIds[0]) as { id: string; properties: Record<string, NotionProperty> } | null;
      if (candPage) {
        const cp = candPage.properties;
        candidateInfo = {
          id: candPage.id,
          name: extractText(cp['Nom']),
          email: extractEmail(cp['E-mail']),
          phone: extractPhone(cp['Téléphone']),
          linkedin: extractUrl(cp['URL Linkedin']),
          expertise: extractMultiSelect(cp['Domaine d\'expertise']),
          seniority: extractSelect(cp['Séniorité']),
        };
      }
    }

    const entryName = extractText(props['Nom']);
    const extractedPositionFromName = entryName.includes(' X ') ? entryName.split(' X ').slice(1).join(' X ').trim() : null;

    const positions: { id: string; name: string }[] = [];
    for (const posId of positionIds) {
      if (positionCache[posId]) {
        positions.push({ id: posId, name: positionCache[posId] });
      } else {
        const pp = await getPage(posId) as { id: string; properties: Record<string, NotionProperty> } | null;
        if (pp) {
          const posName = extractText(pp.properties['Intitulé du poste']) ||
            extractText(pp.properties['Name']) ||
            extractText(pp.properties['Nom']) ||
            extractText(pp.properties['Titre']) ||
            extractText(pp.properties['Title']) ||
            extractText(pp.properties['Poste']) ||
            extractedPositionFromName ||
            null;
          if (posName) {
            positionCache[posId] = posName;
            positions.push({ id: posId, name: posName });
          }
        }
      }
    }
    if (positions.length === 0 && extractedPositionFromName) {
      positions.push({ id: 'extracted', name: extractedPositionFromName });
    }

    results.push({
      id: page.id,
      name: entryName,
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
    });
  }
  return results;
}

// ---- Serve ----
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    // Check cache first
    const cached = await getCache(CACHE_KEY);
    const now = Date.now();
    if (cached && (now - cached.updatedAt.getTime()) < CACHE_TTL_MS) {
      console.log('[fetch-notion-candidates] cache hit');
      return new Response(
        JSON.stringify({ success: true, shortlist: cached.payload, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch fresh data from Notion
    console.log('[fetch-notion-candidates] cache miss – fetching from Notion');
    const shortlist = await buildShortlist();

    // Store in cache (fire-and-forget)
    setCache(CACHE_KEY, shortlist).catch(e => console.error('cache write error', e));

    return new Response(
      JSON.stringify({ success: true, shortlist }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[fetch-notion-candidates] error:', errorMessage);
    // Return 200 with error body to avoid breaking client (other sources + cache still work)
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
