
CREATE TABLE public.vivier_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_airtable_id text NOT NULL UNIQUE,
  linkedin_url text,
  match_type text DEFAULT 'linkedin',
  current_job_title text,
  current_company text,
  headline text,
  location text,
  apollo_data jsonb,
  is_relevant boolean,
  relevance_reason text,
  generated_message text,
  message_type text DEFAULT 'sms',
  message_status text DEFAULT 'draft',
  enriched_at timestamptz DEFAULT now(),
  organization_id uuid REFERENCES public.organizations(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.vivier_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view enrichments for their org"
  ON public.vivier_enrichments FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Users can insert enrichments for their org"
  ON public.vivier_enrichments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Users can update enrichments for their org"
  ON public.vivier_enrichments FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE INDEX idx_vivier_enrichments_contact ON public.vivier_enrichments(contact_airtable_id);
CREATE INDEX idx_vivier_enrichments_org ON public.vivier_enrichments(organization_id);
