
ALTER TABLE public.sequence_enrollments ADD COLUMN IF NOT EXISTS resolved_profile_id text;

-- Backfill: no data yet, will be populated by edge function
CREATE INDEX IF NOT EXISTS idx_enrollments_resolved_profile_id ON public.sequence_enrollments(resolved_profile_id) WHERE resolved_profile_id IS NOT NULL;
