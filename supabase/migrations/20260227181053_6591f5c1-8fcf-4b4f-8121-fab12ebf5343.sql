CREATE OR REPLACE FUNCTION public.acquire_sequence_lock(p_run_id text, p_ttl_minutes integer DEFAULT 10)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row_count integer := 0;
BEGIN
  UPDATE sequence_processing_lock
  SET locked_at = now(),
      locked_by = p_run_id
  WHERE id = 'process'
    AND (
      locked_at IS NULL
      OR locked_at < now() - (p_ttl_minutes || ' minutes')::interval
    );

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$function$;