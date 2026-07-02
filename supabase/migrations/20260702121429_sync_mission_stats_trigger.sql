-- ============================================
-- Migration: sync des stats missions depuis job_candidate_status
-- ============================================
-- Les colonnes stats_* de sourcing_projects (total_found, scored, messaged,
-- dismissed, shortlisted) étaient créées à 0 et JAMAIS mises à jour : aucun
-- trigger, aucun appelant de updateStats() côté front, aucune edge function.
-- Conséquence : useMissionReadiness verrouillait la phase Pipeline/Insights
-- (hasCandidates = stats_total_found > 0) même avec des centaines de
-- candidats réellement trackés, et le dashboard/copilot affichaient 0 partout.
--
-- Fix : triggers statement-level sur job_candidate_status qui recalculent les
-- compteurs de la mission touchée, + backfill one-shot de toutes les missions.
--
-- Mapping job_id → mission (les 2 formes coexistent en base) :
--   'project:{uuid}'  → sourcing_projects.id (écrit par le sourcing)
--   '{uuid}' nu       → sourcing_projects.id (écrit par l'inscription en séquence)
--   autre texte       → sourcing_projects.job_id (mission liée à un job externe)
-- Idempotente, rejouable.

-- ============================================
-- Phase 1: fonction de recalcul
-- ============================================

CREATE OR REPLACE FUNCTION public.recompute_mission_stats(p_mission_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH missions AS (
    SELECT id, job_id
    FROM public.sourcing_projects
    WHERE id = ANY(p_mission_ids)
  ),
  jcs AS (
    SELECT
      CASE WHEN j.job_id LIKE 'project:%' THEN substring(j.job_id from 9) ELSE j.job_id END AS norm_job_id,
      j.status,
      j.score
    FROM public.job_candidate_status j
  ),
  agg AS (
    SELECT
      m.id AS mission_id,
      count(j.*)::int AS total_found,
      -- aligné sur l'UI : un contacté/répondu avec score compte comme scoré
      count(*) FILTER (WHERE j.status = 'scored' OR j.score IS NOT NULL)::int AS scored,
      count(*) FILTER (WHERE j.status IN ('messaged', 'replied'))::int AS messaged,
      count(*) FILTER (WHERE j.status = 'dismissed')::int AS dismissed,
      count(*) FILTER (WHERE j.status = 'shortlisted')::int AS shortlisted
    FROM missions m
    LEFT JOIN jcs j
      ON j.norm_job_id = m.id::text
      OR (m.job_id IS NOT NULL AND j.norm_job_id = m.job_id)
    GROUP BY m.id
  )
  UPDATE public.sourcing_projects sp
  SET
    stats_total_found = agg.total_found,
    stats_scored = agg.scored,
    stats_messaged = agg.messaged,
    stats_dismissed = agg.dismissed,
    stats_shortlisted = agg.shortlisted
  FROM agg
  WHERE sp.id = agg.mission_id
    -- pas d'écriture si rien ne change (évite le churn updated_at/realtime)
    AND (sp.stats_total_found, sp.stats_scored, sp.stats_messaged, sp.stats_dismissed, sp.stats_shortlisted)
        IS DISTINCT FROM
        (agg.total_found, agg.scored, agg.messaged, agg.dismissed, agg.shortlisted);
$$;

-- ============================================
-- Phase 2: trigger function (transition tables)
-- ============================================

CREATE OR REPLACE FUNCTION public.trg_sync_mission_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm_ids text[];
  v_mission_ids uuid[];
BEGIN
  -- Collecte les job_id normalisés touchés par le statement (une seule
  -- exécution par statement grâce aux transition tables — un batch upsert de
  -- 25 profils ne déclenche qu'un recalcul par mission touchée).
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT CASE WHEN job_id LIKE 'project:%' THEN substring(job_id from 9) ELSE job_id END)
    INTO v_norm_ids FROM new_rows;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT array_agg(DISTINCT norm) INTO v_norm_ids FROM (
      SELECT CASE WHEN job_id LIKE 'project:%' THEN substring(job_id from 9) ELSE job_id END AS norm FROM new_rows
      UNION
      SELECT CASE WHEN job_id LIKE 'project:%' THEN substring(job_id from 9) ELSE job_id END FROM old_rows
    ) t;
  ELSE -- DELETE
    SELECT array_agg(DISTINCT CASE WHEN job_id LIKE 'project:%' THEN substring(job_id from 9) ELSE job_id END)
    INTO v_norm_ids FROM old_rows;
  END IF;

  IF v_norm_ids IS NULL OR array_length(v_norm_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(DISTINCT sp.id) INTO v_mission_ids
  FROM public.sourcing_projects sp
  WHERE sp.id::text = ANY(v_norm_ids)
     OR (sp.job_id IS NOT NULL AND sp.job_id = ANY(v_norm_ids));

  IF v_mission_ids IS NOT NULL THEN
    PERFORM public.recompute_mission_stats(v_mission_ids);
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================
-- Phase 3: triggers (un par opération — transition tables obligent)
-- ============================================

DROP TRIGGER IF EXISTS sync_mission_stats_ins ON public.job_candidate_status;
CREATE TRIGGER sync_mission_stats_ins
  AFTER INSERT ON public.job_candidate_status
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_sync_mission_stats();

DROP TRIGGER IF EXISTS sync_mission_stats_upd ON public.job_candidate_status;
CREATE TRIGGER sync_mission_stats_upd
  AFTER UPDATE ON public.job_candidate_status
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_sync_mission_stats();

DROP TRIGGER IF EXISTS sync_mission_stats_del ON public.job_candidate_status;
CREATE TRIGGER sync_mission_stats_del
  AFTER DELETE ON public.job_candidate_status
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_sync_mission_stats();

-- ============================================
-- Phase 4: backfill one-shot de toutes les missions
-- ============================================

SELECT public.recompute_mission_stats(ARRAY(SELECT id FROM public.sourcing_projects));
