-- ============================================================================
-- Migration: Add WhatsApp channel support to sequences
-- ============================================================================

-- 1. Expand action_type CHECK to include whatsapp_message
ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_action_type_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'inmail'::text,
    'connection_request'::text,
    'profile_visit'::text,
    'message'::text,
    'smart_message'::text,
    'wait_connection'::text,
    'wait_reply'::text,
    'wait_profile_visit'::text,
    'condition_branch'::text,
    'check_connection'::text,
    'email'::text,
    'whatsapp_message'::text
  ]));

-- 2. Expand step_channel CHECK to include whatsapp
ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_step_channel_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_step_channel_check
  CHECK (step_channel IN ('email', 'linkedin', 'call', 'manual', 'whatsapp'));

-- 3. Expand execution channel CHECK
ALTER TABLE sequence_step_executions DROP CONSTRAINT IF EXISTS sequence_step_executions_channel_check;
ALTER TABLE sequence_step_executions ADD CONSTRAINT sequence_step_executions_channel_check
  CHECK (channel IN ('email', 'linkedin', 'call', 'manual', 'whatsapp'));

-- 4. Add phone_used to enrollments (WhatsApp needs a phone number)
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS phone_used text;
