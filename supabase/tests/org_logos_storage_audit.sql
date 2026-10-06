-- =====================================================================
-- Audit du stockage des logos d'organisation (bucket org-logos) —
-- Paramètres, lot 1.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, après la migration
-- 20260923095813_parametres_lot1_organisation.sql :
--   BEGIN; \i supabase/tests/org_logos_storage_audit.sql; ROLLBACK;
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Les lignes de storage.objects sont écrites en SQL, sous le rôle que prend
-- l'API de stockage (authenticated ou anon) : aucun fichier réel. Les bornes
-- du bucket (taille, formats) sont appliquées par l'API et ne se vérifient
-- ici que dans le catalogue.
-- Un refus attendu ne passe que sur 42501 (ou 0 ligne pour une lecture,
-- une modification ou une suppression) ; un « accepté » échoue sur toute
-- exception. La garde anti-DELETE direct des versions récentes du schéma
-- storage est levée pour la transaction : une exception « Direct deletion »
-- n'est jamais comptée comme un refus.
-- Hors CI : cet audit écrit directement dans storage.objects, dont les
-- déclencheurs internes (préfixes, garde anti-DELETE) changent selon la
-- version de Supabase. À lancer à la main sur une base `supabase start`
-- après toute migration qui touche aux policies du stockage.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '81111111-1111-4111-8111-111111111111';  -- propriétaire de A
  u_b uuid := '82222222-2222-4222-8222-222222222222';  -- propriétaire de B, puis membre, collaborateur et admin de A
  org_a uuid := '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated')::text;
  f_owner text := '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo-owner.png';
  f_admin text := '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo-admin.png';
  types text[] := ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  v_public boolean;
  v_limit bigint;
  v_types text[];
  v_list text;
  n int;
  failures text := '';
BEGIN
  -- L0. La RLS de storage.objects est active : sans elle, aucun contrôle
  --     ci-dessous n'est concluant.
  SELECT count(*) INTO n FROM pg_class WHERE oid = 'storage.objects'::regclass AND relrowsecurity;
  IF n <> 1 THEN failures := failures || '[L0 : RLS inactive sur storage.objects] '; END IF;

  -- L1. Bucket public, 2 Mo, quatre formats, pas de SVG.
  SELECT bk.public, bk.file_size_limit, bk.allowed_mime_types INTO v_public, v_limit, v_types
    FROM storage.buckets bk WHERE bk.id = 'org-logos';
  IF NOT FOUND THEN
    failures := failures || '[L1 : bucket org-logos absent] ';
  ELSIF NOT v_public OR v_limit IS DISTINCT FROM 2097152
        OR v_types IS NULL OR NOT (v_types @> types AND v_types <@ types) THEN
    failures := failures || format('[L1 : bornes %s / %s / %s] ', v_public, v_limit, v_types);
  END IF;

  -- L2. Policies de mars retirées.
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('Org members can upload logos', 'Org logos are publicly readable', 'Org admins can delete logos');
  IF n <> 0 THEN failures := failures || format('[L2 : %s policy(s) de mars encore là] ', n); END IF;

  -- L3. Règle 7 : toute policy de storage.objects filtre sur bucket_id ; les
  --     quatre org_logos_admins_* couvrent SELECT, INSERT, UPDATE et DELETE,
  --     pour authenticated seulement.
  SELECT string_agg(policyname, ', ') INTO v_list FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%bucket_id%';
  IF v_list IS NOT NULL THEN failures := failures || format('[L3 : policies sans filtre de bucket : %s] ', v_list); END IF;
  SELECT string_agg(cmd, ',' ORDER BY cmd) INTO v_list FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'org\_logos\_admins\_%' AND roles = ARRAY['authenticated']::name[];
  IF v_list IS DISTINCT FROM 'DELETE,INSERT,SELECT,UPDATE' THEN
    failures := failures || format('[L3 : policies org_logos_admins_* TO authenticated : %s] ', coalesce(v_list, 'aucune'));
  END IF;

  -- Jeu de données (propriétaire = créateur, posé par handle_new_organization).
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'logo-a@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'logo-b@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (org_a, 'Audit Logo A', 'audit-logo-a', u_a), (org_b, 'Audit Logo B', 'audit-logo-b', u_b);
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  -- ===== Propriétaire de A =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- L4. Il écrit dans le dossier de son organisation, puis y remplace le fichier.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', f_owner);
    UPDATE storage.objects SET metadata = '{"audit": "owner"}'::jsonb WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[L4 : propriétaire, remplacement : %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[L4 : propriétaire refusé : %s] ', SQLERRM);
  END;
  -- L5. Rien hors de son dossier : racine du bucket, fichier nommé comme
  --     l'organisation, dossier qui ne fait que commencer par son id,
  --     dossier d'une autre organisation.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', 'logo-racine.png');
    failures := failures || '[L5 : fichier à la racine accepté] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L5 racine : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_a::text);
    failures := failures || '[L5 : fichier nommé comme l''organisation accepté] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L5 nom : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_a::text || '-copie/logo.png');
    failures := failures || '[L5 : dossier préfixé accepté] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L5 préfixe : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_b::text || '/intrus.png');
    failures := failures || '[L5 : écriture dans le dossier de B acceptée] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L5 dossier B : %s] ', SQLERRM);
  END;
  -- L6. Il ne déplace pas un logo vers le dossier de B (WITH CHECK de l'UPDATE).
  BEGIN
    UPDATE storage.objects SET name = org_b::text || '/vol.png' WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[L6 : déplacement vers B accepté (%s ligne(s))] ', n);
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L6 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- ===== u_b, propriétaire de B, étranger à A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- L7. Ni écriture, ni lecture, ni modification, ni suppression dans A.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_a::text || '/intrus.png');
    failures := failures || '[L7 : un étranger écrit dans A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L7 écriture : %s] ', SQLERRM);
  END;
  BEGIN
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'org-logos' AND name LIKE org_a::text || '/%';
    IF n <> 0 THEN failures := failures || format('[L7 : un étranger liste %s objet(s) de A] ', n); END IF;
    UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[L7 : un étranger modifie un logo de A] '; END IF;
    DELETE FROM storage.objects WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[L7 : un étranger supprime un logo de A] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[L7 lecture/modification : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- u_b devient membre simple de A (claims vides : enforce_role_hierarchy
  -- ne bloque que le rôle owner).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_b, 'member');

  -- ===== u_b membre simple de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- L8. Un membre n'écrit, ne liste, ne modifie ni ne supprime rien.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_a::text || '/logo-membre.png');
    failures := failures || '[L8 : un membre écrit un logo] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L8 écriture : %s] ', SQLERRM);
  END;
  BEGIN
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'org-logos' AND name = f_owner;
    IF n <> 0 THEN failures := failures || '[L8 : un membre liste les logos] '; END IF;
    UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[L8 : un membre modifie un logo] '; END IF;
    DELETE FROM storage.objects WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[L8 : un membre supprime un logo] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[L8 lecture/modification : %s] ', SQLERRM);
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
  -- L9. Un collaborateur n'écrit pas.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_a::text || '/logo-collaborateur.png');
    failures := failures || '[L9 : un collaborateur écrit un logo] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L9 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'admin' WHERE organization_id = org_a AND user_id = u_b;

  -- ===== u_b administrateur de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- L10. Un administrateur écrit, liste, remplace et supprime dans A.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', f_admin);
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'org-logos' AND name IN (f_owner, f_admin);
    IF n <> 2 THEN failures := failures || format('[L10 : l''admin liste %s logo(s) sur 2] ', n); END IF;
    UPDATE storage.objects SET metadata = '{"audit": "admin"}'::jsonb WHERE bucket_id = 'org-logos' AND name = f_admin;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[L10 : l''admin ne remplace pas (%s ligne(s))] ', n); END IF;
    DELETE FROM storage.objects WHERE bucket_id = 'org-logos' AND name = f_owner;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[L10 : l''admin ne supprime pas (%s ligne(s))] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[L10 : %s] ', SQLERRM);
  END;
  -- L11. L'administrateur de A n'écrit pas pour autant hors de A.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', 'logo-racine-admin.png');
    failures := failures || '[L11 : l''admin écrit à la racine] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L11 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- ===== Propriétaire de A =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- L12. Le propriétaire supprime le logo envoyé par l'administrateur.
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'org-logos' AND name = f_admin;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[L12 : le propriétaire ne supprime pas (%s ligne(s))] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[L12 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- Un logo en place pour le contrôle anonyme (écrit hors RLS).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', f_owner);

  -- ===== Anonyme =====
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;
  -- L13. L'API ne liste rien et n'accepte rien du public (l'URL publique,
  --      elle, ne passe pas par la RLS).
  BEGIN
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'org-logos';
    IF n <> 0 THEN failures := failures || format('[L13 : l''anonyme liste %s logo(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[L13 lecture : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-logos', org_a::text || '/anonyme.png');
    failures := failures || '[L13 : l''anonyme écrit un logo] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[L13 écriture : %s] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  IF failures <> '' THEN
    RAISE EXCEPTION 'org_logos_storage_audit : contrôles en échec %', failures;
  END IF;
  RAISE NOTICE 'org_logos_storage_audit : 14 contrôles OK';
END $$;
