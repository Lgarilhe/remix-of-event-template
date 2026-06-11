-- ─── Cron mensuel : refresh pedigree directory par stade de financement ────
-- Peuple/refresh pedigree_company_directory avec des sociétés EU classées par
-- montant de la dernière levée (proxy stade financement) via Apollo.
--
-- Programmé 1h AVANT resolve-pedigree-directory (3h UTC vs 4h UTC) pour que
-- les nouvelles entrées (resolution_status='pending') soient resolved en IDs
-- LinkedIn dans le même cycle mensuel.
--
-- Auth via PROCESS_SEQUENCES_SECRET (pattern existant resolve-pedigree-directory).

CREATE OR REPLACE FUNCTION public.invoke_refresh_pedigree_by_funding_stage()
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
    RAISE WARNING 'Missing internal_config for refresh-pedigree-by-funding-stage cron';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/refresh-pedigree-by-funding-stage',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 540000  -- 9 min — l'edge fn loop sur 5 stages × 8 pays = ~40 calls Apollo
  );
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-pedigree-by-funding-stage-monthly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 1er du mois à 3h UTC (1h avant resolve-pedigree-directory à 4h UTC).
DO $do$ BEGIN
  PERFORM cron.schedule(
  'refresh-pedigree-by-funding-stage-monthly',
  '0 3 1 * *',
  $$SELECT public.invoke_refresh_pedigree_by_funding_stage();$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;

COMMENT ON FUNCTION public.invoke_refresh_pedigree_by_funding_stage IS
  'Cron mensuel : invoque l''edge fn refresh-pedigree-by-funding-stage qui peuple pedigree_company_directory via Apollo. Précède le cron resolve-pedigree-directory (4h UTC).';
