-- ─────────────────────────────────────────────────────────────────────────────
-- Audit Vague 3 #9 — Idempotency webhooks Unipile
--
-- Avant : Unipile retry les webhooks automatiquement (5× si HTTP != 200 selon
-- leur doc). Sans dédup, on traite 2× le même new_relation, message_received,
-- mail_received → analytics surcomptés (ex: 2 replies pour 1 vraie réponse),
-- toasts dupliqués, etc.
--
-- Après : on enregistre chaque webhook dans webhook_event_log avant traitement.
-- Si l'event_id existe déjà → skip. Helper has_processed_event() retourne
-- true si déjà vu.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webhook_event_log (
  -- Format : "{provider}:{event_id_or_hash}" pour collision-free entre providers
  event_key   text PRIMARY KEY,
  provider    text NOT NULL,        -- 'unipile' | 'resend' | 'stripe' | etc.
  event_type  text,                 -- 'message_received', 'mail_received', etc.
  account_id  text,                 -- account_id Unipile pour debug
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_log_received_at
  ON public.webhook_event_log (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_event_log_provider_received
  ON public.webhook_event_log (provider, received_at DESC);

-- RLS : seul service_role écrit/lit (table interne, pas exposée frontend)
ALTER TABLE public.webhook_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_event_log_service_only ON public.webhook_event_log;
CREATE POLICY webhook_event_log_service_only
  ON public.webhook_event_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Helper : tente d'enregistrer un event. Retourne true si nouveau, false si doublon.
-- Permet le pattern "if (await record_webhook_event(...)) { process } else { skip }"
CREATE OR REPLACE FUNCTION public.record_webhook_event(
  p_event_key  text,
  p_provider   text,
  p_event_type text DEFAULT NULL,
  p_account_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  INSERT INTO public.webhook_event_log (event_key, provider, event_type, account_id)
  VALUES (p_event_key, p_provider, p_event_type, p_account_id)
  ON CONFLICT (event_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- ROW_COUNT = 1 si insert nouveau, 0 si conflit (doublon)
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_webhook_event(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_webhook_event(text, text, text, text) TO service_role;

-- Cleanup automatique : on garde 30 jours d'historique (assez pour debug)
-- Cron qui supprime les vieux events
CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.webhook_event_log
  WHERE received_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Schedule cleanup quotidien à 3h du matin
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-webhook-event-log');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cleanup-webhook-event-log',
  '0 3 * * *',
  $$SELECT public.cleanup_old_webhook_events();$$
);
