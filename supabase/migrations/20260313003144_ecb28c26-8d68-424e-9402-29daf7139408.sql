
-- 1. Fix organization_subscriptions: restrict INSERT/UPDATE to service_role only
DROP POLICY IF EXISTS "Only system can insert/update subscriptions" ON organization_subscriptions;
DROP POLICY IF EXISTS "Only system can update subscriptions" ON organization_subscriptions;
DROP POLICY IF EXISTS "service_role_insert_subscriptions" ON organization_subscriptions;
DROP POLICY IF EXISTS "service_role_update_subscriptions" ON organization_subscriptions;

DROP POLICY IF EXISTS "service_role_insert_subscriptions" ON organization_subscriptions;
CREATE POLICY "service_role_insert_subscriptions" ON organization_subscriptions
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_update_subscriptions" ON organization_subscriptions;
CREATE POLICY "service_role_update_subscriptions" ON organization_subscriptions
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- 2. Fix message_analysis_cache: restrict UPDATE to owner via account_id
DROP POLICY IF EXISTS "Authenticated users can update cache" ON message_analysis_cache;
CREATE POLICY "Users can update own cache" ON message_analysis_cache
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM member_linkedin_accounts mla
      WHERE mla.linkedin_account_id = message_analysis_cache.account_id
      AND mla.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM member_linkedin_accounts mla
      WHERE mla.linkedin_account_id = message_analysis_cache.account_id
      AND mla.user_id = auth.uid()
    )
  );

-- 3. Fix profiles: restrict SELECT to same org or own profile
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own or same-org profiles" ON profiles;
CREATE POLICY "Users can view own or same-org profiles" ON profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member(auth.uid(), active_organization_id)
  );

-- 4. Add organization_id to airtable/aircall tables
ALTER TABLE airtable_candidates ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_contacts ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_companies ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_jobs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_shortlists ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_placements ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_notes ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_kpi ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_tasks ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_appointments ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_glossary ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE airtable_shortlists_cumulated ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE aircall_calls ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

-- 5. Update airtable RLS policies to scope by org
DROP POLICY IF EXISTS "Authenticated users can read candidates" ON airtable_candidates;
DROP POLICY IF EXISTS "Org-scoped read candidates" ON airtable_candidates;
CREATE POLICY "Org-scoped read candidates" ON airtable_candidates
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read contacts" ON airtable_contacts;
DROP POLICY IF EXISTS "Org-scoped read contacts" ON airtable_contacts;
CREATE POLICY "Org-scoped read contacts" ON airtable_contacts
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read placements" ON airtable_placements;
DROP POLICY IF EXISTS "Org-scoped read placements" ON airtable_placements;
CREATE POLICY "Org-scoped read placements" ON airtable_placements
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read shortlists" ON airtable_shortlists;
DROP POLICY IF EXISTS "Org-scoped read shortlists" ON airtable_shortlists;
CREATE POLICY "Org-scoped read shortlists" ON airtable_shortlists
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read notes" ON airtable_notes;
DROP POLICY IF EXISTS "Org-scoped read notes" ON airtable_notes;
CREATE POLICY "Org-scoped read notes" ON airtable_notes
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid()));

-- Aircall scoped policy already created in previous partial migration, update it
DROP POLICY IF EXISTS "Org members can read calls" ON aircall_calls;
CREATE POLICY "Org-scoped read calls" ON aircall_calls
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_org_id(auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_airtable_candidates_org ON airtable_candidates(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_airtable_contacts_org ON airtable_contacts(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_airtable_placements_org ON airtable_placements(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_airtable_shortlists_org ON airtable_shortlists(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aircall_calls_org ON aircall_calls(organization_id) WHERE organization_id IS NOT NULL;
