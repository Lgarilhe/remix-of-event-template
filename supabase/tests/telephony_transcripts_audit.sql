-- =====================================================================
-- Téléphonie, lot A5 : phone_call_transcripts, phone_call_insights,
-- record_phone_call_transcript, claim_phone_call_analysis.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/telephony_transcripts_audit.sql; ROLLBACK;
-- Vérifie la migration *_telephonie_aircall_lot_a5_transcriptions.sql :
--   - transcriptions et analyses : lues par l'organisation de l'appelant
--     seulement, jamais écrites par le navigateur ;
--   - record_phone_call_transcript : une ligne par appel, rejouable, une
--     analyse faite ou en cours n'est pas relancée par un rejeu, une analyse
--     en échec ou ignorée repasse en attente, appel inconnu et entrées
--     invalides refusés, jamais l'appel d'une autre organisation ;
--   - claim_phone_call_analysis : un seul traitement à la fois, reprise d'un
--     traitement interrompu depuis 5 minutes, analyse terminée reprise
--     seulement sur demande, rien sans transcription, rien hors organisation ;
--   - effacement en cascade avec l'appel ;
--   - états et formes d'une analyse bornés par des contraintes.
-- A propriétaire de O1, B membre de O1, C propriétaire de O2 (ids fixes).
-- Aucune fonction refusée n'est appelée sous SET ROLE (CLAUDE.md, supautils) :
-- les droits se lisent par has_*_privilege. Les contrôles sont accumulés ;
-- une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'f1111111-1111-4111-8111-111111111111';
  u_b uuid := 'f2222222-2222-4222-8222-222222222222';
  u_c uuid := 'f3333333-3333-4333-8333-333333333333';
  o1 uuid := 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@transcripts.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@transcripts.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@transcripts.test')::text;
  t0 timestamptz := '2026-10-06 10:00:00+00';
  call_o1 uuid;
  call_o2 uuid;
  utterances jsonb := jsonb_build_array(
    jsonb_build_object('who', 'agent', 'start', 1, 'end', 4, 'text', 'Bonjour Marc'),
    jsonb_build_object('who', 'contact', 'start', 5, 'end', 9, 'text', 'Bonjour, oui'));
  n integer;
  m integer;
  tbl text;
  pr text;
  fn text;
  v_bool boolean;
  v_text text;
  v_json jsonb;
  v_status text;
  v_chars integer;
  v_claimed boolean;
  failures text := '';
BEGIN
  -- 1. RLS active et une seule policy, en lecture, pour authenticated.
  FOREACH tbl IN ARRAY ARRAY['phone_call_transcripts', 'phone_call_insights'] LOOP
    SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = ('public.' || tbl)::regclass;
    SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ') INTO v_text FROM pg_policies
     WHERE schemaname = 'public' AND tablename = tbl;
    IF NOT coalesce(v_bool, false) OR v_text IS DISTINCT FROM 'SELECT:authenticated' THEN
      failures := failures || format('[1. %s : RLS %s, policies %s] ', tbl, v_bool, v_text);
    END IF;
  END LOOP;

  -- 2. Privilèges : rien pour anon ; authenticated lit seulement ; tout pour service_role.
  FOREACH tbl IN ARRAY ARRAY['phone_call_transcripts', 'phone_call_insights'] LOOP
    FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || tbl, pr) THEN
        failures := failures || format('[2. anon a %s sur %s] ', pr, tbl);
      END IF;
      IF pr <> 'SELECT' AND has_table_privilege('authenticated', 'public.' || tbl, pr) THEN
        failures := failures || format('[2. authenticated a %s sur %s] ', pr, tbl);
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') THEN
      failures := failures || format('[2. lecture authenticated manquante sur %s] ', tbl);
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || tbl, 'SELECT, INSERT, UPDATE, DELETE') THEN
      failures := failures || format('[2. écriture service_role manquante sur %s] ', tbl);
    END IF;
  END LOOP;

  -- 3. Fonctions : clé de service seulement.
  FOREACH fn IN ARRAY ARRAY[
    'public.record_phone_call_transcript(uuid, text, text, jsonb, text)',
    'public.claim_phone_call_analysis(uuid, uuid, boolean)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE')
       OR has_function_privilege('public', fn, 'EXECUTE') THEN
      failures := failures || format('[3. %s exécutable hors service_role] ', fn);
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      failures := failures || format('[3. %s refusée à service_role] ', fn);
    END IF;
  END LOOP;

  -- 4. Effacement en cascade avec l'appel et avec l'organisation.
  FOREACH tbl IN ARRAY ARRAY['phone_call_transcripts', 'phone_call_insights'] LOOP
    SELECT count(*) INTO n FROM pg_constraint
     WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'f'
       AND confrelid = 'public.phone_calls'::regclass AND confdeltype = 'c';
    SELECT count(*) INTO m FROM pg_constraint
     WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'f'
       AND confrelid = 'public.organizations'::regclass AND confdeltype = 'c';
    IF n <> 1 OR m <> 1 THEN
      failures := failures || format('[4. %s : clés vers phone_calls (%s) et organizations (%s) sans ON DELETE CASCADE] ', tbl, n, m);
    END IF;
  END LOOP;

  -- Jeu de données : A propriétaire de O1, B membre de O1, C propriétaire de O2.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@transcripts.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@transcripts.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@transcripts.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Transcripts Org 1', 'transcripts-org-1', u_a),
         (o2, 'Transcripts Org 2', 'transcripts-org-2', u_c);
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member');
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner'
     OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner'
     OR coalesce(public.get_org_role(u_b, o1), '') <> 'member' THEN
    RAISE EXCEPTION 'montage : rôles inattendus dans O1 ou O2';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, o1), (u_b, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;

  -- Un appel A-1 dans chaque organisation (même identifiant du fournisseur).
  PERFORM public.record_phone_call(o1, 'aircall', 'A-1', t0, jsonb_build_object('direction', 'inbound', 'status', 'done', 'talk_seconds', 60));
  PERFORM public.record_phone_call(o2, 'aircall', 'A-1', t0, jsonb_build_object('direction', 'outbound', 'status', 'done', 'talk_seconds', 30));
  SELECT id INTO call_o1 FROM public.phone_calls WHERE organization_id = o1 AND external_id = 'A-1';
  SELECT id INTO call_o2 FROM public.phone_calls WHERE organization_id = o2 AND external_id = 'A-1';

  -- 5. Première transcription : ligne gardée, caractères comptés, analyse en attente.
  v_json := public.record_phone_call_transcript(o1, 'aircall', 'A-1', utterances, 'fr');
  SELECT char_count INTO v_chars FROM public.phone_call_transcripts WHERE call_id = call_o1;
  SELECT status INTO v_status FROM public.phone_call_insights WHERE call_id = call_o1;
  IF (v_json->>'call_id')::uuid IS DISTINCT FROM call_o1 OR v_json->>'status' <> 'pending'
     OR v_chars <> length('Bonjour Marc') + length('Bonjour, oui') OR v_status <> 'pending' THEN
    failures := failures || format('[5. première transcription : %s, %s caractères, analyse %s] ', v_json, v_chars, v_status);
  END IF;

  -- 6. Rejeu : une seule ligne de chaque ; une analyse terminée n'est pas relancée.
  UPDATE public.phone_call_insights SET status = 'done', summary = 'Résumé' WHERE call_id = call_o1;
  v_json := public.record_phone_call_transcript(o1, 'aircall', 'A-1', utterances, 'fr');
  SELECT count(*) INTO n FROM public.phone_call_transcripts WHERE call_id = call_o1;
  SELECT count(*) INTO m FROM public.phone_call_insights WHERE call_id = call_o1;
  SELECT status INTO v_status FROM public.phone_call_insights WHERE call_id = call_o1;
  IF n <> 1 OR m <> 1 OR v_status <> 'done' OR v_json->>'status' <> 'done' THEN
    failures := failures || format('[6. rejeu après analyse : %s transcription(s), %s analyse(s), état %s] ', n, m, v_status);
  END IF;

  -- 7. Une analyse en cours n'est pas relancée non plus ; en échec ou ignorée, elle repasse en attente.
  UPDATE public.phone_call_insights SET status = 'analyzing' WHERE call_id = call_o1;
  PERFORM public.record_phone_call_transcript(o1, 'aircall', 'A-1', utterances, 'fr');
  SELECT status INTO v_status FROM public.phone_call_insights WHERE call_id = call_o1;
  IF v_status <> 'analyzing' THEN failures := failures || format('[7. rejeu pendant l''analyse : %s] ', v_status); END IF;
  FOREACH v_text IN ARRAY ARRAY['failed', 'skipped'] LOOP
    UPDATE public.phone_call_insights SET status = v_text, reason = 'error' WHERE call_id = call_o1;
    PERFORM public.record_phone_call_transcript(o1, 'aircall', 'A-1', utterances, 'fr');
    SELECT status INTO v_status FROM public.phone_call_insights WHERE call_id = call_o1;
    SELECT count(*) INTO n FROM public.phone_call_insights WHERE call_id = call_o1 AND reason IS NULL;
    IF v_status <> 'pending' OR n <> 1 THEN
      failures := failures || format('[7. rejeu après %s : état %s, cause effacée %s] ', v_text, v_status, n);
    END IF;
  END LOOP;

  -- 8. La transcription remplace la précédente, et ne touche jamais l'appel d'une autre organisation.
  PERFORM public.record_phone_call_transcript(o1, 'aircall', 'A-1', jsonb_build_array(jsonb_build_object('who', 'agent', 'text', 'Nouveau')), NULL);
  SELECT char_count INTO v_chars FROM public.phone_call_transcripts WHERE call_id = call_o1;
  SELECT count(*) INTO n FROM public.phone_call_transcripts WHERE call_id = call_o2;
  SELECT language INTO v_text FROM public.phone_call_transcripts WHERE call_id = call_o1;
  IF v_chars <> length('Nouveau') OR n <> 0 OR v_text IS DISTINCT FROM 'fr' THEN
    failures := failures || format('[8. remplacement : %s caractères, %s ligne(s) pour O2, langue %s (attendu 7, 0, fr)] ', v_chars, n, v_text);
  END IF;
  PERFORM public.record_phone_call_transcript(o2, 'aircall', 'A-1', utterances, 'fr');
  SELECT count(*) INTO n FROM public.phone_call_transcripts WHERE call_id = call_o2 AND organization_id = o2;
  IF n <> 1 THEN failures := failures || format('[8. transcription de O2 : %s ligne(s)] ', n); END IF;

  -- 9. Appel inconnu et entrées invalides refusés.
  BEGIN
    PERFORM public.record_phone_call_transcript(o1, 'aircall', 'inconnu', utterances, NULL);
    failures := failures || '[9. appel inconnu accepté] ';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL;
  END;
  -- L'appel d'une autre organisation n'est pas le sien.
  PERFORM public.record_phone_call(o2, 'aircall', 'B-ONLY', t0, jsonb_build_object('status', 'done'));
  BEGIN
    PERFORM public.record_phone_call_transcript(o1, 'aircall', 'B-ONLY', utterances, NULL);
    failures := failures || '[9. appel de O2 transcrit depuis O1] ';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL;
  END;
  BEGIN
    PERFORM public.record_phone_call_transcript(o1, 'aircall', 'A-1', '{}'::jsonb, NULL);
    failures := failures || '[9. transcription qui n''est pas une liste acceptée] ';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.record_phone_call_transcript(o1, 'aircall', '', utterances, NULL);
    failures := failures || '[9. identifiant vide accepté] ';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.record_phone_call_transcript(NULL, 'aircall', 'A-1', utterances, NULL);
    failures := failures || '[9. organisation absente acceptée] ';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- 10. Prise de l'analyse : un seul traitement à la fois.
  UPDATE public.phone_call_insights SET status = 'pending', reason = NULL WHERE call_id = call_o1;
  v_claimed := public.claim_phone_call_analysis(o1, call_o1, false);
  SELECT status INTO v_status FROM public.phone_call_insights WHERE call_id = call_o1;
  IF v_claimed IS DISTINCT FROM true OR v_status <> 'analyzing' THEN
    failures := failures || format('[10. première prise : %s, état %s] ', v_claimed, v_status);
  END IF;
  v_claimed := public.claim_phone_call_analysis(o1, call_o1, false);
  IF v_claimed IS DISTINCT FROM false THEN failures := failures || format('[10. deuxième prise pendant l''analyse : %s] ', v_claimed); END IF;
  v_claimed := public.claim_phone_call_analysis(o1, call_o1, true);
  IF v_claimed IS DISTINCT FROM false THEN failures := failures || format('[10. prise forcée pendant l''analyse : %s] ', v_claimed); END IF;

  -- 11. Un traitement interrompu depuis plus de 5 minutes se reprend.
  UPDATE public.phone_call_insights SET updated_at = now() - interval '6 minutes' WHERE call_id = call_o1;
  v_claimed := public.claim_phone_call_analysis(o1, call_o1, false);
  IF v_claimed IS DISTINCT FROM true THEN failures := failures || format('[11. reprise d''un traitement interrompu : %s] ', v_claimed); END IF;

  -- 12. Une analyse terminée se reprend seulement sur demande ; échec ou ignorée : sans demande.
  UPDATE public.phone_call_insights SET status = 'done' WHERE call_id = call_o1;
  v_claimed := public.claim_phone_call_analysis(o1, call_o1, false);
  IF v_claimed IS DISTINCT FROM false THEN failures := failures || format('[12. analyse terminée reprise sans demande : %s] ', v_claimed); END IF;
  v_claimed := public.claim_phone_call_analysis(o1, call_o1, true);
  IF v_claimed IS DISTINCT FROM true THEN failures := failures || format('[12. analyse terminée non reprise sur demande : %s] ', v_claimed); END IF;
  FOREACH v_text IN ARRAY ARRAY['failed', 'skipped'] LOOP
    UPDATE public.phone_call_insights SET status = v_text WHERE call_id = call_o1;
    v_claimed := public.claim_phone_call_analysis(o1, call_o1, false);
    IF v_claimed IS DISTINCT FROM true THEN failures := failures || format('[12. reprise après %s : %s] ', v_text, v_claimed); END IF;
  END LOOP;

  -- 13. Rien sans transcription, rien hors de l'organisation de l'appel.
  PERFORM public.record_phone_call(o1, 'aircall', 'A-NO-TEXT', t0, jsonb_build_object('status', 'done'));
  v_claimed := public.claim_phone_call_analysis(o1, (SELECT id FROM public.phone_calls WHERE organization_id = o1 AND external_id = 'A-NO-TEXT'), false);
  SELECT count(*) INTO n FROM public.phone_call_insights i JOIN public.phone_calls c ON c.id = i.call_id WHERE c.external_id = 'A-NO-TEXT';
  IF v_claimed IS DISTINCT FROM false OR n <> 0 THEN
    failures := failures || format('[13. appel sans transcription : prise %s, %s analyse(s) créée(s)] ', v_claimed, n);
  END IF;
  UPDATE public.phone_call_insights SET status = 'pending' WHERE call_id = call_o1;
  v_claimed := public.claim_phone_call_analysis(o2, call_o1, false);
  SELECT status INTO v_status FROM public.phone_call_insights WHERE call_id = call_o1;
  IF v_claimed IS DISTINCT FROM false OR v_status <> 'pending' THEN
    failures := failures || format('[13. appel de O1 pris au nom de O2 : %s, état %s] ', v_claimed, v_status);
  END IF;
  BEGIN
    PERFORM public.claim_phone_call_analysis(NULL, call_o1, false);
    failures := failures || '[13. prise sans organisation acceptée] ';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- 14. États et formes bornés par des contraintes.
  BEGIN
    UPDATE public.phone_call_insights SET status = 'termine' WHERE call_id = call_o1;
    failures := failures || '[14. état inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.phone_call_insights SET facts = '[]'::jsonb WHERE call_id = call_o1;
    failures := failures || '[14. rubriques qui ne sont pas un objet acceptées] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.phone_call_insights SET next_steps = '{}'::jsonb WHERE call_id = call_o1;
    failures := failures || '[14. suites qui ne sont pas une liste acceptées] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 15. Lecture sous le rôle des utilisateurs : l'organisation de l'appelant seulement.
  UPDATE public.phone_call_insights SET status = 'done', summary = 'Résumé O1' WHERE call_id = call_o1;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_transcripts;
  SELECT count(*) INTO m FROM public.phone_call_insights;
  IF n <> 1 OR m <> 1 THEN failures := failures || format('[15. A voit %s transcription(s) et %s analyse(s), attendu 1 et 1] ', n, m); END IF;
  SELECT count(*) INTO n FROM public.phone_call_transcripts WHERE organization_id = o2;
  IF n <> 0 THEN failures := failures || format('[15. A voit %s transcription(s) de O2] ', n); END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_insights;
  IF n <> 1 THEN failures := failures || format('[15. B (membre de O1) voit %s analyse(s), attendu 1] ', n); END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_transcripts;
  SELECT count(*) INTO m FROM public.phone_call_transcripts WHERE organization_id = o1;
  IF n <> 1 OR m <> 0 THEN failures := failures || format('[15. C voit %s transcription(s) dont %s de O1, attendu 1 et 0] ', n, m); END IF;
  SELECT count(*) INTO n FROM public.phone_call_insights WHERE organization_id = o1;
  IF n <> 0 THEN failures := failures || format('[15. C voit %s analyse(s) de O1] ', n); END IF;
  RESET ROLE;

  -- 16. Effacer un appel efface sa transcription et son analyse.
  DELETE FROM public.phone_calls WHERE id = call_o1;
  SELECT count(*) INTO n FROM public.phone_call_transcripts WHERE call_id = call_o1;
  SELECT count(*) INTO m FROM public.phone_call_insights WHERE call_id = call_o1;
  IF n <> 0 OR m <> 0 THEN failures := failures || format('[16. après effacement de l''appel : %s transcription(s), %s analyse(s)] ', n, m); END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'telephony_transcripts_audit : %', failures;
  END IF;
  RAISE NOTICE 'telephony_transcripts_audit : 16 contrôles passés';
END $$;
