-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger : maintenir auto sourcing_projects.stats_shortlisted
--
-- Avant : la colonne stats_shortlisted existait mais n'était JAMAIS incrémentée
-- → KPIs dashboard toujours à 0.
--
-- Après : trigger AFTER INSERT/UPDATE/DELETE sur job_candidate_status
-- recompte les candidats dont status='shortlisted' OR pipeline_stage est dans
-- les étapes process (donc activement dans le pipeline).
--
-- Idempotent : drop+create du trigger.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_project_shortlist_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_project_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Collect project IDs affected
  IF TG_OP = 'INSERT' THEN
    IF NEW.project_id IS NOT NULL THEN
      v_project_ids := array_append(v_project_ids, NEW.project_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.project_id IS NOT NULL THEN
      v_project_ids := array_append(v_project_ids, NEW.project_id);
    END IF;
    -- If project_id changed, also refresh the old one
    IF OLD.project_id IS NOT NULL AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
      v_project_ids := array_append(v_project_ids, OLD.project_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.project_id IS NOT NULL THEN
      v_project_ids := array_append(v_project_ids, OLD.project_id);
    END IF;
  END IF;

  -- Recompute stats for each affected project
  IF array_length(v_project_ids, 1) > 0 THEN
    UPDATE public.sourcing_projects sp
    SET stats_shortlisted = (
      SELECT COUNT(*)
      FROM public.job_candidate_status jcs
      WHERE jcs.project_id = sp.id
        AND (
          jcs.status = 'shortlisted'
          OR (jcs.pipeline_stage IS NOT NULL AND jcs.pipeline_stage NOT IN ('sourced', 'untreated', 'dismissed'))
        )
    )
    WHERE sp.id = ANY(v_project_ids);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_project_shortlist_stats ON public.job_candidate_status;

CREATE TRIGGER trg_refresh_project_shortlist_stats
  AFTER INSERT OR UPDATE OF status, pipeline_stage, project_id OR DELETE
  ON public.job_candidate_status
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_project_shortlist_stats();

-- One-shot backfill : recalcule pour tous les projets actifs (idempotent)
UPDATE public.sourcing_projects sp
SET stats_shortlisted = (
  SELECT COUNT(*)
  FROM public.job_candidate_status jcs
  WHERE jcs.project_id = sp.id
    AND (
      jcs.status = 'shortlisted'
      OR (jcs.pipeline_stage IS NOT NULL AND jcs.pipeline_stage NOT IN ('sourced', 'untreated', 'dismissed'))
    )
);
