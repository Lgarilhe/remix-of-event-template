-- ============================================
-- Migration: search_failure_log — boîte noire des échecs de recherche LinkedIn
-- ============================================
-- Chaque échec de recherche (unipile-search handleSearch) enregistre le
-- payload exact envoyé au provider + l'erreur brute renvoyée. Diagnostic des
-- multiple_sessions / unable to process sans dépendre des logs console edge
-- (non exposés via MCP). Écrit par service_role uniquement, purgé à 14 jours
-- par le cron cleanup existant (voir cleanup_search_failure_log).
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.search_failure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  account_id text,
  http_status int,
  error_type text,
  error_detail text,
  search_body jsonb
);

CREATE INDEX IF NOT EXISTS idx_search_failure_log_created
  ON public.search_failure_log (created_at DESC);

ALTER TABLE public.search_failure_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Service role only" ON public.search_failure_log
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_search_failure_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.search_failure_log WHERE created_at < now() - interval '14 days';
$$;

-- Purge quotidienne (idempotent : unschedule si déjà présent)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-search-failure-log');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('cleanup-search-failure-log', '25 3 * * *', 'SELECT public.cleanup_search_failure_log();');
