-- =====================================================================
-- mission_action_snoozes (« Plus tard » de la carte Maintenant) : lot 3.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/mission_action_snoozes_audit.sql; ROLLBACK;
-- Vérifie la migration *_refonte_mission_lot3_plus_tard.sql : un report n'est
-- lu et écrit que par son auteur (own_rows_all), la mission d'un report est
-- celle de l'organisation active de l'auteur (policies RESTRICTIVE
-- mission_same_org_*, mission étrangère ou inexistante refusée par la même
-- erreur), unicité (user_id, project_id, action_key), format de la clé,
-- instant du report posé par le serveur, privilèges, effacement en cascade
-- avec la mission et avec le compte. Écritures du front : user_id, project_id,
-- action_key et expires_at seulement.
-- Utilisateurs A et B dans l'organisation O1 (mission P1), C dans O2 (mission
-- P2), D sans organisation. Les contrôles sont accumulés ; une exception
-- finale liste ceux en échec. Aucune fonction n'est appelée sous
-- SET ROLE authenticated hors de celles que la policy évalue (CLAUDE.md).
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'f1111111-1111-4111-8111-111111111111';
  u_b uuid := 'f2222222-2222-4222-8222-222222222222';
  u_c uuid := 'f3333333-3333-4333-8333-333333333333';
  u_d uuid := 'f4444444-4444-4444-8444-444444444444';
  o1 uuid := 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  p1 uuid := 'fa000000-0000-4000-8000-000000000001';
  p2 uuid := 'fb000000-0000-4000-8000-000000000002';
  p_none uuid := 'fc000000-0000-4000-8000-0000000000ff';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@snooze.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@snooze.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@snooze.test')::text;
  v_id uuid;
  v_exp timestamptz;
  v_exp_first timestamptz;
  v_upd timestamptz;
  n integer;
  rec record;
  pr text;
  failures text := '';
BEGIN
  -- Jeu de données : A propriétaire de O1, B membre de O1, C propriétaire de O2, D seul.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@snooze.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@snooze.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@snooze.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_d, 'd@snooze.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Snooze Org 1', 'snooze-org-1', u_a),
         (o2, 'Snooze Org 2', 'snooze-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur on_organization_created.
  -- Sans auth.uid(), enforce_role_hierarchy laisse passer le rôle member.
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member');
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner'
     OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, o1), (u_b, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (p1, 'Mission Snooze 1', o1, u_a),
         (p2, 'Mission Snooze 2', o2, u_c);

  -- ===== Contexte : A =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. A reporte une réponse (user_id, project_id, action_key, expires_at seulement), relue par RETURNING.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p1, 'reply:cand-1', now() + interval '1 day')
    RETURNING id, expires_at INTO v_id, v_exp_first;
    IF v_id IS NULL THEN
      failures := failures || '[1. insertion de A : aucune ligne relue] ';
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[1. insertion de A : %s] ', SQLERRM);
  END;

  -- 2. A relit ses reports : 1 ligne.
  SELECT count(*) INTO n FROM public.mission_action_snoozes;
  IF n <> 1 THEN
    failures := failures || format('[2. A voit %s ligne(s), attendu 1] ', n);
  END IF;

  -- 3. Report répété (upsert du front, ON CONFLICT sur la clé) : toujours 1 ligne, échéance mise à jour.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p1, 'reply:cand-1', now() + interval '2 days')
    ON CONFLICT (user_id, project_id, action_key) DO UPDATE
      SET expires_at = EXCLUDED.expires_at
    RETURNING expires_at INTO v_exp;
    SELECT count(*) INTO n FROM public.mission_action_snoozes;
    IF n <> 1 OR v_exp <= v_exp_first THEN
      failures := failures || format('[3. upsert de A : %s ligne(s), échéance %s après %s] ', n, v_exp, v_exp_first);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[3. upsert de A : %s] ', SQLERRM);
  END;

  -- 4. L'instant d'un report répété est posé par le serveur : un updated_at ancien
  --    envoyé par le client est ignoré au report suivant (déclencheur BEFORE UPDATE).
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at, updated_at)
    VALUES (u_a, p1, 'reply:cand-1', now() + interval '1 day', now() - interval '30 days')
    ON CONFLICT (user_id, project_id, action_key) DO UPDATE
      SET expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
    RETURNING updated_at INTO v_upd;
    IF v_upd < now() - interval '1 minute' THEN
      failures := failures || format('[4. updated_at fixé par le client : %s] ', v_upd);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[4. report répété : %s] ', SQLERRM);
  END;

  -- 5. A ne reporte pas sur la mission d'une autre organisation.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p2, 'to_sort', now() + interval '1 day');
    failures := failures || '[5. A a inséré un report sur la mission de O2] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[5. insertion sur la mission de O2 : %s] ', SQLERRM);
  END;

  -- 6. A n'écrit pas un report au nom de B.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_b, p1, 'to_sort', now() + interval '1 day');
    failures := failures || '[6. A a inséré un report au nom de B] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[6. insertion au nom de B : %s] ', SQLERRM);
  END;

  -- 7. Une mission inexistante est refusée par la même erreur de RLS que celle d'une autre
  --    organisation : aucune violation de clé étrangère (pas de test d'existence).
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p_none, 'to_sort', now() + interval '1 day');
    failures := failures || '[7. report accepté sur une mission inexistante] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[7. mission inexistante : %s] ', SQLERRM);
  END;

  -- 8. A ne déplace pas son report vers la mission d'une autre organisation.
  BEGIN
    UPDATE public.mission_action_snoozes SET project_id = p2 WHERE user_id = u_a;
    failures := failures || '[8. A a déplacé un report vers la mission de O2] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[8. déplacement vers O2 : %s] ', SQLERRM);
  END;

  -- 9. A ne donne pas son report à B.
  BEGIN
    UPDATE public.mission_action_snoozes SET user_id = u_b WHERE user_id = u_a;
    failures := failures || '[9. A a changé le propriétaire d''un report] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[9. changement de propriétaire : %s] ', SQLERRM);
  END;

  -- 10. Format de la clé : majuscule, espace, vide refusés (CHECK), clé à identifiant acceptée.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p1, 'Reply X', now() + interval '1 day');
    failures := failures || '[10. clé « Reply X » acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[10. clé « Reply X » : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p1, '', now() + interval '1 day');
    failures := failures || '[10. clé vide acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[10. clé vide : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p1, 'to_sort', now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[10. clé to_sort : %s] ', SQLERRM);
  END;

  -- 11. Doublon (A, p1, clé) refusé à l'insertion simple.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_a, p1, 'to_sort', now() + interval '1 day');
    failures := failures || '[11. doublon (A, p1, to_sort) accepté] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[11. doublon : %s] ', SQLERRM);
  END;

  SELECT expires_at INTO v_exp FROM public.mission_action_snoozes WHERE action_key = 'reply:cand-1';

  -- ===== Contexte : B (même organisation) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 12. B ne lit pas les reports de A (même organisation, même mission).
  SELECT count(*) INTO n FROM public.mission_action_snoozes;
  IF n <> 0 THEN
    failures := failures || format('[12. B voit %s ligne(s) de A] ', n);
  END IF;

  -- 13. B ne supprime pas les reports de A : 0 ligne touchée.
  BEGIN
    DELETE FROM public.mission_action_snoozes WHERE user_id = u_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
      failures := failures || format('[13. B a supprimé %s ligne(s) de A] ', n);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[13. suppression par B : %s] ', SQLERRM);
  END;

  -- 14. B ne modifie pas les reports de A : 0 ligne touchée.
  BEGIN
    UPDATE public.mission_action_snoozes SET expires_at = now() + interval '30 days' WHERE user_id = u_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
      failures := failures || format('[14. B a modifié %s ligne(s) de A] ', n);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[14. modification par B : %s] ', SQLERRM);
  END;

  -- 15. B reporte la même action sur la même mission : un report par personne.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_b, p1, 'reply:cand-1', now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[15. insertion de B : %s] ', SQLERRM);
  END;
  SELECT count(*) INTO n FROM public.mission_action_snoozes;
  IF n <> 1 THEN
    failures := failures || format('[15. B voit %s ligne(s), attendu 1 (la sienne)] ', n);
  END IF;

  -- ===== Contexte : C (autre organisation) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 16. C ne lit rien.
  SELECT count(*) INTO n FROM public.mission_action_snoozes;
  IF n <> 0 THEN
    failures := failures || format('[16. C voit %s ligne(s)] ', n);
  END IF;

  -- 17. C ne reporte pas sur la mission de O1.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_c, p1, 'to_sort', now() + interval '1 day');
    failures := failures || '[17. C a inséré un report sur la mission de O1] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[17. insertion sur la mission de O1 : %s] ', SQLERRM);
  END;

  -- 18. C reporte sur sa propre mission.
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_c, p2, 'to_sort', now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[18. insertion de C sur sa mission : %s] ', SQLERRM);
  END;

  -- ===== Contexte : A =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 19. Les reports de A sont intacts après les tentatives de B et de C.
  SELECT count(*) INTO n FROM public.mission_action_snoozes WHERE action_key = 'reply:cand-1' AND expires_at = v_exp;
  IF n <> 1 THEN
    failures := failures || format('[19. report de A modifié ou supprimé : %s ligne(s) intactes] ', n);
  END IF;

  -- 20. A retire un report (le « Annuler » du front) : 1 ligne touchée.
  BEGIN
    DELETE FROM public.mission_action_snoozes WHERE user_id = u_a AND project_id = p1 AND action_key = 'to_sort';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      failures := failures || format('[20. suppression par A : %s ligne(s), attendu 1] ', n);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[20. suppression par A : %s] ', SQLERRM);
  END;

  RESET ROLE;

  -- 21. Trois policies, avec leur nature et leur commande.
  FOR rec IN
    SELECT * FROM (VALUES
      ('own_rows_all', 'PERMISSIVE', 'ALL'),
      ('mission_same_org_insert', 'RESTRICTIVE', 'INSERT'),
      ('mission_same_org_update', 'RESTRICTIVE', 'UPDATE')
    ) AS t(name, kind, cmd)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'mission_action_snoozes'
                     AND policyname = rec.name AND permissive = rec.kind AND cmd = rec.cmd) THEN
      failures := failures || format('[21. policy %s (%s, %s) absente] ', rec.name, rec.kind, rec.cmd);
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mission_action_snoozes';
  IF n <> 3 THEN
    failures := failures || format('[21. %s policies, attendu 3] ', n);
  END IF;

  -- 22. Privilèges : anon rien ; authenticated les quatre droits de lecture et d'écriture, ni TRUNCATE ni
  --     le reste ; service_role tout. La RLS est active.
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.mission_action_snoozes', pr) THEN
      failures := failures || format('[22. anon a le droit %s] ', pr);
    END IF;
    IF has_table_privilege('authenticated', 'public.mission_action_snoozes', pr) <> (pr IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) THEN
      failures := failures || format('[22. droit %s de authenticated incorrect] ', pr);
    END IF;
    IF NOT has_table_privilege('service_role', 'public.mission_action_snoozes', pr) THEN
      failures := failures || format('[22. service_role n''a pas le droit %s] ', pr);
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mission_action_snoozes'::regclass) THEN
    failures := failures || '[22. RLS inactive] ';
  END IF;

  -- 23. Un membre retiré de O1 n'écrit plus sur ses missions (profil remis sans organisation active),
  --     mais relit et supprime ce qui reste de ses reports.
  DELETE FROM public.organization_members WHERE organization_id = o1 AND user_id = u_b;
  -- get_user_org_id garde l'organisation de l'appelant le temps de la transaction
  -- (réglage app.user_org.u_<id>) : l'audit tient tout dans une seule, chaque
  -- requête réelle a la sienne. Cache vidé pour B.
  PERFORM set_config('app.user_org.u_' || replace(u_b::text, '-', '_'), '', true);
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
    VALUES (u_b, p1, 'to_sort', now() + interval '1 day');
    failures := failures || '[23. B retiré de O1 a inséré un report sur sa mission] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[23. insertion de B retiré : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.mission_action_snoozes SET expires_at = now() + interval '2 days' WHERE user_id = u_b;
    failures := failures || '[23. B retiré de O1 a modifié un report] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[23. modification de B retiré : %s] ', SQLERRM);
  END;
  DELETE FROM public.mission_action_snoozes WHERE user_id = u_b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    failures := failures || format('[23. B retiré supprime %s ligne(s), attendu 1] ', n);
  END IF;
  RESET ROLE;

  -- 24. Suppression d'une mission : ses reports disparaissent.
  DELETE FROM public.sourcing_projects WHERE id = p1;
  SELECT count(*) INTO n FROM public.mission_action_snoozes WHERE project_id = p1;
  IF n <> 0 THEN
    failures := failures || format('[24. %s report(s) restent après la suppression de la mission] ', n);
  END IF;

  -- 25. Suppression d'un compte : ses reports disparaissent, ceux des autres restent.
  INSERT INTO public.mission_action_snoozes (user_id, project_id, action_key, expires_at)
  VALUES (u_d, p2, 'to_sort', now() + interval '1 day');
  DELETE FROM auth.users WHERE id = u_d;
  SELECT count(*) INTO n FROM public.mission_action_snoozes WHERE user_id = u_d;
  IF n <> 0 THEN
    failures := failures || format('[25. %s report(s) restent après la suppression du compte] ', n);
  END IF;
  SELECT count(*) INTO n FROM public.mission_action_snoozes WHERE user_id = u_c;
  IF n <> 1 THEN
    failures := failures || format('[25. les reports de C : %s ligne(s), attendu 1] ', n);
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'mission_action_snoozes_audit : %', failures;
  END IF;
  RAISE NOTICE 'mission_action_snoozes_audit : 25 contrôles passés';
END $$;
