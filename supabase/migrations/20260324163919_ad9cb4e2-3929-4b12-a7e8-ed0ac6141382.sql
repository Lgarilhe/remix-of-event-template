ALTER TABLE public.organizations 
  ADD COLUMN IF NOT EXISTS team_size text,
  ADD COLUMN IF NOT EXISTS discovery_source text,
  ADD COLUMN IF NOT EXISTS annual_hires text;