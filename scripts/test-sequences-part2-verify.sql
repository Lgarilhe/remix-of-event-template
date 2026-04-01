-- ============================================================================
-- VÉRIFICATION PARTIE 2
-- ============================================================================

-- VUE D'ENSEMBLE
SELECT
  e.profile_name,
  s.action_type, s.step_channel, s.condition_type, s.branch,
  s.parent_step_id IS NOT NULL as is_branch_child,
  x.step_order, x.status, x.skip_reason, x.error_message,
  x.channel, x.tracking_data, x.variant_assigned, x.retry_count
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
JOIN sequence_steps s ON x.step_id = s.id
WHERE e.profile_name LIKE 'T2_%'
ORDER BY e.profile_name, x.created_at;

-- RÉSUMÉ
SELECT
  CASE
    WHEN e.profile_name LIKE 'T2_Webhook_Reply%' THEN 'T10-Webhook-Reply'
    WHEN e.profile_name LIKE 'T2_Webhook_Company%' THEN 'T10-Company-Stop'
    WHEN e.profile_name LIKE 'T2_Webhook_Invite%' THEN 'T11-Invite-Accepted'
    WHEN e.profile_name LIKE 'T2_Tracking%' THEN 'T12-Email-Tracking'
    WHEN e.profile_name LIKE 'T2_Timeout%' THEN 'T13-Timeout'
    WHEN e.profile_name LIKE 'T2_Duplicate%' THEN 'T14-Duplicate'
    WHEN e.profile_name LIKE 'T2_Deep%' THEN 'T15-Deep-Branch'
    WHEN e.profile_name LIKE 'T2_Business%' THEN 'T16-Business-Hours'
    WHEN e.profile_name LIKE 'T2_Lifecycle%' THEN 'T17-Lifecycle'
    WHEN e.profile_name LIKE 'T2_CondOpened%' THEN 'T18-Cond-Opened'
    WHEN e.profile_name LIKE 'T2_CondUnsub%' THEN 'T19-Cond-Unsub'
    ELSE 'Other'
  END as test_group,
  x.status,
  COUNT(*) as count
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name LIKE 'T2_%'
GROUP BY 1, 2
ORDER BY 1, 2;

-- T10: WEBHOOK REPLY — enrollment doit être 'replied' après le webhook
SELECT 'T10' as test, e.profile_name, e.status as enrollment_status, e.replied_at,
  x.status as exec_status, x.skip_reason
FROM sequence_enrollments e
LEFT JOIN sequence_step_executions x ON x.enrollment_id = e.id AND x.step_order = 2
WHERE e.profile_name IN ('T2_Webhook_Reply', 'T2_Webhook_CompanyStop');

-- T11: INVITE ACCEPTED — enrollment doit avoir connection_status='connected'
SELECT 'T11' as test, e.profile_name, e.connection_status, e.network_distance
FROM sequence_enrollments e WHERE e.profile_name = 'T2_Webhook_InviteAccepted';

-- T12: EMAIL TRACKING — execution doit avoir tracking_data avec opened_at/clicked_at
SELECT 'T12' as test, e.profile_name, x.status, x.tracking_data,
  t.tracking_id, t.email_message_id
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
LEFT JOIN sequence_email_tracking t ON t.execution_id = x.id
WHERE e.profile_name = 'T2_Tracking_Email';

-- T13: TIMEOUT — step waiting_event devrait être skipped + step 2 schedulé
SELECT 'T13' as test, e.profile_name, x.step_order, x.status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'T2_Timeout_Branch'
ORDER BY x.step_order;

-- T14: DUPLICATE — seule 1 des 2 executions doit être traitée
SELECT 'T14' as test, e.profile_name, x.status, x.skip_reason, x.error_message
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'T2_Duplicate_Prevention'
ORDER BY x.created_at;

-- T15: DEEP BRANCHING — doit router vers la bonne branche profonde
SELECT 'T15' as test, e.profile_name, s.condition_type, s.branch,
  s.parent_step_id IS NOT NULL as is_child, x.step_order, x.status
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
JOIN sequence_steps s ON x.step_id = s.id
WHERE e.profile_name = 'T2_Deep_EmailAndPhone'
ORDER BY x.created_at;

-- T17: LIFECYCLE — replied/stopped/completed enrollments doivent être skippés
SELECT 'T17' as test, e.profile_name, e.status as enrollment_status,
  x.status as exec_status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name LIKE 'T2_Lifecycle_%';

-- T18: CONDITION OPENED — yes doit passer, no doit être skipped
SELECT 'T18' as test, e.profile_name, x.step_order, x.status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name LIKE 'T2_CondOpened_%' AND x.step_order = 1
ORDER BY e.profile_name;

-- T19: CONDITION UNSUBSCRIBED — doit passer (candidat est désinscrit)
SELECT 'T19' as test, e.profile_name, x.status, x.skip_reason
FROM sequence_step_executions x
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'T2_CondUnsub' AND x.step_order = 1;

-- TRACKING ID pour les tests HTTP
SELECT 'TRACKING_ID' as info, t.tracking_id, x.status, e.profile_name
FROM sequence_email_tracking t
JOIN sequence_step_executions x ON t.execution_id = x.id
JOIN sequence_enrollments e ON x.enrollment_id = e.id
WHERE e.profile_name = 'T2_Tracking_Email';
