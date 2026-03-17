CREATE TABLE public.enrichment_cache (
  cache_key text PRIMARY KEY,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allow cleanup of old entries
CREATE INDEX idx_enrichment_cache_created ON enrichment_cache(created_at);

-- No RLS needed — only accessed by service role from edge function
ALTER TABLE public.enrichment_cache ENABLE ROW LEVEL SECURITY;