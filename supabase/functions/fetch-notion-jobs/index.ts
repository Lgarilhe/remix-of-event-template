import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const POSTES_DATABASE_ID = "2787e1816fb481d2a0e8d4b2c1dd38f9";
const SOCIETES_DATABASE_ID = "0c80d187899541c98f7b10a4f94ea493";

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
      return property.rich_text?.[0]?.plain_text || '';
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
    default:
      return null;
  }
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
        companies.set(id, {
          id,
          name: getPropertyValue(page.properties['Société'] || page.properties['Name']),
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

      return {
        id: job.id,
        title: getPropertyValue(job.properties['Intitulé du poste']),
        client: clientDetails[0] || null,
        status: getPropertyValue(job.properties['Statut']),
        seniority: getPropertyValue(job.properties['Séniorité']),
        contractType: getPropertyValue(job.properties['Type de contrat']),
        location: getPropertyValue(job.properties['Localisation']),
        remote: getPropertyValue(job.properties['Télétravail']),
        salaryMin: getPropertyValue(job.properties['Salaire Min']),
        salaryMax: getPropertyValue(job.properties['Salaire Max']),
        priority: getPropertyValue(job.properties['Priorité']),
        skills: getPropertyValue(job.properties['Compétences']) || [],
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
