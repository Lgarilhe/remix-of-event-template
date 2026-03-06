
-- ============================================
-- Phase 2: Migrate RLS policies to organization-based
-- ============================================

-- Helper: get current user's active org (already exists, just confirming)
-- We'll use: public.get_user_org_id(auth.uid())

-- ============================================
-- 1. sourcing_projects
-- ============================================
DROP POLICY IF EXISTS "Users can view their own projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Users can create their own projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Users can update their own projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Users can delete their own projects" ON public.sourcing_projects;

CREATE POLICY "Org members can view projects"
  ON public.sourcing_projects FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create projects"
  ON public.sourcing_projects FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update projects"
  ON public.sourcing_projects FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete projects"
  ON public.sourcing_projects FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 2. search_history
-- ============================================
DROP POLICY IF EXISTS "Users can view their own search history" ON public.search_history;
DROP POLICY IF EXISTS "Users can create their own search history" ON public.search_history;
DROP POLICY IF EXISTS "Users can update their own search history" ON public.search_history;
DROP POLICY IF EXISTS "Users can delete their own search history" ON public.search_history;

CREATE POLICY "Org members can view search history"
  ON public.search_history FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create search history"
  ON public.search_history FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update search history"
  ON public.search_history FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete search history"
  ON public.search_history FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 3. job_candidate_status
-- ============================================
DROP POLICY IF EXISTS "Users can manage their own candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Users can view their own candidate statuses" ON public.job_candidate_status;

CREATE POLICY "Org members can view candidate statuses"
  ON public.job_candidate_status FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can insert candidate statuses"
  ON public.job_candidate_status FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update candidate statuses"
  ON public.job_candidate_status FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete candidate statuses"
  ON public.job_candidate_status FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 4. outreach_sequences
-- ============================================
DROP POLICY IF EXISTS "Users can create their own sequences" ON public.outreach_sequences;
DROP POLICY IF EXISTS "Users can update their own sequences" ON public.outreach_sequences;
DROP POLICY IF EXISTS "Users can delete their own sequences" ON public.outreach_sequences;
DROP POLICY IF EXISTS "Anyone can view sequences" ON public.outreach_sequences;

CREATE POLICY "Org members can view sequences"
  ON public.outreach_sequences FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create sequences"
  ON public.outreach_sequences FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update sequences"
  ON public.outreach_sequences FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete sequences"
  ON public.outreach_sequences FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 5. saved_filter_presets
-- ============================================
DROP POLICY IF EXISTS "Users can view their own filter presets" ON public.saved_filter_presets;
DROP POLICY IF EXISTS "Users can create their own filter presets" ON public.saved_filter_presets;
DROP POLICY IF EXISTS "Users can update their own filter presets" ON public.saved_filter_presets;
DROP POLICY IF EXISTS "Users can delete their own filter presets" ON public.saved_filter_presets;

CREATE POLICY "Org members can view filter presets"
  ON public.saved_filter_presets FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create filter presets"
  ON public.saved_filter_presets FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update filter presets"
  ON public.saved_filter_presets FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete filter presets"
  ON public.saved_filter_presets FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 6. inmail_queue
-- ============================================
DROP POLICY IF EXISTS "Users can view their own queued InMails" ON public.inmail_queue;
DROP POLICY IF EXISTS "Users can create their own queued InMails" ON public.inmail_queue;
DROP POLICY IF EXISTS "Users can update their own queued InMails" ON public.inmail_queue;
DROP POLICY IF EXISTS "Users can delete their own queued InMails" ON public.inmail_queue;

CREATE POLICY "Org members can view inmail queue"
  ON public.inmail_queue FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create inmail queue"
  ON public.inmail_queue FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update inmail queue"
  ON public.inmail_queue FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete inmail queue"
  ON public.inmail_queue FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 7. qualification_sessions
-- ============================================
DROP POLICY IF EXISTS "Users can view their own qualification sessions" ON public.qualification_sessions;
DROP POLICY IF EXISTS "Users can create qualification sessions" ON public.qualification_sessions;
DROP POLICY IF EXISTS "Users can update their own qualification sessions" ON public.qualification_sessions;
DROP POLICY IF EXISTS "Users can delete their own qualification sessions" ON public.qualification_sessions;

CREATE POLICY "Org members can view qualification sessions"
  ON public.qualification_sessions FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create qualification sessions"
  ON public.qualification_sessions FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update qualification sessions"
  ON public.qualification_sessions FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete qualification sessions"
  ON public.qualification_sessions FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 8. candidate_evaluations
-- ============================================
DROP POLICY IF EXISTS "Users can view their own evaluations" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "Users can create evaluations" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "Users can update their own evaluations" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "Users can delete their own evaluations" ON public.candidate_evaluations;

CREATE POLICY "Org members can view evaluations"
  ON public.candidate_evaluations FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create evaluations"
  ON public.candidate_evaluations FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update evaluations"
  ON public.candidate_evaluations FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete evaluations"
  ON public.candidate_evaluations FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 9. call_coaching_sessions
-- ============================================
DROP POLICY IF EXISTS "Users can view their own coaching sessions" ON public.call_coaching_sessions;
DROP POLICY IF EXISTS "Users can create their own coaching sessions" ON public.call_coaching_sessions;
DROP POLICY IF EXISTS "Users can update their own coaching sessions" ON public.call_coaching_sessions;
DROP POLICY IF EXISTS "Users can delete their own coaching sessions" ON public.call_coaching_sessions;

CREATE POLICY "Org members can view coaching sessions"
  ON public.call_coaching_sessions FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create coaching sessions"
  ON public.call_coaching_sessions FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update coaching sessions"
  ON public.call_coaching_sessions FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete coaching sessions"
  ON public.call_coaching_sessions FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 10. candidate_portal_tokens
-- ============================================
DROP POLICY IF EXISTS "Users can view their own tokens" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "Users can create portal tokens" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "Users can update their own tokens" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.candidate_portal_tokens;
-- Keep the public token lookup policy
-- DROP POLICY IF EXISTS "Anyone can view active tokens by token value" ON public.candidate_portal_tokens;

CREATE POLICY "Org members can view portal tokens"
  ON public.candidate_portal_tokens FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create portal tokens"
  ON public.candidate_portal_tokens FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update portal tokens"
  ON public.candidate_portal_tokens FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete portal tokens"
  ON public.candidate_portal_tokens FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 11. candidate_notes
-- ============================================
DROP POLICY IF EXISTS "Users can view their own notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can create notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Users can delete their own notes" ON public.candidate_notes;

CREATE POLICY "Org members can view candidate notes"
  ON public.candidate_notes FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create candidate notes"
  ON public.candidate_notes FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update candidate notes"
  ON public.candidate_notes FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete candidate notes"
  ON public.candidate_notes FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 12. candidate_reminders
-- ============================================
DROP POLICY IF EXISTS "Users can view their own reminders" ON public.candidate_reminders;
DROP POLICY IF EXISTS "Users can create reminders" ON public.candidate_reminders;
DROP POLICY IF EXISTS "Users can update their own reminders" ON public.candidate_reminders;
DROP POLICY IF EXISTS "Users can delete their own reminders" ON public.candidate_reminders;

CREATE POLICY "Org members can view reminders"
  ON public.candidate_reminders FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create reminders"
  ON public.candidate_reminders FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update reminders"
  ON public.candidate_reminders FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete reminders"
  ON public.candidate_reminders FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 13. nurturing_opportunities
-- ============================================
DROP POLICY IF EXISTS "Users can view their own nurturing opportunities" ON public.nurturing_opportunities;
DROP POLICY IF EXISTS "Users can create nurturing opportunities" ON public.nurturing_opportunities;
DROP POLICY IF EXISTS "Users can update their own nurturing opportunities" ON public.nurturing_opportunities;
DROP POLICY IF EXISTS "Users can delete their own nurturing opportunities" ON public.nurturing_opportunities;

CREATE POLICY "Org members can view nurturing opportunities"
  ON public.nurturing_opportunities FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create nurturing opportunities"
  ON public.nurturing_opportunities FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update nurturing opportunities"
  ON public.nurturing_opportunities FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete nurturing opportunities"
  ON public.nurturing_opportunities FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 14. chat_categories
-- ============================================
DROP POLICY IF EXISTS "Users can view their own chat categories" ON public.chat_categories;
DROP POLICY IF EXISTS "Users can create chat categories" ON public.chat_categories;
DROP POLICY IF EXISTS "Users can update their own chat categories" ON public.chat_categories;
DROP POLICY IF EXISTS "Users can delete their own chat categories" ON public.chat_categories;

CREATE POLICY "Org members can view chat categories"
  ON public.chat_categories FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create chat categories"
  ON public.chat_categories FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update chat categories"
  ON public.chat_categories FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can delete chat categories"
  ON public.chat_categories FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 15. Fix sequence_enrollments (overly permissive)
-- ============================================
DROP POLICY IF EXISTS "Anyone can view sequence enrollments" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "Anyone can create enrollments" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "Anyone can update enrollments" ON public.sequence_enrollments;

CREATE POLICY "Org members can view enrollments"
  ON public.sequence_enrollments FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

CREATE POLICY "Org members can create enrollments"
  ON public.sequence_enrollments FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can update enrollments"
  ON public.sequence_enrollments FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );

-- ============================================
-- 16. Fix sequence_step_executions (overly permissive)
-- ============================================
DROP POLICY IF EXISTS "Anyone can manage step executions" ON public.sequence_step_executions;
DROP POLICY IF EXISTS "Anyone can view step executions" ON public.sequence_step_executions;

CREATE POLICY "Org members can view step executions"
  ON public.sequence_step_executions FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Org members can manage step executions"
  ON public.sequence_step_executions FOR ALL
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

-- ============================================
-- Backfill: set organization_id on existing data
-- ============================================
UPDATE public.sourcing_projects SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = sourcing_projects.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.search_history SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = search_history.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.job_candidate_status SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = job_candidate_status.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.outreach_sequences SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = outreach_sequences.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.saved_filter_presets SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = saved_filter_presets.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.inmail_queue SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = inmail_queue.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.qualification_sessions SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = qualification_sessions.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.candidate_evaluations SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = candidate_evaluations.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.call_coaching_sessions SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = call_coaching_sessions.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.candidate_portal_tokens SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = candidate_portal_tokens.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.candidate_notes SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = candidate_notes.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.candidate_reminders SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = candidate_reminders.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.nurturing_opportunities SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = nurturing_opportunities.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.chat_categories SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = chat_categories.created_by LIMIT 1) WHERE organization_id IS NULL;
UPDATE public.sequence_enrollments SET organization_id = (SELECT active_organization_id FROM profiles WHERE user_id = sequence_enrollments.created_by LIMIT 1) WHERE organization_id IS NULL;
