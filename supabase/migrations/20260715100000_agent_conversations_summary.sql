-- ============================================================================
-- Compaction des conversations longues (P4.2 — suite audit agent 2026-07-14)
-- ============================================================================
-- search-agent-chat ne charge que les 24 messages les plus récents : au-delà,
-- le début de la conversation est simplement PERDU pour le modèle. On stocke
-- un résumé glissant du contexte ancien, régénéré en tâche de fond (Haiku)
-- quand assez de nouveaux messages sont sortis de la fenêtre, et injecté dans
-- le system prompt.
--   summary                : résumé du contexte sorti de la fenêtre de 24
--   summary_message_count  : nb de messages couverts par ce résumé (curseur)
-- Idempotente, rejouable.
-- ============================================================================

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_message_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.agent_conversations.summary IS
  'Résumé glissant du début de conversation (messages sortis de la fenêtre de contexte de 24). Généré par l''IA en tâche de fond.';
COMMENT ON COLUMN public.agent_conversations.summary_message_count IS
  'Nombre de messages (ordre chronologique) couverts par summary — curseur de compaction.';
