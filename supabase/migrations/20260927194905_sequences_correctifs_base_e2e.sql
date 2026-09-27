-- =====================================================================
-- Séquences et actions de l'assistant : correctifs de base relevés par les
-- tests de bout en bout du 2026-09-27 (lot « db »).
--
-- Rejouable sur une base vide (CI e2e) comme en prod : chaque objet visé
-- existe déjà à ce point de la chaîne ; DROP ... IF EXISTS partout.
--
-- 1. SEQ-043  sequence_enrollments : la garde « chacun envoie depuis son
--             propre compte relié » (déclencheur de B6, à l'insertion) vaut
--             aussi pour un changement de compte (account_id) ou d'auteur
--             (created_by) d'une inscription existante. Même fonction, même
--             refus (42501, HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER). La clause
--             WHEN ne la déclenche que si l'une des deux valeurs change : une
--             mise à jour ordinaire (statut, pause, suivi) d'une inscription
--             héritée déjà posée sur le compte d'un collègue reste possible.
-- 2. sequence_templates, sequence_snippets : created_by référençait
--             profiles(id) sur une base construite depuis les migrations, alors
--             que le front écrit l'identifiant auth.users (« Enregistrer comme
--             modèle » refusé, 23503). La prod (MIGRATION_CLEAN.sql) n'a pas
--             de clé étrangère sur ces colonnes : on s'aligne sur elle.
-- 3. SEQ-114 / BUG-016  agent_tool_executions : executed_at est le verrou de
--             réservation du cron et de l'exécution directe. Le client ne
--             pouvait pas le poser, mais pouvait l'effacer : une réservation
--             interrompue ou en cours redevenait exécutable et partait une
--             seconde fois. Seule la remise en attente d'un échec
--             (failed → proposed, bouton « Relancer ») l'efface encore.
-- 4. D3 / SEQ-119  agent_tool_executions, lecture : chacun ses propres
--             lignes ; propriétaire et administrateur voient toute
--             l'organisation (portée « Toute l'organisation » du journal et
--             de l'outil de l'assistant). Un collaborateur ne lit plus en
--             clair le résultat d'une lecture d'un collègue (inscriptions,
--             analyses, fil LinkedIn).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SEQ-043 : changement de compte ou d'auteur d'une inscription
--    Nom trié après sequence_enrollments_check_org (ordre alphabétique des
--    déclencheurs), qui refuse déjà un changement d'organisation.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS sequence_enrollments_check_sender_owner_update ON public.sequence_enrollments;
CREATE TRIGGER sequence_enrollments_check_sender_owner_update
  BEFORE UPDATE OF account_id, created_by ON public.sequence_enrollments
  FOR EACH ROW
  WHEN (OLD.account_id IS DISTINCT FROM NEW.account_id
        OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION public.sequence_enrollments_check_sender_owner();

-- ---------------------------------------------------------------------
-- 2. created_by des modèles et des extraits : identifiant auth.users
-- ---------------------------------------------------------------------
ALTER TABLE public.sequence_templates DROP CONSTRAINT IF EXISTS sequence_templates_created_by_fkey;
ALTER TABLE public.sequence_snippets DROP CONSTRAINT IF EXISTS sequence_snippets_created_by_fkey;

-- ---------------------------------------------------------------------
-- 3. agent_tool_executions : executed_at jamais effacé hors relance d'un échec
--    Corps repris de 20260903074500 (§ 8) ; seul le contrôle de executed_at
--    change.
-- ---------------------------------------------------------------------
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

  -- Verrou de réservation : l'effacer rendrait la ligne de nouveau exécutable
  -- (cron, approbation) alors que l'envoi a pu partir.
  IF NEW.executed_at IS DISTINCT FROM OLD.executed_at
     AND NOT (OLD.status = 'failed' AND NEW.status = 'proposed' AND NEW.executed_at IS NULL) THEN
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

-- ---------------------------------------------------------------------
-- 4. agent_tool_executions : lecture de ses propres lignes, organisation
--    entière pour le propriétaire et l'administrateur
--    Toute policy de lecture existante est retirée (une policy permissive
--    restée à côté annulerait la restriction) ; l'écriture ne change pas.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_tool_executions' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.agent_tool_executions', r.policyname);
  END LOOP;
END $$;

CREATE POLICY org_members_select ON public.agent_tool_executions
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
    )
  );

-- Aucune policy « ALL » ouverte aux utilisateurs connectés ne doit subsister :
-- elle rouvrirait la lecture de toute l'organisation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_tool_executions'
      AND cmd = 'ALL' AND permissive = 'PERMISSIVE'
      AND (roles && ARRAY['authenticated', 'public']::name[])
  ) THEN
    RAISE EXCEPTION 'agent_tool_executions : une policy ALL permissive ouverte aux utilisateurs connectés subsiste';
  END IF;
END $$;
