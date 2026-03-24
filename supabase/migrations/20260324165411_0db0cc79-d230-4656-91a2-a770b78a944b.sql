ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS recruiter_bio text,
  ADD COLUMN IF NOT EXISTS recruiter_headline text,
  ADD COLUMN IF NOT EXISTS public_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS linkedin_skills text[],
  ADD COLUMN IF NOT EXISTS years_experience integer;