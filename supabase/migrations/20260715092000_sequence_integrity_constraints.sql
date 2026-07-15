-- ============================================
-- Migration: intégrité séquences — anti double-planification + fix created_by
-- ============================================
--
-- 1. UNIQUE partiel sur sequence_step_executions (audit 2026-07, DB H3) :
--    aucune contrainte n'empêchait deux exécutions PENDANTES du même step pour
--    le même enrollment (janitor qui réarme + run concurrent, TOCTOU du
--    check-then-insert de scheduleNextStep/webhook). Deux lignes 'scheduled'
--    simultanées = deux messages envoyés au même candidat. L'index ne couvre
--    QUE les statuts pendants — l'historique (sent/opened/...) peut coexister
--    avec une re-planification légitime (boucles de branchement).
--
-- 2. created_by DROP NOT NULL (audit 2026-07, DB H1) : la migration
--    20260504150000 a posé ON DELETE SET NULL sur created_by (outreach_sequences
--    + sequence_enrollments) mais la colonne est restée NOT NULL → toute
--    suppression d'un compte auth.users échoue (violation NOT NULL), ce qui
--    bloque l'offboarding et les demandes d'effacement RGPD.
--
-- Idempotente — réexécutable sans danger.
-- ============================================

-- ─── 1a. Nettoyage préalable : annuler les doublons pendants existants ──────
-- (garde la ligne la plus ancienne par (enrollment_id, step_id), annule le reste)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY enrollment_id, step_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.sequence_step_executions
  WHERE status IN ('scheduled', 'sending', 'waiting_event', 'quota_blocked')
)
UPDATE public.sequence_step_executions e
SET status = 'cancelled',
    skip_reason = 'Doublon de planification annulé (migration intégrité 2026-07-15)'
FROM ranked r
WHERE e.id = r.id AND r.rn > 1;

-- ─── 1b. Index unique partiel ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_step_exec_pending_per_enrollment_step
  ON public.sequence_step_executions (enrollment_id, step_id)
  WHERE status IN ('scheduled', 'sending', 'waiting_event', 'quota_blocked');

-- ─── 2. created_by nullable (cohérent avec ON DELETE SET NULL) ──────────────
ALTER TABLE public.outreach_sequences ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.sequence_enrollments ALTER COLUMN created_by DROP NOT NULL;
