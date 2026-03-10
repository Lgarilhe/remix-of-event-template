ALTER TABLE public.vivier_enrichments
  ADD COLUMN IF NOT EXISTS still_same_company boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS company_change_detail text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notable_events jsonb DEFAULT '[]'::jsonb;