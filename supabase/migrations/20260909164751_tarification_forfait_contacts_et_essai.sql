-- Tarification : borner le coût du forfait de contacts, et deux corrections
-- de plafond d'essai. Suite de l'audit tarifaire du 2026-09-09.
--
-- 1. Un mobile consomme dix unités de forfait, comme au tarif à l'acte.
--    Le barème à l'acte facture un email 1 crédit et un mobile 10, parce que
--    le fournisseur les facture dans ce rapport. Le forfait, lui, comptait les
--    deux pour une unité. Un forfait dépensé en mobiles coûtait donc dix fois
--    un forfait dépensé en emails, sans que rien ne le borne : 225 dollars sur
--    Entreprise contre 22,50. Le forfait est désormais borné quel que soit le
--    mélange choisi par le client.
--
-- 2. Pendant un essai non payé, le forfait de contacts est plafonné à vingt
--    unités et compté sur la fenêtre de l'essai, pas sur le mois civil. La
--    Base Konekt applique déjà un plafond d'essai ; les contacts étaient la
--    seule ligne sans le sien, et son compteur repartait à zéro au changement
--    de mois, ce qui doublait un essai à cheval sur deux mois.
--
-- 3. Le plafond d'essai de la Base Konekt ne s'applique plus à une
--    organisation qui a déjà payé. Un abonnement souscrit pendant l'essai
--    garde le statut « trialing » chez le prestataire jusqu'à la date de fin :
--    le client payait cent recherches et n'en recevait que dix. Même défaut
--    que celui corrigé sur les sièges le 2026-09-08.
--
-- 4. call_coaching_sessions reçoit le filigrane de facturation à la minute
--    (voir la fonction live-coach, facturée à l'appel jusqu'ici).
--
-- Idempotente, rejouable.

-- ─── 1 et 2. Forfait de contacts ───

-- Réservation d'une demande en cours : ce que le forfait doit retenir tant que
-- le fournisseur n'a pas répondu.
ALTER TABLE public.candidate_enrichments
  ADD COLUMN IF NOT EXISTS reserved_units integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.candidate_enrichments.reserved_units IS
  'Unités de forfait retenues par une demande en cours (1 par email, 10 par mobile). Remplacées par le résultat réel une fois la demande terminée.';

CREATE OR REPLACE FUNCTION public.get_org_contact_usage(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state jsonb;
  v_included integer := 0;
  v_used_included integer := 0;
  v_emails integer := 0;
  v_phones integer := 0;
  v_period_start timestamptz := date_trunc('month', now());
  -- Fenêtre de décompte du forfait : le mois civil, sauf pendant un essai non
  -- payé où c'est l'essai lui-même.
  v_included_since timestamptz;
  -- Fin de fenêtre annoncée aux écrans : identique à la fenêtre réellement appliquée.
  v_period_reset timestamptz;
  v_status text;
  v_trial_ends timestamptz;
  v_has_stripe boolean := false;
BEGIN
  -- get_subscription_state contrôle l'accès (membre ou service role) et
  -- applique l'expiration d'essai à la lecture.
  v_state := public.get_subscription_state(p_organization_id);
  IF v_state IS NOT NULL THEN
    v_included := coalesce((v_state->'limits'->>'contacts_included')::integer, 0);
    v_status := v_state->>'status';
    v_trial_ends := (v_state->>'trial_ends_at')::timestamptz;
    v_has_stripe := coalesce((v_state->>'has_stripe_subscription')::boolean, false);
  END IF;

  v_included_since := v_period_start;
  v_period_reset := v_period_start + interval '1 month';

  -- Essai non payé : forfait plafonné, et compté sur la durée de l'essai pour
  -- qu'un essai à cheval sur deux mois n'ouvre pas deux forfaits. La fin de
  -- fenêtre annoncée suit la même règle : renvoyer le 1er du mois suivant
  -- promettait une remise à zéro qui n'a pas lieu pendant l'essai.
  IF coalesce(v_status, '') = 'trialing' AND NOT v_has_stripe THEN
    v_included := least(v_included, 20);
    IF v_trial_ends IS NOT NULL THEN
      v_included_since := least(v_period_start, v_trial_ends - interval '14 days');
      v_period_reset := v_trial_ends;
    END IF;
  END IF;

  -- Un email vaut une unité, un mobile dix : même rapport que le barème à
  -- l'acte et que la facturation du fournisseur.
  --
  -- Les demandes EN COURS comptent leur réservation, pas leur résultat encore
  -- inconnu. Sans cela, un enrichissement en lot passait entièrement avant que
  -- le compteur ne bouge : cinquante mobiles demandés d'un coup voyaient tous
  -- un forfait intact et consommaient cinq cents unités sur deux cents. Une
  -- demande restée en attente plus d'un jour ne bloque plus le forfait : le
  -- fournisseur répond en minutes.
  SELECT coalesce(sum(
    CASE
      WHEN status = 'terminated'
        THEN (contact_email IS NOT NULL)::integer + (contact_phone IS NOT NULL)::integer * 10
      ELSE greatest(coalesce(reserved_units, 0), 0)
    END
  ), 0)
  INTO v_used_included
  FROM public.candidate_enrichments
  WHERE organization_id = p_organization_id
    AND included
    AND (
      (status = 'terminated' AND coalesce(completed_at, requested_at) >= v_included_since)
      OR (status = 'pending' AND requested_at >= greatest(v_included_since, now() - interval '1 day'))
    );

  SELECT coalesce(sum(emails_consumed), 0), coalesce(sum(phones_consumed), 0)
  INTO v_emails, v_phones
  FROM public.enrichment_user_quotas
  WHERE organization_id = p_organization_id
    AND period_month = v_period_start::date;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'included_monthly', v_included,
    'included_used', v_used_included,
    'included_remaining', greatest(0, v_included - v_used_included),
    'emails_this_month', v_emails,
    'phones_this_month', v_phones,
    'period_start', v_included_since,
    'period_end', v_period_reset
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_org_contact_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_contact_usage(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_org_contact_usage(uuid) IS
  'Forfait de contacts inclus : un email vaut 1 unité, un mobile 10 (même rapport que le barème à l''acte). Plafonné à 20 unités sur la fenêtre de l''essai tant qu''aucun abonnement n''est rattaché.';

-- ─── 3. Le plafond d'essai de la Base Konekt épargne un abonné ───
-- Les deux fonctions sont réécrites en entier : seule la condition du plafond
-- change, mais un remplacement de texte sur une définition de fonction serait
-- illisible et casserait en silence au prochain changement de leur corps.

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
  v_status text;
  v_has_stripe boolean := false;
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
  SELECT s.status, s.stripe_subscription_id IS NOT NULL
  INTO v_status, v_has_stripe
  FROM public.organization_subscriptions s
  WHERE s.organization_id = p_organization_id;
  v_has_stripe := coalesce(v_has_stripe, false);

  SELECT coalesce(oi.coresignal_enabled, false) INTO v_enabled
  FROM public.organization_integrations oi
  WHERE oi.organization_id = p_organization_id;
  v_enabled := coalesce(v_enabled, false);

  SELECT coalesce(greatest(0, CASE
    WHEN pg_catalog.jsonb_typeof(p.limits -> 'database_searches_included') = 'number'
      THEN pg_catalog.floor((p.limits ->> 'database_searches_included')::numeric)::integer
    ELSE 0
  END), 0) INTO v_monthly
  FROM public.subscription_plans p
  WHERE p.id = v_plan_id;
  v_monthly := coalesce(v_monthly, 0);
  -- Pendant un essai NON PAYÉ, le forfait est plafonné : l'accès est ouvert
  -- sans carte bancaire, les recherches sont payées au fournisseur. Un
  -- abonnement souscrit pendant l'essai garde le statut « trialing » jusqu'à la
  -- date de fin : sans la seconde condition, le client payait cent recherches
  -- et n'en recevait que dix.
  IF coalesce(v_status, '') = 'trialing' AND NOT v_has_stripe THEN
    v_monthly := least(v_monthly, 10);
  END IF;

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
    'can_activate', coalesce(v_role IN ('owner', 'admin'), false) AND v_plan_id <> 'free',
    -- Droit de couper l'accès, sans condition de plan : une organisation
    -- retombée sur la formule gratuite doit pouvoir désactiver.
    'can_manage', coalesce(v_role IN ('owner', 'admin'), false),
    'trialing', coalesce(v_status, '') = 'trialing' AND NOT v_has_stripe
  );
END;
$$;

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
  v_status text;
  v_has_stripe boolean := false;
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

  SELECT coalesce(greatest(0, CASE
    WHEN pg_catalog.jsonb_typeof(p.limits -> 'database_searches_included') = 'number'
      THEN pg_catalog.floor((p.limits ->> 'database_searches_included')::numeric)::integer
    ELSE 0
  END), 0) INTO v_monthly
  FROM public.subscription_plans p
  WHERE p.id = public.base_konekt_effective_plan(p_organization_id);
  v_monthly := coalesce(v_monthly, 0);

  SELECT s.status, s.stripe_subscription_id IS NOT NULL
  INTO v_status, v_has_stripe
  FROM public.organization_subscriptions s
  WHERE s.organization_id = p_organization_id;
  v_has_stripe := coalesce(v_has_stripe, false);
  -- Même règle que get_base_konekt_state : le plafond d'essai ne s'applique
  -- qu'à un essai sans abonnement rattaché.
  IF coalesce(v_status, '') = 'trialing' AND NOT v_has_stripe THEN
    v_monthly := least(v_monthly, 10);
  END IF;

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

-- ─── 3 bis. Le libellé vendu dit ce qui est livré ───
-- « 200 contacts enrichis par mois » laissait entendre 200 contacts de
-- n'importe quelle nature. Le forfait s'exprime maintenant en emails, avec
-- l'équivalence mobile affichée.

UPDATE public.subscription_plans
SET features = (
  SELECT jsonb_agg(
    CASE
      WHEN elem #>> '{}' = '50 contacts enrichis par mois'
        THEN to_jsonb('50 emails de contact par mois, ou 5 mobiles'::text)
      WHEN elem #>> '{}' = '200 contacts enrichis par mois'
        THEN to_jsonb('200 emails de contact par mois, ou 20 mobiles'::text)
      WHEN elem #>> '{}' = '500 contacts enrichis par mois'
        THEN to_jsonb('500 emails de contact par mois, ou 50 mobiles'::text)
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(features) WITH ORDINALITY AS t(elem, ord)
)
-- Le CASE ne remplace que les libellés exacts : rejouer la migration ne change
-- rien une fois la reformulation faite.
WHERE id IN ('solo', 'cabinet', 'entreprise')
  AND jsonb_typeof(features) = 'array';

-- ─── 4. Filigrane de facturation du coaching en direct ───

ALTER TABLE public.call_coaching_sessions
  ADD COLUMN IF NOT EXISTS billed_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_cost_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_started_at timestamptz;

COMMENT ON COLUMN public.call_coaching_sessions.billing_started_at IS
  'Première analyse de coaching de la session. Le compteur de minutes part de là, pas de la création de la ligne : un panneau ouvert vingt minutes avant l''entretien facturait sinon vingt minutes d''un coup.';

COMMENT ON COLUMN public.call_coaching_sessions.billed_minutes IS
  'Minutes déjà facturées pour cette session. Le coaching est vendu à la minute ; sans ce filigrane il était débité à chaque appel du navigateur, soit cinq fois par minute au minimum.';
COMMENT ON COLUMN public.call_coaching_sessions.pending_cost_usd IS
  'Coût fournisseur accumulé depuis la dernière minute facturée, reporté sur la prochaine transaction de crédits.';

-- Le report du coût s'incrémente en base. Écrire une valeur lue plus tôt
-- écrasait la contribution d'une analyse concurrente, et pouvait ressusciter un
-- coût déjà facturé par l'appel qui venait de remettre le compteur à zéro.
CREATE OR REPLACE FUNCTION public.add_coaching_pending_cost(
  p_session_id uuid,
  p_cost numeric
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.call_coaching_sessions
  SET pending_cost_usd = coalesce(pending_cost_usd, 0) + greatest(coalesce(p_cost, 0), 0)
  WHERE id = p_session_id;
$$;

REVOKE EXECUTE ON FUNCTION public.add_coaching_pending_cost(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_coaching_pending_cost(uuid, numeric) TO service_role;
