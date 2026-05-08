-- ============================================================================
-- MIGRATIONS PEDIGREE — APPLY MANUEL EN PROD
-- ============================================================================
-- À copier-coller dans https://supabase.com/dashboard/project/crckfywoyjxkawathdff/sql
-- Tout est idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING) — peut être
-- rejoué sans casse.
-- ============================================================================

-- ─── 1/3 : client_pedigree_presets ──────────────────────────────────

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

-- ─── 2/3 : pedigree_directory ───────────────────────────────────────

-- ─── Annuaires pedigree global Konekt ──────────────────────────────────────
-- Tables de référence partagées entre toutes les orgs : permettent de résoudre
-- en avance les IDs LinkedIn des écoles/entreprises connues, pour pouvoir les
-- injecter directement dans les filtres de recherche Unipile (au lieu de
-- résoudre à chaque search, ce qui ralentit + multiplie les appels Unipile).
--
-- Les IDs LinkedIn changent rarement mais peuvent évoluer → un cron mensuel
-- (resolve-pedigree-directory edge fn) re-résout via Unipile get_parameters.
--
-- Override per-org : org_pedigree_directory_overrides permet à chaque org
-- d'ajouter ses propres écoles/entreprises privées sans polluer le global.

-- ─── Écoles (global) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedigree_school_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  aliases text[] DEFAULT '{}',
  linkedin_school_id text,                    -- résolu via cron, peut être NULL
  country text,                                -- 'FR', 'US', 'UK', etc.
  category text,                               -- 'ingenieur' | 'commerce' | 'univ' | 'tech_school'
  tier int CHECK (tier >= 1 AND tier <= 3),    -- 1 = top, 3 = average
  notes text,
  last_resolved_at timestamptz,
  resolution_status text DEFAULT 'pending',    -- 'pending' | 'resolved' | 'failed' | 'manual'
  source text DEFAULT 'manual',                -- 'manual' | 'cron_unipile' | etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedigree_school_country ON public.pedigree_school_directory (country);
CREATE INDEX IF NOT EXISTS idx_pedigree_school_category ON public.pedigree_school_directory (category);
CREATE INDEX IF NOT EXISTS idx_pedigree_school_resolution ON public.pedigree_school_directory (resolution_status, last_resolved_at);
CREATE INDEX IF NOT EXISTS idx_pedigree_school_aliases ON public.pedigree_school_directory USING GIN (aliases);

-- ─── Entreprises (global) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedigree_company_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  aliases text[] DEFAULT '{}',
  linkedin_company_id text,
  country text,
  -- Catégorisation pour expansion rapide ("scale_up" → tous les IDs scale-ups)
  category text,                               -- 'gafam' | 'big_tech_us' | 'scale_up' | 'cabinet_strategy' | 'banque_assurance' | 'esn' | etc.
  funding_stage text,                          -- 'seed', 'series_a', 'series_b', 'series_c', 'public', NULL
  tier int CHECK (tier >= 1 AND tier <= 3),
  domain text,                                 -- ex: 'stripe.com'
  notes text,
  last_resolved_at timestamptz,
  resolution_status text DEFAULT 'pending',
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedigree_company_category ON public.pedigree_company_directory (category);
CREATE INDEX IF NOT EXISTS idx_pedigree_company_country ON public.pedigree_company_directory (country);
CREATE INDEX IF NOT EXISTS idx_pedigree_company_resolution ON public.pedigree_company_directory (resolution_status, last_resolved_at);
CREATE INDEX IF NOT EXISTS idx_pedigree_company_aliases ON public.pedigree_company_directory USING GIN (aliases);

-- ─── Override per-org (entrées privées additionnelles ou remplacements) ─────
CREATE TABLE IF NOT EXISTS public.org_pedigree_directory_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('school', 'company')),
  canonical_name text NOT NULL,
  aliases text[] DEFAULT '{}',
  linkedin_id text,
  category text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, canonical_name)
);

CREATE INDEX IF NOT EXISTS idx_org_overrides_org_type
  ON public.org_pedigree_directory_overrides (organization_id, entity_type);

-- ─── Triggers updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_pedigree_directory_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedigree_school_updated_at ON public.pedigree_school_directory;
CREATE TRIGGER trg_pedigree_school_updated_at
  BEFORE UPDATE ON public.pedigree_school_directory
  FOR EACH ROW EXECUTE FUNCTION public.touch_pedigree_directory_updated_at();

DROP TRIGGER IF EXISTS trg_pedigree_company_updated_at ON public.pedigree_company_directory;
CREATE TRIGGER trg_pedigree_company_updated_at
  BEFORE UPDATE ON public.pedigree_company_directory
  FOR EACH ROW EXECUTE FUNCTION public.touch_pedigree_directory_updated_at();

DROP TRIGGER IF EXISTS trg_org_pedigree_overrides_updated_at ON public.org_pedigree_directory_overrides;
CREATE TRIGGER trg_org_pedigree_overrides_updated_at
  BEFORE UPDATE ON public.org_pedigree_directory_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_pedigree_directory_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────

-- Le directory global est readable par tous les authenticated (pas sensible).
-- Seul service_role peut INSERT/UPDATE/DELETE (cures via cron + admin Konekt).
ALTER TABLE public.pedigree_school_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read schools" ON public.pedigree_school_directory;
CREATE POLICY "Authenticated read schools"
  ON public.pedigree_school_directory FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full schools" ON public.pedigree_school_directory;
CREATE POLICY "Service role full schools"
  ON public.pedigree_school_directory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.pedigree_company_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read companies" ON public.pedigree_company_directory;
CREATE POLICY "Authenticated read companies"
  ON public.pedigree_company_directory FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full companies" ON public.pedigree_company_directory;
CREATE POLICY "Service role full companies"
  ON public.pedigree_company_directory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Les overrides per-org : lecture/écriture par membres de l'org
ALTER TABLE public.org_pedigree_directory_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read overrides" ON public.org_pedigree_directory_overrides;
CREATE POLICY "Org members read overrides"
  ON public.org_pedigree_directory_overrides FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members write overrides" ON public.org_pedigree_directory_overrides;
CREATE POLICY "Org members write overrides"
  ON public.org_pedigree_directory_overrides FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "Service role full overrides" ON public.org_pedigree_directory_overrides;
CREATE POLICY "Service role full overrides"
  ON public.org_pedigree_directory_overrides FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.pedigree_school_directory TO authenticated;
GRANT SELECT ON public.pedigree_company_directory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_pedigree_directory_overrides TO authenticated;
GRANT ALL ON public.pedigree_school_directory TO service_role;
GRANT ALL ON public.pedigree_company_directory TO service_role;
GRANT ALL ON public.org_pedigree_directory_overrides TO service_role;

-- ─── SEED — Écoles top FR (30 entrées) ──────────────────────────────────────
INSERT INTO public.pedigree_school_directory (canonical_name, aliases, country, category, tier, notes) VALUES
  ('École Polytechnique', ARRAY['X', 'Polytechnique', 'École Polytechnique de Paris', 'Polytechnique X'], 'FR', 'ingenieur', 1, 'Grande école d''ingénieurs, X-année'),
  ('CentraleSupélec', ARRAY['Centrale', 'Centrale Paris', 'Supélec', 'École Centrale Paris', 'École Centrale'], 'FR', 'ingenieur', 1, 'Fusion Centrale Paris + Supélec'),
  ('HEC Paris', ARRAY['HEC', 'École des Hautes Études Commerciales', 'HEC School of Management'], 'FR', 'commerce', 1, NULL),
  ('Mines ParisTech', ARRAY['Mines de Paris', 'École des Mines de Paris', 'Mines Paris'], 'FR', 'ingenieur', 1, NULL),
  ('École des Ponts ParisTech', ARRAY['Ponts', 'ENPC', 'Ponts et Chaussées', 'École des Ponts'], 'FR', 'ingenieur', 1, NULL),
  ('Sciences Po Paris', ARRAY['Sciences Po', 'IEP Paris', 'Institut d''Études Politiques de Paris'], 'FR', 'univ', 1, NULL),
  ('ESCP Business School', ARRAY['ESCP', 'ESCP Europe', 'ESCP Paris'], 'FR', 'commerce', 1, NULL),
  ('ESSEC Business School', ARRAY['ESSEC'], 'FR', 'commerce', 1, NULL),
  ('Télécom Paris', ARRAY['Télécom ParisTech', 'ENST'], 'FR', 'ingenieur', 1, NULL),
  ('ISAE-SUPAERO', ARRAY['Supaéro', 'Sup''Aéro', 'ISAE'], 'FR', 'ingenieur', 1, NULL),
  ('EM Lyon Business School', ARRAY['EM Lyon', 'EMLyon'], 'FR', 'commerce', 2, NULL),
  ('EDHEC Business School', ARRAY['EDHEC'], 'FR', 'commerce', 2, NULL),
  ('Audencia', ARRAY['Audencia Nantes'], 'FR', 'commerce', 2, NULL),
  ('SKEMA Business School', ARRAY['Skema', 'CERAM'], 'FR', 'commerce', 2, NULL),
  ('Grenoble École de Management', ARRAY['Grenoble EM', 'GEM'], 'FR', 'commerce', 2, NULL),
  ('INSEAD', ARRAY['INSEAD Fontainebleau'], 'FR', 'commerce', 1, 'École de management internationale, MBA'),
  ('Université Paris-Dauphine', ARRAY['Dauphine', 'Paris IX'], 'FR', 'univ', 2, NULL),
  ('ENSAE Paris', ARRAY['ENSAE'], 'FR', 'ingenieur', 1, NULL),
  ('ENS Paris-Saclay', ARRAY['ENS Cachan'], 'FR', 'univ', 1, NULL),
  ('École Normale Supérieure (ENS Ulm)', ARRAY['ENS Paris', 'ENS', 'Ulm'], 'FR', 'univ', 1, NULL),
  ('Université Paris-Saclay', ARRAY['Paris-Saclay'], 'FR', 'univ', 2, NULL),
  ('Sorbonne Université', ARRAY['Sorbonne', 'Paris-Sorbonne'], 'FR', 'univ', 2, NULL),
  ('INSA Lyon', ARRAY['INSA de Lyon'], 'FR', 'ingenieur', 2, NULL),
  ('INSA Toulouse', ARRAY['INSA de Toulouse'], 'FR', 'ingenieur', 2, NULL),
  ('UTC', ARRAY['Université de Technologie de Compiègne'], 'FR', 'ingenieur', 2, NULL),
  ('EPITA', ARRAY['École pour l''informatique et les techniques avancées'], 'FR', 'tech_school', 2, NULL),
  ('EPITECH', ARRAY['École pour l''informatique et les nouvelles technologies'], 'FR', 'tech_school', 2, NULL),
  ('École 42', ARRAY['42', '42 Paris', '42 School'], 'FR', 'tech_school', 2, NULL),
  ('ENSIIE', ARRAY['ENSIIE Évry'], 'FR', 'ingenieur', 2, NULL),
  ('Toulouse INP - ENSEEIHT', ARRAY['ENSEEIHT', 'N7'], 'FR', 'ingenieur', 2, NULL)
ON CONFLICT (canonical_name) DO NOTHING;

-- ─── SEED — GAFAM ──────────────────────────────────────────────────────────
INSERT INTO public.pedigree_company_directory (canonical_name, aliases, country, category, funding_stage, tier, domain) VALUES
  ('Google', ARRAY['Google LLC', 'Alphabet'], 'US', 'gafam', 'public', 1, 'google.com'),
  ('Apple', ARRAY['Apple Inc.'], 'US', 'gafam', 'public', 1, 'apple.com'),
  ('Meta', ARRAY['Meta Platforms', 'Facebook'], 'US', 'gafam', 'public', 1, 'meta.com'),
  ('Amazon', ARRAY['Amazon.com', 'AWS', 'Amazon Web Services'], 'US', 'gafam', 'public', 1, 'amazon.com'),
  ('Microsoft', ARRAY['Microsoft Corporation'], 'US', 'gafam', 'public', 1, 'microsoft.com')
ON CONFLICT (canonical_name) DO NOTHING;

-- ─── SEED — Big Tech US (~30) ──────────────────────────────────────────────
INSERT INTO public.pedigree_company_directory (canonical_name, aliases, country, category, funding_stage, tier, domain) VALUES
  ('Stripe', ARRAY['Stripe Inc.'], 'US', 'big_tech_us', 'series_i', 1, 'stripe.com'),
  ('Airbnb', ARRAY['Airbnb Inc.'], 'US', 'big_tech_us', 'public', 1, 'airbnb.com'),
  ('Uber', ARRAY['Uber Technologies'], 'US', 'big_tech_us', 'public', 1, 'uber.com'),
  ('Datadog', NULL, 'US', 'big_tech_us', 'public', 1, 'datadoghq.com'),
  ('Snowflake', NULL, 'US', 'big_tech_us', 'public', 1, 'snowflake.com'),
  ('Databricks', NULL, 'US', 'big_tech_us', 'series_j', 1, 'databricks.com'),
  ('Notion', ARRAY['Notion Labs'], 'US', 'big_tech_us', 'series_c', 1, 'notion.so'),
  ('Figma', NULL, 'US', 'big_tech_us', 'series_e', 1, 'figma.com'),
  ('Linear', ARRAY['Linear Software'], 'US', 'big_tech_us', 'series_b', 1, 'linear.app'),
  ('Vercel', NULL, 'US', 'big_tech_us', 'series_e', 1, 'vercel.com'),
  ('OpenAI', NULL, 'US', 'big_tech_us', 'series_e', 1, 'openai.com'),
  ('Anthropic', NULL, 'US', 'big_tech_us', 'series_e', 1, 'anthropic.com'),
  ('Salesforce', NULL, 'US', 'big_tech_us', 'public', 1, 'salesforce.com'),
  ('Slack', ARRAY['Slack Technologies'], 'US', 'big_tech_us', 'public', 1, 'slack.com'),
  ('Atlassian', NULL, 'AU', 'big_tech_us', 'public', 1, 'atlassian.com'),
  ('Shopify', NULL, 'CA', 'big_tech_us', 'public', 1, 'shopify.com'),
  ('Twilio', NULL, 'US', 'big_tech_us', 'public', 1, 'twilio.com'),
  ('GitHub', NULL, 'US', 'big_tech_us', 'public', 1, 'github.com'),
  ('GitLab', NULL, 'US', 'big_tech_us', 'public', 1, 'gitlab.com'),
  ('Cloudflare', NULL, 'US', 'big_tech_us', 'public', 1, 'cloudflare.com'),
  ('HashiCorp', NULL, 'US', 'big_tech_us', 'public', 1, 'hashicorp.com'),
  ('MongoDB', NULL, 'US', 'big_tech_us', 'public', 1, 'mongodb.com'),
  ('Elastic', ARRAY['Elasticsearch'], 'US', 'big_tech_us', 'public', 1, 'elastic.co'),
  ('Coinbase', NULL, 'US', 'big_tech_us', 'public', 1, 'coinbase.com'),
  ('Plaid', NULL, 'US', 'big_tech_us', 'series_d', 1, 'plaid.com'),
  ('Discord', ARRAY['Discord Inc.'], 'US', 'big_tech_us', 'series_h', 1, 'discord.com'),
  ('Spotify', NULL, 'SE', 'big_tech_us', 'public', 1, 'spotify.com'),
  ('ServiceNow', NULL, 'US', 'big_tech_us', 'public', 1, 'servicenow.com'),
  ('Workday', NULL, 'US', 'big_tech_us', 'public', 1, 'workday.com'),
  ('Adyen', NULL, 'NL', 'big_tech_us', 'public', 1, 'adyen.com')
ON CONFLICT (canonical_name) DO NOTHING;

-- ─── SEED — Scale-ups EU/FR (~40) ──────────────────────────────────────────
INSERT INTO public.pedigree_company_directory (canonical_name, aliases, country, category, funding_stage, tier, domain) VALUES
  ('Doctolib', NULL, 'FR', 'scale_up', 'series_g', 1, 'doctolib.fr'),
  ('Alan', ARRAY['Alan Insurance'], 'FR', 'scale_up', 'series_f', 1, 'alan.com'),
  ('Qonto', NULL, 'FR', 'scale_up', 'series_d', 1, 'qonto.com'),
  ('Mirakl', NULL, 'FR', 'scale_up', 'series_e', 1, 'mirakl.com'),
  ('Pennylane', NULL, 'FR', 'scale_up', 'series_c', 1, 'pennylane.com'),
  ('Spendesk', NULL, 'FR', 'scale_up', 'series_c', 1, 'spendesk.com'),
  ('Aircall', NULL, 'FR', 'scale_up', 'series_e', 1, 'aircall.io'),
  ('Swile', NULL, 'FR', 'scale_up', 'series_d', 1, 'swile.co'),
  ('Back Market', ARRAY['BackMarket'], 'FR', 'scale_up', 'series_e', 1, 'backmarket.com'),
  ('Vinted', NULL, 'LT', 'scale_up', 'series_f', 1, 'vinted.com'),
  ('ManoMano', NULL, 'FR', 'scale_up', 'series_f', 1, 'manomano.fr'),
  ('Veepee', ARRAY['vente-privee', 'Vente Privée'], 'FR', 'scale_up', 'private', 1, 'veepee.com'),
  ('Voodoo', ARRAY['Voodoo Games'], 'FR', 'scale_up', 'series_b', 2, 'voodoo.io'),
  ('Contentsquare', NULL, 'FR', 'scale_up', 'series_f', 1, 'contentsquare.com'),
  ('Algolia', NULL, 'FR', 'scale_up', 'series_d', 1, 'algolia.com'),
  ('Ankorstore', NULL, 'FR', 'scale_up', 'series_c', 2, 'ankorstore.com'),
  ('Ledger', ARRAY['Ledger SAS'], 'FR', 'scale_up', 'series_c', 1, 'ledger.com'),
  ('Sorare', NULL, 'FR', 'scale_up', 'series_b', 1, 'sorare.com'),
  ('Lydia', NULL, 'FR', 'scale_up', 'series_c', 2, 'lydia-app.com'),
  ('Shine', ARRAY['Shine Banking'], 'FR', 'scale_up', 'series_b', 2, 'shine.fr'),
  ('Owkin', NULL, 'FR', 'scale_up', 'series_b', 1, 'owkin.com'),
  ('Mistral AI', NULL, 'FR', 'scale_up', 'series_b', 1, 'mistral.ai'),
  ('BlaBlaCar', ARRAY['BlaBla Car', 'Comuto'], 'FR', 'scale_up', 'series_e', 1, 'blablacar.fr'),
  ('Deezer', NULL, 'FR', 'scale_up', 'public', 2, 'deezer.com'),
  ('Criteo', NULL, 'FR', 'scale_up', 'public', 1, 'criteo.com'),
  ('Dataiku', NULL, 'FR', 'scale_up', 'series_f', 1, 'dataiku.com'),
  ('OVHcloud', ARRAY['OVH'], 'FR', 'scale_up', 'public', 2, 'ovhcloud.com'),
  ('Klarna', NULL, 'SE', 'scale_up', 'series_h', 1, 'klarna.com'),
  ('N26', NULL, 'DE', 'scale_up', 'series_e', 1, 'n26.com'),
  ('Bolt', ARRAY['Bolt Technology'], 'EE', 'scale_up', 'series_f', 1, 'bolt.eu'),
  ('Personio', NULL, 'DE', 'scale_up', 'series_e', 1, 'personio.com'),
  ('Celonis', NULL, 'DE', 'scale_up', 'series_d', 1, 'celonis.com'),
  ('Pleo', NULL, 'DK', 'scale_up', 'series_c', 2, 'pleo.io'),
  ('Wise', ARRAY['TransferWise'], 'UK', 'scale_up', 'public', 1, 'wise.com'),
  ('Revolut', NULL, 'UK', 'scale_up', 'series_e', 1, 'revolut.com'),
  ('Monzo', NULL, 'UK', 'scale_up', 'series_h', 1, 'monzo.com'),
  ('Pitch', ARRAY['Pitch Software'], 'DE', 'scale_up', 'series_b', 2, 'pitch.com'),
  ('Mews', ARRAY['Mews Systems'], 'CZ', 'scale_up', 'series_d', 2, 'mews.com'),
  ('Glovo', NULL, 'ES', 'scale_up', 'series_f', 2, 'glovoapp.com'),
  ('Cazoo', NULL, 'UK', 'scale_up', 'public', 2, 'cazoo.co.uk')
ON CONFLICT (canonical_name) DO NOTHING;

-- ─── SEED — Cabinets stratégie tier 1 ──────────────────────────────────────
INSERT INTO public.pedigree_company_directory (canonical_name, aliases, country, category, funding_stage, tier, domain) VALUES
  ('McKinsey & Company', ARRAY['McKinsey', 'MBB'], 'US', 'cabinet_strategy', 'private', 1, 'mckinsey.com'),
  ('Boston Consulting Group', ARRAY['BCG', 'MBB'], 'US', 'cabinet_strategy', 'private', 1, 'bcg.com'),
  ('Bain & Company', ARRAY['Bain', 'MBB'], 'US', 'cabinet_strategy', 'private', 1, 'bain.com'),
  ('Roland Berger', NULL, 'DE', 'cabinet_strategy', 'private', 2, 'rolandberger.com'),
  ('Oliver Wyman', NULL, 'US', 'cabinet_strategy', 'private', 2, 'oliverwyman.com'),
  ('Kearney', ARRAY['A.T. Kearney', 'AT Kearney'], 'US', 'cabinet_strategy', 'private', 2, 'kearney.com')
ON CONFLICT (canonical_name) DO NOTHING;

-- ─── Cron mensuel pour re-résoudre les IDs LinkedIn ────────────────────────
-- Auth via PROCESS_SEQUENCES_SECRET (réutilisé pour simplicité, on factorise
-- le pattern d'auth interne déjà en place). À la place de créer un nouveau
-- secret, le cron passe le secret existant que les edge fns internes acceptent.

CREATE OR REPLACE FUNCTION public.invoke_resolve_pedigree_directory()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT value INTO v_secret FROM internal_config WHERE key = 'process_sequences_secret';
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE WARNING 'Missing internal_config for resolve-pedigree-directory cron';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/resolve-pedigree-directory',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('resolve-pedigree-directory-monthly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 1er du mois à 4h du matin UTC
SELECT cron.schedule(
  'resolve-pedigree-directory-monthly',
  '0 4 1 * *',
  $$SELECT public.invoke_resolve_pedigree_directory();$$
);

COMMENT ON TABLE public.pedigree_school_directory IS
  'Annuaire global des écoles avec leur ID LinkedIn pré-résolu (refresh cron mensuel). Permet d''injecter directement les IDs dans les filtres Unipile.';
COMMENT ON TABLE public.pedigree_company_directory IS
  'Annuaire global des entreprises catégorisées (gafam, scale_up, etc.) avec leur ID LinkedIn pré-résolu. Permet expansion rapide d''une catégorie en liste d''IDs Unipile.';
COMMENT ON TABLE public.org_pedigree_directory_overrides IS
  'Entrées additionnelles spécifiques à une org (écoles/entreprises privées non globales). Lookup combiné global + overrides côté frontend.';

-- ─── 3/3 : client_competitors ───────────────────────────────────────

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
