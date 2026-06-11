-- Fix replayability 2026-06-11 : l'ON CONFLICT (job_id, candidate_id, created_by)
-- plus bas exige une UNIQUE qui n'est (re)créée que par le grants bootstrap du
-- 2026-04-21 (le schéma Lovable avait perdu les UNIQUE). On la crée ici de
-- façon idempotente — le bootstrap (gardé par colonnes) la détecte et skip.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'job_candidate_status' AND con.contype = 'u'
  ) THEN
    ALTER TABLE public.job_candidate_status
      ADD CONSTRAINT job_candidate_status_job_candidate_creator_key
      UNIQUE (job_id, candidate_id, created_by);
  END IF;
END $$;


DO $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_seq_linear uuid;
  v_seq_branch uuid;
  v_seq_email uuid;
  v_seq_stop uuid;
  v_seq_ab uuid;
  v_seq_multichannel uuid;
  v_seq_conditions uuid;
  v_seq_edge uuid;
  v_step uuid;
  v_step2 uuid;
  v_step3 uuid;
  v_step_cond uuid;
  v_step_yes uuid;
  v_step_no uuid;
  v_step_a uuid;
  v_step_b uuid;
  v_enroll uuid;
BEGIN
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  SELECT user_id INTO v_user_id FROM organization_members WHERE organization_id = v_org_id LIMIT 1;
  -- Fix replayability 2026-06-11 : cette migration seed des données de TEST et
  -- suppose une org/un user existants (vrai en prod à l'époque, faux sur une
  -- base vierge). On skip proprement au lieu d'échouer — le schéma n'en dépend pas.
  IF v_org_id IS NULL OR v_user_id IS NULL THEN
    RAISE NOTICE 'Seed de test sauté (aucune org/user existant — base vierge)';
    RETURN;
  END IF;

  RAISE NOTICE '=== TEST EXHAUSTIF SÉQUENCES ===';
  RAISE NOTICE 'Org: %, User: %', v_org_id, v_user_id;

  -- CLEANUP
  DELETE FROM sequence_step_executions WHERE enrollment_id IN (
    SELECT id FROM sequence_enrollments WHERE profile_name LIKE 'TEST_%'
  );
  DELETE FROM sequence_enrollments WHERE profile_name LIKE 'TEST_%';
  DELETE FROM sequence_steps WHERE sequence_id IN (
    SELECT id FROM outreach_sequences WHERE name LIKE '[TEST%'
  );
  DELETE FROM outreach_sequences WHERE name LIKE '[TEST%';

  -- TEST 1: LINÉAIRE
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-1] Linéaire classique', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_linear;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES
    (v_seq_linear, 1, 'connection_request', 0, 'always', 'Test invitation', v_org_id),
    (v_seq_linear, 2, 'message', 1, 'if_connected', 'Test message', v_org_id),
    (v_seq_linear, 3, 'message', 2, 'always', 'Test relance', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, status, organization_id, created_by, user_timezone)
  VALUES (v_seq_linear, 'fake-li-account', 'fake-profile-linear', 'TEST_Linear_Marie', 'active', v_org_id, v_user_id, 'Europe/Paris')
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  SELECT v_enroll, id, 1, now(), 'scheduled', v_org_id FROM sequence_steps WHERE sequence_id = v_seq_linear AND step_order = 1;

  -- TEST 2: AUTO-SKIP
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-2] Auto-skip canaux', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_email;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, subject_template, message_template, organization_id)
  VALUES (v_seq_email, 1, 'email', 'email', 0, 'always', 'Test', 'Test body', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_email, 2, 'whatsapp_message', 'whatsapp', 0, 'always', 'Test WA', v_org_id)
  RETURNING id INTO v_step2;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_email, 3, 'message', 0, 'always', 'Test LI msg', v_org_id)
  RETURNING id INTO v_step3;

  -- 2a: SANS email, SANS phone
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, 'fake-li-account', 'fake-skip-all', 'TEST_Skip_NoEmailNoPhone', null, null, 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 2b: AVEC email, SANS phone
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, 'fake-li-account', 'fake-skip-phone', 'TEST_Skip_HasEmailNoPhone', 'test@example.com', null, 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 2c: SANS email, AVEC phone
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, 'fake-li-account', 'fake-skip-email', 'TEST_Skip_NoEmailHasPhone', null, '+33612345678', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 2d: SANS account_id
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, '', 'fake-no-account', 'TEST_Skip_NoLinkedIn', 'test2@example.com', '+33612345679', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- TEST 3: BRANCHING
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-3] Branching yes/no', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_branch;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_branch, 1, 'email', 'email', 0, 'always', 'Initial email', 'Subject', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, organization_id)
  VALUES (v_seq_branch, 2, 'condition_branch', 0, 'if_has_email', v_org_id)
  RETURNING id INTO v_step_cond;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, parent_step_id, branch, message_template, subject_template, organization_id)
  VALUES (v_seq_branch, 3, 'email', 'email', 0, 'always', v_step_cond, 'yes', 'Yes branch email', 'Yes subject', v_org_id)
  RETURNING id INTO v_step_yes;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, parent_step_id, branch, message_template, organization_id)
  VALUES (v_seq_branch, 3, 'whatsapp_message', 'whatsapp', 0, 'always', v_step_cond, 'no', 'No branch WA', v_org_id)
  RETURNING id INTO v_step_no;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_branch, 'fake-li-account', 'fake-branch-yes', 'TEST_Branch_HasEmail', 'branch@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_branch, 'fake-li-account', 'fake-branch-no', 'TEST_Branch_NoEmail', null, '+33699999999', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- TEST 4: STOP CONDITIONS
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by, stop_conditions)
  VALUES ('[TEST-4] Stop on click', v_org_id, true, v_user_id, '{"on_reply": true, "on_click": true, "on_unsubscribe": true}'::jsonb)
  RETURNING id INTO v_seq_stop;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_stop, 1, 'email', 'email', 0, 'always', 'Stop test', 'Stop subject', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_stop, 2, 'email', 'email', 1, 'always', 'Should not execute', 'Should not', v_org_id);

  -- 4a: Click déjà enregistré
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_stop, 'fake-li-account', 'fake-stop-click', 'TEST_Stop_Clicked', 'stop@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, organization_id)
  VALUES (v_enroll, v_step, 0, now() - interval '1 day', 'clicked', now() - interval '1 day', v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 4b: Désinscrit
  INSERT INTO suppressed_emails (email, reason) VALUES ('unsub@example.com', 'unsubscribe') ON CONFLICT (email) DO NOTHING;
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_stop, 'fake-li-account', 'fake-stop-unsub', 'TEST_Stop_Unsubscribed', 'unsub@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- TEST 5: A/B TESTING
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-5] A/B testing', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_ab;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, variant_group, variant_weight, organization_id)
  VALUES (v_seq_ab, 1, 'email', 'email', 0, 'always', 'Version A du message', 'Subject A', 'A', 70, v_org_id)
  RETURNING id INTO v_step_a;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, variant_group, variant_weight, organization_id)
  VALUES (v_seq_ab, 1, 'email', 'email', 0, 'always', 'Version B du message', 'Subject B', 'B', 30, v_org_id)
  RETURNING id INTO v_step_b;

  FOR i IN 1..10 LOOP
    INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
    VALUES (v_seq_ab, 'fake-li-account', 'fake-ab-' || i, 'TEST_AB_' || i, 'ab' || i || '@example.com', 'active', v_org_id, v_user_id)
    RETURNING id INTO v_enroll;
    INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
    VALUES (v_enroll, v_step_a, 1, now(), 'scheduled', v_org_id);
  END LOOP;

  -- TEST 6: MULTICANAL
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-6] Multichannel', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_multichannel;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_multichannel, 1, 'email', 'email', 0, 'always', 'Email first', 'Subject', v_org_id);
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_multichannel, 2, 'whatsapp_message', 'whatsapp', 1, 'always', 'Then WhatsApp', v_org_id);
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_multichannel, 3, 'message', 2, 'always', 'Then LinkedIn', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_multichannel, 'fake-li-account', 'fake-multi-all', 'TEST_Multi_AllChannels', 'multi@example.com', '+33611111111', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  SELECT v_enroll, id, 1, now(), 'scheduled', v_org_id FROM sequence_steps WHERE sequence_id = v_seq_multichannel AND step_order = 1;

  -- TEST 7: CONDITIONS ENRICHIES
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-7] Conditions enrichies', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_conditions;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_conditions, 1, 'email', 'email', 0, 'if_bounced', 'Should skip if bounced', 'Bounce test', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_conditions, 'fake-li-account', 'fake-cond-bounced', 'TEST_Cond_Bounced', 'bounced@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, organization_id)
  VALUES (v_enroll, v_step, 0, now() - interval '2 days', 'bounced', now() - interval '2 days', v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, condition_value, message_template, subject_template, organization_id)
  VALUES (v_seq_conditions, 2, 'email', 'email', 0, 'if_score_above', '70', 'High score email', 'Score test', v_org_id)
  RETURNING id INTO v_step2;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_conditions, 'fake-li-account', 'fake-cond-scored', 'TEST_Cond_ScoreAbove', 'scored@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO job_candidate_status (job_id, candidate_id, status, score, created_by)
  VALUES ('test-job', 'fake-cond-scored', 'scored', 85, v_user_id)
  ON CONFLICT (job_id, candidate_id, created_by) DO UPDATE SET score = 85;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step2, 2, now(), 'scheduled', v_org_id);

  -- TEST 8: STUCK RECOVERY
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-8] Stuck recovery', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_edge;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_edge, 1, 'email', 'email', 0, 'always', 'Stuck test', 'Stuck', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_edge, 'fake-li-account', 'fake-stuck', 'TEST_Stuck_Recovery', 'stuck@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, updated_at, organization_id)
  VALUES (v_enroll, v_step, 1, now() - interval '10 minutes', 'sending', now() - interval '10 minutes', v_org_id);

  -- TEST 9: ENROLLMENT PAUSED
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_edge, 'fake-li-account', 'fake-paused', 'TEST_Paused_Enrollment', 'paused@example.com', 'paused', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  RAISE NOTICE 'TESTS CRÉÉS ! Total : ~20 enrollments, ~25 executions';
END $$;
