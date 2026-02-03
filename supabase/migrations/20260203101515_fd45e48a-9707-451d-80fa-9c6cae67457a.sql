-- Table to track candidate status per job (sourcing activity)
CREATE TABLE public.job_candidate_status (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id text NOT NULL,
  candidate_id text NOT NULL,
  linkedin_profile_url text,
  candidate_name text,
  candidate_headline text,
  
  -- Status: 'dismissed' (écarté), 'messaged' (contacté), 'replied' (a répondu), 'shortlisted' (ajouté pipeline)
  status text NOT NULL DEFAULT 'dismissed',
  
  -- Scoring info when dismissed
  score integer,
  recommendation text,
  skip_reason text,
  
  -- Tracking
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  -- Unique constraint: one status per candidate per job per user
  UNIQUE (job_id, candidate_id, created_by)
);

-- Enable Row Level Security
ALTER TABLE public.job_candidate_status ENABLE ROW LEVEL SECURITY;

-- Users can view their own candidate statuses
CREATE POLICY "Users can view their own candidate statuses" 
ON public.job_candidate_status 
FOR SELECT 
USING (auth.uid() = created_by);

-- Users can create their own candidate statuses
CREATE POLICY "Users can create their own candidate statuses" 
ON public.job_candidate_status 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

-- Users can update their own candidate statuses
CREATE POLICY "Users can update their own candidate statuses" 
ON public.job_candidate_status 
FOR UPDATE 
USING (auth.uid() = created_by);

-- Users can delete their own candidate statuses
CREATE POLICY "Users can delete their own candidate statuses" 
ON public.job_candidate_status 
FOR DELETE 
USING (auth.uid() = created_by);

-- Service role has full access
CREATE POLICY "Service role can manage all candidate statuses" 
ON public.job_candidate_status 
FOR ALL 
USING (auth.role() = 'service_role');

-- Index for fast lookup by job + user
CREATE INDEX idx_job_candidate_status_job_user ON public.job_candidate_status (job_id, created_by);

-- Index for candidate lookup
CREATE INDEX idx_job_candidate_status_candidate ON public.job_candidate_status (candidate_id);

-- Trigger for updated_at
CREATE TRIGGER update_job_candidate_status_updated_at
BEFORE UPDATE ON public.job_candidate_status
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();