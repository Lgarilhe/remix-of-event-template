-- Automatic memory is explicit consent to six closed communication policies.
-- It never accepts free-form model instructions, sourcing or scoring criteria.
ALTER TABLE public.agent_memories
  ADD COLUMN IF NOT EXISTS activation_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS automation_version integer,
  ADD COLUMN IF NOT EXISTS automation_key text,
  ADD COLUMN IF NOT EXISTS automation_source_created_at timestamptz;
ALTER TABLE public.agent_memories DROP CONSTRAINT IF EXISTS agent_memories_activation_check;
ALTER TABLE public.agent_memories ADD CONSTRAINT agent_memories_activation_check CHECK (
  (activation_mode = 'manual' AND automation_version IS NULL AND automation_key IS NULL AND automation_source_created_at IS NULL)
  OR (activation_mode = 'automatic' AND automation_version IS NOT NULL AND automation_version >= 1
    AND automation_key IS NOT NULL AND automation_key IN ('response_language', 'response_length', 'response_format')
    AND automation_source_created_at IS NOT NULL AND scope = 'user' AND kind = 'preference')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memories_one_automatic_policy
  ON public.agent_memories(organization_id, owner_user_id, automation_key)
  WHERE activation_mode = 'automatic' AND status = 'active';

CREATE TABLE IF NOT EXISTS public.agent_memory_automation (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'automatic')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  suggestion_dismissed boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CHECK ((mode = 'manual' AND enabled_at IS NULL) OR (mode = 'automatic' AND enabled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_automation_org_id ON public.agent_memory_automation(organization_id);
ALTER TABLE public.agent_memory_automation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_memory_automation_owner_select ON public.agent_memory_automation;
CREATE POLICY agent_memory_automation_owner_select ON public.agent_memory_automation FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id));
DROP POLICY IF EXISTS agent_memory_automation_owner_insert ON public.agent_memory_automation;
CREATE POLICY agent_memory_automation_owner_insert ON public.agent_memory_automation FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id));
DROP POLICY IF EXISTS agent_memory_automation_owner_update ON public.agent_memory_automation;
CREATE POLICY agent_memory_automation_owner_update ON public.agent_memory_automation FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id));
DROP POLICY IF EXISTS agent_memory_automation_service_access ON public.agent_memory_automation;
CREATE POLICY agent_memory_automation_service_access ON public.agent_memory_automation
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Neither a direct client update nor a model payload can backdate consent.
CREATE OR REPLACE FUNCTION public.agent_memory_automation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid()
    OR NEW.organization_id IS DISTINCT FROM public.get_user_org_id(auth.uid())
    OR NOT public.is_org_member(auth.uid(), NEW.organization_id) THEN
    RAISE EXCEPTION 'Automatic memory consent belongs to the current user'
      USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Automatic memory consent identities are immutable'
        USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.enabled_at := CASE WHEN NEW.mode = 'manual' THEN NULL
      WHEN OLD.mode = 'automatic' THEN OLD.enabled_at ELSE clock_timestamp() END;
    NEW.suggestion_dismissed := OLD.suggestion_dismissed OR NEW.suggestion_dismissed OR NEW.mode = 'automatic';
  ELSE
    NEW.version := 1;
    NEW.enabled_at := CASE WHEN NEW.mode = 'automatic' THEN clock_timestamp() ELSE NULL END;
    NEW.suggestion_dismissed := NEW.suggestion_dismissed OR NEW.mode = 'automatic';
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_memory_automation_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS agent_memory_automation_guard ON public.agent_memory_automation;
CREATE TRIGGER agent_memory_automation_guard BEFORE INSERT OR UPDATE ON public.agent_memory_automation
  FOR EACH ROW EXECUTE FUNCTION public.agent_memory_automation_guard();

-- This matcher is intentionally anchored on the entire clean user message.
-- Quotes, questions, negations, candidate criteria and compound requests fail.
CREATE OR REPLACE FUNCTION public.agent_memory_communication_policy(p_text text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE t text; k text; v text; c text; effects text[];
BEGIN
  t := lower(btrim(regexp_replace(coalesce(p_text, ''), '[[:space:]]+', ' ', 'g')));
  t := btrim(regexp_replace(t, '[.!]+$', ''));
  IF t ~ '^(réponds(-moi)?|répondez(-moi)?|répondre|merci de répondre|je préfère des réponses) en français$'
    OR t ~ '^(please )?(answer( me)?|respond( to me)?) in french$'
    OR t ~ '^i prefer (answers|responses) in french$' THEN
    k := 'response_language'; v := 'fr'; c := 'Répondre en français.'; effects := ARRAY['assistant'];
  ELSIF t ~ '^(réponds(-moi)?|répondez(-moi)?|répondre|merci de répondre|je préfère des réponses) en anglais$'
    OR t ~ '^(please )?(answer( me)?|respond( to me)?) in english$'
    OR t ~ '^i prefer (answers|responses) in english$' THEN
    k := 'response_language'; v := 'en'; c := 'Répondre en anglais.'; effects := ARRAY['assistant'];
  ELSIF t ~ '^(je préfère (des réponses|tes réponses)|je veux des réponses|merci de faire des réponses) (courtes|concises|brèves)$'
    OR t ~ '^(sois|reste) (bref|concis) dans tes réponses$'
    OR t = 'privilégier des réponses courtes'
    OR t ~ '^(i prefer|please give me|give me) (short|concise|brief) (answers|responses)$' THEN
    k := 'response_length'; v := 'concise'; c := 'Privilégier des réponses courtes.'; effects := ARRAY['assistant'];
  ELSIF t ~ '^(je préfère (des réponses|tes réponses)|je veux des réponses|merci de faire des réponses) (détaillées|développées|approfondies)$'
    OR t ~ '^je veux une explication (détaillée|approfondie)$'
    OR t = 'privilégier des réponses détaillées'
    OR t ~ '^(i prefer|please give me|give me) (detailed|in-depth) (answers|responses)$' THEN
    k := 'response_length'; v := 'detailed'; c := 'Privilégier des réponses détaillées.'; effects := ARRAY['assistant'];
  ELSIF t ~ '^(présente tes réponses|présentez vos réponses|je préfère des réponses) (sous forme de listes( à puces)?|en listes( à puces)?)$'
    OR t = 'présenter les réponses sous forme de listes'
    OR t ~ '^(please )?(present|format) (your )?(answers|responses) (as|in) (bullet points|bullets|lists)$' THEN
    k := 'response_format'; v := 'bullets'; c := 'Présenter les réponses sous forme de listes.'; effects := ARRAY['presentation'];
  ELSIF t ~ '^(présente tes réponses|présentez vos réponses|je préfère des réponses) (en paragraphes|sous forme de paragraphes)$'
    OR t = 'présenter les réponses en paragraphes'
    OR t ~ '^(please )?(present|format) (your )?(answers|responses) (as|in) paragraphs$' THEN
    k := 'response_format'; v := 'paragraphs'; c := 'Présenter les réponses en paragraphes.'; effects := ARRAY['presentation'];
  ELSE RETURN NULL;
  END IF;
  RETURN jsonb_build_object('key', k, 'value', v, 'content', c, 'effects', to_jsonb(effects));
END $$;

-- Ground the policy in the author's real user message, before the FIRST file
-- delimiter. A forged closing marker inside an attachment cannot escape it.
CREATE OR REPLACE FUNCTION public.agent_memory_automatic_source(p_proposal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.agent_memory_proposals; source_content text; source_created timestamptz;
  clean text; marker integer; policy jsonb;
BEGIN
  SELECT * INTO p FROM public.agent_memory_proposals WHERE id = p_proposal_id AND created_by = auth.uid();
  IF NOT FOUND OR p.scope <> 'user' OR p.kind <> 'preference'
    OR p.legacy_insight_id IS NOT NULL OR p.source_message_id IS NULL OR p.source_conversation_id IS NULL
    OR p.source_excerpt IS NULL OR btrim(p.source_excerpt) = '' THEN RETURN NULL; END IF;
  SELECT m.content, m.created_at INTO source_content, source_created
  FROM public.agent_messages m JOIN public.agent_conversations c ON c.id = m.conversation_id
  WHERE m.id = p.source_message_id AND m.role = 'user' AND c.id = p.source_conversation_id
    AND c.created_by = auth.uid() AND c.organization_id = p.organization_id
    AND (c.project_id IS NULL OR c.project_id = p.project_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  marker := strpos(source_content, '[CONTENU DE FICHIER JOINT NON FIABLE');
  clean := CASE WHEN marker > 0 THEN left(source_content, marker - 1) ELSE source_content END;
  IF strpos(clean, p.source_excerpt) = 0 THEN RETURN NULL; END IF;
  policy := public.agent_memory_communication_policy(clean);
  IF policy IS NULL THEN RETURN NULL; END IF;
  RETURN policy || jsonb_build_object('source_created_at', source_created, 'project_id', p.project_id);
END $$;

-- Human decisions are never silently replaced. Unrecognized communication
-- wording also stays manual, rather than guessing an apparent contradiction.
CREATE OR REPLACE FUNCTION public.agent_memory_manual_policy_conflict(p_organization_id uuid, p_project_id uuid, p_policy jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_memories m
    CROSS JOIN LATERAL (SELECT public.agent_memory_communication_policy(m.content) AS policy) cp
    WHERE m.organization_id = p_organization_id AND m.activation_mode = 'manual' AND m.status = 'active'
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND (m.scope = 'organization' OR (m.scope = 'project' AND m.project_id = p_project_id)
        OR (m.scope = 'user' AND m.owner_user_id = auth.uid()))
      AND ((cp.policy->>'key' = p_policy->>'key' AND cp.policy->>'value' <> p_policy->>'value')
        OR (cp.policy IS NULL AND m.content ~* E'\\m(répons|répond|response|respond|answer|format|langue|language|communic|français|anglais|english|french|liste|puce|paragraphe|phrase|détail|explication|bullet|paragraph|detail|explanation)[[:alpha:]]*\\M'))
  )
$$;

CREATE OR REPLACE FUNCTION public.get_agent_memory_automation(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE s public.agent_memory_automation; d record; n integer := 0;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS DISTINCT FROM public.get_user_org_id(auth.uid())
    OR NOT public.is_org_member(auth.uid(), p_organization_id) THEN
    RAISE EXCEPTION 'Automatic memory organization is unavailable'
      USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
  END IF;
  SELECT * INTO s FROM public.agent_memory_automation WHERE organization_id = p_organization_id AND user_id = auth.uid();
  FOR d IN
    SELECT p.id, p.status, EXISTS (
      SELECT 1 FROM public.agent_memories m WHERE m.proposal_id = p.id AND m.activation_mode = 'manual'
        AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > now())
        AND m.content = p.content AND m.kind = p.kind AND m.scope = p.scope AND m.effects = p.effects
    ) AS exact_confirmation
    FROM public.agent_memory_proposals p
    JOIN public.agent_messages msg ON msg.id = p.source_message_id AND msg.role = 'user'
    JOIN public.agent_conversations c ON c.id = p.source_conversation_id AND c.id = msg.conversation_id
      AND c.created_by = auth.uid() AND c.organization_id = p_organization_id
    WHERE p.organization_id = p_organization_id AND p.created_by = auth.uid() AND p.status IN ('approved','dismissed')
      AND p.legacy_insight_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.agent_memories m WHERE m.proposal_id = p.id AND m.activation_mode = 'automatic')
    ORDER BY p.updated_at DESC, p.id DESC LIMIT 5
  LOOP
    IF d.status <> 'approved' OR NOT d.exact_confirmation THEN EXIT; END IF;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('mode', coalesce(s.mode, 'manual'), 'version', coalesce(s.version, 0),
    'calibration_count', n, 'suggestion_dismissed', coalesce(s.suggestion_dismissed, false),
    'enabled_at', s.enabled_at,
    'can_suggest', n >= 5 AND coalesce(s.mode, 'manual') = 'manual' AND NOT coalesce(s.suggestion_dismissed, false));
END $$;

CREATE OR REPLACE FUNCTION public.set_agent_memory_automation(
  p_organization_id uuid, p_expected_version integer, p_mode text, p_dismiss_suggestion boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s public.agent_memory_automation;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS DISTINCT FROM public.get_user_org_id(auth.uid())
    OR NOT public.is_org_member(auth.uid(), p_organization_id) THEN
    RAISE EXCEPTION 'Automatic memory consent belongs to the current user'
      USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('manual','automatic') OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'Invalid automatic memory setting' USING ERRCODE = '22023', HINT = 'MEMORY_AUTOMATION_INVALID_INPUT';
  END IF;
  -- Lock an absent row too, so two first opt-ins cannot both claim version 0.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text || '/' || auth.uid()::text, 0));
  SELECT * INTO s FROM public.agent_memory_automation WHERE organization_id = p_organization_id AND user_id = auth.uid() FOR UPDATE;
  IF coalesce(s.version, 0) <> p_expected_version THEN
    RAISE EXCEPTION 'Automatic memory settings changed; refresh before deciding'
      USING ERRCODE = '40001', HINT = 'MEMORY_AUTOMATION_VERSION_CONFLICT';
  END IF;
  IF s.user_id IS NULL THEN
    INSERT INTO public.agent_memory_automation (organization_id, user_id, mode, suggestion_dismissed)
      VALUES (p_organization_id, auth.uid(), p_mode, coalesce(p_dismiss_suggestion, false));
  ELSE
    UPDATE public.agent_memory_automation SET mode = p_mode,
      suggestion_dismissed = s.suggestion_dismissed OR coalesce(p_dismiss_suggestion, false)
    WHERE organization_id = p_organization_id AND user_id = auth.uid();
  END IF;
  RETURN public.get_agent_memory_automation(p_organization_id);
END $$;

-- Replace the existing insertion guard; manual confirmation stays unchanged.
-- Automatic payloads must exactly match a closed policy independently derived
-- from source and consent. The model's proposal.content is never trusted.
CREATE OR REPLACE FUNCTION public.agent_memory_validated_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.agent_memory_proposals; s public.agent_memory_automation; policy jsonb; effects text[];
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
    NEW.version := OLD.version + 1; NEW.updated_at := now(); RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT coalesce(public.agent_memory_can_manage(NEW.organization_id, NEW.scope, NEW.project_id, NEW.owner_user_id), false) THEN
    RAISE EXCEPTION 'Memory scope requires an authorized confirmation' USING ERRCODE = '42501', HINT = 'MEMORY_FORBIDDEN';
  END IF;
  SELECT * INTO p FROM public.agent_memory_proposals
    WHERE id = NEW.proposal_id AND organization_id = NEW.organization_id AND created_by = auth.uid() AND status = 'approved';
  IF NOT FOUND OR NEW.created_by <> auth.uid() OR NEW.confirmed_by <> auth.uid()
    OR (NEW.scope = 'project' AND NEW.project_id IS DISTINCT FROM p.project_id)
    OR (NEW.scope = 'user' AND NEW.owner_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Memory proposal confirmation is unavailable' USING ERRCODE = '42501', HINT = 'MEMORY_PROPOSAL_FORBIDDEN';
  END IF;
  IF NEW.status <> 'active' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'Invalid initial memory status' USING ERRCODE = '22023', HINT = 'MEMORY_INVALID_TRANSITION';
  END IF;
  NEW.content := btrim(NEW.content);
  NEW.effects := ARRAY(SELECT DISTINCT e FROM unnest(NEW.effects) e ORDER BY e);
  IF NEW.activation_mode = 'automatic' THEN
    SELECT * INTO s FROM public.agent_memory_automation
      WHERE organization_id = NEW.organization_id AND user_id = auth.uid() FOR SHARE;
    policy := public.agent_memory_automatic_source(p.id);
    IF s.mode IS DISTINCT FROM 'automatic' OR s.version IS DISTINCT FROM NEW.automation_version
      OR policy IS NULL OR p.created_at < s.enabled_at OR (policy->>'source_created_at')::timestamptz < s.enabled_at THEN
      RAISE EXCEPTION 'Automatic memory requires fresh source and current consent'
        USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
    END IF;
    effects := ARRAY(SELECT jsonb_array_elements_text(policy->'effects'));
    IF NEW.scope <> 'user' OR NEW.kind <> 'preference' OR NEW.content <> policy->>'content'
      OR NEW.effects <> effects OR NEW.automation_key IS DISTINCT FROM policy->>'key'
      OR public.agent_memory_manual_policy_conflict(NEW.organization_id, p.project_id, policy)
      OR EXISTS (SELECT 1 FROM public.agent_memories prior_memory
        WHERE prior_memory.organization_id = NEW.organization_id AND prior_memory.owner_user_id = auth.uid()
          AND prior_memory.activation_mode = 'automatic' AND prior_memory.automation_key = policy->>'key'
          AND prior_memory.automation_source_created_at >= (policy->>'source_created_at')::timestamptz) THEN
      RAISE EXCEPTION 'Automatic memory must follow a closed, conflict-free communication policy'
        USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
    END IF;
    NEW.automation_source_created_at := (policy->>'source_created_at')::timestamptz;
  ELSIF NEW.activation_mode <> 'manual' OR NEW.automation_version IS NOT NULL OR NEW.automation_key IS NOT NULL
    OR NEW.automation_source_created_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid memory activation metadata' USING ERRCODE = '42501', HINT = 'MEMORY_AUTOMATION_FORBIDDEN';
  END IF;
  NEW.confirmed_at := now(); NEW.created_at := now(); NEW.updated_at := now(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.auto_approve_agent_memory(p_proposal_id uuid, p_automation_version integer)
RETURNS public.agent_memories LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.agent_memory_proposals; s public.agent_memory_automation; m public.agent_memories;
  policy jsonb; org uuid; effects text[];
BEGIN
  org := public.get_user_org_id(auth.uid());
  IF auth.uid() IS NULL OR org IS NULL OR NOT public.is_org_member(auth.uid(), org) THEN RETURN NULL; END IF;
  -- Consent first, proposal second: disabling waits for an in-flight decision,
  -- while a completed disable makes every stale model callback a no-op.
  SELECT * INTO s FROM public.agent_memory_automation WHERE organization_id = org AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR s.mode <> 'automatic' OR s.version IS DISTINCT FROM p_automation_version THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.agent_memory_proposals WHERE id = p_proposal_id
    AND organization_id = org AND created_by = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p.status = 'approved' THEN
    SELECT * INTO m FROM public.agent_memories WHERE proposal_id = p.id AND activation_mode = 'automatic'
      AND automation_version = p_automation_version AND status = 'active';
    IF FOUND THEN RETURN m; END IF;
    RETURN NULL;
  END IF;
  IF p.status <> 'proposed' OR p.created_at < s.enabled_at THEN RETURN NULL; END IF;
  policy := public.agent_memory_automatic_source(p.id);
  IF policy IS NULL OR (policy->>'source_created_at')::timestamptz < s.enabled_at
    OR public.agent_memory_manual_policy_conflict(org, p.project_id, policy)
    OR EXISTS (SELECT 1 FROM public.agent_memories prior_memory WHERE prior_memory.organization_id = org AND prior_memory.owner_user_id = auth.uid()
      AND prior_memory.activation_mode = 'automatic' AND prior_memory.automation_key = policy->>'key'
      AND prior_memory.automation_source_created_at >= (policy->>'source_created_at')::timestamptz) THEN RETURN NULL; END IF;
  effects := ARRAY(SELECT jsonb_array_elements_text(policy->'effects'));
  -- Retain historical evidence; only earlier automatic preferences of this
  -- same category are replaced. Human-confirmed memories remain untouched.
  UPDATE public.agent_memories SET status = 'archived' WHERE organization_id = org AND owner_user_id = auth.uid()
    AND activation_mode = 'automatic' AND automation_key = policy->>'key' AND status = 'active';
  UPDATE public.agent_memory_proposals SET status = 'approved' WHERE id = p.id;
  INSERT INTO public.agent_memories (organization_id, proposal_id, created_by, confirmed_by, scope, owner_user_id,
    content, kind, effects, activation_mode, automation_version, automation_key, automation_source_created_at)
  VALUES (org, p.id, auth.uid(), auth.uid(), 'user', auth.uid(), policy->>'content', 'preference', effects,
    'automatic', s.version, policy->>'key', (policy->>'source_created_at')::timestamptz) RETURNING * INTO m;
  RETURN m;
END $$;

REVOKE ALL ON TABLE public.agent_memory_automation FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_memory_automation TO authenticated;
GRANT ALL ON public.agent_memory_automation TO service_role;
REVOKE ALL ON FUNCTION public.agent_memory_communication_policy(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agent_memory_automatic_source(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agent_memory_manual_policy_conflict(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_memory_communication_policy(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_memory_automatic_source(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_memory_manual_policy_conflict(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.get_agent_memory_automation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agent_memory_automation(uuid, integer, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auto_approve_agent_memory(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agent_memory_automation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_memory_automation(uuid, integer, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_agent_memory(uuid, integer) TO authenticated;

-- Real creation/decision timestamps remain ordered even within one transaction.
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
    NEW.updated_at := clock_timestamp();
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
  NEW.created_at := clock_timestamp(); NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
