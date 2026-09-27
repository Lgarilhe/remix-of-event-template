-- =====================================================================
-- Séquences : un candidat effacé (RGPD) ne peut plus être repris, y
-- compris par une écriture directe dans l'API (D5).
--
-- Relevé par e2e/api/seq-actions-2.spec.ts (reprise-directe-rgpd-sans-garde) :
-- la policy org_members_update laissait le propriétaire repasser en
-- « active » l'inscription arrêtée d'un candidat effacé. Le moteur ne lui
-- envoie plus rien (il la ré-arrête au cycle suivant), mais la base doit
-- refuser la reprise elle-même.
--
-- 1. sequence_enrollments : pour un utilisateur connecté, une inscription
--    qui porte tracking_data.gdpr_erased_at ne change plus de statut et ne
--    perd pas ce marqueur. Les chemins serveur (service_role : moteur,
--    effacement, reprise serveur qui refuse déjà ce cas) ne sont pas visés.
-- 2. sequence_step_executions : l'exécution annulée par l'effacement est la
--    trace que lit isGdprErasedEnrollment pour les effacements anciens ; un
--    utilisateur connecté ne peut plus la modifier.
--
-- Rejouable sur une base vide : les deux tables et la fonction de garde des
-- exécutions existent à ce point de la chaîne (20260925163421).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sequence_enrollments_gdpr_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.tracking_data, '{}'::jsonb) ? 'gdpr_erased_at'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR COALESCE(NEW.tracking_data, '{}'::jsonb) -> 'gdpr_erased_at'
             IS DISTINCT FROM OLD.tracking_data -> 'gdpr_erased_at') THEN
    RAISE EXCEPTION 'Les données de ce candidat ont été effacées : son inscription ne peut plus être reprise'
      USING ERRCODE = '42501', HINT = 'ENROLLMENT_GDPR_ERASED';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_enrollments_gdpr_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_enrollments_gdpr_guard ON public.sequence_enrollments;
CREATE TRIGGER sequence_enrollments_gdpr_guard
  BEFORE UPDATE ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sequence_enrollments_gdpr_guard();

-- 2. Même corps que 20260925163421 §3e, plus le gel de la trace d'effacement.
CREATE OR REPLACE FUNCTION public.sequence_step_executions_client_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
     OR NEW.step_id IS DISTINCT FROM OLD.step_id
     OR NEW.step_order IS DISTINCT FROM OLD.step_order
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.tracking_data IS DISTINCT FROM OLD.tracking_data THEN
    RAISE EXCEPTION 'Cette étape ne peut pas être rattachée à un autre candidat ni à une autre séquence'
      USING ERRCODE = '42501', HINT = 'EXECUTION_IMMUTABLE';
  END IF;

  IF OLD.status IN ('sending', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'skipped') THEN
    RAISE EXCEPTION 'Cette étape est déjà envoyée, en cours d''envoi ou sautée : elle ne peut plus être modifiée'
      USING ERRCODE = '42501', HINT = 'EXECUTION_ALREADY_DONE';
  END IF;

  -- GDPR_ERASURE_SKIP_REASON de _shared/get-or-fetch-contact.ts.
  IF OLD.status = 'cancelled'
     AND OLD.skip_reason = 'Effacement des données demandé : séquence arrêtée' THEN
    RAISE EXCEPTION 'Les données de ce candidat ont été effacées : cette étape ne peut plus être modifiée'
      USING ERRCODE = '42501', HINT = 'ENROLLMENT_GDPR_ERASED';
  END IF;

  IF (NEW.final_message IS DISTINCT FROM OLD.final_message
      OR NEW.final_subject IS DISTINCT FROM OLD.final_subject)
     AND OLD.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Seul un message encore programmé peut être modifié'
      USING ERRCODE = '42501', HINT = 'EXECUTION_NOT_SCHEDULED';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_step_executions_client_guard() FROM PUBLIC, anon, authenticated;
