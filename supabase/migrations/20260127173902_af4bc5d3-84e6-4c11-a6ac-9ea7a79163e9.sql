-- Create cache table for AI-extracted job skills
CREATE TABLE public.job_skills_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  skills TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'ai', -- 'ai' or 'notion'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_job_skills_cache_job_id ON public.job_skills_cache(job_id);

-- Enable RLS
ALTER TABLE public.job_skills_cache ENABLE ROW LEVEL SECURITY;

-- Allow edge functions to read/write (service role)
-- Public read access for authenticated users
CREATE POLICY "Anyone can read skills cache"
ON public.job_skills_cache
FOR SELECT
USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can manage skills cache"
ON public.job_skills_cache
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_job_skills_cache_updated_at
BEFORE UPDATE ON public.job_skills_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();