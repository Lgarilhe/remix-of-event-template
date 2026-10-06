-- =====================================================================
-- Téléphonie, lot A1 : phone_calls, telephony_connections, record_phone_call,
-- get_telephony_status. Puis transcription, résumé et tâches proposées :
-- phone_call_insights et phone_call_task_suggestions (contrôles 16 à 22).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/telephony_audit.sql; ROLLBACK;
-- Vérifie la migration *_telephonie_aircall_lot_a1_reception.sql :
--   - appels : lus par l'organisation de l'appelant seulement, jamais écrits
--     par le navigateur ; connexions illisibles et inécrivables par tout rôle
--     client ;
--   - record_phone_call : rejouable, un événement plus ancien est sans effet,
--     un champ absent ne remplace pas un champ connu, la durée de conversation
--     ne recule pas, une même clé fournisseur reste distincte d'une
--     organisation à l'autre, entrées invalides refusées ;
--   - un jeton de webhook ne désigne qu'une organisation ;
--   - get_telephony_status : propriétaire et administrateur seulement, de leur
--     organisation seulement ;
--   - effacement en cascade avec l'organisation ;
--   - transcription et résumé : lus par l'organisation de l'appelant, écrits
--     par la clé de service seulement ; une ligne par appel ;
--   - tâches proposées : le navigateur ne change que l'état (proposée vers
--     acceptée ou ignorée, une seule fois), le lien vers la tâche et la date ;
--     effacement en cascade avec l'appel.
-- A propriétaire de O1, B membre de O1, C propriétaire de O2 (ids fixes).
-- Aucune fonction refusée n'est appelée sous SET ROLE (CLAUDE.md, supautils) :
-- les droits se lisent par has_*_privilege, et les fonctions se jouent avec les
-- jetons posés (auth.uid()) sans changer de rôle. Les contrôles sont
-- accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'f1111111-1111-4111-8111-111111111111';
  u_b uuid := 'f2222222-2222-4222-8222-222222222222';
  u_c uuid := 'f3333333-3333-4333-8333-333333333333';
  o1 uuid := 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@telephony.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@telephony.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@telephony.test')::text;
  t0 timestamptz := '2026-10-05 10:00:00+00';
  n integer;
  r text;
  pr text;
  fn text;
  tbl text;
  v_text text;
  v_bool boolean;
  v_status text;
  v_tags text[];
  v_notes text;
  v_rec text;
  v_talk integer;
  v_json jsonb;
  v_call1 uuid;
  v_call2 uuid;
  v_sug1 uuid;
  v_sug2 uuid;
  v_pol text;
  failures text := '';
BEGIN
  -- 1. phone_calls : RLS active, une seule policy, en lecture, pour authenticated.
  SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = 'public.phone_calls'::regclass;
  SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ') INTO v_text FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'phone_calls';
  IF NOT coalesce(v_bool, false) OR v_text IS DISTINCT FROM 'SELECT:authenticated' THEN
    failures := failures || format('[1. phone_calls : RLS %s, policies %s] ', v_bool, v_text);
  END IF;

  -- 2. telephony_connections : RLS active et AUCUNE policy (illisible par un rôle client).
  SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = 'public.telephony_connections'::regclass;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'telephony_connections';
  IF NOT coalesce(v_bool, false) OR n <> 0 THEN
    failures := failures || format('[2. telephony_connections : RLS %s, %s policy(ies), attendu RLS sans policy] ', v_bool, n);
  END IF;

  -- 3. Privilèges : rien pour anon ; authenticated lit les appels et rien d'autre ; tout pour service_role.
  FOREACH tbl IN ARRAY ARRAY['phone_calls', 'telephony_connections'] LOOP
    FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || tbl, pr) THEN
        failures := failures || format('[3. anon a %s sur %s] ', pr, tbl);
      END IF;
      IF NOT (tbl = 'phone_calls' AND pr = 'SELECT') AND has_table_privilege('authenticated', 'public.' || tbl, pr) THEN
        failures := failures || format('[3. authenticated a %s sur %s] ', pr, tbl);
      END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', 'public.' || tbl, 'SELECT, INSERT, UPDATE, DELETE') THEN
      failures := failures || format('[3. écriture service_role manquante sur %s] ', tbl);
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.phone_calls', 'SELECT') THEN
    failures := failures || '[3. lecture authenticated manquante sur phone_calls] ';
  END IF;

  -- 4. Fonctions : record_phone_call pour la clé de service seulement ;
  --    get_telephony_status pour authenticated et service_role, jamais anon ni PUBLIC.
  fn := 'public.record_phone_call(uuid, text, text, timestamptz, jsonb)';
  IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE')
     OR has_function_privilege('public', fn, 'EXECUTE') THEN
    failures := failures || '[4. record_phone_call exécutable hors service_role] ';
  END IF;
  IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
    failures := failures || '[4. record_phone_call refusée à service_role] ';
  END IF;
  fn := 'public.get_telephony_status(uuid)';
  IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('public', fn, 'EXECUTE') THEN
    failures := failures || '[4. get_telephony_status exécutable par anon ou PUBLIC] ';
  END IF;
  IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') OR NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
    failures := failures || '[4. get_telephony_status refusée à authenticated ou service_role] ';
  END IF;

  -- 5. Effacement en cascade avec l'organisation (clé étrangère).
  FOREACH tbl IN ARRAY ARRAY['phone_calls', 'telephony_connections'] LOOP
    SELECT count(*) INTO n FROM pg_constraint
     WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'f'
       AND confrelid = 'public.organizations'::regclass AND confdeltype = 'c';
    IF n <> 1 THEN failures := failures || format('[5. %s : clé vers organizations sans ON DELETE CASCADE] ', tbl); END IF;
  END LOOP;

  -- Jeu de données : A propriétaire de O1, B membre de O1, C propriétaire de O2.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@telephony.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@telephony.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@telephony.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Telephony Org 1', 'telephony-org-1', u_a),
         (o2, 'Telephony Org 2', 'telephony-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur on_organization_created.
  -- Sans auth.uid(), enforce_role_hierarchy laisse passer le rôle member.
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

  -- 6. Premier événement : 'inserted'.
  r := public.record_phone_call(o1, 'aircall', 'A-1', t0, jsonb_build_object(
    'direction', 'inbound', 'status', 'done', 'started_at', t0, 'answered_at', t0 + interval '10 seconds',
    'ended_at', t0 + interval '70 seconds', 'talk_seconds', 60,
    'contact_number', '+33 6 12 34 56 78', 'contact_number_e164', '+33612345678', 'contact_name', 'Marc Moreau',
    'agent_email', 'a@telephony.test', 'recording_url', 'https://rec.test/1',
    'tags', jsonb_build_array('rdv'), 'notes', 'n1'));
  IF r IS DISTINCT FROM 'inserted' THEN failures := failures || format('[6. premier événement : %s] ', r); END IF;

  -- 7. Même événement rejoué : 'updated', toujours une seule ligne.
  r := public.record_phone_call(o1, 'aircall', 'A-1', t0, jsonb_build_object(
    'direction', 'inbound', 'status', 'done', 'talk_seconds', 60, 'tags', jsonb_build_array('rdv'), 'notes', 'n1'));
  SELECT count(*) INTO n FROM public.phone_calls WHERE organization_id = o1 AND external_id = 'A-1';
  IF r IS DISTINCT FROM 'updated' OR n <> 1 THEN
    failures := failures || format('[7. rejeu : %s, %s ligne(s)] ', r, n);
  END IF;

  -- 8. Événement plus ancien : 'stale', aucune donnée changée.
  r := public.record_phone_call(o1, 'aircall', 'A-1', t0 - interval '1 minute', jsonb_build_object(
    'status', 'initial', 'tags', jsonb_build_array('ancien'), 'notes', 'ancien'));
  SELECT status, tags, notes INTO v_status, v_tags, v_notes FROM public.phone_calls WHERE organization_id = o1 AND external_id = 'A-1';
  IF r IS DISTINCT FROM 'stale' OR v_status <> 'done' OR v_tags <> ARRAY['rdv']::text[] OR v_notes <> 'n1' THEN
    failures := failures || format('[8. événement ancien : %s, statut %s, tags %s, notes %s] ', r, v_status, v_tags, v_notes);
  END IF;

  -- 9. Événement plus récent sans enregistrement : l'enregistrement connu reste,
  --    les étiquettes et notes (portées en entier par chaque événement) sont remplacées.
  r := public.record_phone_call(o1, 'aircall', 'A-1', t0 + interval '1 minute', jsonb_build_object(
    'status', 'done', 'talk_seconds', 40, 'tags', jsonb_build_array('x', 'y')));
  SELECT recording_url, tags, notes, talk_seconds INTO v_rec, v_tags, v_notes, v_talk
    FROM public.phone_calls WHERE organization_id = o1 AND external_id = 'A-1';
  IF r IS DISTINCT FROM 'updated' OR v_rec IS DISTINCT FROM 'https://rec.test/1'
     OR v_tags <> ARRAY['x', 'y']::text[] OR v_notes IS NOT NULL THEN
    failures := failures || format('[9. mise à jour partielle : %s, enregistrement %s, tags %s, notes %s] ', r, v_rec, v_tags, v_notes);
  END IF;

  -- 10. La durée de conversation ne recule jamais (60 s déjà connues, 40 s reçues).
  IF v_talk <> 60 THEN failures := failures || format('[10. durée de conversation : %s, attendu 60] ', v_talk); END IF;

  -- 11. Même clé fournisseur dans une autre organisation : une ligne distincte.
  r := public.record_phone_call(o2, 'aircall', 'A-1', t0, jsonb_build_object(
    'direction', 'outbound', 'status', 'done', 'contact_number_e164', '+33699999999'));
  SELECT count(*) INTO n FROM public.phone_calls WHERE provider = 'aircall' AND external_id = 'A-1';
  IF r IS DISTINCT FROM 'inserted' OR n <> 2 THEN
    failures := failures || format('[11. même identifiant dans deux organisations : %s, %s ligne(s), attendu inserted et 2] ', r, n);
  END IF;

  -- 12. Entrées invalides refusées.
  BEGIN
    PERFORM public.record_phone_call(o1, 'aircall', '', t0, '{}'::jsonb);
    failures := failures || '[12. identifiant vide accepté] ';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.record_phone_call(o1, 'aircall', 'A-2', t0, '[]'::jsonb);
    failures := failures || '[12. appel qui n''est pas un objet accepté] ';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.record_phone_call(o1, 'zoom', 'A-3', t0, '{}'::jsonb);
    failures := failures || '[12. fournisseur inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_phone_call(o1, 'aircall', 'A-4', t0, jsonb_build_object('direction', 'sideways'));
    failures := failures || '[12. sens inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 13. Un jeton de webhook ne désigne qu'une organisation.
  INSERT INTO public.telephony_connections (organization_id, provider, webhook_token_hash, external_webhook_id, connected_by)
  VALUES (o1, 'aircall', 'hash-o1', 'wh-1', u_a);
  BEGIN
    INSERT INTO public.telephony_connections (organization_id, provider, webhook_token_hash)
    VALUES (o2, 'aircall', 'hash-o1');
    failures := failures || '[13. un même jeton relie deux organisations] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.telephony_connections (organization_id, provider, webhook_token_hash)
    VALUES (o1, 'aircall', 'hash-o1-bis');
    failures := failures || '[13. deux connexions Aircall pour une organisation] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 14. Lecture des appels sous le rôle des utilisateurs : l'organisation de l'appelant seulement.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_calls;
  IF n <> 1 THEN failures := failures || format('[14. A voit %s appel(s), attendu 1 (O1)] ', n); END IF;
  SELECT count(*) INTO n FROM public.phone_calls WHERE organization_id = o2;
  IF n <> 0 THEN failures := failures || format('[14. A voit %s appel(s) de O2] ', n); END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_calls;
  IF n <> 1 THEN failures := failures || format('[14. B (membre de O1) voit %s appel(s), attendu 1] ', n); END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_calls;
  SELECT count(*) INTO v_talk FROM public.phone_calls WHERE organization_id = o1;
  IF n <> 1 OR v_talk <> 0 THEN
    failures := failures || format('[14. C voit %s appel(s) dont %s de O1, attendu 1 et 0] ', n, v_talk);
  END IF;
  RESET ROLE;

  -- 15. get_telephony_status : propriétaire de l'organisation seulement.
  --     Joué sans changer de rôle : seul auth.uid() compte.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  v_json := public.get_telephony_status(o1);
  IF NOT (v_json->>'connected')::boolean OR (v_json->>'calls_count')::integer <> 1 OR v_json->>'provider' <> 'aircall' THEN
    failures := failures || format('[15. état de O1 pour son propriétaire : %s] ', v_json);
  END IF;
  -- A n'est pas membre de O2.
  BEGIN
    v_json := public.get_telephony_status(o2);
    failures := failures || '[15. A lit l''état de O2] ';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  BEGIN
    v_json := public.get_telephony_status(o1);
    failures := failures || '[15. un simple membre lit l''état de la connexion] ';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  v_json := public.get_telephony_status(o2);
  IF (v_json->>'connected')::boolean OR (v_json->>'calls_count')::integer <> 1 THEN
    failures := failures || format('[15. état de O2 (non connectée, 1 appel) : %s] ', v_json);
  END IF;

  -- Sans utilisateur (clé de service) : refusé, l'écran n'est pas un chemin serveur.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    v_json := public.get_telephony_status(o1);
    failures := failures || '[15. état lu sans utilisateur] ';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  -- 16. Tables de transcription : RLS active ; policies attendues.
  FOREACH tbl IN ARRAY ARRAY['phone_call_insights', 'phone_call_task_suggestions'] LOOP
    SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = ('public.' || tbl)::regclass;
    SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ' ' ORDER BY cmd) INTO v_text FROM pg_policies
     WHERE schemaname = 'public' AND tablename = tbl;
    IF NOT coalesce(v_bool, false)
       OR v_text IS DISTINCT FROM (CASE WHEN tbl = 'phone_call_insights'
                                        THEN 'SELECT:authenticated'
                                        ELSE 'SELECT:authenticated UPDATE:authenticated' END) THEN
      failures := failures || format('[16. %s : RLS %s, policies %s] ', tbl, v_bool, v_text);
    END IF;
  END LOOP;
  -- La policy de mise à jour : seules les lignes encore proposées, et seulement vers acceptée ou ignorée.
  SELECT qual || ' / ' || with_check INTO v_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'phone_call_task_suggestions' AND cmd = 'UPDATE';
  IF v_pol IS NULL OR v_pol NOT LIKE '%''proposed''%' OR v_pol NOT LIKE '%''accepted''%' OR v_pol NOT LIKE '%''dismissed''%' THEN
    failures := failures || format('[16. policy de mise à jour des suggestions : %s] ', v_pol);
  END IF;

  -- 17. Privilèges : rien pour anon ; authenticated lit, et ne met à jour que
  --     trois colonnes des suggestions ; tout pour service_role.
  FOREACH tbl IN ARRAY ARRAY['phone_call_insights', 'phone_call_task_suggestions'] LOOP
    FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || tbl, pr) THEN
        failures := failures || format('[17. anon a %s sur %s] ', pr, tbl);
      END IF;
      IF pr <> 'SELECT' AND has_table_privilege('authenticated', 'public.' || tbl, pr) THEN
        failures := failures || format('[17. authenticated a %s sur toute la table %s] ', pr, tbl);
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') THEN
      failures := failures || format('[17. lecture authenticated manquante sur %s] ', tbl);
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || tbl, 'SELECT, INSERT, UPDATE, DELETE') THEN
      failures := failures || format('[17. écriture service_role manquante sur %s] ', tbl);
    END IF;
  END LOOP;
  IF has_column_privilege('authenticated', 'public.phone_call_insights', 'summary', 'UPDATE') THEN
    failures := failures || '[17. authenticated peut modifier un résumé] ';
  END IF;
  FOREACH v_text IN ARRAY ARRAY['state', 'reminder_id', 'resolved_at'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.phone_call_task_suggestions', v_text, 'UPDATE') THEN
      failures := failures || format('[17. mise à jour de %s refusée à authenticated] ', v_text);
    END IF;
  END LOOP;
  FOREACH v_text IN ARRAY ARRAY['title', 'reason', 'due_in_days', 'organization_id', 'phone_call_id'] LOOP
    IF has_column_privilege('authenticated', 'public.phone_call_task_suggestions', v_text, 'UPDATE') THEN
      failures := failures || format('[17. authenticated peut modifier %s] ', v_text);
    END IF;
  END LOOP;

  -- 18. Cascade : avec l'organisation et avec l'appel.
  FOREACH tbl IN ARRAY ARRAY['phone_call_insights', 'phone_call_task_suggestions'] LOOP
    SELECT count(*) INTO n FROM pg_constraint
     WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'f'
       AND confrelid = 'public.organizations'::regclass AND confdeltype = 'c';
    IF n <> 1 THEN failures := failures || format('[18. %s : clé vers organizations sans ON DELETE CASCADE] ', tbl); END IF;
    SELECT count(*) INTO n FROM pg_constraint
     WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'f'
       AND confrelid = 'public.phone_calls'::regclass AND confdeltype = 'c';
    IF n <> 1 THEN failures := failures || format('[18. %s : clé vers phone_calls sans ON DELETE CASCADE] ', tbl); END IF;
  END LOOP;

  -- 19. Une ligne par appel ; état et transcription contraints.
  SELECT id INTO v_call1 FROM public.phone_calls WHERE organization_id = o1 AND external_id = 'A-1';
  SELECT id INTO v_call2 FROM public.phone_calls WHERE organization_id = o2 AND external_id = 'A-1';
  INSERT INTO public.phone_call_insights (organization_id, phone_call_id, status, transcript, summary)
  VALUES (o1, v_call1, 'ready', '[{"speaker":"contact","text":"bonjour"}]'::jsonb, 'Résumé O1'),
         (o2, v_call2, 'transcribed', '[]'::jsonb, NULL);
  BEGIN
    INSERT INTO public.phone_call_insights (organization_id, phone_call_id) VALUES (o1, v_call1);
    failures := failures || '[19. deux lignes de transcription pour un même appel] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.phone_call_insights SET status = 'weird' WHERE phone_call_id = v_call1;
    failures := failures || '[19. état inconnu accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.phone_call_insights SET transcript = '{"a":1}'::jsonb WHERE phone_call_id = v_call1;
    failures := failures || '[19. transcription qui n''est pas une liste acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT status INTO v_status FROM public.phone_call_insights WHERE phone_call_id = v_call2;
  IF v_status IS DISTINCT FROM 'transcribed' THEN failures := failures || format('[19. état de O2 : %s] ', v_status); END IF;

  -- 20. Lecture sous le rôle des utilisateurs : l'organisation de l'appelant seulement.
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_insights;
  SELECT summary INTO v_text FROM public.phone_call_insights;
  IF n <> 1 OR v_text IS DISTINCT FROM 'Résumé O1' THEN
    failures := failures || format('[20. A voit %s transcription(s), résumé %s, attendu 1 (O1)] ', n, v_text);
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_insights;
  IF n <> 1 THEN failures := failures || format('[20. B (membre de O1) voit %s transcription(s), attendu 1] ', n); END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_insights;
  SELECT count(*) INTO v_talk FROM public.phone_call_insights WHERE organization_id = o1;
  IF n <> 1 OR v_talk <> 0 THEN
    failures := failures || format('[20. C voit %s transcription(s) dont %s de O1, attendu 1 et 0] ', n, v_talk);
  END IF;
  RESET ROLE;

  -- 21. Tâches proposées : l'état change une fois, dans l'organisation de l'appelant seulement.
  INSERT INTO public.phone_call_task_suggestions (organization_id, phone_call_id, title, reason, due_in_days)
  VALUES (o1, v_call1, 'Envoyer la fiche de poste', 'Le candidat l''a demandée.', 1),
         (o1, v_call1, 'Relancer vendredi', NULL, 3);
  SELECT id INTO v_sug1 FROM public.phone_call_task_suggestions WHERE title = 'Envoyer la fiche de poste';
  SELECT id INTO v_sug2 FROM public.phone_call_task_suggestions WHERE title = 'Relancer vendredi';
  BEGIN
    INSERT INTO public.phone_call_task_suggestions (organization_id, phone_call_id, title, due_in_days)
    VALUES (o1, v_call1, 'x', 90);
    failures := failures || '[21. échéance de 90 jours acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.phone_call_task_suggestions (organization_id, phone_call_id, title)
    VALUES (o1, v_call1, '');
    failures := failures || '[21. titre vide accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- C (O2) ne touche pas aux suggestions de O1 : aucune ligne modifiée.
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.phone_call_task_suggestions SET state = 'dismissed', resolved_at = now() WHERE id = v_sug1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || format('[21. C modifie %s suggestion(s) de O1] ', n); END IF;
  RESET ROLE;

  -- B (membre de O1) accepte : une ligne ; il ne peut plus la changer ensuite.
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.phone_call_task_suggestions;
  IF n <> 2 THEN failures := failures || format('[21. B voit %s suggestion(s), attendu 2] ', n); END IF;
  UPDATE public.phone_call_task_suggestions SET state = 'accepted', resolved_at = now() WHERE id = v_sug1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || format('[21. B accepte %s suggestion(s), attendu 1] ', n); END IF;
  UPDATE public.phone_call_task_suggestions SET state = 'dismissed', resolved_at = now() WHERE id = v_sug1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || format('[21. une suggestion déjà acceptée change encore d''état (%s ligne(s))] ', n); END IF;
  UPDATE public.phone_call_task_suggestions SET state = 'dismissed', resolved_at = now() WHERE id = v_sug2;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || format('[21. B ignore %s suggestion(s), attendu 1] ', n); END IF;
  RESET ROLE;
  SELECT string_agg(state, ',' ORDER BY title) INTO v_text FROM public.phone_call_task_suggestions;
  IF v_text IS DISTINCT FROM 'accepted,dismissed' THEN failures := failures || format('[21. états finaux : %s] ', v_text); END IF;

  -- 22. Effacer l'appel efface sa transcription et ses suggestions.
  DELETE FROM public.phone_calls WHERE id = v_call1;
  SELECT count(*) INTO n FROM public.phone_call_insights WHERE phone_call_id = v_call1;
  SELECT count(*) INTO v_talk FROM public.phone_call_task_suggestions WHERE phone_call_id = v_call1;
  IF n <> 0 OR v_talk <> 0 THEN
    failures := failures || format('[22. appel effacé : %s transcription(s) et %s suggestion(s) restent] ', n, v_talk);
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'telephony_audit : %', failures;
  END IF;
  RAISE NOTICE 'telephony_audit : 22 contrôles passés';
END $$;
