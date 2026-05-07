-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: cron invoke functions for email/inmail queues
--
-- Bugs présents en prod depuis longtemps :
--   1. invoke_process_inmail_queue envoie body=`{}` mais l'edge function
--      process-inmail-queue attend `{action: "process"}` → erreur 400 toutes
--      les 3 minutes "Unknown action: undefined".
--   2. invoke_process_email_queue envoie le `process_sequences_secret` (un
--      secret custom non-JWT) en Bearer header. Mais process-email-queue
--      vérifie que le JWT a `claims.role === 'service_role'` → erreur 403
--      toutes les 2 minutes "Forbidden".
--
-- Fix 1 : ajouter `{action: "process"}` dans invoke_process_inmail_queue.
-- Fix 2 : laisser le secret custom mais l'edge function sera amendée pour
-- accepter aussi PROCESS_SEQUENCES_SECRET en plus du JWT service_role.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.invoke_process_inmail_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT value INTO v_secret FROM internal_config WHERE key = 'process_sequences_secret';
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE WARNING 'Missing internal_config — skipping process-inmail-queue invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-inmail-queue',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := json_build_object('action', 'process')::jsonb
  );
END;
$function$;
