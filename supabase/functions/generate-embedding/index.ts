// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

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
    const userId = auth.userId;

    // Rate limit: 30 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'generate_embedding', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    const { text, type, entityId, organization_id } = await req.json();

    if (!text || !type || !entityId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: text, type, entityId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (type !== 'candidate' && type !== 'job') {
      return new Response(
        JSON.stringify({ error: "type must be 'candidate' or 'job'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user belongs to the organization if provided
    if (organization_id) {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Call OpenAI Embeddings API
    const res = await fetchWithTimeout('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`OpenAI API error [${res.status}]:`, errBody);
      throw new Error(`OpenAI API error: ${res.status}`);
    }

    const data = await res.json();
    const embedding = data.data[0].embedding;

    // Store in the correct table
    const table = type === 'candidate' ? 'candidate_profiles' : 'job_profiles';
    const idCol = type === 'candidate' ? 'candidate_id' : 'job_id';

    // Build upsert payload with embedding as a pgvector-compatible string
    const embeddingStr = `[${embedding.join(',')}]`;
    const upsertPayload: Record<string, unknown> = { [idCol]: entityId, embedding: embeddingStr };
    if (organization_id) {
      upsertPayload.organization_id = organization_id;
    }

    // Retry upsert up to 2 times to handle transient 502s
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: upsertError } = await supabase
        .from(table)
        .upsert(upsertPayload, { onConflict: idCol });

      if (!upsertError) {
        lastError = null;
        break;
      }

      const msg = typeof upsertError.message === 'string' && upsertError.message.includes('<!DOCTYPE')
        ? `Supabase returned 502 (attempt ${attempt + 1}/3)`
        : upsertError.message;
      console.warn(`Upsert attempt ${attempt + 1} failed:`, msg);
      lastError = msg;

      if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }

    if (lastError) {
      throw new Error(`DB upsert failed after retries: ${lastError}`);
    }

    return new Response(
      JSON.stringify({ success: true, dimensions: embedding.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('generate-embedding error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});