
-- Table to store per-organization integration credentials
CREATE TABLE public.organization_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Notion integration
  notion_api_key text,
  notion_postes_db_id text,
  notion_candidats_db_id text,
  notion_shortlist_db_id text,
  notion_connected boolean NOT NULL DEFAULT false,
  
  -- Calendly integration
  calendly_api_key text,
  calendly_connected boolean NOT NULL DEFAULT false,
  
  -- Unipile (LinkedIn) integration
  unipile_dsn text,
  unipile_api_key text,
  unipile_connected boolean NOT NULL DEFAULT false,
  
  -- Airtable integration
  airtable_api_key text,
  airtable_base_id text,
  airtable_base_id_2 text,
  airtable_connected boolean NOT NULL DEFAULT false,
  
  -- Aircall integration
  aircall_api_id text,
  aircall_api_token text,
  aircall_connected boolean NOT NULL DEFAULT false,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(organization_id)
);

ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;

-- Only org admins/owners can view and manage integrations
CREATE POLICY "Org admins can view integrations"
  ON public.organization_integrations FOR SELECT
  TO authenticated
  USING (
    get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "Org admins can insert integrations"
  ON public.organization_integrations FOR INSERT
  TO authenticated
  WITH CHECK (
    get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "Org admins can update integrations"
  ON public.organization_integrations FOR UPDATE
  TO authenticated
  USING (
    get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "Service role can manage all integrations"
  ON public.organization_integrations FOR ALL
  TO authenticated
  USING (auth.role() = 'service_role');

-- Trigger to auto-update updated_at
CREATE TRIGGER update_org_integrations_updated_at
  BEFORE UPDATE ON public.organization_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed row for existing organization
INSERT INTO public.organization_integrations (organization_id)
SELECT id FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- Helper function for edge functions to get org credentials
CREATE OR REPLACE FUNCTION public.get_org_integration(p_org_id uuid)
RETURNS public.organization_integrations
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.organization_integrations
  WHERE organization_id = p_org_id
  LIMIT 1
$$;
