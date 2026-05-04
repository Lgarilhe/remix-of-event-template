-- ─────────────────────────────────────────────────────────────────────────────
-- Audit Vague 3 #12 — Heartbeat cron pour détection panne
--
-- Avant : aucune visibilité sur la santé des cron jobs. Si pg_cron rate une
-- exécution (timeout, OOM, secret manquant), discovery uniquement par les
-- logs Supabase. SequenceDiagnostic devait deviner via la dernière
-- step_execution, ce qui n'est fiable que si du trafic existe.
--
-- Après : table cron_heartbeat alimentée par chaque cron job + helper RPC
-- pour écriture concise. Le diagnostic peut alors comparer last_run_at vs
-- now() et alerter à > 30 min sans run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cron_heartbeat (
  job_name      text PRIMARY KEY,
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  last_status   text NOT NULL DEFAULT 'ok',  -- 'ok' | 'error' | 'skipped'
  last_error    text,
  run_count     bigint NOT NULL DEFAULT 0,
  error_count   bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS : lecture autorisée pour authenticated, écriture seulement service_role
ALTER TABLE public.cron_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cron_heartbeat_read ON public.cron_heartbeat;
CREATE POLICY cron_heartbeat_read
  ON public.cron_heartbeat
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS cron_heartbeat_service_write ON public.cron_heartbeat;
CREATE POLICY cron_heartbeat_service_write
  ON public.cron_heartbeat
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.cron_heartbeat TO authenticated;

-- Helper pour écrire un heartbeat depuis edge function ou pg_cron
CREATE OR REPLACE FUNCTION public.record_cron_heartbeat(
  p_job_name text,
  p_status   text DEFAULT 'ok',
  p_error    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.cron_heartbeat (job_name, last_run_at, last_status, last_error, run_count, error_count, updated_at)
  VALUES (
    p_job_name,
    now(),
    COALESCE(p_status, 'ok'),
    p_error,
    1,
    CASE WHEN p_status = 'error' THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (job_name) DO UPDATE
    SET last_run_at = EXCLUDED.last_run_at,
        last_status = EXCLUDED.last_status,
        last_error  = EXCLUDED.last_error,
        run_count   = public.cron_heartbeat.run_count + 1,
        error_count = public.cron_heartbeat.error_count + CASE WHEN EXCLUDED.last_status = 'error' THEN 1 ELSE 0 END,
        updated_at  = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_cron_heartbeat(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cron_heartbeat(text, text, text) TO authenticated, service_role;
