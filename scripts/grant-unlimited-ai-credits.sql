-- ─── Grant unlimited AI credits to Laurent's org ────────────────────
--
-- Set credits_remaining + credits_total = 999_999_999 for the org of
-- l.garilhe@konekt.fr — afin de ne plus avoir de restrictions IA pendant
-- les phases de design/test.
--
-- Idempotent : peut être rejoué à tout moment.
-- Affecte UNIQUEMENT l'organization de Laurent.
--
-- Usage :
--   npx supabase db query --linked --file scripts/grant-unlimited-ai-credits.sql

DO $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_unlimited integer := 999999999;
BEGIN
  -- Trouve le user_id de Laurent
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'l.garilhe@konekt.fr'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User l.garilhe@konekt.fr non trouvé dans auth.users';
  END IF;

  -- Trouve son organization_id (en tant qu'owner ou admin)
  SELECT organization_id INTO v_org_id
  FROM public.organization_members
  WHERE user_id = v_user_id
    AND role IN ('owner', 'admin')
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Aucune organisation trouvée pour Laurent (user_id %)', v_user_id;
  END IF;

  -- Upsert la balance avec 999M crédits sur TOUTES les colonnes :
  --   credits_remaining : legacy (compat ancien code)
  --   plan_credits      : ce que lit l'edge function ai-credits/get_balance
  --   topup_credits     : crédits supplémentaires achetés
  --   credits_total     : pour calculer le pourcentage utilisé
  INSERT INTO public.ai_credit_balances (
    organization_id,
    credits_remaining,
    plan_credits,
    topup_credits,
    credits_total,
    period_start,
    period_end,
    updated_at
  )
  VALUES (
    v_org_id,
    v_unlimited,
    v_unlimited,
    0,
    v_unlimited,
    now(),
    now() + interval '100 years',
    now()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    credits_remaining = v_unlimited,
    plan_credits = v_unlimited,
    topup_credits = 0,
    credits_total = v_unlimited,
    period_end = now() + interval '100 years',
    updated_at = now();

  -- Audit trail
  INSERT INTO public.ai_credit_transactions (
    organization_id,
    user_id,
    amount,
    balance_after,
    action,
    description,
    metadata
  )
  VALUES (
    v_org_id,
    v_user_id,
    v_unlimited,
    v_unlimited,
    'admin_grant',
    'Crédits IA illimités attribués (phase design/test inbox)',
    jsonb_build_object('granted_by', 'manual_admin_script', 'date', now())
  );

  RAISE NOTICE 'Crédits IA illimités (999_999_999) attribués à org % de Laurent', v_org_id;
END $$;

-- Vérification
SELECT
  o.name AS organization_name,
  b.credits_remaining,
  b.credits_total,
  b.period_end
FROM public.ai_credit_balances b
JOIN public.organizations o ON o.id = b.organization_id
JOIN public.organization_members om ON om.organization_id = b.organization_id
JOIN auth.users u ON u.id = om.user_id
WHERE u.email = 'l.garilhe@konekt.fr'
  AND om.role IN ('owner', 'admin');
