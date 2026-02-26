import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

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

console.log('[process-sequences] Config:', { hasDSN: !!UNIPILE_DSN, hasApiKey: !!UNIPILE_API_KEY });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
// Action-type-specific delays (ms) to simulate natural human behavior
function getActionDelay(actionType: string): number {
  switch (actionType) {
    case 'profile_visit':
    case 'check_connection':
      return 2000 + Math.random() * 3000;    // 2-5s — passive actions (no API write)
    case 'connection_request':
      return 10000 + Math.random() * 10000;  // 10-20s
    case 'message':
      return 8000 + Math.random() * 7000;    // 8-15s
    case 'inmail':
    case 'smart_message':
      return 15000 + Math.random() * 15000;  // 15-30s
    default:
      return 3000 + Math.random() * 5000;    // 3-8s default
  }
}

const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — consider stale after this

async function acquireLock(supabase: any, runId: string): Promise<boolean> {
  // Atomic lock acquisition: only update if lock is free (null) or stale (> LOCK_TIMEOUT_MS)
  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  
  const { data, error } = await supabase
    .from('sequence_processing_lock')
    .update({ locked_at: new Date().toISOString(), locked_by: runId })
    .eq('id', 'process')
    .or(`locked_at.is.null,locked_at.lt.${staleThreshold}`)
    .select()
    .maybeSingle();

  if (error || !data) {
    console.log(`[process] Lock held by another instance, skipping (runId=${runId})`);
    return false;
  }

  console.log(`[process] Lock acquired (runId=${runId})`);
  return true;
}

async function releaseLock(supabase: any) {
  await supabase
    .from('sequence_processing_lock')
    .update({ locked_at: null, locked_by: null })
    .eq('id', 'process');
}

async function handleProcess(supabase: any, force = false) {
  const runId = crypto.randomUUID().slice(0, 8);

  // Global lock: prevent concurrent cron executions
  if (!await acquireLock(supabase, runId)) {
    return new Response(JSON.stringify({ success: true, skipped_reason: 'lock_held' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const now = new Date().toISOString();
    
    const { data: executions, error: fetchError } = await supabase
      .from('sequence_step_executions')
      .select(`*, enrollment:sequence_enrollments(*, sequence:outreach_sequences(*)), step:sequence_steps(*)`)
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .limit(15);

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

    for (const exec of dedupedExecutions) {
      try {
        const enrollment = exec.enrollment;
        const step = exec.step;
        
        if (!enrollment || enrollment.status !== 'active') {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: 'Enrollment inactive' }).eq('id', exec.id);
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

        const conditionResult = await checkStepCondition(step.condition_type, enrollment.account_id, enrollment.profile_id, step.wait_for_event, enrollment.profile_url);
        if (conditionResult === 'wait') {
          await supabase.from('sequence_step_executions').update({ status: 'waiting_event' }).eq('id', exec.id);
          results.skipped++;
          continue;
        }
        if (!conditionResult) {
          await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: `Condition: ${step.condition_type}`, executed_at: now }).eq('id', exec.id);
          results.skipped++;
          await scheduleNextStep(supabase, enrollment, step.step_order);
          continue;
        }

        const { data: lockResult, error: lockError } = await supabase
          .from('sequence_step_executions').update({ status: 'sending' }).eq('id', exec.id).eq('status', 'scheduled').select().single();

        if (lockError || !lockResult) { results.skipped++; continue; }

        let finalMessage = (exec.final_message || step.message_template || '') as string;
        let finalSubject = (step.subject_template || '') as string;
        
        if (step.use_ai_personalization && needsMessage(step.action_type)) {
          const personalized = await generatePersonalizedMessage(supabase, enrollment, step, exec);
          if (personalized) { finalMessage = personalized.message; finalSubject = personalized.subject || finalSubject; }
        }

        const executeResult = await executeStepAction(step.action_type, enrollment, step, 
          { ...exec, final_message: finalMessage, final_subject: finalSubject }, supabase);

        if (executeResult.error === '__WAIT_EVENT__') {
          // Special case: wait_connection — transition to waiting_event
          await supabase.from('sequence_step_executions').update({ status: 'waiting_event' }).eq('id', exec.id);
          console.log(`[process] ${enrollment.profile_name} → waiting_event (wait_connection)`);
          results.skipped++;
        } else if (executeResult.success) {
          await supabase.from('sequence_step_executions').update({ 
            status: 'sent', executed_at: now, final_subject: executeResult.subject || finalSubject, final_message: executeResult.message || finalMessage,
          }).eq('id', exec.id);
          await supabase.from('sequence_enrollments').update({ current_step_order: step.step_order + 1 }).eq('id', enrollment.id);
          if (step.action_type !== 'check_connection') await scheduleNextStep(supabase, enrollment, step.step_order);
          results.processed++;
          
          // Action-type-specific delay to simulate natural human behavior
          const delay = getActionDelay(step.action_type);
          console.log(`[process] Sleeping ${Math.round(delay / 1000)}s after ${step.action_type}`);
          await sleep(delay);
        } else {
          // Retry logic: if error is retryable and retry_count < MAX_RETRIES, reschedule
          const currentRetryCount = exec.retry_count || 0;
          if (isRetryableError(executeResult.error) && currentRetryCount < MAX_RETRIES) {
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
            await supabase.from('sequence_step_executions').update({ status: 'failed', error_message: executeResult.error, executed_at: now, final_message: finalMessage || null, final_subject: finalSubject || null }).eq('id', exec.id);
            results.failed++;
            if (enrollment.sequence_id) failedSequenceIds.add(enrollment.sequence_id);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown';
        const currentRetryCount = exec.retry_count || 0;
        if (isRetryableError(errorMsg) && currentRetryCount < MAX_RETRIES) {
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
    await releaseLock(supabase);
  }
}

// deno-lint-ignore no-explicit-any
async function handleCheckReplies(supabase: any) {
  const { data: activeEnrollments } = await supabase.from('sequence_enrollments').select('*').eq('status', 'active');
  let repliesDetected = 0;
  let skippedTooRecent = 0;

  for (const enrollment of activeEnrollments || []) {
    // Find the last message/inmail sent by the sequence for this enrollment
    const { data: lastSentExec } = await supabase
      .from('sequence_step_executions')
      .select('executed_at, step:sequence_steps!inner(action_type)')
      .eq('enrollment_id', enrollment.id)
      .eq('status', 'sent')
      .in('step.action_type', ['message', 'inmail', 'smart_message', 'connection_request'])
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

    if (await checkForReplyAfterDate(enrollment.account_id, enrollment.profile_id, afterDate, enrollment.profile_url)) {
      await supabase.from('sequence_enrollments').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', enrollment.id);
      await supabase.from('sequence_step_executions').update({ status: 'cancelled', skip_reason: 'Reply detected' }).eq('enrollment_id', enrollment.id).eq('status', 'scheduled');
      await logAnalytics(supabase, enrollment.sequence_id, 'replies_received');
      repliesDetected++;
      console.log(`[checkReplies] Reply detected for ${enrollment.profile_name} (after ${afterDate})`);
    }
  }
  console.log(`[checkReplies] Done: ${repliesDetected} replies, ${skippedTooRecent} skipped (too recent)`);
  return new Response(JSON.stringify({ success: true, repliesDetected, skippedTooRecent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
async function handleCheckTimeouts(supabase: any) {
  const { data: waitingExecutions } = await supabase.from('sequence_step_executions')
    .select(`*, enrollment:sequence_enrollments(*), step:sequence_steps(*)`).eq('status', 'waiting_event').not('step.timeout_days', 'is', null);

  let branched = 0;
  for (const exec of waitingExecutions || []) {
    const step = exec.step, enrollment = exec.enrollment;
    if (!step?.timeout_days || !enrollment) continue;
    const daysPassed = Math.floor((Date.now() - new Date(exec.created_at).getTime()) / 86400000);
    if (daysPassed >= step.timeout_days) {
      await supabase.from('sequence_step_executions').update({ status: 'skipped', skip_reason: `Timeout ${step.timeout_days}d`, executed_at: new Date().toISOString() }).eq('id', exec.id);
      await scheduleNextStep(supabase, enrollment, step.step_order, step.timeout_branch_step_id);
      branched++;
    }
  }
  return new Response(JSON.stringify({ success: true, checked: waitingExecutions?.length || 0, branched }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
async function handleCheckWaitEvents(supabase: any) {
  const { data: waitingExecutions } = await supabase.from('sequence_step_executions')
    .select(`*, enrollment:sequence_enrollments(*), step:sequence_steps(*)`).eq('status', 'waiting_event');

  let eventsTriggered = 0;
  for (const exec of waitingExecutions || []) {
    const step = exec.step, enrollment = exec.enrollment;
    if (!step || !enrollment) continue;

    let eventOccurred = false;
    if (step.wait_for_event === 'connection_accepted') {
      const profile = await getProfileInfo(enrollment.account_id, enrollment.profile_id, enrollment.profile_url);
      eventOccurred = profile?.network_distance === 'FIRST_DEGREE';
    } else if (step.wait_for_event === 'reply_received') {
      eventOccurred = await checkHasProspectReplied(enrollment.account_id, enrollment.profile_id);
    }

    if (eventOccurred) {
      await supabase.from('sequence_step_executions').update({ status: 'scheduled', scheduled_at: new Date().toISOString() }).eq('id', exec.id);
      if (step.wait_for_event === 'connection_accepted') {
        await supabase.from('sequence_enrollments').update({ connection_status: 'connected' }).eq('id', enrollment.id);
        await logAnalytics(supabase, enrollment.sequence_id, 'invites_accepted');
      }
      eventsTriggered++;
    }
  }
  return new Response(JSON.stringify({ success: true, eventsTriggered }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ============ UTILITIES ============

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function needsMessage(actionType: string): boolean { return ['message', 'inmail', 'smart_message'].includes(actionType); }

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
  if (t.length > 20) return false;
  return true;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

function isRetryableError(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes('429') || e.includes('500') || e.includes('502') || e.includes('503') || e.includes('504')
    || e.includes('timeout') || e.includes('rate limit') || e.includes('temporarily') || e.includes('econnreset')
    || e.includes('fetch failed') || e.includes('network');
}

function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();
    const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(now), 10);
    const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
    return day !== "Sat" && day !== "Sun" && hour >= 8 && hour < 19;
  } catch { return true; }
}

function getNextBusinessHourSlot(timezone: string): Date {
  const target = new Date();
  for (let i = 0; i < 7; i++) {
    try {
      const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(target);
      const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(target), 10);
      if (day === "Sat" || day === "Sun" || hour >= 19) { target.setDate(target.getDate() + 1); target.setHours(8, Math.floor(Math.random() * 30), 0, 0); continue; }
      if (hour < 8) { target.setHours(8, Math.floor(Math.random() * 30), 0, 0); }
      break;
    } catch { target.setTime(target.getTime() + 3600000); break; }
  }
  return target;
}

async function getProfileInfo(accountId: string, profileId: string, enrollmentProfileUrl?: string): Promise<{ network_distance?: string } | null> {
  try {
    const r = await fetch(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
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
        const slugRes = await fetch(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(slug)}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
        if (slugRes.ok) {
          const slugData = await slugRes.json();
          const slugDistance = slugData.network_distance;
          console.log(`[getProfileInfo] Slug resolution: network_distance=${slugDistance}`);
          if (slugDistance === 'FIRST_DEGREE' || slugDistance === 1 || slugDistance === '1' || slugDistance === 'DISTANCE_1') {
            slugData.network_distance = 'FIRST_DEGREE';
            return slugData;
          }
        }
      }
    }

    return data;
  } catch (err) {
    console.error(`[getProfileInfo] Error for profileId=${profileId}:`, err);
    return null;
  }
}

async function resolveProfileIdForChat(accountId: string, profileId: string, profileUrl?: string | null): Promise<string> {
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
      const r = await fetch(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
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
      const slugRes = await fetch(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(slug)}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
      if (slugRes.ok) {
        const slugData = await slugRes.json();
        if (slugData.provider_id && !slugData.provider_id.startsWith('AE')) {
          console.log(`[resolveProfileIdForChat] Resolved ${profileId} -> ${slugData.provider_id} via slug ${slug}`);
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

async function checkForReplyAfterDate(accountId: string, profileId: string, afterDate: string, profileUrl?: string | null): Promise<boolean> {
  try {
    const enrollmentTime = new Date(afterDate).getTime();
    
    // Resolve recruiter IDs to a format the chat API understands
    const resolvedId = await resolveProfileIdForChat(accountId, profileId, profileUrl);
    
    const chatsRes = await fetch(`${UNIPILE_DSN}/api/v1/chat_attendees/${resolvedId}/chats?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!chatsRes.ok) {
      // If resolved ID also fails and it was different from original, try original as fallback
      if (resolvedId !== profileId) {
        const fallbackRes = await fetch(`${UNIPILE_DSN}/api/v1/chat_attendees/${profileId}/chats?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
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

async function checkMessagesForReply(chats: { id: string }[], afterTimestamp: number): Promise<boolean> {
  for (const chat of chats) {
    const msgRes = await fetch(`${UNIPILE_DSN}/api/v1/chats/${chat.id}/messages?limit=10`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!msgRes.ok) continue;
    const messages = (await msgRes.json()).items || [];
    // deno-lint-ignore no-explicit-any
    const hasReply = messages.some((m: any) => {
      // Check multiple fields for sender detection (Unipile uses different field names)
      const isSelf = m.is_sender_self === true || m.is_sender === true || m.sender_attendee_id === 'self';
      if (isSelf) return false;
      const msgTime = new Date(m.timestamp || m.date || m.created_at).getTime();
      return msgTime > afterTimestamp;
    });
    if (hasReply) return true;
  }
  return false;
}

async function checkHasProspectReplied(accountId: string, profileId: string): Promise<boolean> {
  return await checkForReplyAfterDate(accountId, profileId, new Date(Date.now() - 86400000).toISOString());
}

// deno-lint-ignore no-explicit-any
async function checkQuotaForAction(supabase: any, actionType: string, accountId: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    if (actionType === 'inmail' || actionType === 'smart_message') {
      const r = await fetch(`${UNIPILE_DSN}/api/v1/linkedin/inmail_balance?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
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

async function checkStepCondition(conditionType: string, accountId: string, profileId: string, waitForEvent?: string, profileUrl?: string): Promise<boolean | 'wait'> {
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
      return true;
    }
    default: return true;
  }
}

// deno-lint-ignore no-explicit-any
async function scheduleNextStep(supabase: any, enrollment: any, currentStepOrder: number, forceBranchStepId?: string) {
  let nextStep;
  
  if (forceBranchStepId) {
    const { data } = await supabase.from('sequence_steps').select('*').eq('id', forceBranchStepId).maybeSingle();
    nextStep = data;
  } else {
    // First try to follow the current step's next_step_id (graph-based chaining)
    const { data: currentStep } = await supabase.from('sequence_steps')
      .select('id, next_step_id')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', currentStepOrder)
      .maybeSingle();
    
    if (currentStep?.next_step_id) {
      const { data } = await supabase.from('sequence_steps').select('*').eq('id', currentStep.next_step_id).maybeSingle();
      nextStep = data;
    } else {
      // Safe fallback to step_order + 1 for linear sequences
      const { data: candidateNext } = await supabase.from('sequence_steps').select('*').eq('sequence_id', enrollment.sequence_id).eq('step_order', currentStepOrder + 1).maybeSingle();
      
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
      } else {
        // No step_order+1 found. Check if we're on a branch target with no explicit continuation.
        if (currentStep?.id) {
          const { data: referencingSteps } = await supabase.from('sequence_steps')
            .select('id')
            .eq('sequence_id', enrollment.sequence_id)
            .or(`timeout_branch_step_id.eq.${currentStep.id},if_true_goto_step.eq.${currentStep.id},if_false_goto_step.eq.${currentStep.id}`);
          
          if (referencingSteps && referencingSteps.length > 0) {
            console.log(`[scheduleNextStep] Step ${currentStepOrder} is a branch target with no next_step_id and no step_order+1, completing sequence`);
          }
        }
        // No next step found — sequence complete
      }
    }
  }

  if (!nextStep) {
    await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
    return;
  }

  let scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
  scheduledAt.setDate(scheduledAt.getDate() + (nextStep.delay_days || 0));
  scheduledAt.setHours(scheduledAt.getHours() + (nextStep.delay_hours || 0));
  // Add human-like jitter: ±5 minutes
  scheduledAt.setMinutes(scheduledAt.getMinutes() + Math.floor(Math.random() * 10) - 5);
  
  // Use timezone-aware hour checking for preferred hours and weekday skipping
  const tz = enrollment.user_timezone || 'Europe/Paris';
  const ps = nextStep.preferred_hour_start ?? 9, pe = nextStep.preferred_hour_end ?? 18;
  
  // Adjust to business hours in the user's timezone (loop up to 7 days to skip weekends)
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(scheduledAt), 10);
      const localDay = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(scheduledAt);
      
      if (localDay === "Sat") { scheduledAt.setDate(scheduledAt.getDate() + 2); scheduledAt.setHours(scheduledAt.getHours() - localHour + ps, Math.floor(Math.random() * 30), 0); continue; }
      if (localDay === "Sun") { scheduledAt.setDate(scheduledAt.getDate() + 1); scheduledAt.setHours(scheduledAt.getHours() - localHour + ps, Math.floor(Math.random() * 30), 0); continue; }
      if (localHour >= pe) { scheduledAt.setDate(scheduledAt.getDate() + 1); scheduledAt.setHours(scheduledAt.getHours() - localHour + ps, Math.floor(Math.random() * 30), 0); continue; }
      if (localHour < ps) { scheduledAt.setHours(scheduledAt.getHours() + (ps - localHour), Math.floor(Math.random() * 30), 0); }
      break;
    } catch { break; }
  }

  const { data: existing } = await supabase.from('sequence_step_executions').select('id').eq('enrollment_id', enrollment.id).eq('step_id', nextStep.id).maybeSingle();
  if (existing) return;

  await supabase.from('sequence_step_executions').insert({ enrollment_id: enrollment.id, step_id: nextStep.id, step_order: nextStep.step_order, scheduled_at: scheduledAt.toISOString(), status: 'scheduled' });
}

// deno-lint-ignore no-explicit-any
async function executeStepAction(actionType: string, enrollment: Record<string, unknown>, step: Record<string, unknown>, execution: Record<string, unknown>, supabase: any): Promise<{ success: boolean; error?: string; subject?: string; message?: string }> {
  try {
    const accountId = enrollment.account_id as string, profileId = enrollment.profile_id as string;
    const msg = (execution.final_message || step.message_template || '') as string;
    const subj = (execution.final_subject || step.subject_template || '') as string;

    switch (actionType) {
      case 'wait_connection': return { success: false, error: '__WAIT_EVENT__' };
      case 'check_connection': {
        const p = await getProfileInfo(accountId, profileId, enrollment.profile_url as string | undefined);
        const isConnected = p?.network_distance === 'FIRST_DEGREE';
        await supabase.from('sequence_enrollments').update({ connection_status: isConnected ? 'connected' : 'not_connected' }).eq('id', enrollment.id);
        const nextId = isConnected ? step.if_true_goto_step : step.if_false_goto_step;
        await scheduleNextStep(supabase, enrollment, step.step_order as number, nextId as string | undefined);
        return { success: true };
      }
      case 'profile_visit': {
        const r = await fetch(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
        if (r.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'profile_visits');
          return { success: true };
        }
        const errBody = await r.text().catch(() => '');
        return { success: false, error: `Profile visit ${r.status}: ${errBody || r.statusText}` };
      }
      case 'smart_message': case 'inmail': case 'message': {
        const p = await getProfileInfo(accountId, profileId, enrollment.profile_url as string | undefined);
        const needsInMail = p?.network_distance !== 'FIRST_DEGREE' && (actionType === 'inmail' || actionType === 'smart_message');
        const fd = new FormData();
        fd.append('account_id', accountId); fd.append('attendees_ids', profileId); fd.append('text', msg);
        if (needsInMail) { fd.append('linkedin[api]', 'recruiter'); fd.append('linkedin[inmail]', 'true'); if (subj) fd.append('linkedin[subject]', subj); }
        const r = await fetch(`${UNIPILE_DSN}/api/v1/chats`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY! }, body: fd });
        if (!r.ok) { const e = await r.text(); return { success: false, error: `Unipile ${r.status}: ${e}` }; }
        await r.json();
        await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        return { success: true, message: msg, subject: needsInMail ? subj : undefined };
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
              const pr = await fetch(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(match[1])}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
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
            const recruiterRes = await fetch(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
            if (recruiterRes.ok) {
              const recruiterProfile = await recruiterRes.json();
              const publicId = recruiterProfile.public_identifier || recruiterProfile.public_id;
              if (publicId) {
                console.log(`[connection_request] Got public_identifier: ${publicId}, resolving classic ID...`);
                const classicRes = await fetch(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(publicId)}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
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
        }
        const r = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, { method: 'POST', headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, provider_id: providerId }) });
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
  return '';
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
    const response = await fetch(url, { headers: { 'X-API-KEY': UNIPILE_API_KEY, 'accept': 'application/json' } });
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
    const profilePromise = fetch(`${UNIPILE_DSN}/api/v1/users/${enrollment.profile_id}?account_id=${enrollment.account_id}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }).then(r => r.ok ? r.json() : null).catch(() => null);
    const postsPromise = fetchRecentPostsForSequence(enrollment.account_id as string, enrollment.profile_id as string);
    
    // Fetch Notion job context (full page + body content)
    let jobNotionData: Record<string, string> = {};
    let jobBodyContent = '';
    let jobAccompagnement: string[] = [];
    let calendlyLink = '';

    // Fetch calendly_link from sourcing_projects linked to this job
    if (enrollment.job_id) {
      try {
        const { data: projects } = await supabase
          .from('sourcing_projects')
          .select('calendly_link')
          .eq('job_id', enrollment.job_id as string)
          .not('calendly_link', 'is', null)
          .limit(1);
        if (projects?.length && projects[0].calendly_link) {
          calendlyLink = projects[0].calendly_link;
          console.log(`[generatePersonalizedMessage] Calendly link found: ${calendlyLink}`);
        }
      } catch { /* ignore */ }
    }

    if (enrollment.job_id && NOTION_API_KEY) {
      try {
        const [pageRes, blocksRes] = await Promise.all([
          fetch(`https://api.notion.com/v1/pages/${enrollment.job_id}`, { headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' } }),
          fetch(`https://api.notion.com/v1/blocks/${enrollment.job_id}/children?page_size=50`, { headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' } }),
        ]);
        if (pageRes.ok) {
          const pageData = await pageRes.json();
          jobNotionData = extractNotionJob(pageData);
        }
        if (blocksRes.ok) {
          const blocksData = await blocksRes.json();
          // deno-lint-ignore no-explicit-any
          const blocks = (blocksData.results || []) as any[];
          const textParts: string[] = [];
          for (const block of blocks) {
            const richText = block[block.type]?.rich_text || block[block.type]?.text;
            if (Array.isArray(richText)) {
              // deno-lint-ignore no-explicit-any
              const text = richText.map((t: any) => t.plain_text || '').join('');
              if (text.trim()) textParts.push(text.trim());
            }
          }
          jobBodyContent = textParts.join('\n').slice(0, 800);
        }
        // Extract accompagnement
        const accomp = jobNotionData['Accompagnement'] || jobNotionData['Type accompagnement'] || '';
        if (accomp) jobAccompagnement = accomp.split(',').map(s => s.trim()).filter(Boolean);
      } catch { /* ignore */ }
    }

    // Fetch candidate history from Airtable cache
    const historyPromise = (async () => {
      try {
        const profileUrl = enrollment.profile_url as string || '';
        const slugMatch = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
        const slug = slugMatch ? slugMatch[1].toLowerCase() : null;
        if (!slug) return null;

        const { data: candidates } = await supabase
          .from('airtable_candidates')
          .select('airtable_id, full_name, status, email, phone, source_base, skills')
          .ilike('linkedin_url', `%${slug}%`)
          .limit(1);

        if (!candidates?.length) return null;
        const candidateAirtableId = candidates[0].airtable_id;

        const [shortlistsRes, placementsRes, notesRes, appointmentsRes] = await Promise.all([
          supabase.from('airtable_shortlists').select('airtable_id, status, date_added, salary_proposed, job_airtable_id, company_airtable_id, raw_data').eq('candidate_airtable_id', candidateAirtableId),
          supabase.from('airtable_placements').select('airtable_id, name, status, start_date, salary, contract_type, company_airtable_id, raw_data').eq('candidate_airtable_id', candidateAirtableId),
          supabase.from('airtable_notes').select('airtable_id, title, detail, note_type, note_date, author, raw_data').eq('candidate_airtable_id', candidateAirtableId).order('note_date', { ascending: false }).limit(5),
          supabase.from('airtable_appointments').select('airtable_id, title, appointment_date, appointment_type, status, raw_data').eq('candidate_airtable_id', candidateAirtableId).order('appointment_date', { ascending: false }).limit(3),
        ]);

        // Resolve company & job names
        const companyIds = new Set<string>();
        const jobIds = new Set<string>();
        // deno-lint-ignore no-explicit-any
        shortlistsRes.data?.forEach((s: any) => { if (s.company_airtable_id) companyIds.add(s.company_airtable_id); if (s.job_airtable_id) jobIds.add(s.job_airtable_id); });
        // deno-lint-ignore no-explicit-any
        placementsRes.data?.forEach((p: any) => { if (p.company_airtable_id) companyIds.add(p.company_airtable_id); });

        const [companiesRes, jobsRes] = await Promise.all([
          companyIds.size > 0 ? supabase.from('airtable_companies').select('airtable_id, name').in('airtable_id', [...companyIds]) : { data: [] },
          jobIds.size > 0 ? supabase.from('airtable_jobs').select('airtable_id, title').in('airtable_id', [...jobIds]) : { data: [] },
        ]);
        // deno-lint-ignore no-explicit-any
        const companyMap = new Map((companiesRes.data || []).map((c: any) => [c.airtable_id, c.name]));
        // deno-lint-ignore no-explicit-any
        const jobMap = new Map((jobsRes.data || []).map((j: any) => [j.airtable_id, j.title]));

        // deno-lint-ignore no-explicit-any
        const extractConsultant = (rawData: any): string | null => {
          if (!rawData || typeof rawData !== 'object') return null;
          for (const key of ['Ajouté par', 'Assignee', 'Created By', 'Identité auteur', 'Créée par', 'Auteur']) {
            const v = rawData[key];
            if (typeof v === 'string' && v.trim()) return v.trim();
            if (v && typeof v === 'object' && typeof v.name === 'string') return v.name;
          }
          return null;
        };

        return {
          // deno-lint-ignore no-explicit-any
          shortlists: (shortlistsRes.data || []).map((s: any) => ({
            job_title: s.job_airtable_id ? jobMap.get(s.job_airtable_id) || null : null,
            company_name: s.company_airtable_id ? companyMap.get(s.company_airtable_id) || null : null,
            status: s.status, date_added: s.date_added, consultant: extractConsultant(s.raw_data),
          })),
          // deno-lint-ignore no-explicit-any
          placements: (placementsRes.data || []).map((p: any) => ({
            company_name: p.company_airtable_id ? companyMap.get(p.company_airtable_id) || null : null,
            contract_type: p.contract_type, start_date: p.start_date, status: p.status, consultant: extractConsultant(p.raw_data),
          })),
          // deno-lint-ignore no-explicit-any
          notes: (notesRes.data || []).map((n: any) => ({
            title: n.title, detail: n.detail, note_date: n.note_date, consultant: extractConsultant(n.raw_data) || n.author,
          })),
          // deno-lint-ignore no-explicit-any
          appointments: (appointmentsRes.data || []).map((a: any) => ({
            title: a.title, appointment_date: a.appointment_date, appointment_type: a.appointment_type, status: a.status,
          })),
        };
      } catch { return null; }
    })();

    const [profile, recentPosts, candidateHistory] = await Promise.all([profilePromise, postsPromise, historyPromise]);

    const { data: prevSteps } = await supabase.from('sequence_step_executions').select('*, step:sequence_steps(*)').eq('enrollment_id', enrollment.id).eq('status', 'sent').order('step_order');
    // deno-lint-ignore no-explicit-any
    const hadInvite = prevSteps?.some((ps: any) => ps.step?.action_type === 'connection_request');
    // deno-lint-ignore no-explicit-any
    const prevMessages = prevSteps?.filter((ps: any) => ['message', 'inmail', 'smart_message'].includes(ps.step?.action_type)) || [];
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
        msgType = 'INMAIL RELANCE (DERNIÈRE TENTATIVE)';
        toneInstructions = `TON DE CLÔTURE FORMEL. DERNIÈRE tentative par InMail.
- Objet court type "Suite à mon précédent message"
- NE PAS répéter le pitch, juste rappeler le poste
- Laisser la porte ouverte
- 200-300 caractères`;
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
        msgType = 'RELANCE 1 (NOUVEL ANGLE)';
        toneInstructions = `PREMIÈRE RELANCE. NE RÉPÈTE PAS le même pitch. Apporte un NOUVEL ANGLE:
- Aspect technique différent, contexte d'équipe, avantage concret
- Pas de culpabilisation
- 200-350 caractères`;
      } else {
        msgType = 'RELANCE 2 (MESSAGE DE CLÔTURE)';
        toneInstructions = `DERNIÈRE RELANCE. Respectueux du silence.
- NE PAS repitcher, juste rappeler le poste en quelques mots
- Laisser la porte ouverte
- 150-250 caractères max`;
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
      ? `\nPUBLICATIONS LINKEDIN RÉCENTES:\n${recentPosts.map((p, i) => `POST ${i + 1} (${p.date}): "${p.text}"`).join('\n')}\n→ Utilise un post comme accroche SI pertinent par rapport au poste.`
      : '';

    // Build rich job context
    const jobTitle = jobNotionData['Poste'] || jobNotionData['Titre'] || enrollment.job_title || 'Tech role';
    const jobSkills = jobNotionData['Compétences'] || jobNotionData['Skills'] || '';
    const jobLocation = jobNotionData['Localisation'] || jobNotionData['Lieu'] || '';
    const jobRemote = jobNotionData['Remote'] || jobNotionData['Télétravail'] || '';
    const jobDescription = jobNotionData['Description'] || '';
    const jobSalary = ''; // Never expose salary to AI — forbidden in outreach messages
    const jobMustHave = jobNotionData['Must-have'] || jobNotionData['Must Have'] || '';

    const jobContextBlock = `POSTE À POURVOIR:
- Titre: ${jobTitle}
- Client: ${clientName}
- Accompagnement: ${jobAccompagnement.join(', ') || 'Non spécifié'} ${isRPO ? '(MODE RPO)' : '(MODE SUCCÈS)'}
${jobSkills ? `- Compétences: ${jobSkills}` : ''}
${jobLocation ? `- Localisation: ${jobLocation}` : ''}
${jobRemote ? `- Remote: ${jobRemote}` : ''}
${jobSalary ? `- Rémunération: ${jobSalary}` : ''}
${jobMustHave ? `- Must-have: ${jobMustHave}` : ''}
${jobDescription ? `- Contexte mission: ${jobDescription.slice(0, 300)}` : ''}
${jobBodyContent ? `- Détails poste:\n${jobBodyContent.slice(0, 400)}` : ''}`;

    // Build profile context
    const profileExperiences = profile?.experiences || profile?.positions?.values || [];
    // deno-lint-ignore no-explicit-any
    const expContext = Array.isArray(profileExperiences) ? profileExperiences.slice(0, 3).map((e: any) => {
      const title = e.title || e.role || '';
      const company = e.company_name || e.company || '';
      const desc = e.description || '';
      return `  • ${title} @ ${company}${desc ? `: ${desc.slice(0, 120)}` : ''}`;
    }).join('\n') : '';

    // Build candidate history section
    const historySection = (() => {
      if (!candidateHistory) return '';
      const parts: string[] = [];
      const senderLower = (senderName || '').toLowerCase().trim();
      const isSenderConsultant = (name: string | null): boolean => {
        if (!name || !senderLower) return false;
        const cLower = name.toLowerCase().trim();
        return cLower === senderLower || cLower.startsWith(senderLower.split(' ')[0]) || senderLower.startsWith(cLower.split(' ')[0]);
      };
      const allConsultants = [
        ...candidateHistory.shortlists.map((s: { consultant: string | null }) => s.consultant),
        ...candidateHistory.placements.map((p: { consultant: string | null }) => p.consultant),
        ...candidateHistory.notes.map((n: { consultant: string | null }) => n.consultant),
      ].filter(Boolean);
      const senderIsInHistory = allConsultants.some((c: string | null) => isSenderConsultant(c));

      // deno-lint-ignore no-explicit-any
      const shortlists = candidateHistory.shortlists.filter((s: any) => s.job_title || s.company_name);
      if (shortlists.length > 0) {
        parts.push('SHORTLISTS:');
        // deno-lint-ignore no-explicit-any
        shortlists.forEach((s: any) => {
          const isMine = isSenderConsultant(s.consultant);
          parts.push(`  - ${[s.job_title, s.company_name, s.status, s.date_added, s.consultant ? `par ${s.consultant}${isMine ? ' (= TOI)' : ''}` : ''].filter(Boolean).join(' | ')}`);
        });
      }
      // deno-lint-ignore no-explicit-any
      const placements = candidateHistory.placements.filter((p: any) => p.company_name);
      if (placements.length > 0) {
        parts.push('PLACEMENTS:');
        // deno-lint-ignore no-explicit-any
        placements.forEach((p: any) => {
          const isMine = isSenderConsultant(p.consultant);
          parts.push(`  - ${[p.company_name, p.contract_type, p.start_date, p.status, p.consultant ? `par ${p.consultant}${isMine ? ' (= TOI)' : ''}` : ''].filter(Boolean).join(' | ')}`);
        });
      }
      // deno-lint-ignore no-explicit-any
      const notes = candidateHistory.notes.filter((n: any) => n.detail || n.title);
      if (notes.length > 0) {
        parts.push('NOTES INTERNES:');
        // deno-lint-ignore no-explicit-any
        notes.slice(0, 3).forEach((n: any) => {
          const isMine = isSenderConsultant(n.consultant);
          parts.push(`  - ${[n.note_date, n.consultant ? `par ${n.consultant}${isMine ? ' (= TOI)' : ''}` : '', n.title, n.detail?.slice(0, 150)].filter(Boolean).join(' | ')}`);
        });
      }
      // deno-lint-ignore no-explicit-any
      const appts = candidateHistory.appointments.filter((a: any) => a.title);
      if (appts.length > 0) {
        parts.push('RENDEZ-VOUS:');
        // deno-lint-ignore no-explicit-any
        appts.forEach((a: any) => { parts.push(`  - ${[a.appointment_date, a.appointment_type, a.title, a.status].filter(Boolean).join(' | ')}`); });
      }
      if (parts.length === 0) return '';

      return `
=== HISTORIQUE INTERNE AVEC CE CANDIDAT ===
${senderIsInHistory ? `⚠️ TU (${senderName}) as personnellement interagi avec ce candidat. Parle à la PREMIÈRE PERSONNE.` : ''}
${parts.join('\n')}

UTILISATION DE L'HISTORIQUE:
- Ce candidat est DÉJÀ CONNU du cabinet.
${senderIsInHistory ? `- TU ES le consultant → première personne: "on avait échangé", "je t'avais contacté"` : `- Un COLLÈGUE a interagi → CITE SON PRÉNOM: "mon collègue [Prénom] m'avait parlé de toi"`}
- Mentionne l'historique QUE si pertinent et naturel. Ne cite JAMAIS les notes internes verbatim.
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
${profile?.summary ? `
=== SECTION "À PROPOS" DU CANDIDAT (SOURCE CLÉ DE PERSONNALISATION ET DE STYLE) ===
"${(profile.summary as string).slice(0, 800)}"
=== FIN À PROPOS ===

IMPORTANT - ANALYSE LE STYLE D'ÉCRITURE DU CANDIDAT:
- Observe comment il écrit: phrases courtes ou longues ? Formel ou décontracté ?
- ADAPTE TON MESSAGE À SON STYLE pour créer une résonance naturelle` : ''}
${profile?.current_company_name ? `- Entreprise actuelle: ${profile.current_company_name}` : ''}
${expContext ? `- Expériences récentes:\n${expContext}` : ''}
${postsSection}
${historySection}

${jobContextBlock}

TYPE DE MESSAGE: ${msgType}
${toneInstructions}

${prevMsgContext ? `MESSAGES PRÉCÉDENTS ENVOYÉS (ne te répète pas, apporte du neuf):\n${prevMsgContext}` : ''}

=== STRATÉGIE LINKEDIN 2025 – RÈGLES ABSOLUES ===

1. PERSONNALISATION = FACTEUR N°1 (NON NÉGOCIABLE)
   Chaque message DOIT contenir au moins UN élément hyper-spécifique au candidat. Cherche dans cet ordre:
   a) PUBLICATIONS LINKEDIN RÉCENTES → "j'ai vu ton post sur [sujet]"
   a-bis) HISTORIQUE INTERNE → "on avait échangé pour [poste/client]"
   b) SECTION "À PROPOS" → passion technique, side project, motivation
   c) PARCOURS PROFESSIONNEL → ancien employeur commun, transition intéressante
   ⚠️ SI rien de spécifique → utilise une QUESTION OUVERTE comme accroche

2. LONGUEUR = COURT (CRITIQUE)
   200-400 CARACTÈRES pour le corps du message (hors signature). 3-5 phrases MAX.

3. CE QUE LE CANDIDAT Y GAGNE, PAS UN DESCRIPTIF DE POSTE
   "Tu définirais l'archi toi-même" > "Nous cherchons un architecte"

4. CTA = SIMPLE ET NON-ENGAGEANT
   Exemples: "Ça te parlerait ?", "C'est un sujet pour toi ?", "T'aurais quelqu'un en tête ?"
   ❌ JAMAIS: proposer un call, un rdv, une dispo

5. FORMAT OBLIGATOIRE:
   SALUTATION: "Salut [Prénom]," UNIQUEMENT si le prénom est fiable. Si marqué "(non fiable, ne pas utiliser)", utilise "Salut," SANS prénom.
   PHRASE 1 = PERSONNALISATION PURE. Une observation spécifique, PAS un résumé de carrière.
   PHRASE 2-3 = Ce que le candidat y gagne
   PHRASE 4 = CTA non-engageant
   Signature: "${senderName}"

   ⛔ STRUCTURES D'ACCROCHE INTERDITES:
   - "Du [entreprise] au [entreprise]..." ❌
   - "Ton parcours de [X] à [Y]..." ❌
   - "Après [N] ans chez [entreprise]..." ❌

8. INTERDITS (MARQUEURS IA À BANNIR):
   - "j'ai parcouru ton profil", "a retenu mon attention"
   - Superlatifs: exceptionnel, remarquable, impressionnant, brillant, solide parcours
   - "parfaitement", "exactement" → trop vendeur
   - TIRETS: JAMAIS de "- ..." ni "A – B"
   - LISTES À PUCES: JAMAIS
   - JARGON: "ton taf", "mise gros", "c'est chaud"
   - FORMULES CREUSES: "projet passionnant", "belle aventure"
   - "ton profil colle parfaitement" ❌ → "ça matche" ou "ton profil colle bien"
   ⛔ FLATTERIE = INTERDIT (ça sonne fake et IA):
   - "c'est rare et c'est ce qu'il nous faut" ❌
   - "ça montre que tu aimes creuser" ❌
   - "ton expertise en [X] est précieuse" ❌
   → Tu OBSERVES ou tu POSES UNE QUESTION, tu ne fais PAS de compliment.

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

    const callAI = async (userPrompt: string) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ 
          model: 'claude-opus-4-6', 
          max_tokens: 500, 
          system: 'Tu es un recruteur tech senior. Tu écris des messages LinkedIn courts, directs, humains. JAMAIS de superlatifs, JAMAIS de tournures IA. Tu réponds TOUJOURS en JSON valide, sans markdown ni code blocks.',
          messages: [{ role: 'user', content: userPrompt }] 
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      // deno-lint-ignore no-explicit-any
      const textContent = data.content?.find((c: any) => c.type === 'text')?.text || '';
      return textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
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
    
    console.log(`[generatePersonalizedMessage] Type: ${msgType}, Length: ${parsed.message.length} chars, RPO: ${isRPO}, Sender: ${senderName}`);
    return { message: parsed.message, subject: parsed.subject };
  } catch (e) { console.error('AI personalization error:', e); return null; }
}
