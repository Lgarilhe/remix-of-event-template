import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";
const NOTION_VERSION = '2022-06-28';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Notion API has a low per-integration request rate; enforce a global pacing
// to prevent bursts (especially when resolving relations).
let notionRequestChain: Promise<unknown> = Promise.resolve();
let lastNotionRequestAt = 0;
const NOTION_MIN_INTERVAL_MS = 350; // ~3 req/s max

async function pacedFetch(url: string, init: RequestInit): Promise<Response> {
  const run = notionRequestChain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, NOTION_MIN_INTERVAL_MS - (now - lastNotionRequestAt));
    if (waitMs) await sleep(waitMs);
    lastNotionRequestAt = Date.now();
    return await fetch(url, init);
  });

  // Keep chain alive even if a request fails
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

async function notionFetch(url: string, init: RequestInit, opts?: { maxRetries?: number; minDelayMs?: number }) {
  const maxRetries = opts?.maxRetries ?? 6;
  const minDelayMs = opts?.minDelayMs ?? 350;

  let attempt = 0;
  while (true) {
    const response = await pacedFetch(url, init);

    // Notion rate-limit / transient upstream issues
    if ([429, 503, 502].includes(response.status) && attempt < maxRetries) {
      await response.text(); // consume body to avoid resource leaks
      const retryAfterMs = getRetryAfterMs(response);
      const backoff = Math.min(8000, minDelayMs * Math.pow(2, attempt));
      const waitMs = retryAfterMs ?? backoff;
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    return response;
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
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

async function queryNotionDatabase(databaseId: string, filter?: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    page_size: 100,
  };
  if (filter) {
    body.filter = filter;
  }

  const response = await notionFetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
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
  const response = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
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

      return new Response(
        JSON.stringify({ success: true, candidates }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Fetch shortlist (candidatures with pipeline)
      const data = await queryNotionDatabase(SHORTLIST_DATABASE_ID);
      
      // Cache for positions to avoid duplicate fetches
      const positionCache: Record<string, string> = {};
      const pageCache = new Map<string, any>();

      const getNotionPageCached = async (pageId: string) => {
        if (pageCache.has(pageId)) return pageCache.get(pageId);
        const page = await getNotionPage(pageId);
        pageCache.set(pageId, page);
        return page;
      };
      
      // Get candidate and position details for each shortlist entry
      // Important: limit concurrency to avoid Notion 429 rate limiting
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

      return new Response(
        JSON.stringify({ success: true, shortlist: shortlistWithCandidates }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching candidates:', errorMessage);
    return new Response(
      // Avoid hard 500 so the client can gracefully fallback (other sources, cache, etc.)
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
