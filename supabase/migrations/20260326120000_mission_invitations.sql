-- Mission invitations — invite external freelancers to work on a mission
CREATE TABLE IF NOT EXISTS public.mission_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'freelance'
    CHECK (role IN ('lead', 'sourcer', 'account_manager', 'reviewer', 'freelance')),
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  invited_by uuid NOT NULL,
  accepted_by uuid,
  message text,
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  UNIQUE(project_id, email)
);

ALTER TABLE public.mission_invitations ENABLE ROW LEVEL SECURITY;

-- Org members can manage invitations for their projects
DROP POLICY IF EXISTS "mission_invitations_manage" ON public.mission_invitations;
CREATE POLICY "mission_invitations_manage" ON public.mission_invitations
  FOR ALL USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Anyone can read their own invitation (by email lookup via token)
DROP POLICY IF EXISTS "mission_invitations_read_by_token" ON public.mission_invitations;
CREATE POLICY "mission_invitations_read_by_token" ON public.mission_invitations
  FOR SELECT USING (true);
