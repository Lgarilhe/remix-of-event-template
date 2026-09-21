-- Incident du 2026-09-21 : PostgREST ne charge plus son cache de schéma.
--
-- Chronologie relevée dans les journaux. Avant 14 h 25 : aucun échec. À partir
-- de 14 h 30, juste après l'application de 20260909183436, la requête
-- d'inventaire du schéma est annulée à répétition (« canceling statement due to
-- statement timeout », code 57014), PostgREST redémarre trois à cinq fois par
-- tranche de cinq minutes et ne sert plus rien. Côté navigateur, cela donne un
-- chargement sans fin puis « upstream request timeout ».
--
-- Le rôle authenticator, sous lequel tourne cet inventaire, a un budget de huit
-- secondes par requête. L'inventaire résout les colonnes source de chaque vue en
-- remontant pg_depend ; les deux vues de mesure ajoutées ce jour-là sont
-- coûteuses à ce jeu-là, l'une par ses deux jointures latérales sur
-- jsonb_array_elements, l'autre par ses trois expressions communes et ses
-- fonctions de fenêtrage. Le budget a été franchi.
--
-- Deux gestes, chacun suffisant seul, appliqués ensemble pour rétablir le
-- service d'un coup.
--
--   1. Les deux vues sortent du schéma exposé. Elles ne servent qu'au
--      diagnostic, ne sont lisibles que par le service role, et ne sont jamais
--      appelées par l'application : PostgREST n'a aucune raison de les
--      inventorier. Elles restent interrogeables à l'identique, sous le
--      préfixe mesure.
--   2. Le budget de l'inventaire passe à trente secondes. Il ne concerne que
--      authenticator, donc ni les requêtes des utilisateurs connectés (qui
--      gardent leurs huit secondes) ni celles des visiteurs anonymes (trois
--      secondes). C'est le réglage que documente Supabase pour un schéma
--      devenu grand, et il laisse de la marge avant le prochain ajout.
--
-- Idempotente, rejouable.

-- ─── 1. Un schéma pour la mesure, hors du périmètre exposé ───
CREATE SCHEMA IF NOT EXISTS mesure;

COMMENT ON SCHEMA mesure IS
  'Vues de diagnostic, hors du schéma exposé par l''API. Rien ici n''est appelé par l''application : ces objets servent à lire des coûts, et les sortir de public évite d''alourdir l''inventaire de schéma de PostgREST.';

REVOKE ALL ON SCHEMA mesure FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mesure TO service_role;

-- ─── 2. Les deux vues quittent public ───
-- Trois états possibles, et un seul geste dans chacun : déplacer si la vue est
-- encore dans public et absente de mesure ; retirer la copie restée dans public
-- si les deux existent ; ne rien faire si le déplacement a déjà eu lieu.
-- Un DROP inconditionnel sur la cible détruirait la vue au rejeu.
DO $$
DECLARE
  v_nom text;
BEGIN
  FOREACH v_nom IN ARRAY ARRAY['base_konekt_call_cost', 'base_konekt_provider_cost']
  LOOP
    IF to_regclass('public.' || v_nom) IS NOT NULL THEN
      IF to_regclass('mesure.' || v_nom) IS NULL THEN
        EXECUTE format('ALTER VIEW public.%I SET SCHEMA mesure', v_nom);
      ELSE
        EXECUTE format('DROP VIEW public.%I', v_nom);
      END IF;
    END IF;
  END LOOP;
END
$$;

-- Les privilèges suivent la vue, on les repose par sécurité après un rejeu.
DO $$
BEGIN
  IF to_regclass('mesure.base_konekt_call_cost') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON mesure.base_konekt_call_cost FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON mesure.base_konekt_call_cost TO service_role';
  END IF;
  IF to_regclass('mesure.base_konekt_provider_cost') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON mesure.base_konekt_provider_cost FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON mesure.base_konekt_provider_cost TO service_role';
  END IF;
END
$$;

-- ─── 3. De la marge pour l'inventaire de schéma ───
-- lock_timeout reste à huit secondes : une migration bloquée doit toujours
-- rendre la main vite.
ALTER ROLE authenticator SET statement_timeout = '30s';

-- ─── 4. Demander le rechargement immédiat ───
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
