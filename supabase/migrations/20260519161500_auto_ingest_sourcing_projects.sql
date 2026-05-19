-- ═══════════════════════════════════════════════════════════════════
-- Knowledge Lake — RAG v3: auto-ingest missions (sourcing_projects)
-- ═══════════════════════════════════════════════════════════════════
-- Wires sourcing_projects into the SAME real-time ingestion pipeline as
-- the candidate tables: AFTER INSERT/UPDATE → public.trigger_auto_ingest_
-- context() (generic, already created in 20260319053948_c9267ec9…) →
-- net.http_post → auto-ingest-context edge fn → buildChunksFromSourcing
-- Project (entity_type:'job', entity_id = project id) → ingest-context.
--
-- The chunk content is derived ONLY from brief-semantic fields (title,
-- client, skills, seniority, remote, salary, mission/context) so the
-- SHA-256 content_hash stays stable across the heavy stats churn
-- (stats_*, last_search_at, updated_at) — dedup skips re-embedding,
-- same cost profile as the existing job_candidate_status trigger.
--
-- No new trigger FUNCTION (the existing one is generic via TG_TABLE_NAME).
-- Idempotent (DROP TRIGGER IF EXISTS + CREATE) — safe to replay / paste
-- in the Supabase SQL editor (migrations CI is desynced on this project).
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_auto_ingest_sourcing_projects ON public.sourcing_projects;

CREATE TRIGGER trg_auto_ingest_sourcing_projects
  AFTER INSERT OR UPDATE ON public.sourcing_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();
