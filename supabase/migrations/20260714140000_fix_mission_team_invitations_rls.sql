-- ====================================================================
-- SECURITY FIX (audit équipe/rôles 2026-07-14) — 2 failles critiques
--
-- 1. mission_team : les 2 policies FOR ALL ("mission_team_policy" et
--    "Users can see team for their org projects") n'ont pas de WITH CHECK.
--    Le disjoint `user_id = auth.uid()` du USING est donc réutilisé comme
--    WITH CHECK pour INSERT → n'importe quel utilisateur authentifié peut
--    s'insérer lui-même dans l'équipe d'une mission d'une AUTRE org
--    (role 'lead' au choix) et obtenir via is_mission_team_member* un
--    accès cross-tenant en lecture/écriture aux candidats, évaluations,
--    notes, séquences et process de cette org.
--    → policies granulaires : INSERT/UPDATE réservés aux membres de l'org
--    du projet ; l'acceptation d'invitation freelance passe désormais par
--    l'edge function accept-mission-invitation (service_role).
--
-- 2. mission_invitations : "public_read_active_invitation"
--    (20260422140000) fait SELECT USING (status='pending' AND non expirée)
--    sans clause TO ni filtre par token → combinée au
--    GRANT SELECT ... TO anon (20260421180000), un `select *` avec la clé
--    anon publique renvoie TOUTES les invitations actives (emails +
--    tokens). Le commentaire d'origine (« il faut connaître l'UUID »)
--    est faux : la RLS filtre des lignes, pas des paramètres.
--    → suppression de la policy publique ; lecture réservée aux membres
--    de l'org et à l'invité (email du JWT — sans requêter auth.users,
--    non lisible par le rôle authenticated).
--
-- Idempotente, rejouable.
-- ====================================================================

-- ─────────────────────────────────────────────────────────────
-- Helper : l'utilisateur est-il membre de l'org propriétaire du projet ?
-- SECURITY DEFINER (comme is_mission_team_member*) pour éviter la
-- récursion RLS mission_team ↔ sourcing_projects.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_org_member_for_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sourcing_projects sp
    JOIN public.organization_members om ON om.organization_id = sp.organization_id
    WHERE sp.id = _project_id
      AND om.user_id = _user_id
  );
$$;

-- Les default privileges ne donnent plus EXECUTE aux rôles clients
-- (20260610120000) → grant explicite requis pour l'évaluation des policies.
REVOKE EXECUTE ON FUNCTION public.is_org_member_for_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member_for_project(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1. mission_team — policies granulaires
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mission_team_policy" ON public.mission_team;
DROP POLICY IF EXISTS "Users can see team for their org projects" ON public.mission_team;
DROP POLICY IF EXISTS "mission_team_select" ON public.mission_team;
DROP POLICY IF EXISTS "mission_team_insert" ON public.mission_team;
DROP POLICY IF EXISTS "mission_team_update" ON public.mission_team;
DROP POLICY IF EXISTS "mission_team_delete" ON public.mission_team;

-- Lecture : membres de l'org du projet + membres de l'équipe mission
-- (les freelances externes voient l'équipe de leurs missions).
CREATE POLICY "mission_team_select" ON public.mission_team
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member_for_project(auth.uid(), project_id)
    OR public.is_mission_team_member_for_project(auth.uid(), project_id)
  );

-- Écriture : uniquement les membres de l'org propriétaire du projet.
-- L'ajout d'un freelance externe passe par accept-mission-invitation
-- (service_role, bypass RLS) après vérification token + email.
CREATE POLICY "mission_team_insert" ON public.mission_team
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member_for_project(auth.uid(), project_id));

CREATE POLICY "mission_team_update" ON public.mission_team
  FOR UPDATE TO authenticated
  USING (public.is_org_member_for_project(auth.uid(), project_id))
  WITH CHECK (public.is_org_member_for_project(auth.uid(), project_id));

-- Suppression : l'org gère son équipe ; un membre peut se retirer lui-même.
CREATE POLICY "mission_team_delete" ON public.mission_team
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member_for_project(auth.uid(), project_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 2. mission_invitations — suppression de la lecture publique
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "public_read_active_invitation" ON public.mission_invitations;
-- Anciennes policies SELECT : sous-requête sur auth.users (non lisible par
-- le rôle authenticated) → remplacées par l'email du JWT.
DROP POLICY IF EXISTS "mission_invitations_read_own" ON public.mission_invitations;
DROP POLICY IF EXISTS "mission_invitations_read" ON public.mission_invitations;
DROP POLICY IF EXISTS "mission_invitations_select" ON public.mission_invitations;

CREATE POLICY "mission_invitations_select" ON public.mission_invitations
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- "mission_invitations_manage" (FOR ALL, scope org) reste inchangée :
-- l'acceptation par l'invité (update status) passe par l'edge function.
