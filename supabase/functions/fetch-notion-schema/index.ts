// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
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
    .select('notion_api_key, notion_postes_db_id, notion_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.notion_connected || !data.notion_api_key) {
    throw new Error('Intégration Notion non configurée pour votre organisation. Rendez-vous dans Settings > Intégrations.');
  }

  console.log('[fetch-notion-schema] Using org-specific Notion credentials');
  return { notionApiKey: data.notion_api_key, postesDatabaseId: data.notion_postes_db_id || undefined };
}

const CACHE_KEY = "notion:schema:postes:v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns the select/multi_select/status options for the Postes database.
 * Cached in notion_api_cache for 1 hour.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const user = { id: auth.userId as string };

    // Resolve org credentials
    let orgId: string | null = null;
    try {
      const body = await req.clone().json();
      orgId = body?.organization_id || null;
    } catch {}
    const url = new URL(req.url);
    if (!orgId) orgId = url.searchParams.get('organization_id');

    if (orgId) {
      const { data: membership } = await supabase.from('organization_members').select('id').eq('user_id', user.id).eq('organization_id', orgId).maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    if (!orgId) {
      throw new Error('organization_id est requis');
    }
    const { notionApiKey, postesDatabaseId } = await resolveOrgCredentials(orgId);

    // Check cache first
    const { data: cached } = await supabase
      .from('notion_api_cache')
      .select('payload, updated_at')
      .eq('cache_key', CACHE_KEY)
      .maybeSingle();

    if (cached) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      if (age < CACHE_TTL_MS) {
        return new Response(JSON.stringify({ success: true, schema: cached.payload }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fetch database schema from Notion
    const resp = await fetchWithRetry(`https://api.notion.com/v1/databases/${postesDatabaseId}`, {
      headers: {
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Notion API error: ${resp.status} — ${body}`);
    }

    const db = await resp.json();

    // Map from Notion property names to our field names
    const PROP_TO_FIELD: Record<string, string> = {
      'État': 'status',
      'Séniorité': 'seniority',
      'Type de contrat': 'contractType',
      'Politique de remote': 'remote',
      'Priorité': 'priority',
      'Entité': 'entity',
      'Canal de publication': 'channel',
    };
    // Note: 'Localisation' is rich_text in Notion, not select — handled as free text input

    const schema: Record<string, { type: string; options: { name: string; color: string }[] }> = {};

    for (const [propName, prop] of Object.entries(db.properties) as [string, any][]) {
      const fieldName = PROP_TO_FIELD[propName];
      if (!fieldName) continue;

      if (prop.type === 'select' && prop.select?.options) {
        schema[fieldName] = {
          type: 'select',
          options: prop.select.options.map((o: any) => ({ name: o.name, color: o.color })),
        };
      } else if (prop.type === 'multi_select' && prop.multi_select?.options) {
        schema[fieldName] = {
          type: 'multi_select',
          options: prop.multi_select.options.map((o: any) => ({ name: o.name, color: o.color })),
        };
      } else if (prop.type === 'status' && prop.status?.options) {
        schema[fieldName] = {
          type: 'status',
          options: prop.status.options.map((o: any) => ({ name: o.name, color: o.color })),
        };
      }
    }

    // Cache result
    await supabase
      .from('notion_api_cache')
      .upsert({ cache_key: CACHE_KEY, payload: schema as any, updated_at: new Date().toISOString() }, { onConflict: 'cache_key' });

    return new Response(JSON.stringify({ success: true, schema }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[fetch-notion-schema]', msg);

    // Fallback: return stale cache if available
    try {
      const { data: stale } = await supabase
        .from('notion_api_cache')
        .select('payload')
        .eq('cache_key', CACHE_KEY)
        .maybeSingle();
      if (stale?.payload) {
        return new Response(JSON.stringify({ success: true, schema: stale.payload, stale: true, error: msg }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
