
-- Candidate evaluations (scorecards)
CREATE TABLE public.candidate_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id text NOT NULL,
  job_id text,
  job_title text,
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
  comments jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_score numeric(3,1),
  ai_generated boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.candidate_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own evaluations"
  ON public.candidate_evaluations FOR SELECT
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create evaluations"
  ON public.candidate_evaluations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own evaluations"
  ON public.candidate_evaluations FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own evaluations"
  ON public.candidate_evaluations FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Service role can manage all evaluations"
  ON public.candidate_evaluations FOR ALL
  TO service_role
  USING (true);
