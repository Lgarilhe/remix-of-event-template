-- ─────────────────────────────────────────────────────────────────────────────
-- Extension de member_quotas pour conformité LinkedIn (warning #260513-007211).
-- Permet à chaque user de configurer ses propres plages horaires d'activité
-- + un cap global d'actions/jour. Indispensable quand le même compte LinkedIn
-- est aussi utilisé par un autre outil tiers (cf. mémo
-- project_linkedin_recruiter_warning.md) : on découpe les plages horaires
-- entre les 2 outils pour éviter chevauchement + on cap le volume cumulé.
--
-- Lu par process-sequences et process-inmail-queue.
-- Idempotent (IF NOT EXISTS + DO block pour les constraints).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.member_quotas
  ADD COLUMN IF NOT EXISTS business_hours_start smallint DEFAULT 8,
  ADD COLUMN IF NOT EXISTS business_hours_end smallint DEFAULT 19,
  ADD COLUMN IF NOT EXISTS max_actions_per_day integer DEFAULT 80,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Europe/Paris';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_quotas_business_hours_range'
  ) THEN
    ALTER TABLE public.member_quotas
      ADD CONSTRAINT member_quotas_business_hours_range
      CHECK (
        business_hours_start >= 0 AND business_hours_start <= 23
        AND business_hours_end >= 1 AND business_hours_end <= 24
        AND business_hours_end > business_hours_start
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_quotas_max_actions_range'
  ) THEN
    ALTER TABLE public.member_quotas
      ADD CONSTRAINT member_quotas_max_actions_range
      CHECK (max_actions_per_day >= 0 AND max_actions_per_day <= 500);
  END IF;
END $$;

COMMENT ON COLUMN public.member_quotas.business_hours_start IS
  'Heure locale de début d''activité LinkedIn (0-23, default 8h). À ajuster si un autre outil partage le compte LinkedIn pour découper les plages.';
COMMENT ON COLUMN public.member_quotas.business_hours_end IS
  'Heure locale de fin d''activité LinkedIn (1-24, default 19h).';
COMMENT ON COLUMN public.member_quotas.max_actions_per_day IS
  'Cap global sur actions visibles (messages, InMails, invitations) par jour. Default 80. À baisser si le même compte LinkedIn est aussi utilisé par un autre outil — le cap doit refléter le volume cumulé acceptable, pas juste celui de Konekt.';
COMMENT ON COLUMN public.member_quotas.timezone IS
  'Timezone IANA pour évaluer les heures locales (default Europe/Paris).';
