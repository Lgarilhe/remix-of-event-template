-- Migration : lot M, marketplace en cercle fermé.
-- Spécification : docs/marketplace-base-konekt-plan-2026-09-07.md, section 3
-- (« Migration supabase/migrations/20260907053654_marketplace_partner_circle.sql »).
--
--   1. hunt_applications : une candidature par (mission, recruteur), statuts
--      contrôlés (pending, accepted, rejected, withdrawn, ended), colonnes
--      responded_at / responded_by, updated_at automatique. Lecture seule côté
--      client (le recruteur voit les siennes, l'organisation de la mission voit
--      celles de ses missions) ; toute écriture passe par les RPC ci-dessous.
--   2. feature_activations : une ligne par (organisation, fonctionnalité),
--      statuts contrôlés, colonnes requested_at / requested_by. Lecture par les
--      membres de l'organisation ; écritures par RPC ou service role.
--   3. sourcing_projects : les missions publiées ne sont plus lisibles par tout
--      utilisateur connecté, seulement par les partenaires validés
--      (marketplace_partner_select). Bornes sur hunt_bounty_percent (5 à 30)
--      et hunt_max_recruiters (1 à 10). Trigger de garde : publier exige une
--      organisation de type entreprise sur le plan Entreprise ou en essai.
--   4. RPC (SECURITY DEFINER, search_path vide, EXECUTE à authenticated et
--      service_role seulement) : is_marketplace_partner,
--      can_publish_hunt_mission, request_marketplace_partner,
--      get_marketplace_partner_state, get_open_hunt_missions,
--      apply_to_hunt_mission, withdraw_hunt_application,
--      get_my_hunt_applications, get_partner_missions, get_hunt_applicants,
--      respond_to_hunt_application, end_hunt_collaboration,
--      get_my_hunt_missions, get_mission_team_profiles.
--   5. Notifications dans l'application : nouvelle candidature (propriétaires
--      et administrateurs de l'entreprise) ; acceptation, refus et fin de
--      collaboration (le recruteur).
--
-- Idempotente, rejouable sans erreur.

-- ─── 1. hunt_applications ───
ALTER TABLE public.hunt_applications ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE public.hunt_applications ADD COLUMN IF NOT EXISTS responded_by uuid;

COMMENT ON COLUMN public.hunt_applications.responded_at IS
  'Date de la réponse de l''entreprise (acceptation, refus ou fin de collaboration).';
COMMENT ON COLUMN public.hunt_applications.responded_by IS
  'Utilisateur de l''entreprise qui a répondu.';

-- Dédoublonnage : une candidature par (mission, recruteur), la plus ancienne est conservée.
DELETE FROM public.hunt_applications
WHERE id IN (
  SELECT d.id
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY project_id, recruiter_user_id
                              ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.hunt_applications
  ) d
  WHERE d.rn > 1
);

DO $$
BEGIN
  -- Sur un environnement neuf, l'UNIQUE en ligne du CREATE TABLE d'origine
  -- existe déjà sous son nom par défaut : on ne double pas l'index.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hunt_applications'::regclass
      AND conname IN ('hunt_applications_project_recruiter_key',
                      'hunt_applications_project_id_recruiter_user_id_key')
  ) THEN
    ALTER TABLE public.hunt_applications
      ADD CONSTRAINT hunt_applications_project_recruiter_key
      UNIQUE (project_id, recruiter_user_id);
  END IF;

  -- Le CHECK d'origine ne connaît pas 'ended' : il est remplacé.
  ALTER TABLE public.hunt_applications DROP CONSTRAINT IF EXISTS hunt_applications_status_check;
  ALTER TABLE public.hunt_applications
    ADD CONSTRAINT hunt_applications_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'ended'));
END
$$;

DROP TRIGGER IF EXISTS trg_hunt_applications_updated_at ON public.hunt_applications;
CREATE TRIGGER trg_hunt_applications_updated_at
  BEFORE UPDATE ON public.hunt_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lecture : le recruteur voit ses candidatures, l'organisation de la mission
-- voit celles de ses missions. Écritures réservées aux RPC.
DROP POLICY IF EXISTS own_or_project_org ON public.hunt_applications;
DROP POLICY IF EXISTS hunt_applications_policy ON public.hunt_applications;
DROP POLICY IF EXISTS hunt_applications_select ON public.hunt_applications;
CREATE POLICY hunt_applications_select
  ON public.hunt_applications FOR SELECT TO authenticated
  USING (
    recruiter_user_id = auth.uid()
    OR public.is_org_member_for_project(auth.uid(), project_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.hunt_applications FROM anon, authenticated;
GRANT SELECT ON public.hunt_applications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hunt_applications TO service_role;

-- ─── 2. feature_activations ───
ALTER TABLE public.feature_activations ADD COLUMN IF NOT EXISTS requested_at timestamptz;
ALTER TABLE public.feature_activations ADD COLUMN IF NOT EXISTS requested_by uuid;

COMMENT ON COLUMN public.feature_activations.requested_at IS
  'Date de la demande d''activation (cercle partenaires : demande de rejoindre).';
COMMENT ON COLUMN public.feature_activations.requested_by IS
  'Utilisateur qui a fait la demande.';

-- Dédoublonnage : une ligne par (organisation, fonctionnalité), la plus ancienne est conservée.
DELETE FROM public.feature_activations
WHERE id IN (
  SELECT d.id
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY organization_id, feature
                              ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.feature_activations
  ) d
  WHERE d.rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.feature_activations'::regclass
      AND conname IN ('feature_activations_org_feature_key',
                      'feature_activations_organization_id_feature_key')
  ) THEN
    ALTER TABLE public.feature_activations
      ADD CONSTRAINT feature_activations_org_feature_key
      UNIQUE (organization_id, feature);
  END IF;

  ALTER TABLE public.feature_activations DROP CONSTRAINT IF EXISTS feature_activations_status_check;
  ALTER TABLE public.feature_activations
    ADD CONSTRAINT feature_activations_status_check
    CHECK (status IN ('inactive', 'pending_validation', 'active', 'suspended'));
END
$$;

DROP POLICY IF EXISTS org_members_all ON public.feature_activations;
DROP POLICY IF EXISTS feature_activations_policy ON public.feature_activations;
DROP POLICY IF EXISTS feature_activations_select ON public.feature_activations;
CREATE POLICY feature_activations_select
  ON public.feature_activations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

REVOKE INSERT, UPDATE, DELETE ON public.feature_activations FROM anon, authenticated;
GRANT SELECT ON public.feature_activations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_activations TO service_role;

-- ─── 2 ter. profiles : forme de l'adresse LinkedIn ───
-- Le champ est affiché en lien cliquable (candidatures, profil public) et
-- reste modifiable en direct par son propriétaire : la forme est contrainte
-- en base, et les lectures filtrent aussi (get_hunt_applicants).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE linkedin_url IS NOT NULL
      AND linkedin_url !~* '^https://([a-z0-9-]+\.)?linkedin\.com/'
  ) THEN
    RAISE NOTICE 'profiles_linkedin_url_check non posé, profils à corriger : %',
      (SELECT array_agg(user_id) FROM public.profiles
       WHERE linkedin_url IS NOT NULL
         AND linkedin_url !~* '^https://([a-z0-9-]+\.)?linkedin\.com/');
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_linkedin_url_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_linkedin_url_check
      CHECK (linkedin_url IS NULL OR linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/');
  END IF;
END $$;

-- ─── 2 bis. mission_team : unicité (mission, membre) ───
-- Le schéma de prod a perdu cette contrainte à l'import : sans elle,
-- l'acceptation d'un partenaire échoue (ON CONFLICT sans contrainte).
DELETE FROM public.mission_team a
USING public.mission_team b
WHERE a.project_id = b.project_id
  AND a.user_id = b.user_id
  AND (a.created_at, a.id) > (b.created_at, b.id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mission_team'::regclass
      AND contype = 'u'
      AND conkey @> (
        SELECT array_agg(attnum ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = 'public.mission_team'::regclass
          AND attname IN ('project_id', 'user_id')
      )
  ) THEN
    ALTER TABLE public.mission_team
      ADD CONSTRAINT mission_team_project_user_key UNIQUE (project_id, user_id);
  END IF;
END $$;

-- ─── 3. sourcing_projects : bornes du mode chasse ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sourcing_projects
    WHERE hunt_bounty_percent IS NOT NULL
      AND (hunt_bounty_percent < 5 OR hunt_bounty_percent > 30)
  ) THEN
    RAISE NOTICE 'sourcing_projects_hunt_bounty_check non posé, missions hors de 5 à 30 : %',
      (SELECT array_agg(id) FROM public.sourcing_projects
       WHERE hunt_bounty_percent IS NOT NULL AND (hunt_bounty_percent < 5 OR hunt_bounty_percent > 30));
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sourcing_projects'::regclass
      AND conname = 'sourcing_projects_hunt_bounty_check'
  ) THEN
    ALTER TABLE public.sourcing_projects
      ADD CONSTRAINT sourcing_projects_hunt_bounty_check
      CHECK (hunt_bounty_percent IS NULL OR (hunt_bounty_percent >= 5 AND hunt_bounty_percent <= 30));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sourcing_projects
    WHERE hunt_max_recruiters IS NOT NULL
      AND (hunt_max_recruiters < 1 OR hunt_max_recruiters > 10)
  ) THEN
    RAISE NOTICE 'sourcing_projects_hunt_max_recruiters_check non posé, missions hors de 1 à 10 : %',
      (SELECT array_agg(id) FROM public.sourcing_projects
       WHERE hunt_max_recruiters IS NOT NULL AND (hunt_max_recruiters < 1 OR hunt_max_recruiters > 10));
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sourcing_projects'::regclass
      AND conname = 'sourcing_projects_hunt_max_recruiters_check'
  ) THEN
    ALTER TABLE public.sourcing_projects
      ADD CONSTRAINT sourcing_projects_hunt_max_recruiters_check
      CHECK (hunt_max_recruiters IS NULL OR (hunt_max_recruiters >= 1 AND hunt_max_recruiters <= 10));
  END IF;
END
$$;

-- ─── 4. Helpers appelés par les policies et le trigger ───

-- Partenaire validé : membre d'une organisation dont l'activation
-- marketplace_recruit est active.
CREATE OR REPLACE FUNCTION public.is_marketplace_partner(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.feature_activations fa
    JOIN public.organization_members om
      ON om.organization_id = fa.organization_id
     AND om.user_id = _user_id
    WHERE fa.feature = 'marketplace_recruit'
      AND fa.status = 'active'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_marketplace_partner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_marketplace_partner(uuid) TO authenticated, service_role;

-- Publication : organisation de type entreprise, sur le plan Entreprise ou en
-- essai non expiré. Plan effectif calculé ici (même règle que
-- get_subscription_state, sans contrôle de l'appelant).
CREATE OR REPLACE FUNCTION public.can_publish_hunt_mission(_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_type text;
  v_plan_id text;
  v_status text;
  v_trial_ends_at timestamptz;
  v_effective_plan_id text;
BEGIN
  SELECT o.org_type, s.plan_id, s.status, s.trial_ends_at
  INTO v_org_type, v_plan_id, v_status, v_trial_ends_at
  FROM public.organizations o
  LEFT JOIN public.organization_subscriptions s ON s.organization_id = o.id
  WHERE o.id = _organization_id
  LIMIT 1;

  IF NOT FOUND OR v_org_type IS DISTINCT FROM 'enterprise' THEN
    RETURN false;
  END IF;

  v_effective_plan_id := CASE
    WHEN v_plan_id IS NULL THEN 'free'
    WHEN v_status IN ('canceled', 'unpaid') THEN 'free'
    WHEN v_status = 'trialing' AND v_trial_ends_at IS NOT NULL AND v_trial_ends_at < now() THEN 'free'
    ELSE v_plan_id
  END;

  RETURN v_effective_plan_id IN ('entreprise', 'enterprise')
    OR (v_status = 'trialing' AND (v_trial_ends_at IS NULL OR v_trial_ends_at >= now()));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_publish_hunt_mission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_publish_hunt_mission(uuid) TO authenticated, service_role;

-- ─── 5. sourcing_projects : lecture par les partenaires, garde de publication ───
DROP POLICY IF EXISTS public_hunt_select ON public.sourcing_projects;
DROP POLICY IF EXISTS "Public can view published hunt missions" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Authenticated can view published hunt missions" ON public.sourcing_projects;
-- Aucune policy de lecture directe pour les partenaires : une policy ouvre la
-- ligne entière (notes, description, filtres, statistiques) à des cabinets
-- concurrents. Les missions ouvertes passent par get_open_hunt_missions, qui
-- ne projette que les champs de la carte ; un partenaire accepté garde l'accès
-- à la mission par mission_team_select.
DROP POLICY IF EXISTS marketplace_partner_select ON public.sourcing_projects;

CREATE OR REPLACE FUNCTION public.sourcing_projects_hunt_publish_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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

-- Fonction de trigger : aucun appel client (le déclenchement ne demande pas EXECUTE).
REVOKE EXECUTE ON FUNCTION public.sourcing_projects_hunt_publish_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sourcing_projects_hunt_publish_guard ON public.sourcing_projects;
CREATE TRIGGER sourcing_projects_hunt_publish_guard
  BEFORE INSERT OR UPDATE OF hunt_status ON public.sourcing_projects
  FOR EACH ROW EXECUTE FUNCTION public.sourcing_projects_hunt_publish_guard();

-- ─── 6. Cercle partenaires : état et demande ───
CREATE OR REPLACE FUNCTION public.get_marketplace_partner_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_type text;
  v_role text;
  v_fa public.feature_activations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.get_user_org_id(v_uid);
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'inactive',
      'requested_at', NULL,
      'validated_at', NULL,
      'org_type', NULL,
      'can_request', false
    );
  END IF;

  SELECT o.org_type INTO v_org_type FROM public.organizations o WHERE o.id = v_org_id;
  v_role := public.get_org_role(v_uid, v_org_id);

  SELECT * INTO v_fa
  FROM public.feature_activations fa
  WHERE fa.organization_id = v_org_id AND fa.feature = 'marketplace_recruit'
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', coalesce(v_fa.status, 'inactive'),
    'requested_at', v_fa.requested_at,
    'validated_at', v_fa.validated_at,
    'org_type', v_org_type,
    'can_request', coalesce(v_org_type IN ('agency', 'freelance') AND v_role IN ('owner', 'admin'), false)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_marketplace_partner_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketplace_partner_state() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_marketplace_partner(
  p_headline text,
  p_bio text,
  p_specializations text[],
  p_linkedin_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_type text;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.get_user_org_id(v_uid);
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Aucune organisation active' USING ERRCODE = '42501';
  END IF;

  v_role := public.get_org_role(v_uid, v_org_id);
  IF coalesce(v_role, '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;

  SELECT o.org_type INTO v_org_type FROM public.organizations o WHERE o.id = v_org_id;
  IF coalesce(v_org_type, '') NOT IN ('agency', 'freelance') THEN
    RAISE EXCEPTION 'Le cercle partenaires est réservé aux cabinets et aux recruteurs indépendants'
      USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(coalesce(p_headline, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_bio, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Indiquez un titre et une présentation' USING ERRCODE = '22023';
  END IF;

  -- L'adresse est affichée en lien cliquable à l'entreprise : seul un lien
  -- LinkedIn en https est accepté (aucun autre schéma, notamment javascript:).
  IF nullif(btrim(p_linkedin_url), '') IS NOT NULL
     AND btrim(p_linkedin_url) !~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^[:space:]]*$' THEN
    RAISE EXCEPTION 'Adresse LinkedIn invalide' USING ERRCODE = '22023';
  END IF;

  -- Fiche recruteur montrée à l'entreprise lors d'une candidature. Un champ
  -- laissé vide ne remplace pas la valeur déjà enregistrée : un appel
  -- incomplet ne doit pas effacer la fiche d'un partenaire actif.
  UPDATE public.profiles
  SET recruiter_headline = coalesce(nullif(btrim(p_headline), ''), recruiter_headline),
      recruiter_bio = coalesce(nullif(btrim(p_bio), ''), recruiter_bio),
      specializations = coalesce(nullif(p_specializations, '{}'), specializations),
      linkedin_url = coalesce(nullif(btrim(p_linkedin_url), ''), linkedin_url)
  WHERE user_id = v_uid;

  -- Une ligne déjà active ou suspendue n'est pas modifiée : son état est renvoyé tel quel.
  INSERT INTO public.feature_activations AS fa (organization_id, feature, status, requested_at, requested_by)
  VALUES (v_org_id, 'marketplace_recruit', 'pending_validation', now(), v_uid)
  ON CONFLICT (organization_id, feature) DO UPDATE
    SET status = 'pending_validation',
        requested_at = now(),
        requested_by = v_uid,
        updated_at = now()
    WHERE coalesce(fa.status, 'inactive') NOT IN ('active', 'suspended');

  RETURN public.get_marketplace_partner_state();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_marketplace_partner(text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_marketplace_partner(text, text, text[], text) TO authenticated, service_role;

-- ─── 7. Côté partenaire : missions ouvertes, candidature, retrait ───

-- Missions ouvertes aux candidatures, hors organisations de l'appelant.
-- Non partenaire : aucune ligne.
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
    'name', sp.name,
    'client_name', sp.client_name,
    'job_details', sp.job_details,
    'hunt_bounty_percent', sp.hunt_bounty_percent,
    'hunt_max_recruiters', sp.hunt_max_recruiters,
    'hunt_deadline', sp.hunt_deadline,
    'hunt_status', sp.hunt_status,
    'created_at', sp.created_at,
    'organization_id', sp.organization_id,
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

CREATE OR REPLACE FUNCTION public.apply_to_hunt_mission(p_project_id uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_project public.sourcing_projects;
  v_accepted integer;
  v_app_id uuid;
  v_recruiter_name text;
  v_recruiter_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  -- Organisation au titre de laquelle le recruteur postule : celle qui a été
  -- validée par Konekt, pas l'organisation active du profil (un utilisateur
  -- peut appartenir à plusieurs organisations).
  SELECT fa.organization_id INTO v_org_id
  FROM public.feature_activations fa
  JOIN public.organization_members om
    ON om.organization_id = fa.organization_id AND om.user_id = v_uid
  WHERE fa.feature = 'marketplace_recruit'
    AND fa.status = 'active'
  ORDER BY (fa.organization_id = public.get_user_org_id(v_uid)) DESC, fa.validated_at NULLS LAST
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Accès réservé aux partenaires du cercle' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_project FROM public.sourcing_projects sp WHERE sp.id = p_project_id;
  IF NOT FOUND OR coalesce(v_project.hunt_mode, false) = false THEN
    RAISE EXCEPTION 'Mission introuvable';
  END IF;

  IF public.is_org_member(v_uid, v_project.organization_id) THEN
    RAISE EXCEPTION 'Vous ne pouvez pas postuler à une mission de votre organisation'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_project.hunt_status, '') NOT IN ('published', 'in_progress')
     OR (v_project.hunt_deadline IS NOT NULL AND v_project.hunt_deadline::date < current_date) THEN
    RAISE EXCEPTION 'Cette mission n''accepte plus de candidature';
  END IF;

  SELECT count(*) INTO v_accepted
  FROM public.hunt_applications ha
  WHERE ha.project_id = p_project_id AND ha.status = 'accepted';
  IF v_accepted >= coalesce(v_project.hunt_max_recruiters, 3) THEN
    RAISE EXCEPTION 'Le nombre maximal de recruteurs est atteint';
  END IF;

  -- Une candidature retirée, refusée ou terminée peut être renouvelée : la
  -- ligne est réutilisée. Une candidature en attente ou acceptée bloque.
  -- Le message est borné : il est affiché tel quel à l'entreprise.
  INSERT INTO public.hunt_applications (project_id, recruiter_user_id, recruiter_org_id, status, message)
  VALUES (p_project_id, v_uid, v_org_id, 'pending', left(nullif(btrim(p_message), ''), 2000))
  ON CONFLICT (project_id, recruiter_user_id) DO UPDATE
    SET status = 'pending',
        message = excluded.message,
        recruiter_org_id = excluded.recruiter_org_id,
        responded_at = NULL,
        responded_by = NULL,
        updated_at = now()
    WHERE public.hunt_applications.status IN ('withdrawn', 'rejected', 'ended')
  RETURNING id INTO v_app_id;

  IF v_app_id IS NULL THEN
    RAISE EXCEPTION 'Vous avez déjà postulé à cette mission';
  END IF;

  -- Notification aux propriétaires et administrateurs de l'entreprise.
  SELECT p.display_name INTO v_recruiter_name FROM public.profiles p WHERE p.user_id = v_uid;
  v_recruiter_name := coalesce(nullif(btrim(v_recruiter_name), ''), 'Un recruteur');
  SELECT o.name INTO v_recruiter_org_name FROM public.organizations o WHERE o.id = v_org_id;

  INSERT INTO public.notifications (user_id, organization_id, type, title, body, link, metadata)
  SELECT m.user_id,
         v_project.organization_id,
         'info',
         'Nouvelle candidature',
         v_recruiter_name
           || CASE WHEN v_recruiter_org_name IS NULL THEN '' ELSE ' (' || v_recruiter_org_name || ')' END
           || ' souhaite chasser sur ' || v_project.name,
         '/missions/' || v_project.id::text || '?tab=config',
         jsonb_build_object('source', 'marketplace', 'application_id', v_app_id, 'project_id', v_project.id)
  FROM public.organization_members m
  WHERE m.organization_id = v_project.organization_id
    AND (
      m.role IN ('owner', 'admin')
      -- Organisation sans propriétaire ni administrateur : tous les membres
      -- sont prévenus, sinon la candidature reste invisible.
      OR NOT EXISTS (
        SELECT 1 FROM public.organization_members m2
        WHERE m2.organization_id = v_project.organization_id
          AND m2.role IN ('owner', 'admin')
      )
    );

  RETURN v_app_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_to_hunt_mission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_hunt_mission(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.withdraw_hunt_application(p_application_id uuid)
RETURNS void
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

  UPDATE public.hunt_applications
  SET status = 'withdrawn',
      updated_at = now()
  WHERE id = p_application_id
    AND recruiter_user_id = v_uid
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cette candidature ne peut plus être retirée';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.withdraw_hunt_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_hunt_application(uuid) TO authenticated, service_role;

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
    'mission_name', sp.name,
    'client_name', sp.client_name,
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

-- Missions où l'appelant est dans l'équipe sans être membre de l'organisation.
CREATE OR REPLACE FUNCTION public.get_partner_missions()
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
    'id', sp.id,
    'name', sp.name,
    'client_name', sp.client_name,
    'job_title', coalesce(sp.job_details->>'title', sp.job_title),
    'hunt_status', sp.hunt_status,
    'hunt_bounty_percent', sp.hunt_bounty_percent,
    'organization_name', o.name,
    'created_at', sp.created_at
  )
  FROM public.mission_team mt
  JOIN public.sourcing_projects sp ON sp.id = mt.project_id
  LEFT JOIN public.organizations o ON o.id = sp.organization_id
  WHERE mt.user_id = v_uid
    AND NOT public.is_org_member(v_uid, sp.organization_id)
  ORDER BY sp.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_partner_missions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_missions() TO authenticated, service_role;

-- ─── 8. Côté entreprise : candidatures, réponse, fin de collaboration ───
CREATE OR REPLACE FUNCTION public.get_hunt_applicants(p_project_id uuid)
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

  IF NOT public.is_org_member_for_project(v_uid, p_project_id) THEN
    RAISE EXCEPTION 'Accès réservé aux membres de l''organisation' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', ha.id,
    'recruiter_user_id', ha.recruiter_user_id,
    'recruiter_org_id', ha.recruiter_org_id,
    'status', ha.status,
    'message', ha.message,
    'created_at', ha.created_at,
    'responded_at', ha.responded_at,
    'display_name', p.display_name,
    'recruiter_headline', p.recruiter_headline,
    'recruiter_bio', p.recruiter_bio,
    'specializations', p.specializations,
    'linkedin_url', CASE
      WHEN p.linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^[:space:]]*$' THEN p.linkedin_url
      ELSE NULL
    END,
    'years_experience', p.years_experience,
    'placements_count', p.placements_count,
    'rating', p.rating,
    'organization_name', o.name,
    'org_type', o.org_type
  )
  FROM public.hunt_applications ha
  LEFT JOIN public.profiles p ON p.user_id = ha.recruiter_user_id
  LEFT JOIN public.organizations o ON o.id = ha.recruiter_org_id
  WHERE ha.project_id = p_project_id
  ORDER BY ha.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hunt_applicants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hunt_applicants(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.respond_to_hunt_application(p_application_id uuid, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app public.hunt_applications;
  v_project public.sourcing_projects;
  v_accepted integer;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  IF coalesce(p_decision, '') NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Décision inconnue';
  END IF;

  SELECT * INTO v_app FROM public.hunt_applications ha WHERE ha.id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidature introuvable';
  END IF;

  -- Verrou sur la mission : le comptage des acceptés se fait sans concurrence.
  SELECT * INTO v_project FROM public.sourcing_projects sp WHERE sp.id = v_app.project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission introuvable';
  END IF;

  IF coalesce(public.get_org_role(v_uid, v_project.organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;

  IF v_app.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Cette candidature n''est plus en attente';
  END IF;

  SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = v_project.organization_id;
  v_org_name := coalesce(v_org_name, 'L''entreprise');

  IF p_decision = 'accepted' THEN
    IF coalesce(v_project.hunt_status, '') NOT IN ('published', 'in_progress') THEN
      RAISE EXCEPTION 'Cette mission n''accepte plus de candidature';
    END IF;

    SELECT count(*) INTO v_accepted
    FROM public.hunt_applications ha
    WHERE ha.project_id = v_project.id AND ha.status = 'accepted';
    IF v_accepted >= coalesce(v_project.hunt_max_recruiters, 3) THEN
      RAISE EXCEPTION 'Le nombre maximal de recruteurs est atteint';
    END IF;

    INSERT INTO public.mission_team (project_id, user_id, role, permissions)
    VALUES (
      v_project.id,
      v_app.recruiter_user_id,
      'freelance',
      '{"can_edit_brief": false, "can_source": true, "can_submit": true}'::jsonb
    )
    ON CONFLICT (project_id, user_id) DO NOTHING;

    UPDATE public.hunt_applications
    SET status = 'accepted',
        responded_at = now(),
        responded_by = v_uid,
        updated_at = now()
    WHERE id = v_app.id;

    IF v_project.hunt_status = 'published' THEN
      UPDATE public.sourcing_projects
      SET hunt_status = 'in_progress',
          updated_at = now()
      WHERE id = v_project.id;
      v_project.hunt_status := 'in_progress';
    END IF;

    INSERT INTO public.notifications (user_id, organization_id, type, title, body, link, metadata)
    VALUES (
      v_app.recruiter_user_id,
      v_app.recruiter_org_id,
      'success',
      'Candidature acceptée',
      v_org_name || ' a accepté votre candidature sur ' || v_project.name
        || '. La mission est disponible dans vos missions partenaires.',
      '/missions/' || v_project.id::text,
      jsonb_build_object('source', 'marketplace', 'application_id', v_app.id, 'project_id', v_project.id)
    );

    RETURN jsonb_build_object('status', 'accepted', 'hunt_status', v_project.hunt_status);
  END IF;

  -- Refus.
  UPDATE public.hunt_applications
  SET status = 'rejected',
      responded_at = now(),
      responded_by = v_uid,
      updated_at = now()
  WHERE id = v_app.id;

  INSERT INTO public.notifications (user_id, organization_id, type, title, body, link, metadata)
  VALUES (
    v_app.recruiter_user_id,
    v_app.recruiter_org_id,
    'info',
    'Candidature non retenue',
    v_org_name || ' n''a pas retenu votre candidature sur ' || v_project.name || '.',
    '/marketplace',
    jsonb_build_object('source', 'marketplace', 'application_id', v_app.id, 'project_id', v_project.id)
  );

  RETURN jsonb_build_object('status', 'rejected', 'hunt_status', v_project.hunt_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_to_hunt_application(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_hunt_application(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.end_hunt_collaboration(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app public.hunt_applications;
  v_project public.sourcing_projects;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_app FROM public.hunt_applications ha WHERE ha.id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidature introuvable';
  END IF;

  SELECT * INTO v_project FROM public.sourcing_projects sp WHERE sp.id = v_app.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission introuvable';
  END IF;

  IF coalesce(public.get_org_role(v_uid, v_project.organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;

  IF v_app.status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'Cette collaboration n''est pas en cours';
  END IF;

  DELETE FROM public.mission_team
  WHERE project_id = v_project.id AND user_id = v_app.recruiter_user_id;

  UPDATE public.hunt_applications
  SET status = 'ended',
      responded_at = now(),
      responded_by = v_uid,
      updated_at = now()
  WHERE id = v_app.id;

  SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = v_project.organization_id;

  INSERT INTO public.notifications (user_id, organization_id, type, title, body, link, metadata)
  VALUES (
    v_app.recruiter_user_id,
    v_app.recruiter_org_id,
    'info',
    'Collaboration terminée',
    coalesce(v_org_name, 'L''entreprise') || ' a mis fin à votre collaboration sur ' || v_project.name || '.',
    '/marketplace',
    jsonb_build_object('source', 'marketplace', 'application_id', v_app.id, 'project_id', v_project.id)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.end_hunt_collaboration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_hunt_collaboration(uuid) TO authenticated, service_role;

-- Missions en mode chasse de l'organisation active de l'appelant, avec le
-- nombre de candidatures en attente et de recruteurs acceptés.
CREATE OR REPLACE FUNCTION public.get_my_hunt_missions()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  v_org_id := public.get_user_org_id(v_uid);
  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', sp.id,
    'name', sp.name,
    'client_name', sp.client_name,
    'job_title', coalesce(sp.job_details->>'title', sp.job_title),
    'hunt_status', sp.hunt_status,
    'hunt_bounty_percent', sp.hunt_bounty_percent,
    'hunt_max_recruiters', sp.hunt_max_recruiters,
    'hunt_deadline', sp.hunt_deadline,
    'pending_count', (
      SELECT count(*) FROM public.hunt_applications ha
      WHERE ha.project_id = sp.id AND ha.status = 'pending'
    ),
    'accepted_count', (
      SELECT count(*) FROM public.hunt_applications ha
      WHERE ha.project_id = sp.id AND ha.status = 'accepted'
    )
  )
  FROM public.sourcing_projects sp
  WHERE sp.organization_id = v_org_id
    AND sp.hunt_mode = true
  ORDER BY sp.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_hunt_missions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_hunt_missions() TO authenticated, service_role;

-- ─── 9. Équipe mission avec noms (membres internes et partenaires) ───
CREATE OR REPLACE FUNCTION public.get_mission_team_profiles(p_project_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_project_org_id uuid;
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

  IF NOT (public.is_org_member_for_project(v_uid, p_project_id)
          OR public.is_mission_team_member(v_uid, p_project_id)) THEN
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
  ORDER BY mt.created_at, mt.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_mission_team_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mission_team_profiles(uuid) TO authenticated, service_role;

-- ─── 10. Côté entreprise : réglages et statut de la mission ───
-- Ces deux fonctions remplacent les écritures directes de l'écran de
-- configuration : elles vérifient le rôle (propriétaire ou administrateur),
-- appliquent les bornes commerciales et ferment les candidatures en attente
-- quand la mission quitte la marketplace.

CREATE OR REPLACE FUNCTION public.save_hunt_mission_settings(
  p_project_id uuid,
  p_bounty numeric,
  p_max_recruiters integer,
  p_deadline timestamptz,
  p_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_project public.sourcing_projects;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_project FROM public.sourcing_projects sp WHERE sp.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission introuvable';
  END IF;

  v_role := public.get_org_role(v_uid, v_project.organization_id);
  IF coalesce(v_role, '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;

  IF p_bounty IS NULL OR p_bounty < 5 OR p_bounty > 30 THEN
    RAISE EXCEPTION 'La rémunération doit être comprise entre 5 %% et 30 %% du salaire annuel';
  END IF;
  IF p_max_recruiters IS NULL OR p_max_recruiters < 1 OR p_max_recruiters > 10 THEN
    RAISE EXCEPTION 'Le nombre de recruteurs doit être compris entre 1 et 10';
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline::date < current_date THEN
    RAISE EXCEPTION 'La date limite ne peut pas être dans le passé';
  END IF;

  UPDATE public.sourcing_projects
  SET hunt_mode = true,
      hunt_bounty_percent = p_bounty,
      hunt_max_recruiters = p_max_recruiters,
      hunt_deadline = p_deadline,
      hunt_status = CASE
        WHEN p_publish AND coalesce(hunt_status, 'draft') = 'draft' THEN 'published'
        ELSE coalesce(hunt_status, 'draft')
      END,
      updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_project;

  RETURN jsonb_build_object('hunt_status', v_project.hunt_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_hunt_mission_settings(uuid, numeric, integer, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_hunt_mission_settings(uuid, numeric, integer, timestamptz, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_hunt_mission_status(p_project_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_project public.sourcing_projects;
  v_role text;
  v_org_name text;
  v_closed integer := 0;
  v_title text;
  v_body text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('enabled', 'draft', 'filled', 'cancelled', 'disabled') THEN
    RAISE EXCEPTION 'Statut inconnu';
  END IF;

  SELECT * INTO v_project FROM public.sourcing_projects sp WHERE sp.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission introuvable';
  END IF;

  v_role := public.get_org_role(v_uid, v_project.organization_id);
  IF coalesce(v_role, '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;

  SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = v_project.organization_id;

  IF p_status = 'enabled' THEN
    UPDATE public.sourcing_projects
    SET hunt_mode = true,
        hunt_status = coalesce(hunt_status, 'draft'),
        updated_at = now()
    WHERE id = p_project_id
    RETURNING * INTO v_project;
    RETURN jsonb_build_object('hunt_status', v_project.hunt_status, 'hunt_mode', true, 'closed', 0);
  END IF;

  -- La mission quitte la marketplace : les candidatures en attente sont
  -- closes et leurs auteurs prévenus, sinon ils attendent une réponse qui
  -- ne viendra jamais.
  v_title := CASE p_status
    WHEN 'filled' THEN 'Mission pourvue'
    WHEN 'cancelled' THEN 'Mission annulée'
    ELSE 'Mission retirée de la marketplace'
  END;
  v_body := coalesce(v_org_name, 'L''entreprise') || ' ne recherche plus de recruteur sur ' || v_project.name || '.';

  WITH closed AS (
    UPDATE public.hunt_applications ha
    SET status = 'rejected',
        responded_at = now(),
        responded_by = v_uid,
        updated_at = now()
    WHERE ha.project_id = p_project_id
      AND ha.status = 'pending'
    RETURNING ha.id, ha.recruiter_user_id, ha.recruiter_org_id
  ),
  notified AS (
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, link, metadata)
    SELECT c.recruiter_user_id, c.recruiter_org_id, 'info', v_title, v_body, '/marketplace',
           jsonb_build_object('source', 'marketplace', 'application_id', c.id, 'project_id', p_project_id)
    FROM closed c
    RETURNING 1
  )
  SELECT count(*) INTO v_closed FROM closed;

  UPDATE public.sourcing_projects
  SET hunt_mode = CASE WHEN p_status = 'disabled' THEN false ELSE hunt_mode END,
      hunt_status = CASE WHEN p_status = 'disabled' THEN NULL ELSE p_status END,
      updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_project;

  RETURN jsonb_build_object(
    'hunt_status', v_project.hunt_status,
    'hunt_mode', v_project.hunt_mode,
    'closed', v_closed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_hunt_mission_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hunt_mission_status(uuid, text) TO authenticated, service_role;

-- ─── 11. Validation d'un partenaire sans la fonction d'administration ───
-- Repli documenté quand le secret KONEKT_PLATFORM_ADMIN_USER_IDS n'est pas
-- posé : même effet que l'action de l'écran (statut et notification).
CREATE OR REPLACE FUNCTION public.validate_marketplace_partner(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous text;
  v_notified integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Réservé à l''équipe Konekt' USING ERRCODE = '42501';
  END IF;

  SELECT fa.status INTO v_previous
  FROM public.feature_activations fa
  WHERE fa.organization_id = p_organization_id AND fa.feature = 'marketplace_recruit';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune demande pour cette organisation';
  END IF;

  UPDATE public.feature_activations
  SET status = 'active', validated_at = now(), updated_at = now()
  WHERE organization_id = p_organization_id AND feature = 'marketplace_recruit';

  IF coalesce(v_previous, '') <> 'active' THEN
    WITH cible AS (
      SELECT m.user_id
      FROM public.organization_members m
      WHERE m.organization_id = p_organization_id
        AND (
          m.role IN ('owner', 'admin')
          OR NOT EXISTS (
            SELECT 1 FROM public.organization_members m2
            WHERE m2.organization_id = p_organization_id AND m2.role IN ('owner', 'admin')
          )
        )
    ),
    ins AS (
      INSERT INTO public.notifications (user_id, organization_id, type, title, body, link, metadata)
      SELECT c.user_id, p_organization_id, 'success', 'Bienvenue dans le cercle partenaires',
             'Votre organisation peut maintenant consulter les missions publiées et postuler.',
             '/marketplace', jsonb_build_object('source', 'marketplace', 'feature', 'marketplace_recruit')
      FROM cible c
      RETURNING 1
    )
    SELECT count(*) INTO v_notified FROM ins;
  END IF;

  RETURN jsonb_build_object('status', 'active', 'notified', v_notified);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_marketplace_partner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_marketplace_partner(uuid) TO service_role;
