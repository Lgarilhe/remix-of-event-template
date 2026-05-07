-- ─────────────────────────────────────────────────────────────────────────────
-- Sequence security hardening (audit Opus 2026-05-07)
--
-- Fixes:
--   1. sequence_steps: write path basé sur created_by uniquement (legacy
--      policy "Users can manage steps of their sequences" 2026-01-28). Un user
--      qui a créé une séquence ensuite reassignée à une autre org pouvait
--      continuer à éditer ses steps. Remplacement par 3 policies INSERT/
--      UPDATE/DELETE org-scoped.
--   2. sequence_steps: doublon de SELECT policy laissant le fallback
--      "organization_id IS NULL" ouvert (créée 2026-03-18). Drop pour ne
--      garder que la policy stricte.
--   3. sequence_step_executions: policy FOR ALL sans WITH CHECK (créée
--      2026-03-13). Un user authentifié pouvait techniquement INSERT une row
--      avec organization_id arbitraire. Remplacement par policies SELECT/
--      INSERT/UPDATE/DELETE distinctes avec WITH CHECK.
--   4. sequence_steps: index manquant sur (sequence_id, step_order) après
--      drop de l'ancien UNIQUE par 20260331120000. Le cron en a besoin.
--
-- Idempotente — réexécutable sans danger.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. sequence_steps : durcir les writes ─────────────────────────────────

DROP POLICY IF EXISTS "Users can manage steps of their sequences" ON public.sequence_steps;
DROP POLICY IF EXISTS "Org members can view sequence steps" ON public.sequence_steps;

-- Note: la policy stricte "Organization members can view sequence steps"
-- (créée 2026-03-16) est conservée pour le SELECT.

CREATE POLICY "Org members can insert sequence steps"
  ON public.sequence_steps
  FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Org members can update sequence steps"
  ON public.sequence_steps
  FOR UPDATE
  TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Org members can delete sequence steps"
  ON public.sequence_steps
  FOR DELETE
  TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- ─── 2. sequence_step_executions : ajouter WITH CHECK ──────────────────────

DROP POLICY IF EXISTS "Org members can manage step executions" ON public.sequence_step_executions;

CREATE POLICY "Org members can view step executions"
  ON public.sequence_step_executions
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (
      organization_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
          AND e.organization_id = public.get_user_org_id(auth.uid())
      )
    )
  );

CREATE POLICY "Org members can insert step executions"
  ON public.sequence_step_executions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    OR (
      organization_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
          AND e.organization_id = public.get_user_org_id(auth.uid())
      )
    )
  );

CREATE POLICY "Org members can update step executions"
  ON public.sequence_step_executions
  FOR UPDATE
  TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Org members can delete step executions"
  ON public.sequence_step_executions
  FOR DELETE
  TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- ─── 3. Index manquant pour le cron ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sequence_steps_seq_order
  ON public.sequence_steps(sequence_id, step_order);

-- ─── 4. sequence_enrollments : policy DELETE manquante ─────────────────────
-- Phase 2 backfill RLS (20260410000000) avait ajouté SELECT/INSERT/UPDATE
-- mais oublié DELETE. Ajout pour permettre la suppression d'un enrollment
-- depuis l'UI.

DROP POLICY IF EXISTS "Org members can delete enrollments" ON public.sequence_enrollments;

CREATE POLICY "Org members can delete enrollments"
  ON public.sequence_enrollments
  FOR DELETE
  TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
