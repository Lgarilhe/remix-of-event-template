ALTER TABLE public.outreach_sequences 
ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_sequences_project_id ON public.outreach_sequences(project_id);