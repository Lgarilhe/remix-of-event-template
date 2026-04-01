
-- Cancel old stuck executions for Marie Dupont
UPDATE sequence_step_executions 
SET status = 'cancelled', skip_reason = 'Ancien code, re-test'
WHERE enrollment_id = (SELECT id FROM sequence_enrollments WHERE profile_name = 'Marie Dupont')
AND status IN ('scheduled', 'cancelled');

-- Reset enrollment
UPDATE sequence_enrollments SET current_step_order = 0 WHERE profile_name = 'Marie Dupont';

-- Create fresh step 1 execution
INSERT INTO sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, organization_id)
SELECT e.id, s.id, s.step_order, now(), 'scheduled', e.organization_id
FROM sequence_enrollments e
JOIN sequence_steps s ON s.sequence_id = e.sequence_id AND s.step_order = 1 AND s.parent_step_id IS NULL
WHERE e.profile_name = 'Marie Dupont';
