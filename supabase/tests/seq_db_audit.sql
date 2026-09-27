-- =====================================================================
-- Module séquences, lot « db » des tests de bout en bout (2026-09-27).
-- Base, contraintes, RLS et reprise des données héritées par la migration
-- 20260925163421_sequences_audit_lot_b6.sql (« B6 »).
--
-- BASE LOCALE OU CI UNIQUEMENT, JAMAIS EN PROD : la dernière partie simule
-- l'état de la prod d'avant B6 (contraintes de statut retirées, colonne
-- assigned_sender_id repassée en uuid, déclencheurs coupés le temps du jeu de
-- données) puis rejoue le fichier B6 dans la transaction. Tout est annulé par
-- le ROLLBACK final, mais ces ALTER TABLE prennent un verrou exclusif.
--
--   BEGIN; \i supabase/tests/seq_db_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/seq_db_audit.sql -c 'ROLLBACK;')
--
-- Chaque bloc accumule ses contrôles dans seq_db_results ; le dernier bloc
-- lève une seule exception listant les contrôles en échec, préfixés par la
-- clé du comportement testé. Les échecs marqués « DÉFAUT » sont des écarts
-- de l'application au contrat (CLAUDE.md, section « Séquences : règles du
-- moteur et de l'interface », et docs/audit-2026-09-25-sequences.md), laissés
-- rouges volontairement.
-- =====================================================================
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '180s';

CREATE TEMP TABLE seq_db_results (
  behaviour text NOT NULL,
  checks int NOT NULL,
  failures text NOT NULL
) ON COMMIT DROP;

-- Contexte d'appel : utilisateur connecté (p_uid) ou chemin serveur (NULL).
-- Vide aussi le cache transactionnel de get_user_org_id des quatre
-- utilisateurs du jeu, dont l'organisation active change en cours de route.
CREATE FUNCTION pg_temp.seqdb_as(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  u uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid IS NULL THEN '' ELSE 'authenticated' END, true);
  FOREACH u IN ARRAY ARRAY[
    'd6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-00000000000b',
    'd6000000-0000-4000-8000-00000000000c', 'd6000000-0000-4000-8000-00000000000d']::uuid[]
  LOOP
    PERFORM set_config('app.user_org.u_' || replace(u::text, '-', '_'), '', true);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Jeu de données commun (chemin serveur)
--   u_a propriétaire de A, u_b propriétaire de B, u_m membre de A,
--   u_c collaborateur de A. Mission proj_a (A), proj_b (B).
--   seq_a (A, mission proj_a) : étapes a1, a2 ; inscription enr_a de u_a
--   avec une exécution envoyée (a1) et une programmée (a2).
--   seq_a2 (A, sans mission), seq_b (B, mission proj_b) : étape b1.
--   Compte LinkedIn 'seqdb-acc-owner' relié à u_a.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  u_b uuid := 'd6000000-0000-4000-8000-00000000000b';
  u_m uuid := 'd6000000-0000-4000-8000-00000000000c';
  u_c uuid := 'd6000000-0000-4000-8000-00000000000d';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  org_b uuid := 'd6b00000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'seqdb-a@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'seqdb-b@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_m, 'seqdb-m@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'seqdb-c@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, org_type, created_by)
  VALUES (org_a, 'SeqDB Org A', 'seqdb-org-a', 'agency', u_a),
         (org_b, 'SeqDB Org B', 'seqdb-org-b', 'agency', u_b);
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_m, 'member'), (org_a, u_c, 'collaborator');
  UPDATE public.profiles SET active_organization_id = org_a WHERE user_id IN (u_a, u_m, u_c);
  UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = u_b;

  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES ('d6a10000-0000-4000-8000-000000000001', 'Mission A', org_a, u_a),
         ('d6b10000-0000-4000-8000-000000000001', 'Mission B', org_b, u_b);

  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, project_id, is_active)
  VALUES ('d6a20000-0000-4000-8000-000000000001', 'SeqDB A', org_a, u_a, 'd6a10000-0000-4000-8000-000000000001', true),
         ('d6a20000-0000-4000-8000-000000000002', 'SeqDB A2', org_a, u_a, NULL, true),
         ('d6b20000-0000-4000-8000-000000000001', 'SeqDB B', org_b, u_b, 'd6b10000-0000-4000-8000-000000000001', true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES ('d6a30000-0000-4000-8000-000000000001', 'd6a20000-0000-4000-8000-000000000001', org_a, 1, 'message', 'Bonjour A1'),
         ('d6a30000-0000-4000-8000-000000000002', 'd6a20000-0000-4000-8000-000000000001', org_a, 2, 'message', 'Relance A2'),
         ('d6a30000-0000-4000-8000-000000000021', 'd6a20000-0000-4000-8000-000000000002', org_a, 1, 'message', 'Bonjour A2-1'),
         ('d6b30000-0000-4000-8000-000000000001', 'd6b20000-0000-4000-8000-000000000001', org_b, 1, 'message', 'Bonjour B1');
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (org_a, u_a, 'seqdb-acc-owner', u_a);
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, current_step_order)
  VALUES ('d6a40000-0000-4000-8000-000000000001', 'd6a20000-0000-4000-8000-000000000001', 'seqdb-acc-owner',
          'seqdb-prof-a', org_a, u_a, 'active', 1);
  INSERT INTO public.sequence_step_executions (id, enrollment_id, step_id, step_order, scheduled_at, status, executed_at, final_message)
  VALUES ('d6a50000-0000-4000-8000-000000000001', 'd6a40000-0000-4000-8000-000000000001', 'd6a30000-0000-4000-8000-000000000001',
          1, now() - interval '2 days', 'sent', now() - interval '2 days', 'Bonjour A1'),
         ('d6a50000-0000-4000-8000-000000000002', 'd6a40000-0000-4000-8000-000000000001', 'd6a30000-0000-4000-8000-000000000002',
          2, now() + interval '1 day', 'scheduled', NULL, NULL);
END $$;

-- ---------------------------------------------------------------------
-- rls-org-recopiee-ou-refusee-mise-a-jour (SEQ-009, SEQ-056)
-- Une inscription ou une exécution sans organisation reçoit celle de son
-- parent ; une mise à jour ne fait changer d'organisation ni une étape, ni
-- une inscription, ni une séquence.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  org_b uuid := 'd6b00000-0000-4000-8000-000000000001';
  seq_a uuid := 'd6a20000-0000-4000-8000-000000000001';
  seq_a2 uuid := 'd6a20000-0000-4000-8000-000000000002';
  seq_b uuid := 'd6b20000-0000-4000-8000-000000000001';
  proj_b uuid := 'd6b10000-0000-4000-8000-000000000001';
  step_a1 uuid := 'd6a30000-0000-4000-8000-000000000001';
  step_a2 uuid := 'd6a30000-0000-4000-8000-000000000002';
  enr_a uuid := 'd6a40000-0000-4000-8000-000000000001';
  v_enr uuid;
  v_org uuid;
  v_seq uuid;
  v_proj uuid;
  v_hint text;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);

  -- Chemin serveur : inscription sans organisation.
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, created_by, status)
    VALUES (seq_a, 'seqdb-mail-a@audit.test', 'seqdb-org-null', u_a, 'active')
    RETURNING id, organization_id INTO v_enr, v_org;
    IF v_org IS DISTINCT FROM org_a THEN
      f := f || format('[inscription sans organisation : %s au lieu de l''organisation de la séquence] ', v_org);
    END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[inscription sans organisation : %s] ', SQLERRM);
  END;

  -- Chemin serveur : exécution portant une organisation fausse.
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
    VALUES (v_enr, step_a1, 1, now() + interval '3 days', 'scheduled', org_b)
    RETURNING organization_id INTO v_org;
    IF v_org IS DISTINCT FROM org_a THEN
      f := f || format('[exécution : garde l''organisation %s au lieu de celle de son inscription] ', v_org);
    END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[exécution organisation fausse : %s] ', SQLERRM);
  END;

  -- Propriétaire de A connecté.
  PERFORM pg_temp.seqdb_as(u_a);
  SET LOCAL ROLE authenticated;

  -- Étape glissée dans la séquence de B : refus (ou aucune ligne touchée).
  c := c + 1;
  BEGIN
    UPDATE public.sequence_steps SET sequence_id = seq_b WHERE id = step_a2;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN f := f || '[étape déplacée dans la séquence de B acceptée] '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN f := f || format('[étape déplacée : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Inscription passée dans l'organisation B : 42501 SEQUENCE_ORG_MISMATCH.
  c := c + 1;
  BEGIN
    UPDATE public.sequence_enrollments SET organization_id = org_b WHERE id = enr_a;
    f := f || '[inscription passée dans l''organisation B] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'SEQUENCE_ORG_MISMATCH' THEN
      f := f || format('[inscription organisation B : refus sans le HINT SEQUENCE_ORG_MISMATCH (%s)] ', v_hint);
    END IF;
  WHEN OTHERS THEN f := f || format('[inscription organisation B : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Inscription rattachée à la séquence de B : même refus.
  c := c + 1;
  BEGIN
    UPDATE public.sequence_enrollments SET sequence_id = seq_b WHERE id = enr_a;
    f := f || '[inscription rattachée à la séquence de B] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'SEQUENCE_ORG_MISMATCH' THEN
      f := f || format('[inscription séquence de B : refus sans le HINT SEQUENCE_ORG_MISMATCH (%s)] ', v_hint);
    END IF;
  WHEN OTHERS THEN f := f || format('[inscription séquence de B : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Séquence passée dans l'organisation B : 42501 (WITH CHECK).
  c := c + 1;
  BEGIN
    UPDATE public.outreach_sequences SET organization_id = org_b WHERE id = seq_a2;
    f := f || '[séquence passée dans l''organisation B] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN f := f || format('[séquence organisation B : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Séquence rattachée à la mission de B : 42501 PROJECT_ORG_MISMATCH.
  c := c + 1;
  BEGIN
    UPDATE public.outreach_sequences SET project_id = proj_b WHERE id = seq_a2;
    f := f || '[séquence rattachée à la mission de B] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'PROJECT_ORG_MISMATCH' THEN
      f := f || format('[séquence mission de B : refus sans le HINT PROJECT_ORG_MISMATCH (%s)] ', v_hint);
    END IF;
  WHEN OTHERS THEN f := f || format('[séquence mission de B : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);

  -- Relecture serveur : rien n'a bougé.
  c := c + 1;
  SELECT sequence_id, organization_id INTO v_seq, v_org FROM public.sequence_steps WHERE id = step_a2;
  IF v_seq IS DISTINCT FROM seq_a OR v_org IS DISTINCT FROM org_a THEN
    f := f || format('[relecture étape : séquence %s, organisation %s] ', v_seq, v_org);
  END IF;
  SELECT sequence_id, organization_id INTO v_seq, v_org FROM public.sequence_enrollments WHERE id = enr_a;
  IF v_seq IS DISTINCT FROM seq_a OR v_org IS DISTINCT FROM org_a THEN
    f := f || format('[relecture inscription : séquence %s, organisation %s] ', v_seq, v_org);
  END IF;
  SELECT organization_id, project_id INTO v_org, v_proj FROM public.outreach_sequences WHERE id = seq_a2;
  IF v_org IS DISTINCT FROM org_a OR v_proj IS NOT NULL THEN
    f := f || format('[relecture séquence : organisation %s, mission %s] ', v_org, v_proj);
  END IF;

  DELETE FROM public.sequence_enrollments WHERE id = v_enr;
  INSERT INTO seq_db_results VALUES ('rls-org-recopiee-ou-refusee-mise-a-jour', c, f);
END $$;

-- ---------------------------------------------------------------------
-- collaborateur-angles-non-couverts (SEQ-119)
-- Hors de l'équipe de mission, le collaborateur ne lit pas les étapes de la
-- séquence d'un collègue ; dans l'équipe, il ne supprime ni l'inscription ni
-- les exécutions d'un collègue et n'ajoute pas d'exécution à son inscription.
-- Contrôle positif : les mêmes opérations sur sa propre inscription passent.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_c uuid := 'd6000000-0000-4000-8000-00000000000d';
  seq_a uuid := 'd6a20000-0000-4000-8000-000000000001';
  proj_a uuid := 'd6a10000-0000-4000-8000-000000000001';
  step_a1 uuid := 'd6a30000-0000-4000-8000-000000000001';
  enr_a uuid := 'd6a40000-0000-4000-8000-000000000001';
  v_enr uuid;
  v_exec uuid;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(u_c);
  SET LOCAL ROLE authenticated;

  c := c + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_a;
    IF n <> 0 THEN f := f || format('[hors mission : le collaborateur lit %s étape(s) de la séquence d''un collègue] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[hors mission lecture : %s] ', SQLERRM);
  END;

  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.mission_team (project_id, user_id, role) VALUES (proj_a, u_c, 'sourcer');
  PERFORM pg_temp.seqdb_as(u_c);
  SET LOCAL ROLE authenticated;

  -- Contrôle positif : dans l'équipe, il lit les étapes.
  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_a;
  IF n <> 2 THEN f := f || format('[dans la mission : le collaborateur lit %s étape(s) sur 2] ', n); END IF;

  c := c + 1;
  BEGIN
    DELETE FROM public.sequence_enrollments WHERE id = enr_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN f := f || '[le collaborateur supprime l''inscription d''un collègue] '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN f := f || format('[suppression inscription : %s] ', SQLERRM);
  END;

  c := c + 1;
  BEGIN
    DELETE FROM public.sequence_step_executions WHERE enrollment_id = enr_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN f := f || format('[le collaborateur supprime %s exécution(s) d''un collègue] ', n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN f := f || format('[suppression exécutions : %s] ', SQLERRM);
  END;

  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, final_message)
    VALUES (enr_a, step_a1, 1, now() + interval '1 day', 'scheduled', 'Texte du collaborateur');
    f := f || '[le collaborateur ajoute une exécution à l''inscription d''un collègue] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN f := f || format('[ajout exécution collègue : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Contrôle positif : sa propre inscription (compte sans liaison).
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'seqdb-mail-c@audit.test', 'seqdb-prof-c', 'd6a00000-0000-4000-8000-000000000001', u_c, 'active')
    RETURNING id INTO v_enr;
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status)
    VALUES (v_enr, step_a1, 1, now() + interval '1 day', 'scheduled')
    RETURNING id INTO v_exec;
    DELETE FROM public.sequence_step_executions WHERE id = v_exec;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN f := f || '[régression : le collaborateur ne supprime pas l''exécution de sa propre inscription] '; END IF;
    DELETE FROM public.sequence_enrollments WHERE id = v_enr;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN f := f || '[régression : le collaborateur ne supprime pas sa propre inscription] '; END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[régression inscription propre : %s] ', SQLERRM);
  END;

  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);
  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_enrollments WHERE id = enr_a;
  IF n <> 1 THEN f := f || '[relecture : inscription du collègue disparue] '; END IF;
  SELECT count(*) INTO n FROM public.sequence_step_executions WHERE enrollment_id = enr_a;
  IF n <> 2 THEN f := f || format('[relecture : %s exécution(s) du collègue au lieu de 2] ', n); END IF;

  DELETE FROM public.mission_team WHERE project_id = proj_a AND user_id = u_c;
  INSERT INTO seq_db_results VALUES ('collaborateur-angles-non-couverts', c, f);
END $$;

-- ---------------------------------------------------------------------
-- save-steps-historique-tous-statuts (SEQ-059)
-- Retirer une étape qui a un historique est refusé, quel que soit le statut
-- de cet historique, avec HINT STEP_HAS_HISTORY et le numéro d'étape dans le
-- DETAIL. Contrôle inverse : une étape seulement annulée à la main se retire.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  seq_h uuid := 'd6a20000-0000-4000-8000-0000000000a1';
  h1 uuid := 'd6a30000-0000-4000-8000-0000000000a1';
  h2 uuid := 'd6a30000-0000-4000-8000-0000000000a2';
  enr_h uuid := 'd6a40000-0000-4000-8000-0000000000a1';
  cases text[][] := ARRAY[
    ['sending', ''], ['sent', ''], ['opened', ''], ['clicked', ''], ['replied', ''],
    ['bounced', ''], ['failed', ''], ['skipped', ''],
    ['cancelled', 'Enrollment became paused during execution']];
  i int;
  v_exec uuid;
  v_hint text;
  v_detail text;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_h, 'SeqDB historique', org_a, u_a, false);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (h1, seq_h, org_a, 1, 'message', 'Bonjour'), (h2, seq_h, org_a, 2, 'message', 'Relance');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (enr_h, seq_h, 'seqdb-mail-h@audit.test', 'seqdb-prof-h', org_a, u_a, 'active');

  FOR i IN 1 .. array_length(cases, 1) LOOP
    c := c + 1;
    RESET ROLE;
    PERFORM pg_temp.seqdb_as(NULL);
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, skip_reason)
    VALUES (enr_h, h2, 2, now() - interval '1 day', cases[i][1], now() - interval '1 day', NULLIF(cases[i][2], ''))
    RETURNING id INTO v_exec;

    PERFORM pg_temp.seqdb_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM * FROM public.save_sequence_steps(seq_h, jsonb_build_array(
        jsonb_build_object('id', h1, 'step_order', 1, 'action_type', 'message', 'message_template', 'Bonjour')));
      f := f || format('[%s%s : étape 2 retirée malgré son historique] ', cases[i][1],
                       CASE WHEN cases[i][2] <> '' THEN ' « ' || cases[i][2] || ' »' ELSE '' END);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
      IF v_hint IS DISTINCT FROM 'STEP_HAS_HISTORY' THEN
        f := f || format('[%s : refus sans le HINT STEP_HAS_HISTORY (%s)] ', cases[i][1], SQLERRM);
      ELSIF v_detail IS DISTINCT FROM 'Étape(s) concernée(s) : 2' THEN
        f := f || format('[%s : DETAIL « %s » au lieu de « Étape(s) concernée(s) : 2 »] ', cases[i][1], v_detail);
      END IF;
    END;
    RESET ROLE;
    PERFORM pg_temp.seqdb_as(NULL);
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_h;
    IF n <> 2 THEN f := f || format('[%s : %s étape(s) après le refus au lieu de 2] ', cases[i][1], n); END IF;
    DELETE FROM public.sequence_step_executions WHERE id = v_exec;
  END LOOP;

  -- Contrôle inverse : une exécution annulée à la main (« Arrêt manuel »)
  -- n'est pas un historique, l'étape se retire.
  c := c + 1;
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, skip_reason)
  VALUES (enr_h, h2, 2, now() + interval '1 day', 'cancelled', 'Arrêt manuel');
  PERFORM pg_temp.seqdb_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_h, jsonb_build_array(
      jsonb_build_object('id', h1, 'step_order', 1, 'action_type', 'message', 'message_template', 'Bonjour')));
  EXCEPTION WHEN OTHERS THEN f := f || format('[« Arrêt manuel » seul : retrait refusé (%s)] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);
  SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_h;
  IF n <> 1 THEN f := f || format('[« Arrêt manuel » seul : %s étape(s) après retrait au lieu de 1] ', n); END IF;

  DELETE FROM public.outreach_sequences WHERE id = seq_h;
  INSERT INTO seq_db_results VALUES ('save-steps-historique-tous-statuts', c, f);
END $$;

-- ---------------------------------------------------------------------
-- save-steps-refus-atomique (SEQ-059)
-- Une sauvegarde refusée pour historique ne laisse aucune modification :
-- texte de l'étape 1, liens, étape retirée et étape ajoutée inchangés.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  seq_r uuid := 'd6a20000-0000-4000-8000-0000000000b1';
  r1 uuid := 'd6a30000-0000-4000-8000-0000000000b1';
  r2 uuid := 'd6a30000-0000-4000-8000-0000000000b2';
  r3 uuid := 'd6a30000-0000-4000-8000-0000000000b3';
  enr_r uuid := 'd6a40000-0000-4000-8000-0000000000b1';
  v_hint text;
  v_row record;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_r, 'SeqDB atomique', org_a, u_a, false);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (r1, seq_r, org_a, 1, 'check_connection', NULL),
         (r2, seq_r, org_a, 2, 'message', 'Texte r2'),
         (r3, seq_r, org_a, 3, 'message', 'Texte r3');
  UPDATE public.sequence_steps
  SET message_template = 'Texte r1', next_step_id = r2, if_true_goto_step = r2,
      if_false_goto_step = r3, timeout_branch_step_id = r3
  WHERE id = r1;
  UPDATE public.sequence_steps SET next_step_id = r3 WHERE id = r2;
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (enr_r, seq_r, 'seqdb-mail-r@audit.test', 'seqdb-prof-r', org_a, u_a, 'active');
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES (enr_r, r2, 2, now() - interval '1 day', 'sent', now() - interval '1 day');

  PERFORM pg_temp.seqdb_as(u_a);
  SET LOCAL ROLE authenticated;
  c := c + 1;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_r, jsonb_build_array(
      jsonb_build_object('id', r1, 'step_order', 1, 'action_type', 'check_connection',
                         'message_template', 'Texte r1 modifié', 'if_true_goto_step', 'n1', 'if_false_goto_step', r3),
      jsonb_build_object('id', r3, 'step_order', 2, 'action_type', 'message', 'message_template', 'Texte r3'),
      jsonb_build_object('id', 'n1', 'step_order', 3, 'action_type', 'message', 'message_template', 'Nouvelle n1')));
    f := f || '[sauvegarde acceptée alors que l''étape 2 retirée a un historique] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'STEP_HAS_HISTORY' THEN
      f := f || format('[refus sans le HINT STEP_HAS_HISTORY (%s)] ', SQLERRM);
    END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);

  c := c + 1;
  SELECT * INTO v_row FROM public.sequence_steps WHERE id = r1;
  IF v_row.message_template IS DISTINCT FROM 'Texte r1' THEN
    f := f || format('[texte de l''étape 1 modifié malgré le refus : %s] ', v_row.message_template);
  END IF;
  IF v_row.next_step_id IS DISTINCT FROM r2 OR v_row.if_true_goto_step IS DISTINCT FROM r2
     OR v_row.if_false_goto_step IS DISTINCT FROM r3 OR v_row.timeout_branch_step_id IS DISTINCT FROM r3 THEN
    f := f || format('[liens de l''étape 1 modifiés : suivante %s, si vrai %s, si faux %s, délai %s] ',
                     v_row.next_step_id, v_row.if_true_goto_step, v_row.if_false_goto_step, v_row.timeout_branch_step_id);
  END IF;
  SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_r;
  IF n <> 3 THEN f := f || format('[%s étape(s) après le refus au lieu de 3] ', n); END IF;
  SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_r AND message_template = 'Nouvelle n1';
  IF n <> 0 THEN f := f || '[étape n1 ajoutée malgré le refus] '; END IF;
  SELECT count(*) INTO n FROM public.sequence_steps WHERE id = r2 AND step_order = 2 AND next_step_id = r3;
  IF n <> 1 THEN f := f || '[étape 2 retirée ou modifiée malgré le refus] '; END IF;
  SELECT count(*) INTO n FROM public.sequence_steps WHERE id = r3 AND step_order = 3;
  IF n <> 1 THEN f := f || '[étape 3 renumérotée malgré le refus] '; END IF;

  DELETE FROM public.outreach_sequences WHERE id = seq_r;
  INSERT INTO seq_db_results VALUES ('save-steps-refus-atomique', c, f);
END $$;

-- ---------------------------------------------------------------------
-- save-steps-id-etape-etrangere (SEQ-009)
-- L'identifiant d'une étape d'une autre séquence (même organisation ou autre
-- organisation) crée une nouvelle étape et ne modifie jamais l'originale.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  org_b uuid := 'd6b00000-0000-4000-8000-000000000001';
  seq_f1 uuid := 'd6a20000-0000-4000-8000-0000000000c1';
  seq_f2 uuid := 'd6a20000-0000-4000-8000-0000000000c2';
  seq_b uuid := 'd6b20000-0000-4000-8000-000000000001';
  f1a uuid := 'd6a30000-0000-4000-8000-0000000000c1';
  f2a uuid := 'd6a30000-0000-4000-8000-0000000000c2';
  step_b1 uuid := 'd6b30000-0000-4000-8000-000000000001';
  v_row record;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_f1, 'SeqDB S1', org_a, u_a, false), (seq_f2, 'SeqDB S2', org_a, u_a, false);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (f1a, seq_f1, org_a, 1, 'message', 'Texte S1'), (f2a, seq_f2, org_a, 1, 'message', 'Texte S2');

  PERFORM pg_temp.seqdb_as(u_a);
  SET LOCAL ROLE authenticated;

  -- Étape d'une autre séquence de la même organisation.
  c := c + 1;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_f1, jsonb_build_array(
      jsonb_build_object('id', f2a, 'step_order', 1, 'action_type', 'message', 'message_template', 'X')));
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_f1 AND message_template = 'X' AND id <> f2a;
    IF n <> 1 THEN f := f || format('[S2 : %s nouvelle(s) étape(s) « X » dans S1 au lieu de 1] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[S2 : sauvegarde refusée (%s)] ', SQLERRM);
  END;

  -- Étape d'une séquence de l'organisation B.
  c := c + 1;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_f1, jsonb_build_array(
      jsonb_build_object('id', step_b1, 'step_order', 1, 'action_type', 'message', 'message_template', 'Y')));
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_f1 AND message_template = 'Y' AND id <> step_b1;
    IF n <> 1 THEN f := f || format('[B : %s nouvelle(s) étape(s) « Y » dans S1 au lieu de 1] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[B : sauvegarde refusée (%s)] ', SQLERRM);
  END;

  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);
  c := c + 1;
  SELECT * INTO v_row FROM public.sequence_steps WHERE id = f2a;
  IF v_row.sequence_id IS DISTINCT FROM seq_f2 OR v_row.message_template IS DISTINCT FROM 'Texte S2' THEN
    f := f || format('[étape de S2 modifiée : séquence %s, texte %s] ', v_row.sequence_id, v_row.message_template);
  END IF;
  SELECT * INTO v_row FROM public.sequence_steps WHERE id = step_b1;
  IF v_row.sequence_id IS DISTINCT FROM seq_b OR v_row.organization_id IS DISTINCT FROM org_b
     OR v_row.message_template IS DISTINCT FROM 'Bonjour B1' THEN
    f := f || format('[étape de B modifiée : séquence %s, texte %s] ', v_row.sequence_id, v_row.message_template);
  END IF;

  DELETE FROM public.outreach_sequences WHERE id IN (seq_f1, seq_f2);
  INSERT INTO seq_db_results VALUES ('save-steps-id-etape-etrangere', c, f);
END $$;

-- ---------------------------------------------------------------------
-- execution-pendante-unique
-- Deux exécutions en attente (scheduled, sending, waiting_event,
-- quota_blocked) de la même étape pour la même inscription sont refusées par
-- uq_step_exec_pending_per_enrollment_step ; une replanification après un
-- envoi reste possible.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  seq_a uuid := 'd6a20000-0000-4000-8000-000000000001';
  step_a1 uuid := 'd6a30000-0000-4000-8000-000000000001';
  v_enr uuid;
  v_cancel uuid;
  v_cons text;
  pairs text[][] := ARRAY[['scheduled', 'scheduled'], ['waiting_event', 'scheduled'],
                          ['sending', 'scheduled'], ['quota_blocked', 'waiting_event']];
  i int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (seq_a, 'seqdb-mail-u@audit.test', 'seqdb-prof-u', org_a, u_a, 'active')
  RETURNING id INTO v_enr;

  FOR i IN 1 .. array_length(pairs, 1) LOOP
    c := c + 1;
    DELETE FROM public.sequence_step_executions WHERE enrollment_id = v_enr;
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status)
    VALUES (v_enr, step_a1, 1, now() + interval '1 day', pairs[i][1]);
    BEGIN
      INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status)
      VALUES (v_enr, step_a1, 1, now() + interval '2 days', pairs[i][2]);
      f := f || format('[%s puis %s : deux exécutions en attente acceptées] ', pairs[i][1], pairs[i][2]);
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      IF v_cons IS DISTINCT FROM 'uq_step_exec_pending_per_enrollment_step' THEN
        f := f || format('[%s puis %s : refus par %s] ', pairs[i][1], pairs[i][2], v_cons);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s puis %s : %s] ', pairs[i][1], pairs[i][2], SQLERRM);
    END;
  END LOOP;

  -- Après un envoi, une nouvelle planification de la même étape passe.
  c := c + 1;
  DELETE FROM public.sequence_step_executions WHERE enrollment_id = v_enr;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
    VALUES (v_enr, step_a1, 1, now() - interval '1 day', 'sent', now() - interval '1 day');
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status)
    VALUES (v_enr, step_a1, 1, now() + interval '1 day', 'scheduled');
  EXCEPTION WHEN OTHERS THEN f := f || format('[envoyée puis programmée refusée : %s] ', SQLERRM);
  END;

  -- Réarmer une exécution annulée alors qu'une autre est en attente : refus.
  c := c + 1;
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, skip_reason)
  VALUES (v_enr, step_a1, 1, now() + interval '1 day', 'cancelled', 'Arrêt manuel')
  RETURNING id INTO v_cancel;
  BEGIN
    UPDATE public.sequence_step_executions SET status = 'scheduled' WHERE id = v_cancel;
    f := f || '[annulée repassée programmée à côté d''une exécution en attente] ';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons IS DISTINCT FROM 'uq_step_exec_pending_per_enrollment_step' THEN
      f := f || format('[réarmement : refus par %s] ', v_cons);
    END IF;
  WHEN OTHERS THEN f := f || format('[réarmement : %s] ', SQLERRM);
  END;

  DELETE FROM public.sequence_enrollments WHERE id = v_enr;
  INSERT INTO seq_db_results VALUES ('execution-pendante-unique', c, f);
END $$;

-- ---------------------------------------------------------------------
-- anti-doublon-identifiants-et-fenetres (SEQ-046, SEQ-128, D3)
-- find_recent_org_contacts rapproche par profile_id, provider_id,
-- resolved_profile_id et slug exact ; garde active et paused sans limite de
-- date, replied et completed depuis p_since (90 jours si NULL), jamais
-- cancelled, stopped ni bounced ; refuse p_org NULL ; 8 colonnes.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  seq_a uuid := 'd6a20000-0000-4000-8000-000000000001';
  window_ids text[] := ARRAY['seqdb-dd-act200', 'seqdb-dd-pau200', 'seqdb-dd-rep10', 'seqdb-dd-rep120',
                             'seqdb-dd-comp10', 'seqdb-dd-canc', 'seqdb-dd-stop', 'seqdb-dd-bounce'];
  v_got text[];
  v_hint text;
  v_state text;
  v_result text;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.sequence_enrollments
    (sequence_id, account_id, profile_id, provider_id, resolved_profile_id, profile_url,
     organization_id, created_by, status, pause_reason, created_at)
  VALUES
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-act200', NULL, NULL, NULL, org_a, u_a, 'active', NULL, now() - interval '200 days'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-pau200', NULL, NULL, NULL, org_a, u_a, 'paused', 'manual', now() - interval '200 days'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-rep10', NULL, NULL, NULL, org_a, u_a, 'replied', NULL, now() - interval '10 days'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-rep120', NULL, NULL, NULL, org_a, u_a, 'replied', NULL, now() - interval '120 days'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-comp10', NULL, NULL, NULL, org_a, u_a, 'completed', NULL, now() - interval '10 days'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-canc', NULL, NULL, NULL, org_a, u_a, 'cancelled', NULL, now() - interval '1 day'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-stop', NULL, NULL, NULL, org_a, u_a, 'stopped', NULL, now() - interval '1 day'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-bounce', NULL, NULL, NULL, org_a, u_a, 'bounced', NULL, now() - interval '1 day'),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-prov', 'seqdb-ACoPROV1', NULL, NULL, org_a, u_a, 'active', NULL, now()),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-res', NULL, 'seqdb-ACoRES1', NULL, org_a, u_a, 'active', NULL, now()),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-url1', NULL, NULL,
     'https://www.linkedin.com/in/SeqDB-Jean-Dupont?trk=public_profile', org_a, u_a, 'active', NULL, now()),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-url2', NULL, NULL,
     'https://linkedin.com/in/seqdb-marie-curie#experience', org_a, u_a, 'active', NULL, now()),
    (seq_a, 'seqdb-mail-dd@audit.test', 'seqdb-dd-url3', NULL, NULL,
     'https://www.linkedin.com/in/ab/', org_a, u_a, 'active', NULL, now());

  PERFORM pg_temp.seqdb_as(u_a);
  SET LOCAL ROLE authenticated;

  c := c + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.find_recent_org_contacts(org_a, ARRAY['seqdb-ACoPROV1'], ARRAY[]::text[], now() - interval '90 days')
    WHERE profile_id = 'seqdb-dd-prov' AND provider_id = 'seqdb-ACoPROV1';
    IF n <> 1 THEN f := f || format('[provider_id : %s ligne(s) au lieu de 1] ', n); END IF;
    SELECT count(*) INTO n FROM public.find_recent_org_contacts(org_a, ARRAY['seqdb-ACoRES1'], ARRAY[]::text[], now() - interval '90 days')
    WHERE profile_id = 'seqdb-dd-res' AND resolved_profile_id = 'seqdb-ACoRES1';
    IF n <> 1 THEN f := f || format('[resolved_profile_id : %s ligne(s) au lieu de 1] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[identifiants : %s] ', SQLERRM);
  END;

  c := c + 1;
  BEGIN
    SELECT array_agg(profile_id ORDER BY profile_id) INTO v_got
    FROM public.find_recent_org_contacts(org_a, window_ids, ARRAY[]::text[], now() - interval '90 days');
    IF v_got IS DISTINCT FROM ARRAY['seqdb-dd-act200', 'seqdb-dd-comp10', 'seqdb-dd-pau200', 'seqdb-dd-rep10'] THEN
      f := f || format('[fenêtre 90 jours : %s au lieu de act200, comp10, pau200, rep10] ', v_got);
    END IF;
    SELECT array_agg(profile_id ORDER BY profile_id) INTO v_got
    FROM public.find_recent_org_contacts(org_a, window_ids, ARRAY[]::text[], NULL);
    IF v_got IS DISTINCT FROM ARRAY['seqdb-dd-act200', 'seqdb-dd-comp10', 'seqdb-dd-pau200', 'seqdb-dd-rep10'] THEN
      f := f || format('[p_since NULL : %s au lieu de la fenêtre de 90 jours] ', v_got);
    END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[fenêtres : %s] ', SQLERRM);
  END;

  c := c + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.find_recent_org_contacts(org_a, ARRAY[]::text[], ARRAY['seqdb-jean-dupont'], NULL)
    WHERE profile_id = 'seqdb-dd-url1';
    IF n <> 1 THEN f := f || format('[slug d''une URL en majuscules avec ?trk= : %s ligne(s)] ', n); END IF;
    SELECT count(*) INTO n FROM public.find_recent_org_contacts(org_a, ARRAY[]::text[], ARRAY['SEQDB-MARIE-CURIE'], NULL)
    WHERE profile_id = 'seqdb-dd-url2';
    IF n <> 1 THEN f := f || format('[slug en majuscules, URL avec # : %s ligne(s)] ', n); END IF;
    SELECT count(*) INTO n FROM public.find_recent_org_contacts(org_a, ARRAY[]::text[], ARRAY['ab'], NULL);
    IF n <> 0 THEN f := f || format('[slug de 2 caractères : %s ligne(s) au lieu de 0] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[slugs : %s] ', SQLERRM);
  END;

  c := c + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.find_recent_org_contacts(NULL, ARRAY['seqdb-dd-act200'], ARRAY[]::text[], NULL);
    f := f || format('[p_org NULL accepté (%s ligne(s))] ', n);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_state = RETURNED_SQLSTATE;
    IF v_state IS DISTINCT FROM '42501' OR v_hint IS DISTINCT FROM 'NOT_ORG_MEMBER' THEN
      f := f || format('[p_org NULL : %s %s au lieu de 42501 NOT_ORG_MEMBER] ', v_state, v_hint);
    END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);

  c := c + 1;
  SELECT pg_get_function_result('public.find_recent_org_contacts(uuid, text[], text[], timestamptz)'::regprocedure) INTO v_result;
  IF v_result IS DISTINCT FROM 'TABLE(profile_id text, provider_id text, resolved_profile_id text, profile_url text, created_by uuid, created_at timestamp with time zone, status text, sequence_id uuid)' THEN
    f := f || format('[colonnes renvoyées : %s] ', v_result);
  END IF;

  DELETE FROM public.sequence_enrollments WHERE profile_id LIKE 'seqdb-dd-%';
  INSERT INTO seq_db_results VALUES ('anti-doublon-identifiants-et-fenetres', c, f);
END $$;

-- ---------------------------------------------------------------------
-- quota-linkedin-plafonds-par-type
-- check_linkedin_action_quota : plafond hebdomadaire d'invitations, plafonds
-- journaliers de vues, recherches et InMails, sur la seule fenêtre et le seul
-- compte demandés ; plafonds NULL = autorisé ; pause fournisseur échue =
-- autorisé ; un refus n'écrit rien au journal.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_m uuid := 'd6000000-0000-4000-8000-00000000000c';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  d timestamptz := now() - interval '1 day';
  w timestamptz := now() - interval '7 days';
  r jsonb;
  rs text := '';
  i int;
  n int;
  n_before int;
  v_type text;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);

  -- Invitations : plafond hebdomadaire 2, la troisième est refusée.
  c := c + 1;
  FOR i IN 1 .. 3 LOOP
    r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-inv', p_action_type => 'connection_request',
           p_day_since => d, p_week_since => w, p_weekly_invite_cap => 2, p_log => true);
    rs := rs || (r->>'allowed') || COALESCE(':' || (r->>'scope'), '') || ' ';
  END LOOP;
  IF rs <> 'true true false:weekly_invite ' THEN f := f || format('[invitations plafond 2 : %s] ', rs); END IF;
  SELECT count(*) INTO n FROM public.linkedin_action_log WHERE account_id = 'seqdb-q-inv';
  IF n <> 2 THEN f := f || format('[invitations : %s ligne(s) au journal au lieu de 2] ', n); END IF;

  -- Vues, recherches, InMails : plafond journalier 1, la deuxième est refusée.
  FOR v_type IN SELECT unnest(ARRAY['profile_view', 'search', 'inmail']) LOOP
    c := c + 1;
    rs := '';
    FOR i IN 1 .. 2 LOOP
      r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-' || v_type, p_action_type => v_type,
             p_day_since => d, p_week_since => w, p_profile_view_cap => 1, p_search_cap => 1,
             p_inmail_daily_cap => 1, p_log => true);
      rs := rs || (r->>'allowed') || COALESCE(':' || (r->>'scope'), '') || ' ';
    END LOOP;
    IF rs <> format('true false:%s ', CASE v_type WHEN 'inmail' THEN 'inmail_daily' ELSE v_type END) THEN
      f := f || format('[%s plafond 1 : %s] ', v_type, rs);
    END IF;
    -- Un refus n'ajoute aucune ligne au journal.
    SELECT count(*) INTO n FROM public.linkedin_action_log WHERE account_id = 'seqdb-q-' || v_type;
    IF n <> 1 THEN f := f || format('[%s : %s ligne(s) au journal après un refus au lieu de 1] ', v_type, n); END IF;
  END LOOP;

  -- Plafonds NULL : tout est autorisé.
  c := c + 1;
  rs := '';
  FOR v_type IN SELECT unnest(ARRAY['connection_request', 'profile_view', 'search', 'inmail', 'message',
                                    'connection_request', 'profile_view', 'search', 'inmail', 'message']) LOOP
    r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-null', p_action_type => v_type,
           p_day_since => d, p_week_since => w, p_log => true);
    IF (r->>'allowed') IS DISTINCT FROM 'true' THEN rs := rs || v_type || '=' || r::text || ' '; END IF;
  END LOOP;
  IF rs <> '' THEN f := f || format('[plafonds NULL refusés : %s] ', rs); END IF;

  -- Pause fournisseur échue : autorisé ; en cours : refusé (provider_pause).
  c := c + 1;
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by, quota_paused_until)
  VALUES (org_a, u_m, 'seqdb-q-paused', u_m, now() - interval '1 hour');
  r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-paused', p_action_type => 'message',
         p_day_since => d, p_week_since => w, p_daily_visible_cap => 10, p_log => false);
  IF (r->>'allowed') IS DISTINCT FROM 'true' THEN f := f || format('[pause fournisseur échue : %s] ', r); END IF;
  UPDATE public.member_linkedin_accounts SET quota_paused_until = now() + interval '1 hour'
  WHERE linkedin_account_id = 'seqdb-q-paused';
  r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-paused', p_action_type => 'message',
         p_day_since => d, p_week_since => w, p_daily_visible_cap => 10, p_log => true);
  IF (r->>'allowed') IS DISTINCT FROM 'false' OR (r->>'scope') IS DISTINCT FROM 'provider_pause' THEN
    f := f || format('[pause fournisseur en cours : %s] ', r);
  END IF;
  SELECT count(*) INTO n FROM public.linkedin_action_log WHERE account_id = 'seqdb-q-paused';
  IF n <> 0 THEN f := f || format('[pause fournisseur : %s ligne(s) au journal] ', n); END IF;

  -- Fenêtre et compte : les actions d'avant p_day_since / p_week_since et
  -- celles d'un autre compte ne comptent pas.
  c := c + 1;
  INSERT INTO public.linkedin_action_log (account_id, action_type, source, created_at)
  SELECT 'seqdb-q-window', 'profile_view', 'seqdb', now() - interval '2 days' FROM generate_series(1, 3)
  UNION ALL
  SELECT 'seqdb-q-window', 'connection_request', 'seqdb', now() - interval '8 days' FROM generate_series(1, 3)
  UNION ALL
  SELECT 'seqdb-q-other', 'profile_view', 'seqdb', now() FROM generate_series(1, 3)
  UNION ALL
  SELECT 'seqdb-q-other', 'connection_request', 'seqdb', now() FROM generate_series(1, 3);
  SELECT count(*) INTO n_before FROM public.linkedin_action_log WHERE account_id = 'seqdb-q-window';
  r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-window', p_action_type => 'profile_view',
         p_day_since => d, p_week_since => w, p_profile_view_cap => 1, p_log => false);
  IF (r->>'allowed') IS DISTINCT FROM 'true' THEN f := f || format('[vues hors fenêtre ou d''un autre compte comptées : %s] ', r); END IF;
  r := public.check_linkedin_action_quota(p_account_id => 'seqdb-q-window', p_action_type => 'connection_request',
         p_day_since => d, p_week_since => w, p_weekly_invite_cap => 1, p_log => false);
  IF (r->>'allowed') IS DISTINCT FROM 'true' THEN f := f || format('[invitations hors semaine ou d''un autre compte comptées : %s] ', r); END IF;
  SELECT count(*) INTO n FROM public.linkedin_action_log WHERE account_id = 'seqdb-q-window';
  IF n <> n_before THEN f := f || '[p_log false : une ligne écrite au journal] '; END IF;

  DELETE FROM public.linkedin_action_log WHERE account_id LIKE 'seqdb-q-%';
  DELETE FROM public.member_linkedin_accounts WHERE linkedin_account_id = 'seqdb-q-paused';
  INSERT INTO seq_db_results VALUES ('quota-linkedin-plafonds-par-type', c, f);
END $$;

-- ---------------------------------------------------------------------
-- garde-compte-contournements (SEQ-043, SEQ-010)
-- « Chacun inscrit depuis son propre compte relié » : le changement du
-- compte d'une inscription existante et une insertion serveur sans auteur
-- doivent aussi être refusés (HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  u_m uuid := 'd6000000-0000-4000-8000-00000000000c';
  u_c uuid := 'd6000000-0000-4000-8000-00000000000d';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  seq_a uuid := 'd6a20000-0000-4000-8000-000000000001';
  v_enr_m uuid;
  v_enr_c uuid;
  v_uid uuid;
  v_enr uuid;
  v_who text;
  v_hint text;
  v_acc text;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqdb_as(NULL);
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (seq_a, 'seqdb-mail-m@audit.test', 'seqdb-prof-gm', org_a, u_m, 'active') RETURNING id INTO v_enr_m;
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (seq_a, 'seqdb-mail-c@audit.test', 'seqdb-prof-gc', org_a, u_c, 'active') RETURNING id INTO v_enr_c;

  -- (a) membre puis collaborateur : leur propre inscription passée sur le
  -- compte relié du propriétaire.
  FOR v_who, v_uid, v_enr IN SELECT * FROM (VALUES ('membre', u_m, v_enr_m), ('collaborateur', u_c, v_enr_c)) AS t(a, b, e) LOOP
    c := c + 1;
    PERFORM pg_temp.seqdb_as(v_uid);
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.sequence_enrollments SET account_id = 'seqdb-acc-owner' WHERE id = v_enr;
      -- DÉFAUT seq-db-garde-compte-update : le déclencheur ne contrôle que l'INSERT.
      f := f || format('[DÉFAUT seq-db-garde-compte-update : %s, inscription passée sur le compte relié d''un collègue] ', v_who);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
        f := f || format('[%s : refus sans le HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER (%s)] ', v_who, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s changement de compte : %s (%s)] ', v_who, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
    PERFORM pg_temp.seqdb_as(NULL);
    SELECT account_id INTO v_acc FROM public.sequence_enrollments WHERE id = v_enr;
    IF v_acc = 'seqdb-acc-owner' THEN
      f := f || format('[DÉFAUT seq-db-garde-compte-update : relecture, l''inscription du %s part du compte du propriétaire] ', v_who);
    END IF;
  END LOOP;

  -- (b) chemin serveur sans auteur, depuis le compte relié d'un membre.
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'seqdb-acc-owner', 'seqdb-prof-gnull', org_a, NULL, 'active');
    -- DÉFAUT seq-db-garde-compte-auteur-absent : « m.user_id <> NULL » n'est jamais vrai.
    f := f || '[DÉFAUT seq-db-garde-compte-auteur-absent : inscription serveur sans auteur depuis le compte relié d''un membre acceptée] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
      f := f || format('[auteur absent : refus sans le HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER (%s)] ', v_hint);
    END IF;
  WHEN OTHERS THEN f := f || format('[auteur absent : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  DELETE FROM public.sequence_enrollments WHERE profile_id IN ('seqdb-prof-gm', 'seqdb-prof-gc', 'seqdb-prof-gnull');
  INSERT INTO seq_db_results VALUES ('garde-compte-contournements', c, f);
END $$;

-- =====================================================================
-- Reprise des données héritées par B6, rejouée sur un état « prod d'avant
-- B6 » simulé dans la transaction :
--   b6-d6-reclassement-pauses-heritees     (pauses sans raison, D6)
--   b6-seq003-envois-annules-repasses-envoyes (1a)
--   b6-seq013-compte-rotation-fige         (1c, colonne repassée en uuid)
--   b6-reparations-organisation-stats-modeles (1d à 1f, déclencheurs coupés)
--   b6-statuts-herites-rien-ne-redemarre   (2c, 2d, contraintes retirées)
-- =====================================================================
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.seqdb_as(NULL); END $$;

-- État d'avant B6 : pas de CHECK de statut, défaut 'pending' des exécutions
-- (prod), assigned_sender_id en uuid (BUG-023). Les valeurs texte actuelles
-- d'autres tests sont effacées dans la transaction seulement.
ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;
ALTER TABLE public.sequence_step_executions DROP CONSTRAINT IF EXISTS sequence_step_executions_status_check;
ALTER TABLE public.sequence_step_executions ALTER COLUMN status SET DEFAULT 'pending';
UPDATE public.sequence_enrollments SET assigned_sender_id = NULL
WHERE assigned_sender_id IS NOT NULL
  AND assigned_sender_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
ALTER TABLE public.sequence_enrollments ALTER COLUMN assigned_sender_id TYPE uuid USING assigned_sender_id::uuid;

-- Jeu de données hérité. session_replication_role = replica coupe les
-- déclencheurs de B6 (organisation recopiée, garde du compte) le temps de
-- semer des lignes que la base refuse aujourd'hui.
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  u_b uuid := 'd6000000-0000-4000-8000-00000000000b';
  org_a uuid := 'd6a00000-0000-4000-8000-000000000001';
  org_b uuid := 'd6b00000-0000-4000-8000-000000000001';
  -- D6
  seq_d6 uuid := 'd6a20000-0000-4000-8000-0000000000d6';
  d1 uuid := 'd6a30000-0000-4000-8000-0000000000d1';
  d2 uuid := 'd6a30000-0000-4000-8000-0000000000d2';
  stops text[] := ARRAY['Arrêt manuel', 'Arrêt groupé', 'Stoppé depuis Inbox', 'Compte LinkedIn dissocié',
                        'Candidat a bloqué le compte LinkedIn — séquence stoppée'];
  i int;
  v_enr uuid;
  -- SEQ-003
  seq_x uuid := 'd6a20000-0000-4000-8000-0000000000e3';
  x1 uuid := 'd6a30000-0000-4000-8000-0000000000e1';
  x2 uuid := 'd6a30000-0000-4000-8000-0000000000e2';
  enr_x uuid := 'd6a40000-0000-4000-8000-0000000000e3';
  -- SEQ-013
  seq_rr uuid := 'd6a20000-0000-4000-8000-000000000131';
  seq_rand uuid := 'd6a20000-0000-4000-8000-000000000132';
  seq_lu uuid := 'd6a20000-0000-4000-8000-000000000133';
  rr1 uuid := 'd6a30000-0000-4000-8000-000000000131';
  rand1 uuid := 'd6a30000-0000-4000-8000-000000000132';
  lu1 uuid := 'd6a30000-0000-4000-8000-000000000133';
  senders jsonb := '[{"account_id": "seqdb-acc1"}, {"account_id": "seqdb-acc2"}]'::jsonb;
  -- 1d-1f (organisation B, pour ne pas toucher aux compteurs de A)
  seq_o uuid := 'd6b20000-0000-4000-8000-0000000000f1';
  seq_o2 uuid := 'd6b20000-0000-4000-8000-0000000000f2';
  o1 uuid := 'd6b30000-0000-4000-8000-0000000000f1';
  o_orga uuid := 'd6b30000-0000-4000-8000-0000000000f9';
  o21 uuid := 'd6b30000-0000-4000-8000-0000000000f2';
  enr_o uuid := 'd6b40000-0000-4000-8000-0000000000f1';
  enr_onull uuid := 'd6b40000-0000-4000-8000-0000000000f2';
  -- 2c
  seq_s uuid := 'd6a20000-0000-4000-8000-0000000002c1';
  s1 uuid := 'd6a30000-0000-4000-8000-0000000002c1';
  s2 uuid := 'd6a30000-0000-4000-8000-0000000002c2';
  v_prof_a uuid;
  v_prof_b uuid;
BEGIN
  SELECT id INTO v_prof_a FROM public.profiles WHERE user_id = u_a;
  SELECT id INTO v_prof_b FROM public.profiles WHERE user_id = u_b;

  -- D6 : séquence désactivée ; E1 auto-pause seule ; E2 à E6 auto-pause et un
  -- arrêt par un recruteur ; E7 sans marqueur ; E8 pause déjà qualifiée ; E9
  -- active sans raison.
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_d6, 'SeqDB D6', org_a, u_a, false);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (d1, seq_d6, org_a, 1, 'message', 'Bonjour'), (d2, seq_d6, org_a, 2, 'message', 'Relance');
  FOR i IN 1 .. 9 LOOP
    INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, pause_reason)
    VALUES (('d6a40000-0000-4000-8000-0000000d600' || i)::uuid, seq_d6, 'seqdb-mail-d6@audit.test', 'seqdb-d6-e' || i, org_a, u_a,
            CASE WHEN i = 9 THEN 'active' ELSE 'paused' END,
            CASE WHEN i = 8 THEN 'account_disconnected' ELSE NULL END);
  END LOOP;
  FOR i IN 1 .. 8 LOOP
    IF i = 7 THEN CONTINUE; END IF;
    INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, scheduled_at, status, skip_reason)
    VALUES (('d6a40000-0000-4000-8000-0000000d600' || i)::uuid, org_a, d1, 1, now() - interval '3 days', 'cancelled',
            'Auto-paused: high failure rate');
  END LOOP;
  FOR i IN 2 .. 6 LOOP
    INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, scheduled_at, status, skip_reason)
    VALUES (('d6a40000-0000-4000-8000-0000000d600' || i)::uuid, org_a, d2, 2, now() - interval '2 days', 'cancelled', stops[i - 1]);
  END LOOP;

  -- SEQ-003 : un message parti marqué annulé, un autre annulé avant l'envoi.
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_x, 'SeqDB SEQ-003', org_a, u_a, true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (x1, seq_x, org_a, 1, 'message', 'Bonjour'), (x2, seq_x, org_a, 2, 'message', 'Relance');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, pause_reason)
  VALUES (enr_x, seq_x, 'seqdb-mail-x@audit.test', 'seqdb-prof-x', org_a, u_a, 'paused', 'manual');
  INSERT INTO public.sequence_step_executions
    (id, enrollment_id, organization_id, step_id, step_order, scheduled_at, status, skip_reason, executed_at, updated_at)
  VALUES ('d6a50000-0000-4000-8000-0000000000e1', enr_x, org_a, x2, 2, '2026-06-01 09:00:00+00', 'cancelled',
          'Enrollment became paused during execution', NULL, '2026-06-01 10:00:00+00'),
         ('d6a50000-0000-4000-8000-0000000000e2', enr_x, org_a, x1, 1, '2026-06-01 09:00:00+00', 'cancelled',
          'Enrollment became paused before send (last-call check)', NULL, '2026-06-01 10:00:00+00');

  -- SEQ-013 : rotation round_robin, random, least_used ; assigned_sender_id =
  -- un user_id hérité de BUG-023.
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active, multi_sender_enabled, rotation_mode, sender_accounts)
  VALUES (seq_rr, 'SeqDB tourniquet', org_a, u_a, true, true, 'round_robin', senders),
         (seq_rand, 'SeqDB aléatoire', org_a, u_a, true, true, 'random', senders),
         (seq_lu, 'SeqDB moins utilisé', org_a, u_a, true, true, 'least_used', senders);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (rr1, seq_rr, org_a, 1, 'message', 'Bonjour'), (rand1, seq_rand, org_a, 1, 'message', 'Bonjour'),
         (lu1, seq_lu, org_a, 1, 'message', 'Bonjour');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, pause_reason, assigned_sender_id)
  VALUES ('d6a40000-0000-4000-8000-000000013001', seq_rr, 'seqdb-acc2', 'seqdb-13-e1', org_a, u_a, 'active', NULL, u_a),
         ('d6a40000-0000-4000-8000-000000013002', seq_rr, 'seqdb-acc2', 'seqdb-13-e2', org_a, u_a, 'active', NULL, u_a),
         ('d6a40000-0000-4000-8000-000000013003', seq_rand, 'seqdb-acc2', 'seqdb-13-e3', org_a, u_a, 'active', NULL, u_a),
         ('d6a40000-0000-4000-8000-000000013004', seq_rr, 'seqdb-acc2', 'seqdb-13-e4', org_a, u_a, 'completed', NULL, u_a),
         ('d6a40000-0000-4000-8000-000000013005', seq_rr, 'seqdb-acc2', 'seqdb-13-e5', org_a, u_a, 'paused', 'manual', u_a),
         ('d6a40000-0000-4000-8000-000000013006', seq_lu, 'seqdb-acc2', 'seqdb-13-e6', org_a, u_a, 'active', NULL, u_a);
  INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES ('d6a40000-0000-4000-8000-000000013001', org_a, rr1, 1, now() - interval '5 days', 'sent', now() - interval '5 days'),
         ('d6a40000-0000-4000-8000-000000013003', org_a, rand1, 1, now() - interval '5 days', 'sent', now() - interval '5 days'),
         ('d6a40000-0000-4000-8000-000000013004', org_a, rr1, 1, now() - interval '5 days', 'sent', now() - interval '5 days'),
         ('d6a40000-0000-4000-8000-000000013005', org_a, rr1, 1, now() - interval '5 days', 'opened', now() - interval '5 days'),
         ('d6a40000-0000-4000-8000-000000013006', org_a, lu1, 1, now() - interval '5 days', 'replied', now() - interval '5 days');

  -- 1d : étape d'organisation A dans une séquence de B ; inscription sans
  -- organisation ; exécution d'une autre organisation que son inscription ;
  -- exécutions programmée et envoyée dont l'étape est d'une autre séquence.
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_o, 'SeqDB réparations', org_b, u_b, true), (seq_o2, 'SeqDB autre séquence', org_b, u_b, true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (o1, seq_o, org_b, 1, 'message', 'Bonjour'),
         (o_orga, seq_o, org_a, 2, 'message', 'Étape d''une autre organisation'),
         (o21, seq_o2, org_b, 1, 'message', 'Étape de l''autre séquence');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (enr_o, seq_o, 'seqdb-mail-o@audit.test', 'seqdb-prof-o', org_b, u_b, 'active'),
         (enr_onull, seq_o, 'seqdb-mail-o@audit.test', 'seqdb-prof-onull', NULL, u_b, 'active');
  INSERT INTO public.sequence_step_executions (id, enrollment_id, organization_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES ('d6b50000-0000-4000-8000-0000000000f1', enr_o, org_a, o1, 1, now() - interval '4 days', 'sent', now() - interval '4 days'),
         ('d6b50000-0000-4000-8000-0000000000f2', enr_o, org_b, o21, 1, now() + interval '1 day', 'scheduled', NULL),
         ('d6b50000-0000-4000-8000-0000000000f3', enr_o, org_b, o21, 1, now() - interval '3 days', 'sent', now() - interval '3 days');

  -- 1e : statistique sans organisation.
  INSERT INTO public.sequence_analytics (sequence_id, date, organization_id, messages_sent)
  VALUES (seq_o, DATE '2026-06-01', NULL, 2);

  -- 1f : modèle d'origine (le plus ancien de son nom), doublon récent du même
  -- nom publié par une organisation, modèle « système » au nom libre, modèle
  -- ordinaire.
  INSERT INTO public.sequence_templates (id, organization_id, name, steps_config, is_system, created_by, created_at)
  VALUES ('d6a60000-0000-4000-8000-000000000001', org_a, 'Sourcing LinkedIn — 3 étapes', '[]'::jsonb, true, v_prof_a, '2000-01-01 00:00:00+00'),
         ('d6b60000-0000-4000-8000-000000000002', org_b, 'Sourcing LinkedIn — 3 étapes', '[]'::jsonb, true, v_prof_b, now()),
         ('d6b60000-0000-4000-8000-000000000003', org_b, 'SeqDB modèle maison', '[]'::jsonb, true, v_prof_b, now()),
         ('d6b60000-0000-4000-8000-000000000004', org_b, 'SeqDB modèle ordinaire', '[]'::jsonb, false, v_prof_b, now());

  -- 2c : inscription 'booked' (ancien calendly-webhook), exécution 'pending'
  -- explicite et exécution semée sans statut (défaut 'pending' de la prod).
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_s, 'SeqDB statuts hérités', org_a, u_a, true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (s1, seq_s, org_a, 1, 'message', 'Bonjour'), (s2, seq_s, org_a, 2, 'message', 'Relance');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status,
                                           completed_at, updated_at, tracking_data)
  VALUES ('d6a40000-0000-4000-8000-0000000002c1', seq_s, 'seqdb-mail-s@audit.test', 'seqdb-2c-booked', org_a, u_a, 'booked',
          NULL, '2026-05-01 09:00:00+00', '{"source": "calendly"}'::jsonb),
         ('d6a40000-0000-4000-8000-0000000002c2', seq_s, 'seqdb-mail-s@audit.test', 'seqdb-2c-paused', org_a, u_a, 'paused',
          NULL, now(), '{}'::jsonb);
  UPDATE public.sequence_enrollments SET pause_reason = 'manual' WHERE id = 'd6a40000-0000-4000-8000-0000000002c2';
  INSERT INTO public.sequence_step_executions (id, enrollment_id, organization_id, step_id, step_order, scheduled_at, status)
  VALUES ('d6a50000-0000-4000-8000-0000000002c1', 'd6a40000-0000-4000-8000-0000000002c1', org_a, s1, 1, now() - interval '1 day', 'pending');
  INSERT INTO public.sequence_step_executions (id, enrollment_id, organization_id, step_id, step_order, scheduled_at)
  VALUES ('d6a50000-0000-4000-8000-0000000002c2', 'd6a40000-0000-4000-8000-0000000002c2', org_a, s2, 2, now() - interval '1 day');
END $$;
SET LOCAL session_replication_role = origin;

-- Photographie avant le rejeu : statuts de toutes les lignes du jeu (A et B).
CREATE TEMP TABLE seq_db_before ON COMMIT DROP AS
SELECT 'enr' AS kind, id, status, pause_reason FROM public.sequence_enrollments
WHERE organization_id IN ('d6a00000-0000-4000-8000-000000000001', 'd6b00000-0000-4000-8000-000000000001')
   OR sequence_id IN (SELECT id FROM public.outreach_sequences
                      WHERE organization_id IN ('d6a00000-0000-4000-8000-000000000001', 'd6b00000-0000-4000-8000-000000000001'))
UNION ALL
SELECT 'exec', x.id, x.status, NULL FROM public.sequence_step_executions x
JOIN public.sequence_enrollments e ON e.id = x.enrollment_id
WHERE e.sequence_id IN (SELECT id FROM public.outreach_sequences
                        WHERE organization_id IN ('d6a00000-0000-4000-8000-000000000001', 'd6b00000-0000-4000-8000-000000000001'));
CREATE TEMP TABLE seq_db_counts_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.sequence_steps WHERE sequence_id IN ('d6b20000-0000-4000-8000-0000000000f1', 'd6b20000-0000-4000-8000-0000000000f2')) AS n_steps,
  (SELECT count(*) FROM public.sequence_enrollments WHERE sequence_id = 'd6b20000-0000-4000-8000-0000000000f1') AS n_enr,
  (SELECT count(*) FROM public.sequence_step_executions WHERE enrollment_id IN ('d6b40000-0000-4000-8000-0000000000f1', 'd6b40000-0000-4000-8000-0000000000f2')) AS n_exec,
  (SELECT count(*) FROM public.sequence_analytics WHERE sequence_id = 'd6b20000-0000-4000-8000-0000000000f1') AS n_stats,
  (SELECT count(*) FROM public.sequence_templates WHERE id::text LIKE 'd6_60000-%') AS n_tpl,
  (SELECT count(*) FROM public.sequence_enrollments WHERE organization_id = 'd6a00000-0000-4000-8000-000000000001' AND status = 'active') AS n_active_a,
  (SELECT count(*) FROM public.sequence_step_executions WHERE organization_id = 'd6a00000-0000-4000-8000-000000000001' AND status = 'scheduled') AS n_sched_a;

-- Rejeu de B6, chemin serveur, comme le workflow de déploiement.
SET LOCAL client_min_messages = warning;
\ir ../migrations/20260925163421_sequences_audit_lot_b6.sql
SET LOCAL client_min_messages = notice;
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.seqdb_as(NULL); END $$;

-- ---------------------------------------------------------------------
-- @critical b6-d6-reclassement-pauses-heritees (SEQ-121, SEQ-002, D6)
-- Pause sans raison : auto_paused avec le seul marqueur d'auto-pause, manual
-- s'il y a aussi un arrêt par un recruteur ou aucun marqueur ; jamais
-- sequence_inactive, même dans une séquence désactivée ; aucun statut touché.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_reason text;
  v_status text;
  i int;
  n int;
  f text := '';
  c int := 0;
BEGIN
  c := c + 1;
  SELECT status, pause_reason INTO v_status, v_reason FROM public.sequence_enrollments WHERE profile_id = 'seqdb-d6-e1';
  IF v_reason IS DISTINCT FROM 'auto_paused' THEN
    f := f || format('[E1 (auto-pause seule) : %s au lieu de auto_paused] ', v_reason);
  END IF;

  c := c + 1;
  FOR i IN 2 .. 7 LOOP
    SELECT pause_reason INTO v_reason FROM public.sequence_enrollments WHERE profile_id = 'seqdb-d6-e' || i;
    IF v_reason IS DISTINCT FROM 'manual' THEN
      f := f || format('[E%s : %s au lieu de manual] ', i, v_reason);
    END IF;
  END LOOP;

  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_enrollments
  WHERE profile_id LIKE 'seqdb-d6-e%' AND pause_reason = 'sequence_inactive';
  IF n <> 0 THEN f := f || format('[%s pause(s) héritée(s) devenue(s) sequence_inactive] ', n); END IF;

  c := c + 1;
  SELECT status, pause_reason INTO v_status, v_reason FROM public.sequence_enrollments WHERE profile_id = 'seqdb-d6-e8';
  IF v_status IS DISTINCT FROM 'paused' OR v_reason IS DISTINCT FROM 'account_disconnected' THEN
    f := f || format('[E8 (déjà qualifiée) : %s / %s] ', v_status, v_reason);
  END IF;
  SELECT status, pause_reason INTO v_status, v_reason FROM public.sequence_enrollments WHERE profile_id = 'seqdb-d6-e9';
  IF v_status IS DISTINCT FROM 'active' OR v_reason IS NOT NULL THEN
    f := f || format('[E9 (active) : %s / %s] ', v_status, v_reason);
  END IF;

  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_enrollments e
  JOIN seq_db_before b ON b.kind = 'enr' AND b.id = e.id
  WHERE e.profile_id LIKE 'seqdb-d6-e%' AND e.status IS DISTINCT FROM b.status;
  IF n <> 0 THEN f := f || format('[%s statut(s) d''inscription modifié(s) par le reclassement] ', n); END IF;
  SELECT count(*) INTO n FROM public.sequence_step_executions x
  JOIN seq_db_before b ON b.kind = 'exec' AND b.id = x.id
  JOIN public.sequence_enrollments e ON e.id = x.enrollment_id
  WHERE e.profile_id LIKE 'seqdb-d6-e%' AND x.status IS DISTINCT FROM b.status;
  IF n <> 0 THEN f := f || format('[%s exécution(s) modifiée(s) par le reclassement] ', n); END IF;

  INSERT INTO seq_db_results VALUES ('b6-d6-reclassement-pauses-heritees', c, f);
END $$;

-- ---------------------------------------------------------------------
-- b6-seq003-envois-annules-repasses-envoyes (SEQ-003)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'd6000000-0000-4000-8000-00000000000a';
  seq_x uuid := 'd6a20000-0000-4000-8000-0000000000e3';
  x1 uuid := 'd6a30000-0000-4000-8000-0000000000e1';
  v_status text;
  v_exec timestamptz;
  v_hint text;
  f text := '';
  c int := 0;
BEGIN
  c := c + 1;
  SELECT status, executed_at INTO v_status, v_exec FROM public.sequence_step_executions WHERE id = 'd6a50000-0000-4000-8000-0000000000e1';
  IF v_status IS DISTINCT FROM 'sent' OR v_exec IS DISTINCT FROM '2026-06-01 10:00:00+00'::timestamptz THEN
    f := f || format('[« during execution » : %s, envoyé le %s au lieu de sent le 2026-06-01 10:00 UTC] ', v_status, v_exec);
  END IF;

  c := c + 1;
  SELECT status INTO v_status FROM public.sequence_step_executions WHERE id = 'd6a50000-0000-4000-8000-0000000000e2';
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    f := f || format('[« before send (last-call check) » : %s au lieu de cancelled] ', v_status);
  END IF;

  c := c + 1;
  PERFORM pg_temp.seqdb_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_x, jsonb_build_array(
      jsonb_build_object('id', x1, 'step_order', 1, 'action_type', 'message', 'message_template', 'Bonjour')));
    f := f || '[étape du message reclassé envoyé retirée] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'STEP_HAS_HISTORY' THEN
      f := f || format('[retrait : refus sans le HINT STEP_HAS_HISTORY (%s)] ', SQLERRM);
    END IF;
  END;
  RESET ROLE;
  PERFORM pg_temp.seqdb_as(NULL);

  INSERT INTO seq_db_results VALUES ('b6-seq003-envois-annules-repasses-envoyes', c, f);
END $$;

-- ---------------------------------------------------------------------
-- b6-seq013-compte-rotation-fige (SEQ-013)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_type text;
  v_got text;
  i int;
  n int;
  expected text[] := ARRAY['seqdb-acc1', NULL, NULL, NULL, 'seqdb-acc1', 'seqdb-acc1'];
  f text := '';
  c int := 0;
BEGIN
  c := c + 1;
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sequence_enrollments' AND column_name = 'assigned_sender_id';
  IF v_type IS DISTINCT FROM 'text' THEN f := f || format('[assigned_sender_id de type %s] ', v_type); END IF;

  c := c + 1;
  FOR i IN 1 .. 6 LOOP
    SELECT assigned_sender_id INTO v_got FROM public.sequence_enrollments WHERE profile_id = 'seqdb-13-e' || i;
    IF v_got IS DISTINCT FROM expected[i] THEN
      f := f || format('[E%s : %s au lieu de %s] ', i, COALESCE(v_got, 'NULL'), COALESCE(expected[i], 'NULL'));
    END IF;
  END LOOP;

  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_enrollments e
  WHERE e.assigned_sender_id IN (SELECT id::text FROM auth.users);
  IF n <> 0 THEN f := f || format('[%s inscription(s) gardent un user_id comme compte d''envoi] ', n); END IF;

  INSERT INTO seq_db_results VALUES ('b6-seq013-compte-rotation-fige', c, f);
END $$;

-- ---------------------------------------------------------------------
-- b6-reparations-organisation-stats-modeles (SEQ-009, SEQ-056, SEQ-057, SEQ-058)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  org_b uuid := 'd6b00000-0000-4000-8000-000000000001';
  v_org uuid;
  v_status text;
  v_skip text;
  v_sys boolean;
  v_before record;
  n int;
  f text := '';
  c int := 0;
BEGIN
  c := c + 1;
  SELECT organization_id INTO v_org FROM public.sequence_steps WHERE id = 'd6b30000-0000-4000-8000-0000000000f9';
  IF v_org IS DISTINCT FROM org_b THEN f := f || format('[étape : organisation %s au lieu de celle de sa séquence] ', v_org); END IF;
  SELECT organization_id INTO v_org FROM public.sequence_enrollments WHERE id = 'd6b40000-0000-4000-8000-0000000000f2';
  IF v_org IS DISTINCT FROM org_b THEN f := f || format('[inscription sans organisation : %s] ', v_org); END IF;
  SELECT organization_id INTO v_org FROM public.sequence_step_executions WHERE id = 'd6b50000-0000-4000-8000-0000000000f1';
  IF v_org IS DISTINCT FROM org_b THEN f := f || format('[exécution : organisation %s au lieu de celle de son inscription] ', v_org); END IF;

  c := c + 1;
  SELECT status, skip_reason INTO v_status, v_skip FROM public.sequence_step_executions WHERE id = 'd6b50000-0000-4000-8000-0000000000f2';
  IF v_status IS DISTINCT FROM 'cancelled' OR v_skip IS DISTINCT FROM 'Étape d''une autre séquence : annulée' THEN
    f := f || format('[exécution programmée d''une autre séquence : %s « %s »] ', v_status, v_skip);
  END IF;
  SELECT status INTO v_status FROM public.sequence_step_executions WHERE id = 'd6b50000-0000-4000-8000-0000000000f3';
  IF v_status IS DISTINCT FROM 'sent' THEN
    f := f || format('[exécution envoyée d''une autre séquence : %s au lieu de sent] ', v_status);
  END IF;

  c := c + 1;
  SELECT organization_id INTO v_org FROM public.sequence_analytics WHERE sequence_id = 'd6b20000-0000-4000-8000-0000000000f1';
  IF v_org IS DISTINCT FROM org_b THEN f := f || format('[statistique : organisation %s] ', v_org); END IF;

  c := c + 1;
  SELECT is_system INTO v_sys FROM public.sequence_templates WHERE id = 'd6a60000-0000-4000-8000-000000000001';
  IF v_sys IS DISTINCT FROM true THEN f := f || '[modèle d''origine (le plus ancien) plus système] '; END IF;
  SELECT is_system INTO v_sys FROM public.sequence_templates WHERE id = 'd6b60000-0000-4000-8000-000000000002';
  IF v_sys IS DISTINCT FROM false THEN f := f || '[doublon récent du modèle d''origine resté système] '; END IF;
  SELECT is_system INTO v_sys FROM public.sequence_templates WHERE id = 'd6b60000-0000-4000-8000-000000000003';
  IF v_sys IS DISTINCT FROM false THEN f := f || '[modèle « système » au nom libre resté système] '; END IF;
  SELECT is_system INTO v_sys FROM public.sequence_templates WHERE id = 'd6b60000-0000-4000-8000-000000000004';
  IF v_sys IS DISTINCT FROM false THEN f := f || '[modèle ordinaire devenu système] '; END IF;

  c := c + 1;
  SELECT * INTO v_before FROM seq_db_counts_before;
  SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id IN ('d6b20000-0000-4000-8000-0000000000f1', 'd6b20000-0000-4000-8000-0000000000f2');
  IF n <> v_before.n_steps THEN f := f || format('[étapes : %s au lieu de %s] ', n, v_before.n_steps); END IF;
  SELECT count(*) INTO n FROM public.sequence_enrollments WHERE sequence_id = 'd6b20000-0000-4000-8000-0000000000f1';
  IF n <> v_before.n_enr THEN f := f || format('[inscriptions : %s au lieu de %s] ', n, v_before.n_enr); END IF;
  SELECT count(*) INTO n FROM public.sequence_step_executions WHERE enrollment_id IN ('d6b40000-0000-4000-8000-0000000000f1', 'd6b40000-0000-4000-8000-0000000000f2');
  IF n <> v_before.n_exec THEN f := f || format('[exécutions : %s au lieu de %s] ', n, v_before.n_exec); END IF;
  SELECT count(*) INTO n FROM public.sequence_analytics WHERE sequence_id = 'd6b20000-0000-4000-8000-0000000000f1';
  IF n <> v_before.n_stats THEN f := f || format('[statistiques : %s au lieu de %s] ', n, v_before.n_stats); END IF;
  SELECT count(*) INTO n FROM public.sequence_templates WHERE id::text LIKE 'd6_60000-%';
  IF n <> v_before.n_tpl THEN f := f || format('[modèles : %s au lieu de %s] ', n, v_before.n_tpl); END IF;

  INSERT INTO seq_db_results VALUES ('b6-reparations-organisation-stats-modeles', c, f);
END $$;

-- ---------------------------------------------------------------------
-- b6-statuts-herites-rien-ne-redemarre (SEQ-215, SEQ-112)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_row record;
  v_before record;
  v_default text;
  n int;
  f text := '';
  c int := 0;
BEGIN
  c := c + 1;
  SELECT status, completed_at, tracking_data INTO v_row FROM public.sequence_enrollments WHERE id = 'd6a40000-0000-4000-8000-0000000002c1';
  IF v_row.status IS DISTINCT FROM 'completed' THEN f := f || format('[« booked » : %s au lieu de completed] ', v_row.status); END IF;
  IF v_row.completed_at IS DISTINCT FROM '2026-05-01 09:00:00+00'::timestamptz THEN
    f := f || format('[« booked » : terminée le %s au lieu de sa dernière mise à jour] ', v_row.completed_at);
  END IF;
  IF v_row.tracking_data->>'completion_reason' IS DISTINCT FROM 'meeting_booked'
     OR v_row.tracking_data->>'legacy_status' IS DISTINCT FROM 'booked'
     OR v_row.tracking_data->>'source' IS DISTINCT FROM 'calendly' THEN
    f := f || format('[« booked » : trace %s] ', v_row.tracking_data);
  END IF;

  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_step_executions
  WHERE id IN ('d6a50000-0000-4000-8000-0000000002c1', 'd6a50000-0000-4000-8000-0000000002c2')
    AND status = 'cancelled' AND skip_reason LIKE 'Étape incohérente%';
  IF n <> 2 THEN f := f || format('[« pending » : %s exécution(s) annulée(s) avec le motif sur 2] ', n); END IF;

  -- Rien ne redémarre : aucune ligne du jeu ne passe active ou programmée.
  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_enrollments e
  JOIN seq_db_before b ON b.kind = 'enr' AND b.id = e.id
  WHERE e.status = 'active' AND b.status IS DISTINCT FROM 'active';
  IF n <> 0 THEN f := f || format('[%s inscription(s) passée(s) active(s) au déploiement] ', n); END IF;
  SELECT count(*) INTO n FROM public.sequence_step_executions x
  JOIN seq_db_before b ON b.kind = 'exec' AND b.id = x.id
  WHERE x.status = 'scheduled' AND b.status IS DISTINCT FROM 'scheduled';
  IF n <> 0 THEN f := f || format('[%s exécution(s) passée(s) programmée(s) au déploiement] ', n); END IF;
  SELECT * INTO v_before FROM seq_db_counts_before;
  SELECT count(*) INTO n FROM public.sequence_enrollments WHERE organization_id = 'd6a00000-0000-4000-8000-000000000001' AND status = 'active';
  IF n <> v_before.n_active_a THEN f := f || format('[inscriptions actives de A : %s au lieu de %s] ', n, v_before.n_active_a); END IF;
  SELECT count(*) INTO n FROM public.sequence_step_executions WHERE organization_id = 'd6a00000-0000-4000-8000-000000000001' AND status = 'scheduled';
  IF n <> v_before.n_sched_a THEN f := f || format('[exécutions programmées de A : %s au lieu de %s] ', n, v_before.n_sched_a); END IF;

  c := c + 1;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
  FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.sequence_step_executions'::regclass AND a.attname = 'status';
  IF v_default IS DISTINCT FROM '''scheduled''::text' THEN f := f || format('[défaut du statut des exécutions : %s] ', v_default); END IF;
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('sequence_enrollments_status_check', 'sequence_step_executions_status_check') AND convalidated;
  IF n <> 2 THEN f := f || format('[%s contrainte(s) de statut posée(s) et validée(s) sur 2] ', n); END IF;

  INSERT INTO seq_db_results VALUES ('b6-statuts-herites-rien-ne-redemarre', c, f);
END $$;

-- ---------------------------------------------------------------------
-- Bilan
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_failed text;
  v_total int;
  v_blocks int;
BEGIN
  SELECT string_agg(format('%s : %s', behaviour, failures), E'\n' ORDER BY behaviour)
    INTO v_failed FROM seq_db_results WHERE failures <> '';
  SELECT sum(checks), count(*) INTO v_total, v_blocks FROM seq_db_results;
  IF v_blocks <> 14 THEN
    RAISE EXCEPTION 'seq_db_audit : % bloc(s) exécuté(s) sur 14', v_blocks;
  END IF;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'seq_db_audit : contrôles en échec\n%', v_failed;
  END IF;
  RAISE NOTICE 'seq_db_audit : % contrôles OK (% comportements)', v_total, v_blocks;
END $$;
