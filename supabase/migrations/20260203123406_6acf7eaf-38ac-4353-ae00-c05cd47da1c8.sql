-- Create table for saved filter presets
CREATE TABLE public.saved_filter_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_id TEXT, -- Optional: linked to a specific job
  job_title TEXT, -- Cached job title for display
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_filter_presets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can create their own filter presets"
  ON public.saved_filter_presets FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view their own filter presets"
  ON public.saved_filter_presets FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can update their own filter presets"
  ON public.saved_filter_presets FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own filter presets"
  ON public.saved_filter_presets FOR DELETE
  USING (auth.uid() = created_by);

-- Trigger for updated_at
CREATE TRIGGER update_saved_filter_presets_updated_at
  BEFORE UPDATE ON public.saved_filter_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for faster queries
CREATE INDEX idx_saved_filter_presets_created_by ON public.saved_filter_presets(created_by);
CREATE INDEX idx_saved_filter_presets_job_id ON public.saved_filter_presets(job_id);