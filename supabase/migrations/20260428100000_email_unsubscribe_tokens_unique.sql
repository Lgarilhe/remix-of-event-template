-- Migration : ajout UNIQUE constraint sur email_unsubscribe_tokens(email)
--
-- Bug observé en prod 2026-04-28 :
--   send-transactional-email essayait .upsert({ onConflict: 'email' }) mais
--   la colonne email n'avait pas de UNIQUE constraint → Postgres 42P10
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--   specification" → "Failed to prepare email" → invitations bloquées.
--
-- Avant l'ALTER, on dédoublonne les rows existantes (au cas où des
-- duplicates auraient été insérés via INSERT historique). On garde la plus
-- ancienne row par email (created_at ASC).

-- Step 1 : dédup défensif (garde la 1ère row par email)
DELETE FROM public.email_unsubscribe_tokens
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at ASC) AS rn
    FROM public.email_unsubscribe_tokens
  ) sub
  WHERE rn > 1
);

-- Step 2 : ajout de la contrainte UNIQUE (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'email_unsubscribe_tokens'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'email_unsubscribe_tokens_email_unique'
  ) THEN
    ALTER TABLE public.email_unsubscribe_tokens
      ADD CONSTRAINT email_unsubscribe_tokens_email_unique UNIQUE (email);
  END IF;
END$$;
