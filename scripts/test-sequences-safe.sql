-- ============================================================================
-- TEST SAFE : Séquences module complet
--
-- Ce script crée des données de test SANS envoyer de vrais messages.
-- Il utilise des steps EMAIL (pas LinkedIn) → l'envoi échouera proprement
-- car aucun MICROSOFT_GRAPH_TOKEN n'est configuré.
--
-- Exécuter dans Supabase SQL Editor, puis appeler process-sequences.
-- ============================================================================

-- Variables : on récupère la première org et son owner
DO $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_seq_id uuid;
  v_step1_id uuid;
  v_step2_id uuid;  -- condition
  v_step3a_id uuid; -- branche yes
  v_step3b_id uuid; -- branche no
  v_step4_id uuid;  -- après les branches
  v_enroll1_id uuid;
  v_enroll2_id uuid;
  v_exec1_id uuid;
  v_exec2_id uuid;
BEGIN
  -- Récupérer l'org et le user
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  SELECT user_id INTO v_user_id FROM organization_members WHERE organization_id = v_org_id LIMIT 1;

  IF v_org_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Aucune organisation ou membre trouvé. Impossible de tester.';
  END IF;

  RAISE NOTICE '=== TEST SÉQUENCES ===';
  RAISE NOTICE 'Org: %', v_org_id;
  RAISE NOTICE 'User: %', v_user_id;

  -- ========================================
  -- 1. Créer la séquence de test
  -- ========================================
  INSERT INTO outreach_sequences (
    name, organization_id, is_active, created_by,
    stop_conditions, multi_sender_enabled
  ) VALUES (
    '[TEST] Séquence complète - safe',
    v_org_id, true, v_user_id,
    '{"on_reply": true, "on_click": true, "on_unsubscribe": true}'::jsonb,
    false
  ) RETURNING id INTO v_seq_id;

  RAISE NOTICE 'Séquence créée: %', v_seq_id;

  -- ========================================
  -- 2. Créer les steps (avec branching)
  -- ========================================

  -- Step 1 : Email initial (va échouer proprement car pas de Graph token)
  INSERT INTO sequence_steps (
    sequence_id, step_order, action_type, step_channel,
    delay_days, delay_hours, condition_type,
    subject_template, message_template,
    use_ai_personalization, ai_personalization_source,
    ai_personalization_prompt,
    include_unsubscribe, organization_id
  ) VALUES (
    v_seq_id, 1, 'email', 'email',
    0, 0, 'always',
    '{{first_name}} — une opportunité tech',
    'Bonjour {{first_name}},

{ai_snippet}

Seriez-vous disponible pour un échange de 15 minutes ?

{{sender_name}}',
    true, 'profile_only',
    'Mentionne brièvement une compétence pertinente du candidat',
    true, v_org_id
  ) RETURNING id INTO v_step1_id;

  -- Step 2 : Condition "A un email ?" (pour tester le branching)
  INSERT INTO sequence_steps (
    sequence_id, step_order, action_type, step_channel,
    delay_days, condition_type, organization_id
  ) VALUES (
    v_seq_id, 2, 'condition_branch', null,
    0, 'if_has_email', v_org_id
  ) RETURNING id INTO v_step2_id;

  -- Step 3a : Branche YES → Email de suivi
  INSERT INTO sequence_steps (
    sequence_id, step_order, action_type, step_channel,
    delay_days, condition_type,
    parent_step_id, branch,
    subject_template, message_template,
    organization_id
  ) VALUES (
    v_seq_id, 3, 'email', 'email',
    2, 'always',
    v_step2_id, 'yes',
    'Re: {{first_name}} — suivi',
    'Bonjour {{first_name}},

Je me permets de vous relancer. Le poste est toujours ouvert.

{{sender_name}}',
    v_org_id
  ) RETURNING id INTO v_step3a_id;

  -- Step 3b : Branche NO → skip (pas d'email)
  INSERT INTO sequence_steps (
    sequence_id, step_order, action_type, step_channel,
    delay_days, condition_type,
    parent_step_id, branch,
    message_template,
    organization_id
  ) VALUES (
    v_seq_id, 3, 'message', 'linkedin',
    1, 'always',
    v_step2_id, 'no',
    'Bonjour {{first_name}}, je vous contacte via LinkedIn car je n''ai pas votre email.',
    v_org_id
  ) RETURNING id INTO v_step3b_id;

  -- Step 4 : Email final (root level, après les branches)
  INSERT INTO sequence_steps (
    sequence_id, step_order, action_type, step_channel,
    delay_days, condition_type,
    subject_template, message_template,
    include_unsubscribe, organization_id
  ) VALUES (
    v_seq_id, 4, 'email', 'email',
    3, 'always',
    'Dernière relance — {{first_name}}',
    'Bonjour {{first_name}},

Je comprends que le timing ne convient peut-être pas. N''hésitez pas à me recontacter si votre situation évolue.

{{sender_name}}',
    true, v_org_id
  ) RETURNING id INTO v_step4_id;

  RAISE NOTICE 'Steps créés: % (email), % (condition), % (yes), % (no), % (final)',
    v_step1_id, v_step2_id, v_step3a_id, v_step3b_id, v_step4_id;

  -- ========================================
  -- 3. Enrôler 2 faux candidats
  -- ========================================

  -- Candidat 1 : AVEC email (testera le flow email + branching yes)
  INSERT INTO sequence_enrollments (
    sequence_id, account_id, profile_id,
    profile_name, profile_headline,
    email_used, company_name,
    status, current_step_order,
    user_timezone, organization_id, created_by
  ) VALUES (
    v_seq_id, 'test-account-001', 'test-profile-001',
    'Marie Dupont', 'Senior Software Engineer @ TechCorp',
    'marie.dupont.test@example.com', 'TechCorp',
    'active', 0,
    'Europe/Paris', v_org_id, v_user_id
  ) RETURNING id INTO v_enroll1_id;

  -- Candidat 2 : SANS email (testera l'auto-skip + branching no)
  INSERT INTO sequence_enrollments (
    sequence_id, account_id, profile_id,
    profile_name, profile_headline,
    email_used, company_name,
    status, current_step_order,
    user_timezone, organization_id, created_by
  ) VALUES (
    v_seq_id, 'test-account-002', 'test-profile-002',
    'Pierre Martin', 'DevOps Lead @ StartupXYZ',
    null, 'StartupXYZ',
    'active', 0,
    'Europe/Paris', v_org_id, v_user_id
  ) RETURNING id INTO v_enroll2_id;

  RAISE NOTICE 'Enrollments créés: % (avec email), % (sans email)', v_enroll1_id, v_enroll2_id;

  -- ========================================
  -- 4. Scheduler les premières exécutions (step 1 = maintenant)
  -- ========================================

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll1_id, v_step1_id, 1, now(), 'scheduled', v_org_id)
  RETURNING id INTO v_exec1_id;

  INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
  VALUES (v_enroll2_id, v_step1_id, 1, now(), 'scheduled', v_org_id)
  RETURNING id INTO v_exec2_id;

  RAISE NOTICE 'Executions schedulées: %, %', v_exec1_id, v_exec2_id;

  -- ========================================
  -- RÉSUMÉ
  -- ========================================
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'TEST PRÊT ! Appelle maintenant :';
  RAISE NOTICE '';
  RAISE NOTICE 'POST /functions/v1/process-sequences';
  RAISE NOTICE 'Body: {"action": "process", "force": true}';
  RAISE NOTICE '';
  RAISE NOTICE 'RÉSULTATS ATTENDUS :';
  RAISE NOTICE '  Marie (avec email) → Step 1 email = failed (pas de Graph token) = NORMAL';
  RAISE NOTICE '  Pierre (sans email) → Step 1 email = skipped (auto-skip, pas d''email)';
  RAISE NOTICE '';
  RAISE NOTICE 'VÉRIFICATION :';
  RAISE NOTICE '  SELECT id, enrollment_id, status, skip_reason, error_message';
  RAISE NOTICE '  FROM sequence_step_executions';
  RAISE NOTICE '  WHERE enrollment_id IN (''%'', ''%'')', v_enroll1_id, v_enroll2_id;
  RAISE NOTICE '  ORDER BY created_at;';
  RAISE NOTICE '';
  RAISE NOTICE '  SELECT * FROM ai_credit_transactions';
  RAISE NOTICE '  ORDER BY created_at DESC LIMIT 5;';
  RAISE NOTICE '============================================';

END $$;
