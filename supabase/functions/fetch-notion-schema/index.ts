import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POSTES_DATABASE_ID = "2787e1816fb481d2a0e8d4b2c1dd38f9";

const CACHE_KEY = "notion:schema:postes:v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns the select/multi_select/status options for the Postes database.
 * Cached in notion_api_cache for 1 hour.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    const resp = await fetch(`https://api.notion.com/v1/databases/${POSTES_DATABASE_ID}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
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
      'Localisation': 'location',
      'Politique de remote': 'remote',
      'Priorité': 'priority',
      'Entité': 'entity',
      'Canal de publication': 'channel',
    };

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
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
