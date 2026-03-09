
-- ============================================
-- RLS Migration: candidate_profiles & match_scores
-- Add organization_id + created_by, org-level RLS policies, backfill
-- ============================================

-- ============================================
-- Phase 1: Schema — candidate_profiles
-- ============================================
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_org_id ON public.candidate_profiles(organization_id);

-- ============================================
-- Phase 2: Schema — match_scores
-- ============================================
ALTER TABLE public.match_scores
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_match_scores_org_id ON public.match_scores(organization_id);

-- ============================================
-- Phase 3: RLS policies — candidate_profiles
-- ============================================
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read" ON public.candidate_profiles;

-- Keep "Service role full access" (Edge Functions need it)

CREATE POLICY "Org members can view candidate profiles"
  ON public.candidate_profiles FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create candidate profiles"
  ON public.candidate_profiles FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update candidate profiles"
  ON public.candidate_profiles FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete candidate profiles"
  ON public.candidate_profiles FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- Phase 4: RLS policies — match_scores
-- ============================================
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can read scores" ON public.match_scores;

-- Keep "Service role full access" (Edge Functions need it)

CREATE POLICY "Org members can view match scores"
  ON public.match_scores FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create match scores"
  ON public.match_scores FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update match scores"
  ON public.match_scores FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete match scores"
  ON public.match_scores FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- Phase 5: Backfill
-- ============================================

-- Step 1: Backfill created_by via job_candidate_status (links candidate_id to a user)
UPDATE public.candidate_profiles cp
  SET created_by = (
    SELECT jcs.created_by
    FROM public.job_candidate_status jcs
    WHERE jcs.candidate_id = cp.candidate_id
    LIMIT 1
  )
  WHERE cp.created_by IS NULL;

UPDATE public.match_scores ms
  SET created_by = (
    SELECT jcs.created_by
    FROM public.job_candidate_status jcs
    WHERE jcs.candidate_id = ms.candidate_id
    LIMIT 1
  )
  WHERE ms.created_by IS NULL;

-- Step 2: Backfill organization_id from created_by → profiles.active_organization_id
UPDATE public.candidate_profiles
  SET organization_id = (
    SELECT active_organization_id
    FROM profiles
    WHERE user_id = candidate_profiles.created_by
    LIMIT 1
  )
  WHERE organization_id IS NULL AND created_by IS NOT NULL;

UPDATE public.match_scores
  SET organization_id = (
    SELECT active_organization_id
    FROM profiles
    WHERE user_id = match_scores.created_by
    LIMIT 1
  )
  WHERE organization_id IS NULL AND created_by IS NOT NULL;
