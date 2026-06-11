-- ─────────────────────────────────────────────────────────────────────────────
-- Audit séquences 2026-05-04 — Vague 1 (constraints critiques)
--
-- Fix #1 : ajoute un CHECK action_type complet pour éviter les valeurs orphelines
--          en DB. Le frontend autorise des types qu'aucun CHECK ne validait
--          (ex: whatsapp_message). Risque de doublons/typos non détectés.
--
-- Fix #7 : sequence_enrollments.created_by avait ON DELETE CASCADE → si un
--          collab est supprimé, tous ses enrollments disparaissent
--          silencieusement. Switch en SET NULL pour préserver les données.
--
-- Idempotente, rejouable. Aucune valeur invalide existante en prod testée OK.
-- ─────────────────────────────────────────────────────────────────────────────

-- Fix #1 — CHECK action_type complet
DO $$
BEGIN
  -- Drop l'ancien CHECK s'il existe (peu importe le nom auto-généré)
  EXECUTE (
    SELECT 'ALTER TABLE public.sequence_steps DROP CONSTRAINT ' || conname
    FROM pg_constraint
    WHERE conrelid = 'public.sequence_steps'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%action_type%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  NULL; -- pas de CHECK existant, on continue
END $$;

-- Vérifier qu'il n'y a pas de valeurs orphelines avant d'ajouter le CHECK
DO $$
DECLARE
  invalid_count int;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM public.sequence_steps
  WHERE action_type NOT IN (
    'inmail', 'connection_request', 'profile_visit', 'message',
    'smart_message', 'email', 'whatsapp_message',
    'wait_connection', 'wait_reply', 'wait_profile_visit',
    'condition_branch', 'check_connection'
  );
  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % rows with invalid action_type values — CHECK not added', invalid_count;
    RETURN;
  END IF;
  -- Ajouter le CHECK final (drop d'abord : la contrainte est créée plus tôt → 42710 sur replay)
  EXECUTE 'ALTER TABLE public.sequence_steps DROP CONSTRAINT IF EXISTS sequence_steps_action_type_check';
  EXECUTE 'ALTER TABLE public.sequence_steps ADD CONSTRAINT sequence_steps_action_type_check
    CHECK (action_type IN (
      ''inmail'', ''connection_request'', ''profile_visit'', ''message'',
      ''smart_message'', ''email'', ''whatsapp_message'',
      ''wait_connection'', ''wait_reply'', ''wait_profile_visit'',
      ''condition_branch'', ''check_connection''
    ))';
END $$;

-- Fix #7 — sequence_enrollments.created_by : CASCADE → SET NULL
-- Drop l'ancienne FK avec CASCADE
ALTER TABLE public.sequence_enrollments
  DROP CONSTRAINT IF EXISTS sequence_enrollments_created_by_fkey;

-- Re-créer avec ON DELETE SET NULL pour préserver les enrollments
ALTER TABLE public.sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

-- Idem pour outreach_sequences (création de séquence par un user supprimé)
ALTER TABLE public.outreach_sequences
  DROP CONSTRAINT IF EXISTS outreach_sequences_created_by_fkey;

ALTER TABLE public.outreach_sequences
  ADD CONSTRAINT outreach_sequences_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
