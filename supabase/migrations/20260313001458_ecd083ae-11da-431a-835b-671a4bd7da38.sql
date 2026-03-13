
-- AI Credit Balances per organization (monthly resettable)
CREATE TABLE public.ai_credit_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credits_remaining integer NOT NULL DEFAULT 0,
  credits_total integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  period_end timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE public.ai_credit_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own org credits"
  ON public.ai_credit_balances FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Service role can manage all credits"
  ON public.ai_credit_balances FOR ALL
  USING (auth.role() = 'service_role'::text);

-- AI Credit Transactions (audit log)
CREATE TABLE public.ai_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  action text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own org transactions"
  ON public.ai_credit_transactions FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Service role can manage all transactions"
  ON public.ai_credit_transactions FOR ALL
  USING (auth.role() = 'service_role'::text);

-- Auto-create credit balance when org subscription is created/updated
CREATE OR REPLACE FUNCTION public.sync_credit_balance_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits integer;
BEGIN
  -- Get credits from plan
  SELECT COALESCE((limits->>'ai_credits')::integer, 100)
  INTO v_credits
  FROM subscription_plans
  WHERE id = NEW.plan_id;

  -- -1 means unlimited, store as 999999
  IF v_credits = -1 THEN
    v_credits := 999999;
  END IF;

  INSERT INTO ai_credit_balances (organization_id, credits_remaining, credits_total, period_start, period_end)
  VALUES (
    NEW.organization_id,
    v_credits,
    v_credits,
    date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month'
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    credits_remaining = EXCLUDED.credits_remaining,
    credits_total = EXCLUDED.credits_total,
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_subscription_sync_credits
  AFTER INSERT OR UPDATE OF plan_id ON public.organization_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_credit_balance_from_subscription();

-- DB function to deduct credits atomically
CREATE OR REPLACE FUNCTION public.deduct_ai_credits(
  p_organization_id uuid,
  p_user_id uuid,
  p_amount integer,
  p_action text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining integer;
  v_period_end timestamptz;
BEGIN
  -- Lock the row and get current balance
  SELECT credits_remaining, period_end
  INTO v_remaining, v_period_end
  FROM ai_credit_balances
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_balance', 'message', 'Aucun solde de crédits trouvé');
  END IF;

  -- Check if period has expired (need monthly reset)
  IF v_period_end <= now() THEN
    -- Reset credits for new period
    UPDATE ai_credit_balances
    SET credits_remaining = credits_total,
        period_start = date_trunc('month', now()),
        period_end = date_trunc('month', now()) + interval '1 month',
        updated_at = now()
    WHERE organization_id = p_organization_id
    RETURNING credits_remaining INTO v_remaining;
  END IF;

  -- Check sufficient credits
  IF v_remaining < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'remaining', v_remaining,
      'required', p_amount,
      'message', 'Crédits IA insuffisants'
    );
  END IF;

  -- Deduct
  UPDATE ai_credit_balances
  SET credits_remaining = credits_remaining - p_amount,
      updated_at = now()
  WHERE organization_id = p_organization_id;

  v_remaining := v_remaining - p_amount;

  -- Log transaction
  INSERT INTO ai_credit_transactions (organization_id, user_id, amount, balance_after, action, description)
  VALUES (p_organization_id, p_user_id, -p_amount, v_remaining, p_action, p_description);

  RETURN jsonb_build_object('success', true, 'remaining', v_remaining);
END;
$$;
