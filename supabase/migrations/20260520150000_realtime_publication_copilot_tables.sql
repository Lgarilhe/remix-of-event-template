-- Add copilot-critical tables to supabase_realtime publication so the
-- frontend channels (AgentToolApprovalCard, MissionSourcing live filters,
-- agent message stream Realtime fallback) actually receive INSERT/UPDATE
-- events. Without this, the frontend Realtime channels are silently dead
-- and rely solely on initial fetch — meaning rows created AFTER mount are
-- never seen (e.g. tool_use → row inserted in agent_tool_executions →
-- bandeau d'approbation invisible until a manual refresh).
--
-- Root cause : at the Lovable→Supabase migration cutover (2026-04-21),
-- the publication was created empty. Diagnosed in prod 2026-05-20 from
-- Laurent's repeated "je vois aucun bandeau" reports while the rows
-- existed in DB.
--
-- Idempotent : each ADD TABLE is wrapped in a DO block that checks
-- pg_publication_tables first.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'agent_tool_executions',
    'agent_messages',
    'agent_conversations',
    'sourcing_projects'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
