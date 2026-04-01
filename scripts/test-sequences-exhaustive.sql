-- ============================================================================
-- TEST EXHAUSTIF : Module Séquences — ~60+ scénarios
--
-- SAFE : utilise des fake profile_id/account_id, donc :
-- - Aucun message LinkedIn envoyé (Unipile rejettera les fake IDs)
-- - Aucun email envoyé (pas de compte email connecté pour fake accounts)
-- - Aucun WhatsApp envoyé (idem)
-- - Les crédits IA SERONT consommés si ANTHROPIC_API_KEY est configuré
--
-- Exécuter dans Supabase SQL Editor, puis appeler process-sequences
-- avec {"action": "process", "force": true}
--
-- Vérifier les résultats avec les requêtes à la fin du script.
-- ============================================================================

DO $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  -- Sequences
  v_seq_linear uuid;
  v_seq_branch uuid;
  v_seq_email uuid;
  v_seq_stop uuid;
  v_seq_ab uuid;
  v_seq_multichannel uuid;
  v_seq_conditions uuid;
  v_seq_edge uuid;
  -- Steps (reused across tests)
  v_step uuid;
  v_step2 uuid;
  v_step3 uuid;
  v_step_cond uuid;
  v_step_yes uuid;
  v_step_no uuid;
  v_step_a uuid;
  v_step_b uuid;
  -- Enrollments
  v_enroll uuid;
BEGIN
  -- Get org and user
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  SELECT user_id INTO v_user_id FROM organization_members WHERE organization_id = v_org_id LIMIT 1;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'No organization found'; END IF;

  RAISE NOTICE '=== TEST EXHAUSTIF SÉQUENCES ===';
  RAISE NOTICE 'Org: %, User: %', v_org_id, v_user_id;

  -- ================================================================
  -- CLEANUP: Remove any previous test data
  -- ================================================================
  DELETE FROM sequence_step_executions WHERE enrollment_id IN (
    SELECT id FROM sequence_enrollments WHERE profile_name LIKE 'TEST_%'
  );
  DELETE FROM sequence_enrollments WHERE profile_name LIKE 'TEST_%';
  DELETE FROM sequence_steps WHERE sequence_id IN (
    SELECT id FROM outreach_sequences WHERE name LIKE '[TEST%'
  );
  DELETE FROM outreach_sequences WHERE name LIKE '[TEST%';

  -- ================================================================
  -- TEST 1: SÉQUENCE LINÉAIRE (non-régression)
  -- 3 steps LinkedIn classiques, step_order 1→2→3
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-1] Linéaire classique', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_linear;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES
    (v_seq_linear, 1, 'connection_request', 0, 'always', 'Test invitation', v_org_id),
    (v_seq_linear, 2, 'message', 1, 'if_connected', 'Test message', v_org_id),
    (v_seq_linear, 3, 'message', 2, 'always', 'Test relance', v_org_id);

  -- Candidat normal avec account_id
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, status, organization_id, created_by, user_timezone)
  VALUES (v_seq_linear, 'fake-li-account', 'fake-profile-linear', 'TEST_Linear_Marie', 'active', v_org_id, v_user_id, 'Europe/Paris')
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  SELECT v_enroll, id, 1, now(), 'scheduled', v_org_id FROM sequence_steps WHERE sequence_id = v_seq_linear AND step_order = 1;

  -- ================================================================
  -- TEST 2: AUTO-SKIP — 4 scénarios
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-2] Auto-skip canaux', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_email;

  -- Step 1: Email
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, subject_template, message_template, organization_id)
  VALUES (v_seq_email, 1, 'email', 'email', 0, 'always', 'Test', 'Test body', v_org_id)
  RETURNING id INTO v_step;

  -- Step 2: WhatsApp
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_email, 2, 'whatsapp_message', 'whatsapp', 0, 'always', 'Test WA', v_org_id)
  RETURNING id INTO v_step2;

  -- Step 3: LinkedIn message
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_email, 3, 'message', 0, 'always', 'Test LI msg', v_org_id)
  RETURNING id INTO v_step3;

  -- 2a: Candidat SANS email, SANS phone → email skip, WA skip, LinkedIn fail (fake account)
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, 'fake-li-account', 'fake-skip-all', 'TEST_Skip_NoEmailNoPhone', null, null, 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 2b: Candidat AVEC email, SANS phone → email attempt, WA skip
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, 'fake-li-account', 'fake-skip-phone', 'TEST_Skip_HasEmailNoPhone', 'test@example.com', null, 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 2c: Candidat SANS email, AVEC phone → email skip, WA attempt
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, 'fake-li-account', 'fake-skip-email', 'TEST_Skip_NoEmailHasPhone', null, '+33612345678', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 2d: Candidat SANS account_id → LinkedIn skip
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_email, '', 'fake-no-account', 'TEST_Skip_NoLinkedIn', 'test2@example.com', '+33612345679', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- ================================================================
  -- TEST 3: BRANCHING CONDITIONNEL (yes/no)
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-3] Branching yes/no', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_branch;

  -- Step 1: Email
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_branch, 1, 'email', 'email', 0, 'always', 'Initial email', 'Subject', v_org_id)
  RETURNING id INTO v_step;

  -- Step 2: Condition "has email?"
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, organization_id)
  VALUES (v_seq_branch, 2, 'condition_branch', 0, 'if_has_email', v_org_id)
  RETURNING id INTO v_step_cond;

  -- Step 3a: Branche YES → email de suivi
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, parent_step_id, branch, message_template, subject_template, organization_id)
  VALUES (v_seq_branch, 3, 'email', 'email', 0, 'always', v_step_cond, 'yes', 'Yes branch email', 'Yes subject', v_org_id)
  RETURNING id INTO v_step_yes;

  -- Step 3b: Branche NO → WhatsApp
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, parent_step_id, branch, message_template, organization_id)
  VALUES (v_seq_branch, 3, 'whatsapp_message', 'whatsapp', 0, 'always', v_step_cond, 'no', 'No branch WA', v_org_id)
  RETURNING id INTO v_step_no;

  -- 3a: Candidat AVEC email → doit aller vers branche YES
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_branch, 'fake-li-account', 'fake-branch-yes', 'TEST_Branch_HasEmail', 'branch@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 3b: Candidat SANS email → doit aller vers branche NO
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_branch, 'fake-li-account', 'fake-branch-no', 'TEST_Branch_NoEmail', null, '+33699999999', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- ================================================================
  -- TEST 4: STOP CONDITIONS
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by, stop_conditions)
  VALUES ('[TEST-4] Stop on click', v_org_id, true, v_user_id, '{"on_reply": true, "on_click": true, "on_unsubscribe": true}'::jsonb)
  RETURNING id INTO v_seq_stop;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_stop, 1, 'email', 'email', 0, 'always', 'Stop test', 'Stop subject', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_stop, 2, 'email', 'email', 1, 'always', 'Should not execute', 'Should not', v_org_id);

  -- 4a: Candidat avec un click déjà enregistré → doit être stoppé
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_stop, 'fake-li-account', 'fake-stop-click', 'TEST_Stop_Clicked', 'stop@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  -- Simuler un click sur un step précédent
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, organization_id)
  VALUES (v_enroll, v_step, 0, now() - interval '1 day', 'clicked', now() - interval '1 day', v_org_id);
  -- Scheduler le step 1
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- 4b: Candidat désinscrit → doit être stoppé
  -- D'abord insérer dans suppressed_emails
  INSERT INTO suppressed_emails (email, reason) VALUES ('unsub@example.com', 'unsubscribe') ON CONFLICT (email) DO NOTHING;
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_stop, 'fake-li-account', 'fake-stop-unsub', 'TEST_Stop_Unsubscribed', 'unsub@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- ================================================================
  -- TEST 5: A/B TESTING
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-5] A/B testing', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_ab;

  -- Variant A (70% weight)
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, variant_group, variant_weight, organization_id)
  VALUES (v_seq_ab, 1, 'email', 'email', 0, 'always', 'Version A du message', 'Subject A', 'A', 70, v_org_id)
  RETURNING id INTO v_step_a;

  -- Variant B (30% weight)
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, variant_group, variant_weight, organization_id)
  VALUES (v_seq_ab, 1, 'email', 'email', 0, 'always', 'Version B du message', 'Subject B', 'B', 30, v_org_id)
  RETURNING id INTO v_step_b;

  -- Enrôler 10 candidats pour voir la distribution A/B
  FOR i IN 1..10 LOOP
    INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
    VALUES (v_seq_ab, 'fake-li-account', 'fake-ab-' || i, 'TEST_AB_' || i, 'ab' || i || '@example.com', 'active', v_org_id, v_user_id)
    RETURNING id INTO v_enroll;
    -- Schedule with step_a (the scheduler will pick the right variant)
    INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
    VALUES (v_enroll, v_step_a, 1, now(), 'scheduled', v_org_id);
  END LOOP;

  -- ================================================================
  -- TEST 6: MULTICANAL (Email → WhatsApp → LinkedIn)
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-6] Multichannel', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_multichannel;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_multichannel, 1, 'email', 'email', 0, 'always', 'Email first', 'Subject', v_org_id);
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_multichannel, 2, 'whatsapp_message', 'whatsapp', 1, 'always', 'Then WhatsApp', v_org_id);
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq_multichannel, 3, 'message', 2, 'always', 'Then LinkedIn', v_org_id);

  -- Candidat avec les 3 canaux dispo
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq_multichannel, 'fake-li-account', 'fake-multi-all', 'TEST_Multi_AllChannels', 'multi@example.com', '+33611111111', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  SELECT v_enroll, id, 1, now(), 'scheduled', v_org_id FROM sequence_steps WHERE sequence_id = v_seq_multichannel AND step_order = 1;

  -- ================================================================
  -- TEST 7: CONDITIONS ENRICHIES
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-7] Conditions enrichies', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_conditions;

  -- Test if_bounced: candidat avec un step bouncé
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_conditions, 1, 'email', 'email', 0, 'if_bounced', 'Should skip if bounced', 'Bounce test', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_conditions, 'fake-li-account', 'fake-cond-bounced', 'TEST_Cond_Bounced', 'bounced@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  -- Simuler un bounce précédent
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, organization_id)
  VALUES (v_enroll, v_step, 0, now() - interval '2 days', 'bounced', now() - interval '2 days', v_org_id);
  -- Scheduler le step conditionnel
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- Test if_score_above: candidat avec score
  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, condition_value, message_template, subject_template, organization_id)
  VALUES (v_seq_conditions, 2, 'email', 'email', 0, 'if_score_above', '70', 'High score email', 'Score test', v_org_id)
  RETURNING id INTO v_step2;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_conditions, 'fake-li-account', 'fake-cond-scored', 'TEST_Cond_ScoreAbove', 'scored@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  -- Insérer un score pour ce candidat
  INSERT INTO job_candidate_status (job_id, candidate_id, status, score, created_by)
  VALUES ('test-job', 'fake-cond-scored', 'scored', 85, v_user_id)
  ON CONFLICT (job_id, candidate_id, created_by) DO UPDATE SET score = 85;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step2, 2, now(), 'scheduled', v_org_id);

  -- ================================================================
  -- TEST 8: STUCK RECOVERY (sending > 5 min)
  -- ================================================================
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[TEST-8] Stuck recovery', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq_edge;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq_edge, 1, 'email', 'email', 0, 'always', 'Stuck test', 'Stuck', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_edge, 'fake-li-account', 'fake-stuck', 'TEST_Stuck_Recovery', 'stuck@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  -- Simuler une execution bloquée en 'sending' depuis 10 min
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, updated_at, organization_id)
  VALUES (v_enroll, v_step, 1, now() - interval '10 minutes', 'sending', now() - interval '10 minutes', v_org_id);

  -- ================================================================
  -- TEST 9: ENROLLMENT PAUSED (doit être ignoré)
  -- ================================================================
  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq_edge, 'fake-li-account', 'fake-paused', 'TEST_Paused_Enrollment', 'paused@example.com', 'paused', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- ================================================================
  -- RÉSUMÉ
  -- ================================================================
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'TESTS CRÉÉS ! Total : ~20 enrollments, ~25 executions';
  RAISE NOTICE '';
  RAISE NOTICE 'Appelle process-sequences avec force=true';
  RAISE NOTICE 'puis vérifie les résultats avec les requêtes ci-dessous';
  RAISE NOTICE '============================================';

END $$;
