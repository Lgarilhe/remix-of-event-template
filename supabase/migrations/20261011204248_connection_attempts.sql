-- Tentatives de connexion d'un compte (LinkedIn, WhatsApp, messagerie) : API v2 du
-- service de connexion, contrat S1 / S2 / S1U.
--
-- 1. Table connection_attempts. Une ligne par tentative, ecrite par les fonctions
--    serveur seulement (cle de service). Son id uuid est le `state` passe au
--    prestataire (lien hote et connexion native) : c'est la seule piste qui relie
--    un evenement du prestataire a un membre et a une organisation. Le navigateur
--    ne fournit jamais l'utilisateur, l'organisation ni l'adresse de retour.
-- 2. purge_connection_attempts() : passe les tentatives echues en `expired`, puis
--    supprime celles de plus de 24 h. Tache planifiee toutes les heures (ignoree
--    sans pg_cron).
-- 3. Statuts de compte : OK, CREDENTIALS, ERROR, DEGRADED, PARTIAL et LOCKED doivent
--    etre admis dans account_status des trois tables de liaison. Aucune migration
--    du depot ne pose de contrainte CHECK sur ces colonnes ; si la base en porte une
--    (heritage de l'import, production), elle est remplacee par une liste elargie.
--
-- Rejouable, sur base neuve comme en production. Regles de CLAUDE.md : fichier
-- committe, horodatage unique, aucun objet qui n'existe que dans l'import
-- (to_regclass), fonction SECURITY DEFINER sans EXECUTE pour PUBLIC ni anon.

-- --- 1. Table connection_attempts ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.connection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL
    CONSTRAINT connection_attempts_provider_check
    CHECK (provider IN ('linkedin', 'whatsapp', 'google', 'outlook', 'imap')),
  purpose text NOT NULL DEFAULT 'link'
    CONSTRAINT connection_attempts_purpose_check
    CHECK (purpose IN ('link', 'reconnect')),
  -- Identifiant v2 (acc_...) du compte a reconnecter, seulement pour purpose 'reconnect'.
  reconnect_account_id text
    CONSTRAINT connection_attempts_reconnect_account_check
    CHECK (reconnect_account_id IS NULL OR reconnect_account_id ~ '^acc_[A-Za-z0-9_-]+$'),
  mode text NOT NULL DEFAULT 'hosted'
    CONSTRAINT connection_attempts_mode_check
    CHECK (mode IN ('hosted', 'native')),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT connection_attempts_status_check
    CHECK (status IN ('pending', 'completed', 'failed', 'expired', 'cancelled')),
  -- Identifiant d'intention d'authentification tant qu'un flux natif est ouvert.
  intent_id text,
  -- Compte obtenu (acc_...) une fois la tentative terminee.
  account_id text,
  -- Nature de l'echec (ErrorKind du client), jamais un texte du prestataire.
  error_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  CONSTRAINT connection_attempts_reconnect_consistency
    CHECK ((purpose = 'reconnect') = (reconnect_account_id IS NOT NULL))
);

-- Une seule tentative en cours par membre et par canal : un nouveau depart annule
-- la precedente (la fonction serveur le fait avant d'inserer).
CREATE UNIQUE INDEX IF NOT EXISTS connection_attempts_one_pending_idx
  ON public.connection_attempts (user_id, provider)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS connection_attempts_org_idx
  ON public.connection_attempts (organization_id);

-- La purge cherche par date.
CREATE INDEX IF NOT EXISTS connection_attempts_created_idx
  ON public.connection_attempts (created_at);

ALTER TABLE public.connection_attempts ENABLE ROW LEVEL SECURITY;

-- Rien pour anon ni PUBLIC. authenticated lit ses lignes (policy ci-dessous) et
-- n'ecrit jamais : seule la cle de service, qui ignore la RLS, ecrit.
REVOKE ALL ON public.connection_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.connection_attempts TO authenticated;
GRANT ALL ON public.connection_attempts TO service_role;

DROP POLICY IF EXISTS connection_attempts_select_own ON public.connection_attempts;
CREATE POLICY connection_attempts_select_own ON public.connection_attempts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.connection_attempts IS
  'Tentatives de connexion d''un compte (id = state passe au prestataire). Ecrite par les fonctions serveur seulement.';

-- --- 2. Purge ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_connection_attempts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  -- Une tentative echue reste `pending` en base tant que personne ne la lit : on la
  -- ferme, ce qui libere aussi l'index unique des tentatives en cours.
  UPDATE public.connection_attempts
     SET status = 'expired'
   WHERE status = 'pending'
     AND expires_at < now();

  DELETE FROM public.connection_attempts
   WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_connection_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_connection_attempts() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('purge-connection-attempts');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'purge-connection-attempts',
      '17 * * * *',
      $cmd$SELECT public.purge_connection_attempts();$cmd$
    );
  END IF;
END
$cron$;

-- --- 3. Statuts de compte elargis ---------------------------------------------
-- Pour chaque table de liaison qui existe, toute contrainte CHECK qui porte sur
-- account_status est remplacee par une liste qui admet les six statuts du client
-- (OK, CREDENTIALS, ERROR, DEGRADED, PARTIAL, LOCKED) et les valeurs deja ecrites
-- par le code (CONNECTING, STOPPED, PERMISSIONS, DELETED, DISCONNECTED, UNKNOWN...).
-- Sans contrainte existante, rien n'est pose : la colonne est du texte libre.
-- La nouvelle contrainte est NOT VALID (aucun controle des lignes anciennes) puis
-- validee si les donnees le permettent.
DO $widen$
DECLARE
  t text;
  c record;
  had_check boolean;
  allowed constant text :=
    '''OK'', ''CREDENTIALS'', ''ERROR'', ''DEGRADED'', ''PARTIAL'', ''LOCKED'', '
    '''CONNECTING'', ''STOPPED'', ''PERMISSIONS'', ''DELETED'', ''DISCONNECTED'', '
    '''SYNC_SUCCESS'', ''RECONNECTED'', ''CREATION_SUCCESS'', ''CAPTCHA'', ''UNKNOWN''';
BEGIN
  FOREACH t IN ARRAY ARRAY['member_linkedin_accounts', 'member_email_accounts', 'member_whatsapp_accounts'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    had_check := false;
    FOR c IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = format('public.%I', t)::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%account_status%'
    LOOP
      had_check := true;
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;
    IF had_check THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (account_status IS NULL OR account_status IN (%s)) NOT VALID',
        t, t || '_account_status_check', allowed
      );
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_account_status_check');
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'contrainte % laissee NOT VALID : des lignes anciennes portent une autre valeur', t || '_account_status_check';
      END;
    END IF;
  END LOOP;
END
$widen$;

-- --- 4. Controle final : l'etat attendu, sinon la migration echoue ------------
DO $check$
DECLARE
  n integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.connection_attempts'::regclass) THEN
    RAISE EXCEPTION 'connection_attempts : RLS inactive';
  END IF;
  IF has_table_privilege('anon', 'public.connection_attempts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.connection_attempts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.connection_attempts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.connection_attempts', 'DELETE') THEN
    RAISE EXCEPTION 'connection_attempts : droits trop larges';
  END IF;
  IF has_function_privilege('anon', 'public.purge_connection_attempts()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_connection_attempts()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.purge_connection_attempts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'purge_connection_attempts : droits d''execution inattendus';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'connection_attempts';
  IF n <> 1 THEN
    RAISE EXCEPTION 'connection_attempts : % policies au lieu d''une', n;
  END IF;
END
$check$;
