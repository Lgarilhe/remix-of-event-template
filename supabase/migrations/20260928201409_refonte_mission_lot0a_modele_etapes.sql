-- =====================================================================
-- Refonte mission, lot 0a : le modèle des étapes candidat.
-- Conception : docs/refonte-mission/conception.md, section 3.3 (« Une seule
-- étape par candidat »). Rien de visible pour l'utilisateur en 0a : les
-- écrivains et les lecteurs actuels ne changent pas (lots 0b et 0c).
--
-- Blocs, dans l'ordre d'exécution :
--   1.  Colonnes du modèle sur job_candidate_status (étape générale, étape
--       d'entretien, date d'entrée, origine de la décision, jalons datés,
--       résumé d'analyse), clé étrangère vers mission_process_steps en
--       ON DELETE SET NULL, contraintes, index, défaut de status aligné sur
--       la production ('new').
--   2.  candidate_stage_from_legacy : correspondance pure de l'ancien couple
--       (status, pipeline_stage) vers l'étape générale.
--   3.  Déclencheur de transition stage_sync_from_legacy : tant que les
--       écrivains écrivent l'ancien couple, les nouvelles colonnes en sont
--       dérivées. Il ne touche jamais status ni pipeline_stage et ne lève
--       aucune erreur.
--   4.  jcs_stage_backfill : reprise des lignes existantes (jalons datés
--       seulement sur une date exacte, sinon NULL).
--   5.  Bloc de reprise, puis NOT NULL et défauts.
--   6.  Statistiques : clé project_id + organisation de la mission ; les
--       définitions restent sur status jusqu'au lot 0c. Retrait du
--       déclencheur par ligne en doublon (trg_refresh_project_shortlist_stats).
--   7.  set_candidate_stage : la seule façon de changer l'étape (appelée par
--       les écrivains à partir du lot 0b).
--   8.  replace_process_steps : l'étape d'entretien suit le réordonnancement,
--       la date d'entrée et les jalons restent.
--   9.  Outils de l'assistant qui changent une étape : jamais automatiques.
--   10. Commentaires.
--
-- Rejouable : deux applications de suite ne changent rien. Rejouable sur une
-- base vide : aucun objet propre à la production n'est supposé.
-- Arrêt d'urgence, neutre pour l'application (les compteurs lisent status) :
--   DROP TRIGGER stage_sync_from_legacy ON public.job_candidate_status;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes, clé étrangère, contraintes, index, défaut de status.
--    Un CHECK « col IN (...) » laisse passer NULL : il est posé avant la
--    reprise. Aucun CHECK sur status ni pipeline_stage (valeurs libres).
-- ---------------------------------------------------------------------
ALTER TABLE public.job_candidate_status
  ADD COLUMN IF NOT EXISTS general_stage       text,
  ADD COLUMN IF NOT EXISTS process_step_id     uuid,
  ADD COLUMN IF NOT EXISTS stage_entered_at    timestamptz,
  ADD COLUMN IF NOT EXISTS decision_source     text,
  ADD COLUMN IF NOT EXISTS contacted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at          timestamptz,
  ADD COLUMN IF NOT EXISTS first_interview_at  timestamptz,
  ADD COLUMN IF NOT EXISTS presented_at        timestamptz,
  ADD COLUMN IF NOT EXISTS hired_at            timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at         timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_from_stage text,
  ADD COLUMN IF NOT EXISTS reply_summary       text;

ALTER TABLE public.job_candidate_status DROP CONSTRAINT IF EXISTS job_candidate_status_process_step_id_fkey;
ALTER TABLE public.job_candidate_status ADD CONSTRAINT job_candidate_status_process_step_id_fkey
  FOREIGN KEY (process_step_id) REFERENCES public.mission_process_steps(id) ON DELETE SET NULL;
ALTER TABLE public.job_candidate_status DROP CONSTRAINT IF EXISTS jcs_general_stage_check;
ALTER TABLE public.job_candidate_status ADD CONSTRAINT jcs_general_stage_check
  CHECK (general_stage IN ('to_sort','retained','contacted','replied','interviewing','hired','rejected'));
ALTER TABLE public.job_candidate_status DROP CONSTRAINT IF EXISTS jcs_decision_source_check;
ALTER TABLE public.job_candidate_status ADD CONSTRAINT jcs_decision_source_check
  CHECK (decision_source IN ('ai','user','system'));
ALTER TABLE public.job_candidate_status DROP CONSTRAINT IF EXISTS jcs_rejected_from_stage_check;
ALTER TABLE public.job_candidate_status ADD CONSTRAINT jcs_rejected_from_stage_check
  CHECK (rejected_from_stage IN ('to_sort','retained','contacted','replied','interviewing','hired'));
ALTER TABLE public.job_candidate_status DROP CONSTRAINT IF EXISTS jcs_process_step_stage_check;
ALTER TABLE public.job_candidate_status ADD CONSTRAINT jcs_process_step_stage_check
  CHECK (process_step_id IS NULL OR general_stage = 'interviewing');
-- Sans cet index, le SET NULL de la clé étrangère parcourrait toute la table.
CREATE INDEX IF NOT EXISTS idx_jcs_process_step_id
  ON public.job_candidate_status (process_step_id) WHERE process_step_id IS NOT NULL;
-- Base neuve : 'dismissed' (20260203101515) ; production : 'new'.
ALTER TABLE public.job_candidate_status ALTER COLUMN status SET DEFAULT 'new';

-- ---------------------------------------------------------------------
-- 2. Correspondance pure de l'ancien couple vers l'étape générale.
--    Un écart l'emporte ; sinon, le rang le plus avancé entre status et
--    pipeline_stage. L'étape d'entretien p_step_id (trouvée par l'appelant
--    pour cette mission et cette organisation) n'est rendue que si
--    pipeline_stage est son identifiant. Toute valeur est couverte : la
--    fonction ne lève jamais d'erreur.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.candidate_stage_from_legacy(
  p_status text, p_pipeline_stage text, p_step_id uuid)
RETURNS TABLE (general_stage text, process_step_id uuid, rejected_from_stage text, presented boolean)
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT lower(btrim(coalesce(p_status, ''))) AS st,
           lower(btrim(coalesce(p_pipeline_stage, ''))) AS ps
  ), c AS (
    SELECT
      CASE WHEN st = 'shortlisted' THEN 1
           WHEN st IN ('messaged','contacted') THEN 2
           WHEN st IN ('replied','interested','not_interested') THEN 3
           WHEN st = 'qualification' THEN 4
           ELSE 0 END AS st_rank,
      CASE WHEN ps IN ('pressenti','shortlisted') THEN 1
           WHEN ps IN ('contacté','messaged') THEN 2
           WHEN ps = 'répondu' THEN 3
           WHEN ps IN ('pré-qualif','itw en cours','offre','cv envoyé') THEN 4
           WHEN ps IN ('gagné','hired') THEN 5
           WHEN ps ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 4
           ELSE 0 END AS ps_rank,
      (st = 'dismissed' OR ps IN ('perdu','dismissed')) AS rej,
      (p_step_id IS NOT NULL AND ps = p_step_id::text) AS on_step,
      (ps = 'cv envoyé') AS presented
    FROM v
  )
  SELECT
    CASE WHEN rej THEN 'rejected'
         ELSE (ARRAY['to_sort','retained','contacted','replied','interviewing','hired'])[greatest(st_rank, ps_rank) + 1] END,
    CASE WHEN NOT rej AND on_step THEN p_step_id END,
    CASE WHEN rej THEN (ARRAY['to_sort','retained','contacted','replied','interviewing','hired'])[greatest(st_rank, ps_rank) + 1] END,
    presented
  FROM c;
$$;
REVOKE ALL ON FUNCTION public.candidate_stage_from_legacy(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_stage_from_legacy(text, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Déclencheur de transition. BEFORE INSERT OR UPDATE, sans liste de
--    colonnes : il neutralise les écritures directes des colonnes du
--    modèle, reçoit le SET NULL de la clé étrangère et compare les valeurs.
--    Nom trié après resolve_project_id_ins (project_id déjà rempli) et
--    avant update_job_candidate_status_updated_at.
--    Drapeaux locaux à la transaction :
--      konekt.stage_write = <id de la ligne> : set_candidate_stage, laisse passer ;
--      konekt.stage_write = '*'              : jcs_stage_backfill, laisse passer ;
--      konekt.stage_remap = <project_id>     : replace_process_steps, seule
--                                              l'étape d'entretien suit.
--    Le drapeau est une garde d'intégrité, pas une frontière de sécurité :
--    la RLS reste la seule barrière.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jcs_stage_sync_from_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_uuid   CONSTANT text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_flag   text := coalesce(current_setting('konekt.stage_write', true), '');
  v_remap  text := coalesce(current_setting('konekt.stage_remap', true), '');
  v_ps     text := lower(btrim(coalesce(NEW.pipeline_stage, '')));
  v_server boolean := auth.role() IS DISTINCT FROM 'authenticated';
  v_step   uuid;
  v_old    text;
  v_trust  boolean;
  d        record;
BEGIN
  -- 1. set_candidate_stage (cette ligne) ou reprise : déjà calculé.
  IF v_flag = NEW.id::text OR v_flag = '*' THEN
    RETURN NEW;
  END IF;

  -- 2. Les colonnes du modèle ne s'écrivent pas en direct.
  IF TG_OP = 'INSERT' THEN
    NEW.general_stage := NULL;      NEW.process_step_id := NULL;  NEW.stage_entered_at := NULL;
    NEW.decision_source := NULL;    NEW.contacted_at := NULL;     NEW.replied_at := NULL;
    NEW.first_interview_at := NULL; NEW.presented_at := NULL;     NEW.hired_at := NULL;
    NEW.rejected_at := NULL;        NEW.rejected_from_stage := NULL;
  ELSE
    NEW.general_stage := OLD.general_stage;       NEW.stage_entered_at := OLD.stage_entered_at;
    NEW.decision_source := OLD.decision_source;   NEW.contacted_at := OLD.contacted_at;
    NEW.replied_at := OLD.replied_at;             NEW.first_interview_at := OLD.first_interview_at;
    NEW.presented_at := OLD.presented_at;         NEW.hired_at := OLD.hired_at;
    NEW.rejected_at := OLD.rejected_at;           NEW.rejected_from_stage := OLD.rejected_from_stage;
    IF NEW.process_step_id IS DISTINCT FROM OLD.process_step_id THEN
      -- Seul admis : NULL pour une étape qui n'existe plus (ON DELETE SET NULL).
      IF NEW.process_step_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.mission_process_steps s WHERE s.id = OLD.process_step_id) THEN
        NEW.process_step_id := OLD.process_step_id;
      END IF;
    END IF;
    v_old := OLD.general_stage;
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.pipeline_stage IS NOT DISTINCT FROM OLD.pipeline_stage
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
      IF NEW.general_stage = 'to_sort' AND NEW.decision_source IS NULL AND NEW.score IS NOT NULL THEN
        NEW.decision_source := 'ai';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- 3. Étape de CETTE mission désignée par pipeline_stage. SKIP LOCKED : une
  --    étape en cours de suppression n'est pas retenue (ni attente, ni
  --    erreur de clé étrangère, ni interblocage).
  IF NEW.project_id IS NOT NULL AND v_ps ~ c_uuid THEN
    SELECT s.id INTO v_step
      FROM public.mission_process_steps s
     WHERE s.id = v_ps::uuid
       AND s.project_id = NEW.project_id
       AND s.organization_id = NEW.organization_id
     FOR KEY SHARE SKIP LOCKED;
  END IF;
  SELECT * INTO d FROM public.candidate_stage_from_legacy(NEW.status, NEW.pipeline_stage, v_step);

  -- 4. replace_process_steps : seule l'étape d'entretien suit ; date,
  --    origine et jalons restent.
  IF TG_OP = 'UPDATE' AND v_remap <> '' AND v_remap = NEW.project_id::text
     AND d.general_stage = NEW.general_stage THEN
    NEW.process_step_id := d.process_step_id;
    RETURN NEW;
  END IF;

  -- 5. Cas général. Une écriture serveur qui fait sauter une ligne À trier
  --    ou Retenu en A répondu ou En entretien ne pose aucun jalon : l'étape
  --    suit l'affichage actuel, mais une date fausse ne se corrigerait plus.
  NEW.general_stage := d.general_stage;
  NEW.process_step_id := d.process_step_id;
  v_trust := NOT (v_server AND coalesce(v_old, 'to_sort') IN ('to_sort','retained')
                  AND d.general_stage IN ('replied','interviewing'));
  IF TG_OP = 'INSERT' OR d.general_stage IS DISTINCT FROM v_old THEN
    NEW.stage_entered_at := now();
    NEW.decision_source := CASE d.general_stage
      WHEN 'to_sort' THEN CASE WHEN NEW.score IS NOT NULL THEN 'ai'
                               WHEN lower(btrim(NEW.status)) = 'untreated' THEN 'user'
                               WHEN v_old = 'rejected' THEN 'user' END
      WHEN 'rejected' THEN CASE
        WHEN coalesce(v_old, 'to_sort') = 'to_sort'
         AND (NEW.recommendation = 'skip'
              OR (NEW.recommendation IN ('POSSIBLE_MATCH','WEAK_MATCH','NO_MATCH')
                  AND coalesce(NEW.score, 0) < 60))
        THEN 'ai' ELSE 'user' END
      WHEN 'contacted' THEN CASE WHEN v_server THEN 'system' ELSE 'user' END
      WHEN 'replied'   THEN CASE WHEN v_server THEN 'system' ELSE 'user' END
      WHEN 'interviewing' THEN CASE WHEN v_server AND lower(btrim(NEW.status)) = 'qualification'
                                    THEN 'system' ELSE 'user' END
      ELSE 'user' END;
    IF v_trust THEN
      IF d.general_stage IN ('contacted','replied','interviewing','hired') THEN
        NEW.contacted_at := coalesce(NEW.contacted_at, now());
      END IF;
      IF d.general_stage IN ('replied','interviewing','hired') THEN
        NEW.replied_at := coalesce(NEW.replied_at, now());
      END IF;
      IF d.general_stage IN ('interviewing','hired') THEN
        NEW.first_interview_at := coalesce(NEW.first_interview_at, now());
      END IF;
      IF d.general_stage = 'hired' THEN
        NEW.hired_at := coalesce(NEW.hired_at, now());
      END IF;
    END IF;
    IF d.general_stage = 'rejected' THEN
      NEW.rejected_at := now();
      NEW.rejected_from_stage := coalesce(v_old, d.rejected_from_stage);
    END IF;
  ELSIF d.process_step_id IS NOT NULL AND d.process_step_id IS DISTINCT FROM OLD.process_step_id THEN
    NEW.stage_entered_at := now();          -- d'une étape d'entretien à une autre
  END IF;
  IF d.presented THEN
    NEW.presented_at := coalesce(NEW.presented_at, now());
  END IF;
  IF NEW.general_stage = 'to_sort' AND NEW.decision_source IS NULL AND NEW.score IS NOT NULL THEN
    NEW.decision_source := 'ai';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jcs_stage_sync_from_legacy() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS stage_sync_from_legacy ON public.job_candidate_status;
CREATE TRIGGER stage_sync_from_legacy
  BEFORE INSERT OR UPDATE ON public.job_candidate_status
  FOR EACH ROW EXECUTE FUNCTION public.jcs_stage_sync_from_legacy();

-- ---------------------------------------------------------------------
-- 4. Reprise des lignes existantes. Réservée au propriétaire de la table
--    (migration, audit) : révoquée à PUBLIC, anon, authenticated et
--    service_role (les privilèges par défaut donnent EXECUTE à service_role).
--    Elle coupe elle-même puis rétablit les déclencheurs d'updated_at et
--    d'indexation : un second appel donne les mêmes valeurs, updated_at ne
--    bouge pas, aucun appel HTTP ne part. ALTER TABLE prend un verrou
--    exclusif jusqu'à la fin de la transaction. L'appeler avec un tableau
--    déjà calculé, jamais depuis une requête qui parcourt la table.
--    Jalons : date exacte seulement (premier envoi visible, réponse de
--    l'inscription, avis du portail, quelle que soit l'étape actuelle ; ou
--    created_at d'une ligne jamais modifiée), sinon NULL. stage_entered_at
--    est approché.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jcs_stage_backfill(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_axis CONSTANT text[] := ARRAY['to_sort','retained','contacted','replied','interviewing','hired'];
  c_uuid CONSTANT text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_iso  CONSTANT text := '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d';
  v_upd "char";
  v_ing "char";
  v_count integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Ni updated_at (« depuis N j », rgpd-purge) ni l'indexation (un appel HTTP par ligne) ne bougent.
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
  PERFORM set_config('konekt.stage_write', '*', true);

  WITH base AS (
    SELECT j.id, j.organization_id, j.project_id, j.candidate_id,
           j.status, lower(btrim(j.status)) AS st, j.pipeline_stage,
           j.score, j.scoring_details, j.created_at, j.updated_at,
           (j.updated_at = j.created_at) AS exact,
           (SELECT s.id FROM public.mission_process_steps s
             WHERE s.id = CASE WHEN lower(btrim(coalesce(j.pipeline_stage, ''))) ~ c_uuid
                               THEN lower(btrim(j.pipeline_stage))::uuid END
               AND s.project_id = j.project_id
               AND s.organization_id = j.organization_id) AS step_id
      FROM public.job_candidate_status j
     WHERE j.id = ANY (p_ids)
  ),
  der AS (
    SELECT b.*, f.general_stage AS g, f.process_step_id AS g_step,
           f.rejected_from_stage AS g_from, f.presented AS g_presented
      FROM base b
     CROSS JOIN LATERAL public.candidate_stage_from_legacy(b.status, b.pipeline_stage, b.step_id) f
  ),
  enr AS (
    -- Inscriptions de la même organisation et de la même mission (par la
    -- séquence ou par job_id normalisé). Envoi visible : règles de
    -- _shared/sequence-engine-rules.ts (VISIBLE_SEND_ACTIONS,
    -- SENT_EXECUTION_STATUSES), plus les annulations de BUG-095.
    SELECT d.id,
           min(e.created_at) AS enrolled_at,
           min(coalesce(e.replied_at,
               CASE WHEN e.tracking_data->>'previous_replied_at' ~ c_iso
                    THEN (e.tracking_data->>'previous_replied_at')::timestamptz END)) AS enr_replied_at,
           min(x.executed_at) FILTER (
             WHERE ss.action_type IN ('message','smart_message','inmail','email','whatsapp_message','connection_request')
               AND (x.status IN ('sent','opened','clicked','replied')
                    OR (x.status = 'cancelled' AND x.skip_reason ~ '^Enrollment became \S+ during execution$'))
           ) AS first_send_at
      FROM der d
      JOIN public.sequence_enrollments e
        ON e.organization_id = d.organization_id
       AND d.candidate_id IN (e.profile_id, e.provider_id, e.resolved_profile_id)
      LEFT JOIN public.outreach_sequences q ON q.id = e.sequence_id
      LEFT JOIN public.sequence_step_executions x ON x.enrollment_id = e.id
      LEFT JOIN public.sequence_steps ss ON ss.id = x.step_id
     WHERE d.project_id IS NOT NULL
       AND (q.project_id = d.project_id
            OR regexp_replace(coalesce(e.job_id, ''), '^project:', '') = d.project_id::text)
     GROUP BY d.id
  ),
  portal AS (
    -- Avis déposés par le portail client (client-portal-data : candidate_id = id de la ligne).
    SELECT d.id, min(ce.created_at) AS evaluated_at
      FROM der d
      JOIN public.candidate_evaluations ce
        ON ce.candidate_id = d.id::text
       AND ce.created_by = '00000000-0000-0000-0000-000000000000'::uuid
     GROUP BY d.id
  ),
  calc AS (
    SELECT d.*, e.enrolled_at, e.enr_replied_at, e.first_send_at, p.evaluated_at,
           (e.id IS NOT NULL) AS enrolled
      FROM der d
      LEFT JOIN enr e ON e.id = d.id
      LEFT JOIN portal p ON p.id = d.id
  )
  UPDATE public.job_candidate_status j SET
    general_stage = c.g,
    process_step_id = c.g_step,
    decision_source = CASE
      WHEN c.g = 'rejected' AND c.st = 'dismissed' THEN 'ai'          -- décision 3 : « écartés par l'IA, à confirmer »
      WHEN c.g = 'rejected' THEN 'user'
      WHEN c.g = 'to_sort' THEN CASE WHEN c.score IS NOT NULL THEN 'ai'
                                     WHEN c.st = 'untreated' THEN 'user'
                                     WHEN c.scoring_details IS NOT NULL THEN 'user' END   -- écart annulé
      WHEN c.g = 'replied' THEN 'system'
      WHEN c.g = 'interviewing' AND c.st = 'qualification' THEN 'system'
      ELSE 'user' END,
    stage_entered_at = CASE
      WHEN c.g = 'to_sort' THEN c.created_at
      WHEN c.g = 'contacted' THEN coalesce(c.first_send_at, c.enrolled_at, c.updated_at)
      WHEN c.g = 'replied' THEN coalesce(c.enr_replied_at, c.updated_at)
      ELSE c.updated_at END,
    -- Envoi et réponse de l'inscription : quelle que soit l'étape actuelle
    -- (une ligne revenue À trier garde son contact, comme sous le déclencheur).
    contacted_at = CASE
      WHEN c.first_send_at IS NOT NULL THEN c.first_send_at
      WHEN c.g IN ('contacted','replied','interviewing','hired') AND NOT c.enrolled AND c.exact THEN c.created_at END,
    replied_at = CASE
      WHEN c.enr_replied_at IS NOT NULL THEN c.enr_replied_at
      WHEN c.g IN ('replied','interviewing','hired') AND c.exact THEN c.created_at END,
    first_interview_at = CASE WHEN c.g IN ('interviewing','hired') AND c.exact THEN c.created_at END,
    presented_at = coalesce(c.evaluated_at, CASE WHEN c.g_presented AND c.exact THEN c.created_at END),
    hired_at = CASE WHEN c.g = 'hired' AND c.exact THEN c.created_at END,
    rejected_at = CASE WHEN c.g = 'rejected' AND c.exact THEN c.created_at END,
    rejected_from_stage = CASE WHEN c.g = 'rejected' THEN
      c_axis[greatest(array_position(c_axis, c.g_from),
                      CASE WHEN c.enr_replied_at IS NOT NULL THEN 4
                           WHEN c.first_send_at IS NOT NULL THEN 3 ELSE 1 END)] END
  FROM calc c
  WHERE j.id = c.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('konekt.stage_write', '', true);
  IF v_upd = 'O' THEN
    ALTER TABLE public.job_candidate_status ENABLE TRIGGER update_job_candidate_status_updated_at;
  END IF;
  IF v_ing = 'O' THEN
    ALTER TABLE public.job_candidate_status ENABLE TRIGGER trg_auto_ingest_job_candidate_status;
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.jcs_stage_backfill(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Reprise : seules les lignes sans étape (aucune sur une base neuve ni au
--    second passage). Ni status, ni pipeline_stage, ni project_id ne
--    changent : les compteurs ne bougent pas.
-- ---------------------------------------------------------------------
DO $lot0a_reprise$
DECLARE
  v_ids uuid[];
  v_n integer;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM public.job_candidate_status WHERE general_stage IS NULL;
  v_n := public.jcs_stage_backfill(v_ids);
  RAISE NOTICE 'Lot 0a : % ligne(s) reprise(s)', v_n;
END
$lot0a_reprise$;

ALTER TABLE public.job_candidate_status
  ALTER COLUMN general_stage SET DEFAULT 'to_sort',
  ALTER COLUMN general_stage SET NOT NULL,
  ALTER COLUMN stage_entered_at SET DEFAULT now(),
  ALTER COLUMN stage_entered_at SET NOT NULL;

-- ---------------------------------------------------------------------
-- 6. Statistiques. Clé du nouveau modèle : project_id + organisation de la
--    mission. Définitions sur status inchangées (celles de C1) jusqu'au
--    lot 0c, où elles passeront à general_stage en même temps que
--    get_project_stats et get_multiple_project_stats. L'arrêt d'urgence du
--    déclencheur de transition reste ainsi neutre pour les compteurs.
--    Le déclencheur par ligne trg_refresh_project_shortlist_stats
--    (20260504130000 : définition divergente, sans filtre d'organisation)
--    est retiré ; ses chiffres étaient déjà réécrits par sync_mission_stats_*.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_refresh_project_shortlist_stats ON public.job_candidate_status;
DROP FUNCTION IF EXISTS public.refresh_project_shortlist_stats();

CREATE OR REPLACE FUNCTION public.recompute_mission_stats(p_mission_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH missions AS (
    SELECT id, organization_id FROM public.sourcing_projects WHERE id = ANY (p_mission_ids)
  ), agg AS (
    SELECT m.id AS mission_id,
      count(j.id)::int AS total_found,
      count(j.id) FILTER (WHERE j.status = 'scored' OR j.score IS NOT NULL)::int AS scored,
      count(j.id) FILTER (WHERE j.status IN ('messaged','replied'))::int AS messaged,
      count(j.id) FILTER (WHERE j.status = 'dismissed')::int AS dismissed,
      count(j.id) FILTER (WHERE j.status = 'shortlisted')::int AS shortlisted
    FROM missions m
    LEFT JOIN public.job_candidate_status j
      ON j.project_id = m.id AND j.organization_id = m.organization_id
    GROUP BY m.id
  )
  UPDATE public.sourcing_projects sp SET
    stats_total_found = agg.total_found, stats_scored = agg.scored, stats_messaged = agg.messaged,
    stats_dismissed = agg.dismissed, stats_shortlisted = agg.shortlisted
  FROM agg
  WHERE sp.id = agg.mission_id
    -- pas d'écriture si rien ne change (ni updated_at, ni temps réel)
    AND (sp.stats_total_found, sp.stats_scored, sp.stats_messaged, sp.stats_dismissed, sp.stats_shortlisted)
        IS DISTINCT FROM (agg.total_found, agg.scored, agg.messaged, agg.dismissed, agg.shortlisted);
$function$;

-- Missions prises par project_id, ancien et nouveau. En UPDATE, recalcul
-- seulement si le statut, la présence d'une note, la mission ou
-- l'organisation change (la garde de recompute_mission_stats évite déjà
-- toute écriture inutile ; le filtre économise la requête d'agrégat).
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
       AND (n.status, n.score IS NULL, n.project_id, n.organization_id)
           IS DISTINCT FROM (o.status, o.score IS NULL, o.project_id, o.organization_id);
  END IF;
  IF v_ids IS NOT NULL THEN
    PERFORM public.recompute_mission_stats(v_ids);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_mission_stats_ins ON public.job_candidate_status;
CREATE TRIGGER sync_mission_stats_ins AFTER INSERT ON public.job_candidate_status
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_mission_stats();
DROP TRIGGER IF EXISTS sync_mission_stats_upd ON public.job_candidate_status;
CREATE TRIGGER sync_mission_stats_upd AFTER UPDATE ON public.job_candidate_status
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_mission_stats();
DROP TRIGGER IF EXISTS sync_mission_stats_del ON public.job_candidate_status;
CREATE TRIGGER sync_mission_stats_del AFTER DELETE ON public.job_candidate_status
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_mission_stats();

REVOKE ALL ON FUNCTION public.recompute_mission_stats(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_mission_stats(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.trg_sync_mission_stats() FROM PUBLIC, anon;

-- Recalcul complet : seules changent les missions où les rapprochements par
-- job_id et par project_id diffèrent (aucune en production le 28/09/2026).
SELECT public.recompute_mission_stats(coalesce(array_agg(id), '{}'::uuid[])) FROM public.sourcing_projects;

-- ---------------------------------------------------------------------
-- 7. set_candidate_stage : la seule façon de changer l'étape.
--    SECURITY INVOKER : la RLS de job_candidate_status dit qui touche quoi
--    (organisation active, mission de la même organisation). Hors
--    navigateur (clé de service, psql), p_organization_id est obligatoire
--    (règle C1 : toute écriture serveur filtre par organisation).
--    Origines : user (une personne), ai (ne marque qu'une ligne À trier),
--    system (événements : n'avancent que, jamais une ligne À trier ou
--    Retenu vers A répondu, jamais un écarté repris).
--    L'ancien couple (status, pipeline_stage) reste rempli pour les lecteurs
--    actuels et l'extension Chrome.
--    Erreurs : 22023 (paramètres, HINT STAGE_*), P0002 (STAGE_ROW_NOT_FOUND).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_candidate_stage(
  p_id uuid,
  p_stage text,
  p_source text,
  p_organization_id uuid DEFAULT NULL,
  p_process_step_id uuid DEFAULT NULL,
  p_legacy_stage text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_axis CONSTANT text[] := ARRAY['to_sort','retained','contacted','replied','interviewing','hired'];
  c_uuid CONSTANT text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  -- Rôle du jeton (inchangé sous une enveloppe SECURITY DEFINER) ; current_user en psql sans jeton.
  -- Aucune enveloppe DEFINER ne doit relayer p_source.
  v_browser boolean := coalesce(nullif(auth.role(), ''), current_user::text) = 'authenticated';
  v_allowed text[];
  r   public.job_candidate_status%ROWTYPE;
  cur record;
  w   record;
  v_result text := 'updated';
  v_stage text := p_stage;
  v_step uuid := p_process_step_id;
  v_cur_step uuid;
  v_changed boolean;
  v_keep boolean;
  v_status text; v_ps text; v_source text;
  v_entered timestamptz; v_contacted timestamptz; v_replied timestamptz; v_interview timestamptz;
  v_presented timestamptz; v_hired timestamptz; v_rejected timestamptz; v_from text;
BEGIN
  -- 1. Paramètres
  IF p_stage IS NULL OR NOT (p_stage = ANY (c_axis) OR p_stage = 'rejected') THEN
    RAISE EXCEPTION 'Étape inconnue : %', coalesce(p_stage, 'NULL') USING ERRCODE = '22023', HINT = 'STAGE_UNKNOWN';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('user','ai','system') THEN
    RAISE EXCEPTION 'Origine inconnue : %', coalesce(p_source, 'NULL') USING ERRCODE = '22023', HINT = 'STAGE_SOURCE_UNKNOWN';
  END IF;
  IF v_browser AND p_source <> 'user' THEN
    RAISE EXCEPTION 'Origine % réservée au serveur', p_source USING ERRCODE = '22023', HINT = 'STAGE_SOURCE_FORBIDDEN';
  END IF;
  IF NOT v_browser AND p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organisation obligatoire pour un appel serveur' USING ERRCODE = '22023', HINT = 'STAGE_ORG_REQUIRED';
  END IF;
  IF p_source = 'ai' AND p_stage <> 'to_sort' THEN
    RAISE EXCEPTION 'L''IA ne fait que noter et suggérer' USING ERRCODE = '22023', HINT = 'STAGE_AI_FORBIDDEN';
  END IF;
  IF p_source = 'system' AND p_stage NOT IN ('contacted','replied','interviewing') THEN
    RAISE EXCEPTION 'Événement sans étape correspondante' USING ERRCODE = '22023', HINT = 'STAGE_SYSTEM_FORBIDDEN';
  END IF;
  IF p_process_step_id IS NOT NULL AND p_stage <> 'interviewing' THEN
    RAISE EXCEPTION 'Étape d''entretien hors entretien' USING ERRCODE = '22023', HINT = 'STAGE_STEP_WITHOUT_INTERVIEW';
  END IF;
  v_allowed := CASE p_stage
    WHEN 'to_sort'      THEN ARRAY['Nouveau','sourced','untreated']
    WHEN 'retained'     THEN ARRAY['Pressenti','shortlisted']
    WHEN 'contacted'    THEN ARRAY['Contacté','messaged']
    WHEN 'replied'      THEN ARRAY['Répondu']
    WHEN 'interviewing' THEN ARRAY['Pré-qualif','ITW en cours','Offre','CV envoyé']
    WHEN 'hired'        THEN ARRAY['hired','Gagné']
    ELSE                     ARRAY['Perdu','dismissed'] END;
  IF p_legacy_stage IS NOT NULL
     AND (p_source <> 'user' OR p_process_step_id IS NOT NULL OR NOT (p_legacy_stage = ANY (v_allowed))) THEN
    RAISE EXCEPTION 'Libellé hérité % incompatible avec %', p_legacy_stage, p_stage
      USING ERRCODE = '22023', HINT = 'STAGE_LEGACY_MISMATCH';
  END IF;

  -- 2. Ligne verrouillée sous la RLS de l'appelant ; organisation imposée au serveur (règle C1).
  SELECT * INTO r FROM public.job_candidate_status WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (p_organization_id IS NOT NULL AND r.organization_id IS DISTINCT FROM p_organization_id) THEN
    RAISE EXCEPTION 'Ligne candidat introuvable' USING ERRCODE = 'P0002', HINT = 'STAGE_ROW_NOT_FOUND';
  END IF;

  -- 3. Étape d'entretien. SKIP LOCKED : une étape en cours de suppression est refusée sans attente.
  --    Un libellé du /pipeline (« Offre », « CV envoyé »...) dispense de l'étape : le /pipeline
  --    ne connaît pas les étapes de mission.
  IF p_process_step_id IS NOT NULL THEN
    PERFORM 1 FROM public.mission_process_steps s
      WHERE s.id = p_process_step_id AND s.project_id = r.project_id
        AND s.organization_id = r.organization_id
      FOR KEY SHARE SKIP LOCKED;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Étape d''une autre mission' USING ERRCODE = '22023', HINT = 'STAGE_STEP_NOT_IN_MISSION';
    END IF;
  ELSIF p_stage = 'interviewing' AND p_source = 'user' AND p_legacy_stage IS NULL
        AND r.project_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.mission_process_steps s
                     WHERE s.project_id = r.project_id AND s.organization_id = r.organization_id) THEN
    RAISE EXCEPTION 'Choisissez l''étape d''entretien' USING ERRCODE = '22023', HINT = 'STAGE_STEP_REQUIRED';
  END IF;

  -- 4. Événements : n'avancent que ; jamais À trier / Retenu vers A répondu ; jamais un écarté repris.
  --    IA : ne touche qu'une ligne À trier.
  IF p_source = 'system' THEN
    IF p_stage = 'replied' AND r.general_stage IN ('to_sort','retained') THEN
      v_result := 'not_contacted';
    ELSIF r.general_stage = 'rejected'
       OR array_position(c_axis, p_stage) <= array_position(c_axis, r.general_stage) THEN
      v_result := 'kept';
    END IF;
  ELSIF p_source = 'ai' AND r.general_stage <> 'to_sort' THEN
    v_result := 'kept';
  END IF;

  IF v_result <> 'updated' THEN
    -- Ni l'étape ni le couple hérité ne bougent ; seule la date de réponse d'une ligne déjà contactée.
    IF p_source = 'system' AND p_stage = 'replied' AND r.contacted_at IS NOT NULL AND r.replied_at IS NULL THEN
      PERFORM set_config('konekt.stage_write', r.id::text, true);
      UPDATE public.job_candidate_status SET replied_at = now() WHERE id = r.id;
      PERFORM set_config('konekt.stage_write', '', true);
      RETURN jsonb_build_object('id', r.id, 'changed', true, 'result', v_result,
        'general_stage', r.general_stage, 'process_step_id', r.process_step_id,
        'stage_entered_at', r.stage_entered_at, 'decision_source', r.decision_source);
    END IF;
    RETURN jsonb_build_object('id', r.id, 'changed', false, 'result', v_result,
      'general_stage', r.general_stage, 'process_step_id', r.process_step_id,
      'stage_entered_at', r.stage_entered_at, 'decision_source', r.decision_source);
  END IF;

  -- 5. Date, origine, jalons
  v_changed := v_stage IS DISTINCT FROM r.general_stage;
  v_source := CASE WHEN v_changed THEN p_source
                   WHEN p_source = 'user' THEN 'user'                      -- une personne confirme
                   ELSE coalesce(r.decision_source, p_source) END;         -- l'IA ne marque qu'une ligne sans origine
  v_entered := CASE WHEN v_changed OR (v_step IS NOT NULL AND v_step IS DISTINCT FROM r.process_step_id)
                    THEN now() ELSE r.stage_entered_at END;
  v_contacted := CASE WHEN v_changed AND v_stage IN ('contacted','replied','interviewing','hired')
                      THEN coalesce(r.contacted_at, now()) ELSE r.contacted_at END;
  v_replied := CASE WHEN v_changed AND v_stage IN ('replied','interviewing','hired')
                    THEN coalesce(r.replied_at, now()) ELSE r.replied_at END;
  v_interview := CASE WHEN v_changed AND v_stage IN ('interviewing','hired')
                      THEN coalesce(r.first_interview_at, now()) ELSE r.first_interview_at END;
  v_hired := CASE WHEN v_changed AND v_stage = 'hired' THEN coalesce(r.hired_at, now()) ELSE r.hired_at END;
  v_rejected := CASE WHEN v_changed AND v_stage = 'rejected' THEN now() ELSE r.rejected_at END;
  v_from := CASE WHEN v_changed AND v_stage = 'rejected' THEN r.general_stage ELSE r.rejected_from_stage END;

  -- 6. Couple de compatibilité : gardé s'il dit déjà la même chose avec un libellé acceptable.
  IF r.project_id IS NOT NULL AND lower(btrim(coalesce(r.pipeline_stage, ''))) ~ c_uuid THEN
    SELECT s.id INTO v_cur_step FROM public.mission_process_steps s
     WHERE s.id = lower(btrim(r.pipeline_stage))::uuid
       AND s.project_id = r.project_id AND s.organization_id = r.organization_id;
  END IF;
  SELECT * INTO cur FROM public.candidate_stage_from_legacy(r.status, r.pipeline_stage, v_cur_step);
  v_keep := cur.general_stage = v_stage
        AND cur.process_step_id IS NOT DISTINCT FROM v_step
        AND (r.pipeline_stage IS NULL
             OR (v_step IS NULL AND r.pipeline_stage = ANY (v_allowed))
             OR (v_step IS NOT NULL AND lower(btrim(r.pipeline_stage)) = v_step::text))
        AND (p_legacy_stage IS NULL OR r.pipeline_stage = p_legacy_stage);
  IF v_keep THEN
    v_status := r.status; v_ps := r.pipeline_stage;
  ELSE
    v_status := CASE v_stage
      WHEN 'to_sort'   THEN CASE WHEN r.score IS NOT NULL THEN 'scored' ELSE 'discovered' END
      WHEN 'retained'  THEN 'shortlisted'
      WHEN 'contacted' THEN 'messaged'
      WHEN 'replied'   THEN 'replied'
      WHEN 'rejected'  THEN 'dismissed'
      ELSE 'shortlisted' END;                                   -- interviewing, hired
    v_ps := CASE
      WHEN v_step IS NOT NULL THEN v_step::text                  -- l'étape d'entretien EST pipeline_stage
      WHEN p_legacy_stage IS NOT NULL THEN p_legacy_stage
      WHEN v_stage = 'replied' THEN 'Répondu'
      WHEN v_stage = 'interviewing' THEN 'ITW en cours'
      WHEN v_stage = 'hired' THEN 'hired' END;
    -- Filet : même règle que le déclencheur (étape retenue seulement si pipeline_stage est son identifiant).
    SELECT * INTO w FROM public.candidate_stage_from_legacy(v_status, v_ps, v_step);
    IF w.general_stage IS DISTINCT FROM v_stage OR w.process_step_id IS DISTINCT FROM v_step THEN
      RAISE EXCEPTION 'Correspondance incohérente : % / % pour %', v_status, v_ps, v_stage
        USING ERRCODE = 'XX000', HINT = 'STAGE_LEGACY_MISMATCH';
    END IF;
  END IF;
  v_presented := CASE WHEN v_ps IS DISTINCT FROM r.pipeline_stage AND v_ps = 'CV envoyé'
                      THEN coalesce(r.presented_at, now()) ELSE r.presented_at END;

  -- 7. Rien ne change : aucune écriture (ni updated_at, ni statistiques, ni appel HTTP).
  IF NOT v_changed AND v_step IS NOT DISTINCT FROM r.process_step_id
     AND v_source IS NOT DISTINCT FROM r.decision_source
     AND v_status IS NOT DISTINCT FROM r.status AND v_ps IS NOT DISTINCT FROM r.pipeline_stage THEN
    RETURN jsonb_build_object('id', r.id, 'changed', false, 'result', 'unchanged',
      'general_stage', r.general_stage, 'process_step_id', r.process_step_id,
      'stage_entered_at', r.stage_entered_at, 'decision_source', r.decision_source);
  END IF;

  -- 8. Une seule écriture ; le drapeau fait traverser stage_sync_from_legacy.
  PERFORM set_config('konekt.stage_write', r.id::text, true);
  UPDATE public.job_candidate_status SET
    general_stage = v_stage, process_step_id = v_step, stage_entered_at = v_entered,
    decision_source = v_source, contacted_at = v_contacted, replied_at = v_replied,
    first_interview_at = v_interview, presented_at = v_presented, hired_at = v_hired,
    rejected_at = v_rejected, rejected_from_stage = v_from,
    status = v_status, pipeline_stage = v_ps
  WHERE id = r.id;
  PERFORM set_config('konekt.stage_write', '', true);

  RETURN jsonb_build_object('id', r.id, 'changed', true, 'result', 'updated',
    'general_stage', v_stage, 'process_step_id', v_step,
    'stage_entered_at', v_entered, 'decision_source', v_source);
END;
$$;
REVOKE ALL ON FUNCTION public.set_candidate_stage(uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_candidate_stage(uuid, text, text, uuid, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. replace_process_steps : corps de 20260906084418 (dernière version),
--    plus le drapeau konekt.stage_remap. Pendant le DELETE des étapes, le
--    SET NULL de la clé étrangère vide process_step_id (admis par le
--    déclencheur : l'étape n'existe plus) ; la réaffectation de
--    pipeline_stage repasse par le déclencheur en mode stage_remap :
--    process_step_id prend la nouvelle étape, stage_entered_at, l'origine et
--    les jalons restent. Une ligne écartée qui portait l'ancien identifiant
--    reste écartée.
-- ---------------------------------------------------------------------
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

  -- Lot 0a : pendant le remplacement, stage_sync_from_legacy fait suivre l'étape
  -- d'entretien (process_step_id) sans toucher à la date d'entrée ni aux jalons.
  PERFORM set_config('konekt.stage_remap', p_project_id::text, true);

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

  PERFORM set_config('konekt.stage_remap', '', true);
  RETURN v_remapped;
END;
$$;
COMMENT ON FUNCTION public.replace_process_steps(uuid, jsonb) IS
  'Remplace atomiquement les étapes du process d''une mission et remappe job_candidate_status.pipeline_stage (ancien step.id vers l''étape de même nom, sinon la première). Lot 0a : process_step_id suit, stage_entered_at et les jalons sont conservés. Retourne le nombre de candidats repositionnés. Réservé aux membres de l''organisation du projet.';
REVOKE ALL ON FUNCTION public.replace_process_steps(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_process_steps(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. L'assistant ne change une étape qu'avec un clic (conception 3.3) :
--    les trois outils qui écrivent l'étape ne sont jamais automatiques
--    (NEVER_AUTO_TOOLS de _shared/agent-tools.ts ; ici, les données).
-- ---------------------------------------------------------------------
UPDATE public.agent_tool_policies SET policy = 'approve'
 WHERE tool_name IN ('update_candidate_stage','add_to_shortlist','bulk_update_stage') AND policy = 'auto';

-- ---------------------------------------------------------------------
-- 10. Commentaires.
-- ---------------------------------------------------------------------
COMMENT ON COLUMN public.job_candidate_status.general_stage IS
  'Étape générale, commune à toutes les missions : to_sort, retained, contacted, replied, interviewing, hired, rejected. S''écrit par set_candidate_stage ; pendant la transition (lot 0a), dérivée de status et pipeline_stage, qui restent des colonnes de compatibilité.';
COMMENT ON COLUMN public.job_candidate_status.process_step_id IS
  'Étape d''entretien de la mission (mission_process_steps), seulement quand general_stage vaut interviewing. Quand elle est renseignée, elle vaut pipeline_stage. Vidée par la suppression de l''étape (ON DELETE SET NULL).';
COMMENT ON COLUMN public.job_candidate_status.stage_entered_at IS
  'Entrée dans l''étape générale ou d''entretien (« depuis N j »). Approchée pour les lignes reprises par le lot 0a (created_at, premier envoi, réponse ou updated_at du jour de la migration).';
COMMENT ON COLUMN public.job_candidate_status.decision_source IS
  'Qui a placé la ligne dans son étape : ai, user ou system (événement). NULL : aucune décision. Décision 3 : les écarts repris par le lot 0a depuis status = dismissed sont ai, « écartés par l''IA, à confirmer ».';
COMMENT ON COLUMN public.job_candidate_status.contacted_at IS
  'Premier contact. Posé une seule fois, sur une date vraie ; NULL pour une ligne reprise sans date exacte.';
COMMENT ON COLUMN public.job_candidate_status.replied_at IS
  'Première réponse. Posée une seule fois, sur une date vraie ; NULL pour une ligne reprise sans date exacte.';
COMMENT ON COLUMN public.job_candidate_status.first_interview_at IS
  'Entrée en entretien (lue par le Bilan). Posée une seule fois ; NULL pour une ligne reprise sans date exacte.';
COMMENT ON COLUMN public.job_candidate_status.presented_at IS
  'Présentation au client (jalon, pas une étape). Posée une seule fois ; NULL pour une ligne reprise sans date exacte.';
COMMENT ON COLUMN public.job_candidate_status.hired_at IS
  'Embauche. Posée une seule fois ; NULL pour une ligne reprise sans date exacte.';
COMMENT ON COLUMN public.job_candidate_status.rejected_at IS
  'Date du dernier écart ; NULL pour une ligne reprise sans date exacte.';
COMMENT ON COLUMN public.job_candidate_status.rejected_from_stage IS
  'Étape générale quittée au dernier écart.';
COMMENT ON COLUMN public.job_candidate_status.reply_summary IS
  'Résumé d''analyse d''une réponse du candidat, écrit à partir du lot 0b à la place de recommendation.';
COMMENT ON FUNCTION public.candidate_stage_from_legacy(text, text, uuid) IS
  'Lot 0a : étape générale, étape d''entretien, étape quittée (écart) et jalon de présentation dérivés de l''ancien couple (status, pipeline_stage). p_step_id n''est rendue que si pipeline_stage est son identifiant. Fonction pure, sans erreur possible.';
COMMENT ON FUNCTION public.jcs_stage_sync_from_legacy() IS
  'Lot 0a, déclencheur de transition stage_sync_from_legacy : dérive les colonnes du modèle de l''ancien couple tant que les écrivains l''écrivent ; ignore les écritures directes de ces colonnes. Arrêt d''urgence neutre : DROP TRIGGER stage_sync_from_legacy ON public.job_candidate_status.';
COMMENT ON FUNCTION public.jcs_stage_backfill(uuid[]) IS
  'Lot 0a : reprise des colonnes du modèle pour les lignes données (jalons datés seulement sur une date exacte). Coupe et rétablit les déclencheurs d''updated_at et d''indexation. Réservée au propriétaire de la table.';
COMMENT ON FUNCTION public.set_candidate_stage(uuid, text, text, uuid, uuid, text) IS
  'Lot 0a : la seule façon de changer l''étape d''un candidat. SECURITY INVOKER (RLS de l''appelant) ; p_organization_id obligatoire hors navigateur. Origines user, ai (ne marque qu''une ligne À trier), system (événements : n''avancent que). Garde status et pipeline_stage remplis pour les lecteurs actuels.';
