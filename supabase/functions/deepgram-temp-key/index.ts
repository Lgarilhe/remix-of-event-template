// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const _authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await (_authClient as any).auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    const DEEPGRAM_PROJECT_ID = Deno.env.get("DEEPGRAM_PROJECT_ID");

    if (!DEEPGRAM_API_KEY) {
      return new Response(
        JSON.stringify({ error: "DEEPGRAM_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If PROJECT_ID is set, use Deepgram's temporary key API (recommended)
    if (DEEPGRAM_PROJECT_ID) {
      const res = await fetchWithTimeout(
        `https://api.deepgram.com/v1/projects/${DEEPGRAM_PROJECT_ID}/keys`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${DEEPGRAM_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            comment: `temp-key-${Date.now()}`,
            scopes: ['usage:write'],
            time_to_live_in_seconds: 60,
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[deepgram-temp-key] Deepgram API error [${res.status}]:`, errText);
        throw new Error(`Failed to create temporary key: ${res.status}`);
      }

      const data = await res.json();
      return new Response(
        JSON.stringify({ key: data.key }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fallback: return the API key directly (for WebSocket auth)
    // WARNING: This exposes the master key — set DEEPGRAM_PROJECT_ID to use temp keys
    console.warn('[deepgram-temp-key] DEEPGRAM_PROJECT_ID not set — returning master key (insecure)');
    return new Response(
      JSON.stringify({ key: DEEPGRAM_API_KEY }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("deepgram-temp-key error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});