CREATE TABLE IF NOT EXISTS public.member_email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  email_account_id text NOT NULL,
  email_address text,
  provider text,
  account_status text DEFAULT 'OK',
  linked_at timestamptz DEFAULT now(),
  linked_by uuid NOT NULL,
  UNIQUE (organization_id, email_account_id)
);

CREATE INDEX IF NOT EXISTS idx_member_email_accounts_org ON member_email_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_member_email_accounts_user ON member_email_accounts(user_id);

ALTER TABLE member_email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_email_accounts_select" ON member_email_accounts
  FOR SELECT USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "member_email_accounts_insert" ON member_email_accounts
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "member_email_accounts_update" ON member_email_accounts
  FOR UPDATE USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "member_email_accounts_delete" ON member_email_accounts
  FOR DELETE USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "member_email_accounts_service_role" ON member_email_accounts
  FOR ALL USING (auth.role() = 'service_role');