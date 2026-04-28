-- Migration : message_templates — réponses-types personnalisées
--
-- Permet à chaque user d'enregistrer ses messages fréquents (intro,
-- relance, présentation poste, etc.) et de les insérer rapidement dans
-- le composer via slash command "/" ou via un picker dédié.
--
-- Scope : per-user (chaque membre a SES propres templates), pas par-org.
-- (On peut faire des templates "partagés org" plus tard si besoin.)

CREATE TABLE IF NOT EXISTS public.message_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Métadonnées
  name            text NOT NULL,         -- "Intro générale", "Relance J+3", etc.
  shortcut        text,                  -- "/intro", "/relance" — slash command optionnel
  emoji           text,                  -- Emoji décoratif optionnel
  category        text,                  -- "Intro", "Relance", "Closing", etc.

  -- Contenu
  content         text NOT NULL,         -- Le message lui-même

  -- Statistiques (utiles pour ranking par usage fréquent)
  usage_count     integer NOT NULL DEFAULT 0,
  last_used_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_templates_user_shortcut_unique
    UNIQUE (user_id, shortcut)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_user
  ON public.message_templates (user_id, last_used_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_message_templates_user_shortcut
  ON public.message_templates (user_id, shortcut)
  WHERE shortcut IS NOT NULL;

-- ─── RLS — accès strict per-user ─────────────────────────────────────

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- SELECT : own templates
DROP POLICY IF EXISTS message_templates_select_own ON public.message_templates;
CREATE POLICY message_templates_select_own
  ON public.message_templates
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT : own templates
DROP POLICY IF EXISTS message_templates_insert_own ON public.message_templates;
CREATE POLICY message_templates_insert_own
  ON public.message_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE : own templates
DROP POLICY IF EXISTS message_templates_update_own ON public.message_templates;
CREATE POLICY message_templates_update_own
  ON public.message_templates
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE : own templates
DROP POLICY IF EXISTS message_templates_delete_own ON public.message_templates;
CREATE POLICY message_templates_delete_own
  ON public.message_templates
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ─── GRANTs ───────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;

-- ─── Comments ─────────────────────────────────────────────────────────

COMMENT ON TABLE public.message_templates IS
  'Templates de messages personnalisés par user (intro, relance, closing). Insérables via slash command dans le composer inbox.';

COMMENT ON COLUMN public.message_templates.shortcut IS
  'Slash command (ex: "/intro"). Doit être unique par user. NULL = pas de raccourci.';

COMMENT ON COLUMN public.message_templates.usage_count IS
  'Nombre de fois utilisé. Sert au ranking dans le picker (les plus utilisés en premier).';
