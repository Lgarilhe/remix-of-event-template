-- Bascule des identifiants de compte : garde de l'ordre des annulations et lot vide.
--
-- Suite de 20261012051307_provider_account_id_remap.sql (non modifiee : elle est traitee comme appliquee).
-- Deux defauts relevés par la repetition de la bascule sur une copie locale :
--
-- R1. Annuler un lot ANCIEN alors qu'un lot plus RECENT n'est pas annule laissait un tableau
--     outreach_sequences.sender_accounts a moitie converti (le lot recent avait reecrit le meme tableau, la
--     restauration de l'ancien lot ne retrouvait plus la valeur ecrite par lui et comptait la ligne « moved »),
--     et l'ancien lot, marque restaure, ne pouvait plus etre repris. La restauration refuse maintenant
--     (REMAP_BATCH_NEWER_OPEN) tant qu'un lot plus recent, non annule, a reecrit des lignes : on annule
--     d'abord le plus recent. L'ordre des lots est celui de leur premiere paire (account_id_remap.id, croissant) :
--     un ordre total, donc le lot le plus recent peut toujours etre annule.
-- R2. Deux conversions simultanees avec la meme empreinte : la seconde, une fois le verrou obtenu, ne trouvait
--     plus rien a convertir mais inscrivait quand meme sa paire dans account_id_remap (un lot vide, liste en
--     tete des conversions precedentes ; l'annuler repondait « restaure 0 » et marquait le lot annule sans rien
--     changer). La paire n'est plus inscrite tant qu'aucune ligne ne la justifie : sans ligne a reecrire ni a
--     rapporter, la fonction rend { recorded: false, noop: true } et n'ecrit rien. Annuler un lot sans ligne
--     sauvegardee est refuse (REMAP_BATCH_EMPTY).
--
-- Nouveautes :
--   - remap_newer_open_batch(p_batch) : lot plus recent non annule qui a reecrit des lignes, ou NULL. Une seule
--     regle, lue par la restauration et par la liste des lots.
--   - remap_batches(p_limit) : lots recents pour la page d'administration (comptes, lignes reecrites, annule ou
--     non, lot plus recent encore ouvert). Lecture seule.
--
-- Rejouable, sur base neuve comme en production (CLAUDE.md, regles de migration) : CREATE OR REPLACE seulement,
-- aucune table ni donnee touchee. Fonctions SECURITY DEFINER : EXECUTE retire a PUBLIC, anon et authenticated,
-- accorde a service_role. Le reste du corps de remap_provider_account_id et de rollback_provider_account_id_remap
-- est celui de la migration d'origine.

-- --- 1. Lot plus recent encore ouvert -------------------------------------------------
-- Les lots sont ranges par leur premiere paire. Un lot « ouvert » a au moins une paire non restauree et a
-- sauvegarde au moins une ligne : un lot sans ligne ne peut rien avoir ecrase.

CREATE OR REPLACE FUNCTION public.remap_newer_open_batch(p_batch uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH lots AS (
    SELECT m.batch_id, min(m.id) AS first_id, bool_and(m.rolled_back_at IS NOT NULL) AS rolled_back
    FROM public.account_id_remap m
    GROUP BY m.batch_id
  )
  SELECT n.batch_id
  FROM lots n
  JOIN lots t ON t.batch_id = p_batch
  WHERE n.batch_id <> p_batch
    AND NOT n.rolled_back
    AND n.first_id > t.first_id
    AND EXISTS (SELECT 1 FROM public.account_id_remap_backup b WHERE b.batch_id = n.batch_id)
  ORDER BY n.first_id DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.remap_newer_open_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remap_newer_open_batch(uuid) TO service_role;

-- --- 2. Liste des lots recents ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remap_batches(p_limit integer DEFAULT 10)
RETURNS TABLE (
  batch_id     uuid,
  pairs        bigint,
  rows_written bigint,
  applied_at   timestamptz,
  rolled_back  boolean,
  newer_open   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- newer_open : seulement pour un lot qu'on pourrait annuler (non annule, avec des lignes sauvegardees).
  SELECT x.batch_id,
         x.pairs,
         x.rows_written,
         x.applied_at,
         x.rolled_back,
         (NOT x.rolled_back AND x.rows_written > 0 AND public.remap_newer_open_batch(x.batch_id) IS NOT NULL) AS newer_open
  FROM (
    SELECT l.batch_id, l.first_id, l.pairs, l.applied_at, l.rolled_back,
           (SELECT count(*) FROM public.account_id_remap_backup b WHERE b.batch_id = l.batch_id) AS rows_written
    FROM (
      SELECT m.batch_id, min(m.id) AS first_id, count(*) AS pairs, min(m.applied_at) AS applied_at,
             bool_and(m.rolled_back_at IS NOT NULL) AS rolled_back
      FROM public.account_id_remap m
      GROUP BY m.batch_id
    ) l
  ) x
  ORDER BY x.first_id DESC
  LIMIT least(greatest(coalesce(p_limit, 10), 1), 100)
$$;

REVOKE ALL ON FUNCTION public.remap_batches(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remap_batches(integer) TO service_role;

-- --- 3. Bascule d'une paire : aucune paire inscrite sans ligne -----------------------------

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
  v_skipped bigint := 0;
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
  -- La paire n'est inscrite qu'a la premiere colonne qui a des lignes a reecrire (voir plus bas) : une
  -- conversion qui n'a plus rien a faire (deux demandes simultanees, rejeu) ne laisse aucun lot vide.
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
      v_skipped := v_skipped + v_count;
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

    IF v_pair_id IS NULL THEN
      INSERT INTO public.account_id_remap (batch_id, old_id, new_id, kind, applied_by)
      VALUES (p_batch, p_old, p_new, v_kind, p_applied_by)
      ON CONFLICT (batch_id, old_id) DO NOTHING;
      SELECT id INTO v_pair_id FROM public.account_id_remap WHERE batch_id = p_batch AND old_id = p_old;
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
    'batch_id', CASE WHEN v_pair_id IS NULL THEN NULL ELSE p_batch END,
    'old_id', p_old, 'new_id', p_new, 'kind', v_kind,
    'recorded', v_pair_id IS NOT NULL,
    'noop', v_total = 0 AND v_skipped = 0,
    'total_rows', v_total, 'columns', v_report);
END;
$$;

REVOKE ALL ON FUNCTION public.remap_provider_account_id(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remap_provider_account_id(uuid, text, text, text, uuid) TO service_role;

-- --- 4. Restauration d'un lot : ordre des lots, lot vide -------------------------------------

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

  -- Un lot qui n'a reecrit aucune ligne n'a rien a restaurer : l'annuler ferait croire que la conversion est
  -- defaite alors que tout reste converti.
  SELECT count(*) INTO v_backups FROM public.account_id_remap_backup WHERE batch_id = p_batch;
  IF v_backups = 0 THEN
    RAISE EXCEPTION 'lot sans ligne reecrite' USING ERRCODE = '22023', HINT = 'REMAP_BATCH_EMPTY';
  END IF;

  -- On annule d'abord le lot le plus recent : un lot plus recent a pu reecrire les memes lignes (un meme tableau
  -- sender_accounts), et restaurer l'ancien d'abord laisserait ce tableau a moitie converti.
  IF public.remap_newer_open_batch(p_batch) IS NOT NULL THEN
    RAISE EXCEPTION 'un lot plus recent n''est pas annule' USING ERRCODE = '22023', HINT = 'REMAP_BATCH_NEWER_OPEN';
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

COMMENT ON FUNCTION public.remap_newer_open_batch(uuid) IS
  'Lot plus recent, non annule, qui a reecrit des lignes (ordre : premiere paire), ou NULL. Lecture seule. service_role seulement.';
COMMENT ON FUNCTION public.remap_batches(integer) IS
  'Lots recents de la bascule des identifiants de compte : comptes, lignes reecrites, annule ou non, lot plus recent encore ouvert. Lecture seule. service_role seulement.';
