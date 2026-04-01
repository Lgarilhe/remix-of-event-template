-- ============================================================================
-- VÉRIFICATION DES TESTS — Exécuter APRÈS process-sequences
-- ============================================================================

-- 1. VUE D'ENSEMBLE : tous les résultats
SELECT
  e.profile_name,
  s.action_type,
  s.step_channel,
  s.condition_type,
  s.variant_group,
  x.step_order,
  x.status,
  x.skip_reason,
  x.error_message,
  x.channel,
  x.ai_snippet IS NOT NULL as has_ai_snippet,
  x.variant_assigned,
  x.executed_at
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
JOIN sequence_steps s ON x.step_id = s.id
WHERE e.profile_name LIKE 'TEST_%'
ORDER BY e.profile_name, x.created_at;

-- 2. RÉSUMÉ PAR TEST
SELECT
  CASE
    WHEN e.profile_name LIKE 'TEST_Linear%' THEN 'T1-Linear'
    WHEN e.profile_name LIKE 'TEST_Skip%' THEN 'T2-AutoSkip'
    WHEN e.profile_name LIKE 'TEST_Branch%' THEN 'T3-Branch'
    WHEN e.profile_name LIKE 'TEST_Stop%' THEN 'T4-StopCond'
    WHEN e.profile_name LIKE 'TEST_AB%' THEN 'T5-ABTest'
    WHEN e.profile_name LIKE 'TEST_Multi%' THEN 'T6-Multi'
    WHEN e.profile_name LIKE 'TEST_Cond%' THEN 'T7-Conditions'
    WHEN e.profile_name LIKE 'TEST_Stuck%' THEN 'T8-Stuck'
    WHEN e.profile_name LIKE 'TEST_Paused%' THEN 'T9-Paused'
    ELSE 'Other'
  END as test_group,
  x.status,
  COUNT(*) as count
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name LIKE 'TEST_%'
GROUP BY 1, 2
ORDER BY 1, 2;

-- 3. VÉRIFICATIONS SPÉCIFIQUES

-- T1: Linéaire → step 1 doit être failed (fake account_id rejeté par Unipile)
SELECT 'T1-Linear' as test, profile_name, x.status, x.error_message
FROM sequence_step_executions x JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Linear_Marie' AND x.step_order = 1;

-- T2: Auto-skip → NoEmailNoPhone step 1 = skipped
SELECT 'T2-Skip-NoEmail' as test, profile_name, x.status, x.skip_reason
FROM sequence_step_executions x JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Skip_NoEmailNoPhone' AND x.step_order = 1;

-- T2: Auto-skip → HasEmailNoPhone step 2 (WA) = skipped
SELECT 'T2-Skip-NoPhone' as test, profile_name, x.status, x.skip_reason, x.step_order
FROM sequence_step_executions x JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Skip_HasEmailNoPhone'
ORDER BY x.step_order;

-- T3: Branching → HasEmail enrollment devrait avoir un step schedulé vers branche YES
SELECT 'T3-Branch' as test, e.profile_name, s.branch, s.parent_step_id IS NOT NULL as is_branch_step, x.status
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
JOIN sequence_steps s ON x.step_id = s.id
WHERE e.profile_name LIKE 'TEST_Branch%'
ORDER BY e.profile_name, x.created_at;

-- T4: Stop conditions → Clicked et Unsubscribed doivent être completed
SELECT 'T4-Stop' as test, e.profile_name, e.status as enrollment_status, x.status as exec_status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name LIKE 'TEST_Stop%'
ORDER BY e.profile_name, x.created_at;

-- T5: A/B → distribution des variantes
SELECT 'T5-AB' as test, x.variant_assigned, COUNT(*) as count
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name LIKE 'TEST_AB_%'
GROUP BY x.variant_assigned;

-- T7: Conditions → if_bounced doit être true (bounced step exists)
SELECT 'T7-Bounced' as test, e.profile_name, x.status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Cond_Bounced' AND x.step_order = 1;

-- T7: Conditions → if_score_above doit être true (score 85 > threshold 70)
SELECT 'T7-Score' as test, e.profile_name, x.status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Cond_ScoreAbove' AND x.step_order = 2;

-- T8: Stuck recovery → doit être reschedulé ou failed
SELECT 'T8-Stuck' as test, e.profile_name, x.status, x.error_message, x.retry_count
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Stuck_Recovery';

-- T9: Paused → doit être skipped (enrollment inactive)
SELECT 'T9-Paused' as test, e.profile_name, e.status as enrollment_status, x.status as exec_status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'TEST_Paused_Enrollment';

-- 4. CRÉDITS IA (si des steps AI ont été exécutés)
SELECT ai_action, model_id, tokens_input, tokens_output, description, created_at
FROM ai_credit_transactions
WHERE description LIKE '%Sequence%' OR description LIKE '%equence%'
ORDER BY created_at DESC LIMIT 10;

-- 5. CLEANUP (optionnel — décommenter pour supprimer les données de test)
-- DELETE FROM sequence_step_executions WHERE enrollment_id IN (SELECT id FROM sequence_enrollments WHERE profile_name LIKE 'TEST_%');
-- DELETE FROM sequence_enrollments WHERE profile_name LIKE 'TEST_%';
-- DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM outreach_sequences WHERE name LIKE '[TEST%');
-- DELETE FROM outreach_sequences WHERE name LIKE '[TEST%';
-- DELETE FROM job_candidate_status WHERE candidate_id = 'fake-cond-scored';
-- DELETE FROM suppressed_emails WHERE email = 'unsub@example.com';
