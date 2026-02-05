/**
 * Step Scheduling Utilities
 */

// deno-lint-ignore no-explicit-any
export async function scheduleNextStep(
  supabase: any, 
  enrollment: any, 
  currentStepOrder: number, 
  forceBranchStepId?: string
): Promise<void> {
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

// deno-lint-ignore no-explicit-any
export async function checkTimeoutBranches(supabase: any): Promise<{ checked: number; branched: number }> {
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
