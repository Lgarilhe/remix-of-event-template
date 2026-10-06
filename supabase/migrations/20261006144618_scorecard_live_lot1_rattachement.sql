-- =====================================================================
-- Refonte scorecard et assistant d'entretien en direct, lot 1 :
-- rattachement des grilles et des séances à la mission et à l'étape,
-- séance liée à son événement, consentement et expiration de la transcription.
--
--  1. candidate_evaluations : project_id et process_step_id. Une grille se
--     rattache à une mission et à une étape d'entretien de cette mission.
--  2. Reprise des lignes existantes : mission déduite du job_id, avis du
--     portail client rangés sous l'identifiant du candidat (ils portaient
--     l'identifiant de la ligne job_candidate_status).
--  3. call_coaching_sessions : mission, étape, grille et événement de la
--     séance ; consentement du candidat ; expiration de la transcription
--     (90 jours après la création, purge au lot 6).
--  4. Droits. Un auteur seul écrit sa grille et sa séance (policies
--     RESTRICTIVE : les policies permissives par organisation, héritées de la
--     base neuve comme de la production, laissaient tout membre modifier ou
--     supprimer la grille d'un collègue, et fixer created_by à sa guise).
--     Lecture inchangée : toute l'organisation. Une mission, une étape, une
--     grille ou un événement liés doivent être ceux de l'organisation de la
--     ligne, l'étape ceux de la mission.
--  5. Expiration et consentement posés par le serveur : un utilisateur ne
--     prolonge pas la conservation de sa transcription et ne choisit pas
--     l'instant de son consentement.
--  6. client_portal_candidate_profile_id : identifiant du profil d'un candidat
--     visible du portail, pour que l'avis du client s'écrive sous le même
--     identifiant que la grille d'un recruteur. Fonction à part : la liste de
--     client_portal_candidates part telle quelle au navigateur du client, qui
--     n'a pas à recevoir l'identifiant LinkedIn d'un candidat anonymisé.
--
-- Rejoue sur base vide comme sur la production (CLAUDE.md, règles 6 et 7) :
-- colonnes et index en IF NOT EXISTS, reprises idempotentes, policies
-- retirées puis recréées, et aucun nom de policy de la production supposé
-- (ces policies sont RESTRICTIVE, donc valables quelles que soient les
-- permissives qui survivent).
-- Audit (base neuve, CI e2e) : supabase/tests/scorecard_live_lot1_audit.sql.
-- =====================================================================


-- =====================================================================
-- 1. candidate_evaluations : mission et étape
-- ON DELETE SET NULL : supprimer une mission ou une étape ne supprime pas
-- l'avis d'un recruteur sur un candidat.
-- =====================================================================
ALTER TABLE public.candidate_evaluations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS process_step_id uuid REFERENCES public.mission_process_steps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_evaluations_project_candidate
  ON public.candidate_evaluations (project_id, candidate_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_evaluations_process_step
  ON public.candidate_evaluations (process_step_id)
  WHERE process_step_id IS NOT NULL;

COMMENT ON COLUMN public.candidate_evaluations.project_id IS
  'Mission de la grille (sourcing_projects.id). NULL pour une grille hors mission, ou dont la mission n''a pas pu être déduite du job_id.';
COMMENT ON COLUMN public.candidate_evaluations.process_step_id IS
  'Étape d''entretien de la mission (mission_process_steps.id) que la grille évalue. NULL pour les grilles d''avant le rattachement : aucune étape ne peut être déduite de interview_stage, qui est un libellé libre.';
COMMENT ON COLUMN public.candidate_evaluations.candidate_id IS
  'Identifiant du candidat tel que le porte job_candidate_status.candidate_id (id du profil), jamais l''id d''une ligne job_candidate_status.';


-- =====================================================================
-- 2. Reprise des lignes existantes
-- =====================================================================

-- 2-a. Avis du portail client : candidate_id valait l'identifiant de la ligne
-- job_candidate_status (celui que renvoie client_portal_candidates). La grille
-- d'un recruteur, la fiche et l'assistant cherchent par job_candidate_status
-- .candidate_id : ces avis n'étaient relus par personne. Seuls les avis du
-- portail portent l'auteur nul. Idempotent : une fois corrigé, candidate_id ne
-- correspond plus à un id de ligne.
UPDATE public.candidate_evaluations ce
SET candidate_id = jcs.candidate_id,
    project_id = coalesce(ce.project_id, jcs.project_id)
FROM public.job_candidate_status jcs
WHERE ce.created_by = '00000000-0000-0000-0000-000000000000'::uuid
  AND ce.candidate_id = jcs.id::text
  AND jcs.organization_id = ce.organization_id;

-- 2-b. Mission déduite du job_id : « project:{uuid} » ou l'id seul d'une mission,
-- sinon le job_id externe d'une ancienne mission. Même résolution que
-- ScorecardTab.buildJobContext. Une ligne dont le job_id désigne plusieurs
-- missions de l'organisation reste sans mission : rien n'est deviné.
UPDATE public.candidate_evaluations ce
SET project_id = m.project_id
FROM (
  SELECT e.id AS evaluation_id, (array_agg(sp.id))[1] AS project_id
  FROM public.candidate_evaluations e
  JOIN public.sourcing_projects sp
    ON sp.organization_id = e.organization_id
   AND (sp.id::text = regexp_replace(e.job_id, '^project:', '')
        OR sp.job_id = e.job_id)
  WHERE e.project_id IS NULL
    AND e.organization_id IS NOT NULL
    AND coalesce(e.job_id, '') <> ''
  GROUP BY e.id
  HAVING count(DISTINCT sp.id) = 1
) m
WHERE ce.id = m.evaluation_id
  AND ce.project_id IS NULL;


-- =====================================================================
-- 3. call_coaching_sessions : mission, étape, grille, événement, conservation
-- =====================================================================
ALTER TABLE public.call_coaching_sessions
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS process_step_id uuid REFERENCES public.mission_process_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evaluation_id uuid REFERENCES public.candidate_evaluations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qualification_session_id uuid REFERENCES public.qualification_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS candidate_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcript_purged_at timestamptz;

-- L'expiration des séances déjà présentes part de leur création : une séance de
-- plus de 90 jours est échue dès la migration. Le bloc ne s'exécute que si la
-- colonne n'existe pas encore, pour qu'un rejeu ne repousse aucune échéance.
DO $lot1_expiry$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'call_coaching_sessions'
      AND column_name = 'transcript_expires_at'
  ) THEN
    ALTER TABLE public.call_coaching_sessions
      ADD COLUMN transcript_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days');
    UPDATE public.call_coaching_sessions
    SET transcript_expires_at = coalesce(created_at, now()) + interval '90 days';
  END IF;
END
$lot1_expiry$;

CREATE INDEX IF NOT EXISTS idx_coaching_sessions_project
  ON public.call_coaching_sessions (project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_evaluation
  ON public.call_coaching_sessions (evaluation_id)
  WHERE evaluation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_qualification
  ON public.call_coaching_sessions (qualification_session_id)
  WHERE qualification_session_id IS NOT NULL;
-- Purge de la transcription (lot 6) : les séances échues dont le texte est encore là.
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_transcript_expiry
  ON public.call_coaching_sessions (transcript_expires_at)
  WHERE transcript_purged_at IS NULL;

COMMENT ON COLUMN public.call_coaching_sessions.project_id IS
  'Mission de la séance. Doit être une mission de l''organisation de la ligne (policy mission_same_org_*).';
COMMENT ON COLUMN public.call_coaching_sessions.process_step_id IS
  'Étape d''entretien de la mission que la séance couvre. Exige project_id, et une étape de cette mission.';
COMMENT ON COLUMN public.call_coaching_sessions.evaluation_id IS
  'Grille (candidate_evaluations.id) alimentée par la séance. Remplace à terme scorecard_id, texte sans clé étrangère qui valait « new » avant la création de la grille.';
COMMENT ON COLUMN public.call_coaching_sessions.qualification_session_id IS
  'Événement d''entretien (qualification_sessions.id) depuis lequel la séance a été lancée, quand elle l''a été depuis le calendrier.';
COMMENT ON COLUMN public.call_coaching_sessions.candidate_consent_at IS
  'Instant où le recruteur a déclaré le candidat informé de la transcription. Posé par le serveur au premier enregistrement, jamais modifiable ensuite. NULL : aucun consentement déclaré (séances d''avant le lot 4 comprises).';
COMMENT ON COLUMN public.call_coaching_sessions.transcript_expires_at IS
  'Fin de conservation de la transcription : 90 jours après la création de la séance. Posée par le serveur, jamais modifiable par un utilisateur connecté. La purge (lot 6) vide transcript et renseigne transcript_purged_at ; le compte rendu reste.';
COMMENT ON COLUMN public.call_coaching_sessions.transcript_purged_at IS
  'Instant où la transcription a été vidée à l''expiration. Posé par la purge (clé de service), jamais par un utilisateur connecté.';


-- =====================================================================
-- 4. Droits : auteur seul en écriture, rattachements dans l'organisation
-- Policies RESTRICTIVE : elles s'ajoutent (AND) aux permissives par
-- organisation, quels que soient les noms et le nombre de ces dernières.
-- La clé de service les contourne, comme toute policy.
-- =====================================================================

-- 4-a. candidate_evaluations
DROP POLICY IF EXISTS evaluations_author_insert ON public.candidate_evaluations;
CREATE POLICY evaluations_author_insert ON public.candidate_evaluations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS evaluations_author_update ON public.candidate_evaluations;
CREATE POLICY evaluations_author_update ON public.candidate_evaluations
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS evaluations_author_delete ON public.candidate_evaluations;
CREATE POLICY evaluations_author_delete ON public.candidate_evaluations
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS mission_same_org_insert ON public.candidate_evaluations;
CREATE POLICY mission_same_org_insert ON public.candidate_evaluations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (project_id IS NULL OR public.project_organization_id(project_id) = organization_id)
    AND (process_step_id IS NULL OR EXISTS (
      SELECT 1 FROM public.mission_process_steps s
      WHERE s.id = candidate_evaluations.process_step_id
        AND s.project_id = candidate_evaluations.project_id))
  );

DROP POLICY IF EXISTS mission_same_org_update ON public.candidate_evaluations;
CREATE POLICY mission_same_org_update ON public.candidate_evaluations
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    (project_id IS NULL OR public.project_organization_id(project_id) = organization_id)
    AND (process_step_id IS NULL OR EXISTS (
      SELECT 1 FROM public.mission_process_steps s
      WHERE s.id = candidate_evaluations.process_step_id
        AND s.project_id = candidate_evaluations.project_id))
  );

-- 4-b. call_coaching_sessions
DROP POLICY IF EXISTS coaching_author_insert ON public.call_coaching_sessions;
CREATE POLICY coaching_author_insert ON public.call_coaching_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS coaching_author_update ON public.call_coaching_sessions;
CREATE POLICY coaching_author_update ON public.call_coaching_sessions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS coaching_author_delete ON public.call_coaching_sessions;
CREATE POLICY coaching_author_delete ON public.call_coaching_sessions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS mission_same_org_insert ON public.call_coaching_sessions;
CREATE POLICY mission_same_org_insert ON public.call_coaching_sessions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (project_id IS NULL OR public.project_organization_id(project_id) = organization_id)
    AND (process_step_id IS NULL OR EXISTS (
      SELECT 1 FROM public.mission_process_steps s
      WHERE s.id = call_coaching_sessions.process_step_id
        AND s.project_id = call_coaching_sessions.project_id))
    AND (evaluation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.candidate_evaluations e
      WHERE e.id = call_coaching_sessions.evaluation_id
        AND e.organization_id = call_coaching_sessions.organization_id))
    AND (qualification_session_id IS NULL OR EXISTS (
      SELECT 1 FROM public.qualification_sessions q
      WHERE q.id = call_coaching_sessions.qualification_session_id
        AND q.organization_id = call_coaching_sessions.organization_id))
  );

DROP POLICY IF EXISTS mission_same_org_update ON public.call_coaching_sessions;
CREATE POLICY mission_same_org_update ON public.call_coaching_sessions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    (project_id IS NULL OR public.project_organization_id(project_id) = organization_id)
    AND (process_step_id IS NULL OR EXISTS (
      SELECT 1 FROM public.mission_process_steps s
      WHERE s.id = call_coaching_sessions.process_step_id
        AND s.project_id = call_coaching_sessions.project_id))
    AND (evaluation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.candidate_evaluations e
      WHERE e.id = call_coaching_sessions.evaluation_id
        AND e.organization_id = call_coaching_sessions.organization_id))
    AND (qualification_session_id IS NULL OR EXISTS (
      SELECT 1 FROM public.qualification_sessions q
      WHERE q.id = call_coaching_sessions.qualification_session_id
        AND q.organization_id = call_coaching_sessions.organization_id))
  );


-- =====================================================================
-- 5. Expiration et consentement posés par le serveur
-- Pour un utilisateur connecté (rôle authenticated ou anon), l'insertion fixe
-- l'expiration à 90 jours et ignore toute purge annoncée ; la mise à jour
-- garde les valeurs d'origine. Le consentement reçoit l'instant du serveur
-- au premier enregistrement, puis ne change plus. La clé de service et les
-- contextes sans jeton (migration, psql, cron de purge) écrivent librement.
-- Fonction SECURITY INVOKER : current_user est le rôle de la session.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.call_coaching_sessions_retention_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.transcript_expires_at := now() + interval '90 days';
    NEW.transcript_purged_at := NULL;
    IF NEW.candidate_consent_at IS NOT NULL THEN
      NEW.candidate_consent_at := now();
    END IF;
  ELSE
    NEW.transcript_expires_at := OLD.transcript_expires_at;
    NEW.transcript_purged_at := OLD.transcript_purged_at;
    IF OLD.candidate_consent_at IS NOT NULL THEN
      NEW.candidate_consent_at := OLD.candidate_consent_at;
    ELSIF NEW.candidate_consent_at IS NOT NULL THEN
      NEW.candidate_consent_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS call_coaching_sessions_retention_guard ON public.call_coaching_sessions;
CREATE TRIGGER call_coaching_sessions_retention_guard
  BEFORE INSERT OR UPDATE ON public.call_coaching_sessions
  FOR EACH ROW EXECUTE FUNCTION public.call_coaching_sessions_retention_guard();


-- =====================================================================
-- 6. Identifiant du profil d'un candidat visible du portail
-- Passe par client_portal_candidates : la règle de visibilité (lien non échu,
-- missions et organisation du lien, retenus ou au-delà) reste écrite à un
-- seul endroit. Rend NULL pour une ligne non visible, un lien échu ou inconnu.
-- SECURITY INVOKER, réservée à service_role comme client_portal_candidates
-- (edge function client-portal-data).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.client_portal_candidate_profile_id(p_token text, p_row_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT j.candidate_id
    FROM public.client_portal_candidates(p_token) c
    JOIN public.job_candidate_status j ON j.id = c.id
   WHERE c.id = p_row_id
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) IS
  'Identifiant du profil (job_candidate_status.candidate_id) d''une ligne visible du portail client, ou NULL. Sous cet identifiant s''écrit l''avis du client. Réservée à service_role (edge function client-portal-data) : ne jamais renvoyer ce résultat au navigateur du client, il identifie un candidat anonymisé.';

REVOKE ALL ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) TO service_role;
