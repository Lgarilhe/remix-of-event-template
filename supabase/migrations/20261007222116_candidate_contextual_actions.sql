-- Durable, private reviewed plans; per-effect reservations and truthful outcomes.
-- All writes are service-only RPCs after the authenticated endpoint rereads context.
CREATE TABLE public.candidate_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  candidate_id text NOT NULL CHECK (length(btrim(candidate_id)) BETWEEN 1 AND 500),
  project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  intent text NOT NULL,
  context_version text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  title text NOT NULL,
  reason text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  follow_up jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','running','completed','partial','needs_review','dismissed')),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX candidate_action_plans_context_unique ON public.candidate_action_plans
  (organization_id, user_id, candidate_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), intent, context_version,
   coalesce(scope->>'account_id',''), coalesce(scope->>'chat_id',''));
CREATE INDEX candidate_action_plans_scope ON public.candidate_action_plans(organization_id,user_id,candidate_id,project_id,created_at DESC);

CREATE TABLE public.candidate_action_effects (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.candidate_action_plans(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('message','document','comment')),
  audience text CHECK (audience IN ('candidate','team')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key text NOT NULL,
  business_key text NOT NULL,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','running','succeeded','failed','unknown','skipped')),
  claim_token uuid,
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  master_effect_id uuid REFERENCES public.candidate_action_effects(id),
  result jsonb,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id,position)
);
CREATE INDEX candidate_action_effects_plan ON public.candidate_action_effects(plan_id);
CREATE INDEX candidate_action_effects_master ON public.candidate_action_effects(master_effect_id) WHERE master_effect_id IS NOT NULL;
CREATE UNIQUE INDEX candidate_action_effects_one_active_business_key ON public.candidate_action_effects(business_key)
  WHERE master_effect_id IS NULL AND status IN ('running','succeeded','unknown');

CREATE TABLE public.candidate_action_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  account_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('linkedin','email','whatsapp')),
  service text NOT NULL CHECK (service IN ('linkedin','email','gmail','outlook','whatsapp')),
  audience text NOT NULL CHECK (audience IN ('candidate','team')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  provider_message_id text NOT NULL,
  provider_thread_id text,
  in_reply_to text,
  counterpart text NOT NULL,
  sender text NOT NULL,
  recipient text NOT NULL,
  subject text,
  content text NOT NULL,
  occurred_at timestamptz NOT NULL,
  action_plan_id uuid REFERENCES public.candidate_action_plans(id) ON DELETE SET NULL,
  effect_id uuid REFERENCES public.candidate_action_effects(id) ON DELETE SET NULL,
  -- Only an acknowledged action completion publishes its outgoing ledger row.
  -- Generic mailbox imports and interrupted sends remain private.
  action_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,provider_message_id)
);
CREATE INDEX candidate_action_messages_scope ON public.candidate_action_messages(organization_id,candidate_id,project_id,occurred_at DESC);
CREATE INDEX candidate_action_messages_owner ON public.candidate_action_messages(owner_user_id,account_id,occurred_at DESC);

ALTER TABLE public.candidate_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_action_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_action_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidate_action_plans, public.candidate_action_effects, public.candidate_action_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.candidate_action_plans, public.candidate_action_effects, public.candidate_action_messages TO authenticated;
GRANT ALL ON public.candidate_action_plans, public.candidate_action_effects, public.candidate_action_messages TO service_role;
CREATE POLICY candidate_action_plans_private_read ON public.candidate_action_plans FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = public.get_user_org_id((SELECT auth.uid()))
         AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.sourcing_projects p WHERE p.id = candidate_action_plans.project_id AND p.organization_id = candidate_action_plans.organization_id)));
CREATE POLICY candidate_action_effects_private_read ON public.candidate_action_effects FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.candidate_action_plans p WHERE p.id = plan_id));
CREATE POLICY candidate_action_messages_scoped_read ON public.candidate_action_messages FOR SELECT TO authenticated
  USING (
    (owner_user_id = (SELECT auth.uid()) AND organization_id = public.get_user_org_id((SELECT auth.uid()))
      AND ((channel='linkedin' AND EXISTS (SELECT 1 FROM public.member_linkedin_accounts a WHERE a.organization_id=candidate_action_messages.organization_id
        AND a.user_id=(SELECT auth.uid()) AND a.linkedin_account_id=candidate_action_messages.account_id)
       ) OR (channel='email' AND EXISTS (SELECT 1 FROM public.member_email_accounts a WHERE a.organization_id=candidate_action_messages.organization_id
        AND a.user_id=(SELECT auth.uid()) AND a.email_account_id=candidate_action_messages.account_id))))
    OR (direction = 'outbound' AND project_id IS NOT NULL
        AND action_plan_id IS NOT NULL AND effect_id IS NOT NULL AND action_completed_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.sourcing_projects p WHERE p.id = candidate_action_messages.project_id AND p.organization_id = candidate_action_messages.organization_id)
        AND ((organization_id = public.get_user_org_id((SELECT auth.uid())))
             OR public.is_mission_team_member_for_project((SELECT auth.uid()),project_id)))
  );

CREATE FUNCTION public.candidate_actions_assert_scope(p_user_id uuid,p_org uuid,p_candidate text,p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_user_id IS NULL OR p_org IS NULL OR length(btrim(coalesce(p_candidate,''))) NOT BETWEEN 1 AND 500
     OR p_org IS DISTINCT FROM public.get_user_org_id(p_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id=p_user_id AND m.organization_id=p_org) THEN
    RAISE EXCEPTION 'Accès refusé à ce contexte candidat' USING ERRCODE='42501', HINT='ACTION_SCOPE_FORBIDDEN';
  END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sourcing_projects p WHERE p.id=p_project AND p.organization_id=p_org) THEN
    RAISE EXCEPTION 'La mission ne correspond pas à ce contexte' USING ERRCODE='42501', HINT='ACTION_SCOPE_FORBIDDEN';
  END IF;
  -- Outside a mission, exact candidate identity is resolved from the user's
  -- account/provider by the endpoint. A mission requires an existing candidature.
  IF p_project IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.job_candidate_status j WHERE j.organization_id=p_org AND j.project_id=p_project AND j.candidate_id=p_candidate
    UNION ALL SELECT 1 FROM public.mission_conversations m WHERE m.organization_id=p_org AND m.project_id=p_project
      AND (m.candidate_id=p_candidate OR p_candidate=ANY(m.candidate_ids))) THEN
    RAISE EXCEPTION 'Ce candidat ne figure pas dans cette mission' USING ERRCODE='42501', HINT='ACTION_CANDIDATE_FORBIDDEN';
  END IF;
END $$;

CREATE FUNCTION public.candidate_actions_purge(p_organization_id uuid,p_candidate_ids text[],p_linkedin_url text DEFAULT NULL,p_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_plans uuid[]; v_messages integer; v_count integer;
BEGIN
  IF coalesce(cardinality(p_candidate_ids),0)=0 AND btrim(coalesce(p_linkedin_url,''))='' AND btrim(coalesce(p_email,''))='' THEN
    RETURN jsonb_build_object('plans',0,'messages',0);
  END IF;
  SELECT coalesce(array_agg(p.id),'{}'::uuid[]) INTO v_plans FROM public.candidate_action_plans p
    WHERE (p_organization_id IS NULL OR p.organization_id=p_organization_id)
      AND (p.candidate_id=ANY(coalesce(p_candidate_ids,'{}'::text[]))
        OR (p_linkedin_url IS NOT NULL AND lower(regexp_replace(coalesce(p.scope->>'linkedin_url',''),'/+$',''))=lower(regexp_replace(p_linkedin_url,'/+$','')))
        OR (p_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.candidate_action_effects e WHERE e.plan_id=p.id
          AND e.audience='candidate' AND lower(e.payload->>'recipient')=lower(p_email))));
  DELETE FROM public.candidate_action_messages m WHERE (p_organization_id IS NULL OR m.organization_id=p_organization_id)
    AND (m.candidate_id=ANY(coalesce(p_candidate_ids,'{}'::text[])) OR m.action_plan_id=ANY(v_plans)
      OR m.candidate_id IN (SELECT p.candidate_id FROM public.candidate_action_plans p WHERE p.id=ANY(v_plans) AND p.organization_id=m.organization_id)
      OR (p_email IS NOT NULL AND m.audience='candidate' AND lower(m.counterpart)=lower(p_email)));
  GET DIAGNOSTICS v_messages=ROW_COUNT;
  DELETE FROM public.notifications n USING public.candidate_action_effects e,public.candidate_action_plans p
    WHERE e.plan_id=p.id AND e.plan_id=ANY(v_plans) AND n.organization_id=p.organization_id
      AND n.metadata->>'candidate_action_effect_id'=e.id::text;
  DELETE FROM public.knowledge_chunks k USING public.candidate_action_effects e,public.candidate_action_plans p
    WHERE e.plan_id=p.id AND e.plan_id=ANY(v_plans) AND k.organization_id=p.organization_id AND k.source_id=e.id::text
      AND k.source_table=CASE WHEN e.kind='document' THEN 'candidate_notes' WHEN e.kind='comment' THEN 'candidate_comments' END;
  DELETE FROM public.candidate_notes n USING public.candidate_action_effects e WHERE n.id=e.id AND e.plan_id=ANY(v_plans) AND e.kind='document';
  DELETE FROM public.candidate_comments c USING public.candidate_action_effects e WHERE c.id=e.id AND e.plan_id=ANY(v_plans) AND e.kind='comment';
  DELETE FROM public.candidate_action_plans p WHERE p.id=ANY(v_plans);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN jsonb_build_object('plans',v_count,'messages',v_messages);
END $$;

CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.candidate_actions_remove_mission_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role',true) IN ('authenticated','anon') AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE='42501';
  END IF;
  IF OLD.organization_id IS NOT NULL AND OLD.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.job_candidate_status j WHERE j.organization_id=OLD.organization_id AND j.project_id=OLD.project_id AND j.candidate_id=OLD.candidate_id) THEN
    DELETE FROM public.candidate_action_messages WHERE organization_id=OLD.organization_id AND project_id=OLD.project_id AND candidate_id=OLD.candidate_id;
    DELETE FROM public.notifications n USING public.candidate_action_effects e,public.candidate_action_plans p
      WHERE e.plan_id=p.id AND n.organization_id=p.organization_id AND n.metadata->>'candidate_action_effect_id'=e.id::text
        AND p.organization_id=OLD.organization_id AND p.project_id=OLD.project_id AND p.candidate_id=OLD.candidate_id;
    DELETE FROM public.knowledge_chunks k USING public.candidate_action_effects e,public.candidate_action_plans p
      WHERE e.plan_id=p.id AND k.organization_id=p.organization_id AND k.source_id=e.id::text AND p.organization_id=OLD.organization_id AND p.project_id=OLD.project_id AND p.candidate_id=OLD.candidate_id
        AND k.source_table=CASE WHEN e.kind='document' THEN 'candidate_notes' WHEN e.kind='comment' THEN 'candidate_comments' END;
    DELETE FROM public.candidate_notes n USING public.candidate_action_effects e, public.candidate_action_plans p
      WHERE n.id=e.id AND e.plan_id=p.id AND e.kind='document' AND p.organization_id=OLD.organization_id AND p.project_id=OLD.project_id AND p.candidate_id=OLD.candidate_id;
    DELETE FROM public.candidate_comments c USING public.candidate_action_effects e, public.candidate_action_plans p
      WHERE c.id=e.id AND e.plan_id=p.id AND e.kind='comment' AND p.organization_id=OLD.organization_id AND p.project_id=OLD.project_id AND p.candidate_id=OLD.candidate_id;
    DELETE FROM public.candidate_action_plans WHERE organization_id=OLD.organization_id AND project_id=OLD.project_id AND candidate_id=OLD.candidate_id;
  END IF;
  RETURN OLD;
END $$;
-- A browser's DELETE is still authenticated and has no plan DELETE grants.
-- This narrowly scoped cleanup executes only for already-authorized removal.
REVOKE ALL ON FUNCTION private.candidate_actions_remove_mission_candidate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER candidate_actions_remove_mission_candidate AFTER DELETE ON public.job_candidate_status
  FOR EACH ROW EXECUTE FUNCTION private.candidate_actions_remove_mission_candidate();

CREATE FUNCTION public.candidate_actions_assert_effect(p_user_id uuid,p_org uuid,p_candidate text,p_project uuid,p_effect jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_owned boolean; v_member uuid; v_mention text; v_eval uuid;
BEGIN
  IF p_effect->>'kind' NOT IN ('message','document','comment') OR length(btrim(coalesce(p_effect->>'content',''))) NOT BETWEEN 1 AND 30000 THEN
    RAISE EXCEPTION 'Contenu ou type d''action invalide' USING HINT='ACTION_INVALID_EFFECT';
  END IF;
  IF p_effect->>'kind'='message' THEN
    IF p_effect->>'audience' NOT IN ('candidate','team') OR p_effect->>'channel' NOT IN ('linkedin','email','whatsapp')
       OR btrim(coalesce(p_effect->>'recipient',''))='' THEN
      RAISE EXCEPTION 'Destinataire ou canal invalide' USING HINT='ACTION_INVALID_TARGET';
    END IF;
    v_owned := false;
    IF p_effect->>'channel'='linkedin' THEN
      SELECT EXISTS (SELECT 1 FROM public.member_linkedin_accounts a WHERE a.organization_id=p_org AND a.user_id=p_user_id
        AND a.linkedin_account_id=p_effect->>'senderAccountId') INTO v_owned;
    ELSIF p_effect->>'channel'='email' THEN
      SELECT EXISTS (SELECT 1 FROM public.member_email_accounts a WHERE a.organization_id=p_org AND a.user_id=p_user_id
        AND a.email_account_id=p_effect->>'senderAccountId' AND lower(a.email_address)=lower(p_effect->>'senderAddress')) INTO v_owned;
    ELSIF to_regclass('public.member_whatsapp_accounts') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.member_whatsapp_accounts a WHERE a.organization_id=$1 AND a.user_id=$2 AND a.whatsapp_account_id=$3)'
        INTO v_owned USING p_org,p_user_id,p_effect->>'senderAccountId';
    END IF;
    IF NOT v_owned THEN RAISE EXCEPTION 'Ce compte d''envoi n''est plus disponible' USING ERRCODE='42501', HINT='ACTION_SENDER_FORBIDDEN'; END IF;
    IF p_effect->>'audience'='team' THEN
      v_member := nullif(p_effect->>'memberId','')::uuid;
      IF v_member IS NULL OR NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id=v_member) THEN
        RAISE EXCEPTION 'Cet intervenant ne fait pas partie de l''équipe' USING ERRCODE='42501', HINT='ACTION_TARGET_FORBIDDEN';
      END IF;
      -- The authenticated endpoint and transport verify the member's exact
      -- address through Auth APIs. service_role has no auth.users SELECT grant.

    END IF;
  ELSIF p_effect->>'kind'='document' THEN
    IF p_effect->>'documentType' NOT IN ('interview_brief','scorecard_questions','follow_up') THEN
      RAISE EXCEPTION 'Type de document invalide' USING HINT='ACTION_INVALID_EFFECT';
    END IF;
    v_eval := nullif(p_effect->>'evaluationId','')::uuid;
    IF v_eval IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.candidate_evaluations e WHERE e.id=v_eval
      AND e.organization_id=p_org AND e.candidate_id=p_candidate AND e.created_by=p_user_id
      AND e.project_id IS NOT DISTINCT FROM p_project) THEN
      RAISE EXCEPTION 'Cette grille ne peut pas être utilisée' USING ERRCODE='42501', HINT='ACTION_EVALUATION_FORBIDDEN';
    END IF;
  ELSE
    FOR v_mention IN SELECT jsonb_array_elements_text(coalesce(p_effect->'mentions','[]'::jsonb)) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id=v_mention::uuid) THEN
        RAISE EXCEPTION 'Mention d''équipe invalide' USING ERRCODE='42501', HINT='ACTION_TARGET_FORBIDDEN';
      END IF;
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION public.candidate_actions_plan_json(p_plan_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('id',p.id,'scope',p.scope,'contextVersion',p.context_version,'revision',p.revision,
    'intent',p.intent,'title',p.title,'reason',p.reason,'status',p.status,'createdBy',p.user_id,
    'createdAt',p.created_at,'updatedAt',p.updated_at,'sources',p.sources,'effects',coalesce((
      SELECT jsonb_agg(e.payload || jsonb_build_object('id',e.id,'status',e.status,'dedupeKey',e.dedupe_key)
        || CASE WHEN e.result IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('result',e.result) END ORDER BY e.position)
      FROM public.candidate_action_effects e WHERE e.plan_id=p.id),'[]'::jsonb))
    || CASE WHEN p.follow_up IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('followUp',p.follow_up) END
  FROM public.candidate_action_plans p WHERE p.id=p_plan_id;
$$;

CREATE FUNCTION public.candidate_actions_sync_duplicates(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Touch only the current actor's plan. Updating other actors' locked plans
  -- during completion can deadlock when each owns a different master effect.
  UPDATE public.candidate_action_effects e SET
    status=CASE WHEN m.status='succeeded' THEN 'skipped' ELSE m.status END,
    result=m.result,completed_at=m.completed_at,updated_at=now()
    FROM public.candidate_action_effects m
    WHERE e.plan_id=p_plan_id AND e.master_effect_id=m.id AND m.status IN ('succeeded','failed','unknown')
      AND (e.status IS DISTINCT FROM CASE WHEN m.status='succeeded' THEN 'skipped' ELSE m.status END OR e.result IS DISTINCT FROM m.result);
END $$;

CREATE FUNCTION public.candidate_actions_owned_plan(p_user_id uuid,p_plan_id uuid)
RETURNS public.candidate_action_plans LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans;
BEGIN
  SELECT * INTO p FROM public.candidate_action_plans WHERE id=p_plan_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposition introuvable' USING ERRCODE='42501', HINT='ACTION_NOT_FOUND'; END IF;
  PERFORM public.candidate_actions_assert_scope(p_user_id,p.organization_id,p.candidate_id,p.project_id);
  PERFORM public.candidate_actions_sync_duplicates(p.id);
  IF p.status IN ('approved','running','partial') THEN
    PERFORM public.candidate_actions_refresh_plan_state(p.id);
    SELECT * INTO p FROM public.candidate_action_plans WHERE id=p.id;
  END IF;
  RETURN p;
END $$;

CREATE FUNCTION public.candidate_actions_create_plan(p_user_id uuid,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans; v_scope jsonb := p_plan->'scope'; v_id uuid; e jsonb; v_pos integer:=0; v_key text;
BEGIN
  PERFORM public.candidate_actions_assert_scope(p_user_id,(v_scope->>'organization_id')::uuid,v_scope->>'candidate_id',nullif(v_scope->>'project_id','')::uuid);
  IF length(coalesce(p_plan->>'contextVersion','')) NOT BETWEEN 1 AND 256 OR length(coalesce(p_plan->>'intent','')) NOT BETWEEN 1 AND 100
     OR jsonb_typeof(p_plan->'effects') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'effects') NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'Proposition invalide' USING HINT='ACTION_INVALID_PLAN';
  END IF;
  INSERT INTO public.candidate_action_plans(id,organization_id,user_id,candidate_id,project_id,scope,intent,context_version,title,reason,sources,follow_up)
    VALUES ((p_plan->>'id')::uuid,(v_scope->>'organization_id')::uuid,p_user_id,v_scope->>'candidate_id',nullif(v_scope->>'project_id','')::uuid,v_scope,
      p_plan->>'intent',p_plan->>'contextVersion',p_plan->>'title',p_plan->>'reason',coalesce(p_plan->'sources','[]'),p_plan->'followUp')
    ON CONFLICT DO NOTHING RETURNING * INTO p;
  IF NOT FOUND THEN
    SELECT * INTO p FROM public.candidate_action_plans x WHERE x.organization_id=(v_scope->>'organization_id')::uuid AND x.user_id=p_user_id
      AND x.candidate_id=v_scope->>'candidate_id' AND x.project_id IS NOT DISTINCT FROM nullif(v_scope->>'project_id','')::uuid
      AND x.intent=p_plan->>'intent' AND x.context_version=p_plan->>'contextVersion'
      AND coalesce(x.scope->>'account_id','')=coalesce(v_scope->>'account_id','') AND coalesce(x.scope->>'chat_id','')=coalesce(v_scope->>'chat_id','');
    IF NOT FOUND THEN RAISE EXCEPTION 'Identifiant de proposition déjà utilisé' USING HINT='ACTION_INVALID_PLAN'; END IF;
    RETURN public.candidate_actions_plan_json(p.id);
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_plan->'effects') LOOP
    PERFORM public.candidate_actions_assert_effect(p_user_id,p.organization_id,p.candidate_id,p.project_id,e);
    v_id := (e->>'id')::uuid;
    IF length(coalesce(e->>'dedupeKey','')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Clé d''action invalide' USING HINT='ACTION_INVALID_EFFECT'; END IF;
    -- dedupeKey is derived by the server from the business source/version and
    -- target. Personal mailbox contextVersion and phrasing must not split it.
    v_key := md5(jsonb_build_array(p.organization_id,p.candidate_id,p.project_id,e->>'kind',e->>'dedupeKey')::text);
    INSERT INTO public.candidate_action_effects(id,plan_id,position,kind,audience,payload,dedupe_key,business_key)
      VALUES(v_id,p.id,v_pos,e->>'kind',CASE WHEN e->>'kind'='message' THEN e->>'audience' END,
        e-'status'-'result'-'dedupeKey',e->>'dedupeKey',v_key);
    v_pos := v_pos+1;
  END LOOP;
  RETURN public.candidate_actions_plan_json(p.id);
END $$;

CREATE FUNCTION public.candidate_actions_get_plan(p_user_id uuid,p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  RETURN public.candidate_actions_plan_json(p_plan_id);
END $$;
CREATE FUNCTION public.candidate_actions_list_plans(p_user_id uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.candidate_actions_assert_scope(p_user_id,(p_scope->>'organization_id')::uuid,p_scope->>'candidate_id',nullif(p_scope->>'project_id','')::uuid);
  FOR v_id IN SELECT x.id FROM public.candidate_action_plans x
    WHERE x.user_id=p_user_id AND x.organization_id=(p_scope->>'organization_id')::uuid AND x.candidate_id=p_scope->>'candidate_id'
      AND x.project_id IS NOT DISTINCT FROM nullif(p_scope->>'project_id','')::uuid ORDER BY x.created_at DESC LIMIT 30 LOOP
    PERFORM public.candidate_actions_owned_plan(p_user_id,v_id);
  END LOOP;
  RETURN coalesce((SELECT jsonb_agg(public.candidate_actions_plan_json(p.id) ORDER BY p.created_at DESC)
    FROM (SELECT id,created_at FROM public.candidate_action_plans x
      WHERE x.user_id=p_user_id AND x.organization_id=(p_scope->>'organization_id')::uuid AND x.candidate_id=p_scope->>'candidate_id'
        AND x.project_id IS NOT DISTINCT FROM nullif(p_scope->>'project_id','')::uuid
      ORDER BY x.created_at DESC LIMIT 30) p),'[]'::jsonb);
END $$;

CREATE FUNCTION public.candidate_actions_save_drafts(p_user_id uuid,p_plan_id uuid,p_expected_revision integer,p_edits jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans; v_id text; v_edit jsonb; e public.candidate_action_effects; v_payload jsonb;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  IF p.revision<>p_expected_revision THEN RAISE EXCEPTION 'La proposition a été modifiée. Rechargez-la.' USING HINT='ACTION_REVISION_CONFLICT'; END IF;
  IF p.status<>'draft' THEN RAISE EXCEPTION 'Cette proposition n''est plus modifiable' USING HINT='ACTION_NOT_EDITABLE'; END IF;
  FOR v_id,v_edit IN SELECT key,value FROM jsonb_each(p_edits) LOOP
    SELECT * INTO e FROM public.candidate_action_effects WHERE plan_id=p.id AND id=v_id::uuid AND status='prepared';
    IF NOT FOUND OR jsonb_typeof(v_edit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Effet inconnu' USING HINT='ACTION_INVALID_EFFECT'; END IF;
    v_payload := e.payload || jsonb_build_object('content',v_edit->>'content');
    IF e.kind='message' AND v_edit ? 'subject' THEN v_payload := v_payload || jsonb_build_object('subject',v_edit->>'subject'); END IF;
    PERFORM public.candidate_actions_assert_effect(p_user_id,p.organization_id,p.candidate_id,p.project_id,v_payload);
    UPDATE public.candidate_action_effects SET payload=v_payload,updated_at=now() WHERE id=e.id;
  END LOOP;
  UPDATE public.candidate_action_plans SET revision=revision+1,updated_at=now() WHERE id=p.id;
  RETURN public.candidate_actions_plan_json(p.id);
END $$;

CREATE FUNCTION public.candidate_actions_approve_plan(p_user_id uuid,p_plan_id uuid,p_expected_revision integer,p_context_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans; e public.candidate_action_effects;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  IF p.revision<>p_expected_revision THEN RAISE EXCEPTION 'La proposition a été modifiée. Rechargez-la.' USING HINT='ACTION_REVISION_CONFLICT'; END IF;
  IF p_context_version IS NULL OR p.context_version<>p_context_version OR p.status='needs_review' THEN
    RAISE EXCEPTION 'Le contexte a changé. Préparez une nouvelle proposition.' USING HINT='ACTION_CONTEXT_CHANGED';
  END IF;
  IF p.status NOT IN ('draft','partial','approved') THEN RAISE EXCEPTION 'Cette proposition ne peut pas être validée' USING HINT='ACTION_NOT_APPROVABLE'; END IF;
  FOR e IN SELECT * FROM public.candidate_action_effects WHERE plan_id=p.id AND status IN ('prepared','failed') LOOP
    PERFORM public.candidate_actions_assert_effect(p_user_id,p.organization_id,p.candidate_id,p.project_id,e.payload);
  END LOOP;
  UPDATE public.candidate_action_plans SET status='approved',approved_at=now(),revision=revision+1,updated_at=now() WHERE id=p.id;
  RETURN public.candidate_actions_plan_json(p.id);
END $$;

CREATE FUNCTION public.candidate_actions_refresh_plan_state(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT CASE WHEN bool_and(status IN ('succeeded','skipped')) THEN 'completed'
    WHEN bool_or(status='running') THEN 'running'
    WHEN bool_or(status IN ('failed','unknown')) THEN 'partial' ELSE 'approved' END
    INTO v_status FROM public.candidate_action_effects WHERE plan_id=p_plan_id;
  UPDATE public.candidate_action_plans SET status=v_status,updated_at=now() WHERE id=p_plan_id AND status NOT IN ('dismissed','needs_review');
END $$;

CREATE FUNCTION public.candidate_actions_claim_effect(p_user_id uuid,p_plan_id uuid,p_effect_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans; e public.candidate_action_effects; m public.candidate_action_effects; v_token uuid;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  IF p.status NOT IN ('approved','running','partial','completed') THEN RAISE EXCEPTION 'Relisez et validez cette proposition' USING HINT='ACTION_NOT_APPROVED'; END IF;
  SELECT * INTO e FROM public.candidate_action_effects WHERE id=p_effect_id AND plan_id=p.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Effet introuvable' USING HINT='ACTION_INVALID_EFFECT'; END IF;
  IF e.status IN ('succeeded','unknown','skipped') OR (e.status='running' AND e.master_effect_id IS NULL) THEN
    RETURN jsonb_build_object('claimed',false,'effect',e.payload || jsonb_build_object('id',e.id,'status',e.status,'dedupeKey',e.dedupe_key,'result',e.result));
  END IF;
  PERFORM public.candidate_actions_assert_effect(p_user_id,p.organization_id,p.candidate_id,p.project_id,e.payload);
  PERFORM pg_advisory_xact_lock(hashtextextended(e.business_key,0));
  SELECT * INTO m FROM public.candidate_action_effects WHERE business_key=e.business_key AND id<>e.id AND master_effect_id IS NULL
    AND status IN ('running','succeeded','unknown') LIMIT 1;
  IF FOUND THEN
    UPDATE public.candidate_action_effects SET master_effect_id=m.id,
      status=CASE WHEN m.status='succeeded' THEN 'skipped' ELSE m.status END,
      result=CASE WHEN m.status='succeeded' THEN m.result ELSE jsonb_build_object('message','Cette action est déjà en cours ou reste à vérifier.','errorCode','ACTION_DUPLICATE_PENDING') END,
      updated_at=now() WHERE id=e.id RETURNING * INTO e;
    PERFORM public.candidate_actions_refresh_plan_state(p.id);
    RETURN jsonb_build_object('claimed',false,'effect',e.payload || jsonb_build_object('id',e.id,'status',e.status,'dedupeKey',e.dedupe_key,'result',e.result));
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.candidate_action_effects SET status='running',claim_token=v_token,claimed_at=now(),attempts=attempts+1,
    master_effect_id=NULL,result=NULL,updated_at=now() WHERE id=e.id RETURNING * INTO e;
  UPDATE public.candidate_action_plans SET status='running',updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('claimed',true,'claimToken',v_token,'effect',e.payload || jsonb_build_object('id',e.id,'status',e.status,'dedupeKey',e.dedupe_key));
END $$;

CREATE FUNCTION public.candidate_actions_complete_effect(p_user_id uuid,p_plan_id uuid,p_effect_id uuid,p_claim_token uuid,p_status text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans; e public.candidate_action_effects; r jsonb;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  SELECT * INTO e FROM public.candidate_action_effects WHERE id=p_effect_id AND plan_id=p.id FOR UPDATE;
  IF NOT FOUND OR e.claim_token IS DISTINCT FROM p_claim_token OR e.master_effect_id IS NOT NULL THEN
    RAISE EXCEPTION 'Réservation d''action invalide' USING HINT='ACTION_CLAIM_CONFLICT';
  END IF;
  IF e.status IN ('succeeded','failed','unknown') THEN RETURN public.candidate_actions_plan_json(p.id); END IF;
  IF e.status<>'running' OR p_status NOT IN ('succeeded','failed','unknown') THEN RAISE EXCEPTION 'Résultat invalide' USING HINT='ACTION_INVALID_RESULT'; END IF;
  r := coalesce(p_result,'{}'::jsonb) || jsonb_build_object('performedBy',p_user_id)
    || CASE WHEN p_status='succeeded' THEN jsonb_build_object('completedAt',now()) ELSE '{}'::jsonb END;
  UPDATE public.candidate_action_effects SET status=p_status,result=r,completed_at=CASE WHEN p_status='succeeded' THEN now() END,updated_at=now() WHERE id=e.id;
  IF p_status='succeeded' AND e.kind='message' THEN
    UPDATE public.candidate_action_messages m SET action_completed_at=now()
      WHERE m.action_plan_id=p.id AND m.effect_id=e.id
        AND m.organization_id=p.organization_id AND m.candidate_id=p.candidate_id
        AND m.project_id IS NOT DISTINCT FROM p.project_id AND m.owner_user_id=p_user_id
        AND m.direction='outbound' AND m.audience=e.audience
        AND m.account_id=e.payload->>'senderAccountId' AND m.recipient=e.payload->>'recipient'
        AND (m.id::text=r->>'referenceId' OR m.provider_message_id=r->>'providerId');
  END IF;
  PERFORM public.candidate_actions_refresh_plan_state(p.id);
  RETURN public.candidate_actions_plan_json(p.id);
END $$;

CREATE FUNCTION public.candidate_actions_write_internal_effect(p_user_id uuid,p_plan_id uuid,p_effect_id uuid,p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans; e public.candidate_action_effects; v_table text; v_mentions uuid[]; v_member uuid;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  SELECT * INTO e FROM public.candidate_action_effects WHERE id=p_effect_id AND plan_id=p.id FOR UPDATE;
  IF NOT FOUND OR e.claim_token IS DISTINCT FROM p_claim_token OR e.master_effect_id IS NOT NULL THEN RAISE EXCEPTION 'Réservation invalide' USING HINT='ACTION_CLAIM_CONFLICT'; END IF;
  IF e.status='succeeded' THEN RETURN public.candidate_actions_plan_json(p.id); END IF;
  IF e.status<>'running' OR e.kind NOT IN ('document','comment') THEN RAISE EXCEPTION 'Action interne invalide' USING HINT='ACTION_INVALID_EFFECT'; END IF;
  PERFORM public.candidate_actions_assert_effect(p_user_id,p.organization_id,p.candidate_id,p.project_id,e.payload);
  IF e.kind='document' THEN
    v_table := 'candidate_notes';
    INSERT INTO public.candidate_notes(id,candidate_id,content,created_by,organization_id)
      VALUES(e.id,p.candidate_id,(e.payload->>'label') || E'\n\n' || (e.payload->>'content'),p_user_id,p.organization_id);
  ELSE
    v_table := 'candidate_comments';
    SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO v_mentions FROM jsonb_array_elements_text(coalesce(e.payload->'mentions','[]'::jsonb));
    FOREACH v_member IN ARRAY v_mentions LOOP
      PERFORM 1 FROM public.organization_members m WHERE m.organization_id=p.organization_id AND m.user_id=v_member FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cet intervenant ne fait plus partie de l''équipe' USING ERRCODE='42501', HINT='ACTION_TARGET_FORBIDDEN'; END IF;
    END LOOP;
    INSERT INTO public.candidate_comments(id,candidate_id,job_id,content,mentions,created_by,organization_id)
      VALUES(e.id,p.candidate_id,p.project_id::text,e.payload->>'content',v_mentions,p_user_id,p.organization_id);
    INSERT INTO public.notifications(id,user_id,type,title,body,link,metadata,organization_id)
      SELECT md5(e.id::text || ':' || mentioned.user_id::text || ':mention')::uuid,mentioned.user_id,'mention',
        'Vous avez été mentionné dans un commentaire candidat',
        'Un commentaire attend votre lecture dans une fiche candidat.',
        '/pipeline?candidate=' || replace(replace(replace(replace(p.candidate_id,'%','%25'),'&','%26'),'#','%23'),'+','%2B'),
        jsonb_build_object('candidate_action_effect_id',e.id,'candidate_comment_id',e.id,'candidate_action_plan_id',p.id),p.organization_id
      FROM (SELECT DISTINCT user_id FROM unnest(v_mentions) AS members(user_id)) mentioned
      JOIN public.organization_members om ON om.user_id=mentioned.user_id AND om.organization_id=p.organization_id
      WHERE mentioned.user_id<>p_user_id
      ON CONFLICT(id) DO NOTHING;
  END IF;
  RETURN public.candidate_actions_complete_effect(p_user_id,p_plan_id,p_effect_id,p_claim_token,'succeeded',
    jsonb_build_object('referenceId',e.id,'referenceTable',v_table,'message','Contenu enregistré'));
END $$;

CREATE FUNCTION public.candidate_actions_dismiss_plan(p_user_id uuid,p_plan_id uuid,p_dismissed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  IF (p_dismissed AND p.status NOT IN ('draft','needs_review','dismissed')) OR (NOT p_dismissed AND p.status<>'dismissed') THEN
    RAISE EXCEPTION 'Cette action a déjà été validée' USING HINT='ACTION_NOT_EDITABLE';
  END IF;
  UPDATE public.candidate_action_plans SET status=CASE WHEN p_dismissed THEN 'dismissed' ELSE 'draft' END,revision=revision+1,updated_at=now() WHERE id=p.id;
  RETURN public.candidate_actions_plan_json(p.id);
END $$;
CREATE FUNCTION public.candidate_actions_mark_needs_review(p_user_id uuid,p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p public.candidate_action_plans;
BEGIN
  p := public.candidate_actions_owned_plan(p_user_id,p_plan_id);
  UPDATE public.candidate_action_plans SET status='needs_review',revision=revision+1,updated_at=now() WHERE id=p.id AND status NOT IN ('completed','dismissed');
  RETURN public.candidate_actions_plan_json(p.id);
END $$;
CREATE FUNCTION public.candidate_actions_reconcile_interrupted(p_user_id uuid,p_scope jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.candidate_action_effects; v_count integer:=0;
BEGIN
  PERFORM public.candidate_actions_assert_scope(p_user_id,(p_scope->>'organization_id')::uuid,p_scope->>'candidate_id',nullif(p_scope->>'project_id','')::uuid);
  FOR e IN SELECT x.* FROM public.candidate_action_effects x JOIN public.candidate_action_plans p ON p.id=x.plan_id
    WHERE p.user_id=p_user_id AND p.organization_id=(p_scope->>'organization_id')::uuid AND p.candidate_id=p_scope->>'candidate_id'
      AND p.project_id IS NOT DISTINCT FROM nullif(p_scope->>'project_id','')::uuid
      AND x.status='running' AND x.master_effect_id IS NULL AND x.claimed_at<now()-interval '10 minutes' FOR UPDATE OF x LOOP
    -- A document write and its receipt commit together. An interrupted external
    -- request may have reached the provider and is NEVER automatically retried.
    UPDATE public.candidate_action_effects SET status=CASE WHEN e.kind='message' THEN 'unknown' ELSE 'failed' END,
      result=jsonb_build_object('errorCode',CASE WHEN e.kind='message' THEN 'ACTION_SEND_UNKNOWN' ELSE 'ACTION_INTERNAL_INTERRUPTED' END,
        'message',CASE WHEN e.kind='message' THEN 'Résultat de l''envoi à vérifier avant toute reprise.' ELSE 'Enregistrement interrompu, non effectué.' END),updated_at=now() WHERE id=e.id;
    PERFORM public.candidate_actions_refresh_plan_state(e.plan_id);
    v_count := v_count+1;
  END LOOP;
  RETURN v_count;
END $$;

-- Default privileges inherited from the bootstrap grant anonymous SELECT and
-- public EXECUTE. Explicitly close every helper and expose only to the service.
DO $grants$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'candidate_actions_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $grants$;
