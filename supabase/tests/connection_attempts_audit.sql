-- =====================================================================
-- connection_attempts et statuts de compte (connexion d'un compte, API v2).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/connection_attempts_audit.sql; ROLLBACK;
-- Vérifie la migration *_connection_attempts.sql : table lue par la
-- personne qui a lancé la tentative et par elle seule, jamais écrite par le
-- navigateur (ni anon), valeurs admises (fournisseur, mode, état), cohérence
-- entre reconnexion et compte visé, une seule tentative en cours par membre et
-- par canal, délai de 30 minutes par défaut, effacement en cascade avec
-- l'organisation ; fonction de purge (droits, effet) ; les six statuts de
-- compte OK, CREDENTIALS, ERROR, DEGRADED, PARTIAL et LOCKED admis par les trois
-- tables de liaison ; page de retour (return_to, liste fermée).
-- A et B membres de O1, C propriétaire de O2. Aucune fonction n'est appelée sous
-- SET ROLE authenticated ou anon (CLAUDE.md) : les droits d'exécution sont lus
-- avec has_function_privilege, et le refus réel par l'API est contrôlé dans
-- e2e.yml. Les contrôles sont accumulés ; une exception finale liste ceux en
-- échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'c1111111-1111-4111-8111-111111111111';
  u_b uuid := 'c2222222-2222-4222-8222-222222222222';
  u_c uuid := 'c3333333-3333-4333-8333-333333333333';
  o1 uuid := 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  o3 uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  att_a uuid := 'ca000000-0000-4000-8000-00000000000a';
  att_b uuid := 'ca000000-0000-4000-8000-00000000000b';
  att_c uuid := 'cb000000-0000-4000-8000-00000000000c';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@connexion.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@connexion.test')::text;
  n integer;
  v_text text;
  v_bool boolean;
  v_ts timestamptz;
  pr text;
  st text;
  failures text := '';
BEGIN
  -- 1. Table : RLS active, une seule policy, en lecture, pour authenticated.
  SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = 'public.connection_attempts'::regclass;
  SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ') INTO v_text FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'connection_attempts';
  IF NOT coalesce(v_bool, false) OR v_text IS DISTINCT FROM 'SELECT:authenticated' THEN
    failures := failures || format('[1. RLS %s, policies %s] ', v_bool, v_text);
  END IF;

  -- 2. Privilèges : rien pour anon, lecture seule pour authenticated, tout pour service_role.
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.connection_attempts', pr) THEN
      failures := failures || format('[2. anon a %s] ', pr);
    END IF;
    IF pr <> 'SELECT' AND has_table_privilege('authenticated', 'public.connection_attempts', pr) THEN
      failures := failures || format('[2. authenticated a %s] ', pr);
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.connection_attempts', 'SELECT') THEN
    failures := failures || '[2. lecture authenticated manquante] ';
  END IF;
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.connection_attempts', pr) THEN
      failures := failures || format('[2. service_role n''a pas %s] ', pr);
    END IF;
  END LOOP;

  -- 3. Effacement en cascade avec l'organisation et avec l'utilisateur.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.connection_attempts'::regclass AND contype = 'f'
     AND confrelid = 'public.organizations'::regclass AND confdeltype = 'c';
  IF n <> 1 THEN failures := failures || '[3. clé vers organizations sans ON DELETE CASCADE] '; END IF;
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.connection_attempts'::regclass AND contype = 'f'
     AND confrelid = 'auth.users'::regclass AND confdeltype = 'c';
  IF n <> 1 THEN failures := failures || '[3. clé vers auth.users sans ON DELETE CASCADE] '; END IF;

  -- 4. Fonction de purge : réservée à service_role.
  IF has_function_privilege('anon', 'public.purge_connection_attempts()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_connection_attempts()', 'EXECUTE') THEN
    failures := failures || '[4. purge_connection_attempts exécutable par anon ou authenticated] ';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.purge_connection_attempts()', 'EXECUTE') THEN
    failures := failures || '[4. purge_connection_attempts non exécutable par service_role] ';
  END IF;
  SELECT prosecdef INTO v_bool FROM pg_proc WHERE oid = 'public.purge_connection_attempts()'::regprocedure;
  IF NOT coalesce(v_bool, false) THEN failures := failures || '[4. purge_connection_attempts n''est pas SECURITY DEFINER] '; END IF;

  -- Jeu de données : A et B membres de O1, C propriétaire de O2.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@connexion.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@connexion.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@connexion.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Connexion Org 1', 'connexion-org-1', u_a),
         (o2, 'Connexion Org 2', 'connexion-org-2', u_c),
         (o3, 'Connexion Org 3', 'connexion-org-3', u_c);
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member');

  -- 5. Valeurs par défaut : en attente, hébergée, liaison, trente minutes.
  INSERT INTO public.connection_attempts (id, organization_id, user_id, provider)
  VALUES (att_a, o1, u_a, 'linkedin');
  SELECT status || ':' || mode || ':' || purpose || ':' || (reconnect_account_id IS NULL)::text || ':' ||
         (intent_id IS NULL AND account_id IS NULL AND error_kind IS NULL AND completed_at IS NULL)::text
    INTO v_text FROM public.connection_attempts WHERE id = att_a;
  IF v_text IS DISTINCT FROM 'pending:hosted:link:true:true' THEN
    failures := failures || format('[5. valeurs par défaut : %s] ', v_text);
  END IF;
  SELECT round(extract(epoch FROM (expires_at - created_at)) / 60)::integer INTO n
    FROM public.connection_attempts WHERE id = att_a;
  IF n IS DISTINCT FROM 30 THEN failures := failures || format('[5. délai par défaut : %s min au lieu de 30] ', n); END IF;

  -- 6. Valeurs admises.
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider) VALUES (o1, u_b, 'telegram');
    failures := failures || '[6. fournisseur inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, mode) VALUES (o1, u_b, 'whatsapp', 'inconnu');
    failures := failures || '[6. mode inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, status) VALUES (o1, u_b, 'whatsapp', 'inconnu');
    failures := failures || '[6. état inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, purpose) VALUES (o1, u_b, 'whatsapp', 'inconnu');
    failures := failures || '[6. objet inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  FOREACH v_text IN ARRAY ARRAY['linkedin', 'whatsapp', 'google', 'outlook', 'imap'] LOOP
    BEGIN
      INSERT INTO public.connection_attempts (organization_id, user_id, provider, status) VALUES (o2, u_c, v_text, 'completed');
    EXCEPTION WHEN check_violation THEN
      failures := failures || format('[6. fournisseur %s refusé] ', v_text);
    END;
  END LOOP;
  FOREACH v_text IN ARRAY ARRAY['pending', 'completed', 'failed', 'expired', 'cancelled'] LOOP
    BEGIN
      INSERT INTO public.connection_attempts (organization_id, user_id, provider, status) VALUES (o3, u_c, 'imap', v_text);
    EXCEPTION WHEN check_violation THEN
      failures := failures || format('[6. état %s refusé] ', v_text);
    WHEN unique_violation THEN
      NULL; -- 'pending' après un autre 'pending' du même membre : couvert au contrôle 8
    END;
  END LOOP;

  -- 7. Reconnexion : compte visé obligatoire, identifiant v2 (acc_...) seulement,
  --    et seulement pour une reconnexion.
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, purpose)
    VALUES (o1, u_b, 'linkedin', 'reconnect');
    failures := failures || '[7. reconnexion sans compte visé acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, reconnect_account_id)
    VALUES (o1, u_b, 'linkedin', 'acc_audit_visé');
    failures := failures || '[7. compte visé sans reconnexion accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, purpose, reconnect_account_id)
    VALUES (o1, u_b, 'linkedin', 'reconnect', 'ancien-identifiant');
    failures := failures || '[7. identifiant hors format acc_ accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (id, organization_id, user_id, provider, purpose, reconnect_account_id)
    VALUES (att_b, o1, u_b, 'linkedin', 'reconnect', 'acc_audit_b');
  EXCEPTION WHEN check_violation THEN
    failures := failures || '[7. reconnexion valide refusée] ';
  END;

  -- 8. Une seule tentative en cours par membre et par canal ; une terminée ne gêne pas.
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider) VALUES (o1, u_a, 'linkedin');
    failures := failures || '[8. deux tentatives en cours pour le même membre et le même canal] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider) VALUES (o1, u_a, 'whatsapp');
    UPDATE public.connection_attempts SET status = 'cancelled' WHERE id = att_a;
    INSERT INTO public.connection_attempts (organization_id, user_id, provider) VALUES (o1, u_a, 'linkedin');
  EXCEPTION WHEN unique_violation THEN
    failures := failures || '[8. l''index unique gêne un autre canal ou une tentative annulée] ';
  END;

  -- 9. Lecture : A ne lit que ses tentatives (jamais celles de B ni de C) ; aucune écriture.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.connection_attempts WHERE user_id <> u_a;
  IF n <> 0 THEN failures := failures || format('[9. A lit %s tentatives d''autres membres] ', n); END IF;
  SELECT count(*) INTO n FROM public.connection_attempts WHERE id = att_a;
  IF n <> 1 THEN failures := failures || '[9. A ne lit pas sa propre tentative] '; END IF;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider) VALUES (o1, u_a, 'google');
    failures := failures || '[9. A a inséré une tentative] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.connection_attempts SET status = 'completed' WHERE id = att_a;
    failures := failures || '[9. A a modifié une tentative] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.connection_attempts WHERE id = att_a;
    failures := failures || '[9. A a supprimé une tentative] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.connection_attempts WHERE id = att_a;
  IF n <> 0 THEN failures := failures || '[9. B lit la tentative de A] '; END IF;
  SELECT count(*) INTO n FROM public.connection_attempts WHERE id = att_b;
  IF n <> 1 THEN failures := failures || '[9. B ne lit pas sa propre tentative] '; END IF;
  RESET ROLE;

  -- 10. anon : aucune lecture (droit retiré).
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.connection_attempts;
    failures := failures || '[10. anon a lu connection_attempts] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- 11. Purge : une tentative en cours échue passe en « expired », une de plus de
  --     24 h disparaît, une récente reste ; la fonction rend le nombre supprimé.
  INSERT INTO public.connection_attempts (id, organization_id, user_id, provider, status, created_at, expires_at)
  VALUES ('cd000000-0000-4000-8000-000000000001', o2, u_c, 'google', 'completed', now() - interval '25 hours', now() - interval '24 hours 30 minutes');
  INSERT INTO public.connection_attempts (id, organization_id, user_id, provider, status, created_at, expires_at)
  VALUES ('cd000000-0000-4000-8000-000000000002', o2, u_c, 'outlook', 'pending', now() - interval '2 hours', now() - interval '90 minutes');
  INSERT INTO public.connection_attempts (id, organization_id, user_id, provider, status)
  VALUES ('cd000000-0000-4000-8000-000000000003', o2, u_c, 'whatsapp', 'completed');
  n := public.purge_connection_attempts();
  IF n < 1 THEN failures := failures || format('[11. la purge rend %s au lieu d''au moins 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.connection_attempts WHERE id = 'cd000000-0000-4000-8000-000000000001';
  IF n <> 0 THEN failures := failures || '[11. une tentative de plus de 24 h reste] '; END IF;
  SELECT status INTO v_text FROM public.connection_attempts WHERE id = 'cd000000-0000-4000-8000-000000000002';
  IF v_text IS DISTINCT FROM 'expired' THEN failures := failures || format('[11. tentative échue : %s au lieu de expired] ', v_text); END IF;
  SELECT status INTO v_text FROM public.connection_attempts WHERE id = 'cd000000-0000-4000-8000-000000000003';
  IF v_text IS DISTINCT FROM 'completed' THEN failures := failures || '[11. une tentative récente a été touchée] '; END IF;

  -- 12. Effacement en cascade avec l'organisation.
  INSERT INTO public.connection_attempts (id, organization_id, user_id, provider)
  VALUES (att_c, o3, u_a, 'imap');
  -- Le déclencheur prevent_last_owner interdit de retirer le dernier propriétaire, y
  -- compris par la cascade d'une suppression d'organisation (migration 20260324145941).
  -- On le suspend pour ce seul contrôle : la transaction de l'audit est annulée à la fin.
  ALTER TABLE public.organization_members DISABLE TRIGGER prevent_last_owner;
  DELETE FROM public.organizations WHERE id = o3;
  ALTER TABLE public.organization_members ENABLE TRIGGER prevent_last_owner;
  SELECT count(*) INTO n FROM public.connection_attempts WHERE organization_id = o3;
  IF n <> 0 THEN failures := failures || '[12. des tentatives survivent à leur organisation] '; END IF;

  -- 13. Statuts de compte : les six statuts du client sont admis par les trois tables de liaison.
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_a, 'acc_audit_statut_li', u_a);
  INSERT INTO public.member_email_accounts (organization_id, user_id, email_account_id, linked_by)
  VALUES (o1, u_a, 'acc_audit_statut_em', u_a);
  INSERT INTO public.member_whatsapp_accounts (organization_id, user_id, whatsapp_account_id)
  VALUES (o1, u_a, 'acc_audit_statut_wa');
  FOREACH st IN ARRAY ARRAY['OK', 'CREDENTIALS', 'ERROR', 'DEGRADED', 'PARTIAL', 'LOCKED'] LOOP
    BEGIN
      UPDATE public.member_linkedin_accounts SET account_status = st WHERE linkedin_account_id = 'acc_audit_statut_li';
      UPDATE public.member_email_accounts SET account_status = st WHERE email_account_id = 'acc_audit_statut_em';
      UPDATE public.member_whatsapp_accounts SET account_status = st WHERE whatsapp_account_id = 'acc_audit_statut_wa';
    EXCEPTION WHEN check_violation THEN
      failures := failures || format('[13. statut %s refusé par une table de liaison] ', st);
    END;
  END LOOP;

  -- 14. Page de retour : un nom d'une liste fermée, nul par défaut ; aucune adresse.
  SELECT return_to IS NULL INTO v_bool FROM public.connection_attempts WHERE id = att_b;
  IF NOT coalesce(v_bool, false) THEN failures := failures || '[14. return_to non nul par défaut] '; END IF;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, return_to)
    VALUES (o1, u_b, 'whatsapp', 'https://exemple.test/retour');
    failures := failures || '[14. une adresse est acceptée comme page de retour] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.connection_attempts (organization_id, user_id, provider, return_to)
    VALUES (o1, u_b, 'google', 'onboarding');
  EXCEPTION WHEN check_violation THEN
    failures := failures || '[14. la page de retour onboarding est refusée] ';
  END;

  IF failures <> '' THEN
    RAISE EXCEPTION 'connection_attempts_audit : %', failures;
  END IF;
  RAISE NOTICE 'connection_attempts_audit : tous les contrôles passent';
END
$$;
