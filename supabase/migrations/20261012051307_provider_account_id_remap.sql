-- Bascule des identifiants de compte du service de connexion (API v1 vers API v2).
--
-- A la bascule, la base contient des identifiants de compte de l'ancienne API et doit
-- contenir ceux de la nouvelle (acc_...). Cette migration pose les outils d'une
-- bascule en une seule fenetre de maintenance, sans fenetre a deux identifiants et
-- sans toucher aux policies RLS, aux declencheurs ni aux fonctions existantes.
--
-- 1. account_id_remap : une ligne par paire (lot, ancien id, nouvel id).
--    account_id_remap_backup : une ligne par valeur reecrite (table, cle de la ligne,
--    colonne, ancienne et nouvelle valeur). Les deux tables sont fermees : RLS active,
--    aucune policy, aucun droit pour PUBLIC, anon ni authenticated.
-- 2. provider_account_id_columns() : registre unique des colonnes visees. Les trois
--    fonctions ci-dessous, l'audit SQL et la requete de controle du proprietaire
--    (supabase/tests/provider_id_columns_check.sql) lisent la meme liste.
-- 3. provider_account_id_usage(p_old) : nombre de lignes qui portent un identifiant, par
--    table et colonne. Lecture seule.
-- 4. remap_provider_account_id(p_batch, p_old, p_new, ...) : sauvegarde puis reecrit toutes
--    les colonnes du registre, dans UNE transaction (celle de l'appel). Toute erreur annule
--    la paire entiere, sauvegarde comprise.
-- 5. rollback_provider_account_id_remap(p_batch) : restaure un lot depuis la sauvegarde ; rend aussi les
--    lignes qui portent encore le nouvel identifiant apres la restauration (still_new : lignes creees
--    depuis la bascule, sans sauvegarde).
-- 6. provider_account_id_orphans(p_limit) : valeurs des colonnes du registre qui ne correspondent a aucun
--    compte relie (tables member_*) et ne sont pas au format acc_ : anciens identifiants que la bascule
--    ne peut pas apparier (compte reconnecte, supprime). Lecture seule.
--
-- Pas de fenetre a deux identifiants (ecart assume avec l'etape 7 du plan de bascule, qui la prevoyait) :
-- aucune fonction ni aucun declencheur existant ne reconnait un ancien identifiant apres la bascule. Le
-- deroulement de la bascule doit donc garder les moteurs planifies en pause jusqu'au deploiement du code
-- final et retirer les anciennes notifications avant de convertir ; la page d'administration le rappelle.
--
-- Ordre des ecritures (prouve sur PostgreSQL 16, voir supabase/tests/account_remap_audit.sql) :
-- les inscriptions de sequence AVANT les tables de liaison member_*_accounts. Le declencheur
-- sequence_enrollments_check_sender_owner_update refuse un changement de account_id quand une
-- liaison du meme compte appartient a un autre membre que created_by (inscription heritee).
-- Les liaisons portant encore l'ancien identifiant, aucune ligne ne correspond au nouveau et la
-- garde laisse passer ; dans l'ordre inverse elle refuse (ENROLL_ACCOUNT_OF_OTHER_MEMBER). Le
-- declencheur member_linkedin_accounts_no_cross_tenant ne depend pas de l'ordre. La restauration
-- suit le meme ordre pour la meme raison.
--
-- Hors registre, a dessein : webhook_event_log et search_failure_log (journaux, l'identifiant n'y
-- sert qu'au diagnostic), notifications.metadata (aucun lecteur), agent_tool_executions (une
-- proposition en attente est relue a l'execution), connection_attempts (ecrite apres la bascule,
-- deja au format acc_), sequence_steps.sender_id si la colonne est de type uuid. Leur effectif est
-- rendu en lecture seule par provider_account_id_usage (etat report_only).
--
-- Rejouable, sur base neuve comme en production (CLAUDE.md, regles de migration) : chaque table et
-- chaque colonne est gardee par le catalogue (une table absente est sautee et rapportee). Fonctions
-- SECURITY DEFINER : EXECUTE retire a PUBLIC, anon et authenticated, accorde a service_role.

-- --- 1. Tables ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_id_remap (
  -- Ordre d'application : la restauration defait les paires de la derniere a la premiere
  -- (un meme tableau sender_accounts peut porter plusieurs paires).
  id             bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  batch_id       uuid        NOT NULL,
  old_id         text        NOT NULL,
  new_id         text        NOT NULL,
  kind           text        NOT NULL
    CONSTRAINT account_id_remap_kind_check CHECK (kind IN ('linkedin', 'email', 'whatsapp')),
  applied_by     uuid,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  CONSTRAINT account_id_remap_pkey PRIMARY KEY (batch_id, old_id)
);

CREATE TABLE IF NOT EXISTS public.account_id_remap_backup (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id    uuid  NOT NULL,
  -- account_id_remap.id de la paire qui a ecrit cette valeur.
  pair_id     bigint NOT NULL,
  table_name  text  NOT NULL,
  -- Cle primaire de la ligne, en jsonb ({"id": "..."}).
  row_key     jsonb NOT NULL,
  column_name text  NOT NULL,
  old_value   jsonb,
  new_value   jsonb
);

CREATE INDEX IF NOT EXISTS account_id_remap_backup_batch_idx
  ON public.account_id_remap_backup (batch_id, table_name, column_name);

ALTER TABLE public.account_id_remap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_id_remap_backup ENABLE ROW LEVEL SECURITY;

-- Aucune policy : seule la cle de service (qui ignore la RLS) lit et ecrit.
REVOKE ALL ON public.account_id_remap FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.account_id_remap_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_id_remap TO service_role;
GRANT ALL ON public.account_id_remap_backup TO service_role;

COMMENT ON TABLE public.account_id_remap IS
  'Paires ancien/nouvel identifiant de compte appliquees par lot. Fermee : service_role seulement.';
COMMENT ON TABLE public.account_id_remap_backup IS
  'Valeurs reecrites par la bascule des identifiants de compte, pour la restauration. Fermee : service_role seulement.';

-- --- 2. Registre des colonnes ---------------------------------------------------
-- mode remap : reecrite par la bascule, dans l'ordre de ord.
-- mode report_only : comptee par provider_account_id_usage, jamais reecrite.
-- kind text : colonne texte egale a l'identifiant ; jsonb_sender_accounts : tableau
--   [{ "account_id": ... }] ; contains_text : le texte de la colonne contient l'identifiant.
-- row_filter : condition SQL ajoutee (alias t), sans parametre utilisateur.

CREATE OR REPLACE FUNCTION public.provider_account_id_columns()
RETURNS TABLE (
  ord         integer,
  table_name  text,
  column_name text,
  kind        text,
  mode        text,
  row_filter  text,
  note        text
)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    -- Inscriptions d'abord (voir l'en-tete : declencheur sender_owner_update).
    (10, 'sequence_enrollments',       'account_id',          'text',                  'remap', NULL::text, 'compte d''envoi de l''inscription'),
    (11, 'sequence_enrollments',       'assigned_sender_id',  'text',                  'remap', NULL,       'expediteur tire par la rotation (texte)'),
    (12, 'sequence_steps',             'sender_id',           'text',                  'remap', NULL,       'seulement si la colonne est de type texte'),
    (13, 'outreach_sequences',         'sender_accounts',     'jsonb_sender_accounts', 'remap', NULL,       'tableau [{account_id, ...}]'),
    (20, 'inmail_queue',               'account_id',          'text',                  'remap', NULL,       NULL),
    (21, 'linkedin_action_log',        'account_id',          'text',                  'remap', NULL,       'registre des plafonds : l''historique doit suivre'),
    (22, 'mission_conversations',      'account_id',          'text',                  'remap', NULL,       NULL),
    (23, 'candidate_action_messages',  'account_id',          'text',                  'remap', NULL,       NULL),
    (24, 'profile_enrichment_queue',   'account_id',          'text',                  'remap', NULL,       NULL),
    (25, 'nurturing_opportunities',    'linkedin_account_id', 'text',                  'remap', NULL,       NULL),
    (26, 'sourcing_agents',            'account_id',          'text',                  'remap', NULL,       'le contexte de l''agent change : recalibrer'),
    (27, 'chat_categories',            'account_id',          'text',                  'remap', NULL,       NULL),
    (28, 'message_analysis_cache',     'account_id',          'text',                  'remap', NULL,       NULL),
    (29, 'internal_config',            'value',               'text',                  'remap', 't.key = ''pedigree_resolver_account_id''', 'compte de resolution de l''annuaire'),
    -- Liaisons en dernier (voir l'en-tete).
    (40, 'member_calendar_accounts',   'account_id',          'text',                  'remap', NULL,       NULL),
    (41, 'member_whatsapp_accounts',   'whatsapp_account_id', 'text',                  'remap', NULL,       NULL),
    (42, 'member_email_accounts',      'email_account_id',    'text',                  'remap', NULL,       NULL),
    (43, 'member_linkedin_accounts',   'linkedin_account_id', 'text',                  'remap', NULL,       NULL),
    -- Comptes seulement.
    (90, 'webhook_event_log',          'account_id',          'text',                  'report_only', NULL, 'journal'),
    (91, 'search_failure_log',         'account_id',          'text',                  'report_only', NULL, 'journal'),
    (92, 'agent_tool_executions',      'params',              'contains_text',         'report_only', 't.status = ''proposed''', 'proposition en attente'),
    (93, 'agent_tool_executions',      'dry_run_result',      'contains_text',         'report_only', 't.status = ''proposed''', 'proposition en attente')
  ) AS v(ord, table_name, column_name, kind, mode, row_filter, note)
$$;

REVOKE ALL ON FUNCTION public.provider_account_id_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_account_id_columns() TO service_role;

-- Etat d'une colonne du registre : ok, missing_table, missing_column, unsupported_type,
-- no_primary_key. pk_columns : colonnes de la cle primaire (ordre de la cle).
CREATE OR REPLACE FUNCTION public.provider_account_id_column_state(p_table text, p_column text, p_kind text)
RETURNS TABLE (status text, pk_columns text[])
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rel regclass;
  v_type text;
  v_pk text[];
BEGIN
  v_rel := to_regclass(format('public.%I', p_table));
  IF v_rel IS NULL THEN
    RETURN QUERY SELECT 'missing_table'::text, NULL::text[];
    RETURN;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
  FROM pg_attribute a
  WHERE a.attrelid = v_rel AND a.attname = p_column AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_type IS NULL THEN
    RETURN QUERY SELECT 'missing_column'::text, NULL::text[];
    RETURN;
  END IF;

  IF p_kind = 'text' AND v_type NOT IN ('text', 'character varying') AND v_type NOT LIKE 'character varying(%' THEN
    RETURN QUERY SELECT 'unsupported_type'::text, NULL::text[];
    RETURN;
  END IF;
  IF p_kind = 'jsonb_sender_accounts' AND v_type <> 'jsonb' THEN
    RETURN QUERY SELECT 'unsupported_type'::text, NULL::text[];
    RETURN;
  END IF;
  IF p_kind = 'contains_text' AND v_type NOT IN ('jsonb', 'json', 'text') THEN
    RETURN QUERY SELECT 'unsupported_type'::text, NULL::text[];
    RETURN;
  END IF;

  SELECT array_agg(att.attname::text ORDER BY k.ord) INTO v_pk
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = k.attnum
  WHERE i.indrelid = v_rel AND i.indisprimary;

  RETURN QUERY SELECT 'ok'::text, v_pk;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_account_id_column_state(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_account_id_column_state(text, text, text) TO service_role;

-- Condition SQL (alias t) qui retient les lignes portant l'identifiant. Valeurs en littéraux
-- echappes par format(%L) : jamais de concatenation brute.
-- p_loose : colonne d'un type inattendu (etat unsupported_type), comptee par son texte pour ne pas la
-- passer sous silence ; jamais utilisee pour ecrire.
CREATE OR REPLACE FUNCTION public.provider_account_id_row_match(p_kind text, p_column text, p_row_filter text, p_old text, p_loose boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cond text;
BEGIN
  IF p_loose THEN
    v_cond := format('strpos(t.%I::text, %L) > 0', p_column, p_old);
  ELSIF p_kind = 'text' THEN
    v_cond := format('t.%I = %L', p_column, p_old);
  ELSIF p_kind = 'jsonb_sender_accounts' THEN
    v_cond := format('t.%I @> %L::jsonb', p_column, jsonb_build_array(jsonb_build_object('account_id', p_old))::text);
  ELSIF p_kind = 'contains_text' THEN
    v_cond := format('strpos(t.%I::text, %L) > 0', p_column, p_old);
  ELSE
    RAISE EXCEPTION 'unknown registry kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_row_filter IS NOT NULL THEN
    v_cond := format('(%s) AND (%s)', v_cond, p_row_filter);
  END IF;
  RETURN v_cond;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_account_id_row_match(text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_account_id_row_match(text, text, text, text, boolean) TO service_role;

-- --- 3. Usage (lecture seule) -------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_account_id_usage(p_old text)
RETURNS TABLE (table_name text, column_name text, rows_holding bigint, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  s record;
  v_n bigint;
BEGIN
  IF p_old IS NULL OR btrim(p_old) = '' THEN
    RAISE EXCEPTION 'identifiant vide' USING ERRCODE = '22023', HINT = 'REMAP_INVALID_OLD';
  END IF;

  FOR r IN SELECT * FROM public.provider_account_id_columns() c ORDER BY c.ord LOOP
    SELECT st.status, st.pk_columns INTO s FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st;
    IF s.status <> 'ok' THEN
      -- Type inattendu : les lignes sont comptees par leur texte (elles ne seront pas reecrites), pour que
      -- l'ecran ne les passe pas sous silence. Table ou colonne absente : rien a compter.
      v_n := 0;
      IF s.status = 'unsupported_type' THEN
        EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', r.table_name,
                       public.provider_account_id_row_match(r.kind, r.column_name, r.row_filter, p_old, true))
          INTO v_n;
      END IF;
      table_name := r.table_name; column_name := r.column_name; rows_holding := v_n; status := s.status;
      RETURN NEXT;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', r.table_name,
                   public.provider_account_id_row_match(r.kind, r.column_name, r.row_filter, p_old, false))
      INTO v_n;
    table_name := r.table_name; column_name := r.column_name; rows_holding := v_n;
    -- Une colonne sans cle primaire ne peut pas etre sauvegardee : elle n'est pas reecrite.
    status := CASE
      WHEN r.mode = 'report_only' THEN 'report_only'
      WHEN s.pk_columns IS NULL THEN 'no_primary_key'
      ELSE 'remap'
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_account_id_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_account_id_usage(text) TO service_role;

-- --- 4. Bascule d'une paire ----------------------------------------------------
-- Une paire par appel, une transaction par appel. Le lot (p_batch) regroupe les paires d'une
-- meme bascule pour la restauration. p_kind : linkedin, email ou whatsapp ; absent, il est
-- deduit des tables de liaison. p_applied_by : utilisateur qui lance la bascule (trace).

CREATE OR REPLACE FUNCTION public.remap_provider_account_id(
  p_batch      uuid,
  p_old        text,
  p_new        text,
  p_kind       text DEFAULT NULL,
  p_applied_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  s record;
  v_kind text;
  v_count bigint;
  v_backup bigint;
  v_updated bigint;
  v_total bigint := 0;
  v_report jsonb := '[]'::jsonb;
  v_match text;
  v_keyexpr text;
  v_newexpr text;
  v_known_new text;
  v_pair_id bigint;
BEGIN
  IF p_batch IS NULL THEN
    RAISE EXCEPTION 'lot manquant' USING ERRCODE = '22023', HINT = 'REMAP_INVALID_BATCH';
  END IF;
  IF p_old IS NULL OR btrim(p_old) = '' OR length(p_old) > 200 OR p_old ~ '^acc_[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'ancien identifiant invalide' USING ERRCODE = '22023', HINT = 'REMAP_INVALID_OLD';
  END IF;
  IF p_new IS NULL OR p_new !~ '^acc_[A-Za-z0-9_-]+$' OR length(p_new) > 200 THEN
    RAISE EXCEPTION 'nouvel identifiant invalide' USING ERRCODE = '22023', HINT = 'REMAP_INVALID_NEW';
  END IF;
  IF p_kind IS NOT NULL AND p_kind NOT IN ('linkedin', 'email', 'whatsapp') THEN
    RAISE EXCEPTION 'type de compte inconnu' USING ERRCODE = '22023', HINT = 'REMAP_INVALID_KIND';
  END IF;

  -- Une bascule a la fois.
  PERFORM pg_advisory_xact_lock(hashtextextended('provider_account_id_remap', 0));

  v_kind := p_kind;
  IF v_kind IS NULL THEN
    IF to_regclass('public.member_linkedin_accounts') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.member_linkedin_accounts WHERE linkedin_account_id = p_old) THEN
      v_kind := 'linkedin';
    ELSIF to_regclass('public.member_whatsapp_accounts') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.member_whatsapp_accounts WHERE whatsapp_account_id = p_old) THEN
      v_kind := 'whatsapp';
    ELSIF to_regclass('public.member_email_accounts') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.member_email_accounts WHERE email_account_id = p_old) THEN
      v_kind := 'email';
    ELSE
      RAISE EXCEPTION 'type de compte indeterminable' USING ERRCODE = '22023', HINT = 'REMAP_KIND_UNKNOWN';
    END IF;
  END IF;

  SELECT new_id INTO v_known_new FROM public.account_id_remap WHERE batch_id = p_batch AND old_id = p_old;
  IF v_known_new IS NOT NULL AND v_known_new <> p_new THEN
    RAISE EXCEPTION 'cet ancien identifiant a deja une autre cible dans ce lot' USING ERRCODE = '22023', HINT = 'REMAP_BATCH_CONFLICT';
  END IF;
  INSERT INTO public.account_id_remap (batch_id, old_id, new_id, kind, applied_by)
  VALUES (p_batch, p_old, p_new, v_kind, p_applied_by)
  ON CONFLICT (batch_id, old_id) DO NOTHING;
  SELECT id INTO v_pair_id FROM public.account_id_remap WHERE batch_id = p_batch AND old_id = p_old;

  FOR r IN SELECT * FROM public.provider_account_id_columns() c WHERE c.mode = 'remap' ORDER BY c.ord LOOP
    SELECT st.status, st.pk_columns INTO s FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st;
    IF s.status <> 'ok' OR s.pk_columns IS NULL THEN
      -- Table ou colonne absente, type inattendu, ou pas de cle primaire (rien a sauvegarder avec
      -- fiabilite) : sautee et rapportee, avec le nombre de lignes concernees quand on peut les compter.
      v_count := 0;
      IF s.status IN ('ok', 'unsupported_type') THEN
        EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', r.table_name,
                       public.provider_account_id_row_match(r.kind, r.column_name, r.row_filter, p_old, s.status = 'unsupported_type'))
          INTO v_count;
      END IF;
      v_report := v_report || jsonb_build_array(jsonb_build_object(
        'table', r.table_name, 'column', r.column_name, 'rows', 0, 'skipped_rows', v_count,
        'status', CASE WHEN s.status = 'ok' THEN 'no_primary_key' ELSE s.status END));
      CONTINUE;
    END IF;

    v_match := public.provider_account_id_row_match(r.kind, r.column_name, r.row_filter, p_old, false);
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', r.table_name, v_match) INTO v_count;
    IF v_count = 0 THEN
      v_report := v_report || jsonb_build_array(jsonb_build_object(
        'table', r.table_name, 'column', r.column_name, 'rows', 0, 'status', 'none'));
      CONTINUE;
    END IF;

    SELECT string_agg(format('%L, t.%I', k, k), ', ') INTO v_keyexpr FROM unnest(s.pk_columns) AS k;

    IF r.kind = 'text' THEN
      v_newexpr := format('%L::text', p_new);
    ELSE
      -- jsonb_sender_accounts : le meme tableau, l'element visé réécrit, l'ordre gardé.
      v_newexpr := format(
        '(SELECT jsonb_agg(CASE WHEN e.value ->> %L = %L THEN jsonb_set(e.value, %L::text[], to_jsonb(%L::text)) ELSE e.value END ORDER BY e.ord) '
        || 'FROM jsonb_array_elements(t.%I) WITH ORDINALITY AS e(value, ord))',
        'account_id', p_old, '{account_id}', p_new, r.column_name);
    END IF;

    -- Verrou des lignes, puis sauvegarde, puis ecriture : meme jeu de lignes, sinon on annule.
    EXECUTE format('SELECT 1 FROM public.%I t WHERE %s FOR UPDATE', r.table_name, v_match);

    EXECUTE format(
      'INSERT INTO public.account_id_remap_backup (batch_id, pair_id, table_name, row_key, column_name, old_value, new_value) '
      || 'SELECT %L::uuid, %s, %L, jsonb_build_object(%s), %L, to_jsonb(t.%I), to_jsonb(%s) FROM public.%I t WHERE %s',
      p_batch, v_pair_id, r.table_name, v_keyexpr, r.column_name, r.column_name, v_newexpr, r.table_name, v_match);
    GET DIAGNOSTICS v_backup = ROW_COUNT;

    BEGIN
      EXECUTE format('UPDATE public.%I t SET %I = %s WHERE %s', r.table_name, r.column_name, v_newexpr, v_match);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'conflit d''unicite sur %.%', r.table_name, r.column_name
        USING ERRCODE = '23505', HINT = 'REMAP_CONFLICT';
    END;

    IF v_updated <> v_backup THEN
      RAISE EXCEPTION 'les lignes ont change pendant la bascule de %.%', r.table_name, r.column_name
        USING ERRCODE = '40001', HINT = 'REMAP_CONCURRENT_CHANGE';
    END IF;

    v_total := v_total + v_updated;
    v_report := v_report || jsonb_build_array(jsonb_build_object(
      'table', r.table_name, 'column', r.column_name, 'rows', v_updated, 'status', 'remapped'));
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', p_batch, 'old_id', p_old, 'new_id', p_new, 'kind', v_kind,
    'total_rows', v_total, 'columns', v_report);
END;
$$;

REVOKE ALL ON FUNCTION public.remap_provider_account_id(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remap_provider_account_id(uuid, text, text, text, uuid) TO service_role;

-- --- 5. Restauration d'un lot ---------------------------------------------------
-- Remet l'ancienne valeur de chaque ligne sauvegardee, seulement si la ligne porte encore la valeur
-- ecrite par la bascule (une ligne modifiee depuis n'est pas ecrasee : elle est comptee dans moved).
-- Meme ordre de tables que l'ecriture, meme raison (voir l'en-tete) ; paires de la derniere a la premiere.
-- Un lot ne se restaure qu'une fois.

CREATE OR REPLACE FUNCTION public.rollback_provider_account_id_remap(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  q record;
  s record;
  v_pairs bigint;
  v_open bigint;
  v_backups bigint;
  v_restored bigint;
  v_total_restored bigint := 0;
  v_total_moved bigint := 0;
  v_report jsonb := '[]'::jsonb;
  v_pkmatch text;
  v_set text;
  v_cond text;
  v_new bigint;
  v_still jsonb := '[]'::jsonb;
  v_still_total bigint := 0;
BEGIN
  IF p_batch IS NULL THEN
    RAISE EXCEPTION 'lot manquant' USING ERRCODE = '22023', HINT = 'REMAP_INVALID_BATCH';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('provider_account_id_remap', 0));

  SELECT count(*), count(*) FILTER (WHERE rolled_back_at IS NULL)
    INTO v_pairs, v_open
  FROM public.account_id_remap WHERE batch_id = p_batch;
  IF v_pairs = 0 THEN
    RAISE EXCEPTION 'lot inconnu' USING ERRCODE = 'P0002', HINT = 'REMAP_BATCH_UNKNOWN';
  END IF;
  IF v_open = 0 THEN
    RAISE EXCEPTION 'lot deja restaure' USING ERRCODE = '22023', HINT = 'REMAP_BATCH_ALREADY_ROLLED_BACK';
  END IF;

  -- Les paires se defont de la derniere a la premiere : un meme tableau sender_accounts peut avoir
  -- ete reecrit par plusieurs paires, et chaque sauvegarde part de l'etat laisse par la precedente.
  FOR q IN SELECT m.id, m.old_id FROM public.account_id_remap m
           WHERE m.batch_id = p_batch AND m.rolled_back_at IS NULL ORDER BY m.id DESC LOOP
    FOR r IN SELECT * FROM public.provider_account_id_columns() c WHERE c.mode = 'remap' ORDER BY c.ord LOOP
      SELECT count(*) INTO v_backups
      FROM public.account_id_remap_backup b
      WHERE b.batch_id = p_batch AND b.pair_id = q.id AND b.table_name = r.table_name AND b.column_name = r.column_name;
      IF v_backups = 0 THEN
        CONTINUE;
      END IF;

      SELECT st.status, st.pk_columns INTO s FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st;
      IF s.status <> 'ok' OR s.pk_columns IS NULL THEN
        v_total_moved := v_total_moved + v_backups;
        v_report := v_report || jsonb_build_array(jsonb_build_object(
          'old_id', q.old_id, 'table', r.table_name, 'column', r.column_name, 'restored', 0, 'moved', v_backups,
          'status', CASE WHEN s.status = 'ok' THEN 'no_primary_key' ELSE s.status END));
        CONTINUE;
      END IF;

      -- Meme ligne : chaque colonne de la cle primaire, lue dans row_key avec le type de la colonne.
      SELECT string_agg(
               format('t.%1$I = (b.row_key ->> %1$L)::%2$s', a.attname, format_type(a.atttypid, a.atttypmod)),
               ' AND ' ORDER BY k.ord)
        INTO v_pkmatch
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = to_regclass(format('public.%I', r.table_name)) AND i.indisprimary;

      IF r.kind = 'text' THEN
        v_set := format('%I = (b.old_value #>> ''{}'')', r.column_name);
        v_cond := format('t.%I = (b.new_value #>> ''{}'')', r.column_name);
      ELSE
        v_set := format('%I = b.old_value', r.column_name);
        v_cond := format('t.%I = b.new_value', r.column_name);
      END IF;

      EXECUTE format(
        'UPDATE public.%I t SET %s FROM public.account_id_remap_backup b '
        || 'WHERE b.batch_id = %L::uuid AND b.pair_id = %s AND b.table_name = %L AND b.column_name = %L AND %s AND %s',
        r.table_name, v_set, p_batch, q.id, r.table_name, r.column_name, v_pkmatch, v_cond);
      GET DIAGNOSTICS v_restored = ROW_COUNT;

      v_total_restored := v_total_restored + v_restored;
      v_total_moved := v_total_moved + (v_backups - v_restored);
      v_report := v_report || jsonb_build_array(jsonb_build_object(
        'old_id', q.old_id, 'table', r.table_name, 'column', r.column_name, 'restored', v_restored,
        'moved', v_backups - v_restored, 'status', 'restored'));
    END LOOP;
  END LOOP;

  -- Lignes qui portent encore le nouvel identifiant une fois le lot restaure : creees depuis la bascule
  -- (sans sauvegarde), elles restent au nouveau format alors que les liaisons sont revenues a l'ancien.
  -- Compte apres toutes les paires : deux paires peuvent viser le meme nouvel identifiant (messagerie et agenda).
  FOR q IN SELECT DISTINCT m.new_id FROM public.account_id_remap m
           WHERE m.batch_id = p_batch AND m.rolled_back_at IS NULL LOOP
    FOR r IN SELECT * FROM public.provider_account_id_columns() c WHERE c.mode = 'remap' ORDER BY c.ord LOOP
      SELECT st.status, st.pk_columns INTO s FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st;
      IF s.status <> 'ok' THEN
        CONTINUE;
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', r.table_name,
                     public.provider_account_id_row_match(r.kind, r.column_name, r.row_filter, q.new_id, false))
        INTO v_new;
      IF v_new > 0 THEN
        v_still_total := v_still_total + v_new;
        v_still := v_still || jsonb_build_array(jsonb_build_object('table', r.table_name, 'column', r.column_name, 'rows', v_new));
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.account_id_remap SET rolled_back_at = now()
  WHERE batch_id = p_batch AND rolled_back_at IS NULL;

  RETURN jsonb_build_object(
    'batch_id', p_batch, 'pairs', v_pairs, 'restored_rows', v_total_restored,
    'moved_rows', v_total_moved, 'columns', v_report,
    'still_new_rows', v_still_total, 'still_new', v_still);
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_provider_account_id_remap(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_provider_account_id_remap(uuid) TO service_role;

-- --- 6. Identifiants sans compte relie (lecture seule) ------------------------------
-- Valeurs des colonnes du registre (hors tables member_*) qui ne sont ni l'identifiant d'un compte relie, ni
-- au format acc_, ni un uuid (assigned_sender_id herite : identifiant d'utilisateur, ignore par le moteur).
-- Cas typique : un membre a reconnecte son compte, l'ancien identifiant n'est plus dans sa liaison mais reste
-- dans ses inscriptions, son registre d'actions ou sa file d'InMails. Aucun appariement n'est possible : c'est
-- au proprietaire de decider avant la bascule. p_limit : valeurs rendues par colonne (500 au plus).

CREATE OR REPLACE FUNCTION public.provider_account_id_orphans(p_limit integer DEFAULT 50)
RETURNS TABLE (table_name text, column_name text, value text, rows_holding bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_members text;
  v_sql text;
  v_filter text;
  v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 500);
BEGIN
  SELECT string_agg(format('SELECT t.%I::text AS v FROM public.%I t WHERE t.%I IS NOT NULL', c.column_name, c.table_name, c.column_name), ' UNION ')
    INTO v_members
  FROM public.provider_account_id_columns() c
  WHERE c.mode = 'remap' AND c.table_name LIKE 'member\_%'
    AND (SELECT st.status FROM public.provider_account_id_column_state(c.table_name, c.column_name, c.kind) st) = 'ok';
  IF v_members IS NULL THEN
    v_members := 'SELECT NULL::text AS v WHERE false';
  END IF;

  FOR r IN SELECT * FROM public.provider_account_id_columns() c
           WHERE c.mode = 'remap' AND c.table_name NOT LIKE 'member\_%' AND c.kind IN ('text', 'jsonb_sender_accounts')
           ORDER BY c.ord LOOP
    IF (SELECT st.status FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st) <> 'ok' THEN
      CONTINUE;
    END IF;
    v_filter := CASE WHEN r.row_filter IS NULL THEN '' ELSE format(' AND (%s)', r.row_filter) END;
    IF r.kind = 'text' THEN
      v_sql := format(
        'SELECT %L::text, %L::text, t.%I::text, count(*)::bigint FROM public.%I t '
        || 'WHERE t.%I IS NOT NULL AND btrim(t.%I::text) <> '''' AND t.%I::text !~ ''^acc_'' '
        || 'AND t.%I::text !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' '
        || 'AND NOT EXISTS (SELECT 1 FROM (%s) m WHERE m.v = t.%I::text)%s '
        || 'GROUP BY 3 ORDER BY 4 DESC, 3 LIMIT %s',
        r.table_name, r.column_name, r.column_name, r.table_name,
        r.column_name, r.column_name, r.column_name, r.column_name, v_members, r.column_name, v_filter, v_lim);
    ELSE
      v_sql := format(
        'SELECT %L::text, %L::text, e.value ->> ''account_id'', count(*)::bigint FROM public.%I t '
        || 'CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.%I) = ''array'' THEN t.%I ELSE ''[]''::jsonb END) AS e(value) '
        || 'WHERE jsonb_typeof(e.value) = ''object'' AND btrim(coalesce(e.value ->> ''account_id'', '''')) <> '''' '
        || 'AND e.value ->> ''account_id'' !~ ''^acc_'' '
        || 'AND NOT EXISTS (SELECT 1 FROM (%s) m WHERE m.v = e.value ->> ''account_id'')%s '
        || 'GROUP BY 3 ORDER BY 4 DESC, 3 LIMIT %s',
        r.table_name, r.column_name, r.table_name, r.column_name, r.column_name, v_members, v_filter, v_lim);
    END IF;
    RETURN QUERY EXECUTE v_sql;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_account_id_orphans(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_account_id_orphans(integer) TO service_role;

COMMENT ON FUNCTION public.remap_provider_account_id(uuid, text, text, text, uuid) IS
  'Reecrit l''identifiant de compte p_old en p_new dans toutes les colonnes du registre, apres sauvegarde, dans la transaction de l''appel. service_role seulement.';
COMMENT ON FUNCTION public.rollback_provider_account_id_remap(uuid) IS
  'Restaure un lot de bascule des identifiants de compte depuis account_id_remap_backup. service_role seulement.';
COMMENT ON FUNCTION public.provider_account_id_orphans(integer) IS
  'Valeurs des colonnes du registre qui ne correspondent a aucun compte relie et ne sont pas au format acc_. Lecture seule. service_role seulement.';
COMMENT ON FUNCTION public.provider_account_id_usage(text) IS
  'Nombre de lignes qui portent un identifiant de compte, par table et colonne. Lecture seule. service_role seulement.';
