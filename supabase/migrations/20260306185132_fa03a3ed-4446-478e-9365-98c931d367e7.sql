
-- Table to link organization members to their LinkedIn accounts
-- A member can have one LinkedIn account, an admin can access all
CREATE TABLE public.member_linkedin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  linkedin_account_id text NOT NULL,
  linkedin_account_name text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid NOT NULL,
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, linkedin_account_id)
);

ALTER TABLE public.member_linkedin_accounts ENABLE ROW LEVEL SECURITY;

-- All org members can view the mappings (needed to display names)
CREATE POLICY "Org members can view linkedin mappings"
  ON public.member_linkedin_accounts FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

-- Admins/owners can manage all mappings
CREATE POLICY "Admins can manage linkedin mappings"
  ON public.member_linkedin_accounts FOR ALL
  USING (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));

-- Service role full access
CREATE POLICY "Service role can manage all linkedin mappings"
  ON public.member_linkedin_accounts FOR ALL
  USING (auth.role() = 'service_role');
