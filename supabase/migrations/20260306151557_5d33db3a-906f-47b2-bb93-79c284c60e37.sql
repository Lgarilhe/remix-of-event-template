
-- Organization invitations table
CREATE TABLE public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  invited_by uuid NOT NULL,
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  accepted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE(organization_id, email, status)
);

-- Enable RLS
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Org admins can view invitations"
  ON public.organization_invitations FOR SELECT
  USING (
    get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "Org admins can create invitations"
  ON public.organization_invitations FOR INSERT
  WITH CHECK (
    get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
    AND auth.uid() = invited_by
  );

CREATE POLICY "Org admins can delete invitations"
  ON public.organization_invitations FOR DELETE
  USING (
    get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "Invitees can view their own invitations"
  ON public.organization_invitations FOR SELECT
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
  );

CREATE POLICY "Service role can manage all invitations"
  ON public.organization_invitations FOR ALL
  USING (auth.role() = 'service_role');
