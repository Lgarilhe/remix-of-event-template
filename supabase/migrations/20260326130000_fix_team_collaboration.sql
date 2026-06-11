-- ═══════════════════════════════════════════════════════════
-- Fix team collaboration workflow — multiple blockers
-- ═══════════════════════════════════════════════════════════

-- 1. Add 'collaborator' to organization_members role CHECK constraint
-- Current: CHECK (role IN ('owner', 'admin', 'member'))
-- The accept-invitation edge function tries to insert 'collaborator' which fails

ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'collaborator'));

-- 2. Allow mission_team members to see projects from other orgs
-- Currently: sourcing_projects RLS only allows org members to see their own org's projects
-- Fix: add a policy that allows SELECT if user is in mission_team for that project

CREATE POLICY "Mission team members can view assigned projects"
  ON public.sourcing_projects FOR SELECT
  USING (
    id IN (
      SELECT mt.project_id FROM public.mission_team mt
      WHERE mt.user_id = auth.uid()
    )
  );

-- Also allow mission_team members to see candidates for those projects
CREATE POLICY "Mission team can view project candidates"
  ON public.job_candidate_status FOR SELECT
  USING (
    project_id IN (
      SELECT mt.project_id FROM public.mission_team mt
      WHERE mt.user_id = auth.uid()
    )
  );

-- And allow them to INSERT/UPDATE candidates (for sourcing)
CREATE POLICY "Mission team can manage project candidates"
  ON public.job_candidate_status FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT mt.project_id FROM public.mission_team mt
      WHERE mt.user_id = auth.uid()
    )
  );

CREATE POLICY "Mission team can update project candidates"
  ON public.job_candidate_status FOR UPDATE
  USING (
    project_id IN (
      SELECT mt.project_id FROM public.mission_team mt
      WHERE mt.user_id = auth.uid()
    )
  );

-- 3. Fix mission_invitations RLS — too permissive (was SELECT USING true)
DROP POLICY IF EXISTS "mission_invitations_read_by_token" ON public.mission_invitations;

DROP POLICY IF EXISTS "mission_invitations_read_own" ON public.mission_invitations;
CREATE POLICY "mission_invitations_read_own" ON public.mission_invitations
  FOR SELECT USING (
    -- Org members can see invitations for their org's projects
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
    OR
    -- Invitee can see their own invitation (matched by email)
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
