-- ═══════════════════════════════════════════════════════════
-- Secure client portal: remove USING(true) policies
--
-- The client portal now uses the edge function client-portal-data
-- which authenticates via token and queries with service_role.
-- No anon access to these tables is needed anymore.
-- ═══════════════════════════════════════════════════════════

-- 1. Drop the 3 public portal read policies (USING(true))
DROP POLICY IF EXISTS "sourcing_projects_public_portal_read" ON public.sourcing_projects;
DROP POLICY IF EXISTS "jcs_public_portal_read" ON public.job_candidate_status;
DROP POLICY IF EXISTS "organizations_public_portal_read" ON public.organizations;

-- 2. Replace client_portal_tokens_read_by_token (USING(true))
--    with org-scoped access for authenticated users only.
--    Anonymous token lookup is now handled by the edge function with service_role.
DROP POLICY IF EXISTS "client_portal_tokens_read_by_token" ON public.client_portal_tokens;

CREATE POLICY "client_portal_tokens_read_by_org"
  ON public.client_portal_tokens
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );
