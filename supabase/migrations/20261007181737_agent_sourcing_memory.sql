-- Confirmed shared recruiting criteria. Personal automatic communication
-- preferences keep the closed policy/consent guard from the previous migration.
ALTER TABLE public.agent_memory_proposals DROP CONSTRAINT IF EXISTS agent_memory_proposals_effects_check;
ALTER TABLE public.agent_memory_proposals ADD CONSTRAINT agent_memory_proposals_effects_check
  CHECK (cardinality(effects) BETWEEN 1 AND 4
    AND effects <@ ARRAY['assistant', 'presentation', 'search', 'scoring']::text[]
    AND array_position(effects, NULL) IS NULL);
ALTER TABLE public.agent_memories DROP CONSTRAINT IF EXISTS agent_memories_effects_check;
ALTER TABLE public.agent_memories ADD CONSTRAINT agent_memories_effects_check
  CHECK (cardinality(effects) BETWEEN 1 AND 4
    AND effects <@ ARRAY['assistant', 'presentation', 'search', 'scoring']::text[]
    AND array_position(effects, NULL) IS NULL);

ALTER TABLE public.agent_memory_proposals DROP CONSTRAINT IF EXISTS agent_memory_proposals_recruiting_scope_check;
ALTER TABLE public.agent_memory_proposals ADD CONSTRAINT agent_memory_proposals_recruiting_scope_check
  CHECK (scope <> 'user' OR NOT (effects && ARRAY['search', 'scoring']::text[]));
ALTER TABLE public.agent_memories DROP CONSTRAINT IF EXISTS agent_memories_recruiting_scope_check;
ALTER TABLE public.agent_memories ADD CONSTRAINT agent_memories_recruiting_scope_check
  CHECK (scope <> 'user' OR NOT (effects && ARRAY['search', 'scoring']::text[]));

-- Workers cannot borrow a browser JWT. This read is callable only by a
-- verified server credential and explicitly checks the originating actor.
-- A job remains attached to its organization when the actor switches UI space.
CREATE OR REPLACE FUNCTION public.get_agent_sourcing_memory_context(
  p_organization_id uuid, p_project_id uuid, p_user_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_role text; v_project public.sourcing_projects; v_memories jsonb;
BEGIN
  IF current_user <> 'service_role' OR p_user_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Sourcing memory requires a verified server actor'
      USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  SELECT role::text INTO v_role FROM public.organization_members
    WHERE user_id = p_user_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sourcing memory actor is outside the organization'
      USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  IF p_project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM public.sourcing_projects
      WHERE id = p_project_id AND organization_id = p_organization_id;
    IF NOT FOUND OR (v_role = 'collaborator' AND v_project.created_by IS DISTINCT FROM p_user_id) THEN
      RAISE EXCEPTION 'Sourcing memory project is unavailable'
        USING ERRCODE = '42501', HINT = 'MEMORY_PROJECT_FORBIDDEN';
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'version', m.version, 'content', m.content, 'scope', m.scope,
    'project_id', m.project_id, 'kind', m.kind, 'effects', m.effects
  ) ORDER BY m.id), '[]'::jsonb)
  INTO v_memories FROM public.agent_memories m
  WHERE m.organization_id = p_organization_id AND m.status = 'active'
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND m.effects && ARRAY['search', 'scoring']::text[]
    AND (m.scope = 'organization' OR (m.scope = 'project' AND m.project_id = p_project_id));
  RETURN jsonb_build_object('memories', v_memories);
END $$;

REVOKE ALL ON FUNCTION public.get_agent_sourcing_memory_context(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_sourcing_memory_context(uuid, uuid, uuid) TO service_role;
