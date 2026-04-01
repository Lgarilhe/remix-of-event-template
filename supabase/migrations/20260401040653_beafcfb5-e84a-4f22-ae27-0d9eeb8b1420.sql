
-- ============================================================================
-- PART 1: NEW TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS sequence_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  steps_config jsonb NOT NULL DEFAULT '[]',
  category text CHECK (category IN ('sourcing', 'nurturing', 'reactivation', 'custom')),
  is_system boolean DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequence_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  category text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequence_email_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES sequence_step_executions(id) ON DELETE CASCADE,
  tracking_id text UNIQUE NOT NULL,
  email_message_id text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- PART 2: ALTER outreach_sequences
-- ============================================================================

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS stop_conditions jsonb
    DEFAULT '{"on_reply": true, "on_click": false, "on_meeting_booked": false, "on_unsubscribe": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS sender_accounts jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rotation_mode text DEFAULT 'round_robin';

-- Add check constraint for rotation_mode only if not exists
DO $$ BEGIN
  ALTER TABLE outreach_sequences ADD CONSTRAINT outreach_sequences_rotation_mode_check
    CHECK (rotation_mode IN ('round_robin', 'random', 'least_used'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 3: ALTER sequence_steps
-- ============================================================================

ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_sequence_id_step_order_key;

ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS condition_value text,
  ADD COLUMN IF NOT EXISTS variant_group text,
  ADD COLUMN IF NOT EXISTS variant_weight integer DEFAULT 100;

-- Expand action_type CHECK to include 'email'
ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_action_type_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'inmail','connection_request','profile_visit','message','smart_message',
    'wait_connection','wait_reply','wait_profile_visit','condition_branch',
    'check_connection','email'
  ]));

-- Expand condition_type CHECK
ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_condition_type_check;
ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_condition_type_check
  CHECK (condition_type IN (
    'always','if_connected','if_not_connected','if_no_response',
    'if_email_opened','if_email_not_opened','if_link_clicked','if_link_not_clicked',
    'if_has_email','if_no_email','if_has_phone','if_no_phone',
    'if_unsubscribed','if_bounced','if_score_above'
  ));

-- ============================================================================
-- PART 4: ALTER sequence_enrollments
-- ============================================================================

ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS assigned_sender_id uuid;

-- Expand status CHECK to include 'stopped'
ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;
ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'cancelled', 'stopped'));

-- ============================================================================
-- PART 5: ALTER sequence_step_executions
-- ============================================================================

ALTER TABLE sequence_step_executions
  ADD COLUMN IF NOT EXISTS variant_assigned text;

-- Expand status CHECK
ALTER TABLE sequence_step_executions DROP CONSTRAINT IF EXISTS sequence_step_executions_status_check;
ALTER TABLE sequence_step_executions ADD CONSTRAINT sequence_step_executions_status_check
  CHECK (status = ANY (ARRAY[
    'scheduled','skipped','sending','sent','failed','cancelled',
    'waiting_event','quota_blocked','opened','clicked','replied','bounced'
  ]));

-- ============================================================================
-- PART 6: ALTER sequence_analytics
-- ============================================================================

ALTER TABLE sequence_analytics
  ADD COLUMN IF NOT EXISTS emails_sent integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_opened integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_clicked integer DEFAULT 0;

-- ============================================================================
-- PART 7: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sequence_steps_parent_step_id
  ON sequence_steps(parent_step_id) WHERE parent_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_company_reply
  ON sequence_enrollments(company_name, sequence_id) WHERE status = 'active' AND company_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_tracking_id
  ON sequence_email_tracking(tracking_id);

CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_message_id
  ON sequence_email_tracking(email_message_id) WHERE email_message_id IS NOT NULL;

-- ============================================================================
-- PART 8: RLS POLICIES
-- ============================================================================

ALTER TABLE sequence_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "sequence_templates_select" ON sequence_templates
    FOR SELECT USING (organization_id = public.get_user_org_id(auth.uid()) OR is_system = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_templates_insert" ON sequence_templates
    FOR INSERT WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_templates_update" ON sequence_templates
    FOR UPDATE USING (organization_id = public.get_user_org_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_templates_delete" ON sequence_templates
    FOR DELETE USING (organization_id = public.get_user_org_id(auth.uid()) AND is_system = false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_templates_service_role" ON sequence_templates
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sequence_snippets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "sequence_snippets_select" ON sequence_snippets
    FOR SELECT USING (organization_id = public.get_user_org_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_snippets_insert" ON sequence_snippets
    FOR INSERT WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_snippets_update" ON sequence_snippets
    FOR UPDATE USING (organization_id = public.get_user_org_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_snippets_delete" ON sequence_snippets
    FOR DELETE USING (organization_id = public.get_user_org_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_snippets_service_role" ON sequence_snippets
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sequence_email_tracking ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "sequence_email_tracking_service_role" ON sequence_email_tracking
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sequence_email_tracking_anon_select" ON sequence_email_tracking
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
