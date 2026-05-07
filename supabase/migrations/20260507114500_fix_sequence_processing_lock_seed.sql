-- Fix: sequence_processing_lock had wrong column type on konekt-production
-- The table was created with `id UUID DEFAULT gen_random_uuid()` (probably from a
-- dump regen during Lovable → self-managed migration), but the original schema
-- was `id TEXT PRIMARY KEY DEFAULT 'process'` and the `acquire_sequence_lock`
-- function does `UPDATE WHERE id = 'process'`. With a UUID column, this UPDATE
-- never matched (and table was empty anyway) → cron always returned `lock_held`
-- → sequences never processed.

-- Step 1: Convert id back to TEXT
ALTER TABLE public.sequence_processing_lock
  ALTER COLUMN id DROP DEFAULT;

ALTER TABLE public.sequence_processing_lock
  ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE public.sequence_processing_lock
  ALTER COLUMN id SET DEFAULT 'process';

-- Step 2: Seed the singleton row
INSERT INTO public.sequence_processing_lock (id, locked_at, locked_by)
VALUES ('process', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
