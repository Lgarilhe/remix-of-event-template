-- Optimize RLS performance by making get_user_org_id() use a cached approach
-- The current function queries profiles table on EVERY row check
-- This version uses set_config/current_setting for per-transaction caching

CREATE OR REPLACE FUNCTION public.get_user_org_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_org_id uuid;
  v_cache_key text;
BEGIN
  -- Check transaction-level cache first
  v_cache_key := 'app.user_org_' || p_user_id::text;
  BEGIN
    v_org_id := current_setting(v_cache_key, true)::uuid;
    IF v_org_id IS NOT NULL THEN
      RETURN v_org_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Setting doesn't exist yet, continue to lookup
    NULL;
  END;

  -- Lookup from profiles table
  SELECT active_organization_id INTO v_org_id
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  -- Cache for this transaction
  IF v_org_id IS NOT NULL THEN
    PERFORM set_config(v_cache_key, v_org_id::text, true);
  END IF;

  RETURN v_org_id;
END;
$$;
