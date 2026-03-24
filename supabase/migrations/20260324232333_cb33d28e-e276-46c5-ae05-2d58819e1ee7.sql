
-- Add careers_url column to organizations
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS careers_url text;

-- Create career_page_scans table
CREATE TABLE public.career_page_scans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  careers_url text NOT NULL,
  roles_found jsonb DEFAULT '[]'::jsonb,
  new_roles_count integer DEFAULT 0,
  scanned_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.career_page_scans ENABLE ROW LEVEL SECURITY;

-- RLS: org members can read their own scans
CREATE POLICY "Org members can view their scans"
  ON public.career_page_scans
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

-- Index for quick lookups
CREATE INDEX idx_career_page_scans_org_scanned ON public.career_page_scans (organization_id, scanned_at DESC);
