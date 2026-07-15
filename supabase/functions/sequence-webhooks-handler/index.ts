/**
 * Edge Function: sequence-webhooks-handler
 *
 * Receives provider webhooks and updates sequence enrollments/executions.
 * Complements the existing check_replies polling in process-sequences.
 *
 * Webhooks handled HERE :
 *   - mail_received (Email reply)
 *   - mail_opened / mail_link_clicked (Email tracking)
 *
 * Webhooks handled by `unipile-webhook` (NOT here, to avoid double processing —
 * audit Opus 2026-05-07) :
 *   - message_received (LinkedIn reply)
 *   - new_relation (LinkedIn invite accepted)
 *
 * Si on reçoit ces events ici (legacy webhook setup), on les ignore avec un
 * warning. Ré-enregistrer les webhooks Unipile via scripts/setup-sequence-
 * webhooks.ts pour ne plus les recevoir.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const WEBHOOK_SECRET = Deno.env.get('SEQUENCE_WEBHOOK_SECRET') || Deno.env.get('UNIPILE_WEBHOOK_SECRET') || '';

// S1 — timing-safe string comparison (constant time regardless of match position)
// évite les timing attacks sur la vérification du secret webhook.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============ HELPERS ============

/**
 * Cancel all scheduled/waiting executions for an enrollment.
 */
async function cancelRemainingExecutions(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  enrollmentId: string,
  reason: string,
) {
  await supabase
    .from('sequence_step_executions')
    .update({
      status: 'cancelled',
      skip_reason: reason,
      executed_at: new Date().toISOString(),
    })
    .eq('enrollment_id', enrollmentId)
    .in('status', ['scheduled', 'waiting_event', 'quota_blocked']);
}

/**
 * Stop all active enrollments for the same company in the same sequence.
 */
async function stopCompanyEnrollments(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  sequenceId: string,
  companyName: string,
  triggerEnrollmentId: string,
) {
  // Find other active enrollments with same company name
  const { data: companyEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('id')
    .eq('sequence_id', sequenceId)
    .eq('company_name', companyName)
    .eq('status', 'active')
    .neq('id', triggerEnrollmentId);

  if (!companyEnrollments?.length) return;

  for (const enrollment of companyEnrollments) {
    await supabase
      .from('sequence_enrollments')
      .update({
        status: 'stopped',
        completed_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id)
      .eq('status', 'active'); // Idempotent: only if still active

    await cancelRemainingExecutions(
      supabase,
      enrollment.id,
      `Company reply stop: another candidate at ${companyName} replied`,
    );
  }

  console.log(`[webhooks] Stopped ${companyEnrollments.length} enrollments for company "${companyName}" in sequence ${sequenceId}`);
}

/**
 * Handle a reply event (LinkedIn or email) for an enrollment.
 */
async function handleReply(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  enrollmentId: string,
  timestamp: string,
) {
  // Idempotent: check current status first
  const { data: enrollment } = await supabase
    .from('sequence_enrollments')
    .select('id, status, sequence_id, company_name, sequence:outreach_sequences(stop_on_company_reply)')
    .eq('id', enrollmentId)
    .single();

  if (!enrollment) return;
  if (enrollment.status === 'replied' || enrollment.status === 'completed' || enrollment.status === 'stopped') {
    console.log(`[webhooks] Enrollment ${enrollmentId} already in terminal state: ${enrollment.status}`);
    return;
  }

  // Mark enrollment as replied
  await supabase
    .from('sequence_enrollments')
    .update({
      status: 'replied',
      replied_at: timestamp,
    })
    .eq('id', enrollmentId);

  // Update the latest execution's tracking_data
  const { data: latestExec } = await supabase
    .from('sequence_step_executions')
    .select('id, tracking_data')
    .eq('enrollment_id', enrollmentId)
    .in('status', ['sent', 'opened', 'clicked'])
    .order('executed_at', { ascending: false })
    .limit(1)
    .single();

  if (latestExec) {
    const trackingData = (latestExec.tracking_data || {}) as Record<string, unknown>;
    await supabase
      .from('sequence_step_executions')
      .update({
        status: 'replied',
        tracking_data: { ...trackingData, replied_at: timestamp },
      })
      .eq('id', latestExec.id);
  }

  // Cancel all remaining scheduled steps
  await cancelRemainingExecutions(supabase, enrollmentId, 'Candidate replied');

  // Company reply stop
  const stopOnCompany = enrollment.sequence?.stop_on_company_reply;
  if (stopOnCompany && enrollment.company_name) {
    await stopCompanyEnrollments(
      supabase,
      enrollment.sequence_id,
      enrollment.company_name,
      enrollmentId,
    );
  }

  console.log(`[webhooks] Enrollment ${enrollmentId} marked as replied`);
}

// ============ WEBHOOK HANDLERS ============

async function handleMessageReceived(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: Record<string, unknown>,
) {
  // Ignore messages sent by us
  if (payload.is_sender === true) return;

  const sender = payload.sender as Record<string, unknown> | undefined;
  const senderId = sender?.provider_id as string;
  const timestamp = (payload.timestamp as string) || new Date().toISOString();

  if (!senderId) {
    console.warn('[webhooks] message_received: no sender.provider_id');
    return;
  }

  // Find active enrollments matching this profile
  const { data: enrollments } = await supabase
    .from('sequence_enrollments')
    .select('id')
    .eq('status', 'active')
    .or(`profile_id.eq.${senderId},resolved_profile_id.eq.${senderId}`);

  if (!enrollments?.length) {
    console.log(`[webhooks] message_received: no active enrollment for profile ${senderId}`);
    return;
  }

  for (const enrollment of enrollments) {
    await handleReply(supabase, enrollment.id, timestamp);
  }
}

async function handleNewRelation(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: Record<string, unknown>,
) {
  const userProviderId = payload.user_provider_id as string;
  const timestamp = (payload.timestamp as string) || new Date().toISOString();

  if (!userProviderId) {
    console.warn('[webhooks] new_relation: no user_provider_id');
    return;
  }

  // Find connection_request executions for this profile that are sent or waiting
  const { data: executions } = await supabase
    .from('sequence_step_executions')
    .select('id, tracking_data, enrollment:sequence_enrollments!inner(id, profile_id, resolved_profile_id)')
    .in('status', ['sent', 'waiting_event'])
    .or(`enrollment.profile_id.eq.${userProviderId},enrollment.resolved_profile_id.eq.${userProviderId}`);

  // Supabase filtering on joins can be tricky, fallback to manual filter
  const { data: enrollments } = await supabase
    .from('sequence_enrollments')
    .select('id')
    .eq('status', 'active')
    .or(`profile_id.eq.${userProviderId},resolved_profile_id.eq.${userProviderId}`);

  if (!enrollments?.length) {
    console.log(`[webhooks] new_relation: no active enrollment for ${userProviderId}`);
    return;
  }

  for (const enrollment of enrollments) {
    // Update connection status
    await supabase
      .from('sequence_enrollments')
      .update({
        connection_status: 'connected',
        network_distance: 'FIRST_DEGREE',
      })
      .eq('id', enrollment.id);

    // Update tracking_data on connection_request executions
    const { data: connExecs } = await supabase
      .from('sequence_step_executions')
      .select('id, tracking_data, step:sequence_steps!inner(action_type)')
      .eq('enrollment_id', enrollment.id)
      .eq('step.action_type', 'connection_request')
      .in('status', ['sent', 'waiting_event']);

    for (const exec of connExecs || []) {
      const trackingData = (exec.tracking_data || {}) as Record<string, unknown>;
      await supabase
        .from('sequence_step_executions')
        .update({
          tracking_data: { ...trackingData, accepted_at: timestamp },
        })
        .eq('id', exec.id);
    }

    // Note: we do NOT reschedule waiting_event steps here.
    // The existing check_wait_events in process-sequences will pick them up
    // on its next run (it checks connection_status). This avoids conflicts.
  }

  console.log(`[webhooks] new_relation: updated ${enrollments.length} enrollment(s) for ${userProviderId}`);
}

async function handleMailReceived(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: Record<string, unknown>,
) {
  const inReplyTo = payload.in_reply_to as string;
  const trackingIdFromBody = payload.tracking_id as string;

  // Try to match via email_message_id (In-Reply-To header)
  let executionId: string | null = null;

  if (inReplyTo) {
    const { data: tracking } = await supabase
      .from('sequence_email_tracking')
      .select('execution_id')
      .eq('email_message_id', inReplyTo)
      .single();
    if (tracking) executionId = tracking.execution_id;
  }

  // Fallback: try tracking_id if found in body
  if (!executionId && trackingIdFromBody) {
    const { data: tracking } = await supabase
      .from('sequence_email_tracking')
      .select('execution_id')
      .eq('tracking_id', trackingIdFromBody)
      .single();
    if (tracking) executionId = tracking.execution_id;
  }

  // Fallback 2: match by sender email → enrollment.email_used
  // SCOPED par account_id pour éviter le cross-org leak (audit Opus 2026-05-07).
  // Si deux orgs ont enrôlé la même adresse mail, on ne marque "replied" que
  // l'enrollment de l'org dont le compte mail a réellement reçu la réponse.
  if (!executionId) {
    const fromEmail = (payload.from_attendee as Record<string, unknown>)?.email as string
      || payload.from as string
      || payload.sender_email as string;
    const accountId = payload.account_id as string;

    if (fromEmail) {
      let query = supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('email_used', fromEmail)
        .eq('status', 'active');
      if (accountId) {
        query = query.eq('account_id', accountId);
      } else {
        console.warn('[webhooks] mail_received: no account_id in payload, skipping email-based fallback to avoid cross-org leak');
        console.log('[webhooks] mail_received: no matching tracking record or enrollment');
        return;
      }
      const { data: enrollments } = await query;

      if (enrollments?.length) {
        console.log(`[webhooks] mail_received: matched ${enrollments.length} enrollment(s) by email_used=${fromEmail} + account_id=${accountId}`);
        const timestamp = (payload.timestamp as string) || new Date().toISOString();
        for (const enrollment of enrollments) {
          await handleReply(supabase, enrollment.id, timestamp);
        }
        return;
      }
    }

    console.log('[webhooks] mail_received: no matching tracking record or enrollment');
    return;
  }

  // Get enrollment from execution
  const { data: execution } = await supabase
    .from('sequence_step_executions')
    .select('enrollment_id')
    .eq('id', executionId)
    .single();

  if (!execution) return;

  const timestamp = (payload.timestamp as string) || new Date().toISOString();
  await handleReply(supabase, execution.enrollment_id, timestamp);
}

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
        'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return ok({ error: 'Method not allowed' });
  }

  // S1 — Webhook signature : fail-closed. Si le secret n'est pas configuré
  // côté Supabase, on refuse tout le trafic (au lieu de l'ancien comportement
  // "skip verif si secret absent" qui était une faille).
  // Comparaison timing-safe (constant-time) pour résister aux timing attacks.
  if (!WEBHOOK_SECRET) {
    console.error('[webhooks] SEQUENCE_WEBHOOK_SECRET (or UNIPILE_WEBHOOK_SECRET) not configured — refusing webhook for security');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const providedSecret = req.headers.get('x-webhook-secret') || '';
  if (!providedSecret || !timingSafeEqual(providedSecret, WEBHOOK_SECRET)) {
    console.warn('[webhooks] Invalid or missing webhook secret');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = await req.json();
    const event = payload.event || payload.type || '';

    console.log(`[webhooks] Received event: ${event}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (event) {
      case 'message_received':
      case 'new_relation':
        // Audit Opus 2026-05-07 : ces events sont gérés par `unipile-webhook`.
        // Si on les reçoit ici, c'est un setup legacy → on logue et on ignore
        // pour éviter le double-processing (double cancel + analytics doublonnées).
        console.warn(`[webhooks] Event "${event}" received here but handled by unipile-webhook — ignoring. Re-run scripts/setup-sequence-webhooks.ts to clean up.`);
        break;

      case 'mail_received':
        await handleMailReceived(supabase, payload);
        break;

      case 'mail_opened':
        await handleMailTracking(supabase, payload, 'open');
        break;

      case 'mail_link_clicked':
        await handleMailTracking(supabase, payload, 'click');
        break;

      default:
        console.log(`[webhooks] Unhandled event type: ${event}`);
    }

    return ok();
  } catch (err) {
    console.error('[webhooks] Error processing webhook:', err);
    // Échec réel de traitement → 500 pour déclencher les retries du provider
    // au lieu de perdre l'event définitivement (audit 2026-07, Delivery M11).
    // Les handlers sont idempotents (filtres status='active', upserts) donc un
    // retraitement est inoffensif.
    return new Response(JSON.stringify({ error: 'Processing error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
