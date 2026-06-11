-- Titre auto-généré (IA) des conversations du copilot.
-- Rempli en fire-and-forget par search-agent-chat après le premier échange.
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS title text;
