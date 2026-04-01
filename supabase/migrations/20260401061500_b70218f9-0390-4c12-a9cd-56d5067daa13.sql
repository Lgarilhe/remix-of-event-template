CREATE TABLE IF NOT EXISTS email_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  is_default boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_signatures_org ON email_signatures(organization_id);

ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_signatures_select" ON email_signatures
  FOR SELECT USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "email_signatures_insert" ON email_signatures
  FOR INSERT WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "email_signatures_update" ON email_signatures
  FOR UPDATE USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "email_signatures_delete" ON email_signatures
  FOR DELETE USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "email_signatures_service_role" ON email_signatures
  FOR ALL USING (auth.role() = 'service_role');