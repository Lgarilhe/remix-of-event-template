-- ====================================================================
-- SECURITY : supprimer les overloads obsolètes de get_vivier_contacts/companies
--
-- Finding e2e 2026-06-11 : ces fonctions ont été redéfinies plusieurs fois
-- avec des signatures DIFFÉRENTES (ajout de filtres) sans dropper les
-- anciennes → plusieurs overloads coexistent en base :
--   get_vivier_contacts : 9, 15, 20 params
--   get_vivier_companies : 9, 12, 16 params
-- Le garde "agency-only" (#207, 20260610130000) n'a été appliqué QUE sur la
-- dernière signature (20 / 16 params). Les overloads plus anciens restaient
-- exécutables par `authenticated` SANS garde → un user d'org enterprise
-- pouvait lire le vivier via une vieille signature (contournement du garde).
-- (Symptôme : PostgREST renvoie 300 Multiple Choices sur un appel ambigu.)
--
-- Fix : ne garder QUE la signature canonique gardée (celle avec le plus de
-- paramètres), dropper toutes les autres. Idempotent.
-- ====================================================================

DO $$
DECLARE
  target record;
  rec record;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('get_vivier_contacts', 20),
    ('get_vivier_companies', 16)
  ) AS t(fn, keep_args) LOOP
    FOR rec IN
      SELECT p.oid::regprocedure AS sig, p.pronargs
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = target.fn
    LOOP
      IF rec.pronargs <> target.keep_args THEN
        EXECUTE format('DROP FUNCTION IF EXISTS %s', rec.sig);
        RAISE NOTICE 'Dropped stale overload %', rec.sig;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Réaffirme la politique de grants sur la signature conservée (révoquée pour
-- les clients par 20260610120000/140000, gardée pour authenticated via la
-- garde agency-only interne).
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_vivier_contacts', 'get_vivier_companies')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', rec.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', rec.sig);
  END LOOP;
END $$;
