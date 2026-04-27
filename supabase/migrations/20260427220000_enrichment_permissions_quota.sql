-- Migration : permissions enrichment + quota mensuel par user
--
-- Objectifs :
-- 1. Permettre à un admin de désactiver l'enrichment pour certains membres
--    (ex: juniors sans budget alloué) via colonne can_enrich_contacts
-- 2. Limiter chaque user à un quota mensuel d'enrichments (default 100/mois)
--    Configurable par-user. Admin peut booster.
--
-- Reset du quota : auto via la colonne quota_period_start, on compare
-- avec current_month en runtime (pas besoin de cron).

-- ─── 1. Colonne can_enrich_contacts sur organization_members ────────────────

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS can_enrich_contacts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enrichment_quota_monthly integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.organization_members.can_enrich_contacts IS
  'Si false, ce membre ne peut pas déclencher d''enrichment de contact. Admin peut désactiver pour limiter coûts.';

COMMENT ON COLUMN public.organization_members.enrichment_quota_monthly IS
  'Nombre max d''enrichments par mois pour ce membre. Default 100. Admin peut override via UI.';

-- ─── 2. Table enrichment_user_quotas — compteur mensuel par-user ────────────

CREATE TABLE IF NOT EXISTS public.enrichment_user_quotas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Premier jour du mois en cours (UTC) — utilisé pour reset auto
  -- Format: 'YYYY-MM-01' (date trunc month)
  period_month    date NOT NULL,

  -- Compteurs (incrémentés après chaque enrich réussi)
  emails_consumed integer NOT NULL DEFAULT 0,
  phones_consumed integer NOT NULL DEFAULT 0,
  total_credits_used integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Une row par (user, org, mois) — atomic upsert
  CONSTRAINT enrichment_quotas_user_org_month_unique
    UNIQUE (user_id, organization_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_quotas_user_org_period
  ON public.enrichment_user_quotas (user_id, organization_id, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_enrichment_quotas_org_period
  ON public.enrichment_user_quotas (organization_id, period_month DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.enrichment_user_quotas ENABLE ROW LEVEL SECURITY;

-- SELECT : un user peut voir son propre quota + admin org peut voir tous
CREATE POLICY enrichment_quotas_select_own
  ON public.enrichment_user_quotas
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- INSERT/UPDATE : service_role uniquement (incrément géré côté edge function)
GRANT SELECT ON public.enrichment_user_quotas TO authenticated;
GRANT ALL ON public.enrichment_user_quotas TO service_role;

-- ─── Fonction utilitaire RPC : incrément atomique du quota ──────────────────

CREATE OR REPLACE FUNCTION public.increment_enrichment_quota(
  p_user_id uuid,
  p_org_id uuid,
  p_emails integer DEFAULT 0,
  p_phones integer DEFAULT 0,
  p_credits integer DEFAULT 0
)
RETURNS public.enrichment_user_quotas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period date := date_trunc('month', now())::date;
  v_row public.enrichment_user_quotas;
BEGIN
  INSERT INTO public.enrichment_user_quotas (user_id, organization_id, period_month, emails_consumed, phones_consumed, total_credits_used)
  VALUES (p_user_id, p_org_id, v_period, p_emails, p_phones, p_credits)
  ON CONFLICT (user_id, organization_id, period_month)
  DO UPDATE SET
    emails_consumed = enrichment_user_quotas.emails_consumed + EXCLUDED.emails_consumed,
    phones_consumed = enrichment_user_quotas.phones_consumed + EXCLUDED.phones_consumed,
    total_credits_used = enrichment_user_quotas.total_credits_used + EXCLUDED.total_credits_used,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_enrichment_quota TO service_role;

-- ─── Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.enrichment_user_quotas IS
  'Quota mensuel d''enrichments par-user. Reset auto au début du mois (nouvelle row).';

COMMENT ON FUNCTION public.increment_enrichment_quota IS
  'Incrément atomique du quota d''un user pour le mois en cours. Crée la row si absente.';
