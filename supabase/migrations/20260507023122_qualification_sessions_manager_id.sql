-- ════════════════════════════════════════════════════════════════════════
-- Migration : ajout de manager_id à qualification_sessions
-- ════════════════════════════════════════════════════════════════════════
--
-- Pourquoi : aujourd'hui `created_by` représente la personne qui a créé
-- l'event (RLS-bound à auth.uid()). Mais le **manager qui anime
-- réellement l'entretien** peut être quelqu'un d'autre dans la team
-- (un consultant senior qui prend le RDV programmé par un assistant,
-- par exemple).
--
-- Solution : nouvelle colonne `manager_id` qui référence auth.users(id),
-- nullable. Si NULL, fallback côté UI sur `created_by`.
--
-- Idempotente : `IF NOT EXISTS`. Aucune migration de données nécessaire,
-- les events existants gardent created_by comme manager par défaut.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.qualification_sessions
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index pour les requêtes de filtre par manager (vue calendrier "Mes RDV"
-- ou filtre par manager dans la barre de filtres)
CREATE INDEX IF NOT EXISTS idx_qualification_sessions_manager_id
  ON public.qualification_sessions (manager_id)
  WHERE manager_id IS NOT NULL;

-- Commentaire pour clarité
COMMENT ON COLUMN public.qualification_sessions.manager_id IS
  'User assigné comme manager/animateur de l''entretien. Distinct de
   created_by (recruteur qui a planifié). Si NULL, fallback UI sur
   created_by.';
