-- Isolated local database only, wrapped in BEGIN / ROLLBACK. No providers.
-- Server reads retain originating actor permissions without a browser session.
-- Browser denial is checked through ACLs: this pinned local Postgres image
-- crashes inside supautils when invoking a function refused to the SQL role.
DO $$
DECLARE
  a uuid := '88111111-1111-4111-8111-111111111111';
  b uuid := '88222222-2222-4222-8222-222222222222';
  c uuid := '88333333-3333-4333-8333-333333333333';
  org_a uuid := '88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_c uuid := '88cccccc-cccc-4ccc-8ccc-cccccccccccc';
  project_a uuid := '88aaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  project_b uuid := '88aaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  project_c uuid := '88ccccc1-cccc-4ccc-8ccc-cccccccccccc';
  conv uuid; msg uuid; proposal uuid; pending uuid;
  org_memory public.agent_memories; project_memory public.agent_memories;
  other_project_memory public.agent_memories; private_memory public.agent_memories;
  archived_memory public.agent_memories; m public.agent_memories;
  context jsonb; hint text; n integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (a, 'a@sourcing-memory.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
    (b, 'b@sourcing-memory.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
    (c, 'c@sourcing-memory.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org_a, 'Sourcing memory agency', 'agent-sourcing-memory-audit-a', a, 'agency'),
    (org_c, 'Sourcing memory enterprise', 'agent-sourcing-memory-audit-c', c, 'enterprise');
  INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (org_a, b, 'collaborator'), (org_c, a, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (a, org_a), (b, org_a), (c, org_c)
    ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, organization_id, created_by, name)
  VALUES (project_a, org_a, a, 'Mission A'), (project_b, org_a, b, 'Mission B'), (project_c, org_c, c, 'Mission C');
  INSERT INTO public.agent_conversations (organization_id, created_by, project_id, status)
    VALUES (org_a, a, project_a, 'calibrating') RETURNING id INTO conv;
  INSERT INTO public.agent_messages (conversation_id, role, content)
    VALUES (conv, 'user', 'Private team discussion and candidate details') RETURNING id INTO msg;

  IF has_function_privilege('anon', 'public.get_agent_sourcing_memory_context(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.get_agent_sourcing_memory_context(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[1] a browser role can execute the server memory RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_agent_sourcing_memory_context(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[2] service role cannot execute the server memory RPC';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.get_agent_sourcing_memory_context(uuid,uuid,uuid)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION '[3] server memory RPC is SECURITY DEFINER';
  END IF;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, project_a, a);
    RAISE EXCEPTION '[4] a non-service SQL role can call the server memory RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_FORBIDDEN' THEN RAISE EXCEPTION '[4] unexpected role-guard hint %', hint; END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, source_conversation_id,
    source_message_id, source_excerpt, content, scope, kind, effects)
  VALUES (org_a, a, project_a, conv, msg, 'Private team discussion', 'Do not source employees of the client',
    'organization', 'constraint', ARRAY['search', 'scoring']) RETURNING id INTO proposal;
  org_memory := public.approve_agent_memory(proposal, 1);
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, content, scope, kind, effects)
    VALUES (org_a, a, project_a, 'Prioritize experience with SaaS products', 'project', 'preference', ARRAY['search'])
    RETURNING id INTO proposal;
  project_memory := public.approve_agent_memory(proposal, 1);
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, content, scope, effects)
    VALUES (org_a, a, project_b, 'Verify the transferable skills for mission B', 'project', ARRAY['scoring'])
    RETURNING id INTO proposal;
  other_project_memory := public.approve_agent_memory(proposal, 1);
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope, effects)
    VALUES (org_a, a, 'Present my replies in paragraphs', 'user', ARRAY['presentation']) RETURNING id INTO proposal;
  private_memory := public.approve_agent_memory(proposal, 1);
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope, effects)
    VALUES (org_a, a, 'Use concise assistant replies', 'organization', ARRAY['assistant']) RETURNING id INTO proposal;
  m := public.approve_agent_memory(proposal, 1);
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, content, scope, effects)
    VALUES (org_a, a, project_a, 'Pending mission decision', 'project', ARRAY['scoring']) RETURNING id INTO pending;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope, effects)
    VALUES (org_a, a, 'Expired recruiting decision', 'organization', ARRAY['scoring']) RETURNING id INTO proposal;
  UPDATE public.agent_memory_proposals SET status = 'approved' WHERE id = proposal;
  INSERT INTO public.agent_memories (organization_id, proposal_id, created_by, confirmed_by, content, scope, kind, effects, expires_at)
    VALUES (org_a, proposal, a, a, 'Expired recruiting decision', 'organization', 'preference', ARRAY['scoring'], now() - interval '1 day');
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope, effects)
    VALUES (org_a, a, 'Archived recruiting decision', 'organization', ARRAY['search']) RETURNING id INTO proposal;
  m := public.approve_agent_memory(proposal, 1);
  archived_memory := public.archive_agent_memory(m.id, m.version);
  -- Browser organization switches must not retarget a running background job.
  UPDATE public.profiles SET active_organization_id = org_c WHERE user_id = a;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;

  context := public.get_agent_sourcing_memory_context(org_a, project_a, a);
  IF jsonb_array_length(context->'memories') <> 2 THEN RAISE EXCEPTION '[5] wrong matching-mission server context %', context; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry WHERE entry->>'id' = org_memory.id::text)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry WHERE entry->>'id' = project_memory.id::text) THEN
    RAISE EXCEPTION '[6] organization or matching mission rule missing';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry WHERE entry->>'id' = other_project_memory.id::text) THEN
    RAISE EXCEPTION '[7] a different mission decision entered the server context';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry WHERE entry->>'id' = private_memory.id::text) THEN
    RAISE EXCEPTION '[8] private presentation memory entered recruiting context';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry
    WHERE (SELECT count(*) FROM jsonb_object_keys(entry)) <> 7
      OR NOT entry ?& ARRAY['id', 'version', 'content', 'scope', 'project_id', 'kind', 'effects']) THEN
    RAISE EXCEPTION '[9] server context exposes private source or unrelated metadata';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry
    WHERE entry->>'content' IN ('Expired recruiting decision', 'Archived recruiting decision', 'Pending mission decision', 'Use concise assistant replies')) THEN
    RAISE EXCEPTION '[10] inactive, pending, expired or unrelated-effect memory entered context';
  END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE user_id = a AND active_organization_id = org_c;
  IF n <> 1 THEN RAISE EXCEPTION '[11] background organization-switch fixture is invalid'; END IF;
  context := public.get_agent_sourcing_memory_context(org_a, NULL, a);
  IF jsonb_array_length(context->'memories') <> 1 OR context->'memories'->0->>'id' <> org_memory.id::text THEN
    RAISE EXCEPTION '[12] organization-only call included mission-specific rules';
  END IF;
  context := public.get_agent_sourcing_memory_context(org_a, project_b, b);
  IF jsonb_array_length(context->'memories') <> 2
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') entry WHERE entry->>'id' = other_project_memory.id::text) THEN
    RAISE EXCEPTION '[13] collaborator cannot read own mission recruiting context';
  END IF;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, project_a, b);
    RAISE EXCEPTION '[14] collaborator reads another member mission';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_PROJECT_FORBIDDEN' THEN RAISE EXCEPTION '[14] unexpected project hint %', hint; END IF;
  END;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, project_c, a);
    RAISE EXCEPTION '[15] cross-organization project was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, project_a, c);
    RAISE EXCEPTION '[16] foreign actor can read organization memory';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_FORBIDDEN' THEN RAISE EXCEPTION '[16] unexpected actor hint %', hint; END IF;
  END;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, project_a, NULL);
    RAISE EXCEPTION '[17] server context accepted a missing actor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(NULL, project_a, a);
    RAISE EXCEPTION '[18] server context accepted a missing organization';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, '88aaaaa9-aaaa-4aaa-8aaa-aaaaaaaaaaaa', a);
    RAISE EXCEPTION '[19] server context accepted a nonexistent mission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  context := public.get_agent_sourcing_memory_context(org_c, project_c, c);
  IF jsonb_array_length(context->'memories') <> 0 THEN RAISE EXCEPTION '[20] foreign organization received recruiting rules'; END IF;
  -- Removing a job's originating actor from the organization revokes reads.
  DELETE FROM public.organization_members WHERE organization_id = org_a AND user_id = b;
  BEGIN
    PERFORM public.get_agent_sourcing_memory_context(org_a, project_b, b);
    RAISE EXCEPTION '[21] removed actor retained background recruiting access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'agent_sourcing_memory_audit: 21 checks passed';
END $$;
