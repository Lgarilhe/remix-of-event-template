-- ============================================
-- Migration: LinkedIn action ledger + unified quota gate
-- ============================================
-- Conformité LinkedIn warning #260513-007211 (license sharing accusé).
--
-- Problème résolu : avant cette migration, le cap journalier d'actions
-- LinkedIn était compté séparément par chaque chemin d'envoi
-- (process-sequences comptait sequence_step_executions ; agent-tools comptait
-- en plus agent_tool_executions ; process-inmail-queue et unipile-search ne
-- comptaient RIEN). Le plafond n'était donc pas un vrai plafond : un même
-- compte LinkedIn pouvait cumuler bien au-delà du seuil sûr.
--
-- Solution : un ledger unique append-only (linkedin_action_log) + un RPC
-- atomique (check_linkedin_action_quota) que TOUS les chemins d'envoi
-- consultent. Source de vérité unique, race-safe (advisory lock par compte).
--
-- Table d'infra écrite UNIQUEMENT par les edge functions (service role), à
-- l'image de rate_limit_log : pas de organization_id NOT NULL ni de policies
-- org-scopées (jamais lue directement par un user authentifié). C'est une
-- dérogation assumée à la règle "org_id obligatoire" du skill migration.md.

-- ============================================
-- Phase 1: Schema — ledger append-only
-- ============================================

CREATE TABLE IF NOT EXISTS public.linkedin_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,                 -- nullable : table d'infra (cf. rate_limit_log)
  user_id uuid,
  account_id text NOT NULL,             -- = member_linkedin_accounts.linkedin_account_id (id compte Unipile)
  action_type text NOT NULL,            -- connection_request | message | inmail | smart_message | profile_view | search
  source text,                          -- sequence | inmail_queue | agent_tool | manual_search | manual_inbox
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index pour les comptages fenêtrés (account + type + temps) et (account + temps)
CREATE INDEX IF NOT EXISTS idx_linkedin_action_log_account_type_time
  ON public.linkedin_action_log (account_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_action_log_account_time
  ON public.linkedin_action_log (account_id, created_at DESC);

-- ============================================
-- Phase 2: RLS — service role only (table d'infra)
-- ============================================

ALTER TABLE public.linkedin_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages linkedin action log" ON public.linkedin_action_log;
CREATE POLICY "Service role manages linkedin action log"
  ON public.linkedin_action_log FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ============================================
-- Phase 3: Colonnes de pilotage sur member_linkedin_accounts
-- ============================================
-- quota_paused_until : posé quand Unipile signale usage >= seuil (90%) — le
-- compte est mis en pause "douce" jusqu'à expiration (par défaut fin de
-- journée). last_usage_pct : dernier % d'usage renvoyé par le fournisseur.

ALTER TABLE public.member_linkedin_accounts
  ADD COLUMN IF NOT EXISTS quota_paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_usage_pct smallint;

-- ============================================
-- Phase 4: Aligner le défaut des vues de profil sur la reco fournisseur (~100/j)
-- ============================================
-- L'ancien défaut (200) était au-dessus de la reco LinkedIn (~100 vues/j).
-- On abaisse le défaut et on rapatrie les lignes encore à l'ancien défaut.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'member_quotas'
      AND column_name = 'max_profile_visits_per_day'
  ) THEN
    EXECUTE 'ALTER TABLE public.member_quotas ALTER COLUMN max_profile_visits_per_day SET DEFAULT 100';
    EXECUTE 'UPDATE public.member_quotas SET max_profile_visits_per_day = 100 WHERE max_profile_visits_per_day = 200';
  END IF;
END $$;

-- ============================================
-- Phase 5: RPC atomique de check + log
-- ============================================
-- Les bornes temporelles (p_day_since / p_week_since) sont calculées côté TS
-- dans le timezone de l'user (cohérent avec la logique business-hours qui y
-- vit déjà). Le RPC reste un compteur atomique "bête" mais race-safe.
--
-- Passer NULL pour un cap = ne pas l'appliquer. Log optimiste : on enregistre
-- l'action AU MOMENT du check autorisé (favorise la sécurité — un envoi qui
-- échoue ensuite "consomme" quand même un slot plutôt que risquer un dépassement).

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
  -- inmail, smart_message confondus) — le garde-fou principal anti-flag.
  IF p_action_type IN ('connection_request', 'message', 'inmail', 'smart_message')
     AND p_daily_visible_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM linkedin_action_log
      WHERE account_id = p_account_id
        AND action_type IN ('connection_request', 'message', 'inmail', 'smart_message')
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

-- ============================================
-- Phase 6: Nettoyage (rétention 30 jours) + cron quotidien
-- ============================================

CREATE OR REPLACE FUNCTION public.cleanup_linkedin_action_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM linkedin_action_log WHERE created_at < now() - interval '30 days';
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-linkedin-action-log',
      '17 3 * * *',
      'SELECT public.cleanup_linkedin_action_log();'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron schedule skipped (cleanup-linkedin-action-log): %', SQLERRM;
END $$;
