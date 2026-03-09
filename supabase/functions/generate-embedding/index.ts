import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { text, type, entityId } = await req.json();

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

    const { error: upsertError } = await supabase
      .from(table)
      .upsert(
        { [idCol]: entityId, embedding: embeddingStr },
        { onConflict: idCol }
      );

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      throw new Error(`DB upsert failed: ${upsertError.message}`);
    }

    return new Response(
      JSON.stringify({ success: true, dimensions: embedding.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('generate-embedding error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
