-- Add UNIQUE constraint on suppressed_emails.email — needed for upsert
-- (onConflict: 'email') used by handle-email-suppression webhook handler.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'suppressed_emails'
      AND c.contype = 'u'
      AND EXISTS (
        SELECT 1 FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attnum = k AND a.attrelid = t.oid
        WHERE a.attname = 'email'
      )
  ) THEN
    ALTER TABLE public.suppressed_emails
      ADD CONSTRAINT suppressed_emails_email_unique UNIQUE (email);
    RAISE NOTICE 'Added UNIQUE(email) on suppressed_emails';
  ELSE
    RAISE NOTICE 'UNIQUE(email) on suppressed_emails already exists';
  END IF;
END $$;
