-- =====================================================================
-- Lot C1 : réparations des fuites (partie base de données).
-- Source : synthèse de l'extension de la page mission, section 4 (R1 à
-- R13), conceptions contre-vérifiées de R2, R3, R4, R6, R7, R13, et
-- décision 17 (Marketplace gelée jusqu'au lot P2).
--
-- Blocs, dans l'ordre d'exécution :
--   R2.  submit-application retirée : purge de ses clés de limitation
--        (e-mail et adresse IP en clair) dans rate_limit_log.
--   R3.  Conversations de l'assistant (agent_conversations, agent_messages) :
--        lues, créées et modifiées par leur auteur seul, dans son
--        organisation active. Actions proposées (agent_tool_executions) :
--        lues par leur auteur, ou par le propriétaire ou un administrateur ;
--        celles proposées dans la conversation d'un autre sont neutralisées.
--   R4.  Portail client : tout lien expire (90 jours par défaut, liens sans
--        date alignés, colonne obligatoire) ; client_portal_candidates(token),
--        seule lecture des candidats du portail, ne rend que les retenus et
--        au-delà de l'organisation du lien ; réservée à service_role.
--   R6.  get_open_hunt_missions et get_my_hunt_applications : projection sur
--        liste blanche, ni poste entier, ni nom du client, ni nom interne.
--   R7.  Équipe de mission : plus aucune policy d'équipe hors de la ligne de
--        mission, de ses étapes et de l'équipe ; un externe ne voit que sa
--        propre ligne d'équipe ; une ligne candidat ou une séquence ne porte
--        que la mission de sa propre organisation (policies RESTRICTIVE).
--        Les chiffres d'une mission ne comptent que les lignes de son
--        organisation (recompute_mission_stats) ; le rattachement par
--        identifiant externe de poste reste dans l'organisation de la ligne.
--   R11. Rôle « Collaborateur » refusé sur les invitations jusqu'au lot C2.
--   D17. Marketplace gelée : une session utilisateur ne fait plus entrer de
--        mission sur la Marketplace, et la validation d'un partenaire par
--        validate_marketplace_partner est refusée (HINT MARKETPLACE_FROZEN).
--   R13. Fonctions SECURITY DEFINER : jamais exécutables par PUBLIC, par anon
--        seulement sur liste blanche ; fonctions internes retirées aussi à
--        authenticated. anon n'écrit plus dans aucune table du schéma public,
--        sauf l'envoi du formulaire de contact. Joué en dernier : la boucle
--        voit les fonctions créées ou remplacées par les blocs précédents.
--
-- Deux familles de noms de policies (CLAUDE.md, règles 6 et 7) : la
-- production vient de MIGRATION_CLEAN.sql, une base neuve des migrations.
-- Les policies à retirer le sont par boucle sur pg_policies, jamais par nom.
-- Chaque bloc est idempotent, rejoue sur base vide comme sur la production ;
-- une table qui peut manquer est testée par to_regclass.
-- Audits (base neuve, CI e2e) : supabase/tests/assistant_conversations_audit.sql
-- (R3), client_portal_audit.sql (R4), partner_engagements_audit.sql (R6, R7,
-- D17), rls_and_definer_audit.sql (R13).
-- =====================================================================


-- =====================================================================
-- R2. submit-application : purge de ses clés de limitation.
-- check_rate_limit rangeait l'e-mail et l'adresse IP de chaque candidature
-- en clair dans rate_limit_log.action (submit_app_<e-mail>,
-- submit_app_ip_<ip>), et aucune tâche planifiée ne purge cette table.
-- Table créée par 20260313002353 (base neuve) et MIGRATION_CLEAN.sql.
-- =====================================================================
DO $c1_r2$
BEGIN
  IF to_regclass('public.rate_limit_log') IS NOT NULL THEN
    DELETE FROM public.rate_limit_log WHERE starts_with(action, 'submit_app_');
  END IF;
END
$c1_r2$;


-- =====================================================================
-- R3. Conversations de l'assistant : leur auteur seul.
-- Production (MIGRATION_CLEAN.sql) : org_members_select, org_members_insert,
-- org_members_update (conversations), org_members_select,
-- org_members_insert (messages). Base neuve (20260310225852) : « Users can
-- view their org conversations », « Users can create conversations »,
-- « Users can update their org conversations », « Users can view messages
-- in their org conversations », « Users can insert messages in their org
-- conversations ». Les policies permissives s'additionnent : toutes celles
-- des deux tables sont retirées, puis reposées.
-- Aucune policy DELETE : aucun écran ne supprime une conversation.
-- =====================================================================
DO $c1_r3$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('agent_conversations', 'agent_messages')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END
$c1_r3$;

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_conversations_author_select ON public.agent_conversations
  FOR SELECT TO authenticated
  USING (created_by = auth.uid()
         AND organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY agent_conversations_author_insert ON public.agent_conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
              AND organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY agent_conversations_author_update ON public.agent_conversations
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()
         AND organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (created_by = auth.uid()
              AND organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY agent_messages_author_select ON public.agent_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = agent_messages.conversation_id
      AND ac.created_by = auth.uid()
      AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));

CREATE POLICY agent_messages_author_insert ON public.agent_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = agent_messages.conversation_id
      AND ac.created_by = auth.uid()
      AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));

-- ---------------------------------------------------------------------
-- R3-b. Actions proposées par l'assistant (agent_tool_executions), avec
-- leurs paramètres (brouillons de messages) et leur aperçu. Lecture : leur
-- auteur, ou le propriétaire ou un administrateur de l'organisation active
-- (vue « Toute l'organisation » du Journal de l'assistant). Modification :
-- l'auteur, inchangée. Mêmes noms dans les deux familles (20260422100000) ;
-- boucle quand même (règle 7).
-- ---------------------------------------------------------------------
DO $c1_r3b$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.agent_tool_executions') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_tool_executions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.agent_tool_executions', r.policyname);
  END LOOP;

  EXECUTE $p$
    CREATE POLICY agent_tool_executions_author_or_admin_select ON public.agent_tool_executions
      FOR SELECT TO authenticated
      USING (organization_id = public.get_user_org_id(auth.uid())
             AND (user_id = auth.uid()
                  OR public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')))
  $p$;
  EXECUTE $p$
    CREATE POLICY agent_tool_executions_author_update ON public.agent_tool_executions
      FOR UPDATE TO authenticated
      USING (organization_id = public.get_user_org_id(auth.uid()) AND user_id = auth.uid())
      WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND user_id = auth.uid())
  $p$;

  -- Actions proposées par un membre dans la conversation d'un autre
  -- (possible avant C1 par search-agent-chat) : neutralisées, sinon leur
  -- approbation écrirait encore son résultat dans le fil d'autrui. Hors
  -- session utilisateur, guard_agent_tool_execution_update laisse passer.
  UPDATE public.agent_tool_executions e
     SET status = 'rejected',
         user_note = coalesce(e.user_note, 'Annulée (C1) : proposée dans la conversation d''un autre utilisateur')
    FROM public.agent_conversations ac
   WHERE e.conversation_id = ac.id
     AND e.user_id <> ac.created_by
     AND (e.status IN ('proposed', 'failed') OR (e.status = 'approved' AND e.executed_at IS NULL));
END
$c1_r3b$;


-- =====================================================================
-- R4-a. Portail client : tout lien expire.
-- Même colonne dans les deux familles (MIGRATION_CLEAN.sql et
-- 20260326090000) : expires_at timestamptz, facultative, sans défaut.
-- Nouveaux liens : 90 jours. Liens sans date : 90 jours après leur
-- création, et au moins 30 jours à compter de cette migration. Puis la
-- colonne devient obligatoire : un lien sans date n'existe plus.
-- =====================================================================
DO $c1_r4a$
BEGIN
  IF to_regclass('public.client_portal_tokens') IS NULL THEN
    RAISE NOTICE 'C1/R4-a : client_portal_tokens absente, bloc ignoré';
    RETURN;
  END IF;

  ALTER TABLE public.client_portal_tokens
    ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days');

  UPDATE public.client_portal_tokens
     SET expires_at = greatest(coalesce(created_at, now()) + interval '90 days',
                               now() + interval '30 days')
   WHERE expires_at IS NULL;

  ALTER TABLE public.client_portal_tokens
    ALTER COLUMN expires_at SET NOT NULL;

  COMMENT ON COLUMN public.client_portal_tokens.expires_at IS
    'Fin de validité du lien /client/{token}. Obligatoire, 90 jours par défaut (C1/R4). Un lien échu est refusé par client-portal-data et par client_portal_candidates.';
END
$c1_r4a$;

-- ---------------------------------------------------------------------
-- R4-b. Portail client : seuls les candidats retenus ou au-delà.
-- Seule lecture des candidats du portail, appelée par l'edge function
-- client-portal-data (service_role) pour l'affichage ET pour l'avis du
-- client : un candidat absent de ce résultat ne peut pas être évalué.
--
-- Règle, sur le modèle actuel de job_candidate_status :
--  * lien non échu, missions du lien, lignes de l'organisation du lien
--    seulement (une ligne d'une autre organisation qui porte la mission
--    n'apparaît jamais) ;
--  * jamais : status 'dismissed' (écarté) ou 'not_interested' (refus du
--    candidat), quelle que soit l'étape ;
--  * l'étape posée (pipeline_stage) l'emporte sur le statut, comme dans le
--    kanban de mission et le /pipeline ;
--  * sans étape : status 'shortlisted' (Retenu) seulement ;
--  * avec étape : 'shortlisted', 'Pressenti' (Retenu) ; 'CV envoyé',
--    'ITW en cours' ou une étape d'entretien DE CETTE MISSION ; 'Offre' ;
--    'hired', 'Gagné' (Embauché). Tout le reste est refusé : 'sourced',
--    'untreated', 'Nouveau' (À trier) ; 'dismissed', 'Perdu' (Écarté) ;
--    valeurs inconnues ; 'messaged' et 'Contacté', posés aujourd'hui sur
--    des profils à trier dès qu'un message part ; 'replied', 'interested',
--    'qualification', 'Répondu', 'Pré-qualif', posés par les écrivains
--    automatiques hors de la mission de la conversation (lot 0b).
-- L'étape renvoyée est traduite dans le vocabulaire du portail (sourced,
-- to_evaluate, interview, offer, hired) : ni identifiant d'étape interne,
-- ni code technique ne sortent.
-- Pas de SECURITY DEFINER : seul service_role l'exécute.
-- project_ids est text[] en production, uuid[] en base neuve : comparaison
-- en texte.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.client_portal_candidates(p_token text)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  candidate_name text,
  candidate_headline text,
  pipeline_stage text,
  score numeric,
  updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT j.id,
         j.project_id,
         j.candidate_name,
         j.candidate_headline,
         CASE
           WHEN j.pipeline_stage IN ('hired', 'Gagné') THEN 'hired'
           WHEN j.pipeline_stage = 'Offre' THEN 'offer'
           WHEN j.pipeline_stage = 'ITW en cours' OR s.id IS NOT NULL THEN 'interview'
           WHEN j.pipeline_stage = 'CV envoyé' THEN 'to_evaluate'
           ELSE 'sourced'
         END,
         j.score::numeric,
         j.updated_at,
         j.created_at
    FROM public.client_portal_tokens t
    JOIN public.sourcing_projects p
      ON p.organization_id = t.organization_id
     AND (t.project_ids IS NULL
          OR cardinality(t.project_ids) = 0
          OR p.id::text = ANY (t.project_ids::text[]))
    JOIN public.job_candidate_status j
      ON j.project_id = p.id
     AND j.organization_id = t.organization_id
    LEFT JOIN public.mission_process_steps s
      ON s.project_id = j.project_id
     AND s.id::text = j.pipeline_stage
   WHERE p_token IS NOT NULL
     AND t.token = p_token
     AND t.expires_at > now()
     AND coalesce(j.status, '') NOT IN ('dismissed', 'not_interested')
     AND CASE
           WHEN nullif(btrim(j.pipeline_stage), '') IS NULL
             THEN j.status = 'shortlisted'
           ELSE j.pipeline_stage IN ('shortlisted', 'Pressenti', 'CV envoyé', 'ITW en cours',
                                     'Offre', 'hired', 'Gagné')
                OR s.id IS NOT NULL
         END
   ORDER BY j.updated_at DESC;
$$;

COMMENT ON FUNCTION public.client_portal_candidates(text) IS
  'Candidats visibles d''un lien de portail client : lien non échu, missions et organisation du lien, retenus ou au-delà, jamais à trier, contactés seulement ni écartés (C1/R4). Réservée à service_role (edge function client-portal-data).';

REVOKE ALL ON FUNCTION public.client_portal_candidates(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_candidates(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_candidates(text) TO service_role;


-- =====================================================================
-- R6. Missions ouvertes aux partenaires : projection sur liste blanche.
-- get_open_hunt_missions renvoyait job_details entier (interlocuteur du
-- client avec e-mail et téléphone, consignes des messages, profils de
-- calibration, critères, brief brut) et client_name à tout membre d'une
-- organisation partenaire, contre le commentaire de 20260907053654 (« ne
-- projette que les champs de la carte »). Seuls les champs affichés par la
-- carte partent désormais : intitulé, contrat, lieu, télétravail,
-- séniorité, compétences requises (textes seulement), rémunération,
-- places, date limite. Plus de client_name ni d'organization_id.
-- Intitulé public : titre du poste, sinon celui de la mission, sinon un
-- libellé neutre ; jamais le nom interne de la mission, qui cite souvent
-- le client.
-- get_my_hunt_applications perd aussi client_name, et son intitulé suit
-- celui de la carte : sans cela, postuler suffirait à relire le nom du
-- client retiré de la carte.
-- Même signature, mêmes droits.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_open_hunt_missions()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_marketplace_partner(v_uid) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', sp.id,
    'name', coalesce(
      nullif(btrim(sp.job_details->>'title'), ''),
      nullif(btrim(sp.job_title), ''),
      'Poste sans intitulé'
    ),
    -- Liste blanche du poste : les seuls champs lus par la carte.
    'job_details', jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(btrim(sp.job_details->>'title'), ''),
      'contract_type', nullif(btrim(sp.job_details->>'contract_type'), ''),
      'location', nullif(btrim(sp.job_details->>'location'), ''),
      'remote_policy', nullif(btrim(sp.job_details->>'remote_policy'), ''),
      'seniority', nullif(btrim(sp.job_details->>'seniority'), ''),
      'skills_must_have', CASE
        WHEN jsonb_typeof(sp.job_details->'skills_must_have') = 'array' THEN (
          SELECT jsonb_agg(e)
          FROM jsonb_array_elements(sp.job_details->'skills_must_have') AS e
          WHERE jsonb_typeof(e) = 'string'
        )
      END
    )),
    'hunt_bounty_percent', sp.hunt_bounty_percent,
    'hunt_max_recruiters', sp.hunt_max_recruiters,
    'hunt_deadline', sp.hunt_deadline,
    'hunt_status', sp.hunt_status,
    'created_at', sp.created_at,
    'organization_name', o.name,
    'accepted_count', (
      SELECT count(*) FROM public.hunt_applications ha
      WHERE ha.project_id = sp.id AND ha.status = 'accepted'
    ),
    'my_application_status', (
      SELECT ha.status FROM public.hunt_applications ha
      WHERE ha.project_id = sp.id AND ha.recruiter_user_id = v_uid
      LIMIT 1
    )
  )
  FROM public.sourcing_projects sp
  LEFT JOIN public.organizations o ON o.id = sp.organization_id
  WHERE sp.hunt_mode = true
    AND sp.hunt_status IN ('published', 'in_progress')
    AND (sp.hunt_deadline IS NULL OR sp.hunt_deadline::date >= current_date)
    AND NOT public.is_org_member(v_uid, sp.organization_id)
  ORDER BY sp.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_open_hunt_missions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_hunt_missions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_hunt_applications()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', ha.id,
    'project_id', ha.project_id,
    'status', ha.status,
    'message', ha.message,
    'created_at', ha.created_at,
    'responded_at', ha.responded_at,
    -- Même intitulé public que la carte des missions ouvertes.
    'mission_name', coalesce(
      nullif(btrim(sp.job_details->>'title'), ''),
      nullif(btrim(sp.job_title), ''),
      'Poste sans intitulé'
    ),
    'job_title', coalesce(sp.job_details->>'title', sp.job_title),
    'hunt_bounty_percent', sp.hunt_bounty_percent,
    'hunt_status', sp.hunt_status,
    'organization_name', o.name
  )
  FROM public.hunt_applications ha
  LEFT JOIN public.sourcing_projects sp ON sp.id = ha.project_id
  LEFT JOIN public.organizations o ON o.id = sp.organization_id
  WHERE ha.recruiter_user_id = v_uid
  ORDER BY ha.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_hunt_applications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_hunt_applications() TO authenticated, service_role;


-- =====================================================================
-- R7. Équipe de mission : plus aucun accès hors de l'organisation de la
-- ligne. Les policies d'équipe ouvraient à un externe (partenaire accepté,
-- invité de mission) les lignes candidats de l'entreprise en lecture et en
-- écriture, ses grilles, et ses notes, profils et notes IA sur toutes ses
-- missions ; deux partenaires d'une même mission se voyaient. Un membre
-- interne n'y gagnait rien : org_members_all (production) et « Org members
-- can … » (base neuve) lui donnent déjà ces accès.
-- Deux familles de noms : les policies sont retirées par leur contenu, sur
-- tout le schéma public, et chaque retrait est journalisé.
-- Gardés jusqu'au lot P1 (transition) : la lecture de la ligne de mission
-- (sourcing_projects) et de ses étapes (mission_process_steps) par un
-- partenaire accepté.
-- =====================================================================
DO $c1_r7$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pol.tablename, pol.policyname
    FROM pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename NOT IN ('sourcing_projects', 'mission_process_steps', 'mission_team')
      AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ILIKE '%mission_team%'
  LOOP
    RAISE NOTICE 'C1/R7 : policy % retirée de %', r.policyname, r.tablename;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  -- mission_team : un membre de l'équipe ne lit plus les autres lignes de
  -- l'équipe, quel que soit le nom de la policy qui le permettait.
  FOR r IN
    SELECT pol.policyname
    FROM pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = 'mission_team'
      AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ILIKE '%is_mission_team_member%'
  LOOP
    RAISE NOTICE 'C1/R7 : policy % retirée de mission_team', r.policyname;
    EXECUTE format('DROP POLICY %I ON public.mission_team', r.policyname);
  END LOOP;
END
$c1_r7$;

-- Lecture de l'équipe : sa propre ligne, ou toute l'équipe pour un membre
-- de l'organisation de la mission.
DROP POLICY IF EXISTS "mission_team_select" ON public.mission_team;
CREATE POLICY "mission_team_select" ON public.mission_team
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member_for_project(auth.uid(), project_id)
  );

-- Noms de l'équipe : l'organisation de la mission voit toute l'équipe, un
-- externe ne voit que sa propre ligne (ni nom, ni nombre des autres).
CREATE OR REPLACE FUNCTION public.get_mission_team_profiles(p_project_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_project_org_id uuid;
  v_is_org_member boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT sp.organization_id INTO v_project_org_id
  FROM public.sourcing_projects sp
  WHERE sp.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission introuvable';
  END IF;

  v_is_org_member := public.is_org_member_for_project(v_uid, p_project_id);
  IF NOT (v_is_org_member OR public.is_mission_team_member(v_uid, p_project_id)) THEN
    RAISE EXCEPTION 'Accès réservé à l''équipe de la mission' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', mt.id,
    'project_id', mt.project_id,
    'user_id', mt.user_id,
    'role', mt.role,
    'permissions', mt.permissions,
    'created_at', mt.created_at,
    'display_name', p.display_name,
    'recruiter_headline', p.recruiter_headline,
    'is_external', NOT public.is_org_member(mt.user_id, v_project_org_id)
  )
  FROM public.mission_team mt
  LEFT JOIN public.profiles p ON p.user_id = mt.user_id
  WHERE mt.project_id = p_project_id
    AND (v_is_org_member OR mt.user_id = v_uid)
  ORDER BY mt.created_at, mt.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_mission_team_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mission_team_profiles(uuid) TO authenticated, service_role;

-- Plus aucune policy n'appelle cette fonction. Si une policy inconnue la
-- retenait encore, elle serait conservée avec un signalement dans le
-- journal, et partner_engagements_audit.sql échouerait sur son contrôle 14.
DO $c1_r7f$
BEGIN
  DROP FUNCTION IF EXISTS public.is_mission_team_member_for_candidate(uuid, text, uuid);
EXCEPTION WHEN dependent_objects_still_exist THEN
  RAISE WARNING 'C1/R7 : is_mission_team_member_for_candidate conservée : %', SQLERRM;
END
$c1_r7f$;

-- ---------------------------------------------------------------------
-- R7-b. Une ligne candidat ou une séquence ne porte que la mission de sa
-- propre organisation. Sans cela, un partenaire qui source depuis la page
-- de mission de l'entreprise (lisible pendant la transition) écrit chez lui
-- une ligne rattachée à cette mission : resolve_jcs_project_id complète
-- project_id depuis job_id, recompute_mission_stats la compte dans les
-- chiffres de l'entreprise. Policies RESTRICTIVE : elles s'ajoutent en ET à
-- toutes les permissives, quel que soit leur nom. Le WITH CHECK est évalué
-- après les déclencheurs BEFORE : l'insertion par job_id seul est couverte.
-- ---------------------------------------------------------------------
DO $c1_r7b$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['job_candidate_status', 'outreach_sequences'] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS mission_same_org_insert ON public.%I', v_table);
    EXECUTE format($f$
      CREATE POLICY mission_same_org_insert ON public.%I
        AS RESTRICTIVE FOR INSERT TO authenticated
        WITH CHECK (project_id IS NULL OR public.project_organization_id(project_id) = organization_id)
    $f$, v_table);
    EXECUTE format('DROP POLICY IF EXISTS mission_same_org_update ON public.%I', v_table);
    EXECUTE format($f$
      CREATE POLICY mission_same_org_update ON public.%I
        AS RESTRICTIVE FOR UPDATE TO authenticated
        USING (true)
        WITH CHECK (project_id IS NULL OR public.project_organization_id(project_id) = organization_id)
    $f$, v_table);
  END LOOP;
END
$c1_r7b$;

-- ---------------------------------------------------------------------
-- R7-c. Les chiffres d'une mission ne comptent que les lignes de son
-- organisation. recompute_mission_stats rapprochait les lignes par job_id
-- seul : une ligne d'une autre organisation qui porte l'identifiant de la
-- mission (écrite en clé de service, comme add-to-shortlist, ou avec un
-- project_id vers une mission à elle, que R7-b laisse passer) gonflait les
-- compteurs de l'entreprise. Corps de 20260702121429, avec l'organisation
-- dans la jointure, puis recalcul de toutes les missions pour retirer ce qui
-- a déjà été compté à tort. CREATE OR REPLACE garde les droits en place.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_mission_stats(p_mission_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH missions AS (
    SELECT id, job_id, organization_id
    FROM public.sourcing_projects
    WHERE id = ANY(p_mission_ids)
  ),
  jcs AS (
    SELECT
      CASE WHEN j.job_id LIKE 'project:%' THEN substring(j.job_id from 9) ELSE j.job_id END AS norm_job_id,
      j.organization_id,
      j.status,
      j.score
    FROM public.job_candidate_status j
  ),
  agg AS (
    SELECT
      m.id AS mission_id,
      count(j.*)::int AS total_found,
      count(*) FILTER (WHERE j.status = 'scored' OR j.score IS NOT NULL)::int AS scored,
      count(*) FILTER (WHERE j.status IN ('messaged', 'replied'))::int AS messaged,
      count(*) FILTER (WHERE j.status = 'dismissed')::int AS dismissed,
      count(*) FILTER (WHERE j.status = 'shortlisted')::int AS shortlisted
    FROM missions m
    LEFT JOIN jcs j
      ON j.organization_id = m.organization_id
     AND (j.norm_job_id = m.id::text
          OR (m.job_id IS NOT NULL AND j.norm_job_id = m.job_id))
    GROUP BY m.id
  )
  UPDATE public.sourcing_projects sp
  SET
    stats_total_found = agg.total_found,
    stats_scored = agg.scored,
    stats_messaged = agg.messaged,
    stats_dismissed = agg.dismissed,
    stats_shortlisted = agg.shortlisted
  FROM agg
  WHERE sp.id = agg.mission_id
    AND (sp.stats_total_found, sp.stats_scored, sp.stats_messaged, sp.stats_dismissed, sp.stats_shortlisted)
        IS DISTINCT FROM
        (agg.total_found, agg.scored, agg.messaged, agg.dismissed, agg.shortlisted);
$function$;

SELECT public.recompute_mission_stats(coalesce(array_agg(id), '{}'::uuid[]))
FROM public.sourcing_projects;

-- ---------------------------------------------------------------------
-- R7-d. Le rattachement automatique d'une ligne à une mission par
-- l'identifiant externe du poste (sourcing_projects.job_id, par exemple une
-- page de poste commune) ne choisit que parmi les missions de l'organisation
-- de la ligne. Sans cela, quand deux organisations suivent le même poste
-- externe, la ligne de l'une recevait la mission de l'autre, que R7-b
-- refuse ensuite : l'écriture légitime échouait. Le rattachement par
-- l'identifiant de la mission elle-même ('project:<uuid>' ou l'uuid) reste
-- sans filtre : R7-b refuse alors la ligne d'une autre organisation.
-- Corps de 20260702164207, une condition ajoutée.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_jcs_project_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_norm := CASE WHEN NEW.job_id LIKE 'project:%' THEN substring(NEW.job_id from 9) ELSE NEW.job_id END;
  SELECT sp.id INTO NEW.project_id
  FROM public.sourcing_projects sp
  WHERE sp.id::text = v_norm
     OR (sp.job_id IS NOT NULL AND sp.job_id = v_norm
         AND sp.organization_id IS NOT DISTINCT FROM NEW.organization_id)
  ORDER BY sp.created_at DESC
  LIMIT 1;
  RETURN NEW;
END;
$$;


-- =====================================================================
-- R11. Le rôle « Collaborateur » n'est plus proposé jusqu'au lot C2 : il
-- promettait un accès restreint et donnait tous les accès d'un membre. Le
-- refus est posé sur la table des invitations, pour couvrir tous les
-- chemins (send-team-invitation, outil d'invitation de l'assistant, clé de
-- service). Une invitation déjà envoyée reste acceptable : son acceptation
-- ne change que le statut. En production, la colonne valait 'collaborator'
-- par défaut (MIGRATION_CLEAN.sql) : elle passe à 'member', comme en base
-- neuve.
-- =====================================================================
DO $c1_r11$
BEGIN
  IF to_regclass('public.organization_invitations') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.organization_invitations ALTER COLUMN role SET DEFAULT 'member';
  CREATE OR REPLACE FUNCTION public.organization_invitations_role_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $f$
  BEGIN
    IF NEW.role = 'collaborator' THEN
      RAISE EXCEPTION 'Le rôle Collaborateur n''est pas encore disponible.'
        USING ERRCODE = '42501', HINT = 'COLLABORATOR_FROZEN';
    END IF;
    RETURN NEW;
  END;
  $f$;
  REVOKE EXECUTE ON FUNCTION public.organization_invitations_role_guard() FROM PUBLIC, anon, authenticated;
  DROP TRIGGER IF EXISTS organization_invitations_role_guard ON public.organization_invitations;
  CREATE TRIGGER organization_invitations_role_guard
    BEFORE INSERT OR UPDATE OF role ON public.organization_invitations
    FOR EACH ROW EXECUTE FUNCTION public.organization_invitations_role_guard();
END
$c1_r11$;


-- =====================================================================
-- D17. Marketplace gelée jusqu'au lot P2 (décision 17).
-- Publication : une session utilisateur ne fait plus entrer de mission sur
-- la Marketplace (mode chasse actif et statut publié ou en cours), ni par
-- save_hunt_mission_settings, ni par une écriture directe. La garde est
-- posée dans le déclencheur de publication, désormais levé aussi par un
-- changement de hunt_mode. Service role, migrations et crons (auth.uid()
-- nul) ne sont pas concernés, comme pour le contrôle de plan.
-- Validation d'un partenaire : validate_marketplace_partner refuse. Son
-- corps d'origine est dans 20260907053654, à reposer au lot P2.
-- Les refus portent le HINT MARKETPLACE_FROZEN.
-- L'invitation de partenaires ne passe par aucune fonction SQL (insertion
-- dans mission_invitations, puis accept-mission-invitation) : rien ici.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.sourcing_projects_hunt_publish_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Gel de la Marketplace (décision 17) : aucune mission n'y entre depuis
  -- une session utilisateur.
  IF auth.uid() IS NOT NULL
     AND coalesce(NEW.hunt_mode, false)
     AND NEW.hunt_status IN ('published', 'in_progress')
     AND (TG_OP = 'INSERT'
          OR NOT (coalesce(OLD.hunt_mode, false)
                  AND coalesce(OLD.hunt_status, '') IN ('published', 'in_progress'))) THEN
    RAISE EXCEPTION 'La publication sur la Marketplace n''est pas encore disponible.'
      USING ERRCODE = '42501', HINT = 'MARKETPLACE_FROZEN';
  END IF;

  -- Service role, migrations, crons (auth.uid() nul) : pas de restriction.
  -- L'insertion est couverte aussi : sans cela, une mission créée directement
  -- avec hunt_status = 'published' contourne le contrôle de plan.
  IF NEW.hunt_status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.hunt_status IS DISTINCT FROM 'published') THEN
    IF auth.uid() IS NOT NULL AND NOT public.can_publish_hunt_mission(NEW.organization_id) THEN
      RAISE EXCEPTION 'La publication sur la marketplace est disponible avec le plan Entreprise.'
        USING ERRCODE = '42501';
    END IF;
    -- Une mission publiée annonce une rémunération : sans elle, le recruteur
    -- postulerait sans condition commerciale.
    IF NEW.hunt_bounty_percent IS NULL THEN
      RAISE EXCEPTION 'Indiquez la rémunération avant de publier la mission';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Fonction de déclencheur : aucun appel client (le déclenchement ne demande
-- pas EXECUTE).
REVOKE EXECUTE ON FUNCTION public.sourcing_projects_hunt_publish_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sourcing_projects_hunt_publish_guard ON public.sourcing_projects;
CREATE TRIGGER sourcing_projects_hunt_publish_guard
  BEFORE INSERT OR UPDATE OF hunt_status, hunt_mode ON public.sourcing_projects
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_projects_hunt_publish_guard();

CREATE OR REPLACE FUNCTION public.validate_marketplace_partner(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'La validation des partenaires de la Marketplace n''est pas encore disponible.'
    USING ERRCODE = '42501', HINT = 'MARKETPLACE_FROZEN';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_marketplace_partner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_marketplace_partner(uuid) TO service_role;


-- =====================================================================
-- R13. Fonctions SECURITY DEFINER du schéma public : jamais PUBLIC, anon
-- seulement sur liste blanche (supabase/tests/rls_and_definer_audit.sql,
-- contrôle 3, qui la tient par signature ; ici par nom, les signatures des
-- fonctions propres à la production n'étant pas connues du dépôt).
--
-- 20260610140000 croyait couper PUBLIC pour les fonctions futures avec
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ... FROM PUBLIC.
-- Sans effet : un défaut par schéma ne fait que s'ajouter au défaut global
-- (documentation PostgreSQL, ALTER DEFAULT PRIVILEGES). Toute fonction créée
-- depuis sans REVOKE explicite reste exécutable par PUBLIC, donc par anon.
-- Le défaut global n'est pas changé. Dans l'image Supabase, les fonctions
-- d'extension appartiennent à supabase_admin et n'en seraient pas
-- affectées. En revanche, toute fonction créée ensuite par postgres
-- naîtrait sans EXECUTE pour authenticated comme pour anon (défaut par
-- schéma de 20260610120000), y compris un helper RLS SECURITY INVOKER. Un
-- GRANT oublié deviendrait un refus, et un refus sous SET ROLE dans un audit
-- psql fait tomber le Postgres de l'image (supautils). Le garde-fou reste
-- l'audit, et chaque migration révoque fonction par fonction.
--
-- 1. Pour chaque fonction en défaut : authenticated et service_role gardent
--    exactement leur droit d'avant (grant explicite s'ils l'avaient, même
--    par PUBLIC), puis PUBLIC et anon le perdent ; une fonction de la liste
--    blanche garde anon si elle l'avait.
-- 2. Fonctions internes (crons, recalcul, pixel sans appelant) : retirées
--    aussi à authenticated.
-- Les fonctions de déclencheur ne sont pas touchées : PostgreSQL refuse de
-- les appeler hors d'un déclencheur, et le droit n'est pas vérifié au
-- déclenchement. Au second passage, la boucle ne trouve plus rien.
-- =====================================================================
DO $c1_r13$
DECLARE
  r record;
  allowed text[] := ARRAY[
    'get_portal_by_token',
    'has_role', 'is_org_member', 'get_org_role', 'get_user_org_id',
    'is_mission_team_member', 'is_mission_team_member_for_project',
    'is_mission_team_member_for_candidate'
  ];
  internal text[] := ARRAY[
    'recompute_mission_stats',      -- déclencheur trg_sync_mission_stats et rattrapage
    'cleanup_search_failure_log',   -- cron cleanup-search-failure-log
    'invoke_agent_daily_digest',    -- cron agent-daily-digest (porte le secret des crons)
    'invoke_process_agent_tasks',   -- cron process-agent-tasks (idem)
    'get_email_tracking_by_id'      -- pixel : aucun appelant, sequence-email-track lit la table en service_role
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.prokind = 'f'
      AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND (
        p.proacl IS NULL
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        OR (has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT p.proname = ANY (allowed))
      )
  LOOP
    IF r.auth_x THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    IF r.svc_x THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.anon_x AND r.proname = ANY (allowed) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = ANY (internal)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$c1_r13$;

-- ---------------------------------------------------------------------
-- R13-b. Écritures anonymes. Le défaut de l'image Supabase donne à anon
-- INSERT, UPDATE, DELETE et TRUNCATE sur toute table du schéma public :
-- une policy sans clause TO ou une RLS oubliée ouvrait l'écriture à
-- n'importe qui, sans session. Seul parcours anonyme qui écrit dans une
-- table : le formulaire de contact de la page d'accueil (INSERT
-- contact_submissions). Le portail client, le portail candidat, la
-- désinscription, /r/:slug et /pricing lisent ou passent par des edge
-- functions (service_role) et des fonctions SECURITY DEFINER.
-- Tables existantes, puis défaut du schéma pour les tables futures créées
-- par le rôle qui applique les migrations.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

DO $c1_r13b$
BEGIN
  IF to_regclass('public.contact_submissions') IS NOT NULL THEN
    GRANT INSERT ON public.contact_submissions TO anon;
  END IF;
END
$c1_r13b$;
