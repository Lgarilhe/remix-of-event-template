-- Local/rebuilt database only. Fixtures and effects roll back completely.
BEGIN;
DO $audit$
DECLARE
  ua uuid:=gen_random_uuid(); up uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
  oa uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
  plan_a uuid:=gen_random_uuid(); plan_peer uuid:=gen_random_uuid(); plan_b uuid:=gen_random_uuid();
  doc_a uuid:=gen_random_uuid(); doc_peer uuid:=gen_random_uuid(); msg_a uuid:=gen_random_uuid(); msg_peer uuid:=gen_random_uuid(); msg_success uuid:=gen_random_uuid(); doc_b uuid:=gen_random_uuid(); comment_a uuid:=gen_random_uuid();
  scope_a jsonb; scope_b jsonb; proposed jsonb; result jsonb; claim jsonb; token uuid; token2 uuid;
  n integer; denied boolean; hint text; f record; checks integer:=0; account_a text:='audit-'||gen_random_uuid()::text; account_peer text:='audit-peer-'||gen_random_uuid()::text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,p.prosecdef FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    WHERE s.nspname='public' AND p.proname LIKE 'candidate_actions_%' LOOP
    IF f.prosecdef OR has_function_privilege('anon',f.signature,'EXECUTE') OR has_function_privilege('authenticated',f.signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Service RPC privilege failure: %',f.signature;
    END IF;
    checks:=checks+1;
  END LOOP;
  IF has_table_privilege('anon','public.candidate_action_plans','SELECT')
     OR has_table_privilege('anon','public.candidate_action_effects','SELECT')
     OR has_table_privilege('anon','public.candidate_action_messages','SELECT')
     OR has_table_privilege('authenticated','public.candidate_action_plans','INSERT')
     OR has_table_privilege('authenticated','public.candidate_action_effects','UPDATE') THEN RAISE EXCEPTION 'Table grants too broad'; END IF;
  checks:=checks+1;
  INSERT INTO auth.users(id,email,aud,role,instance_id,raw_user_meta_data)
    VALUES(ua,'a-'||ua::text||'@audit.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
      (up,'p-'||up::text||'@audit.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}'),
      (ub,'b-'||ub::text||'@audit.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}');
  INSERT INTO public.organizations(id,name,slug,created_by) VALUES(oa,'Actions audit A','actions-a-'||oa::text,ua),(ob,'Actions audit B','actions-b-'||ob::text,ub);
  INSERT INTO public.organization_members(organization_id,user_id,role) VALUES(oa,up,'member') ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET active_organization_id=oa WHERE user_id IN (ua,up);
  UPDATE public.profiles SET active_organization_id=ob WHERE user_id=ub;
  INSERT INTO public.sourcing_projects(id,name,organization_id,created_by) VALUES(pa,'Audit mission A',oa,ua),(pb,'Audit mission B',ob,ub);
  INSERT INTO public.job_candidate_status(candidate_id,job_id,project_id,organization_id,created_by)
    VALUES('ACTION-AUDIT-CAND','project:'||pa::text,pa,oa,ua),('ACTION-AUDIT-CAND','project:'||pb::text,pb,ob,ub);
  INSERT INTO public.member_email_accounts(organization_id,user_id,email_account_id,email_address,linked_by)
    VALUES(oa,ua,account_a,'a-'||ua::text||'@audit.test',ua),(oa,up,account_peer,'p-'||up::text||'@audit.test',up);
  scope_a:=jsonb_build_object('organization_id',oa,'candidate_id','ACTION-AUDIT-CAND','project_id',pa,'linkedin_url','https://www.linkedin.com/in/actions-audit');
  scope_b:=jsonb_build_object('organization_id',ob,'candidate_id','ACTION-AUDIT-CAND','project_id',pb);
  SET LOCAL ROLE service_role;
  proposed:=jsonb_build_object('id',plan_a,'scope',scope_a,'contextVersion','context-personal-a','intent','prepare_interview','title','Brief entretien','reason','Entretien confirmé','sources','[]'::jsonb,
    'effects',jsonb_build_array(
      jsonb_build_object('id',doc_a,'kind','document','documentType','interview_brief','label','Brief','destination','Notes candidat','content','Brief relu','dedupeKey','meeting-123-brief'),
      jsonb_build_object('id',msg_a,'kind','message','audience','candidate','channel','email','service','gmail','targetId','email-candidate','label','Réponse',
        'recipient','candidate@audit.test','senderAccountId',account_a,'senderAddress','a-'||ua::text||'@audit.test','content','Bonjour','dedupeKey','meeting-123-message'),
      jsonb_build_object('id',comment_a,'kind','comment','label','Commentaire d''équipe','destination','Commentaires candidat','content','Merci pour votre retour',
        'mentions',jsonb_build_array(up,ua,up),'dedupeKey','meeting-123-team-comment')));
  result:=public.candidate_actions_create_plan(ua,proposed);
  IF result->>'status'<>'draft' OR (result->>'revision')::integer<>1 OR jsonb_array_length(result->'effects')<>3 THEN RAISE EXCEPTION 'Invalid durable plan'; END IF;
  checks:=checks+1;
  result:=public.candidate_actions_create_plan(ua,proposed||jsonb_build_object('id',gen_random_uuid()));
  IF result->>'id'<>plan_a::text THEN RAISE EXCEPTION 'Repeated preparation duplicated plan'; END IF;
  checks:=checks+1;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_get_plan(ub,plan_a); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-author plan accessible'; END IF;
  checks:=checks+1;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_assert_scope(ua,oa,'ACTION-AUDIT-CAND',pb); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-org mission accepted'; END IF;
  checks:=checks+1;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_assert_scope(ua,oa,'OTHER-CANDIDATE',pa); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Unknown mission candidate accepted'; END IF;
  checks:=checks+1;
  result:=public.candidate_actions_save_drafts(ua,plan_a,1,jsonb_build_object(doc_a::text,jsonb_build_object('content','Brief modifié')));
  IF (result->>'revision')::integer<>2 THEN RAISE EXCEPTION 'Revision not advanced'; END IF;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_save_drafts(ua,plan_a,1,jsonb_build_object(doc_a::text,jsonb_build_object('content','Overwrite')));
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT; denied:=hint='ACTION_REVISION_CONFLICT'; END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale draft overwrote reviewed content'; END IF;
  checks:=checks+1;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_approve_plan(ua,plan_a,2,'different-context');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS hint=PG_EXCEPTION_HINT; denied:=hint='ACTION_CONTEXT_CHANGED'; END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale context approved'; END IF;
  checks:=checks+1;
  result:=public.candidate_actions_approve_plan(ua,plan_a,2,'context-personal-a');
  claim:=public.candidate_actions_claim_effect(ua,plan_a,doc_a); token:=(claim->>'claimToken')::uuid;
  IF NOT (claim->>'claimed')::boolean THEN RAISE EXCEPTION 'First effect not reserved'; END IF;
  IF (public.candidate_actions_claim_effect(ua,plan_a,doc_a)->>'claimed')::boolean THEN RAISE EXCEPTION 'Double claim'; END IF;
  result:=public.candidate_actions_write_internal_effect(ua,plan_a,doc_a,token);
  PERFORM public.candidate_actions_write_internal_effect(ua,plan_a,doc_a,token);
  PERFORM public.candidate_actions_complete_effect(ua,plan_a,doc_a,token,'failed',jsonb_build_object('errorCode','RECEIPT_NETWORK_LOST'));
  SELECT count(*) INTO n FROM public.candidate_action_effects WHERE id=doc_a AND status='succeeded';
  IF n<>1 THEN RAISE EXCEPTION 'Lost successful receipt was overwritten as failed'; END IF;
  checks:=checks+1;
  SELECT count(*) INTO n FROM public.candidate_notes WHERE id=doc_a;
  IF n<>1 THEN RAISE EXCEPTION 'Document write not idempotent'; END IF;
  checks:=checks+1;
  proposed:=jsonb_build_object('id',plan_peer,'scope',scope_a,'contextVersion','context-personal-peer','intent','prepare_interview','title','Brief entretien','reason','Entretien confirmé','sources','[]'::jsonb,
    'effects',jsonb_build_array(jsonb_build_object('id',doc_peer,'kind','document','documentType','interview_brief','label','Brief','destination','Notes candidat','content','Autre rédaction','dedupeKey','meeting-123-brief'),
      jsonb_build_object('id',msg_peer,'kind','message','audience','candidate','channel','email','service','gmail','targetId','email-candidate','label','Réponse',
        'recipient','candidate@audit.test','senderAccountId',account_peer,'senderAddress','p-'||up::text||'@audit.test','content','Bonjour autre acteur','dedupeKey','meeting-123-message')));
  PERFORM public.candidate_actions_create_plan(up,proposed);
  PERFORM public.candidate_actions_approve_plan(up,plan_peer,1,'context-personal-peer');
  claim:=public.candidate_actions_claim_effect(up,plan_peer,doc_peer);
  IF (claim->>'claimed')::boolean OR claim->'effect'->>'status'<>'skipped' OR claim->'effect'->'result'->>'referenceId'<>doc_a::text THEN
    RAISE EXCEPTION 'Cross-actor duplicate document not suppressed'; END IF;
  SELECT count(*) INTO n FROM public.candidate_notes WHERE id IN (doc_a,doc_peer);
  IF n<>1 THEN RAISE EXCEPTION 'Two actors wrote two briefs'; END IF;
  checks:=checks+1;
  claim:=public.candidate_actions_claim_effect(ua,plan_a,msg_a); token:=(claim->>'claimToken')::uuid;
  result:=public.candidate_actions_complete_effect(ua,plan_a,msg_a,token,'failed',jsonb_build_object('errorCode','MESSAGE_REJECTED'));
  IF result->>'status'<>'partial' THEN RAISE EXCEPTION 'Partial result incorrectly announced complete'; END IF;
  claim:=public.candidate_actions_claim_effect(ua,plan_a,msg_a); token2:=(claim->>'claimToken')::uuid;
  IF NOT (claim->>'claimed')::boolean OR token2=token THEN RAISE EXCEPTION 'Known failed message not independently retryable'; END IF;
  result:=public.candidate_actions_complete_effect(ua,plan_a,msg_a,token2,'unknown',jsonb_build_object('errorCode','SEND_UNKNOWN'));
  IF (public.candidate_actions_claim_effect(ua,plan_a,msg_a)->>'claimed')::boolean THEN RAISE EXCEPTION 'Ambiguous send was retried'; END IF;
  IF result->>'status'<>'partial' THEN RAISE EXCEPTION 'Unknown send incorrectly announced complete'; END IF;
  SELECT count(*) INTO n FROM public.candidate_notes WHERE id=doc_a;
  IF n<>1 THEN RAISE EXCEPTION 'Retry recreated successful document'; END IF;
  checks:=checks+1;
  claim:=public.candidate_actions_claim_effect(up,plan_peer,msg_peer);
  IF (claim->>'claimed')::boolean OR claim->'effect'->>'status'<>'unknown' THEN RAISE EXCEPTION 'Another actor retried an ambiguous send'; END IF;
  checks:=checks+1;
  RESET ROLE;
  INSERT INTO public.organization_members(organization_id,user_id,role) VALUES(ob,ua,'member');
  UPDATE public.profiles SET active_organization_id=ob WHERE user_id=ua;
  -- get_user_org_id caches per transaction; a real subsequent API request has
  -- a fresh transaction, so clear that local cache in this rollback-only audit.
  PERFORM set_config('app.user_org.u_'||replace(ua::text,'-','_'),'',true);
  SET LOCAL ROLE service_role;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_claim_effect(ua,plan_a,msg_a); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Claim retained access after active organization changed'; END IF;
  checks:=checks+1;
  RESET ROLE;
  UPDATE public.profiles SET active_organization_id=oa WHERE user_id=ua;
  PERFORM set_config('app.user_org.u_'||replace(ua::text,'-','_'),'',true);
  DELETE FROM public.organization_members WHERE organization_id=ob AND user_id=ua;
  DELETE FROM public.organization_members WHERE organization_id=oa AND user_id=up;
  SET LOCAL ROLE service_role;
  denied:=false;
  BEGIN PERFORM public.candidate_actions_claim_effect(up,plan_peer,msg_peer); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Claim retained access after member removal'; END IF;
  checks:=checks+1;
  RESET ROLE;
  INSERT INTO public.organization_members(organization_id,user_id,role) VALUES(oa,up,'member');
  SET LOCAL ROLE service_role;
  claim:=public.candidate_actions_claim_effect(ua,plan_a,comment_a); token:=(claim->>'claimToken')::uuid;
  PERFORM public.candidate_actions_write_internal_effect(ua,plan_a,comment_a,token);
  PERFORM public.candidate_actions_write_internal_effect(ua,plan_a,comment_a,token);
  SELECT count(*) INTO n FROM public.notifications WHERE organization_id=oa AND metadata->>'candidate_action_effect_id'=comment_a::text AND user_id=up;
  IF n<>1 THEN RAISE EXCEPTION 'Mention notification missing or duplicated'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE metadata->>'candidate_action_effect_id'=comment_a::text AND user_id=ua;
  IF n<>0 THEN RAISE EXCEPTION 'Author notified himself'; END IF;
  checks:=checks+1;
  proposed:=jsonb_build_object('id',plan_b,'scope',scope_b,'contextVersion','context-b','intent','prepare_interview','title','Other tenant','reason','Same LinkedIn identity','sources','[]'::jsonb,
    'effects',jsonb_build_array(jsonb_build_object('id',doc_b,'kind','document','documentType','interview_brief','label','Brief','destination','Notes candidat','content','Org B','dedupeKey','meeting-123-brief')));
  PERFORM public.candidate_actions_create_plan(ub,proposed);
  PERFORM public.candidate_actions_approve_plan(ub,plan_b,1,'context-b');
  claim:=public.candidate_actions_claim_effect(ub,plan_b,doc_b);
  IF NOT (claim->>'claimed')::boolean THEN RAISE EXCEPTION 'Different tenant dedupe collision'; END IF;
  checks:=checks+1;
  -- A confirmed explicit action publishes its receipt; imported outgoing history
  -- and an in-flight/ambiguous action remain personal even on the same mission.
  proposed:=jsonb_build_object('id',gen_random_uuid(),'scope',scope_a,'contextVersion','context-published-action','intent','prepare_reply','title','Réponse publiée','reason','Question candidat','sources','[]'::jsonb,
    'effects',jsonb_build_array(jsonb_build_object('id',msg_success,'kind','message','audience','candidate','channel','email','service','gmail','targetId','email-candidate','label','Réponse',
      'recipient','candidate@audit.test','senderAccountId',account_a,'senderAddress','a-'||ua::text||'@audit.test','content','Message confirmé','dedupeKey','new-question-message')));
  result:=public.candidate_actions_create_plan(ua,proposed);
  token2:=(result->>'id')::uuid;
  PERFORM public.candidate_actions_approve_plan(ua,token2,1,'context-published-action');
  claim:=public.candidate_actions_claim_effect(ua,token2,msg_success); token:=(claim->>'claimToken')::uuid;
  INSERT INTO public.candidate_action_messages(organization_id,candidate_id,project_id,owner_user_id,account_id,channel,service,audience,direction,provider_message_id,counterpart,sender,recipient,content,occurred_at)
    VALUES(oa,'ACTION-AUDIT-CAND',pa,ua,account_a,'email','gmail','candidate','inbound','audit-private-'||ua::text,'candidate@audit.test','candidate@audit.test','owner@audit.test','Private incoming',now()),
      (oa,'ACTION-AUDIT-CAND',pa,ua,account_a,'email','gmail','candidate','outbound','audit-history-'||ua::text,'candidate@audit.test','owner@audit.test','candidate@audit.test','Private imported outgoing',now());
  INSERT INTO public.candidate_action_messages(organization_id,candidate_id,project_id,owner_user_id,account_id,channel,service,audience,direction,provider_message_id,counterpart,sender,recipient,content,occurred_at,action_plan_id,effect_id)
    VALUES(oa,'ACTION-AUDIT-CAND',pa,ua,account_a,'email','gmail','candidate','outbound','audit-shared-'||ua::text,'candidate@audit.test','a-'||ua::text||'@audit.test','candidate@audit.test','Confirmed outgoing',now(),token2,msg_success),
      (oa,'ACTION-AUDIT-CAND',pa,ua,account_a,'email','gmail','candidate','outbound','audit-unknown-'||ua::text,'candidate@audit.test','a-'||ua::text||'@audit.test','candidate@audit.test','Unknown outgoing',now(),plan_a,msg_a);
  PERFORM public.candidate_actions_complete_effect(ua,token2,msg_success,token,'succeeded',jsonb_build_object('providerId','audit-shared-'||ua::text));
  SELECT count(*) INTO n FROM public.candidate_action_messages WHERE provider_message_id='audit-shared-'||ua::text AND action_completed_at IS NOT NULL;
  IF n<>1 THEN RAISE EXCEPTION 'Successful receipt was not published atomically'; END IF;
  checks:=checks+1;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',up,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',up::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.candidate_action_plans WHERE id=plan_a;
  IF n<>0 THEN RAISE EXCEPTION 'Peer read private draft/source snapshot'; END IF;
  SELECT count(*) INTO n FROM public.candidate_action_messages WHERE provider_message_id='audit-private-'||ua::text;
  IF n<>0 THEN RAISE EXCEPTION 'Peer read personal incoming mailbox'; END IF;
  SELECT count(*) INTO n FROM public.candidate_action_messages WHERE provider_message_id IN ('audit-history-'||ua::text,'audit-unknown-'||ua::text);
  IF n<>0 THEN RAISE EXCEPTION 'Peer read imported or ambiguous outgoing mailbox'; END IF;
  SELECT count(*) INTO n FROM public.candidate_action_messages WHERE provider_message_id='audit-shared-'||ua::text;
  IF n<>1 THEN RAISE EXCEPTION 'Authorized mission outgoing not shared'; END IF;
  denied:=false;
  BEGIN UPDATE public.candidate_action_effects SET status='succeeded' WHERE id=doc_peer; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Browser forged successful effect'; END IF;
  checks:=checks+1;
  RESET ROLE;
  -- An external recruiter may read the mission through its existing RLS, but
  -- that invitation does not grant access to another organization's candidates.
  INSERT INTO public.mission_team(project_id,user_id,role) VALUES(pa,ub,'freelance');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ub,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',ub::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.sourcing_projects WHERE id=pa;
  IF n<>1 THEN RAISE EXCEPTION 'External invitation fixture does not have its intended mission access'; END IF;
  SELECT count(*) INTO n FROM public.candidate_action_messages WHERE organization_id=oa;
  IF n<>0 THEN RAISE EXCEPTION 'External mission invitation exposed another organization candidate journal'; END IF;
  checks:=checks+1;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  result:=public.candidate_actions_purge(oa,ARRAY['ACTION-AUDIT-CAND'],NULL,NULL);
  SELECT count(*) INTO n FROM public.candidate_action_plans WHERE organization_id=oa AND candidate_id='ACTION-AUDIT-CAND';
  IF n<>0 THEN RAISE EXCEPTION 'GDPR retained drafts/sources'; END IF;
  SELECT count(*) INTO n FROM public.candidate_action_messages WHERE organization_id=oa AND candidate_id='ACTION-AUDIT-CAND';
  IF n<>0 THEN RAISE EXCEPTION 'GDPR retained message bodies'; END IF;
  SELECT count(*) INTO n FROM public.candidate_notes WHERE id=doc_a;
  IF n<>0 THEN RAISE EXCEPTION 'GDPR retained produced note'; END IF;
  SELECT count(*) INTO n FROM public.candidate_comments WHERE id=comment_a;
  IF n<>0 THEN RAISE EXCEPTION 'GDPR retained produced comment'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE metadata->>'candidate_action_effect_id'=comment_a::text;
  IF n<>0 THEN RAISE EXCEPTION 'GDPR retained produced mention notification'; END IF;
  SELECT count(*) INTO n FROM public.candidate_action_plans WHERE id=plan_b;
  IF n<>1 THEN RAISE EXCEPTION 'GDPR crossed tenant'; END IF;
  checks:=checks+1;
  RESET ROLE;
  RAISE NOTICE 'candidate_actions_audit: % checks passed',checks;
END $audit$;
ROLLBACK;
