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

// Unipile API uses 'account_status' not 'accounts' for the source value
type WebhookSource = 'messaging' | 'users' | 'account_status';

// Map our internal names to Unipile API source values
const SOURCE_MAP: Record<string, WebhookSource> = {
  messaging: 'messaging',
  users: 'users',
  accounts: 'account_status', // Unipile uses 'account_status' not 'accounts'
};

// Reverse map for display
const REVERSE_SOURCE_MAP: Record<WebhookSource, string> = {
  messaging: 'messaging',
  users: 'users',
  account_status: 'accounts',
};

interface WebhookConfig {
  id?: string;
  request_url: string;
  source: WebhookSource;
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

        let existingApiSources: string[] = [];
        if (listResponse.ok) {
          const existingData = await listResponse.json();
          const existingWebhooks = existingData?.items || existingData || [];
          existingApiSources = existingWebhooks.map((w: { source: string }) => w.source);
        }

        // Register only missing webhooks
        const webhookUrl = `${SUPABASE_URL}/functions/v1/unipile-webhook`;
        // Internal names we want to register
        const allInternalSources = ['messaging', 'users', 'accounts'];
        // Convert existing API sources back to internal names for comparison
        const existingInternalSources = existingApiSources.map(s => REVERSE_SOURCE_MAP[s as WebhookSource] || s);
        
        const results: Array<{ source: string; success: boolean; error?: string; id?: string; skipped?: boolean }> = [];

        // Mark already existing as skipped
        for (const internalSource of allInternalSources) {
          if (existingInternalSources.includes(internalSource)) {
            results.push({ source: internalSource, success: true, skipped: true });
            continue;
          }

          // Convert internal source name to API source name
          const apiSource = SOURCE_MAP[internalSource] || internalSource as WebhookSource;

          const config: WebhookConfig = {
            request_url: webhookUrl,
            source: apiSource,
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
              results.push({ source: internalSource, success: false, error: `${response.status}: ${errorText}` });
            } else {
              const data = await response.json();
              results.push({ source: internalSource, success: true, id: data.webhook_id || data.id });
            }
          } catch (err) {
            results.push({ 
              source: internalSource, 
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
