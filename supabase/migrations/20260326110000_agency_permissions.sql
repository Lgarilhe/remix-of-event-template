-- Agency permissions JSONB column on organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS agency_permissions jsonb DEFAULT '{}';

COMMENT ON COLUMN public.organizations.agency_permissions IS
  'Agency-specific permission toggles: hide_payments_from_members, share_candidates_between_members, etc.';
