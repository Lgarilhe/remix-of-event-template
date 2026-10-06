-- =====================================================================
-- Grilles d'entretien et séances de l'assistant en direct : lot 1.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/scorecard_live_lot1_audit.sql; ROLLBACK;
-- Vérifie la migration *_scorecard_live_lot1_rattachement.sql :
--  * reprise des lignes existantes (copie à l'identique des deux UPDATE de la
--    migration, gardée par tests/c1/scorecard-live-lot1.test.mjs) ;
--  * lecture par toute l'organisation, écriture par l'auteur seul (grilles et
--    séances), created_by imposé à l'insertion ;
--  * mission, étape, grille et événement liés : ceux de l'organisation de la
--    ligne, l'étape celle de la mission (policies RESTRICTIVE) ;
--  * expiration de la transcription et consentement posés par le serveur pour
--    un utilisateur connecté, libres pour la clé de service et les contextes
--    sans jeton.
-- Utilisateurs A (propriétaire) et B (membre) dans l'organisation O1, C dans
-- O2. Les contrôles sont accumulés ; une exception finale liste ceux en
-- échec. Aucune fonction n'est appelée sous SET ROLE authenticated hors de
-- celles que les policies évaluent (CLAUDE.md).
-- =====================================================================
DO $$
DECLARE
  u_a uuid := 'e1111111-1111-4111-8111-111111111111';
  u_b uuid := 'e2222222-2222-4222-8222-222222222222';
  u_c uuid := 'e3333333-3333-4333-8333-333333333333';
  o1 uuid := 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  p1 uuid := 'ea000000-0000-4000-8000-000000000001';
  p2 uuid := 'eb000000-0000-4000-8000-000000000002';
  p3 uuid := 'ea000000-0000-4000-8000-000000000003';
  p4 uuid := 'ea000000-0000-4000-8000-000000000004';
  s1 uuid := 'ea100000-0000-4000-8000-000000000001';
  s2 uuid := 'eb100000-0000-4000-8000-000000000002';
  s3 uuid := 'ea100000-0000-4000-8000-000000000003';
  q1 uuid := 'ea200000-0000-4000-8000-000000000001';
  q2 uuid := 'eb200000-0000-4000-8000-000000000002';
  g_c uuid := 'eb300000-0000-4000-8000-0000000000c1';
  jcs_portal uuid := 'ea400000-0000-4000-8000-000000000001';
  nil_author uuid := '00000000-0000-0000-0000-000000000000';
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@scorecard.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@scorecard.test')::text;
  claims_c text := json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@scorecard.test')::text;
  g1 uuid;
  g2 uuid;
  k1 uuid;
  k2 uuid;
  n integer;
  v_text text;
  v_ts timestamptz;
  v_ts2 timestamptz;
  v_state text;
  rec record;
  failures text := '';
BEGIN
  -- ===== Jeu de données (rôle de la session, sans jeton) =====
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@scorecard.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@scorecard.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@scorecard.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Scorecard Org 1', 'scorecard-org-1', u_a),
         (o2, 'Scorecard Org 2', 'scorecard-org-2', u_c);
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, o1), (u_b, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by, job_id)
  VALUES (p1, 'Mission Scorecard 1', o1, u_a, 'EXT-1'),
         (p2, 'Mission Scorecard 2', o2, u_c, NULL),
         (p3, 'Mission Scorecard 3', o1, u_a, 'DUP'),
         (p4, 'Mission Scorecard 4', o1, u_a, 'DUP');
  INSERT INTO public.mission_process_steps (id, project_id, organization_id, step_order, name)
  VALUES (s1, p1, o1, 1, 'Entretien RH'),
         (s2, p2, o2, 1, 'Entretien RH'),
         (s3, p3, o1, 1, 'Entretien technique');
  INSERT INTO public.qualification_sessions (id, created_by, organization_id)
  VALUES (q1, u_a, o1), (q2, u_c, o2);
  INSERT INTO public.candidate_evaluations (id, candidate_id, job_id, created_by, organization_id)
  VALUES (g_c, 'cand-c', 'project:' || p2, u_c, o2);
  INSERT INTO public.job_candidate_status
    (id, candidate_id, job_id, project_id, organization_id, created_by, status, candidate_name)
  VALUES (jcs_portal, 'cand-portal', 'project:' || p1, p1, o1, u_a, 'shortlisted', 'Candidat Portail');

  -- ===== 1 à 7. Reprise des lignes existantes =====
  -- Lignes telles que la base les contenait avant la migration (sans rattachement).
  INSERT INTO public.candidate_evaluations (id, candidate_id, job_id, created_by, organization_id)
  VALUES ('ea500000-0000-4000-8000-000000000001', 'cand-l1', 'project:' || p1, u_a, o1),
         ('ea500000-0000-4000-8000-000000000002', 'cand-l2', 'EXT-1', u_a, o1),
         ('ea500000-0000-4000-8000-000000000003', 'cand-l3', 'DUP', u_a, o1),
         ('ea500000-0000-4000-8000-000000000004', 'cand-l4', p1::text, u_a, o1),
         ('ea500000-0000-4000-8000-000000000005', 'cand-l5', 'EXT-1', u_c, o2),
         ('ea500000-0000-4000-8000-000000000006', jcs_portal::text, p1::text, nil_author, o1),
         ('ea500000-0000-4000-8000-000000000007', jcs_portal::text, p1::text, u_a, o1);

  -- Copie à l'identique des deux UPDATE de la migration (reprise 2-a puis 2-b).
  UPDATE public.candidate_evaluations ce
  SET candidate_id = jcs.candidate_id,
      project_id = coalesce(ce.project_id, jcs.project_id)
  FROM public.job_candidate_status jcs
  WHERE ce.created_by = '00000000-0000-0000-0000-000000000000'::uuid
    AND ce.candidate_id = jcs.id::text
    AND jcs.organization_id = ce.organization_id;

  UPDATE public.candidate_evaluations ce
  SET project_id = m.project_id
  FROM (
    SELECT e.id AS evaluation_id, (array_agg(sp.id))[1] AS project_id
    FROM public.candidate_evaluations e
    JOIN public.sourcing_projects sp
      ON sp.organization_id = e.organization_id
     AND (sp.id::text = regexp_replace(e.job_id, '^project:', '')
          OR sp.job_id = e.job_id)
    WHERE e.project_id IS NULL
      AND e.organization_id IS NOT NULL
      AND coalesce(e.job_id, '') <> ''
    GROUP BY e.id
    HAVING count(DISTINCT sp.id) = 1
  ) m
  WHERE ce.id = m.evaluation_id
    AND ce.project_id IS NULL;

  FOR rec IN
    SELECT * FROM (VALUES
      ('ea500000-0000-4000-8000-000000000001'::uuid, 'job_id « project:{uuid} »', p1),
      ('ea500000-0000-4000-8000-000000000002'::uuid, 'job_id externe d''une seule mission', p1),
      ('ea500000-0000-4000-8000-000000000003'::uuid, 'job_id partagé par deux missions (rien de deviné)', NULL::uuid),
      ('ea500000-0000-4000-8000-000000000004'::uuid, 'job_id = id de la mission', p1),
      ('ea500000-0000-4000-8000-000000000005'::uuid, 'job_id d''une mission d''une autre organisation (jamais rattaché)', NULL::uuid),
      ('ea500000-0000-4000-8000-000000000006'::uuid, 'avis du portail', p1),
      ('ea500000-0000-4000-8000-000000000007'::uuid, 'ligne d''un recruteur (jamais traitée comme avis du portail)', p1)
    ) AS t(eid, label, expected)
  LOOP
    SELECT ce.project_id::text INTO v_text FROM public.candidate_evaluations ce WHERE ce.id = rec.eid;
    IF v_text IS DISTINCT FROM rec.expected::text THEN
      failures := failures || format('[reprise, %s : project_id %s, attendu %s] ', rec.label, coalesce(v_text, 'NULL'), coalesce(rec.expected::text, 'NULL'));
    END IF;
  END LOOP;

  SELECT candidate_id INTO v_text FROM public.candidate_evaluations WHERE id = 'ea500000-0000-4000-8000-000000000006';
  IF v_text IS DISTINCT FROM 'cand-portal' THEN
    failures := failures || format('[reprise, avis du portail : candidate_id %s, attendu cand-portal] ', coalesce(v_text, 'NULL'));
  END IF;
  SELECT candidate_id INTO v_text FROM public.candidate_evaluations WHERE id = 'ea500000-0000-4000-8000-000000000007';
  IF v_text IS DISTINCT FROM jcs_portal::text THEN
    failures := failures || format('[reprise, ligne d''un recruteur : candidate_id modifié en %s] ', coalesce(v_text, 'NULL'));
  END IF;

  -- ===== Contexte : A (auteur, propriétaire de O1) =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 8. A crée sa grille rattachée à la mission P1 et à l'étape S1.
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, job_id, created_by, organization_id, project_id, process_step_id)
    VALUES ('cand-1', 'project:' || p1, u_a, o1, p1, s1)
    RETURNING id INTO g1;
    IF g1 IS NULL THEN failures := failures || '[8. grille de A : aucune ligne relue] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[8. grille de A : %s] ', SQLERRM);
  END;

  -- 9. A ne crée pas une grille au nom de B (created_by imposé).
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id)
    VALUES ('cand-1', u_b, o1);
    failures := failures || '[9. A a créé une grille au nom de B] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[9. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;

  -- 10. A ne rattache pas une grille à la mission d'une autre organisation.
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id, project_id)
    VALUES ('cand-1', u_a, o1, p2);
    failures := failures || '[10. A a rattaché une grille à la mission de O2] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[10. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;

  -- 11. A ne rattache pas une grille à l'étape d'une autre mission (même organisation),
  --     ni à une étape sans mission.
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id, project_id, process_step_id)
    VALUES ('cand-1', u_a, o1, p1, s3);
    failures := failures || '[11a. A a rattaché une grille à l''étape d''une autre mission] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[11a. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id, process_step_id)
    VALUES ('cand-1', u_a, o1, s1);
    failures := failures || '[11b. A a rattaché une grille à une étape sans mission] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[11b. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;

  -- 12. A modifie sa grille : 1 ligne. Il ne la passe ni à B, ni à la mission de O2.
  UPDATE public.candidate_evaluations SET summary = 'Bon entretien' WHERE id = g1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN failures := failures || format('[12a. A modifie sa grille : %s ligne(s), attendu 1] ', n); END IF;
  BEGIN
    UPDATE public.candidate_evaluations SET created_by = u_b WHERE id = g1;
    failures := failures || '[12b. A a transféré sa grille à B] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[12b. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;
  BEGIN
    UPDATE public.candidate_evaluations SET project_id = p2 WHERE id = g1;
    failures := failures || '[12c. A a rattaché sa grille à la mission de O2] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[12c. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;

  -- 13. A crée une séance rattachée (mission, étape, grille, événement) en
  --     annonçant un consentement daté de 2000 et une expiration en 2099.
  BEGIN
    INSERT INTO public.call_coaching_sessions
      (candidate_id, job_id, scorecard_id, created_by, organization_id, project_id, process_step_id,
       evaluation_id, qualification_session_id, candidate_consent_at, transcript_expires_at, transcript_purged_at)
    VALUES ('cand-1', 'project:' || p1, g1::text, u_a, o1, p1, s1, g1, q1,
            '2000-01-01', '2099-01-01', now())
    RETURNING id, transcript_expires_at, candidate_consent_at INTO k1, v_ts, v_ts2;
    IF k1 IS NULL THEN failures := failures || '[13. séance de A : aucune ligne relue] ';
    ELSE
      IF v_ts < now() + interval '89 days' OR v_ts > now() + interval '91 days' THEN
        failures := failures || format('[13a. expiration %s, attendu dans 90 jours] ', v_ts);
      END IF;
      IF v_ts2 < now() - interval '1 minute' OR v_ts2 > now() + interval '1 minute' THEN
        failures := failures || format('[13b. consentement %s, attendu l''instant du serveur] ', v_ts2);
      END IF;
      SELECT transcript_purged_at::text INTO v_text FROM public.call_coaching_sessions WHERE id = k1;
      IF v_text IS NOT NULL THEN failures := failures || '[13c. A a annoncé une purge à l''insertion] '; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[13. séance de A : %s] ', SQLERRM);
  END;

  -- 14. A ne peut ni prolonger la conservation, ni effacer ou changer son consentement,
  --     ni annoncer une purge (la mise à jour garde les valeurs d'origine).
  IF k1 IS NOT NULL THEN
    UPDATE public.call_coaching_sessions
    SET transcript_expires_at = '2099-01-01', candidate_consent_at = NULL, transcript_purged_at = now()
    WHERE id = k1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[14. A modifie sa séance : %s ligne(s), attendu 1] ', n); END IF;
    SELECT transcript_expires_at, candidate_consent_at, transcript_purged_at::text
      INTO v_ts, v_ts2, v_text
      FROM public.call_coaching_sessions WHERE id = k1;
    IF v_ts > now() + interval '91 days' THEN failures := failures || '[14a. A a prolongé la conservation de sa transcription] '; END IF;
    IF v_ts2 IS NULL OR v_ts2 < now() - interval '1 minute' THEN failures := failures || '[14b. A a effacé ou changé son consentement] '; END IF;
    IF v_text IS NOT NULL THEN failures := failures || '[14c. A a annoncé une purge] '; END IF;
  END IF;

  -- 15. Consentement donné après coup : instant du serveur, puis plus de changement.
  BEGIN
    INSERT INTO public.call_coaching_sessions (candidate_id, job_id, scorecard_id, created_by, organization_id)
    VALUES ('cand-2', 'project:' || p1, 'new', u_a, o1)
    RETURNING id INTO k2;
    SELECT candidate_consent_at::text INTO v_text FROM public.call_coaching_sessions WHERE id = k2;
    IF v_text IS NOT NULL THEN failures := failures || '[15a. consentement présent sans avoir été donné] '; END IF;
    UPDATE public.call_coaching_sessions SET candidate_consent_at = '2000-01-01' WHERE id = k2;
    SELECT candidate_consent_at INTO v_ts FROM public.call_coaching_sessions WHERE id = k2;
    IF v_ts IS NULL OR v_ts < now() - interval '1 minute' THEN
      failures := failures || format('[15b. consentement %s, attendu l''instant du serveur] ', v_ts);
    END IF;
    UPDATE public.call_coaching_sessions SET candidate_consent_at = now() + interval '5 days' WHERE id = k2;
    SELECT candidate_consent_at INTO v_ts2 FROM public.call_coaching_sessions WHERE id = k2;
    IF v_ts2 IS DISTINCT FROM v_ts THEN failures := failures || '[15c. le consentement a changé après avoir été enregistré] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[15. consentement après coup : %s] ', SQLERRM);
  END;

  -- 16. A ne lie pas une séance à la grille ni à l'événement d'une autre organisation,
  --     ni à la mission de O2.
  BEGIN
    INSERT INTO public.call_coaching_sessions (candidate_id, job_id, scorecard_id, created_by, organization_id, evaluation_id)
    VALUES ('cand-1', 'x', 'new', u_a, o1, g_c);
    failures := failures || '[16a. A a lié une séance à la grille de O2] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[16a. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;
  BEGIN
    INSERT INTO public.call_coaching_sessions (candidate_id, job_id, scorecard_id, created_by, organization_id, qualification_session_id)
    VALUES ('cand-1', 'x', 'new', u_a, o1, q2);
    failures := failures || '[16b. A a lié une séance à l''événement de O2] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[16b. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;
  BEGIN
    INSERT INTO public.call_coaching_sessions (candidate_id, job_id, scorecard_id, created_by, organization_id, project_id)
    VALUES ('cand-1', 'x', 'new', u_a, o1, p2);
    failures := failures || '[16c. A a lié une séance à la mission de O2] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[16c. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;
  BEGIN
    INSERT INTO public.call_coaching_sessions (candidate_id, job_id, scorecard_id, created_by, organization_id, project_id, process_step_id)
    VALUES ('cand-1', 'x', 'new', u_a, o1, p1, s3);
    failures := failures || '[16d. A a lié une séance à l''étape d''une autre mission] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[16d. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;
  BEGIN
    INSERT INTO public.call_coaching_sessions (candidate_id, job_id, scorecard_id, created_by, organization_id)
    VALUES ('cand-1', 'x', 'new', u_b, o1);
    failures := failures || '[16e. A a créé une séance au nom de B] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[16e. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;

  -- ===== Contexte : B (membre de O1, pas l'auteur) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 17. B lit la grille et la séance de A (lecture d'équipe).
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE id = g1;
  IF n <> 1 THEN failures := failures || format('[17a. B lit %s grille(s) de A, attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.call_coaching_sessions WHERE id = k1;
  IF n <> 1 THEN failures := failures || format('[17b. B lit %s séance(s) de A, attendu 1] ', n); END IF;

  -- 18. B ne modifie ni ne supprime la grille ni la séance de A.
  UPDATE public.candidate_evaluations SET summary = 'Écrasé par B' WHERE id = g1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || format('[18a. B a modifié la grille de A (%s ligne)] ', n); END IF;
  DELETE FROM public.candidate_evaluations WHERE id = g1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || format('[18b. B a supprimé la grille de A (%s ligne)] ', n); END IF;
  UPDATE public.call_coaching_sessions SET transcript = 'Écrasé par B' WHERE id = k1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || format('[18c. B a modifié la séance de A (%s ligne)] ', n); END IF;
  DELETE FROM public.call_coaching_sessions WHERE id = k1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN failures := failures || format('[18d. B a supprimé la séance de A (%s ligne)] ', n); END IF;

  -- 19. B crée sa propre grille sur le même candidat et la même étape : la lecture
  --     d'équipe montre alors deux grilles.
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, job_id, created_by, organization_id, project_id, process_step_id)
    VALUES ('cand-1', 'project:' || p1, u_b, o1, p1, s1)
    RETURNING id INTO g2;
    SELECT count(*) INTO n FROM public.candidate_evaluations
    WHERE candidate_id = 'cand-1' AND project_id = p1 AND process_step_id = s1;
    IF n <> 2 THEN failures := failures || format('[19. %s grille(s) sur le candidat et l''étape, attendu 2 (A et B)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[19. grille de B : %s] ', SQLERRM);
  END;

  -- ===== Contexte : C (autre organisation) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_c, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 20. C ne voit rien des grilles ni des séances de O1.
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE organization_id = o1;
  IF n <> 0 THEN failures := failures || format('[20a. C voit %s grille(s) de O1] ', n); END IF;
  SELECT count(*) INTO n FROM public.call_coaching_sessions WHERE organization_id = o1;
  IF n <> 0 THEN failures := failures || format('[20b. C voit %s séance(s) de O1] ', n); END IF;

  -- 21. C ne crée pas une grille de son organisation liée à la mission de O1.
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id, project_id)
    VALUES ('cand-c2', u_c, o2, p1);
    failures := failures || '[21. C a rattaché une grille de O2 à la mission de O1] ';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN failures := failures || format('[21. refus attendu en 42501, reçu %s : %s] ', SQLSTATE, SQLERRM); END IF;
  END;

  -- ===== Contextes sans jeton ou clé de service : écriture libre =====
  RESET ROLE;

  -- 22. Sans jeton (migration, psql, cron de purge) : l'expiration et la purge s'écrivent.
  IF k1 IS NOT NULL THEN
    UPDATE public.call_coaching_sessions
    SET transcript_expires_at = '2030-06-01', transcript_purged_at = '2030-06-02'
    WHERE id = k1;
    SELECT transcript_expires_at::date::text || '/' || transcript_purged_at::date::text INTO v_state
      FROM public.call_coaching_sessions WHERE id = k1;
    IF v_state IS DISTINCT FROM '2030-06-01/2030-06-02' THEN
      failures := failures || format('[22. contexte sans jeton : %s, attendu 2030-06-01/2030-06-02] ', v_state);
    END IF;

    -- 23. Clé de service : même liberté (purge de la transcription au lot 6).
    SET LOCAL ROLE service_role;
    UPDATE public.call_coaching_sessions
    SET transcript = '', transcript_purged_at = '2031-01-01'
    WHERE id = k1;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    SELECT transcript_purged_at::date::text INTO v_state FROM public.call_coaching_sessions WHERE id = k1;
    IF n <> 1 OR v_state IS DISTINCT FROM '2031-01-01' THEN
      failures := failures || format('[23. service_role : %s ligne(s), purge %s] ', n, v_state);
    END IF;
  END IF;

  -- 24. Suppression d'une mission : la grille et la séance restent, sans mission.
  DELETE FROM public.sourcing_projects WHERE id = p1;
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE id = g1 AND project_id IS NULL AND process_step_id IS NULL;
  IF n <> 1 THEN failures := failures || '[24a. la grille de A ne survit pas à la suppression de sa mission] '; END IF;
  SELECT count(*) INTO n FROM public.call_coaching_sessions WHERE id = k1 AND project_id IS NULL AND process_step_id IS NULL;
  IF n <> 1 THEN failures := failures || '[24b. la séance de A ne survit pas à la suppression de sa mission] '; END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'scorecard_live_lot1_audit : contrôles en échec : %', failures;
  END IF;
  RAISE NOTICE 'scorecard_live_lot1_audit : tous les contrôles passent';
END
$$;
