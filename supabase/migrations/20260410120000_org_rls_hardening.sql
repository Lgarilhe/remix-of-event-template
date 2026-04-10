-- Sprint 2: Multi-tenant RLS hardening
-- Fixes: airtable_glossary open SELECT, airtable_sync_meta open SELECT

-- ── 1. airtable_glossary: replace open SELECT with org-scoped policy ──

DROP POLICY IF EXISTS "Authenticated users can read glossary" ON public.airtable_glossary;

CREATE POLICY "Users can read own org glossary" ON public.airtable_glossary
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR organization_id IS NULL
  );

-- ── 2. airtable_sync_meta: add organization_id and org-scoped policy ──

ALTER TABLE public.airtable_sync_meta
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

DROP POLICY IF EXISTS "Authenticated users can read sync meta" ON public.airtable_sync_meta;

CREATE POLICY "Users can read own org sync meta" ON public.airtable_sync_meta
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR organization_id IS NULL
  );
