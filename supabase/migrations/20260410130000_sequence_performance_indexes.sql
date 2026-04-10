-- Sprint 3: Performance indexes for sequence processing
-- These tables are queried heavily by process-sequences, unipile-webhook, and UI components

-- sequence_step_executions: queried by enrollment_id + status in every processing cycle
CREATE INDEX IF NOT EXISTS idx_step_exec_enrollment_status
  ON public.sequence_step_executions(enrollment_id, status);

-- sequence_step_executions: partial index for scheduled items (the main processing query)
CREATE INDEX IF NOT EXISTS idx_step_exec_scheduled
  ON public.sequence_step_executions(status, scheduled_at)
  WHERE status = 'scheduled';

-- sequence_step_executions: for webhook lookups by step_id
CREATE INDEX IF NOT EXISTS idx_step_exec_step_id
  ON public.sequence_step_executions(step_id);

-- sequence_enrollments: webhook queries by account_id + status
CREATE INDEX IF NOT EXISTS idx_enrollments_account_status
  ON public.sequence_enrollments(account_id, status);

-- sequence_enrollments: webhook queries by profile_id and resolved_profile_id
CREATE INDEX IF NOT EXISTS idx_enrollments_profile_id
  ON public.sequence_enrollments(profile_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_resolved_profile
  ON public.sequence_enrollments(resolved_profile_id)
  WHERE resolved_profile_id IS NOT NULL;

-- organization_id indexes for core tables (RLS performance)
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_org
  ON public.outreach_sequences(organization_id);
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_org
  ON public.sequence_enrollments(organization_id);
CREATE INDEX IF NOT EXISTS idx_sequence_step_executions_org
  ON public.sequence_step_executions(organization_id);
CREATE INDEX IF NOT EXISTS idx_inmail_queue_org
  ON public.inmail_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_candidate_evaluations_org
  ON public.candidate_evaluations(organization_id);
