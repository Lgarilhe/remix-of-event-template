-- ─── Cron mensuel : purge RGPD automatique ─────────────────────────────────
-- L'edge function rgpd-purge implémente les politiques de rétention
-- (candidats inactifs > 24 mois, refusés/retirés > 12 mois, audio coaching
-- > 6 mois) mais n'était planifiée nulle part : les purges ne s'exécutaient
-- jamais. Ce cron l'invoque le 1er de chaque mois à 5h UTC (après les crons
-- pedigree de 3h/4h UTC).
--
-- Auth via PROCESS_SEQUENCES_SECRET (pattern existant refresh-pedigree /
-- resolve-pedigree-directory) — l'edge fn accepte service_role OU ce secret.

CREATE OR REPLACE FUNCTION public.invoke_rgpd_purge()
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
    RAISE WARNING 'Missing internal_config for rgpd-purge cron';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/rgpd-purge',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000  -- 5 min — DELETEs batchés (limit 500 par catégorie)
  );
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('rgpd-purge-monthly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 1er du mois à 5h UTC.
DO $do$ BEGIN
  PERFORM cron.schedule(
  'rgpd-purge-monthly',
  '0 5 1 * *',
  $$SELECT public.invoke_rgpd_purge();$$
);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;

COMMENT ON FUNCTION public.invoke_rgpd_purge IS
  'Cron mensuel : invoque l''edge fn rgpd-purge (rétentions RGPD 24/12/6 mois avec audit log rgpd_purge_log).';
