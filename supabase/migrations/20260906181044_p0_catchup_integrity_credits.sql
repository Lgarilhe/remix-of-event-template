-- Migration : rattrapage P0-A (diagnostic prod en lecture seule du 2026-09-06).
--
-- Constats sur konekt-production :
--   1. Deux migrations sont marquées « appliquées » (repair_tracking du 2026-07,
--      table de suivi seulement) mais n'ont jamais tourné : 20260430120000
--      (colonnes meeting_* de mission_process_steps, lues et écrites par
--      useMissionProcess) et 20260508170000 (table candidate_enrichment_cache,
--      écrite par score-profile-job et _shared/profile-enrichment). Rejouées ici
--      à l'identique, avec des contraintes UNIQUE simples à la place des index
--      uniques partiels (PostgREST ne transmet pas le prédicat dans ON CONFLICT,
--      l'upsert échouait).
--   2. Unicités perdues à l'import du schéma : sequence_enrollments
--      (sequence_id, profile_id) — les trois upserts client échouent en 42P10 —,
--      organization_members (organization_id, user_id), member_linkedin_accounts
--      (organization_id, linkedin_account_id). Aucun doublon en prod le jour du
--      diagnostic ; le dédoublonnage reste pour les autres environnements.
--   3. member_linkedin_accounts.linked_by est NOT NULL sans défaut alors que les
--      upserts serveur (unipile-accounts, unipile-webhook) ne le posent pas :
--      aucun compte connecté par hosted_auth n'était rattaché. Trigger de défaut
--      (linked_by := user_id) en plus du correctif dans les fonctions.
--   4. Crédits IA : le trigger de synchronisation n'écrivait que les colonnes
--      historiques (credits_remaining/credits_total) ; plan_credits restait à 0
--      sur 16 organisations sur 17. Le trigger écrit maintenant plan_credits,
--      conserve topup_credits, ne réagit qu'au changement de plan, et l'illimité
--      (-1) devient 999999. Remise à niveau des soldes à 0.
--   5. notifications : la policy INSERT autorisait tout membre à notifier
--      n'importe quel utilisateur (organization_id NULL). Le destinataire doit
--      être membre de la même organisation, ou être soi-même.
--
-- Idempotente — rejouable sans erreur.

-- ─── 1a. 20260430120000 rejouée : format d'entretien des étapes de process ───
ALTER TABLE public.mission_process_steps ADD COLUMN IF NOT EXISTS meeting_format text DEFAULT 'video';
ALTER TABLE public.mission_process_steps ADD COLUMN IF NOT EXISTS meeting_provider text;
ALTER TABLE public.mission_process_steps ADD COLUMN IF NOT EXISTS meeting_link text;
ALTER TABLE public.mission_process_steps ADD COLUMN IF NOT EXISTS location_address text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mission_process_steps'::regclass
      AND conname = 'mission_process_steps_meeting_format_check'
  ) THEN
    ALTER TABLE public.mission_process_steps
      ADD CONSTRAINT mission_process_steps_meeting_format_check
      CHECK (meeting_format IN ('video', 'phone', 'onsite'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mission_process_steps'::regclass
      AND conname = 'mission_process_steps_meeting_provider_check'
  ) THEN
    ALTER TABLE public.mission_process_steps
      ADD CONSTRAINT mission_process_steps_meeting_provider_check
      CHECK (meeting_provider IS NULL OR meeting_provider IN ('teams', 'zoom', 'google_meet', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN public.mission_process_steps.meeting_format IS
  'Format de l''entretien : video (visioconférence), phone (téléphonique) ou onsite (présentiel).';
COMMENT ON COLUMN public.mission_process_steps.meeting_provider IS
  'Fournisseur visio (uniquement quand meeting_format = ''video'') : teams, zoom, google_meet, other.';
COMMENT ON COLUMN public.mission_process_steps.meeting_link IS
  'Lien de réunion personnalisé ou modèle (quand meeting_provider = ''other'' ou pour un lien fixe).';
COMMENT ON COLUMN public.mission_process_steps.location_address IS
  'Adresse physique de l''entretien (uniquement quand meeting_format = ''onsite'').';

-- ─── 1b. 20260508170000 rejouée : cache cross-mission des profils enrichis ───
CREATE TABLE IF NOT EXISTS public.candidate_enrichment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  linkedin_url text,
  provider_id text,
  enriched_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sections_filled text[] DEFAULT '{}',
  last_enriched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  enriched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_enrichment_cache_lookup_url
  ON public.candidate_enrichment_cache (organization_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_enrichment_cache_lookup_provider
  ON public.candidate_enrichment_cache (organization_id, provider_id)
  WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_enrichment_cache_expires
  ON public.candidate_enrichment_cache (expires_at);

-- Les index uniques partiels de la version d'origine ne sont pas inférables par
-- l'upsert PostgREST (prédicat absent de ON CONFLICT). Contraintes UNIQUE simples :
-- les NULL ne se heurtent pas, l'upsert sur (organization_id, linkedin_url) ou
-- (organization_id, provider_id) fonctionne.
DROP INDEX IF EXISTS public.uniq_candidate_enrichment_cache_url;
DROP INDEX IF EXISTS public.uniq_candidate_enrichment_cache_provider;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.candidate_enrichment_cache'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, linkedin_url)'
  ) THEN
    ALTER TABLE public.candidate_enrichment_cache
      ADD CONSTRAINT candidate_enrichment_cache_org_url_key UNIQUE (organization_id, linkedin_url);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.candidate_enrichment_cache'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, provider_id)'
  ) THEN
    ALTER TABLE public.candidate_enrichment_cache
      ADD CONSTRAINT candidate_enrichment_cache_org_provider_key UNIQUE (organization_id, provider_id);
  END IF;
END $$;

ALTER TABLE public.candidate_enrichment_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can read enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Org members can read enrichment cache"
  ON public.candidate_enrichment_cache FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Org members can write enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Org members can write enrichment cache"
  ON public.candidate_enrichment_cache FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Org members can update enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Org members can update enrichment cache"
  ON public.candidate_enrichment_cache FOR UPDATE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access enrichment cache" ON public.candidate_enrichment_cache;
CREATE POLICY "Service role full access enrichment cache"
  ON public.candidate_enrichment_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.candidate_enrichment_cache TO authenticated;
GRANT ALL ON public.candidate_enrichment_cache TO service_role;

CREATE OR REPLACE FUNCTION public.touch_candidate_enrichment_cache_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_enrichment_cache_updated_at ON public.candidate_enrichment_cache;
CREATE TRIGGER trg_candidate_enrichment_cache_updated_at
  BEFORE UPDATE ON public.candidate_enrichment_cache
  FOR EACH ROW EXECUTE FUNCTION public.touch_candidate_enrichment_cache_updated_at();

COMMENT ON TABLE public.candidate_enrichment_cache IS
  'Cache cross-mission des sections de profil LinkedIn (recommandations, projets, certifications, langues, bénévolat, publications). Lookup par linkedin_url ou provider_id, scopé par organization_id. TTL 14 jours.';

-- ─── 2. Unicités perdues (dédoublonnage puis contrainte) ───
DO $$
BEGIN
  -- 2a. sequence_enrollments (sequence_id, profile_id) : garde la plus ancienne
  DELETE FROM public.sequence_enrollments e
  USING (
    SELECT id, row_number() OVER (PARTITION BY sequence_id, profile_id ORDER BY created_at, id) AS rn
    FROM public.sequence_enrollments
  ) d
  WHERE e.id = d.id AND d.rn > 1;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sequence_enrollments'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (sequence_id, profile_id)'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      ADD CONSTRAINT sequence_enrollments_sequence_id_profile_id_key UNIQUE (sequence_id, profile_id);
  END IF;

  -- 2b. organization_members (organization_id, user_id) : garde le rôle le plus élevé.
  -- Le trigger AFTER DELETE reset_active_org_on_member_removed remettrait
  -- profiles.active_organization_id à NULL pour un membre qui reste membre :
  -- désactivé le temps du dédoublonnage.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.organization_members'::regclass
      AND tgname = 'reset_active_org_on_member_removed'
  ) THEN
    ALTER TABLE public.organization_members DISABLE TRIGGER reset_active_org_on_member_removed;
  END IF;

  DELETE FROM public.organization_members m
  USING (
    SELECT id, row_number() OVER (
      PARTITION BY organization_id, user_id
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, id
    ) AS rn
    FROM public.organization_members
  ) d
  WHERE m.id = d.id AND d.rn > 1;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.organization_members'::regclass
      AND tgname = 'reset_active_org_on_member_removed'
  ) THEN
    ALTER TABLE public.organization_members ENABLE TRIGGER reset_active_org_on_member_removed;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_members'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, user_id)'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_organization_id_user_id_key UNIQUE (organization_id, user_id);
  END IF;

  -- 2c. member_linkedin_accounts (organization_id, linkedin_account_id) : garde le plus ancien rattachement
  DELETE FROM public.member_linkedin_accounts a
  USING (
    SELECT id, row_number() OVER (PARTITION BY organization_id, linkedin_account_id ORDER BY linked_at, id) AS rn
    FROM public.member_linkedin_accounts
  ) d
  WHERE a.id = d.id AND d.rn > 1;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.member_linkedin_accounts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, linkedin_account_id)'
  ) THEN
    ALTER TABLE public.member_linkedin_accounts
      ADD CONSTRAINT member_linkedin_accounts_org_linkedin_account_key
      UNIQUE (organization_id, linkedin_account_id);
  END IF;
END $$;

-- ─── 3. linked_by par défaut = user_id (rattachement serveur sans acteur explicite) ───
CREATE OR REPLACE FUNCTION public.member_linkedin_accounts_default_linked_by()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.linked_by IS NULL THEN
    NEW.linked_by := NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_linkedin_accounts_default_linked_by ON public.member_linkedin_accounts;
CREATE TRIGGER trg_member_linkedin_accounts_default_linked_by
  BEFORE INSERT ON public.member_linkedin_accounts
  FOR EACH ROW EXECUTE FUNCTION public.member_linkedin_accounts_default_linked_by();

-- ─── 4. Crédits IA : une seule source de vérité, subscription_plans.limits.ai_credits ───
CREATE OR REPLACE FUNCTION public.sync_credit_balance_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_credits integer;
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

  INSERT INTO public.ai_credit_balances
    (organization_id, plan_credits, topup_credits, credits_remaining, credits_total, period_start, period_end)
  VALUES
    (NEW.organization_id, v_credits, 0, v_credits, v_credits, now(), now() + interval '1 month')
  ON CONFLICT (organization_id) DO UPDATE SET
    plan_credits = EXCLUDED.plan_credits,
    -- colonnes historiques conservées en miroir (lecteurs résiduels)
    credits_remaining = EXCLUDED.plan_credits + public.ai_credit_balances.topup_credits,
    credits_total = EXCLUDED.plan_credits + public.ai_credit_balances.topup_credits,
    period_start = now(),
    period_end = now() + interval '1 month',
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_subscription_sync_credits ON public.organization_subscriptions;
CREATE TRIGGER on_subscription_sync_credits
  AFTER INSERT OR UPDATE OF plan_id ON public.organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_credit_balance_from_subscription();

-- Remise à niveau : les organisations dont plan_credits est resté à 0 (défaut de
-- colonne) alors que la colonne historique montre des crédits non consommés
-- reçoivent les crédits de leur plan sur une fenêtre neuve d'un mois. Les
-- crédits achetés (topup_credits) sont conservés.
UPDATE public.ai_credit_balances b
SET plan_credits = p.credits,
    credits_remaining = p.credits + b.topup_credits,
    credits_total = p.credits + b.topup_credits,
    period_start = now(),
    period_end = now() + interval '1 month',
    updated_at = now()
FROM (
  SELECT s.organization_id,
         CASE
           WHEN COALESCE((sp.limits->>'ai_credits')::integer, 100) < 0 THEN 999999
           ELSE COALESCE((sp.limits->>'ai_credits')::integer, 100)
         END AS credits
  FROM public.organization_subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
) p
WHERE p.organization_id = b.organization_id
  AND b.plan_credits = 0
  AND b.credits_remaining > 0;

-- RPC historique sur les colonnes legacy, sans appelant (EXECUTE déjà révoqué).
DROP FUNCTION IF EXISTS public.deduct_ai_credits(uuid, uuid, integer, text, text);

-- ─── 5. notifications : le destinataire doit être membre de la même organisation ───
-- Les policies permissives se combinent en OU : toute policy INSERT existante,
-- quel que soit son nom, est retirée avant de poser la nouvelle.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', r.policyname);
  END LOOP;
END $$;

CREATE POLICY org_members_insert
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND public.is_org_member(auth.uid(), organization_id)
      AND public.is_org_member(user_id, organization_id)
    )
  );

COMMENT ON COLUMN public.notifications.type IS
  'mention | new_message | linkedin_disconnected | success | error | digest';
