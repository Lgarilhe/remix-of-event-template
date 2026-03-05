ALTER TABLE public.candidate_evaluations 
  ADD COLUMN IF NOT EXISTS recommendation text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS follow_up_notes text,
  ADD COLUMN IF NOT EXISTS interview_stage text;