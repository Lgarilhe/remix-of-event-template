
-- Fix default to NULL so STATUS_TO_STAGE mapping works for new records
ALTER TABLE public.job_candidate_status ALTER COLUMN pipeline_stage SET DEFAULT NULL;

-- Backfill pipeline_stage from status for all existing records
UPDATE public.job_candidate_status SET pipeline_stage = CASE status
  WHEN 'scored' THEN 'Nouveau'
  WHEN 'shortlisted' THEN 'Pressenti'
  WHEN 'messaged' THEN 'Contacté'
  WHEN 'replied' THEN 'Répondu'
  WHEN 'interested' THEN 'Répondu'
  WHEN 'qualification' THEN 'Pré-qualif'
  WHEN 'not_interested' THEN 'Perdu'
  WHEN 'dismissed' THEN 'Perdu'
  WHEN 'untreated' THEN 'Nouveau'
  ELSE 'Nouveau'
END
WHERE pipeline_stage = 'Pressenti' OR pipeline_stage IS NULL;
