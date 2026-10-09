-- Isolated local database only. All fixtures and effects roll back. No providers.
BEGIN;
DO $audit$
DECLARE
  author uuid := '99111111-1111-4111-8111-111111111111';
  collaborator uuid := '99222222-2222-4222-8222-222222222222';
  outsider uuid := '99333333-3333-4333-8333-333333333333';
  member_actor uuid := '99444444-4444-4444-8444-444444444444';
  solo uuid := '99555555-5555-4555-8555-555555555555';
  org_a uuid := '99aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := '99bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  org_s uuid := '99cccccc-cccc-4ccc-8ccc-cccccccccccc';
  mission uuid := '99aaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  collab_mission uuid := '99aaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other_mission uuid := '99bbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  solo_mission uuid := '99ccccc1-cccc-4ccc-8ccc-cccccccccccc';
  a public.sourcing_agents; claimed public.sourcing_agents; c public.sourcing_agent_candidates;
  data jsonb; old_token uuid; first_id uuid; rejected_id uuid; old_revision integer; n integer; i integer; hint text; fn record;
BEGIN
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO auth.users(id,email,aud,role,instance_id,raw_user_meta_data) VALUES
    (author,'author@continuous-sourcing.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (collaborator,'collaborator@continuous-sourcing.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (outsider,'outsider@continuous-sourcing.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (member_actor,'member@continuous-sourcing.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
    (solo,'solo@continuous-sourcing.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}');
  INSERT INTO public.organizations(id,name,slug,created_by,org_type) VALUES
    (org_a,'Continuous agency','continuous-audit-agency',author,'agency'),
    (org_b,'Continuous enterprise','continuous-audit-enterprise',outsider,'enterprise'),
    (org_s,'Continuous freelance','continuous-audit-freelance',solo,'freelance');
  INSERT INTO public.organization_members(organization_id,user_id,role) VALUES
    (org_a,collaborator,'collaborator'),(org_a,member_actor,'member'),(org_b,author,'member');
  INSERT INTO public.profiles(user_id,active_organization_id) VALUES
    (author,org_a),(collaborator,org_a),(outsider,org_b),(member_actor,org_a),(solo,org_s)
    ON CONFLICT(user_id) DO UPDATE SET active_organization_id=EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects(id,organization_id,created_by,name) VALUES
    (mission,org_a,author,'Continuous mission'),(collab_mission,org_a,collaborator,'Own collaborator mission'),
    (other_mission,org_b,outsider,'Foreign enterprise mission'),(solo_mission,org_s,solo,'Freelance mission');
  INSERT INTO public.member_linkedin_accounts(organization_id,user_id,linkedin_account_id)
    VALUES(org_a,author,'continuous-author-account'),(org_a,member_actor,'continuous-colleague-account');

  IF has_table_privilege('anon','public.sourcing_agents','SELECT') OR
    has_table_privilege('authenticated','public.sourcing_agents','INSERT,UPDATE,DELETE') OR
    has_table_privilege('authenticated','public.sourcing_agent_candidates','INSERT,UPDATE,DELETE') OR
    has_table_privilege('authenticated','public.sourcing_agent_reference_erasures','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION '[ACL] Browser can mutate agents or candidates';
  END IF;
  FOR fn IN SELECT oid,proname,prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('assert_sourcing_agent_actor','mutate_sourcing_agent','claim_sourcing_agent','sourcing_agent_assert_lease',
      'sourcing_agent_checkpoint','reserve_sourcing_agent_budget','release_sourcing_agent_budget',
      'sourcing_agent_candidate_write','review_sourcing_agent_candidate','invoke_process_sourcing_agents',
      'sourcing_agent_candidate_erased','sourcing_agent_candidate_erasure_guard',
      'sourcing_agent_privacy_lock','sourcing_agent_erasure_serialization','sourcing_agent_erase_candidates','sourcing_agent_reference_erased',
      'sourcing_agent_score_uses_references','sourcing_agent_reference_key','sourcing_agent_score_privacy_guard',
      'sourcing_agent_candidates_after_erasure','sourcing_agent_candidates_after_photo_erasure') LOOP
    IF fn.prosecdef OR has_function_privilege('anon',fn.oid,'EXECUTE') OR
      has_function_privilege('authenticated',fn.oid,'EXECUTE') OR NOT has_function_privilege('service_role',fn.oid,'EXECUTE') THEN
      RAISE EXCEPTION '[ACL] Unsafe RPC %',fn.proname;
    END IF;
  END LOOP;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.sourcing_agent_score_privacy_erased(uuid,jsonb)'::regprocedure)
    OR has_function_privilege('anon','public.sourcing_agent_score_privacy_erased(uuid,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.sourcing_agent_score_privacy_erased(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION '[ACL] Boolean privacy boundary unsafe';
  END IF;

  SET LOCAL ROLE service_role;
  data:=public.mutate_sourcing_agent(author,mission,0,'configure','{"source":"pool","settings":{"daily_credit_limit":30}}');
  SELECT * INTO a FROM public.sourcing_agents WHERE id=(data->>'id')::uuid;
  IF a.status<>'draft' OR a.revision<>1 OR a.lease_token IS NOT NULL OR a.approved_context_key IS NOT NULL THEN
    RAISE EXCEPTION '[Opt-in] Configuration starts a worker automatically';
  END IF;
  PERFORM public.mutate_sourcing_agent(solo,solo_mission,0,'configure','{"source":"pool"}');
  PERFORM public.mutate_sourcing_agent(outsider,other_mission,0,'configure','{"source":"pool"}');
  PERFORM public.mutate_sourcing_agent(collaborator,collab_mission,0,'configure','{"source":"pool"}');
  BEGIN
    PERFORM public.mutate_sourcing_agent(collaborator,mission,1,'pause','{}');
    RAISE EXCEPTION '[Scope] Collaborator accessed another mission';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_FORBIDDEN' THEN RAISE EXCEPTION '[Scope] Wrong refusal %',hint; END IF;
  END;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,1,'configure',
      '{"source":"linkedin","account_id":"continuous-colleague-account","api":"recruiter"}');
    RAISE EXCEPTION '[Account] Colleague account accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_ACCOUNT_FORBIDDEN' THEN RAISE EXCEPTION '[Account] Wrong refusal %',hint; END IF;
  END;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,1,'configure','{"settings":{"cadence_hours":1}}');
    RAISE EXCEPTION '[Settings] Invalid cadence accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,1,'configure','{"settings":{"daily_credit_limit":11}}');
    RAISE EXCEPTION '[Settings] Budget below one evaluation accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.sourcing_projects SET kind='search' WHERE id=solo_mission;
  BEGIN
    PERFORM public.mutate_sourcing_agent(solo,solo_mission,1,'start_calibration','{"context_snapshot":{"context_key":"search-context"}}');
    RAISE EXCEPTION '[Mission] A saved search started a mission agent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.sourcing_projects SET kind='mission' WHERE id=solo_mission;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,0,'pause','{}');
    RAISE EXCEPTION '[CAS] Stale configuration overwritten';
  EXCEPTION WHEN serialization_failure THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_REVISION' THEN RAISE EXCEPTION '[CAS] Wrong refusal %',hint; END IF;
  END;

  data:=public.mutate_sourcing_agent(author,mission,1,'start_calibration',
    '{"context_snapshot":{"context_key":"context-before","brief":{"title":"Engineer"}},"search_filters_snapshot":{"keywords":"Engineer"}}');
  SELECT * INTO a FROM public.sourcing_agents WHERE id=(data->>'id')::uuid;
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  IF claimed.id<>a.id OR claimed.lease_token IS NULL THEN RAISE EXCEPTION '[Lease] Due agent not claimed'; END IF;
  old_token:=claimed.lease_token;
  SELECT count(*) INTO n FROM public.claim_sourcing_agent();
  IF n<>0 THEN RAISE EXCEPTION '[Lease] Active lease was claimed twice'; END IF;
  IF NOT public.reserve_sourcing_agent_budget(a.id,old_token,20,30) OR public.reserve_sourcing_agent_budget(a.id,old_token,1,0)
    OR public.reserve_sourcing_agent_budget(a.id,old_token,0,1) THEN RAISE EXCEPTION '[Budget] Daily cap not atomic'; END IF;
  PERFORM public.release_sourcing_agent_budget(a.id,old_token,30);
  BEGIN
    PERFORM public.sourcing_agent_checkpoint(a.id,old_token,'{"credits_used":0}');
    RAISE EXCEPTION '[Checkpoint] Budget could be forged';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.sourcing_agent_checkpoint(a.id,old_token,'{"status":"active"}');
    RAISE EXCEPTION '[Calibration] Worker activated without human approval';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  FOR i IN 1..3 LOOP
    IF NOT public.reserve_sourcing_agent_budget(a.id,old_token,0,3) THEN RAISE EXCEPTION '[Budget] Fixture reservation failed'; END IF;
    data:=public.sourcing_agent_candidate_write(a.id,old_token,'pid:continuous-'||i,
      jsonb_build_object('candidate_id','continuous-'||i,'context_key','context-before',
        'source_aliases',jsonb_build_array('continuous-'||i,'slug:continuous-'||i),
        'profile',jsonb_build_object('name','Candidate '||i,'public_profile_url','https://linkedin.com/in/continuous-'||i),
        'credits_reserved',3));
    IF i=1 THEN first_id:=(data->>'id')::uuid; END IF;
    IF i=3 THEN rejected_id:=(data->>'id')::uuid; END IF;
    data:=public.sourcing_agent_candidate_write(a.id,old_token,'pid:continuous-'||i,
      jsonb_build_object('context_key','context-before','state','scored','score',80,
        'result',jsonb_build_object('recommendation','go'),'credits_used',2));
    data:=public.sourcing_agent_candidate_write(a.id,old_token,'pid:continuous-'||i,
      jsonb_build_object('context_key','context-before','state','scored','score',80,
        'result',jsonb_build_object('recommendation','go'),'credits_used',2));
  END LOOP;
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  IF a.credits_reserved<>0 OR a.credits_used<>6 THEN RAISE EXCEPTION '[Budget] Settlement is not idempotent'; END IF;
  data:=public.sourcing_agent_candidate_write(a.id,old_token,'pid:different-alias',
    '{"candidate_id":"different-alias","context_key":"context-before","source_aliases":["slug:continuous-1"]}');
  IF (data->>'id')::uuid<>first_id OR data->>'state'<>'scored' THEN RAISE EXCEPTION '[Dedup] Alias created another candidate or reset a score'; END IF;
  data:=public.sourcing_agent_candidate_write(a.id,old_token,'pid:different-alias',
    '{"candidate_id":"different-alias","context_key":"context-before","source_aliases":["slug:continuous-1"],"state":"discovered"}');
  IF (data->>'id')::uuid<>first_id OR data->>'state'<>'scored' OR (data->>'credits_used')::numeric<>2 THEN
    RAISE EXCEPTION '[Dedup] Rediscovery reset an older completed evaluation';
  END IF;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,a.revision,'approve_calibration',
      '{"approved_context_key":"context-approved","context_snapshot":{"context_key":"context-approved"}}');
    RAISE EXCEPTION '[Calibration] Approval accepted before three human reviews';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_CALIBRATION_REQUIRED' THEN RAISE EXCEPTION '[Calibration] Wrong refusal %',hint; END IF;
  END;
  FOR c IN SELECT * FROM public.sourcing_agent_candidates WHERE agent_id=a.id ORDER BY candidate_id LOOP
    data:=public.review_sourcing_agent_candidate(author,c.id,a.revision,'reject','Explicit human review with concrete reasoning');
    SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
    IF a.status='active' THEN RAISE EXCEPTION '[Calibration] Feedback implicitly activated the agent'; END IF;
  END LOOP;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,a.revision,'approve_calibration',
      '{"approved_context_key":"context-approved","context_snapshot":{"context_key":"context-approved"}}');
    RAISE EXCEPTION '[Calibration] Three rejections activated the agent without a fit';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_CALIBRATION_REQUIRED' THEN RAISE EXCEPTION '[Calibration] Wrong fit refusal %',hint; END IF;
  END;
  FOR c IN SELECT * FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND id<>rejected_id LOOP
    PERFORM public.review_sourcing_agent_candidate(author,c.id,a.revision,'fit','Updated human review confirms the concrete fit');
    SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  END LOOP;
  BEGIN
    PERFORM public.sourcing_agent_checkpoint(a.id,old_token,'{"checkpoint":{"cursor":"late"}}');
    RAISE EXCEPTION '[Feedback] Old worker wrote after review invalidation';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,a.revision,'approve_calibration',
      '{"approved_context_key":"context-approved","context_snapshot":{"context_key":"context-approved"},"calibration_profiles":[],"expected_job_details":{"changed":true}}');
    RAISE EXCEPTION '[Brief CAS] Approval overwrote a newer brief';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  data:=public.mutate_sourcing_agent(author,mission,a.revision,'approve_calibration',
    '{"approved_context_key":"context-approved","context_snapshot":{"context_key":"context-approved"},"calibration_profiles":[{"name":"Approved reference"}],"expected_job_details":{}}');
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  IF a.status<>'active' OR a.approved_context_key<>'context-approved' OR
    (SELECT job_details->'calibration_profiles' FROM public.sourcing_projects WHERE id=mission)<>'[{"name":"Approved reference"}]'::jsonb THEN
    RAISE EXCEPTION '[Approval] Brief and agent were not updated atomically';
  END IF;
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  data:=public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:continuous-3',
    '{"candidate_id":"continuous-3","context_key":"context-approved","state":"discovered"}');
  IF data->>'decision'<>'reject' OR data->>'state'<>'reviewed' THEN RAISE EXCEPTION '[Decision] A new context resurrected a rejected candidate'; END IF;
  INSERT INTO public.gdpr_erasures(linkedin_url_hash,source) VALUES
    (encode(sha256(convert_to('https://linkedin.com/in/continuous-2','UTF8')),'hex'),'continuous-local-audit');
  IF EXISTS (SELECT 1 FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND candidate_id='continuous-2') THEN
    RAISE EXCEPTION '[Erasure] Stored sourcing candidate survived an erasure';
  END IF;
  BEGIN
    PERFORM public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:continuous-2',
      '{"candidate_id":"continuous-2","context_key":"context-approved","profile":{"public_profile_url":"HTTPS://LINKEDIN.COM/in/continuous-2/?tracking=1"}}');
    RAISE EXCEPTION '[Erasure] Erased candidate recreated';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_CANDIDATE_ERASED' THEN RAISE EXCEPTION '[Erasure] Wrong refusal %',hint; END IF;
  END;
  BEGIN
    INSERT INTO public.sourcing_agent_candidates(agent_id,organization_id,project_id,created_by,person_key,candidate_id,context_key)
      VALUES(a.id,org_b,other_mission,outsider,'pid:forged','forged','context-approved');
    RAISE EXCEPTION '[FK] Forged cross-organization candidate attached';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT public.reserve_sourcing_agent_budget(a.id,claimed.lease_token,0,1) THEN RAISE EXCEPTION '[Erasure] Fixture reservation failed'; END IF;
  PERFORM public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:photo-erased',
    '{"candidate_id":"photo-erased","context_key":"context-approved","source_aliases":["id:photo-erased-provider"],"credits_reserved":1}');
  INSERT INTO public.candidate_photos(organization_id,candidate_id,status) VALUES(org_a,'photo-erased-provider','erased');
  IF EXISTS (SELECT 1 FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND candidate_id='photo-erased') THEN
    RAISE EXCEPTION '[Erasure] Provider identity marker did not remove a suggestion';
  END IF;
  IF (SELECT credits_reserved FROM public.sourcing_agents WHERE id=a.id)<>0 OR
    (SELECT credits_used FROM public.sourcing_agents WHERE id=a.id)<>7 THEN
    RAISE EXCEPTION '[Erasure] Deleted in-flight candidate left an orphaned reservation';
  END IF;
  INSERT INTO public.gdpr_erasures(email_hash,source) VALUES
    (encode(sha256(convert_to('array-contact@continuous-local.test','UTF8')),'hex'),'continuous-local-audit-email');
  BEGIN
    PERFORM public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:email-erased',
      '{"candidate_id":"email-erased","context_key":"context-approved","profile":{"contact_info":{"emails":[" ARRAY-CONTACT@CONTINUOUS-LOCAL.TEST "]}}}');
    RAISE EXCEPTION '[Erasure] An erased contact-array email recreated a candidate';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_CANDIDATE_ERASED' THEN RAISE EXCEPTION '[Erasure] Wrong email refusal %',hint; END IF;
  END;
  old_token:=claimed.lease_token;
  data:=public.mutate_sourcing_agent(author,mission,a.revision,'pause','{}');
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  BEGIN
    PERFORM public.sourcing_agent_candidate_write(a.id,old_token,'pid:late',
      '{"candidate_id":"late","context_key":"context-approved"}');
    RAISE EXCEPTION '[Pause] Old lease created a candidate';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  IF (SELECT count(*) FROM public.claim_sourcing_agent())<>0 THEN RAISE EXCEPTION '[Pause] Paused agent claimed'; END IF;
  data:=public.mutate_sourcing_agent(author,mission,a.revision,'resume','{"approved_context_key":"context-approved"}');
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  old_token:=claimed.lease_token;
  IF NOT public.reserve_sourcing_agent_budget(a.id,old_token,0,2) THEN RAISE EXCEPTION '[Recovery] Fixture reservation failed'; END IF;
  PERFORM public.sourcing_agent_candidate_write(a.id,old_token,'pid:uncertain-cost',
    '{"candidate_id":"uncertain-cost","context_key":"context-approved","credits_reserved":2,"provenance":{"scoring_started_at":"2026-10-08T12:00:00Z"}}');
  UPDATE public.sourcing_agents SET lease_until=now()-interval '1 minute' WHERE id=a.id;
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  IF claimed.lease_token=old_token THEN RAISE EXCEPTION '[Fencing] Reclaim kept expired token'; END IF;
  IF claimed.credits_reserved<>0 OR claimed.credits_used<>9 OR NOT EXISTS (
    SELECT 1 FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND candidate_id='uncertain-cost'
      AND credits_reserved=0 AND credits_used=2 AND provenance->>'reservation_recovered'='ESTIMATED_AFTER_LEASE'
      AND provenance ? 'scoring_started_at') THEN RAISE EXCEPTION '[Recovery] Abandoned reservation blocked the budget or was refunded'; END IF;
  BEGIN
    PERFORM public.reserve_sourcing_agent_budget(a.id,old_token,0,1);
    RAISE EXCEPTION '[Fencing] Expired worker reserved credits';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;

  -- A UI space switch does not mutate the immutable originating organization.
  UPDATE public.profiles SET active_organization_id=org_b WHERE user_id=author;
  PERFORM public.reserve_sourcing_agent_budget(a.id,claimed.lease_token,0,0);
  data:=public.sourcing_agent_checkpoint(a.id,claimed.lease_token,
    jsonb_build_object('revision',a.revision,'context_key','context-approved','checkpoint',jsonb_build_object('cursor','next-page'),
      'next_run_at',now()+interval '6 hours'));
  IF data->>'lease_token' IS NOT NULL OR data->'checkpoint'->>'cursor'<>'next-page' THEN RAISE EXCEPTION '[Checkpoint] Lease not released or cursor lost'; END IF;
  UPDATE public.profiles SET active_organization_id=org_a WHERE user_id=author;

  -- An explicit human resolution never retries the uncertain paid evaluation.
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  SELECT * INTO c FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND candidate_id='uncertain-cost';
  UPDATE public.sourcing_agents SET next_run_at=now() WHERE id=a.id;
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  data:=public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:uncertain-cost',
    '{"context_key":"context-approved","provenance":{"scoring_started_at":null,"reservation_recovered":null}}');
  IF data->'provenance'->>'scoring_started_at' IS NULL OR data->'provenance'->>'reservation_recovered' IS NULL THEN
    RAISE EXCEPTION '[Uncertainty] Candidate patch erased a durable uncertainty marker';
  END IF;
  UPDATE public.sourcing_agents SET context_snapshot='{"context_key":"context-after-brief-change"}' WHERE id=a.id;
  BEGIN
    PERFORM public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:uncertain-cost',
      '{"context_key":"context-after-brief-change","state":"discovered","provenance":{}}');
    RAISE EXCEPTION '[Uncertainty] A changed brief reset an unresolved paid evaluation';
  EXCEPTION WHEN serialization_failure THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_SCORING_UNCERTAIN' THEN RAISE EXCEPTION '[Uncertainty] Wrong reset refusal %',hint; END IF;
  END;
  FOREACH hint IN ARRAY ARRAY['configure','start_calibration','approve_calibration','resume'] LOOP
    BEGIN
      PERFORM public.mutate_sourcing_agent(author,mission,a.revision,hint,'{}');
      RAISE EXCEPTION '[Uncertainty] Action % bypassed unresolved old context',hint;
    EXCEPTION WHEN invalid_parameter_value THEN
      GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
      IF hint IS DISTINCT FROM 'SOURCING_AGENT_SCORING_UNCERTAIN' THEN RAISE EXCEPTION '[Uncertainty] Wrong action refusal %',hint; END IF;
    END;
  END LOOP;
  UPDATE public.organization_members SET role='admin' WHERE organization_id=org_a AND user_id=member_actor;
  BEGIN
    PERFORM public.mutate_sourcing_agent(member_actor,mission,a.revision,'skip_uncertain',
      jsonb_build_object('candidate_id',c.id,'context_key','context-approved','reason','Explicitly skip this uncertain evaluation'));
    RAISE EXCEPTION '[Resolution] Another administrator resolved the actor personal evaluation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.organization_members SET role='member' WHERE organization_id=org_a AND user_id=member_actor;
  old_revision:=a.revision;
  data:=public.mutate_sourcing_agent(author,mission,a.revision,'skip_uncertain',
    jsonb_build_object('candidate_id',c.id,'context_key','context-approved','reason','Explicitly skip this uncertain evaluation'));
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  IF a.status<>'paused' OR a.credits_reserved<>0 OR a.credits_used<>9 OR a.lease_token IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM public.sourcing_agent_candidates WHERE id=c.id AND state='skipped' AND credits_used=2 AND reason IS NULL
      AND score IS NULL AND result='{}' AND provenance->>'skip_reason'='HUMAN_SKIP_UNCERTAIN') THEN
    RAISE EXCEPTION '[Resolution] Recovered cost charged twice or automatic restart';
  END IF;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,old_revision,'skip_uncertain',
      jsonb_build_object('candidate_id',c.id,'context_key','context-approved','reason','Repeated explicit skip action'));
    RAISE EXCEPTION '[Resolution] Double click bypassed the revision gate';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,a.revision,'skip_uncertain',
      jsonb_build_object('candidate_id',c.id,'context_key','context-approved','reason','Repeated explicit skip action'));
    RAISE EXCEPTION '[Resolution] Already resolved evaluation was resolved twice';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.sourcing_agent_checkpoint(a.id,claimed.lease_token,'{"checkpoint":{"cursor":"late-uncertain"}}');
    RAISE EXCEPTION '[Resolution] Old worker wrote after human uncertainty resolution';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.mutate_sourcing_agent(author,mission,a.revision,'resume','{"approved_context_key":"context-approved"}');
    RAISE EXCEPTION '[Resolution] Changed context resumed with stale approval';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  UPDATE public.sourcing_agents SET context_snapshot='{"context_key":"context-approved"}' WHERE id=a.id;
  PERFORM public.mutate_sourcing_agent(author,mission,a.revision,'resume','{"approved_context_key":"context-approved"}');

  -- Low scores do not consume pending slots; only proposed profiles need review.
  UPDATE public.sourcing_agents SET settings=settings||'{"max_pending":5}',next_run_at=now() WHERE id=a.id;
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  FOR i IN 1..10 LOOP
    PERFORM public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:low-score-'||i,
      jsonb_build_object('candidate_id','low-score-'||i,'context_key','context-approved','state','scored','score',20,
        'result',jsonb_build_object('recommendation','reject'),'credits_used',0));
  END LOOP;
  PERFORM public.sourcing_agent_checkpoint(a.id,claimed.lease_token,jsonb_build_object('next_run_at',now()));
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  IF claimed.id IS DISTINCT FROM a.id THEN RAISE EXCEPTION '[Pending] Low scores stopped discovery'; END IF;
  FOR i IN 1..5 LOOP
    PERFORM public.sourcing_agent_candidate_write(a.id,claimed.lease_token,'pid:low-score-'||i,
      '{"context_key":"context-approved","state":"proposed"}');
  END LOOP;
  PERFORM public.sourcing_agent_checkpoint(a.id,claimed.lease_token,jsonb_build_object('next_run_at',now()));
  SELECT count(*) INTO n FROM public.claim_sourcing_agent();
  IF n<>0 OR
    (SELECT status FROM public.sourcing_agents WHERE id=a.id)<>'awaiting_review' THEN
    RAISE EXCEPTION '[Pending] Proposed review limit failed, status %, proposed %, limit %',
      (SELECT status FROM public.sourcing_agents WHERE id=a.id),
      (SELECT count(*) FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND context_key='context-approved' AND state='proposed'),
      (SELECT settings->>'max_pending' FROM public.sourcing_agents WHERE id=a.id);
  END IF;
  -- Restore active for the later inactive-mission assertion, without starting work.
  UPDATE public.sourcing_agents SET status='active',next_run_at=now()+interval '6 hours' WHERE id=a.id;

  data:=public.mutate_sourcing_agent(outsider,other_mission,1,'start_calibration',
    '{"context_snapshot":{"context_key":"enterprise-calibration"}}');
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  FOR i IN 1..5 LOOP
    PERFORM public.sourcing_agent_candidate_write(claimed.id,claimed.lease_token,'pid:calibration-'||i,
      jsonb_build_object('candidate_id','calibration-'||i,'context_key','enterprise-calibration','state','scored','score',20,
        'result',jsonb_build_object('recommendation','reject'),'credits_used',0));
  END LOOP;
  PERFORM public.sourcing_agent_checkpoint(claimed.id,claimed.lease_token,jsonb_build_object('next_run_at',now()));
  SELECT count(*) INTO n FROM public.claim_sourcing_agent();
  IF n<>0 OR
    (SELECT status FROM public.sourcing_agents WHERE id=claimed.id)<>'awaiting_review' THEN
    RAISE EXCEPTION '[Calibration] Discovery continued after the five-profile sample';
  END IF;

  INSERT INTO public.member_linkedin_accounts(organization_id,user_id,linkedin_account_id,account_status)
    VALUES(org_a,collaborator,'continuous-collaborator-account','OK');
  PERFORM public.mutate_sourcing_agent(collaborator,collab_mission,1,'configure',
    '{"source":"linkedin","account_id":"continuous-collaborator-account","api":"classic"}');
  PERFORM public.mutate_sourcing_agent(collaborator,collab_mission,2,'start_calibration',
    '{"context_snapshot":{"context_key":"collaborator-account-context"}}');
  SELECT * INTO claimed FROM public.claim_sourcing_agent();
  PERFORM public.sourcing_agent_assert_lease(claimed.id,claimed.lease_token);
  DELETE FROM public.member_linkedin_accounts WHERE linkedin_account_id='continuous-collaborator-account';
  BEGIN
    PERFORM public.sourcing_agent_assert_lease(claimed.id,claimed.lease_token);
    RAISE EXCEPTION '[Account] A transferred personal account kept provider authorization';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_ACCOUNT_FORBIDDEN' THEN RAISE EXCEPTION '[Account] Wrong transfer refusal %',hint; END IF;
  END;
  INSERT INTO public.member_linkedin_accounts(organization_id,user_id,linkedin_account_id,account_status)
    VALUES(org_a,collaborator,'continuous-collaborator-account','CREDENTIALS');
  BEGIN
    PERFORM public.sourcing_agent_assert_lease(claimed.id,claimed.lease_token);
    RAISE EXCEPTION '[Account] A disconnected account kept provider authorization';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT;
    IF hint IS DISTINCT FROM 'SOURCING_AGENT_ACCOUNT_RECONNECT' THEN RAISE EXCEPTION '[Account] Wrong reconnect refusal %',hint; END IF;
  END;
  UPDATE public.member_linkedin_accounts SET account_status='CONNECTED' WHERE linkedin_account_id='continuous-collaborator-account';
  PERFORM public.sourcing_agent_assert_lease(claimed.id,claimed.lease_token);
  PERFORM public.sourcing_agent_checkpoint(claimed.id,claimed.lease_token,'{"status":"paused"}');

  -- Read policy: author and organization owner/admin only, with collaborator restriction.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',collaborator,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',collaborator::text,true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.sourcing_agents)<>1 OR
    EXISTS (SELECT 1 FROM public.sourcing_agents WHERE project_id=mission) THEN RAISE EXCEPTION '[RLS] Collaborator sees foreign agents'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member_actor,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',member_actor::text,true);
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.sourcing_agents WHERE project_id=mission) THEN RAISE EXCEPTION '[RLS] Regular member sees another actor agent'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',author,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',author::text,true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.sourcing_agents WHERE organization_id=org_a)<>2 OR
    EXISTS (SELECT 1 FROM public.sourcing_agents WHERE organization_id=org_s) THEN RAISE EXCEPTION '[RLS] Owner read scope incorrect'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  SET LOCAL ROLE service_role;
  UPDATE public.sourcing_agents SET next_run_at=now() WHERE id=a.id;
  UPDATE public.sourcing_projects SET status='paused' WHERE id=mission;
  IF (SELECT count(*) FROM public.claim_sourcing_agent())<>0 THEN RAISE EXCEPTION '[Mission] Inactive mission claimed'; END IF;
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  IF a.status<>'paused' THEN RAISE EXCEPTION '[Mission] Inactive mission not paused'; END IF;

  -- Erasure removes only agent-generated calibration copies, clears snapshots,
  -- and requires a new human calibration before any subsequent paid work.
  INSERT INTO public.sourcing_agent_candidates(agent_id,organization_id,project_id,created_by,person_key,candidate_id,context_key,profile)
    VALUES(a.id,org_a,mission,author,'pid:reference-erased','reference-erased','context-approved',
      '{"public_profile_url":"https://linkedin.com/in/continuous-reference-erased"}') RETURNING * INTO c;
  data:=jsonb_build_array(
    jsonb_build_object('name','Erased reference','linkedin_url','https://linkedin.com/in/continuous-reference-erased','sourcing_agent_candidate_id',c.id),
    jsonb_build_object('name','Another linked copy','linkedin_url','https://linkedin.com/in/continuous-reference-erased','sourcing_agent_candidate_id',gen_random_uuid()),
    jsonb_build_object('name','Independent manual reference'));
  UPDATE public.sourcing_projects SET job_details=jsonb_set(job_details,'{calibration_profiles}',data) WHERE id=mission;
  data:=jsonb_build_object('scoringContext',jsonb_build_object('inputVersionKey',jsonb_build_object('job',
    jsonb_build_object('calibrationProfiles',jsonb_build_array(jsonb_build_object('name','Erased reference',
      'linkedinUrl','https://linkedin.com/in/continuous-reference-erased'))))::text));
  INSERT INTO public.sourcing_agent_candidates(agent_id,organization_id,project_id,created_by,person_key,candidate_id,context_key,score,result,state)
    VALUES(a.id,org_a,mission,author,'pid:dependent-score','dependent-score','context-approved',80,data,'proposed');
  INSERT INTO public.match_scores(candidate_id,job_id,organization_id,score,scoring_result) VALUES
    ('dependent-score','project:'||mission,org_a,80,data),
    ('unrelated-score','project:'||mission,org_a,90,'{"scoringContext":{"inputVersionKey":"{}"}}');
  INSERT INTO public.job_candidate_status(candidate_id,job_id,organization_id,project_id,created_by,candidate_name,score,scoring_details)
    VALUES('dependent-score','project:'||mission,org_a,mission,author,'Independent scored person',80,data);
  data:=(SELECT job_details->'calibration_profiles' FROM public.sourcing_projects WHERE id=mission);
  UPDATE public.sourcing_agents SET context_snapshot=jsonb_build_object('context_key','context-approved','job_details',
      jsonb_build_object('calibration_profiles',data)),search_filters_snapshot='{"keywords":"reference"}',checkpoint='{"cursor":"old"}' WHERE id=a.id;
  old_revision:=a.revision;
  INSERT INTO public.gdpr_erasures(linkedin_url_hash,source) VALUES
    (encode(sha256(convert_to('https://linkedin.com/in/continuous-reference-erased','UTF8')),'hex'),'continuous-reference-audit');
  SELECT * INTO a FROM public.sourcing_agents WHERE id=a.id;
  IF (SELECT job_details->'calibration_profiles' FROM public.sourcing_projects WHERE id=mission)<>'[{"name":"Independent manual reference"}]'::jsonb
    OR a.context_snapshot<>'{}' OR a.search_filters_snapshot<>'{}' OR a.checkpoint<>'{}' OR a.approved_context_key IS NOT NULL
    OR a.status<>'blocked' OR a.last_reason<>'CONTEXT_CHANGED' OR a.revision<>old_revision+1 OR a.lease_token IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.sourcing_agent_candidates WHERE id=c.id) THEN
    RAISE EXCEPTION '[Erasure copies] Agent-generated brief/snapshot references retained personal data or approval';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND candidate_id='dependent-score'
      AND (score IS NOT NULL OR result<>'{}' OR state<>'skipped'))
    OR EXISTS (SELECT 1 FROM public.match_scores WHERE organization_id=org_a AND candidate_id='dependent-score')
    OR NOT EXISTS (SELECT 1 FROM public.match_scores WHERE organization_id=org_a AND candidate_id='unrelated-score' AND score=90)
    OR EXISTS (SELECT 1 FROM public.job_candidate_status WHERE organization_id=org_a AND project_id=mission
      AND candidate_id='dependent-score' AND (score IS NOT NULL OR scoring_details IS NOT NULL OR general_stage<>'to_sort')) THEN
    RAISE EXCEPTION '[Erasure score copies] Dependent scoring metadata retained references or unrelated scores/stages changed';
  END IF;
  data:=jsonb_build_object('scoringContext',jsonb_build_object('inputVersionKey',jsonb_build_object('job',
    jsonb_build_object('calibrationProfiles',jsonb_build_array(jsonb_build_object('name','Erased reference',
      'linkedinUrl','https://linkedin.com/in/continuous-reference-erased','sourcing_agent_candidate_id',c.id))))::text));
  INSERT INTO public.match_scores(candidate_id,job_id,organization_id,score,scoring_result)
    VALUES('late-dependent-score','project:'||mission,org_a,80,data);
  UPDATE public.job_candidate_status SET score=80,scoring_details=data
    WHERE organization_id=org_a AND project_id=mission AND candidate_id='dependent-score';
  IF EXISTS (SELECT 1 FROM public.match_scores WHERE organization_id=org_a AND candidate_id='late-dependent-score')
    OR EXISTS (SELECT 1 FROM public.job_candidate_status WHERE organization_id=org_a AND project_id=mission
      AND candidate_id='dependent-score' AND (score IS NOT NULL OR scoring_details IS NOT NULL OR general_stage<>'to_sort')) THEN
    RAISE EXCEPTION '[Erasure late writer] A delayed scorer recreated erased reference data or changed an ATS stage';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',author,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',author::text,true);
  SET LOCAL ROLE authenticated;
  IF NOT public.sourcing_agent_score_privacy_erased(org_a,data) THEN RAISE EXCEPTION '[Privacy boundary] Own erased reference not recognized'; END IF;
  BEGIN
    PERFORM public.sourcing_agent_score_privacy_erased(org_s,data);
    RAISE EXCEPTION '[Privacy boundary] Browser queried another organization opposition status';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.sourcing_agent_reference_erasures;
    RAISE EXCEPTION '[Privacy boundary] Browser could read opposition rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.match_scores(candidate_id,job_id,organization_id,created_by,score,scoring_result)
    VALUES('browser-clean-score','project:'||mission,org_a,author,92,'{"scoringContext":{"inputVersionKey":"{}"}}');
  UPDATE public.job_candidate_status SET score=92,scoring_details='{"scoringContext":{"inputVersionKey":"{}"}}'
    WHERE organization_id=org_a AND project_id=mission AND candidate_id='dependent-score';
  IF NOT EXISTS (SELECT 1 FROM public.match_scores WHERE organization_id=org_a AND candidate_id='browser-clean-score' AND score=92)
    OR NOT EXISTS (SELECT 1 FROM public.job_candidate_status WHERE organization_id=org_a AND project_id=mission
      AND candidate_id='dependent-score' AND score=92) THEN RAISE EXCEPTION '[Privacy boundary] Legitimate authenticated scoring write blocked'; END IF;
  UPDATE public.job_candidate_status SET score=80,scoring_details=data
    WHERE organization_id=org_a AND project_id=mission AND candidate_id='dependent-score';
  IF EXISTS (SELECT 1 FROM public.job_candidate_status WHERE organization_id=org_a AND project_id=mission
    AND candidate_id='dependent-score' AND (score IS NOT NULL OR scoring_details IS NOT NULL OR general_stage<>'to_sort')) THEN
    RAISE EXCEPTION '[Privacy boundary] Authenticated late scoring retained erased references';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  SET LOCAL ROLE service_role;
  IF (SELECT credits_used FROM public.sourcing_agents WHERE id=a.id)<>9 OR
    (SELECT credits_reserved FROM public.sourcing_agents WHERE id=a.id)<>0 THEN RAISE EXCEPTION '[Privacy boundary] Optional cache guard changed credit settlement'; END IF;
  -- A historical score keeps its reference UUID even after the brief/snapshot
  -- changed, so erasure can purge that copy without touching current criteria.
  INSERT INTO public.sourcing_agent_candidates(agent_id,organization_id,project_id,created_by,person_key,candidate_id,context_key,profile)
    VALUES(a.id,org_a,mission,author,'pid:historical-reference','historical-reference','old-reference-context',
      '{"email":"historical-reference@continuous-local.test"}') RETURNING * INTO c;
  data:=jsonb_build_object('scoringContext',jsonb_build_object('inputVersionKey',jsonb_build_object('job',
    jsonb_build_object('calibrationProfiles',jsonb_build_array(jsonb_build_object('name','Historical erased reference',
      'sourcing_agent_candidate_id',c.id))))::text));
  INSERT INTO public.match_scores(candidate_id,job_id,organization_id,score,scoring_result)
    VALUES('historical-dependent-score','project:'||mission,org_a,85,data);
  INSERT INTO public.gdpr_erasures(email_hash,source) VALUES
    (encode(sha256(convert_to('historical-reference@continuous-local.test','UTF8')),'hex'),'continuous-historical-reference-audit');
  IF EXISTS (SELECT 1 FROM public.match_scores WHERE organization_id=org_a AND candidate_id='historical-dependent-score') THEN
    RAISE EXCEPTION '[Erasure historical copies] Historical score retained a generated reference UUID';
  END IF;
  DELETE FROM public.sourcing_projects WHERE id=mission;
  IF EXISTS (SELECT 1 FROM public.sourcing_agents WHERE id=a.id) OR
    EXISTS (SELECT 1 FROM public.sourcing_agent_candidates WHERE agent_id=a.id) THEN RAISE EXCEPTION '[Deletion] Mission data did not cascade'; END IF;
  RESET ROLE;
  RAISE NOTICE 'continuous sourcing audit: ACL/RLS/org types/scopes, revisions/calibration/brief CAS, leases/budget caps/recovery, durable dedupe/rejection, human uncertainty resolution, erasure/reimport/calibration and score copies/historical UUID, cross-org FK, pause/checkpoints/deletion passed';
END;
$audit$;
ROLLBACK;
