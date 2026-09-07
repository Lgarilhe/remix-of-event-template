-- =====================================================================
-- Alignement des policies héritées sur l'état de la production.
--
-- La production a été créée le 2026-04-21 depuis MIGRATION_CLEAN.sql. Elle
-- n'a jamais reçu les policies posées par les migrations de janvier à avril
-- 2026. Le rattrapage 20260903074500 a donc durci la production en droppant
-- SES noms à elle, et laisse intactes les policies homonymes d'origine.
--
-- Une base reconstruite à partir des seules migrations, par exemple la stack
-- de test de la CI e2e ou un nouvel environnement, garde ces policies. Comme
-- les policies permissives s'additionnent, la plus large l'emporte : les
-- contrôles d'organisation posés par le rattrapage sont sans effet.
--
-- Mesuré sur une base reconstruite, avant ce fichier, avec
-- supabase/tests/rls_two_orgs_audit.sql : un membre de l'organisation B écrit
-- une note et une ligne d'ATS portant l'organisation A, crée une invitation de
-- mission sur un projet de A, et la lecture des invitations échoue sur
-- « permission denied for table users ».
--
-- Chaque instruction est un DROP POLICY IF EXISTS : sans effet en production,
-- où ces noms n'existent pas. Idempotente, rejouable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- candidate_notes (SEC-001, volet écriture)
-- created_by seul n'empêche pas d'écrire une ligne portant une autre
-- organisation. Couvert par « Org members can create candidate notes »
-- (organisation de l'utilisateur) et mission_team_insert (équipe et
-- organisation de la ligne).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create their own notes" ON public.candidate_notes;

-- ---------------------------------------------------------------------
-- job_candidate_status (SEC-009)
-- Même défaut sur les trois écritures, plus deux policies d'équipe de
-- mission sans contrôle de l'organisation de la ligne. Couvert par
-- mission_team_insert (qui compare organization_id à celle du projet),
-- mission_team_update et les policies « Org members can … ».
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create their own candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Users can update their own candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Users can delete their own candidate statuses" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Mission team can manage project candidates" ON public.job_candidate_status;
DROP POLICY IF EXISTS "Mission team can update project candidates" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_insert_candidates" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_update_candidates" ON public.job_candidate_status;

-- ---------------------------------------------------------------------
-- candidate_comments (SEC-009)
-- La mise à jour par l'auteur ne vérifiait pas l'organisation de la ligne.
-- Couvert par authors_update, qui la vérifie côté WITH CHECK.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Authors can update their comments" ON public.candidate_comments;

-- ---------------------------------------------------------------------
-- mission_invitations (SEC-003)
-- La policy FOR ALL sans WITH CHECK autorisait une invitation portant
-- l'organisation de l'invitant sur le projet d'une autre organisation.
-- Couvert par org_members_manage, qui compare l'organisation du projet à
-- celle de la ligne.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "mission_invitations_manage" ON public.mission_invitations;

-- ---------------------------------------------------------------------
-- organization_invitations (BUG-002, SEC-034)
-- La policy lisait auth.users, table sur laquelle le rôle authenticated n'a
-- aucun droit : toute lecture de la table levait « permission denied for
-- table users ». Couvert par invitee_read_jwt, qui lit l'adresse dans le
-- jeton.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Invitees can view their own invitations" ON public.organization_invitations;
