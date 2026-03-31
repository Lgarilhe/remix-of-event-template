-- ============================================================================
-- Migration: Enrich Sequence Conditions, Stop Conditions, A/B Testing, Rotation
-- Adds Lemlist-level depth to the sequence engine.
-- ============================================================================

-- ============================================================================
-- 1. EXPAND condition_type CHECK (11 new condition types)
-- ============================================================================

ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_condition_type_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_condition_type_check
  CHECK (condition_type IN (
    -- Existing
    'always',
    'if_connected', 'if_not_connected',
    'if_no_response',
    -- Email engagement
    'if_email_opened', 'if_email_not_opened',
    'if_link_clicked', 'if_link_not_clicked',
    -- Data availability
    'if_has_email', 'if_no_email',
    'if_has_phone', 'if_no_phone',
    -- Status-based
    'if_unsubscribed',
    'if_bounced',
    -- Scoring
    'if_score_above'
  ));

-- ============================================================================
-- 2. CONDITION VALUE (parameterized conditions)
-- ============================================================================

ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS condition_value text;
  -- if_score_above → threshold (e.g. "70")
  -- if_email_opened → optionally step_id to check specific email
  -- if_link_clicked → optionally URL pattern to match

-- ============================================================================
-- 3. STOP CONDITIONS (sequence-level, configurable)
-- ============================================================================

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS stop_conditions jsonb
    DEFAULT '{"on_reply": true, "on_click": false, "on_meeting_booked": false, "on_unsubscribe": true}'::jsonb;

-- ============================================================================
-- 4. A/B TESTING
-- ============================================================================

-- Steps can belong to a variant group (A, B, C...)
ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS variant_group text,
  ADD COLUMN IF NOT EXISTS variant_weight integer DEFAULT 100;

-- Track which variant was assigned per execution
ALTER TABLE sequence_step_executions
  ADD COLUMN IF NOT EXISTS variant_assigned text;

-- ============================================================================
-- 5. INBOX ROTATION (multi-sender)
-- ============================================================================

-- Lock a sender to an enrollment for consistency
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS assigned_sender_id uuid;

-- Sender pool and rotation mode at sequence level
ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS sender_accounts jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rotation_mode text DEFAULT 'round_robin'
    CHECK (rotation_mode IN ('round_robin', 'random', 'least_used'));
