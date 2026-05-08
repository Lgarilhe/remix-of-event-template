-- ─── Liste de concurrents par client (org-scoped) ──────────────────────────
-- Permet aux orgs de configurer pour chaque client une liste de concurrents
-- directs. Utilisée pour :
-- 1. **Bonus scoring** : un profil ayant bossé chez un concurrent du client
--    devient un signal positif fort (passé au LLM via targetCompanies).
-- 2. **Sourcing chirurgical** ("poach mode") : l'utilisateur peut cocher
--    "cibler uniquement les concurrents" → injection des linkedin_company_id
--    directement dans le filtre company Unipile (recherche restreinte).
--
-- L'utilisateur peut générer la liste avec l'IA (edge fn generate-client-
-- competitors) ou ajouter à la main. Les linkedin_ids sont résolus en async
-- par le cron resolve-pedigree-directory.

CREATE TABLE IF NOT EXISTS public.client_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Clé fonctionnelle : normalisé (lowercase trim) pour matcher les missions
  client_company_name text NOT NULL,
  client_company_name_normalized text NOT NULL,

  competitor_name text NOT NULL,
  -- Catégorisation libre : "direct" = même produit/marché, "adjacent" = même
  -- secteur mais offre différente
  relation_kind text DEFAULT 'direct' CHECK (relation_kind IN ('direct', 'adjacent', 'inspirational')),
  reason text,                                  -- Justif courte (auto-générée ou saisie)
  country text,
  domain text,
  linkedin_company_id text,                     -- Résolu via cron (Unipile get_parameters)

  enabled boolean DEFAULT true,
  source text DEFAULT 'manual',                 -- 'manual' | 'ai_suggested'
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, client_company_name_normalized, competitor_name)
);

CREATE INDEX IF NOT EXISTS idx_client_competitors_org_client
  ON public.client_competitors (organization_id, client_company_name_normalized);
CREATE INDEX IF NOT EXISTS idx_client_competitors_resolution
  ON public.client_competitors (linkedin_company_id) WHERE linkedin_company_id IS NULL;

-- ─── Trigger : normalise client_company_name automatiquement ────────────────
CREATE OR REPLACE FUNCTION public.normalize_client_competitor_name()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.client_company_name_normalized = lower(trim(NEW.client_company_name));
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_client_competitor ON public.client_competitors;
CREATE TRIGGER trg_normalize_client_competitor
  BEFORE INSERT OR UPDATE ON public.client_competitors
  FOR EACH ROW EXECUTE FUNCTION public.normalize_client_competitor_name();

-- ─── RLS : org members peuvent CRUD ─────────────────────────────────────────
ALTER TABLE public.client_competitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read competitors" ON public.client_competitors;
CREATE POLICY "Org members read competitors"
  ON public.client_competitors FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members write competitors" ON public.client_competitors;
CREATE POLICY "Org members write competitors"
  ON public.client_competitors FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  ) WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role full competitors" ON public.client_competitors;
CREATE POLICY "Service role full competitors"
  ON public.client_competitors FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_competitors TO authenticated;
GRANT ALL ON public.client_competitors TO service_role;

COMMENT ON TABLE public.client_competitors IS
  'Liste de concurrents par client (org-scoped). Utilisée comme signal positif au scoring + mode chirurgical Unipile (recherche restreinte aux profils issus des concurrents).';
