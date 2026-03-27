CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_org_id uuid;
  v_cache_key text;
BEGIN
  v_cache_key := 'app.user_org_' || _user_id::text;
  BEGIN
    v_org_id := current_setting(v_cache_key, true)::uuid;
    IF v_org_id IS NOT NULL THEN
      RETURN v_org_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT active_organization_id INTO v_org_id
  FROM public.profiles
  WHERE user_id = _user_id
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    PERFORM set_config(v_cache_key, v_org_id::text, true);
  END IF;

  RETURN v_org_id;
END;
$$;