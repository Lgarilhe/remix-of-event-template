import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const POSTES_DATABASE_ID = "2787e1816fb481d2a0e8d4b2c1dd38f9";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    // Fetch jobs from Notion - only active ones (Publié status)
    const jobsData = await fetchNotionDatabase(POSTES_DATABASE_ID, {
      property: 'État',
      status: {
        equals: 'Publié'
      }
    });
    const jobs: NotionPage[] = jobsData.results;

    // Collect all company IDs and job IDs
    const companyIds = new Set<string>();
    const jobIds: string[] = [];
    
    jobs.forEach((job) => {
      jobIds.push(job.id);
      const clientRelation = job.properties['Client'];
      if (clientRelation?.type === 'relation') {
        clientRelation.relation?.forEach(r => companyIds.add(r.id));
      }
    });

    // Fetch company details and candidate counts in parallel
    const [companies, candidateCounts] = await Promise.all([
      fetchCompanyDetails(Array.from(companyIds)),
      fetchCandidateCounts(jobIds)
    ]);

    // Prepare job data for AI skill extraction
    const jobsForAI = jobs.map((job) => ({
      id: job.id,
      title: getTitleFromProperties(job.properties),
      description: getPropertyValue(job.properties['RAG — Synthèse']) || '',
      requirements: getPropertyValue(job.properties['🔴 Must-have poste']) || '',
    }));

    // Extract skills using AI
    const aiSkillsMap = await extractSkillsWithAI(jobsForAI);

    // Transform jobs data
    const transformedJobs = jobs.map((job) => {
      const clientIds = getPropertyValue(job.properties['Client']) || [];
      const clientDetails = clientIds.map((id: string) => companies.get(id)).filter(Boolean);
      
      const contractTypeValue = getPropertyValue(job.properties['Type de contrat']);
      const contractType = Array.isArray(contractTypeValue) 
        ? contractTypeValue.join(', ') 
        : contractTypeValue;

      const counts = candidateCounts.get(job.id) || { cv: 0, itw: 0, offre: 0, total: 0 };

      // Get skills: prefer Notion field, fallback to AI-extracted
      const notionSkills = getPropertyValue(job.properties['Skills sourcing'])?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
      const aiSkills = aiSkillsMap.get(job.id) || [];
      const skills = notionSkills.length > 0 ? notionSkills : aiSkills;

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
        // Candidate counts by stage
        candidateCounts: counts,
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
