-- ============================================
-- Migration: Pipeline mission — project_id auto-résolu + RPCs manquantes
-- ============================================
-- Deux dégâts constatés en prod (2026-07-02) :
--
-- 1. job_candidate_status.project_id est NULL sur 1352/1398 lignes : le flux
--    sourcing n'a jamais rempli cette colonne. Or la vue Pipeline mission
--    (useProjectCandidates) filtre .eq('project_id', ...) → pipeline quasi
--    vide alors que les candidats existent (trackés par job_id).
--
-- 2. Les RPCs de la migration 20260309170900 (get_project_stats,
--    get_multiple_project_stats, get_outreach_acceptance_stats) N'EXISTENT
--    PAS en prod : victimes de la désynchro du tracking de migrations,
--    réparée en tracking-only (marquées appliquées sans rejouer le DDL).
--    useProjectStats échoue silencieusement depuis.
--
-- Fix :
--   Phase 1 — trigger BEFORE qui résout project_id depuis job_id
--             ('project:{uuid}' | '{uuid}' nu | job_id externe) à l'insertion.
--   Phase 2 — backfill one-shot des lignes existantes.
--   Phase 3 — re-création des 3 RPCs, avec 2 corrections :
--             * untreated comptait status='untreated' qui n'existe pas en
--               base (valeur UI) → status='discovered'.
--             * garde-fous org (SECURITY DEFINER sans borne = fuite
--               cross-tenant sur les compteurs).
-- Idempotente, rejouable.

-- ============================================
-- Phase 1: trigger — auto-résolution de project_id
-- ============================================

CREATE OR REPLACE FUNCTION public.resolve_jcs_project_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_norm := CASE WHEN NEW.job_id LIKE 'project:%' THEN substring(NEW.job_id from 9) ELSE NEW.job_id END;
  SELECT sp.id INTO NEW.project_id
  FROM public.sourcing_projects sp
  WHERE sp.id::text = v_norm
     OR (sp.job_id IS NOT NULL AND sp.job_id = v_norm)
  ORDER BY sp.created_at DESC
  LIMIT 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_project_id_ins ON public.job_candidate_status;
CREATE TRIGGER resolve_project_id_ins
  BEFORE INSERT ON public.job_candidate_status
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_jcs_project_id();

DROP TRIGGER IF EXISTS resolve_project_id_upd ON public.job_candidate_status;
CREATE TRIGGER resolve_project_id_upd
  BEFORE UPDATE OF job_id ON public.job_candidate_status
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_jcs_project_id();

-- ============================================
-- Phase 2: backfill des lignes existantes
-- ============================================

UPDATE public.job_candidate_status jcs
SET project_id = sp.id
FROM public.sourcing_projects sp
WHERE jcs.project_id IS NULL
  AND (
    sp.id::text = CASE WHEN jcs.job_id LIKE 'project:%' THEN substring(jcs.job_id from 9) ELSE jcs.job_id END
    OR (sp.job_id IS NOT NULL AND sp.job_id = CASE WHEN jcs.job_id LIKE 'project:%' THEN substring(jcs.job_id from 9) ELSE jcs.job_id END)
  );

-- Index utile : la vue Pipeline filtre systématiquement par project_id
CREATE INDEX IF NOT EXISTS idx_job_candidate_status_project_id
  ON public.job_candidate_status(project_id)
  WHERE project_id IS NOT NULL;

-- ============================================
-- Phase 3: RPCs manquantes (20260309170900 jamais appliquée en prod)
-- ============================================

CREATE OR REPLACE FUNCTION public.get_project_stats(p_project_id UUID)
RETURNS TABLE(
  total BIGINT,
  scored BIGINT,
  messaged BIGINT,
  shortlisted BIGINT,
  dismissed BIGINT,
  untreated BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Garde org : l'appelant doit être membre de l'org du projet
  IF NOT EXISTS (
    SELECT 1 FROM public.sourcing_projects sp
    JOIN public.organization_members om ON om.organization_id = sp.organization_id
    WHERE sp.id = p_project_id AND om.user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE jcs.score IS NOT NULL OR jcs.status = 'scored')::BIGINT AS scored,
    COUNT(*) FILTER (WHERE jcs.status IN ('messaged', 'replied'))::BIGINT AS messaged,
    COUNT(*) FILTER (WHERE jcs.status = 'shortlisted')::BIGINT AS shortlisted,
    COUNT(*) FILTER (WHERE jcs.status = 'dismissed')::BIGINT AS dismissed,
    COUNT(*) FILTER (WHERE jcs.status = 'discovered')::BIGINT AS untreated
  FROM public.job_candidate_status jcs
  WHERE jcs.project_id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_multiple_project_stats(p_project_ids UUID[])
RETURNS TABLE(
  project_id UUID,
  total BIGINT,
  scored BIGINT,
  messaged BIGINT,
  shortlisted BIGINT,
  dismissed BIGINT,
  untreated BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jcs.project_id,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE jcs.score IS NOT NULL OR jcs.status = 'scored')::BIGINT AS scored,
    COUNT(*) FILTER (WHERE jcs.status IN ('messaged', 'replied'))::BIGINT AS messaged,
    COUNT(*) FILTER (WHERE jcs.status = 'shortlisted')::BIGINT AS shortlisted,
    COUNT(*) FILTER (WHERE jcs.status = 'dismissed')::BIGINT AS dismissed,
    COUNT(*) FILTER (WHERE jcs.status = 'discovered')::BIGINT AS untreated
  FROM public.job_candidate_status jcs
  WHERE jcs.project_id = ANY(p_project_ids)
    -- Garde org : seuls les projets des orgs de l'appelant
    AND EXISTS (
      SELECT 1 FROM public.sourcing_projects sp
      JOIN public.organization_members om ON om.organization_id = sp.organization_id
      WHERE sp.id = jcs.project_id AND om.user_id = auth.uid()
    )
  GROUP BY jcs.project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_outreach_acceptance_stats()
RETURNS TABLE(
  user_id UUID,
  total_enrolled BIGINT,
  connected BIGINT,
  not_connected BIGINT,
  pending BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.created_by AS user_id,
    COUNT(*)::BIGINT AS total_enrolled,
    COUNT(*) FILTER (WHERE LOWER(se.connection_status) IN ('connected', 'accepted'))::BIGINT AS connected,
    COUNT(*) FILTER (WHERE LOWER(se.connection_status) IN ('not_connected', 'declined', 'withdrawn'))::BIGINT AS not_connected,
    COUNT(*) FILTER (WHERE LOWER(COALESCE(se.connection_status, '')) NOT IN ('connected', 'accepted', 'not_connected', 'declined', 'withdrawn'))::BIGINT AS pending
  FROM public.sequence_enrollments se
  -- Garde org : bornée aux orgs de l'appelant (l'originale agrégeait toute la base)
  WHERE se.organization_id IN (
    SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()
  )
  GROUP BY se.created_by;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_multiple_project_stats(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_outreach_acceptance_stats() TO authenticated;
