
-- 1. Add organization_id to message_analysis_cache for proper tenant isolation
ALTER TABLE public.message_analysis_cache 
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- 2. Backfill organization_id from member_linkedin_accounts
UPDATE public.message_analysis_cache mac
SET organization_id = mla.organization_id
FROM public.member_linkedin_accounts mla
WHERE mla.linkedin_account_id = mac.account_id
  AND mac.organization_id IS NULL;

-- 3. Drop overly permissive policies on message_analysis_cache
DROP POLICY IF EXISTS "Authenticated users can read analysis cache" ON public.message_analysis_cache;
DROP POLICY IF EXISTS "Authenticated users can insert analysis cache" ON public.message_analysis_cache;
DROP POLICY IF EXISTS "Authenticated users can update analysis cache" ON public.message_analysis_cache;

-- 4. Create proper org-filtered policies
CREATE POLICY "Org members can read analysis cache"
ON public.message_analysis_cache
FOR SELECT TO authenticated
USING (
  organization_id = get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND EXISTS (
    SELECT 1 FROM member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
    AND mla.user_id = auth.uid()
  ))
);

CREATE POLICY "Org members can insert analysis cache"
ON public.message_analysis_cache
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND EXISTS (
    SELECT 1 FROM member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
    AND mla.user_id = auth.uid()
  ))
);

CREATE POLICY "Org members can update analysis cache"
ON public.message_analysis_cache
FOR UPDATE TO authenticated
USING (
  organization_id = get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND EXISTS (
    SELECT 1 FROM member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
    AND mla.user_id = auth.uid()
  ))
)
WITH CHECK (
  organization_id = get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND EXISTS (
    SELECT 1 FROM member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
    AND mla.user_id = auth.uid()
  ))
);
