-- ============================================
-- Migration: audits marque employeur persistés + snapshot d'enrichissement org
--
-- Refonte onboarding (06/07/2026) :
-- 1. employer_brand_audits — l'audit marque employeur devient une feature
--    re-consultable : audit-employer-brand persiste désormais son résultat
--    (score, catégories, quick wins) au lieu de le jeter à la fin de l'écran.
-- 2. organizations.enrichment_snapshot — l'enrichissement société lancé en
--    arrière-plan pendant l'onboarding y dépose son résultat condensé
--    (industrie, description, postes ouverts, careers_url...), consommé par
--    la carte « postes détectés » et les brouillons IA du dashboard.
-- ============================================

-- ============================================
-- Phase 1: Schema
-- ============================================

CREATE TABLE IF NOT EXISTS public.employer_brand_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  company_name text NOT NULL,
  score integer,
  categories jsonb,
  quick_wins jsonb,
  summary text
);

-- Index on organization_id (MANDATORY for RLS performance)
CREATE INDEX IF NOT EXISTS idx_employer_brand_audits_org_id ON public.employer_brand_audits(organization_id);

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enrichment_snapshot jsonb;

-- ============================================
-- Phase 2: RLS
-- ============================================

ALTER TABLE public.employer_brand_audits ENABLE ROW LEVEL SECURITY;

-- Service role bypass (edge functions need this)
CREATE POLICY "Service role full access"
  ON public.employer_brand_audits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Org-scoped read
CREATE POLICY "Org members can view employer_brand_audits"
  ON public.employer_brand_audits FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

-- Org-scoped insert (l'écriture normale passe par l'edge function en service
-- role ; on autorise aussi l'insert direct d'un membre par cohérence)
CREATE POLICY "Org members can create employer_brand_audits"
  ON public.employer_brand_audits FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_org_member(auth.uid(), organization_id)
  );

-- Org-scoped delete
CREATE POLICY "Org members can delete employer_brand_audits"
  ON public.employer_brand_audits FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
  );
