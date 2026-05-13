-- ─────────────────────────────────────────────────────────────────────────────
-- Ralentit le cron principal process-sequences de toutes les minutes à toutes
-- les 5 minutes.
--
-- Contexte (2026-05-13) : Laurent a reçu un warning LinkedIn (Reference
-- # 260513-007211) « partage de licence Recruiter détecté ». L'audit a montré
-- que le cron à `* * * * *` crée une signature d'activité régulière 24/7 qui,
-- combinée au cookie rejoué depuis IPs serveur, est détectée comme un bot
-- partageant une session Recruiter. Passer à `*/5 * * * *` :
--   - Réduit le pattern régulier (intervalle plus espacé)
--   - Reste compatible avec les batch limits internes (5 visible actions/cycle)
--   - Préserve la latence end-to-end acceptable pour l'outreach (< 5 min)
--
-- Idempotent : unschedule puis reschedule.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-sequences-main');
  EXCEPTION WHEN OTHERS THEN
    -- Job didn't exist, ignore
    NULL;
  END;
END;
$$;

SELECT cron.schedule(
  'process-sequences-main',
  '*/5 * * * *',  -- toutes les 5 min (au lieu de toutes les minutes)
  $$SELECT public.invoke_process_sequences('process', false);$$
);
