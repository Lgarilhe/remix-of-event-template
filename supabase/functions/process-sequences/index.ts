import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
            const shouldExecute = await checkStepCondition(
              supabase,
              step.condition_type,
              enrollment.account_id,
              enrollment.profile_id
            );

            if (!shouldExecute) {
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
              exec
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
  supabase: any,
  conditionType: string,
  accountId: string,
  profileId: string
): Promise<boolean> {
  switch (conditionType) {
    case 'always':
      return true;
    case 'if_connected':
      // TODO: Check connection status via Unipile API
      return true;
    case 'if_not_connected':
      // TODO: Check connection status via Unipile API
      return true;
    case 'if_no_response':
      // TODO: Check message history via Unipile API
      return true;
    default:
      return true;
  }
}

async function executeStepAction(
  actionType: string,
  enrollment: any,
  step: any,
  execution: any
): Promise<{ success: boolean; error?: string; subject?: string; message?: string }> {
  const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
  const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN');

  try {
    switch (actionType) {
      case 'profile_visit':
        // Visit profile via Unipile
        const visitResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/${enrollment.profile_id}`, {
          headers: { 'X-API-KEY': UNIPILE_API_KEY! },
        });
        return { success: visitResponse.ok };

      case 'inmail':
      case 'message':
        // Send message via Unipile
        const messageBody = {
          account_id: enrollment.account_id,
          attendee_provider_id: enrollment.profile_id,
          text: execution.final_message || step.message_template,
        };
        
        const msgResponse = await fetch(`${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageBody),
        });
        
        return { 
          success: msgResponse.ok,
          message: execution.final_message || step.message_template,
        };

      case 'connection_request':
        // Send connection request via Unipile
        const connectBody = {
          account_id: enrollment.account_id,
          provider_id: enrollment.profile_id,
          message: step.message_template,
        };
        
        const connectResponse = await fetch(`${UNIPILE_DSN}/api/v1/users/invite`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(connectBody),
        });
        
        return { success: connectResponse.ok };

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}

async function scheduleNextStep(supabase: any, enrollment: any, currentStepOrder: number) {
  // Get next step
  const { data: nextStep } = await supabase
    .from('sequence_steps')
    .select('*')
    .eq('sequence_id', enrollment.sequence_id)
    .eq('step_order', currentStepOrder + 1)
    .maybeSingle();

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

async function checkForReply(accountId: string, profileId: string): Promise<boolean> {
  // TODO: Implement reply detection via Unipile API
  return false;
}
