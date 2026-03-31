-- ============================================================================
-- Migration: Enhance Sequences Module
-- Adds: email channel, tree branching, templates, snippets, email tracking,
--       multi-sender, company reply stops, AI personalization enhancements
-- All changes are ADDITIVE — no existing columns/tables removed or renamed.
-- ============================================================================

-- ============================================================================
-- 1. NEW TABLES (created first so FKs can reference them)
-- ============================================================================

-- Sequence templates: reusable sequence configurations
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

-- Sequence snippets: reusable text blocks for messages
CREATE TABLE IF NOT EXISTS sequence_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  category text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Email tracking: pixel opens + link clicks
CREATE TABLE IF NOT EXISTS sequence_email_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES sequence_step_executions(id) ON DELETE CASCADE,
  tracking_id text UNIQUE NOT NULL,
  email_message_id text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 2. ALTER TABLE outreach_sequences
-- ============================================================================

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS stop_on_company_reply boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS multi_sender_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES sequence_templates(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. ALTER TABLE sequence_steps
-- ============================================================================

-- Drop the UNIQUE constraint on (sequence_id, step_order) — incompatible with
-- tree branching where sibling branches share step_order values
ALTER TABLE sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_sequence_id_step_order_key;

-- Add new columns
ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS parent_step_id uuid REFERENCES sequence_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch text CHECK (branch IN ('yes', 'no')),
  ADD COLUMN IF NOT EXISTS step_channel text CHECK (step_channel IN ('email', 'linkedin', 'call', 'manual')),
  ADD COLUMN IF NOT EXISTS ai_personalization_source text DEFAULT 'profile_only' CHECK (ai_personalization_source IN ('profile_only', 'rag_full', 'rag_notes_only')),
  ADD COLUMN IF NOT EXISTS ai_personalization_prompt text,
  ADD COLUMN IF NOT EXISTS sender_id uuid,
  ADD COLUMN IF NOT EXISTS include_unsubscribe boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS signature_id uuid,
  ADD COLUMN IF NOT EXISTS cc_emails text[],
  ADD COLUMN IF NOT EXISTS bcc_emails text[];

-- Expand action_type CHECK to include 'email'
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
    'email'::text
  ]));

-- ============================================================================
-- 4. ALTER TABLE sequence_enrollments
-- ============================================================================

ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS email_used text,
  ADD COLUMN IF NOT EXISTS label text CHECK (label IN ('interested', 'not_interested')),
  ADD COLUMN IF NOT EXISTS company_name text;

-- Expand status CHECK to include 'stopped'
ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;
ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'cancelled', 'stopped'));

-- ============================================================================
-- 5. ALTER TABLE sequence_step_executions
-- ============================================================================

ALTER TABLE sequence_step_executions
  ADD COLUMN IF NOT EXISTS channel text CHECK (channel IN ('email', 'linkedin', 'call', 'manual')),
  ADD COLUMN IF NOT EXISTS tracking_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_snippet text,
  ADD COLUMN IF NOT EXISTS personalized_subject text;

-- Expand status CHECK to include email tracking statuses
ALTER TABLE sequence_step_executions DROP CONSTRAINT IF EXISTS sequence_step_executions_status_check;
ALTER TABLE sequence_step_executions ADD CONSTRAINT sequence_step_executions_status_check
  CHECK (status = ANY (ARRAY[
    'scheduled'::text, 'skipped'::text, 'sending'::text, 'sent'::text,
    'failed'::text, 'cancelled'::text, 'waiting_event'::text, 'quota_blocked'::text,
    'opened'::text, 'clicked'::text, 'replied'::text, 'bounced'::text
  ]));

-- ============================================================================
-- 6. ALTER TABLE sequence_analytics
-- ============================================================================

ALTER TABLE sequence_analytics
  ADD COLUMN IF NOT EXISTS emails_sent integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_opened integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_clicked integer DEFAULT 0;

-- ============================================================================
-- 7. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sequence_steps_parent_step_id
  ON sequence_steps(parent_step_id)
  WHERE parent_step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_company_reply
  ON sequence_enrollments(company_name, sequence_id)
  WHERE status = 'active' AND company_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_tracking_id
  ON sequence_email_tracking(tracking_id);

CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_message_id
  ON sequence_email_tracking(email_message_id)
  WHERE email_message_id IS NOT NULL;

-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================

-- sequence_templates
ALTER TABLE sequence_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sequence_templates_select" ON sequence_templates
  FOR SELECT USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR is_system = true
  );

CREATE POLICY "sequence_templates_insert" ON sequence_templates
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "sequence_templates_update" ON sequence_templates
  FOR UPDATE USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "sequence_templates_delete" ON sequence_templates
  FOR DELETE USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND is_system = false
  );

CREATE POLICY "sequence_templates_service_role" ON sequence_templates
  FOR ALL USING (auth.role() = 'service_role');

-- sequence_snippets
ALTER TABLE sequence_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sequence_snippets_select" ON sequence_snippets
  FOR SELECT USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "sequence_snippets_insert" ON sequence_snippets
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "sequence_snippets_update" ON sequence_snippets
  FOR UPDATE USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "sequence_snippets_delete" ON sequence_snippets
  FOR DELETE USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "sequence_snippets_service_role" ON sequence_snippets
  FOR ALL USING (auth.role() = 'service_role');

-- sequence_email_tracking (service_role only — accessed via edge functions)
ALTER TABLE sequence_email_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sequence_email_tracking_service_role" ON sequence_email_tracking
  FOR ALL USING (auth.role() = 'service_role');

-- Allow anon access for the tracking pixel/redirect endpoint (no auth)
CREATE POLICY "sequence_email_tracking_anon_select" ON sequence_email_tracking
  FOR SELECT USING (true);
