-- Une grille par auteur et entretien, sans réutiliser la dernière grille d'une
-- autre étape. Les anciennes grilles restent détachées : aucun rapprochement
-- par date, nom ou mission ne permet de retrouver leur entretien avec certitude.
ALTER TABLE public.candidate_evaluations
  ADD COLUMN IF NOT EXISTS qualification_session_id uuid
    REFERENCES public.qualification_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preparation_status text,
  ADD COLUMN IF NOT EXISTS preparation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparation_token uuid,
  ADD COLUMN IF NOT EXISTS preparation_error text;

ALTER TABLE public.candidate_evaluations
  DROP CONSTRAINT IF EXISTS candidate_evaluations_preparation_status_check;
ALTER TABLE public.candidate_evaluations
  ADD CONSTRAINT candidate_evaluations_preparation_status_check
  CHECK (preparation_status IS NULL OR preparation_status IN ('preparing', 'ready', 'failed'));

-- L'ordre sert aussi aux recherches et aux suppressions par entretien. Deux
-- recruteurs gardent chacun leur grille ; deux appels simultanés du même
-- auteur ne créent pas deux préparations.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_evaluations_session_author_key
  ON public.candidate_evaluations (qualification_session_id, created_by)
  WHERE qualification_session_id IS NOT NULL;

COMMENT ON COLUMN public.candidate_evaluations.qualification_session_id IS
  'Entretien exact de la grille. NULL pour une grille historique ou un entretien supprimé. Unique par entretien et auteur.';
COMMENT ON COLUMN public.candidate_evaluations.preparation_token IS
  'Jeton serveur de la préparation en cours : protège la finalisation contre un ancien appel ou une reprise concurrente.';

-- SECURITY INVOKER : le navigateur doit pouvoir lire l'entretien via ses
-- droits habituels. Le verrou partage empêche une réaffectation concurrente
-- pendant le rattachement. La clé de service est également validée.
CREATE OR REPLACE FUNCTION public.candidate_evaluation_interview_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  session_row public.qualification_sessions%ROWTYPE;
  finalizing boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    finalizing := OLD.preparation_status = 'preparing' AND NEW.preparation_status = 'ready';
  END IF;
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.preparation_status IS NOT NULL OR NEW.preparation_started_at IS NOT NULL
        OR NEW.preparation_token IS NOT NULL OR NEW.preparation_error IS NOT NULL THEN
        RAISE EXCEPTION 'La préparation est gérée par le serveur.' USING ERRCODE = '42501';
      END IF;
    ELSIF ROW(NEW.preparation_status, NEW.preparation_started_at, NEW.preparation_token, NEW.preparation_error)
      IS DISTINCT FROM ROW(OLD.preparation_status, OLD.preparation_started_at, OLD.preparation_token, OLD.preparation_error) THEN
      RAISE EXCEPTION 'La préparation est gérée par le serveur.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.qualification_session_id IS NULL THEN
    IF finalizing THEN
      RAISE EXCEPTION 'L''entretien de cette préparation est indisponible.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO session_row
    FROM public.qualification_sessions q
    WHERE q.id = NEW.qualification_session_id
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entretien indisponible pour cette grille.' USING ERRCODE = '23514';
  END IF;

  IF session_row.organization_id IS DISTINCT FROM NEW.organization_id
    OR session_row.candidate_profile_id IS DISTINCT FROM NEW.candidate_id
    OR session_row.project_id IS DISTINCT FROM NEW.project_id
    OR (session_row.organization_id IS NULL AND session_row.created_by IS DISTINCT FROM NEW.created_by) THEN
    RAISE EXCEPTION 'La grille ne correspond pas à cet entretien.' USING ERRCODE = '23514';
  END IF;

  -- Le contrôle et l'écriture partagent le verrou de l'entretien : une
  -- annulation ou un changement de recruteur entre la génération et sa
  -- sauvegarde ne peut pas publier le résultat de l'ancienne préparation.
  -- Les avis déjà prêts restent éditables après l'entretien ou sa réaffectation.
  IF finalizing AND (
    session_row.status NOT IN ('scheduled', 'in_progress')
    OR coalesce(session_row.manager_id, session_row.created_by) IS DISTINCT FROM NEW.created_by
  ) THEN
    RAISE EXCEPTION 'L''entretien a changé pendant la préparation.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.candidate_evaluation_interview_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS candidate_evaluation_interview_guard ON public.candidate_evaluations;
CREATE TRIGGER candidate_evaluation_interview_guard
  BEFORE INSERT OR UPDATE ON public.candidate_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.candidate_evaluation_interview_guard();

-- Ne pas transporter les avis d'un candidat vers un autre via une modification
-- de l'événement. Notes, dates, lieu et statut restent modifiables. Supprimer
-- l'entretien détache les grilles sans supprimer leur contenu.
-- La lecture des grilles est ouverte à toute l'organisation (seule l'écriture
-- est bornée à l'auteur). Pour les anciennes lignes sans organisation, le
-- garde ci-dessus impose le même auteur : aucun avis lié ne peut être masqué
-- au propriétaire de l'entretien par la RLS.
CREATE OR REPLACE FUNCTION public.qualification_scorecard_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF ROW(NEW.organization_id, NEW.candidate_profile_id, NEW.project_id)
    IS NOT DISTINCT FROM ROW(OLD.organization_id, OLD.candidate_profile_id, OLD.project_id) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.candidate_evaluations e WHERE e.qualification_session_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Un entretien avec une grille ne peut pas être réaffecté.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qualification_scorecard_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS qualification_scorecard_identity_guard ON public.qualification_sessions;
CREATE TRIGGER qualification_scorecard_identity_guard
  BEFORE UPDATE OF organization_id, candidate_profile_id, project_id ON public.qualification_sessions
  FOR EACH ROW EXECUTE FUNCTION public.qualification_scorecard_identity_guard();

NOTIFY pgrst, 'reload schema';
