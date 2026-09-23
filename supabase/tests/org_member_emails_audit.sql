-- =====================================================================
-- Audit de get_org_member_emails — Paramètres, lot 1.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, après la migration
-- 20260923095813_parametres_lot1_organisation.sql :
--   BEGIN; \i supabase/tests/org_member_emails_audit.sql; ROLLBACK;
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Utilisateurs et organisations synthétiques (ids fixes). Le rôle de u_b dans
-- l'organisation A évolue en cours de test : admin, membre, collaborateur.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '91111111-1111-4111-8111-111111111111';  -- propriétaire de A
  u_b uuid := '92222222-2222-4222-8222-222222222222';  -- admin, puis membre, puis collaborateur de A
  u_c uuid := '93333333-3333-4333-8333-333333333333';  -- propriétaire de B, étranger à A
  org_a uuid := '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated')::text;
  fn regprocedure := 'public.get_org_member_emails(uuid)'::regprocedure;
  -- E-mails attendus pour A, triés : propriétaire et u_b.
  emails_a text := 'a@emails.test,b@emails.test';
  v_list text;
  n int;
  failures text := '';
BEGIN
  -- 1 à 4. Privilèges et définition.
  IF has_function_privilege('anon', fn, 'EXECUTE') THEN failures := failures || '[1 : anon peut exécuter] '; END IF;
  IF has_function_privilege('service_role', fn, 'EXECUTE') THEN failures := failures || '[2 : service_role peut exécuter] '; END IF;
  IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN failures := failures || '[3 : authenticated sans EXECUTE] '; END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.oid = fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'];
  IF n <> 1 THEN failures := failures || '[4 : pas SECURITY DEFINER, ou search_path non vide] '; END IF;

  -- Jeu de données (propriétaire = créateur, posé par handle_new_organization).
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@emails.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@emails.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@emails.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (org_a, 'Emails Org A', 'emails-audit-a', u_a), (org_b, 'Emails Org B', 'emails-audit-b', u_c);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_b, 'admin');

  -- ===== Propriétaire de A =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 5. Les e-mails de A, et rien de B.
  BEGIN
    SELECT string_agg(email, ',' ORDER BY email) INTO v_list FROM public.get_org_member_emails(org_a);
    IF v_list IS DISTINCT FROM emails_a THEN failures := failures || format('[5 : propriétaire de A lit %s] ', v_list); END IF;
    SELECT count(*) INTO n FROM public.get_org_member_emails(org_b);
    IF n <> 0 THEN failures := failures || format('[5 : propriétaire de A lit %s e-mail(s) de B] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[5 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- ===== u_b administrateur de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 6. Les e-mails de A, et rien de B.
  BEGIN
    SELECT string_agg(email, ',' ORDER BY email) INTO v_list FROM public.get_org_member_emails(org_a);
    IF v_list IS DISTINCT FROM emails_a THEN failures := failures || format('[6 : admin de A lit %s] ', v_list); END IF;
    SELECT count(*) INTO n FROM public.get_org_member_emails(org_b);
    IF n <> 0 THEN failures := failures || format('[6 : admin de A lit %s e-mail(s) de B] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[6 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- u_b devient membre simple de A (claims vides : enforce_role_hierarchy
  -- ne bloque que le rôle owner).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'member' WHERE organization_id = org_a AND user_id = u_b;

  -- ===== u_b membre simple de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 7. Les e-mails de A, et rien de B.
  BEGIN
    SELECT string_agg(email, ',' ORDER BY email) INTO v_list FROM public.get_org_member_emails(org_a);
    IF v_list IS DISTINCT FROM emails_a THEN failures := failures || format('[7 : membre de A lit %s] ', v_list); END IF;
    SELECT count(*) INTO n FROM public.get_org_member_emails(org_b);
    IF n <> 0 THEN failures := failures || format('[7 : membre de A lit %s e-mail(s) de B] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[7 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'collaborator' WHERE organization_id = org_a AND user_id = u_b;

  -- ===== u_b collaborateur de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 8. Collaborateur externe : rien, sans erreur.
  BEGIN
    SELECT count(*) INTO n FROM public.get_org_member_emails(org_a);
    IF n <> 0 THEN failures := failures || format('[8 : un collaborateur lit %s e-mail(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[8 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- ===== Propriétaire de B, étranger à A =====
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 9. Rien de A, sans erreur ; ses propres e-mails, oui.
  BEGIN
    SELECT count(*) INTO n FROM public.get_org_member_emails(org_a);
    IF n <> 0 THEN failures := failures || format('[9 : un étranger lit %s e-mail(s) de A] ', n); END IF;
    SELECT string_agg(email, ',' ORDER BY email) INTO v_list FROM public.get_org_member_emails(org_b);
    IF v_list IS DISTINCT FROM 'c@emails.test' THEN failures := failures || format('[9 : propriétaire de B lit %s] ', v_list); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[9 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- ===== Anonyme =====
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;
  -- 10. Appel refusé (pas d'EXECUTE).
  BEGIN
    PERFORM public.get_org_member_emails(org_a);
    failures := failures || '[10 : l''anonyme appelle la fonction] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[10 : %s] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  IF failures <> '' THEN
    RAISE EXCEPTION 'org_member_emails_audit : contrôles en échec %', failures;
  END IF;
  RAISE NOTICE 'org_member_emails_audit : 10 contrôles OK';
END $$;
