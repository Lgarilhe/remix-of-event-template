
-- 1. Add plan_credits and topup_credits to ai_credit_balances
ALTER TABLE public.ai_credit_balances
  ADD COLUMN IF NOT EXISTS plan_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_credits integer NOT NULL DEFAULT 0;

-- Migrate existing data: plan_credits = credits_remaining, topup_credits = 0
UPDATE public.ai_credit_balances
SET plan_credits = credits_remaining,
    topup_credits = 0;

-- 2. Create credit_purchases table
CREATE TABLE IF NOT EXISTS public.credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid,
  pack_id text,
  credits integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'eur',
  stripe_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their credit purchases"
  ON public.credit_purchases FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- 3. Add columns to ai_credit_transactions
ALTER TABLE public.ai_credit_transactions
  ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_input integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_output integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_id text,
  ADD COLUMN IF NOT EXISTS cost_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'plan';
