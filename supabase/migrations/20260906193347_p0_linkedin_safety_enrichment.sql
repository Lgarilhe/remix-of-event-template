-- Migration : lot P0-D, sécurité LinkedIn visible et enrichissement packagé.
-- Hypothèses : docs/p0-plan-2026-09-06.md, section 2.
--
--   1. member_quotas : un membre peut créer et modifier sa propre ligne, mais
--      seulement ses horaires et son fuseau ; les plafonds restent aux
--      propriétaires et administrateurs (trigger de garde).
--   2. Montée en charge par compte : linkedin_ramp_factor(linked_at) donne
--      25 / 50 / 75 / 100 % des plafonds par semaine depuis le rattachement ;
--      les comptes rattachés avant le 2026-09-14 (pivot de mise en prod, avec
--      marge) sont considérés matures. La
--      même table est appliquée côté serveur dans _shared/linkedin-quotas.ts.
--   3. get_linkedin_quota_status(account) : compteurs du jour et de la semaine
--      lus dans linkedin_action_log (réservé au service role jusqu'ici),
--      plafonds effectifs après palier, pause en cours, heures ouvrées.
--   4. Enrichissement : candidate_enrichments.included marque une demande
--      couverte par le forfait du plan ; get_org_contact_usage(org) renvoie le
--      consommé et le reste inclus du mois. Le plafond par membre passe à
--      illimité par défaut (le forfait est par organisation).
--   5. sequence_enrollments.pause_reason : raison lisible d'une mise en pause
--      (compte déconnecté, limite atteinte, abonnement requis).
--
-- Idempotente — rejouable sans erreur.

-- ─── 1. member_quotas en libre-service (horaires et fuseau) ───
DROP POLICY IF EXISTS own_row_insert ON public.member_quotas;
CREATE POLICY own_row_insert
  ON public.member_quotas FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS own_row_update ON public.member_quotas;
CREATE POLICY own_row_update
  ON public.member_quotas FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.member_quotas_self_service_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- Service role, migrations, crons : pas de restriction.
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Le rôle est jugé dans l'organisation d'origine de la ligne ; déplacer une
  -- ligne vers une autre organisation exige d'en être administrateur aussi.
  v_role := public.get_org_role(auth.uid(),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.organization_id ELSE NEW.organization_id END);
  IF v_role IN ('owner', 'admin') THEN
    IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id
       AND coalesce(public.get_org_role(auth.uid(), NEW.organization_id), '') NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.max_actions_per_day IS DISTINCT FROM OLD.max_actions_per_day
       OR NEW.max_profile_visits_per_day IS DISTINCT FROM OLD.max_profile_visits_per_day
       OR NEW.max_searches_per_day IS DISTINCT FROM OLD.max_searches_per_day
       OR NEW.max_inmails_per_day IS DISTINCT FROM OLD.max_inmails_per_day
       OR NEW.max_messages_per_day IS DISTINCT FROM OLD.max_messages_per_day
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Seuls les horaires et le fuseau sont modifiables par un membre'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Création par le membre : plafonds aux valeurs par défaut de l'organisation.
    NEW.max_actions_per_day := 80;
    NEW.max_profile_visits_per_day := 100;
    NEW.max_searches_per_day := NULL;
    NEW.max_inmails_per_day := NULL;
    NEW.max_messages_per_day := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_quotas_self_service_guard ON public.member_quotas;
CREATE TRIGGER trg_member_quotas_self_service_guard
  BEFORE INSERT OR UPDATE ON public.member_quotas
  FOR EACH ROW EXECUTE FUNCTION public.member_quotas_self_service_guard();

-- ─── 2. Montée en charge par compte ───
CREATE OR REPLACE FUNCTION public.linkedin_ramp_factor(p_linked_at timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_linked_at IS NULL THEN 1.0
    WHEN p_linked_at < timestamptz '2026-09-14 00:00:00+00' THEN 1.0
    WHEN now() - p_linked_at < interval '7 days' THEN 0.25
    WHEN now() - p_linked_at < interval '14 days' THEN 0.5
    WHEN now() - p_linked_at < interval '21 days' THEN 0.75
    ELSE 1.0
  END;
$$;

COMMENT ON FUNCTION public.linkedin_ramp_factor(timestamptz) IS
  'Part des plafonds LinkedIn applicable selon l''ancienneté du rattachement : 25 % la première semaine, 50 % la deuxième, 75 % la troisième, 100 % ensuite. Comptes rattachés avant le 2026-09-14 : matures. Même table dans _shared/linkedin-quotas.ts.';

-- Appelée seulement par get_linkedin_quota_status (SECURITY DEFINER) : aucun accès client.
REVOKE EXECUTE ON FUNCTION public.linkedin_ramp_factor(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_ramp_factor(timestamptz) TO service_role;

-- ─── 3. État des plafonds d'un compte ───
CREATE OR REPLACE FUNCTION public.get_linkedin_quota_status(p_account_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc public.member_linkedin_accounts;
  v_q public.member_quotas;
  v_tz text;
  v_day_start timestamptz;
  v_factor numeric;
  v_visible integer := 0;
  v_visits integer := 0;
  v_searches integer := 0;
  v_inmails integer := 0;
  v_invites_week integer := 0;
  v_cap_visible integer;
  v_cap_visits integer;
  v_cap_searches integer;
  v_cap_inmails integer;
  v_cap_invites_week integer;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
BEGIN
  SELECT * INTO v_acc
  FROM public.member_linkedin_accounts
  WHERE linkedin_account_id = p_account_id
  ORDER BY linked_at
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Sans JWT (rôle postgres, cron) : diagnostic autorisé ; anon est bloqué par le REVOKE.
  IF auth.uid() IS NOT NULL AND NOT v_is_service
     AND NOT public.is_org_member(auth.uid(), v_acc.organization_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_q
  FROM public.member_quotas
  WHERE organization_id = v_acc.organization_id AND user_id = v_acc.user_id;

  v_tz := coalesce(v_q.timezone, 'Europe/Paris');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'Europe/Paris';
  END;
  v_day_start := (date_trunc('day', now() AT TIME ZONE v_tz)) AT TIME ZONE v_tz;
  -- Ancienneté réelle : la première action journalisée si elle précède linked_at
  -- (compte dissocié puis rattaché). Même règle dans _shared/linkedin-quotas.ts.
  v_factor := public.linkedin_ramp_factor(least(
    v_acc.linked_at,
    (SELECT min(created_at) FROM public.linkedin_action_log WHERE account_id = p_account_id)
  ));

  v_cap_visible := ceil(coalesce(v_q.max_actions_per_day, 80) * v_factor);
  v_cap_visits := ceil(coalesce(v_q.max_profile_visits_per_day, 100) * v_factor);
  v_cap_searches := ceil(coalesce(v_q.max_searches_per_day, 100) * v_factor);
  v_cap_inmails := ceil(coalesce(v_q.max_inmails_per_day, 40) * v_factor);
  v_cap_invites_week := ceil(100 * v_factor);

  SELECT
    count(*) FILTER (WHERE action_type IN ('connection_request', 'message', 'inmail', 'smart_message') AND created_at >= v_day_start),
    count(*) FILTER (WHERE action_type = 'profile_view' AND created_at >= v_day_start),
    count(*) FILTER (WHERE action_type = 'search' AND created_at >= v_day_start),
    count(*) FILTER (WHERE action_type = 'inmail' AND created_at >= v_day_start),
    count(*) FILTER (WHERE action_type = 'connection_request' AND created_at >= now() - interval '7 days')
  INTO v_visible, v_visits, v_searches, v_inmails, v_invites_week
  FROM public.linkedin_action_log
  WHERE account_id = p_account_id
    AND created_at >= least(v_day_start, now() - interval '7 days');

  RETURN jsonb_build_object(
    'account_id', p_account_id,
    'account_status', v_acc.account_status,
    'paused_until', v_acc.quota_paused_until,
    'linked_at', v_acc.linked_at,
    'ramp_factor', v_factor,
    'ramp_stage', CASE
      WHEN v_factor >= 1 THEN 'mature'
      WHEN v_factor >= 0.75 THEN 'week3'
      WHEN v_factor >= 0.5 THEN 'week2'
      ELSE 'week1' END,
    'timezone', v_tz,
    'business_hours', jsonb_build_object(
      'start', coalesce(v_q.business_hours_start, 8),
      'end', coalesce(v_q.business_hours_end, 19)),
    'today', jsonb_build_object(
      'visible_actions', v_visible,
      'profile_views', v_visits,
      'searches', v_searches,
      'inmails', v_inmails),
    'week', jsonb_build_object('invitations', v_invites_week),
    'caps', jsonb_build_object(
      'visible_actions', v_cap_visible,
      'profile_views', v_cap_visits,
      'searches', v_cap_searches,
      'inmails', v_cap_inmails,
      'weekly_invitations', v_cap_invites_week),
    'day_resets_at', v_day_start + interval '1 day'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_linkedin_quota_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_linkedin_quota_status(text) TO authenticated, service_role;

-- ─── 4. Enrichissement packagé ───
ALTER TABLE public.candidate_enrichments
  ADD COLUMN IF NOT EXISTS included boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.candidate_enrichments.included IS
  'Demande couverte par le forfait de contacts du plan (pas de débit de crédits).';

ALTER TABLE public.organization_members
  ALTER COLUMN enrichment_quota_monthly DROP NOT NULL,
  ALTER COLUMN enrichment_quota_monthly DROP DEFAULT;

-- Le forfait est par organisation ; le plafond par membre n'est plus posé par défaut.
UPDATE public.organization_members
SET enrichment_quota_monthly = NULL
WHERE enrichment_quota_monthly = 100;

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
BEGIN
  -- get_subscription_state contrôle l'accès (membre ou service role) et
  -- applique l'expiration d'essai à la lecture.
  v_state := public.get_subscription_state(p_organization_id);
  IF v_state IS NOT NULL THEN
    v_included := coalesce((v_state->'limits'->>'contacts_included')::integer, 0);
  END IF;

  SELECT coalesce(sum((contact_email IS NOT NULL)::integer + (contact_phone IS NOT NULL)::integer), 0)
  INTO v_used_included
  FROM public.candidate_enrichments
  WHERE organization_id = p_organization_id
    AND included
    AND status = 'terminated'
    AND coalesce(completed_at, requested_at) >= v_period_start;

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
    'period_start', v_period_start,
    'period_end', v_period_start + interval '1 month'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_org_contact_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_contact_usage(uuid) TO authenticated, service_role;

-- ─── 5. Raison de pause lisible sur les inscriptions ───
ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS pause_reason text;

COMMENT ON COLUMN public.sequence_enrollments.pause_reason IS
  'Raison de la mise en pause : account_disconnected | quota_reached | subscription_required | manual. NULL hors pause.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_pause_reason_check') THEN
    ALTER TABLE public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_pause_reason_check
      CHECK (pause_reason IS NULL OR pause_reason IN ('account_disconnected', 'quota_reached', 'subscription_required', 'manual'));
  END IF;
END $$;
