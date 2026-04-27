-- Migration : gdpr_erasures — registre des demandes d'effacement (RGPD art. 17)
--
-- Quand un candidat exerce son droit à l'effacement (CNIL/RGPD), on stocke
-- dans cette table un HASH SHA-256 de son email + linkedin_url (jamais en
-- clair, car ironique de stocker l'email dans la table d'effacement).
--
-- Avant chaque enrichment de contact, on check si le candidat est dans cette
-- liste → si oui, on refuse l'enrichment (renvoie not_found au lieu de payer).
--
-- C'est aussi la table cible pour DELETE en cascade : quand on insert ici,
-- on supprime toutes les rows correspondantes dans candidate_enrichments,
-- pdl_profile_cache, etc.

CREATE TABLE IF NOT EXISTS public.gdpr_erasures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiants hashés (SHA-256 hex) — NEVER store in clear
  email_hash      text,                          -- hash de l'email lowercased
  linkedin_url_hash text,                        -- hash du linkedin_url normalisé

  -- Metadata audit (sans PII)
  reason          text NOT NULL DEFAULT 'user_request',  -- 'user_request' | 'opt_out_email' | 'cnil_complaint' | 'manual'
  source          text,                          -- d'où vient la demande : 'unsubscribe_link' | 'admin_panel' | 'api_endpoint'
  notes           text,                          -- optionnel, jamais d'info nominative

  erased_at       timestamptz NOT NULL DEFAULT now(),

  -- Au moins l'un des hashes doit être présent
  CONSTRAINT gdpr_erasures_at_least_one_hash CHECK (email_hash IS NOT NULL OR linkedin_url_hash IS NOT NULL)
);

-- Index pour lookups rapides (avant chaque enrichment)
CREATE INDEX IF NOT EXISTS idx_gdpr_erasures_email_hash
  ON public.gdpr_erasures (email_hash) WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gdpr_erasures_linkedin_hash
  ON public.gdpr_erasures (linkedin_url_hash) WHERE linkedin_url_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gdpr_erasures_erased_at
  ON public.gdpr_erasures (erased_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- Pas d'accès depuis le client (uniquement service_role).
-- Le client passe par /unsubscribe ou un endpoint dédié /api/gdpr/erase

ALTER TABLE public.gdpr_erasures ENABLE ROW LEVEL SECURITY;

-- Pas de policy SELECT pour authenticated → bloqué par défaut
GRANT ALL ON public.gdpr_erasures TO service_role;

-- ─── Comments ─────────────────────────────────────────────────────────────

COMMENT ON TABLE public.gdpr_erasures IS
  'Registre RGPD art. 17 : demandes d''effacement de contacts. Hash SHA-256 only — jamais d''email en clair.';

COMMENT ON COLUMN public.gdpr_erasures.email_hash IS
  'SHA-256 hex (lowercased) de l''email à effacer. Null si demande basée sur linkedin_url.';

COMMENT ON COLUMN public.gdpr_erasures.linkedin_url_hash IS
  'SHA-256 hex du linkedin_url normalisé. Null si demande basée sur email.';
