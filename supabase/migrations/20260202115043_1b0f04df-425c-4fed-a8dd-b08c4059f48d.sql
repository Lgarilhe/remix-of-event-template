-- Add unique constraint for upsert to work
ALTER TABLE public.nurturing_opportunities 
ADD CONSTRAINT nurturing_opportunities_candidate_account_unique 
UNIQUE (candidate_id, linkedin_account_id);