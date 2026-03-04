
UPDATE sequence_step_executions 
SET status = 'scheduled', scheduled_at = now()
WHERE status = 'waiting_event' 
  AND enrollment_id IN (
    SELECT id FROM sequence_enrollments 
    WHERE connection_status = 'connected' 
      AND network_distance = 'FIRST_DEGREE'
      AND status = 'active'
  );
