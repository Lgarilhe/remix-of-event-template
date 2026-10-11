-- Base locale uniquement, dans BEGIN / ROLLBACK (CI e2e).
-- Entretien exact, isolation des organisations/auteurs, reprise concurrente,
-- marqueurs serveur et conservation des avis après suppression de l'entretien.
DO $$
DECLARE
  ua uuid := 'f1111111-1111-4111-8111-111111111111';
  ub uuid := 'f2222222-2222-4222-8222-222222222222';
  uc uuid := 'f3333333-3333-4333-8333-333333333333';
  oa uuid := 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  ob uuid := 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  pa uuid := 'fa000000-0000-4000-8000-000000000001';
  pb uuid := 'fa000000-0000-4000-8000-000000000002';
  qa uuid := 'fa100000-0000-4000-8000-000000000001';
  qb uuid := 'fb100000-0000-4000-8000-000000000002';
  qn uuid := 'fa100000-0000-4000-8000-000000000003';
  ga uuid;
  gb uuid;
  old_token uuid := gen_random_uuid();
  new_token uuid := gen_random_uuid();
  n integer;
  failed boolean;
  bad record;
  failures text := '';
BEGIN
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (ua, 'a@interview-scorecard.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
         (ub, 'b@interview-scorecard.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
         (uc, 'c@interview-scorecard.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (oa, 'Interview A', 'interview-scorecard-a', ua), (ob, 'Interview B', 'interview-scorecard-b', uc);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (oa, ub, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (ua, oa), (ub, oa), (uc, ob)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, created_by, organization_id)
  VALUES (pa, 'Interview mission A', ua, oa), (pb, 'Interview mission B', ua, oa);
  INSERT INTO public.qualification_sessions (id, created_by, organization_id, candidate_profile_id, project_id)
  VALUES (qa, ua, oa, 'interview-candidate', pa),
         (qb, uc, ob, 'interview-candidate', NULL),
         (qn, ua, oa, 'interview-candidate', NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- La grille ancienne sans entretien reste autorisée, même en plusieurs copies.
  INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id)
  VALUES ('legacy-candidate', ua, oa), ('legacy-candidate', ua, oa);
  INSERT INTO public.candidate_evaluations
    (candidate_id, created_by, organization_id, project_id, qualification_session_id, summary)
  VALUES ('interview-candidate', ua, oa, pa, qa, 'Avis à conserver') RETURNING id INTO ga;
  INSERT INTO public.candidate_evaluations
    (candidate_id, created_by, organization_id, qualification_session_id)
  VALUES ('interview-candidate', ua, oa, qn);

  failed := false;
  BEGIN
    INSERT INTO public.candidate_evaluations
      (candidate_id, created_by, organization_id, project_id, qualification_session_id)
    VALUES ('interview-candidate', ua, oa, pa, qa);
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[doublon auteur/entretien] '; END IF;

  FOR bad IN SELECT * FROM (VALUES
    ('autre candidat', 'other-candidate', oa, pa, qa),
    ('autre mission', 'interview-candidate', oa, pb, qa),
    ('mission absente', 'interview-candidate', oa, NULL::uuid, qa),
    ('mission ajoutée', 'interview-candidate', oa, pa, qn),
    ('autre organisation', 'interview-candidate', ob, pa, qa),
    ('entretien invisible', 'interview-candidate', oa, NULL::uuid, qb)
  ) AS cases(label, candidate, org, project, session) LOOP
    failed := false;
    BEGIN
      INSERT INTO public.candidate_evaluations
        (candidate_id, created_by, organization_id, project_id, qualification_session_id)
      VALUES (bad.candidate, ua, bad.org, bad.project, bad.session);
    EXCEPTION WHEN check_violation THEN failed := true;
    END;
    IF NOT failed THEN failures := failures || '[' || bad.label || '] '; END IF;
  END LOOP;

  failed := false;
  BEGIN
    UPDATE public.candidate_evaluations SET candidate_id = 'other-candidate' WHERE id = ga;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[réaffectation de la grille] '; END IF;
  failed := false;
  BEGIN
    UPDATE public.candidate_evaluations SET project_id = pb WHERE id = ga;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[changement mission grille] '; END IF;

  failed := false;
  BEGIN
    UPDATE public.qualification_sessions SET candidate_profile_id = 'other-candidate' WHERE id = qa;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[réaffectation candidat entretien] '; END IF;
  failed := false;
  BEGIN
    UPDATE public.qualification_sessions SET project_id = pb WHERE id = qa;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[réaffectation mission entretien] '; END IF;
  failed := false;
  BEGIN
    UPDATE public.qualification_sessions SET organization_id = ob WHERE id = qa;
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[réaffectation organisation entretien] '; END IF;
  UPDATE public.qualification_sessions SET event_start_at = now() + interval '1 day', notes = 'Reporté' WHERE id = qa;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || '[modification des horaires] '; END IF;

  failed := false;
  BEGIN
    UPDATE public.candidate_evaluations SET preparation_status = 'ready' WHERE id = ga;
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[marqueur navigateur UPDATE] '; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id, preparation_token)
    VALUES ('legacy-candidate', ua, oa, gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[marqueur navigateur INSERT] '; END IF;
  RESET ROLE;

  -- Un collègue garde son avis distinct et ne peut pas écraser celui de A.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ub::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.candidate_evaluations
    (candidate_id, created_by, organization_id, project_id, qualification_session_id)
  VALUES ('interview-candidate', ub, oa, pa, qa) RETURNING id INTO gb;
  UPDATE public.candidate_evaluations SET summary = 'Avis écrasé' WHERE id = ga;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || '[avis autre auteur modifiable] '; END IF;
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE qualification_session_id = qa;
  IF n <> 2 THEN failures := failures || '[avis partagés dans équipe] '; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uc::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE qualification_session_id = qa;
  IF n <> 0 THEN failures := failures || '[avis visibles autre organisation] '; END IF;
  RESET ROLE;

  -- Réservation et reprise serveur : un ancien résultat ne finalise pas la
  -- nouvelle préparation. Les marqueurs n'interfèrent pas avec les notes.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  UPDATE public.candidate_evaluations
    SET preparation_status = 'preparing', preparation_token = old_token, preparation_started_at = now()
    WHERE id = ga;
  UPDATE public.candidate_evaluations SET preparation_token = new_token
    WHERE id = ga AND preparation_token = old_token;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || '[reprise serveur] '; END IF;
  UPDATE public.candidate_evaluations SET preparation_status = 'ready'
    WHERE id = ga AND preparation_token = old_token;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || '[ancienne préparation finalisée] '; END IF;

  UPDATE public.qualification_sessions SET status = 'cancelled' WHERE id = qa;
  failed := false;
  BEGIN
    UPDATE public.candidate_evaluations SET preparation_status = 'ready'
      WHERE id = ga AND preparation_token = new_token;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[préparation publiée après annulation] '; END IF;

  UPDATE public.qualification_sessions SET status = 'scheduled', manager_id = ub WHERE id = qa;
  failed := false;
  BEGIN
    UPDATE public.candidate_evaluations SET preparation_status = 'ready'
      WHERE id = ga AND preparation_token = new_token;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[préparation publiée après changement recruteur] '; END IF;

  UPDATE public.qualification_sessions SET status = 'in_progress', manager_id = NULL WHERE id = qa;
  UPDATE public.candidate_evaluations SET preparation_status = 'ready'
    WHERE id = ga AND preparation_token = new_token;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || '[préparation active non finalisée] '; END IF;
  UPDATE public.qualification_sessions SET status = 'completed', manager_id = ub WHERE id = qa;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ua::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.candidate_evaluations SET follow_up_notes = 'Notes éditables' WHERE id = ga;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || '[édition après préparation] '; END IF;
  -- Le garde voit aussi une grille appartenant uniquement au collègue.
  UPDATE public.candidate_evaluations SET qualification_session_id = NULL WHERE id = ga;
  failed := false;
  BEGIN
    UPDATE public.qualification_sessions SET candidate_profile_id = 'other-candidate' WHERE id = qa;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[grille collègue invisible au garde] '; END IF;
  UPDATE public.candidate_evaluations SET qualification_session_id = qa WHERE id = ga;
  DELETE FROM public.qualification_sessions WHERE id = qa;
  SELECT count(*) INTO n FROM public.candidate_evaluations
    WHERE id IN (ga, gb) AND qualification_session_id IS NULL;
  IF n <> 2 THEN failures := failures || '[suppression entretien perd les avis] '; END IF;
  SELECT count(*) INTO n FROM public.candidate_evaluations
    WHERE id = ga AND summary = 'Avis à conserver' AND preparation_status = 'ready';
  IF n <> 1 THEN failures := failures || '[contenu perdu après suppression] '; END IF;
  RESET ROLE;

  -- Une préparation détachée par suppression d'entretien ne doit pas publier
  -- tardivement son résultat ; une grille déjà terminée reste conservée.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  UPDATE public.candidate_evaluations SET preparation_status = 'preparing' WHERE id = gb;
  failed := false;
  BEGIN
    UPDATE public.candidate_evaluations SET preparation_status = 'ready' WHERE id = gb;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  IF NOT failed THEN failures := failures || '[préparation publiée après suppression] '; END IF;
  RESET ROLE;

  IF failures <> '' THEN
    RAISE EXCEPTION 'interview_scorecard_attachment_audit : %', failures;
  END IF;
  RAISE NOTICE 'interview_scorecard_attachment_audit : tous les contrôles passent';
END;
$$;
