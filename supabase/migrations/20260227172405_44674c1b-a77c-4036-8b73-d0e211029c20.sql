
-- Create a helper function that pg_cron can use to call process-sequences with the correct auth
-- The secret is stored in a dedicated table readable only by postgres (service role)
CREATE TABLE IF NOT EXISTS public.internal_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- RLS: no public access at all
ALTER TABLE public.internal_config ENABLE ROW LEVEL SECURITY;
-- No policies = no access via API, only via SECURITY DEFINER functions or direct SQL

-- Helper function to call process-sequences with the stored secret
CREATE OR REPLACE FUNCTION public.invoke_process_sequences(p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT value INTO v_secret FROM internal_config WHERE key = 'process_sequences_secret';
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';
  
  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE WARNING 'Missing internal_config for process_sequences';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-sequences',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := json_build_object('action', p_action)::jsonb
  );
END;
$$;
