-- ═══════════════════════════════════════════════════════════
-- M-1: Marketplace — Hunt mode, applications, feature activations
-- ═══════════════════════════════════════════════════════════

-- 1. Hunt mode columns on sourcing_projects
ALTER TABLE public.sourcing_projects
  ADD COLUMN IF NOT EXISTS hunt_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hunt_bounty_percent decimal,
  ADD COLUMN IF NOT EXISTS hunt_max_recruiters integer,
  ADD COLUMN IF NOT EXISTS hunt_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS hunt_status text DEFAULT 'draft'
    CHECK (hunt_status IN ('draft', 'published', 'in_progress', 'filled', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_sourcing_projects_hunt
  ON public.sourcing_projects(hunt_mode, hunt_status)
  WHERE hunt_mode = true;

-- 2. Hunt applications — recruiters applying to hunt missions
CREATE TABLE IF NOT EXISTS public.hunt_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  recruiter_user_id uuid NOT NULL,
  recruiter_org_id uuid REFERENCES public.organizations(id),
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  match_score decimal,
  message text,
  invited_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, recruiter_user_id)
);

ALTER TABLE public.hunt_applications ENABLE ROW LEVEL SECURITY;

-- Recruiters can see their own applications + project owners can see applications to their projects
DROP POLICY IF EXISTS "hunt_applications_policy" ON public.hunt_applications;
CREATE POLICY "hunt_applications_policy" ON public.hunt_applications
  FOR ALL USING (
    recruiter_user_id = auth.uid()
    OR project_id IN (
      SELECT sp.id FROM public.sourcing_projects sp
      WHERE sp.organization_id IN (
        SELECT om.organization_id FROM public.organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );

-- 3. Feature activations — track marketplace activation per org
CREATE TABLE IF NOT EXISTS public.feature_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature text NOT NULL,
  status text DEFAULT 'inactive'
    CHECK (status IN ('inactive', 'pending_validation', 'active', 'suspended')),
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

DROP POLICY IF EXISTS "feature_activations_policy" ON public.feature_activations;
CREATE POLICY "feature_activations_policy" ON public.feature_activations
  FOR ALL USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- 4. Client portal tokens (for agency/freelance → give client access)
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

DROP POLICY IF EXISTS "client_portal_tokens_policy" ON public.client_portal_tokens;
CREATE POLICY "client_portal_tokens_policy" ON public.client_portal_tokens
  FOR ALL USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- 5. Recruiter stats columns on profiles (for portfolio/marketplace)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rating decimal,
  ADD COLUMN IF NOT EXISTS placements_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_time_to_fill_days integer,
  ADD COLUMN IF NOT EXISTS first_round_rate decimal,
  ADD COLUMN IF NOT EXISTS mid_round_rate decimal,
  ADD COLUMN IF NOT EXISTS intro_video_url text,
  ADD COLUMN IF NOT EXISTS testimonials jsonb DEFAULT '[]';
