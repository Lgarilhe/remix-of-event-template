
ALTER TABLE public.organization_integrations
  ADD COLUMN IF NOT EXISTS apollo_api_key text,
  ADD COLUMN IF NOT EXISTS pdl_api_key text,
  ADD COLUMN IF NOT EXISTS anthropic_api_key text;
