-- =====================================================================
-- Actions programmées de l'assistant, lot « scheduled-1 » : la file
-- agent_tool_executions est infalsifiable côté client.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/seq_scheduled_1_audit.sql; ROLLBACK;
--
-- file-infalsifiable-cote-client : le cron process-scheduled-actions exécute
--   toute ligne « approved », échue (scheduled_for passé), sans executed_at.
--   Un client authentifié ne doit pouvoir ni créer une telle ligne, ni en
--   fabriquer une à partir des siennes : pas d'INSERT, pas de passage en
--   « approved », pas d'écriture de scheduled_for, executed_at, tool_name,
--   dry_run_result, ni de params après approbation (trigger
--   guard_agent_tool_execution_update, migration 20260903074500, § 8). Il ne
--   touche jamais la ligne d'un collègue ni d'une autre organisation (RLS
--   org_members_update). Il ne lit que ses propres lignes, sauf propriétaire
--   et administrateur (RLS org_members_select, D3). anon n'a aucun accès.
--   Contrôles témoins : les transitions utilisées par l'interface (rejet,
--   annulation d'une programmation non réservée, remise en attente d'un échec,
--   paramètres avant approbation) restent possibles.
--
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'a5111111-1111-4111-8111-111111111111';  -- propriétaire, org A
  u_c uuid := 'a5333333-3333-4333-8333-333333333333';  -- membre, org A (collègue)
  u_b uuid := 'a5222222-2222-4222-8222-222222222222';  -- propriétaire, org B
  org_a uuid := 'a5aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := 'a5bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  r_prop uuid := 'a5e00000-0000-4000-8000-000000000001';  -- A, proposed
  r_appr uuid := 'a5e00000-0000-4000-8000-000000000002';  -- A, approved, programmée dans 2 h
  r_resv uuid := 'a5e00000-0000-4000-8000-000000000003';  -- A, approved, réservation interrompue (11 min)
  r_live uuid := 'a5e00000-0000-4000-8000-000000000004';  -- A, approved, réservée à l'instant (en cours)
  r_done uuid := 'a5e00000-0000-4000-8000-000000000005';  -- A, executed
  r_fail uuid := 'a5e00000-0000-4000-8000-000000000006';  -- A, failed
  r_coll uuid := 'a5e00000-0000-4000-8000-000000000007';  -- C (collègue), approved, programmée
  r_b    uuid := 'a5e00000-0000-4000-8000-000000000008';  -- B (autre org), approved, programmée
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@seq-scheduled-1.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@seq-scheduled-1.test')::text;
  claims_anon text := json_build_object('role', 'anon')::text;
  failures text := '';
  checks int := 0;
  n int;
  v_status text;
  v_sched timestamptz;
  v_exec timestamptz;
  msg text;
BEGIN
  -- ===== Jeu de données (rôle postgres, trigger inactif hors « authenticated ») =====
  -- Clé de service simulée pendant le seed (enforce_role_hierarchy : le trigger
  -- de création d'organisation pose déjà le propriétaire).
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@seq-scheduled-1.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@seq-scheduled-1.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@seq-scheduled-1.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org_a, 'Seq Scheduled 1 A', 'seq-scheduled-1-a', u_a, 'agency'),
         (org_b, 'Seq Scheduled 1 B', 'seq-scheduled-1-b', u_b, 'agency');
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_a, 'owner'), (org_a, u_c, 'member'), (org_b, u_b, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, org_a), (u_c, org_a), (u_b, org_b)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  PERFORM set_config('request.jwt.claim.role', '', true);

  INSERT INTO public.agent_tool_executions (id, user_id, organization_id, tool_name, params, status, dry_run_result, real_result, scheduled_for, approved_at, executed_at)
  VALUES
    (r_prop, u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour"}', 'proposed',
     '{"summary":"Envoyer un message LinkedIn à Camille"}', NULL, NULL, NULL, NULL),
    (r_appr, u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour"}', 'approved',
     '{"summary":"Envoyer un message LinkedIn à Camille"}', NULL, now() + interval '2 hours', now(), NULL),
    (r_resv, u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour"}', 'approved',
     '{"summary":"Envoyer un message LinkedIn à Camille"}', NULL, now() - interval '1 hour', now() - interval '2 hours', now() - interval '11 minutes'),
    (r_live, u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour"}', 'approved',
     '{"summary":"Envoyer un message LinkedIn à Camille"}', NULL, now() - interval '1 minute', now() - interval '2 hours', now()),
    (r_done, u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour"}', 'executed',
     '{"summary":"Envoyer un message LinkedIn à Camille"}', '{"success":true}', now() - interval '2 hours', now() - interval '3 hours', now() - interval '1 hour'),
    (r_fail, u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour"}', 'failed',
     '{"summary":"Envoyer un message LinkedIn à Camille"}', '{"success":false,"error":"x"}', now() - interval '2 hours', now() - interval '3 hours', now() - interval '1 hour'),
    (r_coll, u_c, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS2","text":"Bonjour"}', 'approved',
     '{"summary":"Message du collègue"}', NULL, now() + interval '2 hours', now(), NULL),
    (r_b, u_b, org_b, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS3","text":"Bonjour"}', 'approved',
     '{"summary":"Message de l''autre organisation"}', NULL, now() + interval '2 hours', now(), NULL);

  -- ===== Contexte : propriétaire A (rôle authenticated) =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', 'a@seq-scheduled-1.test', true);
  SET LOCAL ROLE authenticated;

  -- 1. Aucun INSERT client : une ligne « approved » échue fabriquée de toutes pièces est refusée.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.agent_tool_executions (user_id, organization_id, tool_name, params, status, scheduled_for, dry_run_result)
    VALUES (u_a, org_a, 'send_linkedin_message', '{"recipient_provider_id":"ACoAAAUDITS9","text":"x"}', 'approved', now() - interval '1 minute', '{"summary":"forgée"}');
    failures := failures || '[1. INSERT client accepté] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[1. INSERT : erreur inattendue %s] ', SQLERRM);
  END;

  -- 2 à 13 : chaque écriture interdite doit lever l'exception du trigger (message « agent_tool_executions: … »).
  -- 2. proposed → approved (contourner l'approbation serveur).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'approved' WHERE id = r_prop;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[2. proposed → approved accepté (%s ligne)] ', n);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%transition proposed vers approved interdite%' THEN failures := failures || format('[2. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 3. scheduled_for posé par le client (rendre une ligne échue).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET scheduled_for = now() WHERE id = r_prop;
    failures := failures || '[3. scheduled_for écrit par le client (proposed)] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%scheduled_for réservé au serveur%' THEN failures := failures || format('[3. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 4. executed_at posé par le client.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET executed_at = now() WHERE id = r_prop;
    failures := failures || '[4. executed_at écrit par le client] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%executed_at réservé au serveur%' THEN failures := failures || format('[4. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 5. tool_name changé (exécuter un autre outil que celui proposé).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET tool_name = 'enroll_in_sequence' WHERE id = r_prop;
    failures := failures || '[5. tool_name modifié par le client] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%colonne non modifiable%' THEN failures := failures || format('[5. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 6. dry_run_result réécrit (aperçu qui porterait un details.scheduled_for de son choix).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET dry_run_result = '{"summary":"x","details":{"scheduled_for":"2020-01-01T00:00:00Z"}}' WHERE id = r_prop;
    failures := failures || '[6. dry_run_result modifié par le client] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%colonne non modifiable%' THEN failures := failures || format('[6. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 7. Identité de la ligne (user_id vers le collègue, organization_id vers B).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET user_id = u_c WHERE id = r_prop;
    failures := failures || '[7a. user_id modifié par le client] ';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET organization_id = org_b WHERE id = r_prop;
    failures := failures || '[7b. organization_id modifié par le client] ';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 8. params d'une ligne approuvée (viser un autre destinataire après approbation).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET params = '{"recipient_provider_id":"ACoAAAUDITS9","text":"autre"}' WHERE id = r_appr;
    failures := failures || '[8. params modifiés après approbation] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%paramètres modifiables uniquement avant approbation%' THEN failures := failures || format('[8. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 9. scheduled_for avancé sur une ligne programmée (la rendre échue tout de suite).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET scheduled_for = now() - interval '1 minute' WHERE id = r_appr;
    failures := failures || '[9. scheduled_for avancé par le client (approved)] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%scheduled_for réservé au serveur%' THEN failures := failures || format('[9. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 10. Statuts finaux ou retour arrière écrits par le client sur une ligne approuvée.
  FOREACH v_status IN ARRAY ARRAY['executed', 'failed', 'proposed', 'auto_executed'] LOOP
    checks := checks + 1;
    BEGIN
      UPDATE public.agent_tool_executions SET status = v_status WHERE id = r_appr;
      failures := failures || format('[10. approved → %s accepté] ', v_status);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%interdite côté client%' THEN failures := failures || format('[10. approved → %s : message inattendu %s] ', v_status, SQLERRM); END IF;
    END;
  END LOOP;

  -- 11. Annulation après réservation (executed_at posé par le cron) : refusée.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'rejected', scheduled_for = NULL WHERE id = r_live;
    failures := failures || '[11. annulation d''une action réservée acceptée] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%transition approved vers rejected interdite%' THEN failures := failures || format('[11. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 12. executed_at effacé sur une réservation interrompue : la ligne redeviendrait
  --     approved + échue + executed_at NULL, donc rejouée par le cron alors que
  --     l'envoi a pu partir (SEQ-114 : jamais rejouée).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET executed_at = NULL WHERE id = r_resv;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN failures := failures || '[12. executed_at effacé par le client sur une réservation interrompue : ligne réarmée pour le cron] '; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 13. executed_at effacé sur une réservation en cours : un second passage du cron l'exécuterait une deuxième fois.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET executed_at = NULL WHERE id = r_live;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN failures := failures || '[13. executed_at effacé par le client sur une réservation en cours : double exécution possible] '; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 14. failed → approved, executed → approved : refusés.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'approved', executed_at = NULL, real_result = NULL WHERE id = r_fail;
    failures := failures || '[14a. failed → approved accepté] ';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'approved', executed_at = NULL WHERE id = r_done;
    failures := failures || '[14b. executed → approved accepté] ';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 15. Remise en attente d'un échec AVEC changement de params dans la même écriture : refusée.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions
    SET status = 'proposed', params = '{"recipient_provider_id":"ACoAAAUDITS9","text":"autre"}'
    WHERE id = r_fail;
    failures := failures || '[15. failed → proposed avec nouveaux params accepté] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%paramètres modifiables uniquement avant approbation%' THEN failures := failures || format('[15. message inattendu : %s] ', SQLERRM); END IF;
  END;

  -- 16. Ligne d'un collègue (même organisation) : aucune écriture (0 ligne).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'rejected', scheduled_for = NULL, user_note = 'annulée par A' WHERE id = r_coll;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[16. A annule la ligne du collègue (%s ligne)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[16. erreur inattendue : %s] ', SQLERRM);
  END;

  -- 17. Ligne d'une autre organisation : ni lecture ni écriture.
  checks := checks + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.agent_tool_executions WHERE id = r_b;
    IF n <> 0 THEN failures := failures || '[17a. A lit la ligne de l''organisation B] '; END IF;
    UPDATE public.agent_tool_executions SET status = 'rejected', scheduled_for = NULL WHERE id = r_b;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[17b. A modifie la ligne de l''organisation B (%s ligne)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[17. erreur inattendue : %s] ', SQLERRM);
  END;

  -- 18. Aucun DELETE client (effacer la trace d'une action).
  checks := checks + 1;
  BEGIN
    DELETE FROM public.agent_tool_executions WHERE id = r_done;
    failures := failures || '[18. DELETE client accepté] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[18. DELETE : erreur inattendue %s] ', SQLERRM);
  END;

  -- ===== Témoins : les écritures de l'interface restent possibles =====
  -- 19. params modifiés avant approbation.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET params = '{"recipient_provider_id":"ACoAAAUDITS1","text":"Bonjour, modifié"}', user_note = 'édité' WHERE id = r_prop;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[19. témoin : params avant approbation refusés (%s ligne)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[19. témoin params : %s] ', SQLERRM);
  END;

  -- 20. Annulation d'une programmation non réservée (bouton « Annuler la programmation »).
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'rejected', user_note = 'annulée', scheduled_for = NULL
    WHERE id = r_appr AND status = 'approved' AND executed_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[20. témoin : annulation d''une programmation refusée (%s ligne)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[20. témoin annulation : %s] ', SQLERRM);
  END;

  -- 21. Remise en attente d'un échec (bouton « Relancer »), comme l'interface.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions
    SET status = 'proposed', real_result = NULL, executed_at = NULL, approved_at = NULL, scheduled_for = NULL, proposed_at = now()
    WHERE id = r_fail AND status = 'failed';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[21. témoin : remise en attente refusée (%s ligne)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[21. témoin remise en attente : %s] ', SQLERRM);
  END;

  -- 22. Rejet d'une proposition.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET status = 'rejected' WHERE id = r_prop;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[22. témoin : rejet refusé (%s ligne)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[22. témoin rejet : %s] ', SQLERRM);
  END;

  -- 28. Lecture (D3) : le propriétaire voit la ligne du collègue (portée « Toute l'organisation »).
  checks := checks + 1;
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE id = r_coll;
  IF n <> 1 THEN failures := failures || format('[28. propriétaire : ligne du collègue invisible (%s)] ', n); END IF;

  RESET ROLE;

  -- ===== Contexte : collègue, membre de A (rôle authenticated) =====
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', 'c@seq-scheduled-1.test', true);
  SET LOCAL ROLE authenticated;

  -- 29. Lecture (D3) : hors propriétaire et administrateur, chacun ne lit que ses
  --     propres lignes (params et résultats des actions d'un collègue non exposés).
  checks := checks + 1;
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE organization_id = org_a AND user_id <> u_c;
  IF n <> 0 THEN failures := failures || format('[29. le collègue lit %s ligne(s) du propriétaire] ', n); END IF;
  SELECT count(*) INTO n FROM public.agent_tool_executions WHERE id = r_coll;
  IF n <> 1 THEN failures := failures || format('[29. le collègue ne lit pas sa propre ligne (%s)] ', n); END IF;

  RESET ROLE;

  -- ===== Contexte : anon =====
  PERFORM set_config('request.jwt.claims', claims_anon, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;

  -- 23. anon : pas d'INSERT.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.agent_tool_executions (user_id, organization_id, tool_name, status, scheduled_for)
    VALUES (u_a, org_a, 'send_linkedin_message', 'approved', now() - interval '1 minute');
    failures := failures || '[23. INSERT anon accepté] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[23. INSERT anon : erreur inattendue %s] ', SQLERRM);
  END;

  -- 24. anon : ni lecture ni écriture d'une ligne existante.
  checks := checks + 1;
  BEGIN
    UPDATE public.agent_tool_executions SET scheduled_for = now() - interval '1 minute' WHERE id = r_coll;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[24a. UPDATE anon : %s ligne modifiée] ', n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[24a. UPDATE anon : erreur inattendue %s] ', SQLERRM);
  END;
  checks := checks + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.agent_tool_executions;
    IF n <> 0 THEN failures := failures || format('[24b. anon lit %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[24b. SELECT anon : erreur inattendue %s] ', SQLERRM);
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- ===== Relecture en clé de service : lignes d'autrui intactes =====
  checks := checks + 1;
  SELECT status, scheduled_for INTO v_status, v_sched FROM public.agent_tool_executions WHERE id = r_coll;
  IF v_status <> 'approved' OR v_sched IS NULL OR v_sched <= now() THEN
    failures := failures || format('[25. ligne du collègue altérée : %s, %s] ', v_status, v_sched);
  END IF;
  checks := checks + 1;
  SELECT status, scheduled_for INTO v_status, v_sched FROM public.agent_tool_executions WHERE id = r_b;
  IF v_status <> 'approved' OR v_sched IS NULL OR v_sched <= now() THEN
    failures := failures || format('[26. ligne de l''organisation B altérée : %s, %s] ', v_status, v_sched);
  END IF;
  -- 27. Invariant final : aucune ligne du jeu de données n'est devenue exécutable par le cron
  --     (approved, échue, executed_at NULL) du fait d'une écriture client.
  checks := checks + 1;
  SELECT count(*) INTO n FROM public.agent_tool_executions
  WHERE organization_id IN (org_a, org_b) AND status = 'approved' AND executed_at IS NULL
    AND scheduled_for IS NOT NULL AND scheduled_for <= now();
  IF n <> 0 THEN failures := failures || format('[27. %s ligne(s) rendue(s) exécutable(s) par le cron depuis le client] ', n); END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'seq_scheduled_1_audit : contrôles en échec (% au total) : %', checks, failures;
  END IF;
  RAISE NOTICE 'seq_scheduled_1_audit : % contrôles OK', checks;
END $$;
