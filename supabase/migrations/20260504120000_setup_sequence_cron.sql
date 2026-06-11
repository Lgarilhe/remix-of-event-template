-- ─────────────────────────────────────────────────────────────────────────────
-- Setup pg_cron pour orchestrer les séquences d'outreach.
--
-- Audit 2026-05-04 : aucun cron actif en prod → les séquences ne s'exécutaient
-- jamais automatiquement. Cette migration installe le cron qui appelle
-- process-sequences toutes les minutes.
--
-- Pré-requis :
--   - Extensions pg_cron et pg_net activées (déjà OK en prod)
--   - PROCESS_SEQUENCES_SECRET configuré dans Supabase function secrets
--   - Le même secret doit être présent dans internal_config (seed via SQL)
--
-- Pour seed le secret en prod, exécuter SÉPARÉMENT (jamais dans une migration
-- pour éviter de versionner le secret) :
--   INSERT INTO internal_config (key, value)
--   VALUES ('process_sequences_secret', '<VALEUR_DU_SECRET>'),
--          ('supabase_functions_url', 'https://crckfywoyjxkawathdff.functions.supabase.co')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. S'assurer que la fonction invoke_process_sequences est à jour
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
    RAISE WARNING 'Missing internal_config (process_sequences_secret or supabase_functions_url) — skipping invocation';
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

-- 2. Helper pour process-email-queue (idem pattern)
CREATE OR REPLACE FUNCTION public.invoke_process_email_queue()
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
    RAISE WARNING 'Missing internal_config — skipping process-email-queue invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-email-queue',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- 3. Helper pour process-inmail-queue
CREATE OR REPLACE FUNCTION public.invoke_process_inmail_queue()
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
    RAISE WARNING 'Missing internal_config — skipping process-inmail-queue invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-inmail-queue',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- 4. Schedule cron jobs (idempotent)
-- Unschedule existing first (no-op si absent)
DO $$
DECLARE
  job_name text;
BEGIN
  FOR job_name IN SELECT unnest(ARRAY[
    'process-sequences-main',
    'process-sequences-replies',
    'process-sequences-timeouts',
    'process-email-queue',
    'process-inmail-queue'
  ])
  LOOP
    BEGIN
      PERFORM cron.unschedule(job_name);
    EXCEPTION WHEN OTHERS THEN
      -- Job didn't exist, ignore
      NULL;
    END;
  END LOOP;
END;
$$;

-- Cron 1 : process-sequences action='process' toutes les minutes (force=true bypass lock pour debug)
DO $do$ BEGIN
  PERFORM cron.schedule(
  'process-sequences-main',
  '* * * * *',
  $$SELECT public.invoke_process_sequences('process', false);$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;

-- Cron 2 : check_replies toutes les 5 min (poll Unipile pour les nouvelles réponses)
DO $do$ BEGIN
  PERFORM cron.schedule(
  'process-sequences-replies',
  '*/5 * * * *',
  $$SELECT public.invoke_process_sequences('check_replies', false);$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;

-- Cron 3 : check_timeouts toutes les 10 min (gère les enrollments stuck)
DO $do$ BEGIN
  PERFORM cron.schedule(
  'process-sequences-timeouts',
  '*/10 * * * *',
  $$SELECT public.invoke_process_sequences('check_timeouts', false);$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;

-- Cron 4 : process-email-queue toutes les 2 min
DO $do$ BEGIN
  PERFORM cron.schedule(
  'process-email-queue',
  '*/2 * * * *',
  $$SELECT public.invoke_process_email_queue();$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;

-- Cron 5 : process-inmail-queue toutes les 3 min
DO $do$ BEGIN
  PERFORM cron.schedule(
  'process-inmail-queue',
  '*/3 * * * *',
  $$SELECT public.invoke_process_inmail_queue();$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;
