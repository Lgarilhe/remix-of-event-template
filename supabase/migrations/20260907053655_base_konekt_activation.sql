-- Migration : lot K, Base Konekt en libre-service.
-- Spécification : docs/marketplace-base-konekt-plan-2026-09-07.md, section 4
-- (« Migration supabase/migrations/20260907053655_base_konekt_activation.sql »).
--
--   1. subscription_plans : quota de recherches incluses par mois civil
--      (limits.database_searches_included) et ligne de features lisible sur la
--      page tarifs. 0 sur free et solo, 100 sur cabinet et pro, 300 sur
--      entreprise et enterprise.
--   2. organization_integrations : coresignal_activated_at et
--      coresignal_activated_by, trace de qui a ouvert l'accès et quand.
--   3. Table base_konekt_usage : une ligne par page d'aperçu ou par fiche,
--      incluse au forfait ou facturée en crédits. Lecture par les membres de
--      l'organisation, écritures réservées au service role.
--   4. RPC (SECURITY DEFINER, search_path vide) :
--      - get_base_konekt_state / set_base_konekt_enabled, pour le front
--        (EXECUTE à authenticated et service_role) ;
--      - reserve_base_konekt_included / record_base_konekt_usage /
--        release_base_konekt_usage, pour l'edge function coresignal-search
--        (EXECUTE au service role seulement).
--
-- Le plan effectif est recalculé ici plutôt que lu par get_subscription_state,
-- qui contrôle l'appelant et écrit (expiration paresseuse de l'essai) : même
-- règle que can_publish_hunt_mission du lot M.
--
-- Idempotente, rejouable sans erreur.

-- ─── 1. subscription_plans : quota inclus par plan ───
-- pro et enterprise sont les anciens identifiants de cabinet et entreprise :
-- ils gardent le même quota tant que des organisations y sont rattachées.
UPDATE public.subscription_plans p
SET limits = p.limits || jsonb_build_object('database_searches_included', q.quota)
FROM (VALUES
  ('free'::text, 0),
  ('solo', 0),
  ('cabinet', 100),
  ('pro', 100),
  ('entreprise', 300),
  ('enterprise', 300)
) AS q(id, quota)
WHERE p.id = q.id;

-- Ligne visible sur la page tarifs, ajoutée une seule fois. Le plan gratuit
-- n'annonce rien : la Base Konekt n'y est pas activable.
UPDATE public.subscription_plans p
SET features = p.features || to_jsonb(q.ligne)
FROM (VALUES
  ('solo'::text, 'Base Konekt facturée en crédits'::text),
  ('cabinet', 'Base Konekt : 100 recherches incluses par mois'),
  ('pro', 'Base Konekt : 100 recherches incluses par mois'),
  ('entreprise', 'Base Konekt : 300 recherches incluses par mois'),
  ('enterprise', 'Base Konekt : 300 recherches incluses par mois')
) AS q(id, ligne)
WHERE p.id = q.id
  AND jsonb_typeof(p.features) = 'array'
  AND NOT (p.features @> to_jsonb(q.ligne));

-- ─── 2. organization_integrations : trace d'activation ───
ALTER TABLE public.organization_integrations
  ADD COLUMN IF NOT EXISTS coresignal_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS coresignal_activated_by uuid;

COMMENT ON COLUMN public.organization_integrations.coresignal_activated_at IS
  'Date de la dernière activation de la Base Konekt (set_base_konekt_enabled).';
COMMENT ON COLUMN public.organization_integrations.coresignal_activated_by IS
  'Utilisateur qui a activé la Base Konekt.';

-- ─── 3. base_konekt_usage : consommation du mois ───
CREATE TABLE IF NOT EXISTS public.base_konekt_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Aucune référence vers auth.users : l'usage reste tracé même si le compte
  -- est supprimé, et la ligne appartient d'abord à l'organisation.
  user_id uuid,
  action text NOT NULL,
  included boolean NOT NULL DEFAULT false,
  credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.base_konekt_usage IS
  'Usage de la Base Konekt : une ligne par page d''aperçu (20 profils) ou par fiche complète. included = true : décomptée du forfait mensuel du plan. included = false : facturée en crédits (colonne credits).';

DO $$
BEGIN
  ALTER TABLE public.base_konekt_usage DROP CONSTRAINT IF EXISTS base_konekt_usage_action_check;
  ALTER TABLE public.base_konekt_usage
    ADD CONSTRAINT base_konekt_usage_action_check
    CHECK (action IN ('preview', 'search', 'collect'));
END
$$;

-- Toutes les lectures filtrent par organisation sur le mois en cours.
CREATE INDEX IF NOT EXISTS idx_base_konekt_usage_org_created
  ON public.base_konekt_usage (organization_id, created_at DESC);

ALTER TABLE public.base_konekt_usage ENABLE ROW LEVEL SECURITY;

-- Lecture par les membres de l'organisation ; toute écriture passe par les
-- fonctions ci-dessous, appelées par l'edge function avec le service role.
DROP POLICY IF EXISTS base_konekt_usage_select ON public.base_konekt_usage;
CREATE POLICY base_konekt_usage_select
  ON public.base_konekt_usage FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

REVOKE INSERT, UPDATE, DELETE ON public.base_konekt_usage FROM anon, authenticated;
GRANT SELECT ON public.base_konekt_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_konekt_usage TO service_role;

-- ─── 4. Plan effectif ───
-- Même règle que get_subscription_state, sans contrôle de l'appelant ni
-- écriture : free si aucun abonnement, si l'abonnement est annulé ou impayé,
-- ou si l'essai est échu.
CREATE OR REPLACE FUNCTION public.base_konekt_effective_plan(_organization_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id text;
  v_status text;
  v_trial_ends_at timestamptz;
BEGIN
  SELECT s.plan_id, s.status, s.trial_ends_at
  INTO v_plan_id, v_status, v_trial_ends_at
  FROM public.organization_subscriptions s
  WHERE s.organization_id = _organization_id
  LIMIT 1;

  IF NOT FOUND OR v_plan_id IS NULL THEN
    RETURN 'free';
  END IF;

  RETURN CASE
    WHEN v_status IN ('canceled', 'unpaid') THEN 'free'
    WHEN v_status = 'trialing' AND v_trial_ends_at IS NOT NULL AND v_trial_ends_at < now() THEN 'free'
    ELSE v_plan_id
  END;
END;
$$;

-- Utilitaire interne des fonctions ci-dessous : aucun appel client.
REVOKE EXECUTE ON FUNCTION public.base_konekt_effective_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.base_konekt_effective_plan(uuid) TO service_role;

-- ─── 5. État lu par le front (tous les membres) ───
CREATE OR REPLACE FUNCTION public.get_base_konekt_state(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_plan_id text;
  v_enabled boolean;
  v_role text;
  v_monthly integer;
  v_used integer;
  -- Mois civil en UTC : le décompte ne dépend pas du fuseau de la session.
  v_period_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_period_end timestamptz;
BEGIN
  -- L'edge function lit l'état avec le service role (auth.uid() nul).
  IF NOT v_is_service THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_org_member(v_uid, p_organization_id) THEN
      RAISE EXCEPTION 'Accès réservé aux membres de l''organisation' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_period_end := v_period_start + interval '1 month';
  v_plan_id := public.base_konekt_effective_plan(p_organization_id);

  SELECT coalesce(oi.coresignal_enabled, false) INTO v_enabled
  FROM public.organization_integrations oi
  WHERE oi.organization_id = p_organization_id;
  v_enabled := coalesce(v_enabled, false);

  SELECT coalesce((p.limits ->> 'database_searches_included')::integer, 0) INTO v_monthly
  FROM public.subscription_plans p
  WHERE p.id = v_plan_id;
  v_monthly := coalesce(v_monthly, 0);

  -- Une unité = une page d'aperçu ; la fiche complète (collect) reste en crédits.
  SELECT count(*) INTO v_used
  FROM public.base_konekt_usage u
  WHERE u.organization_id = p_organization_id
    AND u.included = true
    AND u.action IN ('preview', 'search')
    AND u.created_at >= v_period_start
    AND u.created_at < v_period_end;

  v_role := public.get_org_role(v_uid, p_organization_id);

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'plan_allows', v_plan_id <> 'free',
    'effective_plan_id', v_plan_id,
    'included_monthly', v_monthly,
    'included_used', v_used,
    'included_remaining', greatest(0, v_monthly - v_used),
    'period_end', v_period_end,
    'credits_per_search', 2,
    'credits_per_profile', 2,
    'can_activate', coalesce(v_role IN ('owner', 'admin'), false) AND v_plan_id <> 'free'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_base_konekt_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_base_konekt_state(uuid) TO authenticated, service_role;

-- ─── 6. Activation en libre-service (propriétaire ou administrateur) ───
CREATE OR REPLACE FUNCTION public.set_base_konekt_enabled(p_organization_id uuid, p_enabled boolean)
RETURNS jsonb
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

  IF coalesce(public.get_org_role(v_uid, p_organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;

  -- La désactivation reste ouverte quel que soit le plan : une organisation
  -- retombée sur le plan gratuit doit pouvoir couper l'accès.
  IF p_enabled AND public.base_konekt_effective_plan(p_organization_id) = 'free' THEN
    RAISE EXCEPTION 'La Base Konekt est disponible à partir du plan Solo' USING ERRCODE = '42501';
  END IF;

  -- La trace d'activation n'est écrasée que par une activation : après une
  -- coupure, on sait toujours qui avait ouvert l'accès.
  INSERT INTO public.organization_integrations AS oi
    (organization_id, coresignal_enabled, coresignal_activated_at, coresignal_activated_by)
  VALUES (
    p_organization_id,
    p_enabled,
    CASE WHEN p_enabled THEN now() ELSE NULL END,
    CASE WHEN p_enabled THEN v_uid ELSE NULL END
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET coresignal_enabled = excluded.coresignal_enabled,
        coresignal_activated_at = CASE WHEN excluded.coresignal_enabled
          THEN now() ELSE oi.coresignal_activated_at END,
        coresignal_activated_by = CASE WHEN excluded.coresignal_enabled
          THEN v_uid ELSE oi.coresignal_activated_by END,
        updated_at = now();

  RETURN public.get_base_konekt_state(p_organization_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_base_konekt_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_base_konekt_enabled(uuid, boolean) TO authenticated, service_role;

-- ─── 7. Décompte du forfait, appelé par coresignal-search ───
-- Renvoie l'identifiant de la ligne réservée si le mois en cours a encore des
-- recherches incluses, NULL sinon (l'appel est alors facturé en crédits).
CREATE OR REPLACE FUNCTION public.reserve_base_konekt_included(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_monthly integer;
  v_used integer;
  v_usage_id uuid;
  v_period_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_period_end timestamptz;
BEGIN
  -- Seul l'aperçu entre dans le forfait ; la fiche complète est toujours
  -- facturée en crédits.
  IF coalesce(p_action, '') NOT IN ('preview', 'search') THEN
    RETURN NULL;
  END IF;

  v_period_end := v_period_start + interval '1 month';

  -- Verrou par organisation, relâché à la fin de la transaction : deux
  -- recherches simultanées ne peuvent pas dépasser le quota du mois.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('base_konekt_usage'),
    pg_catalog.hashtext(p_organization_id::text)
  );

  SELECT coalesce((p.limits ->> 'database_searches_included')::integer, 0) INTO v_monthly
  FROM public.subscription_plans p
  WHERE p.id = public.base_konekt_effective_plan(p_organization_id);
  v_monthly := coalesce(v_monthly, 0);

  IF v_monthly <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_used
  FROM public.base_konekt_usage u
  WHERE u.organization_id = p_organization_id
    AND u.included = true
    AND u.action IN ('preview', 'search')
    AND u.created_at >= v_period_start
    AND u.created_at < v_period_end;

  IF v_used >= v_monthly THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.base_konekt_usage (organization_id, user_id, action, included, credits)
  VALUES (p_organization_id, p_user_id, p_action, true, 0)
  RETURNING id INTO v_usage_id;

  RETURN v_usage_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_base_konekt_included(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_base_konekt_included(uuid, uuid, text) TO service_role;

-- Usage hors forfait : la trace accompagne le débit fait par settleCredits.
CREATE OR REPLACE FUNCTION public.record_base_konekt_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_credits integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usage_id uuid;
BEGIN
  IF coalesce(p_action, '') NOT IN ('preview', 'search', 'collect') THEN
    RAISE EXCEPTION 'Action inconnue';
  END IF;

  INSERT INTO public.base_konekt_usage (organization_id, user_id, action, included, credits)
  VALUES (p_organization_id, p_user_id, p_action, false, greatest(coalesce(p_credits, 0), 0))
  RETURNING id INTO v_usage_id;

  RETURN v_usage_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_base_konekt_usage(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_base_konekt_usage(uuid, uuid, text, integer) TO service_role;

-- Le fournisseur a échoué après la réservation : la recherche n'est pas
-- décomptée du forfait.
CREATE OR REPLACE FUNCTION public.release_base_konekt_usage(p_usage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.base_konekt_usage WHERE id = p_usage_id AND included = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_base_konekt_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_base_konekt_usage(uuid) TO service_role;
