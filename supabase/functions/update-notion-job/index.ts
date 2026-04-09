// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

async function resolveOrgCredentials(orgId: string) {
  const { data } = await supabase
    .from('organization_integrations')
    .select('notion_api_key, notion_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.notion_connected || !data.notion_api_key) {
    throw new Error('Intégration Notion non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  console.log('[update-notion-job] Using org-specific Notion credentials');
  return { notionApiKey: data.notion_api_key };
}

/**
 * Maps app field names → Notion property names + types.
 */
const FIELD_MAP: Record<string, { notionKey: string; type: string }> = {
  title:             { notionKey: '__title__', type: 'title' },
  status:            { notionKey: 'État', type: 'status' },
  seniority:         { notionKey: 'Séniorité', type: 'select' },
  contractType:      { notionKey: 'Type de contrat', type: 'multi_select' },
  location:          { notionKey: 'Localisation', type: 'rich_text' },
  remote:            { notionKey: 'Politique de remote', type: 'select' },
  salaryMin:         { notionKey: 'Salaire budget', type: 'number' },
  salaryMax:         { notionKey: 'Salaire maximum', type: 'number' },
  priority:          { notionKey: 'Priorité', type: 'select' },
  entity:            { notionKey: 'Entité', type: 'select' },
  description:       { notionKey: 'RAG — Synthèse', type: 'rich_text' },
  interviewProcess:  { notionKey: 'Process', type: 'rich_text' },
  mustHave:          { notionKey: '🔴 Must-have poste', type: 'rich_text' },
  shouldHave:        { notionKey: '🟡 Should-have poste', type: 'rich_text' },
  niceToHave:        { notionKey: '🟢 Nice-to-have poste', type: 'rich_text' },
  openingDate:       { notionKey: "Date d'ouverture", type: 'date' },
  startDate:         { notionKey: 'Date de démarrage espérée', type: 'date' },
  channel:           { notionKey: 'Canal de publication', type: 'select' },
  sourcingCriteria:  { notionKey: 'Critères sourcing', type: 'rich_text' },
  teamInfo:          { notionKey: 'Équipe (client)', type: 'rich_text' },
  xpMin:             { notionKey: 'XP minimum', type: 'number' },
  xpMax:             { notionKey: 'XP maximum', type: 'number' },
  tjm:               { notionKey: 'TJM', type: 'number' },
  skillsSourcing:    { notionKey: 'Skills sourcing', type: 'rich_text' },
};

function buildNotionProperty(type: string, value: any): any {
  switch (type) {
    case 'title':
      return { title: [{ text: { content: String(value ?? '') } }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: String(value ?? '') } }] };
    case 'number':
      return { number: value === '' || value === null || value === undefined ? null : Number(value) };
    case 'select':
      if (!value || value === '—') return { select: null };
      return { select: { name: String(value) } };
    case 'multi_select':
      if (!value) return { multi_select: [] };
      const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim()).filter(Boolean);
      return { multi_select: items.map((name: string) => ({ name })) };
    case 'status':
      if (!value) return { status: null };
      return { status: { name: String(value) } };
    case 'date':
      if (!value) return { date: null };
      return { date: { start: String(value) } };
    default:
      return { rich_text: [{ text: { content: String(value ?? '') } }] };
  }
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

    const { pageId, updates, organization_id } = await req.json();

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

    if (!pageId || !updates || typeof updates !== 'object') {
      throw new Error('Missing pageId or updates');
    }

    console.log(`[update-notion-job] Updating page ${pageId}`, Object.keys(updates));

    const properties: Record<string, any> = {};

    for (const [field, value] of Object.entries(updates)) {
      const mapping = FIELD_MAP[field];
      if (!mapping) {
        console.warn(`[update-notion-job] Unknown field: ${field}, skipping`);
        continue;
      }

      if (mapping.notionKey === '__title__') {
        const pageResp = await fetchWithRetry(`https://api.notion.com/v1/pages/${pageId}`, {
          headers: {
            'Authorization': `Bearer ${notionApiKey}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (pageResp.ok) {
          const pageData = await pageResp.json();
          const titlePropName = Object.entries(pageData.properties).find(
            ([_, prop]: [string, any]) => prop.type === 'title'
          )?.[0];
          if (titlePropName) {
            properties[titlePropName] = buildNotionProperty('title', value);
          }
        }
      } else {
        properties[mapping.notionKey] = buildNotionProperty(mapping.type, value);
      }
    }

    if (Object.keys(properties).length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No valid fields to update' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetchWithRetry(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[update-notion-job] Notion API error:`, errorBody);
      throw new Error(`Notion API error: ${response.status} — ${errorBody}`);
    }

    const result = await response.json();

    // Invalidate the jobs cache
    await supabase
      .from('notion_api_cache')
      .delete()
      .eq('cache_key', 'notion:jobs:v1');
    console.log('[update-notion-job] Cache invalidated');

    return new Response(
      JSON.stringify({ success: true, pageId: result.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[update-notion-job] Error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
