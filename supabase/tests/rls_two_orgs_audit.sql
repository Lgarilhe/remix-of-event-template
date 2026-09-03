-- =====================================================================
-- Test RLS à deux organisations — audit 2026-09-01 (constats critiques).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, après la migration
-- 20260903074500_rls_catchup_audit_critiques.sql :
--   BEGIN; \i supabase/tests/rls_two_orgs_audit.sql; ROLLBACK;
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Les utilisateurs et organisations créés sont synthétiques (ids fixes).
-- Aucun ALTER TABLE : pas de verrou exclusif sur une table de production.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '11111111-1111-4111-8111-111111111111';
  u_b uuid := '22222222-2222-4222-8222-222222222222';
  org_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  proj_a uuid := 'a0000000-0000-4000-8000-000000000001';
  proj_b uuid := 'b0000000-0000-4000-8000-000000000001';
  n int;
  v_org uuid;
  failures text := '';
  timings text := '';
  t_prev timestamptz := clock_timestamp();
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@audit.test')::text;
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@audit.test')::text;
BEGIN
  -- Jeu de données : deux users, deux orgs (owner = créateur), un projet chacun.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (org_a, 'Audit Org A', 'audit-org-a', u_a), (org_b, 'Audit Org B', 'audit-org-b', u_b);
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (proj_a, 'Projet A', org_a, u_a), (proj_b, 'Projet B', org_b, u_b);

  -- Org A : un candidat CAND-1 avec une note confidentielle.
  INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
  VALUES ('CAND-1', 'project:' || proj_a::text, proj_a, org_a, u_a);
  INSERT INTO public.candidate_notes (candidate_id, content, organization_id, created_by)
  VALUES ('CAND-1', 'note privée org A', org_a, u_a);

  -- Chaîne d'attaque SEC-001 : B se met dans mission_team de SON projet et
  -- déclare le même candidat CAND-1 dans SON org.
  INSERT INTO public.mission_team (project_id, user_id, role) VALUES (proj_b, u_b, 'lead');
  INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
  VALUES ('CAND-1', 'project:' || proj_b::text, proj_b, org_b, u_b);
  timings := timings || format('setup=%sms ', round(extract(epoch from clock_timestamp() - t_prev) * 1000)); t_prev := clock_timestamp();

  -- ===== Contexte : user B (rôle authenticated) =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', 'b@audit.test', true);
  SET LOCAL ROLE authenticated;

  -- 1. SEC-001 : B ne lit plus la note de l'org A sur CAND-1.
  BEGIN
    SELECT count(*) INTO n FROM public.candidate_notes WHERE candidate_id = 'CAND-1' AND organization_id = org_a;
    IF n <> 0 THEN failures := failures || format('[SEC-001 lecture : B lit %s note(s) de A] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEC-001 lecture : %s] ', SQLERRM);
  END;
  timings := timings || format('sec001r=%sms ', round(extract(epoch from clock_timestamp() - t_prev) * 1000)); t_prev := clock_timestamp();

  -- 2. SEC-001 (écriture) : B ne peut pas insérer une note portant l'org A.
  BEGIN
    INSERT INTO public.candidate_notes (candidate_id, content, organization_id, created_by)
    VALUES ('CAND-1', 'injection', org_a, u_b);
    failures := failures || '[SEC-001 écriture : B insère une note dans A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEC-001 écriture : %s] ', SQLERRM);
  END;

  -- 3. SEC-009 : B (mission_team de proj_b) ne peut pas écrire un
  --    job_candidate_status portant l'org A sur son projet.
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
    VALUES ('CAND-2', 'project:' || proj_b::text, proj_b, org_a, u_b);
    failures := failures || '[SEC-009 : B injecte une ligne ATS dans A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEC-009 : %s] ', SQLERRM);
  END;

  -- 4. SEC-008/033 : B ne peut plus forger un extension_token lié à l'org A.
  BEGIN
    INSERT INTO public.extension_tokens (user_id, organization_id, token_hash, token_prefix)
    VALUES (u_b, org_a, 'hash-' || u_b::text, 'kekt_x');
    failures := failures || '[SEC-033 : B forge un token extension pour A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEC-033 : %s] ', SQLERRM);
  END;

  -- 5. SEC-003 : B ne peut pas créer une invitation mission (son org) sur le projet de A.
  BEGIN
    INSERT INTO public.mission_invitations (email, invited_by, organization_id, project_id, role)
    VALUES ('x@audit.test', u_b, org_b, proj_a, 'sourcer');
    failures := failures || '[SEC-003 : invitation org B sur projet A acceptée] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEC-003 : %s] ', SQLERRM);
  END;
  timings := timings || format('writes=%sms ', round(extract(epoch from clock_timestamp() - t_prev) * 1000)); t_prev := clock_timestamp();

  -- 6. BUG-002 / SEC-034 : la lecture des invitations ne lève plus « permission denied for table users ».
  BEGIN
    SELECT count(*) INTO n FROM public.organization_invitations;
    SELECT count(*) INTO n FROM public.mission_invitations;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[BUG-002 : %s] ', SQLERRM);
  END;

  -- 7. SEC-010 : message_analysis_cache n'est plus lisible en clair.
  BEGIN
    SELECT count(*) INTO n FROM public.message_analysis_cache;
    IF n <> 0 THEN failures := failures || format('[SEC-010 : %s ligne(s) visibles sans compte] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEC-010 : %s] ', SQLERRM);
  END;
  timings := timings || format('reads=%sms ', round(extract(epoch from clock_timestamp() - t_prev) * 1000)); t_prev := clock_timestamp();

  RESET ROLE;

  -- 8. SEC-032 : un membre retiré perd son org active (trigger) et
  --    get_user_org_id refuse une org sans appartenance (JOIN).
  --    A rejoint l'org B, la prend comme org active, puis en est retiré.
  --    (Deux utilisateurs seulement : chaque insertion dans auth.users
  --    coûte plusieurs secondes en prod.)
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_b, u_a, 'admin');
    UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = u_a;
    PERFORM set_config('app.user_org.u_' || replace(u_a::text, '-', '_'), '', true);
    IF public.get_user_org_id(u_a) IS DISTINCT FROM org_b THEN failures := failures || '[SEC-032 : membre légitime sans org active] '; END IF;
    DELETE FROM public.organization_members WHERE user_id = u_a AND organization_id = org_b;
    SELECT active_organization_id INTO v_org FROM public.profiles WHERE user_id = u_a;
    IF v_org IS NOT NULL THEN failures := failures || '[SEC-032 : active_organization_id non remis à zéro au retrait] '; END IF;
    -- Profil pointant encore vers l'org (état hérité) : la fonction doit refuser.
    -- Réinsertion directe (validate_active_org ne couvre que l'UPDATE).
    DELETE FROM public.profiles WHERE user_id = u_a;
    INSERT INTO public.profiles (user_id, active_organization_id) VALUES (u_a, org_b);
    PERFORM set_config('app.user_org.u_' || replace(u_a::text, '-', '_'), '', true);
    IF public.get_user_org_id(u_a) IS NOT NULL THEN failures := failures || '[SEC-032 : get_user_org_id renvoie une org sans appartenance] '; END IF;
    -- Remise en état pour le contrôle 10.
    UPDATE public.profiles SET active_organization_id = org_a WHERE user_id = u_a;
    PERFORM set_config('app.user_org.u_' || replace(u_a::text, '-', '_'), '', true);
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEC-032 : %s] ', SQLERRM);
  END;

  -- 9. SEC-018 : une invitation role=owner est refusée par la contrainte.
  BEGIN
    INSERT INTO public.organization_invitations (email, invited_by, organization_id, token, role)
    VALUES ('o@audit.test', u_a, org_a, 'tok-owner', 'owner');
    failures := failures || '[SEC-018 : invitation owner acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEC-018 : %s] ', SQLERRM);
  END;
  timings := timings || format('admin=%sms ', round(extract(epoch from clock_timestamp() - t_prev) * 1000)); t_prev := clock_timestamp();

  -- 10. Le membre légitime (A) lit toujours ses propres données.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.candidate_notes WHERE candidate_id = 'CAND-1';
    IF n <> 1 THEN failures := failures || format('[Régression : A ne lit plus sa note (%s)] ', n); END IF;
    SELECT count(*) INTO n FROM public.job_candidate_status WHERE candidate_id = 'CAND-1' AND project_id = proj_a;
    IF n <> 1 THEN failures := failures || format('[Régression : A ne lit plus son ATS (%s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression A : %s] ', SQLERRM);
  END;
  RESET ROLE;
  timings := timings || format('regression=%sms', round(extract(epoch from clock_timestamp() - t_prev) * 1000));

  IF failures <> '' THEN
    RAISE EXCEPTION 'rls_two_orgs_audit : contrôles en échec %  (durées : %)', failures, timings;
  END IF;
  RAISE NOTICE 'rls_two_orgs_audit : 10 contrôles OK (durées : %)', timings;
END $$;
