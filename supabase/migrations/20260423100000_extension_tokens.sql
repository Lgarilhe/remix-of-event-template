-- ============================================================================
-- Migration : extension_tokens
-- ----------------------------------------------------------------------------
-- Tokens d'authentification pour la Chrome extension Konekt.
-- Chaque token est lié à un user + organisation. L'extension stocke ce token
-- dans chrome.storage.local et l'envoie en header Authorization sur chaque call.
--
-- Sécurité :
--   - Token = string aléatoire 64 chars (cryptographic entropy)
--   - On stocke seulement le HASH SHA-256 du token côté DB (jamais le clair)
--   - Le token clair n'est montré qu'UNE FOIS à la création (pattern API token)
--   - Révocation : soft-delete via revoked_at
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- Préfixe du token visible dans l'UI (4 premiers chars du clair, ex. "kekt_a3F2") pour
  -- identifier visuellement le token sans le révéler en clair
  token_prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Mon extension Chrome',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_user
  ON public.extension_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_extension_tokens_org
  ON public.extension_tokens(organization_id);
CREATE INDEX IF NOT EXISTS idx_extension_tokens_active
  ON public.extension_tokens(token_hash) WHERE revoked_at IS NULL;

-- ============================================================================
-- RLS : un user ne voit que ses propres tokens
-- ============================================================================

ALTER TABLE public.extension_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS extension_tokens_select_own ON public.extension_tokens;
CREATE POLICY extension_tokens_select_own ON public.extension_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS extension_tokens_insert_own ON public.extension_tokens;
CREATE POLICY extension_tokens_insert_own ON public.extension_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS extension_tokens_update_own ON public.extension_tokens;
CREATE POLICY extension_tokens_update_own ON public.extension_tokens
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS extension_tokens_delete_own ON public.extension_tokens;
CREATE POLICY extension_tokens_delete_own ON public.extension_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- GRANTs (les RLS suffisent à scoper, mais on grant explicitement comme partout)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extension_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extension_tokens TO service_role;

COMMENT ON TABLE public.extension_tokens IS
  'Tokens API pour la Chrome extension Konekt. token_hash est SHA-256 du clair (jamais stocké).';
