-- Migration : candidate_enrichments — cache enrichments waterfall
--
-- Stocke les résultats d'enrichment de contact (email + phone) issus
-- d'un fournisseur waterfall (Better Contact en l'occurrence — peut être
-- swappé par Datagma/FullEnrich/Findymail plus tard sans toucher au schema).
--
-- Stratégie cache : org-wide, TTL 30j (les emails B2B changent peu).
-- Une recherche d'un même candidat dans une autre mission de la même org
-- est gratuite si déjà enriché → ROI maximal des crédits BC.
--
-- Workflow :
--   1. POST /enrich-candidate-contact → INSERT row status='pending' avec bc_request_id
--   2. Frontend poll toutes les 5s → GET /get-enrichment-status?id=xxx
--   3. Si BC répond status='terminated' → UPDATE row avec contact_data + status='terminated'
--   4. Lookup futur → SELECT par (organization_id, linkedin_url_normalized) si non expiré

CREATE TABLE IF NOT EXISTS public.candidate_enrichments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identifiant canonique du candidat
  linkedin_url    text NOT NULL,                    -- normalisé : lowercase, sans trailing /
  -- Contexte input (utile si pas de match côté BC, on garde la trace)
  first_name      text,
  last_name       text,
  company         text,
  company_domain  text,

  -- Résultat de l'enrichment (peuplé quand status='terminated')
  contact_email   text,
  contact_email_status text,                        -- 'deliverable' | 'catch_all_safe' | 'catch_all_not_safe' | 'undeliverable' | 'not_found'
  contact_phone   text,
  contact_phone_type text,                          -- 'mobile' | 'direct' | 'work'
  raw_response    jsonb,                            -- payload BC complet (debug + audit RGPD)

  -- Tracking provider (pour audit RGPD : "qui nous a fourni cet email ?")
  provider        text NOT NULL DEFAULT 'bettercontact',
  provider_request_id text,                         -- request_id BC pour polling
  email_provider_source text,                       -- ex: "Datagma" / "Hunter" / "Apollo" — qui a gagné dans la cascade
  phone_provider_source text,

  -- Crédits consommés (BC : 1 cr/email, 10 cr/phone)
  credits_consumed integer NOT NULL DEFAULT 0,

  -- État de la requête
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'terminated' | 'error'
  error_message   text,

  -- Timestamps
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  -- Audit
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT candidate_enrichments_org_linkedin_unique UNIQUE (organization_id, linkedin_url)
);

-- Index pour les lookups les plus fréquents
CREATE INDEX IF NOT EXISTS idx_candidate_enrichments_org_linkedin
  ON public.candidate_enrichments (organization_id, linkedin_url)
  WHERE status = 'terminated';

CREATE INDEX IF NOT EXISTS idx_candidate_enrichments_request_id
  ON public.candidate_enrichments (provider_request_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_candidate_enrichments_expires
  ON public.candidate_enrichments (expires_at);

-- ─── RLS — accès strict org membership ─────────────────────────────────────

ALTER TABLE public.candidate_enrichments ENABLE ROW LEVEL SECURITY;

-- SELECT : membres de l'org peuvent voir leurs enrichments
DROP POLICY IF EXISTS candidate_enrichments_select ON public.candidate_enrichments;
CREATE POLICY candidate_enrichments_select
  ON public.candidate_enrichments
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

-- ─── GRANTs ────────────────────────────────────────────────────────────────

GRANT SELECT ON public.candidate_enrichments TO authenticated;
GRANT ALL ON public.candidate_enrichments TO service_role;

-- ─── Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.candidate_enrichments IS
  'Cache org-wide des enrichments de contact (email + phone) via waterfall (Better Contact). TTL 30j.';

COMMENT ON COLUMN public.candidate_enrichments.email_provider_source IS
  'Quel provider de la cascade a fourni l''email (audit RGPD). Ex: Datagma, Hunter, Apollo, RocketReach...';

COMMENT ON COLUMN public.candidate_enrichments.credits_consumed IS
  'Crédits BC consommés. 1 cr = 1 email valide trouvé, 10 cr = 1 mobile trouvé. Pas trouvé = 0 cr.';
