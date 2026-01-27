import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const POSTES_DATABASE_ID = "2787e1816fb481d2a0e8d4b2c1dd38f9";

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

// Find the title property (it's the one with type "title")
function getTitleFromProperties(properties: Record<string, NotionProperty>): string {
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'title') {
      return prop.title?.[0]?.plain_text || 'Sans titre';
    }
  }
  return 'Sans titre';
}

async function fetchNotionDatabase(databaseId: string) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 100,
    }),
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
        // Find the title property for company name
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    // Fetch jobs from Notion
    const jobsData = await fetchNotionDatabase(POSTES_DATABASE_ID);
    const jobs: NotionPage[] = jobsData.results;

    // Collect all company IDs
    const companyIds = new Set<string>();
    jobs.forEach((job) => {
      const clientRelation = job.properties['Client'];
      if (clientRelation?.type === 'relation') {
        clientRelation.relation?.forEach(r => companyIds.add(r.id));
      }
    });

    // Fetch company details
    const companies = await fetchCompanyDetails(Array.from(companyIds));

    // Transform jobs data
    const transformedJobs = jobs.map((job) => {
      const clientIds = getPropertyValue(job.properties['Client']) || [];
      const clientDetails = clientIds.map((id: string) => companies.get(id)).filter(Boolean);
      
      // Get contract type - handle multi_select returning array
      const contractTypeValue = getPropertyValue(job.properties['Type de contrat']);
      const contractType = Array.isArray(contractTypeValue) 
        ? contractTypeValue.join(', ') 
        : contractTypeValue;

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
        skills: getPropertyValue(job.properties['Skills sourcing'])?.split(',').map((s: string) => s.trim()).filter(Boolean) || [],
        entity: getPropertyValue(job.properties['Entité']),
        // Detailed fields
        description: getPropertyValue(job.properties['RAG — Synthèse']) || '',
        interviewProcess: getPropertyValue(job.properties['Process']) || '',
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
      };
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs: transformedJobs,
        total: transformedJobs.length 
      }),
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
