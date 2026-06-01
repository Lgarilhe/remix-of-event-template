-- ============================================
-- Migration: profile_enrichment_queue (Phase 2 — découplage des vues de
-- profil hors du scoring)
-- ============================================
-- Conformité LinkedIn warning #260513-007211 (« consultations de profil
-- anormalement élevées »). Le scoring n'enrichit plus AUCUN profil en direct :
-- il met les profils à enrichir dans cette file, et le cron
-- process-enrichment-queue les traite UN PAR UN, espacés, en heures ouvrées,
-- passés par le ledger quota (profile_view). Zéro burst par construction.
--
-- Table d'infra (service-role only, comme rate_limit_log / linkedin_action_log).

-- ============================================
-- Phase 1: Schema
-- ============================================

CREATE TABLE IF NOT EXISTS public.profile_enrichment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  account_id text NOT NULL,            -- member_linkedin_accounts.linkedin_account_id (compte Unipile)
  provider_id text,
  profile_url text,
  -- dedup_key = provider_id || profile_url (posé par l'appelant). NOT NULL pour
  -- garantir la déduplication.
  dedup_key text NOT NULL,
  candidate_id text,                   -- pour invalider match_scores (re-score lazy)
  job_id text NOT NULL DEFAULT '',     -- idem ('' = enrichissement hors contexte job)
  user_id uuid,
  status text NOT NULL DEFAULT 'pending',  -- pending | done | failed | skipped
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_enrichment_queue_identifier_chk
    CHECK (provider_id IS NOT NULL OR profile_url IS NOT NULL)
);

-- Déduplication : une seule entrée par (compte, personne, job). Le ré-enqueue
-- d'une personne déjà en file met simplement à jour (re-enrichissement).
CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_enrichment_queue
  ON public.profile_enrichment_queue (account_id, dedup_key, job_id);

-- Index de consommation : items prêts à traiter, plus anciens d'abord.
CREATE INDEX IF NOT EXISTS idx_profile_enrichment_queue_ready
  ON public.profile_enrichment_queue (status, scheduled_at)
  WHERE status = 'pending';

-- ============================================
-- Phase 2: RLS (service-role only)
-- ============================================

ALTER TABLE public.profile_enrichment_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages profile enrichment queue" ON public.profile_enrichment_queue;
CREATE POLICY "Service role manages profile enrichment queue"
  ON public.profile_enrichment_queue FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ============================================
-- Phase 3: Cron invocation helper (mirror du pattern process-sequences)
-- ============================================

CREATE OR REPLACE FUNCTION public.invoke_process_enrichment_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT value INTO v_secret FROM internal_config WHERE key = 'process_sequences_secret';
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE WARNING 'Missing internal_config — skipping process-enrichment-queue invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-enrichment-queue',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- ============================================
-- Phase 4: Cron schedule (toutes les 2 min ; le worker traite peu d'items
-- espacés → ~1 profil/40s, plafonné par le ledger profile_view (100/j))
-- ============================================

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-enrichment-queue');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM cron.schedule(
    'process-enrichment-queue',
    '*/2 * * * *',
    $cron$SELECT public.invoke_process_enrichment_queue();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron schedule skipped (process-enrichment-queue): %', SQLERRM;
END $$;
