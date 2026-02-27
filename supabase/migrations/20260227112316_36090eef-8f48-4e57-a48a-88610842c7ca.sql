-- Add pipeline_stage column to job_candidate_status
ALTER TABLE public.job_candidate_status 
ADD COLUMN pipeline_stage text DEFAULT 'Pressenti';

-- Add notion_synced_at to track last sync with Notion
ALTER TABLE public.job_candidate_status 
ADD COLUMN notion_synced_at timestamp with time zone;

-- Add notion_candidate_id and notion_shortlist_id for bidirectional sync
ALTER TABLE public.job_candidate_status 
ADD COLUMN notion_candidate_id text;

ALTER TABLE public.job_candidate_status 
ADD COLUMN notion_shortlist_id text;

-- Index for fast lookups
CREATE INDEX idx_jcs_pipeline_stage ON public.job_candidate_status(pipeline_stage);
CREATE INDEX idx_jcs_notion_candidate_id ON public.job_candidate_status(notion_candidate_id);
CREATE INDEX idx_jcs_notion_shortlist_id ON public.job_candidate_status(notion_shortlist_id);