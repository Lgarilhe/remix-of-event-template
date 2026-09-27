-- =====================================================================
-- Moteur de séquences, lot « engine-1 » : verrous en base.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/seq_engine_1_audit.sql; ROLLBACK;
--
-- verrou-execution-optimiste : l'index unique partiel
--   uq_step_exec_pending_per_enrollment_step interdit deux exécutions en
--   attente (scheduled, sending, waiting_event, quota_blocked) pour la même
--   (inscription, étape) ; l'historique (sent…) coexiste avec une nouvelle
--   planification (SEQ-072, SEQ-081).
-- verrou-ttl-liberation : acquire_sequence_lock / release_sequence_lock. Un
--   seul détenteur, seul lui libère, un verrou de plus de 10 min est repris
--   (SEQ-074).
--
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- now() est figé sur la transaction : les dates du verrou sont posées à la main.
-- =====================================================================
DO $$
DECLARE
  u_o uuid := '81111111-1111-4111-8111-111111111111';
  org uuid := '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  seq uuid := '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  st0 uuid := '8ccccccc-cccc-4ccc-8ccc-cccccccccc00';
  st1 uuid := '8ccccccc-cccc-4ccc-8ccc-cccccccccc01';
  enr uuid := '8ddddddd-dddd-4ddd-8ddd-dddddddddddd';
  failures text := '';
  checks int := 0;
  ok boolean;
  pending_statuses text[] := ARRAY['scheduled', 'sending', 'waiting_event', 'quota_blocked'];
  a text;
  b text;
BEGIN
  -- Jeu de données : un propriétaire, une organisation, une séquence de deux étapes, une inscription.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_o, 'o@seq-engine-1.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org, 'Seq Engine 1', 'seq-engine-1', u_o, 'agency');
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq, 'Séquence audit', org, u_o, true);
  INSERT INTO public.sequence_steps (id, sequence_id, step_order, action_type, delay_days, message_template)
  VALUES (st0, seq, 0, 'message', 0, 'Bonjour'), (st1, seq, 1, 'message', 2, 'Relance');
  INSERT INTO public.sequence_enrollments (id, sequence_id, organization_id, created_by, profile_id, account_id, status)
  VALUES (enr, seq, org, u_o, 'ACoAAAUDITENGINE1', 'acc_audit_engine_1', 'active');

  -- ===== Index unique partiel =====

  -- 1. Deux exécutions de même statut en attente pour la même (inscription, étape) : refusé.
  FOREACH a IN ARRAY pending_statuses LOOP
    checks := checks + 1;
    BEGIN
      INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, status, scheduled_at)
      VALUES (enr, org, st0, 0, a, now()), (enr, org, st0, 0, a, now());
      failures := failures || format('[1. deux « %s » acceptées] ', a);
    EXCEPTION WHEN unique_violation THEN NULL;
    WHEN OTHERS THEN failures := failures || format('[1. deux « %s » : %s] ', a, SQLERRM);
    END;
  END LOOP;

  -- 2. Deux statuts en attente différents (ex. waiting_event + quota_blocked) : refusé aussi.
  FOREACH a IN ARRAY pending_statuses LOOP
    FOREACH b IN ARRAY pending_statuses LOOP
      CONTINUE WHEN a >= b;
      checks := checks + 1;
      BEGIN
        INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, status, scheduled_at)
        VALUES (enr, org, st0, 0, a, now()), (enr, org, st0, 0, b, now());
        failures := failures || format('[2. « %s » + « %s » acceptées] ', a, b);
      EXCEPTION WHEN unique_violation THEN NULL;
      WHEN OTHERS THEN failures := failures || format('[2. « %s » + « %s » : %s] ', a, b, SQLERRM);
      END;
    END LOOP;
  END LOOP;

  -- 3. Historique + nouvelle planification de la même étape : accepté (boucles de branche, reprise).
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, status, scheduled_at, executed_at)
    VALUES (enr, org, st0, 0, 'sent', now() - interval '1 day', now() - interval '1 day'),
           (enr, org, st0, 0, 'cancelled', now() - interval '1 day', now() - interval '1 day'),
           (enr, org, st0, 0, 'scheduled', now(), NULL);
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[3. envoyée + annulée + planifiée : %s] ', SQLERRM);
  END;

  -- 4. Une autre étape de la même inscription reste planifiable en parallèle.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, organization_id, step_id, step_order, status, scheduled_at)
    VALUES (enr, org, st1, 1, 'waiting_event', now() + interval '2 days');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[4. étape 1 en attente à côté de l''étape 0 : %s] ', SQLERRM);
  END;

  -- 5. Repasser une exécution annulée en « scheduled » à côté d'une planifiée : refusé
  --    (un réarmement côté serveur ne peut pas doubler une étape, SEQ-004).
  checks := checks + 1;
  BEGIN
    UPDATE public.sequence_step_executions SET status = 'scheduled'
    WHERE enrollment_id = enr AND step_id = st0 AND status = 'cancelled';
    failures := failures || '[5. réarmement en doublon accepté] ';
  EXCEPTION WHEN unique_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[5. réarmement : %s] ', SQLERRM);
  END;

  -- ===== Verrou global =====
  INSERT INTO public.sequence_processing_lock (id) VALUES ('process') ON CONFLICT (id) DO NOTHING;
  UPDATE public.sequence_processing_lock SET locked_at = NULL, locked_by = NULL WHERE id = 'process';

  -- 6. Premier détenteur : acquis.
  checks := checks + 1;
  IF public.acquire_sequence_lock('a', 10) IS NOT TRUE THEN failures := failures || '[6. acquire(a) refusé sur verrou libre] '; END IF;
  -- 7. Second passage pendant ce temps : refusé.
  checks := checks + 1;
  IF public.acquire_sequence_lock('b', 10) IS NOT FALSE THEN failures := failures || '[7. acquire(b) accepté alors que a tient le verrou] '; END IF;
  -- 8. Seul le détenteur libère : release(b) sans effet.
  checks := checks + 1;
  PERFORM public.release_sequence_lock('b');
  IF public.acquire_sequence_lock('b', 10) IS NOT FALSE THEN failures := failures || '[8. release(b) a libéré le verrou de a] '; END IF;
  checks := checks + 1;
  SELECT locked_by = 'a' INTO ok FROM public.sequence_processing_lock WHERE id = 'process';
  IF ok IS NOT TRUE THEN failures := failures || '[8b. détenteur changé par un tiers] '; END IF;
  -- 9. Le détenteur libère : le suivant acquiert.
  checks := checks + 1;
  PERFORM public.release_sequence_lock('a');
  SELECT locked_at IS NULL AND locked_by IS NULL INTO ok FROM public.sequence_processing_lock WHERE id = 'process';
  IF ok IS NOT TRUE THEN failures := failures || '[9. release(a) n''a pas vidé le verrou] '; END IF;
  checks := checks + 1;
  IF public.acquire_sequence_lock('b', 10) IS NOT TRUE THEN failures := failures || '[9b. acquire(b) refusé après release(a)] '; END IF;
  -- 10. Verrou de 9 min : encore tenu.
  checks := checks + 1;
  UPDATE public.sequence_processing_lock SET locked_at = now() - interval '9 minutes' WHERE id = 'process';
  IF public.acquire_sequence_lock('c', 10) IS NOT FALSE THEN failures := failures || '[10. verrou de 9 min repris] '; END IF;
  -- 11. Verrou de 11 min : repris par le suivant.
  checks := checks + 1;
  UPDATE public.sequence_processing_lock SET locked_at = now() - interval '11 minutes' WHERE id = 'process';
  IF public.acquire_sequence_lock('c', 10) IS NOT TRUE THEN failures := failures || '[11. verrou de 11 min non repris] '; END IF;
  -- 12. L'ancien détenteur (b) ne libère plus le verrou repris par c.
  checks := checks + 1;
  PERFORM public.release_sequence_lock('b');
  SELECT locked_by = 'c' INTO ok FROM public.sequence_processing_lock WHERE id = 'process';
  IF ok IS NOT TRUE THEN failures := failures || '[12. l''ancien détenteur a libéré le verrou repris] '; END IF;
  checks := checks + 1;
  PERFORM public.release_sequence_lock('c');
  SELECT locked_at IS NULL INTO ok FROM public.sequence_processing_lock WHERE id = 'process';
  IF ok IS NOT TRUE THEN failures := failures || '[12b. release(c) n''a pas libéré] '; END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'seq_engine_1_audit : %', failures;
  END IF;
  RAISE NOTICE 'seq_engine_1_audit : % contrôles OK', checks;
END $$;
