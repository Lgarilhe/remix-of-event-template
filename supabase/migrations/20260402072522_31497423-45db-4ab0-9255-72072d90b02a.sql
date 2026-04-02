CREATE OR REPLACE FUNCTION public.atomic_tracking_append(
  p_execution_id uuid,
  p_field text,
  p_value text,
  p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE sequence_step_executions
  SET
    tracking_data = jsonb_set(
      COALESCE(tracking_data, '{}'::jsonb),
      ARRAY[p_field],
      (COALESCE(tracking_data->p_field, '[]'::jsonb) || to_jsonb(p_value))
    ),
    status = p_new_status
  WHERE id = p_execution_id;
END;
$$;