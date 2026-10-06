-- Parcours de paiement : deux défauts trouvés avant le premier vrai encaissement.
--
-- 1. organization_subscriptions.plan_id est NOT NULL sans valeur par défaut en
--    production, alors que la migration de création lui en donne une ('free').
--    La production vient de MIGRATION_CLEAN.sql, qui a perdu ce défaut. Une
--    écriture PostgREST qui n'énumère pas la colonne est donc refusée en
--    production et passe en base reconstruite : divergence invisible en CI.
--    Le défaut est reposé pour aligner les deux.
--
-- 2. sync_credit_balance_from_subscription déduisait la consommation en
--    comparant les forfaits (ancien plafond moins solde restant) et redémarrait
--    la période à chaque changement de plan. Trois conséquences mesurées :
--      - à l'expiration d'un essai, une organisation ayant consommé plus de 100
--        crédits tombait à 0 au lieu des 100 du plan gratuit, et n'était
--        rechargée qu'un mois plus tard ;
--      - un aller-retour par un plan plus petit reconstituait presque tout le
--        forfait, le plafonnement à zéro ayant effacé la trace de la
--        consommation ;
--      - la période repartant à la date du changement, la jauge affichait
--        « 0 % utilisé » juste après une montée de plan.
--    La consommation est désormais lue dans ai_credit_transactions, sur la même
--    définition que ai-credits (somme de credits_used depuis period_start, pour
--    les sources plan, topup et mixed), et la période n'est plus remise à zéro
--    lors d'un changement de plan en cours de mois. Une sortie d'essai vers le
--    plan gratuit ouvre en revanche une période neuve avec le forfait entier.
--
-- Idempotente, rejouable.

ALTER TABLE public.organization_subscriptions
  ALTER COLUMN plan_id SET DEFAULT 'free';

CREATE OR REPLACE FUNCTION public.sync_credit_balance_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_credits integer;
  v_consumed integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_keep_period boolean := false;
BEGIN
  -- Ne réagit qu'à la création et au changement de plan : le webhook de paiement
  -- met à jour statut et période sans toucher aux crédits.
  IF TG_OP = 'UPDATE' AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((limits->>'ai_credits')::integer, 100)
  INTO v_credits
  FROM public.subscription_plans
  WHERE id = NEW.plan_id;

  IF v_credits IS NULL THEN
    v_credits := 100;
  END IF;
  IF v_credits < 0 THEN
    v_credits := 999999; -- illimité
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT period_start, period_end
    INTO v_period_start, v_period_end
    FROM public.ai_credit_balances
    WHERE organization_id = NEW.organization_id;

    -- Fin d'essai vers le plan gratuit : période neuve, forfait entier. La
    -- consommation de l'essai n'est pas imputée au plan d'atterrissage.
    IF OLD.status = 'trialing' AND NEW.plan_id = 'free' THEN
      v_keep_period := false;

    -- Changement de plan en cours de période : la période est conservée et la
    -- consommation réelle de la période est déduite du nouveau forfait.
    ELSIF v_period_start IS NOT NULL AND v_period_end IS NOT NULL AND v_period_end > now() THEN
      v_keep_period := true;

      SELECT COALESCE(SUM(credits_used), 0)::integer
      INTO v_consumed
      FROM public.ai_credit_transactions
      WHERE organization_id = NEW.organization_id
        AND created_at >= v_period_start
        AND source IN ('plan', 'topup', 'mixed');

      v_credits := GREATEST(0, v_credits - COALESCE(v_consumed, 0));
    END IF;
  END IF;

  INSERT INTO public.ai_credit_balances
    (organization_id, plan_credits, topup_credits, credits_remaining, credits_total, period_start, period_end)
  VALUES
    (NEW.organization_id, v_credits, 0, v_credits, v_credits, now(), now() + interval '1 month')
  ON CONFLICT (organization_id) DO UPDATE SET
    plan_credits = EXCLUDED.plan_credits,
    -- colonnes historiques conservées en miroir (lecteurs résiduels)
    credits_remaining = EXCLUDED.plan_credits + public.ai_credit_balances.topup_credits,
    credits_total = EXCLUDED.plan_credits + public.ai_credit_balances.topup_credits,
    period_start = CASE WHEN v_keep_period THEN public.ai_credit_balances.period_start ELSE now() END,
    period_end = CASE WHEN v_keep_period THEN public.ai_credit_balances.period_end ELSE now() + interval '1 month' END,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_subscription_sync_credits ON public.organization_subscriptions;
CREATE TRIGGER on_subscription_sync_credits
  AFTER INSERT OR UPDATE OF plan_id ON public.organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_credit_balance_from_subscription();
