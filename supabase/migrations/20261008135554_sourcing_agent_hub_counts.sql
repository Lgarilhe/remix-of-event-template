-- Aggregate personal hub metadata in PostgreSQL instead of downloading profile
-- history. Existing agent/candidate RLS still applies to every caller.
CREATE FUNCTION public.sourcing_agent_hub_counts(
  p_organization_id uuid,
  p_agent_ids uuid[]
) RETURNS TABLE (
  agent_id uuid,
  context_key text,
  total bigint,
  discovered bigint,
  evaluated bigint,
  proposed bigint,
  reviewed bigint,
  fit bigint,
  rejected bigint,
  skipped bigint,
  uncertain bigint,
  last_activity_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE actor_id uuid := (SELECT auth.uid());
BEGIN
  IF p_organization_id IS NULL OR p_agent_ids IS NULL
    OR cardinality(p_agent_ids) > 100 OR array_position(p_agent_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Supply an organization and at most 100 non-null agent IDs'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT a.id,
    a.context_snapshot->>'context_key',
    count(c.id),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state='discovered'),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state IN ('scored','proposed','reviewed')),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state='proposed'),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state='reviewed'),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state='reviewed' AND c.decision='fit'),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state='reviewed' AND c.decision='reject'),
    count(c.id) FILTER (WHERE c.context_key=a.context_snapshot->>'context_key' AND c.state='skipped'),
    count(c.id) FILTER (WHERE c.state='discovered' AND (c.credits_reserved>0
      OR c.provenance ? 'scoring_started_at' OR c.provenance ? 'reservation_recovered')),
    greatest(a.updated_at, a.last_run_at, max(c.updated_at))
  FROM public.sourcing_agents a
  LEFT JOIN public.sourcing_agent_candidates c ON c.agent_id=a.id
    AND c.organization_id=p_organization_id AND c.project_id=a.project_id AND c.created_by=actor_id
  WHERE a.organization_id=p_organization_id AND a.created_by=actor_id AND a.id=ANY(p_agent_ids)
  GROUP BY a.id
  ORDER BY a.id;
END;
$$;

REVOKE ALL ON FUNCTION public.sourcing_agent_hub_counts(uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sourcing_agent_hub_counts(uuid,uuid[]) TO authenticated;
COMMENT ON FUNCTION public.sourcing_agent_hub_counts(uuid,uuid[]) IS
  'Read-only personal sourcing counts, at most 100 agents per organization; invoker RLS, saved-context counters and all-context uncertainty.';
