-- Fix RLS regression on sequence_* tables.
--
-- Migrations 20260210105248 and 20260210110708 introduced "Anyone can..."
-- policies with USING (true) / WITH CHECK (true). Migration 20260313002307
-- dropped two of them, and 20260410000000_backfill_rls_phase_2.sql added
-- proper "Org members can..." policies. But 5 stale policies were never
-- removed. Postgres combines policies of the same command with OR, so
-- USING (true) keeps winning: these tables are effectively readable by
-- anyone with the anon key.
--
-- Dropping the stale policies leaves only the org-scoped ones, restoring
-- multi-tenant isolation.
--
-- Safety: sequence-email-track and process-sequences edge functions use
-- SUPABASE_SERVICE_ROLE_KEY (RLS-bypassing), so tightening these policies
-- does not break the tracking pixel or the sequence processor.

DROP POLICY IF EXISTS "Anyone can view sequences" ON public.outreach_sequences;

DROP POLICY IF EXISTS "Anyone can view sequence enrollments" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "Anyone can create enrollments" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "Anyone can update enrollments" ON public.sequence_enrollments;

DROP POLICY IF EXISTS "Anyone can view step executions" ON public.sequence_step_executions;
DROP POLICY IF EXISTS "Anyone can manage step executions" ON public.sequence_step_executions;

-- Defensive: already dropped in 20260313002307, harmless to re-assert.
DROP POLICY IF EXISTS "Anyone can view sequence steps" ON public.sequence_steps;
DROP POLICY IF EXISTS "Anyone can view sequence analytics" ON public.sequence_analytics;
