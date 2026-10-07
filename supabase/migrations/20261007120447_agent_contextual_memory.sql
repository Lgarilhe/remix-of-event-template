-- Validated contextual memory. Proposals retain private conversation sources;
-- only the confirmed rule is shared. No LinkedIn, ATS or scoring writes occur.
-- Scope identities are real: organization, sourcing project, individual user.

CREATE TABLE IF NOT EXISTS public.agent_memory_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  source_conversation_id uuid REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  source_excerpt text CHECK (source_excerpt IS NULL OR char_length(source_excerpt) <= 4000),
  legacy_insight_id uuid UNIQUE REFERENCES public.user_insights(id) ON DELETE SET NULL,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  scope text NOT NULL DEFAULT 'user' CHECK (scope IN ('organization', 'project', 'user')),
  kind text NOT NULL DEFAULT 'preference' CHECK (kind IN ('constraint', 'preference', 'method', 'context')),
  effects text[] NOT NULL DEFAULT ARRAY['assistant']::text[]
    CHECK (cardinality(effects) BETWEEN 1 AND 2
      AND effects <@ ARRAY['assistant', 'presentation']::text[]
      AND array_position(effects, NULL) IS NULL),
  confidence numeric(3, 2) CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'dismissed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope <> 'project' OR project_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proposal_id uuid UNIQUE REFERENCES public.agent_memory_proposals(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL CHECK (scope IN ('organization', 'project', 'user')),
  project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  kind text NOT NULL CHECK (kind IN ('constraint', 'preference', 'method', 'context')),
  effects text[] NOT NULL DEFAULT ARRAY['assistant']::text[]
    CHECK (cardinality(effects) BETWEEN 1 AND 2
      AND effects <@ ARRAY['assistant', 'presentation']::text[]
      AND array_position(effects, NULL) IS NULL),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'organization' AND project_id IS NULL AND owner_user_id IS NULL)
    OR (scope = 'project' AND project_id IS NOT NULL AND owner_user_id IS NULL)
    OR (scope = 'user' AND project_id IS NULL AND owner_user_id IS NOT NULL AND owner_user_id = created_by))
);

-- A proposal cannot announce effects that this version does not implement.
-- Explicit names also keep local replay compatible with an earlier draft.
ALTER TABLE public.agent_memory_proposals DROP CONSTRAINT IF EXISTS agent_memory_proposals_effects_check;
ALTER TABLE public.agent_memory_proposals ADD CONSTRAINT agent_memory_proposals_effects_check
  CHECK (cardinality(effects) BETWEEN 1 AND 2
    AND effects <@ ARRAY['assistant', 'presentation']::text[] AND array_position(effects, NULL) IS NULL);
ALTER TABLE public.agent_memories DROP CONSTRAINT IF EXISTS agent_memories_effects_check;
ALTER TABLE public.agent_memories ADD CONSTRAINT agent_memories_effects_check
  CHECK (cardinality(effects) BETWEEN 1 AND 2
    AND effects <@ ARRAY['assistant', 'presentation']::text[] AND array_position(effects, NULL) IS NULL);

-- Extraction may run concurrently. The citation fingerprint makes the
-- private deduplication atomic without indexing up to 4,000 characters.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_proposals_source_unique
  ON public.agent_memory_proposals(organization_id, created_by, source_message_id, md5(source_excerpt))
  WHERE source_message_id IS NOT NULL AND source_excerpt IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_memory_proposals_org_id
  ON public.agent_memory_proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_proposals_author_status
  ON public.agent_memory_proposals(organization_id, created_by, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_proposals_project_id
  ON public.agent_memory_proposals(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_memories_org_id
  ON public.agent_memories(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_active_scope
  ON public.agent_memories(organization_id, scope, project_id, owner_user_id)
  WHERE status = 'active';

ALTER TABLE public.agent_memory_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_memory_proposals_service_access ON public.agent_memory_proposals;
CREATE POLICY agent_memory_proposals_service_access ON public.agent_memory_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS agent_memories_service_access ON public.agent_memories;
CREATE POLICY agent_memories_service_access ON public.agent_memories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Only identities that the caller can access in the active organization.
-- A collaborator can work on their own project, not another member's project.
CREATE OR REPLACE FUNCTION public.agent_memory_can_read_project(p_organization_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p_organization_id = public.get_user_org_id(auth.uid())
    AND public.is_org_member(auth.uid(), p_organization_id)
    AND EXISTS (
      SELECT 1 FROM public.sourcing_projects p
      WHERE p.id = p_project_id AND p.organization_id = p_organization_id
        AND (public.get_org_role(auth.uid(), p_organization_id) <> 'collaborator'
          OR p.created_by = auth.uid())
    )
$$;

CREATE OR REPLACE FUNCTION public.agent_memory_can_manage(
  p_organization_id uuid, p_scope text, p_project_id uuid, p_owner_user_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p_organization_id = public.get_user_org_id(auth.uid())
    AND public.is_org_member(auth.uid(), p_organization_id)
    AND CASE p_scope
      WHEN 'user' THEN p_owner_user_id = auth.uid()
      WHEN 'organization' THEN public.get_org_role(auth.uid(), p_organization_id) IN ('owner', 'admin')
      WHEN 'project' THEN public.agent_memory_can_read_project(p_organization_id, p_project_id)
        AND (public.get_org_role(auth.uid(), p_organization_id) IN ('owner', 'admin')
          OR EXISTS (SELECT 1 FROM public.sourcing_projects p
            WHERE p.id = p_project_id AND p.organization_id = p_organization_id AND p.created_by = auth.uid()))
      ELSE false
    END
$$;

REVOKE ALL ON FUNCTION public.agent_memory_can_read_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agent_memory_can_manage(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_memory_can_read_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_memory_can_manage(uuid, text, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS agent_memory_proposals_author_select ON public.agent_memory_proposals;
CREATE POLICY agent_memory_proposals_author_select ON public.agent_memory_proposals
  FOR SELECT TO authenticated USING (
    created_by = (SELECT auth.uid())
    AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND (project_id IS NULL OR public.agent_memory_can_read_project(organization_id, project_id))
  );
DROP POLICY IF EXISTS agent_memory_proposals_author_insert ON public.agent_memory_proposals;
CREATE POLICY agent_memory_proposals_author_insert ON public.agent_memory_proposals
  FOR INSERT TO authenticated WITH CHECK (
    created_by = (SELECT auth.uid())
    AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND (project_id IS NULL OR public.agent_memory_can_read_project(organization_id, project_id))
  );
DROP POLICY IF EXISTS agent_memory_proposals_author_update ON public.agent_memory_proposals;
CREATE POLICY agent_memory_proposals_author_update ON public.agent_memory_proposals
  FOR UPDATE TO authenticated USING (
    created_by = (SELECT auth.uid())
    AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND (project_id IS NULL OR public.agent_memory_can_read_project(organization_id, project_id))
  ) WITH CHECK (
    created_by = (SELECT auth.uid())
    AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND (project_id IS NULL OR public.agent_memory_can_read_project(organization_id, project_id))
  );

DROP POLICY IF EXISTS agent_memories_context_select ON public.agent_memories;
CREATE POLICY agent_memories_context_select ON public.agent_memories
  FOR SELECT TO authenticated USING (
    organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND (scope = 'organization'
      OR (scope = 'user' AND owner_user_id = (SELECT auth.uid()))
      OR (scope = 'project' AND public.agent_memory_can_read_project(organization_id, project_id)))
  );
DROP POLICY IF EXISTS agent_memories_validated_insert ON public.agent_memories;
CREATE POLICY agent_memories_validated_insert ON public.agent_memories
  FOR INSERT TO authenticated WITH CHECK (
    created_by = (SELECT auth.uid()) AND confirmed_by = (SELECT auth.uid())
    AND public.agent_memory_can_manage(organization_id, scope, project_id, owner_user_id)
    AND EXISTS (SELECT 1 FROM public.agent_memory_proposals p
      WHERE p.id = agent_memories.proposal_id AND p.organization_id = agent_memories.organization_id
        AND p.created_by = (SELECT auth.uid()) AND p.status = 'approved')
  );
DROP POLICY IF EXISTS agent_memories_manager_update ON public.agent_memories;
CREATE POLICY agent_memories_manager_update ON public.agent_memories
  FOR UPDATE TO authenticated
  USING (public.agent_memory_can_manage(organization_id, scope, project_id, owner_user_id))
  WITH CHECK (public.agent_memory_can_manage(organization_id, scope, project_id, owner_user_id));

-- Old automatic insights become private proposals. They never become active
-- merely because the old extraction pipeline observed a pattern.
INSERT INTO public.agent_memory_proposals (
  organization_id, created_by, project_id, source_conversation_id, source_excerpt,
  legacy_insight_id, content, scope, kind, effects, confidence, created_at
)
SELECT i.organization_id, i.user_id,
  CASE WHEN c.organization_id = i.organization_id AND c.created_by = i.user_id
    AND (c.project_id IS NULL OR (p.id IS NOT NULL
      AND (public.get_org_role(i.user_id, i.organization_id) <> 'collaborator' OR p.created_by = i.user_id)))
    THEN c.project_id ELSE NULL END,
  CASE WHEN c.organization_id = i.organization_id AND c.created_by = i.user_id
    AND (c.project_id IS NULL OR (p.id IS NOT NULL
      AND (public.get_org_role(i.user_id, i.organization_id) <> 'collaborator' OR p.created_by = i.user_id)))
    THEN c.id ELSE NULL END,
  left(i.content, 4000), i.id, left(btrim(i.content), 2000), 'user',
  CASE WHEN i.insight_type IN ('pattern', 'expertise', 'context') THEN 'context' ELSE 'preference' END,
  ARRAY['assistant']::text[], i.confidence, i.created_at
FROM public.user_insights i
LEFT JOIN public.agent_conversations c ON c.id = i.source_conversation_id
LEFT JOIN public.sourcing_projects p ON p.id = c.project_id AND p.organization_id = i.organization_id
WHERE btrim(i.content) <> ''
  AND EXISTS (SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = i.organization_id AND m.user_id = i.user_id)
ON CONFLICT (legacy_insight_id) DO NOTHING;

-- The trigger checks tenant and source identities even for backend inserts.
-- Source IDs are immutable; FK-driven deletion may only clear the source link.
CREATE OR REPLACE FUNCTION public.agent_memory_proposal_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_project public.sourcing_projects; v_conversation public.agent_conversations;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','version','updated_at','source_conversation_id','source_message_id','legacy_insight_id'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','version','updated_at','source_conversation_id','source_message_id','legacy_insight_id'])
      OR ((NEW.source_conversation_id IS DISTINCT FROM OLD.source_conversation_id
           OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
           OR NEW.legacy_insight_id IS DISTINCT FROM OLD.legacy_insight_id)
        AND NOT (pg_trigger_depth() > 1
          AND (NEW.source_conversation_id IS NULL OR NEW.source_conversation_id = OLD.source_conversation_id)
          AND (NEW.source_message_id IS NULL OR NEW.source_message_id = OLD.source_message_id)
          AND (NEW.legacy_insight_id IS NULL OR NEW.legacy_insight_id = OLD.legacy_insight_id))) THEN
      RAISE EXCEPTION 'Memory proposal identities and original source are immutable'
        USING ERRCODE = '42501', HINT = 'MEMORY_PROPOSAL_IMMUTABLE';
    END IF;
    IF OLD.status <> NEW.status AND (OLD.status <> 'proposed' OR NEW.status NOT IN ('approved','dismissed')) THEN
      RAISE EXCEPTION 'Invalid memory proposal transition' USING ERRCODE = '22023', HINT = 'MEMORY_INVALID_TRANSITION';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.status <> 'proposed' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'New memory must be proposed for confirmation' USING ERRCODE = '22023', HINT = 'MEMORY_CONFIRMATION_REQUIRED';
  END IF;
  IF NOT public.is_org_member(NEW.created_by, NEW.organization_id) THEN
    RAISE EXCEPTION 'Memory author is outside the organization' USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT * INTO v_project FROM public.sourcing_projects
      WHERE id = NEW.project_id AND organization_id = NEW.organization_id;
    IF NOT FOUND OR (public.get_org_role(NEW.created_by, NEW.organization_id) = 'collaborator'
      AND v_project.created_by <> NEW.created_by) THEN
      RAISE EXCEPTION 'Memory project is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_PROJECT_FORBIDDEN';
    END IF;
  END IF;
  IF NEW.source_conversation_id IS NOT NULL THEN
    SELECT * INTO v_conversation FROM public.agent_conversations
      WHERE id = NEW.source_conversation_id AND organization_id = NEW.organization_id AND created_by = NEW.created_by;
    IF NOT FOUND OR (v_conversation.project_id IS NOT NULL AND v_conversation.project_id IS DISTINCT FROM NEW.project_id) THEN
      RAISE EXCEPTION 'Memory conversation is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_SOURCE_FORBIDDEN';
    END IF;
  END IF;
  IF NEW.source_message_id IS NOT NULL AND (NEW.source_conversation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.agent_messages m
      WHERE m.id = NEW.source_message_id AND m.conversation_id = NEW.source_conversation_id
  )) THEN
    RAISE EXCEPTION 'Memory message does not belong to its conversation' USING ERRCODE = '42501', HINT = 'MEMORY_SOURCE_FORBIDDEN';
  END IF;
  IF NEW.legacy_insight_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_insights i WHERE i.id = NEW.legacy_insight_id
      AND i.organization_id = NEW.organization_id AND i.user_id = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'Legacy memory source is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_SOURCE_FORBIDDEN';
  END IF;
  NEW.content := btrim(NEW.content);
  NEW.effects := ARRAY(SELECT DISTINCT e FROM unnest(NEW.effects) e ORDER BY e);
  NEW.created_at := now(); NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.agent_memory_validated_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_proposal public.agent_memory_proposals;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','version','updated_at','proposal_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','version','updated_at','proposal_id'])
       OR (NEW.proposal_id IS DISTINCT FROM OLD.proposal_id AND NOT (pg_trigger_depth() > 1 AND NEW.proposal_id IS NULL)) THEN
      RAISE EXCEPTION 'Confirmed memory content and scope cannot be silently rewritten'
        USING ERRCODE = '42501', HINT = 'MEMORY_IMMUTABLE';
    END IF;
    IF OLD.status <> NEW.status AND (OLD.status <> 'active' OR NEW.status <> 'archived') THEN
      RAISE EXCEPTION 'Invalid confirmed memory transition' USING ERRCODE = '22023', HINT = 'MEMORY_INVALID_TRANSITION';
    END IF;
    NEW.version := OLD.version + 1; NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.agent_memory_can_manage(NEW.organization_id, NEW.scope, NEW.project_id, NEW.owner_user_id) THEN
    RAISE EXCEPTION 'Memory scope requires an authorized confirmation' USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  SELECT * INTO v_proposal FROM public.agent_memory_proposals
    WHERE id = NEW.proposal_id AND organization_id = NEW.organization_id AND created_by = auth.uid() AND status = 'approved';
  IF NOT FOUND OR NEW.created_by <> auth.uid() OR NEW.confirmed_by <> auth.uid()
    OR (NEW.scope = 'project' AND NEW.project_id IS DISTINCT FROM v_proposal.project_id)
    OR (NEW.scope = 'user' AND NEW.owner_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Memory proposal confirmation is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_PROPOSAL_FORBIDDEN';
  END IF;
  IF NEW.status <> 'active' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'Invalid initial memory status' USING ERRCODE = '22023', HINT = 'MEMORY_INVALID_TRANSITION';
  END IF;
  NEW.content := btrim(NEW.content);
  NEW.effects := ARRAY(SELECT DISTINCT e FROM unnest(NEW.effects) e ORDER BY e);
  NEW.confirmed_at := now(); NEW.created_at := now(); NEW.updated_at := now();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.agent_memory_proposal_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_memory_validated_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS agent_memory_proposals_guard ON public.agent_memory_proposals;
CREATE TRIGGER agent_memory_proposals_guard BEFORE INSERT OR UPDATE ON public.agent_memory_proposals
  FOR EACH ROW EXECUTE FUNCTION public.agent_memory_proposal_guard();
DROP TRIGGER IF EXISTS agent_memories_guard ON public.agent_memories;
CREATE TRIGGER agent_memories_guard BEFORE INSERT OR UPDATE ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.agent_memory_validated_guard();

CREATE OR REPLACE FUNCTION public.approve_agent_memory(
  p_proposal_id uuid, p_expected_version integer,
  p_content text DEFAULT NULL, p_scope text DEFAULT NULL,
  p_kind text DEFAULT NULL, p_effects text[] DEFAULT NULL
)
RETURNS public.agent_memories LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.agent_memory_proposals; m public.agent_memories;
  v_content text; v_scope text; v_kind text; v_effects text[]; v_project uuid; v_owner uuid;
BEGIN
  SELECT * INTO p FROM public.agent_memory_proposals
    WHERE id = p_proposal_id AND created_by = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Memory proposal is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_PROPOSAL_FORBIDDEN';
  END IF;
  v_content := btrim(coalesce(p_content, p.content));
  v_scope := coalesce(p_scope, p.scope); v_kind := coalesce(p_kind, p.kind);
  v_effects := ARRAY(SELECT DISTINCT e FROM unnest(coalesce(p_effects, p.effects)) e ORDER BY e);
  v_project := CASE WHEN v_scope = 'project' THEN p.project_id ELSE NULL END;
  v_owner := CASE WHEN v_scope = 'user' THEN auth.uid() ELSE NULL END;
  IF NOT coalesce(public.agent_memory_can_manage(p.organization_id, v_scope, v_project, v_owner), false) THEN
    RAISE EXCEPTION 'Memory scope requires permission' USING ERRCODE = '42501', HINT = 'MEMORY_SCOPE_FORBIDDEN';
  END IF;
  IF p.status = 'approved' THEN
    SELECT * INTO m FROM public.agent_memories WHERE proposal_id = p.id;
    IF FOUND AND m.content = v_content AND m.scope = v_scope AND m.kind = v_kind AND m.effects = v_effects
      AND p_expected_version IN (p.version, p.version - 1) THEN RETURN m; END IF;
    RAISE EXCEPTION 'Memory proposal was already decided' USING ERRCODE = '40001', HINT = 'MEMORY_VERSION_CONFLICT';
  END IF;
  IF p.status <> 'proposed' OR p.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Memory proposal changed; refresh before deciding' USING ERRCODE = '40001', HINT = 'MEMORY_VERSION_CONFLICT';
  END IF;
  UPDATE public.agent_memory_proposals SET status = 'approved' WHERE id = p.id;
  INSERT INTO public.agent_memories (
    organization_id, proposal_id, created_by, confirmed_by, scope, project_id, owner_user_id, content, kind, effects
  ) VALUES (p.organization_id, p.id, auth.uid(), auth.uid(), v_scope, v_project, v_owner, v_content, v_kind, v_effects)
  RETURNING * INTO m;
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.dismiss_agent_memory_proposal(p_proposal_id uuid, p_expected_version integer)
RETURNS public.agent_memory_proposals LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.agent_memory_proposals;
BEGIN
  SELECT * INTO p FROM public.agent_memory_proposals
    WHERE id = p_proposal_id AND created_by = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Memory proposal is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_PROPOSAL_FORBIDDEN';
  END IF;
  IF p.status = 'dismissed' AND p_expected_version IN (p.version, p.version - 1) THEN RETURN p; END IF;
  IF p.status <> 'proposed' OR p.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Memory proposal changed; refresh before deciding' USING ERRCODE = '40001', HINT = 'MEMORY_VERSION_CONFLICT';
  END IF;
  UPDATE public.agent_memory_proposals SET status = 'dismissed' WHERE id = p.id RETURNING * INTO p;
  RETURN p;
END $$;

CREATE OR REPLACE FUNCTION public.archive_agent_memory(p_memory_id uuid, p_expected_version integer)
RETURNS public.agent_memories LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE m public.agent_memories;
BEGIN
  SELECT * INTO m FROM public.agent_memories WHERE id = p_memory_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(public.agent_memory_can_manage(m.organization_id, m.scope, m.project_id, m.owner_user_id), false) THEN
    RAISE EXCEPTION 'Memory is unavailable for modification' USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  IF m.status = 'archived' AND p_expected_version IN (m.version, m.version - 1) THEN RETURN m; END IF;
  IF m.status <> 'active' OR m.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Memory changed; refresh before deciding' USING ERRCODE = '40001', HINT = 'MEMORY_VERSION_CONFLICT';
  END IF;
  UPDATE public.agent_memories SET status = 'archived' WHERE id = m.id RETURNING * INTO m;
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.get_agent_memory_context(p_organization_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_memories jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS DISTINCT FROM public.get_user_org_id(auth.uid())
    OR NOT public.is_org_member(auth.uid(), p_organization_id) THEN
    RAISE EXCEPTION 'Memory organization is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  IF p_project_id IS NOT NULL AND NOT coalesce(public.agent_memory_can_read_project(p_organization_id, p_project_id), false) THEN
    RAISE EXCEPTION 'Memory project is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_PROJECT_FORBIDDEN';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY
    CASE m.scope WHEN 'organization' THEN 0 WHEN 'project' THEN 1 ELSE 2 END,
    CASE m.kind WHEN 'constraint' THEN 0 ELSE 1 END, m.confirmed_at DESC, m.id), '[]'::jsonb)
  INTO v_memories FROM public.agent_memories m
  WHERE m.organization_id = p_organization_id AND m.status = 'active'
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND (m.scope = 'organization' OR (m.scope = 'project' AND m.project_id = p_project_id)
      OR (m.scope = 'user' AND m.owner_user_id = auth.uid()));
  RETURN jsonb_build_object('memories', v_memories,
    'can_manage_organization', coalesce(public.agent_memory_can_manage(p_organization_id, 'organization', NULL, NULL), false),
    'can_manage_project', coalesce(public.agent_memory_can_manage(p_organization_id, 'project', p_project_id, NULL), false));
END $$;

REVOKE ALL ON TABLE public.agent_memory_proposals, public.agent_memories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_memory_proposals, public.agent_memories TO authenticated;
GRANT ALL ON public.agent_memory_proposals, public.agent_memories TO service_role;
REVOKE ALL ON FUNCTION public.approve_agent_memory(uuid, integer, text, text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_agent_memory_proposal(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_agent_memory(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agent_memory_context(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_agent_memory(uuid, integer, text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_agent_memory_proposal(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_agent_memory(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_memory_context(uuid, uuid) TO authenticated;
