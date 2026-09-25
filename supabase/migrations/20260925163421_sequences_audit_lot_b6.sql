-- =====================================================================
-- Séquences, audit du 2026-09-25, lot B6 : données, contraintes, RLS.
--
-- Deux états de départ, traités tous les deux :
--   prod (créée depuis MIGRATION_CLEAN.sql) : policies génériques
--     org_members_all / service_role_all / mission_team_select, plus celles
--     posées ensuite par 20260507150000 ; aucun CHECK de statut ; aucun index
--     de 20260410130000 ; sequence_analytics.date en timestamptz.
--   base neuve (migrations, CI e2e) : policies d'origine Lovable
--     (« Org members can ... », sequence_templates_*, « Users can delete their
--     enrollments »...), CHECK de statut présents, index présents.
-- Rejouable : chaque bloc est gardé (IF [NOT] EXISTS, to_regclass, contrôle du
-- type de colonne) ; les données ne sont modifiées que si elles sont fausses.
--
-- 0. Inventaire (NOTICE) des lignes incohérentes, avant toute réparation.
-- 1. Données
--   1a. SEQ-003  Exécutions « annulées » alors que le message était parti
--                (BUG-095, skip_reason « Enrollment became X during execution ») :
--                passées 'sent', pour qu'aucune reprise ne les renvoie. Les
--                lignes « before send (last-call check) », jamais parties, restent.
--   1b. SEQ-121  Pauses sans raison : 'manual'. Une réactivation de séquence
--                ne les reprend donc pas ; « Reprendre » reste possible.
--   1c. SEQ-013  assigned_sender_id passe de uuid à text (identifiant du compte
--                d'envoi). Toute valeur actuelle est un user_id hérité de
--                BUG-023, jamais un compte : remise à NULL avant le changement.
--                Les inscriptions déjà engagées d'une séquence en rotation
--                (hors tirage aléatoire) sont figées sur le premier compte du
--                groupe, celui dont l'ancien moteur partait toujours.
--   1d. SEQ-009 / SEQ-056  Organisation des étapes alignée sur la séquence,
--                des inscriptions sans organisation sur la séquence, des
--                exécutions sur l'inscription. Aucune suppression (la cascade
--                effacerait l'historique d'envoi). Les exécutions EN ATTENTE
--                dont l'étape appartient à une autre séquence sont annulées.
--   1e. SEQ-057  Statistiques sans organisation rattachées à leur séquence.
--   1f. SEQ-058  Modèles is_system publiés par une organisation neutralisés,
--                sauf les quatre modèles d'origine (scripts/seed-sequence-data.sql,
--                la plus ancienne ligne de chaque nom).
-- 2. Contraintes
--   2a. SEQ-002 / SEQ-121  pause_reason : ajout de sequence_inactive,
--                auto_paused, send_failed, blocked_by_candidate.
--   2b. SEQ-215  CHECK de statut de la base neuve posés en prod (NOT VALID,
--                puis validation tentée : un refus laisse un avertissement, pas
--                un échec de déploiement). DEFAULT 'scheduled' sur le statut
--                des exécutions (la prod avait 'pending', ignoré du moteur).
-- 3. Déclencheurs
--   3a. SEQ-009  sequence_steps : organization_id toujours recopiée de la
--                séquence. La WITH CHECK voit donc l'organisation réelle : une
--                étape glissée dans la séquence d'une autre organisation est refusée.
--   3b. SEQ-056  sequence_enrollments : organisation reprise de la séquence si
--                absente, refus si elle diffère.
--   3c. SEQ-056  sequence_step_executions : organisation recopiée de
--                l'inscription, refus si l'étape n'est pas de la séquence de
--                l'inscription.
--   3d. SEQ-056  outreach_sequences : refus d'une mission d'une autre
--                organisation, sauf pour un membre de l'équipe de cette mission
--                (partenaire qui crée sa séquence dans sa propre organisation).
--   3e. SEQ-214  sequence_step_executions, écritures d'un utilisateur connecté
--                (le moteur et les webhooks ne sont pas concernés) : candidat,
--                étape, organisation, canal et suivi non modifiables ; rien ne
--                change sur une étape en cours d'envoi, envoyée ou sautée ; le
--                texte ne change que sur une étape encore programmée.
-- 4. Fonctions
--   4a. SEQ-057  increment_sequence_analytics pose organization_id (et ne
--                laisse plus un compteur NULL en prod, colonnes sans défaut).
--   4b. SEQ-059  save_sequence_steps refuse de supprimer une étape qui a un
--                historique (HINT STEP_HAS_HISTORY) ; les exécutions en attente
--                des étapes retirées disparaissent avec elles (rien n'était parti).
--   4c. SEQ-165  get_sequence_enrollment_counts : compteurs par séquence et
--                statut, calculés en base (plus de liste tronquée à 1 000 lignes).
--   4d. SEQ-119  is_active_org_collaborator : rôle collaborateur dans
--                l'organisation active, pour les policies.
-- 5. Policies (SEQ-009, 011, 056, 057, 058, 119, 216) : sur les dix tables du
--    module, toutes les policies sont retirées quel que soit leur nom (règle 7
--    de CLAUDE.md) puis un seul jeu est recréé, aux noms de la prod. Contrôle
--    final qui fait échouer la migration si l'état n'est pas le bon.
--    Collaborateur (décision produit : moindre privilège) : lit ses propres
--    séquences, celles des missions de son équipe et leurs candidats ; ne
--    modifie que les inscriptions qu'il a créées et leurs étapes.
--    inmail_queue : lecture dans l'organisation, et seule écriture permise le
--    suivi d'un message déjà envoyé (status 'sent') ; tout le reste passe par
--    le serveur.
-- 6. SEQ-117  Index du moteur absents en prod, et deux index partiels des
--    rattrapages (étapes bloquées, inscriptions sans étape en attente).
-- 7. SEQ-075  Crons décalés : plus aucun contrôle à la même minute que l'envoi
--    (le verrou unique faisait sauter l'un des deux).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Inventaire
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n_steps int;
  n_enr_null int;
  n_enr_div int;
  n_exec_div int;
  n_exec_cross int;
  n_seq_proj int;
BEGIN
  SELECT count(*) INTO n_steps
  FROM public.sequence_steps st
  JOIN public.outreach_sequences s ON s.id = st.sequence_id
  WHERE st.organization_id IS DISTINCT FROM s.organization_id;

  SELECT count(*) FILTER (WHERE e.organization_id IS NULL),
         count(*) FILTER (WHERE e.organization_id IS NOT NULL
                            AND e.organization_id IS DISTINCT FROM s.organization_id)
    INTO n_enr_null, n_enr_div
  FROM public.sequence_enrollments e
  JOIN public.outreach_sequences s ON s.id = e.sequence_id;

  SELECT count(*) INTO n_exec_div
  FROM public.sequence_step_executions x
  JOIN public.sequence_enrollments e ON e.id = x.enrollment_id
  WHERE x.organization_id IS DISTINCT FROM e.organization_id;

  SELECT count(*) INTO n_exec_cross
  FROM public.sequence_step_executions x
  JOIN public.sequence_enrollments e ON e.id = x.enrollment_id
  JOIN public.sequence_steps st ON st.id = x.step_id
  WHERE st.sequence_id <> e.sequence_id;

  SELECT count(*) INTO n_seq_proj
  FROM public.outreach_sequences s
  JOIN public.sourcing_projects p ON p.id = s.project_id
  WHERE p.organization_id IS DISTINCT FROM s.organization_id;

  RAISE NOTICE 'Séquences, inventaire avant réparation : étapes d''une autre organisation que leur séquence = %, inscriptions sans organisation = %, inscriptions d''une autre organisation que leur séquence = % (laissées en place, refusées à l''envoi par le moteur), exécutions d''une autre organisation que leur inscription = %, exécutions dont l''étape est d''une autre séquence = %, séquences rattachées à la mission d''une autre organisation = % (partenaires)',
    n_steps, n_enr_null, n_enr_div, n_exec_div, n_exec_cross, n_seq_proj;
END $$;

-- ---------------------------------------------------------------------
-- 1a. SEQ-003 : message parti, ligne marquée annulée (BUG-095)
-- ---------------------------------------------------------------------
UPDATE public.sequence_step_executions
SET status = 'sent',
    executed_at = COALESCE(executed_at, updated_at)
WHERE status = 'cancelled'
  AND skip_reason LIKE 'Enrollment became % during execution';

-- ---------------------------------------------------------------------
-- 1b. SEQ-121 : jamais de pause sans raison
-- ---------------------------------------------------------------------
UPDATE public.sequence_enrollments
SET pause_reason = 'manual'
WHERE status = 'paused'
  AND pause_reason IS NULL;

-- ---------------------------------------------------------------------
-- 1c. SEQ-013 : assigned_sender_id en text
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sequence_enrollments'
      AND column_name = 'assigned_sender_id'
      AND data_type = 'uuid'
  ) THEN
    UPDATE public.sequence_enrollments
    SET assigned_sender_id = NULL
    WHERE assigned_sender_id IS NOT NULL;

    ALTER TABLE public.sequence_enrollments
      ALTER COLUMN assigned_sender_id TYPE text USING assigned_sender_id::text;

    -- Inscriptions déjà engagées dans une séquence en rotation (hors tirage
    -- aléatoire) : faute de pouvoir enregistrer le compte, l'ancien moteur
    -- comptait zéro envoi partout et partait toujours du premier compte du
    -- groupe. On le fige, pour que la suite de la conversation parte du même
    -- compte au lieu d'un nouveau tirage.
    UPDATE public.sequence_enrollments e
    SET assigned_sender_id = s.sender_accounts->0->>'account_id'
    FROM public.outreach_sequences s
    WHERE s.id = e.sequence_id
      AND s.multi_sender_enabled IS TRUE
      AND jsonb_typeof(s.sender_accounts) = 'array'
      AND jsonb_array_length(s.sender_accounts) > 0
      AND NULLIF(s.sender_accounts->0->>'account_id', '') IS NOT NULL
      AND COALESCE(s.rotation_mode, 'round_robin') <> 'random'
      AND e.status IN ('active', 'paused')
      AND EXISTS (
        SELECT 1 FROM public.sequence_step_executions x
        WHERE x.enrollment_id = e.id
          AND x.status IN ('sent', 'opened', 'clicked', 'replied')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.sequence_enrollments.assigned_sender_id IS
  'Compte d''envoi figé par la rotation multi-expéditeurs (même identifiant que account_id). NULL tant qu''aucun compte de rotation n''a été attribué.';

-- ---------------------------------------------------------------------
-- 1d. SEQ-009 / SEQ-056 : organisation recopiée du parent
-- ---------------------------------------------------------------------
UPDATE public.sequence_steps st
SET organization_id = s.organization_id
FROM public.outreach_sequences s
WHERE s.id = st.sequence_id
  AND st.organization_id IS DISTINCT FROM s.organization_id;

UPDATE public.sequence_enrollments e
SET organization_id = s.organization_id
FROM public.outreach_sequences s
WHERE s.id = e.sequence_id
  AND e.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

UPDATE public.sequence_step_executions x
SET organization_id = e.organization_id
FROM public.sequence_enrollments e
WHERE e.id = x.enrollment_id
  AND x.organization_id IS DISTINCT FROM e.organization_id;

UPDATE public.sequence_step_executions x
SET status = 'cancelled',
    skip_reason = 'Étape d''une autre séquence : annulée'
FROM public.sequence_enrollments e, public.sequence_steps st
WHERE e.id = x.enrollment_id
  AND st.id = x.step_id
  AND st.sequence_id <> e.sequence_id
  AND x.status IN ('scheduled', 'waiting_event', 'quota_blocked');

-- ---------------------------------------------------------------------
-- 1e. SEQ-057 : statistiques rattachées à l'organisation de la séquence
-- ---------------------------------------------------------------------
UPDATE public.sequence_analytics a
SET organization_id = s.organization_id
FROM public.outreach_sequences s
WHERE s.id = a.sequence_id
  AND a.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 1f. SEQ-058 : modèles « système » publiés par une organisation
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  WITH seeds AS (
    SELECT DISTINCT ON (t.name) t.id
    FROM public.sequence_templates t
    WHERE t.is_system = true
      AND t.name IN (
        'Sourcing LinkedIn — 3 étapes',
        'Multicanal LinkedIn + Email — 5 étapes',
        'Nurturing — Garder le contact',
        'Réactivation — Candidats dormants'
      )
    ORDER BY t.name, t.created_at ASC, t.id ASC
  )
  UPDATE public.sequence_templates t
  SET is_system = false
  WHERE t.is_system = true
    AND t.organization_id IS NOT NULL
    AND t.id NOT IN (SELECT id FROM seeds);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'sequence_templates : % modèle(s) « système » publiés par une organisation repassés en modèles d''organisation', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2a. SEQ-002 / SEQ-121 : raisons de pause
-- ---------------------------------------------------------------------
ALTER TABLE public.sequence_enrollments
  DROP CONSTRAINT IF EXISTS sequence_enrollments_pause_reason_check;
ALTER TABLE public.sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_pause_reason_check
  CHECK (pause_reason IS NULL OR pause_reason IN (
    'manual',
    'account_disconnected',
    'quota_reached',
    'subscription_required',
    'sequence_inactive',
    'auto_paused',
    'send_failed',
    'blocked_by_candidate'
  ));

COMMENT ON COLUMN public.sequence_enrollments.pause_reason IS
  'Raison de la mise en pause : manual | account_disconnected | quota_reached | subscription_required | sequence_inactive (séquence désactivée) | auto_paused (trop d''échecs) | send_failed | blocked_by_candidate. La réactivation d''une séquence ne reprend que sequence_inactive et auto_paused.';

-- ---------------------------------------------------------------------
-- 2b. SEQ-215 : CHECK de statut (listes de la base neuve)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('sequence_step_executions', 'sequence_step_executions_status_check',
       $c$status IN ('scheduled', 'skipped', 'sending', 'sent', 'failed', 'cancelled', 'waiting_event', 'quota_blocked', 'opened', 'clicked', 'replied', 'bounced')$c$),
      ('sequence_step_executions', 'sequence_step_executions_channel_check',
       $c$channel IN ('email', 'linkedin', 'call', 'manual', 'whatsapp')$c$),
      ('sequence_enrollments', 'sequence_enrollments_status_check',
       $c$status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'cancelled', 'stopped')$c$),
      ('sequence_enrollments', 'sequence_enrollments_label_check',
       $c$label IN ('interested', 'not_interested')$c$),
      ('inmail_queue', 'inmail_queue_status_check',
       $c$status IN ('pending', 'scheduled', 'sending', 'sent', 'failed', 'cancelled', 'replied')$c$),
      ('sequence_steps', 'sequence_steps_step_channel_check',
       $c$step_channel IN ('email', 'linkedin', 'call', 'manual', 'whatsapp')$c$),
      ('sequence_steps', 'sequence_steps_condition_type_check',
       $c$condition_type IN ('always', 'if_connected', 'if_not_connected', 'if_no_response', 'if_email_opened', 'if_email_not_opened', 'if_link_clicked', 'if_link_not_clicked', 'if_has_email', 'if_no_email', 'if_has_phone', 'if_no_phone', 'if_unsubscribed', 'if_bounced', 'if_score_above')$c$),
      ('outreach_sequences', 'outreach_sequences_rotation_mode_check',
       $c$rotation_mode IN ('round_robin', 'random', 'least_used')$c$)
    ) AS v(tbl, conname, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', c.tbl)::regclass
        AND conname = c.conname
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.conname, c.expr);
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', c.tbl, c.conname);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '% : des lignes existantes sortent de la liste, contrainte % laissée NOT VALID (les nouvelles écritures sont contrôlées)', c.tbl, c.conname;
      END;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.sequence_step_executions ALTER COLUMN status SET DEFAULT 'scheduled';

-- ---------------------------------------------------------------------
-- 3a. SEQ-009 : organisation d'une étape = celle de sa séquence
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_steps_sync_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT s.organization_id INTO NEW.organization_id
  FROM public.outreach_sequences s
  WHERE s.id = NEW.sequence_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_steps_sync_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_steps_sync_org ON public.sequence_steps;
CREATE TRIGGER sequence_steps_sync_org
  BEFORE INSERT OR UPDATE OF sequence_id, organization_id ON public.sequence_steps
  FOR EACH ROW EXECUTE FUNCTION public.sequence_steps_sync_org();

-- ---------------------------------------------------------------------
-- 3b. SEQ-056 : une inscription est de l'organisation de sa séquence
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_enrollments_check_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq_org uuid;
BEGIN
  SELECT s.organization_id INTO v_seq_org
  FROM public.outreach_sequences s
  WHERE s.id = NEW.sequence_id;
  IF NOT FOUND THEN
    RETURN NEW; -- la clé étrangère refuse la ligne
  END IF;

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_seq_org;
  ELSIF NEW.organization_id IS DISTINCT FROM v_seq_org THEN
    RAISE EXCEPTION 'Cette séquence appartient à une autre organisation'
      USING ERRCODE = '42501', HINT = 'SEQUENCE_ORG_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_enrollments_check_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_enrollments_check_org ON public.sequence_enrollments;
CREATE TRIGGER sequence_enrollments_check_org
  BEFORE INSERT OR UPDATE OF sequence_id, organization_id ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sequence_enrollments_check_org();

-- ---------------------------------------------------------------------
-- 3c. SEQ-056 : une exécution suit son inscription
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_step_executions_check_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enr_org uuid;
  v_enr_seq uuid;
  v_step_seq uuid;
BEGIN
  SELECT e.organization_id, e.sequence_id INTO v_enr_org, v_enr_seq
  FROM public.sequence_enrollments e
  WHERE e.id = NEW.enrollment_id;
  IF NOT FOUND THEN
    RETURN NEW; -- la clé étrangère refuse la ligne
  END IF;

  SELECT st.sequence_id INTO v_step_seq
  FROM public.sequence_steps st
  WHERE st.id = NEW.step_id;
  IF FOUND AND v_step_seq IS DISTINCT FROM v_enr_seq THEN
    RAISE EXCEPTION 'Cette étape n''appartient pas à la séquence du candidat'
      USING ERRCODE = '23514', HINT = 'STEP_SEQUENCE_MISMATCH';
  END IF;

  NEW.organization_id := v_enr_org;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_step_executions_check_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_step_executions_check_org ON public.sequence_step_executions;
CREATE TRIGGER sequence_step_executions_check_org
  BEFORE INSERT OR UPDATE OF enrollment_id, step_id, organization_id ON public.sequence_step_executions
  FOR EACH ROW EXECUTE FUNCTION public.sequence_step_executions_check_org();

-- ---------------------------------------------------------------------
-- 3d. SEQ-056 : mission d'une autre organisation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_sequences_check_project_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proj_org uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.organization_id INTO v_proj_org
  FROM public.sourcing_projects p
  WHERE p.id = NEW.project_id;
  IF NOT FOUND OR v_proj_org IS NOT DISTINCT FROM NEW.organization_id THEN
    RETURN NEW;
  END IF;
  -- Un partenaire membre de l'équipe de la mission y rattache sa propre
  -- séquence (dans son organisation). Les chemins serveur (sans utilisateur)
  -- vérifient la mission eux-mêmes.
  IF auth.uid() IS NOT NULL
     AND NOT public.is_mission_team_member_for_project(auth.uid(), NEW.project_id) THEN
    RAISE EXCEPTION 'Cette mission appartient à une autre organisation'
      USING ERRCODE = '42501', HINT = 'PROJECT_ORG_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.outreach_sequences_check_project_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS outreach_sequences_check_project_org ON public.outreach_sequences;
CREATE TRIGGER outreach_sequences_check_project_org
  BEFORE INSERT OR UPDATE OF project_id, organization_id ON public.outreach_sequences
  FOR EACH ROW EXECUTE FUNCTION public.outreach_sequences_check_project_org();

-- ---------------------------------------------------------------------
-- 3e. SEQ-214 : bornes des écritures du navigateur sur les exécutions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_step_executions_client_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
     OR NEW.step_id IS DISTINCT FROM OLD.step_id
     OR NEW.step_order IS DISTINCT FROM OLD.step_order
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.tracking_data IS DISTINCT FROM OLD.tracking_data THEN
    RAISE EXCEPTION 'Cette étape ne peut pas être rattachée à un autre candidat ni à une autre séquence'
      USING ERRCODE = '42501', HINT = 'EXECUTION_IMMUTABLE';
  END IF;

  IF OLD.status IN ('sending', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'skipped') THEN
    RAISE EXCEPTION 'Cette étape est déjà envoyée, en cours d''envoi ou sautée : elle ne peut plus être modifiée'
      USING ERRCODE = '42501', HINT = 'EXECUTION_ALREADY_DONE';
  END IF;

  IF (NEW.final_message IS DISTINCT FROM OLD.final_message
      OR NEW.final_subject IS DISTINCT FROM OLD.final_subject)
     AND OLD.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Seul un message encore programmé peut être modifié'
      USING ERRCODE = '42501', HINT = 'EXECUTION_NOT_SCHEDULED';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_step_executions_client_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_step_executions_client_guard ON public.sequence_step_executions;
CREATE TRIGGER sequence_step_executions_client_guard
  BEFORE UPDATE ON public.sequence_step_executions
  FOR EACH ROW EXECUTE FUNCTION public.sequence_step_executions_client_guard();

-- ---------------------------------------------------------------------
-- 4a. SEQ-057 : statistiques rattachées à l'organisation de la séquence
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_sequence_analytics(
  p_sequence_id uuid,
  p_field text,
  p_increment integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field NOT IN ('invites_sent', 'invites_accepted', 'messages_sent', 'replies_received', 'profile_visits') THEN
    RAISE EXCEPTION 'increment_sequence_analytics: unknown field %', p_field;
  END IF;
  IF p_sequence_id IS NULL THEN
    RETURN;
  END IF;

  -- Séquence supprimée : aucune ligne (la clé étrangère l'aurait refusée).
  -- COALESCE : en prod les compteurs n'ont pas de défaut, NULL + n restait NULL.
  EXECUTE format(
    'INSERT INTO public.sequence_analytics AS a (sequence_id, date, organization_id, %1$I)
     SELECT s.id, CURRENT_DATE, s.organization_id, $2
     FROM public.outreach_sequences s
     WHERE s.id = $1
     ON CONFLICT (sequence_id, date) DO UPDATE
       SET %1$I = COALESCE(a.%1$I, 0) + EXCLUDED.%1$I,
           organization_id = COALESCE(a.organization_id, EXCLUDED.organization_id)',
    p_field
  ) USING p_sequence_id, GREATEST(p_increment, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_sequence_analytics(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_sequence_analytics(uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------
-- 4b. SEQ-059 : save_sequence_steps (corps v2 de 20260715091000, plus le
--     refus de supprimer une étape qui a un historique)
-- ---------------------------------------------------------------------
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
  v_blocked_orders text;
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

  -- Étape retirée qui a déjà servi : la supprimer effacerait en cascade ses
  -- exécutions et le suivi de ses e-mails (une réponse à cet e-mail ne serait
  -- plus reconnue). Refus explicite, traduit par le front via le HINT.
  -- 'sending' : envoi en cours. 'cancelled' + « during execution » : message
  -- parti marqué annulé par l'ancien moteur (BUG-095).
  SELECT string_agg(DISTINCT st.step_order::text, ', ')
    INTO v_blocked_orders
  FROM public.sequence_steps st
  JOIN public.sequence_step_executions x ON x.step_id = st.id
  WHERE st.sequence_id = p_sequence_id
    AND NOT (st.id = ANY(v_incoming))
    AND (
      x.status IN ('sending', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped')
      OR (x.status = 'cancelled' AND x.skip_reason LIKE 'Enrollment became % during execution')
    );

  IF v_blocked_orders IS NOT NULL THEN
    RAISE EXCEPTION 'Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée. Modifiez son contenu à la place.'
      USING ERRCODE = 'P0001',
            HINT = 'STEP_HAS_HISTORY',
            DETAIL = format('Étape(s) concernée(s) : %s', v_blocked_orders);
  END IF;

  -- Sans historique, seules des exécutions en attente peuvent subsister : elles
  -- disparaissent avec l'étape (ON DELETE CASCADE), aucune n'était partie. Le
  -- moteur planifie ensuite l'étape suivante des inscriptions concernées.
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

REVOKE ALL ON FUNCTION public.save_sequence_steps(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_sequence_steps(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4c. SEQ-165 : compteurs d'inscriptions par séquence et statut
--     SECURITY INVOKER : la RLS borne le résultat à ce que l'appelant voit.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sequence_enrollment_counts(p_sequence_ids uuid[])
RETURNS TABLE (sequence_id uuid, status text, count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT e.sequence_id, e.status, count(*)::bigint
  FROM public.sequence_enrollments e
  WHERE e.sequence_id = ANY (p_sequence_ids)
  GROUP BY e.sequence_id, e.status
$$;

REVOKE ALL ON FUNCTION public.get_sequence_enrollment_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sequence_enrollment_counts(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4d. SEQ-119 : rôle collaborateur dans l'organisation active
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_org_collaborator(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.get_org_role(_user_id, public.get_user_org_id(_user_id)) = 'collaborator',
    false
  )
$$;

REVOKE ALL ON FUNCTION public.is_active_org_collaborator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_org_collaborator(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Policies : un seul jeu par table
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'outreach_sequences', 'sequence_steps', 'sequence_enrollments',
        'sequence_step_executions', 'sequence_templates', 'sequence_snippets',
        'sequence_analytics', 'inmail_queue', 'sequence_email_tracking',
        'sequence_processing_lock'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_step_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inmail_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_email_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_processing_lock ENABLE ROW LEVEL SECURITY;

-- outreach_sequences
CREATE POLICY org_members_select ON public.outreach_sequences
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (created_by = auth.uid() OR NOT (SELECT public.is_active_org_collaborator(auth.uid())))
  );
CREATE POLICY mission_team_select ON public.outreach_sequences
  FOR SELECT TO authenticated
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));
CREATE POLICY org_members_insert ON public.outreach_sequences
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY org_members_update ON public.outreach_sequences
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY org_members_delete ON public.outreach_sequences
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY service_role_all ON public.outreach_sequences
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_steps : l'étape et sa séquence dans l'organisation de l'appelant.
-- La sous-requête sur outreach_sequences passe par sa RLS : un collaborateur
-- n'atteint que les étapes des séquences qu'il voit.
CREATE POLICY org_members_select ON public.sequence_steps
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.outreach_sequences s
      WHERE s.id = sequence_steps.sequence_id
        AND s.organization_id = public.get_user_org_id(auth.uid())
    )
  );
CREATE POLICY org_members_insert ON public.sequence_steps
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.outreach_sequences s
      WHERE s.id = sequence_steps.sequence_id
        AND s.organization_id = public.get_user_org_id(auth.uid())
    )
  );
CREATE POLICY org_members_update ON public.sequence_steps
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.outreach_sequences s
      WHERE s.id = sequence_steps.sequence_id
        AND s.organization_id = public.get_user_org_id(auth.uid())
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.outreach_sequences s
      WHERE s.id = sequence_steps.sequence_id
        AND s.organization_id = public.get_user_org_id(auth.uid())
    )
  );
CREATE POLICY org_members_delete ON public.sequence_steps
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.outreach_sequences s
      WHERE s.id = sequence_steps.sequence_id
        AND s.organization_id = public.get_user_org_id(auth.uid())
    )
  );
CREATE POLICY service_role_all ON public.sequence_steps
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_enrollments
CREATE POLICY org_members_select ON public.sequence_enrollments
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      NOT (SELECT public.is_active_org_collaborator(auth.uid()))
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.outreach_sequences s
        WHERE s.id = sequence_enrollments.sequence_id
          AND (s.created_by = auth.uid()
               OR public.is_mission_team_member_for_project(auth.uid(), s.project_id))
      )
    )
  );
CREATE POLICY org_members_insert ON public.sequence_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY org_members_update ON public.sequence_enrollments
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (created_by = auth.uid() OR NOT (SELECT public.is_active_org_collaborator(auth.uid())))
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (created_by = auth.uid() OR NOT (SELECT public.is_active_org_collaborator(auth.uid())))
  );
CREATE POLICY org_members_delete ON public.sequence_enrollments
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (created_by = auth.uid() OR NOT (SELECT public.is_active_org_collaborator(auth.uid())))
  );
CREATE POLICY service_role_all ON public.sequence_enrollments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_step_executions : organization_id est recopiée de l'inscription
-- (3c) avant la WITH CHECK. Un collaborateur ne lit que les étapes des
-- candidats qu'il voit et n'écrit que sur ceux qu'il a inscrits.
CREATE POLICY org_members_select ON public.sequence_step_executions
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      NOT (SELECT public.is_active_org_collaborator(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
      )
    )
  );
CREATE POLICY org_members_insert ON public.sequence_step_executions
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      NOT (SELECT public.is_active_org_collaborator(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
          AND e.created_by = auth.uid()
      )
    )
  );
CREATE POLICY org_members_update ON public.sequence_step_executions
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      NOT (SELECT public.is_active_org_collaborator(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
          AND e.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      NOT (SELECT public.is_active_org_collaborator(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
          AND e.created_by = auth.uid()
      )
    )
  );
CREATE POLICY org_members_delete ON public.sequence_step_executions
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      NOT (SELECT public.is_active_org_collaborator(auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.id = sequence_step_executions.enrollment_id
          AND e.created_by = auth.uid()
      )
    )
  );
CREATE POLICY service_role_all ON public.sequence_step_executions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_templates : un modèle « système » ne se crée, ne se modifie et ne
-- se supprime que par migration ou service_role.
CREATE POLICY org_or_system_select ON public.sequence_templates
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) OR is_system = true);
CREATE POLICY org_members_insert ON public.sequence_templates
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND is_system IS NOT TRUE);
CREATE POLICY org_members_update ON public.sequence_templates
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND is_system IS NOT TRUE)
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND is_system IS NOT TRUE);
CREATE POLICY org_members_delete ON public.sequence_templates
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND is_system IS NOT TRUE);
CREATE POLICY service_role_all ON public.sequence_templates
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_snippets
CREATE POLICY org_members_all ON public.sequence_snippets
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY service_role_all ON public.sequence_snippets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_analytics : écrite par increment_sequence_analytics seulement
CREATE POLICY org_members_select ON public.sequence_analytics
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY service_role_all ON public.sequence_analytics
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- inmail_queue : programmation, envoi et annulation passent par
-- process-inmail-queue (contrôle du compte d'envoi) ; le navigateur n'écrit
-- que le suivi d'un message déjà parti.
CREATE POLICY org_members_select ON public.inmail_queue
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY org_members_insert ON public.inmail_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND created_by = auth.uid()
    AND status = 'sent'
  );
CREATE POLICY service_role_all ON public.inmail_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- sequence_email_tracking (pixel de suivi : fonction SECURITY DEFINER) et
-- verrou du moteur : service_role seulement, comme en prod.
CREATE POLICY service_role_all ON public.sequence_email_tracking
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY service_role_all ON public.sequence_processing_lock
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Contrôle : exactement le jeu attendu sur chaque table
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'inmail_queue:org_members_insert',
    'inmail_queue:org_members_select',
    'inmail_queue:service_role_all',
    'outreach_sequences:mission_team_select',
    'outreach_sequences:org_members_delete',
    'outreach_sequences:org_members_insert',
    'outreach_sequences:org_members_select',
    'outreach_sequences:org_members_update',
    'outreach_sequences:service_role_all',
    'sequence_analytics:org_members_select',
    'sequence_analytics:service_role_all',
    'sequence_email_tracking:service_role_all',
    'sequence_enrollments:org_members_delete',
    'sequence_enrollments:org_members_insert',
    'sequence_enrollments:org_members_select',
    'sequence_enrollments:org_members_update',
    'sequence_enrollments:service_role_all',
    'sequence_processing_lock:service_role_all',
    'sequence_snippets:org_members_all',
    'sequence_snippets:service_role_all',
    'sequence_step_executions:org_members_delete',
    'sequence_step_executions:org_members_insert',
    'sequence_step_executions:org_members_select',
    'sequence_step_executions:org_members_update',
    'sequence_step_executions:service_role_all',
    'sequence_steps:org_members_delete',
    'sequence_steps:org_members_insert',
    'sequence_steps:org_members_select',
    'sequence_steps:org_members_update',
    'sequence_steps:service_role_all',
    'sequence_templates:org_members_delete',
    'sequence_templates:org_members_insert',
    'sequence_templates:org_members_update',
    'sequence_templates:org_or_system_select',
    'sequence_templates:service_role_all'
  ];
  v_actual text[];
BEGIN
  SELECT array_agg(tablename || ':' || policyname ORDER BY tablename || ':' || policyname)
    INTO v_actual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'outreach_sequences', 'sequence_steps', 'sequence_enrollments',
      'sequence_step_executions', 'sequence_templates', 'sequence_snippets',
      'sequence_analytics', 'inmail_queue', 'sequence_email_tracking',
      'sequence_processing_lock'
    );
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Séquences : policies inattendues %, attendu %', v_actual, v_expected;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. SEQ-117 : index du moteur (mêmes noms que la base neuve, IF NOT EXISTS :
--    sans effet en base neuve, créés en prod) et index des rattrapages.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_step_exec_enrollment_status
  ON public.sequence_step_executions (enrollment_id, status);
CREATE INDEX IF NOT EXISTS idx_step_exec_scheduled
  ON public.sequence_step_executions (status, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_step_exec_step_id
  ON public.sequence_step_executions (step_id);
CREATE INDEX IF NOT EXISTS idx_sequence_step_executions_org
  ON public.sequence_step_executions (organization_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_account_status
  ON public.sequence_enrollments (account_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_profile_id
  ON public.sequence_enrollments (profile_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_resolved_profile
  ON public.sequence_enrollments (resolved_profile_id)
  WHERE resolved_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_org
  ON public.sequence_enrollments (organization_id);
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_company_reply
  ON public.sequence_enrollments (company_name, sequence_id)
  WHERE status = 'active' AND company_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_org
  ON public.outreach_sequences (organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_project_id
  ON public.outreach_sequences (project_id);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_next_step_id
  ON public.sequence_steps (next_step_id);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_parent_step_id
  ON public.sequence_steps (parent_step_id)
  WHERE parent_step_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sequence_steps_timeout_branch
  ON public.sequence_steps (timeout_branch_step_id)
  WHERE timeout_branch_step_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inmail_queue_org
  ON public.inmail_queue (organization_id);
CREATE INDEX IF NOT EXISTS idx_inmail_queue_status_scheduled
  ON public.inmail_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_inmail_queue_created_by
  ON public.inmail_queue (created_by);
CREATE INDEX IF NOT EXISTS idx_sequence_analytics_org_id
  ON public.sequence_analytics (organization_id);
-- Réponse à un e-mail (in_reply_to) et pixel de suivi.
CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_message_id
  ON public.sequence_email_tracking (email_message_id)
  WHERE email_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sequence_email_tracking_tracking_id
  ON public.sequence_email_tracking (tracking_id);

DO $$
BEGIN
  IF to_regclass('public.candidate_evaluations') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_candidate_evaluations_org
      ON public.candidate_evaluations (organization_id);
  END IF;
END $$;

-- Rattrapage des étapes bloquées en 'sending' ou 'quota_blocked'.
CREATE INDEX IF NOT EXISTS idx_step_exec_stuck_updated_at
  ON public.sequence_step_executions (status, updated_at)
  WHERE status IN ('sending', 'quota_blocked');
-- Rattrapage des inscriptions actives sans étape en attente.
CREATE INDEX IF NOT EXISTS idx_enrollments_active_updated_at
  ON public.sequence_enrollments (updated_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 7. SEQ-075 : contrôles décalés de l'envoi (process reste à */5)
--    process :00 :05 :10...  check_replies :02 :07...  check_timeouts :03 :13...
--    check_wait_events :04 :19 :34 :49. Même forme que 20260513200000.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-sequences-replies');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM cron.unschedule('process-sequences-timeouts');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM cron.unschedule('process-sequences-wait-events');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

DO $do$
BEGIN
  PERFORM cron.schedule(
    'process-sequences-replies',
    '2-59/5 * * * *',
    $$SELECT public.invoke_process_sequences('check_replies', false);$$
  );
  PERFORM cron.schedule(
    'process-sequences-timeouts',
    '3-59/10 * * * *',
    $$SELECT public.invoke_process_sequences('check_timeouts', false);$$
  );
  PERFORM cron.schedule(
    'process-sequences-wait-events',
    '4-59/15 * * * *',
    $$SELECT public.invoke_process_sequences('check_wait_events', false);$$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;
