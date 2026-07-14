-- ====================================================================
-- SECURITY FIX (audit équipe/rôles 2026-07-14, risque #4 moyen)
--
-- profiles : la policy UPDATE "Users can update their own profile"
-- (USING auth.uid() = user_id, sans restriction de colonnes) permet à un
-- utilisateur de falsifier ses statistiques de réputation marketplace
-- (rating, placements_count, first_round_rate, mid_round_rate,
-- avg_time_to_fill_days, testimonials — affichées sur la page publique
-- RecruiterPublicProfile et utilisées pour le hunt mode).
--
-- La RLS ne sait pas restreindre des colonnes → trigger BEFORE UPDATE.
-- Le frontend ne fait que LIRE ces colonnes (vérifié : aucun .update()
-- client ne les touche) ; les écritures légitimes passent par des edge
-- functions en service_role, qui bypass le trigger.
--
-- Idempotente, rejouable.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_reputation_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- service_role (edge functions, backfills, crons) : passage libre.
  -- Double source comme enforce_role_hierarchy (auth.role() + claim brut).
  IF auth.role() = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.placements_count IS DISTINCT FROM OLD.placements_count
     OR NEW.avg_time_to_fill_days IS DISTINCT FROM OLD.avg_time_to_fill_days
     OR NEW.first_round_rate IS DISTINCT FROM OLD.first_round_rate
     OR NEW.mid_round_rate IS DISTINCT FROM OLD.mid_round_rate
     OR NEW.testimonials IS DISTINCT FROM OLD.testimonials THEN
    RAISE EXCEPTION 'Les statistiques de réputation ne sont pas modifiables directement';
  END IF;

  RETURN NEW;
END;
$$;

-- Fonction interne : pas d'EXECUTE client (appelée uniquement par le trigger).
REVOKE EXECUTE ON FUNCTION public.protect_profile_reputation_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_reputation ON public.profiles;
CREATE TRIGGER protect_profile_reputation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_reputation_columns();
