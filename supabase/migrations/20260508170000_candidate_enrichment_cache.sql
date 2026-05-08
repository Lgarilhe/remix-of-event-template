-- ─── Cache cross-mission des données enrichies LinkedIn ────────────────────
--
-- Avant : à chaque scoring, maybeEnrichProfile faisait 1 ou 2 appels Unipile
-- (GET /users/{id} + GET /users/{id}/posts) pour récupérer recommendations,
-- projects, certifications, languages, volunteering, recent_posts. Si le même
-- candidat était scoré sur N missions du même org → N appels Unipile pour la
-- même donnée. Le quota natif LinkedIn (~50 get_profile/jour pour compte
-- normal) saute vite.
--
-- Maintenant : lookup dans cette table AVANT l'appel Unipile. Si entry
-- récente (TTL 14 jours) → pas d'appel API, on hydrate le profile depuis
-- le cache. Si miss ou TTL expiré → appel Unipile + write-through dans le
-- cache.
--
-- Économie : sur une org qui score le même candidat sur 5 missions/mois,
-- on passe de 5-10 appels Unipile par candidat à 1 seul (lecture cache 4×).

CREATE TABLE IF NOT EXISTS public.candidate_enrichment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identifiants candidat (au moins l'un des deux)
  -- linkedin_url canonicalisé : lowercase, sans trailing slash
  linkedin_url text,
  -- provider_id LinkedIn (urn:li:fsd_profile:...) si dispo
  provider_id text,

  -- Données enrichies (mêmes shapes que ProfileData côté edge function)
  -- On stocke en JSONB pour flexibilité (les fields exacts peuvent évoluer).
  enriched_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Sections remplies dans cet enrichment (utile pour décider si on doit
  -- re-call Unipile pour des sections qui manqueraient — futur)
  -- Ex: ["experience", "about", "skills", "recommendations", "projects",
  --      "certifications", "languages", "volunteer_experience", "recent_posts"]
  sections_filled text[] DEFAULT '{}',

  -- Métadonnées
  last_enriched_at timestamptz NOT NULL DEFAULT now(),
  -- TTL 14 jours par défaut. Au-delà : expire et on re-call Unipile pour
  -- avoir des données fraîches (les profils LinkedIn évoluent — nouveau
  -- poste, nouvelles recos, etc.)
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  enriched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes pour les lookups les plus fréquents
CREATE INDEX IF NOT EXISTS idx_candidate_enrichment_cache_lookup_url
  ON public.candidate_enrichment_cache (organization_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_enrichment_cache_lookup_provider
  ON public.candidate_enrichment_cache (organization_id, provider_id)
  WHERE provider_id IS NOT NULL;

-- Index sur expires_at pour le job de nettoyage cron (à mettre en place plus tard)
CREATE INDEX IF NOT EXISTS idx_candidate_enrichment_cache_expires
  ON public.candidate_enrichment_cache (expires_at);

-- Contrainte d'unicité : un candidat (par url ou provider_id) n'a qu'une seule
-- entrée de cache par org. Permet l'upsert avec ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_candidate_enrichment_cache_url
  ON public.candidate_enrichment_cache (organization_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_candidate_enrichment_cache_provider
  ON public.candidate_enrichment_cache (organization_id, provider_id)
  WHERE provider_id IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Les membres d'une org peuvent lire/écrire dans le cache de leur org.
-- Pas d'accès cross-org.

ALTER TABLE public.candidate_enrichment_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can read enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Org members can read enrichment cache"
  ON public.candidate_enrichment_cache FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members can write enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Org members can write enrichment cache"
  ON public.candidate_enrichment_cache FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members can update enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Org members can update enrichment cache"
  ON public.candidate_enrichment_cache FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

-- Service role bypass (pour les edge functions)
DROP POLICY IF EXISTS "Service role full access enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Service role full access enrichment cache"
  ON public.candidate_enrichment_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.candidate_enrichment_cache TO authenticated;
GRANT ALL ON public.candidate_enrichment_cache TO service_role;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_candidate_enrichment_cache_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_enrichment_cache_updated_at ON public.candidate_enrichment_cache;
CREATE TRIGGER trg_candidate_enrichment_cache_updated_at
  BEFORE UPDATE ON public.candidate_enrichment_cache
  FOR EACH ROW EXECUTE FUNCTION public.touch_candidate_enrichment_cache_updated_at();

COMMENT ON TABLE public.candidate_enrichment_cache IS
  'Cache cross-mission des données enrichies LinkedIn (recommendations, projects, certifications, languages, volunteering, recent_posts). Lookup par linkedin_url ou provider_id, scopé par organization_id. TTL 14 jours.';
