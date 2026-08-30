-- Désaturation des crons de fond (incident 2026-08-30 : login impossible,
-- auth /token en 504 « context deadline exceeded » — la DB n'avait plus de
-- connexions disponibles). process-agent-tasks tournait chaque minute et
-- trois files toutes les 2 min alors qu'il n'y a aucun usage réel : ~51 %
-- de startup timeouts pg_cron constatés. Tout passe à */5.
-- Déjà appliqué à chaud en prod le 2026-08-30 — idempotent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'process-agent-tasks',
      'process-email-queue',
      'process-scheduled-actions',
      'process-enrichment-queue',
      'process-inmail-queue'
    )
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, schedule := '*/5 * * * *');
  END LOOP;
END $$;
