-- Run on an isolated local database, inside BEGIN / ROLLBACK. No providers.
-- Two organizations, an owner/member pair, and private conversation sources.
DO $$
DECLARE
  a uuid := '86111111-1111-4111-8111-111111111111';
  b uuid := '86222222-2222-4222-8222-222222222222';
  c uuid := '86333333-3333-4333-8333-333333333333';
  org_a uuid := '86aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_c uuid := '86cccccc-cccc-4ccc-8ccc-cccccccccccc';
  project_a uuid := '86aaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  project_b uuid := '86aaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  project_c uuid := '86ccccc1-cccc-4ccc-8ccc-cccccccccccc';
  conv_a uuid; msg_a uuid; proposal_a uuid; proposal_user uuid; proposal_org uuid;
  proposal_b uuid; proposal_other uuid; proposal_expired uuid;
  memory_a public.agent_memories; memory_user public.agent_memories; memory_org public.agent_memories;
  replay public.agent_memories; decision public.agent_memory_proposals;
  context jsonb; n integer; hint text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (a, 'a@agent-memory.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
    (b, 'b@agent-memory.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
    (c, 'c@agent-memory.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org_a, 'Memory agency', 'agent-memory-audit-a', a, 'agency'),
    (org_c, 'Memory enterprise', 'agent-memory-audit-c', c, 'enterprise');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, b, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (a, org_a), (b, org_a), (c, org_c)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, organization_id, created_by, name)
  VALUES (project_a, org_a, a, 'Mission A'), (project_b, org_a, b, 'Mission B'), (project_c, org_c, c, 'Mission C');
  INSERT INTO public.agent_conversations (organization_id, created_by, project_id, status)
    VALUES (org_a, a, project_a, 'calibrating') RETURNING id INTO conv_a;
  INSERT INTO public.agent_messages (conversation_id, role, content)
    VALUES (conv_a, 'user', 'Private candidate calibration detail') RETURNING id INTO msg_a;

  IF has_table_privilege('anon', 'public.agent_memories', 'SELECT')
    OR has_table_privilege('anon', 'public.agent_memory_proposals', 'SELECT')
    OR has_function_privilege('anon', 'public.approve_agent_memory(uuid,integer,text,text,text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '[1] anonymous memory access is granted';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('approve_agent_memory', 'dismiss_agent_memory_proposal',
    'archive_agent_memory', 'get_agent_memory_context') AND prosecdef) THEN
    RAISE EXCEPTION '[2] a memory RPC bypasses RLS';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, source_conversation_id,
    source_message_id, source_excerpt, content, scope, kind)
  VALUES (org_a, a, project_a, conv_a, msg_a, 'Private source', 'Prioritize SaaS product construction', 'project', 'preference')
    RETURNING id INTO proposal_a;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope)
    VALUES (org_a, a, 'Show concise explanations', 'user') RETURNING id INTO proposal_user;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope, kind)
    VALUES (org_a, a, 'Never treat unknown experience as a refusal', 'organization', 'constraint') RETURNING id INTO proposal_org;
  BEGIN
    INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, source_conversation_id,
      source_message_id, source_excerpt, content, scope)
    VALUES (org_a, a, project_a, conv_a, msg_a, 'Private source', 'Repeated citation from concurrent extraction', 'project');
    RAISE EXCEPTION '[36] duplicate citation created a second card';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, effects)
      VALUES (org_a, a, 'Unsupported scoring effect', ARRAY['scoring']);
    RAISE EXCEPTION '[37] proposal accepted an unimplemented scoring effect';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.approve_agent_memory(proposal_org, 1, NULL, NULL, NULL, ARRAY['scoring']);
    RAISE EXCEPTION '[38] approval accepted an unimplemented scoring effect';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT * INTO decision FROM public.agent_memory_proposals WHERE id = proposal_org;
  IF decision.status <> 'proposed' OR decision.version <> 1 THEN
    RAISE EXCEPTION '[38] failed approval partially changed the proposal';
  END IF;

  context := public.get_agent_memory_context(org_a, project_a);
  IF jsonb_array_length(context->'memories') <> 0 THEN RAISE EXCEPTION '[3] an unconfirmed proposal was applied'; END IF;
  BEGIN
    PERFORM public.approve_agent_memory(proposal_a, 99);
    RAISE EXCEPTION '[4] stale proposal version was approved';
  EXCEPTION WHEN serialization_failure THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_VERSION_CONFLICT' THEN RAISE EXCEPTION '[4] unexpected stale-version hint %', hint; END IF;
  END;
  memory_a := public.approve_agent_memory(proposal_a, 1);
  replay := public.approve_agent_memory(proposal_a, 1);
  IF memory_a.id <> replay.id OR replay.version <> 1 THEN RAISE EXCEPTION '[5] confirmation is not idempotent'; END IF;
  SELECT count(*) INTO n FROM public.agent_memories WHERE proposal_id = proposal_a;
  IF n <> 1 THEN RAISE EXCEPTION '[6] duplicate confirmed memories'; END IF;
  BEGIN
    PERFORM public.approve_agent_memory(proposal_a, 1, 'Different content');
    RAISE EXCEPTION '[7] a conflicting retry silently rewrote a confirmed memory';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  memory_user := public.approve_agent_memory(proposal_user, 1);
  memory_org := public.approve_agent_memory(proposal_org, 1);
  BEGIN
    PERFORM public.archive_agent_memory(memory_a.id, 99);
    RAISE EXCEPTION '[35] stale confirmed-memory version was archived';
  EXCEPTION WHEN serialization_failure THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_VERSION_CONFLICT' THEN RAISE EXCEPTION '[35] unexpected archive-conflict hint %', hint; END IF;
  END;
  context := public.get_agent_memory_context(org_a, project_a);
  IF jsonb_array_length(context->'memories') <> 3
    OR (context->>'can_manage_organization')::boolean IS DISTINCT FROM true
    OR (context->>'can_manage_project')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[8] incorrect owner context %', context;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') m
    WHERE m ? 'source_excerpt' OR m ? 'source_conversation_id' OR m ? 'source_message_id') THEN
    RAISE EXCEPTION '[9] private source was shared through context';
  END IF;
  BEGIN
    UPDATE public.agent_memories SET content = 'Silent rewrite' WHERE id = memory_a.id;
    RAISE EXCEPTION '[10] confirmed content can be silently changed';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_IMMUTABLE' THEN RAISE EXCEPTION '[10] unexpected immutable hint %', hint; END IF;
  END;
  BEGIN
    INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, content, scope)
      VALUES (org_a, a, project_c, 'Foreign project', 'project');
    RAISE EXCEPTION '[11] cross-organization project accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- B shares the confirmed project rule, never A's raw proposal or personal rule.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.agent_memory_proposals WHERE created_by = a;
  IF n <> 0 THEN RAISE EXCEPTION '[12] member reads another user proposal/source'; END IF;
  SELECT count(*) INTO n FROM public.agent_memories WHERE id = memory_user.id;
  IF n <> 0 THEN RAISE EXCEPTION '[13] member reads another user personal memory'; END IF;
  context := public.get_agent_memory_context(org_a, project_a);
  IF jsonb_array_length(context->'memories') <> 2
    OR (context->>'can_manage_organization')::boolean IS DISTINCT FROM false
    OR (context->>'can_manage_project')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '[14] member context/permissions incorrect %', context;
  END IF;
  BEGIN
    PERFORM public.archive_agent_memory(memory_a.id, 1);
    RAISE EXCEPTION '[15] member archives another member project memory';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, source_conversation_id, content)
      VALUES (org_a, b, project_a, conv_a, 'Injected source');
    RAISE EXCEPTION '[16] another user private conversation accepted as source';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, project_id, content, scope)
    VALUES (org_a, b, project_b, 'Mission B context', 'project') RETURNING id INTO proposal_b;
  replay := public.approve_agent_memory(proposal_b, 1);
  IF replay.project_id <> project_b THEN RAISE EXCEPTION '[17] own-project approval failed'; END IF;
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope)
    VALUES (org_a, b, 'An organization suggestion', 'organization') RETURNING id INTO proposal_other;
  BEGIN
    PERFORM public.approve_agent_memory(proposal_other, 1);
    RAISE EXCEPTION '[18] member promotes a rule to organization';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'MEMORY_SCOPE_FORBIDDEN' THEN RAISE EXCEPTION '[18] unexpected promotion hint %', hint; END IF;
  END;
  BEGIN
    PERFORM public.approve_agent_memory(proposal_other, 1, NULL, 'project');
    RAISE EXCEPTION '[19] project scope without an identity was approved';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  decision := public.dismiss_agent_memory_proposal(proposal_other, 1);
  IF decision.status <> 'dismissed' OR decision.version <> 2 THEN RAISE EXCEPTION '[20] dismiss transition incorrect'; END IF;
  decision := public.dismiss_agent_memory_proposal(proposal_other, 1);
  IF decision.version <> 2 THEN RAISE EXCEPTION '[21] repeated dismissal changes version'; END IF;
  BEGIN
    UPDATE public.agent_memory_proposals SET organization_id = org_c WHERE id = proposal_other;
    RAISE EXCEPTION '[22] a proposal can change tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Expired rules are visible in audit rows but are never applied in context.
  INSERT INTO public.agent_memory_proposals (organization_id, created_by, content, scope)
    VALUES (org_a, b, 'Expired preference', 'user') RETURNING id INTO proposal_expired;
  UPDATE public.agent_memory_proposals SET status = 'approved' WHERE id = proposal_expired;
  INSERT INTO public.agent_memories (organization_id, proposal_id, created_by, confirmed_by, scope,
    owner_user_id, content, kind, expires_at)
  VALUES (org_a, proposal_expired, b, b, 'user', b, 'Expired preference', 'preference', now() - interval '1 day');
  context := public.get_agent_memory_context(org_a, project_b);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'memories') m WHERE m->>'content' = 'Expired preference') THEN
    RAISE EXCEPTION '[23] expired memory applied';
  END IF;

  -- Administrator role does not reveal private conversation/personal memories.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.organization_members SET role = 'admin' WHERE organization_id = org_a AND user_id = b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.agent_memories WHERE id = memory_user.id;
  IF n <> 0 THEN RAISE EXCEPTION '[24] administrator reads another user personal memory'; END IF;
  SELECT count(*) INTO n FROM public.agent_memory_proposals WHERE created_by = a;
  IF n <> 0 THEN RAISE EXCEPTION '[25] administrator reads another user proposal'; END IF;
  BEGIN
    PERFORM public.approve_agent_memory(proposal_user, 2);
    RAISE EXCEPTION '[26] administrator decides another user private proposal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  replay := public.archive_agent_memory(memory_a.id, 1);
  IF replay.status <> 'archived' OR replay.version <> 2 THEN RAISE EXCEPTION '[27] authorized archive failed'; END IF;
  replay := public.archive_agent_memory(memory_a.id, 1);
  IF replay.version <> 2 THEN RAISE EXCEPTION '[28] archive retry is not idempotent'; END IF;
  context := public.get_agent_memory_context(org_a, project_a);
  IF jsonb_array_length(context->'memories') <> 1 THEN RAISE EXCEPTION '[29] archived memory remains applied'; END IF;

  -- Collaborator isolation uses the same project identities, never client names.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.organization_members SET role = 'collaborator' WHERE organization_id = org_a AND user_id = b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_agent_memory_context(org_a, project_a);
    RAISE EXCEPTION '[30] collaborator reads another member project context';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  context := public.get_agent_memory_context(org_a, project_b);
  IF (context->>'can_manage_project')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '[31] collaborator cannot manage own project'; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.agent_memories WHERE organization_id = org_a;
  IF n <> 0 THEN RAISE EXCEPTION '[32] other organization reads memories'; END IF;
  SELECT count(*) INTO n FROM public.agent_memory_proposals WHERE organization_id = org_a;
  IF n <> 0 THEN RAISE EXCEPTION '[33] other organization reads proposals'; END IF;
  BEGIN
    PERFORM public.get_agent_memory_context(org_a, project_a);
    RAISE EXCEPTION '[34] other organization reads context through RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'agent_memory_audit: 38 checks passed';
END $$;
