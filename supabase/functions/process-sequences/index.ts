// Deno.serve used directly
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

// No wildcard CORS — this function is called by cron (service role) and frontend (authenticated users)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============ ENV CONFIG ============
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN_RAW = (Deno.env.get('UNIPILE_DSN') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const UNIPILE_DSN = `https://${UNIPILE_DSN_RAW}`;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
const WEEKLY_INVITE_LIMIT = 100;

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Fetch RAG context for a candidate from the Knowledge Lake
async function fetchRAGContext(
  orgId: string,
  candidateId: string,
  jobContextText: string,
): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) return null;

    const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/retrieve-context`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        organization_id: orgId,
        entity_type: 'candidate',
        entity_id: candidateId,
        query: jobContextText,
        limit: 8,
      }),
    });

    if (!res.ok) {
      console.warn('[process-sequences] RAG retrieve-context failed:', res.status);
      return null;
    }

    const data = await res.json();
    const ctx = data?.formatted_context || null;
    return ctx ? ctx.substring(0, 2000) : null;
  } catch (err) {
    console.warn('[process-sequences] RAG error, falling back to legacy:', err);
    return null;
  }
}

// In-memory profile cache — cleared at the start of each request to avoid cross-invocation staleness
const profileInfoCache = new Map<string, { network_distance?: string; provider_id?: string }>();

console.log('[process-sequences] Config:', { hasDSN: !!UNIPILE_DSN, hasApiKey: !!UNIPILE_API_KEY });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Clear profile cache for each new request
  profileInfoCache.clear();

  // ===== AUTH CHECK =====
  // Accept: (1) service_role key (internal/cron), (2) PROCESS_SEQUENCES_SECRET, or (3) valid admin JWT (frontend)
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const cronSecret = Deno.env.get('PROCESS_SEQUENCES_SECRET') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log(`[auth] Token length: ${token.length}, cronSecret length: ${cronSecret.length}, hasServiceRole: ${!!serviceRoleKey}`);

  let isAuthorized = false;
  let authMethod = 'none';

  if (token === serviceRoleKey) {
    isAuthorized = true;
    authMethod = 'service_role';
  } else if (cronSecret && token === cronSecret) {
    isAuthorized = true;
    authMethod = 'cron_secret';
  } else if (token && token !== anonKey) {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await authClient.auth.getUser();
    if (!error && user) {
      const { data: hasAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      isAuthorized = !!hasAdmin;
      authMethod = hasAdmin ? 'admin_jwt' : 'jwt_no_admin';
    } else {
      authMethod = `jwt_failed: ${error?.message || 'no user'}`;
    }
  }

  console.log(`[auth] Result: ${authMethod}, authorized: ${isAuthorized}`);

  if (!isAuthorized) {
    console.warn(`[auth] ❌ Unauthorized request rejected (method: ${authMethod})`);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {

    const { action, force } = await req.json();

    switch (action) {
      case 'process':
        return await handleProcess(supabase, !!force);
      case 'check_replies':
        return await handleCheckReplies(supabase);
      case 'check_timeouts':
        return await handleCheckTimeouts(supabase);
      case 'check_wait_events':
        return await handleCheckWaitEvents(supabase);
      case 'force_reschedule':
        return await handleForceReschedule(supabase);
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Sequence processor error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ============ ACTION HANDLERS ============

// deno-lint-ignore no-explicit-any

async function acquireLock(supabase: any, runId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('acquire_sequence_lock', { p_run_id: runId, p_ttl_minutes: 10 });
  if (error) {
    console.error(`[process] Lock RPC error:`, error);
    return false;
  }
  const acquired = !!data;
  console.log(`[process] Lock ${acquired ? 'acquired' : 'held by another run'} (runId=${runId})`);
  return acquired;
}

async function releaseLock(supabase: any, runId: string) {
  await supabase.rpc('release_sequence_lock', { p_run_id: runId });
}

async function handleProcess(supabase: any, force = false) {
  const runId = crypto.randomUUID().slice(0, 8);

  // Global lock: prevent concurrent cron executions
  if (!await acquireLock(supabase, runId)) {
    return new Response(JSON.stringify({ success: true, skipped_reason: 'lock_held' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const now = new Date().toISOString();

    // Recovery: unstick executions stuck in 'sending' for more than 5 minutes
    // This happens when sequence-send-email times out or crashes mid-execution
    const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckExecs } = await supabase
      .from('sequence_step_executions')
      .select('id, retry_count')
      .eq('status', 'sending')
      .lt('updated_at', stuckCutoff)
      .limit(20);

    if (stuckExecs?.length) {
      console.warn(`[process] Recovering ${stuckExecs.length} stuck 'sending' execution(s)`);
      for (const stuck of stuckExecs) {
        const retryCount = stuck.retry_count || 0;
        if (retryCount < 3) {
          // Reschedule for retry
          await supabase.from('sequence_step_executions').update({
            status: 'scheduled',
            retry_count: retryCount + 1,
            error_message: `Recovered from stuck 'sending' state (retry ${retryCount + 1}/3)`,
            scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // retry in 10 min
          }).eq('id', stuck.id);
        } else {
          // Max retries reached — mark as failed
          await supabase.from('sequence_step_executions').update({
            status: 'failed',
            error_message: 'Failed after 3 retries (stuck in sending state)',
            executed_at: new Date().toISOString(),
          }).eq('id', stuck.id);
        }
      }
    }

    // Smart batching: fetch more candidates, then split by action visibility
    // Non-visible actions (profile_visit, check_connection) = safe to batch aggressively
    // Visible actions (message, inmail, connection_request) = keep conservative but maximized
    const INVISIBLE_ACTIONS = new Set(['profile_visit', 'check_connection', 'wait_connection']);
    const MAX_INVISIBLE_PER_CYCLE = 15;
    const MAX_VISIBLE_PER_CYCLE = 5;
    const FETCH_LIMIT = 25; // Overfetch to compensate for dedup, skips, quota blocks

    const { data: executions, error: fetchError } = await supabase
      .from('sequence_step_executions')
      .select(`*, enrollment:sequence_enrollments(*, sequence:outreach_sequences(*)), step:sequence_steps(*)`)
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .limit(FETCH_LIMIT);

    if (fetchError) throw fetchError;

    const results = { processed: 0, skipped: 0, failed: 0, retried: 0, quota_blocked: 0 };
    const failedSequenceIds = new Set<string>();

    // Deduplicate: only process one execution per profile per batch to preserve natural spacing
    const seenProfiles = new Set<string>();
    const dedupedExecutions = (executions || []).filter((exec: { enrollment?: { profile_id?: string } }) => {
      const profileId = exec.enrollment?.profile_id;
      if (!profileId || seenProfiles.has(profileId)) return false;
      seenProfiles.add(profileId);
      return true;
    });

    // Smart batching: separate invisible vs visible actions, apply per-type limits
    let invisibleCount = 0;
    let visibleCount = 0;
    const batchedExecutions = dedupedExecutions.filter((exec: { step?: { action_type?: string } }) => {
      const actionType = exec.step?.action_type || '';
      if (INVISIBLE_ACTIONS.has(actionType)) {
        if (invisibleCount >= MAX_INVISIBLE_PER_CYCLE) return false;
        invisibleCount++;
        return true;
      } else {
        if (visibleCount >= MAX_VISIBLE_PER_CYCLE) return false;
        visibleCount++;
        return true;
      }
    });

    console.log(`[process] Smart batch: ${invisibleCount} invisible + ${visibleCount} visible actions (from ${dedupedExecutions.length} candidates)`);

    // Random jitter (0-10s) only before visible actions to appear more human
    if (visibleCount > 0) {
      const jitterMs = Math.floor(Math.random() * 10000);
      if (jitterMs > 0) {
        console.log(`[process] Jitter: waiting ${Math.round(jitterMs / 1000)}s before visible actions`);
        await new Promise(r => setTimeout(r, jitterMs));
      }
    }

    let visibleActionsExecuted = 0;
    for (const exec of batchedExecutions) {
      const enrollment = exec.enrollment;
      const step = exec.step;
      try {
        
        if (!enrollment || enrollment.status !== 'active') {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: 'Enrollment inactive' }).eq('id', exec.id);
          results.skipped++;
          continue;
        }

        const sequence = enrollment.sequence;

        // === CONFIGURABLE STOP CONDITIONS ===
        const stopCond = sequence?.stop_conditions || { on_reply: true, on_unsubscribe: true };
        let shouldStop = false;
        let stopReason = '';

        // on_reply is already handled by the existing PRE-SEND REPLY CHECK below — skip here
        if (stopCond.on_click) {
          const { data: clickedExecs } = await supabase.from('sequence_step_executions').select('id').eq('enrollment_id', enrollment.id).eq('status', 'clicked').limit(1);
          if (clickedExecs?.length) { shouldStop = true; stopReason = 'Stop condition: link clicked'; }
        }
        if (!shouldStop && stopCond.on_unsubscribe && enrollment.email_used) {
          const { data: suppressed } = await supabase.from('suppressed_emails').select('id').eq('email', enrollment.email_used).limit(1);
          if (suppressed?.length) { shouldStop = true; stopReason = 'Stop condition: unsubscribed'; }
        }
        if (!shouldStop && stopCond.on_meeting_booked) {
          // Check if a Calendly meeting was booked for this candidate (qualification_sessions table)
          const meetingFilters = [];
          if (enrollment.email_used) meetingFilters.push(`invitee_email.eq.${enrollment.email_used}`);
          if (enrollment.profile_id) meetingFilters.push(`candidate_profile_id.eq.${enrollment.profile_id}`);
          if (enrollment.profile_url) {
            const slugMatch = (enrollment.profile_url as string).match(/linkedin\.com\/in\/([^/?#]+)/i);
            if (slugMatch) meetingFilters.push(`candidate_linkedin_url.ilike.%${slugMatch[1]}%`);
          }
          if (meetingFilters.length > 0) {
            const { data: meetings } = await supabase.from('qualification_sessions').select('id').or(meetingFilters.join(',')).limit(1);
            if (meetings?.length) { shouldStop = true; stopReason = 'Stop condition: meeting booked (Calendly)'; }
          }
        }
        if (shouldStop) {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: stopReason, executed_at: new Date().toISOString() }).eq('id', exec.id);
          await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
          await supabase.from('sequence_step_executions').update({ status: 'cancelled', skip_reason: stopReason }).eq('enrollment_id', enrollment.id).eq('status', 'scheduled');
          console.log(`[process] ⛔ ${enrollment.profile_name} — ${stopReason}`);
          results.skipped++;
          continue;
        }

        // === AUTO-SKIP: channel unavailable ===
        const effectiveChannel = step.step_channel || (step.action_type === 'email' ? 'email' : step.action_type === 'whatsapp_message' ? 'whatsapp' : 'linkedin');
        if (effectiveChannel === 'email' && !enrollment.email_used) {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: 'No email — channel skipped', executed_at: new Date().toISOString() }).eq('id', exec.id);
          await scheduleNextStep(supabase, enrollment, step.step_order, undefined, undefined, 0, step.id);
          console.log(`[process] ⏭️ ${enrollment.profile_name} — email step skipped (no email), advancing to next`);
          results.skipped++;
          continue;
        }
        if (effectiveChannel === 'linkedin' && !enrollment.account_id) {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: 'No LinkedIn account — channel skipped', executed_at: new Date().toISOString() }).eq('id', exec.id);
          await scheduleNextStep(supabase, enrollment, step.step_order, undefined, undefined, 0, step.id);
          console.log(`[process] ⏭️ ${enrollment.profile_name} — LinkedIn step skipped (no account), advancing to next`);
          results.skipped++;
          continue;
        }
        if ((effectiveChannel === 'whatsapp' || step.action_type === 'whatsapp_message') && !enrollment.phone_used) {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: 'No phone number — WhatsApp skipped', executed_at: new Date().toISOString() }).eq('id', exec.id);
          await scheduleNextStep(supabase, enrollment, step.step_order, undefined, undefined, 0, step.id);
          console.log(`[process] ⏭️ ${enrollment.profile_name} — WhatsApp step skipped (no phone), advancing to next`);
          results.skipped++;
          continue;
        }

        const quotaCheck = await checkQuotaForAction(supabase, step.action_type, enrollment.account_id);
        if (!quotaCheck.allowed) {
          await supabase.from('sequence_step_executions').update({ 
            status: 'quota_blocked', skip_reason: quotaCheck.reason,
            scheduled_at: new Date(Date.now() + 86400000).toISOString(),
          }).eq('id', exec.id);
          results.quota_blocked++;
          continue;
        }

        const userTimezone = enrollment.user_timezone || 'Europe/Paris';
        if (!force && !isWithinBusinessHours(userTimezone)) {
          const nextSlot = getNextBusinessHourSlot(userTimezone);
          await supabase.from('sequence_step_executions').update({ scheduled_at: nextSlot.toISOString() }).eq('id', exec.id);
          results.skipped++;
          continue;
        }

        const conditionResult = await checkStepCondition(step.condition_type, enrollment.account_id, enrollment.profile_id, step.wait_for_event, enrollment.profile_url, supabase, enrollment.id, enrollment, step.condition_value);
        if (conditionResult === 'wait') {
          await supabase.from('sequence_step_executions').update({ status: 'waiting_event' }).eq('id', exec.id);
          results.skipped++;
          continue;
        }

        // For condition_branch steps with parent_step_id children: evaluate and route to branch
        const hasChildren = step.action_type === 'condition_branch' || step.action_type === 'check_connection';
        const { data: branchChildren } = hasChildren && step.id
          ? await supabase.from('sequence_steps').select('id').eq('parent_step_id', step.id).limit(1)
          : { data: null };
        const useTreeBranching = branchChildren && branchChildren.length > 0;

        if (!conditionResult) {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: `Condition: ${step.condition_type}`, executed_at: new Date().toISOString() }).eq('id', exec.id);
          results.skipped++;
          // Route to 'no' branch if tree branching, otherwise linear fallback
          await scheduleNextStep(supabase, enrollment, step.step_order, undefined, useTreeBranching ? 'no' : undefined, 0, step.id);
          continue;
        }

        // Condition is true — if this is a pure condition node with tree children, route to 'yes' branch directly
        if (useTreeBranching && (step.action_type === 'condition_branch')) {
          await supabase.from('sequence_step_executions').update({ status: 'sent', executed_at: new Date().toISOString(), final_message: `Condition "${step.condition_type}" → true` }).eq('id', exec.id);
          await supabase.from('sequence_enrollments').update({ current_step_order: step.step_order + 1 }).eq('id', enrollment.id);
          await scheduleNextStep(supabase, enrollment, step.step_order, undefined, 'yes', 0, step.id);
          results.processed++;
          continue;
        }

        // Guard: prevent follow-up messages from being sent if no prior message was sent in this enrollment
        // BUT only if there ARE prior message-type steps that SHOULD have been sent (i.e., this is truly a follow-up)
        if (needsMessage(step.action_type) && step.step_order > 0) {
          // First: check if there are ANY earlier message-type steps in this enrollment's execution history
          const { data: priorMessageSteps } = await supabase
            .from('sequence_step_executions')
            .select('id, status, step:sequence_steps!inner(action_type)')
            .eq('enrollment_id', enrollment.id)
            .lt('step_order', step.step_order)
            .in('step.action_type', ['message', 'inmail', 'smart_message', 'email', 'whatsapp_message']);

          // If no prior message-type steps exist at all, this IS the first message → allow it
          const hasPriorMessageSteps = priorMessageSteps && priorMessageSteps.length > 0;
          
          if (hasPriorMessageSteps) {
            // There ARE prior message steps — check if at least one was actually sent (or progressed beyond sent)
            const sentStatuses = new Set(['sent', 'opened', 'clicked', 'replied']);
            const anyPriorSent = priorMessageSteps.some((s: any) => sentStatuses.has(s.status));
            
            if (!anyPriorSent) {
              console.warn(`[process] ⛔ GUARD: Skipping ${step.action_type} step ${step.step_order} for ${enrollment.profile_name} — ${priorMessageSteps.length} prior message step(s) exist but none were sent. Completing sequence.`);
              await supabase.from('sequence_step_executions').update({ 
                status: 'skipped', 
                skip_reason: 'no_previous_message', 
                executed_at: new Date().toISOString() 
              }).eq('id', exec.id);
              await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
              await supabase.from('sequence_step_executions').update({ status: 'cancelled', skip_reason: 'no_previous_message' }).eq('enrollment_id', enrollment.id).eq('status', 'scheduled');
              results.skipped++;
              continue;
            }

            // *** PRE-SEND REPLY CHECK ***
            // Before sending a follow-up, check in real-time if the candidate has already replied
            // This catches replies missed by webhook or not yet picked up by the 4h polling
            try {
              const lastSentDate = priorMessageSteps
                .filter((s: any) => s.status === 'sent')
                .reduce((latest: string | null, s: any) => {
                  // We don't have executed_at here, use a safe window: 7 days ago
                  return latest;
                }, null);
              
              const replyCheckDate = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
              const hasReplied = await checkForReplyAfterDate(
                enrollment.account_id, 
                enrollment.resolved_profile_id || enrollment.profile_id, 
                replyCheckDate, 
                enrollment.profile_url, 
                enrollment.id, 
                supabase
              );
              
              if (hasReplied) {
                console.warn(`[process] ⛔ PRE-SEND REPLY CHECK: ${enrollment.profile_name} has replied! Stopping sequence.`);
                await supabase.from('sequence_enrollments').update({ 
                  status: 'replied', 
                  replied_at: new Date().toISOString() 
                }).eq('id', enrollment.id);
                await supabase.from('sequence_step_executions').update({ 
                  status: 'cancelled', 
                  skip_reason: 'Reply detected (pre-send check)',
                  executed_at: new Date().toISOString()
                }).eq('enrollment_id', enrollment.id).in('status', ['scheduled', 'sending']);
                await logAnalytics(supabase, enrollment.sequence_id, 'replies_received');
                
                // Update job_candidate_status
                if (enrollment.profile_id) {
                  const { data: jcsRows } = await supabase
                    .from('job_candidate_status')
                    .select('id')
                    .eq('candidate_id', enrollment.profile_id)
                    .in('status', ['contacted', 'shortlisted', 'scored', 'new']);
                  if (jcsRows && jcsRows.length > 0) {
                    await supabase
                      .from('job_candidate_status')
                      .update({ status: 'replied', updated_at: new Date().toISOString() })
                      .in('id', jcsRows.map((r: { id: string }) => r.id));
                  }
                }
                
                results.skipped++;
                continue;
              }
            } catch (replyCheckErr) {
              console.warn(`[process] Pre-send reply check failed (non-blocking):`, replyCheckErr);
              // Don't block sending if the check fails — better to send than to silently skip
            }
          } else {
            console.log(`[process] ✅ First message step for ${enrollment.profile_name} at step_order=${step.step_order} (no prior message steps) — allowing`);
          }
        }

        // === INBOX ROTATION: assign sender if multi_sender_enabled ===
        if (sequence?.multi_sender_enabled && sequence.sender_accounts?.length > 0 && !enrollment.assigned_sender_id) {
          const sender = await pickSenderForRotation(supabase, sequence);
          if (sender) {
            await supabase.from('sequence_enrollments').update({ assigned_sender_id: sender.account_id }).eq('id', enrollment.id);
            enrollment.assigned_sender_id = sender.account_id;
            console.log(`[process] Rotation: assigned sender ${sender.account_id} to enrollment ${enrollment.id}`);
          }
        }

        const { data: lockResult, error: lockError } = await supabase
          .from('sequence_step_executions').update({ status: 'sending' }).eq('id', exec.id).eq('status', 'scheduled').select().single();

        if (lockError || !lockResult) { results.skipped++; continue; }

        let finalMessage = (exec.final_message || step.message_template || '') as string;
        let finalSubject = (step.subject_template || '') as string;

        // AI personalization: use the rich pipeline for ALL message types including email
        // For email steps, the personalized message is passed to sequence-send-email
        if (step.use_ai_personalization && needsMessage(step.action_type)) {
          const personalized = await generatePersonalizedMessage(supabase, enrollment, step, exec);
          if (personalized) { finalMessage = personalized.message; finalSubject = personalized.subject || finalSubject; }
        }

        // Determine effective action type: step_channel 'email' overrides action_type
        const effectiveActionType = (step.step_channel === 'email' || step.action_type === 'email') ? 'email'
          : (step.step_channel === 'whatsapp' || step.action_type === 'whatsapp_message') ? 'whatsapp_message'
          : step.action_type;

        // Inter-visible-action spacing: 1-3s delay between visible actions to look human
        if (!INVISIBLE_ACTIONS.has(effectiveActionType) && visibleActionsExecuted > 0) {
          const spacingMs = 1000 + Math.floor(Math.random() * 2000);
          console.log(`[process] Spacing: ${Math.round(spacingMs / 1000)}s between visible actions`);
          await new Promise(r => setTimeout(r, spacingMs));
        }

        const executeResult = await executeStepAction(effectiveActionType, enrollment, step,
          { ...exec, final_message: finalMessage, final_subject: finalSubject }, supabase);

        if (executeResult.error === '__WAIT_EVENT__') {
          // Special case: wait_connection — transition to waiting_event
          await supabase.from('sequence_step_executions').update({ status: 'waiting_event' }).eq('id', exec.id);
          console.log(`[process] ${enrollment.profile_name} → waiting_event (wait_connection)`);
          results.skipped++;
        } else if (executeResult.success) {
          // Fix 1: Re-check enrollment status — a reply may have been detected during execution
          const { data: freshEnrollment } = await supabase
            .from('sequence_enrollments').select('status').eq('id', enrollment.id).single();
          if (freshEnrollment?.status === 'replied' || freshEnrollment?.status === 'completed' || freshEnrollment?.status === 'paused') {
            console.warn(`[process] ⛔ Enrollment ${enrollment.id} status changed to '${freshEnrollment.status}' during execution — cancelling step ${exec.id}`);
            await supabase.from('sequence_step_executions').update({
              status: 'cancelled', skip_reason: `Enrollment became ${freshEnrollment.status} during execution`,
              executed_at: new Date().toISOString(),
            }).eq('id', exec.id);
            results.skipped++;
            continue;
          }

          // For email steps, sequence-send-email already updated the execution — skip redundant update
          if (effectiveActionType !== 'email') {
            await supabase.from('sequence_step_executions').update({
              status: 'sent', executed_at: new Date().toISOString(), final_subject: executeResult.subject || finalSubject, final_message: executeResult.message || finalMessage,
            }).eq('id', exec.id);
          }
          await supabase.from('sequence_enrollments').update({ current_step_order: step.step_order + 1 }).eq('id', enrollment.id);
          if (effectiveActionType !== 'check_connection') await scheduleNextStep(supabase, enrollment, step.step_order, undefined, undefined, 0, step.id);
          results.processed++;
          if (!INVISIBLE_ACTIONS.has(effectiveActionType)) visibleActionsExecuted++;
          
          // Sync Notion stage (fire-and-forget, non-blocking)
          syncNotionStageAfterAction(step.action_type, enrollment).catch(err => console.warn('[notion-sync] Fire-and-forget error:', err));
        } else {
          // For email steps, sequence-send-email may have already updated the execution status.
          // Re-fetch to avoid overwriting a more specific status (e.g. 'bounced').
          if (effectiveActionType === 'email') {
            const { data: freshExec } = await supabase.from('sequence_step_executions').select('status').eq('id', exec.id).single();
            if (freshExec && freshExec.status !== 'sending') {
              console.log(`[process] Email execution ${exec.id} already updated to '${freshExec.status}' by sequence-send-email — skipping error handling`);
              results.failed++;
              continue;
            }
          }
          // Error handling: differentiate rate limits from other retryable errors
          const currentRetryCount = exec.retry_count || 0;
          const errorStr = executeResult.error || '';
          
          if (isRateLimitError(errorStr)) {
            // Rate limit: NO retry counter increment, reschedule based on action type
            const retryAt = getRateLimitRetryDate(step.action_type, enrollment.user_timezone || 'Europe/Paris');
            await supabase.from('sequence_step_executions').update({ 
              status: 'scheduled', 
              error_message: `Rate limit (${step.action_type}) → rescheduled to ${retryAt.toISOString()}`,
              scheduled_at: retryAt.toISOString(),
            }).eq('id', exec.id);
            console.log(`[process] ⏸️ Rate limit for ${enrollment.profile_name} (${step.action_type}), rescheduled to ${retryAt.toISOString()}`);
            results.retried++;
          } else if (isRetryableError(errorStr) && currentRetryCount < MAX_RETRIES) {
            const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
            await supabase.from('sequence_step_executions').update({ 
              status: 'scheduled', 
              retry_count: currentRetryCount + 1, 
              error_message: `Retry ${currentRetryCount + 1}/${MAX_RETRIES}: ${executeResult.error}`,
              scheduled_at: retryAt,
            }).eq('id', exec.id);
            console.log(`[process] Retryable error for ${enrollment.profile_id}, retry ${currentRetryCount + 1}/${MAX_RETRIES} scheduled at ${retryAt}`);
            results.retried++;
          } else {
            await supabase.from('sequence_step_executions').update({ status: 'failed', error_message: executeResult.error, executed_at: new Date().toISOString(), final_message: finalMessage || null, final_subject: finalSubject || null }).eq('id', exec.id);
            results.failed++;
            if (enrollment.sequence_id) failedSequenceIds.add(enrollment.sequence_id);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown';
        const currentRetryCount = exec.retry_count || 0;
        if (isRateLimitError(errorMsg)) {
          const retryAt = getRateLimitRetryDate(step.action_type, enrollment.user_timezone || 'Europe/Paris');
          await supabase.from('sequence_step_executions').update({ 
            status: 'scheduled',
            error_message: `Rate limit (${step.action_type}) → rescheduled to ${retryAt.toISOString()}`,
            scheduled_at: retryAt.toISOString(),
          }).eq('id', exec.id);
          results.retried++;
        } else if (isRetryableError(errorMsg) && currentRetryCount < MAX_RETRIES) {
          await supabase.from('sequence_step_executions').update({ 
            status: 'scheduled', retry_count: currentRetryCount + 1,
            error_message: `Retry ${currentRetryCount + 1}/${MAX_RETRIES}: ${errorMsg}`,
            scheduled_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          }).eq('id', exec.id);
          results.retried++;
        } else {
          await supabase.from('sequence_step_executions').update({ status: 'failed', error_message: errorMsg }).eq('id', exec.id);
          results.failed++;
        }
      }
    }

    // Auto-pause: if >30% of batch actions failed definitively, pause affected sequences
    const totalActioned = results.processed + results.failed;
    if (totalActioned >= 5 && results.failed / totalActioned > 0.3) {
      console.warn(`[process] ⚠️ HIGH FAILURE RATE: ${results.failed}/${totalActioned} failed (${Math.round(results.failed / totalActioned * 100)}%). Auto-pausing affected sequences.`);
      for (const seqId of failedSequenceIds) {
        await supabase.from('outreach_sequences').update({ is_active: false }).eq('id', seqId);
        // Cancel remaining scheduled executions for this sequence
        const { data: enrollments } = await supabase.from('sequence_enrollments').select('id').eq('sequence_id', seqId).eq('status', 'active');
        if (enrollments?.length) {
          for (const enr of enrollments) {
            await supabase.from('sequence_step_executions').update({ status: 'cancelled', skip_reason: 'Auto-paused: high failure rate' }).eq('enrollment_id', enr.id).eq('status', 'scheduled');
          }
          await supabase.from('sequence_enrollments').update({ status: 'paused' }).eq('sequence_id', seqId).eq('status', 'active');
        }
        console.warn(`[process] Sequence ${seqId} paused due to high failure rate`);
      }
    }

    return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } finally {
    await releaseLock(supabase, runId);
  }
}

// deno-lint-ignore no-explicit-any
async function handleCheckReplies(supabase: any) {
  // Fix 2: Global lock to prevent concurrent executions
  const runId = `replies-${crypto.randomUUID().slice(0, 8)}`;
  if (!await acquireLock(supabase, runId)) {
    return new Response(JSON.stringify({ success: true, skipped_reason: 'lock_held' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
  // Throttle: run at most every 4 hours — webhook handles real-time, this is fallback only
  const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;
  const { data: lastRun } = await supabase
    .from('internal_config')
    .select('value')
    .eq('key', 'last_check_replies')
    .maybeSingle();

  if (lastRun?.value && Date.now() - new Date(lastRun.value).getTime() < MIN_INTERVAL_MS) {
    console.log('[checkReplies] Skipped — last run too recent:', lastRun.value);
    return new Response(JSON.stringify({ skipped: 'too_recent', last_run: lastRun.value }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  await supabase.from('internal_config').upsert({ key: 'last_check_replies', value: new Date().toISOString() }, { onConflict: 'key' });

  const { data: activeEnrollments } = await supabase.from('sequence_enrollments').select('*').eq('status', 'active').limit(20);
  let repliesDetected = 0;
  let skippedTooRecent = 0;

  for (const enrollment of activeEnrollments || []) {
    // Find the last message/inmail sent by the sequence for this enrollment
    const { data: lastSentExec } = await supabase
      .from('sequence_step_executions')
      .select('executed_at, step:sequence_steps!inner(action_type)')
      .eq('enrollment_id', enrollment.id)
      .eq('status', 'sent')
      .in('step.action_type', ['message', 'inmail', 'smart_message', 'connection_request', 'email', 'whatsapp_message'])
      .order('executed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only check for replies if we've actually sent a message
    if (!lastSentExec?.executed_at) continue;

    // Skip if the last message was sent less than 30 minutes ago (avoid false positives)
    const sentAge = Date.now() - new Date(lastSentExec.executed_at).getTime();
    if (sentAge < 30 * 60 * 1000) {
      skippedTooRecent++;
      continue;
    }

    // Check for replies after the last message was sent (not after enrollment creation)
    const afterDate = lastSentExec.executed_at;

    if (await checkForReplyAfterDate(enrollment.account_id, enrollment.resolved_profile_id || enrollment.profile_id, afterDate, enrollment.profile_url, enrollment.id, supabase)) {
      await supabase.from('sequence_enrollments').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', enrollment.id);
      await supabase.from('sequence_step_executions').update({ status: 'cancelled', skip_reason: 'Reply detected' }).eq('enrollment_id', enrollment.id).eq('status', 'scheduled');
      await logAnalytics(supabase, enrollment.sequence_id, 'replies_received');

      // Update job_candidate_status to 'replied'
      if (enrollment.profile_id) {
        const { data: jcsRows } = await supabase
          .from('job_candidate_status')
          .select('id')
          .eq('candidate_id', enrollment.profile_id)
          .in('status', ['contacted', 'shortlisted', 'scored', 'new']);
        if (jcsRows && jcsRows.length > 0) {
          await supabase
            .from('job_candidate_status')
            .update({ status: 'replied', updated_at: new Date().toISOString() })
            .in('id', jcsRows.map((r: { id: string }) => r.id));
          console.log(`[checkReplies] Updated ${jcsRows.length} job_candidate_status → replied`);
        }
      }

      // Sync Notion: Etat → "A répondu", Etape → "Qualification"
      try {
        let candidateId = await findCandidateInNotionSeq(
          enrollment.profile_name || '',
          enrollment.profile_url
        );
        if (!candidateId) {
          // Create candidate + shortlist if not found
          candidateId = await createCandidateAndShortlistInNotion(enrollment, { etape: 'Qualification', etat: 'A répondu' });
        }
        if (candidateId) {
          await updateNotionPageSeq(candidateId, { 'Etat': { select: { name: 'A répondu' } } });
          const shortlistIds = await findShortlistsForCandidateSeq(candidateId);
          for (const slId of shortlistIds) {
            await updateNotionPageSeq(slId, { 'Etape': { select: { name: 'Qualification' } } });
          }
          console.log(`[checkReplies] Notion synced: Etat→"A répondu", Etape→"Qualification" (${shortlistIds.length} shortlists)`);
        }
      } catch (notionErr) {
        console.warn('[checkReplies] Notion sync failed (non-blocking):', notionErr);
      }

      repliesDetected++;
      console.log(`[checkReplies] Reply detected for ${enrollment.profile_name} (after ${afterDate})`);
    }
  }
  console.log(`[checkReplies] Done: ${repliesDetected} replies, ${skippedTooRecent} skipped (too recent)`);
  return new Response(JSON.stringify({ success: true, repliesDetected, skippedTooRecent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } finally {
    await releaseLock(supabase, runId);
  }
}

// deno-lint-ignore no-explicit-any
async function handleCheckTimeouts(supabase: any) {
  // Fix 2: Global lock to prevent concurrent executions
  const runId = `timeouts-${crypto.randomUUID().slice(0, 8)}`;
  if (!await acquireLock(supabase, runId)) {
    return new Response(JSON.stringify({ success: true, skipped_reason: 'lock_held' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
  const { data: waitingExecutions } = await supabase.from('sequence_step_executions')
    .select(`*, enrollment:sequence_enrollments(*), step:sequence_steps(*)`).eq('status', 'waiting_event').not('step.timeout_days', 'is', null).limit(50);

  let branched = 0;
  for (const exec of waitingExecutions || []) {
    const step = exec.step, enrollment = exec.enrollment;
    if (!step?.timeout_days || !enrollment) continue;
    const daysPassed = Math.floor((Date.now() - new Date(exec.created_at).getTime()) / 86400000);
    if (daysPassed >= step.timeout_days) {
      await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: `Timeout ${step.timeout_days}d`, executed_at: new Date().toISOString() }).eq('id', exec.id);
      await scheduleNextStep(supabase, enrollment, step.step_order, step.timeout_branch_step_id, undefined, 0, step.id);
      branched++;
    }
  }
  return new Response(JSON.stringify({ success: true, checked: waitingExecutions?.length || 0, branched }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } finally {
    await releaseLock(supabase, runId);
  }
}

// deno-lint-ignore no-explicit-any
async function handleCheckWaitEvents(supabase: any) {
  // Fix 2: Global lock to prevent concurrent executions
  const runId = `waitevents-${crypto.randomUUID().slice(0, 8)}`;
  if (!await acquireLock(supabase, runId)) {
    return new Response(JSON.stringify({ success: true, skipped_reason: 'lock_held' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
  // Phase 1: Fast DB-only pass — immediately unblock candidates already marked as connected
  // This runs every time without throttle since it doesn't call Unipile
  const { data: dbConnected } = await supabase.from('sequence_step_executions')
    .select(`id, enrollment:sequence_enrollments!inner(id, connection_status, network_distance, sequence_id, profile_name)`)
    .eq('status', 'waiting_event')
    .eq('enrollment.connection_status', 'connected')
    .limit(100);

  let fastUnblocked = 0;
  for (const exec of dbConnected || []) {
    const enrollment = exec.enrollment;
    if (!enrollment) continue;
    await supabase.from('sequence_step_executions').update({ status: 'scheduled', scheduled_at: new Date().toISOString() }).eq('id', exec.id);
    await logAnalytics(supabase, enrollment.sequence_id, 'invites_accepted');
    fastUnblocked++;
    console.log(`[handleCheckWaitEvents] Fast unblock: ${enrollment.profile_name}`);
  }

  if (fastUnblocked > 0) {
    console.log(`[handleCheckWaitEvents] Fast-unblocked ${fastUnblocked} already-connected candidates`);
  }

  // Phase 2: Throttled Unipile check for remaining waiting_event candidates
  const MIN_INTERVAL_MS = 8 * 60 * 60 * 1000;
  const { data: lastRun } = await supabase
    .from('internal_config')
    .select('value')
    .eq('key', 'last_check_wait_events')
    .maybeSingle();

  if (lastRun?.value && Date.now() - new Date(lastRun.value).getTime() < MIN_INTERVAL_MS) {
    console.log('[handleCheckWaitEvents] API check skipped — last run too recent:', lastRun.value);
    return new Response(JSON.stringify({ success: true, fastUnblocked, eventsTriggered: 0, skipped_api: 'too_recent' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Update last run timestamp
  await supabase.from('internal_config').upsert({ key: 'last_check_wait_events', value: new Date().toISOString() }, { onConflict: 'key' });

  const { data: waitingExecutions } = await supabase.from('sequence_step_executions')
    .select(`*, enrollment:sequence_enrollments(*), step:sequence_steps(*)`)
    .eq('status', 'waiting_event')
    .order('updated_at', { ascending: true })
    .limit(20);

  let eventsTriggered = 0;
  for (const exec of waitingExecutions || []) {
    const step = exec.step, enrollment = exec.enrollment;
    if (!step || !enrollment) continue;

    let eventOccurred = false;
    if (step.wait_for_event === 'connection_accepted') {
      // Use DB-stored network_distance first → avoids Unipile API call
      if (enrollment.network_distance === 'FIRST_DEGREE' || enrollment.connection_status === 'connected') {
        eventOccurred = true;
        console.log(`[handleCheckWaitEvents] DB hit: ${enrollment.profile_name} already FIRST_DEGREE/connected`);
      } else {
        const profile = await getProfileInfo(enrollment.account_id, enrollment.profile_id, enrollment.profile_url);
        eventOccurred = profile?.network_distance === 'FIRST_DEGREE';
        // Persist network_distance + provider_id to DB for future lookups
        if (profile) {
          await supabase.from('sequence_enrollments').update({
            network_distance: profile.network_distance || null,
            provider_id: profile.provider_id || null,
          }).eq('id', enrollment.id);
        }
      }
    } else if (step.wait_for_event === 'reply_received') {
      eventOccurred = await checkHasProspectReplied(enrollment.account_id, enrollment.profile_id);
    }

    if (eventOccurred) {
      await supabase.from('sequence_step_executions').update({ status: 'scheduled', scheduled_at: new Date().toISOString() }).eq('id', exec.id);
      if (step.wait_for_event === 'connection_accepted') {
        await supabase.from('sequence_enrollments').update({ connection_status: 'connected', network_distance: 'FIRST_DEGREE' }).eq('id', enrollment.id);
        await logAnalytics(supabase, enrollment.sequence_id, 'invites_accepted');
      }
      eventsTriggered++;
    }
  }
  return new Response(JSON.stringify({ success: true, fastUnblocked, eventsTriggered }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } finally {
    await releaseLock(supabase, runId);
  }
}

// ============ UTILITIES ============

// Inbox rotation: pick the best sender from the pool
// deno-lint-ignore no-explicit-any
async function pickSenderForRotation(supabase: any, sequence: any): Promise<{ account_id: string; email?: string; daily_limit?: number } | null> {
  const accounts = sequence.sender_accounts as { account_id: string; email?: string; daily_limit?: number }[];
  if (!accounts || accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0];

  const mode = sequence.rotation_mode || 'round_robin';

  if (mode === 'random') {
    return accounts[Math.floor(Math.random() * accounts.length)];
  }

  // round_robin / least_used: count sends per sender today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const accountIds = accounts.map(a => a.account_id);

  const { data: todaySends } = await supabase
    .from('sequence_step_executions')
    .select('id, enrollment:sequence_enrollments!inner(assigned_sender_id)')
    .eq('status', 'sent')
    .gte('executed_at', todayStart.toISOString())
    .in('enrollment.assigned_sender_id', accountIds);

  // Count sends per sender
  const sendCounts = new Map<string, number>();
  accountIds.forEach(id => sendCounts.set(id, 0));
  // deno-lint-ignore no-explicit-any
  (todaySends || []).forEach((s: any) => {
    const sid = s.enrollment?.assigned_sender_id;
    if (sid) sendCounts.set(sid, (sendCounts.get(sid) || 0) + 1);
  });

  // Filter out senders who hit their daily limit
  const available = accounts.filter(a => {
    const count = sendCounts.get(a.account_id) || 0;
    return !a.daily_limit || count < a.daily_limit;
  });

  if (available.length === 0) {
    console.warn('[pickSender] All senders hit daily limit');
    return accounts[0]; // Fallback to first sender
  }

  // Pick the one with fewest sends
  available.sort((a, b) => (sendCounts.get(a.account_id) || 0) - (sendCounts.get(b.account_id) || 0));
  return available[0];
}

function needsMessage(actionType: string): boolean { return ['message', 'inmail', 'smart_message', 'email', 'whatsapp_message'].includes(actionType); }

function isLikelyRealFirstName(name: string): boolean {
  if (!name || name.trim().length < 2) return false;
  const t = name.trim();
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/u.test(t)) return false;
  if (/\d/.test(t)) return false;
  if (/[^a-zA-ZÀ-ÿ\s'\-]/.test(t)) return false;
  if (t.length > 2 && t === t.toUpperCase() && /[A-Z]/.test(t)) return false;
  if (/^(mr|mme|dr|prof|dispo|open|looking|hiring|freelance|consultant|dev|engineer|cto|ceo|lead|senior|junior|stagiaire|intern|coach|expert|disponible)/i.test(t)) return false;
  if (/\b(dispo|opentowork|open.to.work|recrut|cherche|search|available)\b/i.test(t)) return false;
  if (/\.\s*$/.test(t)) return false;
  if (/^(.)\1+$/i.test(t)) return false;
  if (t.length > 30) return false;
  // Compound names: validate each part
  if (t.includes(' ')) {
    const parts = t.split(/\s+/);
    if (parts.length > 3) return false;
    if (parts.some(p => p.length < 2)) return false;
  }
  return true;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes (for non-rate-limit retryable errors)

function isRateLimitError(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes('429') || e.includes('rate limit') || e.includes('too many requests');
}

function isRetryableError(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes('429') || e.includes('500') || e.includes('502') || e.includes('503') || e.includes('504')
    || e.includes('timeout') || e.includes('rate limit') || e.includes('temporarily') || e.includes('econnreset')
    || e.includes('fetch failed') || e.includes('network');
}

/**
 * For rate limit (429) errors, compute the retry delay based on the action type:
 * - connection_request → next Monday 9am (weekly limit of ~100 pending invitations)
 * - inmail / smart_message → 1st of next month 9am (monthly InMail credits)
 * - message / profile_visit / other → next business day 9am (daily limits)
 * 
 * All times are in the enrollment's timezone (default Europe/Paris).
 */
function getRateLimitRetryDate(actionType: string, timezone: string): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const dayName = get('weekday');
  const year = parseInt(get('year'));
  const month = parseInt(get('month'));
  const day = parseInt(get('day'));

  // Helper: create a date at 9am in the given timezone (approximate via offset)
  const make9am = (y: number, m: number, d: number) => {
    // Create date string and parse in timezone
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T09:00:00`;
    // Use a rough approach: get the offset for this timezone
    const probe = new Date(dateStr + 'Z');
    const localStr = probe.toLocaleString('en-US', { timeZone: timezone });
    const localDate = new Date(localStr);
    const offsetMs = probe.getTime() - localDate.getTime();
    return new Date(probe.getTime() + offsetMs);
  };

  if (actionType === 'connection_request') {
    // Next Monday
    const dayMap: Record<string, number> = { Sun: 1, Mon: 7, Tue: 6, Wed: 5, Thu: 4, Fri: 3, Sat: 2 };
    const daysUntilMonday = dayMap[dayName] || 7;
    const target = new Date(year, month - 1, day + daysUntilMonday);
    return make9am(target.getFullYear(), target.getMonth() + 1, target.getDate());
  }
  
  if (actionType === 'inmail' || actionType === 'smart_message') {
    // 1st of next month
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return make9am(nextYear, nextMonth, 1);
  }

  // Default: next business day
  const daysToAdd = dayName === 'Fri' ? 3 : dayName === 'Sat' ? 2 : 1;
  const target = new Date(year, month - 1, day + daysToAdd);
  return make9am(target.getFullYear(), target.getMonth() + 1, target.getDate());
}

function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();
    const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(now), 10);
    const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
    return day !== "Sat" && day !== "Sun" && hour >= 8 && hour < 19;
  } catch { return true; }
}

// Helper: get the UTC offset (in hours) for a given timezone at a given instant
function getTimezoneOffsetHours(date: Date, tz: string): number {
  // Extract local hour in the target timezone
  const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date), 10);
  const utcHour = date.getUTCHours();
  // offset = localHour - utcHour (positive means ahead of UTC, e.g. Europe/Paris = +1 or +2)
  let offset = localHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return offset;
}

// Set the date's time so that the LOCAL hour in `tz` equals `desiredLocalHour`
function setLocalHour(date: Date, tz: string, desiredLocalHour: number, minutes = 0): void {
  const offset = getTimezoneOffsetHours(date, tz);
  date.setUTCHours(desiredLocalHour - offset, minutes, 0, 0);
}

function getNextBusinessHourSlot(timezone: string): Date {
  const target = new Date();
  for (let i = 0; i < 7; i++) {
    try {
      const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(target);
      const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(target), 10);
      if (day === "Sat" || day === "Sun" || hour >= 19) {
        target.setDate(target.getDate() + 1);
        setLocalHour(target, timezone, 8, Math.floor(Math.random() * 30));
        continue;
      }
      if (hour < 8) {
        setLocalHour(target, timezone, 8, Math.floor(Math.random() * 30));
      }
      break;
    } catch { target.setTime(target.getTime() + 3600000); break; }
  }
  return target;
}

async function getProfileInfo(accountId: string, profileId: string, enrollmentProfileUrl?: string): Promise<{ network_distance?: string; provider_id?: string } | null> {
  const cacheKey = `${accountId}::${profileId}`;
  const cached = profileInfoCache.get(cacheKey);
  if (cached) {
    console.log(`[getProfileInfo] Cache hit for ${profileId} → network_distance=${cached.network_distance}`);
    return cached;
  }

  try {
    const r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!r.ok) {
      console.warn(`[getProfileInfo] API returned ${r.status} for profileId=${profileId}`);
      return null;
    }
    const data = await r.json();
    const rawDistance = data.network_distance;
    console.log(`[getProfileInfo] profileId=${profileId} | network_distance=${rawDistance} | provider_id=${data.provider_id}`);

    // Normalize network_distance: some API modes return numeric (1) or different strings
    if (rawDistance === 'FIRST_DEGREE' || rawDistance === 1 || rawDistance === '1' || rawDistance === 'DISTANCE_1') {
      data.network_distance = 'FIRST_DEGREE';
      profileInfoCache.set(cacheKey, data);
      return data;
    }

    // If the profile ID is a Recruiter format (AE/AEM), the API may not return accurate network_distance.
    // Try resolving via the profile slug for a more reliable check.
    if (profileId.startsWith('AE') && rawDistance !== 'FIRST_DEGREE') {
      let slug: string | null = null;
      
      // Try extracting slug from enrollment profile URL
      if (enrollmentProfileUrl) {
        const match = enrollmentProfileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
        if (match) slug = match[1];
      }
      
      // Try extracting slug from the recruiter profile's public_identifier
      if (!slug) {
        slug = data.public_identifier || data.public_id || null;
      }

      if (slug) {
        console.log(`[getProfileInfo] Recruiter ID detected, re-checking via slug: ${slug}`);
        const slugRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(slug)}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
        if (slugRes.ok) {
          const slugData = await slugRes.json();
          const slugDistance = slugData.network_distance;
          console.log(`[getProfileInfo] Slug resolution: network_distance=${slugDistance}`);
          if (slugDistance === 'FIRST_DEGREE' || slugDistance === 1 || slugDistance === '1' || slugDistance === 'DISTANCE_1') {
            slugData.network_distance = 'FIRST_DEGREE';
            profileInfoCache.set(cacheKey, slugData);
            return slugData;
          }
        }
      }
    }

    profileInfoCache.set(cacheKey, data);
    return data;
  } catch (err) {
    console.error(`[getProfileInfo] Error for profileId=${profileId}:`, err);
    return null;
  }
}

async function resolveProfileIdForChat(accountId: string, profileId: string, profileUrl?: string | null, enrollmentId?: string, supabase?: any): Promise<string> {
  // If it's a recruiter ID (AEM/AE), resolve to a slug or classic ID for chat API
  if (!profileId.startsWith('AE')) return profileId;
  
  try {
    // Try extracting slug from profile URL first
    let slug: string | null = null;
    if (profileUrl) {
      const match = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
      if (match && !match[1].startsWith('AE')) slug = match[1];
    }
    
    // If no slug from URL, fetch profile to get public_identifier
    if (!slug) {
      const r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
      if (r.ok) {
        const data = await r.json();
        slug = data.public_identifier || data.public_id || null;
        // Also try provider_id if it's a classic format
        if (!slug && data.provider_id && !data.provider_id.startsWith('AE')) {
          return data.provider_id;
        }
      }
    }
    
    if (slug) {
      // Resolve slug to get the classic provider_id
      const slugRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(slug)}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
      if (slugRes.ok) {
        const slugData = await slugRes.json();
        if (slugData.provider_id && !slugData.provider_id.startsWith('AE')) {
          console.log(`[resolveProfileIdForChat] Resolved ${profileId} -> ${slugData.provider_id} via slug ${slug}`);
          // Persist resolved ID for future webhook matching
          if (enrollmentId && supabase) {
            await supabase.from('sequence_enrollments').update({ resolved_profile_id: slugData.provider_id }).eq('id', enrollmentId);
          }
          return slugData.provider_id;
        }
      }
      // Use slug directly as fallback
      console.log(`[resolveProfileIdForChat] Using slug ${slug} for ${profileId}`);
      return slug;
    }
  } catch (err) {
    console.warn(`[resolveProfileIdForChat] Error resolving ${profileId}:`, err);
  }
  
  return profileId;
}

async function checkForReplyAfterDate(accountId: string, profileId: string, afterDate: string, profileUrl?: string | null, enrollmentId?: string, supabase?: any): Promise<boolean> {
  try {
    const enrollmentTime = new Date(afterDate).getTime();
    
    // Resolve recruiter IDs to a format the chat API understands
    const resolvedId = await resolveProfileIdForChat(accountId, profileId, profileUrl, enrollmentId, supabase);
    
    const chatsRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chat_attendees/${resolvedId}/chats?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!chatsRes.ok) {
      // If resolved ID also fails and it was different from original, try original as fallback
      if (resolvedId !== profileId) {
        const fallbackRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chat_attendees/${profileId}/chats?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
        if (!fallbackRes.ok) return false;
        const fallbackChats = (await fallbackRes.json()).items || [];
        return await checkMessagesForReply(fallbackChats, enrollmentTime);
      }
      return false;
    }
    const chats = (await chatsRes.json()).items || [];
    return await checkMessagesForReply(chats, enrollmentTime);
  } catch { return false; }
}

interface ChatAttendeeInfo {
  ownIds: Set<string>;
  otherIds: Set<string>;
  resolved: boolean;
}

async function resolveAttendeeIds(chatId: string): Promise<ChatAttendeeInfo> {
  const result: ChatAttendeeInfo = { ownIds: new Set(['self']), otherIds: new Set(), resolved: false };
  try {
    const attRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats/${chatId}/attendees`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!attRes.ok) {
      console.warn(`[checkReplies] Attendees endpoint failed for chat ${chatId}: ${attRes.status}`);
      return result;
    }
    const attData = await attRes.json();
    const attendees = attData.items || attData || [];
    const list = Array.isArray(attendees) ? attendees : [];
    
    // Log full attendee data for debugging
    // deno-lint-ignore no-explicit-any
    console.log(`[checkReplies] Chat ${chatId} attendees (${list.length}):`, list.map((a: any) => ({ 
      id: a.id, provider_id: a.provider_id, is_self: a.is_self, role: a.role, display_name: a.display_name 
    })));
    
    // deno-lint-ignore no-explicit-any
    for (const att of list) {
      const ids = [att.id, att.provider_id, att.attendee_id].filter(Boolean);
      // is_self can be true/false/0/1/undefined — normalize carefully
      const isSelf = att.is_self === true || att.is_self === 1 || att.role === 'self';
      const isOther = att.is_self === false || att.is_self === 0;
      if (isSelf) {
        ids.forEach((id: string) => result.ownIds.add(id));
      } else if (isOther) {
        ids.forEach((id: string) => result.otherIds.add(id));
      } else {
        // Unknown — don't classify
        console.log(`[checkReplies] Attendee ${att.id} has ambiguous is_self=${att.is_self}`);
      }
    }
    
    // In a 1-to-1 chat with 2 attendees, if we can't find is_self,
    // but we know our account, we can infer: the attendee that ISN'T us is the other person.
    // If NO attendee has is_self, use a different approach:
    // Any message from an attendee in otherIds is a genuine reply.
    // Any message from an attendee NOT in otherIds AND NOT in ownIds is ambiguous.
    result.resolved = list.length > 0;
    
    console.log(`[checkReplies] Resolved for chat ${chatId}: ownIds=${JSON.stringify(Array.from(result.ownIds))}, otherIds=${JSON.stringify(Array.from(result.otherIds))}`);
  } catch (e) {
    console.warn(`[checkReplies] Failed to resolve attendees for chat ${chatId}:`, e);
  }
  return result;
}

async function checkMessagesForReply(chats: { id: string }[], afterTimestamp: number): Promise<boolean> {
  for (const chat of chats) {
    // Resolve attendee identities for this chat
    const attendeeInfo = await resolveAttendeeIds(chat.id);

    const msgRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats/${chat.id}/messages?limit=10`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!msgRes.ok) continue;
    const messages = (await msgRes.json()).items || [];
    // deno-lint-ignore no-explicit-any
    const incomingReplies = messages.filter((m: any) => {
      // Explicit self-detection — always trust this
      if (m.is_sender_self === true) return false;
      // If explicitly marked as not-self, it's a genuine reply
      if (m.is_sender_self === false) {
        const msgTime = new Date(m.timestamp || m.date || m.created_at).getTime();
        return msgTime > afterTimestamp;
      }
      // is_sender_self is undefined (InMail case) — use attendee resolution
      const senderAtt = m.sender_attendee_id || '';
      // If sender is in our known own IDs, skip
      if (attendeeInfo.ownIds.has(senderAtt)) return false;
      // If sender is in known other IDs (the prospect), it's a genuine reply
      if (senderAtt && attendeeInfo.otherIds.has(senderAtt)) {
        const msgTime = new Date(m.timestamp || m.date || m.created_at).getTime();
        return msgTime > afterTimestamp;
      }
      // If we have otherIds resolved but sender is NOT in them, it's likely us → skip
      if (attendeeInfo.resolved && attendeeInfo.otherIds.size > 0) {
        console.log(`[checkReplies] Skipping message ${m.id} — sender ${senderAtt} not in otherIds, likely self`);
        return false;
      }
      // No resolution at all — skip to be safe
      console.log(`[checkReplies] Skipping ambiguous message ${m.id} (no attendee resolution)`);
      return false;
    });
    if (incomingReplies.length > 0) {
      // deno-lint-ignore no-explicit-any
      console.log(`[checkReplies] Found ${incomingReplies.length} genuine reply(ies) in chat ${chat.id}:`, incomingReplies.map((m: any) => ({ 
        id: m.id, is_sender_self: m.is_sender_self, sender_attendee_id: m.sender_attendee_id, type: m.type,
        timestamp: m.timestamp || m.date 
      })));
      return true;
    }
  }
  return false;
}

async function checkHasProspectReplied(accountId: string, profileId: string): Promise<boolean> {
  // 72h window instead of 24h to catch weekend replies
  return await checkForReplyAfterDate(accountId, profileId, new Date(Date.now() - 72 * 3600000).toISOString());
}

// deno-lint-ignore no-explicit-any
async function checkQuotaForAction(supabase: any, actionType: string, accountId: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    if (actionType === 'inmail' || actionType === 'smart_message') {
      const r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/linkedin/inmail_balance?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
      if (!r.ok) return { allowed: true };
      const b = await r.json();
      const total = (b.recruiter || 0) + (b.premium || 0) + (b.sales_navigator || 0);
      if (total <= 0) return { allowed: false, reason: 'Quota InMail épuisé' };
    } else if (actionType === 'connection_request') {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const { data } = await supabase.from('sequence_step_executions').select('id, step:sequence_steps!inner(action_type)').eq('status', 'sent').eq('step.action_type', 'connection_request').gte('executed_at', weekAgo.toISOString());
      if ((data?.length || 0) >= WEEKLY_INVITE_LIMIT) return { allowed: false, reason: `Limite hebdo invitations (${WEEKLY_INVITE_LIMIT})` };
    }
    return { allowed: true };
  } catch { return { allowed: true }; }
}

// deno-lint-ignore no-explicit-any
async function checkStepCondition(conditionType: string, accountId: string, profileId: string, waitForEvent?: string, profileUrl?: string, supabaseClient?: any, enrollmentId?: string, enrollment?: any, conditionValue?: string): Promise<boolean | 'wait'> {
  const eff = waitForEvent ? 'wait_for_event' : (conditionType || 'always');
  switch (eff) {
    case 'always': return true;
    case 'if_connected': { const p = await getProfileInfo(accountId, profileId, profileUrl); return p?.network_distance === 'FIRST_DEGREE'; }
    case 'if_not_connected': { const p = await getProfileInfo(accountId, profileId, profileUrl); return p?.network_distance !== 'FIRST_DEGREE'; }
    case 'if_no_response': return !(await checkHasProspectReplied(accountId, profileId));
    case 'wait_until_connected': { const p = await getProfileInfo(accountId, profileId, profileUrl); return p?.network_distance === 'FIRST_DEGREE' ? true : 'wait'; }
    case 'wait_for_event': {
      if (waitForEvent === 'connection_accepted') { const p = await getProfileInfo(accountId, profileId, profileUrl); return p?.network_distance === 'FIRST_DEGREE' ? true : 'wait'; }
      if (waitForEvent === 'reply_received') return (await checkHasProspectReplied(accountId, profileId)) ? true : 'wait';
      if (waitForEvent === 'email_opened' && supabaseClient && enrollmentId) {
        const { data } = await supabaseClient.from('sequence_step_executions').select('id').eq('enrollment_id', enrollmentId).in('status', ['opened', 'clicked', 'replied']).limit(1);
        return (data && data.length > 0) ? true : 'wait';
      }
      if (waitForEvent === 'link_clicked' && supabaseClient && enrollmentId) {
        const { data } = await supabaseClient.from('sequence_step_executions').select('id').eq('enrollment_id', enrollmentId).in('status', ['clicked', 'replied']).limit(1);
        return (data && data.length > 0) ? true : 'wait';
      }
      return true;
    }

    // --- NEW: Email engagement conditions ---
    case 'if_email_opened': {
      if (!supabaseClient || !enrollmentId) return true;
      const { data } = await supabaseClient.from('sequence_step_executions').select('id').eq('enrollment_id', enrollmentId).in('status', ['opened', 'clicked', 'replied']).limit(1);
      return data && data.length > 0;
    }
    case 'if_email_not_opened': {
      if (!supabaseClient || !enrollmentId) return true;
      const { data: sentEmails } = await supabaseClient.from('sequence_step_executions').select('id, status').eq('enrollment_id', enrollmentId).eq('channel', 'email').in('status', ['sent', 'opened', 'clicked', 'replied']);
      if (!sentEmails || sentEmails.length === 0) return true; // no emails sent yet → condition is vacuously true
      const anyOpened = sentEmails.some((e: { status: string }) => e.status !== 'sent');
      return !anyOpened;
    }
    case 'if_link_clicked': {
      if (!supabaseClient || !enrollmentId) return true;
      const { data } = await supabaseClient.from('sequence_step_executions').select('id').eq('enrollment_id', enrollmentId).in('status', ['clicked', 'replied']).limit(1);
      return data && data.length > 0;
    }
    case 'if_link_not_clicked': {
      if (!supabaseClient || !enrollmentId) return true;
      const { data } = await supabaseClient.from('sequence_step_executions').select('id').eq('enrollment_id', enrollmentId).in('status', ['clicked']).limit(1);
      return !data || data.length === 0;
    }

    // --- NEW: Data availability conditions ---
    case 'if_has_email': return !!(enrollment?.email_used);
    case 'if_no_email': return !(enrollment?.email_used);
    case 'if_has_phone': {
      return !!(enrollment?.phone_used);
    }
    case 'if_no_phone': {
      return !(enrollment?.phone_used);
    }

    // --- NEW: Status-based conditions ---
    case 'if_bounced': {
      if (!supabaseClient || !enrollmentId) return false;
      const { data } = await supabaseClient.from('sequence_step_executions').select('id').eq('enrollment_id', enrollmentId).eq('status', 'bounced').limit(1);
      return data && data.length > 0;
    }
    case 'if_unsubscribed': {
      if (!supabaseClient || !enrollment?.email_used) return false;
      const { data } = await supabaseClient.from('suppressed_emails').select('id').eq('email', enrollment.email_used).limit(1);
      return data && data.length > 0;
    }

    // --- NEW: Scoring condition ---
    case 'if_score_above': {
      if (!supabaseClient || !profileId) return false;
      const threshold = parseInt(conditionValue || '0', 10);
      const { data } = await supabaseClient.from('job_candidate_status').select('score').eq('candidate_id', profileId).not('score', 'is', null).order('score', { ascending: false }).limit(1);
      if (!data || data.length === 0) return false;
      return (data[0].score || 0) >= threshold;
    }

    default: return true;
  }
}

// Force reschedule: move all today's scheduled executions to NOW so they get picked up immediately
async function handleForceReschedule(supabase: any) {
  const now = new Date();
  const tz = 'Europe/Paris';
  
  // Get today's end in Paris timezone
  const todayEnd = new Date(now);
  todayEnd.setDate(todayEnd.getDate() + 1);
  setLocalHour(todayEnd, tz, 0, 0);
  
  // Reschedule all 'scheduled' executions that are due today but haven't been processed yet
  const { data: updated, error } = await supabase
    .from('sequence_step_executions')
    .update({ scheduled_at: now.toISOString() })
    .eq('status', 'scheduled')
    .gt('scheduled_at', now.toISOString())
    .lte('scheduled_at', todayEnd.toISOString())
    .select('id');
  
  if (error) {
    console.error('[force_reschedule] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  const count = updated?.length || 0;
  console.log(`[force_reschedule] Rescheduled ${count} executions to now`);
  
  return new Response(JSON.stringify({ success: true, rescheduled: count }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
async function scheduleNextStep(supabase: any, enrollment: any, currentStepOrder: number, forceBranchStepId?: string, conditionResult?: 'yes' | 'no', _depth = 0, currentStepId?: string) {
  // Guard: prevent infinite recursion on deeply nested or circular branches
  const MAX_BRANCH_DEPTH = 10;
  if (_depth >= MAX_BRANCH_DEPTH) {
    console.error(`[scheduleNextStep] MAX_BRANCH_DEPTH (${MAX_BRANCH_DEPTH}) reached for enrollment ${enrollment.id} at step_order ${currentStepOrder}. Completing sequence to prevent infinite loop.`);
    await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
    return;
  }

  let nextStep;

  if (forceBranchStepId) {
    const { data } = await supabase.from('sequence_steps').select('*').eq('id', forceBranchStepId).maybeSingle();
    nextStep = data;
  } else {
    // Fetch current step with branching columns — use ID if available (step_order is no longer unique)
    let currentStepQuery = supabase.from('sequence_steps')
      .select('id, next_step_id, parent_step_id, branch, step_order, sequence_id');
    if (currentStepId) {
      currentStepQuery = currentStepQuery.eq('id', currentStepId);
    } else {
      currentStepQuery = currentStepQuery
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_order', currentStepOrder)
        .is('parent_step_id', null) // prefer root-level step when no ID given
        .is('branch', null);
    }
    const { data: currentStep } = await currentStepQuery.maybeSingle();

    // === NEW: parent_step_id/branch tree resolution ===
    // If a conditionResult is provided, route to the matching child branch
    if (!nextStep && conditionResult && currentStep?.id) {
      const { data: branchStep } = await supabase.from('sequence_steps')
        .select('*')
        .eq('parent_step_id', currentStep.id)
        .eq('branch', conditionResult)
        .order('step_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (branchStep) {
        nextStep = branchStep;
      } else {
        // conditionResult was explicitly set but no matching branch exists.
        // This means the branch is empty (e.g. "No" branch has no steps).
        // Do NOT fall through to next_step_id or step_order+1 — that would be wrong routing.
        // Instead, check if there's a step after the condition node at root level.
        console.log(`[scheduleNextStep] No '${conditionResult}' branch child for step ${currentStepOrder}. Looking for next root-level step.`);
        // Skip to the step after this condition in the main flow
        const { data: nextRootStep } = await supabase.from('sequence_steps')
          .select('*')
          .eq('sequence_id', enrollment.sequence_id)
          .is('parent_step_id', null)
          .is('branch', null)
          .gt('step_order', currentStepOrder)
          .order('step_order', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (nextRootStep) {
          nextStep = nextRootStep;
        } else {
          // No more steps at all — complete the sequence
          await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
          return;
        }
      }
    }

    // If current step is IN a branch (has parent_step_id), find next sibling in same branch
    if (!nextStep && currentStep?.parent_step_id && currentStep.branch) {
      const { data: nextInBranch } = await supabase.from('sequence_steps')
        .select('*')
        .eq('parent_step_id', currentStep.parent_step_id)
        .eq('branch', currentStep.branch)
        .gt('step_order', currentStepOrder)
        .order('step_order', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextInBranch) {
        nextStep = nextInBranch;
      } else {
        // End of branch → find the parent step and continue after it
        const { data: parentStep } = await supabase.from('sequence_steps')
          .select('step_order, parent_step_id, branch')
          .eq('id', currentStep.parent_step_id)
          .single();
        if (parentStep) {
          // Recurse: schedule the step after the parent (using parent's context)
          return scheduleNextStep(supabase, enrollment, parentStep.step_order, undefined, undefined, _depth + 1);
        }
      }
    }
    // === END parent_step_id/branch resolution ===

    // Existing: try next_step_id (graph-based chaining)
    if (!nextStep && currentStep?.next_step_id) {
      const { data } = await supabase.from('sequence_steps').select('*').eq('id', currentStep.next_step_id).maybeSingle();
      nextStep = data;
    }

    if (!nextStep) {
      // Before falling back to step_order + 1, check if the CURRENT step is a branch target
      // (i.e., reached via timeout_branch_step_id, if_true_goto_step, or if_false_goto_step).
      // If so, step_order + 1 is NOT a valid continuation — it belongs to a different branch.
      let isBranchTarget = false;
      if (currentStep?.id) {
        const { data: referencingSteps } = await supabase.from('sequence_steps')
          .select('id')
          .eq('sequence_id', enrollment.sequence_id)
          .or(`timeout_branch_step_id.eq.${currentStep.id},if_true_goto_step.eq.${currentStep.id},if_false_goto_step.eq.${currentStep.id},next_step_id.eq.${currentStep.id}`);
        
        if (referencingSteps && referencingSteps.length > 0) {
          isBranchTarget = true;
          console.log(`[scheduleNextStep] Step ${currentStepOrder} is a branch target (referenced by ${referencingSteps.length} step(s)). Blocking step_order+1 fallback → completing sequence.`);
        }
      }

      if (!isBranchTarget) {
        // Safe fallback to step_order + 1 for truly linear sequences (root-level steps only)
        const { data: candidateNext } = await supabase.from('sequence_steps').select('*').eq('sequence_id', enrollment.sequence_id).eq('step_order', currentStepOrder + 1).is('parent_step_id', null).is('branch', null).maybeSingle();
        
        if (candidateNext) {
          // Guard: if the candidate next step has a branch-specific condition, verify compatibility
          if (candidateNext.condition_type) {
            const connStatus = enrollment.connection_status;
            if (candidateNext.condition_type === 'if_connected' && connStatus !== 'connected') {
              console.log(`[scheduleNextStep] Skipping step ${candidateNext.step_order} (if_connected) — enrollment connection_status is '${connStatus}'`);
              await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
              return;
            }
            if (candidateNext.condition_type === 'if_not_connected' && connStatus === 'connected') {
              console.log(`[scheduleNextStep] Skipping step ${candidateNext.step_order} (if_not_connected) — enrollment is connected`);
              await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
              return;
            }
          }
          nextStep = candidateNext;
        }
        // else: no step_order+1 found — sequence complete (falls through to !nextStep check below)
      }
      // If isBranchTarget and no next_step_id: sequence complete for this branch
    }
  }

  if (!nextStep) {
    await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
    return;
  }

  let scheduledAt = new Date();
  // Use time-based arithmetic to avoid setHours/setDate timezone pitfalls
  scheduledAt.setTime(scheduledAt.getTime()
    + (nextStep.delay_days || 0) * 86400000
    + (nextStep.delay_hours || 0) * 3600000
    + (nextStep.delay_minutes || 0) * 60000
  );
  // Add human-like jitter: 0 to +3 minutes (never negative, to avoid going before preferred_hour_start)
  scheduledAt.setTime(scheduledAt.getTime() + Math.floor(Math.random() * 3) * 60000);
  
  // Use timezone-aware hour checking for preferred hours and weekday skipping
  const tz = enrollment.user_timezone || 'Europe/Paris';
  const ps = nextStep.preferred_hour_start ?? 9, pe = nextStep.preferred_hour_end ?? 18;
  
  // Adjust to business hours in the user's timezone (loop up to 7 days to skip weekends)
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(scheduledAt), 10);
      const localDay = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(scheduledAt);
      
      if (localDay === "Sat") { scheduledAt.setDate(scheduledAt.getDate() + 2); setLocalHour(scheduledAt, tz, ps, Math.floor(Math.random() * 30)); continue; }
      if (localDay === "Sun") { scheduledAt.setDate(scheduledAt.getDate() + 1); setLocalHour(scheduledAt, tz, ps, Math.floor(Math.random() * 30)); continue; }
      if (localHour >= pe) { scheduledAt.setDate(scheduledAt.getDate() + 1); setLocalHour(scheduledAt, tz, ps, Math.floor(Math.random() * 30)); continue; }
      if (localHour < ps) { setLocalHour(scheduledAt, tz, ps, Math.floor(Math.random() * 30)); }
      break;
    } catch { break; }
  }

  // Fix 4: Re-check enrollment status before inserting — prevent scheduling on replied/completed enrollments
  const { data: freshEnrollmentStatus } = await supabase
    .from('sequence_enrollments').select('status').eq('id', enrollment.id).single();
  if (freshEnrollmentStatus && freshEnrollmentStatus.status !== 'active') {
    console.log(`[scheduleNextStep] Enrollment ${enrollment.id} is '${freshEnrollmentStatus.status}', not scheduling next step`);
    return;
  }

  // === A/B TESTING: if nextStep has a variant_group, pick a variant ===
  let variantAssigned: string | null = null;
  if (nextStep.variant_group) {
    const { data: variants } = await supabase.from('sequence_steps')
      .select('*')
      .eq('sequence_id', nextStep.sequence_id)
      .eq('step_order', nextStep.step_order)
      .not('variant_group', 'is', null);

    if (variants && variants.length > 1) {
      // Weighted random selection
      const totalWeight = variants.reduce((sum: number, v: { variant_weight?: number }) => sum + (v.variant_weight || 100), 0);
      let random = Math.random() * totalWeight;
      for (const variant of variants) {
        random -= (variant.variant_weight || 100);
        if (random <= 0) {
          nextStep = variant;
          break;
        }
      }
      variantAssigned = nextStep.variant_group;
      console.log(`[scheduleNextStep] A/B test: selected variant '${variantAssigned}' for enrollment ${enrollment.id} step_order ${nextStep.step_order}`);
    }
  }

  // Guard: prevent duplicate executions for the same enrollment+step (any non-terminal status)
  const { data: existing } = await supabase.from('sequence_step_executions').select('id, status').eq('enrollment_id', enrollment.id).eq('step_id', nextStep.id).in('status', ['scheduled', 'sending', 'waiting_event', 'quota_blocked']);
  if (existing && existing.length > 0) {
    console.log(`[scheduleNextStep] Skipping duplicate: enrollment=${enrollment.id} step=${nextStep.id} (existing status=${existing[0].status})`);
    return;
  }

  await supabase.from('sequence_step_executions').insert({
    enrollment_id: enrollment.id,
    step_id: nextStep.id,
    step_order: nextStep.step_order,
    scheduled_at: scheduledAt.toISOString(),
    status: 'scheduled',
    variant_assigned: variantAssigned,
  });
}

// deno-lint-ignore no-explicit-any
async function executeStepAction(actionType: string, enrollment: Record<string, unknown>, step: Record<string, unknown>, execution: Record<string, unknown>, supabase: any): Promise<{ success: boolean; error?: string; subject?: string; message?: string }> {
  try {
    const accountId = enrollment.account_id as string, profileId = enrollment.profile_id as string;
    const msg = (execution.final_message || step.message_template || '') as string;
    const subj = (execution.final_subject || step.subject_template || '') as string;

    switch (actionType) {
      case 'email': {
        // Delegate to sequence-send-email edge function
        // Pass pre-personalized message so sequence-send-email uses it instead of its basic AI
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        try {
          const emailRes = await fetchWithTimeout(
            `${supabaseUrl}/functions/v1/sequence-send-email`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                execution_id: execution.id,
                enrollment_id: enrollment.id,
                step_id: step.id,
                pre_personalized_message: msg || undefined,
                pre_personalized_subject: subj || undefined,
              }),
            },
            30000, // 30s timeout for email sending
          );

          if (emailRes.ok) {
            const result = await emailRes.json();
            if (result.success) {
              // sequence-send-email already updated the execution status
              return { success: true, message: result.message_id };
            }
            return { success: false, error: result.error || 'Email send failed' };
          }
          const errText = await emailRes.text().catch(() => '');
          return { success: false, error: `sequence-send-email ${emailRes.status}: ${errText}` };
        } catch (emailErr) {
          return { success: false, error: `Email function error: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}` };
        }
      }
      case 'wait_connection': return { success: false, error: '__WAIT_EVENT__' };
      case 'check_connection': {
        const p = await getProfileInfo(accountId, profileId, enrollment.profile_url as string | undefined);
        const isConnected = p?.network_distance === 'FIRST_DEGREE';
        await supabase.from('sequence_enrollments').update({ connection_status: isConnected ? 'connected' : 'not_connected' }).eq('id', enrollment.id);
        const nextId = isConnected ? step.if_true_goto_step : step.if_false_goto_step;
        if (nextId) {
          // Old-style explicit branching (if_true_goto_step / if_false_goto_step)
          await scheduleNextStep(supabase, enrollment, step.step_order as number, nextId as string, undefined, 0, step.id as string);
        } else {
          // New tree branching via parent_step_id/branch — pass condition result
          await scheduleNextStep(supabase, enrollment, step.step_order as number, undefined, isConnected ? 'yes' : 'no', 0, step.id as string);
        }
        return { success: true };
      }
      case 'profile_visit': {
        const r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
        if (r.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'profile_visits');
          return { success: true };
        }
        const errBody = await r.text().catch(() => '');
        return { success: false, error: `Profile visit ${r.status}: ${errBody || r.statusText}` };
      }
      case 'smart_message': case 'inmail': case 'message': {
        const p = await getProfileInfo(accountId, profileId, enrollment.profile_url as string | undefined);
        const isConnected = p?.network_distance === 'FIRST_DEGREE' || (enrollment as any).connection_status === 'connected';
        const needsInMail = !isConnected && (actionType === 'inmail' || actionType === 'smart_message');

        // Resolve LinkedIn API mode: recruiter vs sales_navigator vs classic
        // Based on which subscription has InMail credits available
        let linkedinApiMode = 'classic';
        if (needsInMail) {
          try {
            const balRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/linkedin/inmail_balance?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
            if (balRes.ok) {
              const bal = await balRes.json();
              if ((bal.recruiter || 0) > 0) linkedinApiMode = 'recruiter';
              else if ((bal.sales_navigator || 0) > 0) linkedinApiMode = 'sales_navigator';
              else if ((bal.premium || 0) > 0) linkedinApiMode = 'classic'; // Premium uses classic API
            }
          } catch { linkedinApiMode = 'recruiter'; /* fallback */ }
        }

        console.log(`[executeStepAction] ${(enrollment as any).profile_name} | actionType=${actionType} | isConnected=${isConnected} | needsInMail=${needsInMail} | apiMode=${linkedinApiMode}`);
        
        // *** SINGLE THREAD LOGIC ***
        // Try to find an existing chat with this candidate to avoid creating duplicate threads
        let existingChatId: string | null = null;
        try {
          const resolvedId = (enrollment as any).resolved_profile_id || profileId;
          const chatsRes = await fetchWithTimeout(
            `${UNIPILE_DSN}/api/v1/chat_attendees/${resolvedId}/chats?account_id=${accountId}`,
            { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
          );
          if (chatsRes.ok) {
            const chatsData = await chatsRes.json();
            const chats = chatsData.items || [];
            if (chats.length > 0) {
              // Use the most recent chat (first in the list)
              existingChatId = chats[0].id;
              console.log(`[executeStepAction] Found existing chat ${existingChatId} with ${(enrollment as any).profile_name} (${chats.length} total chats)`);
            }
          } else if (resolvedId !== profileId) {
            // Fallback: try with original profileId
            const fallbackRes = await fetchWithTimeout(
              `${UNIPILE_DSN}/api/v1/chat_attendees/${profileId}/chats?account_id=${accountId}`,
              { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
            );
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              const fallbackChats = fallbackData.items || [];
              if (fallbackChats.length > 0) {
                existingChatId = fallbackChats[0].id;
                console.log(`[executeStepAction] Found existing chat ${existingChatId} via fallback ID`);
              }
            }
          }
        } catch (chatLookupErr) {
          console.warn(`[executeStepAction] Chat lookup failed (will create new):`, chatLookupErr);
        }

        let r: Response;
        if (existingChatId) {
          // Send to existing chat thread — NO duplicate!
          const fd = new FormData();
          fd.append('text', msg);
          r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats/${existingChatId}/messages`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY! }, body: fd });
          if (!r.ok) {
            // Fallback: if sending to existing chat fails (e.g. InMail thread can't receive replies), create new
            console.warn(`[executeStepAction] Send to existing chat ${existingChatId} failed (${r.status}), falling back to new chat`);
            const fd2 = new FormData();
            fd2.append('account_id', accountId); fd2.append('attendees_ids', profileId); fd2.append('text', msg);
            if (needsInMail) { fd2.append('linkedin[api]', linkedinApiMode); fd2.append('linkedin[inmail]', 'true'); if (subj) fd2.append('subject', subj); }
            r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY! }, body: fd2 });
          }
        } else {
          // No existing chat — create new one (first contact)
          console.log(`[executeStepAction] No existing chat found for ${(enrollment as any).profile_name}, creating new`);
          const fd = new FormData();
          fd.append('account_id', accountId); fd.append('attendees_ids', profileId); fd.append('text', msg);
          if (needsInMail) { fd.append('linkedin[api]', linkedinApiMode); fd.append('linkedin[inmail]', 'true'); if (subj) fd.append('subject', subj); }
          r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY! }, body: fd });
        }
        if (!r.ok) { const e = await r.text(); return { success: false, error: `Unipile ${r.status}: ${e}` }; }
        await r.json();
        await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        return { success: true, message: msg, subject: needsInMail ? subj : undefined };
      }
      case 'whatsapp_message': {
        // Send WhatsApp message via Unipile — same API as LinkedIn (POST /api/v1/chats)
        // Uses the WhatsApp account_id and the candidate's phone number as attendee
        const whatsappAccountId = (step.sender_id || enrollment.assigned_sender_id || enrollment.account_id) as string;
        const phoneNumber = (enrollment as any).phone_used;

        if (!phoneNumber) {
          return { success: false, error: 'No phone number available for WhatsApp' };
        }

        // Try to find existing WhatsApp chat
        let waExistingChatId: string | null = null;
        try {
          const waChatsRes = await fetchWithTimeout(
            `${UNIPILE_DSN}/api/v1/chat_attendees/${phoneNumber}/chats?account_id=${whatsappAccountId}`,
            { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
          );
          if (waChatsRes.ok) {
            const waChatsData = await waChatsRes.json();
            if (waChatsData.items?.length > 0) {
              waExistingChatId = waChatsData.items[0].id;
              console.log(`[executeStepAction] Found existing WhatsApp chat ${waExistingChatId}`);
            }
          }
        } catch { /* will create new */ }

        let waR: Response;
        if (waExistingChatId) {
          const waFd = new FormData();
          waFd.append('text', msg);
          waR = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats/${waExistingChatId}/messages`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY! }, body: waFd });
        } else {
          const waFd = new FormData();
          waFd.append('account_id', whatsappAccountId);
          waFd.append('attendees_ids', phoneNumber);
          waFd.append('text', msg);
          waR = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/chats`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY! }, body: waFd });
        }
        if (!waR.ok) { const e = await waR.text(); return { success: false, error: `Unipile WhatsApp ${waR.status}: ${e}` }; }
        await waR.json();
        await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        return { success: true, message: msg };
      }
      case 'connection_request': {
        let providerId = profileId;
        if (!profileId.startsWith('ACo') && !profileId.startsWith('ADo')) {
          console.log(`[connection_request] Profile ID ${profileId} is not classic format, resolving...`);
          let resolved = false;

          // Strategy 1: Extract slug from profile URL
          const profileUrl = enrollment.profile_url as string | undefined;
          if (profileUrl) {
            const match = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
            if (match) {
              console.log(`[connection_request] Trying slug resolution: ${match[1]}`);
              const pr = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(match[1])}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
              if (pr.ok) {
                const pd = await pr.json();
                if (pd.provider_id && (pd.provider_id.startsWith('ACo') || pd.provider_id.startsWith('ADo'))) {
                  providerId = pd.provider_id;
                  resolved = true;
                  console.log(`[connection_request] Resolved via slug to: ${providerId}`);
                }
              }
            }
          }

          // Strategy 2: Fetch recruiter profile to get public_identifier, then resolve
          if (!resolved) {
            console.log(`[connection_request] Trying recruiter profile resolution...`);
            const recruiterRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
            if (recruiterRes.ok) {
              const recruiterProfile = await recruiterRes.json();
              const publicId = recruiterProfile.public_identifier || recruiterProfile.public_id;
              if (publicId) {
                console.log(`[connection_request] Got public_identifier: ${publicId}, resolving classic ID...`);
                const classicRes = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(publicId)}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
                if (classicRes.ok) {
                  const classicProfile = await classicRes.json();
                  if (classicProfile.provider_id && (classicProfile.provider_id.startsWith('ACo') || classicProfile.provider_id.startsWith('ADo'))) {
                    providerId = classicProfile.provider_id;
                    resolved = true;
                    console.log(`[connection_request] Resolved via recruiter profile to: ${providerId}`);
                  }
                }
              }
              // Strategy 3: Check if the recruiter profile itself has a member_urn or classic provider_id
              if (!resolved && recruiterProfile.member_urn) {
                const urnMatch = recruiterProfile.member_urn.match(/urn:li:fs_miniProfile:(.+)/);
                if (urnMatch) {
                  providerId = urnMatch[1];
                  resolved = true;
                  console.log(`[connection_request] Resolved via member_urn to: ${providerId}`);
                }
              }
            }
          }

          if (!resolved) {
            console.warn(`[connection_request] Could not resolve classic ID for ${profileId}, attempting with original ID`);
          }

          // Save resolved classic ID for future reply matching (webhook + checkReplies)
          if (resolved && providerId !== profileId) {
            await supabase.from('sequence_enrollments').update({ resolved_profile_id: providerId }).eq('id', enrollment.id);
            console.log(`[connection_request] Saved resolved_profile_id: ${providerId}`);
          }
        }
        const r = await fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/invite`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, provider_id: providerId }) });
        if (!r.ok) { const e = await r.text(); return { success: false, error: `Invite ${r.status}: ${e}` }; }
        await logAnalytics(supabase, enrollment.sequence_id as string, 'invites_sent');
        await supabase.from('sequence_enrollments').update({ connection_status: 'pending_invite' }).eq('id', enrollment.id);
        return { success: true };
      }
      default: return { success: false, error: `Unknown action: ${actionType}` };
    }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : 'Failed' }; }
}

// deno-lint-ignore no-explicit-any
async function logAnalytics(supabase: any, sequenceId: string, field: string) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data: existing } = await supabase.from('sequence_analytics').select('*').eq('sequence_id', sequenceId).eq('date', today).maybeSingle();
    if (existing) await supabase.from('sequence_analytics').update({ [field]: (existing[field] || 0) + 1 }).eq('id', existing.id);
    else await supabase.from('sequence_analytics').insert({ sequence_id: sequenceId, date: today, [field]: 1 });
  } catch (e) { console.error('Analytics error:', e); }
}

// ============ NOTION CANDIDATE/SHORTLIST SYNC ============

const CANDIDATS_DATABASE_ID = Deno.env.get("NOTION_CANDIDATS_DB_ID")!;
const SHORTLIST_DATABASE_ID_SEQ = Deno.env.get("NOTION_SHORTLIST_DB_ID")!;

// Action → Notion stage mapping
const ACTION_TO_NOTION_STAGE: Record<string, { etape: string; etat: string }> = {
  connection_request: { etape: 'Pressenti', etat: 'Message à envoyer' },
  message:            { etape: 'Contacté', etat: 'En attente de réponse' },
  smart_message:      { etape: 'Contacté', etat: 'En attente de réponse' },
  inmail:             { etape: 'Contacté', etat: 'En attente de réponse' },
};

async function notionQuerySeq(databaseId: string, filter: Record<string, unknown>) {
  if (!NOTION_API_KEY) return null;
  const response = await fetchWithTimeout(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, page_size: 100 }),
  });
  if (!response.ok) return null;
  return response.json();
}

async function updateNotionPageSeq(pageId: string, properties: Record<string, unknown>) {
  if (!NOTION_API_KEY) return false;
  const response = await fetchWithTimeout(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  if (!response.ok) console.error('[notion-sync] Update error:', await response.text().catch(() => ''));
  return response.ok;
}

async function findCandidateInNotionSeq(name: string, linkedinUrl?: string): Promise<string | null> {
  if (linkedinUrl) {
    const r = await notionQuerySeq(CANDIDATS_DATABASE_ID, { property: 'URL Linkedin', url: { equals: linkedinUrl } });
    if (r?.results?.[0]?.id) return r.results[0].id;
  }
  if (name) {
    const r = await notionQuerySeq(CANDIDATS_DATABASE_ID, { property: 'Nom', title: { equals: name } });
    if (r?.results?.[0]?.id) return r.results[0].id;
  }
  return null;
}

async function findShortlistsForCandidateSeq(candidateId: string): Promise<string[]> {
  const r = await notionQuerySeq(SHORTLIST_DATABASE_ID_SEQ, { property: 'Candidats', relation: { contains: candidateId } });
  return (r?.results || []).map((p: { id: string }) => p.id);
}

async function createNotionPageSeq(databaseId: string, properties: Record<string, unknown>): Promise<string | null> {
  if (!NOTION_API_KEY) return null;
  const response = await fetchWithTimeout('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
  if (!response.ok) {
    console.error('[notion-sync] Create page error:', await response.text().catch(() => ''));
    return null;
  }
  const data = await response.json();
  return data.id;
}

async function createCandidateAndShortlistInNotion(
  enrollment: Record<string, unknown>,
  mapping: { etape: string; etat: string }
): Promise<string | null> {
  const profileName = enrollment.profile_name as string;
  const profileUrl = enrollment.profile_url as string | undefined;
  const profileHeadline = enrollment.profile_headline as string | undefined;
  const jobId = enrollment.job_id as string | undefined;
  const jobTitle = enrollment.job_title as string | undefined;

  // Create Candidat
  const candidatProps: Record<string, unknown> = {
    'Nom': { title: [{ text: { content: profileName } }] },
    'Entité': { select: { name: 'Konekt' } },
    'Etape': { status: { name: mapping.etape === 'Pressenti' ? 'Pressenti' : 'Contacté' } },
    'Etat': { select: { name: mapping.etat } },
  };
  if (profileUrl) {
    candidatProps['URL Linkedin'] = { url: profileUrl };
    candidatProps['Lien source'] = { url: profileUrl };
  }
  if (profileHeadline) {
    candidatProps['Titre du poste'] = { rich_text: [{ text: { content: profileHeadline } }] };
  }
  if (jobId) {
    candidatProps['💼 Postes'] = { relation: [{ id: jobId }] };
  }

  const candidateId = await createNotionPageSeq(CANDIDATS_DATABASE_ID, candidatProps);
  if (!candidateId) {
    console.error('[notion-sync] Failed to create candidate in Notion');
    return null;
  }
  console.log(`[notion-sync] Created candidate in Notion: ${profileName} → ${candidateId}`);

  // Create Shortlist
  const shortlistTitle = jobTitle ? `${profileName} X ${jobTitle}` : profileName;
  const shortlistProps: Record<string, unknown> = {
    'Nom': { title: [{ text: { content: shortlistTitle } }] },
    'Candidats': { relation: [{ id: candidateId }] },
    'Etape': { select: { name: mapping.etape } },
    'Entité': { select: { name: 'Konekt' } },
  };
  if (jobId) {
    shortlistProps['💼 Postes'] = { relation: [{ id: jobId }] };
  }

  const shortlistId = await createNotionPageSeq(SHORTLIST_DATABASE_ID_SEQ, shortlistProps);
  console.log(`[notion-sync] Created shortlist in Notion: ${shortlistTitle} → ${shortlistId}`);

  return candidateId;
}

async function syncNotionStageAfterAction(actionType: string, enrollment: Record<string, unknown>) {
  const mapping = ACTION_TO_NOTION_STAGE[actionType];
  if (!mapping || !NOTION_API_KEY) return;
  
  try {
    const profileName = enrollment.profile_name as string;
    const profileUrl = enrollment.profile_url as string | undefined;
    
    let candidateId = await findCandidateInNotionSeq(profileName, profileUrl);
    
    if (!candidateId) {
      console.log(`[notion-sync] Candidate not found in Notion, creating: ${profileName}`);
      candidateId = await createCandidateAndShortlistInNotion(enrollment, mapping);
      if (!candidateId) return;
      // Already created with correct etape/etat, done
      return;
    }

    // Update Candidat "Etat"
    await updateNotionPageSeq(candidateId, { 'Etat': { select: { name: mapping.etat } } });
    
    // Update all Shortlist "Etape"
    const shortlistIds = await findShortlistsForCandidateSeq(candidateId);
    if (shortlistIds.length === 0 && (enrollment.job_id || enrollment.job_title)) {
      // Candidate exists but no shortlist — create one
      const jobId = enrollment.job_id as string | undefined;
      const jobTitle = enrollment.job_title as string | undefined;
      const shortlistTitle = jobTitle ? `${profileName} X ${jobTitle}` : profileName;
      const shortlistProps: Record<string, unknown> = {
        'Nom': { title: [{ text: { content: shortlistTitle } }] },
        'Candidats': { relation: [{ id: candidateId }] },
        'Etape': { select: { name: mapping.etape } },
        'Entité': { select: { name: 'Konekt' } },
      };
      if (jobId) {
        shortlistProps['💼 Postes'] = { relation: [{ id: jobId }] };
      }
      const slId = await createNotionPageSeq(SHORTLIST_DATABASE_ID_SEQ, shortlistProps);
      console.log(`[notion-sync] Created missing shortlist: ${shortlistTitle} → ${slId}`);
    } else {
      for (const slId of shortlistIds) {
        await updateNotionPageSeq(slId, { 'Etape': { select: { name: mapping.etape } } });
      }
    }
    
    console.log(`[notion-sync] ${profileName}: Etat→"${mapping.etat}", Etape→"${mapping.etape}" (${shortlistIds.length} shortlists)`);
  } catch (err) {
    console.error('[notion-sync] Error:', err instanceof Error ? err.message : err);
  }
}

// ============ NOTION HELPERS ============

function extractNotionText(prop: unknown): string {
  if (!prop || typeof prop !== 'object') return '';
  const p = prop as Record<string, unknown>;
  if (p.type === 'title' || p.type === 'rich_text') {
    const arr = (p[p.type as string] || []) as Array<{ plain_text?: string }>;
    return arr.map(t => t.plain_text || '').join('');
  }
  if (p.type === 'select' && p.select && typeof p.select === 'object') {
    return (p.select as Record<string, unknown>).name as string || '';
  }
  if (p.type === 'multi_select' && Array.isArray(p.multi_select)) {
    return (p.multi_select as Array<{ name: string }>).map(s => s.name).join(', ');
  }
  if (p.type === 'number') return p.number != null ? String(p.number) : '';
  if (p.type === 'relation' && Array.isArray(p.relation)) {
    // Store relation IDs as comma-separated for later resolution
    return (p.relation as Array<{ id: string }>).map(r => r.id).filter(Boolean).join(',');
  }
  if (p.type === 'rollup' && p.rollup && typeof p.rollup === 'object') {
    const rollup = p.rollup as Record<string, unknown>;
    if (rollup.type === 'array' && Array.isArray(rollup.array)) {
      return (rollup.array as Array<Record<string, unknown>>).map(item => {
        if (item.type === 'title' || item.type === 'rich_text') {
          const arr = (item[item.type as string] || []) as Array<{ plain_text?: string }>;
          return arr.map(t => t.plain_text || '').join('');
        }
        return '';
      }).filter(Boolean).join(', ');
    }
  }
  return '';
}

// Resolve Notion relation IDs to page titles
async function resolveNotionRelations(data: Record<string, string>, keys: string[]): Promise<void> {
  if (!NOTION_API_KEY) return;
  for (const key of keys) {
    const val = data[key];
    if (!val || !val.match(/^[a-f0-9-]{36}(,[a-f0-9-]{36})*$/i)) continue;
    const ids = val.split(',');
    const titles: string[] = [];
    for (const id of ids.slice(0, 3)) {
      try {
        const res = await fetchWithTimeout(`https://api.notion.com/v1/pages/${id}`, {
          headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
        });
        if (res.ok) {
          const page = await res.json();
          const props = (page.properties || {}) as Record<string, unknown>;
          for (const prop of Object.values(props)) {
            const p = prop as Record<string, unknown>;
            if (p.type === 'title') {
              const arr = (p.title || []) as Array<{ plain_text?: string }>;
              const title = arr.map(t => t.plain_text || '').join('');
              if (title) { titles.push(title); break; }
            }
          }
        }
      } catch { /* ignore */ }
    }
    if (titles.length > 0) {
      data[key] = titles.join(', ');
    } else {
      // Resolution failed — clear the raw UUID so it doesn't leak into messages
      delete data[key];
    }
  }
}

function extractNotionJob(pageData: Record<string, unknown>): Record<string, string> {
  const props = (pageData.properties || {}) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(props)) {
    const text = extractNotionText(val);
    if (text) result[key] = text;
  }
  return result;
}

// ============ POSTS FETCHER ============

async function fetchRecentPostsForSequence(
  accountId: string, profileId: string, maxPosts = 3, maxAgeDays = 90
): Promise<{ text: string; date: string; reactions?: number }[]> {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY) return [];
  try {
    const url = `${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(profileId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=5`;
    const response = await fetchWithTimeout(url, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    const items = data?.items || data?.data || (Array.isArray(data) ? data : []);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const posts: { text: string; date: string; reactions?: number }[] = [];
    for (const post of items) {
      const text = post.text || post.body || post.content || '';
      if (!text || text.length < 20) continue;
      const postDate = post.created_at || post.date || post.timestamp || '';
      if (postDate && new Date(postDate) < cutoff) continue;
      posts.push({
        text: text.slice(0, 500),
        date: postDate ? new Date(postDate).toLocaleDateString('fr-FR') : 'récent',
        reactions: post.reactions_count || post.likes_count || post.num_likes || undefined,
      });
      if (posts.length >= maxPosts) break;
    }
    return posts;
  } catch { return []; }
}

// ============ GUARDRAILS ============

function detectSequenceViolations(isRPO: boolean, message: string, subject?: string): string[] {
  const v: string[] = [];
  const text = `${subject || ''}\n${message || ''}`;
  if (/^\s*[-•]\s+/m.test(message)) v.push('tiret / puce en début de ligne');
  if (/[–—]/.test(message) || /\s-\s/.test(message)) v.push('tiret dans le texte');
  if (/\b(colle|match)e\s+parfaitement\b/i.test(text)) v.push('"colle parfaitement"');
  // Salary/compensation leak
  if (/\b(\d{2,3}\s*k€?|\d{2,3}\s*000\s*€|salaire|rémunération|package|compensation)\b/i.test(text)) v.push('mention de salaire/rémunération');
  // Signature must NOT be "Recruteur"
  if (/\bRecruteur\b/i.test(message)) v.push('signature "Recruteur" interdite — utiliser le prénom');
  // CTA: no call/rdv/dispo
  if (/\b(dispo(nible)?|call|rdv|rendez.vous|échange téléphonique|en discuter de vive voix)\b/i.test(text)) v.push('CTA engageant interdit (call/rdv/dispo)');
  // Only block aggressive closing tones
  if (/derni[èe]re\s+tentative/i.test(text)) v.push('"dernière tentative" interdit — ton agressif');
  if (/je\s+ne\s+veux\s+pas\s+(insister|m'incruster|être\s+lourd)/i.test(text)) v.push('"je ne veux pas insister" interdit — culpabilisant');
  if (/la\s+porte\s+(reste|est)\s+ouverte/i.test(text)) v.push('"la porte reste ouverte" interdit — cliché de clôture');
  if (isRPO) {
    if (/\bje\s+recrute\b/i.test(text)) v.push('RPO: "je recrute"');
    if (/\bj['']accompagne\b/i.test(text)) v.push('RPO: "j\'accompagne"');
    if (/\bils\b/i.test(text)) v.push('RPO: "ils"');
    if (/\bleur(s)?\b/i.test(text)) v.push('RPO: "leur"');
    if (/\bmon\s+client\b/i.test(text)) v.push('RPO: "mon client"');
  }
  return v;
}

function sanitizeSequenceMessage(message: string): string {
  return (message || '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s[–—]\s/g, '. ')
    .replace(/\s-\s/g, '. ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// ============ MESSAGE GENERATION ============

// deno-lint-ignore no-explicit-any
async function generatePersonalizedMessage(supabase: any, enrollment: Record<string, unknown>, step: Record<string, unknown>, _exec: Record<string, unknown>): Promise<{ message: string; subject?: string } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    // Fetch profile and posts in parallel
    const profilePromise = fetchWithTimeout(`${UNIPILE_DSN}/api/v1/users/${enrollment.profile_id}?account_id=${enrollment.account_id}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }).then(r => r.ok ? r.json() : null).catch(() => null);
    const postsPromise = fetchRecentPostsForSequence(enrollment.account_id as string, enrollment.profile_id as string);

    // Fetch job context from sourcing_projects.job_details (universal, not tied to any specific ATS)
    // Falls back to Notion API if job_details is empty and NOTION_API_KEY is configured (legacy)
    let jobNotionData: Record<string, string> = {};
    let jobBodyContent = '';
    let jobAccompagnement: string[] = [];
    let calendlyLink = '';

    if (enrollment.job_id) {
      try {
        // Primary: load from sourcing_projects (works with any ATS integration)
        const { data: project } = await supabase
          .from('sourcing_projects')
          .select('job_details, calendly_link, name')
          .or(`id.eq.${enrollment.job_id},job_id.eq.${enrollment.job_id}`)
          .limit(1)
          .maybeSingle();

        const jd = project?.job_details as Record<string, unknown> | null;

        if (jd) {
          // Map JobDetails fields to the format used by the prompt builder
          const client = jd.client as Record<string, unknown> | undefined;
          jobNotionData = {
            'Poste': (jd.title as string) || project?.name || '',
            'Client': client?.name as string || '',
            'Entreprise': client?.name as string || '',
            'Secteur': client?.sector as string || '',
            'Compétences': [...(jd.skills_must_have as string[] || []), ...(jd.skills_should_have as string[] || [])].join(', '),
            'Must-have': (jd.skills_must_have as string[] || []).join(', '),
            'Should-have': (jd.skills_should_have as string[] || []).join(', '),
            'Séniorité': jd.seniority as string || '',
            'XP Min': jd.experience_min != null ? String(jd.experience_min) : '',
            'XP Max': jd.experience_max != null ? String(jd.experience_max) : '',
            'Localisation': jd.location as string || '',
            'Remote': jd.remote_policy as string || '',
            'Type de contrat': jd.contract_type as string || '',
            'Description': jd.mission_description as string || '',
          };
          jobBodyContent = (jd.context as string || '').slice(0, 800);
          // Culture notes as additional context
          if (client?.culture_notes) jobBodyContent += '\n' + (client.culture_notes as string).slice(0, 400);

          console.log(`[generatePersonalizedMessage] Job context from sourcing_projects.job_details: "${jobNotionData['Poste']}" @ "${jobNotionData['Client']}"`);
        }

        // Calendly link
        if (project?.calendly_link) {
          const baseCalendly = project.calendly_link;
          const profileUrl = enrollment.profile_url as string | undefined;
          const profileName = enrollment.profile_name as string | undefined;
          const params = new URLSearchParams();
          if (profileUrl) params.set('a1', profileUrl);
          if (profileName) {
            const parts = profileName.trim().split(/\s+/);
            if (parts.length >= 2) { params.set('first_name', parts[0]); params.set('last_name', parts.slice(1).join(' ')); }
            else if (parts.length === 1) params.set('first_name', parts[0]);
          }
          calendlyLink = params.toString()
            ? `${baseCalendly}${baseCalendly.includes('?') ? '&' : '?'}${params.toString()}`
            : baseCalendly;
        }

        // Legacy fallback: if job_details is empty, try Notion API (for existing users with Notion integration)
        if (!jd && NOTION_API_KEY) {
          try {
            const [pageRes, blocksRes] = await Promise.all([
              fetchWithTimeout(`https://api.notion.com/v1/pages/${enrollment.job_id}`, { headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' } }),
              fetchWithTimeout(`https://api.notion.com/v1/blocks/${enrollment.job_id}/children?page_size=50`, { headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' } }),
            ]);
            if (pageRes.ok) {
              jobNotionData = extractNotionJob(await pageRes.json());
              await resolveNotionRelations(jobNotionData, ['Client', 'Entreprise', 'Company', 'Société']);
            }
            if (blocksRes.ok) {
              const blocks = ((await blocksRes.json()).results || []) as any[];
              // deno-lint-ignore no-explicit-any
              jobBodyContent = blocks.map((b: any) => { const rt = b[b.type]?.rich_text || b[b.type]?.text; return Array.isArray(rt) ? rt.map((t: any) => t.plain_text || '').join('') : ''; }).filter(Boolean).join('\n').slice(0, 800);
            }
            const accomp = jobNotionData['Accompagnement'] || jobNotionData['Type accompagnement'] || '';
            if (accomp) jobAccompagnement = accomp.split(',').map(s => s.trim()).filter(Boolean);
            console.log(`[generatePersonalizedMessage] Legacy fallback: Notion job data loaded`);
          } catch { /* Notion unavailable, continue without */ }
        }
      } catch { /* ignore */ }
    }

    // RAG context — the Knowledge Lake abstracts all data sources (ATS, CRM, notes, etc.)
    // This replaces the need for hardcoded Airtable queries — any ingested data is available via RAG
    const orgId = enrollment.organization_id as string || '';
    const ragJobTitle = jobNotionData?.['Poste'] || jobNotionData?.['Titre'] || enrollment.job_title as string || '';
    const ragJobSkills = jobNotionData?.['Compétences'] || jobNotionData?.['Skills'] || '';
    // deno-lint-ignore no-explicit-any
    const ragPromise: Promise<any> = orgId
      ? fetchRAGContext(orgId, enrollment.profile_id as string, `${ragJobTitle} ${ragJobSkills}`)
      : Promise.resolve(null);

    // Candidate history: use RAG Knowledge Lake (universal) instead of hardcoded Airtable tables
    // The Knowledge Lake ingests data from any connected source (Airtable, ATS, CRM, etc.)
    // via auto-ingest-context, so all candidate history is available through retrieve-context
    // deno-lint-ignore no-explicit-any
    const historyPromise: Promise<any> = orgId
      ? fetchRAGContext(orgId, enrollment.profile_id as string, `historique interactions recrutement shortlist placement notes ${enrollment.profile_name || ''}`)
      : Promise.resolve(null);

    // deno-lint-ignore no-explicit-any
    let [profile, recentPosts, candidateHistory, ragContext] = await Promise.all([profilePromise, postsPromise, historyPromise, ragPromise]);

    // Fallback: if Unipile didn't return experiences, try to get them from the DB snapshot
    const hasExperiences = Array.isArray(profile?.work_experience || profile?.experiences || profile?.positions?.values) && (profile?.work_experience || profile?.experiences || profile?.positions?.values).length > 0;
    if (!hasExperiences) {
      try {
        const { data: jcs } = await supabase
          .from('job_candidate_status')
          .select('linkedin_profile_data')
          .eq('candidate_id', enrollment.profile_id as string)
          .not('linkedin_profile_data', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1);
        
        const snapshot = jcs?.[0]?.linkedin_profile_data;
        if (snapshot && typeof snapshot === 'object') {
          // Merge snapshot data into profile, preserving any Unipile identity data
          const snapshotExperiences = snapshot.work_experience || snapshot.experiences || snapshot.positions?.values || [];
          const snapshotEducation = snapshot.education || [];
          const snapshotSkills = snapshot.skills || [];
          const snapshotLanguages = snapshot.languages || [];
          const snapshotAbout = snapshot.about || snapshot.summary || '';
          
          if (Array.isArray(snapshotExperiences) && snapshotExperiences.length > 0) {
            profile = { ...(profile || {}), experiences: snapshotExperiences };
            console.log(`[generatePersonalizedMessage] Fallback: loaded ${snapshotExperiences.length} experiences from DB snapshot`);
          }
          if (Array.isArray(snapshotEducation) && snapshotEducation.length > 0 && !profile?.education?.length) {
            profile = { ...(profile || {}), education: snapshotEducation };
          }
          if (Array.isArray(snapshotSkills) && snapshotSkills.length > 0 && !profile?.skills?.length) {
            profile = { ...(profile || {}), skills: snapshotSkills };
          }
          if (snapshotAbout && !profile?.about && !profile?.summary) {
            profile = { ...(profile || {}), about: snapshotAbout };
          }
        }
      } catch (e) {
        console.warn('[generatePersonalizedMessage] DB snapshot fallback error:', e);
      }
    }

    const { data: prevSteps } = await supabase.from('sequence_step_executions').select('*, step:sequence_steps(*)').eq('enrollment_id', enrollment.id).eq('status', 'sent').order('step_order');
    // deno-lint-ignore no-explicit-any
    const hadInvite = prevSteps?.some((ps: any) => ps.step?.action_type === 'connection_request');
    // deno-lint-ignore no-explicit-any
    const prevMessages = prevSteps?.filter((ps: any) => ['message', 'inmail', 'smart_message', 'email', 'whatsapp_message'].includes(ps.step?.action_type)) || [];
    const hadMsg = prevMessages.length > 0;
    const isInvite = step.action_type === 'connection_request';
    const isInMail = step.action_type === 'inmail' || step.action_type === 'smart_message';
    
    // deno-lint-ignore no-explicit-any
    const prevInMails = prevMessages.filter((ps: any) => ['inmail', 'smart_message'].includes(ps.step?.action_type));
    // deno-lint-ignore no-explicit-any
    const prevDirectMsgs = prevMessages.filter((ps: any) => ps.step?.action_type === 'message');
    
    // Determine precise message type
    let msgType: string;
    let toneInstructions: string;
    
    if (isInvite) {
      msgType = 'INVITATION';
      toneInstructions = 'Note d\'invitation courte. MAX 50 caractères.';
    } else if (isInMail) {
      if (prevInMails.length === 0) {
        msgType = 'INMAIL INITIAL';
        toneInstructions = `TON FORMEL ET DIRECT. C'est un InMail (le candidat n'est pas connecté).
- Objet obligatoire, < 40 caractères, mobile-first
- Proposition de valeur claire et concise
- CTA non-engageant: demande d'avis, PAS de proposition de call/rdv
- 200-400 caractères pour le corps`;
      } else {
        msgType = 'INMAIL DE RELANCE';
        toneInstructions = `C'est une RELANCE. Le candidat a déjà reçu un premier InMail.
- Tu PEUX et DOIS faire référence au fait que tu as déjà contacté le candidat (ex: "Suite à mon précédent message", "Je reviens vers toi", "Je me permets de te relancer")
- Propose un angle complémentaire ou renforce le pitch initial
- Objet < 40 caractères, peut référencer le premier message
- Ton un peu plus direct/familier que le premier InMail
- 200-400 caractères pour le corps`;
      }
    } else {
      if (!hadMsg && !hadInvite) {
        msgType = 'PREMIER MESSAGE';
        toneInstructions = `PREMIER CONTACT. Accroche personnalisée + pitch concis + CTA non-engageant.
- Cherche un hook dans les posts LinkedIn récents ou le "À propos"
- 200-400 caractères`;
      } else if (!hadMsg && hadInvite) {
        msgType = 'SUITE INVITATION';
        toneInstructions = `PREMIER MESSAGE après acceptation de connexion.
- Bref remerciement (1 phrase) puis pitch direct
- NE DIS PAS "je reviens vers vous"
- 200-400 caractères`;
      } else if (prevDirectMsgs.length === 1) {
        msgType = 'RELANCE 1';
        toneInstructions = `PREMIÈRE RELANCE. Tu PEUX référencer ton précédent message.
- Apporte un angle complémentaire ou renforce le pitch
- Ton plus direct, familier
- 200-350 caractères`;
      } else {
        msgType = 'RELANCE 2';
        toneInstructions = `DEUXIÈME RELANCE. Tu PEUX référencer tes précédents messages.
- Ton direct, un peu plus insistant mais jamais agressif
- Propose un dernier angle ou un CTA concret (appel, café, etc.)
- 200-350 caractères`;
      }
    }

    // Build previous messages context
    // deno-lint-ignore no-explicit-any
    const prevMsgContext = prevMessages.length > 0 ? prevMessages.map((ps: any, i: number) => 
      `MESSAGE ${i + 1} (${ps.step?.action_type}): "${(ps.final_message || '').slice(0, 200)}"`
    ).join('\n') : '';

    // Get sender name
    let senderName = 'Recruteur';
    try {
      const { data: senderProfile } = await supabase.from('profiles').select('display_name').eq('user_id', enrollment.created_by).maybeSingle();
      if (senderProfile?.display_name) senderName = senderProfile.display_name;
    } catch { /* ignore */ }

    // Determine RPO vs Succès
    const isRPO = jobAccompagnement.some(a => a.toLowerCase().includes('rpo') || a.toLowerCase().includes('embedded') || a.toLowerCase().includes('intégré'));
    const clientName = jobNotionData['Client'] || jobNotionData['Entreprise'] || enrollment.job_title as string || 'nous';

    const engagementBlock = isRPO
      ? `=== MODE RPO (TU ES INTÉGRÉ CHEZ ${clientName.toUpperCase()}) ===
Tu travailles CHEZ ${clientName}. Tu n'es PAS un cabinet externe. Tu es un recruteur interne.
- TOUJOURS: "on", "nous", "notre équipe", "chez ${clientName}" ou "chez nous"
- JAMAIS: "ils", "leur", "mon client", "je recrute pour", "j'accompagne"
- Tu parles comme si tu étais SALARIÉ de ${clientName}
- Exemples: "On cherche", "Notre équipe Data", "Chez nous", "Chez ${clientName}"`
      : `=== MODE SUCCÈS (CABINET EXTERNE) ===
Tu parles EN TANT QUE recruteur externe indépendant.
- Utilise "je", "j'accompagne", "chez ${clientName}", "leur équipe"
- Tu peux valoriser ta connaissance du client`;

    // Build posts section
    const postsSection = recentPosts.length > 0
      ? `\nPUBLICATIONS LINKEDIN RÉCENTES:\n${recentPosts.map((p: any, i: number) => `POST ${i + 1} (${p.date}): "${p.text}"`).join('\n')}\n→ Utilise un post comme accroche SI pertinent par rapport au poste.`
      : '';

    // Build rich job context
    const jobTitle = jobNotionData['Poste'] || jobNotionData['Titre'] || enrollment.job_title || 'Tech role';
    const jobSkills = jobNotionData['Compétences'] || jobNotionData['Skills'] || '';
    const jobLocation = jobNotionData['Localisation'] || jobNotionData['Lieu'] || '';
    const jobRemote = jobNotionData['Remote'] || jobNotionData['Télétravail'] || '';
    const jobDescription = jobNotionData['Description'] || '';
    const jobMustHave = jobNotionData['Must-have'] || jobNotionData['Must Have'] || '';
    const jobShouldHave = jobNotionData['Should-have'] || jobNotionData['Should Have'] || '';
    const jobSeniority = jobNotionData['Séniorité'] || jobNotionData['Seniority'] || '';
    const jobXpMin = jobNotionData['XP Min'] || jobNotionData['Expérience min'] || '';
    const jobXpMax = jobNotionData['XP Max'] || jobNotionData['Expérience max'] || '';
    const jobContractType = jobNotionData['Type de contrat'] || jobNotionData['Contract Type'] || '';
    const jobSector = jobNotionData['Secteur'] || jobNotionData['Sector'] || '';

    const jobContextBlock = `POSTE À POURVOIR:
- Titre: ${jobTitle}
- Client: ${clientName}${jobSector ? ` (${jobSector})` : ''}
- Accompagnement: ${jobAccompagnement.join(', ') || 'Non spécifié'} ${isRPO ? '(MODE RPO)' : '(MODE SUCCÈS)'}
${jobSkills ? `- Compétences requises: ${jobSkills}` : ''}
${jobSeniority ? `- Séniorité: ${jobSeniority}` : ''}${jobXpMin || jobXpMax ? ` | XP: ${jobXpMin || '?'}-${jobXpMax || '?'} ans` : ''}
${jobLocation ? `- Localisation: ${jobLocation}` : ''}
${jobRemote ? `- Télétravail: ${jobRemote}` : ''}
${jobContractType ? `- Type contrat: ${jobContractType}` : ''}
${jobMustHave ? `- Must-have: ${jobMustHave}` : ''}
${jobShouldHave ? `- Should-have: ${jobShouldHave}` : ''}
${jobDescription ? `- Contexte mission: ${jobDescription.slice(0, 300)}` : ''}
${jobBodyContent ? `- Détails poste:\n${jobBodyContent.slice(0, 400)}` : ''}`;

    // Build profile context
    const profileExperiences = profile?.work_experience || profile?.experiences || profile?.positions?.values || [];
    // deno-lint-ignore no-explicit-any
    const expContext = Array.isArray(profileExperiences) ? profileExperiences.slice(0, 3).map((e: any) => {
      const title = e.title || e.role || '';
      const company = e.company_name || e.company || '';
      const desc = e.description || '';
      return `  • ${title} @ ${company}${desc ? `: ${desc.slice(0, 120)}` : ''}`;
    }).join('\n') : '';

    // Extract skills from profile
    const profileSkills = (() => {
      if (!profile?.skills) return '';
      const skills = Array.isArray(profile.skills) 
        // deno-lint-ignore no-explicit-any
        ? profile.skills.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean)
        : [];
      return skills.slice(0, 15).join(', ');
    })();

    // Extract education from profile
    const profileEducation = (() => {
      const edu = profile?.education || [];
      if (!Array.isArray(edu) || edu.length === 0) return '';
      // deno-lint-ignore no-explicit-any
      return edu.slice(0, 2).map((e: any) => {
        const school = e.school_name || e.school || '';
        const degree = e.degree_name || e.degree || '';
        const field = e.field_of_study || e.field || '';
        return [school, degree, field].filter(Boolean).join(' - ');
      }).join('; ');
    })();

    // Calculate years of experience
    const profileYearsXP = (() => {
      if (!Array.isArray(profileExperiences) || profileExperiences.length === 0) return 0;
      let earliest = 9999;
      // deno-lint-ignore no-explicit-any
      for (const exp of profileExperiences as any[]) {
        const startDate = exp.start_date || exp.starts_at || exp.start;
        if (startDate) {
          const year = typeof startDate === 'object' && startDate?.year
            ? startDate.year
            : typeof startDate === 'string' 
              ? parseInt(startDate.split('-')[0]) 
              : 9999;
          if (year < earliest) earliest = year;
        }
      }
      return earliest < 9999 ? new Date().getFullYear() - earliest : 0;
    })();

    // Build candidate history section from RAG Knowledge Lake (universal — works with any ATS/CRM)
    const historySection = (() => {
      if (!candidateHistory || typeof candidateHistory !== 'string' || !candidateHistory.trim()) return '';
      return `
=== HISTORIQUE INTERNE AVEC CE CANDIDAT (via Knowledge Lake) ===
${candidateHistory.slice(0, 2000)}

UTILISATION DE L'HISTORIQUE:
- Ce candidat est DÉJÀ CONNU du cabinet.
- Mentionne l'historique QUE si pertinent et naturel. Ne cite JAMAIS les notes internes verbatim.
- Si l'historique mentionne un consultant qui est le sender actuel (${senderName}), utilise la première personne.
=== FIN HISTORIQUE ===`;
    })();

    const prompt = `Tu es un recruteur tech senior. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.
${engagementBlock}

PROFIL CANDIDAT:
- Prénom: ${(() => {
      const raw = profile?.first_name || profile?.name?.split(' ')[0] || '';
      return isLikelyRealFirstName(raw) ? raw : '(non fiable, ne pas utiliser)';
    })()}
- Titre: ${profile?.headline || 'N/A'}
${profile?.current_company_name ? `- Poste actuel: ${profile.headline?.split(' at ')[0] || profile.headline?.split(' chez ')[0] || ''} chez ${profile.current_company_name}` : ''}
${profileSkills ? `- Compétences: ${profileSkills}` : ''}
${profileYearsXP ? `- Années d'expérience: ~${profileYearsXP} ans` : ''}
${profileEducation ? `- Formation: ${profileEducation}` : ''}
${profile?.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE CLÉ DE PERSONNALISATION ET DE STYLE) ===
"${(profile.summary as string).slice(0, 800)}"
=== FIN À PROPOS ===

IMPORTANT - ANALYSE LE STYLE D'ÉCRITURE DU CANDIDAT:
- Observe comment il écrit: phrases courtes ou longues ? Formel ou décontracté ?
- Utilise-t-il des émojis, de l'humour, des expressions familières ?
- Son ton est-il corporate, startup, créatif, technique ?
- ADAPTE TON MESSAGE À SON STYLE pour créer une résonance naturelle` : ''}
${expContext ? `- Expériences récentes:\n${expContext}` : ''}
${ragContext ? `\n=== CONTEXTE CANDIDAT (RAG) ===\n${ragContext}\n=== FIN CONTEXTE RAG ===` : `${postsSection}\n${historySection}`}

${jobContextBlock}

TYPE DE MESSAGE: ${msgType}
${toneInstructions}

${prevMsgContext ? `MESSAGES PRÉCÉDENTS ENVOYÉS (pour varier l'angle et t'en inspirer pour ta relance):\n${prevMsgContext}` : ''}

=== POSTURE DU RECRUTEUR (CRITIQUE) ===
Tu es un CONNECTEUR, pas un expert technique.
Tu fais le PONT entre le candidat et l'environnement du poste.
=== FIN POSTURE ===

=== STRATÉGIE LINKEDIN 2025 – RÈGLES ABSOLUES ===

📊 STATS CLÉS QUI GUIDENT TA RÉDACTION:
- Les InMails personnalisés obtiennent +15% de taux de réponse vs envois en masse
- Les messages entre 200 et 400 CARACTÈRES ont +16% de chances de réponse
- 57% du trafic LinkedIn est mobile → sujet COURT obligatoire
- Mentionner un ancien employeur commun = +27% de réponse

1. PERSONNALISATION = FACTEUR N°1 (NON NÉGOCIABLE)
   Chaque message DOIT contenir au moins UN élément hyper-spécifique au candidat. Cherche dans cet ordre:
   a) PUBLICATIONS LINKEDIN RÉCENTES → "j'ai vu ton post sur [sujet]"
   a-bis) HISTORIQUE INTERNE → "on avait échangé pour [poste/client]"
   b) SECTION "À PROPOS" → passion technique, side project, motivation
      ⚠️ JAMAIS écrire "dans ton À propos", "tu mentionnes dans ton profil" → cite le contenu DIRECTEMENT
   c) PARCOURS PROFESSIONNEL → ancien employeur commun (+27% réponse), transition intéressante
   d) CONNEXIONS MUTUELLES → même école, même ex-employeur → warm intro
   ⚠️ SI rien de spécifique → utilise une QUESTION OUVERTE comme accroche

2. LONGUEUR = COURT (CRITIQUE)
   200-400 CARACTÈRES pour le corps du message (hors signature). 3-5 phrases MAX.
   Sur mobile (57% du trafic), un message court = entièrement visible sans scroller.

3. CE QUE LE CANDIDAT Y GAGNE, PAS UN DESCRIPTIF DE POSTE
   "Tu définirais l'archi toi-même" > "Nous cherchons un architecte"
   "Stack greenfield Go/K8s, pas de legacy" > "Stack: Go, Kubernetes"
   MAX 1-2 éléments différenciants, intégrés naturellement. Pas de liste.

4. CTA = SIMPLE ET NON-ENGAGEANT
   Exemples: "Ça te parlerait ?", "C'est un sujet pour toi ?", "T'aurais quelqu'un en tête ?"
   ❌ JAMAIS: proposer un call, un rdv, une dispo

5. FORMAT OBLIGATOIRE:
   SALUTATION: "Salut [Prénom]," UNIQUEMENT si le prénom est fiable. Si marqué "(non fiable, ne pas utiliser)", utilise "Salut," SANS prénom.
   PHRASE 1 = PERSONNALISATION PURE. Une observation spécifique, PAS un résumé de carrière.
   PHRASE 2-3 = Ce que le candidat y gagne
   PHRASE 4 = CTA non-engageant
   Signature: "${senderName}"
   IMPORTANT: \\n\\n entre les paragraphes. Jamais de bloc massif.

   ⛔ STRUCTURES D'ACCROCHE INTERDITES:
   - "Du [entreprise] au [entreprise]..." ❌
   - "Ton parcours de [X] à [Y]..." ❌
   - "Après [N] ans chez [entreprise]..." ❌

   ✅ BONNES ACCROCHES — factuel, jamais flatteur:
    - "Le DDD et l'ownership, c'est aussi ce qu'on pousse chez ${clientName}." (cite le contenu SANS mentionner "À propos")
    - "J'ai vu ton post sur [sujet], on part sur la même approche chez ${clientName}."
    - "Ton passage chez [entreprise] m'intrigue, comment tu gérais [problème spécifique] ?"

6. ADAPTATION AU STYLE DU CANDIDAT:
   - SI décontracté avec émojis → sois plus casual
   - SI corporate/formel → reste pro mais pas froid
   - SI humour → ose une touche légère
   Le but: un message de PAIR, pas de robot.

7. INTERDITS (MARQUEURS IA À BANNIR):
   - "j'ai parcouru ton profil", "a retenu mon attention", "m'a tapé dans l'œil"
   - "dans ton À propos", "tu mentionnes dans ton profil", "dans ta bio" → CITE LE CONTENU DIRECTEMENT
   - Superlatifs: exceptionnel, remarquable, impressionnant, brillant, solide parcours
   - "parfaitement", "exactement" → trop vendeur
   - FORMAT: JAMAIS "20+", "10+" → "plus de 20", "plus de 10"
   - TIRETS: JAMAIS de "- ..." ni "A – B" → phrases avec points/virgules
   - LISTES À PUCES: JAMAIS, écris en prose fluide
   - LIENS: JAMAIS de liens dans le message (sauf Calendly si applicable)
   - JARGON: "ton taf", "mise gros", "c'est chaud", "le kiff"
   - FORMULES CREUSES: "projet passionnant", "belle aventure", "super équipe"
   - "ton profil colle parfaitement" ❌ → "ça matche" ou "ton profil colle bien"
   ⛔ FLATTERIE = INTERDIT (ça sonne fake et IA):
   - "c'est rare et c'est ce qu'il nous faut" ❌
   - "ça montre que tu aimes creuser" ❌
   - "ton expertise en [X] est précieuse" ❌
   → Tu OBSERVES ou tu POSES UNE QUESTION, tu ne fais PAS de compliment.

   EN MODE RPO - ABSOLUMENT INTERDIT:
   - "je recrute pour eux" ❌ → "on cherche"
   - "ce qu'ils cherchent" ❌ → "ce qu'on recherche"
   - "leur équipe" ❌ → "notre équipe"

RÈGLES ABSOLUES:
- JAMAIS mentionner le salaire, la rémunération, le TJM, le package ou tout montant en €
- Sauts de ligne entre les paragraphes (\\n\\n)
- Signe TOUJOURS avec ton prénom "${senderName}" (jamais "Recruteur", jamais de titre)
${calendlyLink ? `
=== LIEN CALENDLY DISPONIBLE ===
Lien de prise de RDV: ${calendlyLink}
RÈGLES D'UTILISATION:
- Tu peux proposer ce lien comme CTA UNIQUEMENT quand le message vise à proposer un échange/call
- Intègre-le naturellement: "Si ça te parle, tu peux bloquer un créneau ici: ${calendlyLink}"
- NE L'UTILISE PAS pour les messages de qualification ou de relance avec question ouverte
- Pour les INMAILS INITIAUX et PREMIERS MESSAGES: ne mets PAS le lien (trop tôt)
- Pour les RELANCES et messages POST-CONNEXION: tu peux l'utiliser si le CTA propose un échange
=== FIN CALENDLY ===` : ''}

Réponds UNIQUEMENT en JSON valide: {"subject": "objet si InMail, sinon vide", "message": "le message complet"}`;

    // Resolve AI model from org settings (respects user's model choice in Settings)
    const seqOrgId = (enrollment.organization_id || '') as string;
    let resolvedModelId = 'claude-sonnet-4-6'; // fallback
    let resolvedAnthropicModel = 'claude-sonnet-4-6';
    try {
      const { getModel: getModelFn, getAnthropicModelId: getAnthropicModelIdFn } = await import('../_shared/ai-config.ts');
      let orgModelDefault: string | null = null;
      if (seqOrgId) {
        const { data: orgRow } = await supabase.from('organizations').select('ai_model_default').eq('id', seqOrgId).maybeSingle();
        orgModelDefault = orgRow?.ai_model_default || null;
      }
      resolvedModelId = getModelFn('default', null, orgModelDefault);
      resolvedAnthropicModel = getAnthropicModelIdFn(resolvedModelId);
    } catch (modelErr) {
      console.warn('[generatePersonalizedMessage] Model resolution failed, using default:', modelErr);
    }

    // Token tracking for credit settlement
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    const callAI = async (userPrompt: string) => {
      try {
        const { callAnthropicWithRetry: callWithRetry } = await import('../_shared/ai-config.ts');
        const result = await callWithRetry(ANTHROPIC_API_KEY!, {
          model: resolvedAnthropicModel,
          max_tokens: 500,
          system: [{ type: 'text', text: 'Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.', cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userPrompt }],
        });
        // Track tokens
        totalTokensIn += result.usage?.input_tokens || 0;
        totalTokensOut += result.usage?.output_tokens || 0;
        // deno-lint-ignore no-explicit-any
        const textContent = (result as any).content?.find((c: any) => c.type === 'text')?.text || '';
        return textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } catch (aiErr) {
        console.error('[generatePersonalizedMessage] AI call failed:', aiErr);
        return null;
      }
    };

    const firstContent = await callAI(prompt);
    if (!firstContent) return null;

    const jsonMatch = firstContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed = JSON.parse(jsonMatch[0]);
    
    // Guardrails: detect violations and retry once if needed
    const violations = detectSequenceViolations(isRPO, parsed.message || '', parsed.subject);
    if (violations.length > 0) {
      console.warn(`[generatePersonalizedMessage] Violations detected, retrying:`, violations);
      const correctionPrompt = `${prompt}\n\n=== CORRECTION STRICTE ===\nLe draft viole ces règles: ${violations.join(' ; ')}.\n${isRPO ? `En MODE RPO: jamais "ils", "leur", "mon client", "j'accompagne". Toujours "on", "nous", "chez ${clientName}".` : ''}\nJAMAIS mentionner le salaire ou la rémunération.\nAucun tiret nulle part. MAX 400 caractères.\n\nDRAFT: ${JSON.stringify(parsed)}\n\nRéponds en JSON valide: {"subject": "...", "message": "..."}`;
      const retryContent = await callAI(correctionPrompt);
      if (retryContent) {
        const retryMatch = retryContent.match(/\{[\s\S]*\}/);
        if (retryMatch) {
          try { parsed = JSON.parse(retryMatch[0]); } catch { /* keep original */ }
        }
      }
    }

    // Sanitize output
    parsed.message = sanitizeSequenceMessage(parsed.message || '');
    
    // Force-replace "Recruteur" signature with actual sender name
    parsed.message = parsed.message.replace(/\bRecruteur\b/gi, senderName);
    
    // Ensure message ends with sender name if not already present
    const lines = parsed.message.trim().split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine.toLowerCase() !== senderName.toLowerCase() && !lastLine.toLowerCase().includes(senderName.toLowerCase())) {
      parsed.message = parsed.message.trim() + '\n\n' + senderName;
    }
    
    console.log(`[generatePersonalizedMessage] Type: ${msgType}, Length: ${parsed.message.length} chars, RPO: ${isRPO}, Sender: ${senderName}, Model: ${resolvedModelId}, Tokens: ${totalTokensIn}in+${totalTokensOut}out`);

    // Settle AI credits (fire-and-forget — never blocks the message)
    if (seqOrgId && (totalTokensIn + totalTokensOut) > 0) {
      try {
        const { settleCredits: settle } = await import('../_shared/settle-credits.ts');
        settle(supabase, {
          organizationId: seqOrgId,
          userId: (enrollment.created_by || '') as string,
          aiAction: 'outreach_message',
          modelId: resolvedModelId,
          tokensInput: totalTokensIn,
          tokensOutput: totalTokensOut,
          description: `Sequence AI (${msgType} — ${step.action_type})`,
        }).catch(e => console.warn('[generatePersonalizedMessage] settle error:', e));
      } catch { /* settle-credits import failed — non-blocking */ }
    }

    return { message: parsed.message, subject: parsed.subject };
  } catch (e) { console.error('AI personalization error:', e); return null; }
}
