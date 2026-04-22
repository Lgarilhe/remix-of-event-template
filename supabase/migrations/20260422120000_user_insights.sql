-- ============================================================================
-- Sprint 3 (RAG_AGENT_AUDIT.md §8) — Mémoire cross-session de l'agent IA
-- ============================================================================
-- Stocke les insights persistants extraits des conversations chat. Ces facts
-- sont injectés dans le system prompt de toutes les nouvelles conversations
-- pour que l'agent se "souvienne" du recruteur (préférences, patterns, style).
--
-- Exemples :
--   - "Paul vise principalement des candidats Senior+ (5+ ans XP)"
--   - "Marie ferme les missions en 25j en moyenne, préfère candidats locaux"
--   - "Cabinet cible Series A/B en SaaS B2B"
--   - "Style de message : direct, tutoiement, phrases courtes"
--
-- Extraction : hook post-conversation qui demande à Claude Haiku d'extraire
-- 0-3 insights durables. Évite les facts circonstanciels ("a parlé de X
-- aujourd'hui") au profit de patterns ("préfère X").

CREATE TABLE IF NOT EXISTS public.user_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  insight_type text NOT NULL
    CHECK (insight_type IN ('preference', 'pattern', 'style', 'expertise', 'context')),
  -- Catégorie pour grouper l'injection (ex: "candidate_preferences", "mission_pattern")
  category text NOT NULL,
  -- Le fact lui-même, court (1-2 phrases max)
  content text NOT NULL,
  -- Confidence 0-1 : combien de fois ça a été observé / cohérent
  confidence numeric(3, 2) NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),

  -- Conversation source (pour la traçabilité)
  source_conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,

  -- Utilisé pour le decay : si plus utilisé depuis longtemps, on baisse la priority
  last_used_at timestamptz NOT NULL DEFAULT now(),
  use_count integer NOT NULL DEFAULT 0,

  -- Embedding pour le retrieval pertinent (Sprint 3 v2)
  -- embedding vector(1536), -- enabled quand on génère les embeddings

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index pour fetch rapide les insights d'un user (organisé par dernière utilisation)
CREATE INDEX IF NOT EXISTS idx_user_insights_user_last_used
  ON public.user_insights (user_id, organization_id, last_used_at DESC);

-- Index pour grouper par catégorie (utile dans les system prompts)
CREATE INDEX IF NOT EXISTS idx_user_insights_user_category
  ON public.user_insights (user_id, category);

CREATE OR REPLACE FUNCTION public.set_user_insights_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_user_insights_updated_at ON public.user_insights;
CREATE TRIGGER trg_user_insights_updated_at
  BEFORE UPDATE ON public.user_insights
  FOR EACH ROW EXECUTE FUNCTION public.set_user_insights_updated_at();

-- RLS : un user ne voit que ses propres insights
ALTER TABLE public.user_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_insights_select" ON public.user_insights;
CREATE POLICY "own_insights_select" ON public.user_insights
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "own_insights_update" ON public.user_insights;
CREATE POLICY "own_insights_update" ON public.user_insights
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "own_insights_delete" ON public.user_insights;
CREATE POLICY "own_insights_delete" ON public.user_insights
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

-- INSERT réservé au service_role (l'extraction se fait via edge function admin)

GRANT SELECT, UPDATE, DELETE ON public.user_insights TO authenticated;
GRANT ALL ON public.user_insights TO service_role;
