-- Nouvelles colonnes pour sequence_steps (timeout et événements)
ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS timeout_days integer DEFAULT NULL;
ALTER TABLE sequence_steps ADD COLUMN IF NOT EXISTS wait_for_event text DEFAULT NULL;

-- Nouvelles colonnes pour sequence_enrollments (tracking connexion)
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS last_check_at timestamptz DEFAULT NULL;
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS connection_status text DEFAULT 'unknown';

-- Table pour les statistiques de séquence
CREATE TABLE IF NOT EXISTS sequence_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  date date NOT NULL,
  invites_sent integer DEFAULT 0,
  invites_accepted integer DEFAULT 0,
  messages_sent integer DEFAULT 0,
  replies_received integer DEFAULT 0,
  profile_visits integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sequence_id, date)
);

-- Enable RLS on sequence_analytics
ALTER TABLE sequence_analytics ENABLE ROW LEVEL SECURITY;

-- Users can view analytics for their own sequences
CREATE POLICY "Users can view their sequence analytics"
ON sequence_analytics FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM outreach_sequences
    WHERE outreach_sequences.id = sequence_analytics.sequence_id
    AND outreach_sequences.created_by = auth.uid()
  )
);

-- Service role can manage all analytics
CREATE POLICY "Service role can manage all analytics"
ON sequence_analytics FOR ALL
USING (auth.role() = 'service_role');