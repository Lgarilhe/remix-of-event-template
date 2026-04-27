-- Migration : pdl_profile_cache — cache des profils enrichis via PDL
--
-- Pourquoi : PDL facture chaque résultat retourné, MÊME les doublons d'une
-- requête à l'autre. Sans cache, on paye 5x le même profil si il matche
-- plusieurs recherches. Cette table stocke les profils enrichis avec un
-- TTL de 30 jours (matche le refresh mensuel PDL).
--
-- Stratégie : cache GLOBAL per-org (pas par mission/par user). Un profil
-- enrichi pour une mission est immédiatement réutilisable pour toutes les
-- autres missions de la même org → maximise le ROI des crédits.
--
-- Workflow lookup :
--   1. avant d'envoyer une requête PDL → SELECT par linkedin_url IN (...)
--      filtré sur expires_at > now()
--   2. dédupliquer la liste de candidats à enrichir (skip ce qui est cached)
--   3. PDL n'est appelé QUE pour les nouveaux profils
--   4. INSERT ou UPDATE le résultat dans le cache (ON CONFLICT)
--
-- Cleanup : un cron quotidien purge expires_at < now() (à câbler séparément).

CREATE TABLE IF NOT EXISTS public.pdl_profile_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identifiants du profil
  pdl_id          text NOT NULL,                    -- p.id renvoyé par PDL (canonique)
  linkedin_url    text,                             -- linkedin_url normalisé (sans trailing /)

  -- Données enrichies (au format LinkedInProfile pour réutilisation directe)
  profile_data    jsonb NOT NULL,

  -- Métadonnées de débogage / audit
  source_query_hash text,                           -- SHA256 des filtres ayant remonté ce profil (debug)
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  -- Tracking des coûts (pour reporting interne)
  credits_consumed integer NOT NULL DEFAULT 1,

  CONSTRAINT pdl_profile_cache_org_pdl_unique UNIQUE (organization_id, pdl_id)
);

-- Index pour les lookups les plus fréquents
CREATE INDEX IF NOT EXISTS idx_pdl_cache_org_linkedin
  ON public.pdl_profile_cache (organization_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdl_cache_expires
  ON public.pdl_profile_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_pdl_cache_fetched
  ON public.pdl_profile_cache (organization_id, fetched_at DESC);

-- ─── RLS — accès strict org membership ─────────────────────────────────────

ALTER TABLE public.pdl_profile_cache ENABLE ROW LEVEL SECURITY;

-- SELECT : membres de l'org peuvent voir le cache de leur org
CREATE POLICY pdl_profile_cache_select
  ON public.pdl_profile_cache
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE : service_role uniquement (les edge functions écrivent)
-- Pas de policy explicite → bloqué par défaut pour authenticated, ouvert pour service_role
-- (qui contourne RLS de toute façon)

-- ─── GRANTs ────────────────────────────────────────────────────────────────

GRANT SELECT ON public.pdl_profile_cache TO authenticated;
GRANT ALL ON public.pdl_profile_cache TO service_role;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.pdl_profile_cache IS
  'Cache org-wide des profils enrichis via PDL. TTL 30j (matche refresh PDL). Évite de re-payer les doublons.';

COMMENT ON COLUMN public.pdl_profile_cache.profile_data IS
  'Profil au format LinkedInProfile (cf src/components/outreach/types.ts) pour réutilisation directe sans re-mapping.';

COMMENT ON COLUMN public.pdl_profile_cache.credits_consumed IS
  'Nombre de crédits PDL consommés pour ce profil. Permet reporting coût par org.';
