-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Trigger function: calls auto-ingest-context via pg_net
CREATE OR REPLACE FUNCTION public.trigger_auto_ingest_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_url text;
  v_anon_key text;
  v_payload jsonb;
BEGIN
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';
  SELECT value INTO v_anon_key FROM internal_config WHERE key = 'supabase_anon_key';

  IF v_url IS NULL OR v_anon_key IS NULL THEN
    RAISE WARNING 'Missing internal_config for auto-ingest-context';
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', to_jsonb(NEW),
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
  );

  PERFORM net.http_post(
    url := v_url || '/auto-ingest-context',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := v_payload
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Triggers on critical tables

DROP TRIGGER IF EXISTS trg_auto_ingest_job_candidate_status ON public.job_candidate_status;
CREATE TRIGGER trg_auto_ingest_job_candidate_status
  AFTER INSERT OR UPDATE ON public.job_candidate_status
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

DROP TRIGGER IF EXISTS trg_auto_ingest_candidate_notes ON public.candidate_notes;
CREATE TRIGGER trg_auto_ingest_candidate_notes
  AFTER INSERT OR UPDATE ON public.candidate_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

DROP TRIGGER IF EXISTS trg_auto_ingest_candidate_comments ON public.candidate_comments;
CREATE TRIGGER trg_auto_ingest_candidate_comments
  AFTER INSERT OR UPDATE ON public.candidate_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

DROP TRIGGER IF EXISTS trg_auto_ingest_coaching_sessions ON public.call_coaching_sessions;
CREATE TRIGGER trg_auto_ingest_coaching_sessions
  AFTER INSERT OR UPDATE ON public.call_coaching_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

DROP TRIGGER IF EXISTS trg_auto_ingest_candidate_evaluations ON public.candidate_evaluations;
CREATE TRIGGER trg_auto_ingest_candidate_evaluations
  AFTER INSERT OR UPDATE ON public.candidate_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();