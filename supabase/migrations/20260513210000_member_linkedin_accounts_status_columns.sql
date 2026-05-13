-- ─────────────────────────────────────────────────────────────────────────────
-- Ajoute les colonnes account_status, last_checked_at, failure_reason à
-- member_linkedin_accounts.
--
-- Bug découvert le 2026-05-13 pendant l'audit conformité LinkedIn
-- (warning #260513-007211) : ces 3 colonnes sont référencées dans le code
-- (unipile-accounts/index.ts, unipile-webhook/index.ts, process-sequences/index.ts)
-- mais aucune migration ne les avait jamais créées. Conséquence :
--   - Les UPDATE sur account_status échouaient silencieusement
--   - process-sequences ne pouvait pas check l'état du compte avant envoi
--   - Le webhook account_status_updated ne pouvait pas persister les transitions
--
-- Cause probable : la migration originale (héritée de Lovable) n'a pas été
-- transférée lors de la bascule vers Supabase self-managed (2026-04-21).
--
-- Idempotent : utilise IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.member_linkedin_accounts
  ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'OK',
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

COMMENT ON COLUMN public.member_linkedin_accounts.account_status IS
  'Statut Unipile du compte LinkedIn : OK, CONNECTING, CREDENTIALS, ERROR, STOPPED, etc.';
COMMENT ON COLUMN public.member_linkedin_accounts.last_checked_at IS
  'Timestamp du dernier check de statut (via webhook ou polling).';
COMMENT ON COLUMN public.member_linkedin_accounts.failure_reason IS
  'Raison du dernier échec si account_status != OK (geoloc, captcha, credentials expired, etc.).';
