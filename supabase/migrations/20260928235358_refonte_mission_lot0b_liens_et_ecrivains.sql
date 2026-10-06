-- =====================================================================
-- Refonte mission, lot 0b-1 : lien conversation–mission, fonctions des
-- écrivains, garde des écritures directes en mode observation.
-- Conception : docs/refonte-mission/conception.md (3.3, 5.3, 13).
-- Aucun écrivain actuel ne change ; la garde ne fait que journaliser.
-- Une seule reprise : les liens des inscriptions existantes (bloc 11).
-- Aucune ligne de job_candidate_status n'est écrite par cette migration.
-- Aucune fonction du lot 0a n'est redéfinie.
-- Rejouable (seconde application sans effet), rejouable sur une base vide.
-- jcs_stage_write_mode() n'est créée que si absente : une seconde
-- application ne rétrograde pas le refus posé par 0b-5.
--
-- Blocs :
--   1.  Index : lignes d'un candidat dans une organisation.
--   2.  Aides pures (slug LinkedIn, identifiants d'un candidat).
--   3.  Table mission_conversations, déclencheurs d'organisation et
--       d'effacement RGPD, RLS.
--   4.  inmail_queue.project_id (mission d'un InMail programmé).
--   5.  Garde stage_write_guard, son mode et son journal.
--   6.  set_candidate_stages : plusieurs lignes à la fois.
--   7.  Résolution : mission d'une inscription, d'une conversation, envois
--       Konekt prouvés.
--   8.  apply_mission_candidate_stage : lignes d'un candidat dans une mission.
--   9.  Lien et événements : envoi, réponse, message propre, résumé.
--   10. Rendez-vous.
--   11. Reprise des liens des inscriptions.
--   12. Droits et commentaires.
--
-- Arrêt d'urgence de la garde, neutre :
--   ALTER TABLE public.job_candidate_status DISABLE TRIGGER stage_write_guard;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Index : lignes d'un candidat dans une organisation.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jcs_org_candidate
  ON public.job_candidate_status (organization_id, candidate_id);

-- ---------------------------------------------------------------------
-- 2. Aides pures. Un candidat est décrit par un jsonb :
--    { ids: [identifiants LinkedIn], slug, profile_url, name, headline }.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_url_slug(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT nullif(substring(lower(p_url) FROM 'linkedin\.com/in/([^/?#[:space:]]+)'), '')
$$;

CREATE OR REPLACE FUNCTION public.candidate_ref_ids(p_candidate jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(s.v ORDER BY s.pos), '{}'::text[])
    FROM (SELECT btrim(t.v) AS v, min(t.pos) AS pos
            FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(p_candidate -> 'ids') = 'array'
                        THEN p_candidate -> 'ids' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(v, pos)
           WHERE btrim(t.v) <> '' AND length(t.v) <= 512
           GROUP BY btrim(t.v)) s
$$;

CREATE OR REPLACE FUNCTION public.candidate_ref_slug(p_candidate jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce(nullif(lower(btrim(p_candidate ->> 'slug')), ''),
                  public.linkedin_url_slug(p_candidate ->> 'profile_url'))
$$;

-- ---------------------------------------------------------------------
-- 3. Lien conversation–mission : une ligne par organisation, mission,
--    compte LinkedIn et candidat. Écrit par le serveur seulement ; lu par
--    les membres de l'organisation (un collaborateur : ses liens). Les dates ne reculent jamais
--    (greatest / least) : un événement rejoué ou en retard est sans effet.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mission_conversations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id               uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  account_id               text NOT NULL,
  candidate_id             text NOT NULL,
  candidate_ids            text[] NOT NULL DEFAULT '{}'::text[],
  candidate_slug           text,
  chat_id                  text,
  source                   text NOT NULL,
  enrollment_id            uuid REFERENCES public.sequence_enrollments(id) ON DELETE SET NULL,
  created_by               uuid,
  outbound_pending_at      timestamptz,
  first_outbound_at        timestamptz,
  last_outbound_at         timestamptz,
  last_mission_send_at     timestamptz,
  last_send_kind           text,
  last_outbound_message_id text,
  last_inbound_at          timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mission_conversations_source_check
    CHECK (source IN ('manual','sequence','inmail_queue','assistant','outside','inferred','backfill')),
  CONSTRAINT mission_conversations_send_kind_check
    CHECK (last_send_kind IS NULL OR last_send_kind IN ('message','inmail','invitation','outside')),
  CONSTRAINT mission_conversations_key UNIQUE (organization_id, project_id, account_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_mission_conversations_chat
  ON public.mission_conversations (organization_id, account_id, chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mission_conversations_account
  ON public.mission_conversations (organization_id, account_id);
CREATE INDEX IF NOT EXISTS idx_mission_conversations_candidate
  ON public.mission_conversations (organization_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_mission_conversations_candidate_ids
  ON public.mission_conversations USING gin (candidate_ids);
CREATE INDEX IF NOT EXISTS idx_mission_conversations_slug
  ON public.mission_conversations (organization_id, candidate_slug) WHERE candidate_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mission_conversations_project
  ON public.mission_conversations (project_id);
CREATE INDEX IF NOT EXISTS idx_mission_conversations_enrollment
  ON public.mission_conversations (enrollment_id) WHERE enrollment_id IS NOT NULL;

-- Une mission d'une autre organisation est refusée (même règle que C1).
CREATE OR REPLACE FUNCTION public.mission_conversations_same_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sourcing_projects sp
                  WHERE sp.id = NEW.project_id AND sp.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Mission d''une autre organisation'
      USING ERRCODE = '42501', HINT = 'MISSION_CONVERSATION_ORG_MISMATCH';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mission_conversations_same_org() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mission_conversations_same_org ON public.mission_conversations;
CREATE TRIGGER mission_conversations_same_org
  BEFORE INSERT OR UPDATE ON public.mission_conversations
  FOR EACH ROW EXECUTE FUNCTION public.mission_conversations_same_org();

ALTER TABLE public.mission_conversations ENABLE ROW LEVEL SECURITY;
-- Un collaborateur ne lit que ses liens, comme ses inscriptions (lot C1).
DROP POLICY IF EXISTS mission_conversations_org_select ON public.mission_conversations;
CREATE POLICY mission_conversations_org_select ON public.mission_conversations
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid())
         AND (NOT (SELECT public.is_active_org_collaborator(auth.uid())) OR created_by = auth.uid()));
-- Privilèges par défaut du schéma (20260421180000) : retirés ; lecture seule
-- pour authenticated, aucune écriture hors clé de service.
REVOKE ALL ON public.mission_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mission_conversations TO authenticated;
GRANT ALL ON public.mission_conversations TO service_role;

-- Effacement RGPD : quand une inscription reçoit tracking_data.gdpr_erased_at
-- (recordGdprErasure, SEQ-054), les liens du candidat dans son organisation
-- sont supprimés (inscription, identifiants ou slug). 0b-1 est ainsi complet
-- seul ; l'effacement par les fonctions (0b-2a) couvrira en plus un candidat
-- sans inscription.
-- SECURITY DEFINER : le marqueur peut être posé sous un jeton sans droit
-- d'écriture sur les liens.
CREATE OR REPLACE FUNCTION public.mission_conversations_gdpr_erase()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  uuid := NEW.organization_id;
  v_ids  text[];
  v_slug text := public.linkedin_url_slug(NEW.profile_url);
BEGIN
  IF v_org IS NULL THEN
    SELECT q.organization_id INTO v_org FROM public.outreach_sequences q WHERE q.id = NEW.sequence_id;
  END IF;
  SELECT coalesce(array_agg(DISTINCT btrim(v)), '{}'::text[]) INTO v_ids
    FROM unnest(ARRAY[NEW.profile_id, NEW.provider_id, NEW.resolved_profile_id]) AS v
   WHERE btrim(coalesce(v, '')) <> '';
  DELETE FROM public.mission_conversations mc
   WHERE mc.enrollment_id = NEW.id
      OR (mc.organization_id = v_org
          AND (mc.candidate_id = ANY (v_ids) OR mc.candidate_ids && v_ids
               OR (v_slug IS NOT NULL AND mc.candidate_slug = v_slug)));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mission_conversations_gdpr_erase() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mission_conversations_gdpr_erase ON public.sequence_enrollments;
CREATE TRIGGER mission_conversations_gdpr_erase
  AFTER UPDATE OF tracking_data ON public.sequence_enrollments
  FOR EACH ROW
  WHEN (NEW.tracking_data ? 'gdpr_erased_at'
        AND NOT coalesce(OLD.tracking_data ? 'gdpr_erased_at', false))
  EXECUTE FUNCTION public.mission_conversations_gdpr_erase();

-- ---------------------------------------------------------------------
-- 4. Mission d'un InMail programmé (remplie par l'action queue, vérifiée).
-- ---------------------------------------------------------------------
ALTER TABLE public.inmail_queue
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inmail_queue_project_id
  ON public.inmail_queue (project_id) WHERE project_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Garde des écritures directes de l'étape.
--    Mode : jcs_stage_write_mode() rend off, observe ou refuse. Créée ici en
--    observe seulement si elle est absente ; 0b-5 la redéfinit en refuse.
--    Journal : jcs_direct_write_log, fermé à anon et authenticated.
-- ---------------------------------------------------------------------
DO $lot0b_mode$
BEGIN
  IF to_regprocedure('public.jcs_stage_write_mode()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.jcs_stage_write_mode()
      RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp
      AS $m$ SELECT 'observe'::text $m$
    $f$;
    EXECUTE $c$
      COMMENT ON FUNCTION public.jcs_stage_write_mode() IS
        'Lot 0b : mode de la garde stage_write_guard (off, observe, refuse). Observation depuis le lot 0b-1.'
    $c$;
  END IF;
END
$lot0b_mode$;
REVOKE ALL ON FUNCTION public.jcs_stage_write_mode() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.jcs_direct_write_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logged_at          timestamptz NOT NULL DEFAULT now(),
  op                 text NOT NULL,
  db_role            text,
  user_id            uuid,
  row_id             uuid,
  organization_id    uuid,
  project_id         uuid,
  old_status         text,
  new_status         text,
  old_pipeline_stage text,
  new_pipeline_stage text,
  old_general_stage  text,
  new_general_stage  text,
  request_path       text,
  client_info        text,
  referer            text
);
CREATE INDEX IF NOT EXISTS idx_jcs_direct_write_log_at ON public.jcs_direct_write_log (logged_at);
ALTER TABLE public.jcs_direct_write_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jcs_direct_write_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.jcs_direct_write_log_id_seq FROM PUBLIC, anon, authenticated;

-- Nom trié après stage_sync_from_legacy (ordre des noms, en C) : NEW porte
-- déjà l'étape dérivée. Contexte contrôlé : rôle du jeton, sinon celui de
-- SET ROLE (le GUC « role » ne suit pas SECURITY DEFINER, current_user si) ;
-- 'none' : psql, migration, cron, audit sans jeton. Passe-droits : plan 0b,
-- section 1.4 (drapeaux de set_candidate_stage et de replace_process_steps,
-- insertion À trier, écriture sans changement d'étape, changement de
-- mission ou d'organisation avec le couple intact).
CREATE OR REPLACE FUNCTION public.jcs_stage_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode    text := coalesce(public.jcs_stage_write_mode(), 'observe');
  v_role    text := coalesce(nullif(auth.role(), ''), nullif(current_setting('role', true), 'none'), 'none');
  v_flag    text := coalesce(current_setting('konekt.stage_write', true), '');
  v_remap   text := coalesce(current_setting('konekt.stage_remap', true), '');
  v_old_st  text;
  v_old_ps  text;
  v_old_gs  text;
  v_headers jsonb;
BEGIN
  IF v_mode = 'off' OR v_role NOT IN ('authenticated', 'service_role', 'anon') THEN
    RETURN NEW;
  END IF;
  IF v_flag = '*' OR v_flag = NEW.id::text THEN
    RETURN NEW;                                      -- set_candidate_stage, reprise 0a
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.general_stage = 'to_sort' THEN
      RETURN NEW;
    END IF;
  ELSE
    v_old_st := OLD.status;
    v_old_ps := OLD.pipeline_stage;
    v_old_gs := OLD.general_stage;
    IF NEW.general_stage IS NOT DISTINCT FROM OLD.general_stage
       AND NEW.process_step_id IS NOT DISTINCT FROM OLD.process_step_id THEN
      RETURN NEW;                                    -- note, identité, new/discovered/untreated -> scored
    END IF;
    IF v_remap <> '' AND v_remap = NEW.project_id::text
       AND NEW.general_stage IS NOT DISTINCT FROM OLD.general_stage THEN
      RETURN NEW;                                    -- replace_process_steps
    END IF;
    IF (NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.pipeline_stage IS NOT DISTINCT FROM OLD.pipeline_stage THEN
      RETURN NEW;                                    -- changement de mission, couple intact
    END IF;
  END IF;

  IF v_mode = 'refuse' THEN
    RAISE EXCEPTION 'L''étape d''un candidat ne s''écrit pas directement : elle se change par set_candidate_stage'
      USING ERRCODE = '42501',
            HINT = 'STAGE_DIRECT_WRITE',
            DETAIL = format('%s %s : %s / %s (%s) -> %s / %s (%s)', TG_OP, NEW.id,
                            coalesce(v_old_st, '-'), coalesce(v_old_ps, '-'), coalesce(v_old_gs, '-'),
                            coalesce(NEW.status, '-'), coalesce(NEW.pipeline_stage, '-'),
                            coalesce(NEW.general_stage, '-'));
  END IF;

  BEGIN                                              -- observation : jamais d'échec de l'écriture
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    INSERT INTO public.jcs_direct_write_log
      (op, db_role, user_id, row_id, organization_id, project_id,
       old_status, new_status, old_pipeline_stage, new_pipeline_stage,
       old_general_stage, new_general_stage, request_path, client_info, referer)
    VALUES
      (TG_OP, v_role, auth.uid(), NEW.id, NEW.organization_id, NEW.project_id,
       v_old_st, NEW.status, v_old_ps, NEW.pipeline_stage,
       v_old_gs, NEW.general_stage,
       nullif(current_setting('request.path', true), ''),
       left(v_headers ->> 'x-client-info', 200), left(v_headers ->> 'referer', 500));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jcs_stage_write_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stage_write_guard ON public.job_candidate_status;
CREATE TRIGGER stage_write_guard
  BEFORE INSERT OR UPDATE OF status, pipeline_stage, project_id, organization_id
  ON public.job_candidate_status
  FOR EACH ROW EXECUTE FUNCTION public.jcs_stage_write_guard();

-- ---------------------------------------------------------------------
-- 6. Plusieurs lignes à la fois (200 au plus). Seuls les refus métier
--    (22023, P0002) sont rendus par ligne ; toute autre erreur (verrou,
--    annulation, incohérence) remonte et annule l'appel entier, pour que
--    l'appelant rejoue. p_from_stages : étapes de départ admises, les
--    autres lignes rendent skipped sans écriture.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_candidate_stages(
  p_ids uuid[],
  p_stage text,
  p_source text,
  p_organization_id uuid DEFAULT NULL,
  p_process_step_id uuid DEFAULT NULL,
  p_legacy_stage text DEFAULT NULL,
  p_from_stages text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids   uuid[];
  v_id    uuid;
  v_cur   text;
  v_out   jsonb := '[]'::jsonb;
  v_state text;
  v_hint  text;
  v_msg   text;
BEGIN
  SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) INTO v_ids
    FROM unnest(coalesce(p_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL;
  IF cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'Trop de candidats à la fois (200 au plus)'
      USING ERRCODE = '22023', HINT = 'STAGE_BATCH_TOO_LARGE';
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    BEGIN
      IF p_from_stages IS NOT NULL THEN
        SELECT j.general_stage INTO v_cur
          FROM public.job_candidate_status j
         WHERE j.id = v_id
           AND (p_organization_id IS NULL OR j.organization_id = p_organization_id)
         FOR UPDATE;
        IF FOUND AND NOT (v_cur = ANY (p_from_stages)) THEN
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'id', v_id, 'changed', false, 'result', 'skipped', 'general_stage', v_cur));
          CONTINUE;
        END IF;
      END IF;
      v_out := v_out || jsonb_build_array(public.set_candidate_stage(
        v_id, p_stage, p_source, p_organization_id, p_process_step_id, p_legacy_stage));
    EXCEPTION WHEN invalid_parameter_value OR no_data_found THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'changed', false, 'result', 'error', 'code', v_state, 'hint', v_hint, 'message', v_msg));
    END;
  END LOOP;
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Mission d'une inscription, inscriptions d'un candidat, mission d'une
--    conversation, envois Konekt prouvés dans une mission.
-- ---------------------------------------------------------------------
-- Mission de la séquence, sinon job_id de l'inscription (avec ou sans le
-- préfixe project:), dans l'organisation de l'inscription ; NULL si aucune
-- ou plusieurs.
CREATE OR REPLACE FUNCTION public.enrollment_mission_id(p_enrollment_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH e AS (
    SELECT coalesce(e.organization_id, q.organization_id) AS org,
           q.project_id AS seq_project,
           nullif(regexp_replace(coalesce(e.job_id, ''), '^project:', ''), '') AS job_norm
      FROM public.sequence_enrollments e
      LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
     WHERE e.id = p_enrollment_id
  ), c AS (
    SELECT DISTINCT sp.id
      FROM e
      JOIN public.sourcing_projects sp ON sp.organization_id = e.org
     WHERE (e.seq_project IS NOT NULL AND sp.id = e.seq_project)
        OR (e.seq_project IS NULL AND e.job_norm IS NOT NULL
            AND (sp.id::text = e.job_norm OR sp.job_id = e.job_norm))
  )
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(c.id))[1] END FROM c
$$;

-- Inscriptions du candidat dans l'organisation (sur ce compte s'il est
-- donné), les plus récentes d'abord ; inscriptions effacées (RGPD) exclues.
CREATE OR REPLACE FUNCTION public.candidate_enrollment_ids(
  p_organization_id uuid, p_account_id text, p_candidate jsonb)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH ref AS (SELECT public.candidate_ref_ids(p_candidate) AS ids,
                      public.candidate_ref_slug(p_candidate) AS slug,
                      nullif(btrim(p_account_id), '') AS acc)
  SELECT coalesce(array_agg(e.id ORDER BY e.created_at DESC), '{}'::uuid[])
    FROM ref, public.sequence_enrollments e
    LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
   WHERE coalesce(e.organization_id, q.organization_id) = p_organization_id
     AND (ref.acc IS NULL OR e.account_id = ref.acc OR e.assigned_sender_id = ref.acc)
     AND (e.profile_id = ANY (ref.ids) OR e.provider_id = ANY (ref.ids)
          OR e.resolved_profile_id = ANY (ref.ids)
          OR (ref.slug IS NOT NULL AND public.linkedin_url_slug(e.profile_url) = ref.slug))
     AND NOT (coalesce(e.tracking_data, '{}'::jsonb) ? 'gdpr_erased_at')
$$;

-- Décision 3 du plan 0b. '' vaut NULL. Un lien sans envoi attribué, sans
-- réception et hors reprise est ignoré (un envoi seulement en cours ne
-- compte pas).
CREATE OR REPLACE FUNCTION public.resolve_conversation_mission(
  p_organization_id uuid,
  p_account_id text,
  p_chat_id text,
  p_candidate jsonb,
  p_enrollment_ids uuid[] DEFAULT NULL)
RETURNS TABLE (project_id uuid, via text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_account text := nullif(btrim(p_account_id), '');
  v_chat    text := nullif(btrim(p_chat_id), '');
  v_ids     text[] := public.candidate_ref_ids(p_candidate);
  v_slug    text := public.candidate_ref_slug(p_candidate);
  v_enr     uuid[] := p_enrollment_ids;
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;
  -- 1. La conversation, sur ce compte.
  IF v_chat IS NOT NULL AND v_account IS NOT NULL THEN
    RETURN QUERY
      SELECT mc.project_id, 'chat'::text
        FROM public.mission_conversations mc
       WHERE mc.organization_id = p_organization_id
         AND mc.account_id = v_account AND mc.chat_id = v_chat
         AND (mc.last_mission_send_at IS NOT NULL OR mc.last_inbound_at IS NOT NULL OR mc.source = 'backfill')
       ORDER BY mc.last_mission_send_at DESC NULLS LAST, mc.last_inbound_at DESC NULLS LAST,
                mc.created_at DESC, mc.id
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- 2. Le profil, sur ce compte (sur tous les comptes si le compte est inconnu).
  IF cardinality(v_ids) > 0 OR v_slug IS NOT NULL THEN
    RETURN QUERY
      SELECT mc.project_id, 'profile'::text
        FROM public.mission_conversations mc
       WHERE mc.organization_id = p_organization_id
         AND (v_account IS NULL OR mc.account_id = v_account)
         AND (mc.candidate_id = ANY (v_ids) OR mc.candidate_ids && v_ids
              OR (v_slug IS NOT NULL AND mc.candidate_slug = v_slug))
         AND (mc.last_mission_send_at IS NOT NULL OR mc.last_inbound_at IS NOT NULL OR mc.source = 'backfill')
       ORDER BY mc.last_mission_send_at DESC NULLS LAST, mc.last_inbound_at DESC NULLS LAST,
                mc.created_at DESC, mc.id
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- 3. L'inscription la plus récente dont la mission se résout dans l'organisation.
  IF v_enr IS NULL THEN
    v_enr := public.candidate_enrollment_ids(p_organization_id, v_account, p_candidate);
  END IF;
  IF cardinality(v_enr) > 0 THEN
    RETURN QUERY
      SELECT m.pid, 'enrollment'::text
        FROM public.sequence_enrollments e
        CROSS JOIN LATERAL (SELECT public.enrollment_mission_id(e.id) AS pid) m
        JOIN public.sourcing_projects sp ON sp.id = m.pid AND sp.organization_id = p_organization_id
       WHERE e.id = ANY (v_enr)
       ORDER BY e.created_at DESC, e.id
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- 4. Les lignes de l'organisation à Contacté ou au-delà, dont la mission est
  --    à l'organisation (une ligne peut porter la mission d'une autre, C1 R7-d).
  IF cardinality(v_ids) > 0 OR v_slug IS NOT NULL THEN
    RETURN QUERY
      SELECT j.project_id, 'rows'::text
        FROM public.job_candidate_status j
        JOIN public.sourcing_projects sp ON sp.id = j.project_id AND sp.organization_id = p_organization_id
       WHERE j.organization_id = p_organization_id
         AND j.general_stage IN ('contacted', 'replied', 'interviewing', 'hired')
         AND (j.candidate_id = ANY (v_ids)
              OR (v_slug IS NOT NULL AND public.linkedin_url_slug(j.linkedin_profile_url) = v_slug))
       ORDER BY coalesce(j.contacted_at, j.stage_entered_at) DESC, j.id
       LIMIT 1;
  END IF;
END;
$$;

-- Envois Konekt prouvés vers ce candidat dans cette mission : liens (envoi
-- attribué), exécutions visibles (critères 0a, 20260928201409:347-351),
-- InMails envoyés de la file.
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
       AND iq.status = 'sent' AND iq.recipient_profile_id = ANY (ref.ids)
  )
  SELECT min(t.f), max(t.l) FROM t
$$;

-- ---------------------------------------------------------------------
-- 8. Lignes d'un candidat dans une mission (toutes, ou celles d'un auteur),
--    création d'une ligne À trier si un créateur est donné et qu'il n'y en
--    a aucune (forme project:<id>, celle du Sourcing), puis
--    set_candidate_stages.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_mission_candidate_stage(
  p_organization_id uuid,
  p_project_id uuid,
  p_candidate jsonb,
  p_stage text,
  p_source text,
  p_process_step_id uuid DEFAULT NULL,
  p_legacy_stage text DEFAULT NULL,
  p_from_stages text[] DEFAULT NULL,
  p_create_by uuid DEFAULT NULL,
  p_only_created_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids     text[] := public.candidate_ref_ids(p_candidate);
  v_slug    text := public.candidate_ref_slug(p_candidate);
  v_rows    uuid[];
  v_new     uuid;
  v_created boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'Organisation et mission obligatoires'
      USING ERRCODE = '22023', HINT = 'STAGE_MISSION_REQUIRED';
  END IF;
  IF cardinality(v_ids) = 0 AND v_slug IS NULL THEN
    RAISE EXCEPTION 'Candidat sans identifiant' USING ERRCODE = '22023', HINT = 'STAGE_CANDIDATE_REQUIRED';
  END IF;
  PERFORM 1 FROM public.sourcing_projects sp
   WHERE sp.id = p_project_id AND sp.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission introuvable' USING ERRCODE = 'P0002', HINT = 'STAGE_MISSION_NOT_FOUND';
  END IF;

  SELECT array_agg(j.id ORDER BY j.created_at) INTO v_rows
    FROM public.job_candidate_status j
   WHERE j.organization_id = p_organization_id
     AND j.project_id = p_project_id
     AND (p_only_created_by IS NULL OR j.created_by = p_only_created_by)
     AND (j.candidate_id = ANY (v_ids)
          OR (v_slug IS NOT NULL AND public.linkedin_url_slug(j.linkedin_profile_url) = v_slug));

  IF v_rows IS NULL AND p_create_by IS NOT NULL AND cardinality(v_ids) > 0 THEN
    INSERT INTO public.job_candidate_status
      (organization_id, project_id, job_id, candidate_id, created_by,
       candidate_name, candidate_headline, linkedin_profile_url)
    VALUES
      (p_organization_id, p_project_id, 'project:' || p_project_id::text, v_ids[1], p_create_by,
       nullif(btrim(p_candidate ->> 'name'), ''), nullif(btrim(p_candidate ->> 'headline'), ''),
       nullif(btrim(p_candidate ->> 'profile_url'), ''))
    ON CONFLICT (job_id, candidate_id, created_by) DO NOTHING
    RETURNING id INTO v_new;
    v_created := v_new IS NOT NULL;
    IF v_new IS NULL THEN
      SELECT j.id INTO v_new FROM public.job_candidate_status j
       WHERE j.job_id = 'project:' || p_project_id::text
         AND j.candidate_id = v_ids[1] AND j.created_by = p_create_by
         AND j.organization_id = p_organization_id;
    END IF;
    IF v_new IS NOT NULL THEN
      v_rows := ARRAY[v_new];
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'created', v_created,
    'rows', public.set_candidate_stages(coalesce(v_rows, '{}'::uuid[]), p_stage, p_source,
                                        p_organization_id, p_process_step_id, p_legacy_stage, p_from_stages));
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Lien, puis événements.
-- ---------------------------------------------------------------------
-- Crée ou met à jour le lien (organisation, mission, compte, candidat).
-- Événements : pending (marqueur avant l'envoi, jamais effacé), outbound
-- (envoi : dates d'envoi, envoi attribué, type, message), inbound (réception).
CREATE OR REPLACE FUNCTION public.touch_mission_conversation(
  p_organization_id uuid,
  p_project_id uuid,
  p_account_id text,
  p_ids text[],
  p_slug text,
  p_chat_id text,
  p_source text,
  p_enrollment_id uuid,
  p_created_by uuid,
  p_event text,
  p_message_id text DEFAULT NULL,
  p_at timestamptz DEFAULT NULL,
  p_send_kind text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids     text[] := coalesce(p_ids, '{}'::text[]);
  v_account text := nullif(btrim(p_account_id), '');
  v_chat    text := nullif(btrim(p_chat_id), '');
  v_at      timestamptz := coalesce(p_at, now());
  v_id      uuid;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('pending', 'outbound', 'inbound') THEN
    RAISE EXCEPTION 'Événement inconnu : %', coalesce(p_event, 'NULL')
      USING ERRCODE = '22023', HINT = 'LINK_EVENT_UNKNOWN';
  END IF;
  -- Valeurs refusées par les CHECK de la table : refus métier (22023) plutôt
  -- qu'une violation de contrainte, que l'appelant prendrait pour transitoire.
  IF p_source IS NULL OR p_source NOT IN ('manual','sequence','inmail_queue','assistant','outside','inferred','backfill') THEN
    RAISE EXCEPTION 'Origine de lien inconnue : %', coalesce(p_source, 'NULL')
      USING ERRCODE = '22023', HINT = 'LINK_SOURCE_UNKNOWN';
  END IF;
  IF p_send_kind IS NOT NULL AND p_send_kind NOT IN ('message','inmail','invitation','outside') THEN
    RAISE EXCEPTION 'Type d''envoi inconnu : %', p_send_kind
      USING ERRCODE = '22023', HINT = 'LINK_SEND_KIND_UNKNOWN';
  END IF;
  IF p_organization_id IS NULL OR p_project_id IS NULL OR v_account IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT mc.id INTO v_id
    FROM public.mission_conversations mc
   WHERE mc.organization_id = p_organization_id AND mc.project_id = p_project_id
     AND mc.account_id = v_account
     AND (mc.candidate_id = ANY (v_ids) OR mc.candidate_ids && v_ids
          OR (p_slug IS NOT NULL AND mc.candidate_slug = p_slug))
   ORDER BY mc.updated_at DESC, mc.id
   LIMIT 1
   FOR UPDATE;

  IF v_id IS NULL THEN
    IF cardinality(v_ids) = 0 THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.mission_conversations AS mc
      (organization_id, project_id, account_id, candidate_id, candidate_ids, candidate_slug,
       source, enrollment_id, created_by)
    VALUES
      (p_organization_id, p_project_id, v_account, v_ids[1], coalesce(v_ids[2:], '{}'::text[]),
       p_slug, p_source, p_enrollment_id, p_created_by)
    ON CONFLICT (organization_id, project_id, account_id, candidate_id) DO NOTHING
    RETURNING mc.id INTO v_id;
    IF v_id IS NULL THEN
      SELECT mc.id INTO v_id
        FROM public.mission_conversations mc
       WHERE mc.organization_id = p_organization_id AND mc.project_id = p_project_id
         AND mc.account_id = v_account AND mc.candidate_id = v_ids[1]
       FOR UPDATE;
    END IF;
  END IF;

  UPDATE public.mission_conversations mc SET
    candidate_ids = ARRAY(SELECT DISTINCT x FROM unnest(mc.candidate_ids || v_ids) AS x
                           WHERE x IS DISTINCT FROM mc.candidate_id),
    candidate_slug = coalesce(mc.candidate_slug, p_slug),
    chat_id = coalesce(v_chat, mc.chat_id),
    enrollment_id = coalesce(mc.enrollment_id, p_enrollment_id),
    created_by = coalesce(mc.created_by, p_created_by),
    outbound_pending_at = CASE WHEN p_event = 'pending'
                               THEN greatest(coalesce(mc.outbound_pending_at, v_at), v_at)
                               ELSE mc.outbound_pending_at END,          -- jamais effacé (écho)
    first_outbound_at = CASE WHEN p_event = 'outbound'
                             THEN least(coalesce(mc.first_outbound_at, v_at), v_at)
                             ELSE mc.first_outbound_at END,
    last_outbound_at = CASE WHEN p_event = 'outbound'
                            THEN greatest(coalesce(mc.last_outbound_at, v_at), v_at)
                            ELSE mc.last_outbound_at END,
    last_mission_send_at = CASE WHEN p_event = 'outbound'
                                THEN greatest(coalesce(mc.last_mission_send_at, v_at), v_at)
                                ELSE mc.last_mission_send_at END,
    last_send_kind = CASE WHEN p_event = 'outbound'
                           AND (mc.last_mission_send_at IS NULL OR v_at >= mc.last_mission_send_at)
                          THEN coalesce(p_send_kind, 'message') ELSE mc.last_send_kind END,
    last_outbound_message_id = CASE WHEN p_event = 'outbound' AND p_message_id IS NOT NULL
                                    THEN p_message_id ELSE mc.last_outbound_message_id END,
    last_inbound_at = CASE WHEN p_event = 'inbound'
                           THEN greatest(coalesce(mc.last_inbound_at, v_at), v_at)
                           ELSE mc.last_inbound_at END
  WHERE mc.id = v_id;
  RETURN v_id;
END;
$$;

-- Envoi Konekt (ou son marqueur, p_pending) : lien, puis « Contacté » en
-- origine system sur les lignes du candidat dans la mission, avec création
-- d'une ligne si un créateur est donné (décision 6). Mission : explicite,
-- sinon celle de l'inscription, sinon résolue ; une mission hors
-- organisation est ignorée.
CREATE OR REPLACE FUNCTION public.record_candidate_outbound(
  p_organization_id uuid,
  p_account_id text,
  p_candidate jsonb,
  p_source text,
  p_project_id uuid DEFAULT NULL,
  p_chat_id text DEFAULT NULL,
  p_message_id text DEFAULT NULL,
  p_enrollment_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_pending boolean DEFAULT false,
  p_send_kind text DEFAULT 'message')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_account text := nullif(btrim(p_account_id), '');
  v_chat    text := nullif(btrim(p_chat_id), '');
  v_ids     text[] := public.candidate_ref_ids(p_candidate);
  v_slug    text := public.candidate_ref_slug(p_candidate);
  v_project uuid;
  v_via     text;
  v_link    uuid;
  v_rows    jsonb := '[]'::jsonb;
BEGIN
  IF p_organization_id IS NULL OR v_account IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('project_id', NULL, 'reason', 'missing_input');
  END IF;
  IF p_project_id IS NOT NULL THEN
    v_project := p_project_id;  v_via := 'explicit';
  ELSIF p_enrollment_id IS NOT NULL THEN
    v_project := public.enrollment_mission_id(p_enrollment_id);  v_via := 'enrollment';
  END IF;
  IF v_project IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.sourcing_projects sp
        WHERE sp.id = v_project AND sp.organization_id = p_organization_id) THEN
    v_project := NULL;                               -- mission hors organisation : ignorée
  END IF;
  IF v_project IS NULL THEN
    SELECT r.project_id, r.via INTO v_project, v_via
      FROM public.resolve_conversation_mission(p_organization_id, v_account, v_chat, p_candidate,
             CASE WHEN p_enrollment_id IS NULL THEN NULL ELSE ARRAY[p_enrollment_id] END) r;
  END IF;
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('project_id', NULL, 'reason', 'no_mission');
  END IF;

  v_link := public.touch_mission_conversation(
    p_organization_id, v_project, v_account, v_ids, v_slug, v_chat,
    CASE WHEN v_via IN ('explicit', 'enrollment') THEN p_source ELSE 'inferred' END,
    p_enrollment_id, p_created_by,
    CASE WHEN p_pending THEN 'pending' ELSE 'outbound' END, p_message_id, NULL, p_send_kind);

  IF NOT p_pending THEN
    v_rows := public.apply_mission_candidate_stage(
      p_organization_id, v_project, p_candidate, 'contacted', 'system',
      NULL, NULL, NULL, p_created_by) -> 'rows';
  END IF;
  RETURN jsonb_build_object('project_id', v_project, 'via', v_via, 'link_id', v_link, 'rows', v_rows);
END;
$$;

-- Réponse d'un candidat : seulement les lignes de la mission résolue.
-- « Contacté » manqué (décision 13) si un envoi Konekt est prouvé dans la
-- mission, puis « A répondu » en origine system. p_received_at : rattrapage
-- (auto-analyze-message), rien avant le premier contact dans la mission.
CREATE OR REPLACE FUNCTION public.record_candidate_inbound(
  p_organization_id uuid,
  p_account_id text,
  p_candidate jsonb,
  p_chat_id text DEFAULT NULL,
  p_enrollment_ids uuid[] DEFAULT NULL,
  p_enrollment_first boolean DEFAULT false,
  p_received_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_account text := nullif(btrim(p_account_id), '');
  v_chat    text := nullif(btrim(p_chat_id), '');
  v_ids     text[] := public.candidate_ref_ids(p_candidate);
  v_slug    text := public.candidate_ref_slug(p_candidate);
  v_eid     uuid;
  v_project uuid;
  v_via     text;
  v_link    uuid;
  v_first   timestamptz;
  v_contact timestamptz;
  v_pre     jsonb := '[]'::jsonb;
BEGIN
  IF p_organization_id IS NULL OR (cardinality(v_ids) = 0 AND v_slug IS NULL) THEN
    RETURN jsonb_build_object('project_id', NULL, 'reason', 'missing_input');
  END IF;

  -- 0. Réponse vue par une inscription, sans conversation : sa mission d'abord.
  IF p_enrollment_first AND p_enrollment_ids IS NOT NULL THEN
    FOREACH v_eid IN ARRAY p_enrollment_ids LOOP
      SELECT sp.id INTO v_project
        FROM public.sourcing_projects sp
       WHERE sp.id = public.enrollment_mission_id(v_eid)
         AND sp.organization_id = p_organization_id;
      EXIT WHEN v_project IS NOT NULL;
    END LOOP;
    IF v_project IS NOT NULL THEN v_via := 'enrollment'; END IF;
  END IF;
  -- 1 à 4. Conversation, profil, inscription, lignes contactées.
  IF v_project IS NULL THEN
    SELECT r.project_id, r.via INTO v_project, v_via
      FROM public.resolve_conversation_mission(p_organization_id, v_account, v_chat,
                                               p_candidate, p_enrollment_ids) r;
  END IF;
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('project_id', NULL, 'reason', 'no_mission');
  END IF;

  -- Premier contact connu dans la mission : envoi Konekt prouvé, ou jalon des lignes.
  SELECT s.first_send_at INTO v_first
    FROM public.candidate_mission_sends(p_organization_id, v_project, p_candidate) s;
  SELECT least(v_first, min(j.contacted_at)) INTO v_contact
    FROM public.job_candidate_status j
   WHERE j.organization_id = p_organization_id AND j.project_id = v_project
     AND (j.candidate_id = ANY (v_ids)
          OR (v_slug IS NOT NULL AND public.linkedin_url_slug(j.linkedin_profile_url) = v_slug));

  -- Rattrapage (auto-analyze-message) : seulement un message postérieur au premier contact.
  IF p_received_at IS NOT NULL AND (v_contact IS NULL OR p_received_at <= v_contact) THEN
    RETURN jsonb_build_object('project_id', v_project, 'via', v_via, 'reason', 'before_contact');
  END IF;

  IF v_account IS NOT NULL THEN
    v_link := public.touch_mission_conversation(p_organization_id, v_project, v_account, v_ids, v_slug,
                v_chat, 'inferred', NULL, NULL, 'inbound', NULL, coalesce(p_received_at, now()), NULL);
  END IF;

  -- « Contacté » manqué : un envoi Konekt est prouvé dans cette mission (décision 13).
  IF v_first IS NOT NULL THEN
    v_pre := public.apply_mission_candidate_stage(p_organization_id, v_project, p_candidate,
               'contacted', 'system') -> 'rows';
  END IF;
  RETURN jsonb_build_object('project_id', v_project, 'via', v_via, 'link_id', v_link,
    'contacted_rows', v_pre,
    'rows', public.apply_mission_candidate_stage(p_organization_id, v_project, p_candidate,
                                                 'replied', 'system') -> 'rows');
END;
$$;

-- Message écrit depuis le compte du recruteur (décision 5) : écho d'un envoi
-- Konekt, note d'invitation, fil déjà rattaché (sa mission seule), sinon
-- Retenu dans une seule mission (U-I7).
CREATE OR REPLACE FUNCTION public.record_own_message(
  p_organization_id uuid,
  p_account_id text,
  p_chat_id text,
  p_message_id text,
  p_candidate jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_account  text := nullif(btrim(p_account_id), '');
  v_chat     text := nullif(btrim(p_chat_id), '');
  v_msg      text := nullif(btrim(p_message_id), '');
  v_ids      text[] := public.candidate_ref_ids(p_candidate);
  v_slug     text := public.candidate_ref_slug(p_candidate);
  v_cand     jsonb := coalesce(p_candidate, '{}'::jsonb);
  v_link_id  uuid;
  v_link_prj uuid;
  v_inv_at   timestamptz;
  v_inv_prj  uuid;
  v_projects uuid[];
  v_rows     jsonb;
BEGIN
  IF p_organization_id IS NULL OR v_account IS NULL THEN
    RETURN jsonb_build_object('result', 'missing_input');
  END IF;

  -- Candidat inconnu de l'appelant (format new_message) : celui de la conversation liée.
  IF cardinality(v_ids) = 0 AND v_slug IS NULL AND v_chat IS NOT NULL THEN
    SELECT ARRAY[mc.candidate_id] || mc.candidate_ids, mc.candidate_slug INTO v_ids, v_slug
      FROM public.mission_conversations mc
     WHERE mc.organization_id = p_organization_id AND mc.account_id = v_account AND mc.chat_id = v_chat
     ORDER BY mc.last_mission_send_at DESC NULLS LAST, mc.id
     LIMIT 1;
    v_ids := coalesce(v_ids, '{}'::text[]);
    v_cand := jsonb_build_object('ids', to_jsonb(v_ids), 'slug', v_slug);
  END IF;

  -- 1. Écho d'un envoi Konekt : même message, ou envoi Konekt (en cours ou
  --    enregistré, hors attribution « outside ») de moins de 10 minutes.
  IF EXISTS (
    SELECT 1 FROM public.mission_conversations mc
     WHERE mc.organization_id = p_organization_id AND mc.account_id = v_account
       AND ((v_msg IS NOT NULL AND mc.last_outbound_message_id = v_msg)
            OR (greatest(mc.outbound_pending_at,
                         CASE WHEN mc.last_send_kind IS DISTINCT FROM 'outside'
                              THEN mc.last_mission_send_at END) > now() - interval '10 minutes'
                AND ((v_chat IS NOT NULL AND mc.chat_id = v_chat)
                     OR mc.candidate_id = ANY (v_ids) OR mc.candidate_ids && v_ids
                     OR (v_slug IS NOT NULL AND mc.candidate_slug = v_slug))))) THEN
    RETURN jsonb_build_object('result', 'konekt_send');
  END IF;

  IF cardinality(v_ids) = 0 AND v_slug IS NULL THEN
    RETURN jsonb_build_object('result', 'no_candidate');
  END IF;

  -- 2. Note d'une invitation Konekt, renvoyée comme message propre à
  --    l'acceptation (unipile-webhook/index.ts:1289-1296) : conversation encore
  --    inconnue sur ce compte.
  IF v_chat IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.mission_conversations mc
        WHERE mc.organization_id = p_organization_id AND mc.account_id = v_account
          AND mc.chat_id = v_chat) THEN
    SELECT mc.id INTO v_link_id
      FROM public.mission_conversations mc
     WHERE mc.organization_id = p_organization_id AND mc.account_id = v_account
       AND mc.last_send_kind = 'invitation' AND mc.chat_id IS NULL
       AND (mc.candidate_id = ANY (v_ids) OR mc.candidate_ids && v_ids
            OR (v_slug IS NOT NULL AND mc.candidate_slug = v_slug))
     ORDER BY mc.last_mission_send_at DESC NULLS LAST, mc.id
     LIMIT 1;
    IF v_link_id IS NOT NULL THEN
      UPDATE public.mission_conversations SET chat_id = v_chat WHERE id = v_link_id;
      RETURN jsonb_build_object('result', 'invitation_note', 'link_id', v_link_id);
    END IF;
    -- Invitation envoyée par le moteur sans lien (avant le lot 0b).
    SELECT x.executed_at, public.enrollment_mission_id(e.id) INTO v_inv_at, v_inv_prj
      FROM public.sequence_enrollments e
      LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
      JOIN public.sequence_step_executions x ON x.enrollment_id = e.id
      JOIN public.sequence_steps ss ON ss.id = x.step_id
     WHERE coalesce(e.organization_id, q.organization_id) = p_organization_id
       AND (e.account_id = v_account OR e.assigned_sender_id = v_account)
       AND (e.profile_id = ANY (v_ids) OR e.provider_id = ANY (v_ids) OR e.resolved_profile_id = ANY (v_ids)
            OR (v_slug IS NOT NULL AND public.linkedin_url_slug(e.profile_url) = v_slug))
       AND ss.action_type = 'connection_request'
       AND x.status IN ('sent','opened','clicked','replied')
     ORDER BY x.executed_at DESC NULLS LAST
     LIMIT 1;
    -- Note reconnue seulement si le lien est créé : la conversation devient
    -- connue et les messages suivants passent aux règles 3 et 4. Invitation
    -- sans mission, ou candidat sans identifiant : aucun lien possible, le
    -- message suit les règles 3 et 4 (sinon chaque message du fil serait pris
    -- pour la note, sans fin).
    IF FOUND AND v_inv_prj IS NOT NULL AND cardinality(v_ids) > 0 THEN
      v_link_id := public.touch_mission_conversation(p_organization_id, v_inv_prj, v_account, v_ids, v_slug,
                     v_chat, 'sequence', NULL, NULL, 'outbound', NULL, v_inv_at, 'invitation');
      IF v_link_id IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'invitation_note', 'link_id', v_link_id);
      END IF;
    END IF;
  END IF;

  -- 3. Conversation déjà rattachée sur ce compte : réponse du recruteur hors
  --    Konekt. Seule la mission de ce lien est concernée ; le tri de la
  --    décision 2 (last_mission_send_at) ne bouge pas.
  SELECT mc.id, mc.project_id INTO v_link_id, v_link_prj
    FROM public.mission_conversations mc
   WHERE mc.organization_id = p_organization_id AND mc.account_id = v_account
     AND ((v_chat IS NOT NULL AND mc.chat_id = v_chat)
          OR mc.candidate_id = ANY (v_ids) OR mc.candidate_ids && v_ids
          OR (v_slug IS NOT NULL AND mc.candidate_slug = v_slug))
   ORDER BY coalesce(v_chat IS NOT NULL AND mc.chat_id = v_chat, false) DESC,
            mc.last_mission_send_at DESC NULLS LAST, mc.last_inbound_at DESC NULLS LAST,
            mc.created_at DESC, mc.id
   LIMIT 1;
  IF v_link_id IS NOT NULL THEN
    UPDATE public.mission_conversations mc
       SET last_outbound_at = greatest(coalesce(mc.last_outbound_at, now()), now()),
           first_outbound_at = coalesce(mc.first_outbound_at, now()),
           chat_id = coalesce(mc.chat_id, v_chat)
     WHERE mc.id = v_link_id;
    v_rows := public.apply_mission_candidate_stage(p_organization_id, v_link_prj, v_cand,
                'contacted', 'system', NULL, NULL, ARRAY['retained']) -> 'rows';
    RETURN jsonb_build_object('result', 'linked', 'project_id', v_link_prj,
                              'link_id', v_link_id, 'rows', v_rows);
  END IF;

  -- 4. Aucune conversation rattachée : Retenu dans une seule mission de
  --    l'organisation → Contacté et lien « outside » (U-I7). Sinon rien.
  SELECT array_agg(DISTINCT j.project_id) INTO v_projects
    FROM public.job_candidate_status j
    JOIN public.sourcing_projects sp ON sp.id = j.project_id AND sp.organization_id = p_organization_id
   WHERE j.organization_id = p_organization_id
     AND j.general_stage = 'retained'
     AND (j.candidate_id = ANY (v_ids)
          OR (v_slug IS NOT NULL AND public.linkedin_url_slug(j.linkedin_profile_url) = v_slug));
  IF coalesce(cardinality(v_projects), 0) <> 1 THEN
    RETURN jsonb_build_object('result', CASE WHEN v_projects IS NULL THEN 'not_retained' ELSE 'ambiguous' END,
                              'missions', coalesce(cardinality(v_projects), 0));
  END IF;
  v_rows := public.apply_mission_candidate_stage(p_organization_id, v_projects[1], v_cand,
              'contacted', 'system', NULL, NULL, ARRAY['retained']) -> 'rows';
  IF cardinality(v_ids) > 0 THEN
    v_link_id := public.touch_mission_conversation(p_organization_id, v_projects[1], v_account, v_ids, v_slug,
                   v_chat, 'outside', NULL, NULL, 'outbound', NULL, NULL, 'outside');
  END IF;
  RETURN jsonb_build_object('result', 'contacted', 'project_id', v_projects[1],
                            'link_id', v_link_id, 'rows', v_rows);
END;
$$;

-- Résumé d'analyse d'une réponse : lignes à Contacté ou au-delà (ou déjà
-- contactées) de la mission résolue ; recommendation n'est plus touché.
CREATE OR REPLACE FUNCTION public.record_reply_summary(
  p_organization_id uuid,
  p_account_id text,
  p_chat_id text,
  p_candidate jsonb,
  p_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids     text[] := public.candidate_ref_ids(p_candidate);
  v_slug    text := public.candidate_ref_slug(p_candidate);
  v_summary text := left(btrim(coalesce(p_summary, '')), 2000);
  v_project uuid;
  v_via     text;
  v_n       integer := 0;
BEGIN
  IF p_organization_id IS NULL OR v_summary = '' OR (cardinality(v_ids) = 0 AND v_slug IS NULL) THEN
    RETURN jsonb_build_object('project_id', NULL, 'updated', 0);
  END IF;
  SELECT r.project_id, r.via INTO v_project, v_via
    FROM public.resolve_conversation_mission(p_organization_id, p_account_id, p_chat_id, p_candidate, NULL) r;
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('project_id', NULL, 'updated', 0);
  END IF;
  UPDATE public.job_candidate_status j
     SET reply_summary = v_summary
   WHERE j.organization_id = p_organization_id
     AND j.project_id = v_project
     AND (j.candidate_id = ANY (v_ids)
          OR (v_slug IS NOT NULL AND public.linkedin_url_slug(j.linkedin_profile_url) = v_slug))
     AND (j.general_stage IN ('contacted', 'replied', 'interviewing', 'hired') OR j.contacted_at IS NOT NULL)
     AND j.reply_summary IS DISTINCT FROM v_summary;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('project_id', v_project, 'via', v_via, 'updated', v_n);
END;
$$;

-- ---------------------------------------------------------------------
-- 10. Rendez-vous (Calendly) : résolution, puis écriture sur la mission
--     choisie (la même sert à la séance et à l'étape).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_meeting_mission(
  p_organization_id uuid,
  p_candidate jsonb)
RETURNS TABLE (project_id uuid, via text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ids      text[] := public.candidate_ref_ids(p_candidate);
  v_slug     text := public.candidate_ref_slug(p_candidate);
  v_projects uuid[];
BEGIN
  IF p_organization_id IS NULL OR (cardinality(v_ids) = 0 AND v_slug IS NULL) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.project_id, r.via
      FROM public.resolve_conversation_mission(p_organization_id, NULL, NULL, p_candidate, NULL) r;
  IF FOUND THEN RETURN; END IF;
  -- Repli : le candidat n'est suivi (hors écartés) que dans une seule mission de l'organisation.
  SELECT array_agg(DISTINCT j.project_id) INTO v_projects
    FROM public.job_candidate_status j
    JOIN public.sourcing_projects sp ON sp.id = j.project_id AND sp.organization_id = p_organization_id
   WHERE j.organization_id = p_organization_id
     AND j.general_stage <> 'rejected'
     AND (j.candidate_id = ANY (v_ids)
          OR (v_slug IS NOT NULL AND public.linkedin_url_slug(j.linkedin_profile_url) = v_slug));
  IF coalesce(cardinality(v_projects), 0) = 1 THEN
    RETURN QUERY SELECT v_projects[1], 'single_mission'::text;
  END IF;
END;
$$;

-- Entretien en origine system sur la première étape d'entretien de la
-- mission, ou « ITW en cours » si elle n'en a pas. Un écarté reste écarté.
CREATE OR REPLACE FUNCTION public.record_candidate_meeting(
  p_organization_id uuid,
  p_project_id uuid,
  p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_step uuid;
BEGIN
  IF p_organization_id IS NULL OR p_project_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.sourcing_projects sp
        WHERE sp.id = p_project_id AND sp.organization_id = p_organization_id) THEN
    RETURN jsonb_build_object('project_id', NULL, 'reason', 'no_mission');
  END IF;
  SELECT s.id INTO v_step
    FROM public.mission_process_steps s
   WHERE s.project_id = p_project_id AND s.organization_id = p_organization_id
   ORDER BY s.step_order, s.created_at, s.id
   LIMIT 1;
  RETURN jsonb_build_object('project_id', p_project_id, 'process_step_id', v_step,
    'rows', public.apply_mission_candidate_stage(p_organization_id, p_project_id, p_candidate,
                                                 'interviewing', 'system', v_step) -> 'rows');
END;
$$;

-- ---------------------------------------------------------------------
-- 11. Reprise : un lien par (organisation, mission résolue, compte,
--     profile_id) des inscriptions existantes (17 en production, vers une
--     seule mission). Dates d'envoi visible (critères 0a), agrégées sur
--     toutes les inscriptions de la même clé ; réponse = replied_at ;
--     inscriptions effacées (RGPD) exclues. ON CONFLICT DO NOTHING : sans
--     effet au second passage ou sur une base vide. Le chat_id se complète
--     au premier message, reçu, envoyé ou propre.
-- ---------------------------------------------------------------------
DO $lot0b_liens$
DECLARE
  v_n integer;
BEGIN
  WITH enr AS (
    SELECT e.id, coalesce(e.organization_id, q.organization_id) AS org,
           btrim(e.account_id) AS account_id, btrim(e.profile_id) AS profile_id,
           e.provider_id, e.resolved_profile_id, e.profile_url, e.created_by, e.created_at, e.replied_at,
           public.enrollment_mission_id(e.id) AS project_id
      FROM public.sequence_enrollments e
      LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
     WHERE btrim(coalesce(e.account_id, '')) <> '' AND btrim(coalesce(e.profile_id, '')) <> ''
       AND NOT (coalesce(e.tracking_data, '{}'::jsonb) ? 'gdpr_erased_at')
  ), keyed AS (
    SELECT enr.* FROM enr WHERE enr.org IS NOT NULL AND enr.project_id IS NOT NULL
  ), sends AS (
    -- Envoi visible : mêmes critères que la reprise 0a (20260928201409:347-351).
    SELECT x.enrollment_id, x.executed_at, ss.action_type
      FROM public.sequence_step_executions x
      JOIN public.sequence_steps ss ON ss.id = x.step_id
     WHERE x.enrollment_id IN (SELECT keyed.id FROM keyed)
       AND x.executed_at IS NOT NULL
       AND ss.action_type IN ('message','smart_message','inmail','email','whatsapp_message','connection_request')
       AND (x.status IN ('sent','opened','clicked','replied')
            OR (x.status = 'cancelled' AND x.skip_reason ~ '^Enrollment became \S+ during execution$'))
  ), per_key AS (
    SELECT k.org, k.project_id, k.account_id, k.profile_id,
           min(s.executed_at) AS first_sent, max(s.executed_at) AS last_sent,
           (array_agg(s.action_type ORDER BY s.executed_at DESC, s.action_type)
              FILTER (WHERE s.executed_at IS NOT NULL))[1] AS last_action,
           max(k.replied_at) AS replied_at
      FROM keyed k
      LEFT JOIN sends s ON s.enrollment_id = k.id
     GROUP BY k.org, k.project_id, k.account_id, k.profile_id
  ), latest AS (
    SELECT DISTINCT ON (k.org, k.project_id, k.account_id, k.profile_id) k.*
      FROM keyed k
     ORDER BY k.org, k.project_id, k.account_id, k.profile_id, k.created_at DESC, k.id
  )
  INSERT INTO public.mission_conversations
    (organization_id, project_id, account_id, candidate_id, candidate_ids, candidate_slug, chat_id,
     source, enrollment_id, created_by, first_outbound_at, last_outbound_at, last_mission_send_at,
     last_send_kind, last_inbound_at, created_at)
  SELECT l.org, l.project_id, l.account_id, l.profile_id,
         ARRAY(SELECT DISTINCT btrim(v) FROM unnest(ARRAY[l.provider_id, l.resolved_profile_id]) AS v
                WHERE btrim(v) <> '' AND btrim(v) <> l.profile_id),
         public.linkedin_url_slug(l.profile_url), NULL,
         'backfill', l.id, l.created_by, p.first_sent, p.last_sent, p.last_sent,
         CASE WHEN p.last_action IS NULL THEN NULL
              WHEN p.last_action = 'connection_request' THEN 'invitation'
              WHEN p.last_action = 'inmail' THEN 'inmail'
              ELSE 'message' END,
         p.replied_at, l.created_at
    FROM latest l
    JOIN per_key p ON p.org = l.org AND p.project_id = l.project_id
                  AND p.account_id = l.account_id AND p.profile_id = l.profile_id
  ON CONFLICT (organization_id, project_id, account_id, candidate_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Lot 0b : % lien(s) conversation–mission repris des inscriptions', v_n;
END
$lot0b_liens$;

-- ---------------------------------------------------------------------
-- 12. Droits et commentaires.
--     Aides pures et set_candidate_stages : authenticated et service_role.
--     Fonctions serveur : service_role seulement, jamais authenticated
--     (organisation passée sans contrôle d'appartenance). SECURITY INVOKER.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.linkedin_url_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linkedin_url_slug(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.candidate_ref_ids(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_ref_ids(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.candidate_ref_slug(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_ref_slug(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_candidate_stages(uuid[], text, text, uuid, uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_candidate_stages(uuid[], text, text, uuid, uuid, text, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enrollment_mission_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.candidate_enrollment_ids(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_conversation_mission(uuid, text, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.candidate_mission_sends(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_mission_candidate_stage(uuid, uuid, jsonb, text, text, uuid, text, text[], uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_mission_conversation(uuid, uuid, text, text[], text, text, text, uuid, uuid, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_candidate_outbound(uuid, text, jsonb, text, uuid, text, text, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_candidate_inbound(uuid, text, jsonb, text, uuid[], boolean, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_own_message(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_reply_summary(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_meeting_mission(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_candidate_meeting(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enrollment_mission_id(uuid),
  public.candidate_enrollment_ids(uuid, text, jsonb),
  public.resolve_conversation_mission(uuid, text, text, jsonb, uuid[]),
  public.candidate_mission_sends(uuid, uuid, jsonb),
  public.apply_mission_candidate_stage(uuid, uuid, jsonb, text, text, uuid, text, text[], uuid, uuid),
  public.touch_mission_conversation(uuid, uuid, text, text[], text, text, text, uuid, uuid, text, text, timestamptz, text),
  public.record_candidate_outbound(uuid, text, jsonb, text, uuid, text, text, uuid, uuid, boolean, text),
  public.record_candidate_inbound(uuid, text, jsonb, text, uuid[], boolean, timestamptz),
  public.record_own_message(uuid, text, text, text, jsonb),
  public.record_reply_summary(uuid, text, text, jsonb, text),
  public.resolve_meeting_mission(uuid, jsonb),
  public.record_candidate_meeting(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON TABLE public.mission_conversations IS
  'Lot 0b : lien entre une conversation LinkedIn (ou le profil) et une mission, par organisation, mission, compte et candidat. Écrit par le serveur à chaque envoi, réception et message propre ; lu par les membres (un collaborateur : ses liens seulement) ; supprimé à l''effacement RGPD d''une inscription. Tri des missions : last_mission_send_at. Rang 3 de Maintenant : last_inbound_at > last_outbound_at.';
COMMENT ON TABLE public.jcs_direct_write_log IS
  'Lot 0b : journal des écritures directes de l''étape d''un candidat (garde stage_write_guard en observation). Fermé à anon et authenticated.';
COMMENT ON COLUMN public.inmail_queue.project_id IS
  'Lot 0b : mission de l''InMail programmé (Contacté et lien à l''envoi).';
COMMENT ON FUNCTION public.jcs_stage_write_guard() IS
  'Lot 0b : garde stage_write_guard. Toute écriture directe (jeton authenticated, service_role ou anon, ou SET ROLE) qui change l''étape dérivée est journalisée (observe) ou refusée (refuse, HINT STAGE_DIRECT_WRITE). Mode : jcs_stage_write_mode(). Arrêt d''urgence neutre : DISABLE TRIGGER stage_write_guard.';
COMMENT ON FUNCTION public.set_candidate_stages(uuid[], text, text, uuid, uuid, text, text[]) IS
  'Lot 0b : set_candidate_stage sur 200 lignes au plus ; résultat par ligne (updated, unchanged, kept, not_contacted, skipped, error). Seuls les refus 22023 et P0002 sont rendus par ligne ; les autres erreurs annulent l''appel.';
COMMENT ON FUNCTION public.resolve_conversation_mission(uuid, text, text, jsonb, uuid[]) IS
  'Lot 0b : mission d''une conversation. 1 conversation sur le compte, 2 profil sur le compte, 3 inscription, 4 lignes à Contacté ou au-delà d''une mission de l''organisation. Tri : dernier envoi attribué, dernière réception, création, id.';
COMMENT ON FUNCTION public.record_candidate_outbound(uuid, text, jsonb, text, uuid, text, text, uuid, uuid, boolean, text) IS
  'Lot 0b : envoi Konekt (ou son marqueur p_pending). Lien conversation–mission, puis Contacté en origine system sur les lignes du candidat dans la mission, avec création d''une ligne si p_created_by est donné.';
COMMENT ON FUNCTION public.record_candidate_inbound(uuid, text, jsonb, text, uuid[], boolean, timestamptz) IS
  'Lot 0b : réponse d''un candidat. Contacté puis A répondu si un envoi Konekt est prouvé dans la mission, sinon A répondu (not_contacted pour À trier ou Retenu). p_received_at : rattrapage, rien avant le premier contact.';
COMMENT ON FUNCTION public.record_own_message(uuid, text, text, text, jsonb) IS
  'Lot 0b : message écrit depuis le compte du recruteur. Écho d''un envoi Konekt ou note d''invitation : rien ; fil rattaché : Contacté dans sa mission seule ; sinon Retenu dans une seule mission : Contacté et lien outside.';
COMMENT ON FUNCTION public.record_reply_summary(uuid, text, text, jsonb, text) IS
  'Lot 0b : résumé d''analyse d''une réponse, sur les lignes à Contacté ou au-delà de la mission résolue. recommendation n''est plus touché.';
COMMENT ON FUNCTION public.record_candidate_meeting(uuid, uuid, jsonb) IS
  'Lot 0b : rendez-vous. En entretien (origine system) sur la première étape de la mission, ou ITW en cours sans étape ; un écarté reste écarté.';
