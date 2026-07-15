-- ============================================================================
-- Politiques d'autonomie de l'agent IA (P2.1 audit 2026-07-14)
-- ============================================================================
-- Une row par (org, tool) : comment l'agent exécute ce tool.
--   'auto'    → exécution immédiate (loggée auto_executed, visible dans l'audit)
--   'approve' → bandeau d'approbation (comportement historique, défaut mutations)
--   'off'     → tool refusé ("désactivé par l'administrateur")
--
-- Le défaut (aucune row) reste le comportement historique :
--   reads → auto ; mutations → approve.
-- GARDE-FOU SERVEUR : les tools de catégorie mutation_external et la liste
-- destructive (dismiss/bulk_dismiss/invite/quotas/statut mission) ne peuvent
-- JAMAIS passer en auto — clamp à 'approve' dans agent-tools.ts même si une
-- row dit 'auto'.
--
-- Le pseudo-tool 'daily_digest' (agent proactif) utilise aussi cette table :
-- policy='auto' = digest matinal activé pour l'org (défaut : off).
--
-- Idempotente, rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_tool_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  policy text NOT NULL CHECK (policy IN ('auto', 'approve', 'off')),
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_policies_org_tool_unique UNIQUE (organization_id, tool_name)
);

COMMENT ON TABLE public.agent_tool_policies IS
  'Politique d''exécution par (org, tool) pour l''agent IA : auto (exécution directe), approve (bandeau), off (désactivé). Défaut sans row : reads=auto, mutations=approve. Les tools mutation_external/destructifs sont clampés à approve côté serveur.';

CREATE INDEX IF NOT EXISTS idx_agent_tool_policies_org
  ON public.agent_tool_policies (organization_id);

-- updated_at automatique (même pattern que agent_tool_executions)
CREATE OR REPLACE FUNCTION public.set_agent_tool_policies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_tool_policies_updated_at ON public.agent_tool_policies;
CREATE TRIGGER trg_agent_tool_policies_updated_at
  BEFORE UPDATE ON public.agent_tool_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_agent_tool_policies_updated_at();

-- RLS : lecture pour tous les membres de l'org ; écriture réservée owner/admin.
ALTER TABLE public.agent_tool_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select" ON public.agent_tool_policies;
CREATE POLICY "org_members_select" ON public.agent_tool_policies
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "org_admins_insert" ON public.agent_tool_policies;
CREATE POLICY "org_admins_insert" ON public.agent_tool_policies
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = agent_tool_policies.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_admins_update" ON public.agent_tool_policies;
CREATE POLICY "org_admins_update" ON public.agent_tool_policies
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = agent_tool_policies.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = agent_tool_policies.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_admins_delete" ON public.agent_tool_policies;
CREATE POLICY "org_admins_delete" ON public.agent_tool_policies
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = agent_tool_policies.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- GRANTs (gotcha RLS 2026-04-21 : sans grant explicite → permission denied)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tool_policies TO authenticated;
GRANT ALL ON public.agent_tool_policies TO service_role;
