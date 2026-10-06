-- =====================================================================
-- Refonte mission, lot 0c-1 : les lectures, socle SQL.
-- Conception : docs/refonte-mission/conception.md (3.3, 13).
--   1. Vue mission_candidate_rows : une ligne par (organisation, mission,
--      candidat), ligne canonique des doublons, jalons et note du groupe,
--      drapeau is_unopened. security_invoker : RLS de l'appelant.
--   2. get_mission_stage_counts(uuid[]) : effectifs, cumuls, par mission
--      de l'organisation de l'appelant.
--   3. stats_* lus dans get_mission_stage_counts ; recalcul complet sans
--      updated_at ni indexation.
--   4. undo_candidate_stages(jsonb) : l'annulation remet l'état d'avant.
--   5. candidate_mission_sends : un InMail répondu reste une preuve d'envoi.
--   6. rgpd_purge_candidate_rows : lignes à purger, sur l'étape générale
--      (compte seulement par défaut).
--   7. Reprise des recommendation libres écrasées par l'ancienne analyse.
-- Aucune ligne candidat ne change d'étape. Seconde application : aucune
-- écriture, aucun appel HTTP. Rejouable sur une base vide : tous les objets
-- lus existent depuis les lots 0a et 0b ; aucune table de l'import Lovable.
-- get_project_stats et get_multiple_project_stats restent (lot 0c-6).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vue mission_candidate_rows
--    Groupe : même organisation, mission et candidat. Rangs de la ligne
--    canonique :
--      0 écart d'une personne, s'il est sa dernière décision du groupe ;
--      1 étape décidée hors écart, la plus avancée puis la plus récente ;
--      2 autre écart, personne avant IA, puis le plus récent ;
--      3 À trier : notée, décidée, restaurée, ajoutée à la main.
--    Égalité : forme project:<uuid>, created_at, id.
--    Jalons : le plus ancien du groupe. Note, recommandation, détail et
--    motif : ligne notée la plus récente. reply_summary : le plus récent
--    non vide. Le reste : ligne canonique.
--    Mission jointe sur son organisation (règle C1). Colonnes nommées une à
--    une : un DROP COLUMN d'une colonne non lue n'est pas bloqué.
--    Toutes les fenêtres partitionnent par (organisation, mission,
--    candidat) : un filtre sur project_id descend sous les fenêtres.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.mission_candidate_rows
WITH (security_invoker = true) AS
WITH b AS (
  SELECT
    j.id, j.organization_id, j.project_id, j.candidate_id, j.job_id, j.created_by,
    j.candidate_name, j.candidate_headline, j.linkedin_profile_url, j.linkedin_profile_data,
    j.status, j.pipeline_stage, j.general_stage, j.process_step_id, j.stage_entered_at,
    j.decision_source, j.score, j.tags, j.rejected_at, j.rejected_from_stage,
    j.created_at, j.updated_at,
    sp.name AS mission_name,
    sp.kind AS mission_kind,
    array_agg(j.id) OVER grp AS group_ids,
    (count(*) OVER grp)::integer AS group_size,
    min(j.contacted_at) OVER grp AS g_contacted_at,
    min(j.replied_at) OVER grp AS g_replied_at,
    min(j.first_interview_at) OVER grp AS g_first_interview_at,
    min(j.presented_at) OVER grp AS g_presented_at,
    min(j.hired_at) OVER grp AS g_hired_at,
    max(j.stage_entered_at) FILTER (WHERE j.decision_source = 'user') OVER grp AS g_last_user_at,
    first_value(j.score) OVER sc AS g_score,
    first_value(j.recommendation) OVER sc AS g_recommendation,
    first_value(j.scoring_details) OVER sc AS g_scoring_details,
    first_value(j.skip_reason) OVER sc AS g_skip_reason,
    first_value(j.reply_summary) OVER rs AS g_reply_summary
  FROM public.job_candidate_status j
  JOIN public.sourcing_projects sp
    ON sp.id = j.project_id AND sp.organization_id = j.organization_id
  WINDOW grp AS (PARTITION BY j.organization_id, j.project_id, j.candidate_id),
         sc  AS (PARTITION BY j.organization_id, j.project_id, j.candidate_id
                 ORDER BY (j.score IS NULL), j.updated_at DESC, j.id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING),
         rs  AS (PARTITION BY j.organization_id, j.project_id, j.candidate_id
                 ORDER BY (nullif(btrim(j.reply_summary), '') IS NULL), j.updated_at DESC, j.id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
), r AS (
  SELECT b.*,
    row_number() OVER (
      PARTITION BY b.organization_id, b.project_id, b.candidate_id
      ORDER BY
        CASE WHEN b.general_stage = 'rejected' AND b.decision_source = 'user'
                  AND b.stage_entered_at = b.g_last_user_at THEN 0
             WHEN b.general_stage NOT IN ('to_sort','rejected') THEN 1
             WHEN b.general_stage = 'rejected' THEN 2
             ELSE 3 END,
        array_position(ARRAY['hired','interviewing','replied','contacted','retained']::text[],
                       b.general_stage) NULLS LAST,
        CASE WHEN b.general_stage = 'rejected' THEN b.decision_source IS DISTINCT FROM 'user' END,
        CASE WHEN b.general_stage <> 'to_sort' THEN b.stage_entered_at END DESC NULLS LAST,
        (b.score IS NULL), (b.decision_source IS NULL), (b.rejected_at IS NULL),
        (b.status = 'discovered'), (b.job_id NOT LIKE 'project:%'), b.created_at, b.id) AS rn
  FROM b
)
SELECT r.id, r.organization_id, r.project_id, r.candidate_id, r.job_id, r.created_by,
       r.candidate_name, r.candidate_headline, r.linkedin_profile_url, r.linkedin_profile_data,
       r.status, r.pipeline_stage, r.general_stage, r.process_step_id, r.stage_entered_at,
       r.decision_source,
       r.g_score AS score, r.g_recommendation AS recommendation,
       r.g_scoring_details AS scoring_details, r.g_skip_reason AS skip_reason,
       r.g_reply_summary AS reply_summary, r.tags, r.rejected_at, r.rejected_from_stage,
       r.g_contacted_at AS contacted_at, r.g_replied_at AS replied_at,
       r.g_first_interview_at AS first_interview_at, r.g_presented_at AS presented_at,
       r.g_hired_at AS hired_at,
       r.created_at, r.updated_at, r.mission_name, r.mission_kind,
       (r.general_stage = 'to_sort' AND r.status = 'discovered' AND r.score IS NULL
        AND r.decision_source IS NULL AND r.rejected_at IS NULL AND r.g_contacted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.sequence_enrollments e
                          LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
                         WHERE coalesce(e.organization_id, q.organization_id) = r.organization_id
                           AND r.candidate_id IN (e.profile_id, e.provider_id, e.resolved_profile_id))
        AND NOT EXISTS (SELECT 1 FROM public.inmail_queue iq
                         WHERE iq.organization_id = r.organization_id
                           AND iq.recipient_profile_id = r.candidate_id)) AS is_unopened,
       r.group_ids, r.group_size
  FROM r
 WHERE r.rn = 1;

-- Privilèges par défaut d'une vue neuve retirés un à un, puis lecture seule.
REVOKE ALL ON public.mission_candidate_rows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mission_candidate_rows TO authenticated, service_role;
COMMENT ON VIEW public.mission_candidate_rows IS
  'Lot 0c : une ligne par (organisation, mission, candidat). Ligne canonique : écart d''une personne s''il est sa dernière décision, sinon étape la plus avancée, À trier en dernier. Jalons les plus anciens du groupe, note de la ligne notée la plus récente, group_ids. is_unopened : trouvé par une recherche, jamais noté, trié, contacté ni inscrit. security_invoker.';

-- ---------------------------------------------------------------------
-- 2. get_mission_stage_counts : une ligne par mission demandée, même sans
--    candidat. Appel authenticated : missions de l'organisation de
--    l'appelant seulement (la policy d'équipe de mission de
--    sourcing_projects ne donne pas de zéros faux). Appel depuis une
--    fonction SECURITY DEFINER ou en service_role : toutes les missions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mission_stage_counts(p_project_ids uuid[])
RETURNS TABLE (
  project_id uuid,
  unopened integer, to_sort integer, retained integer, contacted integer,
  replied integer, interviewing integer, hired integer, rejected integer,
  interviewing_by_step jsonb,
  scored integer,
  ever_retained integer, ever_contacted integer, ever_replied integer,
  ever_interviewed integer, ever_presented integer, ever_hired integer,
  triaged_by_user integer,
  last_stage_move_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH m AS (
    SELECT sp.id FROM public.sourcing_projects sp
     WHERE sp.id = ANY (p_project_ids)
       AND (current_user <> 'authenticated'
            OR sp.organization_id = public.get_user_org_id(auth.uid()))
  ), v AS (
    SELECT c.* FROM public.mission_candidate_rows c
     WHERE c.project_id = ANY (p_project_ids) AND c.project_id IN (SELECT m.id FROM m)
  ), st AS (
    SELECT x.project_id, jsonb_object_agg(x.step_key, x.n) AS by_step
      FROM (SELECT v.project_id, coalesce(v.process_step_id::text, 'none') AS step_key,
                   count(*)::integer AS n
              FROM v WHERE v.general_stage = 'interviewing'
             GROUP BY 1, 2) x
     GROUP BY x.project_id
  )
  SELECT m.id,
    count(v.id) FILTER (WHERE v.is_unopened)::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'to_sort' AND NOT v.is_unopened)::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'retained')::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'contacted')::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'replied')::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'interviewing')::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'hired')::integer,
    count(v.id) FILTER (WHERE v.general_stage = 'rejected')::integer,
    coalesce(st.by_step, '{}'::jsonb),
    count(v.id) FILTER (WHERE v.score IS NOT NULL)::integer,
    count(v.id) FILTER (WHERE v.contacted_at IS NOT NULL
      OR v.general_stage IN ('retained','contacted','replied','interviewing','hired')
      OR v.rejected_from_stage IN ('retained','contacted','replied','interviewing','hired'))::integer,
    count(v.id) FILTER (WHERE v.contacted_at IS NOT NULL
      OR v.general_stage IN ('contacted','replied','interviewing','hired')
      OR v.rejected_from_stage IN ('contacted','replied','interviewing','hired'))::integer,
    count(v.id) FILTER (WHERE v.replied_at IS NOT NULL
      OR v.general_stage IN ('replied','interviewing','hired')
      OR v.rejected_from_stage IN ('replied','interviewing','hired'))::integer,
    count(v.id) FILTER (WHERE v.first_interview_at IS NOT NULL
      OR v.general_stage IN ('interviewing','hired')
      OR v.rejected_from_stage IN ('interviewing','hired'))::integer,
    count(v.id) FILTER (WHERE v.presented_at IS NOT NULL)::integer,
    count(v.id) FILTER (WHERE v.hired_at IS NOT NULL OR v.general_stage = 'hired'
      OR v.rejected_from_stage = 'hired')::integer,
    count(v.id) FILTER (WHERE v.decision_source = 'user' AND v.general_stage <> 'to_sort')::integer,
    max(v.stage_entered_at) FILTER (WHERE NOT v.is_unopened)
  FROM m
  LEFT JOIN v ON v.project_id = m.id
  LEFT JOIN st ON st.project_id = m.id
  GROUP BY m.id, st.by_step;
$$;
REVOKE ALL ON FUNCTION public.get_mission_stage_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mission_stage_counts(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Compteurs de mission : une seule définition, get_mission_stage_counts
--    (appelée ici en propriétaire : ni filtre d'organisation de l'appelant,
--    ni RLS).
--    total_found : Sourcés (jamais ouverts compris) ; scored ; messaged :
--    contactés au total ; dismissed : écartés ; shortlisted : retenus au total.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_mission_stats(p_mission_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH agg AS (
    SELECT c.project_id AS mission_id,
      (c.unopened + c.to_sort + c.retained + c.contacted + c.replied
       + c.interviewing + c.hired + c.rejected) AS total_found,
      c.scored, c.ever_contacted AS messaged, c.rejected AS dismissed,
      c.ever_retained AS shortlisted
    FROM public.get_mission_stage_counts(p_mission_ids) c
  )
  UPDATE public.sourcing_projects sp SET
    stats_total_found = agg.total_found, stats_scored = agg.scored, stats_messaged = agg.messaged,
    stats_dismissed = agg.dismissed, stats_shortlisted = agg.shortlisted
  FROM agg
  WHERE sp.id = agg.mission_id
    -- pas d'écriture si rien ne change (ni updated_at, ni temps réel, ni indexation)
    AND (sp.stats_total_found, sp.stats_scored, sp.stats_messaged, sp.stats_dismissed, sp.stats_shortlisted)
        IS DISTINCT FROM (agg.total_found, agg.scored, agg.messaged, agg.dismissed, agg.shortlisted);
$function$;

-- En UPDATE, recalcul si une colonne lue par les compteurs ou par le choix
-- de la ligne canonique change (la garde de recompute_mission_stats évite
-- déjà toute écriture inutile ; le filtre économise la requête).
CREATE OR REPLACE FUNCTION public.trg_sync_mission_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.project_id) INTO v_ids FROM new_rows n WHERE n.project_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.project_id) INTO v_ids FROM old_rows o WHERE o.project_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT t.pid) INTO v_ids
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
     CROSS JOIN LATERAL (VALUES (n.project_id), (o.project_id)) AS t(pid)
     WHERE t.pid IS NOT NULL
       AND (n.status, n.general_stage, n.stage_entered_at, n.decision_source, n.score IS NULL,
            n.contacted_at IS NULL, n.rejected_from_stage, n.candidate_id, n.project_id, n.organization_id)
           IS DISTINCT FROM
           (o.status, o.general_stage, o.stage_entered_at, o.decision_source, o.score IS NULL,
            o.contacted_at IS NULL, o.rejected_from_stage, o.candidate_id, o.project_id, o.organization_id);
  END IF;
  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_mission_stats(v_ids);
  END IF;
  RETURN NULL;
END;
$$;
-- Les trois déclencheurs sync_mission_stats_* (lot 0a) appellent cette
-- fonction par son nom : rien à recréer.
REVOKE ALL ON FUNCTION public.recompute_mission_stats(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_mission_stats(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.trg_sync_mission_stats() FROM PUBLIC, anon;

-- Recalcul complet : ni updated_at (ordre des missions) ni indexation
-- (un appel HTTP par mission) ne bougent. Modèle : jcs_stage_backfill du
-- lot 0a. Seconde application : aucun compteur ne change, aucune écriture.
-- Verrous pris dans l'ordre des écrivains (job_candidate_status, puis
-- sourcing_projects par le déclencheur des compteurs) : sans cela, un
-- écrivain qui attend sourcing_projects et la migration qui attend
-- job_candidate_status (bloc 7) s'interbloquent.
DO $lot0c_stats$
DECLARE
  v_upd "char";
  v_ing "char";
BEGIN
  LOCK TABLE public.job_candidate_status, public.sourcing_projects IN SHARE ROW EXCLUSIVE MODE;
  SELECT t.tgenabled INTO v_upd FROM pg_trigger t
   WHERE t.tgrelid = 'public.sourcing_projects'::regclass AND t.tgname = 'update_sourcing_projects_updated_at';
  SELECT t.tgenabled INTO v_ing FROM pg_trigger t
   WHERE t.tgrelid = 'public.sourcing_projects'::regclass AND t.tgname = 'trg_auto_ingest_sourcing_projects';
  IF v_upd = 'O' THEN
    ALTER TABLE public.sourcing_projects DISABLE TRIGGER update_sourcing_projects_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.sourcing_projects DISABLE TRIGGER trg_auto_ingest_sourcing_projects;
  END IF;

  PERFORM public.recompute_mission_stats(
    coalesce((SELECT array_agg(id) FROM public.sourcing_projects), '{}'::uuid[]));

  IF v_upd = 'O' THEN
    ALTER TABLE public.sourcing_projects ENABLE TRIGGER update_sourcing_projects_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.sourcing_projects ENABLE TRIGGER trg_auto_ingest_sourcing_projects;
  END IF;
END
$lot0c_stats$;

-- ---------------------------------------------------------------------
-- 4. undo_candidate_stages : annulation d'un geste fait par une personne.
--    Élément : {id, after_entered_at, before: {general_stage,
--    process_step_id, legacy_stage, stage_entered_at, decision_source,
--    rejected_at, rejected_from_stage, presented_at}, after_pipeline_stage}.
--    after_entered_at : date d'entrée rendue par le geste (chaîne de la
--    base, à la microseconde). after_pipeline_stage (facultatif) : colonne
--    du /pipeline visée par le geste ; entre deux colonnes d'entretien
--    (Pré-qualif, CV envoyé, ITW en cours, Offre), seul pipeline_stage
--    change, pas la date d'entrée.
--    moved_since si l'étape ou la colonne a bougé depuis le geste, ou si la
--    dernière décision de la ligne n'est pas celle d'une personne (un
--    événement serveur l'a déplacée : ses jalons sont vrais) ; unchanged si
--    la ligne est déjà à l'étape d'avant (colonne d'entretien comprise) ;
--    sinon set_candidate_stage (règles appliquées), puis effacement des
--    jalons posés par le geste ou par l'annulation, puis remise de la date,
--    de l'origine et de l'écart d'avant (dates antérieures au geste
--    seulement). Aucune date de jalon ne vient du navigateur ; seul
--    presented_at (posé par une personne, jamais par un événement) est
--    effacé sur sa déclaration qu'il était vide avant un passage en
--    « CV envoyé ».
--    SECURITY INVOKER (RLS de l'appelant), authenticated seulement.
-- ---------------------------------------------------------------------
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
      contacted_at       = CASE WHEN contacted_at IN (v_after, v_undo) THEN NULL ELSE contacted_at END,
      replied_at         = CASE WHEN replied_at IN (v_after, v_undo) THEN NULL ELSE replied_at END,
      first_interview_at = CASE WHEN first_interview_at IN (v_after, v_undo) THEN NULL ELSE first_interview_at END,
      presented_at       = CASE WHEN presented_at IN (v_after, v_undo) OR (v_unpres AND presented_at >= v_after)
                                THEN NULL ELSE presented_at END,
      hired_at           = CASE WHEN hired_at IN (v_after, v_undo) THEN NULL ELSE hired_at END,
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

-- ---------------------------------------------------------------------
-- 5. candidate_mission_sends : corps du lot 0b, InMail répondu compté (le
--    webhook passe l'InMail en replied avant record_candidate_inbound).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.candidate_mission_sends(
  p_organization_id uuid, p_project_id uuid, p_candidate jsonb)
RETURNS TABLE (first_send_at timestamptz, last_send_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH ref AS MATERIALIZED (
    SELECT public.candidate_ref_ids(p_candidate) AS ids, public.candidate_ref_slug(p_candidate) AS slug
  ), enr AS MATERIALIZED (
    SELECT e.id
      FROM ref, public.sequence_enrollments e
      LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
     WHERE coalesce(e.organization_id, q.organization_id) = p_organization_id
       AND (e.profile_id = ANY (ref.ids) OR e.provider_id = ANY (ref.ids) OR e.resolved_profile_id = ANY (ref.ids)
            OR (ref.slug IS NOT NULL AND public.linkedin_url_slug(e.profile_url) = ref.slug))
       AND NOT (coalesce(e.tracking_data, '{}'::jsonb) ? 'gdpr_erased_at')
  ), t AS (
    SELECT mc.first_outbound_at AS f, mc.last_mission_send_at AS l
      FROM ref, public.mission_conversations mc
     WHERE mc.organization_id = p_organization_id AND mc.project_id = p_project_id
       AND mc.last_mission_send_at IS NOT NULL
       AND (mc.candidate_id = ANY (ref.ids) OR mc.candidate_ids && ref.ids
            OR (ref.slug IS NOT NULL AND mc.candidate_slug = ref.slug))
    UNION ALL
    SELECT x.executed_at, x.executed_at
      FROM enr
      JOIN public.sequence_step_executions x ON x.enrollment_id = enr.id
      JOIN public.sequence_steps ss ON ss.id = x.step_id
     WHERE public.enrollment_mission_id(enr.id) = p_project_id
       AND ss.action_type IN ('message','smart_message','inmail','email','whatsapp_message','connection_request')
       AND (x.status IN ('sent','opened','clicked','replied')
            OR (x.status = 'cancelled' AND x.skip_reason ~ '^Enrollment became \S+ during execution$'))
    UNION ALL
    SELECT iq.sent_at, iq.sent_at
      FROM ref, public.inmail_queue iq
     WHERE iq.organization_id = p_organization_id AND iq.project_id = p_project_id
       AND iq.status IN ('sent','replied') AND iq.sent_at IS NOT NULL
       AND iq.recipient_profile_id = ANY (ref.ids)
  )
  SELECT min(t.f), max(t.l) FROM t
$$;
REVOKE ALL ON FUNCTION public.candidate_mission_sends(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.candidate_mission_sends(uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 6. rgpd_purge_candidate_rows : lignes à purger, comptées (dry run, par
--    défaut) ou supprimées (p_dry_run = false explicite).
--    Inactives : aucune date dans la fenêtre, hors Embauché.
--    Écartées : date d'écart (ou d'entrée, lignes reprises) hors fenêtre.
--    Fenêtres plus courtes que 24 et 12 mois refusées.
--    SECURITY INVOKER, service_role seulement (fonction serveur rgpd-purge).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rgpd_purge_candidate_rows(
  p_inactive_before timestamptz, p_rejected_before timestamptz,
  p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 500)
RETURNS TABLE (row_id uuid, organization_id uuid, candidate_id text, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_inactive_before IS NULL OR p_rejected_before IS NULL
     OR p_inactive_before > now() - interval '24 months'
     OR p_rejected_before > now() - interval '12 months' THEN
    RAISE EXCEPTION 'Fenêtre de conservation trop courte' USING ERRCODE = '22023', HINT = 'PURGE_WINDOW_TOO_SHORT';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'Limite hors bornes' USING ERRCODE = '22023', HINT = 'PURGE_LIMIT_INVALID';
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT j.id, j.organization_id, j.candidate_id,
      CASE
        WHEN j.general_stage = 'rejected'
         AND coalesce(j.rejected_at, j.stage_entered_at) < p_rejected_before THEN 'rejected_12m'
        WHEN j.general_stage <> 'hired'
         AND greatest(j.updated_at, j.stage_entered_at,
                      coalesce(j.contacted_at, '-infinity'), coalesce(j.replied_at, '-infinity'),
                      coalesce(j.first_interview_at, '-infinity'), coalesce(j.presented_at, '-infinity'))
             < p_inactive_before THEN 'inactive_24m'
      END AS reason
    FROM public.job_candidate_status j
  ), picked AS (
    SELECT c.id, c.organization_id, c.candidate_id, c.reason
      FROM c WHERE c.reason IS NOT NULL ORDER BY c.id LIMIT p_limit
  ), d AS (
    DELETE FROM public.job_candidate_status j
     USING picked p
     WHERE j.id = p.id AND NOT p_dry_run
    RETURNING j.id, j.organization_id, j.candidate_id, p.reason
  )
  SELECT p.id, p.organization_id, p.candidate_id, p.reason FROM picked p WHERE p_dry_run
  UNION ALL
  SELECT d.id, d.organization_id, d.candidate_id, d.reason FROM d;
END;
$$;
REVOKE ALL ON FUNCTION public.rgpd_purge_candidate_rows(timestamptz, timestamptz, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rgpd_purge_candidate_rows(timestamptz, timestamptz, boolean, integer)
  TO service_role;

-- ---------------------------------------------------------------------
-- 7. Reprise des recommendation libres (texte de l'ancienne analyse d'une
--    réponse, avant 0b-2a). Valeur inconnue ET libre (espace ou plus de
--    20 caractères) : recalculée depuis la note (seuils de
--    score-profile-job), NULL sans note. Le texte n'est pas recopié. Une
--    valeur courte inconnue reste. Ni updated_at ni indexation. Rien au
--    second passage. Aucune colonne de la garde stage_write_guard n'est
--    écrite.
-- ---------------------------------------------------------------------
DO $lot0c_reco$
DECLARE
  c_known CONSTANT text[] := ARRAY['strong_match','good_match','possible_match','weak_match','no_match',
                                   'shortlist','maybe','skip','go','no_go','potential','weak'];
  v_upd "char";
  v_ing "char";
  v_n   integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_candidate_status
                  WHERE recommendation IS NOT NULL
                    AND lower(btrim(recommendation)) <> ALL (c_known)
                    AND (recommendation ~ '\s' OR length(recommendation) > 20)) THEN
    RETURN;
  END IF;
  SELECT t.tgenabled INTO v_upd FROM pg_trigger t
   WHERE t.tgrelid = 'public.job_candidate_status'::regclass AND t.tgname = 'update_job_candidate_status_updated_at';
  SELECT t.tgenabled INTO v_ing FROM pg_trigger t
   WHERE t.tgrelid = 'public.job_candidate_status'::regclass AND t.tgname = 'trg_auto_ingest_job_candidate_status';
  IF v_upd = 'O' THEN
    ALTER TABLE public.job_candidate_status DISABLE TRIGGER update_job_candidate_status_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.job_candidate_status DISABLE TRIGGER trg_auto_ingest_job_candidate_status;
  END IF;

  UPDATE public.job_candidate_status SET recommendation = CASE
      WHEN score IS NULL THEN NULL
      WHEN score >= 80 THEN 'STRONG_MATCH'
      WHEN score >= 65 THEN 'GOOD_MATCH'
      WHEN score >= 50 THEN 'POSSIBLE_MATCH'
      WHEN score >= 35 THEN 'WEAK_MATCH'
      ELSE 'NO_MATCH' END
   WHERE recommendation IS NOT NULL
     AND lower(btrim(recommendation)) <> ALL (c_known)
     AND (recommendation ~ '\s' OR length(recommendation) > 20);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Lot 0c : % recommendation reprise(s)', v_n;   -- nombre seulement, jamais le texte

  IF v_upd = 'O' THEN
    ALTER TABLE public.job_candidate_status ENABLE TRIGGER update_job_candidate_status_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.job_candidate_status ENABLE TRIGGER trg_auto_ingest_job_candidate_status;
  END IF;
END
$lot0c_reco$;

COMMENT ON FUNCTION public.get_mission_stage_counts(uuid[]) IS
  'Lot 0c : effectifs par étape générale (jamais ouverts à part), par étape d''entretien, cumuls par jalon ou étape ou écart depuis l''étape, sur la ligne canonique. Missions de l''organisation de l''appelant (toutes en service_role ou sous une fonction SECURITY DEFINER). SECURITY INVOKER. Source unique des stats_*.';
COMMENT ON FUNCTION public.recompute_mission_stats(uuid[]) IS
  'Lot 0c : compteurs stats_* de la mission lus dans get_mission_stage_counts (total_found : Sourcés, jamais ouverts compris ; messaged : contactés au total ; shortlisted : retenus au total ; dismissed : écartés ; scored). Aucune écriture si rien ne change.';
COMMENT ON FUNCTION public.undo_candidate_stages(jsonb) IS
  'Lot 0c : annulation d''un geste fait par une personne ; remet l''état d''avant (étape, colonne d''entretien, date, origine, écart), efface les jalons posés par le geste ou l''annulation ; moved_since si l''étape ou la colonne a bougé depuis ou si la dernière décision n''est pas celle d''une personne, unchanged si déjà à l''étape d''avant. 200 lignes au plus. authenticated seulement.';
COMMENT ON FUNCTION public.rgpd_purge_candidate_rows(timestamptz, timestamptz, boolean, integer) IS
  'Lot 0c : lignes candidat à purger (24 mois sans activité hors Embauché ; 12 mois après un écart). Compte seulement par défaut (p_dry_run vrai). Fenêtres plus courtes refusées (PURGE_WINDOW_TOO_SHORT). service_role seulement.';
