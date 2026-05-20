-- ============================================================================
-- Scheduled agent actions — queue les actions LinkedIn approuvées hors-plage
-- horaire (au lieu de les refuser) et les exécute via un cron quand la
-- plage s'ouvre.
--
-- Contexte 2026-05-20 : Laurent essaie d'envoyer un message LinkedIn à 17h15
-- (hors plage 8h-16h pour son user) → le tool refuse. Le user attend que
-- demain matin pour ré-essayer manuellement. Pénible.
--
-- Nouvelle UX : l'user approuve normalement le bandeau, et le système :
--   1. Stocke scheduled_for = next business hours open (8h le lendemain en
--      Europe/Paris pour Laurent).
--   2. Cron toutes les 2 min : SELECT rows WHERE status='approved' AND
--      scheduled_for <= now() AND executed_at IS NULL → appelle l'edge
--      function process-scheduled-actions qui exécute le tool.
--
-- Idempotent : la colonne et l'index sont ajoutés si absents, le cron est
-- unschedulé puis reschedulué.
-- ============================================================================

-- 1. Add scheduled_for column (nullable — la plupart des actions s'exécutent
--    immédiatement, scheduled_for ne sert qu'au cas hors-plage).
ALTER TABLE public.agent_tool_executions
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NULL;

COMMENT ON COLUMN public.agent_tool_executions.scheduled_for IS
  'UTC timestamp at which a queued action becomes eligible for execution. Set when the user approves an action that was deferred (e.g. out-of-business-hours LinkedIn send). Cron process-scheduled-actions picks up rows where scheduled_for <= now() AND status = ''approved'' AND executed_at IS NULL.';

-- 2. Partial index for the cron query (selective : only the rows waiting to run)
CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_scheduled_due
  ON public.agent_tool_executions (scheduled_for)
  WHERE status = 'approved' AND executed_at IS NULL AND scheduled_for IS NOT NULL;

-- 3. Invoker function (same pattern as invoke_process_sequences)
CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_actions()
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
    RAISE WARNING 'Missing internal_config — skipping process-scheduled-actions invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-scheduled-actions',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- 4. Schedule cron every 2 minutes (idempotent : unschedule first)
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-scheduled-actions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

SELECT cron.schedule(
  'process-scheduled-actions',
  '*/2 * * * *',
  $$SELECT public.invoke_process_scheduled_actions();$$
);
