-- =====================================================================
-- Rattrapage RLS écrit contre les policies RÉELLES de la production.
--
-- La prod a été créée le 2026-04-21 depuis MIGRATION_CLEAN.sql (noms
-- génériques : org_members_all, invitee_read, authenticated_read…). Les
-- durcissements de juillet droppaient des noms Lovable jamais appliqués en
-- prod, donc les policies baseline permissives sont restées actives.
-- Source : docs/audit-2026-09-01.md — SEC-001, SEC-002 (volet DB), SEC-003,
-- SEC-008/SEC-033, SEC-009, SEC-010, SEC-018, SEC-032, SEC-034, SEC-035,
-- BUG-002, BUG-016.
--
-- Idempotente, rejouable. Validée en transaction (BEGIN … ROLLBACK) sur la
-- prod avec le test à deux organisations supabase/tests/rls_two_orgs_audit.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. extension_tokens (SEC-008 / SEC-033)
-- La création, la liste et la révocation passent exclusivement par l'edge
-- function extension-token (service_role). Un INSERT client pouvait forger
-- un token portant l'organization_id d'une autre org.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.extension_tokens FROM authenticated;
REVOKE ALL ON public.extension_tokens FROM anon;
DROP POLICY IF EXISTS "extension_tokens_insert_own" ON public.extension_tokens;
DROP POLICY IF EXISTS "extension_tokens_update_own" ON public.extension_tokens;
DROP POLICY IF EXISTS "extension_tokens_delete_own" ON public.extension_tokens;

-- ---------------------------------------------------------------------
-- 2. is_mission_team_member_for_candidate (SEC-001)
-- candidate_id est l'identifiant LinkedIn, global entre toutes les orgs.
-- Sans filtre sur l'organisation, un membre de mission_team d'un projet
-- quelconque lisait notes, évaluations, profils et scores de tous les
-- tenants pour ce candidat. Nouvelle signature avec l'organisation de la
-- ligne ; les policies des 4 tables candidats sont recréées TO authenticated.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_mission_team_member_for_candidate(
  _user_id uuid,
  _candidate_id text,
  _organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT _organization_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.job_candidate_status jcs
    JOIN public.sourcing_projects sp ON sp.id = jcs.project_id
    JOIN public.mission_team mt ON mt.project_id = jcs.project_id
    WHERE jcs.candidate_id = _candidate_id
      AND jcs.organization_id = _organization_id
      AND sp.organization_id = _organization_id
      AND mt.user_id = _user_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_mission_team_member_for_candidate(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_mission_team_member_for_candidate(uuid, text, uuid) TO authenticated;

-- candidate_evaluations
DROP POLICY IF EXISTS "mission_team_select" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "mission_team_insert" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "mission_team_update" ON public.candidate_evaluations;
CREATE POLICY "mission_team_select" ON public.candidate_evaluations
  FOR SELECT TO authenticated
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));
CREATE POLICY "mission_team_insert" ON public.candidate_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));
CREATE POLICY "mission_team_update" ON public.candidate_evaluations
  FOR UPDATE TO authenticated
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id))
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));

-- candidate_notes
DROP POLICY IF EXISTS "mission_team_select" ON public.candidate_notes;
DROP POLICY IF EXISTS "mission_team_insert" ON public.candidate_notes;
CREATE POLICY "mission_team_select" ON public.candidate_notes
  FOR SELECT TO authenticated
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));
CREATE POLICY "mission_team_insert" ON public.candidate_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));

-- candidate_profiles
DROP POLICY IF EXISTS "mission_team_select" ON public.candidate_profiles;
CREATE POLICY "mission_team_select" ON public.candidate_profiles
  FOR SELECT TO authenticated
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));

-- match_scores
DROP POLICY IF EXISTS "mission_team_select" ON public.match_scores;
CREATE POLICY "mission_team_select" ON public.match_scores
  FOR SELECT TO authenticated
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id, organization_id));

-- Ancienne signature sans organisation : plus aucune policy ne l'utilise.
DROP FUNCTION IF EXISTS public.is_mission_team_member_for_candidate(uuid, text);

-- ---------------------------------------------------------------------
-- 3. job_candidate_status et candidate_comments (SEC-009)
-- Un membre de mission_team pouvait écrire une ligne portant l'organization_id
-- d'une autre org (injection dans l'ATS et le RAG de la victime).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_organization_id(_project_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT sp.organization_id FROM public.sourcing_projects sp WHERE sp.id = _project_id
$$;
REVOKE EXECUTE ON FUNCTION public.project_organization_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_organization_id(uuid) TO authenticated;

DROP POLICY IF EXISTS "mission_team_select" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_insert" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_update" ON public.job_candidate_status;
CREATE POLICY "mission_team_select" ON public.job_candidate_status
  FOR SELECT TO authenticated
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));
CREATE POLICY "mission_team_insert" ON public.job_candidate_status
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_mission_team_member_for_project(auth.uid(), project_id)
    AND organization_id = public.project_organization_id(project_id)
  );
CREATE POLICY "mission_team_update" ON public.job_candidate_status
  FOR UPDATE TO authenticated
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id))
  WITH CHECK (
    public.is_mission_team_member_for_project(auth.uid(), project_id)
    AND organization_id = public.project_organization_id(project_id)
  );

DROP POLICY IF EXISTS "authors_update" ON public.candidate_comments;
CREATE POLICY "authors_update" ON public.candidate_comments
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

-- ---------------------------------------------------------------------
-- 4. message_analysis_cache (SEC-010)
-- authenticated_read USING (true) exposait les analyses IA des messageries
-- LinkedIn de tous les tenants. Lecture limitée aux comptes de l'org.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_read" ON public.message_analysis_cache;
DROP POLICY IF EXISTS "org_account_select" ON public.message_analysis_cache;
CREATE POLICY "org_account_select" ON public.message_analysis_cache
  FOR SELECT TO authenticated
  USING (
    (organization_id IS NOT NULL AND organization_id = public.get_user_org_id(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.member_linkedin_accounts mla
      WHERE mla.linkedin_account_id = message_analysis_cache.account_id
        AND mla.organization_id = public.get_user_org_id(auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- 5. get_user_org_id (SEC-032)
-- La version en prod lit profiles.active_organization_id sans vérifier
-- l'appartenance : un membre retiré gardait l'accès RLS à son ancienne org.
-- Le cache set_config est transactionnel, un retrait prend effet à la
-- requête suivante. Trigger de remise à zéro au retrait d'un membre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_cache_key text;
BEGIN
  v_cache_key := 'app.user_org.u_' || replace(_user_id::text, '-', '_');

  BEGIN
    v_org_id := current_setting(v_cache_key, true)::uuid;
    IF v_org_id IS NOT NULL THEN
      RETURN v_org_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT p.active_organization_id
  INTO v_org_id
  FROM public.profiles p
  JOIN public.organization_members om
    ON om.organization_id = p.active_organization_id
   AND om.user_id = p.user_id
  WHERE p.user_id = _user_id
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    PERFORM set_config(v_cache_key, v_org_id::text, true);
  END IF;

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_active_org_on_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
  SET active_organization_id = NULL
  WHERE user_id = OLD.user_id
    AND active_organization_id = OLD.organization_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS reset_active_org_on_member_removed ON public.organization_members;
CREATE TRIGGER reset_active_org_on_member_removed
  AFTER DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_active_org_on_member_removed();

-- ---------------------------------------------------------------------
-- 6. invitations (BUG-002, SEC-034, SEC-003)
-- invitee_read sous-requête auth.users, illisible par le rôle authenticated :
-- tout SELECT client sur ces deux tables échouait « permission denied for
-- table users ». L'invité est déjà couvert par l'email du JWT.
-- mission_invitations : défauts token/status perdus dans la baseline, et
-- project_id jamais rattaché à organization_id (auto-invitation sur le projet
-- d'une autre org).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "invitee_read" ON public.mission_invitations;
DROP POLICY IF EXISTS "invitee_read" ON public.organization_invitations;
DROP POLICY IF EXISTS "invitee_read_jwt" ON public.organization_invitations;
CREATE POLICY "invitee_read_jwt" ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

ALTER TABLE public.mission_invitations ALTER COLUMN token SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.mission_invitations ALTER COLUMN status SET DEFAULT 'pending';

DROP POLICY IF EXISTS "org_members_manage" ON public.mission_invitations;
CREATE POLICY "org_members_manage" ON public.mission_invitations
  FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  ))
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
    AND public.project_organization_id(project_id) = organization_id
  );

-- ---------------------------------------------------------------------
-- 7. member_email_accounts (SEC-035)
-- La policy baseline org_members_all (FOR ALL) rendait inopérant le
-- durcissement du 16/07 : tout membre pouvait réécrire ou supprimer le
-- mapping email d'un collègue. Lecture org conservée pour le multi-sender.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "org_members_all" ON public.member_email_accounts;
DROP POLICY IF EXISTS "member_email_accounts_select" ON public.member_email_accounts;
CREATE POLICY "member_email_accounts_select" ON public.member_email_accounts
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- ---------------------------------------------------------------------
-- 8. agent_tool_executions (SEC-002 volet DB, BUG-016)
-- Le propriétaire d'une ligne pouvait réécrire tool_name, status,
-- scheduled_for… entre proposition et approbation. Le serveur rejoue
-- désormais verifyAccess avant execute ; ce trigger borne en plus ce que le
-- client peut modifier : params avant approbation, user_note, et les
-- transitions déjà utilisées par l'UI (rejet, annulation d'une action
-- programmée, remise en attente d'un échec).
-- ---------------------------------------------------------------------
REVOKE INSERT, DELETE ON public.agent_tool_executions FROM authenticated;

CREATE OR REPLACE FUNCTION public.guard_agent_tool_execution_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.tool_name IS DISTINCT FROM OLD.tool_name
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.dry_run_result IS DISTINCT FROM OLD.dry_run_result THEN
    RAISE EXCEPTION 'agent_tool_executions: colonne non modifiable côté client';
  END IF;

  IF NEW.params IS DISTINCT FROM OLD.params AND OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'agent_tool_executions: paramètres modifiables uniquement avant approbation';
  END IF;

  IF NEW.executed_at IS NOT NULL AND NEW.executed_at IS DISTINCT FROM OLD.executed_at THEN
    RAISE EXCEPTION 'agent_tool_executions: executed_at réservé au serveur';
  END IF;
  IF NEW.real_result IS NOT NULL AND NEW.real_result IS DISTINCT FROM OLD.real_result THEN
    RAISE EXCEPTION 'agent_tool_executions: real_result réservé au serveur';
  END IF;
  IF NEW.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'agent_tool_executions: approved_at réservé au serveur';
  END IF;
  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for THEN
    RAISE EXCEPTION 'agent_tool_executions: scheduled_for réservé au serveur';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'proposed' AND NEW.status = 'rejected')
      OR (OLD.status = 'approved' AND NEW.status = 'rejected' AND OLD.executed_at IS NULL)
      OR (OLD.status = 'failed' AND NEW.status = 'proposed')
    ) THEN
      RAISE EXCEPTION 'agent_tool_executions: transition % vers % interdite côté client', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_agent_tool_execution_update ON public.agent_tool_executions;
CREATE TRIGGER guard_agent_tool_execution_update
  BEFORE UPDATE ON public.agent_tool_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_agent_tool_execution_update();

-- ---------------------------------------------------------------------
-- 9. organization_invitations.role (SEC-018)
-- Un admin pouvait insérer via PostgREST une invitation role='owner' pour
-- son second compte ; accept-invitation l'insérait tel quel sous service_role.
-- ---------------------------------------------------------------------
UPDATE public.organization_invitations SET role = 'admin' WHERE role = 'owner';
ALTER TABLE public.organization_invitations DROP CONSTRAINT IF EXISTS organization_invitations_role_check;
ALTER TABLE public.organization_invitations
  ADD CONSTRAINT organization_invitations_role_check
  CHECK (role IN ('admin', 'member', 'collaborator'));

-- ---------------------------------------------------------------------
-- 10. notion_api_cache
-- Les clés globales servaient les postes et candidats Notion d'une org à
-- toutes les autres. Les edge functions utilisent désormais des clés par
-- organisation (v2) ; les entrées globales sont purgées.
-- ---------------------------------------------------------------------
DELETE FROM public.notion_api_cache
WHERE cache_key IN ('notion:jobs:v1', 'notion:candidates:v1', 'notion:shortlist:v1');
