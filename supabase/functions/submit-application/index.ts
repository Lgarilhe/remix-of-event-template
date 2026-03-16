// Deno.serve used directly

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = Deno.env.get("NOTION_CANDIDATS_DB_ID")!;
const SHORTLIST_DATABASE_ID = Deno.env.get("NOTION_SHORTLIST_DB_ID")!;

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
  const response = await fetchWithTimeout('https://api.notion.com/v1/pages', {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    const data: ApplicationData = await req.json();

    // ── Input Validation ──
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2 || data.name.length > 100) {
      return new Response(JSON.stringify({ success: false, error: 'Nom invalide (2-100 caractères requis)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!data.email || typeof data.email !== 'string' || !emailRegex.test(data.email)) {
      return new Response(JSON.stringify({ success: false, error: 'Email invalide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate optional URL fields
    const urlRegex = /^https?:\/\/.+/i;
    if (data.linkedin && !urlRegex.test(data.linkedin)) {
      return new Response(JSON.stringify({ success: false, error: 'URL LinkedIn invalide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (data.cvUrl && !urlRegex.test(data.cvUrl)) {
      return new Response(JSON.stringify({ success: false, error: 'URL CV invalide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanitize: trim strings, cap message length
    data.name = data.name.trim().slice(0, 100);
    data.email = data.email.trim().toLowerCase().slice(0, 255);
    data.phone = (data.phone || '').trim().slice(0, 20);
    data.linkedin = (data.linkedin || '').trim().slice(0, 500);
    data.message = (data.message || '').trim().slice(0, 5000);
    data.cvUrl = (data.cvUrl || '').trim().slice(0, 500);

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
