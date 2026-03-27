
-- Fix infinite recursion: mission_team policy references sourcing_projects which references mission_team

-- Drop the recursive policies
DROP POLICY IF EXISTS "mission_team_policy" ON public.mission_team;
DROP POLICY IF EXISTS "mission_team_view_projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "mission_team_view_candidates" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_insert_candidates" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_update_candidates" ON public.job_candidate_status;

-- Recreate mission_team policy using org membership directly (no join to sourcing_projects)
CREATE POLICY "mission_team_policy" ON public.mission_team FOR ALL
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid()
    AND om.organization_id = (
      SELECT sp.organization_id FROM public.sourcing_projects sp WHERE sp.id = mission_team.project_id LIMIT 1
    )
  )
);

-- Recreate sourcing_projects policy for mission_team members using a security definer function
CREATE OR REPLACE FUNCTION public.is_mission_team_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mission_team
    WHERE user_id = _user_id AND project_id = _project_id
  )
$$;

CREATE POLICY "mission_team_view_projects" ON public.sourcing_projects FOR SELECT
USING (public.is_mission_team_member(auth.uid(), id));

-- Same approach for job_candidate_status
CREATE OR REPLACE FUNCTION public.is_mission_team_member_for_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mission_team
    WHERE user_id = _user_id AND project_id = _project_id
  )
$$;

CREATE POLICY "mission_team_view_candidates" ON public.job_candidate_status FOR SELECT
USING (public.is_mission_team_member_for_project(auth.uid(), project_id));

CREATE POLICY "mission_team_insert_candidates" ON public.job_candidate_status FOR INSERT
WITH CHECK (public.is_mission_team_member_for_project(auth.uid(), project_id));

CREATE POLICY "mission_team_update_candidates" ON public.job_candidate_status FOR UPDATE
USING (public.is_mission_team_member_for_project(auth.uid(), project_id));
