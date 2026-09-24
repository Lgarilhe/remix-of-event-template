-- =====================================================================
-- Purge quotidienne de l'historique des tâches planifiées (pg_cron).
--
-- cron.job_run_details garde une ligne par exécution et n'est jamais vidé
-- par pg_cron : 508 695 lignes depuis mai 2026, 107 Mo sur une base de
-- 193 Mo, mesurés le 24/09/2026 pendant une saturation du disque. Une purge
-- manuelle (7 derniers jours gardés) a été faite ce jour-là ; ce job la
-- rejoue chaque nuit.
--
-- cron.schedule remplace un job de même nom : rejouable. Protégé si pg_cron
-- n'est pas installé (base neuve sans l'extension).
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-cron-run-details',
      '40 3 * * *',
      $cmd$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days'$cmd$
    );
  END IF;
END $$;
