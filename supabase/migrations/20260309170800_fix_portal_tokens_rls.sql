-- ============================================
-- SECURITY FIX: candidate_portal_tokens anon policy
-- ============================================
-- The previous policy "Anyone can view active tokens by token value" allowed
-- anonymous users to list ALL active tokens without knowing the token value.
-- This is a critical data leak. Replace with a SECURITY DEFINER function
-- that requires the caller to provide the exact token value.

-- 1. Drop the overly permissive anon policy
DROP POLICY IF EXISTS "Anyone can view active tokens by token value" ON public.candidate_portal_tokens;

-- 2. Create a secure RPC function that only returns data for a known token
CREATE OR REPLACE FUNCTION public.get_portal_by_token(p_token text)
RETURNS TABLE (
  candidate_name text,
  job_title text,
  company_name text,
  company_logo_url text,
  company_description text,
  pipeline_stage text,
  next_steps text,
  updated_at timestamptz,
  stage_updated_at timestamptz,
  estimated_days_to_next integer,
  recruiter_name text,
  recruiter_email text,
  recruiter_phone text,
  documents jsonb,
  faq jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    t.candidate_name,
    t.job_title,
    t.company_name,
    t.company_logo_url,
    t.company_description,
    t.pipeline_stage,
    t.next_steps,
    t.updated_at,
    t.stage_updated_at,
    t.estimated_days_to_next,
    t.recruiter_name,
    t.recruiter_email,
    t.recruiter_phone,
    t.documents,
    t.faq
  FROM candidate_portal_tokens t
  WHERE t.token = p_token
    AND t.is_active = true
    AND (t.expires_at IS NULL OR t.expires_at > now());
$$;

-- 3. Grant execute to anon role (public portal access)
GRANT EXECUTE ON FUNCTION public.get_portal_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_by_token(text) TO authenticated;
