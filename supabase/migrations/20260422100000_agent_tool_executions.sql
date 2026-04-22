-- ============================================================================
-- Sprint 1 — Mutations: traçabilité des actions proposées par l'agent IA.
-- ============================================================================
-- Pattern human-in-the-loop : Claude propose une mutation via tool use →
-- une row 'proposed' est créée → l'UI affiche un bandeau d'approbation →
-- l'user approuve/rejette/modifie → on passe à 'approved'/'rejected' →
-- l'exécution réelle passe à 'executed' (ou 'failed' si l'API tierce KO).
--
-- Garde-fou contre les agents qui font des bêtises tout seul. Toutes les
-- mutations passent par cette table — audit trail complet.

CREATE TABLE IF NOT EXISTS public.agent_tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  -- params envoyés par Claude (input du tool call). JSONB pour flexibilité.
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'executed', 'failed', 'auto_executed')),
  -- Result du dryRun() — preview "voici ce qui va se passer" affichée à l'user.
  dry_run_result jsonb,
  -- Result du execute() — ce qui a réellement été fait. Inclut error si 'failed'.
  real_result jsonb,
  -- Optional rejection reason / user note when modifying params before approval
  user_note text,
  -- Timing
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for the UI : list les actions en attente d'approbation pour une conv
CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_conv_status
  ON public.agent_tool_executions (conversation_id, status, proposed_at DESC);

-- Index for the audit dashboard : actions executed par org
CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_org_executed
  ON public.agent_tool_executions (organization_id, executed_at DESC)
  WHERE status = 'executed';

-- updated_at trigger (pattern standard du projet)
CREATE OR REPLACE FUNCTION public.set_agent_tool_executions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_tool_executions_updated_at ON public.agent_tool_executions;
CREATE TRIGGER trg_agent_tool_executions_updated_at
  BEFORE UPDATE ON public.agent_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_agent_tool_executions_updated_at();

-- RLS — multi-tenant standard : org members peuvent voir/agir sur leurs propres
-- exécutions, service_role bypass (les edge functions écrivent via service key).
ALTER TABLE public.agent_tool_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select" ON public.agent_tool_executions;
CREATE POLICY "org_members_select" ON public.agent_tool_executions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "org_members_update" ON public.agent_tool_executions;
CREATE POLICY "org_members_update" ON public.agent_tool_executions
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND user_id = auth.uid())
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND user_id = auth.uid());

-- INSERT/DELETE réservés au service_role (les edge functions agent uniquement)

-- GRANTs (cohérence avec fix-organizations-rls.sql)
GRANT SELECT, UPDATE ON public.agent_tool_executions TO authenticated;
GRANT ALL ON public.agent_tool_executions TO service_role;
