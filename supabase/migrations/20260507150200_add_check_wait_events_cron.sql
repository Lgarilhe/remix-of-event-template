-- ─────────────────────────────────────────────────────────────────────────────
-- Cron : check_wait_events
--
-- Audit Opus 2026-05-07 : la migration 20260504120000_setup_sequence_cron
-- planifie 5 jobs (process / check_replies / check_timeouts / email-queue /
-- inmail-queue) MAIS oublie `check_wait_events`. Conséquence : si le webhook
-- Unipile `new_relation` rate (Unipile down, secret invalide, account
-- déconnecté), un enrollment en `waiting_event` reste bloqué indéfiniment.
--
-- Le handler `handleCheckWaitEvents` dans process-sequences a déjà sa propre
-- logique de throttle interne (8h pour les appels API, fast DB-only sinon),
-- donc on peut le cronner toutes les 15 min sans surcharge.
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-sequences-wait-events');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

SELECT cron.schedule(
  'process-sequences-wait-events',
  '*/15 * * * *',
  $$SELECT public.invoke_process_sequences('check_wait_events', false);$$
);
