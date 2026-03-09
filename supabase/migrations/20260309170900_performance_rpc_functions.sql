-- Performance optimization: server-side aggregation RPCs
-- Replaces client-side fetching of all rows just to count statuses

-- =============================================================================
-- 1. get_project_stats: Count statuses for a single project (replaces useProjectStats)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_project_stats(p_project_id UUID)
RETURNS TABLE(
  total BIGINT,
  scored BIGINT,
  messaged BIGINT,
  shortlisted BIGINT,
  dismissed BIGINT,
  untreated BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE jcs.score IS NOT NULL)::BIGINT AS scored,
    COUNT(*) FILTER (WHERE jcs.status = 'messaged')::BIGINT AS messaged,
    COUNT(*) FILTER (WHERE jcs.status = 'shortlisted')::BIGINT AS shortlisted,
    COUNT(*) FILTER (WHERE jcs.status = 'dismissed')::BIGINT AS dismissed,
    COUNT(*) FILTER (WHERE jcs.status = 'untreated')::BIGINT AS untreated
  FROM job_candidate_status jcs
  WHERE jcs.project_id = p_project_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- 2. get_multiple_project_stats: Batch stats for multiple projects (replaces useMultipleProjectStats)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_multiple_project_stats(p_project_ids UUID[])
RETURNS TABLE(
  project_id UUID,
  total BIGINT,
  scored BIGINT,
  messaged BIGINT,
  shortlisted BIGINT,
  dismissed BIGINT,
  untreated BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jcs.project_id,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE jcs.score IS NOT NULL)::BIGINT AS scored,
    COUNT(*) FILTER (WHERE jcs.status = 'messaged')::BIGINT AS messaged,
    COUNT(*) FILTER (WHERE jcs.status = 'shortlisted')::BIGINT AS shortlisted,
    COUNT(*) FILTER (WHERE jcs.status = 'dismissed')::BIGINT AS dismissed,
    COUNT(*) FILTER (WHERE jcs.status = 'untreated')::BIGINT AS untreated
  FROM job_candidate_status jcs
  WHERE jcs.project_id = ANY(p_project_ids)
  GROUP BY jcs.project_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- 3. get_outreach_acceptance_stats: Aggregate enrollment stats (replaces useOutreachAcceptanceStats)
-- =============================================================================
CREATE OR REPLACE FUNCTION get_outreach_acceptance_stats()
RETURNS TABLE(
  user_id UUID,
  total_enrolled BIGINT,
  connected BIGINT,
  not_connected BIGINT,
  pending BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.created_by AS user_id,
    COUNT(*)::BIGINT AS total_enrolled,
    COUNT(*) FILTER (WHERE LOWER(se.connection_status) IN ('connected', 'accepted'))::BIGINT AS connected,
    COUNT(*) FILTER (WHERE LOWER(se.connection_status) IN ('not_connected', 'declined', 'withdrawn'))::BIGINT AS not_connected,
    COUNT(*) FILTER (WHERE LOWER(COALESCE(se.connection_status, '')) NOT IN ('connected', 'accepted', 'not_connected', 'declined', 'withdrawn'))::BIGINT AS pending
  FROM sequence_enrollments se
  GROUP BY se.created_by;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
