import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";

interface ApplicationData {
  jobId: string;
  jobTitle: string;
  clientName: string;
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  message: string;
  cvUrl: string;
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

    // Create a page in the Candidats database
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: CANDIDATS_DATABASE_ID },
        properties: {
          // Title property - candidate name
          'Nom': {
            title: [
              {
                text: {
                  content: data.name
                }
              }
            ]
          },
          // Email
          'E-mail': {
            email: data.email
          },
          // Phone
          'Téléphone': {
            phone_number: data.phone || null
          },
          // LinkedIn URL
          'URL Linkedin': {
            url: data.linkedin || null
          },
          // CV URL (using Lien source)
          'Lien source': {
            url: data.cvUrl || null
          }
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Notion API error:', error);
      throw new Error(`Failed to submit application: ${error}`);
    }

    const result = await response.json();

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Application submitted successfully',
        pageId: result.id
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
