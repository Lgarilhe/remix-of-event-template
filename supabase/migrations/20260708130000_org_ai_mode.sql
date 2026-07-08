-- Mode IA souverain — flag par organisation.
-- Cf. docs/ai-sovereign-mode.md.
--   performance  : frontier (Claude), défaut.
--   sovereign    : modèles open source hébergés UE (Scaleway / OVH).
--   sovereign_fr : variante « 100 % modèle français » (Mistral only).
-- Idempotente, rejouable.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'performance';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_ai_mode_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_ai_mode_check
      CHECK (ai_mode IN ('performance', 'sovereign', 'sovereign_fr'));
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.ai_mode IS
  'Mode IA de l''org : performance (Claude, défaut) | sovereign (open source UE) | sovereign_fr (Mistral only).';
