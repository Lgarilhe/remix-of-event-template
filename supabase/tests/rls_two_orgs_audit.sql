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

-- =====================================================================
-- Module séquences — audit du 2026-09-25, lot B6 (migration
-- 20260925163421_sequences_audit_lot_b6.sql). Même transaction que le bloc
-- précédent : il réutilise ses deux utilisateurs, organisations et projets
-- (aucune nouvelle ligne dans auth.users). Contrôles accumulés, exception
-- finale listant ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '11111111-1111-4111-8111-111111111111';
  u_b uuid := '22222222-2222-4222-8222-222222222222';
  org_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  proj_a uuid := 'a0000000-0000-4000-8000-000000000001';
  proj_b uuid := 'b0000000-0000-4000-8000-000000000001';
  seq_a uuid := 'a5000000-0000-4000-8000-000000000001';
  seq_b uuid := 'b5000000-0000-4000-8000-000000000001';
  step_a1 uuid := 'a5100000-0000-4000-8000-000000000001';
  step_a2 uuid := 'a5100000-0000-4000-8000-000000000002';
  step_b1 uuid := 'b5100000-0000-4000-8000-000000000001';
  enr_a uuid := 'a5200000-0000-4000-8000-000000000001';
  exec_sent uuid := 'a5300000-0000-4000-8000-000000000001';
  exec_sched uuid := 'a5300000-0000-4000-8000-000000000002';
  tpl_b uuid := 'b5400000-0000-4000-8000-000000000001';
  cache_b text := 'app.user_org.u_' || replace('22222222-2222-4222-8222-222222222222', '-', '_');
  claims_a text := json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated', 'email', 'a@audit.test')::text;
  claims_b text := json_build_object('sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated', 'email', 'b@audit.test')::text;
  n int;
  v_org uuid;
  v_text text;
  v_hint text;
  failures text := '';
  checks int := 0;
BEGIN
  -- Jeu de données, sans utilisateur connecté (chemin serveur).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RESET ROLE;
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, project_id, is_active)
  VALUES (seq_a, 'Séquence A', org_a, u_a, proj_a, false),
         (seq_b, 'Séquence B', org_b, u_b, proj_b, false);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type)
  VALUES (step_a1, seq_a, org_a, 1, 'message'),
         (step_a2, seq_a, org_a, 2, 'message'),
         (step_b1, seq_b, org_b, 1, 'message');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (enr_a, seq_a, 'acc-a', 'prof-a', org_a, u_a, 'active');
  INSERT INTO public.sequence_step_executions (id, enrollment_id, step_id, step_order, scheduled_at, status, executed_at, final_message)
  VALUES (exec_sent, enr_a, step_a1, 1, now() - interval '1 day', 'sent', now() - interval '1 day', 'Bonjour'),
         (exec_sched, enr_a, step_a2, 2, now() + interval '1 day', 'scheduled', NULL, NULL);
  -- created_by : profiles.id (clé étrangère de la base neuve, NOT NULL en prod).
  INSERT INTO public.sequence_templates (id, organization_id, name, steps_config, is_system, created_by)
  SELECT tpl_b, org_b, 'Modèle B', '[]'::jsonb, false, p.id FROM public.profiles p WHERE p.user_id = u_b;
  PERFORM public.increment_sequence_analytics(seq_a, 'messages_sent', 1);

  -- S1. SEQ-009 : côté serveur aussi, une étape prend l'organisation de sa séquence.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_steps (sequence_id, organization_id, step_order, action_type)
    VALUES (seq_a, org_b, 9, 'message') RETURNING organization_id INTO v_org;
    IF v_org IS DISTINCT FROM org_a THEN failures := failures || '[SEQ-009 : étape gardant une autre organisation que sa séquence] '; END IF;
    DELETE FROM public.sequence_steps WHERE sequence_id = seq_a AND step_order = 9;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEQ-009 serveur : %s] ', SQLERRM);
  END;

  -- S2. SEQ-056 : une exécution dont l'étape est d'une autre séquence est refusée.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status)
    VALUES (enr_a, step_b1, 1, now(), 'scheduled');
    failures := failures || '[SEQ-056 : exécution sur une étape d''une autre séquence acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-056 étape : %s] ', SQLERRM);
  END;

  -- S3. SEQ-057 : la statistique porte l'organisation de sa séquence.
  checks := checks + 1;
  SELECT organization_id INTO v_org FROM public.sequence_analytics WHERE sequence_id = seq_a;
  IF v_org IS DISTINCT FROM org_a THEN failures := failures || '[SEQ-057 : statistique sans organisation] '; END IF;

  -- S4. SEQ-002 / SEQ-121 / SEQ-013 : nouvelles raisons de pause, compte d'envoi en texte.
  checks := checks + 1;
  BEGIN
    UPDATE public.sequence_enrollments
    SET pause_reason = 'sequence_inactive', assigned_sender_id = 'kzAxdybMQ7ipVxK1U6kwZw'
    WHERE id = enr_a;
    UPDATE public.sequence_enrollments SET pause_reason = NULL, assigned_sender_id = NULL WHERE id = enr_a;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEQ-002/013 : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.sequence_enrollments SET pause_reason = 'inconnue' WHERE id = enr_a;
    failures := failures || '[SEQ-002 : raison de pause hors liste acceptée] ';
  EXCEPTION WHEN check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-002 liste : %s] ', SQLERRM);
  END;

  -- S5. SEQ-216 : plus aucune policy héritée sur les tables du module.
  checks := checks + 1;
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_text
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('outreach_sequences', 'sequence_steps', 'sequence_enrollments', 'sequence_step_executions',
                      'sequence_templates', 'sequence_snippets', 'sequence_analytics', 'inmail_queue',
                      'sequence_email_tracking', 'sequence_processing_lock')
    AND policyname NOT IN ('org_members_select', 'org_members_insert', 'org_members_update', 'org_members_delete',
                           'org_members_all', 'org_or_system_select', 'mission_team_select', 'service_role_all');
  IF v_text IS NOT NULL THEN failures := failures || format('[SEQ-216 : policies héritées %s] ', v_text); END IF;

  -- ===== Contexte : user B (org B) =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(cache_b, '', true);
  SET LOCAL ROLE authenticated;

  -- S6. SEQ-217 : B ne lit ni les inscriptions, ni les exécutions, ni les statistiques de A.
  checks := checks + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.sequence_enrollments WHERE id = enr_a;
    IF n <> 0 THEN failures := failures || '[SEQ-217 : B lit une inscription de A] '; END IF;
    SELECT count(*) INTO n FROM public.sequence_step_executions WHERE enrollment_id = enr_a;
    IF n <> 0 THEN failures := failures || format('[SEQ-217 : B lit %s exécution(s) de A] ', n); END IF;
    SELECT count(*) INTO n FROM public.sequence_analytics WHERE sequence_id = seq_a;
    IF n <> 0 THEN failures := failures || '[SEQ-057 : B lit les statistiques de A] '; END IF;
    SELECT count(*) INTO n FROM public.get_sequence_enrollment_counts(ARRAY[seq_a]);
    IF n <> 0 THEN failures := failures || '[SEQ-165 : B compte les inscriptions de A] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEQ-217 lecture : %s] ', SQLERRM);
  END;

  -- S7. SEQ-009 : B ne peut pas glisser une étape dans la séquence de A.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_steps (sequence_id, organization_id, step_order, action_type, message_template)
    VALUES (seq_a, org_b, 3, 'message', 'injection');
    failures := failures || '[SEQ-009 : B insère une étape dans la séquence de A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-009 : %s] ', SQLERRM);
  END;

  -- S8. SEQ-056 : B ne peut pas planifier une étape sur une inscription de A.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id, final_message)
    VALUES (enr_a, step_a1, 1, now(), 'scheduled', org_b, 'texte libre');
    failures := failures || '[SEQ-056 : B insère une exécution sur une inscription de A] ';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-056 exécution : %s] ', SQLERRM);
  END;

  -- S9. SEQ-056 : B ne peut pas inscrire un candidat dans la séquence de A.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'acc-b', 'prof-b', org_b, u_b, 'active');
    failures := failures || '[SEQ-056 : B inscrit un candidat dans la séquence de A] ';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-056 inscription : %s] ', SQLERRM);
  END;

  -- S10. SEQ-056 : B ne rattache pas sa séquence à la mission de A...
  checks := checks + 1;
  BEGIN
    INSERT INTO public.outreach_sequences (name, organization_id, created_by, project_id, is_active)
    VALUES ('Séquence B sur mission A', org_b, u_b, proj_a, false);
    failures := failures || '[SEQ-056 : séquence de B rattachée à la mission de A] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-056 mission : %s] ', SQLERRM);
  END;
  -- ... sauf s'il fait partie de l'équipe de cette mission (partenaire).
  RESET ROLE;
  INSERT INTO public.mission_team (project_id, user_id, role) VALUES (proj_a, u_b, 'freelance');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.outreach_sequences (name, organization_id, created_by, project_id, is_active)
    VALUES ('Séquence partenaire', org_b, u_b, proj_a, false);
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression partenaire : %s] ', SQLERRM);
  END;
  RESET ROLE;
  DELETE FROM public.outreach_sequences WHERE name = 'Séquence partenaire' AND organization_id = org_b;
  DELETE FROM public.mission_team WHERE project_id = proj_a AND user_id = u_b;
  SET LOCAL ROLE authenticated;

  -- S11. SEQ-058 : B ne publie pas de modèle « système », ni ne transforme le sien.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_templates (organization_id, name, steps_config, is_system, created_by)
    SELECT org_b, 'Relance recommandée', '[]'::jsonb, true, p.id FROM public.profiles p WHERE p.user_id = u_b;
    failures := failures || '[SEQ-058 : B publie un modèle système] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-058 création : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.sequence_templates SET is_system = true WHERE id = tpl_b;
    failures := failures || '[SEQ-058 : B passe son modèle en système] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-058 modification : %s] ', SQLERRM);
  END;

  -- S12. SEQ-011 : B ne programme pas d'InMail par l'API, mais note un message envoyé.
  checks := checks + 1;
  BEGIN
    INSERT INTO public.inmail_queue (account_id, recipient_profile_id, subject, message, status, scheduled_at, organization_id, created_by)
    VALUES ('acc-a', 'prof-x', 'Objet', 'Texte', 'scheduled', now(), org_b, u_b);
    failures := failures || '[SEQ-011 : B programme un InMail par l''API] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-011 : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.inmail_queue (account_id, recipient_profile_id, subject, message, status, sent_at, organization_id, created_by)
    VALUES ('acc-b', 'prof-x', 'Objet', 'Texte', 'sent', now(), org_b, u_b);
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression SEQ-011 suivi d''envoi : %s] ', SQLERRM);
  END;

  -- ===== SEQ-119 : B devient collaborateur de l'org A =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_b, 'collaborator');
  UPDATE public.profiles SET active_organization_id = org_a WHERE user_id = u_b;
  PERFORM set_config(cache_b, '', true);
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- S13. Hors de son équipe de mission, le collaborateur ne voit ni la séquence ni ses candidats.
  checks := checks + 1;
  BEGIN
    IF public.get_user_org_id(u_b) IS DISTINCT FROM org_a THEN failures := failures || '[SEQ-119 : org active du collaborateur] '; END IF;
    SELECT count(*) INTO n FROM public.outreach_sequences WHERE id = seq_a;
    IF n <> 0 THEN failures := failures || '[SEQ-119 : le collaborateur lit une séquence hors de sa mission] '; END IF;
    SELECT count(*) INTO n FROM public.sequence_enrollments WHERE id = enr_a;
    IF n <> 0 THEN failures := failures || '[SEQ-119 : le collaborateur lit une inscription hors de sa mission] '; END IF;
    SELECT count(*) INTO n FROM public.sequence_step_executions WHERE enrollment_id = enr_a;
    IF n <> 0 THEN failures := failures || '[SEQ-119 : le collaborateur lit les messages d''un collègue] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEQ-119 lecture : %s] ', SQLERRM);
  END;

  -- S14. Dans l'équipe de la mission, il lit les candidats mais ne modifie pas
  --      ceux d'un collègue.
  RESET ROLE;
  INSERT INTO public.mission_team (project_id, user_id, role) VALUES (proj_a, u_b, 'sourcer');
  SET LOCAL ROLE authenticated;
  checks := checks + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.sequence_enrollments WHERE id = enr_a;
    IF n <> 1 THEN failures := failures || format('[SEQ-119 : le collaborateur ne lit pas les candidats de sa mission (%s)] ', n); END IF;
    UPDATE public.sequence_enrollments SET status = 'paused', pause_reason = 'manual' WHERE id = enr_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[SEQ-119 : le collaborateur modifie l''inscription d''un collègue] '; END IF;
    UPDATE public.sequence_step_executions SET final_message = 'modifié' WHERE id = exec_sched;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[SEQ-119 : le collaborateur modifie le message d''un collègue] '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-119 écriture : %s] ', SQLERRM);
  END;

  -- Remise en état : B redevient seulement membre de l'org B.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  DELETE FROM public.mission_team WHERE project_id = proj_a AND user_id = u_b;
  DELETE FROM public.organization_members WHERE organization_id = org_a AND user_id = u_b;
  UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = u_b;
  PERFORM set_config(cache_b, '', true);

  -- ===== Contexte : user A (org A) =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- S15. Régression : A lit sa séquence, ses étapes, son candidat, ses messages et ses statistiques.
  checks := checks + 1;
  BEGIN
    SELECT count(*) INTO n FROM public.outreach_sequences WHERE id = seq_a;
    IF n <> 1 THEN failures := failures || '[Régression : A ne lit plus sa séquence] '; END IF;
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_a;
    IF n <> 2 THEN failures := failures || format('[Régression : A lit %s étape(s) sur 2] ', n); END IF;
    SELECT count(*) INTO n FROM public.sequence_step_executions WHERE enrollment_id = enr_a;
    IF n <> 2 THEN failures := failures || format('[Régression : A lit %s exécution(s) sur 2] ', n); END IF;
    SELECT coalesce(sum(messages_sent), 0) INTO n FROM public.sequence_analytics WHERE sequence_id = seq_a;
    IF n <> 1 THEN failures := failures || format('[SEQ-057 : A lit %s message(s) envoyé(s) au lieu de 1] ', n); END IF;
    SELECT count INTO n FROM public.get_sequence_enrollment_counts(ARRAY[seq_a]) WHERE status = 'active';
    IF n IS DISTINCT FROM 1 THEN failures := failures || format('[SEQ-165 : compteur d''actifs %s au lieu de 1] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression A séquences : %s] ', SQLERRM);
  END;

  -- S16. SEQ-214 : une étape envoyée ne redevient pas programmée, et une étape
  --      ne change pas de candidat ; le texte d'une étape programmée reste modifiable.
  checks := checks + 1;
  BEGIN
    UPDATE public.sequence_step_executions SET status = 'scheduled', scheduled_at = now() WHERE id = exec_sent;
    failures := failures || '[SEQ-214 : étape envoyée remise en programmée] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-214 statut : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.sequence_step_executions SET step_id = step_a1 WHERE id = exec_sched;
    failures := failures || '[SEQ-214 : étape rattachée à une autre étape de la séquence] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[SEQ-214 rattachement : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.sequence_step_executions SET final_message = 'Texte revu' WHERE id = exec_sched AND status = 'scheduled';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || '[Régression SEQ-214 : texte d''une étape programmée non modifiable] '; END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression SEQ-214 : %s] ', SQLERRM);
  END;

  -- S17. SEQ-059 : retirer une étape déjà envoyée est refusé (HINT STEP_HAS_HISTORY) ;
  --      retirer une étape sans historique reste possible.
  checks := checks + 1;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_a, jsonb_build_array(
      jsonb_build_object('id', step_a2, 'step_order', 1, 'action_type', 'message')));
    failures := failures || '[SEQ-059 : étape envoyée supprimée] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'STEP_HAS_HISTORY' THEN
      failures := failures || format('[SEQ-059 : refus sans le HINT attendu (%s)] ', SQLERRM);
    END IF;
  END;
  BEGIN
    PERFORM * FROM public.save_sequence_steps(seq_a, jsonb_build_array(
      jsonb_build_object('id', step_a1, 'step_order', 1, 'action_type', 'message'),
      jsonb_build_object('id', step_a2, 'step_order', 2, 'action_type', 'message'),
      jsonb_build_object('id', 'nouvelle', 'step_order', 3, 'action_type', 'message')));
    PERFORM * FROM public.save_sequence_steps(seq_a, jsonb_build_array(
      jsonb_build_object('id', step_a1, 'step_order', 1, 'action_type', 'message'),
      jsonb_build_object('id', step_a2, 'step_order', 2, 'action_type', 'message')));
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_a;
    IF n <> 2 THEN failures := failures || format('[Régression SEQ-059 : %s étape(s) après retrait] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression SEQ-059 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- S18. SEQ-165 : les compteurs portent la raison de pause des inscriptions en pause.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.sequence_enrollments SET status = 'paused', pause_reason = 'sequence_inactive' WHERE id = enr_a;
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  checks := checks + 1;
  BEGIN
    SELECT count INTO n FROM public.get_sequence_enrollment_counts(ARRAY[seq_a])
    WHERE status = 'paused' AND pause_reason = 'sequence_inactive';
    IF n IS DISTINCT FROM 1 THEN failures := failures || format('[SEQ-165 : %s pause(s) « séquence désactivée » au lieu de 1] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[SEQ-165 raison de pause : %s] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.sequence_enrollments SET status = 'active', pause_reason = NULL WHERE id = enr_a;

  -- S19. SEQ-043 : on inscrit depuis son propre compte LinkedIn relié. B, membre
  --      de l'org A le temps du contrôle, n'inscrit pas depuis le compte relié à A,
  --      même en se déclarant auteur à la place de A ; un compte sans liaison
  --      (e-mail) reste accepté, et le chemin serveur contrôle created_by.
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (org_a, u_a, 'acc-li-a', u_a);
  checks := checks + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'acc-li-a', 'prof-srv-b', org_a, u_b, 'active');
    failures := failures || '[SEQ-043 : serveur, inscription depuis le compte relié à un autre membre acceptée] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
      failures := failures || format('[SEQ-043 serveur : refus sans le HINT attendu (%s)] ', SQLERRM);
    END IF;
  WHEN OTHERS THEN failures := failures || format('[SEQ-043 serveur : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'acc-li-a', 'prof-srv-a', org_a, u_a, 'active');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression SEQ-043 : le serveur n''inscrit plus depuis le compte de l''auteur (%s)] ', SQLERRM);
  END;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_b, 'collaborator');
  UPDATE public.profiles SET active_organization_id = org_a WHERE user_id = u_b;
  PERFORM set_config(cache_b, '', true);
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'acc-li-a', 'prof-b-1', org_a, u_b, 'active');
    failures := failures || '[SEQ-043 : B inscrit depuis le compte relié à A] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
      failures := failures || format('[SEQ-043 : refus sans le HINT attendu (%s)] ', SQLERRM);
    END IF;
  WHEN OTHERS THEN failures := failures || format('[SEQ-043 : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'acc-li-a', 'prof-b-2', org_a, u_a, 'active');
    failures := failures || '[SEQ-043 : B inscrit depuis le compte de A en se déclarant A] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
      failures := failures || format('[SEQ-043 usurpation : refus sans le HINT attendu (%s)] ', SQLERRM);
    END IF;
  WHEN OTHERS THEN failures := failures || format('[SEQ-043 usurpation : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'mail-b@audit.test', 'prof-b-3', org_a, u_b, 'active');
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[Régression SEQ-043 : compte sans liaison refusé (%s)] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  DELETE FROM public.sequence_enrollments WHERE sequence_id = seq_a AND profile_id IN ('prof-srv-a', 'prof-b-3');
  DELETE FROM public.member_linkedin_accounts WHERE organization_id = org_a AND linkedin_account_id = 'acc-li-a';
  DELETE FROM public.organization_members WHERE organization_id = org_a AND user_id = u_b;
  UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = u_b;
  PERFORM set_config(cache_b, '', true);

  IF failures <> '' THEN
    RAISE EXCEPTION 'rls_two_orgs_audit (séquences) : contrôles en échec %', failures;
  END IF;
  RAISE NOTICE 'rls_two_orgs_audit (séquences) : % contrôles OK', checks;
END $$;
