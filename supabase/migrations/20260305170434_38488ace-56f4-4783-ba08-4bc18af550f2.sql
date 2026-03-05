
-- Add new columns to candidate_portal_tokens for enhanced portal
ALTER TABLE public.candidate_portal_tokens
  ADD COLUMN IF NOT EXISTS recruiter_name text,
  ADD COLUMN IF NOT EXISTS recruiter_email text,
  ADD COLUMN IF NOT EXISTS recruiter_phone text,
  ADD COLUMN IF NOT EXISTS company_logo_url text,
  ADD COLUMN IF NOT EXISTS company_description text,
  ADD COLUMN IF NOT EXISTS stage_updated_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS estimated_days_to_next integer,
  ADD COLUMN IF NOT EXISTS documents jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS faq jsonb DEFAULT '[]'::jsonb;
