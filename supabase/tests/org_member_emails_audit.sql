-- =====================================================================
-- Audit de get_org_member_emails — Paramètres, lot 1.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, après la migration
-- 20260923095813_parametres_lot1_organisation.sql :
--   BEGIN; \i supabase/tests/org_member_emails_audit.sql; ROLLBACK;
-- Utilisateurs et organisations synthétiques (ids fixes). Le rôle de u_b dans
-- l'organisation A évolue en cours de test : admin, membre, collaborateur.
--
-- Chaque appel de la fonction est une instruction de premier niveau, jouée
-- sous le rôle authenticated, dont le résultat va dans une table temporaire.
-- Un DO final lève une exception listant les contrôles en échec.
--
-- Ne jamais appeler cette fonction depuis un bloc PL/pgSQL qui rattrape une
-- erreur (DO … EXCEPTION) : le Postgres de l'image Supabase de la CI y meurt
-- par erreur de segmentation (signal 11 ; runs du 24/09, appel sous
-- authenticated, et du 25/09, appel refusé sous anon). Le refus d'un appel
-- anonyme est donc contrôlé ici par les droits de la fonction (contrôles 1
-- et 10), et en vrai par .github/workflows/e2e.yml, hors bloc PL/pgSQL.
-- =====================================================================

CREATE TEMP TABLE emails_audit_results (n int, ok boolean, detail text) ON COMMIT DROP;
GRANT INSERT, SELECT ON emails_audit_results TO authenticated;

-- 1 à 4. Privilèges et définition.
INSERT INTO emails_audit_results
SELECT 1, NOT has_function_privilege('anon', 'public.get_org_member_emails(uuid)', 'EXECUTE'), 'anon peut exécuter'
UNION ALL
SELECT 2, NOT has_function_privilege('service_role', 'public.get_org_member_emails(uuid)', 'EXECUTE'), 'service_role peut exécuter'
UNION ALL
SELECT 3, has_function_privilege('authenticated', 'public.get_org_member_emails(uuid)', 'EXECUTE'), 'authenticated sans EXECUTE'
UNION ALL
SELECT 4, count(*) = 1, 'pas SECURITY DEFINER, ou search_path non vide'
FROM pg_proc p
WHERE p.oid = 'public.get_org_member_emails(uuid)'::regprocedure
  AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'];

-- Jeu de données (propriétaire = créateur, posé par handle_new_organization).
INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
VALUES ('91111111-1111-4111-8111-111111111111', 'a@emails.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
       ('92222222-2222-4222-8222-222222222222', 'b@emails.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
       ('93333333-3333-4333-8333-333333333333', 'c@emails.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
INSERT INTO public.organizations (id, name, slug, created_by)
VALUES ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Emails Org A', 'emails-audit-a', '91111111-1111-4111-8111-111111111111'),
       ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Emails Org B', 'emails-audit-b', '93333333-3333-4333-8333-333333333333');
INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '92222222-2222-4222-8222-222222222222', 'admin');

-- ===== 5. Propriétaire de A : les e-mails de A, et rien de B =====
SELECT set_config('request.jwt.claims', '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '91111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO emails_audit_results
SELECT 5, coalesce(v = 'a@emails.test,b@emails.test', false), 'propriétaire de A lit ' || coalesce(v, 'rien')
FROM (SELECT string_agg(email, ',' ORDER BY email) AS v
      FROM public.get_org_member_emails('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) s;
INSERT INTO emails_audit_results
SELECT 5, count(*) = 0, 'propriétaire de A lit ' || count(*) || ' e-mail(s) de B'
FROM public.get_org_member_emails('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
RESET ROLE;

-- ===== 6. u_b administrateur de A =====
SELECT set_config('request.jwt.claims', '{"sub":"92222222-2222-4222-8222-222222222222","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO emails_audit_results
SELECT 6, coalesce(v = 'a@emails.test,b@emails.test', false), 'admin de A lit ' || coalesce(v, 'rien')
FROM (SELECT string_agg(email, ',' ORDER BY email) AS v
      FROM public.get_org_member_emails('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) s;
INSERT INTO emails_audit_results
SELECT 6, count(*) = 0, 'admin de A lit ' || count(*) || ' e-mail(s) de B'
FROM public.get_org_member_emails('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
RESET ROLE;

-- u_b devient membre simple de A (claims vides : enforce_role_hierarchy
-- ne bloque que le rôle owner).
SELECT set_config('request.jwt.claims', '', true),
       set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', '', true);
UPDATE public.organization_members SET role = 'member'
WHERE organization_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND user_id = '92222222-2222-4222-8222-222222222222';

-- ===== 7. u_b membre simple de A =====
SELECT set_config('request.jwt.claims', '{"sub":"92222222-2222-4222-8222-222222222222","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO emails_audit_results
SELECT 7, coalesce(v = 'a@emails.test,b@emails.test', false), 'membre de A lit ' || coalesce(v, 'rien')
FROM (SELECT string_agg(email, ',' ORDER BY email) AS v
      FROM public.get_org_member_emails('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) s;
INSERT INTO emails_audit_results
SELECT 7, count(*) = 0, 'membre de A lit ' || count(*) || ' e-mail(s) de B'
FROM public.get_org_member_emails('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true),
       set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', '', true);
UPDATE public.organization_members SET role = 'collaborator'
WHERE organization_id = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND user_id = '92222222-2222-4222-8222-222222222222';

-- ===== 8. u_b collaborateur externe de A : rien, sans erreur =====
SELECT set_config('request.jwt.claims', '{"sub":"92222222-2222-4222-8222-222222222222","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '92222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO emails_audit_results
SELECT 8, count(*) = 0, 'un collaborateur lit ' || count(*) || ' e-mail(s)'
FROM public.get_org_member_emails('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
RESET ROLE;

-- ===== 9. Propriétaire de B, étranger à A : rien de A ; les siens, oui =====
SELECT set_config('request.jwt.claims', '{"sub":"93333333-3333-4333-8333-333333333333","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '93333333-3333-4333-8333-333333333333', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
INSERT INTO emails_audit_results
SELECT 9, count(*) = 0, 'un étranger lit ' || count(*) || ' e-mail(s) de A'
FROM public.get_org_member_emails('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO emails_audit_results
SELECT 9, coalesce(v = 'c@emails.test', false), 'propriétaire de B lit ' || coalesce(v, 'rien')
FROM (SELECT string_agg(email, ',' ORDER BY email) AS v
      FROM public.get_org_member_emails('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) s;
RESET ROLE;

-- ===== 10. Anonyme : EXECUTE n'est accordé ni à anon ni à PUBLIC =====
-- Lecture des droits explicites de la fonction. proacl nul voudrait dire les
-- droits par défaut, donc EXECUTE pour PUBLIC : le contrôle échoue alors.
SELECT set_config('request.jwt.claims', '', true),
       set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', '', true);
INSERT INTO emails_audit_results
SELECT 10,
       p.proacl IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM aclexplode(p.proacl) AS a
         WHERE a.privilege_type = 'EXECUTE'
           AND a.grantee IN (0, 'anon'::regrole::oid)
       ),
       'EXECUTE accordé à anon ou à PUBLIC'
FROM pg_proc AS p
WHERE p.oid = 'public.get_org_member_emails(uuid)'::regprocedure;

-- ===== Bilan =====
DO $$
DECLARE
  failures text;
  checks int;
BEGIN
  SELECT string_agg(format('[%s : %s]', n, detail), ' ' ORDER BY n) INTO failures
  FROM emails_audit_results WHERE ok IS NOT TRUE;
  SELECT count(DISTINCT n) INTO checks FROM emails_audit_results;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'org_member_emails_audit : contrôles en échec %', failures;
  END IF;
  IF checks <> 10 THEN
    RAISE EXCEPTION 'org_member_emails_audit : % contrôles joués sur 10', checks;
  END IF;
  RAISE NOTICE 'org_member_emails_audit : 10 contrôles OK';
END $$;
