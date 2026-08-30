-- Désaturation des crons de fond (incident 2026-08-30 : login impossible,
-- auth /token en 504 « context deadline exceeded » — la DB n'avait plus de
-- connexions disponibles). process-agent-tasks tournait chaque minute et
-- trois files toutes les 2 min alors qu'il n'y a aucun usage réel : ~51 %
-- de startup timeouts pg_cron constatés. Tout passe à */5.
-- Déjà appliqué à chaud en prod le 2026-08-30 — idempotent.
-- Les minutes sont décalées (1-4) pour ne pas déclencher tous les jobs à la
-- même minute que les crons séquences déjà en */5 (minute 0).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN (
      'process-agent-tasks',
      'process-email-queue',
      'process-scheduled-actions',
      'process-enrichment-queue',
      'process-inmail-queue'
    )
  LOOP
    PERFORM cron.alter_job(
      job_id := r.jobid,
      schedule := CASE r.jobname
        WHEN 'process-agent-tasks'       THEN '1-59/5 * * * *'
        WHEN 'process-email-queue'       THEN '2-59/5 * * * *'
        WHEN 'process-inmail-queue'      THEN '2-59/5 * * * *'
        WHEN 'process-scheduled-actions' THEN '3-59/5 * * * *'
        WHEN 'process-enrichment-queue'  THEN '4-59/5 * * * *'
      END
    );
  END LOOP;
END $$;
