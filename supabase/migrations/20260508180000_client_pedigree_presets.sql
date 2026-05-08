-- ─── Pedigree presets clients réutilisables ─────────────────────────────────
--
-- Permet aux orgs de définir des "profils de client type" qui paramètrent
-- automatiquement le scoring sur leurs missions. Exemple : pour le client
-- BlaBlaCar, exiger systématiquement "École Polytechnique/Centrale/HEC OU
-- expérience scale-up Series B+".
--
-- Le preset peut être :
-- - associé à un nom de client (auto-applied quand on crée une mission pour
--   ce client_name)
-- - sélectionné manuellement dans le BriefWizard
--
-- L'application au scoring se fait en injectant pedigree_requirements dans
-- job_details, puis le SCORING_SYSTEM_PROMPT honore ces critères avec
-- priorité sur les règles d'équité par défaut.

CREATE TABLE IF NOT EXISTS public.client_pedigree_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identité du preset
  name text NOT NULL,                       -- "BlaBlaCar — Top tech FR"
  description text,                          -- Note interne
  client_company_name text,                  -- Si associé à un client précis

  -- Le contenu du preset (structure jsonb pour flexibilité)
  -- Schema typescript dans src/types/pedigreePreset.ts :
  -- {
  --   schools_required?: string[];          // Polytechnique, Centrale, HEC...
  --   diploma_must_be_from?: 'france' | 'eu' | 'any';
  --   companies_required_provenance?: ('gafam' | 'scale_up' | 'startup_funded'
  --                                    | 'big_tech_us' | 'banque_assurance'
  --                                    | 'cabinet_strategy' | 'esn')[];
  --   companies_specific_required?: string[]; // ex: ["Stripe", "Doctolib"]
  --   companies_avoid?: ('esn_body_shopping' | 'small_consulting')[];
  --   min_seniority?: string;               // 'lead', 'staff', 'principal'
  --   strict_mode?: boolean;                // true = profil non-conforme = score ≤ 50
  --   custom_instructions?: string;         // Texte libre additionnel
  -- }
  pedigree_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Auto-application : si is_default_for_client + client_company_name renseigné,
  -- ce preset est sélectionné par défaut quand on crée une nouvelle mission
  -- pour ce client. L'user peut override.
  is_default_for_client boolean DEFAULT false,

  -- Métadonnées
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes pour les lookups les plus fréquents
CREATE INDEX IF NOT EXISTS idx_client_pedigree_presets_org
  ON public.client_pedigree_presets (organization_id);

-- Lookup auto-application par client_name
CREATE INDEX IF NOT EXISTS idx_client_pedigree_presets_default
  ON public.client_pedigree_presets (organization_id, client_company_name, is_default_for_client)
  WHERE is_default_for_client = true AND client_company_name IS NOT NULL;

-- Une org peut avoir au max UN preset par défaut par client_company_name
CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_preset_per_client
  ON public.client_pedigree_presets (organization_id, client_company_name)
  WHERE is_default_for_client = true AND client_company_name IS NOT NULL;

-- ─── Lien sourcing_projects → preset (optionnel) ──────────────────────────
-- Quand l'user sélectionne un preset pour une mission, on garde la trace
-- pour le re-scoring futur (sinon les pedigree_requirements seraient figés
-- dans job_details snapshot mais sans lien vers le preset master).

ALTER TABLE public.sourcing_projects
  ADD COLUMN IF NOT EXISTS pedigree_preset_id uuid REFERENCES public.client_pedigree_presets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sourcing_projects_pedigree_preset
  ON public.sourcing_projects (pedigree_preset_id)
  WHERE pedigree_preset_id IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.client_pedigree_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read pedigree presets" ON public.client_pedigree_presets;
CREATE POLICY "Org members read pedigree presets"
  ON public.client_pedigree_presets FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members create pedigree presets" ON public.client_pedigree_presets;
CREATE POLICY "Org members create pedigree presets"
  ON public.client_pedigree_presets FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members update pedigree presets" ON public.client_pedigree_presets;
CREATE POLICY "Org members update pedigree presets"
  ON public.client_pedigree_presets FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members delete pedigree presets" ON public.client_pedigree_presets;
CREATE POLICY "Org members delete pedigree presets"
  ON public.client_pedigree_presets FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role full access pedigree presets" ON public.client_pedigree_presets;
CREATE POLICY "Service role full access pedigree presets"
  ON public.client_pedigree_presets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_pedigree_presets TO authenticated;
GRANT ALL ON public.client_pedigree_presets TO service_role;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_client_pedigree_presets_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pedigree_presets_updated_at ON public.client_pedigree_presets;
CREATE TRIGGER trg_client_pedigree_presets_updated_at
  BEFORE UPDATE ON public.client_pedigree_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_pedigree_presets_updated_at();

COMMENT ON TABLE public.client_pedigree_presets IS
  'Presets de critères pédigree client réutilisables. Permet de configurer une fois "Pour ce client, exiger top école FR + scale-up Series B+", appliqué auto sur toutes les missions du client.';
