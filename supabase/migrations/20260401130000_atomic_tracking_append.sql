-- ============================================================================
-- RPC: Atomic tracking_data append for email tracking
-- Prevents lost-update race condition when 2 concurrent opens/clicks hit
-- the same execution simultaneously.
-- ============================================================================

CREATE OR REPLACE FUNCTION atomic_tracking_append(
  p_execution_id uuid,
  p_field text,       -- 'opened_at' or 'clicked_at'
  p_value text,       -- timestamp ISO string to append
  p_new_status text   -- new status (only applied if higher priority)
) RETURNS void AS $$
BEGIN
  UPDATE sequence_step_executions
  SET
    tracking_data = jsonb_set(
      COALESCE(tracking_data, '{}'::jsonb),
      ARRAY[p_field],
      COALESCE(tracking_data->p_field, '[]'::jsonb) || to_jsonb(p_value)
    ),
    status = CASE
      WHEN p_new_status IS NOT NULL
        AND p_new_status != status
        AND (
          (p_new_status = 'opened' AND status = 'sent')
          OR (p_new_status = 'clicked' AND status IN ('sent', 'opened'))
          OR (p_new_status = 'replied' AND status IN ('sent', 'opened', 'clicked'))
        )
      THEN p_new_status
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_execution_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
