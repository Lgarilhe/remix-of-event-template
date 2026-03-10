
-- ICP (Ideal Customer/Candidate Profile) table
CREATE TABLE public.prospection_icps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  name text NOT NULL,
  description text,
  target_type text NOT NULL DEFAULT 'both' CHECK (target_type IN ('client', 'candidate', 'both')),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.prospection_icps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view ICPs"
  ON public.prospection_icps FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()) OR (organization_id IS NULL AND created_by = auth.uid()));

CREATE POLICY "Org members can create ICPs"
  ON public.prospection_icps FOR INSERT
  WITH CHECK (auth.uid() = created_by AND (organization_id IS NULL OR is_org_member(auth.uid(), organization_id)));

CREATE POLICY "Org members can update ICPs"
  ON public.prospection_icps FOR UPDATE
  USING (organization_id = get_user_org_id(auth.uid()) OR (organization_id IS NULL AND created_by = auth.uid()));

CREATE POLICY "Org members can delete ICPs"
  ON public.prospection_icps FOR DELETE
  USING (organization_id = get_user_org_id(auth.uid()) OR (organization_id IS NULL AND created_by = auth.uid()));

CREATE POLICY "Service role can manage all ICPs"
  ON public.prospection_icps FOR ALL
  USING (auth.role() = 'service_role');

-- Link ICPs to sourcing projects
ALTER TABLE public.sourcing_projects ADD COLUMN IF NOT EXISTS icp_id uuid REFERENCES public.prospection_icps(id) ON DELETE SET NULL;
