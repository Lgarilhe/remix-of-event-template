import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
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
    console.error('Notion API error:', error);
    throw new Error(`Failed to query Notion database: ${error}`);
  }

  return response.json();
}

async function getNotionPage(pageId: string) {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
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
      
      // Get candidate and position details for each shortlist entry
      const shortlistWithCandidates = await Promise.all(
        data.results.map(async (page: { id: string; properties: Record<string, NotionProperty> }) => {
          const props = page.properties;
          const candidateIds = extractRelations(props['Candidats']);
          const positionIds = extractRelations(props['💼 Postes']);
          
          // Fetch candidate info if available
          let candidateInfo = null;
          if (candidateIds.length > 0) {
            const candidatePage = await getNotionPage(candidateIds[0]);
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
              const positionPage = await getNotionPage(posId);
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
        })
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
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
