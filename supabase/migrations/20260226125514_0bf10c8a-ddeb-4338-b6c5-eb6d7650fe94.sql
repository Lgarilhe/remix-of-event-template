
-- Add 'waiting_event' and 'quota_blocked' to the status check constraint
ALTER TABLE sequence_step_executions DROP CONSTRAINT IF EXISTS sequence_step_executions_status_check;
ALTER TABLE sequence_step_executions ADD CONSTRAINT sequence_step_executions_status_check 
  CHECK (status = ANY (ARRAY['scheduled', 'skipped', 'sending', 'sent', 'failed', 'cancelled', 'waiting_event', 'quota_blocked']));
