import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Import modular utilities
import { 
  isWithinBusinessHours, 
  getNextBusinessHourSlot, 
  getInterActionDelayMs, 
  sleep 
} from './utils/scheduling.ts';
import { 
  UNIPILE_DSN, 
  UNIPILE_API_KEY, 
  getProfileInfo, 
  getFullLinkedInProfile,
  checkForReplyAfterDate, 
  checkHasProspectReplied 
} from './utils/linkedin.ts';
import { fetchNotionJobContext } from './utils/notion.ts';
import { needsMessage, generatePersonalizedMessage } from './utils/ai-personalization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Quota limits per account type
const WEEKLY_INVITE_LIMIT = 100;

console.log('[process-sequences] Config:', {
  hasDSN: !!UNIPILE_DSN,
  dsn: UNIPILE_DSN,
  hasApiKey: !!UNIPILE_API_KEY,
});

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
      case 'process': {
        const now = new Date().toISOString();
        
        const { data: executions, error: fetchError } = await supabase
          .from('sequence_step_executions')
          .select(`
            *,
            enrollment:sequence_enrollments(
              *,
              sequence:outreach_sequences(*)
            ),
            step:sequence_steps(*)
          `)
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
              await supabase
                .from('sequence_step_executions')
                .update({ status: 'skipped', skip_reason: 'Enrollment inactive' })
                .eq('id', exec.id);
              results.skipped++;
              continue;
            }

            // Quota verification
            const quotaCheck = await checkQuotaForAction(
              supabase,
              step.action_type,
              enrollment.account_id
            );
            
            if (!quotaCheck.allowed) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'quota_blocked', 
                  skip_reason: quotaCheck.reason,
                  scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                })
                .eq('id', exec.id);
              results.quota_blocked++;
              continue;
            }

            // Human activity simulation - check business hours
            const userTimezone = enrollment.user_timezone || 'Europe/Paris';
            if (!isWithinBusinessHours(userTimezone)) {
              const nextSlot = getNextBusinessHourSlot(userTimezone);
              console.log(`[process-sequences] Outside business hours for ${userTimezone}, rescheduling to ${nextSlot.toISOString()}`);
              
              await supabase
                .from('sequence_step_executions')
                .update({ scheduled_at: nextSlot.toISOString() })
                .eq('id', exec.id);
              results.skipped++;
              continue;
            }

            // Check conditions
            const conditionResult = await checkStepCondition(
              supabase,
              step.condition_type,
              enrollment.account_id,
              enrollment.profile_id,
              step.wait_for_event
            );

            if (conditionResult === 'wait') {
              await supabase
                .from('sequence_step_executions')
                .update({ status: 'waiting_event' })
                .eq('id', exec.id);
              results.skipped++;
              continue;
            }

            if (!conditionResult) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'skipped', 
                  skip_reason: `Condition not met: ${step.condition_type}`,
                  executed_at: now,
                })
                .eq('id', exec.id);
              results.skipped++;
              await scheduleNextStep(supabase, enrollment, step.step_order);
              continue;
            }

            // Optimistic locking to prevent duplicate executions
            const { data: lockResult, error: lockError } = await supabase
              .from('sequence_step_executions')
              .update({ status: 'sending' })
              .eq('id', exec.id)
              .eq('status', 'scheduled')
              .select()
              .single();

            if (lockError || !lockResult) {
              console.log(`[process-sequences] Execution ${exec.id} already being processed, skipping`);
              results.skipped++;
              continue;
            }

            // AI personalization
            let finalMessage = (exec.final_message || step.message_template || '') as string;
            let finalSubject = (step.subject_template || '') as string;
            
            if (step.use_ai_personalization && needsMessage(step.action_type)) {
              const personalizedContent = await generatePersonalizedMessage(
                supabase,
                enrollment,
                step,
                exec
              );
              
              if (personalizedContent) {
                finalMessage = personalizedContent.message;
                finalSubject = personalizedContent.subject || finalSubject;
              }
            }

            // Execute the action
            const executeResult = await executeStepAction(
              step.action_type,
              enrollment,
              step,
              { ...exec, final_message: finalMessage, final_subject: finalSubject },
              supabase
            );

            if (executeResult.success) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'sent', 
                  executed_at: now,
                  final_subject: executeResult.subject || finalSubject,
                  final_message: executeResult.message || finalMessage,
                })
                .eq('id', exec.id);
              
              await supabase
                .from('sequence_enrollments')
                .update({ current_step_order: step.step_order + 1 })
                .eq('id', enrollment.id);

              // Actions that handle their own scheduling
              const selfSchedulingActions = ['check_connection'];
              if (!selfSchedulingActions.includes(step.action_type)) {
                await scheduleNextStep(supabase, enrollment, step.step_order);
              }
              results.processed++;
              
              // Add random delay between LinkedIn actions
              const linkedInActions = ['profile_visit', 'connection_request', 'message', 'inmail', 'smart_message'];
              if (linkedInActions.includes(step.action_type)) {
                const delayMs = getInterActionDelayMs();
                console.log(`[process-sequences] Waiting ${Math.round(delayMs/1000)}s before next action`);
                await sleep(delayMs);
              }
            } else {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'failed', 
                  error_message: executeResult.error,
                  executed_at: now,
                })
                .eq('id', exec.id);
              results.failed++;
            }
          } catch (err) {
            console.error('Step execution error:', err);
            await supabase
              .from('sequence_step_executions')
              .update({ 
                status: 'failed', 
                error_message: err instanceof Error ? err.message : 'Unknown error',
              })
              .eq('id', exec.id);
            results.failed++;
          }
        }

        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_replies': {
        const { data: activeEnrollments } = await supabase
          .from('sequence_enrollments')
          .select('*')
          .eq('status', 'active');

        let repliesDetected = 0;

        for (const enrollment of activeEnrollments || []) {
          const hasReply = await checkForReplyAfterDate(
            enrollment.account_id, 
            enrollment.profile_id,
            enrollment.created_at
          );
          
          if (hasReply) {
            console.log(`[process-sequences] Reply detected for enrollment ${enrollment.id}`);
            
            await supabase
              .from('sequence_enrollments')
              .update({ 
                status: 'replied', 
                replied_at: new Date().toISOString(),
              })
              .eq('id', enrollment.id);
            
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'cancelled', skip_reason: 'Reply detected' })
              .eq('enrollment_id', enrollment.id)
              .eq('status', 'scheduled');
            
            repliesDetected++;
          }
        }

        return new Response(JSON.stringify({ success: true, repliesDetected }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_timeouts': {
        const timeoutResults = await checkTimeoutBranches(supabase);
        return new Response(JSON.stringify({ success: true, ...timeoutResults }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_wait_events': {
        const { data: waitingExecutions } = await supabase
          .from('sequence_step_executions')
          .select(`
            *,
            enrollment:sequence_enrollments(*),
            step:sequence_steps(*)
          `)
          .eq('status', 'waiting_event');

        let eventsTriggered = 0;

        for (const exec of waitingExecutions || []) {
          const step = exec.step;
          const enrollment = exec.enrollment;
          
          if (!step || !enrollment) continue;

          let eventOccurred = false;

          switch (step.wait_for_event) {
            case 'connection_accepted': {
              const profile = await getProfileInfo(enrollment.account_id, enrollment.profile_id);
              eventOccurred = profile?.network_distance === 'FIRST_DEGREE';
              break;
            }
            case 'reply_received': {
              eventOccurred = await checkHasProspectReplied(enrollment.account_id, enrollment.profile_id);
              break;
            }
          }

          if (eventOccurred) {
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
              .eq('id', exec.id);
            
            if (step.wait_for_event === 'connection_accepted') {
              await supabase
                .from('sequence_enrollments')
                .update({ connection_status: 'connected' })
                .eq('id', enrollment.id);
            }
            
            eventsTriggered++;
          }
        }

        return new Response(JSON.stringify({ success: true, eventsTriggered }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Sequence processor error:', error);
    return new Response(JSON.stringify({
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ============ QUOTA VERIFICATION ============

// deno-lint-ignore no-explicit-any
async function checkQuotaForAction(
  supabase: any,
  actionType: string,
  accountId: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    switch (actionType) {
      case 'inmail':
      case 'smart_message': {
        const balanceResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/linkedin/inmail_balance?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        
        if (!balanceResponse.ok) {
          console.warn('Could not check InMail balance, proceeding anyway');
          return { allowed: true };
        }
        
        const balance = await balanceResponse.json();
        const recruiterCredits = balance.recruiter || balance.recruiter_balance || 0;
        const premiumCredits = balance.premium || balance.premium_balance || 0;
        const salesNavCredits = balance.sales_navigator || balance.sales_navigator_balance || 0;
        
        const totalCredits = recruiterCredits + premiumCredits + salesNavCredits;
        
        console.log(`[process-sequences] InMail balance:`, { recruiter: recruiterCredits, premium: premiumCredits, salesNav: salesNavCredits, total: totalCredits });
        
        if (totalCredits <= 0) {
          return { 
            allowed: false, 
            reason: `Quota InMail épuisé (Recruiter: ${recruiterCredits}, Premium: ${premiumCredits}, Sales Nav: ${salesNavCredits})` 
          };
        }
        
        return { allowed: true };
      }

      case 'connection_request': {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        const { data: sentInvites } = await supabase
          .from('sequence_step_executions')
          .select(`id, step:sequence_steps!inner(action_type)`)
          .eq('status', 'sent')
          .eq('step.action_type', 'connection_request')
          .gte('executed_at', weekAgo.toISOString());
        
        const totalInvites = sentInvites?.length || 0;
        
        if (totalInvites >= WEEKLY_INVITE_LIMIT) {
          return { 
            allowed: false, 
            reason: `Limite hebdomadaire d'invitations atteinte (${totalInvites}/${WEEKLY_INVITE_LIMIT})` 
          };
        }
        
        return { allowed: true };
      }

      default:
        return { allowed: true };
    }
  } catch (err) {
    console.error('Quota check error:', err);
    return { allowed: true };
  }
}

// ============ STEP CONDITIONS ============

async function checkStepCondition(
  _supabase: unknown,
  conditionType: string,
  accountId: string,
  profileId: string,
  waitForEvent?: string
): Promise<boolean | 'wait'> {
  const effectiveConditionType = waitForEvent ? 'wait_for_event' : (conditionType || 'always');

  switch (effectiveConditionType) {
    case 'always':
      return true;

    case 'if_connected': {
      const profile = await getProfileInfo(accountId, profileId);
      return profile?.network_distance === 'FIRST_DEGREE';
    }

    case 'if_not_connected': {
      const profile = await getProfileInfo(accountId, profileId);
      return profile?.network_distance !== 'FIRST_DEGREE';
    }

    case 'if_no_response': {
      const hasReply = await checkHasProspectReplied(accountId, profileId);
      return !hasReply;
    }

    case 'wait_until_connected': {
      const profile = await getProfileInfo(accountId, profileId);
      if (profile?.network_distance === 'FIRST_DEGREE') {
        return true;
      }
      return 'wait';
    }

    case 'wait_for_event': {
      if (!waitForEvent) return true;
      
      switch (waitForEvent) {
        case 'connection_accepted': {
          const profile = await getProfileInfo(accountId, profileId);
          return profile?.network_distance === 'FIRST_DEGREE' ? true : 'wait';
        }
        case 'reply_received': {
          const hasReply = await checkHasProspectReplied(accountId, profileId);
          return hasReply ? true : 'wait';
        }
        default:
          return true;
      }
    }

    default:
      return true;
  }
}

// ============ STEP EXECUTION ============

// deno-lint-ignore no-explicit-any
async function executeStepAction(
  actionType: string,
  enrollment: Record<string, unknown>,
  step: Record<string, unknown>,
  execution: Record<string, unknown>,
  supabase: any
): Promise<{ success: boolean; error?: string; subject?: string; message?: string }> {
  try {
    const accountId = enrollment.account_id as string;
    const profileId = enrollment.profile_id as string;
    const messageText = (execution.final_message || step.message_template || '') as string;
    const subjectText = (execution.final_subject || step.subject_template || '') as string;

    switch (actionType) {
      case 'wait_connection': {
        return { success: true };
      }

      case 'check_connection': {
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        
        const nextStepId = isConnected 
          ? (step.if_true_goto_step as string | undefined) 
          : (step.if_false_goto_step as string | undefined);
        
        await supabase
          .from('sequence_enrollments')
          .update({ connection_status: isConnected ? 'connected' : 'not_connected' })
          .eq('id', enrollment.id);
        
        if (nextStepId) {
          await scheduleNextStep(supabase, enrollment, step.step_order as number, nextStepId);
        } else {
          await scheduleNextStep(supabase, enrollment, step.step_order as number);
        }
        
        return { success: true };
      }

      case 'profile_visit': {
        const visitResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        
        if (visitResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'profile_visits');
        }
        
        return { success: visitResponse.ok };
      }

      case 'smart_message':
      case 'inmail':
      case 'message': {
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        const needsInMail = !isConnected && (actionType === 'inmail' || actionType === 'smart_message');
        
        const formData = new FormData();
        formData.append('account_id', accountId);
        formData.append('attendees_ids', profileId);
        formData.append('text', messageText);
        
        if (needsInMail) {
          formData.append('linkedin[api]', 'recruiter');
          formData.append('linkedin[inmail]', 'true');
          if (subjectText) {
            formData.append('linkedin[subject]', subjectText);
          }
        }
        
        console.log(`[process-sequences] Sending ${needsInMail ? 'InMail' : 'message'} to ${profileId}`, {
          isConnected,
          needsInMail,
          hasSubject: !!subjectText,
          textLength: messageText.length,
        });
        
        const msgResponse = await fetch(`${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: { 'X-API-KEY': UNIPILE_API_KEY! },
          body: formData,
        });
        
        if (!msgResponse.ok) {
          const errorText = await msgResponse.text();
          console.error(`[process-sequences] Message send failed:`, msgResponse.status, errorText);
          return { success: false, error: `Unipile error ${msgResponse.status}: ${errorText}` };
        }
        
        const msgResult = await msgResponse.json();
        console.log(`[process-sequences] Message sent successfully:`, msgResult.id || msgResult.chat_id);
        
        await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        
        return { success: true, message: messageText, subject: needsInMail ? subjectText : undefined };
      }

      case 'connection_request': {
        let correctProviderId = profileId;
        const profileUrl = enrollment.profile_url as string | undefined;

        // deno-lint-ignore no-explicit-any
        const extractProviderId = (profileData: any): string | undefined => {
          return profileData?.provider_id || profileData?.providerId || profileData?.provider?.id || profileData?.provider?.provider_id;
        };

        const fetchProfile = async (identifier: string, source: string, linkedinApi?: 'recruiter' | 'sales_navigator') => {
          try {
            const url = new URL(`${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(identifier)}`);
            url.searchParams.set('account_id', accountId);
            if (linkedinApi) url.searchParams.set('linkedin_api', linkedinApi);

            const profileResponse = await fetch(url.toString(), {
              headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'accept': 'application/json' },
            });

            if (!profileResponse.ok) {
              console.warn(`[process-sequences] Could not fetch profile (${source}) for ${identifier}:`, profileResponse.status);
              return null;
            }

            return await profileResponse.json();
          } catch (err) {
            console.warn(`[process-sequences] Error fetching profile (${source}):`, err);
            return null;
          }
        };

        // deno-lint-ignore no-explicit-any
        const setProviderIdFromProfile = (profileData: any, source: string) => {
          const providerId = extractProviderId(profileData);
          if (providerId) {
            correctProviderId = providerId;
            console.log(`[process-sequences] Resolved provider_id (${source}): ${correctProviderId}`);
            return true;
          }
          console.warn(`[process-sequences] No provider_id in profile response (${source})`);
          return false;
        };

        // Resolve provider_id for invite endpoint
        if (typeof profileId === 'string' && !profileId.startsWith('ACo') && !profileId.startsWith('ADo')) {
          if (profileId.startsWith('AE') || profileId.startsWith('AEM')) {
            const recruiterProfile = await fetchProfile(profileId, 'recruiter_by_profile_id', 'recruiter');
            if (recruiterProfile) {
              setProviderIdFromProfile(recruiterProfile, 'recruiter_by_profile_id');

              const publicIdentifier = recruiterProfile.public_identifier as string | undefined;
              if (publicIdentifier && !correctProviderId.startsWith('ACo') && !correctProviderId.startsWith('ADo')) {
                console.log(`[process-sequences] Converting recruiter id -> classic provider_id using public_identifier: ${publicIdentifier}`);
                const classicProfile = await fetchProfile(publicIdentifier, 'classic_by_public_identifier');
                if (classicProfile) {
                  setProviderIdFromProfile(classicProfile, 'classic_by_public_identifier');
                }
              }
            }
          }

          if (!correctProviderId.startsWith('ACo') && !correctProviderId.startsWith('ADo') && profileUrl) {
            const match = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
            if (match) {
              const publicIdentifier = match[1];
              console.log(`[process-sequences] Fetching classic provider_id for public_identifier: ${publicIdentifier}`);
              const classicProfile = await fetchProfile(publicIdentifier, 'classic_by_public_identifier_fallback');
              if (classicProfile) {
                setProviderIdFromProfile(classicProfile, 'classic_by_public_identifier_fallback');
              }
            }
          }
        }

        if (typeof correctProviderId === 'string' && !correctProviderId.startsWith('ACo')) {
          console.warn(`[process-sequences] provider_id not resolved to ACo...; invite likely to fail`, {
            originalProfileId: profileId,
            resolvedProviderId: correctProviderId,
          });
        }
        
        const inviteBody: Record<string, string> = {
          account_id: accountId,
          provider_id: correctProviderId,
        };
        
        console.log(`[process-sequences] Sending connection request (no message)`, {
          originalProfileId: profileId,
          resolvedProviderId: correctProviderId,
        });
        
        const connectResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, {
          method: 'POST',
          headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'Content-Type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify(inviteBody),
        });
        
        if (!connectResponse.ok) {
          const errorText = await connectResponse.text();
          console.error(`[process-sequences] Invite failed:`, connectResponse.status, errorText);
          return { success: false, error: `Unipile invite error ${connectResponse.status}: ${errorText}` };
        }
        
        console.log(`[process-sequences] Invitation sent successfully to ${correctProviderId}`);
        await logAnalytics(supabase, enrollment.sequence_id as string, 'invites_sent');
        
        await supabase
          .from('sequence_enrollments')
          .update({ connection_status: 'pending_invite' })
          .eq('id', enrollment.id);
        
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}

// ============ ANALYTICS ============

// deno-lint-ignore no-explicit-any
async function logAnalytics(
  supabase: any,
  sequenceId: string,
  field: 'invites_sent' | 'invites_accepted' | 'messages_sent' | 'replies_received' | 'profile_visits'
) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: existing } = await supabase
      .from('sequence_analytics')
      .select('*')
      .eq('sequence_id', sequenceId)
      .eq('date', today)
      .maybeSingle();
    
    if (existing) {
      const currentValue = existing[field] || 0;
      await supabase
        .from('sequence_analytics')
        .update({ [field]: currentValue + 1 })
        .eq('id', existing.id);
    } else {
      await supabase.from('sequence_analytics').insert({
        sequence_id: sequenceId,
        date: today,
        [field]: 1,
      });
    }
  } catch (err) {
    console.error('Failed to log analytics:', err);
  }
}

// ============ SCHEDULING ============

// deno-lint-ignore no-explicit-any
async function scheduleNextStep(supabase: any, enrollment: any, currentStepOrder: number, forceBranchStepId?: string) {
  let nextStep;
  
  if (forceBranchStepId) {
    const { data } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('id', forceBranchStepId)
      .maybeSingle();
    nextStep = data;
  } else {
    const { data: currentStep } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', currentStepOrder)
      .maybeSingle();
    
    // Check if the current step is a branch target
    const { data: parentBranchSteps } = await supabase
      .from('sequence_steps')
      .select('id, step_order, if_true_goto_step, if_false_goto_step')
      .eq('sequence_id', enrollment.sequence_id)
      .or(`if_true_goto_step.eq.${currentStep?.id},if_false_goto_step.eq.${currentStep?.id}`);
    
    const isBranchTarget = parentBranchSteps && parentBranchSteps.length > 0;
    
    const { data } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', currentStepOrder + 1)
      .maybeSingle();
    nextStep = data;

    if (nextStep) {
      // Skip timeout branch targets in normal linear flow
      if (currentStep?.timeout_branch_step_id && nextStep.id === currentStep.timeout_branch_step_id) {
        console.log(`[process-sequences] Skipping timeout branch step ${nextStep.step_order}`);
        const { data: skipToStep } = await supabase
          .from('sequence_steps')
          .select('*')
          .eq('sequence_id', enrollment.sequence_id)
          .eq('step_order', currentStepOrder + 2)
          .maybeSingle();
        nextStep = skipToStep;
      }
      
      // Handle branch crossing
      if (isBranchTarget && nextStep) {
        const parentStep = parentBranchSteps[0];
        const trueBranchId = parentStep.if_true_goto_step;
        const falseBranchId = parentStep.if_false_goto_step;
        
        if (currentStep?.id === trueBranchId && nextStep.id === falseBranchId) {
          console.log(`[process-sequences] Marking sequence complete for this branch`);
          nextStep = null;
        } else if (currentStep?.id === falseBranchId && nextStep.id === trueBranchId) {
          console.log(`[process-sequences] Marking sequence complete for this branch`);
          nextStep = null;
        } else {
          const { data: nextStepParents } = await supabase
            .from('sequence_steps')
            .select('id, step_order, if_true_goto_step, if_false_goto_step')
            .eq('sequence_id', enrollment.sequence_id)
            .or(`if_true_goto_step.eq.${nextStep.id},if_false_goto_step.eq.${nextStep.id}`);
          
          if (nextStepParents && nextStepParents.length > 0) {
            const nextParent = nextStepParents[0];
            if (nextParent.id === parentStep.id) {
              console.log(`[process-sequences] Step ${nextStep.step_order} belongs to sibling branch, marking complete`);
              nextStep = null;
            }
          }
        }
      }
    }
  }

  if (!nextStep) {
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    return;
  }

  // Schedule with human-like randomization
  const userTimezone = enrollment.user_timezone || 'Europe/Paris';
  
  let scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
  scheduledAt.setDate(scheduledAt.getDate() + (nextStep.delay_days || 0));
  scheduledAt.setHours(scheduledAt.getHours() + (nextStep.delay_hours || 0));
  
  // Add random variation (+/- 0-5 minutes)
  const randomVariation = Math.floor(Math.random() * 10) - 5;
  scheduledAt.setMinutes(scheduledAt.getMinutes() + randomVariation);
  
  const preferredStart = nextStep.preferred_hour_start ?? 9;
  const preferredEnd = nextStep.preferred_hour_end ?? 18;
  
  // Adjust for business hours
  if (scheduledAt.getHours() < preferredStart) {
    scheduledAt.setHours(preferredStart, Math.floor(Math.random() * 30), 0);
  } else if (scheduledAt.getHours() >= preferredEnd) {
    scheduledAt.setDate(scheduledAt.getDate() + 1);
    scheduledAt.setHours(preferredStart, Math.floor(Math.random() * 30), 0);
  }

  // Skip weekends
  const day = scheduledAt.getDay();
  if (day === 0) scheduledAt.setDate(scheduledAt.getDate() + 1);
  if (day === 6) scheduledAt.setDate(scheduledAt.getDate() + 2);
  
  console.log(`[process-sequences] Scheduling next step ${nextStep.step_order} for ${scheduledAt.toISOString()}`);

  // Check for duplicate executions
  const { data: existingExecution } = await supabase
    .from('sequence_step_executions')
    .select('id, status')
    .eq('enrollment_id', enrollment.id)
    .eq('step_id', nextStep.id)
    .maybeSingle();

  if (existingExecution) {
    console.log(`[process-sequences] Execution already exists for step ${nextStep.step_order}, skipping duplicate`);
    return;
  }

  await supabase
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollment.id,
      step_id: nextStep.id,
      step_order: nextStep.step_order,
      scheduled_at: scheduledAt.toISOString(),
      status: 'scheduled',
    });
}

// ============ TIMEOUT BRANCHES ============

// deno-lint-ignore no-explicit-any
async function checkTimeoutBranches(supabase: any) {
  const { data: waitingExecutions } = await supabase
    .from('sequence_step_executions')
    .select(`
      *,
      enrollment:sequence_enrollments(*),
      step:sequence_steps(*)
    `)
    .eq('status', 'waiting_event')
    .not('step.timeout_days', 'is', null);

  if (!waitingExecutions?.length) return { checked: 0, branched: 0 };

  let branched = 0;

  for (const exec of waitingExecutions) {
    const step = exec.step;
    const enrollment = exec.enrollment;
    
    if (!step?.timeout_days || !enrollment) continue;

    const waitingSince = new Date(exec.created_at);
    const now = new Date();
    const daysPassed = Math.floor((now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPassed >= step.timeout_days) {
      if (step.timeout_branch_step_id) {
        await supabase
          .from('sequence_step_executions')
          .update({ 
            status: 'skipped', 
            skip_reason: `Timeout after ${step.timeout_days} days - branching`,
            executed_at: now.toISOString(),
          })
          .eq('id', exec.id);

        await scheduleNextStep(supabase, enrollment, step.step_order, step.timeout_branch_step_id);
        branched++;
      } else {
        await supabase
          .from('sequence_step_executions')
          .update({ 
            status: 'skipped', 
            skip_reason: `Timeout after ${step.timeout_days} days - no branch`,
            executed_at: now.toISOString(),
          })
          .eq('id', exec.id);

        await scheduleNextStep(supabase, enrollment, step.step_order);
      }
    }
  }

  return { checked: waitingExecutions.length, branched };
}
