ALTER TABLE public.sequence_enrollments 
  ADD COLUMN IF NOT EXISTS network_distance text,
  ADD COLUMN IF NOT EXISTS provider_id text;