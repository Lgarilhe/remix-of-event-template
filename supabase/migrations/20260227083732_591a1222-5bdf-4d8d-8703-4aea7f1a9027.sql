
-- Table for storing Calendly bookings and qualification scorecards
CREATE TABLE public.qualification_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Calendly booking info
  calendly_event_id TEXT UNIQUE,
  calendly_invitee_id TEXT,
  event_name TEXT,
  event_start_at TIMESTAMP WITH TIME ZONE,
  event_end_at TIMESTAMP WITH TIME ZONE,
  event_location TEXT,
  invitee_email TEXT,
  
  -- Candidate matching
  candidate_linkedin_url TEXT,
  candidate_name TEXT,
  candidate_headline TEXT,
  candidate_profile_id TEXT,
  
  -- Job context
  job_id TEXT,
  job_title TEXT,
  client_name TEXT,
  project_id UUID REFERENCES public.sourcing_projects(id),
  
  -- Scoring context (snapshot from job_candidate_status)
  scoring_summary JSONB DEFAULT '{}'::jsonb,
  job_criteria JSONB DEFAULT '[]'::jsonb,
  
  -- Qualification scorecard
  notes TEXT DEFAULT '',
  verdict TEXT DEFAULT 'pending',
  verdict_notes TEXT,
  verdict_at TIMESTAMP WITH TIME ZONE,
  verdict_by UUID,
  
  -- Notion sync
  notion_candidate_id TEXT,
  notion_shortlist_id TEXT,
  notion_synced_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'scheduled'
);

-- Enable RLS
ALTER TABLE public.qualification_sessions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own qualification sessions"
  ON public.qualification_sessions FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create qualification sessions"
  ON public.qualification_sessions FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own qualification sessions"
  ON public.qualification_sessions FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own qualification sessions"
  ON public.qualification_sessions FOR DELETE
  USING (auth.uid() = created_by);

CREATE POLICY "Service role can manage all qualification sessions"
  ON public.qualification_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- Indexes for fast lookups
CREATE INDEX idx_qualification_sessions_candidate ON public.qualification_sessions(candidate_linkedin_url);
CREATE INDEX idx_qualification_sessions_job ON public.qualification_sessions(job_id);
CREATE INDEX idx_qualification_sessions_calendly ON public.qualification_sessions(calendly_event_id);
CREATE INDEX idx_qualification_sessions_profile ON public.qualification_sessions(candidate_profile_id);

-- Trigger for updated_at
CREATE TRIGGER update_qualification_sessions_updated_at
  BEFORE UPDATE ON public.qualification_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
