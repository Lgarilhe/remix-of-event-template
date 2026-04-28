-- Migration : user_template_variables — variables custom des templates
--
-- Permet à l'user de définir ses PROPRES variables réutilisables dans
-- les templates (ex: {{lien_demo}}, {{prix_offre}}, {{nom_produit}}).
--
-- Différent des placeholders auto (prenom, client, etc.) qui sont
-- résolus depuis les vraies données. Ici l'user définit la valeur lui-même.

CREATE TABLE IF NOT EXISTS public.user_template_variables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identifier (snake_case sans accents). Sera utilisé comme {{key}}
  key             text NOT NULL,
  value           text NOT NULL,
  description     text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_template_variables_user_key_unique UNIQUE (user_id, key),
  -- key doit être un identifier valide (snake_case)
  CONSTRAINT user_template_variables_key_format
    CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 50)
);

CREATE INDEX IF NOT EXISTS idx_user_template_variables_user
  ON public.user_template_variables (user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.user_template_variables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_template_variables_select_own ON public.user_template_variables;
CREATE POLICY user_template_variables_select_own
  ON public.user_template_variables
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_template_variables_insert_own ON public.user_template_variables;
CREATE POLICY user_template_variables_insert_own
  ON public.user_template_variables
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_template_variables_update_own ON public.user_template_variables;
CREATE POLICY user_template_variables_update_own
  ON public.user_template_variables
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_template_variables_delete_own ON public.user_template_variables;
CREATE POLICY user_template_variables_delete_own
  ON public.user_template_variables
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_template_variables TO authenticated;
GRANT ALL ON public.user_template_variables TO service_role;

COMMENT ON TABLE public.user_template_variables IS
  'Variables custom de templates definies par l''user (ex: lien_demo, prix, nom_produit). Utilisables dans les message_templates et interpolees par templatePlaceholders.ts.';
