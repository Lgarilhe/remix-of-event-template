-- ============================================================================
-- Agent de fond — file de tâches longues exécutées par lots (P5 audit 2026-07-15)
-- ============================================================================
-- Le copilot peut lancer une tâche longue (ex. « score les 296 profils sourcés
-- de la mission X ») sans bloquer le chat : la tâche est mise en file ici, un
-- worker cron (process-agent-tasks, chaque minute) la traite par lots bornés
-- (timeout edge 60s → 1 batch/tick + re-tick), met à jour la progression en
-- temps réel (realtime), puis notifie l'utilisateur à la fin.
--
-- Modèle repris de process-enrichment-queue / process-scheduled-actions :
--   claim atomique (FOR UPDATE SKIP LOCKED + lock TTL), fail-soft par item,
--   secret cron interne (internal_config.process_sequences_secret).
--
-- v1 : un seul kind, 'score_mission_profiles'. La structure (kind + params
-- jsonb + dispatch worker) est prête pour d'autres types (enrichissement…).
--
-- Idempotente, rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_background_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Créateur de la tâche : cible de la notification de fin + imputation des
  -- crédits IA (le worker cron n'a pas de user courant).
  created_by uuid NOT NULL,
  -- Conversation d'origine : permet de reposter un message de fin dans le chat.
  conversation_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('score_mission_profiles')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'error', 'canceled')),
  -- Libellé lisible par l'utilisateur (FR, jamais de nom de fournisseur).
  title text NOT NULL,
  progress_total integer NOT NULL DEFAULT 0,
  progress_done integer NOT NULL DEFAULT 0,
  progress_failed integer NOT NULL DEFAULT 0,
  result jsonb NULL,
  last_error text NULL,
  attempts integer NOT NULL DEFAULT 0,
  -- Marqueur de claim : posé par le worker au début d'un tick, relâché en fin
  -- de tick (ou expiré au bout de 5 min si le worker a crashé en plein batch).
  locked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  finished_at timestamptz NULL
);

COMMENT ON TABLE public.agent_background_tasks IS
  'File des tâches de fond du copilot IA (scoring en masse…). Traitée par lots par le worker cron process-agent-tasks. Progression exposée en realtime, notification de fin dans notifications + agent_messages.';

-- Claim : un index partiel sur les tâches actives, trié pour l''ordre FIFO.
CREATE INDEX IF NOT EXISTS idx_agent_background_tasks_claim
  ON public.agent_background_tasks (created_at)
  WHERE status IN ('queued', 'running');

-- Listing par org (UI).
CREATE INDEX IF NOT EXISTS idx_agent_background_tasks_org
  ON public.agent_background_tasks (organization_id, created_at DESC);

-- updated_at automatique (même pattern que agent_tool_policies).
CREATE OR REPLACE FUNCTION public.set_agent_background_tasks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_background_tasks_updated_at ON public.agent_background_tasks;
CREATE TRIGGER trg_agent_background_tasks_updated_at
  BEFORE UPDATE ON public.agent_background_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_agent_background_tasks_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Lecture : membres de l'org. Les INSERT/traitement passent par le service-role
-- (tool start_background_task côté edge, worker). Un membre peut annuler SA
-- tâche (passer une tâche active à 'canceled') mais rien d'autre.
ALTER TABLE public.agent_background_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select" ON public.agent_background_tasks;
CREATE POLICY "org_members_select" ON public.agent_background_tasks
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- Annulation par le créateur : on ne peut que basculer une tâche encore active
-- vers 'canceled' (le WITH CHECK borne la transition, l'USING borne la source).
-- Le WITH CHECK re-valide aussi l'appartenance org sur la NOUVELLE ligne, et le
-- GRANT UPDATE est scopé à LA SEULE colonne status : impossible de re-parenter
-- (organization_id), renommer (title) ou altérer params/created_by au passage.
DROP POLICY IF EXISTS "creator_cancel_update" ON public.agent_background_tasks;
CREATE POLICY "creator_cancel_update" ON public.agent_background_tasks
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND public.is_org_member(auth.uid(), organization_id)
    AND status IN ('queued', 'running')
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_org_member(auth.uid(), organization_id)
    AND status = 'canceled'
  );

-- GRANTs (gotcha RLS 2026-04-21 : sans grant explicite → permission denied).
-- UPDATE limité à la colonne status (annulation uniquement).
GRANT SELECT ON public.agent_background_tasks TO authenticated;
GRANT UPDATE (status) ON public.agent_background_tasks TO authenticated;
GRANT ALL ON public.agent_background_tasks TO service_role;

-- ── Claim atomique (worker) ────────────────────────────────────────────────
-- Réclame UNE tâche traitable : soit 'queued', soit 'running' dont le lock a
-- expiré (worker crashé). FOR UPDATE SKIP LOCKED → deux ticks concurrents ne
-- prennent jamais la même ligne. SECURITY DEFINER, réservé au service-role.
-- NB : n'incrémente PAS attempts — une tâche longue est réclamée à chaque tick
-- (une tâche de 296 profils ~10 ticks). attempts compte les ÉCHECS, géré par
-- le worker (gate de retry). Ici on ne fait que poser le lock.
CREATE OR REPLACE FUNCTION public.claim_agent_background_task(p_lock_ttl_minutes integer DEFAULT 5)
RETURNS SETOF public.agent_background_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.agent_background_tasks t
     SET status = 'running',
         locked_at = now(),
         started_at = COALESCE(t.started_at, now())
   WHERE t.id = (
     SELECT c.id
       FROM public.agent_background_tasks c
      WHERE c.status IN ('queued', 'running')
        AND (c.locked_at IS NULL OR c.locked_at < now() - make_interval(mins => p_lock_ttl_minutes))
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING t.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_background_task(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_agent_background_task(integer) TO service_role;

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Progression live de la table + correction du canal notifications (le hook
-- useNotifications s'y abonnait déjà mais la table n'était pas publiée →
-- l'événement INSERT ne partait jamais). REPLICA IDENTITY FULL pour que les
-- UPDATE filtrés par organization_id fonctionnent côté client.
ALTER TABLE public.agent_background_tasks REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_background_tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Cron worker ────────────────────────────────────────────────────────────
-- Invoque process-agent-tasks chaque minute (pattern internal_config, réutilise
-- le secret partagé process_sequences_secret comme les autres workers).
CREATE OR REPLACE FUNCTION public.invoke_process_agent_tasks()
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
    RAISE WARNING 'Missing internal_config — skipping process-agent-tasks invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-agent-tasks',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

-- Schedule idempotent (unschedule d'abord, puis schedule dans un bloc tolérant :
-- la CI e2e n'a pas pg_cron).
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-agent-tasks');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

DO $do$ BEGIN
  PERFORM cron.schedule(
    'process-agent-tasks',
    '* * * * *',
    $$SELECT public.invoke_process_agent_tasks();$$
  );
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron skip: %', SQLERRM;
END $do$;
