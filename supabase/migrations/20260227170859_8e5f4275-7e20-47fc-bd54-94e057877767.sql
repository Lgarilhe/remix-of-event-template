
-- Atomic lock acquisition with TTL (10 min stale threshold)
CREATE OR REPLACE FUNCTION public.acquire_sequence_lock(p_run_id text, p_ttl_minutes integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locked boolean := false;
BEGIN
  -- Try to acquire the lock atomically:
  -- 1. Lock the row with FOR UPDATE SKIP LOCKED (non-blocking)
  -- 2. Only succeed if lock is free (locked_at IS NULL) or stale (older than TTL)
  UPDATE sequence_processing_lock
  SET locked_at = now(),
      locked_by = p_run_id
  WHERE id = 'process'
    AND (
      locked_at IS NULL
      OR locked_at < now() - (p_ttl_minutes || ' minutes')::interval
    );

  GET DIAGNOSTICS v_locked = ROW_COUNT;
  RETURN v_locked > 0;
END;
$$;

-- Atomic lock release
CREATE OR REPLACE FUNCTION public.release_sequence_lock(p_run_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE sequence_processing_lock
  SET locked_at = NULL,
      locked_by = NULL
  WHERE id = 'process'
    AND locked_by = p_run_id;
END;
$$;
