-- Invalidate match_scores cache when a job's scoring-relevant fields change
-- This ensures re-scoring uses the latest job criteria.

CREATE OR REPLACE FUNCTION public.invalidate_match_scores_on_job_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only invalidate if scoring-relevant columns changed
  IF OLD.skills IS DISTINCT FROM NEW.skills
     OR OLD.requirements IS DISTINCT FROM NEW.requirements
     OR OLD.must_have IS DISTINCT FROM NEW.must_have
     OR OLD.should_have IS DISTINCT FROM NEW.should_have
     OR OLD.nice_to_have IS DISTINCT FROM NEW.nice_to_have
     OR OLD.xp_min IS DISTINCT FROM NEW.xp_min
     OR OLD.xp_max IS DISTINCT FROM NEW.xp_max
     OR OLD.seniority IS DISTINCT FROM NEW.seniority
     OR OLD.location IS DISTINCT FROM NEW.location
     OR OLD.remote IS DISTINCT FROM NEW.remote
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.contract_type IS DISTINCT FROM NEW.contract_type
     OR OLD.salary_min IS DISTINCT FROM NEW.salary_min
     OR OLD.salary_max IS DISTINCT FROM NEW.salary_max
  THEN
    DELETE FROM public.match_scores WHERE job_id = NEW.id;
    RAISE LOG '[match_scores] Cache invalidated for job %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_invalidate_match_scores_on_job_update ON public.jobs;
CREATE TRIGGER trg_invalidate_match_scores_on_job_update
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_match_scores_on_job_update();
