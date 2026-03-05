CREATE TABLE public.call_coaching_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id text NOT NULL,
  job_id text NOT NULL,
  scorecard_id text NOT NULL,
  transcript text DEFAULT '',
  coach_feed jsonb DEFAULT '[]'::jsonb,
  criteria_detected jsonb DEFAULT '{}'::jsonb,
  alerts_log jsonb DEFAULT '[]'::jsonb,
  report jsonb,
  duration_seconds integer DEFAULT 0,
  status text DEFAULT 'recording',
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_coaching_candidate ON public.call_coaching_sessions(candidate_id, created_at DESC);

ALTER TABLE public.call_coaching_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own coaching sessions"
  ON public.call_coaching_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own coaching sessions"
  ON public.call_coaching_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own coaching sessions"
  ON public.call_coaching_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own coaching sessions"
  ON public.call_coaching_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Service role can manage all coaching sessions"
  ON public.call_coaching_sessions FOR ALL
  TO service_role
  USING (true);