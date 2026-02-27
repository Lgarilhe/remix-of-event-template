-- Add column to store full LinkedIn profile data snapshot
ALTER TABLE public.job_candidate_status 
ADD COLUMN IF NOT EXISTS linkedin_profile_data jsonb DEFAULT NULL;