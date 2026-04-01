-- ============================================================================
-- Migration: Add AI model default to organizations for backend model resolution
-- ============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_model_default text;
-- Stores the org's preferred AI model (e.g. 'claude-sonnet-4-6', 'claude-haiku-4-5')
-- Used by cron-triggered functions (process-sequences) that can't read frontend localStorage
-- NULL = use routing tier defaults from ai-config.ts
