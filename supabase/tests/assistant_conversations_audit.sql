-- =====================================================================
-- Conversations de l'assistant : leur auteur seul (lot C1, R3).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/assistant_conversations_audit.sql; ROLLBACK;
-- Vérifie le bloc R3 de 20260927233806_c1_reparations_fuites.sql :
-- agent_conversations et agent_messages lus et modifiés par l'auteur seul,
-- dans son organisation active ; agent_tool_executions lues par leur
-- auteur, ou par le propriétaire ou un administrateur de l'organisation,
-- jamais par un membre ni un collaborateur ; aucune policy d'une autre
-- famille de noms ne survit (CLAUDE.md, règle 7).
-- A propriétaire et B membre de O1, C propriétaire de O2 (ids fixes). Le
-- rôle de B dans O1 évolue en cours de test : membre, administrateur,
-- collaborateur.
-- Aucune fonction n'est appelée sous un rôle qui n'en a pas le droit.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'a1111111-1111-4111-8111-111111111111';
  u_b uuid := 'a2222222-2222-4222-8222-222222222222';
  u_c uuid := 'a3333333-3333-4333-8333-333333333333';
  o1 uuid := 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'aaaaaaa2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  conv_a uuid;
  n integer;
  names text;
  failures text := '';
BEGIN
  -- ===== Jeu de données (sans jeton) =====
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@assistant.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@assistant.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@assistant.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Assistant Org 1', 'assistant-org-1', u_a),
         (o2, 'Assistant Org 2', 'assistant-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur de création.
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member');
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner'
     OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, o1), (u_b, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;

  -- ===== A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. A crée sa conversation comme le tiroir (AgentChatPanel.ensureConversationId).
  BEGIN
    INSERT INTO public.agent_conversations (organization_id, created_by, status)
    VALUES (o1, u_a, 'calibrating')
    RETURNING id INTO conv_a;
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[1. création par A : %s] ', SQLERRM);
  END;

  -- 7. A ne crée pas de conversation dans une organisation qui n'est pas la sienne.
  BEGIN
    INSERT INTO public.agent_conversations (organization_id, created_by, status)
    VALUES (o2, u_a, 'calibrating');
    failures := failures || '[7. A a créé une conversation dans O2] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[7. création dans O2 : %s] ', SQLERRM);
    END IF;
  END;

  -- Messages et actions écrits par le serveur (service_role contourne la RLS).
  RESET ROLE;
  IF conv_a IS NULL THEN
    RAISE EXCEPTION 'assistant_conversations_audit : %', failures;
  END IF;
  INSERT INTO public.agent_messages (conversation_id, role, content)
  VALUES (conv_a, 'user', 'Question de A'), (conv_a, 'assistant', 'Réponse à A');
  INSERT INTO public.agent_tool_executions (conversation_id, user_id, organization_id, tool_name, params)
  VALUES (conv_a, u_a, o1, 'send_linkedin_message', '{"message": "Brouillon de A"}'::jsonb),
         (NULL, u_b, o1, 'create_task', '{"title": "Tâche de B"}'::jsonb);

  SET LOCAL ROLE authenticated;

  -- 2. A relit sa conversation et ses deux messages.
  SELECT count(*) INTO n FROM public.agent_conversations WHERE id = conv_a;
  IF n <> 1 THEN failures := failures || format('[2. A voit %s conversation(s), attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.agent_messages WHERE conversation_id = conv_a;
  IF n <> 2 THEN failures := failures || format('[2. A voit %s message(s), attendu 2] ', n); END IF;

  -- 10. A, propriétaire, lit son action et celle de B (vue organisation du journal).
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE organization_id = o1;
  IF n <> 2 THEN failures := failures || format('[10. le propriétaire voit %s action(s), attendu 2] ', n); END IF;

  -- 11. A archive sa conversation comme la barre latérale (ApprovalsSection).
  UPDATE public.agent_conversations SET archived_at = now() WHERE id = conv_a AND created_by = u_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || format('[11. A archive %s ligne(s), attendu 1] ', n); END IF;

  -- ===== B, membre de la même organisation =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 3. B ne lit ni la conversation ni les messages de A.
  SELECT count(*) INTO n FROM public.agent_conversations;
  IF n <> 0 THEN failures := failures || format('[3. B voit %s conversation(s) de A] ', n); END IF;
  SELECT count(*) INTO n FROM public.agent_messages;
  IF n <> 0 THEN failures := failures || format('[3. B voit %s message(s) de A] ', n); END IF;

  -- 4. B ne modifie pas la conversation de A : 0 ligne touchée.
  BEGIN
    UPDATE public.agent_conversations SET title = 'réécrit par B' WHERE id = conv_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[4. B a modifié %s conversation(s) de A] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[4. modification par B : %s] ', SQLERRM);
  END;

  -- 5. B n'écrit pas dans la conversation de A.
  BEGIN
    INSERT INTO public.agent_messages (conversation_id, role, content) VALUES (conv_a, 'assistant', 'injecté par B');
    failures := failures || '[5. B a écrit un message dans la conversation de A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[5. message de B : %s] ', SQLERRM);
    END IF;
  END;

  -- 6. B ne crée pas de conversation au nom de A.
  BEGIN
    INSERT INTO public.agent_conversations (organization_id, created_by, status) VALUES (o1, u_a, 'calibrating');
    failures := failures || '[6. B a créé une conversation au nom de A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[6. création au nom de A : %s] ', SQLERRM);
    END IF;
  END;

  -- 9. B ne lit pas l'action proposée de A, mais lit la sienne.
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE user_id = u_a;
  IF n <> 0 THEN failures := failures || format('[9. B voit %s action(s) de A] ', n); END IF;
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE user_id = u_b;
  IF n <> 1 THEN failures := failures || format('[9. B voit %s action(s) à lui, attendu 1] ', n); END IF;

  -- ===== B devient administrateur de O1 (claims vides : la garde des rôles
  --       ne bloque que le rôle owner) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'admin' WHERE organization_id = o1 AND user_id = u_b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 13. Administrateur : il lit l'action de A (journal de l'organisation),
  --     jamais sa conversation ni ses messages.
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE user_id = u_a;
  IF n <> 1 THEN failures := failures || format('[13. l''administrateur voit %s action(s) de A, attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.agent_conversations;
  IF n <> 0 THEN failures := failures || format('[13. l''administrateur voit %s conversation(s) de A] ', n); END IF;
  SELECT count(*) INTO n FROM public.agent_messages;
  IF n <> 0 THEN failures := failures || format('[13. l''administrateur voit %s message(s) de A] ', n); END IF;
  -- Il lit l'action de A mais ne la modifie pas (brouillon, statut).
  BEGIN
    UPDATE public.agent_tool_executions SET params = '{"message": "réécrit par l''administrateur"}'::jsonb
     WHERE user_id = u_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[13. l''administrateur modifie %s action(s) de A] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[13. modification par l''administrateur : %s] ', SQLERRM);
  END;

  -- ===== B devient collaborateur de O1 =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'collaborator' WHERE organization_id = o1 AND user_id = u_b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 14. Collaborateur : ni l'action, ni la conversation, ni les messages de A.
  SELECT (SELECT count(*) FROM public.agent_tool_executions WHERE user_id = u_a)
       + (SELECT count(*) FROM public.agent_conversations)
       + (SELECT count(*) FROM public.agent_messages)
    INTO n;
  IF n <> 0 THEN failures := failures || format('[14. le collaborateur voit %s ligne(s) de A] ', n); END IF;

  -- ===== C, autre organisation =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_c, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 8. C ne lit rien.
  SELECT (SELECT count(*) FROM public.agent_conversations)
       + (SELECT count(*) FROM public.agent_messages)
       + (SELECT count(*) FROM public.agent_tool_executions)
    INTO n;
  IF n <> 0 THEN failures := failures || format('[8. C voit %s ligne(s)] ', n); END IF;

  RESET ROLE;

  -- 12. Une seule famille de policies : celles du bloc R3, rien d'autre.
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname), count(*)
    INTO names, n
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('agent_conversations', 'agent_messages', 'agent_tool_executions');
  IF n <> 7 OR names IS DISTINCT FROM
     'agent_conversations.agent_conversations_author_insert, agent_conversations.agent_conversations_author_select, '
     || 'agent_conversations.agent_conversations_author_update, agent_messages.agent_messages_author_insert, '
     || 'agent_messages.agent_messages_author_select, agent_tool_executions.agent_tool_executions_author_or_admin_select, '
     || 'agent_tool_executions.agent_tool_executions_author_update' THEN
    failures := failures || format('[12. policies inattendues : %s] ', coalesce(names, 'aucune'));
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'assistant_conversations_audit : %', failures;
  END IF;
  RAISE NOTICE 'assistant_conversations_audit : 14 contrôles passés';
END $$;
