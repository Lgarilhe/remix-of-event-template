import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN_RAW = Deno.env.get('UNIPILE_DSN') || '';
const UNIPILE_DSN = UNIPILE_DSN_RAW.startsWith('http') ? UNIPILE_DSN_RAW : `https://${UNIPILE_DSN_RAW}`;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET');

interface WebhookConfig {
  id?: string;
  request_url: string;
  source: 'messaging' | 'users' | 'accounts';
  headers?: Array<{ key: string; value: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Read body only once (Deno Request body can be consumed a single time)
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    switch (action) {
      case 'list': {
        // List all registered webhooks
        const response = await fetch(`${UNIPILE_DSN}/api/v1/webhooks`, {
          headers: { 'X-API-KEY': UNIPILE_API_KEY! },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to list webhooks: ${response.status} ${errorText}`);
        }

        const webhooks = await response.json();
        return new Response(JSON.stringify({ success: true, webhooks }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'register': {
        // First, list existing webhooks to avoid duplicates
        const listResponse = await fetch(`${UNIPILE_DSN}/api/v1/webhooks`, {
          headers: { 'X-API-KEY': UNIPILE_API_KEY! },
        });

        let existingSources: string[] = [];
        if (listResponse.ok) {
          const existingData = await listResponse.json();
          const existingWebhooks = existingData?.items || existingData || [];
          existingSources = existingWebhooks.map((w: { source: string }) => w.source);
        }

        // Register only missing webhooks
        const webhookUrl = `${SUPABASE_URL}/functions/v1/unipile-webhook`;
        const allSources: Array<'messaging' | 'users' | 'accounts'> = ['messaging', 'users', 'accounts'];
        const missingSources = allSources.filter(s => !existingSources.includes(s));
        
        const results: Array<{ source: string; success: boolean; error?: string; id?: string; skipped?: boolean }> = [];

        // Mark already existing as skipped
        for (const source of allSources) {
          if (existingSources.includes(source)) {
            results.push({ source, success: true, skipped: true });
            continue;
          }

          const config: WebhookConfig = {
            request_url: webhookUrl,
            source,
            headers: WEBHOOK_SECRET 
              ? [{ key: 'Unipile-Auth', value: WEBHOOK_SECRET }]
              : undefined,
          };

          try {
            const response = await fetch(`${UNIPILE_DSN}/api/v1/webhooks`, {
              method: 'POST',
              headers: {
                'X-API-KEY': UNIPILE_API_KEY!,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(config),
            });

            if (!response.ok) {
              const errorText = await response.text();
              results.push({ source, success: false, error: `${response.status}: ${errorText}` });
            } else {
              const data = await response.json();
              results.push({ source, success: true, id: data.webhook_id || data.id });
            }
          } catch (err) {
            results.push({ 
              source, 
              success: false, 
              error: err instanceof Error ? err.message : 'Unknown error' 
            });
          }
        }

        const allSucceeded = results.every(r => r.success);
        return new Response(JSON.stringify({ 
          success: allSucceeded, 
          results,
          webhook_url: webhookUrl,
          skipped: results.filter(r => r.skipped).length,
          registered: results.filter(r => !r.skipped && r.success).length,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete': {
        // Delete a webhook by ID
        const webhook_id = (body as { webhook_id?: string }).webhook_id;
        
        if (!webhook_id) {
          throw new Error('webhook_id is required');
        }

        const response = await fetch(`${UNIPILE_DSN}/api/v1/webhooks/${webhook_id}`, {
          method: 'DELETE',
          headers: { 'X-API-KEY': UNIPILE_API_KEY! },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to delete webhook: ${response.status} ${errorText}`);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('[unipile-manage-webhooks] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
