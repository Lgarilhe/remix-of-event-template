-- V2-1: Add job_details JSONB to sourcing_projects
-- V2-3a: Create mission_process_steps, mission_team, process_templates tables
-- Also add org_type to organizations

-- ═══════════════════════════════════════════════════════════
-- 1. job_details JSONB column on sourcing_projects
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.sourcing_projects
  ADD COLUMN IF NOT EXISTS job_details jsonb DEFAULT '{}';

COMMENT ON COLUMN public.sourcing_projects.job_details IS
  'Structured job brief: title, client, skills (must/should/nice/avoid), salary, remote policy, seniority, etc.';

-- ═══════════════════════════════════════════════════════════
-- 2. org_type on organizations
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS org_type text DEFAULT 'enterprise'
    CHECK (org_type IN ('enterprise', 'agency', 'freelance'));

-- ═══════════════════════════════════════════════════════════
-- 3. mission_process_steps — recruitment process per mission
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
  interviewer_type text DEFAULT 'internal'
    CHECK (interviewer_type IN ('internal', 'client', 'panel')),
  interviewer_name text,
  interviewer_user_id uuid,
  evaluation_criteria jsonb DEFAULT '[]',
  is_eliminatory boolean DEFAULT false,
  template_source text DEFAULT 'custom'
    CHECK (template_source IN ('default', 'custom', 'ai_generated')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, step_order)
);

ALTER TABLE public.mission_process_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage process steps for their org projects"
  ON public.mission_process_steps
  FOR ALL
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 4. mission_team — who works on each mission
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

CREATE POLICY "Users can see team for their org projects"
  ON public.mission_team
  FOR ALL
  USING (
    project_id IN (
      SELECT sp.id FROM public.sourcing_projects sp
      WHERE sp.organization_id IN (
        SELECT om.organization_id FROM public.organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 5. process_templates — reusable process templates
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

CREATE POLICY "Users can manage templates for their org"
  ON public.process_templates
  FOR ALL
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );
