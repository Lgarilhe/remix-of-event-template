
-- Subscription plans (static config)
CREATE TABLE public.subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price_monthly integer NOT NULL DEFAULT 0,
  price_yearly integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'eur',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_price_id_monthly text,
  stripe_price_id_yearly text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active plans"
  ON public.subscription_plans FOR SELECT
  USING (is_active = true);

-- Seed default plans
INSERT INTO public.subscription_plans (id, name, description, price_monthly, price_yearly, features, limits, sort_order) VALUES
('free', 'Free', 'Pour découvrir Skalr', 0, 0,
 '["3 postes actifs", "50 recherches / mois", "Scoring IA basique", "1 utilisateur"]'::jsonb,
 '{"max_jobs": 3, "max_searches": 50, "max_members": 1, "ai_credits": 100}'::jsonb,
 0),
('pro', 'Pro', 'Pour les recruteurs indépendants', 7900, 79000,
 '["Postes illimités", "Recherches illimitées", "Scoring IA avancé", "Séquences LinkedIn", "Inbox unifiée", "5 utilisateurs", "Support prioritaire"]'::jsonb,
 '{"max_jobs": -1, "max_searches": -1, "max_members": 5, "ai_credits": 5000}'::jsonb,
 1),
('enterprise', 'Enterprise', 'Pour les cabinets de recrutement', 19900, 199000,
 '["Tout Pro inclus", "Utilisateurs illimités", "Crédits IA illimités", "Intégrations ATS", "API access", "Account manager dédié", "SSO (bientôt)"]'::jsonb,
 '{"max_jobs": -1, "max_searches": -1, "max_members": -1, "ai_credits": -1}'::jsonb,
 2);

-- Organization subscriptions
CREATE TABLE public.organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.subscription_plans(id) DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own org subscription"
  ON public.organization_subscriptions FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Only system can insert/update subscriptions"
  ON public.organization_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Only system can update subscriptions"
  ON public.organization_subscriptions FOR UPDATE
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- Auto-create free subscription when org is created
CREATE OR REPLACE FUNCTION public.auto_create_free_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_subscriptions (organization_id, plan_id, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_organization_created_subscription
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_free_subscription();
