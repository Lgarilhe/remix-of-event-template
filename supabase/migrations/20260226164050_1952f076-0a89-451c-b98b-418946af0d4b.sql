
-- Cache for pre-computed AI analysis of incoming messages
CREATE TABLE public.message_analysis_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id text NOT NULL,
  account_id text NOT NULL,
  recipient_name text,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT message_analysis_cache_chat_id_account_id_key UNIQUE (chat_id, account_id)
);

-- Enable RLS
ALTER TABLE public.message_analysis_cache ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can read analysis cache"
  ON public.message_analysis_cache FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage analysis cache"
  ON public.message_analysis_cache FOR ALL
  USING (auth.role() = 'service_role');

-- Index for fast lookups
CREATE INDEX idx_message_analysis_cache_chat_account ON public.message_analysis_cache (chat_id, account_id);

-- Auto-update timestamp
CREATE TRIGGER update_message_analysis_cache_updated_at
  BEFORE UPDATE ON public.message_analysis_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
