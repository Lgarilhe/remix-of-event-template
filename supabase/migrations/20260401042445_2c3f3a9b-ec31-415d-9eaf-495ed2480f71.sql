
UPDATE sequence_step_executions 
SET scheduled_at = now()
WHERE enrollment_id = (SELECT id FROM sequence_enrollments WHERE profile_name = 'Marie Dupont')
AND status = 'scheduled';
