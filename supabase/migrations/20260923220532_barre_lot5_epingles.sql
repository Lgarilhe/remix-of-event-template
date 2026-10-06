-- =====================================================================
-- Barre latérale, lot 5 : épingles de missions (job_favorites).
--
-- Deux états de départ :
--   prod (créée depuis MIGRATION_CLEAN.sql:964-969) : id, created_at, job_id,
--     user_id ; aucune unicité ; une policy own_rows_all (FOR ALL, user_id =
--     auth.uid(), MIGRATION_CLEAN.sql:3532-3536) ; pas d'organization_id.
--   base neuve (migrations) : UNIQUE (user_id, job_id) posée par
--     20260127175338 (contrainte job_favorites_user_id_job_id_key),
--     organization_id ajoutée par 20260309170000:71-74, six policies :
--     « Users can view / add / delete their own favorites » (20260127175338:18-33)
--     et « Org members can view / create / delete job favorites »
--     (20260309170000:438-456), dont une lecture ouverte à l'organisation.
--
-- Effet :
--   1. dédoublonnage (garde la plus ancienne ligne de chaque couple) ;
--   2. index unique (user_id, job_id) sous le nom de la contrainte de la base
--      neuve : sans effet en base neuve, créé en prod ;
--   3. toutes les policies retirées quel que soit leur nom (CLAUDE.md règle 7),
--      une seule recréée : « mes lignes » ;
--   4. contrôle final qui fait échouer la migration si l'état n'est pas le bon ;
--   5. index des deux lectures permanentes de la barre (notifications non lues,
--      tâches en retard), déclarés par 20260310073451:75 et 20260507025500:53-55.
--      Mêmes noms, IF NOT EXISTS : sans effet en base neuve. En prod (lecture du
--      23/09/2026), idx_candidate_reminders_due_at existe déjà avec cette
--      définition (partiel, WHERE completed_at IS NULL) et idx_notifications_user
--      manque : seul ce dernier y est créé.
-- organization_id n'est ni lue, ni écrite, ni supprimée : absente en prod, le
-- front ne l'utilise pas.
-- Plafond de 10 épingles : côté front seulement (D22), aucun déclencheur.
-- =====================================================================

-- 1. Dédoublonnage
DELETE FROM public.job_favorites a
USING public.job_favorites b
WHERE a.user_id = b.user_id
  AND a.job_id = b.job_id
  AND (a.created_at, a.id) > (b.created_at, b.id);

-- 2. Unicité (même nom que la contrainte UNIQUE de la base neuve)
CREATE UNIQUE INDEX IF NOT EXISTS job_favorites_user_id_job_id_key
  ON public.job_favorites (user_id, job_id);

-- 3. Policies : une seule, sur mes lignes
ALTER TABLE public.job_favorites ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_favorites'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_favorites', r.policyname);
  END LOOP;
END $$;

CREATE POLICY own_rows_all ON public.job_favorites
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Contrôle
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'job_favorites';
  IF n <> 1 THEN
    RAISE EXCEPTION 'job_favorites : % policies (attendu : 1, own_rows_all)', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'job_favorites'
      AND indexname = 'job_favorites_user_id_job_id_key'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%(user_id, job_id)%'
  ) THEN
    RAISE EXCEPTION 'job_favorites : index unique (user_id, job_id) absent';
  END IF;
END $$;

-- 5. Index des lectures permanentes de la barre
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications (user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_candidate_reminders_due_at
  ON public.candidate_reminders (due_at)
  WHERE completed_at IS NULL;
