
-- Add archived_at column for soft-archive
ALTER TABLE public.agent_conversations 
ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

-- Add index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_agent_conversations_archived 
ON public.agent_conversations (status, updated_at) 
WHERE archived_at IS NULL;

-- Function to archive old completed conversations
CREATE OR REPLACE FUNCTION public.archive_old_agent_conversations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
BEGIN
  UPDATE public.agent_conversations
  SET archived_at = now()
  WHERE status IN ('completed', 'error')
    AND updated_at < now() - interval '30 days'
    AND archived_at IS NULL;
  
  GET DIAGNOSTICS archived_count = ROW_COUNT;
  
  -- Also delete associated messages for conversations archived > 60 days ago
  DELETE FROM public.agent_messages
  WHERE conversation_id IN (
    SELECT id FROM public.agent_conversations
    WHERE archived_at IS NOT NULL
      AND archived_at < now() - interval '60 days'
  );
  
  -- Hard-delete conversations archived > 60 days ago
  DELETE FROM public.agent_conversations
  WHERE archived_at IS NOT NULL
    AND archived_at < now() - interval '60 days';
  
  RETURN archived_count;
END;
$$;
