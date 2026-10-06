-- Agenda Outlook (lot I3, étape 2), demande de fusion A : base de données.
-- Plan : docs/refonte-mission/agenda-outlook-construction-2026-10-05.md, sections 4 et 8.
--
-- 1. Table member_calendar_accounts : l'agenda (Outlook, Google plus tard) qu'une
--    personne relie à son organisation. Une ligne par agenda relié, écrite par les
--    fonctions serveur seulement ; lue par la personne et par les propriétaires et
--    administrateurs de l'organisation.
-- 2. qualification_sessions : trois colonnes pour les séances lues dans un agenda
--    (origine, agenda, identifiant de l'événement), l'origine « booking » reprise
--    pour les séances Calendly, un index unique pour qu'un événement ne crée
--    qu'une séance, un index de lecture par date.
--
-- Aucune fonction ni tâche planifiée ici : elles viennent avec la demande B.
-- Rejouable, sur base neuve comme en production (qualification_sessions y a les
-- policies org_members_all et service_role_all de MIGRATION_CLEAN.sql, aucune
-- n'est touchée).

-- ─── 1. Table member_calendar_accounts ──────────────────────────────────────
-- account_id : identifiant du compte chez le service de connexion (acc_...).
-- status : reflet de l'état du compte chez ce service (running, error, ...),
--   texte libre tenu à jour par la synchronisation.
-- last_synced_at et last_error : dernier passage de la synchronisation.
CREATE TABLE IF NOT EXISTS public.member_calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('outlook', 'google')),
  account_id text NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 200),
  email_address text CHECK (char_length(email_address) <= 320),
  status text NOT NULL DEFAULT 'running' CHECK (char_length(status) <= 100),
  last_synced_at timestamptz,
  last_error text CHECK (char_length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_calendar_accounts_org_account_key UNIQUE (organization_id, account_id),
  CONSTRAINT member_calendar_accounts_org_user_provider_key UNIQUE (organization_id, user_id, provider)
);

-- La policy de lecture cherche par user_id.
CREATE INDEX IF NOT EXISTS idx_member_calendar_accounts_user
  ON public.member_calendar_accounts (user_id);

DROP TRIGGER IF EXISTS update_member_calendar_accounts_updated_at ON public.member_calendar_accounts;
CREATE TRIGGER update_member_calendar_accounts_updated_at
  BEFORE UPDATE ON public.member_calendar_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.member_calendar_accounts ENABLE ROW LEVEL SECURITY;

-- Une personne lit sa ligne tant qu'elle est membre de l'organisation ; un
-- propriétaire ou administrateur lit celles de l'organisation. Aucune policy
-- d'écriture : seule la clé de service, qui ignore la RLS, écrit.
DROP POLICY IF EXISTS member_calendar_accounts_select ON public.member_calendar_accounts;
CREATE POLICY member_calendar_accounts_select ON public.member_calendar_accounts
  FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid() AND public.is_org_member(auth.uid(), organization_id))
    OR public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

-- Rien pour anon, lecture seule pour authenticated (la RLS borne les lignes),
-- tout pour la clé de service.
REVOKE ALL ON public.member_calendar_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_calendar_accounts TO authenticated;
GRANT ALL ON public.member_calendar_accounts TO service_role;

COMMENT ON TABLE public.member_calendar_accounts IS
  'Agenda relié par un membre (Outlook, Google plus tard), par organisation. Écrite par les fonctions serveur calendar-*, jamais par le navigateur. Contient l''adresse du recruteur : exportée par export-org-data, supprimée avec l''organisation.';

-- ─── 2. qualification_sessions : séances lues dans un agenda ───────────────
-- source : manual (saisie), agenda (lue dans un agenda relié), invitation
--   (invitation envoyée par Konekt), booking (prise de rendez-vous Calendly).
-- calendar_account_id et external_event_id : l'agenda et l'événement d'une séance
--   « agenda ». Un agenda retiré laisse la séance (SET NULL), qui garde ses notes
--   et sa décision.
ALTER TABLE public.qualification_sessions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS calendar_account_id uuid REFERENCES public.member_calendar_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_event_id text;

ALTER TABLE public.qualification_sessions
  DROP CONSTRAINT IF EXISTS qualification_sessions_source_check;
ALTER TABLE public.qualification_sessions
  ADD CONSTRAINT qualification_sessions_source_check
  CHECK (source IN ('manual', 'agenda', 'invitation', 'booking'));

-- Les séances créées par calendly-webhook portent calendly_event_id. Seules
-- les lignes encore à la valeur par défaut sont reprises : rejouable sans
-- écraser une origine posée depuis. La mise à jour passe par le déclencheur
-- updated_at : la date de modification de ces séances avance une fois.
UPDATE public.qualification_sessions
   SET source = 'booking'
 WHERE calendly_event_id IS NOT NULL
   AND source = 'manual';

-- Un événement d'un agenda ne crée qu'une séance. Partiel : les séances
-- saisies ou Calendly n'ont ni agenda ni identifiant d'événement.
CREATE UNIQUE INDEX IF NOT EXISTS qualification_sessions_agenda_event_key
  ON public.qualification_sessions (calendar_account_id, external_event_id)
  WHERE calendar_account_id IS NOT NULL AND external_event_id IS NOT NULL;

-- Lecture des séances d'une organisation par date (barre latérale, agenda).
CREATE INDEX IF NOT EXISTS idx_qualification_sessions_org_start
  ON public.qualification_sessions (organization_id, event_start_at);

-- ─── 3. Contrôle final : l'état attendu, sinon la migration échoue ─────────
DO $check$
DECLARE
  n integer;
  pr text;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'member_calendar_accounts';
  IF n <> 1 THEN
    RAISE EXCEPTION 'member_calendar_accounts : % policies (attendu : 1)', n;
  END IF;
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.member_calendar_accounts', pr) THEN
      RAISE EXCEPTION 'member_calendar_accounts : anon a le droit %', pr;
    END IF;
  END LOOP;
  FOREACH pr IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege('authenticated', 'public.member_calendar_accounts', pr) THEN
      RAISE EXCEPTION 'member_calendar_accounts : authenticated a le droit %', pr;
    END IF;
  END LOOP;
END
$check$;

NOTIFY pgrst, 'reload schema';
