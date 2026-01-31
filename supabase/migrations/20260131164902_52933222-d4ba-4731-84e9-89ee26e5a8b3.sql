-- Cache table for expensive external API responses (e.g., Notion)
CREATE TABLE IF NOT EXISTS public.notion_api_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Basic index for housekeeping / lookups by recency
CREATE INDEX IF NOT EXISTS idx_notion_api_cache_updated_at
ON public.notion_api_cache (updated_at);

-- Enable Row Level Security so the table isn't readable from the client by default.
ALTER TABLE public.notion_api_cache ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies: only service-role (backend) reads/writes this table.
