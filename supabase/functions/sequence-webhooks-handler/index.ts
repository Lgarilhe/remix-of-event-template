/**
 * Edge Function: sequence-webhooks-handler
 *
 * Receives Unipile webhooks and updates sequence enrollments/executions.
 * Complements the existing check_replies polling in process-sequences.
 *
 * Webhooks handled:
 *   - message_received (LinkedIn reply)
 *   - new_relation (LinkedIn invite accepted)
 *   - mail_received (Email reply)
 *   - mail_opened / mail_link_clicked (Email tracking via Unipile)
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('SEQUENCE_WEBHOOK_SECRET') || Deno.env.get('UNIPILE_WEBHOOK_SECRET') || '';

// ============ HELPERS ============

/**
 * Cancel all scheduled/waiting executions for an enrollment.
 */
async function cancelRemainingExecutions(
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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

  if (!executionId) {
    console.log('[webhooks] mail_received: no matching tracking record');
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
  supabase: ReturnType<typeof createClient>,
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

  const trackingData = (execution.tracking_data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  const STATUS_PRIORITY: Record<string, number> = {
    'sent': 2, 'opened': 3, 'clicked': 4, 'replied': 5,
  };

  const currentPriority = STATUS_PRIORITY[execution.status] ?? 0;

  if (eventType === 'open') {
    const openedAt = (trackingData.opened_at || []) as string[];
    const updates: Record<string, unknown> = {
      tracking_data: { ...trackingData, opened_at: [...openedAt, now] },
    };
    if ((STATUS_PRIORITY['opened'] ?? 3) > currentPriority) {
      updates.status = 'opened';
    }
    await supabase.from('sequence_step_executions').update(updates).eq('id', execution.id);
  } else if (eventType === 'click') {
    const clickedAt = (trackingData.clicked_at || []) as string[];
    const updates: Record<string, unknown> = {
      tracking_data: { ...trackingData, clicked_at: [...clickedAt, now] },
    };
    if ((STATUS_PRIORITY['clicked'] ?? 4) > currentPriority) {
      updates.status = 'clicked';
    }
    await supabase.from('sequence_step_executions').update(updates).eq('id', execution.id);
  }
}

// ============ MAIN HANDLER ============

Deno.serve(async (req) => {
  // Always return 200 to prevent Unipile retries
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

  // Verify webhook secret
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers.get('x-webhook-secret') || '';
    if (providedSecret !== WEBHOOK_SECRET) {
      console.warn('[webhooks] Invalid webhook secret');
      return ok({ error: 'Invalid secret' });
    }
  }

  try {
    const payload = await req.json();
    const event = payload.event || payload.type || '';

    console.log(`[webhooks] Received event: ${event}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    switch (event) {
      case 'message_received':
        await handleMessageReceived(supabase, payload);
        break;

      case 'new_relation':
        await handleNewRelation(supabase, payload);
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
    return ok({ error: 'Processing error' });
  }
});
