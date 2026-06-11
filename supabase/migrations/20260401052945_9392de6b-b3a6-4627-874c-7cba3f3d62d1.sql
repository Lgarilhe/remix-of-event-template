
-- Cleanup previous part 2 tests
DELETE FROM sequence_email_tracking WHERE execution_id IN (
  SELECT x.id FROM sequence_step_executions x
  JOIN sequence_enrollments e ON x.enrollment_id = e.id WHERE e.profile_name LIKE 'T2_%'
);
DELETE FROM sequence_step_executions WHERE enrollment_id IN (
  SELECT id FROM sequence_enrollments WHERE profile_name LIKE 'T2_%'
);
DELETE FROM sequence_enrollments WHERE profile_name LIKE 'T2_%';
DELETE FROM sequence_steps WHERE sequence_id IN (
  SELECT id FROM outreach_sequences WHERE name LIKE '[T2-%'
);
DELETE FROM outreach_sequences WHERE name LIKE '[T2-%';

-- Now run the DO block for inserts
DO $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_seq uuid;
  v_step uuid;
  v_step2 uuid;
  v_step3 uuid;
  v_step_cond uuid;
  v_step_yes uuid;
  v_step_no uuid;
  v_step_deep uuid;
  v_step_deep_yes uuid;
  v_enroll uuid;
  v_enroll2 uuid;
  v_exec uuid;
  v_tracking_id text;
BEGIN
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  SELECT user_id INTO v_user_id FROM organization_members WHERE organization_id = v_org_id LIMIT 1;

  -- Fix replayability 2026-06-11 : seed de DONNÉES DE TEST — suppose une org/un
  -- user existants. Skip propre sur base vierge (le schéma n'en dépend pas).
  IF v_org_id IS NULL OR v_user_id IS NULL THEN
    RAISE NOTICE 'Seed de test (partie 2) sauté — base vierge';
    RETURN;
  END IF;

  RAISE NOTICE '=== TEST COMPLET PARTIE 2 ===';

  -- T2-10: WEBHOOK — LinkedIn reply
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by, stop_on_company_reply)
  VALUES ('[T2-10] Webhook LinkedIn reply', v_org_id, true, v_user_id, true)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq, 1, 'message', 0, 'always', 'Hello', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq, 2, 'message', 2, 'always', 'Follow up', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, company_name, status, organization_id, created_by)
  VALUES (v_seq, 'fake-webhook-account', 'webhook-profile-001', 'T2_Webhook_Reply', 'ACME Corp', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, organization_id)
  VALUES (v_enroll, v_step, 1, now() - interval '1 day', 'sent', now() - interval '1 day', v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  SELECT v_enroll, id, 2, now() + interval '1 day', 'scheduled', v_org_id
  FROM sequence_steps WHERE sequence_id = v_seq AND step_order = 2;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, company_name, status, organization_id, created_by)
  VALUES (v_seq, 'fake-webhook-account', 'webhook-profile-002', 'T2_Webhook_CompanyStop', 'ACME Corp', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll2;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll2, v_step, 1, now() + interval '1 day', 'scheduled', v_org_id);

  -- T2-11: WEBHOOK — Invite accepted
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-11] Webhook invite accepted', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, message_template, organization_id)
  VALUES (v_seq, 1, 'connection_request', 0, 'always', null, v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, wait_for_event, message_template, organization_id)
  VALUES (v_seq, 2, 'wait_connection', 0, 'always', 'connection_accepted', null, v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, connection_status, status, organization_id, created_by)
  VALUES (v_seq, 'fake-webhook-account', 'webhook-profile-invite', 'T2_Webhook_InviteAccepted', 'pending_invite', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, organization_id)
  VALUES (v_enroll, v_step, 1, now() - interval '2 days', 'sent', now() - interval '2 days', v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  SELECT v_enroll, id, 2, now() - interval '1 day', 'waiting_event', v_org_id
  FROM sequence_steps WHERE sequence_id = v_seq AND step_order = 2;

  -- T2-12: EMAIL TRACKING
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-12] Email tracking', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq, 1, 'email', 'email', 0, 'always', 'Tracking test', 'Subject', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'tracking-profile', 'T2_Tracking_Email', 'tracking@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, channel, tracking_data, organization_id)
  VALUES (v_enroll, v_step, 1, now() - interval '1 hour', 'sent', now() - interval '1 hour', 'email', '{}'::jsonb, v_org_id)
  RETURNING id INTO v_exec;

  v_tracking_id := replace(gen_random_uuid()::text, '-', '');
  INSERT INTO sequence_email_tracking (execution_id, tracking_id)
  VALUES (v_exec, v_tracking_id);

  RAISE NOTICE 'T2-12 Tracking ID: %', v_tracking_id;

  -- T2-13: WAIT EVENT + TIMEOUT BRANCHING
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-13] Timeout branching', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, wait_for_event, timeout_days, organization_id)
  VALUES (v_seq, 1, 'wait_connection', 0, 'always', 'connection_accepted', 2, v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq, 2, 'email', 'email', 0, 'always', 'Timeout fallback email', 'Timeout', v_org_id)
  RETURNING id INTO v_step2;

  UPDATE sequence_steps SET timeout_branch_step_id = v_step2 WHERE id = v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, connection_status, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'timeout-profile', 'T2_Timeout_Branch', 'timeout@example.com', 'pending_invite', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, created_at, organization_id)
  VALUES (v_enroll, v_step, 1, now() - interval '3 days', 'waiting_event', now() - interval '3 days', v_org_id);

  -- T2-14: DUPLICATE PREVENTION
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-14] Duplicate prevention', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq, 1, 'email', 'email', 0, 'always', 'Duplicate test', 'Dup', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'dup-profile', 'T2_Duplicate_Prevention', 'dup@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- T2-15: DEEP BRANCHING
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-15] Deep branching', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, organization_id)
  VALUES (v_seq, 1, 'condition_branch', 0, 'if_has_email', v_org_id)
  RETURNING id INTO v_step_cond;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, parent_step_id, branch, organization_id)
  VALUES (v_seq, 2, 'condition_branch', 0, 'if_has_phone', v_step_cond, 'yes', v_org_id)
  RETURNING id INTO v_step_deep;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, parent_step_id, branch, message_template, subject_template, organization_id)
  VALUES (v_seq, 3, 'email', 'email', 0, 'always', v_step_deep, 'yes', 'Has email AND phone', 'Deep yes-yes', v_org_id);

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, parent_step_id, branch, message_template, organization_id)
  VALUES (v_seq, 3, 'email', 'email', 0, 'always', v_step_deep, 'no', 'Has email but no phone', v_org_id);

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, delay_days, condition_type, parent_step_id, branch, message_template, organization_id)
  VALUES (v_seq, 2, 'message', 0, 'always', v_step_cond, 'no', 'No email fallback', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, phone_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'deep-both', 'T2_Deep_EmailAndPhone', 'deep@example.com', '+33600000000', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step_cond, 1, now(), 'scheduled', v_org_id);

  -- T2-16: BUSINESS HOURS
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-16] Business hours', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, preferred_hour_start, preferred_hour_end, organization_id)
  VALUES (v_seq, 1, 'email', 'email', 0, 'always', 'Business hours test', 'BH', 9, 18, v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, user_timezone, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'bh-profile', 'T2_BusinessHours', 'bh@example.com', 'active', 'Europe/Paris', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- T2-17: ENROLLMENT LIFECYCLE
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-17] Enrollment lifecycle', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq, 1, 'email', 'email', 0, 'always', 'Lifecycle test', 'LC', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, replied_at, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'lifecycle-replied', 'T2_Lifecycle_Replied', 'replied@example.com', 'replied', now() - interval '1 hour', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'lifecycle-stopped', 'T2_Lifecycle_Stopped', 'stopped@example.com', 'stopped', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, completed_at, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'lifecycle-completed', 'T2_Lifecycle_Completed', 'completed@example.com', 'completed', now() - interval '1 hour', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- T2-18: CONDITION if_email_opened
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-18] Condition email opened', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq, 1, 'email', 'email', 0, 'if_email_opened', 'Only if opened', 'Opened?', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'cond-opened-yes', 'T2_CondOpened_Yes', 'opened@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, channel, tracking_data, organization_id)
  VALUES (v_enroll, v_step, 0, now() - interval '2 days', 'opened', now() - interval '2 days', 'email', '{"opened_at": ["2026-03-30T10:00:00Z"]}'::jsonb, v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'cond-opened-no', 'T2_CondOpened_No', 'notopened@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, channel, organization_id)
  VALUES (v_enroll, v_step, 0, now() - interval '2 days', 'sent', now() - interval '2 days', 'email', v_org_id);
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  -- T2-19: CONDITION if_unsubscribed
  INSERT INTO outreach_sequences (name, organization_id, is_active, created_by)
  VALUES ('[T2-19] Condition unsubscribed', v_org_id, true, v_user_id)
  RETURNING id INTO v_seq;

  INSERT INTO sequence_steps (sequence_id, step_order, action_type, step_channel, delay_days, condition_type, message_template, subject_template, organization_id)
  VALUES (v_seq, 1, 'email', 'email', 0, 'if_unsubscribed', 'Only if unsubscribed', 'Unsub?', v_org_id)
  RETURNING id INTO v_step;

  INSERT INTO sequence_enrollments (sequence_id, account_id, profile_id, profile_name, email_used, status, organization_id, created_by)
  VALUES (v_seq, 'fake-li', 'cond-unsub', 'T2_CondUnsub', 'unsub@example.com', 'active', v_org_id, v_user_id)
  RETURNING id INTO v_enroll;
  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll, v_step, 1, now(), 'scheduled', v_org_id);

  RAISE NOTICE 'PARTIE 2 : ~15 enrollments, ~25 executions créées';
END $$;
