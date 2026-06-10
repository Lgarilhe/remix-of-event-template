-- ====================================================================
-- Quota LinkedIn : compter les endorsements dans le cap "visible"
--
-- Audit 2026-06-10 : l'action endorse_skill (POST /linkedin/profile/endorse
-- via unipile-search) était la seule action LinkedIn visible non couverte
-- par le quota gate — exécutée sans être comptée dans le ledger.
--
-- Fix côté edge (même PR) : unipile-search mappe endorse_skill → type
-- 'endorse' dans enforceLinkedInAction. Côté SQL : 'endorse' rejoint le
-- cap cumulé d'actions visibles/jour (le garde-fou principal anti-flag).
-- Pas de cap dédié — un endorsement pèse comme une action visible.
--
-- Redéfinition identique à 20260601120000_linkedin_action_ledger.sql,
-- seuls les deux IN (...) du bloc "visible" changent.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.check_linkedin_action_quota(
  p_account_id text,
  p_action_type text,
  p_day_since timestamptz,
  p_week_since timestamptz,
  p_daily_visible_cap integer DEFAULT NULL,
  p_weekly_invite_cap integer DEFAULT NULL,
  p_profile_view_cap integer DEFAULT NULL,
  p_search_cap integer DEFAULT NULL,
  p_inmail_daily_cap integer DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_log boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_paused timestamptz;
BEGIN
  -- Sérialise par compte : deux invocations cron/worker concurrentes ne peuvent
  -- pas passer le cap au même instant.
  PERFORM pg_advisory_xact_lock(hashtext(p_account_id));

  -- Pause "douce" pilotée par le signal fournisseur (usage >= seuil).
  SELECT quota_paused_until INTO v_paused
  FROM member_linkedin_accounts
  WHERE linkedin_account_id = p_account_id
  LIMIT 1;
  IF v_paused IS NOT NULL AND v_paused > now() THEN
    RETURN jsonb_build_object(
      'allowed', false, 'scope', 'provider_pause', 'paused_until', v_paused,
      'reason', 'Compte en pause quota (signal fournisseur atteint).'
    );
  END IF;

  -- Cap hebdomadaire d'invitations
  IF p_action_type = 'connection_request' AND p_weekly_invite_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM linkedin_action_log
      WHERE account_id = p_account_id AND action_type = 'connection_request'
        AND created_at >= p_week_since;
    IF v_count >= p_weekly_invite_cap THEN
      RETURN jsonb_build_object('allowed', false, 'scope', 'weekly_invite',
        'count', v_count, 'cap', p_weekly_invite_cap,
        'reason', format('Limite hebdo invitations atteinte (%s/%s).', v_count, p_weekly_invite_cap));
    END IF;
  END IF;

  -- Caps journaliers par type (vues de profil / recherches / InMails)
  IF p_action_type = 'profile_view' AND p_profile_view_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM linkedin_action_log
      WHERE account_id = p_account_id AND action_type = 'profile_view'
        AND created_at >= p_day_since;
    IF v_count >= p_profile_view_cap THEN
      RETURN jsonb_build_object('allowed', false, 'scope', 'profile_view',
        'count', v_count, 'cap', p_profile_view_cap,
        'reason', format('Cap journalier vues de profil atteint (%s/%s).', v_count, p_profile_view_cap));
    END IF;
  ELSIF p_action_type = 'search' AND p_search_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM linkedin_action_log
      WHERE account_id = p_account_id AND action_type = 'search'
        AND created_at >= p_day_since;
    IF v_count >= p_search_cap THEN
      RETURN jsonb_build_object('allowed', false, 'scope', 'search',
        'count', v_count, 'cap', p_search_cap,
        'reason', format('Cap journalier recherches atteint (%s/%s).', v_count, p_search_cap));
    END IF;
  ELSIF p_action_type = 'inmail' AND p_inmail_daily_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM linkedin_action_log
      WHERE account_id = p_account_id AND action_type = 'inmail'
        AND created_at >= p_day_since;
    IF v_count >= p_inmail_daily_cap THEN
      RETURN jsonb_build_object('allowed', false, 'scope', 'inmail_daily',
        'count', v_count, 'cap', p_inmail_daily_cap,
        'reason', format('Cap journalier InMails atteint (%s/%s).', v_count, p_inmail_daily_cap));
    END IF;
  END IF;

  -- Cap cumulé d'actions "visibles" par jour (connection_request, message,
  -- inmail, smart_message, endorse confondus) — le garde-fou principal anti-flag.
  IF p_action_type IN ('connection_request', 'message', 'inmail', 'smart_message', 'endorse')
     AND p_daily_visible_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM linkedin_action_log
      WHERE account_id = p_account_id
        AND action_type IN ('connection_request', 'message', 'inmail', 'smart_message', 'endorse')
        AND created_at >= p_day_since;
    IF v_count >= p_daily_visible_cap THEN
      RETURN jsonb_build_object('allowed', false, 'scope', 'daily_visible',
        'count', v_count, 'cap', p_daily_visible_cap,
        'reason', format('Cap journalier actions LinkedIn atteint (%s/%s).', v_count, p_daily_visible_cap));
    END IF;
  END IF;

  -- Autorisé → log optimiste de l'action.
  IF p_log THEN
    INSERT INTO linkedin_action_log (organization_id, user_id, account_id, action_type, source)
      VALUES (p_organization_id, p_user_id, p_account_id, p_action_type, p_source);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'count', v_count);
END;
$$;

-- La fonction est SECURITY DEFINER : on réapplique la politique de grants
-- du hardening 20260610120000/140000 (clients révoqués, service_role only).
REVOKE EXECUTE ON FUNCTION public.check_linkedin_action_quota(text, text, timestamptz, timestamptz, integer, integer, integer, integer, integer, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_linkedin_action_quota(text, text, timestamptz, timestamptz, integer, integer, integer, integer, integer, uuid, uuid, text, boolean) TO service_role;
