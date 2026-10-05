-- =====================================================================
-- candidate_photos (copie privée des photos des candidats) : design simplifié, lot P.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/candidate_photos_audit.sql; ROLLBACK;
-- Vérifie la migration *_photos_candidats_copie_privee.sql : bucket privé
-- (200 ko, JPEG, PNG, WebP), une seule policy de lecture sur ses fichiers,
-- table lue par les membres de l'organisation et jamais écrite par le
-- navigateur, fonctions réservées à la clé de service, réclamation des photos
-- à copier (jamais « stored » ni « erased », reprise d'un lien changé),
-- copies orphelines, effacement en cascade avec l'organisation (clé étrangère).
-- A propriétaire de O1, C propriétaire de O2. Les fichiers du bucket ne sont
-- pas écrits ici (tables internes du stockage, voir org_logos_storage_audit.sql).
-- Aucune fonction n'est appelée sous SET ROLE authenticated hors de celles que
-- la policy évalue (CLAUDE.md). Les contrôles sont accumulés ; une exception
-- finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'e1111111-1111-4111-8111-111111111111';
  u_c uuid := 'e3333333-3333-4333-8333-333333333333';
  o1 uuid := 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  p1 uuid := 'ea000000-0000-4000-8000-000000000001';
  p2 uuid := 'eb000000-0000-4000-8000-000000000002';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@photos.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@photos.test')::text;
  n integer;
  v_text text;
  v_bool boolean;
  pr text;
  fn text;
  failures text := '';
BEGIN
  -- 1. Bucket privé, 200 ko, JPEG, PNG et WebP seulement.
  SELECT count(*) INTO n FROM storage.buckets
   WHERE id = 'candidate-photos' AND NOT public AND file_size_limit = 204800
     AND allowed_mime_types::text[] @> ARRAY['image/jpeg', 'image/png', 'image/webp']
     AND cardinality(allowed_mime_types) = 3;
  IF n <> 1 THEN failures := failures || '[1. bucket candidate-photos absent, public ou mal borné] '; END IF;

  -- 2. Fichiers du bucket : une seule policy, en lecture, pour authenticated.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%candidate-photos%';
  SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ') INTO v_text FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%candidate-photos%';
  IF n <> 1 OR v_text <> 'SELECT:authenticated' THEN
    failures := failures || format('[2. policies du bucket : %s (%s), attendu SELECT:authenticated] ', n, v_text);
  END IF;

  -- 3. Table : RLS active, une seule policy, en lecture, pour authenticated.
  SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = 'public.candidate_photos'::regclass;
  SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ') INTO v_text FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'candidate_photos';
  IF NOT coalesce(v_bool, false) OR v_text IS DISTINCT FROM 'SELECT:authenticated' THEN
    failures := failures || format('[3. RLS %s, policies %s] ', v_bool, v_text);
  END IF;

  -- 4. Privilèges : rien pour anon, lecture seule pour authenticated, tout pour service_role.
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.candidate_photos', pr) THEN
      failures := failures || format('[4. anon a %s] ', pr);
    END IF;
    IF pr <> 'SELECT' AND has_table_privilege('authenticated', 'public.candidate_photos', pr) THEN
      failures := failures || format('[4. authenticated a %s] ', pr);
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.candidate_photos', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.candidate_photos', 'INSERT, UPDATE, DELETE') THEN
    failures := failures || '[4. lecture authenticated ou écriture service_role manquante] ';
  END IF;

  -- 5. Fonctions : exécutables par la clé de service seulement.
  FOREACH fn IN ARRAY ARRAY[
    'public.claim_candidate_photos(integer)',
    'public.list_candidate_photo_orphans(integer)',
    'public.invoke_capture_candidate_photos()'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE')
       OR has_function_privilege('public', fn, 'EXECUTE') THEN
      failures := failures || format('[5. %s exécutable hors service_role] ', fn);
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      failures := failures || format('[5. %s refusée à service_role] ', fn);
    END IF;
  END LOOP;

  -- 6. Effacement en cascade avec l'organisation.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.candidate_photos'::regclass AND contype = 'f'
     AND confrelid = 'public.organizations'::regclass AND confdeltype = 'c';
  IF n <> 1 THEN failures := failures || '[6. clé vers organizations sans ON DELETE CASCADE] '; END IF;

  -- Jeu de données : A propriétaire de O1 (mission P1), C propriétaire de O2 (mission P2).
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@photos.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@photos.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Photos Org 1', 'photos-org-1', u_a),
         (o2, 'Photos Org 2', 'photos-org-2', u_c);
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner'
     OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (p1, 'Mission Photos 1', o1, u_a),
         (p2, 'Mission Photos 2', o2, u_c);
  -- Ph-1 : petite photo ; Ph-2 : grande photo seulement ; Ph-3 : pas de photo ;
  -- Ph-4 : lien non http ; Ph-1 aussi dans O2 (une copie par organisation).
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, linkedin_profile_url, linkedin_profile_data)
  VALUES
    ('Ph-1', 'project:' || p1, p1, o1, u_a, 'https://www.linkedin.com/in/ph-1',
     '{"profile_picture_url": "https://media.licdn.com/ph-1-small.jpg", "profile_picture_url_large": "https://media.licdn.com/ph-1-large.jpg"}'),
    ('Ph-2', 'project:' || p1, p1, o1, u_a, 'https://www.linkedin.com/in/ph-2',
     '{"profile_picture_url_large": "https://media.licdn.com/ph-2-large.jpg"}'),
    ('Ph-3', 'project:' || p1, p1, o1, u_a, 'https://www.linkedin.com/in/ph-3', '{"first_name": "Sans"}'),
    ('Ph-4', 'project:' || p1, p1, o1, u_a, 'https://www.linkedin.com/in/ph-4', '{"profile_picture_url": "data:image/png;base64,AAAA"}'),
    ('Ph-1', 'project:' || p2, p2, o2, u_c, 'https://www.linkedin.com/in/ph-1',
     '{"profile_picture_url": "https://media.licdn.com/ph-1-o2.jpg"}');

  -- Les autres organisations sont mises de côté le temps de l'audit (ROLLBACK) :
  -- leurs candidats ne passent ni dans les réclamations ni dans les orphelins.
  UPDATE public.candidate_photos SET status = 'erased', storage_path = NULL
   WHERE organization_id NOT IN (o1, o2);
  INSERT INTO public.candidate_photos (organization_id, candidate_id, status)
  SELECT DISTINCT j.organization_id, j.candidate_id, 'erased'
    FROM public.job_candidate_status j
   WHERE j.organization_id IS NOT NULL AND j.organization_id NOT IN (o1, o2)
     AND char_length(j.candidate_id) BETWEEN 1 AND 512
  ON CONFLICT DO NOTHING;

  -- 7. Première réclamation : les trois candidats avec un lien http, une fois chacun, avec le bon
  --    lien ; sans lien http (Ph-3, Ph-4) : « skipped », no_url, rien à télécharger.
  CREATE TEMP TABLE claim_1 ON COMMIT DROP AS SELECT * FROM public.claim_candidate_photos(25);
  SELECT string_agg(organization_id::text || '/' || candidate_id || '=' || picture_url || '#' || attempts,
                    ' ' ORDER BY organization_id, candidate_id) INTO v_text
    FROM claim_1 WHERE organization_id IN (o1, o2);
  IF v_text IS DISTINCT FROM format('%s/Ph-1=https://media.licdn.com/ph-1-small.jpg#0 %s/Ph-2=https://media.licdn.com/ph-2-large.jpg#0 %s/Ph-1=https://media.licdn.com/ph-1-o2.jpg#0', o1, o1, o2) THEN
    failures := failures || format('[7. première réclamation : %s] ', v_text);
  END IF;
  SELECT count(*) INTO n FROM public.candidate_photos WHERE organization_id IN (o1, o2) AND status = 'pending';
  IF n <> 3 THEN failures := failures || format('[7. %s ligne(s) pending, attendu 3] ', n); END IF;
  SELECT string_agg(candidate_id || ':' || status || ':' || coalesce(last_error, '-'), ' ' ORDER BY candidate_id) INTO v_text
    FROM public.candidate_photos WHERE organization_id = o1 AND candidate_id IN ('Ph-3', 'Ph-4');
  IF v_text IS DISTINCT FROM 'Ph-3:skipped:no_url Ph-4:skipped:no_url' THEN
    failures := failures || format('[7. candidats sans lien : %s] ', v_text);
  END IF;

  -- 8. Réclamation suivante : rien (copies en cours, candidats sans lien déjà examinés).
  SELECT count(*) INTO n FROM public.claim_candidate_photos(25) WHERE organization_id IN (o1, o2);
  IF n <> 0 THEN failures := failures || format('[8. %s ligne(s) réclamée(s) deux fois] ', n); END IF;

  -- 9. Une copie en cours abandonnée depuis 15 minutes est reprise.
  UPDATE public.candidate_photos SET checked_at = now() - interval '20 minutes'
   WHERE organization_id = o1 AND candidate_id = 'Ph-2';
  SELECT string_agg(candidate_id, ' ') INTO v_text FROM public.claim_candidate_photos(25) WHERE organization_id IN (o1, o2);
  IF v_text IS DISTINCT FROM 'Ph-2' THEN failures := failures || format('[9. reprise d''une copie abandonnée : %s] ', v_text); END IF;

  -- 10. « stored » demande un chemin, et un chemin demande « stored ».
  BEGIN
    UPDATE public.candidate_photos SET status = 'stored', storage_path = NULL
     WHERE organization_id = o1 AND candidate_id = 'Ph-1';
    failures := failures || '[10. « stored » sans chemin accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.candidate_photos SET status = 'failed', storage_path = o1::text || '/x.jpg'
     WHERE organization_id = o1 AND candidate_id = 'Ph-1';
    failures := failures || '[10. chemin sans « stored » accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 11. Ni « stored » ni « erased » ne sont repris, même vieux et avec un lien changé.
  UPDATE public.candidate_photos
     SET status = 'stored', storage_path = o1::text || '/ph1.jpg', checked_at = now() - interval '2 days'
   WHERE organization_id = o1 AND candidate_id = 'Ph-1';
  UPDATE public.candidate_photos SET status = 'erased', checked_at = now() - interval '2 days'
   WHERE organization_id = o1 AND candidate_id = 'Ph-2';
  UPDATE public.job_candidate_status
     SET linkedin_profile_data = '{"profile_picture_url": "https://media.licdn.com/nouveau.jpg"}'
   WHERE organization_id = o1 AND candidate_id IN ('Ph-1', 'Ph-2');
  SELECT count(*) INTO n FROM public.claim_candidate_photos(25) WHERE organization_id = o1;
  IF n <> 0 THEN failures := failures || format('[11. %s copie(s) « stored » ou « erased » reprise(s)] ', n); END IF;

  -- L'horloge d'une transaction ne bouge pas : pour simuler « la ligne change après
  -- le dernier examen », l'examen est reculé d'une minute avant chaque changement.

  -- 12. « failed » : repris une heure après, trois essais au plus (l'examen sans suite
  --     avance checked_at) ; un lien changé remet les essais à zéro.
  UPDATE public.candidate_photos SET status = 'failed', attempts = 1, checked_at = now() - interval '2 hours'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  SELECT string_agg(candidate_id || '#' || attempts, ' ') INTO v_text FROM public.claim_candidate_photos(25) WHERE organization_id = o2;
  IF v_text IS DISTINCT FROM 'Ph-1#1' THEN failures := failures || format('[12. reprise d''un échec : %s] ', v_text); END IF;
  UPDATE public.candidate_photos SET status = 'failed', attempts = 3, checked_at = now() - interval '2 hours'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  SELECT count(*) INTO n FROM public.claim_candidate_photos(25) WHERE organization_id = o2;
  IF n <> 0 THEN failures := failures || '[12. un quatrième essai sur le même lien] '; END IF;
  SELECT count(*) INTO n FROM public.candidate_photos
   WHERE organization_id = o2 AND candidate_id = 'Ph-1' AND status = 'failed' AND attempts = 3 AND checked_at = now();
  IF n <> 1 THEN failures := failures || '[12. examen sans suite : état changé ou checked_at non avancé] '; END IF;
  UPDATE public.candidate_photos SET checked_at = now() - interval '1 minute'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  UPDATE public.job_candidate_status
     SET linkedin_profile_data = '{"profile_picture_url": "https://media.licdn.com/ph-1-o2-nouveau.jpg"}'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  SELECT string_agg(picture_url || '#' || attempts, ' ') INTO v_text FROM public.claim_candidate_photos(25) WHERE organization_id = o2;
  IF v_text IS DISTINCT FROM 'https://media.licdn.com/ph-1-o2-nouveau.jpg#0' THEN
    failures := failures || format('[12. lien changé après trois échecs : %s] ', v_text);
  END IF;

  -- 13. « expired » : pas repris sur le même lien, repris sur un lien changé.
  UPDATE public.candidate_photos SET status = 'expired', checked_at = now() - interval '2 days'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  SELECT count(*) INTO n FROM public.claim_candidate_photos(25) WHERE organization_id = o2;
  IF n <> 0 THEN failures := failures || '[13. lien expiré repris sans changement] '; END IF;
  UPDATE public.candidate_photos SET checked_at = now() - interval '1 minute'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  UPDATE public.job_candidate_status
     SET linkedin_profile_data = '{"profile_picture_url": "https://media.licdn.com/ph-1-o2-encore.jpg"}'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  SELECT count(*) INTO n FROM public.claim_candidate_photos(25) WHERE organization_id = o2;
  IF n <> 1 THEN failures := failures || format('[13. lien expiré puis changé : %s réclamation(s), attendu 1] ', n); END IF;

  -- 14. Un candidat sans lien est repris quand sa ligne en reçoit un.
  UPDATE public.candidate_photos SET checked_at = now() - interval '1 minute'
   WHERE organization_id = o1 AND candidate_id = 'Ph-3';
  UPDATE public.job_candidate_status
     SET linkedin_profile_data = '{"profile_picture_url": "https://media.licdn.com/ph-3.jpg"}'
   WHERE organization_id = o1 AND candidate_id = 'Ph-3';
  SELECT string_agg(candidate_id || '=' || picture_url, ' ') INTO v_text
    FROM public.claim_candidate_photos(25) WHERE organization_id IN (o1, o2);
  IF v_text IS DISTINCT FROM 'Ph-3=https://media.licdn.com/ph-3.jpg' THEN
    failures := failures || format('[14. candidat qui reçoit un lien : %s] ', v_text);
  END IF;

  -- 15. Profils lus par passage : quatre fois la limite au plus, chaque candidat examiné marqué.
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, linkedin_profile_url, linkedin_profile_data)
  SELECT 'Ph-n' || g, 'project:' || p1, p1, o1, u_a, 'https://www.linkedin.com/in/ph-n' || g, '{"first_name": "Sans"}'
    FROM generate_series(1, 6) g;
  SELECT count(*) INTO n FROM public.claim_candidate_photos(1) WHERE organization_id IN (o1, o2);
  SELECT n * 100 + count(*) INTO n FROM public.candidate_photos WHERE organization_id = o1 AND candidate_id LIKE 'Ph-n%';
  IF n <> 4 THEN failures := failures || format('[15. premier passage (limite 1) : %s, attendu 0 réclamation et 4 examens] ', n); END IF;
  PERFORM public.claim_candidate_photos(1);
  SELECT count(*) INTO n FROM public.candidate_photos
   WHERE organization_id = o1 AND candidate_id LIKE 'Ph-n%' AND status = 'skipped' AND last_error = 'no_url';
  IF n <> 6 THEN failures := failures || format('[15. second passage : %s candidat(s) examiné(s), attendu 6] ', n); END IF;

  -- 16. Lecture par les membres : A voit O1 seulement, C voit O2 seulement ; aucune écriture.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT string_agg(DISTINCT organization_id::text, ' ') INTO v_text FROM public.candidate_photos
   WHERE organization_id IN (o1, o2);
  IF v_text IS DISTINCT FROM o1::text THEN failures := failures || format('[16. A lit les organisations %s] ', v_text); END IF;
  BEGIN
    INSERT INTO public.candidate_photos (organization_id, candidate_id, status) VALUES (o1, 'Ph-9', 'erased');
    failures := failures || '[16. A a inséré une ligne] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[16. insertion de A : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.candidate_photos SET status = 'skipped', storage_path = NULL WHERE organization_id = o1;
    failures := failures || '[16. A a modifié une ligne] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[16. modification de A : %s] ', SQLERRM);
  END;
  BEGIN
    DELETE FROM public.candidate_photos WHERE organization_id = o1;
    failures := failures || '[16. A a supprimé une ligne] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[16. suppression de A : %s] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  SET LOCAL ROLE authenticated;
  SELECT string_agg(DISTINCT organization_id::text, ' ') INTO v_text FROM public.candidate_photos
   WHERE organization_id IN (o1, o2);
  IF v_text IS DISTINCT FROM o2::text THEN failures := failures || format('[16. C lit les organisations %s] ', v_text); END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- 17. Copies orphelines : candidat sorti du pipeline de l'organisation, hors « pending » et « erased ».
  UPDATE public.candidate_photos SET status = 'stored', storage_path = o2::text || '/ph1.jpg'
   WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  DELETE FROM public.job_candidate_status WHERE organization_id = o2 AND candidate_id = 'Ph-1';
  DELETE FROM public.job_candidate_status WHERE organization_id = o1 AND candidate_id = 'Ph-2';
  SELECT string_agg(organization_id::text || '/' || candidate_id || '=' || coalesce(storage_path, '-'), ' ') INTO v_text
    FROM public.list_candidate_photo_orphans(50) WHERE organization_id IN (o1, o2);
  IF v_text IS DISTINCT FROM format('%s/Ph-1=%s/ph1.jpg', o2, o2) THEN
    failures := failures || format('[17. orphelins : %s] ', v_text);
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'candidate_photos_audit : %', failures;
  END IF;
  RAISE NOTICE 'candidate_photos_audit : 17 contrôles passés';
END $$;
