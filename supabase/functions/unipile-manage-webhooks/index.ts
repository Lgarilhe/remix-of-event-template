// Deno.serve used directly
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
};

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}


const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const WEBHOOK_SECRET = Deno.env.get('UNIPILE_WEBHOOK_SECRET');

// Unipile API source values (cf. Unipile webhooks docs)
type WebhookSource = 'messaging' | 'users' | 'account_status' | 'email' | 'email_tracking';

// Map our internal names to Unipile API source values
const SOURCE_MAP: Record<string, WebhookSource> = {
  messaging: 'messaging',
  users: 'users',
  accounts: 'account_status',
  email: 'email',
  email_tracking: 'email_tracking',
};

// Reverse map for display
const REVERSE_SOURCE_MAP: Record<WebhookSource, string> = {
  messaging: 'messaging',
  users: 'users',
  account_status: 'accounts',
  email: 'email',
  email_tracking: 'email_tracking',
};

interface WebhookConfig {
  id?: string;
  request_url: string;
  source: WebhookSource;
  headers?: Array<{ key: string; value: string }>;
}

/**
 * Resolve Unipile credentials: try org-specific first, then fall back to env vars.
 */
async function resolveUnipileCredentials(organizationId?: string): Promise<{ apiKey: string; dsn: string } | null> {
  if (organizationId) {
    try {
      const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
      const sb = createClient(SUPABASE_URL!, serviceKey);
      
      const { data } = await sb
        .from('organization_integrations')
        .select('unipile_api_key, unipile_dsn, unipile_connected')
        .eq('organization_id', organizationId)
        .single();
      
      if (data?.unipile_connected && data?.unipile_api_key && data?.unipile_dsn) {
        const rawDsn = data.unipile_dsn;
        const dsn = rawDsn.startsWith('http') ? rawDsn.replace(/^https?:\/\//, '') : rawDsn;
        console.log(`[unipile-manage-webhooks] Using org-specific credentials for org ${organizationId}`);
        return { apiKey: data.unipile_api_key, dsn: `https://${dsn}` };
      }
    } catch (e) {
      console.warn('[unipile-manage-webhooks] Failed to resolve org credentials:', e);
    }
  }
  
  const apiKey = Deno.env.get('UNIPILE_API_KEY');
  const rawDsn = Deno.env.get('UNIPILE_DSN') || '';
  if (apiKey && rawDsn) {
    const dsn = rawDsn.startsWith('http') ? rawDsn : `https://${rawDsn}`;
    return { apiKey, dsn };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;
    const organizationId = (body as { organization_id?: string }).organization_id;

    const credentials = await resolveUnipileCredentials(organizationId);
    if (!credentials) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Unipile not configured',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { apiKey, dsn: UNIPILE_DSN } = credentials;

    switch (action) {
      case 'list': {
        const response = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks`, {
          headers: { 'X-API-KEY': apiKey },
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
        const listResponse = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks`, {
          headers: { 'X-API-KEY': apiKey },
        });

        let existingApiSources: string[] = [];
        if (listResponse.ok) {
          const existingData = await listResponse.json();
          const existingWebhooks = existingData?.items || existingData || [];
          existingApiSources = existingWebhooks.map((w: { source: string }) => w.source);
        }

        const webhookUrl = `${SUPABASE_URL}/functions/v1/unipile-webhook`;
        // 'email' = mail_received / mail_sent (réponses aux séquences email)
        // 'email_tracking' = opens / clicks (analytics)
        const allInternalSources = ['messaging', 'users', 'accounts', 'email', 'email_tracking'];
        const existingInternalSources = existingApiSources.map(s => REVERSE_SOURCE_MAP[s as WebhookSource] || s);
        
        const results: Array<{ source: string; success: boolean; error?: string; id?: string; skipped?: boolean }> = [];

        for (const internalSource of allInternalSources) {
          if (existingInternalSources.includes(internalSource)) {
            results.push({ source: internalSource, success: true, skipped: true });
            continue;
          }

          const apiSource = SOURCE_MAP[internalSource] || internalSource as WebhookSource;

          const config: WebhookConfig = {
            request_url: webhookUrl,
            source: apiSource,
            headers: WEBHOOK_SECRET 
              ? [{ key: 'Unipile-Auth', value: WEBHOOK_SECRET }]
              : undefined,
          };

          try {
            const response = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks`, {
              method: 'POST',
              headers: {
                'X-API-KEY': apiKey,
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
        const webhook_id = (body as { webhook_id?: string }).webhook_id;
        
        if (!webhook_id) {
          throw new Error('webhook_id is required');
        }

        const response = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks/${webhook_id}`, {
          method: 'DELETE',
          headers: { 'X-API-KEY': apiKey },
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
