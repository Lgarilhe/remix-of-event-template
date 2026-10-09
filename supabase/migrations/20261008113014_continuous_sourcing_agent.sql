-- Continuous sourcing: opt-in discovery/evaluation only. No outreach or ATS
-- stage writes. All mutations use actor checks and a versioned, fenced lease.
CREATE TABLE public.sourcing_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'pool' CHECK (source IN ('linkedin','pool')),
  account_id text,
  api text CHECK (api IN ('classic','recruiter','sales_navigator')),
  settings jsonb NOT NULL DEFAULT '{"cadence_hours":6,"daily_profile_limit":20,"daily_credit_limit":100,"max_pending":10,"min_score":70,"model_id":"claude-sonnet-5-5"}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calibrating','active','paused','blocked','awaiting_review','stopped')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  approved_context_key text,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context_snapshot) = 'object'),
  search_filters_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(search_filters_snapshot) = 'object'),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_reason text CHECK (last_reason ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  last_error text CHECK (last_error ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  daily_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  profiles_used integer NOT NULL DEFAULT 0 CHECK (profiles_used >= 0),
  credits_reserved numeric(14,4) NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  credits_used numeric(14,4) NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_id),
  UNIQUE (id, organization_id, project_id, created_by),
  CHECK ((source = 'pool' AND account_id IS NULL AND api IS NULL)
    OR (source = 'linkedin' AND nullif(btrim(account_id),'') IS NOT NULL AND api IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (jsonb_typeof(settings) = 'object'
    AND settings ?& ARRAY['cadence_hours','daily_profile_limit','daily_credit_limit','max_pending','min_score','model_id']
    AND (settings->>'cadence_hours')::integer IN (2,6,12,24)
    AND (settings->>'daily_profile_limit')::integer BETWEEN 5 AND 100
    AND (settings->>'daily_credit_limit')::numeric BETWEEN 12 AND 500
    AND (settings->>'max_pending')::integer BETWEEN 5 AND 50
    AND (settings->>'min_score')::numeric BETWEEN 0 AND 100
    AND settings->>'model_id' IN ('claude-haiku-4-5','claude-sonnet-4-5','claude-sonnet-4-6','claude-opus-4-6','claude-sonnet-5-5','claude-opus-5-5'))
);
CREATE INDEX sourcing_agents_due ON public.sourcing_agents (next_run_at, id)
  WHERE status IN ('calibrating','active');
CREATE INDEX sourcing_agents_actor ON public.sourcing_agents (created_by, organization_id);

CREATE TABLE public.sourcing_agent_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_by uuid NOT NULL,
  person_key text NOT NULL CHECK (length(person_key) BETWEEN 3 AND 500),
  candidate_id text NOT NULL CHECK (length(candidate_id) BETWEEN 1 AND 500),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  score numeric CHECK (score BETWEEN 0 AND 100),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  context_key text NOT NULL CHECK (length(context_key) BETWEEN 1 AND 200000),
  state text NOT NULL DEFAULT 'discovered' CHECK (state IN ('discovered','scored','proposed','reviewed','skipped')),
  decision text CHECK (decision IN ('fit','reject')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 5 AND 1000),
  source_aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_aliases) = 'array'),
  credits_reserved numeric(14,4) NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  credits_used numeric(14,4) NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, person_key),
  FOREIGN KEY (agent_id, organization_id, project_id, created_by)
    REFERENCES public.sourcing_agents(id, organization_id, project_id, created_by) ON DELETE CASCADE,
  CHECK ((state = 'reviewed' AND decision IS NOT NULL AND reason IS NOT NULL)
    OR (state <> 'reviewed' AND decision IS NULL AND reason IS NULL))
);
CREATE INDEX sourcing_agent_candidates_pending ON public.sourcing_agent_candidates (agent_id, context_key, state);
CREATE INDEX sourcing_agent_candidates_org ON public.sourcing_agent_candidates (organization_id, project_id);
CREATE INDEX sourcing_agent_candidates_aliases ON public.sourcing_agent_candidates USING gin (source_aliases);

-- Opaque opposition keys outlive deleted profile copies. Neither identity nor
-- reference text is retained or exposed to browser roles.
CREATE TABLE public.sourcing_agent_reference_erasures (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reference_key text NOT NULL CHECK (reference_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,reference_key)
);
ALTER TABLE public.sourcing_agent_reference_erasures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sourcing_agent_reference_erasures FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sourcing_agent_reference_erasures TO service_role;

-- Browser helper stays invoker: it never borrows privileged access to a mission.
CREATE FUNCTION public.can_read_sourcing_agent(p_organization_id uuid, p_project_id uuid, p_created_by uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    JOIN public.sourcing_projects p ON p.id = p_project_id AND p.organization_id = m.organization_id
    WHERE m.user_id = (SELECT auth.uid()) AND m.organization_id = p_organization_id
      AND ((m.role::text IN ('owner','admin')) OR
        (p_created_by = (SELECT auth.uid()) AND
          (m.role::text <> 'collaborator' OR p.created_by = (SELECT auth.uid()))))
  );
$$;
ALTER TABLE public.sourcing_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_agent_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_agents_read ON public.sourcing_agents FOR SELECT TO authenticated
  USING (public.can_read_sourcing_agent(organization_id, project_id, created_by));
CREATE POLICY sourcing_agent_candidates_read ON public.sourcing_agent_candidates FOR SELECT TO authenticated
  USING (public.can_read_sourcing_agent(organization_id, project_id, created_by));
REVOKE ALL ON public.sourcing_agents, public.sourcing_agent_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sourcing_agents, public.sourcing_agent_candidates TO authenticated;
GRANT ALL ON public.sourcing_agents, public.sourcing_agent_candidates TO service_role;
REVOKE ALL ON FUNCTION public.can_read_sourcing_agent(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_sourcing_agent(uuid,uuid,uuid) TO authenticated, service_role;

-- No browser mutation accepts an actor, an approved context, or a lease.
CREATE FUNCTION public.assert_sourcing_agent_actor(
  p_user_id uuid, p_project_id uuid, p_require_active_space boolean DEFAULT false
) RETURNS public.sourcing_projects LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.sourcing_projects; actor_role text;
BEGIN
  IF current_user <> 'service_role' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Verified server actor required' USING ERRCODE='42501', HINT='SOURCING_AGENT_FORBIDDEN';
  END IF;
  SELECT * INTO p FROM public.sourcing_projects WHERE id = p_project_id;
  IF NOT FOUND OR p.kind IS DISTINCT FROM 'mission' THEN RAISE EXCEPTION 'Mission unavailable' USING ERRCODE='42501', HINT='SOURCING_AGENT_FORBIDDEN'; END IF;
  SELECT role::text INTO actor_role FROM public.organization_members
    WHERE organization_id = p.organization_id AND user_id = p_user_id;
  IF NOT FOUND OR (actor_role = 'collaborator' AND p.created_by IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'Actor cannot access this mission' USING ERRCODE='42501', HINT='SOURCING_AGENT_FORBIDDEN';
  END IF;
  IF p_require_active_space AND NOT EXISTS (SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id AND active_organization_id = p.organization_id) THEN
    RAISE EXCEPTION 'Active space differs' USING ERRCODE='42501', HINT='SOURCING_AGENT_FORBIDDEN';
  END IF;
  RETURN p;
END;
$$;

CREATE FUNCTION public.mutate_sourcing_agent(
  p_user_id uuid, p_project_id uuid, p_expected_revision integer, p_action text, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.sourcing_projects; a public.sourcing_agents; actor_role text; settings_value jsonb;
  review_count integer; fit_count integer; key_value text; refs jsonb; c public.sourcing_agent_candidates; human_reason text;
BEGIN
  p := public.assert_sourcing_agent_actor(p_user_id,p_project_id,true);
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid payload' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.sourcing_agents WHERE organization_id=p.organization_id AND project_id=p.id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action <> 'configure' OR coalesce(p_expected_revision,0) <> 0 THEN
      RAISE EXCEPTION 'Agent not configured' USING ERRCODE='40001', HINT='SOURCING_AGENT_REVISION';
    END IF;
    INSERT INTO public.sourcing_agents(organization_id,project_id,created_by) VALUES(p.organization_id,p.id,p_user_id)
      ON CONFLICT (organization_id,project_id) DO NOTHING RETURNING * INTO a;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Configuration changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_REVISION'; END IF;
  ELSE
    SELECT role::text INTO actor_role FROM public.organization_members WHERE organization_id=p.organization_id AND user_id=p_user_id;
    IF a.created_by <> p_user_id AND actor_role NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'Agent belongs to another actor' USING ERRCODE='42501', HINT='SOURCING_AGENT_FORBIDDEN';
    END IF;
    IF a.revision IS DISTINCT FROM p_expected_revision THEN
      RAISE EXCEPTION 'Configuration changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_REVISION';
    END IF;
  END IF;
  IF p_action IN ('configure','start_calibration','approve_calibration','activate','resume') AND p.status <> 'active' THEN
    RAISE EXCEPTION 'Mission inactive' USING ERRCODE='22023', HINT='SOURCING_AGENT_MISSION_INACTIVE';
  END IF;
  IF p_action IN ('configure','start_calibration','approve_calibration','activate','resume') AND EXISTS (
    SELECT 1 FROM public.sourcing_agent_candidates pending WHERE pending.agent_id=a.id AND pending.state='discovered'
      AND (pending.credits_reserved>0 OR pending.provenance ? 'scoring_started_at' OR pending.provenance ? 'reservation_recovered')) THEN
    RAISE EXCEPTION 'Resolve uncertain evaluation first' USING ERRCODE='22023', HINT='SOURCING_AGENT_SCORING_UNCERTAIN';
  END IF;
  IF p_action = 'configure' THEN
    settings_value := a.settings || coalesce(p_payload->'settings','{}'::jsonb);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(settings_value) k WHERE k NOT IN
      ('cadence_hours','daily_profile_limit','daily_credit_limit','max_pending','min_score','model_id')) THEN
      RAISE EXCEPTION 'Unknown settings' USING ERRCODE='22023';
    END IF;
    a.source := coalesce(p_payload->>'source',a.source);
    a.account_id := CASE WHEN a.source='pool' THEN NULL ELSE coalesce(p_payload->>'account_id',a.account_id) END;
    a.api := CASE WHEN a.source='pool' THEN NULL ELSE coalesce(p_payload->>'api',a.api) END;
    IF a.source='linkedin' AND NOT EXISTS (SELECT 1 FROM public.member_linkedin_accounts
      WHERE organization_id=a.organization_id AND user_id=a.created_by AND linkedin_account_id=a.account_id) THEN
      RAISE EXCEPTION 'Account not assigned to actor' USING ERRCODE='42501', HINT='SOURCING_AGENT_ACCOUNT_FORBIDDEN';
    END IF;
    UPDATE public.sourcing_agents SET source=a.source,account_id=a.account_id,api=a.api,settings=settings_value,
      status='draft',approved_context_key=NULL,context_snapshot='{}',search_filters_snapshot='{}',checkpoint='{}',
      revision=CASE WHEN p_expected_revision IS NULL OR p_expected_revision=0 THEN revision ELSE revision+1 END,
      lease_token=NULL,lease_until=NULL,last_reason='CALIBRATION_REQUIRED',last_error=NULL,updated_at=now()
      WHERE id=a.id RETURNING * INTO a;
  ELSIF p_action='start_calibration' THEN
    key_value := p_payload->'context_snapshot'->>'context_key';
    IF nullif(key_value,'') IS NULL OR jsonb_typeof(p_payload->'context_snapshot')<>'object' THEN
      RAISE EXCEPTION 'Verified context required' USING ERRCODE='22023', HINT='SOURCING_AGENT_CONTEXT_REQUIRED';
    END IF;
    UPDATE public.sourcing_agents SET status='calibrating',approved_context_key=NULL,
      context_snapshot=p_payload->'context_snapshot',search_filters_snapshot=coalesce(p_payload->'search_filters_snapshot','{}'),
      checkpoint='{}',next_run_at=now(),revision=revision+1,lease_token=NULL,lease_until=NULL,
      last_reason='CALIBRATION_REQUIRED',last_error=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  ELSIF p_action IN ('approve_calibration','activate') THEN
    SELECT count(*),count(*) FILTER (WHERE decision='fit') INTO review_count,fit_count
      FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND state='reviewed'
        AND context_key=a.context_snapshot->>'context_key';
    IF review_count<3 OR fit_count<1 THEN
      RAISE EXCEPTION 'Three reasoned reviews including a fit required' USING ERRCODE='22023', HINT='SOURCING_AGENT_CALIBRATION_REQUIRED';
    END IF;
    key_value := p_payload->>'approved_context_key';
    IF nullif(key_value,'') IS NULL OR key_value IS DISTINCT FROM p_payload->'context_snapshot'->>'context_key' THEN
      RAISE EXCEPTION 'Verified context required' USING ERRCODE='22023', HINT='SOURCING_AGENT_CONTEXT_REQUIRED';
    END IF;
    SELECT * INTO p FROM public.sourcing_projects WHERE id=p_project_id FOR UPDATE;
    IF p_payload ? 'calibration_profiles' THEN
      refs := p_payload->'calibration_profiles';
      IF jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)>5 OR p.job_details IS DISTINCT FROM p_payload->'expected_job_details' THEN
        RAISE EXCEPTION 'Brief changed or references invalid' USING ERRCODE='40001', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
      END IF;
      UPDATE public.sourcing_projects SET job_details=coalesce(job_details,'{}'::jsonb)||jsonb_build_object('calibration_profiles',refs)
        WHERE id=p.id AND organization_id=a.organization_id;
    END IF;
    UPDATE public.sourcing_agents SET status='active',approved_context_key=key_value,
      context_snapshot=p_payload->'context_snapshot',search_filters_snapshot=coalesce(p_payload->'search_filters_snapshot',search_filters_snapshot),
      checkpoint='{}',next_run_at=now(),revision=revision+1,lease_token=NULL,lease_until=NULL,
      last_reason=NULL,last_error=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  ELSIF p_action='resume' THEN
    IF a.approved_context_key IS NULL OR a.approved_context_key IS DISTINCT FROM p_payload->>'approved_context_key'
      OR a.approved_context_key IS DISTINCT FROM a.context_snapshot->>'context_key' THEN
      RAISE EXCEPTION 'Context must be approved' USING ERRCODE='22023', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
    END IF;
    UPDATE public.sourcing_agents SET status='active',next_run_at=now(),revision=revision+1,
      lease_token=NULL,lease_until=NULL,last_reason=NULL,last_error=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  ELSIF p_action='skip_uncertain' THEN
    IF a.created_by<>p_user_id THEN RAISE EXCEPTION 'Resolution belongs to another actor' USING ERRCODE='42501', HINT='SOURCING_AGENT_FORBIDDEN'; END IF;
    key_value:=p_payload->>'context_key'; human_reason:=btrim(p_payload->>'reason');
    IF nullif(key_value,'') IS NULL THEN
      RAISE EXCEPTION 'Resolution context changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
    END IF;
    IF human_reason IS NULL OR length(human_reason) NOT BETWEEN 5 AND 1000 THEN
      RAISE EXCEPTION 'Reasoned human resolution required' USING ERRCODE='22023';
    END IF;
    SELECT * INTO c FROM public.sourcing_agent_candidates WHERE id=(p_payload->>'candidate_id')::uuid AND agent_id=a.id FOR UPDATE;
    IF NOT FOUND OR c.context_key IS DISTINCT FROM key_value OR c.state<>'discovered'
      OR NOT (c.credits_reserved>0 OR c.provenance ? 'scoring_started_at' OR c.provenance ? 'reservation_recovered') THEN
      RAISE EXCEPTION 'Candidate is not an uncertain evaluation' USING ERRCODE='40001', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
    END IF;
    IF c.credits_reserved>a.credits_reserved THEN RAISE EXCEPTION 'Reservation changed' USING ERRCODE='40001'; END IF;
    UPDATE public.sourcing_agent_candidates SET state='skipped',score=NULL,result='{}',credits_reserved=0,
      credits_used=credits_used+c.credits_reserved,provenance=provenance||jsonb_build_object(
        'skip_reason','HUMAN_SKIP_UNCERTAIN','human_skip_reason',human_reason,'skipped_by',p_user_id,'skipped_at',now()),
      updated_at=now() WHERE id=c.id;
    UPDATE public.sourcing_agents SET status='paused',revision=revision+1,lease_token=NULL,lease_until=NULL,
      credits_reserved=credits_reserved-c.credits_reserved,credits_used=credits_used+c.credits_reserved,
      last_reason='USER_PAUSED',last_error=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  ELSIF p_action IN ('pause','stop','block') THEN
    UPDATE public.sourcing_agents SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'stop' THEN 'stopped' ELSE 'blocked' END,
      revision=revision+1,lease_token=NULL,lease_until=NULL,
      last_reason=coalesce(p_payload->>'last_reason',CASE p_action WHEN 'pause' THEN 'USER_PAUSED' WHEN 'stop' THEN 'USER_STOPPED' ELSE 'RETRY_LATER' END),
      updated_at=now() WHERE id=a.id RETURNING * INTO a;
  ELSE RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
  END IF;
  RETURN to_jsonb(a);
END;
$$;

CREATE FUNCTION public.claim_sourcing_agent()
RETURNS SETOF public.sourcing_agents LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents; p public.sourcing_projects;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Server role required' USING ERRCODE='42501'; END IF;
  FOR a IN SELECT * FROM public.sourcing_agents s WHERE s.status IN ('calibrating','active') AND s.next_run_at<=now()
    AND (s.lease_until IS NULL OR s.lease_until<=now()) ORDER BY s.next_run_at,s.id FOR UPDATE SKIP LOCKED LIMIT 10
  LOOP
    BEGIN p:=public.assert_sourcing_agent_actor(a.created_by,a.project_id,false);
    EXCEPTION WHEN insufficient_privilege THEN
      UPDATE public.sourcing_agents SET status='blocked',last_reason='ACCESS_REVOKED',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=a.id;
      CONTINUE;
    END;
    IF p.status<>'active' THEN
      UPDATE public.sourcing_agents SET status='paused',last_reason='MISSION_INACTIVE',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=a.id;
      CONTINUE;
    END IF;
    IF (a.status='active' AND (SELECT count(*) FROM public.sourcing_agent_candidates c WHERE c.agent_id=a.id
        AND c.context_key=a.context_snapshot->>'context_key' AND c.state='proposed') >= (a.settings->>'max_pending')::integer)
      OR (a.status='calibrating' AND (SELECT count(*) FROM public.sourcing_agent_candidates c WHERE c.agent_id=a.id
        AND c.context_key=a.context_snapshot->>'context_key' AND c.state IN ('scored','proposed','reviewed'))>=5) THEN
      UPDATE public.sourcing_agents SET status='awaiting_review',last_reason='WAITING_REVIEW',updated_at=now() WHERE id=a.id;
      CONTINUE;
    END IF;
    -- An expired/invalidated worker cannot settle after the new lease. Account
    -- for its outstanding reservation conservatively once, rather than making
    -- a crash or pause leave the budget locked forever or refund unknown costs.
    IF a.credits_reserved>0 THEN
      UPDATE public.sourcing_agent_candidates SET credits_used=credits_used+credits_reserved,
        credits_reserved=0,provenance=provenance||'{"reservation_recovered":"ESTIMATED_AFTER_LEASE"}'::jsonb,updated_at=now()
        WHERE agent_id=a.id AND credits_reserved>0;
      UPDATE public.sourcing_agents SET credits_used=credits_used+credits_reserved,credits_reserved=0,updated_at=now()
        WHERE id=a.id RETURNING * INTO a;
    END IF;
    UPDATE public.sourcing_agents SET lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',last_run_at=now(),updated_at=now()
      WHERE id=a.id RETURNING * INTO a;
    RETURN NEXT a;
    RETURN;
  END LOOP;
END;
$$;

CREATE FUNCTION public.sourcing_agent_assert_lease(p_agent_id uuid,p_lease_token uuid)
RETURNS public.sourcing_agents LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents; p public.sourcing_projects;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Server role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.sourcing_agents WHERE id=p_agent_id FOR UPDATE;
  IF NOT FOUND OR p_lease_token IS NULL OR a.lease_token IS DISTINCT FROM p_lease_token
    OR a.lease_until<=now() OR a.status NOT IN ('calibrating','active') THEN
    RAISE EXCEPTION 'Stale lease' USING ERRCODE='40001', HINT='SOURCING_AGENT_STALE_LEASE';
  END IF;
  p:=public.assert_sourcing_agent_actor(a.created_by,a.project_id,false);
  IF p.status<>'active' THEN RAISE EXCEPTION 'Mission inactive' USING ERRCODE='40001', HINT='SOURCING_AGENT_MISSION_INACTIVE'; END IF;
  IF a.source='linkedin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.member_linkedin_accounts WHERE organization_id=a.organization_id
      AND user_id=a.created_by AND linkedin_account_id=a.account_id) THEN
      RAISE EXCEPTION 'Account no longer assigned to actor' USING ERRCODE='42501',HINT='SOURCING_AGENT_ACCOUNT_FORBIDDEN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.member_linkedin_accounts WHERE organization_id=a.organization_id
      AND user_id=a.created_by AND linkedin_account_id=a.account_id AND upper(account_status) IN ('OK','CONNECTED')) THEN
      RAISE EXCEPTION 'Account must reconnect' USING ERRCODE='42501',HINT='SOURCING_AGENT_ACCOUNT_RECONNECT';
    END IF;
  END IF;
  RETURN a;
END;
$$;

CREATE FUNCTION public.sourcing_agent_checkpoint(p_agent_id uuid,p_lease_token uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents;
BEGIN
  a:=public.sourcing_agent_assert_lease(p_agent_id,p_lease_token);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k
    WHERE k NOT IN ('revision','status','checkpoint','next_run_at','last_reason','last_error','context_key')) THEN
    RAISE EXCEPTION 'Unknown checkpoint field' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'revision' AND (p_patch->>'revision')::integer<>a.revision THEN
    RAISE EXCEPTION 'Revision changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_REVISION';
  END IF;
  IF p_patch ? 'context_key' AND p_patch->>'context_key' IS DISTINCT FROM a.context_snapshot->>'context_key' THEN
    RAISE EXCEPTION 'Context changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
  END IF;
  IF p_patch ? 'status' AND p_patch->>'status' NOT IN ('calibrating','active','blocked','awaiting_review','paused','stopped') THEN
    RAISE EXCEPTION 'Invalid worker state' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'status' AND p_patch->>'status' IN ('active','calibrating') AND p_patch->>'status'<>a.status THEN
    RAISE EXCEPTION 'Worker cannot activate or restart calibration' USING ERRCODE='42501';
  END IF;
  UPDATE public.sourcing_agents SET status=coalesce(p_patch->>'status',status),
    checkpoint=coalesce(p_patch->'checkpoint',checkpoint),next_run_at=coalesce((p_patch->>'next_run_at')::timestamptz,next_run_at),
    last_reason=CASE WHEN p_patch ? 'last_reason' THEN p_patch->>'last_reason' ELSE last_reason END,
    last_error=CASE WHEN p_patch ? 'last_error' THEN p_patch->>'last_error' ELSE last_error END,
    lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  RETURN to_jsonb(a);
END;
$$;

CREATE FUNCTION public.reserve_sourcing_agent_budget(p_agent_id uuid,p_lease_token uuid,p_profile_count integer,p_credits numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents; today date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
  a:=public.sourcing_agent_assert_lease(p_agent_id,p_lease_token);
  IF p_profile_count IS NULL OR p_credits IS NULL OR p_profile_count<0 OR p_credits<0 OR p_credits>500 OR p_profile_count>100 THEN
    RAISE EXCEPTION 'Invalid reservation' USING ERRCODE='22023';
  END IF;
  IF a.daily_date<>today THEN
    -- In-flight reservations survive midnight; they cannot disappear before settlement.
    UPDATE public.sourcing_agents SET daily_date=today,profiles_used=0,credits_used=0,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  END IF;
  IF a.profiles_used+p_profile_count>(a.settings->>'daily_profile_limit')::integer
    OR a.credits_used+a.credits_reserved+p_credits>(a.settings->>'daily_credit_limit')::numeric THEN RETURN false; END IF;
  UPDATE public.sourcing_agents SET profiles_used=profiles_used+p_profile_count,credits_reserved=credits_reserved+p_credits,updated_at=now() WHERE id=a.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.release_sourcing_agent_budget(p_agent_id uuid,p_lease_token uuid,p_credits numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents;
BEGIN
  a:=public.sourcing_agent_assert_lease(p_agent_id,p_lease_token);
  IF p_credits IS NULL OR p_credits<0 OR p_credits>a.credits_reserved THEN RAISE EXCEPTION 'Invalid release' USING ERRCODE='22023'; END IF;
  UPDATE public.sourcing_agents SET credits_reserved=credits_reserved-p_credits,updated_at=now() WHERE id=a.id;
  RETURN true;
END;
$$;

-- Discovery and erasure share one short transaction lock. Acquire it before
-- agent/candidate row locks so an erasure cannot miss an uncommitted new row.
-- Human reviews and budget settlement do not change stored profile identity.
CREATE FUNCTION public.sourcing_agent_privacy_lock()
RETURNS void LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('continuous-sourcing-privacy',0));
$$;
REVOKE ALL ON FUNCTION public.sourcing_agent_privacy_lock() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sourcing_agent_privacy_lock() TO service_role;

CREATE FUNCTION public.sourcing_agent_candidate_write(p_agent_id uuid,p_lease_token uuid,p_person_key text,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents; c public.sourcing_agent_candidates; next_state text; reserved numeric; used numeric; aliases text[];
BEGIN
  PERFORM public.sourcing_agent_privacy_lock();
  a:=public.sourcing_agent_assert_lease(p_agent_id,p_lease_token);
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k
    WHERE k NOT IN ('candidate_id','profile','score','result','provenance','context_key','state','source_aliases','credits_reserved','credits_used')) THEN
    RAISE EXCEPTION 'Unknown candidate field' USING ERRCODE='22023';
  END IF;
  IF p_patch->>'context_key' IS DISTINCT FROM a.context_snapshot->>'context_key' OR nullif(p_patch->>'context_key','') IS NULL THEN
    RAISE EXCEPTION 'Context changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
  END IF;
  IF p_patch ? 'source_aliases' AND (jsonb_typeof(p_patch->'source_aliases')<>'array'
    OR jsonb_array_length(p_patch->'source_aliases')>20 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch->'source_aliases') v
      WHERE jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 500)) THEN
    RAISE EXCEPTION 'Invalid person aliases' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(v),'{}'::text[]) INTO aliases FROM jsonb_array_elements_text(coalesce(p_patch->'source_aliases','[]')) v;
  SELECT * INTO c FROM public.sourcing_agent_candidates WHERE agent_id=a.id
    AND (person_key=p_person_key OR source_aliases ?| aliases)
    ORDER BY (person_key=p_person_key) DESC,created_at LIMIT 1 FOR UPDATE;
  IF c.id IS NOT NULL AND c.state='discovered' AND c.context_key IS DISTINCT FROM p_patch->>'context_key'
    AND (c.credits_reserved>0 OR c.provenance ? 'scoring_started_at' OR c.provenance ? 'reservation_recovered') THEN
    RAISE EXCEPTION 'Resolve uncertain evaluation first' USING ERRCODE='40001', HINT='SOURCING_AGENT_SCORING_UNCERTAIN';
  END IF;
  next_state:=coalesce(p_patch->>'state',c.state,'discovered');
  IF next_state='reviewed' THEN RAISE EXCEPTION 'Human review required' USING ERRCODE='42501'; END IF;
  IF c.id IS NOT NULL AND c.state='reviewed' AND (c.decision='reject' OR c.context_key=p_patch->>'context_key') THEN RETURN to_jsonb(c); END IF;
  IF c.id IS NOT NULL AND c.state='skipped' AND c.provenance->>'skip_reason'='HUMAN_SKIP_UNCERTAIN' THEN RETURN to_jsonb(c); END IF;
  IF c.id IS NOT NULL AND c.context_key=p_patch->>'context_key' AND c.state IN ('scored','proposed','skipped')
    AND (next_state='discovered' OR p_patch ? 'credits_reserved') THEN RETURN to_jsonb(c); END IF;
  IF c.id IS NULL THEN
    INSERT INTO public.sourcing_agent_candidates(agent_id,organization_id,project_id,created_by,person_key,candidate_id,context_key)
      VALUES(a.id,a.organization_id,a.project_id,a.created_by,p_person_key,p_patch->>'candidate_id',p_patch->>'context_key') RETURNING * INTO c;
  ELSIF c.context_key<>p_patch->>'context_key' THEN
    IF c.credits_reserved>0 THEN RAISE EXCEPTION 'Unsettled previous context' USING ERRCODE='40001'; END IF;
    UPDATE public.sourcing_agent_candidates SET context_key=p_patch->>'context_key',state='discovered',decision=NULL,reason=NULL,
      score=NULL,result='{}',provenance='{}',credits_used=0 WHERE id=c.id RETURNING * INTO c;
  END IF;
  IF next_state IN ('scored','proposed') AND (coalesce((p_patch->>'score')::numeric,c.score) IS NULL
    OR coalesce(p_patch->'result',c.result)='{}'::jsonb) THEN
    RAISE EXCEPTION 'Complete score required' USING ERRCODE='22023';
  END IF;
  reserved:=coalesce((p_patch->>'credits_reserved')::numeric,c.credits_reserved);
  used:=coalesce((p_patch->>'credits_used')::numeric,c.credits_used);
  IF reserved<0 OR used<0 OR reserved>a.credits_reserved OR (c.credits_reserved>0 AND reserved<>c.credits_reserved)
    OR reserved+(SELECT coalesce(sum(credits_reserved),0) FROM public.sourcing_agent_candidates WHERE agent_id=a.id AND id<>c.id)>a.credits_reserved THEN
    RAISE EXCEPTION 'Invalid candidate reservation' USING ERRCODE='22023';
  END IF;
  IF next_state IN ('scored','proposed','skipped') AND p_patch ? 'credits_used' THEN
    -- Idempotent completion: a previously settled item does not spend twice.
    IF c.state IN ('scored','proposed','skipped') AND c.credits_reserved=0 THEN used:=c.credits_used;
    ELSE
      UPDATE public.sourcing_agents SET credits_reserved=credits_reserved-reserved,credits_used=credits_used+used,updated_at=now() WHERE id=a.id;
    END IF;
    reserved:=0;
  END IF;
  UPDATE public.sourcing_agent_candidates SET candidate_id=coalesce(p_patch->>'candidate_id',candidate_id),
    profile=coalesce(p_patch->'profile',profile),score=CASE WHEN p_patch ? 'score' THEN (p_patch->>'score')::numeric ELSE score END,
    result=coalesce(p_patch->'result',result),provenance=provenance||coalesce(p_patch->'provenance','{}')
      ||CASE WHEN c.provenance ? 'scoring_started_at' THEN jsonb_build_object('scoring_started_at',c.provenance->'scoring_started_at') ELSE '{}'::jsonb END
      ||CASE WHEN c.provenance ? 'reservation_recovered' THEN jsonb_build_object('reservation_recovered',c.provenance->'reservation_recovered') ELSE '{}'::jsonb END,state=next_state,
    source_aliases=(SELECT coalesce(jsonb_agg(DISTINCT v),'[]'::jsonb)
      FROM jsonb_array_elements_text(source_aliases||coalesce(p_patch->'source_aliases','[]')) v),
    credits_reserved=reserved,credits_used=used,updated_at=now()
    WHERE id=c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END;
$$;

CREATE FUNCTION public.review_sourcing_agent_candidate(
  p_user_id uuid,p_candidate_id uuid,p_expected_revision integer,p_decision text,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE a public.sourcing_agents; c public.sourcing_agent_candidates; p public.sourcing_projects;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Server role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.sourcing_agent_candidates WHERE id=p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate unavailable' USING ERRCODE='42501'; END IF;
  p:=public.assert_sourcing_agent_actor(p_user_id,c.project_id,true);
  SELECT * INTO a FROM public.sourcing_agents WHERE id=c.agent_id FOR UPDATE;
  IF a.created_by<>p_user_id OR a.organization_id<>p.organization_id THEN RAISE EXCEPTION 'Review belongs to another actor' USING ERRCODE='42501'; END IF;
  IF a.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Revision changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_REVISION'; END IF;
  SELECT * INTO c FROM public.sourcing_agent_candidates WHERE id=p_candidate_id FOR UPDATE;
  IF c.context_key IS DISTINCT FROM a.context_snapshot->>'context_key' OR c.state NOT IN ('scored','proposed','reviewed') OR c.credits_reserved>0 THEN
    RAISE EXCEPTION 'Review context changed' USING ERRCODE='40001', HINT='SOURCING_AGENT_CONTEXT_CHANGED';
  END IF;
  IF p_decision NOT IN ('fit','reject') OR p_decision IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'Reasoned fit/reject decision required' USING ERRCODE='22023';
  END IF;
  UPDATE public.sourcing_agent_candidates SET state='reviewed',decision=p_decision,reason=btrim(p_reason),updated_at=now() WHERE id=c.id RETURNING * INTO c;
  UPDATE public.sourcing_agents SET revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  RETURN jsonb_build_object('agent',to_jsonb(a),'candidate',to_jsonb(c));
END;
$$;

-- RPC ACLs also protect SECURITY INVOKER functions: PUBLIC gets execute by default.
REVOKE ALL ON FUNCTION public.assert_sourcing_agent_actor(uuid,uuid,boolean),
  public.mutate_sourcing_agent(uuid,uuid,integer,text,jsonb),public.claim_sourcing_agent(),
  public.sourcing_agent_assert_lease(uuid,uuid),public.sourcing_agent_checkpoint(uuid,uuid,jsonb),
  public.reserve_sourcing_agent_budget(uuid,uuid,integer,numeric),public.release_sourcing_agent_budget(uuid,uuid,numeric),
  public.sourcing_agent_candidate_write(uuid,uuid,text,jsonb),public.review_sourcing_agent_candidate(uuid,uuid,integer,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_sourcing_agent_actor(uuid,uuid,boolean),
  public.mutate_sourcing_agent(uuid,uuid,integer,text,jsonb),public.claim_sourcing_agent(),
  public.sourcing_agent_assert_lease(uuid,uuid),public.sourcing_agent_checkpoint(uuid,uuid,jsonb),
  public.reserve_sourcing_agent_budget(uuid,uuid,integer,numeric),public.release_sourcing_agent_budget(uuid,uuid,numeric),
  public.sourcing_agent_candidate_write(uuid,uuid,text,jsonb),public.review_sourcing_agent_candidate(uuid,uuid,integer,text,text)
  TO service_role;

-- The existing erasure workflows must also cover profiles saved by this feature.
-- Exact hashes mirror normalizeLinkedInUrl/normalizeEmail; names never identify people.
CREATE FUNCTION public.sourcing_agent_candidate_erased(p_organization_id uuid,p_candidate_id text,p_profile jsonb,p_aliases jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.candidate_photos p
    WHERE p.organization_id=p_organization_id AND p.status='erased'
      AND (p.candidate_id=p_candidate_id OR p_aliases ? p.candidate_id OR p_aliases ? ('id:'||p.candidate_id) OR p_aliases ? ('pid:'||p.candidate_id)))
  OR EXISTS (
    SELECT 1 FROM public.gdpr_erasures g
    JOIN (
      SELECT DISTINCT nullif(btrim(regexp_replace(regexp_replace(lower(v),'[?#].*$',''),'/$',''),E' \t\n\r\f'),'') AS url_value
      FROM unnest(ARRAY[p_profile->>'public_profile_url',p_profile->>'profile_url',p_profile->>'linkedin_profile_url',p_profile->>'profileUrl']) v
      UNION SELECT nullif(btrim(regexp_replace(regexp_replace(lower(v),'[?#].*$',''),'/$',''),E' \t\n\r\f'),'')
        FROM jsonb_array_elements_text(p_aliases) v WHERE v ~* '^https?://[^/]*linkedin\.com/in/'
    ) urls ON g.linkedin_url_hash=encode(sha256(convert_to(urls.url_value,'UTF8')),'hex')
  ) OR EXISTS (
    SELECT 1 FROM public.gdpr_erasures g WHERE g.email_hash IN (
      SELECT encode(sha256(convert_to(lower(btrim(v,E' \t\n\r\f')),'UTF8')),'hex')
      FROM (
        SELECT v FROM unnest(ARRAY[p_profile->>'email',p_profile->'contact_info'->>'email']) v
        UNION SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_profile->'contact_info'->'emails')='array'
          THEN p_profile->'contact_info'->'emails' ELSE '[]'::jsonb END)
      ) emails WHERE v ~ '\S+@\S+\.\S+'
    )
  );
$$;
CREATE FUNCTION public.sourcing_agent_candidate_erasure_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    AND NEW.candidate_id IS NOT DISTINCT FROM OLD.candidate_id AND NEW.profile IS NOT DISTINCT FROM OLD.profile
    AND NEW.source_aliases IS NOT DISTINCT FROM OLD.source_aliases THEN RETURN NEW; END IF;
  PERFORM public.sourcing_agent_privacy_lock();
  IF public.sourcing_agent_candidate_erased(NEW.organization_id,NEW.candidate_id,NEW.profile,NEW.source_aliases) THEN
    RAISE EXCEPTION 'Candidate erased' USING ERRCODE='42501',HINT='SOURCING_AGENT_CANDIDATE_ERASED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sourcing_agent_candidate_erasure_guard BEFORE INSERT OR UPDATE ON public.sourcing_agent_candidates
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_candidate_erasure_guard();
CREATE FUNCTION public.sourcing_agent_erasure_serialization()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='candidate_photos' THEN
    IF NEW.status<>'erased' THEN RETURN NEW; END IF;
  END IF;
  PERFORM public.sourcing_agent_privacy_lock();
  RETURN NEW;
END;
$$;
CREATE TRIGGER sourcing_agent_erasure_serialization BEFORE INSERT OR UPDATE OF email_hash,linkedin_url_hash ON public.gdpr_erasures
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_erasure_serialization();
CREATE TRIGGER sourcing_agent_photo_erasure_serialization BEFORE INSERT OR UPDATE OF status ON public.candidate_photos
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_erasure_serialization();
CREATE FUNCTION public.sourcing_agent_reference_key(p_kind text,p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT CASE WHEN p_kind IN ('id','url') AND nullif(btrim(p_value),'') IS NOT NULL THEN
    encode(sha256(convert_to(p_kind||':'||CASE WHEN p_kind='url' THEN
      btrim(regexp_replace(regexp_replace(lower(p_value),'[?#].*$',''),'/$','')) ELSE lower(btrim(p_value)) END,'UTF8')),'hex') ELSE NULL END;
$$;
CREATE FUNCTION public.sourcing_agent_reference_erased(p_organization_id uuid,p_reference jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_reference ? 'sourcing_agent_candidate_id' AND (
    EXISTS (SELECT 1 FROM public.sourcing_agent_reference_erasures marker WHERE marker.organization_id=p_organization_id
      AND marker.reference_key IN (public.sourcing_agent_reference_key('id',p_reference->>'sourcing_agent_candidate_id'),
        public.sourcing_agent_reference_key('url',p_reference->>'linkedin_url')))
    OR
    EXISTS (SELECT 1 FROM public.sourcing_agent_candidates c WHERE c.organization_id=p_organization_id
      AND c.id::text=p_reference->>'sourcing_agent_candidate_id'
      AND public.sourcing_agent_candidate_erased(c.organization_id,c.candidate_id,c.profile,c.source_aliases))
    OR public.sourcing_agent_candidate_erased(p_organization_id,'',
      jsonb_build_object('profile_url',p_reference->>'linkedin_url'),'[]'::jsonb)
  );
$$;
CREATE FUNCTION public.sourcing_agent_score_uses_references(p_organization_id uuid,p_result jsonb,p_erased_references jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE inputs jsonb; scored_ref jsonb; erased_ref jsonb; scored_url text; erased_url text;
BEGIN
  BEGIN inputs:=(p_result->'scoringContext'->>'inputVersionKey')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  FOR scored_ref IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(inputs->'job'->'calibrationProfiles')='array'
    THEN inputs->'job'->'calibrationProfiles' ELSE '[]'::jsonb END)
  LOOP
    IF EXISTS (SELECT 1 FROM public.sourcing_agent_reference_erasures marker WHERE marker.organization_id=p_organization_id
      AND marker.reference_key IN (public.sourcing_agent_reference_key('id',scored_ref->>'sourcing_agent_candidate_id'),
        public.sourcing_agent_reference_key('url',scored_ref->>'linkedinUrl'))) THEN RETURN true; END IF;
    IF scored_ref ? 'sourcing_agent_candidate_id' AND public.sourcing_agent_reference_erased(p_organization_id,
      jsonb_build_object('sourcing_agent_candidate_id',scored_ref->>'sourcing_agent_candidate_id','linkedin_url',scored_ref->>'linkedinUrl')) THEN RETURN true; END IF;
    FOR erased_ref IN SELECT * FROM jsonb_array_elements(p_erased_references)
    LOOP
      scored_url:=nullif(btrim(regexp_replace(regexp_replace(lower(scored_ref->>'linkedinUrl'),'[?#].*$',''),'/$','')), '');
      erased_url:=nullif(btrim(regexp_replace(regexp_replace(lower(erased_ref->>'linkedin_url'),'[?#].*$',''),'/$','')), '');
      IF (scored_ref->>'sourcing_agent_candidate_id' IS NOT NULL
          AND scored_ref->>'sourcing_agent_candidate_id'=erased_ref->>'sourcing_agent_candidate_id')
        OR (scored_url IS NOT NULL AND scored_url=erased_url)
        OR scored_ref=jsonb_strip_nulls(jsonb_build_object('name',erased_ref->'name','headline',erased_ref->'headline',
          'linkedinUrl',erased_ref->'linkedin_url','whyGoodFit',erased_ref->'why_good_fit','areasOfImprovement',erased_ref->'areas_of_improvement')) THEN RETURN true; END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;
CREATE FUNCTION public.sourcing_agent_erase_candidates()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE a public.sourcing_agents; reserved numeric; p public.sourcing_projects; refs jsonb; erased_refs jsonb; snapshot_erased boolean;
BEGIN
  PERFORM public.sourcing_agent_privacy_lock();
  -- Match the worker/reviewer order: agent before candidate row locks. Settle
  -- an unknown in-flight cost conservatively, even if this agent stays blocked.
  FOR a IN SELECT * FROM public.sourcing_agents s WHERE EXISTS (
    SELECT 1 FROM public.sourcing_agent_candidates c WHERE c.agent_id=s.id
      AND public.sourcing_agent_candidate_erased(c.organization_id,c.candidate_id,c.profile,c.source_aliases))
    OR EXISTS (SELECT 1 FROM public.sourcing_projects project_row,
      LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(project_row.job_details->'calibration_profiles')='array'
        THEN project_row.job_details->'calibration_profiles' ELSE '[]'::jsonb END) r
      WHERE project_row.id=s.project_id AND public.sourcing_agent_reference_erased(s.organization_id,r))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.context_snapshot->'job_details'->'calibration_profiles')='array'
      THEN s.context_snapshot->'job_details'->'calibration_profiles' ELSE '[]'::jsonb END) r
      WHERE public.sourcing_agent_reference_erased(s.organization_id,r))
    ORDER BY s.id FOR UPDATE
  LOOP
    INSERT INTO public.sourcing_agent_reference_erasures(organization_id,reference_key)
      SELECT a.organization_id,public.sourcing_agent_reference_key('id',c.id::text) FROM public.sourcing_agent_candidates c
      WHERE c.agent_id=a.id AND public.sourcing_agent_candidate_erased(c.organization_id,c.candidate_id,c.profile,c.source_aliases)
      ON CONFLICT DO NOTHING;
    INSERT INTO public.sourcing_agent_reference_erasures(organization_id,reference_key)
      SELECT DISTINCT a.organization_id,public.sourcing_agent_reference_key('url',profile_url) FROM public.sourcing_agent_candidates c,
        LATERAL unnest(ARRAY[c.profile->>'public_profile_url',c.profile->>'profile_url',c.profile->>'linkedin_profile_url',c.profile->>'profileUrl']) profile_url
      WHERE c.agent_id=a.id AND public.sourcing_agent_candidate_erased(c.organization_id,c.candidate_id,c.profile,c.source_aliases)
        AND public.sourcing_agent_reference_key('url',profile_url) IS NOT NULL ON CONFLICT DO NOTHING;
    SELECT coalesce(sum(c.credits_reserved),0) INTO reserved FROM public.sourcing_agent_candidates c WHERE c.agent_id=a.id
      AND public.sourcing_agent_candidate_erased(c.organization_id,c.candidate_id,c.profile,c.source_aliases);
    UPDATE public.sourcing_agents SET credits_reserved=credits_reserved-least(credits_reserved,reserved),
      credits_used=credits_used+least(credits_reserved,reserved),updated_at=now() WHERE id=a.id;
    SELECT * INTO p FROM public.sourcing_projects WHERE id=a.project_id FOR UPDATE;
    SELECT coalesce(jsonb_agg(DISTINCT r),'[]'::jsonb) INTO erased_refs FROM jsonb_array_elements(
      (CASE WHEN jsonb_typeof(p.job_details->'calibration_profiles')='array' THEN p.job_details->'calibration_profiles' ELSE '[]'::jsonb END)
      || (CASE WHEN jsonb_typeof(a.context_snapshot->'job_details'->'calibration_profiles')='array'
        THEN a.context_snapshot->'job_details'->'calibration_profiles' ELSE '[]'::jsonb END)
    ) r WHERE public.sourcing_agent_reference_erased(a.organization_id,r);
    INSERT INTO public.sourcing_agent_reference_erasures(organization_id,reference_key)
      SELECT a.organization_id,key_value FROM jsonb_array_elements(erased_refs) r,
        LATERAL unnest(ARRAY[public.sourcing_agent_reference_key('id',r->>'sourcing_agent_candidate_id'),
          public.sourcing_agent_reference_key('url',r->>'linkedin_url')]) key_value
      WHERE key_value IS NOT NULL ON CONFLICT DO NOTHING;
    SELECT coalesce(jsonb_agg(r ORDER BY ordinal),'[]'::jsonb) INTO refs FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.job_details->'calibration_profiles')='array' THEN p.job_details->'calibration_profiles' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS reference(r,ordinal) WHERE NOT public.sourcing_agent_reference_erased(a.organization_id,r);
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.context_snapshot->'job_details'->'calibration_profiles')='array'
      THEN a.context_snapshot->'job_details'->'calibration_profiles' ELSE '[]'::jsonb END) r
      WHERE public.sourcing_agent_reference_erased(a.organization_id,r)) INTO snapshot_erased;
    IF (jsonb_typeof(p.job_details->'calibration_profiles')='array' AND refs IS DISTINCT FROM p.job_details->'calibration_profiles') OR snapshot_erased THEN
      IF jsonb_typeof(p.job_details->'calibration_profiles')='array' AND refs IS DISTINCT FROM p.job_details->'calibration_profiles' THEN
        UPDATE public.sourcing_projects SET job_details=jsonb_set(job_details,'{calibration_profiles}',refs) WHERE id=p.id;
      END IF;
      UPDATE public.sourcing_agents SET context_snapshot='{}',search_filters_snapshot='{}',checkpoint='{}',approved_context_key=NULL,
        status='blocked',last_reason='CONTEXT_CHANGED',last_error=NULL,revision=revision+1,lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE id=a.id;
    END IF;
    -- UUID metadata also links historical scores after the current brief has
    -- changed. Comparisons to generated references support mapped older shapes.
    UPDATE public.sourcing_agent_candidates candidate SET score=NULL,result='{}',
      state=CASE WHEN state='reviewed' THEN state ELSE 'skipped' END,provenance=provenance||'{"context_erased":true}',updated_at=now()
      WHERE candidate.agent_id=a.id AND public.sourcing_agent_score_uses_references(a.organization_id,candidate.result,erased_refs);
    DELETE FROM public.match_scores cached WHERE cached.organization_id=a.organization_id
      AND (cached.job_id IN ('project:'||a.project_id,a.project_id::text) OR cached.job_id=p.job_id)
      AND public.sourcing_agent_score_uses_references(a.organization_id,cached.scoring_result,erased_refs);
    UPDATE public.job_candidate_status pipeline SET score=NULL,scoring_details=NULL
      WHERE pipeline.organization_id=a.organization_id AND pipeline.project_id=a.project_id
        AND public.sourcing_agent_score_uses_references(a.organization_id,pipeline.scoring_details,erased_refs);
    DELETE FROM public.sourcing_agent_candidates c WHERE c.agent_id=a.id
      AND public.sourcing_agent_candidate_erased(c.organization_id,c.candidate_id,c.profile,c.source_aliases);
  END LOOP;
END;
$$;
-- The sole definer is a boolean-only read boundary for existing authenticated
-- score writers. It exposes no opposition rows and checks organization scope.
CREATE FUNCTION public.sourcing_agent_score_privacy_erased(p_organization_id uuid,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inputs jsonb; caller_role text:=current_setting('role',true);
BEGIN
  IF NOT coalesce((caller_role='service_role' OR auth.role()='service_role'
    OR (caller_role IN ('none','postgres','supabase_admin') AND session_user IN ('postgres','supabase_admin'))),false)
    AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Scoring organization unavailable' USING ERRCODE='42501';
  END IF;
  BEGIN inputs:=(p_result->'scoringContext'->>'inputVersionKey')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  IF jsonb_typeof(inputs->'job'->'calibrationProfiles') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(inputs->'job'->'calibrationProfiles')=0 THEN RETURN false; END IF;
  -- Row-level UPDATE triggers already hold their row lock. Never wait in the
  -- opposite order to erasure; skip this optional score copy if privacy is busy.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('continuous-sourcing-privacy',0)) THEN RETURN true; END IF;
  -- VOLATILE PL/pgSQL takes a fresh statement snapshot after lock acquisition.
  RETURN public.sourcing_agent_score_uses_references(p_organization_id,p_result,'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.sourcing_agent_score_privacy_erased(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sourcing_agent_score_privacy_erased(uuid,jsonb) TO authenticated,service_role;
CREATE FUNCTION public.sourcing_agent_score_privacy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE score_copy jsonb; inputs jsonb;
BEGIN
  IF TG_TABLE_NAME='match_scores' THEN score_copy:=NEW.scoring_result;
  ELSIF TG_TABLE_NAME='job_candidate_status' THEN score_copy:=NEW.scoring_details;
  ELSE score_copy:=NEW.result; END IF;
  -- Non-scoring writes keep the existing stage/authorization guards, including
  -- their refusal hints. The scoped read boundary is needed only for a real
  -- persisted calibration reference copy, not absent or malformed metadata.
  BEGIN inputs:=(score_copy->'scoringContext'->>'inputVersionKey')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
  IF jsonb_typeof(inputs->'job'->'calibrationProfiles') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  IF jsonb_array_length(inputs->'job'->'calibrationProfiles')=0 THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='match_scores' THEN
    IF public.sourcing_agent_score_privacy_erased(NEW.organization_id,NEW.scoring_result) THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME='job_candidate_status' THEN
    IF public.sourcing_agent_score_privacy_erased(NEW.organization_id,NEW.scoring_details) THEN
      NEW.score:=NULL; NEW.scoring_details:=NULL;
    END IF;
  ELSE
    IF public.sourcing_agent_score_privacy_erased(NEW.organization_id,NEW.result) THEN
      NEW.score:=NULL; NEW.result:='{}';
      IF NEW.state IN ('scored','proposed') THEN NEW.state:='skipped'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sourcing_agent_score_privacy_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sourcing_agent_score_privacy_guard() TO service_role;
CREATE TRIGGER sourcing_agent_score_privacy_guard BEFORE INSERT OR UPDATE OF scoring_result ON public.match_scores
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_score_privacy_guard();
CREATE TRIGGER sourcing_agent_score_privacy_guard BEFORE INSERT OR UPDATE OF scoring_details ON public.job_candidate_status
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_score_privacy_guard();
CREATE TRIGGER sourcing_agent_score_privacy_guard BEFORE INSERT OR UPDATE OF result ON public.sourcing_agent_candidates
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_score_privacy_guard();
CREATE FUNCTION public.sourcing_agent_candidates_after_erasure()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  PERFORM public.sourcing_agent_erase_candidates();
  RETURN NEW;
END;
$$;
CREATE TRIGGER sourcing_agent_candidates_after_erasure AFTER INSERT OR UPDATE OF email_hash,linkedin_url_hash ON public.gdpr_erasures
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_candidates_after_erasure();
CREATE FUNCTION public.sourcing_agent_candidates_after_photo_erasure()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.status='erased' THEN
    PERFORM public.sourcing_agent_erase_candidates();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sourcing_agent_candidates_after_photo_erasure AFTER INSERT OR UPDATE OF status ON public.candidate_photos
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_agent_candidates_after_photo_erasure();
REVOKE ALL ON FUNCTION public.sourcing_agent_candidate_erased(uuid,text,jsonb,jsonb),public.sourcing_agent_candidate_erasure_guard(),
  public.sourcing_agent_erasure_serialization(),
  public.sourcing_agent_erase_candidates(),
  public.sourcing_agent_reference_erased(uuid,jsonb),
  public.sourcing_agent_score_uses_references(uuid,jsonb,jsonb),
  public.sourcing_agent_reference_key(text,text),
  public.sourcing_agent_candidates_after_erasure(),public.sourcing_agent_candidates_after_photo_erasure() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sourcing_agent_candidate_erased(uuid,text,jsonb,jsonb),public.sourcing_agent_candidate_erasure_guard(),
  public.sourcing_agent_erasure_serialization(),
  public.sourcing_agent_erase_candidates(),
  public.sourcing_agent_reference_erased(uuid,jsonb),
  public.sourcing_agent_score_uses_references(uuid,jsonb,jsonb),
  public.sourcing_agent_reference_key(text,text),
  public.sourcing_agent_candidates_after_erasure(),public.sourcing_agent_candidates_after_photo_erasure() TO service_role;

-- No agents are enabled by this migration. Scheduled ticks are empty until opt-in.
CREATE FUNCTION public.invoke_process_sourcing_agents()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE secret_value text; url_value text;
BEGIN
  SELECT value INTO secret_value FROM public.internal_config WHERE key='process_sequences_secret';
  SELECT value INTO url_value FROM public.internal_config WHERE key='supabase_functions_url';
  IF secret_value IS NULL OR url_value IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url:=url_value||'/process-sourcing-agents',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret_value),body:='{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_process_sourcing_agents() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_sourcing_agents() TO service_role;
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    BEGIN PERFORM cron.unschedule('process-sourcing-agents'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('process-sourcing-agents','* * * * *','SELECT public.invoke_process_sourcing_agents();');
  END IF;
EXCEPTION WHEN undefined_function OR insufficient_privilege THEN RAISE NOTICE 'Sourcing cron unavailable in this local database';
END;
$cron$;
