-- =====================================================================
-- Retour arrière du lot 0c-1 (compteurs stats_* seulement). NON JOUÉ.
-- Pour s'en servir : copier ce fichier dans supabase/migrations/ sous un
-- horodatage neuf (date -u +%Y%m%d%H%M%S, unique : règles 1 et 3 de
-- « Discipline migrations » du CLAUDE.md), jamais par l'éditeur SQL seul.
--
-- Remet recompute_mission_stats et trg_sync_mission_stats du lot 0a
-- (20260928201409, section « compteurs ») : stats_* comptés sur status, par
-- project_id et organisation, doublons comptés deux fois. Puis recalcul
-- complet sans toucher updated_at ni indexer (déclencheurs de
-- sourcing_projects coupés, comme le bloc 3 de la migration 0c-1).
-- Restent en place : la vue mission_candidate_rows, get_mission_stage_counts,
-- undo_candidate_stages, rgpd_purge_candidate_rows et candidate_mission_sends
-- (rien ne les lit avant 0c-3 et 0c-4 ; les écrans de 0c-3 lisent la vue).
-- Libellés « au total » des écrans : retour Vercel habituel si besoin.
-- Idempotent.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.recompute_mission_stats(p_mission_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH missions AS (
    SELECT id, organization_id FROM public.sourcing_projects WHERE id = ANY (p_mission_ids)
  ), agg AS (
    SELECT m.id AS mission_id,
      count(j.id)::int AS total_found,
      count(j.id) FILTER (WHERE j.status = 'scored' OR j.score IS NOT NULL)::int AS scored,
      count(j.id) FILTER (WHERE j.status IN ('messaged','replied'))::int AS messaged,
      count(j.id) FILTER (WHERE j.status = 'dismissed')::int AS dismissed,
      count(j.id) FILTER (WHERE j.status = 'shortlisted')::int AS shortlisted
    FROM missions m
    LEFT JOIN public.job_candidate_status j
      ON j.project_id = m.id AND j.organization_id = m.organization_id
    GROUP BY m.id
  )
  UPDATE public.sourcing_projects sp SET
    stats_total_found = agg.total_found, stats_scored = agg.scored, stats_messaged = agg.messaged,
    stats_dismissed = agg.dismissed, stats_shortlisted = agg.shortlisted
  FROM agg
  WHERE sp.id = agg.mission_id
    -- pas d'écriture si rien ne change (ni updated_at, ni temps réel)
    AND (sp.stats_total_found, sp.stats_scored, sp.stats_messaged, sp.stats_dismissed, sp.stats_shortlisted)
        IS DISTINCT FROM (agg.total_found, agg.scored, agg.messaged, agg.dismissed, agg.shortlisted);
$function$;

CREATE OR REPLACE FUNCTION public.trg_sync_mission_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.project_id) INTO v_ids FROM new_rows n WHERE n.project_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.project_id) INTO v_ids FROM old_rows o WHERE o.project_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT t.pid) INTO v_ids
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
     CROSS JOIN LATERAL (VALUES (n.project_id), (o.project_id)) AS t(pid)
     WHERE t.pid IS NOT NULL
       AND (n.status, n.score IS NULL, n.project_id, n.organization_id)
           IS DISTINCT FROM (o.status, o.score IS NULL, o.project_id, o.organization_id);
  END IF;
  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_mission_stats(v_ids);
  END IF;
  RETURN NULL;
END;
$$;
-- Les trois déclencheurs sync_mission_stats_* (lot 0a) appellent cette
-- fonction par son nom : rien à recréer.
REVOKE ALL ON FUNCTION public.recompute_mission_stats(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_mission_stats(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.trg_sync_mission_stats() FROM PUBLIC, anon;

-- Recalcul complet : ni updated_at (ordre des missions) ni indexation.
-- Verrous dans l'ordre des écrivains (job_candidate_status puis
-- sourcing_projects), comme la migration 0c-1.
DO $retour_0c1$
DECLARE
  v_upd "char";
  v_ing "char";
BEGIN
  LOCK TABLE public.job_candidate_status, public.sourcing_projects IN SHARE ROW EXCLUSIVE MODE;
  SELECT t.tgenabled INTO v_upd FROM pg_trigger t
   WHERE t.tgrelid = 'public.sourcing_projects'::regclass AND t.tgname = 'update_sourcing_projects_updated_at';
  SELECT t.tgenabled INTO v_ing FROM pg_trigger t
   WHERE t.tgrelid = 'public.sourcing_projects'::regclass AND t.tgname = 'trg_auto_ingest_sourcing_projects';
  IF v_upd = 'O' THEN
    ALTER TABLE public.sourcing_projects DISABLE TRIGGER update_sourcing_projects_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.sourcing_projects DISABLE TRIGGER trg_auto_ingest_sourcing_projects;
  END IF;

  PERFORM public.recompute_mission_stats(
    coalesce((SELECT array_agg(id) FROM public.sourcing_projects), '{}'::uuid[]));

  IF v_upd = 'O' THEN
    ALTER TABLE public.sourcing_projects ENABLE TRIGGER update_sourcing_projects_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.sourcing_projects ENABLE TRIGGER trg_auto_ingest_sourcing_projects;
  END IF;
END
$retour_0c1$;

COMMENT ON FUNCTION public.recompute_mission_stats(uuid[]) IS
  'Retour arrière du lot 0c-1 : compteurs stats_* du lot 0a, sur status, par project_id et organisation de la mission.';
