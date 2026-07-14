-- ============================================================================
-- Agent proactif — cron du digest matinal (P2.3 audit 2026-07-14)
-- ============================================================================
-- Appelle l'edge function agent-daily-digest chaque matin de semaine à
-- 6h00 UTC (8h Paris l'été, 7h l'hiver). La fonction ne traite que les orgs
-- opt-in (agent_tool_policies : daily_digest=auto) et est idempotente
-- (un digest par org et par jour) → un double déclenchement est inoffensif.
-- Même pattern qu'invoke_process_scheduled_actions (internal_config).
-- Idempotente, rejouable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invoke_agent_daily_digest()
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
    RAISE WARNING 'Missing internal_config — skipping agent-daily-digest invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/agent-daily-digest',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- Schedule (idempotent : unschedule first)
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('agent-daily-digest');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

DO $do$ BEGIN
  PERFORM cron.schedule(
  'agent-daily-digest',
  '0 6 * * 1-5',
  $$SELECT public.invoke_agent_daily_digest();$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;
