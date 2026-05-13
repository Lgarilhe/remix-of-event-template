-- Add AI context columns for user-level and org-level personalization.
--
-- Both columns store a structured JSONB doc :
-- {
--   "tone": "tu" | "vous" | "casual" | "formal" | null,
--   "specialty": string (max 200 chars),         -- "Tech recruiter SaaS scale-up FR/EU"
--   "do": string[] (max 10 items, 200 chars each),  -- "toujours mentionner remote OK"
--   "dont": string[] (max 10 items, 200 chars each),-- "jamais 'belle opportunité'"
--   "free_text": string (max 1000 chars)          -- nuances additionnelles
-- }
--
-- Usage : loaded by `_shared/ai-context.ts` (added in Phase 2) and injected as
-- a prefix block to the system prompt of user-facing AI calls (outreach gen,
-- reply suggestions, chat assistant, etc.). User-level context overrides
-- org-level when both are set.
--
-- RLS unchanged — existing policies already cover :
--   organizations : SELECT by members, UPDATE by owners
--   profiles      : SELECT same-org, UPDATE own rows
-- Idempotent : safe to re-run.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_context jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_context jsonb;

COMMENT ON COLUMN public.organizations.ai_context IS
  'Structured AI personalization context (tone, specialty, do/dont, free_text). Injected into all user-facing AI prompts at org level (Konekt brand voice, market focus). Admin-editable only.';

COMMENT ON COLUMN public.profiles.ai_context IS
  'Structured AI personalization context per user. Overrides org-level when set. User-editable on own row.';
