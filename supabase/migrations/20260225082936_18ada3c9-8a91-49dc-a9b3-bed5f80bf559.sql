
-- Create a simple processing lock table
CREATE TABLE public.sequence_processing_lock (
  id TEXT PRIMARY KEY DEFAULT 'process',
  locked_at TIMESTAMP WITH TIME ZONE,
  locked_by TEXT
);

-- Insert the single lock row
INSERT INTO public.sequence_processing_lock (id, locked_at, locked_by) VALUES ('process', NULL, NULL);

-- No RLS needed — only accessed by service role from edge functions
ALTER TABLE public.sequence_processing_lock ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role manages lock"
ON public.sequence_processing_lock
FOR ALL
USING (true)
WITH CHECK (true);
