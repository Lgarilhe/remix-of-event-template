-- Migration : extension chat_categories pour snooze + archive (Inbox refonte Phase 1)
--
-- But : permettre à l'user de mettre une conversation "en sommeil" (snooze)
-- jusqu'à une date donnée, ou de l'archiver complètement (hidden mais pas
-- supprimée).
--
-- Choix design : on étend chat_categories (déjà RLS-ready, scoped per-account)
-- au lieu de créer une nouvelle table → moins de jointures, code unifié.

-- 1. Ajouter les colonnes (idempotent)
ALTER TABLE public.chat_categories
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2. Indexes pour les filtres frontend (sidebar Active / Snoozed / Archived)
CREATE INDEX IF NOT EXISTS idx_chat_categories_snoozed
  ON public.chat_categories (account_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_categories_archived
  ON public.chat_categories (account_id, archived_at)
  WHERE archived_at IS NOT NULL;

-- 3. Comments pour audit
COMMENT ON COLUMN public.chat_categories.snoozed_until IS
  'Si défini, la conversation est masquée du filter par défaut jusqu''à cette date. NULL = non snoozée.';

COMMENT ON COLUMN public.chat_categories.archived_at IS
  'Si défini, la conversation est archivée (masquée du filter par défaut). NULL = active.';
