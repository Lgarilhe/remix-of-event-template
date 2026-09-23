-- =====================================================================
-- job_favorites (épingles de missions) : barre latérale, lot 5.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/job_favorites_audit.sql; ROLLBACK;
-- Vérifie la migration *_barre_lot5_epingles.sql : une seule policy « mes
-- lignes » (own_rows_all), plus de lecture entre collègues (fuite de la base
-- neuve, CLAUDE.md règle 7), unicité (user_id, job_id). Écritures du front :
-- user_id et job_id seulement, jamais de colonne d'organisation.
-- Utilisateurs A et B dans l'organisation O1, C dans O2 (ids fixes).
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '81111111-1111-4111-8111-111111111111';
  u_b uuid := '82222222-2222-4222-8222-222222222222';
  u_c uuid := '83333333-3333-4333-8333-333333333333';
  o1 uuid := '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@pins.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@pins.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@pins.test')::text;
  n integer;
  pname text;
  failures text := '';
BEGIN
  -- Jeu de données : A propriétaire de O1, B membre de O1, C propriétaire de O2.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@pins.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@pins.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@pins.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Pins Org 1', 'pins-org-1', u_a),
         (o2, 'Pins Org 2', 'pins-org-2', u_c);
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

  -- ===== Contexte : A =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. A épingle p1 (user_id et job_id seulement, comme le front).
  BEGIN
    INSERT INTO public.job_favorites (user_id, job_id) VALUES (u_a, 'p1');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[1. insertion de A : %s] ', SQLERRM);
  END;

  -- 2. A relit ses épingles : 1 ligne.
  SELECT count(*) INTO n FROM public.job_favorites;
  IF n <> 1 THEN
    failures := failures || format('[2. A voit %s ligne(s), attendu 1] ', n);
  END IF;

  -- ===== Contexte : B (même organisation) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 3. B ne lit pas les épingles de A (plus de lecture ouverte à l'organisation).
  SELECT count(*) INTO n FROM public.job_favorites;
  IF n <> 0 THEN
    failures := failures || format('[3. B voit %s ligne(s) de A] ', n);
  END IF;

  -- 4. B n'écrit pas une épingle au nom de A.
  BEGIN
    INSERT INTO public.job_favorites (user_id, job_id) VALUES (u_a, 'p2');
    failures := failures || '[4. B a inséré une épingle au nom de A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[4. insertion de B : %s] ', SQLERRM);
    END IF;
  END;

  -- 5. B ne supprime pas l'épingle de A : 0 ligne touchée.
  BEGIN
    DELETE FROM public.job_favorites WHERE user_id = u_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
      failures := failures || format('[5. B a supprimé %s ligne(s) de A] ', n);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[5. suppression par B : %s] ', SQLERRM);
  END;

  -- ===== Contexte : C (autre organisation) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 6. C ne lit rien.
  SELECT count(*) INTO n FROM public.job_favorites;
  IF n <> 0 THEN
    failures := failures || format('[6. C voit %s ligne(s)] ', n);
  END IF;

  -- ===== Contexte : A =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 5 (suite). L'épingle de A existe toujours.
  SELECT count(*) INTO n FROM public.job_favorites WHERE job_id = 'p1';
  IF n <> 1 THEN
    failures := failures || format('[5. après la suppression par B, A voit %s ligne(s) p1] ', n);
  END IF;

  -- 7. Doublon (A, p1) refusé.
  BEGIN
    INSERT INTO public.job_favorites (user_id, job_id) VALUES (u_a, 'p1');
    failures := failures || '[7. doublon (A, p1) accepté] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[7. doublon : %s] ', SQLERRM);
  END;

  RESET ROLE;

  -- 8. Une seule policy, own_rows_all.
  SELECT count(*), min(policyname) INTO n, pname FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'job_favorites';
  IF n <> 1 OR pname IS DISTINCT FROM 'own_rows_all' THEN
    failures := failures || format('[8. %s policies (%s), attendu 1 : own_rows_all] ', n, coalesce(pname, 'aucune'));
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'job_favorites_audit : %', failures;
  END IF;
  RAISE NOTICE 'job_favorites_audit : 8 contrôles passés';
END $$;
