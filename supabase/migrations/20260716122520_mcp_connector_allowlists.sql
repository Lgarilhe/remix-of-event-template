-- MCP connectors are executed by the hosted model provider, outside Konekt's
-- agent_tool_executions approval lifecycle. Fail closed by requiring an
-- explicit allowlist of read-only tools for every enabled connector.

ALTER TABLE public.organization_mcp_servers
  ADD COLUMN IF NOT EXISTS allowed_tools text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.organization_mcp_servers.allowed_tools IS
  'Explicit allowlist of read-only MCP tool names exposed to the Copilot. Empty means disabled/fail-closed.';

-- The existing updated_at trigger function was flagged by the Supabase
-- security advisor because it inherited a caller-controlled search_path.
ALTER FUNCTION public.set_org_mcp_servers_updated_at()
  SET search_path = pg_catalog;

-- Existing connectors predate allowlists. Disable them until an admin reviews
-- the remote server and explicitly chooses the read-only tools to expose.
UPDATE public.organization_mcp_servers
SET enabled = false
WHERE enabled = true
  AND cardinality(allowed_tools) = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_mcp_servers_allowlist_guard'
      AND conrelid = 'public.organization_mcp_servers'::regclass
  ) THEN
    ALTER TABLE public.organization_mcp_servers
      ADD CONSTRAINT organization_mcp_servers_allowlist_guard CHECK (
        cardinality(allowed_tools) <= 50
        AND (
          cardinality(allowed_tools) = 0
          OR array_to_string(allowed_tools, ',') ~ '^[A-Za-z0-9_.:-]+(,[A-Za-z0-9_.:-]+)*$'
        )
        AND octet_length(array_to_string(allowed_tools, ',')) <= 6500
        AND array_to_string(allowed_tools, ',') !~* '(^|[,_.:-])(create|write|update|delete|remove|send|patch|edit|modify|move|rename|archive|invite|add|upload|execute|run|trigger|publish|approve|reject|assign|enroll|dismiss|cancel|reply)([,_.:-]|$)'
        AND (enabled = false OR cardinality(allowed_tools) > 0)
      );
  END IF;
END
$$;

-- Preserve the write-only token design while exposing only the allowlist.
GRANT SELECT (allowed_tools)
  ON public.organization_mcp_servers TO authenticated;
GRANT INSERT (allowed_tools)
  ON public.organization_mcp_servers TO authenticated;
GRANT UPDATE (allowed_tools)
  ON public.organization_mcp_servers TO authenticated;
