-- Migration : RPC transactionnelle de remplacement des étapes du process d'une mission.
-- Constat F5-process-duplicate (audit bêta) : « Réoptimiser avec l'IA » et les templates
-- insèrent N étapes EN PLUS des existantes (UNIQUE(project_id, step_order) supprimée le
-- 2026-03-26 → doublons silencieux), et tout DELETE d'étape laisse orphelins les candidats
-- dont job_candidate_status.pipeline_stage = mission_process_steps.id (MissionPipeline.tsx).
--
-- replace_process_steps(p_project_id, p_steps) :
--   1. verrou advisory transactionnel par projet (sérialise deux remplacements concurrents) ;
--   2. contrôle d'appartenance à l'org du projet (is_org_member) ;
--   3. DELETE des anciennes étapes, INSERT des nouvelles (step_order = position dans le tableau) ;
--   4. remap pipeline_stage : ancien step.id → nouvelle étape de même nom (casse/espaces
--      ignorés), sinon première étape ; retourne le nombre de candidats repositionnés.
-- Idempotente — rejouable sans erreur.

CREATE OR REPLACE FUNCTION public.replace_process_steps(
  p_project_id uuid,
  p_steps jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org       uuid;
  v_old_ids   uuid[];
  v_old_names text[];
  v_first_id  uuid;
  v_remapped  integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) = 0 THEN
    RAISE EXCEPTION 'Le process doit contenir au moins une étape' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_steps) > 50 THEN
    RAISE EXCEPTION 'Trop d''étapes (50 maximum)' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Verrou applicatif par projet : sérialise deux remplacements simultanés
  -- (double clic, deux onglets) SANS verrouiller la ligne sourcing_projects,
  -- que les triggers de job_candidate_status (stats) doivent pouvoir mettre à
  -- jour ; un FOR UPDATE ici créait un cycle de verrous avec un déplacement
  -- kanban concurrent (deadlock reproduit en relecture).
  PERFORM pg_advisory_xact_lock(hashtext('replace_process_steps'), hashtext(p_project_id::text));

  SELECT sp.organization_id INTO v_org
  FROM public.sourcing_projects sp
  WHERE sp.id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Mission introuvable' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_org_member(auth.uid(), v_org) THEN
    RAISE EXCEPTION 'Accès refusé à cette mission' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Snapshot des anciennes étapes (id + nom) pour le remap des candidats.
  SELECT array_agg(s.id   ORDER BY s.step_order, s.created_at),
         array_agg(s.name ORDER BY s.step_order, s.created_at)
    INTO v_old_ids, v_old_names
  FROM public.mission_process_steps s
  WHERE s.project_id = p_project_id;

  DELETE FROM public.mission_process_steps WHERE project_id = p_project_id;

  INSERT INTO public.mission_process_steps (
    project_id, organization_id, step_order, name, description, objectives,
    duration_minutes, interviewer_type, interviewer_name, interviewer_user_id,
    evaluation_criteria, is_eliminatory, template_source
  )
  SELECT
    p_project_id,
    v_org,
    e.ord::integer,
    COALESCE(NULLIF(btrim(e.elem->>'name'), ''), 'Étape ' || e.ord),
    NULLIF(e.elem->>'description', ''),
    CASE WHEN jsonb_typeof(e.elem->'objectives') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(e.elem->'objectives'))
         ELSE '{}'::text[] END,
    COALESCE(NULLIF(e.elem->>'duration_minutes', '')::integer, 30),
    COALESCE(NULLIF(e.elem->>'interviewer_type', ''), 'internal'),
    NULLIF(e.elem->>'interviewer_name', ''),
    NULLIF(e.elem->>'interviewer_user_id', '')::uuid,
    CASE WHEN jsonb_typeof(e.elem->'evaluation_criteria') = 'array'
         THEN e.elem->'evaluation_criteria'
         ELSE '[]'::jsonb END,
    COALESCE((e.elem->>'is_eliminatory')::boolean, false),
    COALESCE(NULLIF(e.elem->>'template_source', ''), 'default')
  FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(elem, ord)
  ORDER BY e.ord;

  SELECT n.id INTO v_first_id
  FROM public.mission_process_steps n
  WHERE n.project_id = p_project_id
  ORDER BY n.step_order
  LIMIT 1;

  -- Remap des candidats positionnés sur une ancienne étape (pipeline_stage = ancien id).
  WITH old_steps AS (
    SELECT o.old_id, o.old_name
    FROM unnest(COALESCE(v_old_ids, '{}'::uuid[]), COALESCE(v_old_names, '{}'::text[])) AS o(old_id, old_name)
  ),
  mapping AS (
    SELECT o.old_id,
           COALESCE(
             (SELECT n.id
                FROM public.mission_process_steps n
               WHERE n.project_id = p_project_id
                 AND lower(btrim(n.name)) = lower(btrim(o.old_name))
               ORDER BY n.step_order
               LIMIT 1),
             v_first_id
           ) AS new_id
    FROM old_steps o
  )
  UPDATE public.job_candidate_status jcs
     SET pipeline_stage = m.new_id::text
    FROM mapping m
   WHERE jcs.project_id = p_project_id
     AND jcs.pipeline_stage = m.old_id::text;
  GET DIAGNOSTICS v_remapped = ROW_COUNT;

  RETURN v_remapped;
END;
$$;

COMMENT ON FUNCTION public.replace_process_steps(uuid, jsonb) IS
  'Remplace atomiquement les étapes du process d''une mission et remappe job_candidate_status.pipeline_stage (ancien step.id → étape de même nom, sinon première étape). Retourne le nombre de candidats repositionnés. Réservé aux membres de l''organisation du projet.';

-- anon reçoit EXECUTE par les default privileges du bootstrap : révocation explicite.
REVOKE ALL ON FUNCTION public.replace_process_steps(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_process_steps(uuid, jsonb) TO authenticated, service_role;
