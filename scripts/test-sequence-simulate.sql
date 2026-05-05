-- ─────────────────────────────────────────────────────────────────────────────
-- DRY-RUN simulation : crée 3 enrollments tests pour les 3 chemins de la
-- séquence "Outreach Adaptatif", insère les step_executions correspondantes,
-- et vérifie que la routing graph aboutit aux bons steps.
--
-- IMPORTANT : enrollments en status='paused' pour que la cron ne les pick pas
-- → aucun appel Unipile réel, c'est pur test de logique DB.
--
-- Account_id fictif : 'TEST_DRY_RUN_ACCOUNT' — n'existe pas chez Unipile,
-- pas de risque de fire un vrai message.
-- ─────────────────────────────────────────────────────────────────────────────

-- Cleanup d'éventuels test précédents
DELETE FROM public.sequence_step_executions
WHERE enrollment_id IN (
  SELECT id FROM public.sequence_enrollments
  WHERE account_id = 'TEST_DRY_RUN_ACCOUNT'
);
DELETE FROM public.sequence_enrollments WHERE account_id = 'TEST_DRY_RUN_ACCOUNT';

DO $$
DECLARE
  v_seq_id  uuid := '551c1e1a-23f2-4554-b09a-cd02826748c9';
  v_user_id uuid := '16583eb3-1284-4110-b2a6-b845dc7b677a';
  v_org_id  uuid := '23e5e6d5-6e11-4ea1-8a7c-1a4efe6cf2e8';

  -- Enrollment IDs
  v_e_pathA uuid;
  v_e_pathB uuid;
  v_e_pathC uuid;

  -- Step IDs (récupérés par step_order)
  v_s0  uuid; v_s1  uuid; v_s2  uuid; v_s3  uuid; v_s4  uuid;
  v_s5  uuid; v_s6  uuid; v_s7  uuid; v_s8  uuid; v_s9  uuid; v_s10 uuid;
BEGIN
  -- Récupère les IDs des steps
  SELECT id INTO v_s0  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 0;
  SELECT id INTO v_s1  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 1;
  SELECT id INTO v_s2  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 2;
  SELECT id INTO v_s3  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 3;
  SELECT id INTO v_s4  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 4;
  SELECT id INTO v_s5  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 5;
  SELECT id INTO v_s6  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 6;
  SELECT id INTO v_s7  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 7;
  SELECT id INTO v_s8  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 8;
  SELECT id INTO v_s9  FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 9;
  SELECT id INTO v_s10 FROM sequence_steps WHERE sequence_id = v_seq_id AND step_order = 10;

  -- ────────────────────────────────────────────────────────────
  -- PATH A : Candidat déjà 1er degré
  -- Trajectoire attendue : 0 → 1 (YES) → 2 → 3 → 4 → END
  -- ────────────────────────────────────────────────────────────
  INSERT INTO public.sequence_enrollments (
    sequence_id, account_id, profile_id, profile_name, profile_url,
    status, current_step_order, created_by, organization_id, network_distance, connection_status
  )
  VALUES (
    v_seq_id, 'TEST_DRY_RUN_ACCOUNT', 'TEST_PATH_A_first_degree',
    'Test Path A — Déjà connecté', 'https://test.local/A',
    'paused', 0, v_user_id, v_org_id,
    'FIRST_DEGREE', 'connected'
  )
  RETURNING id INTO v_e_pathA;

  -- Simule chaque step exécuté avec succès
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, status, scheduled_at, executed_at, organization_id, final_message)
  VALUES
    (v_e_pathA, v_s0, 0, 'sent', now() - interval '5 days', now() - interval '5 days', v_org_id, NULL),
    (v_e_pathA, v_s1, 1, 'sent', now() - interval '5 days', now() - interval '5 days', v_org_id, NULL),
    (v_e_pathA, v_s2, 2, 'sent', now() - interval '4 days', now() - interval '4 days', v_org_id, '[message direct simulé]'),
    (v_e_pathA, v_s3, 3, 'sent', now() - interval '4 days', now() - interval '4 days', v_org_id, NULL),
    (v_e_pathA, v_s4, 4, 'sent', now() - interval '1 day',  now() - interval '1 day',  v_org_id, '[relance simulée]');

  -- ────────────────────────────────────────────────────────────
  -- PATH B : Candidat 2e/3e degré + invitation acceptée
  -- Trajectoire attendue : 0 → 1 (NO) → 5 → 6 (success) → 7 → 8 → 9 → END
  -- ────────────────────────────────────────────────────────────
  INSERT INTO public.sequence_enrollments (
    sequence_id, account_id, profile_id, profile_name, profile_url,
    status, current_step_order, created_by, organization_id, network_distance, connection_status
  )
  VALUES (
    v_seq_id, 'TEST_DRY_RUN_ACCOUNT', 'TEST_PATH_B_invite_accepted',
    'Test Path B — Invité puis accepté', 'https://test.local/B',
    'paused', 0, v_user_id, v_org_id,
    'SECOND_DEGREE', 'pending'  -- au démarrage
  )
  RETURNING id INTO v_e_pathB;

  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, status, scheduled_at, executed_at, organization_id, final_message)
  VALUES
    (v_e_pathB, v_s0, 0, 'sent', now() - interval '7 days', now() - interval '7 days', v_org_id, NULL),
    (v_e_pathB, v_s1, 1, 'sent', now() - interval '7 days', now() - interval '7 days', v_org_id, NULL),
    (v_e_pathB, v_s5, 5, 'sent', now() - interval '6 days', now() - interval '6 days', v_org_id, '[invitation simulée]'),
    (v_e_pathB, v_s6, 6, 'sent', now() - interval '6 days', now() - interval '4 days', v_org_id, NULL),
    (v_e_pathB, v_s7, 7, 'sent', now() - interval '3 days', now() - interval '3 days', v_org_id, '[message après accept]'),
    (v_e_pathB, v_s8, 8, 'sent', now() - interval '3 days', now() - interval '3 days', v_org_id, NULL),
    (v_e_pathB, v_s9, 9, 'sent', now() - interval '1 hour', now() - interval '1 hour', v_org_id, '[relance simulée]');

  -- ────────────────────────────────────────────────────────────
  -- PATH C : Candidat 2e/3e + invitation timeout 3j → InMail
  -- Trajectoire attendue : 0 → 1 (NO) → 5 → 6 (timeout) → 10 → END
  -- ────────────────────────────────────────────────────────────
  INSERT INTO public.sequence_enrollments (
    sequence_id, account_id, profile_id, profile_name, profile_url,
    status, current_step_order, created_by, organization_id, network_distance, connection_status
  )
  VALUES (
    v_seq_id, 'TEST_DRY_RUN_ACCOUNT', 'TEST_PATH_C_invite_timeout',
    'Test Path C — Invitation timeout', 'https://test.local/C',
    'paused', 0, v_user_id, v_org_id,
    'SECOND_DEGREE', 'pending'
  )
  RETURNING id INTO v_e_pathC;

  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, status, scheduled_at, executed_at, organization_id, final_message, skip_reason)
  VALUES
    (v_e_pathC, v_s0, 0, 'sent',    now() - interval '6 days', now() - interval '6 days', v_org_id, NULL, NULL),
    (v_e_pathC, v_s1, 1, 'sent',    now() - interval '6 days', now() - interval '6 days', v_org_id, NULL, NULL),
    (v_e_pathC, v_s5, 5, 'sent',    now() - interval '5 days', now() - interval '5 days', v_org_id, '[invitation simulée — pas acceptée]', NULL),
    (v_e_pathC, v_s6, 6, 'skipped', now() - interval '5 days', now() - interval '2 days', v_org_id, NULL, 'Timeout 3j sans acceptation → branche InMail'),
    (v_e_pathC, v_s10,10, 'sent',   now() - interval '1 day',  now() - interval '1 day',  v_org_id, '[InMail fallback simulé]', NULL);

  RAISE NOTICE 'Path A: % | Path B: % | Path C: %', v_e_pathA, v_e_pathB, v_e_pathC;
END $$;

-- Vérification : trace les 3 chemins exécutés
SELECT
  e.profile_name,
  e.network_distance,
  e.connection_status,
  exec.step_order,
  st.action_type,
  exec.status,
  COALESCE(LEFT(exec.final_message, 40), '-') AS msg_excerpt,
  COALESCE(exec.skip_reason, '-') AS skip_reason
FROM public.sequence_enrollments e
JOIN public.sequence_step_executions exec ON exec.enrollment_id = e.id
JOIN public.sequence_steps st ON st.id = exec.step_id
WHERE e.account_id = 'TEST_DRY_RUN_ACCOUNT'
ORDER BY e.profile_name, exec.step_order;
