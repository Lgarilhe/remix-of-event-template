-- =====================================================================
-- Lot P, étape P-0b : refresh_candidate_pictures et ses aides.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/candidate_pictures_audit.sql; ROLLBACK;
-- Vérifie la migration *_photos_lot_p0b_rafraichir_adresses.sql :
--   A. échéance (paramètre e=), adresse échue, règle de remplacement
--      (https sur licdn.com, 2 048 caractères, pas échue dans moins d'un jour,
--      adresse enregistrée manquante ou échue dans moins de 3 jours, nouvelle
--      adresse plus tardive) ;
--   B. rafraîchissement : lignes de l'appelant seulement, les deux formes du
--      job_id, profil existant seulement, reste du profil intact, aucune
--      écriture quand l'adresse enregistrée est bonne (updated_at ne bouge
--      pas), étape et journal des écritures directes inchangés ;
--   C. refus : p_job_ids, p_items, lot de plus de 200, appel sans session ;
--   D. droits : jamais anon ni PUBLIC, SECURITY INVOKER.
-- Utilisateurs A et B dans l'organisation O1, C dans O2 (ids fixes).
-- Aucune fonction n'est appelée sous SET ROLE si elle est refusée à ce rôle
-- (CLAUDE.md, supautils) : les droits se lisent dans les catalogues.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '91111111-1111-4111-8111-111111111111';
  u_b uuid := '92222222-2222-4222-8222-222222222222';
  u_c uuid := '93333333-3333-4333-8333-333333333333';
  o1 uuid := '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  m1 uuid := '9ccccccc-cccc-4ccc-8ccc-cccccccccccc';
  m2 uuid := '9ddddddd-dddd-4ddd-8ddd-dddddddddddd';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@pics.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@pics.test')::text;
  jf_p text := 'project:' || m1;   -- forme avec préfixe
  jf_b text := m1::text;           -- forme nue
  old_ts timestamptz := now() - interval '2 days';
  far text;     -- échéance lointaine (30 jours)
  soon2 text;   -- dans 2 jours (en deçà de la marge de 3 jours)
  soon1h text;  -- dans 12 heures (refusée comme nouvelle adresse)
  past text;    -- échue
  base text := 'https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_100_100/0/1?e=';
  n integer;
  b boolean;
  ts timestamptz;
  d jsonb;
  returned integer;
  hint text;
  failures text := '';
  log_before bigint;
  log_after bigint;
  stage_before text;
  stage_after text;
BEGIN
  far   := base || extract(epoch from now() + interval '30 days')::bigint || '&v=beta&t=far';
  soon2 := base || extract(epoch from now() + interval '2 days')::bigint || '&v=beta&t=soon2';
  soon1h := base || extract(epoch from now() + interval '12 hours')::bigint || '&v=beta&t=soon1h';
  past  := base || extract(epoch from now() - interval '5 days')::bigint || '&v=beta&t=past';

  -- ===== A. Aides pures =====
  -- A1. Échéance lue dans e=, nulle sans e=, jamais confondue avec un autre paramètre.
  SELECT public.candidate_picture_expiry('https://media.licdn.com/x?e=1999999999&v=beta') INTO ts;
  IF ts IS DISTINCT FROM to_timestamp(1999999999) THEN
    failures := failures || format('[A1. e= lu %s] ', ts);
  END IF;
  SELECT public.candidate_picture_expiry('https://media.licdn.com/x?v=beta&e=1999999999') INTO ts;
  IF ts IS DISTINCT FROM to_timestamp(1999999999) THEN
    failures := failures || format('[A1. e= en second paramètre lu %s] ', ts);
  END IF;
  IF public.candidate_picture_expiry('https://media.licdn.com/x?v=beta') IS NOT NULL
     OR public.candidate_picture_expiry('https://media.licdn.com/x?te=1999999999') IS NOT NULL
     OR public.candidate_picture_expiry('https://media.licdn.com/x?e=abc') IS NOT NULL
     OR public.candidate_picture_expiry(NULL) IS NOT NULL THEN
    failures := failures || '[A1. échéance inventée pour une adresse sans e= valide] ';
  END IF;

  -- A2. Adresse échue ou manquante : à remplacer ; sans échéance : jugée bonne.
  IF NOT public.candidate_picture_is_stale(NULL)
     OR NOT public.candidate_picture_is_stale('')
     OR NOT public.candidate_picture_is_stale(past)
     OR NOT public.candidate_picture_is_stale(soon2) THEN
    failures := failures || '[A2. adresse manquante, échue ou à moins de 3 jours non vue comme à remplacer] ';
  END IF;
  IF public.candidate_picture_is_stale(far)
     OR public.candidate_picture_is_stale('https://media.licdn.com/x?v=beta') THEN
    failures := failures || '[A2. adresse bonne vue comme à remplacer] ';
  END IF;

  -- A3. Règle de remplacement.
  IF NOT public.candidate_picture_should_replace(far, NULL)
     OR NOT public.candidate_picture_should_replace(far, '')
     OR NOT public.candidate_picture_should_replace(far, past)
     OR NOT public.candidate_picture_should_replace(far, soon2)
     OR NOT public.candidate_picture_should_replace('https://media.licdn.com/x?v=beta', NULL)
     OR NOT public.candidate_picture_should_replace('https://media.licdn.com/x?v=beta', past) THEN
    failures := failures || '[A3. un remplacement légitime est refusé] ';
  END IF;
  IF public.candidate_picture_should_replace(far, far)
     OR public.candidate_picture_should_replace(far, 'https://media.licdn.com/x?v=beta')
     OR public.candidate_picture_should_replace('https://media.licdn.com/x?v=beta', far) THEN
    failures := failures || '[A3. une adresse enregistrée bonne est remplacée] ';
  END IF;
  -- Une adresse qui échoit dans 12 heures n'est pas retenue ; une adresse plus ancienne que l'enregistrée non plus.
  IF public.candidate_picture_should_replace(soon1h, NULL) THEN
    failures := failures || '[A3. adresse à moins d''un jour acceptée] ';
  END IF;
  IF public.candidate_picture_should_replace(
       base || extract(epoch from now() + interval '30 hours')::bigint,
       base || extract(epoch from now() + interval '60 hours')::bigint) THEN
    failures := failures || '[A3. adresse moins tardive que l''enregistrée acceptée] ';
  END IF;
  -- Hôte, schéma, forme.
  IF public.candidate_picture_should_replace('http://media.licdn.com/x?e=1999999999', NULL)
     OR public.candidate_picture_should_replace('https://evil.example/x?e=1999999999', NULL)
     OR public.candidate_picture_should_replace('https://licdn.com.evil.example/x', NULL)
     OR public.candidate_picture_should_replace('https://evil.example/licdn.com/x', NULL)
     OR public.candidate_picture_should_replace('https://media.licdn.com@evil.example/x', NULL)
     OR public.candidate_picture_should_replace('https://media.licdn.com:8443/x', NULL)
     OR public.candidate_picture_should_replace('https://media.licdn.com/x y', NULL)
     OR public.candidate_picture_should_replace('https://media.licdn.com/' || repeat('a', 2100), NULL)
     OR public.candidate_picture_should_replace(NULL, NULL)
     OR public.candidate_picture_should_replace('', NULL) THEN
    failures := failures || '[A3. une adresse hors règle est acceptée] ';
  END IF;

  -- ===== Jeu de données =====
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@pics.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@pics.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@pics.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Pics Org 1', 'pics-org-1', u_a),
         (o2, 'Pics Org 2', 'pics-org-2', u_c);
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
  VALUES (m1, 'Mission Pics 1', o1, u_a),
         (m2, 'Mission Pics 2', o1, u_a);

  -- Lignes de A (updated_at ancien : une écriture le ramène à now(), une absence d'écriture le laisse).
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, linkedin_profile_data, updated_at)
  VALUES
    -- r1 : profil sans photo, avec d'autres champs à préserver.
    ('pic-1', jf_p, m1, o1, u_a, 'discovered',
       jsonb_build_object('name', 'Un', 'headline', 'Titre', 'skills', jsonb_build_array('sql', 'node')), old_ts),
    -- r2 : petite photo échue, grande absente.
    ('pic-2', jf_p, m1, o1, u_a, 'discovered',
       jsonb_build_object('name', 'Deux', 'profile_picture_url', past), old_ts),
    -- r3 : petite photo bonne : aucune écriture attendue.
    ('pic-3', jf_p, m1, o1, u_a, 'discovered',
       jsonb_build_object('name', 'Trois', 'profile_picture_url', far, 'profile_picture_url_large', far), old_ts),
    -- r4 : aucun profil enregistré : jamais touchée.
    ('pic-4', jf_p, m1, o1, u_a, 'discovered', NULL, old_ts),
    -- r6 : forme nue du job_id.
    ('pic-6', jf_b, m1, o1, u_a, 'discovered',
       jsonb_build_object('name', 'Six'), old_ts),
    -- r7 : autre mission, absente de p_job_ids : jamais touchée.
    ('pic-7', 'project:' || m2, m2, o1, u_a, 'discovered',
       jsonb_build_object('name', 'Sept'), old_ts),
    -- r8 : profil non objet (tableau JSON) : jamais touchée.
    ('pic-8', jf_p, m1, o1, u_a, 'discovered', '[]'::jsonb, old_ts);
  -- r5 : même mission et même candidat que r1, ligne de B : jamais touchée par A.
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, linkedin_profile_data, updated_at)
  VALUES ('pic-1', jf_p, m1, o1, u_b, 'discovered', jsonb_build_object('name', 'Un (B)'), old_ts);

  SELECT count(*) INTO log_before FROM public.jcs_direct_write_log;
  SELECT general_stage INTO stage_before FROM public.job_candidate_status
   WHERE candidate_id = 'pic-1' AND created_by = u_a;

  -- ===== Contexte : A =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- B1. Le lot : pic-1 (rien), pic-2 (petite échue, grande absente), pic-3 (bonne),
  --     pic-4 (sans profil), pic-6 (forme nue), pic-7 (autre mission), pic-8 (profil non objet),
  --     pic-9 (inconnu), pic-10 (adresses refusées), pic-1 en double.
  returned := public.refresh_candidate_pictures(
    ARRAY[jf_p, jf_b],
    jsonb_build_array(
      jsonb_build_object('candidate_id', 'pic-1', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-1', 'picture', 'https://evil.example/x', 'picture_large', NULL),
      jsonb_build_object('candidate_id', 'pic-2', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-3', 'picture', far || '9', 'picture_large', far || '9'),
      jsonb_build_object('candidate_id', 'pic-4', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-6', 'picture', far, 'picture_large', NULL),
      jsonb_build_object('candidate_id', 'pic-7', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-8', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-9', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-10', 'picture', 'http://media.licdn.com/x', 'picture_large', soon1h)));
  -- pic-1, pic-2, pic-6 : trois lignes modifiées.
  IF returned <> 3 THEN
    failures := failures || format('[B1. %s ligne(s) modifiée(s), attendu 3] ', returned);
  END IF;

  RESET ROLE;

  -- B2. pic-1 (A) : photos posées, reste du profil intact.
  SELECT linkedin_profile_data INTO d FROM public.job_candidate_status
   WHERE candidate_id = 'pic-1' AND created_by = u_a;
  IF d->>'profile_picture_url' IS DISTINCT FROM far OR d->>'profile_picture_url_large' IS DISTINCT FROM far THEN
    failures := failures || '[B2. photos de pic-1 non posées] ';
  END IF;
  IF d->>'name' IS DISTINCT FROM 'Un' OR d->>'headline' IS DISTINCT FROM 'Titre'
     OR d->'skills' IS DISTINCT FROM jsonb_build_array('sql', 'node') THEN
    failures := failures || format('[B2. reste du profil de pic-1 altéré : %s] ', d);
  END IF;

  -- B3. pic-2 : la petite échue est remplacée, la grande posée.
  SELECT linkedin_profile_data INTO d FROM public.job_candidate_status WHERE candidate_id = 'pic-2';
  IF d->>'profile_picture_url' IS DISTINCT FROM far OR d->>'profile_picture_url_large' IS DISTINCT FROM far
     OR d->>'name' IS DISTINCT FROM 'Deux' THEN
    failures := failures || format('[B3. pic-2 : %s] ', d);
  END IF;

  -- B4. pic-3 : adresse bonne, aucune écriture (updated_at ancien conservé).
  SELECT linkedin_profile_data, updated_at INTO d, ts FROM public.job_candidate_status WHERE candidate_id = 'pic-3';
  IF d->>'profile_picture_url' IS DISTINCT FROM far OR ts IS DISTINCT FROM old_ts THEN
    failures := failures || format('[B4. pic-3 réécrite : %s, updated_at %s] ', d->>'profile_picture_url', ts);
  END IF;

  -- B5. pic-4 (sans profil) et pic-8 (profil non objet) : intactes.
  SELECT count(*) INTO n FROM public.job_candidate_status
   WHERE candidate_id = 'pic-4' AND linkedin_profile_data IS NULL AND updated_at = old_ts;
  IF n <> 1 THEN failures := failures || '[B5. pic-4 (sans profil) touchée] '; END IF;
  SELECT count(*) INTO n FROM public.job_candidate_status
   WHERE candidate_id = 'pic-8' AND linkedin_profile_data = '[]'::jsonb AND updated_at = old_ts;
  IF n <> 1 THEN failures := failures || '[B5. pic-8 (profil non objet) touchée] '; END IF;

  -- B6. pic-6 (forme nue du job_id) : petite posée, grande absente (aucune adresse envoyée).
  SELECT linkedin_profile_data INTO d FROM public.job_candidate_status WHERE candidate_id = 'pic-6';
  IF d->>'profile_picture_url' IS DISTINCT FROM far OR d ? 'profile_picture_url_large' THEN
    failures := failures || format('[B6. pic-6 : %s] ', d);
  END IF;

  -- B7. pic-7 (autre mission) : intacte.
  SELECT linkedin_profile_data, updated_at INTO d, ts FROM public.job_candidate_status WHERE candidate_id = 'pic-7';
  IF d ? 'profile_picture_url' OR ts IS DISTINCT FROM old_ts THEN
    failures := failures || '[B7. ligne d''une mission hors p_job_ids touchée] ';
  END IF;

  -- B8. La ligne de B (même mission, même candidat) : intacte.
  SELECT linkedin_profile_data, updated_at INTO d, ts FROM public.job_candidate_status
   WHERE candidate_id = 'pic-1' AND created_by = u_b;
  IF d ? 'profile_picture_url' OR ts IS DISTINCT FROM old_ts THEN
    failures := failures || '[B8. la ligne d''un collègue a été touchée par A] ';
  END IF;

  -- B9. Aucune ligne créée pour un candidat inconnu ou aux adresses refusées.
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE candidate_id IN ('pic-9', 'pic-10');
  IF n <> 0 THEN failures := failures || '[B9. une ligne a été créée] '; END IF;

  -- B10. L'étape n'a pas bougé et le journal des écritures directes n'a pas grossi.
  SELECT general_stage INTO stage_after FROM public.job_candidate_status
   WHERE candidate_id = 'pic-1' AND created_by = u_a;
  SELECT count(*) INTO log_after FROM public.jcs_direct_write_log;
  IF stage_after IS DISTINCT FROM stage_before THEN
    failures := failures || format('[B10. étape de pic-1 : %s puis %s] ', stage_before, stage_after);
  END IF;
  IF log_after <> log_before THEN
    failures := failures || format('[B10. journal des écritures directes : %s puis %s] ', log_before, log_after);
  END IF;

  -- B13. Contrat avec la copie privée : une ligne dont l'adresse est remplacée voit updated_at
  --      avancer (claim_candidate_photos relit les lignes changées depuis son dernier contrôle) ;
  --      une ligne dont l'adresse est restée bonne (pic-3) n'a pas bougé (B4).
  SELECT count(*) INTO n FROM public.job_candidate_status
   WHERE candidate_id IN ('pic-1', 'pic-2', 'pic-6') AND created_by = u_a AND updated_at > old_ts;
  IF n <> 3 THEN
    failures := failures || format('[B13. %s ligne(s) remplacée(s) sur 3 ont avancé updated_at] ', n);
  END IF;
  SELECT count(*) INTO n FROM public.job_candidate_status
   WHERE candidate_id IN ('pic-1', 'pic-2', 'pic-6') AND created_by = u_a AND updated_at > old_ts
     AND public.candidate_picture_is_stale(linkedin_profile_data->>'profile_picture_url');
  IF n <> 0 THEN
    failures := failures || '[B13. une ligne avec updated_at avancé garde pourtant une adresse à remplacer] ';
  END IF;

  -- B11. Rejouer le même lot ne change plus rien (idempotent, aucune écriture).
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  SET LOCAL ROLE authenticated;
  returned := public.refresh_candidate_pictures(
    ARRAY[jf_p, jf_b],
    jsonb_build_array(
      jsonb_build_object('candidate_id', 'pic-1', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-2', 'picture', far, 'picture_large', far),
      jsonb_build_object('candidate_id', 'pic-6', 'picture', far, 'picture_large', NULL)));
  IF returned <> 0 THEN
    failures := failures || format('[B11. second passage : %s ligne(s) modifiée(s)] ', returned);
  END IF;

  -- B12. Une adresse qui échoit dans moins de 3 jours est remplacée par une plus tardive,
  --      jamais par une plus ancienne.
  RESET ROLE;
  UPDATE public.job_candidate_status
     SET linkedin_profile_data = jsonb_build_object('profile_picture_url', soon2, 'name', 'Quatre')
   WHERE candidate_id = 'pic-3';
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  SET LOCAL ROLE authenticated;
  returned := public.refresh_candidate_pictures(
    ARRAY[jf_p],
    jsonb_build_array(jsonb_build_object('candidate_id', 'pic-3',
      'picture', base || extract(epoch from now() + interval '30 hours')::bigint, 'picture_large', NULL)));
  IF returned <> 0 THEN
    failures := failures || '[B12. une adresse moins tardive a remplacé celle de pic-3] ';
  END IF;
  returned := public.refresh_candidate_pictures(
    ARRAY[jf_p],
    jsonb_build_array(jsonb_build_object('candidate_id', 'pic-3', 'picture', far, 'picture_large', NULL)));
  IF returned <> 1 THEN
    failures := failures || format('[B12. adresse plus tardive : %s ligne(s), attendu 1] ', returned);
  END IF;

  -- ===== C. Refus =====
  -- C1. Aucune forme de job_id, ou plus de 4.
  hint := NULL;
  BEGIN
    PERFORM public.refresh_candidate_pictures(ARRAY[]::text[], '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  END;
  IF hint IS DISTINCT FROM 'PICTURE_JOBS_INVALID' THEN
    failures := failures || format('[C1. p_job_ids vide : HINT %s] ', coalesce(hint, 'aucun refus'));
  END IF;
  hint := NULL;
  BEGIN
    PERFORM public.refresh_candidate_pictures(ARRAY['a', 'b', 'c', 'd', 'e'], '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  END;
  IF hint IS DISTINCT FROM 'PICTURE_JOBS_INVALID' THEN
    failures := failures || format('[C1. p_job_ids à 5 : HINT %s] ', coalesce(hint, 'aucun refus'));
  END IF;

  -- C2. p_items qui n'est pas un tableau.
  hint := NULL;
  BEGIN
    PERFORM public.refresh_candidate_pictures(ARRAY[jf_p], '{"candidate_id": "pic-1"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  END;
  IF hint IS DISTINCT FROM 'PICTURE_ITEMS_INVALID' THEN
    failures := failures || format('[C2. p_items objet : HINT %s] ', coalesce(hint, 'aucun refus'));
  END IF;

  -- C3. Plus de 200 profils : refusé ; 200 : accepté.
  hint := NULL;
  BEGIN
    PERFORM public.refresh_candidate_pictures(ARRAY[jf_p],
      (SELECT jsonb_agg(jsonb_build_object('candidate_id', 'x' || g, 'picture', far)) FROM generate_series(1, 201) g));
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  END;
  IF hint IS DISTINCT FROM 'PICTURE_BATCH_TOO_LARGE' THEN
    failures := failures || format('[C3. 201 profils : HINT %s] ', coalesce(hint, 'aucun refus'));
  END IF;
  BEGIN
    returned := public.refresh_candidate_pictures(ARRAY[jf_p],
      (SELECT jsonb_agg(jsonb_build_object('candidate_id', 'x' || g, 'picture', far)) FROM generate_series(1, 200) g));
    IF returned <> 0 THEN failures := failures || format('[C3. 200 profils inconnus : %s ligne(s)] ', returned); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[C3. 200 profils refusés : %s] ', SQLERRM);
  END;

  -- C4. Lot vide : zéro, sans erreur.
  returned := public.refresh_candidate_pictures(ARRAY[jf_p], '[]'::jsonb);
  IF returned <> 0 THEN failures := failures || '[C4. lot vide : lignes modifiées] '; END IF;

  -- C5. Sans session (auth.uid() nul) : refus 28000.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE authenticated;
  hint := NULL;
  BEGIN
    PERFORM public.refresh_candidate_pictures(ARRAY[jf_p], '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
  END;
  IF hint IS DISTINCT FROM 'PICTURE_AUTH_REQUIRED' THEN
    failures := failures || format('[C5. sans session : HINT %s] ', coalesce(hint, 'aucun refus'));
  END IF;

  -- ===== Contexte : C (autre organisation) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  returned := public.refresh_candidate_pictures(
    ARRAY[jf_p, jf_b],
    jsonb_build_array(jsonb_build_object('candidate_id', 'pic-6', 'picture', far || '7', 'picture_large', far || '7')));
  IF returned <> 0 THEN
    failures := failures || format('[C6. un tiers a modifié %s ligne(s) d''une autre organisation] ', returned);
  END IF;
  RESET ROLE;
  SELECT linkedin_profile_data INTO d FROM public.job_candidate_status WHERE candidate_id = 'pic-6';
  IF d->>'profile_picture_url' IS DISTINCT FROM far THEN
    failures := failures || '[C6. adresse de pic-6 changée par un tiers] ';
  END IF;

  -- ===== D. Droits et nature des fonctions =====
  SELECT count(*) INTO n FROM (VALUES
      ('public.candidate_picture_expiry(text)'),
      ('public.candidate_picture_is_stale(text, interval)'),
      ('public.candidate_picture_should_replace(text, text)'),
      ('public.refresh_candidate_pictures(text[], jsonb)')) AS f(sig)
   WHERE has_function_privilege('anon', f.sig::regprocedure, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', f.sig::regprocedure, 'EXECUTE')
      OR NOT has_function_privilege('service_role', f.sig::regprocedure, 'EXECUTE');
  IF n <> 0 THEN
    failures := failures || format('[D1. %s fonction(s) avec un droit d''exécution inattendu (anon, authenticated, service_role)] ', n);
  END IF;
  SELECT count(*) INTO n
    FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid IN ('public.candidate_picture_expiry(text)'::regprocedure,
                   'public.candidate_picture_is_stale(text, interval)'::regprocedure,
                   'public.candidate_picture_should_replace(text, text)'::regprocedure,
                   'public.refresh_candidate_pictures(text[], jsonb)'::regprocedure)
     AND a.grantee = 0;
  IF n <> 0 THEN
    failures := failures || '[D2. EXECUTE accordé à PUBLIC] ';
  END IF;
  SELECT prosecdef INTO b FROM pg_proc WHERE oid = 'public.refresh_candidate_pictures(text[], jsonb)'::regprocedure;
  IF b THEN
    failures := failures || '[D3. refresh_candidate_pictures est SECURITY DEFINER, attendu INVOKER] ';
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'candidate_pictures_audit : %', failures;
  END IF;
  RAISE NOTICE 'candidate_pictures_audit : contrôles A à D passés';
END $$;
