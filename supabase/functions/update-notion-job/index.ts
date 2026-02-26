import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");

/**
 * Maps app field names → Notion property names + types.
 * This is the single source of truth for the Postes database schema.
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

/**
 * Build a Notion property value payload from our field map.
 */
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY is not configured');
    }

    const { pageId, updates } = await req.json();

    if (!pageId || !updates || typeof updates !== 'object') {
      throw new Error('Missing pageId or updates');
    }

    console.log(`[update-notion-job] Updating page ${pageId}`, Object.keys(updates));

    // Build Notion properties payload
    const properties: Record<string, any> = {};

    for (const [field, value] of Object.entries(updates)) {
      const mapping = FIELD_MAP[field];
      if (!mapping) {
        console.warn(`[update-notion-job] Unknown field: ${field}, skipping`);
        continue;
      }

      // Title property needs special handling — find the actual title property name
      if (mapping.notionKey === '__title__') {
        // Fetch the page to discover the title property name
        const pageResp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
          headers: {
            'Authorization': `Bearer ${NOTION_API_KEY}`,
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

    // Update the Notion page
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
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

    // Invalidate the jobs cache so next fetch picks up changes
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check");
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase
        .from('notion_api_cache')
        .delete()
        .eq('cache_key', 'notion:jobs:v1');
      console.log('[update-notion-job] Cache invalidated');
    }

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
