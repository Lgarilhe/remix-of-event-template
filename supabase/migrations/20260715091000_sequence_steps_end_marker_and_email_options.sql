-- ============================================
-- Migration: ends_sequence + options email dans save_sequence_steps
-- ============================================
--
-- 1. `ends_sequence` (audit 2026-07, Builder H2) : le builder propose « Fin de
--    séquence » (sentinelle '__end__' côté client) mais la sauvegarde la
--    convertissait en next_step_id=NULL = « automatique » → le moteur
--    enchaînait sur step_order+1, l'inverse de l'intention. Nouvelle colonne
--    booléenne lue par scheduleNextStep (process-sequences).
--
-- 2. save_sequence_steps v2 (audit 2026-07, Builder H3) : persiste désormais
--    ends_sequence + les options email des steps (cc_emails, bcc_emails,
--    include_unsubscribe, signature_id) que l'ancien chemin de sauvegarde
--    perdait silencieusement à chaque édition.
--
-- Idempotente — réexécutable sans danger.
-- ============================================

ALTER TABLE public.sequence_steps
  ADD COLUMN IF NOT EXISTS ends_sequence boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sequence_steps.ends_sequence IS
  'Fin de séquence explicite choisie dans le builder : après ce step, le moteur complete l''enrollment au lieu d''enchaîner sur step_order+1.';

CREATE OR REPLACE FUNCTION public.save_sequence_steps(
  p_sequence_id uuid,
  p_steps jsonb
)
RETURNS SETOF public.sequence_steps
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_elem jsonb;
  v_client_id text;
  v_id uuid;
  v_incoming uuid[] := ARRAY[]::uuid[];
  v_map jsonb := '{}'::jsonb;
BEGIN
  SELECT organization_id INTO v_org
  FROM public.outreach_sequences
  WHERE id = p_sequence_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence % not found or not accessible', p_sequence_id
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    v_client_id := NULLIF(v_elem->>'id', '');
    v_id := NULL;

    IF v_client_id IS NOT NULL
       AND v_client_id ~ '^[0-9a-fA-F-]{36}$'
       AND EXISTS (
         SELECT 1 FROM public.sequence_steps
         WHERE id = v_client_id::uuid AND sequence_id = p_sequence_id
       ) THEN
      v_id := v_client_id::uuid;
      UPDATE public.sequence_steps SET
        organization_id        = v_org,
        step_order             = COALESCE((v_elem->>'step_order')::int, step_order),
        action_type            = COALESCE(v_elem->>'action_type', action_type),
        condition_type         = COALESCE(v_elem->>'condition_type', condition_type),
        condition_value        = NULLIF(v_elem->>'condition_value', ''),
        delay_days             = COALESCE(NULLIF(v_elem->>'delay_days', '')::int, 0),
        delay_hours            = COALESCE(NULLIF(v_elem->>'delay_hours', '')::int, 0),
        delay_minutes          = COALESCE(NULLIF(v_elem->>'delay_minutes', '')::int, 0),
        preferred_hour_start   = NULLIF(v_elem->>'preferred_hour_start', '')::int,
        preferred_hour_end     = NULLIF(v_elem->>'preferred_hour_end', '')::int,
        subject_template       = v_elem->>'subject_template',
        message_template       = v_elem->>'message_template',
        use_ai_personalization = COALESCE((v_elem->>'use_ai_personalization')::boolean, false),
        ai_tone                = v_elem->>'ai_tone',
        timeout_days           = NULLIF(v_elem->>'timeout_days', '')::int,
        wait_for_event         = v_elem->>'wait_for_event',
        variant_group          = NULLIF(v_elem->>'variant_group', ''),
        variant_weight         = COALESCE(NULLIF(v_elem->>'variant_weight', '')::int, 100),
        ends_sequence          = COALESCE((v_elem->>'ends_sequence')::boolean, false),
        cc_emails              = CASE WHEN v_elem ? 'cc_emails' AND jsonb_typeof(v_elem->'cc_emails') = 'array'
                                      THEN ARRAY(SELECT jsonb_array_elements_text(v_elem->'cc_emails')) ELSE cc_emails END,
        bcc_emails             = CASE WHEN v_elem ? 'bcc_emails' AND jsonb_typeof(v_elem->'bcc_emails') = 'array'
                                      THEN ARRAY(SELECT jsonb_array_elements_text(v_elem->'bcc_emails')) ELSE bcc_emails END,
        include_unsubscribe    = CASE WHEN v_elem ? 'include_unsubscribe'
                                      THEN (v_elem->>'include_unsubscribe')::boolean ELSE include_unsubscribe END,
        signature_id           = CASE WHEN v_elem ? 'signature_id'
                                      THEN NULLIF(v_elem->>'signature_id', '')::uuid ELSE signature_id END,
        if_true_goto_step      = NULL,
        if_false_goto_step     = NULL,
        timeout_branch_step_id = NULL,
        next_step_id           = NULL
      WHERE id = v_id AND sequence_id = p_sequence_id;
    ELSE
      INSERT INTO public.sequence_steps (
        sequence_id, organization_id, step_order, action_type, condition_type,
        condition_value, delay_days, delay_hours, delay_minutes,
        preferred_hour_start, preferred_hour_end, subject_template, message_template,
        use_ai_personalization, ai_tone, timeout_days, wait_for_event,
        variant_group, variant_weight, ends_sequence,
        cc_emails, bcc_emails, include_unsubscribe, signature_id
      ) VALUES (
        p_sequence_id, v_org,
        COALESCE((v_elem->>'step_order')::int, 0),
        v_elem->>'action_type',
        COALESCE(v_elem->>'condition_type', 'always'),
        NULLIF(v_elem->>'condition_value', ''),
        COALESCE(NULLIF(v_elem->>'delay_days', '')::int, 0),
        COALESCE(NULLIF(v_elem->>'delay_hours', '')::int, 0),
        COALESCE(NULLIF(v_elem->>'delay_minutes', '')::int, 0),
        NULLIF(v_elem->>'preferred_hour_start', '')::int,
        NULLIF(v_elem->>'preferred_hour_end', '')::int,
        v_elem->>'subject_template',
        v_elem->>'message_template',
        COALESCE((v_elem->>'use_ai_personalization')::boolean, false),
        v_elem->>'ai_tone',
        NULLIF(v_elem->>'timeout_days', '')::int,
        v_elem->>'wait_for_event',
        NULLIF(v_elem->>'variant_group', ''),
        COALESCE(NULLIF(v_elem->>'variant_weight', '')::int, 100),
        COALESCE((v_elem->>'ends_sequence')::boolean, false),
        CASE WHEN v_elem ? 'cc_emails' AND jsonb_typeof(v_elem->'cc_emails') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(v_elem->'cc_emails')) ELSE NULL END,
        CASE WHEN v_elem ? 'bcc_emails' AND jsonb_typeof(v_elem->'bcc_emails') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(v_elem->'bcc_emails')) ELSE NULL END,
        CASE WHEN v_elem ? 'include_unsubscribe'
             THEN (v_elem->>'include_unsubscribe')::boolean ELSE NULL END,
        NULLIF(v_elem->>'signature_id', '')::uuid
      )
      RETURNING id INTO v_id;
    END IF;

    v_incoming := array_append(v_incoming, v_id);
    v_map := v_map || jsonb_build_object(COALESCE(v_client_id, v_id::text), v_id::text);
  END LOOP;

  DELETE FROM public.sequence_steps
  WHERE sequence_id = p_sequence_id
    AND NOT (id = ANY(v_incoming));

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    v_client_id := COALESCE(NULLIF(v_elem->>'id', ''), '');
    v_id := NULLIF(v_map->>v_client_id, '')::uuid;
    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.sequence_steps SET
      if_true_goto_step      = NULLIF(v_map->>(v_elem->>'if_true_goto_step'), '')::uuid,
      if_false_goto_step     = NULLIF(v_map->>(v_elem->>'if_false_goto_step'), '')::uuid,
      timeout_branch_step_id = NULLIF(v_map->>(v_elem->>'timeout_branch_step_id'), '')::uuid,
      next_step_id           = NULLIF(v_map->>(v_elem->>'next_step_id'), '')::uuid
    WHERE id = v_id AND sequence_id = p_sequence_id;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.sequence_steps
    WHERE sequence_id = p_sequence_id
    ORDER BY step_order;
END;
$$;

REVOKE ALL ON FUNCTION public.save_sequence_steps(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_sequence_steps(uuid, jsonb) TO authenticated, service_role;
