-- ============================================================================
-- Migration: RAG Database Webhooks via pg_net
-- Triggers async calls to auto-ingest-context edge function
-- when source data changes, keeping the Knowledge Lake in sync.
-- ============================================================================

-- 1. Ensure pg_net extension is available
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================================
-- TRIGGER FUNCTIONS
-- Each function builds a JSON payload and fires an async HTTP POST
-- via pg_net. If anything fails, it logs a warning and NEVER blocks
-- the original operation.
-- ============================================================================

-- ── job_candidate_status ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_rag_on_job_candidate_status_change()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  edge_url text;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', row_to_json(NEW)::jsonb,
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END
  );

  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-ingest-context';

  IF edge_url IS NULL OR edge_url = '/functions/v1/auto-ingest-context' THEN
    RAISE LOG '[auto-ingest] Supabase URL not configured, skipping RAG ingestion for % on %', TG_OP, TG_TABLE_NAME;
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM extensions.http_post(
    url := edge_url,
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[auto-ingest] Error triggering RAG for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── candidate_notes ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_rag_on_candidate_notes_change()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  edge_url text;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', row_to_json(NEW)::jsonb,
    'old_record', NULL
  );

  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-ingest-context';

  IF edge_url IS NULL OR edge_url = '/functions/v1/auto-ingest-context' THEN
    RAISE LOG '[auto-ingest] Supabase URL not configured, skipping RAG ingestion for % on %', TG_OP, TG_TABLE_NAME;
    RETURN NEW;
  END IF;

  PERFORM extensions.http_post(
    url := edge_url,
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[auto-ingest] Error triggering RAG for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── candidate_comments ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_rag_on_candidate_comments_change()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  edge_url text;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', row_to_json(NEW)::jsonb,
    'old_record', NULL
  );

  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-ingest-context';

  IF edge_url IS NULL OR edge_url = '/functions/v1/auto-ingest-context' THEN
    RAISE LOG '[auto-ingest] Supabase URL not configured, skipping RAG ingestion for % on %', TG_OP, TG_TABLE_NAME;
    RETURN NEW;
  END IF;

  PERFORM extensions.http_post(
    url := edge_url,
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[auto-ingest] Error triggering RAG for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── call_coaching_sessions ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_rag_on_call_coaching_sessions_change()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  edge_url text;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE row_to_json(NEW)::jsonb END,
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END
  );

  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-ingest-context';

  IF edge_url IS NULL OR edge_url = '/functions/v1/auto-ingest-context' THEN
    RAISE LOG '[auto-ingest] Supabase URL not configured, skipping RAG ingestion for % on %', TG_OP, TG_TABLE_NAME;
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM extensions.http_post(
    url := edge_url,
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[auto-ingest] Error triggering RAG for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── qualification_sessions ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_rag_on_qualification_sessions_change()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  edge_url text;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE row_to_json(NEW)::jsonb END,
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END
  );

  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-ingest-context';

  IF edge_url IS NULL OR edge_url = '/functions/v1/auto-ingest-context' THEN
    RAISE LOG '[auto-ingest] Supabase URL not configured, skipping RAG ingestion for % on %', TG_OP, TG_TABLE_NAME;
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM extensions.http_post(
    url := edge_url,
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[auto-ingest] Error triggering RAG for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── sequence_step_executions ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_rag_on_sequence_step_executions_change()
RETURNS TRIGGER AS $$
DECLARE
  payload jsonb;
  edge_url text;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'record', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE row_to_json(NEW)::jsonb END,
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END
  );

  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-ingest-context';

  IF edge_url IS NULL OR edge_url = '/functions/v1/auto-ingest-context' THEN
    RAISE LOG '[auto-ingest] Supabase URL not configured, skipping RAG ingestion for % on %', TG_OP, TG_TABLE_NAME;
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM extensions.http_post(
    url := edge_url,
    body := payload::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true)
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[auto-ingest] Error triggering RAG for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- Each trigger fires AFTER the operation, with conditions to avoid
-- unnecessary webhook calls.
-- ============================================================================

-- job_candidate_status: fire on INSERT or when linkedin_profile_data changes
CREATE TRIGGER trg_rag_job_candidate_status
  AFTER INSERT OR UPDATE ON public.job_candidate_status
  FOR EACH ROW
  WHEN (
    TG_OP = 'INSERT'
    OR NEW.linkedin_profile_data IS DISTINCT FROM OLD.linkedin_profile_data
  )
  EXECUTE FUNCTION public.notify_rag_on_job_candidate_status_change();

-- candidate_notes: fire on INSERT only
CREATE TRIGGER trg_rag_candidate_notes
  AFTER INSERT ON public.candidate_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_rag_on_candidate_notes_change();

-- candidate_comments: fire on INSERT only
CREATE TRIGGER trg_rag_candidate_comments
  AFTER INSERT ON public.candidate_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_rag_on_candidate_comments_change();

-- call_coaching_sessions: fire on INSERT or when transcript/report changes
CREATE TRIGGER trg_rag_call_coaching_sessions
  AFTER INSERT OR UPDATE ON public.call_coaching_sessions
  FOR EACH ROW
  WHEN (
    TG_OP = 'INSERT'
    OR NEW.transcript IS DISTINCT FROM OLD.transcript
    OR NEW.report IS DISTINCT FROM OLD.report
  )
  EXECUTE FUNCTION public.notify_rag_on_call_coaching_sessions_change();

-- qualification_sessions: fire on INSERT or when notes/verdict changes
CREATE TRIGGER trg_rag_qualification_sessions
  AFTER INSERT OR UPDATE ON public.qualification_sessions
  FOR EACH ROW
  WHEN (
    TG_OP = 'INSERT'
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.verdict IS DISTINCT FROM OLD.verdict
  )
  EXECUTE FUNCTION public.notify_rag_on_qualification_sessions_change();

-- sequence_step_executions: fire when status becomes 'sent'
CREATE TRIGGER trg_rag_sequence_step_executions
  AFTER INSERT OR UPDATE ON public.sequence_step_executions
  FOR EACH ROW
  WHEN (
    NEW.status = 'sent'
    AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'sent')
  )
  EXECUTE FUNCTION public.notify_rag_on_sequence_step_executions_change();
