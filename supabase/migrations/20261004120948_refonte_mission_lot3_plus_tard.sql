-- =====================================================================
-- Refonte mission, lot 3 : « Plus tard » de la carte Maintenant.
--
-- Un report par personne, par mission et par action : la personne qui clique
-- « Plus tard » ne voit plus cette action jusqu'à expires_at (le lendemain
-- matin, heure du navigateur, calculée par le front). Aucun lien avec le
-- chiffre d'À traiter de la barre : cette table n'est lue ni écrite par la
-- barre, et aucun déclencheur ne touche notifications, candidate_reminders
-- ni les signaux de l'assistant.
--
-- action_key : « <nature> » ou « <nature>:<identifiant> », en minuscules
--   (exemples : retained_uncontacted, to_sort, reply:<candidate_id>). Le rang
--   n'est pas stocké : la règle d'ordre peut changer sans migration.
--
-- Table neuve dans les deux états de départ (prod créée depuis
-- MIGRATION_CLEAN.sql, base neuve rejouée depuis les migrations) : aucune
-- policy héritée à retirer. Trois policies seulement :
--   own_rows_all             PERMISSIVE  ALL     user_id = auth.uid()
--   mission_same_org_insert  RESTRICTIVE INSERT  la mission est celle de l'organisation active de l'auteur
--   mission_same_org_update  RESTRICTIVE UPDATE  idem, sur la ligne écrite
-- (même modèle que les policies mission_same_org_* de 20260927233806).
-- Aucune fonction nouvelle : l'audit rls_and_definer_audit.sql reste inchangé.
-- =====================================================================

-- 0. Précondition : les aides existent (prod et base neuve).
DO $pre$
BEGIN
  IF to_regprocedure('public.project_organization_id(uuid)') IS NULL
     OR to_regprocedure('public.get_user_org_id(uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'mission_action_snoozes : aide absente (project_organization_id, get_user_org_id ou update_updated_at_column)';
  END IF;
END
$pre$;

-- 1. Table
CREATE TABLE IF NOT EXISTS public.mission_action_snoozes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  action_key  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mission_action_snoozes_key UNIQUE (user_id, project_id, action_key),
  CONSTRAINT mission_action_snoozes_action_key_format
    CHECK (char_length(action_key) <= 200 AND action_key ~ '^[a-z][a-z0-9_]*(:.+)?$')
);

-- Suppression d'une mission : la clé étrangère cherche par project_id.
CREATE INDEX IF NOT EXISTS idx_mission_action_snoozes_project
  ON public.mission_action_snoozes (project_id);

-- updated_at = instant (serveur) du dernier report ; le front le compare à la
-- date du dernier événement d'une action pour savoir si la situation a changé.
DROP TRIGGER IF EXISTS update_mission_action_snoozes_updated_at ON public.mission_action_snoozes;
CREATE TRIGGER update_mission_action_snoozes_updated_at
  BEFORE UPDATE ON public.mission_action_snoozes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. RLS
ALTER TABLE public.mission_action_snoozes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_rows_all ON public.mission_action_snoozes;
CREATE POLICY own_rows_all ON public.mission_action_snoozes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- La mission d'une autre organisation est refusée, existante ou non (même
-- erreur : pas de moyen de tester l'existence d'une mission). Évalué avant la
-- clé étrangère.
DROP POLICY IF EXISTS mission_same_org_insert ON public.mission_action_snoozes;
CREATE POLICY mission_same_org_insert ON public.mission_action_snoozes
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.project_organization_id(project_id) = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS mission_same_org_update ON public.mission_action_snoozes;
CREATE POLICY mission_same_org_update ON public.mission_action_snoozes
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (public.project_organization_id(project_id) = public.get_user_org_id(auth.uid()));

-- 3. Privilèges : rien pour anon, quatre droits pour authenticated (la RLS
-- borne les lignes), tout pour la clé de service.
REVOKE ALL ON public.mission_action_snoozes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mission_action_snoozes TO authenticated;
GRANT ALL ON public.mission_action_snoozes TO service_role;

COMMENT ON TABLE public.mission_action_snoozes IS
  'Lot 3 : reports « Plus tard » de la carte Maintenant, par personne, mission et action. Une ligne échue ne compte plus ; supprimée la nuit suivante.';

-- 4. Purge quotidienne des lignes échues depuis plus de 2 jours (pg_cron).
-- Même forme que cleanup-cron-run-details (20260924060053) : rejouable,
-- ignorée si pg_cron n'est pas installé. Elle borne la durée de vie des
-- identifiants de candidats gardés dans action_key.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-mission-action-snoozes',
      '50 3 * * *',
      $cmd$DELETE FROM public.mission_action_snoozes WHERE expires_at < now() - interval '2 days'$cmd$
    );
  END IF;
END
$cron$;

-- 5. Contrôle final : l'état attendu, sinon la migration échoue.
DO $check$
DECLARE
  n integer;
  pr text;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'mission_action_snoozes';
  IF n <> 3 THEN
    RAISE EXCEPTION 'mission_action_snoozes : % policies (attendu : 3)', n;
  END IF;
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.mission_action_snoozes', pr) THEN
      RAISE EXCEPTION 'mission_action_snoozes : anon a le droit %', pr;
    END IF;
  END LOOP;
END
$check$;

NOTIFY pgrst, 'reload schema';
