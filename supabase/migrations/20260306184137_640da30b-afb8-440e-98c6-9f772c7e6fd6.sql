
-- 1. Job assignments: which members are assigned to which jobs
CREATE TABLE public.job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  job_id text NOT NULL,
  job_title text,
  assigned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, job_id)
);

ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view job assignments"
  ON public.job_assignments FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage job assignments"
  ON public.job_assignments FOR ALL
  USING (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));

CREATE POLICY "Service role can manage all job assignments"
  ON public.job_assignments FOR ALL
  USING (auth.role() = 'service_role');

-- 2. Member quotas: per-member daily limits
CREATE TABLE public.member_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  max_inmails_per_day integer DEFAULT 50,
  max_messages_per_day integer DEFAULT 100,
  max_searches_per_day integer DEFAULT 100,
  max_profile_visits_per_day integer DEFAULT 200,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

ALTER TABLE public.member_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view quotas"
  ON public.member_quotas FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage quotas"
  ON public.member_quotas FOR ALL
  USING (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));

CREATE POLICY "Service role can manage all quotas"
  ON public.member_quotas FOR ALL
  USING (auth.role() = 'service_role');

-- 3. Candidate assignments: round-robin tracking
CREATE TABLE public.candidate_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL,
  assigned_by uuid,
  job_id text NOT NULL,
  candidate_id text NOT NULL,
  candidate_name text,
  assignment_method text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  UNIQUE (organization_id, job_id, candidate_id)
);

ALTER TABLE public.candidate_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view candidate assignments"
  ON public.candidate_assignments FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org members can create candidate assignments"
  ON public.candidate_assignments FOR INSERT
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admins can manage all candidate assignments"
  ON public.candidate_assignments FOR ALL
  USING (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));

CREATE POLICY "Service role can manage all candidate assignments"
  ON public.candidate_assignments FOR ALL
  USING (auth.role() = 'service_role');

-- 4. Round-robin state: track last assigned recruiter per job
CREATE TABLE public.round_robin_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id text NOT NULL,
  last_assigned_user_id uuid,
  last_assigned_at timestamptz,
  UNIQUE (organization_id, job_id)
);

ALTER TABLE public.round_robin_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view round robin state"
  ON public.round_robin_state FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org members can manage round robin state"
  ON public.round_robin_state FOR ALL
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Service role can manage all round robin state"
  ON public.round_robin_state FOR ALL
  USING (auth.role() = 'service_role');
