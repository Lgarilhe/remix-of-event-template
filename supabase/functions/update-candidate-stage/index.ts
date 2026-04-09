// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function resolveOrgCredentials(orgId: string): Promise<{ notionApiKey: string }> {
  const { data } = await supabase
    .from('organization_integrations')
    .select('notion_api_key, notion_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.notion_connected || !data.notion_api_key) {
    throw new Error('Intégration Notion non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  console.log('[update-candidate-stage] Using org-specific Notion credentials');
  return { notionApiKey: data.notion_api_key };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: validate JWT and org membership ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { shortlistId, newStage, organization_id } = await req.json();

    if (organization_id) {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!organization_id) {
      throw new Error('organization_id est requis');
    }
    const { notionApiKey } = await resolveOrgCredentials(organization_id);

    if (!shortlistId || !newStage) {
      throw new Error('Missing shortlistId or newStage');
    }

    const response = await fetchWithTimeout(`https://api.notion.com/v1/pages/${shortlistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          'Etape': {
            select: {
              name: newStage,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Notion API error:', error);
      throw new Error(`Failed to update Notion page: ${error}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error updating candidate stage:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
