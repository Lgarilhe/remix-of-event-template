-- Isolated database only. All fixtures roll back; no providers or paid calls.
BEGIN;
DO $audit$
DECLARE
  author uuid := '98111111-1111-4111-8111-111111111111';
  administrator uuid := '98222222-2222-4222-8222-222222222222';
  collaborator uuid := '98333333-3333-4333-8333-333333333333';
  member_actor uuid := '98444444-4444-4444-8444-444444444444';
  outsider uuid := '98555555-5555-4555-8555-555555555555';
  org_a uuid := '98aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := '98bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  main_mission uuid := '98aaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_mission uuid := '98aaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  collab_mission uuid := '98aaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  forbidden_mission uuid := '98aaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  shared_mission uuid := '98aaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  draft_mission uuid := '98aaaaa6-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  own_b_mission uuid := '98bbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  foreign_mission uuid := '98bbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  main_agent uuid := '98a00001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_agent uuid := '98a00002-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  collab_agent uuid := '98a00003-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  forbidden_agent uuid := '98a00004-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  shared_agent uuid := '98a00005-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  draft_agent uuid := '98a00006-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  own_b_agent uuid := '98b00001-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  foreign_agent uuid := '98b00002-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  fn oid := 'public.sourcing_agent_hub_counts(uuid,uuid[])'::regprocedure;
  ids uuid[]; counts record; payload jsonb; before_agent jsonb; before_candidates jsonb;
  n integer; visible integer;
BEGIN
  IF (SELECT prosecdef OR provolatile<>'s' OR
      ARRAY(SELECT replace(config,' ','') FROM unnest(proconfig) config)<>ARRAY['search_path=pg_catalog,public']
    FROM pg_proc WHERE oid=fn)
    OR has_function_privilege('anon',fn,'EXECUTE')
    OR has_function_privilege('service_role',fn,'EXECUTE')
    OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) acl
      WHERE p.oid=fn AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION '[ACL] Hub counts must be stable invoker, fixed path, authenticated only';
  END IF;

  PERFORM set_config('request.jwt.claims','',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO auth.users(id,email,aud,role,instance_id,raw_user_meta_data) VALUES
    (author,'author@hub-counts.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (administrator,'admin@hub-counts.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (collaborator,'collaborator@hub-counts.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (member_actor,'member@hub-counts.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (outsider,'outsider@hub-counts.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}');
  INSERT INTO public.organizations(id,name,slug,created_by,org_type) VALUES
    (org_a,'Hub counts agency','hub-counts-audit-agency',author,'agency'),
    (org_b,'Hub counts enterprise','hub-counts-audit-enterprise',outsider,'enterprise');
  INSERT INTO public.organization_members(organization_id,user_id,role) VALUES
    (org_a,administrator,'admin'),(org_a,collaborator,'collaborator'),
    (org_a,member_actor,'member'),(org_b,author,'member');
  INSERT INTO public.profiles(user_id,active_organization_id) VALUES
    (author,org_a),(administrator,org_a),(collaborator,org_a),(member_actor,org_a),(outsider,org_b)
    ON CONFLICT(user_id) DO UPDATE SET active_organization_id=EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects(id,organization_id,created_by,name) VALUES
    (main_mission,org_a,author,'Personal mission'),(admin_mission,org_a,administrator,'Admin mission'),
    (collab_mission,org_a,collaborator,'Own collaborator mission'),
    (forbidden_mission,org_a,author,'Not the collaborator mission'),
    (shared_mission,org_a,author,'Shared team mission'),(draft_mission,org_a,author,'Draft mission'),
    (own_b_mission,org_b,author,'Other organization personal mission'),
    (foreign_mission,org_b,outsider,'Foreign mission');

  SET LOCAL ROLE service_role;
  INSERT INTO public.sourcing_agents(id,organization_id,project_id,created_by,context_snapshot,updated_at,last_run_at,credits_reserved) VALUES
    (main_agent,org_a,main_mission,author,'{"context_key":"current","private_brief":"PRIVATE_BRIEF"}','2020-01-01T09:00:00Z','2020-01-01T08:00:00Z',3),
    (admin_agent,org_a,admin_mission,administrator,'{}','2020-01-01T09:00:00Z',NULL,0),
    (collab_agent,org_a,collab_mission,collaborator,'{}','2020-01-01T09:00:00Z',NULL,0),
    (forbidden_agent,org_a,forbidden_mission,collaborator,'{}','2020-01-01T09:00:00Z',NULL,0),
    (shared_agent,org_a,shared_mission,member_actor,'{}','2020-01-01T09:00:00Z',NULL,0),
    (draft_agent,org_a,draft_mission,author,'{}','2020-01-01T09:00:00Z',NULL,0),
    (own_b_agent,org_b,own_b_mission,author,'{}','2020-01-01T09:00:00Z',NULL,0),
    (foreign_agent,org_b,foreign_mission,outsider,'{}','2020-01-01T09:00:00Z',NULL,0);
  INSERT INTO public.sourcing_agent_candidates(agent_id,organization_id,project_id,created_by,
    person_key,candidate_id,context_key,state,decision,reason,credits_reserved,provenance,profile,result,score,updated_at)
  SELECT main_agent,org_a,main_mission,author,v.person_key,v.person_key,v.context_key,v.state,v.decision,
    CASE WHEN v.state='reviewed' THEN 'Reasoned review' END,v.reserved,v.provenance,
    '{"name":"PRIVATE_PROFILE"}'::jsonb,'{"summary":"PRIVATE_SCORE"}'::jsonb,
    CASE WHEN v.state IN ('scored','proposed','reviewed') THEN 80 END,v.updated_at::timestamptz
  FROM (VALUES
    ('discovered','current','discovered',NULL::text,0,'{}'::jsonb,'2020-01-01T10:00:00Z'),
    ('reserved','current','discovered',NULL,3,'{}','2020-01-01T10:00:00Z'),
    ('started','current','discovered',NULL,0,'{"scoring_started_at":"2020-01-01T10:00:00Z"}','2020-01-01T10:00:00Z'),
    ('scored','current','scored',NULL,0,'{}','2020-01-01T10:00:00Z'),
    ('proposed','current','proposed',NULL,0,'{}','2020-01-01T10:00:00Z'),
    ('fit','current','reviewed','fit',0,'{}','2020-01-01T10:00:00Z'),
    ('reject','current','reviewed','reject',0,'{}','2020-01-01T10:00:00Z'),
    ('skipped','current','skipped',NULL,0,'{}','2020-01-01T10:00:00Z'),
    ('old-proposed','old','proposed',NULL,0,'{}','2020-01-01T10:00:00Z'),
    ('old-recovered','old','discovered',NULL,0,'{"reservation_recovered":"ESTIMATED_AFTER_LEASE"}','2020-01-01T11:00:00Z'),
    ('old-null-marker','old','discovered',NULL,0,'{"reservation_recovered":null}','2020-01-01T12:00:00Z'),
    ('old-fit','old','reviewed','fit',0,'{}','2020-01-01T10:00:00Z')
  ) v(person_key,context_key,state,decision,reserved,provenance,updated_at);
  SELECT to_jsonb(a) INTO before_agent FROM public.sourcing_agents a WHERE id=main_agent;
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) INTO before_candidates FROM public.sourcing_agent_candidates c WHERE agent_id=main_agent;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',author::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',author,'role','authenticated')::text,true);
  SELECT * INTO counts FROM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent]);
  IF counts.agent_id IS DISTINCT FROM main_agent OR counts.context_key IS DISTINCT FROM 'current'
    OR counts.total<>12 OR counts.discovered<>3 OR counts.evaluated<>4 OR counts.proposed<>1
    OR counts.reviewed<>2 OR counts.fit<>1 OR counts.rejected<>1 OR counts.skipped<>1 OR counts.uncertain<>4
    OR counts.last_activity_at IS DISTINCT FROM '2020-01-01T12:00:00Z'::timestamptz THEN
    RAISE EXCEPTION '[Counts] Current-context counts or durable old uncertainty incorrect';
  END IF;
  payload:=to_jsonb(counts);
  IF payload::text LIKE '%PRIVATE_%' OR payload ?| ARRAY['profile','result','provenance','context_snapshot','created_by'] THEN
    RAISE EXCEPTION '[Privacy] Hub RPC exposed a profile, brief, or actor payload';
  END IF;
  SELECT * INTO counts FROM public.sourcing_agent_hub_counts(org_a,ARRAY[draft_agent]);
  IF counts.agent_id IS DISTINCT FROM draft_agent OR counts.context_key IS NOT NULL OR counts.total<>0
    OR counts.discovered<>0 OR counts.evaluated<>0 OR counts.proposed<>0 OR counts.reviewed<>0
    OR counts.fit<>0 OR counts.rejected<>0 OR counts.skipped<>0 OR counts.uncertain<>0
    OR counts.last_activity_at IS DISTINCT FROM '2020-01-01T09:00:00Z'::timestamptz THEN
    RAISE EXCEPTION '[Empty] A visible draft without candidates needs a real zero-count row';
  END IF;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,
    ARRAY[main_agent,draft_agent,admin_agent,collab_agent,own_b_agent,foreign_agent]);
  IF n<>2 THEN RAISE EXCEPTION '[Scope] Another actor or organization was included'; END IF;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_b,ARRAY[main_agent,own_b_agent,foreign_agent]);
  SELECT count(*) INTO visible FROM public.sourcing_agents WHERE organization_id=org_b AND created_by=author AND id=own_b_agent;
  IF n<>visible THEN RAISE EXCEPTION '[Scope] Organization parameter bypassed invoker RLS'; END IF;
  SET LOCAL ROLE service_role;
  UPDATE public.profiles SET active_organization_id=org_b WHERE user_id=author;
  -- Separate HTTP requests get fresh transaction-local org caches. This audit
  -- deliberately switches twice inside one transaction, so clear that cache.
  PERFORM set_config('app.user_org.u_'||replace(author::text,'-','_'),'',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_b,ARRAY[main_agent,own_b_agent,foreign_agent]);
  IF n<>1 THEN RAISE EXCEPTION '[Scope] Switching spaces did not isolate the same actor organization'; END IF;
  SET LOCAL ROLE service_role;
  UPDATE public.profiles SET active_organization_id=org_a WHERE user_id=author;
  PERFORM set_config('app.user_org.u_'||replace(author::text,'-','_'),'',true);
  SET LOCAL ROLE authenticated;

  SELECT array_agg(gen_random_uuid()) INTO ids FROM generate_series(1,99);
  ids:=array_append(ids,main_agent);
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ids);
  IF cardinality(ids)<>100 OR n<>1 THEN RAISE EXCEPTION '[Limit] A 100-ID batch must work'; END IF;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent,main_agent]);
  IF n<>1 THEN RAISE EXCEPTION '[Dedupe] Repeated IDs duplicated aggregates'; END IF;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[]::uuid[]);
  IF n<>0 THEN RAISE EXCEPTION '[Empty] Empty batch should return no rows'; END IF;
  BEGIN
    PERFORM public.sourcing_agent_hub_counts(org_a,array_fill(main_agent,ARRAY[101]));
    RAISE EXCEPTION '[Limit] More than 100 IDs were accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.sourcing_agent_hub_counts(org_a,NULL);
    RAISE EXCEPTION '[Input] Null IDs were accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent,NULL]);
    RAISE EXCEPTION '[Input] Null array entry was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.sourcing_agent_hub_counts(NULL,ARRAY[main_agent]);
    RAISE EXCEPTION '[Input] Null organization was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  PERFORM set_config('request.jwt.claim.sub',administrator::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',administrator,'role','authenticated')::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.sourcing_agents WHERE id=main_agent) THEN
    RAISE EXCEPTION '[Fixture] Admin RLS must be broader than the personal RPC scope';
  END IF;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent,admin_agent]);
  IF n<>1 THEN RAISE EXCEPTION '[Admin] Admin received another creator counts'; END IF;

  PERFORM set_config('request.jwt.claim.sub',collaborator::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',collaborator,'role','authenticated')::text,true);
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[collab_agent,forbidden_agent,main_agent]);
  IF n<>1 THEN RAISE EXCEPTION '[Collaborator] Invoker bypassed own-mission RLS'; END IF;
  PERFORM set_config('request.jwt.claim.sub',member_actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member_actor,'role','authenticated')::text,true);
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[shared_agent,main_agent]);
  IF n<>1 THEN RAISE EXCEPTION '[Member] Personal agent on a shared mission was lost'; END IF;
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent,collab_agent]);
  IF n<>0 THEN RAISE EXCEPTION '[Foreign] Cross-organization actor received counts'; END IF;
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_b,ARRAY[foreign_agent,own_b_agent]);
  IF n<>1 THEN RAISE EXCEPTION '[Foreign] Own organization counts were lost'; END IF;

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  SELECT count(*) INTO n FROM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent]);
  IF n<>0 THEN RAISE EXCEPTION '[Auth] Missing subject received counts'; END IF;
  -- This local image crashes on a denied EXECUTE after SET ROLE anon; see the
  -- existing org_member_emails_audit.sql and e2e.yml precedent. Anonymous ACL
  -- is checked above; the real 42501 refusal is tested through PostgREST HTTP.

  SET LOCAL ROLE service_role;
  IF (SELECT to_jsonb(a) FROM public.sourcing_agents a WHERE id=main_agent) IS DISTINCT FROM before_agent
    OR (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.sourcing_agent_candidates c WHERE agent_id=main_agent) IS DISTINCT FROM before_candidates THEN
    RAISE EXCEPTION '[Read-only] Counting changed an agent or candidate';
  END IF;
  UPDATE public.sourcing_agents SET context_snapshot='{"context_key":"new-current"}' WHERE id=main_agent;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',author::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',author,'role','authenticated')::text,true);
  SELECT * INTO counts FROM public.sourcing_agent_hub_counts(org_a,ARRAY[main_agent]);
  IF counts.context_key IS DISTINCT FROM 'new-current' OR counts.total<>12 OR counts.uncertain<>4
    OR counts.discovered<>0 OR counts.evaluated<>0 OR counts.proposed<>0 OR counts.reviewed<>0
    OR counts.fit<>0 OR counts.rejected<>0 OR counts.skipped<>0 THEN
    RAISE EXCEPTION '[Context] Changed context mixed historical counters or lost uncertainty';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'sourcing agent hub counts audit: invoker/ACL, 2 organizations/actors/admin/collaborator/shared mission, exact context counts, old uncertainty, empty drafts, 100-ID bound/dedup, privacy and read-only behavior passed';
END;
$audit$;
ROLLBACK;
