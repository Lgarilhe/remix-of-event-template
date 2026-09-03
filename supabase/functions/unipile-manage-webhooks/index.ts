// Deno.serve used directly
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { requireOrgAccess } from "../_shared/require-auth.ts";
import { resolveUnipileV2Credentials, unipileV2Fetch, V2_TRIGGER_EVENTS, resolveV2WebhookToken } from "../_shared/unipile-v2.ts";

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

// Events à subscribe par source. Bug 2026-05-13 : sans `events`, Unipile crée
// le webhook mais ne push AUCUN event (events:[]). Conséquence : on n'a jamais
// reçu un event `credentials` (account_status) → DB jamais updated quand le
// compte LinkedIn se déconnecte → UI affiche CREDENTIALS sans qu'on le sache.
const EVENTS_PER_SOURCE: Record<WebhookSource, string[]> = {
  messaging: ['message_received', 'message_reaction', 'message_read'],
  users: ['new_relation'],
  account_status: [
    'creation_success', 'creation_fail', 'deleted', 'reconnected',
    'sync_success', 'stopped', 'ok', 'connecting', 'error',
    'credentials', 'permissions',
  ],
  email: ['mail_received'],
  email_tracking: ['mail_opened'],
};

interface WebhookConfig {
  id?: string;
  request_url: string;
  source: WebhookSource;
  events?: string[];
  headers?: Array<{ key: string; value: string }>;
}

interface UnipileWebhook {
  id: string;
  request_url: string;
  source: string;
  events?: string[];
  headers?: Array<{ key: string; value: string }>;
}

/** Détecte si un webhook pointant déjà vers notre URL est cassé (pas de secret OU pas d'events). */
function isWebhookBroken(w: UnipileWebhook): boolean {
  const hasSecret = (w.headers || []).some(h => (h?.key || '').toLowerCase() === 'unipile-auth' && !!h?.value);
  const wantedEvents = EVENTS_PER_SOURCE[w.source as WebhookSource];
  const hasAllEvents = !wantedEvents || (w.events || []).length >= wantedEvents.length;
  return !hasSecret || !hasAllEvents;
}

/**
 * Resolve Unipile credentials: try org-specific first, then fall back to env vars.
 */
async function resolveUnipileCredentials(organizationId?: string): Promise<{ apiKey: string; dsn: string; source: 'org' | 'env' } | null> {
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
        return { apiKey: data.unipile_api_key, dsn: `https://${dsn}`, source: 'org' };
      }
    } catch (e) {
      console.warn('[unipile-manage-webhooks] Failed to resolve org credentials:', e);
    }
  }
  
  const apiKey = Deno.env.get('UNIPILE_API_KEY');
  const rawDsn = Deno.env.get('UNIPILE_DSN') || '';
  if (apiKey && rawDsn) {
    const dsn = rawDsn.startsWith('http') ? rawDsn : `https://${rawDsn}`;
    return { apiKey, dsn, source: 'env' };
  }
  return null;
}

/** Réponse JSON sans jamais renvoyer un token dans une URL (query retirée). */
function stripQuery(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/**
 * Mutations sur la clé Unipile PLATEFORME (fallback env partagé par toutes
 * les orgs, et toute la branche v2) : réservées aux user ids listés dans le
 * secret KONEKT_PLATFORM_ADMIN_USER_IDS (séparés par des virgules) quand il
 * est défini. Sans ce secret, owner/admin de l'org suffit (comportement
 * historique) ; le poser est recommandé (SEC-031).
 */
function platformAdminDenied(userId: string, corsHeadersForResponse: Record<string, string>): Response | null {
  const raw = Deno.env.get('KONEKT_PLATFORM_ADMIN_USER_IDS') ?? '';
  const allow = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0 || allow.includes(userId)) return null;
  return new Response(JSON.stringify({
    success: false,
    error: 'Action réservée aux administrateurs de la plateforme',
  }), { status: 403, headers: { ...corsHeadersForResponse, 'Content-Type': 'application/json' } });
}

/**
 * Actions API v2 (BETA) — opt-in via body { api_version: 'v2' }.
 * La v2 gère les webhooks au niveau application : UN endpoint avec un tableau
 * `trigger_events` unifié (plus de notion de `source` par webhook comme en v1).
 * La création v2 n'accepte pas de headers custom → le secret est porté par un
 * token dérivé en query param (voir deriveV2WebhookToken).
 */
async function handleV2Action(action: string | undefined, body: Record<string, unknown>): Promise<Response> {
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  const v2 = resolveUnipileV2Credentials();
  if (!v2) {
    return jsonResponse({ success: false, error: 'Unipile v2 not configured (secret UNIPILE_V2_API_KEY manquant)' });
  }

  switch (action) {
    case 'list': {
      const resp = await unipileV2Fetch(v2, '/webhooks/endpoints/');
      if (!resp.ok) throw new Error(`Failed to list v2 webhook endpoints: ${resp.status} ${await resp.text()}`);
      const data = await resp.json();
      // Projection : l'URL porte le token d'authentification en query (SEC-005).
      const rawItems = (data?.data ?? data?.items ?? (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
      const items = rawItems.map((e) => ({
        id: e.id,
        url: stripQuery(e.url),
        trigger_events: e.trigger_events,
        description: e.description,
        created_at: e.created_at,
      }));
      return jsonResponse({ success: true, api_version: 'v2', webhooks: { items } });
    }

    case 'register': {
      const token = await resolveV2WebhookToken();
      if (!token) throw new Error('UNIPILE_V2_WEBHOOK_TOKEN (or UNIPILE_WEBHOOK_SECRET) must be set before registering v2 webhooks');
      const receiverBase = `${SUPABASE_URL}/functions/v1/unipile-webhook`;
      const targetUrl = `${receiverBase}?v2_token=${token}`;

      // Idempotent : skip si un endpoint complet pointe déjà vers notre receiver.
      const listResp = await unipileV2Fetch(v2, '/webhooks/endpoints/');
      if (listResp.ok) {
        const listJson = await listResp.json();
        const items: Array<{ id: string; url?: string; trigger_events?: string[] }> =
          listJson?.data ?? listJson?.items ?? [];
        const existing = items.find((e) => (e.url || '').startsWith(receiverBase));
        if (existing) {
          const missing = V2_TRIGGER_EVENTS.filter((ev) => !(existing.trigger_events || []).includes(ev));
          if (missing.length === 0 && (existing.url || '').includes('v2_token=')) {
            return jsonResponse({ success: true, api_version: 'v2', skipped: true, id: existing.id, webhook_url: receiverBase });
          }
          // Endpoint incomplet (events manquants ou token absent) → recréé proprement
          await unipileV2Fetch(v2, `/webhooks/endpoints/${existing.id}`, { method: 'DELETE' });
        }
      }

      const createResp = await unipileV2Fetch(v2, '/webhooks/endpoints/', {
        method: 'POST',
        body: JSON.stringify({
          trigger_events: V2_TRIGGER_EVENTS,
          url: targetUrl,
          description: 'Konekt — webhook unifié (messaging, relations, comptes, email, tracking)',
        }),
      });
      if (!createResp.ok) throw new Error(`Failed to create v2 webhook endpoint: ${createResp.status} ${await createResp.text()}`);
      const created = await createResp.json();
      return jsonResponse({
        success: true,
        api_version: 'v2',
        id: created?.id ?? created?.data?.id,
        webhook_url: receiverBase,
        trigger_events: V2_TRIGGER_EVENTS,
      });
    }

    case 'delete': {
      const webhookId = body.webhook_id as string | undefined;
      if (!webhookId || /[\/\\?#]/.test(webhookId) || webhookId.includes('..')) throw new Error('webhook_id is required');
      const resp = await unipileV2Fetch(v2, `/webhooks/endpoints/${encodeURIComponent(webhookId)}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`Failed to delete v2 webhook endpoint: ${resp.status} ${await resp.text()}`);
      return jsonResponse({ success: true, api_version: 'v2' });
    }

    default:
      throw new Error(`Unknown v2 action: ${action}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    // AUTH + org membership — this endpoint MANAGES an org's LinkedIn webhooks
    // (it is NOT a webhook receiver). Previously it had no auth at all, so any
    // caller could list/register/delete another org's webhooks by passing its id.
    let organizationId: string;
    let userId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let adminClient: any;
    try {
      const access = await requireOrgAccess(req, body as Record<string, unknown>, corsHeaders);
      organizationId = access.organizationId;
      userId = access.userId;
      adminClient = access.adminClient;
    } catch (resp) {
      return resp as Response;
    }

    // Rôle owner/admin exigé pour toutes les actions (SEC-031) : la gestion des
    // webhooks agit sur la clé plateforme partagée. L'UI est déjà admin-only.
    const { data: membership } = await adminClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    const callerRole = (membership as { role?: string } | null)?.role;
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return new Response(JSON.stringify({
        success: false,
        error: "Action réservée aux administrateurs de l'organisation",
      }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isMutation = action === 'register' || action === 'delete' || action === 'bootstrap-prod';

    // Branche v2 (BETA) — ne touche pas au chemin v1 ci-dessous.
    // Les credentials v2 sont toujours ceux de la plateforme.
    if ((body as { api_version?: string }).api_version === 'v2') {
      if (isMutation) {
        const denied = platformAdminDenied(userId, corsHeaders);
        if (denied) return denied;
      }
      return await handleV2Action(action, body as Record<string, unknown>);
    }

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

    if (isMutation && credentials.source === 'env') {
      const denied = platformAdminDenied(userId, corsHeaders);
      if (denied) return denied;
    }

    switch (action) {
      case 'list': {
        const response = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks`, {
          headers: { 'X-API-KEY': apiKey },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to list webhooks: ${response.status} ${errorText}`);
        }

        const raw = await response.json();
        // Projection (SEC-005) : la réponse brute contient headers[].value, soit
        // UNIPILE_WEBHOOK_SECRET en clair. WebhookManager ne lit que
        // id / request_url / source.
        const rawItems = (raw?.items ?? (Array.isArray(raw) ? raw : [])) as UnipileWebhook[];
        const items = rawItems.map((w) => ({
          id: w.id,
          request_url: w.request_url,
          source: w.source,
          events: w.events ?? [],
          has_secret: (w.headers || []).some((h) => (h?.key || '').toLowerCase() === 'unipile-auth' && !!h?.value),
        }));
        return new Response(JSON.stringify({ success: true, webhooks: { items } }), {
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
            events: EVENTS_PER_SOURCE[apiSource],
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

        if (!webhook_id || typeof webhook_id !== 'string' || /[\/\\?#]/.test(webhook_id) || webhook_id.includes('..')) {
          throw new Error('webhook_id is required');
        }

        const response = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks/${encodeURIComponent(webhook_id)}`, {
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

      case 'bootstrap-prod': {
        // Bootstrap webhooks for the current konekt-production project:
        // 1. Delete any webhook pointing to URLs other than the current SUPABASE_URL
        //    AND other than the leadmagnet-worker (kept on purpose by Laurent)
        // 2. Register the 5 sources to konekt-production /functions/v1/unipile-webhook
        //
        // Pass `dry_run: true` in body to preview without modifying anything.
        const dryRun = !!(body as { dry_run?: boolean }).dry_run;
        // Motif de conservation fixé côté serveur : un client ne doit pas
        // pouvoir choisir ce qui survit au nettoyage de la clé plateforme.
        const keepUrlPattern = 'leadmagnet-worker';
        const targetUrl = `${SUPABASE_URL}/functions/v1/unipile-webhook`;

        const listResp = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks`, { headers: { 'X-API-KEY': apiKey } });
        if (!listResp.ok) throw new Error(`List webhooks failed: ${listResp.status}`);
        const listJson = await listResp.json();
        const allWebhooks: UnipileWebhook[] = listJson?.items || listJson?.webhooks?.items || [];

        const targetUrlLower = targetUrl.toLowerCase();
        // Webhooks to delete : (1) non-target URLs (other env) sauf leadmagnet,
        // (2) target URL mais cassés (pas de secret OU events vides).
        const toDelete = allWebhooks.filter(w => {
          const url = (w.request_url || '').toLowerCase();
          if (url.includes(keepUrlPattern)) return false; // explicitly kept
          if (url === targetUrlLower) {
            // Sur target : delete uniquement si cassé (à recréer proprement)
            return isWebhookBroken(w);
          }
          return true; // sur autre URL non whitelistée
        });

        // Sources déjà bien configurées sur target (avec secret + events) : skip
        const healthyTargetSources = allWebhooks
          .filter(w => (w.request_url || '').toLowerCase() === targetUrlLower && !isWebhookBroken(w))
          .map(w => w.source);

        const allInternalSources: WebhookSource[] = ['messaging', 'users', 'account_status', 'email', 'email_tracking'];
        const toCreate = allInternalSources.filter(src => !healthyTargetSources.includes(src));

        if (dryRun) {
          return new Response(JSON.stringify({
            success: true,
            dry_run: true,
            target_url: targetUrl,
            keep_pattern: keepUrlPattern,
            total_webhooks: allWebhooks.length,
            to_delete: toDelete.map(w => ({
              id: w.id, url: w.request_url, source: w.source, events: w.events,
              reason: (w.request_url || '').toLowerCase() === targetUrlLower
                ? 'broken (missing secret or events)'
                : 'other env',
            })),
            to_create: toCreate,
            healthy_on_target: healthyTargetSources,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const deleteResults: Array<{ id: string; success: boolean; error?: string }> = [];
        for (const w of toDelete) {
          try {
            const resp = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks/${w.id}`, {
              method: 'DELETE',
              headers: { 'X-API-KEY': apiKey },
            });
            if (!resp.ok) {
              const errText = await resp.text();
              deleteResults.push({ id: w.id, success: false, error: `${resp.status}: ${errText.slice(0, 200)}` });
            } else {
              deleteResults.push({ id: w.id, success: true });
            }
          } catch (err) {
            deleteResults.push({ id: w.id, success: false, error: err instanceof Error ? err.message : 'unknown' });
          }
        }

        const createResults: Array<{ source: string; success: boolean; error?: string; id?: string }> = [];
        for (const src of toCreate) {
          const config: WebhookConfig = {
            request_url: targetUrl,
            source: src,
            events: EVENTS_PER_SOURCE[src],
            headers: WEBHOOK_SECRET ? [{ key: 'Unipile-Auth', value: WEBHOOK_SECRET }] : undefined,
          };
          try {
            const resp = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/webhooks`, {
              method: 'POST',
              headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify(config),
            });
            if (!resp.ok) {
              const errText = await resp.text();
              createResults.push({ source: src, success: false, error: `${resp.status}: ${errText.slice(0, 200)}` });
            } else {
              const data = await resp.json();
              createResults.push({ source: src, success: true, id: data.webhook_id || data.id });
            }
          } catch (err) {
            createResults.push({ source: src, success: false, error: err instanceof Error ? err.message : 'unknown' });
          }
        }

        return new Response(JSON.stringify({
          success: deleteResults.every(r => r.success) && createResults.every(r => r.success),
          target_url: targetUrl,
          deleted: deleteResults,
          created: createResults,
          kept_url_pattern: keepUrlPattern,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
