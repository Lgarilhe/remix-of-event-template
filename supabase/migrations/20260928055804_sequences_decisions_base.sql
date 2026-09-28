-- =====================================================================
-- Séquences : décisions produit de la seconde vague d'audit (2026-09-28),
-- lot « db ». docs/audit-2026-09-25-sequences.md, « Décisions produit en
-- attente », numéros 12, 15, 17 à 21.
--
-- Rejouable sur une base vide (CI e2e) comme en prod : chaque objet visé
-- existe à ce point de la chaîne (20260925163421, 20260927194905,
-- 20260927231417) ; DROP ... IF EXISTS et CREATE OR REPLACE partout.
--
-- Les chemins serveur (service_role : moteur, webhooks, assistant) restent
-- libres pour 17 et 18 ; 12, 20 et 21 les visent aussi.
--
-- 1. D12  sequence_enrollments, à l'insertion : refus (42501, HINT
--         ENROLLMENT_GDPR_ERASED) d'un profil effacé. Empreinte SHA-256 de
--         l'URL de profil (normalizeLinkedInUrl) ou de l'adresse (normalizeEmail)
--         au registre gdpr_erasures, comme recordGdprErasure
--         (_shared/get-or-fetch-contact.ts) ; ou marqueur
--         tracking_data.gdpr_erased_at sur une inscription de la même
--         organisation qui partage un identifiant (profile_id, provider_id,
--         resolved_profile_id) ou le slug public (/in/{slug}).
-- 2. D21  sequence_enrollments, à l'insertion : refus (23505, HINT
--         ENROLLMENT_SAME_PERSON_IN_SEQUENCE) si la même personne (identifiant
--         commun ou même slug) a déjà dans la séquence une inscription vivante
--         (active, paused) ou close depuis moins de 90 jours. Au-delà : permis
--         (décision 23, avertissement dans l'interface). Le même profile_id
--         reste l'affaire de UNIQUE(sequence_id, profile_id) : l'inscription
--         groupée du navigateur (ON CONFLICT DO NOTHING) continue d'écarter ce
--         doublon en silence. re_enroll réactive la même ligne : non concerné.
-- 3. D20  Garde du compte d'envoi (SEQ-043) : une inscription sans auteur
--         (created_by NULL) depuis le compte LinkedIn relié à un membre est
--         refusée aussi côté serveur (HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER). La
--         remise à NULL par suppression d'un utilisateur (ON DELETE SET NULL)
--         reste hors du déclencheur de mise à jour (clause WHEN de
--         20260927194905).
-- 4. D17  sequence_enrollments : un utilisateur connecté ne fait plus passer
--         une inscription d'un autre statut à 'active' (HINT
--         ENROLLMENT_RESUME_SERVER_ONLY). La reprise passe par le serveur
--         (resume_enrollments, re_enroll). L'insertion en 'active' reste permise.
--         Le nom du déclencheur le fait passer après
--         sequence_enrollments_gdpr_guard : un candidat effacé garde son refus
--         ENROLLMENT_GDPR_ERASED.
-- 5. D18  sequence_step_executions, utilisateur connecté :
--         - une étape annulée ou en échec ne change plus de statut (HINT
--           EXECUTION_REARM_SERVER_ONLY), après le refus RGPD de 20260927231417 ;
--         - seule insertion permise : la première étape d'une inscription
--           active qui n'en a encore aucune, en 'scheduled' et jamais exécutée
--           (fenêtres d'inscription du navigateur). Tout le reste : HINT
--           EXECUTION_INSERT_SERVER_ONLY.
-- 6. D15  agent_conversations, agent_messages : chacun lit ses conversations
--         et leurs messages ; propriétaire et administrateur lisent toute
--         l'organisation. Écriture (mise à jour d'une conversation, message
--         ajouté) : l'auteur seul. Toutes les policies existantes sont retirées
--         quel que soit leur nom (règle 7 de CLAUDE.md), un seul jeu est recréé
--         aux noms de la prod, contrôle final. Les fonctions en clé de service
--         (search-agent-chat, run-agent-search...) ne sont pas concernées.
-- 7. D19  Tables du module : anon perd tous ses droits (aucune policy ne le
--         vise) ; authenticated perd TRUNCATE, REFERENCES et TRIGGER partout,
--         et les écritures sans policy : sequence_analytics,
--         sequence_email_tracking, sequence_processing_lock (lecture seule ou
--         serveur seul), UPDATE et DELETE sur inmail_queue (le navigateur n'y
--         insère que le suivi d'un message parti).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. D12 : profil effacé, à l'insertion
--    SECURITY DEFINER : le marqueur d'une inscription de collègue doit être
--    vu même si la RLS la cache à l'appelant (collaborateur).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_enrollments_gdpr_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := NEW.organization_id;
  v_ids text[];
  v_slug text;
  v_url text;
  v_email text;
BEGIN
  IF v_org IS NULL THEN
    SELECT s.organization_id INTO v_org
    FROM public.outreach_sequences s
    WHERE s.id = NEW.sequence_id;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT btrim(v)), ARRAY[]::text[]) INTO v_ids
  FROM unnest(ARRAY[NEW.profile_id, NEW.provider_id, NEW.resolved_profile_id]) AS v
  WHERE btrim(v) <> '';
  -- linkedInProfileSlug : /in/{slug} en minuscules, 3 caractères au moins.
  v_slug := substring(lower(NEW.profile_url) FROM 'linkedin\.com/in/([^/?#[:space:]]+)');
  IF length(v_slug) < 3 THEN
    v_slug := NULL;
  END IF;

  -- normalizeLinkedInUrl et normalizeEmail, puis sha256Hex.
  v_url := NULLIF(btrim(regexp_replace(regexp_replace(lower(NEW.profile_url), '[?#].*$', ''), '/$', ''),
                        E' \t\n\r\f'), '');
  v_email := lower(btrim(NEW.email_used, E' \t\n\r\f'));
  IF v_email !~ '\S+@\S+\.\S+' THEN
    v_email := NULL;
  END IF;

  IF (v_url IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.gdpr_erasures g
        WHERE g.linkedin_url_hash = encode(sha256(convert_to(v_url, 'UTF8')), 'hex')))
     OR (v_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.gdpr_erasures g
        WHERE g.email_hash = encode(sha256(convert_to(v_email, 'UTF8')), 'hex')))
     OR (v_org IS NOT NULL AND (cardinality(v_ids) > 0 OR v_slug IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.sequence_enrollments e
        WHERE e.organization_id = v_org
          AND e.tracking_data <> '{}'::jsonb
          AND e.tracking_data ? 'gdpr_erased_at'
          AND e.tracking_data -> 'gdpr_erased_at' NOT IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb)
          AND (e.profile_id = ANY (v_ids)
               OR e.provider_id = ANY (v_ids)
               OR e.resolved_profile_id = ANY (v_ids)
               OR (v_slug IS NOT NULL
                   AND substring(lower(e.profile_url) FROM 'linkedin\.com/in/([^/?#[:space:]]+)') = v_slug)))) THEN
    RAISE EXCEPTION 'Ce candidat a demandé l''effacement de ses données : il ne peut plus être inscrit dans une séquence.'
      USING ERRCODE = '42501', HINT = 'ENROLLMENT_GDPR_ERASED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_enrollments_gdpr_insert_guard() FROM PUBLIC, anon, authenticated;

-- Nom trié après sequence_enrollments_check_org, qui complète organization_id.
DROP TRIGGER IF EXISTS sequence_enrollments_gdpr_insert_guard ON public.sequence_enrollments;
CREATE TRIGGER sequence_enrollments_gdpr_insert_guard
  BEFORE INSERT ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sequence_enrollments_gdpr_insert_guard();

-- ---------------------------------------------------------------------
-- 2. D21 : même personne, même séquence, sous un autre identifiant
--    SECURITY DEFINER : un collaborateur ne voit pas les inscriptions de ses
--    collègues. Nom trié après la garde RGPD (1).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_enrollments_same_person_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[];
  v_slug text;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT btrim(v)), ARRAY[]::text[]) INTO v_ids
  FROM unnest(ARRAY[NEW.profile_id, NEW.provider_id, NEW.resolved_profile_id]) AS v
  WHERE btrim(v) <> '';
  v_slug := substring(lower(NEW.profile_url) FROM 'linkedin\.com/in/([^/?#[:space:]]+)');
  IF length(v_slug) < 3 THEN
    v_slug := NULL;
  END IF;
  IF cardinality(v_ids) = 0 AND v_slug IS NULL THEN
    RETURN NEW;
  END IF;

  -- Date de clôture : fin ou réponse, la plus récente ; à défaut la dernière
  -- écriture (inscription arrêtée sans date de fin).
  IF EXISTS (
    SELECT 1 FROM public.sequence_enrollments e
    WHERE e.sequence_id = NEW.sequence_id
      AND e.profile_id IS DISTINCT FROM NEW.profile_id
      AND (e.status IN ('active', 'paused')
           OR COALESCE(GREATEST(e.completed_at, e.replied_at), e.updated_at) > now() - interval '90 days')
      AND (e.profile_id = ANY (v_ids)
           OR e.provider_id = ANY (v_ids)
           OR e.resolved_profile_id = ANY (v_ids)
           OR (v_slug IS NOT NULL
               AND substring(lower(e.profile_url) FROM 'linkedin\.com/in/([^/?#[:space:]]+)') = v_slug))
  ) THEN
    RAISE EXCEPTION 'Ce candidat est déjà dans cette séquence sous un autre identifiant LinkedIn, ou l''a quittée il y a moins de 90 jours.'
      USING ERRCODE = '23505', HINT = 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_enrollments_same_person_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_enrollments_same_person_guard ON public.sequence_enrollments;
CREATE TRIGGER sequence_enrollments_same_person_guard
  BEFORE INSERT ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.sequence_enrollments_same_person_guard();

-- ---------------------------------------------------------------------
-- 3. D20 : inscription sans auteur depuis le compte relié d'un membre
--    Même corps que 20260925163421 §3f, plus le cas created_by NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_enrollments_check_sender_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_uid uuid;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_org := NEW.organization_id;
  IF v_org IS NULL THEN
    SELECT s.organization_id INTO v_org
    FROM public.outreach_sequences s
    WHERE s.id = NEW.sequence_id;
  END IF;

  -- Utilisateur connecté (navigateur, API) : created_by est fourni par le
  -- client, on contrôle aussi l'appelant réel. Chemins serveur (agent,
  -- service_role) : created_by seul.
  IF COALESCE(auth.role(), '') = 'authenticated' THEN
    v_uid := auth.uid();
  END IF;

  -- D20 : sans auteur, personne ne peut répondre de l'envoi depuis ce compte.
  IF NEW.created_by IS NULL AND EXISTS (
    SELECT 1 FROM public.member_linkedin_accounts m
    WHERE m.organization_id = v_org
      AND m.linkedin_account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Une inscription depuis le compte LinkedIn relié d''un membre doit indiquer son auteur.'
      USING ERRCODE = '42501', HINT = 'ENROLL_ACCOUNT_OF_OTHER_MEMBER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.member_linkedin_accounts m
    WHERE m.organization_id = v_org
      AND m.linkedin_account_id = NEW.account_id
      AND (m.user_id <> NEW.created_by
           OR (v_uid IS NOT NULL AND m.user_id <> v_uid))
  ) THEN
    RAISE EXCEPTION 'Ce compte LinkedIn est relié à un autre membre de l''équipe. Inscrivez les candidats depuis votre propre compte.'
      USING ERRCODE = '42501', HINT = 'ENROLL_ACCOUNT_OF_OTHER_MEMBER';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_enrollments_check_sender_owner() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. D17 : reprise réservée au serveur
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sequence_enrollments_resume_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Un candidat en pause ou sorti de la séquence se reprend avec « Reprendre » ou « Relancer » : son statut ne se réécrit pas directement.'
    USING ERRCODE = '42501', HINT = 'ENROLLMENT_RESUME_SERVER_ONLY';
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_enrollments_resume_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_enrollments_resume_guard ON public.sequence_enrollments;
CREATE TRIGGER sequence_enrollments_resume_guard
  BEFORE UPDATE OF status ON public.sequence_enrollments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'active' AND NEW.status = 'active')
  EXECUTE FUNCTION public.sequence_enrollments_resume_guard();

-- ---------------------------------------------------------------------
-- 5. D18 : étapes, écritures d'un utilisateur connecté
--    5a. Même corps que 20260927231417 §2, plus le refus du réarmement.
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

  -- GDPR_ERASURE_SKIP_REASON de _shared/get-or-fetch-contact.ts.
  IF OLD.status = 'cancelled'
     AND OLD.skip_reason = 'Effacement des données demandé : séquence arrêtée' THEN
    RAISE EXCEPTION 'Les données de ce candidat ont été effacées : cette étape ne peut plus être modifiée'
      USING ERRCODE = '42501', HINT = 'ENROLLMENT_GDPR_ERASED';
  END IF;

  -- D18 : une étape annulée ou en échec ne se réarme que par le serveur.
  IF OLD.status IN ('cancelled', 'failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cette étape est annulée ou en échec : elle ne se reprogramme qu''avec « Reprendre » ou « Relancer ».'
      USING ERRCODE = '42501', HINT = 'EXECUTION_REARM_SERVER_ONLY';
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

-- 5b. Insertion : la première étape d'une inscription qui vient d'être créée
--     (EnrollmentPreviewModal, SequenceEnrollModal), rien d'autre. SECURITY
--     DEFINER : les étapes déjà planifiées se comptent toutes, RLS ou non.
--     Nom trié après sequence_step_executions_check_org, qui refuse une étape
--     d'une autre séquence et recopie l'organisation.
CREATE OR REPLACE FUNCTION public.sequence_step_executions_client_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'scheduled'
     OR NEW.executed_at IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.sequence_enrollments e
       WHERE e.id = NEW.enrollment_id AND e.status = 'active')
     OR EXISTS (
       SELECT 1 FROM public.sequence_step_executions x
       WHERE x.enrollment_id = NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Seule la première étape d''un candidat qui vient d''être inscrit se programme depuis l''application ; la suite est planifiée par le moteur d''envoi.'
      USING ERRCODE = '42501', HINT = 'EXECUTION_INSERT_SERVER_ONLY';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sequence_step_executions_client_insert_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sequence_step_executions_client_insert_guard ON public.sequence_step_executions;
CREATE TRIGGER sequence_step_executions_client_insert_guard
  BEFORE INSERT ON public.sequence_step_executions
  FOR EACH ROW EXECUTE FUNCTION public.sequence_step_executions_client_insert_guard();

-- ---------------------------------------------------------------------
-- 6. D15 : conversations et messages de l'assistant
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('agent_conversations', 'agent_messages')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_members_select ON public.agent_conversations
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
    )
  );
CREATE POLICY org_members_insert ON public.agent_conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY org_members_update ON public.agent_conversations
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY org_members_select ON public.agent_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = agent_messages.conversation_id
      AND ac.organization_id = public.get_user_org_id(auth.uid())
      AND (
        ac.created_by = auth.uid()
        OR public.get_org_role(auth.uid(), ac.organization_id) IN ('owner', 'admin')
      )
  ));
CREATE POLICY org_members_insert ON public.agent_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = agent_messages.conversation_id
      AND ac.organization_id = public.get_user_org_id(auth.uid())
      AND ac.created_by = auth.uid()
  ));

-- Contrôle : exactement ce jeu sur les deux tables.
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'agent_conversations:org_members_insert',
    'agent_conversations:org_members_select',
    'agent_conversations:org_members_update',
    'agent_messages:org_members_insert',
    'agent_messages:org_members_select'
  ];
  v_actual text[];
BEGIN
  SELECT array_agg(tablename || ':' || policyname ORDER BY tablename || ':' || policyname)
    INTO v_actual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('agent_conversations', 'agent_messages');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Assistant : policies inattendues %, attendu %', v_actual, v_expected;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. D19 : droits inutiles sur les tables du module
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.outreach_sequences, public.sequence_steps, public.sequence_enrollments,
  public.sequence_step_executions, public.sequence_templates, public.sequence_snippets,
  public.sequence_analytics, public.inmail_queue, public.sequence_email_tracking,
  public.sequence_processing_lock
FROM PUBLIC, anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.outreach_sequences, public.sequence_steps, public.sequence_enrollments,
  public.sequence_step_executions, public.sequence_templates, public.sequence_snippets,
  public.sequence_analytics, public.inmail_queue, public.sequence_email_tracking,
  public.sequence_processing_lock
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.sequence_analytics, public.sequence_email_tracking, public.sequence_processing_lock
FROM authenticated;

REVOKE UPDATE, DELETE ON TABLE public.inmail_queue FROM authenticated;
