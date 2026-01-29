import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

interface AddToShortlistData {
  // Candidate info from LinkedIn
  name: string;
  headline?: string;
  linkedinUrl?: string;
  linkedinId?: string;
  // Optional job association
  jobId?: string;
  jobTitle?: string;
  // Optional source info
  source?: string;
}

async function searchCandidateByLinkedIn(linkedinUrl: string): Promise<string | null> {
  // Search for existing candidate by LinkedIn URL
  const response = await fetch(`https://api.notion.com/v1/databases/${CANDIDATS_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        property: 'URL Linkedin',
        url: {
          equals: linkedinUrl,
        },
      },
      page_size: 1,
    }),
  });

  if (!response.ok) {
    console.error('Error searching candidates:', await response.text());
    return null;
  }

  const data = await response.json();
  if (data.results && data.results.length > 0) {
    return data.results[0].id;
  }
  return null;
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

async function checkExistingShortlist(candidateId: string, jobId?: string): Promise<boolean> {
  // Check if candidate already has a shortlist entry for this job
  const filter: Record<string, unknown> = {
    and: [
      {
        property: 'Candidats',
        relation: {
          contains: candidateId,
        },
      },
    ],
  };

  // If jobId provided, also filter by job
  if (jobId) {
    (filter.and as unknown[]).push({
      property: '💼 Postes',
      relation: {
        contains: jobId,
      },
    });
  }

  const response = await fetch(`https://api.notion.com/v1/databases/${SHORTLIST_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter,
      page_size: 1,
    }),
  });

  if (!response.ok) {
    console.error('Error checking shortlist:', await response.text());
    return false;
  }

  const data = await response.json();
  return data.results && data.results.length > 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    const data: AddToShortlistData = await req.json();

    // Validate required fields
    if (!data.name) {
      throw new Error('Name is required');
    }

    console.log('Adding to shortlist:', data.name);

    let candidateId: string | null = null;

    // Step 1: Check if candidate already exists (by LinkedIn URL)
    if (data.linkedinUrl) {
      candidateId = await searchCandidateByLinkedIn(data.linkedinUrl);
      if (candidateId) {
        console.log('Found existing candidate:', candidateId);
      }
    }

    // Step 2: Create candidate if not found
    if (!candidateId) {
      const candidatProperties: Record<string, unknown> = {
        'Nom': {
          title: [{ text: { content: data.name } }]
        },
      };

      // Add LinkedIn URL if provided
      if (data.linkedinUrl) {
        candidatProperties['URL Linkedin'] = { url: data.linkedinUrl };
      }

      // Add headline as notes or description if available
      if (data.headline) {
        candidatProperties['Notes'] = {
          rich_text: [{ text: { content: data.headline } }]
        };
      }

      // Add relation to job if provided
      if (data.jobId) {
        candidatProperties['💼 Postes'] = {
          relation: [{ id: data.jobId }]
        };
      }

      console.log('Creating new candidate...');
      const candidatResult = await createNotionPage(CANDIDATS_DATABASE_ID, candidatProperties);
      candidateId = candidatResult.id;
      console.log('Candidate created:', candidateId);
    }

    // Step 3: Check if shortlist entry already exists
    const shortlistExists = await checkExistingShortlist(candidateId!, data.jobId);
    if (shortlistExists) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Candidate already in shortlist',
          candidateId,
          alreadyExists: true,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Step 4: Create Shortlist entry
    const shortlistTitle = data.jobTitle 
      ? `${data.name} - ${data.jobTitle}`
      : data.name;

    const shortlistProperties: Record<string, unknown> = {
      'Nom': {
        title: [{ text: { content: shortlistTitle } }]
      },
      'Candidats': {
        relation: [{ id: candidateId }]
      },
      'Etape': {
        select: { name: 'Pressenti' }
      },
      'Entité': {
        select: { name: 'Konekt' }
      },
    };

    // Add job relation if provided
    if (data.jobId) {
      shortlistProperties['💼 Postes'] = {
        relation: [{ id: data.jobId }]
      };
    }

    console.log('Creating shortlist entry...');
    const shortlistResult = await createNotionPage(SHORTLIST_DATABASE_ID, shortlistProperties);
    console.log('Shortlist created:', shortlistResult.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Added to shortlist',
        candidateId,
        shortlistId: shortlistResult.id,
        alreadyExists: false,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error adding to shortlist:', errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
