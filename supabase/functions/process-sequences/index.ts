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

    const { action } = await req.json();

    switch (action) {
      case 'process':
        return await handleProcess(supabase);
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
async function handleProcess(supabase: any) {
  const now = new Date().toISOString();
  
  const { data: executions, error: fetchError } = await supabase
    .from('sequence_step_executions')
    .select(`*, enrollment:sequence_enrollments(*, sequence:outreach_sequences(*)), step:sequence_steps(*)`)
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .limit(10);

  if (fetchError) throw fetchError;

  const results = { processed: 0, skipped: 0, failed: 0, quota_blocked: 0 };

  for (const exec of executions || []) {
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
      if (!isWithinBusinessHours(userTimezone)) {
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

      if (executeResult.success) {
        await supabase.from('sequence_step_executions').update({ 
          status: 'sent', executed_at: now, final_subject: executeResult.subject || finalSubject, final_message: executeResult.message || finalMessage,
        }).eq('id', exec.id);
        await supabase.from('sequence_enrollments').update({ current_step_order: step.step_order + 1 }).eq('id', enrollment.id);
        if (step.action_type !== 'check_connection') await scheduleNextStep(supabase, enrollment, step.step_order);
        results.processed++;
        
        if (['profile_visit', 'connection_request', 'message', 'inmail', 'smart_message'].includes(step.action_type)) {
          await sleep(30000 + Math.random() * 90000);
        }
      } else {
        await supabase.from('sequence_step_executions').update({ status: 'failed', error_message: executeResult.error, executed_at: now }).eq('id', exec.id);
        results.failed++;
      }
    } catch (err) {
      await supabase.from('sequence_step_executions').update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown' }).eq('id', exec.id);
      results.failed++;
    }
  }

  return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
async function handleCheckReplies(supabase: any) {
  const { data: activeEnrollments } = await supabase.from('sequence_enrollments').select('*').eq('status', 'active');
  let repliesDetected = 0;

  for (const enrollment of activeEnrollments || []) {
    if (await checkForReplyAfterDate(enrollment.account_id, enrollment.profile_id, enrollment.created_at)) {
      await supabase.from('sequence_enrollments').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', enrollment.id);
      await supabase.from('sequence_step_executions').update({ status: 'cancelled', skip_reason: 'Reply detected' }).eq('enrollment_id', enrollment.id).eq('status', 'scheduled');
      await logAnalytics(supabase, enrollment.sequence_id, 'replies_received');
      repliesDetected++;
    }
  }
  return new Response(JSON.stringify({ success: true, repliesDetected }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

async function checkForReplyAfterDate(accountId: string, profileId: string, afterDate: string): Promise<boolean> {
  try {
    const enrollmentTime = new Date(afterDate).getTime();
    const chatsRes = await fetch(`${UNIPILE_DSN}/api/v1/chat_attendees/${profileId}/chats?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    if (!chatsRes.ok) return false;
    const chats = (await chatsRes.json()).items || [];
    for (const chat of chats) {
      const msgRes = await fetch(`${UNIPILE_DSN}/api/v1/chats/${chat.id}/messages?limit=20`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
      if (!msgRes.ok) continue;
      const messages = (await msgRes.json()).items || [];
      // deno-lint-ignore no-explicit-any
      if (messages.some((m: any) => !m.is_sender_self && m.sender_attendee_id !== 'self' && new Date(m.timestamp || m.date || m.created_at).getTime() > enrollmentTime)) return true;
    }
    return false;
  } catch { return false; }
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
      // Before falling back to step_order + 1, check if the current step was reached via branching
      // (i.e. another step references it as a branch target). If so, this branch ends here.
      if (currentStep?.id) {
        const { data: referencingSteps } = await supabase.from('sequence_steps')
          .select('id')
          .eq('sequence_id', enrollment.sequence_id)
          .or(`timeout_branch_step_id.eq.${currentStep.id},if_true_goto_step.eq.${currentStep.id},if_false_goto_step.eq.${currentStep.id}`);
        
        if (referencingSteps && referencingSteps.length > 0) {
          // This step is a branch target with no next_step_id — branch ends, complete the sequence
          console.log(`[scheduleNextStep] Step ${currentStepOrder} is a branch target with no next_step_id, completing sequence`);
          await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
          return;
        }
      }
      
      // Safe fallback to step_order + 1 for linear sequences
      const { data: candidateNext } = await supabase.from('sequence_steps').select('*').eq('sequence_id', enrollment.sequence_id).eq('step_order', currentStepOrder + 1).maybeSingle();
      
      // Guard: if the candidate next step has a branch-specific condition, verify compatibility
      if (candidateNext && candidateNext.condition_type) {
        const connStatus = enrollment.connection_status;
        if (candidateNext.condition_type === 'if_connected' && connStatus !== 'connected') {
          console.log(`[scheduleNextStep] Skipping step ${candidateNext.step_order} (if_connected) — enrollment connection_status is '${connStatus}'`);
          // Don't schedule this cross-branch step, complete the sequence
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
  }

  if (!nextStep) {
    await supabase.from('sequence_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
    return;
  }

  let scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
  scheduledAt.setDate(scheduledAt.getDate() + (nextStep.delay_days || 0));
  scheduledAt.setHours(scheduledAt.getHours() + (nextStep.delay_hours || 0));
  scheduledAt.setMinutes(scheduledAt.getMinutes() + Math.floor(Math.random() * 10) - 5);
  
  const ps = nextStep.preferred_hour_start ?? 9, pe = nextStep.preferred_hour_end ?? 18;
  if (scheduledAt.getHours() < ps) scheduledAt.setHours(ps, Math.floor(Math.random() * 30), 0);
  else if (scheduledAt.getHours() >= pe) { scheduledAt.setDate(scheduledAt.getDate() + 1); scheduledAt.setHours(ps, Math.floor(Math.random() * 30), 0); }
  const day = scheduledAt.getDay();
  if (day === 0) scheduledAt.setDate(scheduledAt.getDate() + 1);
  if (day === 6) scheduledAt.setDate(scheduledAt.getDate() + 2);

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
      case 'wait_connection': return { success: true };
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
        if (r.ok) await logAnalytics(supabase, enrollment.sequence_id as string, 'profile_visits');
        return { success: r.ok };
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
  if (isRPO) {
    if (/\bje\s+recrute\b/i.test(text)) v.push('RPO: "je recrute"');
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

    const [profile, recentPosts] = await Promise.all([profilePromise, postsPromise]);

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
- CTA: proposition de call ou demande d'avis
- 300-500 caractères pour le corps`;
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
      ? `=== MODE RPO (TU ES SALARIÉ DE ${clientName.toUpperCase()}) ===
Tu travailles CHEZ ${clientName}. Tu n'es PAS un cabinet externe.
- TOUJOURS: "on", "nous", "chez ${clientName}" ou "chez nous"
- JAMAIS: "ils", "leur", "mon client", "je recrute pour"`
      : `=== MODE SUCCÈS (CABINET EXTERNE) ===
Tu parles EN TANT QUE recruteur externe.
- Utilise "ils", "leur équipe", "chez ${clientName}"
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
    const jobSalary = jobNotionData['Salaire'] || jobNotionData['TJM'] || '';
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

    const prompt = `Tu es un recruteur tech senior. Écris un message LinkedIn ULTRA personnalisé et percutant.
${engagementBlock}

PROFIL CANDIDAT:
- Prénom: ${profile?.first_name || profile?.name?.split(' ')[0] || 'Candidat'}
- Titre: ${profile?.headline || 'N/A'}
${profile?.summary ? `- À propos: "${(profile.summary as string).slice(0, 500)}"` : ''}
${profile?.current_company_name ? `- Entreprise actuelle: ${profile.current_company_name}` : ''}
${expContext ? `- Expériences récentes:\n${expContext}` : ''}
${postsSection}

${jobContextBlock}

TYPE DE MESSAGE: ${msgType}
${toneInstructions}

${prevMsgContext ? `MESSAGES PRÉCÉDENTS ENVOYÉS (ne te répète pas, apporte du neuf):\n${prevMsgContext}` : ''}

=== STRATÉGIE LINKEDIN 2025 ===
1. PERSONNALISATION: Utilise les posts LinkedIn > À propos > parcours comme accroche
2. LONGUEUR: 200-400 caractères. Chaque mot doit mériter sa place
3. CE QUE LE CANDIDAT Y GAGNE, pas un descriptif de poste
4. CTA: simple et non-engageant ("Dispo pour un call de 15 min ?")

RÈGLES ABSOLUES:
- JAMAIS de tirets (—, –, -), bullet points, ni listes
- JAMAIS de superlatifs IA: "exceptionnel", "impressionnant", "remarquable"
- JAMAIS de "j'ai parcouru ton profil", "a retenu mon attention"
- JAMAIS "ton profil colle parfaitement" → "ça matche" ou "ton profil colle bien"
- Sauts de ligne entre les paragraphes (\\n\\n)
- Signature: "${senderName}"

Réponds UNIQUEMENT en JSON valide: {"subject": "objet si InMail, sinon vide", "message": "le message complet"}`;

    const callAI = async (userPrompt: string) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 500, messages: [{ role: 'user', content: userPrompt }] }),
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
      const correctionPrompt = `${prompt}\n\n=== CORRECTION STRICTE ===\nLe draft viole ces règles: ${violations.join(' ; ')}.\n${isRPO ? `En MODE RPO: jamais "ils", "leur", "mon client". Toujours "on", "nous", "chez ${clientName}".` : ''}\nAucun tiret nulle part.\n\nDRAFT: ${JSON.stringify(parsed)}\n\nRéponds en JSON valide: {"subject": "...", "message": "..."}`;
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
    
    console.log(`[generatePersonalizedMessage] Type: ${msgType}, Length: ${parsed.message.length} chars, RPO: ${isRPO}`);
    return { message: parsed.message, subject: parsed.subject };
  } catch (e) { console.error('AI personalization error:', e); return null; }
}
