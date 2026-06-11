
-- ====================================================================
-- SECURITY FIX: candidate_portal_tokens — replace anon SELECT policy
-- ====================================================================
DROP POLICY IF EXISTS "Anyone can view active tokens by token value" ON public.candidate_portal_tokens;

CREATE OR REPLACE FUNCTION public.get_portal_token(p_token text)
RETURNS SETOF public.candidate_portal_tokens
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.candidate_portal_tokens
  WHERE token = p_token
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
$$;

-- ====================================================================
-- SECURITY FIX: candidate_notes — drop overly permissive SELECT
-- ====================================================================
DROP POLICY IF EXISTS "Users can view all notes" ON public.candidate_notes;

-- ====================================================================
-- SECURITY FIX: profiles — restrict to authenticated users only
-- ====================================================================
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- ====================================================================
-- SECURITY FIX: sequence_steps — restrict to org members
-- ====================================================================
DROP POLICY IF EXISTS "Anyone can view sequence steps" ON public.sequence_steps;

CREATE POLICY "Org members can view sequence steps"
  ON public.sequence_steps FOR SELECT
  TO authenticated
  USING (
    (organization_id = get_user_org_id(auth.uid()))
    OR (organization_id IS NULL AND EXISTS (
      SELECT 1 FROM outreach_sequences os
      WHERE os.id = sequence_steps.sequence_id
        AND (os.organization_id = get_user_org_id(auth.uid())
             OR (os.organization_id IS NULL AND os.created_by = auth.uid()))
    ))
  );

-- ====================================================================
-- SECURITY FIX: sequence_analytics — restrict to authenticated via sequence
-- ====================================================================
DROP POLICY IF EXISTS "Anyone can view sequence analytics" ON public.sequence_analytics;

DROP POLICY IF EXISTS "Org members can view sequence analytics" ON public.sequence_analytics;
CREATE POLICY "Org members can view sequence analytics"
  ON public.sequence_analytics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM outreach_sequences os
      WHERE os.id = sequence_analytics.sequence_id
        AND (os.organization_id = get_user_org_id(auth.uid())
             OR (os.organization_id IS NULL AND os.created_by = auth.uid()))
    )
  );

-- ====================================================================
-- SECURITY FIX: sequence_processing_lock — service_role only
-- ====================================================================
DROP POLICY IF EXISTS "Service role manages lock" ON public.sequence_processing_lock;

CREATE POLICY "Service role manages lock"
  ON public.sequence_processing_lock FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ====================================================================
-- SECURITY FIX: sequence_step_executions — tighten NULL org_id bypass
-- ====================================================================
DROP POLICY IF EXISTS "Org members can manage step executions" ON public.sequence_step_executions;
DROP POLICY IF EXISTS "Org members can view step executions" ON public.sequence_step_executions;

CREATE POLICY "Org members can view step executions"
  ON public.sequence_step_executions FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND EXISTS (
      SELECT 1 FROM sequence_enrollments se
      WHERE se.id = sequence_step_executions.enrollment_id
        AND (se.organization_id = get_user_org_id(auth.uid())
             OR (se.organization_id IS NULL AND se.created_by = auth.uid()))
    ))
  );

DROP POLICY IF EXISTS "Org members can manage step executions" ON public.sequence_step_executions;
CREATE POLICY "Org members can manage step executions"
  ON public.sequence_step_executions FOR ALL
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND EXISTS (
      SELECT 1 FROM sequence_enrollments se
      WHERE se.id = sequence_step_executions.enrollment_id
        AND (se.organization_id = get_user_org_id(auth.uid())
             OR (se.organization_id IS NULL AND se.created_by = auth.uid()))
    ))
  );
