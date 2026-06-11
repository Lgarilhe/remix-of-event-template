
-- ═══════════════════════════════════════════════════════════
-- 1. org_type on organizations
-- ═══════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='organizations' AND column_name='org_type'
  ) THEN
    ALTER TABLE public.organizations ADD COLUMN org_type text DEFAULT 'enterprise';
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_org_type_check CHECK (org_type IN ('enterprise', 'agency', 'freelance'));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 2. mission_process_steps
-- ═══════════════════════════════════════════════════════════
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mission_process_steps' AND policyname='Users can manage process steps for their org projects') THEN
    DROP POLICY IF EXISTS "Users can manage process steps for their org projects" ON public.mission_process_steps;
    CREATE POLICY "Users can manage process steps for their org projects"
      ON public.mission_process_steps FOR ALL
      USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 3. mission_team
-- ═══════════════════════════════════════════════════════════
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mission_team' AND policyname='Users can see team for their org projects') THEN
    DROP POLICY IF EXISTS "Users can see team for their org projects" ON public.mission_team;
    CREATE POLICY "Users can see team for their org projects"
      ON public.mission_team FOR ALL
      USING (project_id IN (SELECT sp.id FROM public.sourcing_projects sp WHERE sp.organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid())));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 4. process_templates
-- ═══════════════════════════════════════════════════════════
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='process_templates' AND policyname='Users can manage templates for their org') THEN
    DROP POLICY IF EXISTS "Users can manage templates for their org" ON public.process_templates;
    CREATE POLICY "Users can manage templates for their org"
      ON public.process_templates FOR ALL
      USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 5. Hunt mode columns on sourcing_projects
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.sourcing_projects
  ADD COLUMN IF NOT EXISTS hunt_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hunt_bounty_percent decimal,
  ADD COLUMN IF NOT EXISTS hunt_max_recruiters integer,
  ADD COLUMN IF NOT EXISTS hunt_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS hunt_status text DEFAULT 'draft';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sourcing_projects_hunt_status_check') THEN
    ALTER TABLE public.sourcing_projects ADD CONSTRAINT sourcing_projects_hunt_status_check CHECK (hunt_status IN ('draft', 'published', 'in_progress', 'filled', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sourcing_projects_hunt
  ON public.sourcing_projects(hunt_mode, hunt_status)
  WHERE hunt_mode = true;

-- ═══════════════════════════════════════════════════════════
-- 6. hunt_applications
-- ═══════════════════════════════════════════════════════════
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hunt_applications' AND policyname='hunt_applications_policy') THEN
    DROP POLICY IF EXISTS "hunt_applications_policy" ON public.hunt_applications;
    CREATE POLICY "hunt_applications_policy" ON public.hunt_applications
      FOR ALL USING (
        recruiter_user_id = auth.uid()
        OR project_id IN (SELECT sp.id FROM public.sourcing_projects sp WHERE sp.organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()))
      );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 7. feature_activations
-- ═══════════════════════════════════════════════════════════
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='feature_activations' AND policyname='feature_activations_policy') THEN
    DROP POLICY IF EXISTS "feature_activations_policy" ON public.feature_activations;
    CREATE POLICY "feature_activations_policy" ON public.feature_activations
      FOR ALL USING (organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid()));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 8. client_portal_tokens (for agency portal)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.client_portal_tokens (
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

-- ═══════════════════════════════════════════════════════════
-- 9. Recruiter stats on profiles
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rating decimal,
  ADD COLUMN IF NOT EXISTS placements_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_time_to_fill_days integer,
  ADD COLUMN IF NOT EXISTS first_round_rate decimal,
  ADD COLUMN IF NOT EXISTS mid_round_rate decimal,
  ADD COLUMN IF NOT EXISTS intro_video_url text,
  ADD COLUMN IF NOT EXISTS testimonials jsonb DEFAULT '[]';

-- ═══════════════════════════════════════════════════════════
-- 10. Fix process steps UNIQUE constraint
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.mission_process_steps DROP CONSTRAINT IF EXISTS mission_process_steps_project_id_step_order_key;

CREATE INDEX IF NOT EXISTS idx_process_steps_project_order
  ON public.mission_process_steps(project_id, step_order);

-- ═══════════════════════════════════════════════════════════
-- 11. Fix client portal RLS — anonymous read access
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "client_portal_tokens_policy" ON public.client_portal_tokens;

DROP POLICY IF EXISTS "client_portal_tokens_read_by_token" ON public.client_portal_tokens;
CREATE POLICY "client_portal_tokens_read_by_token" ON public.client_portal_tokens
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "client_portal_tokens_manage_by_org" ON public.client_portal_tokens;
CREATE POLICY "client_portal_tokens_manage_by_org" ON public.client_portal_tokens
  FOR ALL USING (
    organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = auth.uid())
  );

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sourcing_projects' AND policyname='sourcing_projects_public_portal_read') THEN
    DROP POLICY IF EXISTS "sourcing_projects_public_portal_read" ON public.sourcing_projects;
    CREATE POLICY "sourcing_projects_public_portal_read" ON public.sourcing_projects FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_candidate_status' AND policyname='jcs_public_portal_read') THEN
    DROP POLICY IF EXISTS "jcs_public_portal_read" ON public.job_candidate_status;
    CREATE POLICY "jcs_public_portal_read" ON public.job_candidate_status FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='organizations_public_portal_read') THEN
    DROP POLICY IF EXISTS "organizations_public_portal_read" ON public.organizations;
    CREATE POLICY "organizations_public_portal_read" ON public.organizations FOR SELECT USING (true);
  END IF;
END $$;
