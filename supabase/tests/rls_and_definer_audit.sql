-- =====================================================================
-- Audit générique du schéma public (lot C1, R13).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite depuis les migrations (jamais en prod) :
--   BEGIN; \i supabase/tests/rls_and_definer_audit.sql; ROLLBACK;
-- À rejouer aussi sur une copie de la production avant chaque lot de
-- droits : la production vient de MIGRATION_CLEAN.sql, pas des migrations.
--
-- Quatre contrôles, sur les catalogues seulement :
--   1. toute table du schéma public a la RLS activée ;
--   2. aucune relation du schéma public n'est lisible par anon (droit SELECT
--      sur la table ou sur une colonne) hors de la liste blanche, et une
--      table de la liste blanche a la RLS et une policy de lecture qui
--      s'applique à anon ;
--   3. aucune fonction SECURITY DEFINER du schéma public n'est exécutable par
--      PUBLIC, ni par anon hors de la liste blanche, tenue par signature
--      (une nouvelle surcharge d'un nom autorisé n'y entre pas) ;
--   4. anon n'écrit dans aucune relation du schéma public (INSERT, UPDATE,
--      DELETE, TRUNCATE), sauf INSERT sur contact_submissions, formulaire
--      de la page d'accueil ; une table créée ensuite par le rôle qui
--      applique les migrations ne lui donne rien.
--
-- Aucune fonction n'est appelée sous SET ROLE anon ou authenticated : dans
-- l'image Postgres de Supabase (17.6.1.106), le refus d'une fonction sous
-- ces rôles fait tomber le serveur (supautils, signal 11, CLAUDE.md). Les
-- droits se lisent par has_table_privilege, has_any_column_privilege,
-- has_function_privilege et aclexplode.
--
-- Hors du contrôle 3, par règle : les fonctions de déclencheur (PostgreSQL
-- refuse de les appeler hors d'un déclencheur) et les fonctions d'une
-- extension. Hors des contrôles 1, 2 et 4 : les objets d'une extension.
--
-- Toute fonction SECURITY DEFINER nouvelle révoque EXECUTE à PUBLIC et à
-- anon dans sa migration, sinon le contrôle 3 échoue : le défaut par schéma
-- de 20260610140000 ne retire pas PUBLIC.
-- Chaque objet en échec donne une ligne ; une exception finale les liste.
-- =====================================================================

CREATE TEMP TABLE c1_definer_results (n int, ok boolean, detail text) ON COMMIT DROP;

-- Listes blanches, justifiées une par une.
CREATE TEMP TABLE c1_anon_read_allowed (relname text PRIMARY KEY, why text) ON COMMIT DROP;
INSERT INTO c1_anon_read_allowed VALUES
  ('profiles', '/r/:slug (RecruiterPublicProfile) : colonnes publiques seulement, 20260714170000'),
  ('subscription_plans', '/pricing lisible sans session');

CREATE TEMP TABLE c1_anon_exec_allowed (sig text PRIMARY KEY, why text) ON COMMIT DROP;
INSERT INTO c1_anon_exec_allowed VALUES
  ('public.get_portal_by_token(text)', '/portal/:token (CandidatePortal), limité au jeton, 20260610120000'),
  ('public.has_role(uuid, public.app_role)', 'aide RLS : évaluée pour anon par les policies sans clause TO'),
  ('public.is_org_member(uuid, uuid)', 'aide RLS : idem'),
  ('public.get_org_role(uuid, uuid)', 'aide RLS : idem'),
  ('public.get_user_org_id(uuid)', 'aide RLS : idem'),
  ('public.is_mission_team_member(uuid, uuid)', 'aide RLS : idem'),
  ('public.is_mission_team_member_for_project(uuid, uuid)', 'aide RLS : idem');

-- 1. RLS active sur toute table du schéma public.
INSERT INTO c1_definer_results
SELECT 1, false, format('table public.%I sans RLS', c.relname)
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');
INSERT INTO c1_definer_results VALUES (1, true, 'contrôle joué');

-- 2. Lecture anonyme : liste blanche, RLS et policy qui s'applique à anon.
INSERT INTO c1_definer_results
SELECT 2, false,
       CASE
         WHEN w.relname IS NULL THEN
           format('%s public.%I lisible par anon hors liste blanche',
                  CASE c.relkind WHEN 'v' THEN 'vue' WHEN 'm' THEN 'vue matérialisée'
                                 WHEN 'f' THEN 'table externe' ELSE 'table' END,
                  c.relname)
         WHEN c.relkind NOT IN ('r', 'p') OR NOT c.relrowsecurity THEN
           format('public.%I lisible par anon sans RLS', c.relname)
         ELSE
           format('public.%I lisible par anon sans policy de lecture qui s''applique à anon', c.relname)
       END
FROM pg_class c
LEFT JOIN c1_anon_read_allowed w ON w.relname = c.relname
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_any_column_privilege('anon', c.oid, 'SELECT'))
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  AND (
    w.relname IS NULL
    OR c.relkind NOT IN ('r', 'p')
    OR NOT c.relrowsecurity
    OR NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = c.oid
        AND p.polcmd IN ('r', '*')
        AND (p.polroles @> ARRAY[0::oid] OR p.polroles @> ARRAY['anon'::regrole::oid])
    )
  );
-- profiles : anon ne lit que les colonnes publiques du profil recruteur,
-- jamais la table entière (la policy de lecture publique exposerait sinon
-- toute colonne ajoutée).
INSERT INTO c1_definer_results
SELECT 2, false, 'public.profiles lisible en entier par anon'
WHERE has_table_privilege('anon', 'public.profiles', 'SELECT');
INSERT INTO c1_definer_results
SELECT 2, false, format('public.profiles.%I lisible par anon hors des colonnes publiques', a.attname)
FROM pg_attribute a
WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  AND has_column_privilege('anon', 'public.profiles', a.attname, 'SELECT')
  AND a.attname <> ALL (ARRAY['display_name', 'job_title', 'specializations', 'linkedin_url',
                              'recruiter_bio', 'recruiter_headline', 'public_slug', 'linkedin_skills',
                              'years_experience', 'rating', 'placements_count', 'avg_time_to_fill_days',
                              'first_round_rate', 'mid_round_rate', 'intro_video_url', 'testimonials']);
INSERT INTO c1_definer_results VALUES (2, true, 'contrôle joué');

-- 3. SECURITY DEFINER : jamais PUBLIC ; anon seulement sur la liste blanche.
--    proacl NULL vaut les droits par défaut, qui donnent EXECUTE à PUBLIC.
INSERT INTO c1_definer_results
SELECT 3, false,
       format('%s exécutable par %s', p.oid::regprocedure,
              concat_ws(' et ',
                CASE WHEN pub.x THEN 'PUBLIC' END,
                CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') AND w.sig IS NULL THEN 'anon' END))
FROM pg_proc p
LEFT JOIN c1_anon_exec_allowed w ON to_regprocedure(w.sig) = p.oid
CROSS JOIN LATERAL (
  SELECT p.proacl IS NULL
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS x
) pub
WHERE p.pronamespace = 'public'::regnamespace
  AND p.prosecdef
  AND p.prokind = 'f'
  AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  AND (pub.x OR (has_function_privilege('anon', p.oid, 'EXECUTE') AND w.sig IS NULL));
INSERT INTO c1_definer_results VALUES (3, true, 'contrôle joué');

-- 4. Écritures anonymes : aucune, sauf INSERT sur contact_submissions.
INSERT INTO c1_definer_results
SELECT 4, false, format('public.%I modifiable par anon (%s)', c.relname, w.privs)
FROM pg_class c
CROSS JOIN LATERAL (
  SELECT string_agg(pr, ', ' ORDER BY pr) AS privs
  FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS pr
  WHERE (has_table_privilege('anon', c.oid, pr)
         OR (pr IN ('INSERT', 'UPDATE') AND has_any_column_privilege('anon', c.oid, pr)))
    AND NOT (c.relname = 'contact_submissions' AND pr = 'INSERT')
) w
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  AND w.privs IS NOT NULL;

-- 4 (suite). Le formulaire de contact reste ouvert : INSERT pour anon et une
-- policy d'insertion qui s'applique à anon.
INSERT INTO c1_definer_results
SELECT 4, false, 'le formulaire de contact n''accepte plus d''envoi anonyme'
WHERE to_regclass('public.contact_submissions') IS NOT NULL
  AND NOT (
    has_table_privilege('anon', 'public.contact_submissions', 'INSERT')
    AND EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = 'public.contact_submissions'::regclass
        AND p.polcmd IN ('a', '*')
        AND (p.polroles @> ARRAY[0::oid] OR p.polroles @> ARRAY['anon'::regrole::oid])
    )
  );

-- 4 (fin). Défaut du schéma : une table créée maintenant par le rôle qui
-- applique les migrations ne donne à anon ni lecture ni écriture. La table
-- est supprimée aussitôt ; la transaction est de toute façon annulée.
CREATE TABLE public.c1_audit_default_probe (id int);
INSERT INTO c1_definer_results
SELECT 4, false, format('une table nouvelle donne à anon : %s', string_agg(pr, ', ' ORDER BY pr))
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS pr
WHERE has_table_privilege('anon', 'public.c1_audit_default_probe', pr)
HAVING count(*) > 0;
DROP TABLE public.c1_audit_default_probe;
INSERT INTO c1_definer_results VALUES (4, true, 'contrôle joué');

-- ===== Bilan =====
DO $$
DECLARE
  failures text;
  nfail int;
  checks int;
BEGIN
  SELECT string_agg(format('[%s : %s]', n, detail), ' ' ORDER BY n, detail), count(*)
    INTO failures, nfail
  FROM c1_definer_results WHERE ok IS NOT TRUE;
  SELECT count(DISTINCT n) INTO checks FROM c1_definer_results WHERE ok;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'rls_and_definer_audit : % objet(s) en échec %', nfail, failures;
  END IF;
  IF checks <> 4 THEN
    RAISE EXCEPTION 'rls_and_definer_audit : % contrôles joués sur 4', checks;
  END IF;
  RAISE NOTICE 'rls_and_definer_audit : 4 contrôles OK';
END $$;
