-- ════════════════════════════════════════════════════════════════════════
-- Migration : ajout de tracking_data à sequence_enrollments
-- ════════════════════════════════════════════════════════════════════════
--
-- Bug : le code frontend (EnrollmentPreviewModal.tsx) insert un objet
-- tracking_data avec message_overrides + step_config_overrides dans
-- sequence_enrollments, mais la colonne n'existe que sur
-- sequence_step_executions (depuis la migration 20260331120000).
--
-- Erreur runtime visible côté user :
--   Could not find the 'tracking_data' column of 'sequence_enrollments'
--   in the schema cache
--
-- Le cron process-sequences (et useEnrollmentPreview ligne 721) lit
-- enrollment.tracking_data.message_overrides pour appliquer les
-- personnalisations par-étape pré-enregistrées par l'user lors de
-- l'enrôlement (custom subjects, custom delays, etc.).
--
-- Solution : ajouter la colonne JSONB sur sequence_enrollments.
-- Idempotent (IF NOT EXISTS), default '{}'.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS tracking_data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sequence_enrollments.tracking_data IS
  'JSONB pour stocker les overrides per-enrollment :
   - tracking_data.message_overrides : { stepId → { subject, message } }
   - tracking_data.step_config_overrides : { stepId → { delay_minutes, max_wait_minutes } }
   Lu par le cron process-sequences au scheduling de chaque étape, et
   par useEnrollmentPreview au render de la tree view.';

-- Index GIN partiel pour requêtes éventuelles sur tracking_data
-- (rare, mais utile si on veut filtrer "enrollments avec overrides")
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_tracking_data
  ON public.sequence_enrollments USING gin (tracking_data)
  WHERE tracking_data != '{}'::jsonb;
