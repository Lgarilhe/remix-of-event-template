
-- Add columns to sourcing_projects
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS job_details jsonb DEFAULT '{}';
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS hunt_mode boolean DEFAULT false;
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS hunt_bounty_percent decimal;
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS hunt_max_recruiters integer;
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS hunt_deadline timestamptz;
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS hunt_status text DEFAULT 'draft' CHECK (hunt_status IN ('draft', 'published', 'in_progress', 'filled', 'cancelled'));

-- Add columns to organizations
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS org_type text DEFAULT 'enterprise' CHECK (org_type IN ('enterprise', 'agency', 'freelance'));
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS agency_permissions jsonb DEFAULT '{}';

-- Add columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rating decimal;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS placements_count integer DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avg_time_to_fill_days integer;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_round_rate decimal;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mid_round_rate decimal;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS intro_video_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS testimonials jsonb DEFAULT '[]';

-- Fix organization_members role constraint
ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'collaborator'));

-- Create mission_process_steps
CREATE TABLE IF NOT EXISTS public.mission_process_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  name text NOT NULL,
  description text,
  objectives text[] DEFAULT '{}',
  duration_minutes integer DEFAULT 30,
  interviewer_type text DEFAULT 'internal' CHECK (interviewer_type IN ('internal', 'client', 'panel')),
  interviewer_name text,
  interviewer_user_id uuid,
  evaluation_criteria jsonb DEFAULT '[]',
  is_eliminatory boolean DEFAULT false,
  template_source text DEFAULT 'custom' CHECK (template_source IN ('default', 'custom', 'ai_generated')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.mission_process_steps ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'process_steps_policy' AND tablename = 'mission_process_steps') THEN
    CREATE POLICY "process_steps_policy" ON public.mission_process_steps FOR ALL USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- Create mission_team
CREATE TABLE IF NOT EXISTS public.mission_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('lead', 'sourcer', 'account_manager', 'reviewer', 'freelance')),
  permissions jsonb DEFAULT '{"can_edit_brief": false, "can_source": true, "can_submit": true}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);
ALTER TABLE public.mission_team ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_team_policy' AND tablename = 'mission_team') THEN
    CREATE POLICY "mission_team_policy" ON public.mission_team FOR ALL USING (project_id IN (SELECT sp.id FROM public.sourcing_projects sp WHERE sp.organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid())));
  END IF;
END $$;

-- Create process_templates
CREATE TABLE IF NOT EXISTS public.process_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  steps jsonb NOT NULL DEFAULT '[]',
  job_category text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.process_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'process_templates_policy' AND tablename = 'process_templates') THEN
    CREATE POLICY "process_templates_policy" ON public.process_templates FOR ALL USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- Create hunt_applications
CREATE TABLE IF NOT EXISTS public.hunt_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  recruiter_user_id uuid NOT NULL,
  recruiter_org_id uuid REFERENCES public.organizations(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  match_score decimal,
  message text,
  invited_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, recruiter_user_id)
);
ALTER TABLE public.hunt_applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'hunt_applications_policy' AND tablename = 'hunt_applications') THEN
    DROP POLICY IF EXISTS "hunt_applications_policy" ON public.hunt_applications;
    CREATE POLICY "hunt_applications_policy" ON public.hunt_applications FOR ALL USING (recruiter_user_id = auth.uid() OR project_id IN (SELECT sp.id FROM public.sourcing_projects sp WHERE sp.organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid())));
  END IF;
END $$;

-- Create feature_activations
CREATE TABLE IF NOT EXISTS public.feature_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature text NOT NULL,
  status text DEFAULT 'inactive' CHECK (status IN ('inactive', 'pending_validation', 'active', 'suspended')),
  contract_signed_at timestamptz,
  contract_document_url text,
  validated_by text,
  validated_at timestamptz,
  payment_method_added boolean DEFAULT false,
  checklist jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, feature)
);
ALTER TABLE public.feature_activations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feature_activations_policy' AND tablename = 'feature_activations') THEN
    DROP POLICY IF EXISTS "feature_activations_policy" ON public.feature_activations;
    CREATE POLICY "feature_activations_policy" ON public.feature_activations FOR ALL USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- Create client_portal_tokens (skip if exists from previous migration)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_portal_tokens') THEN
    CREATE TABLE public.client_portal_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES public.organizations(id),
      client_name text NOT NULL,
      client_email text,
      token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
      project_ids uuid[],
      permissions jsonb DEFAULT '{"can_comment": true, "can_see_names": true, "can_fill_scorecard": true}',
      expires_at timestamptz,
      created_at timestamptz DEFAULT now(),
      last_accessed_at timestamptz
    );
    ALTER TABLE public.client_portal_tokens ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'client_portal_tokens_read' AND tablename = 'client_portal_tokens') THEN
    CREATE POLICY "client_portal_tokens_read" ON public.client_portal_tokens FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'client_portal_tokens_manage' AND tablename = 'client_portal_tokens') THEN
    CREATE POLICY "client_portal_tokens_manage" ON public.client_portal_tokens FOR ALL USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid())) WITH CHECK (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- Create mission_invitations
CREATE TABLE IF NOT EXISTS public.mission_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'freelance' CHECK (role IN ('lead', 'sourcer', 'account_manager', 'reviewer', 'freelance')),
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  invited_by uuid NOT NULL,
  accepted_by uuid,
  message text,
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  UNIQUE(project_id, email)
);
ALTER TABLE public.mission_invitations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_invitations_manage' AND tablename = 'mission_invitations') THEN
    DROP POLICY IF EXISTS "mission_invitations_manage" ON public.mission_invitations;
    CREATE POLICY "mission_invitations_manage" ON public.mission_invitations FOR ALL USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_invitations_read' AND tablename = 'mission_invitations') THEN
    CREATE POLICY "mission_invitations_read" ON public.mission_invitations FOR SELECT USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()) OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));
  END IF;
END $$;

-- RLS policies for mission_team access to sourcing_projects and job_candidate_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_team_view_projects' AND tablename = 'sourcing_projects') THEN
    CREATE POLICY "mission_team_view_projects" ON public.sourcing_projects FOR SELECT USING (id IN (SELECT mt.project_id FROM public.mission_team mt WHERE mt.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_team_view_candidates' AND tablename = 'job_candidate_status') THEN
    CREATE POLICY "mission_team_view_candidates" ON public.job_candidate_status FOR SELECT USING (project_id IN (SELECT mt.project_id FROM public.mission_team mt WHERE mt.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_team_insert_candidates' AND tablename = 'job_candidate_status') THEN
    CREATE POLICY "mission_team_insert_candidates" ON public.job_candidate_status FOR INSERT WITH CHECK (project_id IN (SELECT mt.project_id FROM public.mission_team mt WHERE mt.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mission_team_update_candidates' AND tablename = 'job_candidate_status') THEN
    CREATE POLICY "mission_team_update_candidates" ON public.job_candidate_status FOR UPDATE USING (project_id IN (SELECT mt.project_id FROM public.mission_team mt WHERE mt.user_id = auth.uid()));
  END IF;
END $$;
