/**
 * Edge Function: sequence-webhooks-handler
 *
 * Récepteur des événements de SUIVI des e-mails de séquence du service de
 * connexion (API v2) : `tracking.open` et `tracking.click`. Il complète le suivi
 * par pixel de sequence-email-track.
 *
 * Authentification : le point de terminaison d'un webhook v2 ne porte aucun en-tête
 * personnalisé, le jeton `?v2_token=` de l'URL est donc la seule preuve admise
 * (verifyWebhookRequest, comparaison en temps constant, échec fermé : 503 sans
 * jeton configuré, 401 sinon). L'ancien en-tête `x-webhook-secret` n'est plus lu.
 *
 * Événements traités par `unipile-webhook` (PAS ici, pour ne rien traiter deux
 * fois) : message.new, relation.new, email.new. Reçus ici (point de terminaison
 * mal configuré), ils sont journalisés et ignorés.
 *
 * Le suivi natif n'est actif que si l'envoi le demande (`tracking_options` à
 * l'envoi d'un e-mail) : sequence-send-email ne le demande pas aujourd'hui, ce
 * récepteur ne reçoit donc rien tant que scripts/setup-sequence-webhooks.ts n'a pas
 * abonné un point de terminaison ET que l'envoi n'active pas le suivi. La forme des
 * charges tracking.* n'est pas documentée : seul `tracking_id` est lu, comme avant.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";
import { describeForLog, flattenEnvelope, verifyWebhookRequest, webhookDedupKey } from "../_shared/unipile/index.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;

// ============ WEBHOOK HANDLERS ============

async function handleMailTracking(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: Record<string, unknown>,
  eventType: 'open' | 'click',
) {
  const trackingId = payload.tracking_id as string;
  if (!trackingId) return;

  const { data: tracking } = await supabase
    .from('sequence_email_tracking')
    .select('execution_id')
    .eq('tracking_id', trackingId)
    .single();

  if (!tracking) return;

  const { data: execution } = await supabase
    .from('sequence_step_executions')
    .select('id, status, tracking_data')
    .eq('id', tracking.execution_id)
    .single();

  if (!execution) return;

  const now = new Date().toISOString();

  // Audit Opus 2026-05-07 : utilisation de la RPC atomic_tracking_append pour
  // éviter les lost-updates quand un open/click pixel + un open/click webhook
  // arrivent simultanément. La RPC fait un jsonb_set + array_append en SQL
  // atomique et préserve la priorité du status (sent < opened < clicked < replied).
  const field = eventType === 'open' ? 'opened_at' : 'clicked_at';
  const newStatus = eventType === 'open' ? 'opened' : 'clicked';

  const { error: rpcError } = await supabase.rpc('atomic_tracking_append', {
    p_execution_id: execution.id,
    p_field: field,
    p_value: now,
    p_new_status: newStatus,
  });

  if (rpcError) {
    // Fallback non-atomique en dernier recours (lost-update possible mais
    // mieux que de perdre l'event entièrement). Logué pour alerting.
    console.error(`[webhooks] atomic_tracking_append RPC failed (${rpcError.message}) — falling back to read-modify-write`);
    const trackingData = (execution.tracking_data || {}) as Record<string, unknown>;
    const STATUS_PRIORITY: Record<string, number> = {
      'sent': 2, 'opened': 3, 'clicked': 4, 'replied': 5,
    };
    const currentPriority = STATUS_PRIORITY[execution.status] ?? 0;
    const list = (trackingData[field] || []) as string[];
    const updates: Record<string, unknown> = {
      tracking_data: { ...trackingData, [field]: [...list, now] },
    };
    if ((STATUS_PRIORITY[newStatus] ?? 0) > currentPriority) {
      updates.status = newStatus;
    }
    await supabase.from('sequence_step_executions').update(updates).eq('id', execution.id);
  }
}

// ============ MAIN HANDLER ============

Deno.serve(async (req) => {
  // 200 pour les cas traités/ignorés ; les échecs RÉELS répondent 500 (catch
  // final) pour déclencher les retries du provider.
  const ok = (body: Record<string, unknown> = { received: true }) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return ok({ error: 'Method not allowed' });
  }

  // Authentification par le jeton de l'URL, fail-closed : sans jeton configuré
  // côté Supabase on refuse tout le trafic (503), jeton absent ou faux : 401.
  const auth = await verifyWebhookRequest(req);
  if (!auth.ok) {
    if (auth.reason === 'not_configured') {
      console.error('[webhooks] No delivery token configured (UNIPILE_V2_WEBHOOK_TOKEN) — refusing webhook for security');
    } else {
      console.warn('[webhooks] Invalid or missing delivery token');
    }
    return new Response(JSON.stringify({ error: auth.status === 503 ? 'Webhook not configured' : 'Unauthorized' }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let dedupKey: string | null = null;
  // deno-lint-ignore no-explicit-any
  let supabaseForCleanup: any = null;
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const flat = flattenEnvelope(raw);
    if (!flat) {
      console.warn('[webhooks] Ignored: body is not a v2 event envelope');
      return ok({ received: true, ignored: 'not_a_v2_envelope' });
    }
    const event = String(flat.v2_event ?? '');

    console.log(`[webhooks] Received event: ${event}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (event) {
      case 'message.new':
      case 'relation.new':
      case 'email.new':
        // Gérés par `unipile-webhook` (messages, acceptations d'invitation, réponses
        // e-mail : réponses automatiques et rebonds écartés, rattachement borné à
        // l'organisation de la boîte). Ici, aucun rattachement ni clôture : on journalise.
        console.warn(`[webhooks] Event "${event}" received here but handled by unipile-webhook — ignoring. Re-run scripts/setup-sequence-webhooks.ts to clean up.`);
        break;

      case 'tracking.open':
      case 'tracking.click': {
        // Une nouvelle livraison du même événement n'est pas recomptée.
        dedupKey = webhookDedupKey(flat);
        if (dedupKey) {
          const { data: isNew } = await supabase.rpc('record_webhook_event', {
            p_event_key: dedupKey,
            p_provider: 'unipile',
            p_event_type: event,
            p_account_id: typeof flat.account_id === 'string' ? flat.account_id : null,
          });
          if (isNew === false) {
            console.log('[webhooks] Duplicate tracking event ignored');
            dedupKey = null;
            return ok({ received: true, deduplicated: true });
          }
          supabaseForCleanup = supabase;
        }
        await handleMailTracking(supabase, flat, event === 'tracking.open' ? 'open' : 'click');
        break;
      }

      default:
        console.log(`[webhooks] Unhandled event type: ${event}`);
    }

    return ok();
  } catch (err) {
    console.error('[webhooks] Error processing webhook:', describeForLog(err));
    // Échec réel de traitement → 500 pour déclencher les retries du provider
    // au lieu de perdre l'event définitivement (audit 2026-07, Delivery M11).
    // La ligne de dédoublonnage est retirée, sinon le rejeu serait ignoré.
    if (dedupKey && supabaseForCleanup) {
      try {
        await supabaseForCleanup.from('webhook_event_log').delete().eq('event_key', dedupKey);
      } catch (cleanupErr) {
        console.error('[webhooks] Dedup cleanup failed:', cleanupErr);
      }
    }
    return new Response(JSON.stringify({ error: 'Processing error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
