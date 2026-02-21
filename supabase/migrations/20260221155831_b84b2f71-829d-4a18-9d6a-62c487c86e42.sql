
-- Table for automatic search history per job
CREATE TABLE public.search_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL,
  job_id TEXT NOT NULL,
  job_title TEXT,
  client_name TEXT,
  filters_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  results_count INTEGER NOT NULL DEFAULT 0,
  treated_count INTEGER NOT NULL DEFAULT 0,
  dismissed_count INTEGER NOT NULL DEFAULT 0,
  messaged_count INTEGER NOT NULL DEFAULT 0,
  shortlisted_count INTEGER NOT NULL DEFAULT 0,
  search_api TEXT DEFAULT 'classic',
  project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own search history"
ON public.search_history FOR SELECT
USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own search history"
ON public.search_history FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own search history"
ON public.search_history FOR UPDATE
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own search history"
ON public.search_history FOR DELETE
USING (auth.uid() = created_by);

-- Index for fast lookup by job
CREATE INDEX idx_search_history_job ON public.search_history(created_by, job_id, created_at DESC);

-- Auto-update timestamp
CREATE TRIGGER update_search_history_updated_at
BEFORE UPDATE ON public.search_history
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
