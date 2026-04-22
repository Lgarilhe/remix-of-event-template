// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchWithTimeout(url, options);
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
      await new Promise(r => setTimeout(r, (retryAfter * 1000) + Math.random() * 500));
      continue;
    }
    if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
      continue;
    }
    return res;
  }
  return fetchWithTimeout(url, options);
}

interface ContactSubmission {
  name: string;
  email: string;
  company?: string;
  message: string;
}

async function createNotionPage(data: ContactSubmission, notionApiKey: string, notionDatabaseId: string) {
  const response = await fetchWithRetry("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${notionApiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: notionDatabaseId },
      properties: {
        "Nom complet": {
          title: [{ text: { content: data.name } }],
        },
        "Email": {
          email: data.email,
        },
        "Entreprise": {
          rich_text: [{ text: { content: data.company || "" } }],
        },
        "Statut": {
          status: { name: "Nouveau" },
        },
      },
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: "Message" } }],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: data.message } }],
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Notion API error:", error);
    throw new Error(`Failed to create Notion page: ${error}`);
  }

  return await response.json();
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const _authClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await _authClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { name, email, company, message, organization_id }: ContactSubmission & { organization_id?: string } = body;

    // Resolve Notion credentials from organization_integrations
    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id est requis" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify org membership — prevent cross-org Notion access
    const userId = claimsData.claims.sub as string;
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: integrationData } = await supabase
      .from('organization_integrations')
      .select('notion_api_key, notion_leads_db_id, notion_connected')
      .eq('organization_id', organization_id)
      .single();

    if (!integrationData?.notion_connected || !integrationData.notion_api_key || !integrationData.notion_leads_db_id) {
      return new Response(
        JSON.stringify({ error: "Intégration Notion non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const notionApiKey = integrationData.notion_api_key;
    const notionDatabaseId = integrationData.notion_leads_db_id;

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Creating Notion page for lead: ${name}`);
    
    const notionPage = await createNotionPage({ name, email, company, message }, notionApiKey, notionDatabaseId);
    
    console.log("Notion page created successfully:", notionPage.id);

    return new Response(
      JSON.stringify({ success: true, notionPageId: notionPage.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-notion function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
