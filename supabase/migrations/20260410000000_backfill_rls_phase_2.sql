-- ============================================================================
-- RLS Phase 2: Backfill organization_id + strict policies + freelance + hunt
-- ============================================================================
-- Konekt org: 2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82
-- All NULL organization_id rows belong to this org (only real tenant).
-- NOT NULL constraint deferred to a separate migration after validation.
-- ============================================================================

-- ============================================================================
-- ÉTAPE 1: Backfill organization_id on all NULL rows
-- ============================================================================

UPDATE public.aircall_calls        SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.match_scores         SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.candidate_profiles   SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.sequence_enrollments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.nurturing_opportunities SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.job_candidate_status SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.chat_categories      SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.candidate_evaluations SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.call_coaching_sessions SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.search_history       SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.candidate_portal_tokens SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.candidate_notes      SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.outreach_sequences   SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;
UPDATE public.sourcing_projects    SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id IS NULL;

-- ============================================================================
-- ÉTAPE 2: Replace "OR organization_id IS NULL" policies with strict org check
-- ============================================================================

-- -----------------------------------------------
-- 2.1 sourcing_projects
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Org members can create projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Org members can update projects" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Org members can delete projects" ON public.sourcing_projects;

CREATE POLICY "Org members can view projects"
  ON public.sourcing_projects FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create projects" ON public.sourcing_projects;
CREATE POLICY "Org members can create projects"
  ON public.sourcing_projects FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update projects" ON public.sourcing_projects;
CREATE POLICY "Org members can update projects"
  ON public.sourcing_projects FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete projects" ON public.sourcing_projects;
CREATE POLICY "Org members can delete projects"
  ON public.sourcing_projects FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.2 search_history
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view search history" ON public.search_history;
DROP POLICY IF EXISTS "Org members can create search history" ON public.search_history;
DROP POLICY IF EXISTS "Org members can update search history" ON public.search_history;
DROP POLICY IF EXISTS "Org members can delete search history" ON public.search_history;

CREATE POLICY "Org members can view search history"
  ON public.search_history FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create search history" ON public.search_history;
CREATE POLICY "Org members can create search history"
  ON public.search_history FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update search history" ON public.search_history;
CREATE POLICY "Org members can update search history"
  ON public.search_history FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete search history" ON public.search_history;
CREATE POLICY "Org members can delete search history"
  ON public.search_history FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.3 job_candidate_status
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Org members can insert candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Org members can update candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Org members can delete candidate statuses" ON public.job_candidate_status;

CREATE POLICY "Org members can view candidate statuses"
  ON public.job_candidate_status FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can insert candidate statuses" ON public.job_candidate_status;
CREATE POLICY "Org members can insert candidate statuses"
  ON public.job_candidate_status FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update candidate statuses" ON public.job_candidate_status;
CREATE POLICY "Org members can update candidate statuses"
  ON public.job_candidate_status FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete candidate statuses" ON public.job_candidate_status;
CREATE POLICY "Org members can delete candidate statuses"
  ON public.job_candidate_status FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.4 outreach_sequences
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view sequences" ON public.outreach_sequences;
DROP POLICY IF EXISTS "Org members can create sequences" ON public.outreach_sequences;
DROP POLICY IF EXISTS "Org members can update sequences" ON public.outreach_sequences;
DROP POLICY IF EXISTS "Org members can delete sequences" ON public.outreach_sequences;

CREATE POLICY "Org members can view sequences"
  ON public.outreach_sequences FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create sequences" ON public.outreach_sequences;
CREATE POLICY "Org members can create sequences"
  ON public.outreach_sequences FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update sequences" ON public.outreach_sequences;
CREATE POLICY "Org members can update sequences"
  ON public.outreach_sequences FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete sequences" ON public.outreach_sequences;
CREATE POLICY "Org members can delete sequences"
  ON public.outreach_sequences FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.5 candidate_evaluations
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view evaluations" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "Org members can create evaluations" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "Org members can update evaluations" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "Org members can delete evaluations" ON public.candidate_evaluations;

CREATE POLICY "Org members can view evaluations"
  ON public.candidate_evaluations FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create evaluations" ON public.candidate_evaluations;
CREATE POLICY "Org members can create evaluations"
  ON public.candidate_evaluations FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update evaluations" ON public.candidate_evaluations;
CREATE POLICY "Org members can update evaluations"
  ON public.candidate_evaluations FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete evaluations" ON public.candidate_evaluations;
CREATE POLICY "Org members can delete evaluations"
  ON public.candidate_evaluations FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.6 call_coaching_sessions
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view coaching sessions" ON public.call_coaching_sessions;
DROP POLICY IF EXISTS "Org members can create coaching sessions" ON public.call_coaching_sessions;
DROP POLICY IF EXISTS "Org members can update coaching sessions" ON public.call_coaching_sessions;
DROP POLICY IF EXISTS "Org members can delete coaching sessions" ON public.call_coaching_sessions;

CREATE POLICY "Org members can view coaching sessions"
  ON public.call_coaching_sessions FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create coaching sessions" ON public.call_coaching_sessions;
CREATE POLICY "Org members can create coaching sessions"
  ON public.call_coaching_sessions FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update coaching sessions" ON public.call_coaching_sessions;
CREATE POLICY "Org members can update coaching sessions"
  ON public.call_coaching_sessions FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete coaching sessions" ON public.call_coaching_sessions;
CREATE POLICY "Org members can delete coaching sessions"
  ON public.call_coaching_sessions FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.7 candidate_portal_tokens
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view portal tokens" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "Org members can create portal tokens" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "Org members can update portal tokens" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "Org members can delete portal tokens" ON public.candidate_portal_tokens;

CREATE POLICY "Org members can view portal tokens"
  ON public.candidate_portal_tokens FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create portal tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Org members can create portal tokens"
  ON public.candidate_portal_tokens FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update portal tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Org members can update portal tokens"
  ON public.candidate_portal_tokens FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete portal tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Org members can delete portal tokens"
  ON public.candidate_portal_tokens FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.8 candidate_notes
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view candidate notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Org members can create candidate notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Org members can update candidate notes" ON public.candidate_notes;
DROP POLICY IF EXISTS "Org members can delete candidate notes" ON public.candidate_notes;

CREATE POLICY "Org members can view candidate notes"
  ON public.candidate_notes FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create candidate notes" ON public.candidate_notes;
CREATE POLICY "Org members can create candidate notes"
  ON public.candidate_notes FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update candidate notes" ON public.candidate_notes;
CREATE POLICY "Org members can update candidate notes"
  ON public.candidate_notes FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete candidate notes" ON public.candidate_notes;
CREATE POLICY "Org members can delete candidate notes"
  ON public.candidate_notes FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.9 nurturing_opportunities
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view nurturing opportunities" ON public.nurturing_opportunities;
DROP POLICY IF EXISTS "Org members can create nurturing opportunities" ON public.nurturing_opportunities;
DROP POLICY IF EXISTS "Org members can update nurturing opportunities" ON public.nurturing_opportunities;
DROP POLICY IF EXISTS "Org members can delete nurturing opportunities" ON public.nurturing_opportunities;

DROP POLICY IF EXISTS "Org members can view nurturing opportunities" ON public.nurturing_opportunities;
CREATE POLICY "Org members can view nurturing opportunities"
  ON public.nurturing_opportunities FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create nurturing opportunities" ON public.nurturing_opportunities;
CREATE POLICY "Org members can create nurturing opportunities"
  ON public.nurturing_opportunities FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update nurturing opportunities" ON public.nurturing_opportunities;
CREATE POLICY "Org members can update nurturing opportunities"
  ON public.nurturing_opportunities FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete nurturing opportunities" ON public.nurturing_opportunities;
CREATE POLICY "Org members can delete nurturing opportunities"
  ON public.nurturing_opportunities FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.10 chat_categories
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view chat categories" ON public.chat_categories;
DROP POLICY IF EXISTS "Org members can create chat categories" ON public.chat_categories;
DROP POLICY IF EXISTS "Org members can update chat categories" ON public.chat_categories;
DROP POLICY IF EXISTS "Org members can delete chat categories" ON public.chat_categories;

CREATE POLICY "Org members can view chat categories"
  ON public.chat_categories FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create chat categories" ON public.chat_categories;
CREATE POLICY "Org members can create chat categories"
  ON public.chat_categories FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update chat categories" ON public.chat_categories;
CREATE POLICY "Org members can update chat categories"
  ON public.chat_categories FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete chat categories" ON public.chat_categories;
CREATE POLICY "Org members can delete chat categories"
  ON public.chat_categories FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.11 sequence_enrollments
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view enrollments" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "Org members can create enrollments" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "Org members can update enrollments" ON public.sequence_enrollments;

CREATE POLICY "Org members can view enrollments"
  ON public.sequence_enrollments FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org members can create enrollments"
  ON public.sequence_enrollments FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update enrollments" ON public.sequence_enrollments;
CREATE POLICY "Org members can update enrollments"
  ON public.sequence_enrollments FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.12 candidate_profiles
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view candidate profiles" ON public.candidate_profiles;
DROP POLICY IF EXISTS "Org members can create candidate profiles" ON public.candidate_profiles;
DROP POLICY IF EXISTS "Org members can update candidate profiles" ON public.candidate_profiles;
DROP POLICY IF EXISTS "Org members can delete candidate profiles" ON public.candidate_profiles;

CREATE POLICY "Org members can view candidate profiles"
  ON public.candidate_profiles FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create candidate profiles" ON public.candidate_profiles;
CREATE POLICY "Org members can create candidate profiles"
  ON public.candidate_profiles FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update candidate profiles" ON public.candidate_profiles;
CREATE POLICY "Org members can update candidate profiles"
  ON public.candidate_profiles FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete candidate profiles" ON public.candidate_profiles;
CREATE POLICY "Org members can delete candidate profiles"
  ON public.candidate_profiles FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.13 match_scores
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view match scores" ON public.match_scores;
DROP POLICY IF EXISTS "Org members can create match scores" ON public.match_scores;
DROP POLICY IF EXISTS "Org members can update match scores" ON public.match_scores;
DROP POLICY IF EXISTS "Org members can delete match scores" ON public.match_scores;

CREATE POLICY "Org members can view match scores"
  ON public.match_scores FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can create match scores" ON public.match_scores;
CREATE POLICY "Org members can create match scores"
  ON public.match_scores FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update match scores" ON public.match_scores;
CREATE POLICY "Org members can update match scores"
  ON public.match_scores FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete match scores" ON public.match_scores;
CREATE POLICY "Org members can delete match scores"
  ON public.match_scores FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- -----------------------------------------------
-- 2.14 aircall_calls (has 2 SELECT policies to drop)
-- -----------------------------------------------
DROP POLICY IF EXISTS "Org members can view aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Org members can insert aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Org members can update aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Org members can delete aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Org-scoped read calls" ON public.aircall_calls;

DROP POLICY IF EXISTS "Org members can view aircall calls" ON public.aircall_calls;
CREATE POLICY "Org members can view aircall calls"
  ON public.aircall_calls FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can insert aircall calls" ON public.aircall_calls;
CREATE POLICY "Org members can insert aircall calls"
  ON public.aircall_calls FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can update aircall calls" ON public.aircall_calls;
CREATE POLICY "Org members can update aircall calls"
  ON public.aircall_calls FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org members can delete aircall calls" ON public.aircall_calls;
CREATE POLICY "Org members can delete aircall calls"
  ON public.aircall_calls FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- ============================================================================
-- ÉTAPE 3: Drop USING(true) remnants + stale policy
-- ============================================================================

-- 3.1 job_skills_cache: open SELECT → already covered by org-scoped policies
DROP POLICY IF EXISTS "Anyone can read skills cache" ON public.job_skills_cache;

-- 3.2 events: open SELECT → covered by admin + user-scoped policies from 20251021/20251022
DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;

-- 3.3 sequence_email_tracking: replace USING(true) with SECURITY DEFINER function
--     The tracking pixel/redirect endpoint needs to look up by tracking_id.
--     Instead of open table access, we expose a scoped function.
DROP POLICY IF EXISTS "sequence_email_tracking_anon_select" ON public.sequence_email_tracking;

CREATE OR REPLACE FUNCTION public.get_email_tracking_by_id(p_tracking_id text)
RETURNS TABLE (
  id uuid,
  execution_id uuid,
  tracking_id text,
  email_message_id text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT t.id, t.execution_id, t.tracking_id, t.email_message_id, t.created_at
  FROM public.sequence_email_tracking t
  WHERE t.tracking_id = p_tracking_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_tracking_by_id(text) TO anon, authenticated;

-- 3.4 job_profiles: stale "Authenticated users can read" (replaced by org-scoped)
DROP POLICY IF EXISTS "Authenticated users can read" ON public.job_profiles;

-- ============================================================================
-- ÉTAPE 4: Freelance mission_team policies on 8 tables
-- ============================================================================
-- Freelancers are mission_team members who are NOT org members.
-- They access data through their mission_team membership, scoped by project.
-- Uses existing SECURITY DEFINER functions:
--   is_mission_team_member(_user_id, _project_id) — for sourcing_projects
--   is_mission_team_member_for_project(_user_id, _project_id) — for tables with project_id

-- Helper: check mission_team membership via candidate_id → job_candidate_status.project_id
CREATE OR REPLACE FUNCTION public.is_mission_team_member_for_candidate(_user_id uuid, _candidate_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_candidate_status jcs
    JOIN public.mission_team mt ON mt.project_id = jcs.project_id
    WHERE jcs.candidate_id = _candidate_id
      AND mt.user_id = _user_id
  );
$$;

-- 4.1 sourcing_projects — already has "mission_team_view_projects" (SELECT)
-- 4.2 job_candidate_status — already has "mission_team_view/insert/update_candidates"
-- (both from migration 20260326183825, no changes needed)

-- 4.3 mission_process_steps (SELECT — see interview process)
CREATE POLICY "mission_team_view_process_steps"
  ON public.mission_process_steps FOR SELECT
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));

-- 4.4 candidate_evaluations (SELECT, INSERT, UPDATE via candidate_id)
CREATE POLICY "mission_team_view_evaluations"
  ON public.candidate_evaluations FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

CREATE POLICY "mission_team_create_evaluations"
  ON public.candidate_evaluations FOR INSERT
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

CREATE POLICY "mission_team_update_evaluations"
  ON public.candidate_evaluations FOR UPDATE
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

-- 4.5 candidate_notes (SELECT, INSERT via candidate_id)
CREATE POLICY "mission_team_view_notes"
  ON public.candidate_notes FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

CREATE POLICY "mission_team_create_notes"
  ON public.candidate_notes FOR INSERT
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

-- 4.6 candidate_profiles (SELECT via candidate_id)
CREATE POLICY "mission_team_view_profiles"
  ON public.candidate_profiles FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

-- 4.7 match_scores (SELECT via candidate_id)
CREATE POLICY "mission_team_view_scores"
  ON public.match_scores FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));

-- 4.8 outreach_sequences (SELECT via project_id)
CREATE POLICY "mission_team_view_sequences"
  ON public.outreach_sequences FOR SELECT
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));

-- ============================================================================
-- ÉTAPE 5: Marketplace hunt mode — public SELECT on sourcing_projects
-- ============================================================================
-- Anyone (incl. anon) can see published hunt missions.
-- Does NOT expose created_by — frontend must not SELECT that column in public queries.
-- RLS filters rows, not columns; column restriction is handled at the query level.

CREATE POLICY "Public can view published hunt missions"
  ON public.sourcing_projects FOR SELECT
  USING (hunt_mode = true AND hunt_status = 'published');
