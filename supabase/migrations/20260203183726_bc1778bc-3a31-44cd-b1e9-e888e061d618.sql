-- Create sourcing_projects table
CREATE TABLE public.sourcing_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  job_id TEXT, -- Optional link to Notion job
  job_title TEXT, -- Cached for display
  client_name TEXT, -- Cached for display
  filters_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, -- Saved search filters
  notes TEXT, -- Project notes
  status TEXT NOT NULL DEFAULT 'active', -- active, paused, completed, archived
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_search_at TIMESTAMP WITH TIME ZONE, -- Last time search was run
  -- Stats (denormalized for performance)
  stats_total_found INTEGER NOT NULL DEFAULT 0,
  stats_scored INTEGER NOT NULL DEFAULT 0,
  stats_messaged INTEGER NOT NULL DEFAULT 0,
  stats_dismissed INTEGER NOT NULL DEFAULT 0,
  stats_shortlisted INTEGER NOT NULL DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.sourcing_projects ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own projects"
ON public.sourcing_projects FOR SELECT
USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own projects"
ON public.sourcing_projects FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own projects"
ON public.sourcing_projects FOR UPDATE
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own projects"
ON public.sourcing_projects FOR DELETE
USING (auth.uid() = created_by);

-- Add project_id to job_candidate_status to link candidates to projects
ALTER TABLE public.job_candidate_status 
ADD COLUMN project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_sourcing_projects_created_by ON public.sourcing_projects(created_by);
CREATE INDEX idx_sourcing_projects_job_id ON public.sourcing_projects(job_id);
CREATE INDEX idx_sourcing_projects_status ON public.sourcing_projects(status);
CREATE INDEX idx_job_candidate_status_project_id ON public.job_candidate_status(project_id);

-- Trigger for updated_at
CREATE TRIGGER update_sourcing_projects_updated_at
BEFORE UPDATE ON public.sourcing_projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();