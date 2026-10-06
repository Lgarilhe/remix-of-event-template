-- Refonte mission, lot 0c-4 : correctif d'undo_candidate_stages (relecture du 04/10/2026).
--
-- Annuler un simple changement de colonne d'entretien du /pipeline (par exemple
-- ITW en cours vers Offre, la date d'entrée dans l'étape ne bouge pas) effaçait
-- replied_at, first_interview_at et les autres jalons égaux à after_entered_at :
-- ces jalons datent de l'entrée en entretien, avant le geste, et sont vrais.
-- Désormais les jalons ne sont effacés que si le geste a changé l'étape (date
-- d'entrée d'avant différente de after_entered_at). presented_at posé par un
-- passage en « CV envoyé » reste effacé par v_unpres, comme avant.
-- Seule la fonction est remplacée (signature et droits inchangés) ; la migration
-- rejoue sur une base vide après 20260929112827.

CREATE OR REPLACE FUNCTION public.undo_candidate_stages(p_moves jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  m        jsonb;
  bf       jsonb;
  v_id     uuid;
  v_after  timestamptz;
  v_undo   timestamptz;
  v_b_at   timestamptz;
  v_b_rej  timestamptz;
  v_b_src  text;
  v_b_step uuid;
  v_b_leg  text;
  v_unpres boolean;
  v_moved  boolean;
  r        record;
  v_res    jsonb;
  v_hint   text;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF p_moves IS NULL OR jsonb_typeof(p_moves) <> 'array' THEN
    RAISE EXCEPTION 'Annulation : tableau attendu' USING ERRCODE = '22023', HINT = 'STAGE_UNDO_INVALID';
  END IF;
  IF jsonb_array_length(p_moves) > 200 THEN
    RAISE EXCEPTION 'Trop de lignes (200 au plus)' USING ERRCODE = '22023', HINT = 'STAGE_BATCH_TOO_LARGE';
  END IF;

  FOR m IN SELECT e FROM jsonb_array_elements(p_moves) AS e LOOP
    BEGIN
      v_id     := (m->>'id')::uuid;
      v_after  := (m->>'after_entered_at')::timestamptz;
      bf       := m->'before';
      v_b_step := nullif(bf->>'process_step_id', '')::uuid;
      v_b_at   := nullif(bf->>'stage_entered_at', '')::timestamptz;
      v_b_rej  := nullif(bf->>'rejected_at', '')::timestamptz;
      v_b_src  := nullif(bf->>'decision_source', '');
      v_b_leg  := nullif(bf->>'legacy_stage', '');
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', m->>'id', 'result', 'error', 'hint', 'STAGE_UNDO_INVALID'));
      CONTINUE;
    END;
    IF v_id IS NULL OR v_after IS NULL OR jsonb_typeof(bf) IS DISTINCT FROM 'object'
       OR nullif(bf->>'general_stage', '') IS NULL
       OR (v_b_src IS NOT NULL AND v_b_src NOT IN ('ai','user','system'))
       OR (nullif(bf->>'rejected_from_stage', '') IS NOT NULL
           AND bf->>'rejected_from_stage' NOT IN ('to_sort','retained','contacted','replied','interviewing','hired')) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'result', 'error', 'hint', 'STAGE_UNDO_INVALID'));
      CONTINUE;
    END IF;

    SELECT j.general_stage, j.process_step_id, j.stage_entered_at, j.pipeline_stage, j.decision_source INTO r
      FROM public.job_candidate_status j WHERE j.id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'result', 'error', 'hint', 'STAGE_ROW_NOT_FOUND'));
      CONTINUE;
    END IF;
    IF r.stage_entered_at IS DISTINCT FROM v_after
       OR r.decision_source IS DISTINCT FROM 'user'
       OR (m ? 'after_pipeline_stage'
           AND r.pipeline_stage IS DISTINCT FROM nullif(m->>'after_pipeline_stage', '')) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'result', 'moved_since'));
      CONTINUE;
    END IF;
    IF r.general_stage = bf->>'general_stage' AND r.process_step_id IS NOT DISTINCT FROM v_b_step
       AND (v_b_leg IS NULL OR r.pipeline_stage IS NOT DISTINCT FROM v_b_leg) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'result', 'unchanged'));
      CONTINUE;
    END IF;
    -- Passage en « CV envoyé » annulé : presented_at posé par le geste.
    v_unpres := r.pipeline_stage = 'CV envoyé' AND v_b_leg IS DISTINCT FROM 'CV envoyé'
                AND bf ? 'presented_at' AND nullif(bf->>'presented_at', '') IS NULL;
    -- Le geste a changé l'étape (donc posé la date d'entrée et les jalons manquants) :
    -- seulement alors les jalons égaux à cette date sont ceux du geste. Entre deux
    -- colonnes d'entretien, la date d'entrée et les jalons d'entrée en entretien
    -- sont d'avant le geste et restent.
    v_moved := v_b_at IS DISTINCT FROM v_after;

    BEGIN
      v_res := public.set_candidate_stage(v_id, bf->>'general_stage', 'user', NULL,
                                          v_b_step, v_b_leg);
    EXCEPTION WHEN invalid_parameter_value OR no_data_found THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'result', 'error', 'hint', v_hint));
      CONTINUE;
    END;
    v_undo := (v_res->>'stage_entered_at')::timestamptz;

    -- Le drapeau fait traverser stage_sync_from_legacy ; la garde
    -- stage_write_guard ne regarde ni les jalons ni la date.
    PERFORM set_config('konekt.stage_write', v_id::text, true);
    UPDATE public.job_candidate_status SET
      contacted_at       = CASE WHEN v_moved AND contacted_at IN (v_after, v_undo) THEN NULL ELSE contacted_at END,
      replied_at         = CASE WHEN v_moved AND replied_at IN (v_after, v_undo) THEN NULL ELSE replied_at END,
      first_interview_at = CASE WHEN v_moved AND first_interview_at IN (v_after, v_undo) THEN NULL ELSE first_interview_at END,
      presented_at       = CASE WHEN (v_moved AND presented_at IN (v_after, v_undo))
                                     OR (v_unpres AND presented_at >= v_after)
                                THEN NULL ELSE presented_at END,
      hired_at           = CASE WHEN v_moved AND hired_at IN (v_after, v_undo) THEN NULL ELSE hired_at END,
      stage_entered_at   = CASE WHEN v_b_at < v_after THEN v_b_at ELSE stage_entered_at END,
      decision_source    = CASE WHEN bf ? 'decision_source' THEN v_b_src ELSE decision_source END,
      rejected_at        = CASE WHEN v_b_rej IS NULL OR v_b_rej < v_after THEN v_b_rej ELSE rejected_at END,
      rejected_from_stage = CASE WHEN v_b_rej IS NULL OR v_b_rej < v_after
                                 THEN nullif(bf->>'rejected_from_stage', '') ELSE rejected_from_stage END
    WHERE id = v_id;
    PERFORM set_config('konekt.stage_write', '', true);

    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'result', v_res->>'result',
                                                           'general_stage', v_res->>'general_stage'));
  END LOOP;
  RETURN jsonb_build_object('rows', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.undo_candidate_stages(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_candidate_stages(jsonb) TO authenticated;
