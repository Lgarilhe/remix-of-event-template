-- Migration : lot P0-C, grille tarifaire, essai de 14 jours, sièges.
-- Hypothèses : docs/p0-plan-2026-09-06.md, section 2.
--
--   1. Trois plans par siège et par mois : solo 59 €, cabinet 139 €, entreprise
--      189 € (annuel = 10 × mensuel). Crédits IA inclus 500 / 2 000 / 5 000,
--      contacts enrichis inclus 50 / 200 / 500 (clé limits.contacts_included).
--      pro et enterprise sont désactivés (les identifiants restent pour les
--      clés étrangères) ; free devient le palier d'atterrissage après essai.
--   2. organization_subscriptions.seats (quantité facturée) et trial_ends_at.
--   3. Essai : à la création d'une organisation, abonnement cabinet en statut
--      trialing pour 14 jours, une fois par utilisateur créateur
--      (subscription_trial_grants). Les organisations déjà sur free sans
--      abonnement Stripe reçoivent le même essai à partir d'aujourd'hui (bêta).
--   4. Expiration : expire_subscription_trials() (cron horaire) et, à la lecture,
--      get_subscription_state(org) qui renvoie le plan effectif, l'essai
--      restant, les sièges facturés et les membres comptés.
--   5. La page tarifs devient publique : SELECT sur subscription_plans pour anon.
--
-- Idempotente — rejouable sans erreur.

-- ─── 1. Grille ───
INSERT INTO public.subscription_plans
  (id, name, description, price_monthly, price_yearly, currency, features, limits, is_active, sort_order)
VALUES
  ('solo', 'Solo', 'Pour un recruteur indépendant, un compte LinkedIn.',
   5900, 59000, 'eur',
   '["Missions illimitées", "Recherches LinkedIn illimitées", "Scoring IA des profils", "Séquences LinkedIn et email", "Inbox unifiée", "500 crédits IA par mois", "50 contacts enrichis par mois"]'::jsonb,
   '{"max_jobs": -1, "max_searches": -1, "max_members": -1, "ai_credits": 500, "contacts_included": 50}'::jsonb,
   true, 1),
  ('cabinet', 'Cabinet', 'Pour un cabinet de recrutement, par siège.',
   13900, 139000, 'eur',
   '["Tout Solo", "Équipe, rôles et quotas par recruteur", "Portail client par mission", "Paramètres agence", "2 000 crédits IA par mois", "200 contacts enrichis par mois"]'::jsonb,
   '{"max_jobs": -1, "max_searches": -1, "max_members": -1, "ai_credits": 2000, "contacts_included": 200}'::jsonb,
   true, 2),
  ('entreprise', 'Entreprise', 'Pour une équipe recrutement interne, par siège.',
   18900, 189000, 'eur',
   '["Tout Cabinet", "Publication sur la marketplace de recruteurs", "5 000 crédits IA par mois", "500 contacts enrichis par mois", "Support prioritaire"]'::jsonb,
   '{"max_jobs": -1, "max_searches": -1, "max_members": -1, "ai_credits": 5000, "contacts_included": 500}'::jsonb,
   true, 3)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  currency = EXCLUDED.currency,
  features = EXCLUDED.features,
  limits = public.subscription_plans.limits || EXCLUDED.limits,
  is_active = true,
  sort_order = EXCLUDED.sort_order;

UPDATE public.subscription_plans
SET is_active = false
WHERE id IN ('pro', 'enterprise');

UPDATE public.subscription_plans
SET name = 'Gratuit',
    description = 'Après l''essai : vos données restent accessibles, sans envoi de séquences.',
    features = '["3 missions actives", "Recherches LinkedIn limitées", "100 crédits IA par mois", "Pas d''envoi de séquences"]'::jsonb,
    limits = limits || '{"max_jobs": 3, "max_searches": 50, "max_members": 1, "ai_credits": 100, "contacts_included": 0}'::jsonb,
    sort_order = 0
WHERE id = 'free';

GRANT SELECT ON public.subscription_plans TO anon;

-- ─── 2. Colonnes ───
ALTER TABLE public.organization_subscriptions ADD COLUMN IF NOT EXISTS seats integer NOT NULL DEFAULT 1;
ALTER TABLE public.organization_subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

COMMENT ON COLUMN public.organization_subscriptions.seats IS
  'Sièges facturés (quantité de l''abonnement Stripe). 1 par défaut, hors abonnement.';
COMMENT ON COLUMN public.organization_subscriptions.trial_ends_at IS
  'Fin de l''essai gratuit (status = trialing). NULL hors essai.';

-- ─── 3. Un essai par utilisateur créateur ───
CREATE TABLE IF NOT EXISTS public.subscription_trial_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_trial_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_grant_select ON public.subscription_trial_grants;
CREATE POLICY own_grant_select
  ON public.subscription_trial_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS service_role_all ON public.subscription_trial_grants;
CREATE POLICY service_role_all
  ON public.subscription_trial_grants FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.subscription_trial_grants TO authenticated;
GRANT ALL ON public.subscription_trial_grants TO service_role;

CREATE OR REPLACE FUNCTION public.auto_create_free_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_trial boolean := false;
BEGIN
  -- organizations.created_by n'a pas de clé étrangère : on vérifie que le
  -- créateur existe avant de lui accorder un essai (la table des essais, elle,
  -- référence auth.users).
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.created_by)
     AND NOT EXISTS (SELECT 1 FROM public.subscription_trial_grants g WHERE g.user_id = NEW.created_by)
     AND EXISTS (SELECT 1 FROM public.subscription_plans p WHERE p.id = 'cabinet' AND p.is_active) THEN
    v_trial := true;
  END IF;

  IF v_trial THEN
    INSERT INTO public.organization_subscriptions (organization_id, plan_id, status, trial_ends_at, seats)
    VALUES (NEW.id, 'cabinet', 'trialing', now() + interval '14 days', 1)
    ON CONFLICT (organization_id) DO NOTHING;

    INSERT INTO public.subscription_trial_grants (user_id, organization_id)
    VALUES (NEW.created_by, NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO public.organization_subscriptions (organization_id, plan_id, status, seats)
    VALUES (NEW.id, 'free', 'active', 1)
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 4. Expiration de l'essai ───
CREATE OR REPLACE FUNCTION public.expire_subscription_trials()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.organization_subscriptions
    SET plan_id = 'free',
        status = 'active',
        updated_at = now()
    WHERE status = 'trialing'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at < now()
      AND stripe_subscription_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_subscription_trials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_subscription_trials() TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-subscription-trials') THEN
    PERFORM cron.unschedule('expire-subscription-trials');
  END IF;
  PERFORM cron.schedule(
    'expire-subscription-trials',
    '7 * * * *',
    $$SELECT public.expire_subscription_trials();$$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron skip: %', SQLERRM;
END
$do$;

-- ─── 5. État d'abonnement lu par le front et les edge functions ───
-- Renvoie le plan effectif (free si l'essai est expiré, expiration appliquée à
-- la lecture), l'essai restant, les sièges facturés et les membres comptés.
CREATE OR REPLACE FUNCTION public.get_subscription_state(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub public.organization_subscriptions;
  v_plan public.subscription_plans;
  v_effective_plan_id text;
  v_seat_count integer;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
BEGIN
  IF NOT v_is_service AND NOT public.is_org_member(auth.uid(), p_organization_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Expiration paresseuse (même règle que le cron)
  UPDATE public.organization_subscriptions
  SET plan_id = 'free', status = 'active', updated_at = now()
  WHERE organization_id = p_organization_id
    AND status = 'trialing'
    AND trial_ends_at IS NOT NULL
    AND trial_ends_at < now()
    AND stripe_subscription_id IS NULL;

  SELECT * INTO v_sub FROM public.organization_subscriptions WHERE organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_effective_plan_id := CASE
    WHEN v_sub.status IN ('canceled', 'unpaid') THEN 'free'
    ELSE v_sub.plan_id
  END;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_effective_plan_id;
  SELECT count(*) INTO v_seat_count FROM public.organization_members WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'organization_id', v_sub.organization_id,
    'plan_id', v_sub.plan_id,
    'effective_plan_id', v_effective_plan_id,
    'plan_name', v_plan.name,
    'limits', coalesce(v_plan.limits, '{}'::jsonb),
    'status', v_sub.status,
    'billing_cycle', v_sub.billing_cycle,
    'trial_ends_at', v_sub.trial_ends_at,
    'trial_days_left', CASE
      WHEN v_sub.status = 'trialing' AND v_sub.trial_ends_at IS NOT NULL
        THEN greatest(0, ceil(extract(epoch FROM (v_sub.trial_ends_at - now())) / 86400.0))::integer
      ELSE NULL END,
    'seats', v_sub.seats,
    'seat_count', v_seat_count,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'has_stripe_subscription', v_sub.stripe_subscription_id IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_subscription_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_subscription_state(uuid) TO authenticated, service_role;

-- ─── 6. Bêta : les organisations existantes sur free (sans abonnement Stripe) démarrent l'essai ───
UPDATE public.organization_subscriptions s
SET plan_id = 'cabinet',
    status = 'trialing',
    trial_ends_at = now() + interval '14 days',
    updated_at = now()
WHERE s.plan_id = 'free'
  AND s.status = 'active'
  AND s.stripe_subscription_id IS NULL
  AND s.trial_ends_at IS NULL
  AND EXISTS (SELECT 1 FROM public.subscription_plans p WHERE p.id = 'cabinet' AND p.is_active)
  -- Un essai par créateur : sa première organisation, s'il n'en a pas déjà eu un.
  AND s.organization_id IN (
    SELECT DISTINCT ON (o.created_by) o.id
    FROM public.organizations o
    WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.created_by)
      AND NOT EXISTS (SELECT 1 FROM public.subscription_trial_grants g WHERE g.user_id = o.created_by)
    ORDER BY o.created_by, o.created_at
  );

INSERT INTO public.subscription_trial_grants (user_id, organization_id)
SELECT o.created_by, o.id
FROM public.organizations o
JOIN public.organization_subscriptions s ON s.organization_id = o.id
WHERE s.status = 'trialing'
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.created_by)
ON CONFLICT (user_id) DO NOTHING;
