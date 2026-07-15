-- ============================================================================
-- Connecteurs MCP par organisation (P3.1 — 2026-07-14)
-- ============================================================================
-- Serveurs MCP distants (Model Context Protocol) attachés au Copilot d'une
-- org : Notion, Slack, calendriers, outils internes… L'API IA s'y connecte
-- côté serveur (connecteur MCP natif) — les outils exposés par ces serveurs
-- deviennent disponibles dans la boucle d'outils de search-agent-chat.
--
-- SÉCURITÉ TOKEN : authorization_token est WRITE-ONLY pour les clients
-- authentifiés — grants PAR COLONNE : INSERT/UPDATE incluent le token,
-- SELECT l'exclut. Seul service_role (edge functions) peut le lire.
-- ⚠️ Conséquence : le frontend doit SELECTionner des colonnes explicites
-- (jamais select('*') sur cette table).
--
-- Idempotente, rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Nom court du connecteur (slug, unique par org) — référencé par l'agent
  name text NOT NULL,
  url text NOT NULL CHECK (url LIKE 'https://%'),
  -- Bearer token optionnel — WRITE-ONLY côté client (voir grants)
  authorization_token text NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_mcp_servers_org_name_unique UNIQUE (organization_id, name),
  CONSTRAINT organization_mcp_servers_name_format CHECK (name ~ '^[a-z0-9][a-z0-9_-]{1,39}$')
);

COMMENT ON TABLE public.organization_mcp_servers IS
  'Serveurs MCP distants attachés au Copilot d''une organisation. authorization_token est write-only pour authenticated (grants par colonne) — lecture service_role uniquement.';

CREATE INDEX IF NOT EXISTS idx_org_mcp_servers_org
  ON public.organization_mcp_servers (organization_id);

-- updated_at automatique
CREATE OR REPLACE FUNCTION public.set_org_mcp_servers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_mcp_servers_updated_at ON public.organization_mcp_servers;
CREATE TRIGGER trg_org_mcp_servers_updated_at
  BEFORE UPDATE ON public.organization_mcp_servers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_org_mcp_servers_updated_at();

-- RLS : lecture membres org ; écriture owner/admin (même pattern que
-- agent_tool_policies).
ALTER TABLE public.organization_mcp_servers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select" ON public.organization_mcp_servers;
CREATE POLICY "org_members_select" ON public.organization_mcp_servers
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "org_admins_insert" ON public.organization_mcp_servers;
CREATE POLICY "org_admins_insert" ON public.organization_mcp_servers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_mcp_servers.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_admins_update" ON public.organization_mcp_servers;
CREATE POLICY "org_admins_update" ON public.organization_mcp_servers
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_mcp_servers.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_mcp_servers.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_admins_delete" ON public.organization_mcp_servers;
CREATE POLICY "org_admins_delete" ON public.organization_mcp_servers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_mcp_servers.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- GRANTS PAR COLONNE — le token est write-only pour authenticated.
REVOKE ALL ON public.organization_mcp_servers FROM authenticated;
GRANT SELECT (id, organization_id, name, url, enabled, created_by, created_at, updated_at)
  ON public.organization_mcp_servers TO authenticated;
GRANT INSERT (organization_id, name, url, authorization_token, enabled, created_by)
  ON public.organization_mcp_servers TO authenticated;
GRANT UPDATE (name, url, authorization_token, enabled)
  ON public.organization_mcp_servers TO authenticated;
GRANT DELETE ON public.organization_mcp_servers TO authenticated;
GRANT ALL ON public.organization_mcp_servers TO service_role;
