-- Create email tracking table (missing from previous migration)
CREATE TABLE IF NOT EXISTS sequence_email_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES sequence_step_executions(id) ON DELETE CASCADE,
  tracking_id text UNIQUE NOT NULL,
  email_message_id text,
  created_at timestamptz DEFAULT now()
);

-- Add missing columns to sequence_analytics
ALTER TABLE sequence_analytics
  ADD COLUMN IF NOT EXISTS emails_sent integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_opened integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_clicked integer DEFAULT 0;

-- Add missing columns to sequence_step_executions (if not present)
ALTER TABLE sequence_step_executions
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS tracking_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_snippet text,
  ADD COLUMN IF NOT EXISTS personalized_subject text;

-- Add missing columns to outreach_sequences
ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS stop_on_company_reply boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS multi_sender_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES sequence_templates(id) ON DELETE SET NULL;

-- Indexes for email tracking
CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_tracking_id
  ON sequence_email_tracking(tracking_id);

CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_message_id
  ON sequence_email_tracking(email_message_id)
  WHERE email_message_id IS NOT NULL;

-- RLS for sequence_email_tracking
ALTER TABLE sequence_email_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sequence_email_tracking_service_role" ON sequence_email_tracking;
CREATE POLICY "sequence_email_tracking_service_role" ON sequence_email_tracking
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "sequence_email_tracking_anon_select" ON sequence_email_tracking;
CREATE POLICY "sequence_email_tracking_anon_select" ON sequence_email_tracking
  FOR SELECT USING (true);