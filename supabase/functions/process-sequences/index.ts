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

      const conditionResult = await checkStepCondition(step.condition_type, enrollment.account_id, enrollment.profile_id, step.wait_for_event);
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
      const profile = await getProfileInfo(enrollment.account_id, enrollment.profile_id);
      eventOccurred = profile?.network_distance === 'FIRST_DEGREE';
    } else if (step.wait_for_event === 'reply_received') {
      eventOccurred = await checkHasProspectReplied(enrollment.account_id, enrollment.profile_id);
    }

    if (eventOccurred) {
      await supabase.from('sequence_step_executions').update({ status: 'scheduled', scheduled_at: new Date().toISOString() }).eq('id', exec.id);
      if (step.wait_for_event === 'connection_accepted') {
        await supabase.from('sequence_enrollments').update({ connection_status: 'connected' }).eq('id', enrollment.id);
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

async function getProfileInfo(accountId: string, profileId: string): Promise<{ network_distance?: string } | null> {
  try {
    const r = await fetch(`${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
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

async function checkStepCondition(conditionType: string, accountId: string, profileId: string, waitForEvent?: string): Promise<boolean | 'wait'> {
  const eff = waitForEvent ? 'wait_for_event' : (conditionType || 'always');
  switch (eff) {
    case 'always': return true;
    case 'if_connected': { const p = await getProfileInfo(accountId, profileId); return p?.network_distance === 'FIRST_DEGREE'; }
    case 'if_not_connected': { const p = await getProfileInfo(accountId, profileId); return p?.network_distance !== 'FIRST_DEGREE'; }
    case 'if_no_response': return !(await checkHasProspectReplied(accountId, profileId));
    case 'wait_until_connected': { const p = await getProfileInfo(accountId, profileId); return p?.network_distance === 'FIRST_DEGREE' ? true : 'wait'; }
    case 'wait_for_event': {
      if (waitForEvent === 'connection_accepted') { const p = await getProfileInfo(accountId, profileId); return p?.network_distance === 'FIRST_DEGREE' ? true : 'wait'; }
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
      .select('next_step_id')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', currentStepOrder)
      .maybeSingle();
    
    if (currentStep?.next_step_id) {
      const { data } = await supabase.from('sequence_steps').select('*').eq('id', currentStep.next_step_id).maybeSingle();
      nextStep = data;
    } else {
      // Fallback to step_order + 1 for legacy linear sequences
      const { data } = await supabase.from('sequence_steps').select('*').eq('sequence_id', enrollment.sequence_id).eq('step_order', currentStepOrder + 1).maybeSingle();
      nextStep = data;
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
        const p = await getProfileInfo(accountId, profileId);
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
        const p = await getProfileInfo(accountId, profileId);
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

// deno-lint-ignore no-explicit-any
async function generatePersonalizedMessage(supabase: any, enrollment: Record<string, unknown>, step: Record<string, unknown>, _exec: Record<string, unknown>): Promise<{ message: string; subject?: string } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const profileRes = await fetch(`${UNIPILE_DSN}/api/v1/users/${enrollment.profile_id}?account_id=${enrollment.account_id}`, { headers: { 'X-API-KEY': UNIPILE_API_KEY! } });
    const profile = profileRes.ok ? await profileRes.json() : null;
    
    let jobContext: Record<string, unknown> | null = null;
    if (enrollment.job_id && NOTION_API_KEY) {
      try {
        const jr = await fetch(`https://api.notion.com/v1/pages/${enrollment.job_id}`, { headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' } });
        if (jr.ok) jobContext = await jr.json();
      } catch { /* ignore */ }
    }

    const { data: prevSteps } = await supabase.from('sequence_step_executions').select('*, step:sequence_steps(*)').eq('enrollment_id', enrollment.id).eq('status', 'sent').order('step_order');
    // deno-lint-ignore no-explicit-any
    const hadInvite = prevSteps?.some((ps: any) => ps.step?.action_type === 'connection_request');
    // deno-lint-ignore no-explicit-any
    const prevMessages = prevSteps?.filter((ps: any) => ['message', 'inmail', 'smart_message'].includes(ps.step?.action_type)) || [];
    const hadMsg = prevMessages.length > 0;
    const isInvite = step.action_type === 'connection_request';
    const isInMail = step.action_type === 'inmail' || step.action_type === 'smart_message';
    
    // Count previous messages of same type (inmail vs message) to determine relance number
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
- Ton plus professionnel que pour un message direct
- Proposition de valeur claire et concise
- Explique brièvement pourquoi tu le contactes par InMail
- CTA: proposition de call ou demande d'avis
- 300-500 caractères pour le corps (InMail = légèrement plus long qu'un message direct)`;
      } else {
        msgType = 'INMAIL RELANCE (DERNIÈRE TENTATIVE)';
        toneInstructions = `TON DE CLÔTURE FORMEL. C'est ta DERNIÈRE tentative par InMail.
- Objet court type "Suite à mon précédent message"
- Reconnaître que le candidat est probablement très sollicité
- NE PAS répéter le pitch complet, juste rappeler le poste en une phrase
- Laisser la porte ouverte sans insistance
- Message court: 200-300 caractères
- CTA doux: "je reste disponible si ça change"`;
      }
    } else {
      // Message direct LinkedIn
      if (!hadMsg && !hadInvite) {
        msgType = 'PREMIER MESSAGE';
        toneInstructions = `PREMIER CONTACT. Accroche personnalisée + pitch concis + CTA non-engageant.
- Cherche un hook dans les posts LinkedIn récents ou le "À propos"
- Structure: Accroche perso (1 phrase) → Ce que le candidat y gagne (1-2 phrases) → CTA
- 200-400 caractères`;
      } else if (!hadMsg && hadInvite) {
        msgType = 'SUITE INVITATION';
        toneInstructions = `PREMIER MESSAGE après acceptation de connexion. Le candidat vient d'accepter ta demande.
- Commence par un bref remerciement pour la connexion (1 phrase max, pas obséquieux)
- Enchaîne directement avec le pitch du poste
- NE DIS PAS "je reviens vers vous" (c'est le premier échange !)
- CTA non-engageant
- 200-400 caractères`;
      } else if (prevDirectMsgs.length === 1) {
        msgType = 'RELANCE 1 (NOUVEL ANGLE)';
        toneInstructions = `PREMIÈRE RELANCE. Le candidat n'a pas répondu au premier message.
- NE RÉPÈTE PAS le même pitch. Apporte un NOUVEL ANGLE sur le poste:
  * Un aspect technique différent (stack, ownership, impact)
  * Le contexte d'équipe ou de croissance
  * Un avantage concret (remote, salaire, stack greenfield)
- Ton naturel, pas de "je me permets de revenir vers vous"
- Pas de culpabilisation ("vous n'avez pas répondu")
- Question ouverte ou nouvel élément pour relancer la conversation
- 200-350 caractères`;
      } else {
        msgType = 'RELANCE 2 (MESSAGE DE CLÔTURE)';
        toneInstructions = `DERNIÈRE RELANCE. Le candidat n'a pas répondu après 2 messages.
- C'est ton DERNIER message, sois respectueux du silence
- Reconnaître que le timing n'est peut-être pas bon
- NE PAS repitcher en détail, juste rappeler le poste en quelques mots
- Laisser la porte ouverte ("n'hésitez pas si ça change")
- Ton poli et léger, JAMAIS passif-agressif
- Message COURT: 150-250 caractères max
- Pas de CTA pressant`;
      }
    }

    // Build previous messages context for AI
    // deno-lint-ignore no-explicit-any
    const prevMsgContext = prevMessages.length > 0 ? prevMessages.map((ps: any, i: number) => 
      `MESSAGE ${i + 1} (${ps.step?.action_type}): "${(ps.final_message || '').slice(0, 200)}"`
    ).join('\n') : '';

    // Get sender name from profile
    let senderName = 'Recruteur';
    try {
      const { data: senderProfile } = await supabase.from('profiles').select('display_name').eq('user_id', enrollment.created_by).maybeSingle();
      if (senderProfile?.display_name) senderName = senderProfile.display_name;
    } catch { /* ignore */ }

    const prompt = `Tu es un recruteur tech senior. Écris un message LinkedIn personnalisé.

PROFIL CANDIDAT:
- Prénom: ${profile?.first_name || profile?.name?.split(' ')[0] || 'Candidat'}
- Titre: ${profile?.headline || 'N/A'}
${profile?.summary ? `- À propos: "${(profile.summary as string).slice(0, 400)}"` : ''}
${profile?.current_company_name ? `- Entreprise actuelle: ${profile.current_company_name}` : ''}

POSTE: ${enrollment.job_title || 'Tech role'}

TYPE DE MESSAGE: ${msgType}
${toneInstructions}

${prevMsgContext ? `MESSAGES PRÉCÉDENTS ENVOYÉS (ne te répète pas, apporte du neuf):\n${prevMsgContext}` : ''}

RÈGLES ABSOLUES:
- JAMAIS de tirets (—, –, -), bullet points, ni listes
- JAMAIS de superlatifs IA: "exceptionnel", "impressionnant", "remarquable"
- JAMAIS de "j'ai parcouru ton profil", "a retenu mon attention"
- Sauts de ligne entre les paragraphes (\\n\\n)
- Signature: "${senderName}"

Réponds UNIQUEMENT en JSON valide: {"subject": "objet si InMail, sinon vide", "message": "le message complet"}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!aiRes.ok) return null;
    const aiData = await aiRes.json();
    // deno-lint-ignore no-explicit-any
    const textContent = aiData.content?.find((c: any) => c.type === 'text')?.text || '';
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[generatePersonalizedMessage] Type: ${msgType}, Length: ${(parsed.message || '').length} chars`);
      return { message: parsed.message || '', subject: parsed.subject };
    }
    return null;
  } catch (e) { console.error('AI personalization error:', e); return null; }
}
