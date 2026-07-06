-- ============================================
-- Migration: get_linkedin_reconnect_alerts — bannière « compte à reconnecter »
-- ============================================
-- Expose, en lecture seule agrégée, les échecs multiple_sessions récents de
-- search_failure_log aux membres de l'org propriétaire du compte LinkedIn
-- (jointure member_linkedin_accounts → organization_members). ≥ 2 conflits de
-- session en 12 h → le frontend affiche une bannière invitant à ré-importer
-- des cookies frais (cf. LOGBOOK 2026-07-06, verdict mono-session Recruiter).
-- La table search_failure_log reste service-role-only : seule cette fonction
-- SECURITY DEFINER agrégée est accessible aux users authentifiés (aucun
-- payload de recherche ni détail d'erreur exposé). Idempotente.

CREATE OR REPLACE FUNCTION public.get_linkedin_reconnect_alerts()
RETURNS TABLE (account_id text, failure_count bigint, last_failure_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.account_id, count(*) AS failure_count, max(f.created_at) AS last_failure_at
  FROM public.search_failure_log f
  WHERE f.error_type ILIKE '%multiple_sessions%'
    AND f.created_at > now() - interval '12 hours'
    AND f.account_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.member_linkedin_accounts m
      JOIN public.organization_members om
        ON om.organization_id = m.organization_id AND om.user_id = auth.uid()
      WHERE m.linkedin_account_id = f.account_id
    )
  GROUP BY f.account_id
  HAVING count(*) >= 2;
$$;

REVOKE ALL ON FUNCTION public.get_linkedin_reconnect_alerts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_linkedin_reconnect_alerts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_linkedin_reconnect_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_linkedin_reconnect_alerts() TO service_role;
