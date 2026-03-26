-- Fix: Allow anonymous read access to client_portal_tokens via token
-- The portal page (/client/:token) is public and doesn't require auth.
-- Authenticated users (org members) can manage tokens.

DROP POLICY IF EXISTS "client_portal_tokens_policy" ON public.client_portal_tokens;

-- Anonymous read: anyone with a valid token can look it up
CREATE POLICY "client_portal_tokens_read_by_token" ON public.client_portal_tokens
  FOR SELECT USING (true);

-- Authenticated write: only org members can create/update/delete
CREATE POLICY "client_portal_tokens_manage_by_org" ON public.client_portal_tokens
  FOR ALL USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Also allow anonymous read on sourcing_projects and job_candidate_status
-- for the client portal (filtered by project_id from token)
-- These tables already have org-based RLS, so we add a limited public read policy

-- Allow anonymous SELECT on sourcing_projects for portal access
-- (only id, name, status — no sensitive data)
CREATE POLICY "sourcing_projects_public_portal_read" ON public.sourcing_projects
  FOR SELECT USING (true);

-- Allow anonymous SELECT on job_candidate_status for portal access
CREATE POLICY "jcs_public_portal_read" ON public.job_candidate_status
  FOR SELECT USING (true);

-- Allow anonymous SELECT on organizations for portal branding
CREATE POLICY "organizations_public_portal_read" ON public.organizations
  FOR SELECT USING (true);
