import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN_RAW = Deno.env.get('UNIPILE_DSN') || '';
// Ensure DSN has https:// prefix
const UNIPILE_DSN = UNIPILE_DSN_RAW.startsWith('http') ? UNIPILE_DSN_RAW : `https://${UNIPILE_DSN_RAW}`;

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
        // Find scheduled steps ready to execute
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

        const results = { processed: 0, skipped: 0, failed: 0 };

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

            // Check conditions
            const conditionResult = await checkStepCondition(
              supabase,
              step.condition_type,
              enrollment.account_id,
              enrollment.profile_id,
              step.wait_for_event
            );

            if (conditionResult === 'wait') {
              // Put execution in waiting state
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
              
              // Schedule next step
              await scheduleNextStep(supabase, enrollment, step.step_order);
              continue;
            }

            // Mark as sending
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'sending' })
              .eq('id', exec.id);

            // Execute the action
            const executeResult = await executeStepAction(
              step.action_type,
              enrollment,
              step,
              exec,
              supabase
            );

            if (executeResult.success) {
              await supabase
                .from('sequence_step_executions')
                .update({ 
                  status: 'sent', 
                  executed_at: now,
                  final_subject: executeResult.subject,
                  final_message: executeResult.message,
                })
                .eq('id', exec.id);
              
              // Update enrollment progress
              await supabase
                .from('sequence_enrollments')
                .update({ current_step_order: step.step_order + 1 })
                .eq('id', enrollment.id);

              // Schedule next step
              await scheduleNextStep(supabase, enrollment, step.step_order);
              
              results.processed++;
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
        // Check for replies to pause sequences
        const { data: activeEnrollments } = await supabase
          .from('sequence_enrollments')
          .select('*')
          .eq('status', 'active');

        let repliesDetected = 0;

        for (const enrollment of activeEnrollments || []) {
          const hasReply = await checkForReply(enrollment.account_id, enrollment.profile_id);
          
          if (hasReply) {
            await supabase
              .from('sequence_enrollments')
              .update({ 
                status: 'replied', 
                replied_at: new Date().toISOString(),
              })
              .eq('id', enrollment.id);
            
            // Cancel pending executions
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
        // Check for steps waiting too long and branch accordingly
        const timeoutResults = await checkTimeoutBranches(supabase);
        return new Response(JSON.stringify({ success: true, ...timeoutResults }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check_wait_events': {
        // Check enrollments waiting for events (connection accepted, etc.)
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
            // Event occurred! Execute the step
            await supabase
              .from('sequence_step_executions')
              .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
              .eq('id', exec.id);
            
            // Update connection status if applicable
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

async function checkStepCondition(
  _supabase: unknown,
  conditionType: string,
  accountId: string,
  profileId: string,
  waitForEvent?: string
): Promise<boolean | 'wait'> {
  switch (conditionType) {
    case 'always':
      return true;

    case 'if_connected': {
      // Check if connected (1st degree) via Unipile API
      const profile = await getProfileInfo(accountId, profileId);
      return profile?.network_distance === 'FIRST_DEGREE';
    }

    case 'if_not_connected': {
      // Check if NOT connected via Unipile API
      const profile = await getProfileInfo(accountId, profileId);
      return profile?.network_distance !== 'FIRST_DEGREE';
    }

    case 'if_no_response': {
      // Check if no response received via Unipile API
      const hasReply = await checkHasProspectReplied(accountId, profileId);
      return !hasReply;
    }

    case 'wait_until_connected': {
      // Check if connected, if not return 'wait' to pause execution
      const profile = await getProfileInfo(accountId, profileId);
      if (profile?.network_distance === 'FIRST_DEGREE') {
        return true;
      }
      // Not connected yet - put in waiting state
      return 'wait';
    }

    case 'wait_for_event': {
      // Custom wait for specific event
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

// Helper: Get profile info from Unipile
async function getProfileInfo(accountId: string, profileId: string): Promise<{
  network_distance?: string;
} | null> {
  try {
    const response = await fetch(
      `${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Helper: Check if prospect has replied
async function checkHasProspectReplied(accountId: string, profileId: string): Promise<boolean> {
  try {
    // Get chats with this attendee
    const chatsResponse = await fetch(
      `${UNIPILE_DSN}/api/v1/chat_attendees/${profileId}/chats?account_id=${accountId}`,
      { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
    );
    
    if (!chatsResponse.ok) return false;
    
    const chatsData = await chatsResponse.json();
    const chats = chatsData.items || [];
    
    if (chats.length === 0) return false;

    // Check messages in each chat
    for (const chat of chats) {
      const messagesResponse = await fetch(
        `${UNIPILE_DSN}/api/v1/chats/${chat.id}/messages?limit=20`,
        { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
      );
      
      if (!messagesResponse.ok) continue;
      
      const messagesData = await messagesResponse.json();
      const messages = messagesData.items || [];
      
      // Find messages from the prospect (not from self)
      const prospectMessages = messages.filter((m: { is_sender_self?: boolean; sender_attendee_id?: string }) => 
        !m.is_sender_self && m.sender_attendee_id !== 'self'
      );
      
      if (prospectMessages.length > 0) {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

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
    const subjectText = (step.subject_template || '') as string;

    switch (actionType) {
      case 'check_connection': {
        // Check if connected and route accordingly
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        
        const nextStepId = isConnected 
          ? (step.if_true_goto_step as string | undefined) 
          : (step.if_false_goto_step as string | undefined);
        
        // Update enrollment connection status
        await supabase
          .from('sequence_enrollments')
          .update({ connection_status: isConnected ? 'connected' : 'not_connected' })
          .eq('id', enrollment.id);
        
        // Schedule next step based on branch
        if (nextStepId) {
          await scheduleNextStep(supabase, enrollment, step.step_order as number, nextStepId);
        } else {
          await scheduleNextStep(supabase, enrollment, step.step_order as number);
        }
        
        return { success: true };
      }

      case 'profile_visit': {
        // Visit profile via Unipile
        const visitResponse = await fetch(
          `${UNIPILE_DSN}/api/v1/users/${profileId}?account_id=${accountId}`,
          { headers: { 'X-API-KEY': UNIPILE_API_KEY! } }
        );
        
        // Log analytics
        if (visitResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'profile_visits');
        }
        
        return { success: visitResponse.ok };
      }

      case 'smart_message':
      case 'inmail':
      case 'message': {
        // Auto-detect: check connection status to decide InMail vs Direct message
        const profile = await getProfileInfo(accountId, profileId);
        const isConnected = profile?.network_distance === 'FIRST_DEGREE';
        
        // Build message body - Unipile API format
        const messageBody: Record<string, unknown> = {
          account_id: accountId,
          attendees: [{ provider_id: profileId }],
          text: messageText,
        };
        
        // Add subject for InMail (only if not connected)
        if (!isConnected && subjectText) {
          messageBody.subject = subjectText;
        }
        
        const msgResponse = await fetch(`${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageBody),
        });
        
        if (msgResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'messages_sent');
        }
        
        return { 
          success: msgResponse.ok,
          message: messageText,
          subject: !isConnected ? subjectText : undefined,
        };
      }

      case 'connection_request': {
        // Send connection request via Unipile
        const connectBody: Record<string, unknown> = {
          account_id: accountId,
          provider_id: profileId,
        };
        
        if (messageText) {
          connectBody.message = messageText;
        }
        
        const connectResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(connectBody),
        });
        
        if (connectResponse.ok) {
          await logAnalytics(supabase, enrollment.sequence_id as string, 'invites_sent');
          
          // Update enrollment connection status to pending
          await supabase
            .from('sequence_enrollments')
            .update({ connection_status: 'pending_invite' })
            .eq('id', enrollment.id);
        }
        
        return { success: connectResponse.ok };
      }

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}

// Helper: Log analytics
// deno-lint-ignore no-explicit-any
async function logAnalytics(
  supabase: any,
  sequenceId: string,
  field: 'invites_sent' | 'invites_accepted' | 'messages_sent' | 'replies_received' | 'profile_visits'
) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Try to get existing record
    const { data: existing } = await supabase
      .from('sequence_analytics')
      .select('*')
      .eq('sequence_id', sequenceId)
      .eq('date', today)
      .maybeSingle();
    
    if (existing) {
      // Update existing - increment the field
      const currentValue = existing[field] || 0;
      await supabase
        .from('sequence_analytics')
        .update({ [field]: currentValue + 1 })
        .eq('id', existing.id);
    } else {
      // Insert new
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

async function scheduleNextStep(supabase: any, enrollment: any, currentStepOrder: number, forceBranchStepId?: string) {
  let nextStep;
  
  if (forceBranchStepId) {
    // Force branch to a specific step (timeout branch)
    const { data } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('id', forceBranchStepId)
      .maybeSingle();
    nextStep = data;
  } else {
    // Get next step in sequence order
    const { data } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_order', currentStepOrder + 1)
      .maybeSingle();
    nextStep = data;
  }

  if (!nextStep) {
    // Sequence complete
    await supabase
      .from('sequence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    return;
  }

  // Calculate next execution time
  const scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
  scheduledAt.setDate(scheduledAt.getDate() + (nextStep.delay_days || 0));
  scheduledAt.setHours(scheduledAt.getHours() + (nextStep.delay_hours || 0));
  
  // Adjust to preferred window
  const preferredStart = nextStep.preferred_hour_start ?? 9;
  const preferredEnd = nextStep.preferred_hour_end ?? 18;
  
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

// Check wait_until_connected steps for timeout and branch
async function checkTimeoutBranches(supabase: any) {
  // Get enrollments waiting for connection with timeout configured
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

    // Check if timeout has passed
    const waitingSince = new Date(exec.created_at);
    const now = new Date();
    const daysPassed = Math.floor((now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));

    if (daysPassed >= step.timeout_days) {
      // Timeout reached!
      if (step.timeout_branch_step_id) {
        // Branch to alternative step
        await supabase
          .from('sequence_step_executions')
          .update({ 
            status: 'skipped', 
            skip_reason: `Timeout after ${step.timeout_days} days - branching to alternative`,
            executed_at: now.toISOString(),
          })
          .eq('id', exec.id);

        // Schedule the timeout branch step
        await scheduleNextStep(supabase, enrollment, step.step_order, step.timeout_branch_step_id);
        branched++;
      } else {
        // No branch configured, just skip and continue
        await supabase
          .from('sequence_step_executions')
          .update({ 
            status: 'skipped', 
            skip_reason: `Timeout after ${step.timeout_days} days - no branch configured`,
            executed_at: now.toISOString(),
          })
          .eq('id', exec.id);

        await scheduleNextStep(supabase, enrollment, step.step_order);
      }
    }
  }

  return { checked: waitingExecutions.length, branched };
}

async function checkForReply(accountId: string, profileId: string): Promise<boolean> {
  return await checkHasProspectReplied(accountId, profileId);
}
