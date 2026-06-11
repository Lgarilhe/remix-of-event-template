
CREATE OR REPLACE FUNCTION public.invoke_process_sequences(p_action text, p_force boolean DEFAULT false)
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
    body := json_build_object('action', p_action, 'force', p_force)::jsonb
  );
END;
$$;

-- Update the main cron to pass force=true
DO $do$ BEGIN
  PERFORM cron.unschedule('process-sequences-main');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;
DO $do$ BEGIN
  PERFORM cron.schedule(
  'process-sequences-main',
  '* * * * *',
  $$SELECT public.invoke_process_sequences('process', true);$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;
