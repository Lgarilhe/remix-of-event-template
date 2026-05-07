-- ════════════════════════════════════════════════════════════════════════
-- Migration : candidate_reminders V2 — standalone tasks + categorisation
-- ════════════════════════════════════════════════════════════════════════
--
-- Pourquoi : la table était trop rigide :
-- - candidate_id NOT NULL → impossible de créer une tâche admin/client
--   sans candidat lié
-- - Pas de catégorie → tout est dans le même "bucket" générique
-- - Pas de moyen de tagger les tâches auto-générées (debrief post-RDV)
-- - Pas de lien vers l'event qui a déclenché la tâche
--
-- Changes :
-- 1. candidate_id : DROP NOT NULL (standalone tasks possibles)
-- 2. category : enum-like text par défaut 'general' (general / follow_up /
--    interview_prep / debrief / admin / client)
-- 3. auto_generated : bool, true si créé par le système
-- 4. source_event_id : ref qualification_sessions, si tâche créée après un
--    event (debrief notamment) — sert à dédupliquer les auto-tasks
--
-- Idempotente. Pas de migration de données.
-- ════════════════════════════════════════════════════════════════════════

-- 1. candidate_id nullable
ALTER TABLE public.candidate_reminders
  ALTER COLUMN candidate_id DROP NOT NULL;

-- 2. Ajout des colonnes additives (idempotent)
ALTER TABLE public.candidate_reminders
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_event_id UUID
    REFERENCES public.qualification_sessions(id) ON DELETE SET NULL;

-- 3. Contrainte CHECK sur category (whitelist)
ALTER TABLE public.candidate_reminders
  DROP CONSTRAINT IF EXISTS candidate_reminders_category_check;

ALTER TABLE public.candidate_reminders
  ADD CONSTRAINT candidate_reminders_category_check
  CHECK (category IN (
    'general', 'follow_up', 'interview_prep', 'debrief',
    'admin', 'client', 'sourcing'
  ));

-- 4. Index pour les requêtes courantes
CREATE INDEX IF NOT EXISTS idx_candidate_reminders_category
  ON public.candidate_reminders (category);

CREATE INDEX IF NOT EXISTS idx_candidate_reminders_source_event
  ON public.candidate_reminders (source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_reminders_due_at
  ON public.candidate_reminders (due_at)
  WHERE completed_at IS NULL;

-- 5. Comments pour clarté
COMMENT ON COLUMN public.candidate_reminders.candidate_id IS
  'Candidat lié (nullable). Si NULL, c''est une tâche standalone (admin, client, etc.)';
COMMENT ON COLUMN public.candidate_reminders.category IS
  'Catégorie : general / follow_up / interview_prep / debrief / admin / client / sourcing';
COMMENT ON COLUMN public.candidate_reminders.auto_generated IS
  'true si créé automatiquement par le système (post-RDV debrief, stagnant, etc.)';
COMMENT ON COLUMN public.candidate_reminders.source_event_id IS
  'Event qualification qui a déclenché cette tâche (debrief notamment). Sert à
   dédupliquer les auto-tasks (1 debrief / event max).';
