import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

interface ApplicationData {
  jobId: string; // Notion page ID of the job
  jobTitle: string;
  clientName: string;
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  message: string;
  cvUrl: string;
}

async function createNotionPage(databaseId: string, properties: Record<string, unknown>) {
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Notion API error:', error);
    throw new Error(`Failed to create Notion page: ${error}`);
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

    const data: ApplicationData = await req.json();

    // Validate required fields
    if (!data.name || !data.email) {
      throw new Error('Name and email are required');
    }

    // Step 1: Create the candidate in Candidats database (without job relation first)
    const candidatProperties: Record<string, unknown> = {
      'Nom': {
        title: [{ text: { content: data.name } }]
      },
      'E-mail': {
        email: data.email
      },
    };

    // Add optional fields
    if (data.phone) {
      candidatProperties['Téléphone'] = { phone_number: data.phone };
    }
    if (data.linkedin) {
      candidatProperties['URL Linkedin'] = { url: data.linkedin };
    }
    if (data.cvUrl) {
      candidatProperties['Lien source'] = { url: data.cvUrl };
    }

    // Add relation to the job position if jobId looks valid
    if (data.jobId) {
      candidatProperties['💼 Postes'] = {
        relation: [{ id: data.jobId }]
      };
    }

    console.log('Creating candidate with properties:', JSON.stringify(candidatProperties));
    const candidatResult = await createNotionPage(CANDIDATS_DATABASE_ID, candidatProperties);
    console.log('Candidate created:', candidatResult.id);

    // Step 2: Create a Shortlist entry linking candidate and job
    const shortlistProperties: Record<string, unknown> = {
      // Title - use candidate name + job title
      'Nom': {
        title: [{ text: { content: `${data.name} - ${data.jobTitle}` } }]
      },
      // Relation to candidate
      'Candidats': {
        relation: [{ id: candidatResult.id }]
      },
      // Etape - new application (Pressenti = identified candidate)
      'Etape': {
        select: { name: 'Pressenti' }
      },
      // Entity - default to Konekt
      'Entité': {
        select: { name: 'Konekt' }
      }
    };

    // Add relation to job position
    if (data.jobId) {
      shortlistProperties['💼 Postes'] = {
        relation: [{ id: data.jobId }]
      };
    }

    console.log('Creating shortlist with properties:', JSON.stringify(shortlistProperties));
    const shortlistResult = await createNotionPage(SHORTLIST_DATABASE_ID, shortlistProperties);
    console.log('Shortlist created:', shortlistResult.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Application submitted successfully',
        candidateId: candidatResult.id,
        shortlistId: shortlistResult.id
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error submitting application:', errorMessage);
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
