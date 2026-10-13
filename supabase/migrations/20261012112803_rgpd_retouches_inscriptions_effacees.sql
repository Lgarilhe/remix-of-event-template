-- =====================================================================
-- RGPD : retouches de messages des candidats déjà effacés (décision du
-- propriétaire du 12/10/2026).
--
-- Pourquoi : tracking_data.message_overrides garde, par étape, le texte
-- retouché pour un candidat à son inscription (nom, parcours, entreprise) :
-- des données personnelles. Depuis le 11/10/2026, l'effacement d'un candidat
-- les retire de ses inscriptions (recordGdprErasure, étape 7 bis,
-- supabase/functions/_shared/get-or-fetch-contact.ts). Les effacements faits
-- avant cette date les ont gardés. Ce rattrapage les retire de toute
-- inscription qui porte le marqueur d'effacement tracking_data.gdpr_erased_at,
-- posé par chaque effacement sur les inscriptions trouvées.
--
-- Marqueur : présent et non vide, la même lecture que le moteur
-- (isGdprErasedEnrollment) et que la garde d'inscription
-- sequence_enrollments_gdpr_insert_guard (20260928140417) : un marqueur null,
-- false ou "" n'est pas un effacement, l'inscription garde ses retouches.
--
-- Seule la clé message_overrides part : le marqueur, le statut et les autres
-- marqueurs relus par les contrôles (completion_reason, manual_stop) restent.
--
-- Déclencheurs de sequence_enrollments sur UPDATE, la migration tournant sans
-- jeton :
--   - sequence_enrollments_gdpr_guard (BEFORE UPDATE) : ne vise qu'un jeton
--     authenticated, et ni le statut ni le marqueur ne changent ici ;
--   - mission_conversations_gdpr_erase (AFTER UPDATE OF tracking_data) : ne
--     s'exécute que si le marqueur apparaît ; il est déjà là, aucun lien
--     conversation-mission n'est touché ;
--   - gardes UPDATE OF status, sequence_id, organization_id, account_id,
--     created_by ou assigned_sender_id : colonnes non écrites, non exécutées ;
--   - update_sequence_enrollments_updated_at (BEFORE UPDATE) : avancerait
--     updated_at, qui date la purge des inscriptions closes (rgpd-purge,
--     étape 4, 24 mois) et repousserait de deux ans celle de ces inscriptions
--     effacées. Désactivé le temps de la mise à jour s'il était actif, puis
--     réactivé, comme les reprises de données de 20260929112827.
--
-- Rejouable : une seconde passe ne trouve plus aucune ligne. Base vide : la
-- table et le déclencheur existent depuis 20260128174745, la mise à jour ne
-- touche aucune ligne.
-- =====================================================================

DO $rgpd_retouches$
DECLARE
  v_upd "char";
BEGIN
  SELECT t.tgenabled INTO v_upd FROM pg_trigger t
   WHERE t.tgrelid = 'public.sequence_enrollments'::regclass
     AND t.tgname = 'update_sequence_enrollments_updated_at';
  IF v_upd = 'O' THEN
    ALTER TABLE public.sequence_enrollments DISABLE TRIGGER update_sequence_enrollments_updated_at;
  END IF;

  UPDATE public.sequence_enrollments
     SET tracking_data = tracking_data - 'message_overrides'
   WHERE tracking_data ? 'gdpr_erased_at'
     AND tracking_data -> 'gdpr_erased_at' NOT IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb)
     AND tracking_data ? 'message_overrides';

  IF v_upd = 'O' THEN
    ALTER TABLE public.sequence_enrollments ENABLE TRIGGER update_sequence_enrollments_updated_at;
  END IF;
END
$rgpd_retouches$;
