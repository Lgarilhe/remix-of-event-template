-- =====================================================================
-- member_calendar_accounts et colonnes d'agenda de qualification_sessions
-- (agenda Outlook, lot I3, demande de fusion A).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/calendar_accounts_audit.sql; ROLLBACK;
-- Vérifie la migration *_agenda_outlook_base.sql : table lue par la personne
-- reliée et par les propriétaires et administrateurs de son organisation,
-- jamais par un collègue simple membre, une autre organisation ou un membre
-- sorti, jamais écrite par le navigateur ; contraintes (fournisseur, doublons) ;
-- effacement en cascade avec l'organisation ; séances : origine par défaut
-- « manual », valeurs admises, un événement d'agenda ne crée qu'une séance,
-- un agenda retiré laisse la séance.
-- A propriétaire de O1, B simple membre de O1, C propriétaire de O2, D membre
-- sorti de O1. Aucune fonction n'est appelée sous SET ROLE authenticated hors
-- de celles que la policy évalue (CLAUDE.md). L'accès de anon est lu dans les
-- droits ; le refus réel par l'API est contrôlé dans e2e.yml. Les contrôles
-- sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'f1111111-1111-4111-8111-111111111111';
  u_b uuid := 'f2222222-2222-4222-8222-222222222222';
  u_c uuid := 'f3333333-3333-4333-8333-333333333333';
  u_d uuid := 'f4444444-4444-4444-8444-444444444444';
  o1 uuid := 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  o3 uuid := 'fccccccc-cccc-4ccc-8ccc-cccccccccccc';
  acc_a uuid := 'fa000000-0000-4000-8000-00000000000a';
  acc_b uuid := 'fa000000-0000-4000-8000-00000000000b';
  acc_d uuid := 'fa000000-0000-4000-8000-00000000000d';
  acc_c uuid := 'fb000000-0000-4000-8000-00000000000c';
  acc_o3 uuid := 'fc000000-0000-4000-8000-0000000000e3';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@agenda.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@agenda.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@agenda.test')::text;
  claims_d text := json_build_object('sub', u_d, 'role', 'authenticated', 'email', 'd@agenda.test')::text;
  n integer;
  v_text text;
  v_bool boolean;
  v_id uuid;
  pr text;
  failures text := '';
BEGIN
  -- 1. Table : RLS active, une seule policy, en lecture, pour authenticated.
  SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = 'public.member_calendar_accounts'::regclass;
  SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ') INTO v_text FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'member_calendar_accounts';
  IF NOT coalesce(v_bool, false) OR v_text IS DISTINCT FROM 'SELECT:authenticated' THEN
    failures := failures || format('[1. RLS %s, policies %s] ', v_bool, v_text);
  END IF;

  -- 2. Privilèges : rien pour anon, lecture seule pour authenticated, tout pour service_role.
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.member_calendar_accounts', pr) THEN
      failures := failures || format('[2. anon a %s] ', pr);
    END IF;
    IF pr <> 'SELECT' AND has_table_privilege('authenticated', 'public.member_calendar_accounts', pr) THEN
      failures := failures || format('[2. authenticated a %s] ', pr);
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.member_calendar_accounts', 'SELECT') THEN
    failures := failures || '[2. lecture authenticated manquante] ';
  END IF;
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.member_calendar_accounts', pr) THEN
      failures := failures || format('[2. service_role n''a pas %s] ', pr);
    END IF;
  END LOOP;

  -- 3. Effacement en cascade avec l'organisation ; un agenda retiré laisse la séance.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.member_calendar_accounts'::regclass AND contype = 'f'
     AND confrelid = 'public.organizations'::regclass AND confdeltype = 'c';
  IF n <> 1 THEN failures := failures || '[3. clé vers organizations sans ON DELETE CASCADE] '; END IF;
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.qualification_sessions'::regclass AND contype = 'f'
     AND confrelid = 'public.member_calendar_accounts'::regclass AND confdeltype = 'n';
  IF n <> 1 THEN failures := failures || '[3. qualification_sessions.calendar_account_id sans ON DELETE SET NULL] '; END IF;

  -- 4. Colonnes des séances : origine non nulle, « manual » par défaut ; déclencheur updated_at posé.
  SELECT a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') INTO v_text
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.qualification_sessions'::regclass AND a.attname = 'source' AND NOT a.attisdropped;
  IF v_text IS DISTINCT FROM 'true:''manual''::text' THEN
    failures := failures || format('[4. qualification_sessions.source : %s] ', v_text);
  END IF;
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = 'public.qualification_sessions'::regclass AND attname IN ('calendar_account_id', 'external_event_id')
     AND NOT attisdropped;
  IF n <> 2 THEN failures := failures || '[4. colonnes calendar_account_id et external_event_id absentes] '; END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.member_calendar_accounts'::regclass AND NOT tgisinternal
     AND tgname = 'update_member_calendar_accounts_updated_at';
  IF n <> 1 THEN failures := failures || '[4. déclencheur updated_at absent] '; END IF;

  -- Jeu de données : A propriétaire de O1, B membre de O1, D membre de O1 (sorti plus bas),
  -- C propriétaire de O2.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@agenda.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@agenda.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@agenda.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_d, 'd@agenda.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Agenda Org 1', 'agenda-org-1', u_a),
         (o2, 'Agenda Org 2', 'agenda-org-2', u_c),
         (o3, 'Agenda Org 3', 'agenda-org-3', u_c);
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner'
     OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member'), (o1, u_d, 'member');
  INSERT INTO public.member_calendar_accounts (id, organization_id, user_id, provider, account_id, email_address)
  VALUES (acc_a, o1, u_a, 'outlook', 'acc_audit_a', 'a@agenda.test'),
         (acc_b, o1, u_b, 'outlook', 'acc_audit_b', 'b@agenda.test'),
         (acc_d, o1, u_d, 'outlook', 'acc_audit_d', 'd@agenda.test'),
         (acc_c, o2, u_c, 'outlook', 'acc_audit_c', 'c@agenda.test'),
         (acc_o3, o3, u_c, 'outlook', 'acc_audit_o3', 'c@agenda.test');

  -- 5. Contraintes : fournisseur connu, un compte relié une fois par organisation,
  --    un agenda par personne et par fournisseur ; les valeurs par défaut.
  BEGIN
    INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id)
    VALUES (o1, u_a, 'yahoo', 'acc_audit_x1');
    failures := failures || '[5. fournisseur inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id)
    VALUES (o1, u_b, 'google', 'acc_audit_a');
    failures := failures || '[5. même compte relié deux fois dans l''organisation] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id)
    VALUES (o1, u_a, 'outlook', 'acc_audit_x2');
    failures := failures || '[5. deuxième agenda Outlook pour la même personne] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id, status)
    VALUES (o1, u_a, 'google', 'acc_audit_x3', repeat('x', 101));
    failures := failures || '[5. état de plus de 100 caractères accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id)
  VALUES (o1, u_a, 'google', 'acc_audit_g') RETURNING id INTO v_id;
  SELECT status || ':' || (last_synced_at IS NULL AND last_error IS NULL)::text INTO v_text
    FROM public.member_calendar_accounts WHERE id = v_id;
  IF v_text IS DISTINCT FROM 'running:true' THEN failures := failures || format('[5. valeurs par défaut : %s] ', v_text); END IF;
  DELETE FROM public.member_calendar_accounts WHERE id = v_id;

  -- 6. Séances : « manual » par défaut ; origine hors liste refusée.
  INSERT INTO public.qualification_sessions (id, created_by, organization_id)
  VALUES ('fa100000-0000-4000-8000-000000000001', u_a, o1);
  SELECT source INTO v_text FROM public.qualification_sessions WHERE id = 'fa100000-0000-4000-8000-000000000001';
  IF v_text IS DISTINCT FROM 'manual' THEN failures := failures || format('[6. origine par défaut : %s] ', v_text); END IF;
  BEGIN
    INSERT INTO public.qualification_sessions (created_by, organization_id, source) VALUES (u_a, o1, 'inconnue');
    failures := failures || '[6. origine inconnue acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  FOREACH v_text IN ARRAY ARRAY['manual', 'agenda', 'invitation', 'booking'] LOOP
    BEGIN
      INSERT INTO public.qualification_sessions (created_by, organization_id, source) VALUES (u_a, o1, v_text);
    EXCEPTION WHEN check_violation THEN
      failures := failures || format('[6. origine %s refusée] ', v_text);
    END;
  END LOOP;

  -- 7. Un événement d'un agenda ne crée qu'une séance ; le même identifiant sur un autre
  --    agenda, ou des séances sans agenda, ne se gênent pas.
  INSERT INTO public.qualification_sessions (id, created_by, organization_id, source, calendar_account_id, external_event_id)
  VALUES ('fa100000-0000-4000-8000-000000000002', u_a, o1, 'agenda', acc_a, 'evt-1');
  BEGIN
    INSERT INTO public.qualification_sessions (created_by, organization_id, source, calendar_account_id, external_event_id)
    VALUES (u_a, o1, 'agenda', acc_a, 'evt-1');
    failures := failures || '[7. un même événement a créé deux séances] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.qualification_sessions (created_by, organization_id, source, calendar_account_id, external_event_id)
    VALUES (u_b, o1, 'agenda', acc_b, 'evt-1');
    INSERT INTO public.qualification_sessions (created_by, organization_id, source) VALUES (u_a, o1, 'manual');
    INSERT INTO public.qualification_sessions (created_by, organization_id, source) VALUES (u_a, o1, 'manual');
    INSERT INTO public.qualification_sessions (created_by, organization_id, source, calendar_account_id)
    VALUES (u_a, o1, 'agenda', acc_a);
    INSERT INTO public.qualification_sessions (created_by, organization_id, source, calendar_account_id)
    VALUES (u_a, o1, 'agenda', acc_a);
  EXCEPTION WHEN unique_violation THEN
    failures := failures || '[7. l''index unique gêne un autre agenda ou des séances sans identifiant d''événement] ';
  END;

  -- 8. Un agenda retiré laisse la séance, sans agenda.
  DELETE FROM public.member_calendar_accounts WHERE id = acc_a;
  SELECT (calendar_account_id IS NULL)::text || ':' || external_event_id INTO v_text
    FROM public.qualification_sessions WHERE id = 'fa100000-0000-4000-8000-000000000002';
  IF v_text IS DISTINCT FROM 'true:evt-1' THEN
    failures := failures || format('[8. séance après retrait de l''agenda : %s] ', coalesce(v_text, 'supprimée'));
  END IF;
  INSERT INTO public.member_calendar_accounts (id, organization_id, user_id, provider, account_id, email_address)
  VALUES (acc_a, o1, u_a, 'outlook', 'acc_audit_a', 'a@agenda.test');

  -- 9. Lecture : A (propriétaire de O1) lit les agendas de O1, pas ceux de O2.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT string_agg(account_id, ' ' ORDER BY account_id) INTO v_text FROM public.member_calendar_accounts;
  IF v_text IS DISTINCT FROM 'acc_audit_a acc_audit_b acc_audit_d' THEN
    failures := failures || format('[9. A lit : %s] ', v_text);
  END IF;
  -- 10. Aucune écriture par le navigateur, même d'un propriétaire.
  BEGIN
    INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id)
    VALUES (o1, u_a, 'google', 'acc_audit_w');
    failures := failures || '[10. A a inséré un agenda] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[10. insertion de A : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.member_calendar_accounts SET status = 'error' WHERE organization_id = o1;
    failures := failures || '[10. A a modifié un agenda] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[10. modification de A : %s] ', SQLERRM);
  END;
  BEGIN
    DELETE FROM public.member_calendar_accounts WHERE organization_id = o1;
    failures := failures || '[10. A a supprimé un agenda] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[10. suppression de A : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- 11. B (simple membre) ne lit que le sien.
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT string_agg(account_id, ' ' ORDER BY account_id) INTO v_text FROM public.member_calendar_accounts;
  IF v_text IS DISTINCT FROM 'acc_audit_b' THEN failures := failures || format('[11. B lit : %s] ', v_text); END IF;
  RESET ROLE;

  -- 12. C (propriétaire de O2 et O3) lit O2 et O3, rien de O1.
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  SET LOCAL ROLE authenticated;
  SELECT string_agg(account_id, ' ' ORDER BY account_id) INTO v_text FROM public.member_calendar_accounts;
  IF v_text IS DISTINCT FROM 'acc_audit_c acc_audit_o3' THEN failures := failures || format('[12. C lit : %s] ', v_text); END IF;
  RESET ROLE;

  -- 13. D, sorti de O1 : son agenda reste en base mais il ne la lit plus.
  DELETE FROM public.organization_members WHERE organization_id = o1 AND user_id = u_d;
  PERFORM set_config('request.jwt.claims', claims_d, true);
  PERFORM set_config('request.jwt.claim.sub', u_d::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.member_calendar_accounts;
  IF n <> 0 THEN failures := failures || format('[13. un membre sorti lit %s agenda(s)] ', n); END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- 14. Effacement en cascade : supprimer l'organisation supprime ses agendas.
  DELETE FROM public.organizations WHERE id = o3;
  SELECT count(*) INTO n FROM public.member_calendar_accounts WHERE organization_id = o3;
  IF n <> 0 THEN failures := failures || format('[14. %s agenda(s) restent après la suppression de l''organisation] ', n); END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'calendar_accounts_audit : %', failures;
  END IF;
  RAISE NOTICE 'calendar_accounts_audit : 14 contrôles passés';
END $$;
