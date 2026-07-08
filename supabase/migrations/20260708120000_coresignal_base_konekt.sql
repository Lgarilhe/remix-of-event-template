-- Base Konekt v2 (Coresignal) — infrastructure MVP phase 1
-- Cf. docs/coresignal-integration-audit.md
--
-- 1. Clé API par org + flag d'activation (rollout contrôlé)
-- 2. Cache des profils collectés (miroir de pdl_profile_cache, TTL 30j)
--
-- Idempotente, rejouable.

-- ─── 1. organization_integrations : clé + flag ───────────────────────────────
ALTER TABLE public.organization_integrations
  ADD COLUMN IF NOT EXISTS coresignal_api_key text,
  ADD COLUMN IF NOT EXISTS coresignal_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_integrations.coresignal_enabled IS
  'Feature flag Base Konekt (recherche base de données via Coresignal). Off par défaut, rollout contrôlé par org.';

-- ─── 2. coresignal_profile_cache (miroir de pdl_profile_cache) ────────────────
CREATE TABLE IF NOT EXISTS public.coresignal_profile_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- id canonique fournisseur (employee_multi_source id)
  coresignal_id text NOT NULL,
  -- URL LinkedIn normalisée (sans trailing slash), sert de clé d'effacement RGPD
  linkedin_url text,
  -- profil déjà converti au format LinkedInProfile
  profile_data jsonb NOT NULL,
  source_query_hash text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  -- TTL : cleanup par cron quotidien (à câbler séparément)
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  -- crédits Coresignal réellement consommés (collect multi-source = 2)
  credits_consumed integer NOT NULL DEFAULT 2,
  CONSTRAINT coresignal_profile_cache_org_id_unique UNIQUE (organization_id, coresignal_id)
);

CREATE INDEX IF NOT EXISTS idx_coresignal_cache_org_linkedin
  ON public.coresignal_profile_cache (organization_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coresignal_cache_expires
  ON public.coresignal_profile_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_coresignal_cache_fetched
  ON public.coresignal_profile_cache (organization_id, fetched_at DESC);

ALTER TABLE public.coresignal_profile_cache ENABLE ROW LEVEL SECURITY;

-- SELECT : membres de l'org uniquement. INSERT/UPDATE/DELETE réservés au service_role.
DROP POLICY IF EXISTS coresignal_profile_cache_select ON public.coresignal_profile_cache;
CREATE POLICY coresignal_profile_cache_select
  ON public.coresignal_profile_cache
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.coresignal_profile_cache TO authenticated;
GRANT ALL ON public.coresignal_profile_cache TO service_role;

COMMENT ON TABLE public.coresignal_profile_cache IS
  'Cache des profils Base Konekt (Coresignal collect), format LinkedInProfile. TTL 30j. Écriture service_role only.';
