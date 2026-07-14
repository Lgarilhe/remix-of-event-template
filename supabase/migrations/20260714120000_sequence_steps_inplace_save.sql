-- ============================================
-- Migration: save_sequence_steps — édition non destructive des étapes de séquence
-- ============================================
--
-- PROBLÈME (bloquant B1) : le frontend sauvegardait une séquence éditée via
-- DELETE de TOUS les steps puis re-INSERT. Or `sequence_step_executions.step_id`
-- est en `ON DELETE CASCADE` → chaque édition (même une simple faute de frappe)
-- supprimait TOUTES les exécutions planifiées des enrollments actifs. Résultat :
-- les candidats déjà enrôlés restaient `active` mais ne recevaient plus jamais
-- rien, et l'historique d'envoi disparaissait. Le tout était en plus non
-- transactionnel (delete OK + insert KO = séquence vidée).
--
-- SOLUTION : une fonction transactionnelle (un appel = une transaction, rollback
-- automatique en cas d'erreur) qui met à jour les steps EXISTANTS en place
-- (préserve leur id → les exécutions gardent leur FK et leur contenu), insère
-- les nouveaux, et ne supprime QUE les steps réellement retirés par l'user.
--
-- SECURITY INVOKER (par défaut) : la RLS de `sequence_steps` s'applique donc
-- comme aujourd'hui (policies org-scopées). Aucune élévation de privilège.
--
-- Idempotente (CREATE OR REPLACE) — réexécutable sans danger.
-- ============================================

CREATE OR REPLACE FUNCTION public.save_sequence_steps(
  p_sequence_id uuid,
  p_steps jsonb
)
RETURNS SETOF public.sequence_steps
LANGUAGE plpgsql
-- SECURITY INVOKER explicite : on veut que la RLS du caller s'applique.
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_elem jsonb;
  v_client_id text;
  v_id uuid;
  v_incoming uuid[] := ARRAY[]::uuid[];
  v_map jsonb := '{}'::jsonb;  -- client_id (text) -> db_id (text)
BEGIN
  -- Org de la séquence parente (visible uniquement si le caller y a accès via RLS).
  SELECT organization_id INTO v_org
  FROM public.outreach_sequences
  WHERE id = p_sequence_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence % not found or not accessible', p_sequence_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Pass 1 : upsert des steps (UPDATE in-place si l'id existe déjà pour cette
  --    séquence, sinon INSERT). Les refs de branchement sont posées en pass 2
  --    (après que tous les ids définitifs existent).
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
      -- Step existant → UPDATE in-place (préserve l'id → exécutions intactes).
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
        -- refs de branchement remises à NULL ici, réassignées en pass 2
        if_true_goto_step      = NULL,
        if_false_goto_step     = NULL,
        timeout_branch_step_id = NULL,
        next_step_id           = NULL
      WHERE id = v_id AND sequence_id = p_sequence_id;
    ELSE
      -- Nouveau step → INSERT (id généré par la DB).
      INSERT INTO public.sequence_steps (
        sequence_id, organization_id, step_order, action_type, condition_type,
        condition_value, delay_days, delay_hours, delay_minutes,
        preferred_hour_start, preferred_hour_end, subject_template, message_template,
        use_ai_personalization, ai_tone, timeout_days, wait_for_event,
        variant_group, variant_weight
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
        COALESCE(NULLIF(v_elem->>'variant_weight', '')::int, 100)
      )
      RETURNING id INTO v_id;
    END IF;

    v_incoming := array_append(v_incoming, v_id);
    -- Clé de mapping = l'id client fourni (pour remapper les branchements),
    -- fallback sur le db_id si aucun id client.
    v_map := v_map || jsonb_build_object(COALESCE(v_client_id, v_id::text), v_id::text);
  END LOOP;

  -- ── Suppression des steps RÉELLEMENT retirés (plus dans le payload).
  --    Cascade sur leurs exécutions — mais uniquement pour ces steps précis,
  --    plus le "delete tout" destructeur d'avant.
  DELETE FROM public.sequence_steps
  WHERE sequence_id = p_sequence_id
    AND NOT (id = ANY(v_incoming));

  -- ── Pass 2 : refs de branchement, remappées client_id -> db_id.
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

-- Exécutable par les utilisateurs authentifiés (la RLS reste la barrière réelle).
REVOKE ALL ON FUNCTION public.save_sequence_steps(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_sequence_steps(uuid, jsonb) TO authenticated, service_role;
