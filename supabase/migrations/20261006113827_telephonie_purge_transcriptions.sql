-- ======================================================================
-- Téléphonie : purge des transcriptions d'appels après 12 mois.
--
-- La transcription, le résumé et les tâches proposées d'un appel
-- (phone_call_insights, phone_call_task_suggestions) portent le contenu d'une
-- conversation avec un candidat. rgpd-purge les compte, puis les supprime sur
-- demande explicite ({"dry_run": false}), comme toutes ses autres étapes.
--
-- Ce qui part : la ligne de transcription et les suggestions du même appel.
-- Ce qui reste : la ligne de l'appel (phone_calls : date, durée, numéro) et les
-- tâches déjà créées par « Créer la tâche » (candidate_reminders, à
-- l'organisation). L'âge se lit sur la date de l'appel, pas sur celle de la
-- transcription : une transcription récupérée à la main un an plus tard est
-- purgée tout de suite.
--
-- Fenêtre minimale de 6 mois, refusée en dessous (HINT PURGE_WINDOW_TOO_SHORT),
-- comme rgpd_purge_candidate_rows : un appelant qui passerait la date du jour
-- par erreur ne vide pas la table. Réservée à service_role.
--
-- Rejouable sur une base vide (règle 6 des migrations) : les deux tables
-- viennent de la migration 20261006104437.
-- ======================================================================

CREATE OR REPLACE FUNCTION public.rgpd_purge_phone_call_insights(
  p_before  timestamptz,
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 500)
RETURNS TABLE (insight_id uuid, phone_call_id uuid, organization_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_before IS NULL OR p_before > now() - interval '6 months' THEN
    RAISE EXCEPTION 'Fenêtre de conservation trop courte' USING ERRCODE = '22023', HINT = 'PURGE_WINDOW_TOO_SHORT';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'Limite hors bornes' USING ERRCODE = '22023', HINT = 'PURGE_LIMIT_INVALID';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT i.id AS insight_id, i.phone_call_id, i.organization_id
      FROM public.phone_call_insights i
      JOIN public.phone_calls c ON c.id = i.phone_call_id
     WHERE coalesce(c.started_at, c.created_at) < p_before
     ORDER BY i.id
     LIMIT p_limit
  ), s AS (
    DELETE FROM public.phone_call_task_suggestions t
     USING picked p
     WHERE t.phone_call_id = p.phone_call_id AND NOT p_dry_run
    RETURNING t.id
  ), d AS (
    DELETE FROM public.phone_call_insights i
     USING picked p
     WHERE i.id = p.insight_id AND NOT p_dry_run
    RETURNING i.id AS insight_id, i.phone_call_id, i.organization_id
  )
  SELECT p.insight_id, p.phone_call_id, p.organization_id FROM picked p WHERE p_dry_run
  UNION ALL
  SELECT d.insight_id, d.phone_call_id, d.organization_id FROM d;
END;
$$;

REVOKE ALL ON FUNCTION public.rgpd_purge_phone_call_insights(timestamptz, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rgpd_purge_phone_call_insights(timestamptz, boolean, integer)
  TO service_role;

COMMENT ON FUNCTION public.rgpd_purge_phone_call_insights(timestamptz, boolean, integer) IS
  'Purge RGPD des transcriptions d''appels : transcription, résumé et tâches proposées des appels antérieurs à p_before (date de l''appel). Compte seulement par défaut, fenêtre minimale de 6 mois, service_role seulement.';
