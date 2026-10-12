-- =====================================================================
-- Bascule des identifiants de compte du service de connexion (API v1 vers v2).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite depuis les migrations (jamais en prod) :
--   BEGIN; \i supabase/tests/account_remap_audit.sql; ROLLBACK;
-- Vérifie la migration *_provider_account_id_remap.sql :
--   1. tables account_id_remap et account_id_remap_backup : RLS active, aucune
--      policy, aucun droit pour PUBLIC, anon ni authenticated ;
--   2. fonctions : exécutables par service_role seulement, SECURITY DEFINER pour
--      les trois qui lisent ou écrivent les données ;
--   3. registre des colonnes : chaque colonne du registre existe (ou est
--      rapportée absente), et toute colonne *account_id* du schéma public est au
--      registre ou dans la liste justifiée de l'audit (une table nouvelle qui
--      porte un identifiant de compte fait échouer l'audit) ;
--   4. provider_account_id_usage : effectifs justes, aucune écriture ;
--   5. l'ordre des écritures : une inscription héritée (créée sur le compte d'un
--      collègue) se bascule, alors que l'ordre inverse est refusé par le
--      déclencheur sequence_enrollments_check_sender_owner_update ;
--   6. remap_provider_account_id : toutes les colonnes d'une paire, le tableau
--      sender_accounts, la ligne internal_config visée seulement, la sauvegarde
--      (une ligne par valeur), rien chez l'autre organisation, rejouable sans
--      effet, refus des entrées invalides ;
--   7. atomicité : un conflit d'unicité et une violation cross-tenant annulent
--      la paire entière, sauvegarde comprise ;
--   8. rollback_provider_account_id_remap : valeurs d'avant rétablies, ligne
--      modifiée depuis laissée telle quelle (comptée moved), ligne créée depuis
--      la bascule comptée still_new, un lot ne se restaure qu'une fois, lot
--      inconnu refusé ;
--   9. colonne d'un type inattendu (unsupported_type) : comptée par l'usage et
--      rapportée par la bascule (skipped_rows), jamais réécrite en silence ;
--  10. provider_account_id_orphans : identifiants sans compte relié listés,
--      identifiants de comptes reliés, acc_ et uuid absents.
-- Aucune fonction n'est appelée sous SET ROLE anon ou authenticated (CLAUDE.md) :
-- les droits se lisent avec has_function_privilege et has_table_privilege.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================

-- Empreinte des colonnes visées, pour les lignes du jeu de données seulement.
CREATE FUNCTION pg_temp.rm_digest() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := '';
BEGIN
  v := v || coalesce((SELECT string_agg(id::text || ':' || account_id || ':' || coalesce(assigned_sender_id, '-'), '|' ORDER BY id)
                       FROM public.sequence_enrollments WHERE organization_id IN ('ee111111-0000-4000-8000-000000000001', 'ee222222-0000-4000-8000-000000000001')), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || sender_accounts::text, '|' ORDER BY id)
                       FROM public.outreach_sequences WHERE organization_id IN ('ee111111-0000-4000-8000-000000000001', 'ee222222-0000-4000-8000-000000000001')), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || linkedin_account_id, '|' ORDER BY id)
                       FROM public.member_linkedin_accounts WHERE organization_id IN ('ee111111-0000-4000-8000-000000000001', 'ee222222-0000-4000-8000-000000000001')), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || email_account_id, '|' ORDER BY id)
                       FROM public.member_email_accounts WHERE organization_id = 'ee111111-0000-4000-8000-000000000001'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || whatsapp_account_id, '|' ORDER BY id)
                       FROM public.member_whatsapp_accounts WHERE organization_id = 'ee111111-0000-4000-8000-000000000001'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.member_calendar_accounts WHERE organization_id = 'ee111111-0000-4000-8000-000000000001'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.inmail_queue WHERE created_by IN ('ee000000-0000-4000-8000-00000000000a', 'ee000000-0000-4000-8000-00000000000b')), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.linkedin_action_log WHERE action_type = 'rm_audit'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.chat_categories WHERE chat_id LIKE 'rm-chat-%'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.message_analysis_cache WHERE chat_id LIKE 'rm-chat-%'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.mission_conversations WHERE organization_id = 'ee111111-0000-4000-8000-000000000001'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || account_id, '|' ORDER BY id)
                       FROM public.profile_enrichment_queue WHERE dedup_key LIKE 'rm-dedup-%'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || linkedin_account_id, '|' ORDER BY id)
                       FROM public.nurturing_opportunities WHERE candidate_id LIKE 'rm-cand-%'), '');
  v := v || '#' || coalesce((SELECT string_agg(id::text || ':' || coalesce(account_id, '-'), '|' ORDER BY id)
                       FROM public.sourcing_agents WHERE organization_id = 'ee111111-0000-4000-8000-000000000001'), '');
  v := v || '#' || coalesce((SELECT string_agg(key || ':' || value, '|' ORDER BY key)
                       FROM public.internal_config WHERE key IN ('pedigree_resolver_account_id', 'rm_audit_other_key')), '');
  v := v || '#' || coalesce((SELECT string_agg(event_key || ':' || coalesce(account_id, '-'), '|' ORDER BY event_key)
                       FROM public.webhook_event_log WHERE event_key LIKE 'rm-audit:%'), '');
  RETURN md5(v);
END $f$;

DO $$
DECLARE
  u_a uuid := 'ee000000-0000-4000-8000-00000000000a';
  u_m uuid := 'ee000000-0000-4000-8000-00000000000b';
  u_b uuid := 'ee000000-0000-4000-8000-00000000000c';
  o1  uuid := 'ee111111-0000-4000-8000-000000000001';
  o2  uuid := 'ee222222-0000-4000-8000-000000000001';
  seq1 uuid := 'ee111111-0000-4000-8000-0000000000a1';
  seq2 uuid := 'ee222222-0000-4000-8000-0000000000a1';
  proj uuid := 'ee111111-0000-4000-8000-0000000000b1';
  e_a uuid := 'ee111111-0000-4000-8000-0000000000c1';
  e_legacy uuid := 'ee111111-0000-4000-8000-0000000000c2';
  e_b uuid := 'ee222222-0000-4000-8000-0000000000c1';
  batch1 uuid := 'ee000000-0000-4000-8000-0000000000f1';
  batch2 uuid := 'ee000000-0000-4000-8000-0000000000f2';
  batch3 uuid := 'ee000000-0000-4000-8000-0000000000f3';
  batch_unknown uuid := 'ee000000-0000-4000-8000-0000000000f9';
  d0 text;
  d1 text;
  d2 text;
  res jsonb;
  n bigint;
  n2 bigint;
  v_text text;
  v_hint text;
  v_state text;
  v_bool boolean;
  pr text;
  fn text;
  rel text;
  r record;
  sender_before jsonb;
  failures text := '';
BEGIN
  -- ===== 1. Tables fermées ==========================================================
  FOREACH rel IN ARRAY ARRAY['account_id_remap', 'account_id_remap_backup'] LOOP
    SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = ('public.' || rel)::regclass;
    IF NOT coalesce(v_bool, false) THEN failures := failures || format('[1. %s sans RLS] ', rel); END IF;
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = rel;
    IF n <> 0 THEN failures := failures || format('[1. %s a %s policy] ', rel, n); END IF;
    FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('anon', 'public.' || rel, pr) THEN failures := failures || format('[1. anon a %s sur %s] ', pr, rel); END IF;
      IF has_table_privilege('authenticated', 'public.' || rel, pr) THEN failures := failures || format('[1. authenticated a %s sur %s] ', pr, rel); END IF;
    END LOOP;
    FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', 'public.' || rel, pr) THEN failures := failures || format('[1. service_role n''a pas %s sur %s] ', pr, rel); END IF;
    END LOOP;
  END LOOP;

  -- ===== 2. Fonctions : service_role seulement ====================================
  FOREACH fn IN ARRAY ARRAY[
    'public.provider_account_id_columns()',
    'public.provider_account_id_column_state(text, text, text)',
    'public.provider_account_id_row_match(text, text, text, text, boolean)',
    'public.provider_account_id_usage(text)',
    'public.provider_account_id_orphans(integer)',
    'public.remap_provider_account_id(uuid, text, text, text, uuid)',
    'public.rollback_provider_account_id_remap(uuid)'] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      failures := failures || format('[2. %s exécutable par anon ou authenticated] ', fn);
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      failures := failures || format('[2. %s non exécutable par service_role] ', fn);
    END IF;
    SELECT p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      INTO v_bool FROM pg_proc p WHERE p.oid = fn::regprocedure;
    IF v_bool THEN failures := failures || format('[2. %s exécutable par PUBLIC] ', fn); END IF;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.provider_account_id_usage(text)',
    'public.provider_account_id_orphans(integer)',
    'public.remap_provider_account_id(uuid, text, text, text, uuid)',
    'public.rollback_provider_account_id_remap(uuid)'] LOOP
    SELECT prosecdef INTO v_bool FROM pg_proc WHERE oid = fn::regprocedure;
    IF NOT coalesce(v_bool, false) THEN failures := failures || format('[2. %s n''est pas SECURITY DEFINER] ', fn); END IF;
  END LOOP;

  -- ===== 3. Registre ================================================================
  SELECT count(*) INTO n FROM (SELECT table_name, column_name FROM public.provider_account_id_columns() GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF n <> 0 THEN failures := failures || '[3. doublon au registre] '; END IF;
  SELECT count(*) INTO n FROM public.provider_account_id_columns() WHERE mode NOT IN ('remap', 'report_only') OR kind NOT IN ('text', 'jsonb_sender_accounts', 'contains_text');
  IF n <> 0 THEN failures := failures || '[3. mode ou type inconnu au registre] '; END IF;
  FOR r IN SELECT c.* FROM public.provider_account_id_columns() c WHERE c.mode = 'remap' LOOP
    IF to_regclass('public.' || r.table_name) IS NOT NULL THEN
      SELECT st.status INTO v_text FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st;
      -- sequence_steps.sender_id est de type uuid sur une base neuve : état unsupported_type attendu, jamais réécrit.
      IF v_text <> 'ok' AND NOT (r.table_name = 'sequence_steps' AND r.column_name = 'sender_id' AND v_text = 'unsupported_type') THEN
        failures := failures || format('[3. %s.%s : état %s] ', r.table_name, r.column_name, v_text);
      END IF;
      IF v_text = 'ok' THEN
        SELECT (st.pk_columns IS NULL) INTO v_bool FROM public.provider_account_id_column_state(r.table_name, r.column_name, r.kind) st;
        IF v_bool THEN failures := failures || format('[3. %s sans clé primaire : non sauvegardable] ', r.table_name); END IF;
      END IF;
    END IF;
  END LOOP;
  -- Toute colonne *account_id* du schéma public est au registre ou justifiée ici.
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname ILIKE '%account_id%'
      AND NOT EXISTS (SELECT 1 FROM public.provider_account_id_columns() g WHERE g.table_name = c.relname AND g.column_name = a.attname)
      AND (c.relname, a.attname) NOT IN (
        -- Écrites après la bascule, déjà au format acc_ (contrainte CHECK pour reconnect_account_id).
        ('connection_attempts', 'account_id'),
        ('connection_attempts', 'reconnect_account_id'),
        -- Clé étrangère vers member_calendar_accounts(id), pas un identifiant du prestataire.
        ('qualification_sessions', 'calendar_account_id'))
  LOOP
    failures := failures || format('[3. %s.%s porte un identifiant de compte hors du registre : l''ajouter à provider_account_id_columns() ou le justifier ici] ', r.tbl, r.col);
  END LOOP;

  -- ===== Jeu de données =============================================================
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@remap.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_m, 'm@remap.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@remap.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Remap Org 1', 'remap-org-1', u_a), (o2, 'Remap Org 2', 'remap-org-2', u_b);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (o1, u_m, 'member');

  INSERT INTO public.sourcing_projects (id, name, created_by, organization_id) VALUES (proj, 'Remap mission', u_a, o1);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active, multi_sender_enabled, sender_accounts)
  VALUES (seq1, 'Remap S1', o1, u_a, true, true,
          '[{"account_id":"rm-li-a","daily_limit":50,"label":"A"},{"account_id":"rm-li-m","daily_limit":40},{"account_id":"rm-other","daily_limit":10},"rm-li-a"]'::jsonb),
         (seq2, 'Remap S2', o2, u_b, true, false, '[{"account_id":"rm-li-b"}]'::jsonb);

  -- Liaisons de A (LinkedIn, e-mail, WhatsApp, agenda) et de l'organisation 2.
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_a, 'rm-li-a', u_a), (o2, u_b, 'rm-li-b', u_b);
  INSERT INTO public.member_email_accounts (organization_id, user_id, email_account_id, linked_by) VALUES (o1, u_a, 'rm-mail-a', u_a);
  INSERT INTO public.member_whatsapp_accounts (organization_id, user_id, whatsapp_account_id) VALUES (o1, u_a, 'rm-wa-a');
  INSERT INTO public.member_calendar_accounts (organization_id, user_id, provider, account_id) VALUES (o1, u_a, 'outlook', 'rm-mail-a');

  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, assigned_sender_id, profile_id, organization_id, created_by, status)
  VALUES (e_a, seq1, 'rm-li-a', 'rm-li-a', 'ACoRM1', o1, u_a, 'active'),
         (e_b, seq2, 'rm-li-b', NULL, 'ACoRM3', o2, u_b, 'active');
  -- Inscription héritée : créée par A sur le compte de M, AVANT que M relie son compte (la garde
  -- d'insertion la refuserait après). Cas réel : « une inscription héritée déjà posée sur le compte d'un collègue ».
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (e_legacy, seq1, 'rm-li-m', 'ACoRM2', o1, u_a, 'active');
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by) VALUES (o1, u_m, 'rm-li-m', u_m);

  INSERT INTO public.inmail_queue (account_id, recipient_profile_id, subject, message, created_by)
  VALUES ('rm-li-a', 'ACoRM1', 's', 'm', u_a), ('rm-li-b', 'ACoRM3', 's', 'm', u_b);
  -- 'rm-gone' : ancien identifiant d'un compte qui n'est plus relié (ni dans une liaison, ni au format acc_).
  INSERT INTO public.linkedin_action_log (account_id, action_type)
  VALUES ('rm-li-a', 'rm_audit'), ('rm-li-a', 'rm_audit'), ('rm-li-m', 'rm_audit'), ('rm-li-b', 'rm_audit'),
         ('rm-gone', 'rm_audit'), ('rm-gone', 'rm_audit'), ('acc_rm_already', 'rm_audit');
  INSERT INTO public.chat_categories (chat_id, account_id, created_by) VALUES ('rm-chat-1', 'rm-li-a', u_a), ('rm-chat-2', 'rm-li-b', u_b);
  INSERT INTO public.message_analysis_cache (chat_id, account_id) VALUES ('rm-chat-1', 'rm-li-a'), ('rm-chat-2', 'rm-li-b');
  INSERT INTO public.mission_conversations (organization_id, project_id, account_id, candidate_id, source)
  VALUES (o1, proj, 'rm-li-a', 'rm-cand-1', 'manual'), (o1, proj, 'rm-li-m', 'rm-cand-2', 'manual');
  INSERT INTO public.profile_enrichment_queue (account_id, dedup_key, provider_id) VALUES ('rm-li-a', 'rm-dedup-1', 'ACoRM1');
  INSERT INTO public.nurturing_opportunities (candidate_id, trigger_type, suggested_action, created_by, linkedin_account_id)
  VALUES ('rm-cand-1', 'silence', 'followup', u_a, 'rm-li-a');
  INSERT INTO public.sourcing_agents (organization_id, project_id, created_by, source, account_id, api)
  VALUES (o1, proj, u_a, 'linkedin', 'rm-li-a', 'recruiter');
  INSERT INTO public.internal_config (key, value) VALUES ('pedigree_resolver_account_id', 'rm-li-a'), ('rm_audit_other_key', 'rm-li-a')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.webhook_event_log (event_key, provider, account_id) VALUES ('rm-audit:1', 'unipile', 'rm-li-a');

  -- ===== 4. Usage : effectifs justes, lecture seule ===================================
  d0 := pg_temp.rm_digest();
  SELECT string_agg(table_name || '.' || column_name || '=' || rows_holding || ':' || status, ' ' ORDER BY table_name, column_name)
    INTO v_text FROM public.provider_account_id_usage('rm-li-a') WHERE rows_holding > 0 OR status IN ('remap', 'report_only');
  FOREACH fn IN ARRAY ARRAY[
    'sequence_enrollments.account_id=1:remap', 'sequence_enrollments.assigned_sender_id=1:remap',
    'outreach_sequences.sender_accounts=1:remap', 'inmail_queue.account_id=1:remap',
    'linkedin_action_log.account_id=2:remap', 'mission_conversations.account_id=1:remap',
    'profile_enrichment_queue.account_id=1:remap', 'nurturing_opportunities.linkedin_account_id=1:remap',
    'sourcing_agents.account_id=1:remap', 'chat_categories.account_id=1:remap',
    'message_analysis_cache.account_id=1:remap', 'internal_config.value=1:remap',
    'member_linkedin_accounts.linkedin_account_id=1:remap', 'webhook_event_log.account_id=1:report_only'] LOOP
    IF position(fn IN coalesce(v_text, '')) = 0 THEN failures := failures || format('[4. usage : %s absent de « %s »] ', fn, v_text); END IF;
  END LOOP;
  IF pg_temp.rm_digest() IS DISTINCT FROM d0 THEN failures := failures || '[4. provider_account_id_usage a écrit] '; END IF;
  SELECT rows_holding INTO n FROM public.provider_account_id_usage('rm-aucun') WHERE table_name = 'linkedin_action_log';
  IF n IS DISTINCT FROM 0 THEN failures := failures || '[4. usage d''un identifiant inconnu non nul] '; END IF;
  BEGIN
    PERFORM * FROM public.provider_account_id_usage('  ');
    failures := failures || '[4. usage d''un identifiant vide accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'REMAP_INVALID_OLD' THEN failures := failures || format('[4. identifiant vide : %s] ', v_hint); END IF;
  END;

  -- ===== 4b. Identifiants sans compte relié ==========================================
  d0 := pg_temp.rm_digest();
  SELECT string_agg(table_name || '.' || column_name || '=' || value || ':' || rows_holding, ' ' ORDER BY table_name, column_name, value)
    INTO v_text FROM public.provider_account_id_orphans(500);
  IF position('linkedin_action_log.account_id=rm-gone:2' IN coalesce(v_text, '')) = 0 THEN
    failures := failures || format('[4b. orphelin du registre d''actions absent : %s] ', v_text);
  END IF;
  IF position('outreach_sequences.sender_accounts=rm-other:1' IN coalesce(v_text, '')) = 0 THEN
    failures := failures || format('[4b. orphelin du tableau sender_accounts absent : %s] ', v_text);
  END IF;
  -- Comptes reliés, format acc_ : jamais rendus. L'élément texte du tableau n'est pas un objet : ignoré.
  FOREACH fn IN ARRAY ARRAY['=rm-li-a:', '=rm-li-m:', '=rm-li-b:', '=rm-mail-a:', '=rm-wa-a:', '=acc_rm_already:'] LOOP
    IF position(fn IN coalesce(v_text, '')) > 0 THEN failures := failures || format('[4b. %s rendu comme orphelin] ', fn); END IF;
  END LOOP;
  IF pg_temp.rm_digest() IS DISTINCT FROM d0 THEN failures := failures || '[4b. provider_account_id_orphans a écrit] '; END IF;
  -- La limite par colonne est respectée.
  SELECT max(c) INTO n FROM (SELECT count(*) AS c FROM public.provider_account_id_orphans(1) GROUP BY table_name, column_name) x;
  IF n > 1 THEN failures := failures || format('[4b. limite ignorée : %s valeurs pour une colonne] ', n); END IF;

  -- ===== 5. Ordre des écritures =====================================================
  -- Ordre inverse (liaison d'abord) : la garde refuse la mise à jour de l'inscription héritée.
  d0 := pg_temp.rm_digest();
  BEGIN
    UPDATE public.member_linkedin_accounts SET linkedin_account_id = 'acc_rm_order' WHERE linkedin_account_id = 'rm-li-m';
    BEGIN
      UPDATE public.sequence_enrollments SET account_id = 'acc_rm_order' WHERE id = e_legacy;
      failures := failures || '[5. ordre inverse : l''inscription héritée a été acceptée, la garde ne protège plus ce cas] ';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
        failures := failures || format('[5. ordre inverse refusé pour une autre raison : %s] ', v_hint);
      END IF;
    END;
    RAISE EXCEPTION 'rm_audit_undo' USING ERRCODE = 'P0001';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    IF v_text IS DISTINCT FROM 'rm_audit_undo' THEN failures := failures || format('[5. %s] ', v_text); END IF;
  END;
  IF pg_temp.rm_digest() IS DISTINCT FROM d0 THEN failures := failures || '[5. l''essai d''ordre inverse n''a pas été annulé] '; END IF;

  -- ===== 6. Bascule d'une paire ======================================================
  sender_before := (SELECT sender_accounts FROM public.outreach_sequences WHERE id = seq1);
  d0 := pg_temp.rm_digest();

  -- Paire M : l'inscription héritée passe, dans l'ordre du registre.
  res := public.remap_provider_account_id(batch1, 'rm-li-m', 'acc_rm_li_m', 'linkedin', u_a);
  SELECT account_id INTO v_text FROM public.sequence_enrollments WHERE id = e_legacy;
  IF v_text IS DISTINCT FROM 'acc_rm_li_m' THEN failures := failures || format('[6. inscription héritée : %s] ', v_text); END IF;
  SELECT linkedin_account_id INTO v_text FROM public.member_linkedin_accounts WHERE user_id = u_m AND organization_id = o1;
  IF v_text IS DISTINCT FROM 'acc_rm_li_m' THEN failures := failures || format('[6. liaison de M : %s] ', v_text); END IF;
  -- 1 inscription + 1 élément de tableau (séquence) + 1 action + 1 conversation + 1 liaison.
  IF (res ->> 'total_rows')::bigint <> 5 THEN failures := failures || format('[6. paire M : %s lignes au lieu de 5 : %s] ', res ->> 'total_rows', res::text); END IF;
  IF res ->> 'kind' <> 'linkedin' THEN failures := failures || '[6. type de la paire M] '; END IF;
  SELECT count(*) INTO n FROM public.account_id_remap_backup WHERE batch_id = batch1;
  IF n <> 5 THEN failures := failures || format('[6. sauvegarde de la paire M : %s lignes au lieu de 5] ', n); END IF;
  SELECT count(*) INTO n FROM public.account_id_remap WHERE batch_id = batch1 AND old_id = 'rm-li-m' AND new_id = 'acc_rm_li_m' AND kind = 'linkedin' AND applied_by = u_a AND rolled_back_at IS NULL;
  IF n <> 1 THEN failures := failures || '[6. ligne account_id_remap de la paire M] '; END IF;

  -- Paire A : toutes les colonnes, le tableau, la seule ligne internal_config visée.
  res := public.remap_provider_account_id(batch1, 'rm-li-a', 'acc_rm_li_a');
  IF res ->> 'kind' <> 'linkedin' THEN failures := failures || format('[6. type déduit : %s] ', res ->> 'kind'); END IF;
  SELECT count(*) INTO n FROM public.provider_account_id_usage('rm-li-a') WHERE status = 'remap' AND rows_holding > 0;
  IF n <> 0 THEN failures := failures || format('[6. %s colonne(s) portent encore l''ancien identifiant de A] ', n); END IF;
  SELECT count(*) INTO n FROM public.provider_account_id_usage('acc_rm_li_a') WHERE status = 'remap' AND rows_holding > 0;
  IF n < 11 THEN failures := failures || format('[6. seulement %s colonnes portent le nouvel identifiant de A] ', n); END IF;
  SELECT sender_accounts::text INTO v_text FROM public.outreach_sequences WHERE id = seq1;
  IF v_text IS DISTINCT FROM '[{"label": "A", "account_id": "acc_rm_li_a", "daily_limit": 50}, {"account_id": "acc_rm_li_m", "daily_limit": 40}, {"account_id": "rm-other", "daily_limit": 10}, "rm-li-a"]' THEN
    failures := failures || format('[6. tableau sender_accounts : %s] ', v_text);
  END IF;
  SELECT value INTO v_text FROM public.internal_config WHERE key = 'pedigree_resolver_account_id';
  IF v_text IS DISTINCT FROM 'acc_rm_li_a' THEN failures := failures || '[6. internal_config.pedigree_resolver_account_id non réécrit] '; END IF;
  SELECT value INTO v_text FROM public.internal_config WHERE key = 'rm_audit_other_key';
  IF v_text IS DISTINCT FROM 'rm-li-a' THEN failures := failures || '[6. une autre clé de internal_config a été réécrite] '; END IF;
  SELECT account_id INTO v_text FROM public.webhook_event_log WHERE event_key = 'rm-audit:1';
  IF v_text IS DISTINCT FROM 'rm-li-a' THEN failures := failures || '[6. le journal (report_only) a été réécrit] '; END IF;
  -- L'autre organisation et les autres comptes ne bougent pas.
  SELECT account_id INTO v_text FROM public.sequence_enrollments WHERE id = e_b;
  IF v_text IS DISTINCT FROM 'rm-li-b' THEN failures := failures || '[6. l''inscription de l''autre organisation a bougé] '; END IF;
  SELECT linkedin_account_id INTO v_text FROM public.member_linkedin_accounts WHERE user_id = u_b;
  IF v_text IS DISTINCT FROM 'rm-li-b' THEN failures := failures || '[6. la liaison de l''autre organisation a bougé] '; END IF;
  SELECT count(*) INTO n FROM public.linkedin_action_log WHERE account_id = 'rm-li-b';
  IF n <> 1 THEN failures := failures || '[6. le registre d''actions de l''autre compte a bougé] '; END IF;
  -- Sauvegarde : une ligne par valeur réécrite, l'ancienne et la nouvelle valeur.
  SELECT count(*) INTO n FROM public.account_id_remap_backup
   WHERE batch_id = batch1 AND table_name = 'member_linkedin_accounts' AND old_value = '"rm-li-a"'::jsonb AND new_value = '"acc_rm_li_a"'::jsonb
     AND row_key ? 'id' AND column_name = 'linkedin_account_id';
  IF n <> 1 THEN failures := failures || '[6. sauvegarde de la liaison de A] '; END IF;
  SELECT count(*) INTO n FROM public.account_id_remap_backup
   WHERE batch_id = batch1 AND table_name = 'outreach_sequences' AND old_value = sender_before AND column_name = 'sender_accounts';
  IF n <> 1 THEN failures := failures || '[6. sauvegarde du tableau sender_accounts (valeur d''avant)] '; END IF;
  SELECT count(*) INTO n FROM public.account_id_remap_backup WHERE batch_id = batch1 AND table_name = 'internal_config' AND row_key = '{"key": "pedigree_resolver_account_id"}'::jsonb;
  IF n <> 1 THEN failures := failures || '[6. sauvegarde de internal_config avec sa clé primaire texte] '; END IF;

  -- Paires e-mail (liaison et agenda du même compte) et WhatsApp.
  res := public.remap_provider_account_id(batch1, 'rm-mail-a', 'acc_rm_mail_a', 'email', u_a);
  IF (res ->> 'total_rows')::bigint <> 2 THEN failures := failures || format('[6. paire e-mail : %s lignes au lieu de 2 (liaison + agenda)] ', res ->> 'total_rows'); END IF;
  res := public.remap_provider_account_id(batch1, 'rm-wa-a', 'acc_rm_wa_a', 'whatsapp', u_a);
  IF (res ->> 'total_rows')::bigint <> 1 THEN failures := failures || format('[6. paire WhatsApp : %s lignes au lieu de 1] ', res ->> 'total_rows'); END IF;

  -- Rejouable : sans effet, sans sauvegarde en plus.
  SELECT count(*) INTO n FROM public.account_id_remap_backup WHERE batch_id = batch1;
  res := public.remap_provider_account_id(batch1, 'rm-li-a', 'acc_rm_li_a', 'linkedin', u_a);
  SELECT count(*) INTO n2 FROM public.account_id_remap_backup WHERE batch_id = batch1;
  IF (res ->> 'total_rows')::bigint <> 0 OR n2 <> n THEN failures := failures || '[6. rejeu de la paire A a écrit] '; END IF;
  SELECT count(*) INTO n FROM public.account_id_remap WHERE batch_id = batch1;
  IF n <> 4 THEN failures := failures || format('[6. %s lignes account_id_remap au lieu de 4] ', n); END IF;

  -- Entrées invalides.
  FOR r IN SELECT * FROM (VALUES
    ('rm-x', 'pas_acc', 'REMAP_INVALID_NEW'), ('rm-x', NULL, 'REMAP_INVALID_NEW'),
    ('acc_deja_v2', 'acc_autre', 'REMAP_INVALID_OLD'), ('', 'acc_autre', 'REMAP_INVALID_OLD'), (NULL, 'acc_autre', 'REMAP_INVALID_OLD'),
    ('rm-li-m', 'acc_une_autre_cible', 'REMAP_BATCH_CONFLICT')) AS v(o, nw, h)
  LOOP
    BEGIN
      PERFORM public.remap_provider_account_id(batch1, r.o, r.nw, 'linkedin');
      failures := failures || format('[6. entrée invalide acceptée : %s -> %s] ', r.o, r.nw);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM r.h THEN failures := failures || format('[6. %s -> %s : %s au lieu de %s] ', r.o, r.nw, v_hint, r.h); END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.remap_provider_account_id(batch1, 'rm-x', 'acc_x', 'telegram');
    failures := failures || '[6. type de compte inconnu accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'REMAP_INVALID_KIND' THEN failures := failures || format('[6. type inconnu : %s] ', v_hint); END IF;
  END;
  BEGIN
    PERFORM public.remap_provider_account_id(batch1, 'rm-sans-liaison', 'acc_sans_liaison');
    failures := failures || '[6. type indéterminable accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'REMAP_KIND_UNKNOWN' THEN failures := failures || format('[6. type indéterminable : %s] ', v_hint); END IF;
  END;

  -- ===== 7. Atomicité ================================================================
  d1 := pg_temp.rm_digest();
  SELECT count(*) INTO n FROM public.account_id_remap_backup WHERE batch_id = batch2;
  -- Conflit d'unicité : le nouvel identifiant est déjà porté, dans la même organisation, par une autre liaison.
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_b, 'acc_rm_taken', u_b);
  -- La paire B (autre organisation) vise cet identifiant déjà pris par O1 : refus cross-tenant.
  BEGIN
    PERFORM public.remap_provider_account_id(batch2, 'rm-li-b', 'acc_rm_taken', 'linkedin', u_a);
    failures := failures || '[7. identifiant déjà relié à une autre organisation accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IS DISTINCT FROM '42501' THEN failures := failures || format('[7. cross-tenant : SQLSTATE %s au lieu de 42501] ', v_state); END IF;
  END;
  -- Conflit d'unicité hors liaison : message_analysis_cache (chat_id, account_id) porte déjà la cible.
  INSERT INTO public.message_analysis_cache (chat_id, account_id) VALUES ('rm-chat-2', 'acc_rm_cache_target');
  BEGIN
    PERFORM public.remap_provider_account_id(batch2, 'rm-li-b', 'acc_rm_cache_target', 'linkedin', u_a);
    failures := failures || '[7. conflit d''unicité accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_state = RETURNED_SQLSTATE;
    IF v_hint IS DISTINCT FROM 'REMAP_CONFLICT' OR v_state IS DISTINCT FROM '23505' THEN
      failures := failures || format('[7. conflit : %s / %s au lieu de REMAP_CONFLICT / 23505] ', v_hint, v_state);
    END IF;
  END;
  DELETE FROM public.message_analysis_cache WHERE account_id = 'acc_rm_cache_target';
  DELETE FROM public.member_linkedin_accounts WHERE linkedin_account_id = 'acc_rm_taken';
  d2 := pg_temp.rm_digest();
  IF d2 IS DISTINCT FROM d1 THEN failures := failures || '[7. un refus a laissé des écritures partielles] '; END IF;
  SELECT count(*) INTO n2 FROM public.account_id_remap_backup WHERE batch_id = batch2;
  IF n2 <> n THEN failures := failures || '[7. un refus a laissé des lignes de sauvegarde] '; END IF;
  SELECT count(*) INTO n2 FROM public.account_id_remap WHERE batch_id = batch2;
  IF n2 <> 0 THEN failures := failures || '[7. un refus a laissé une ligne account_id_remap] '; END IF;

  -- ===== 8. Restauration =============================================================
  -- Une ligne modifiée depuis la bascule n'est pas écrasée.
  UPDATE public.inmail_queue SET account_id = 'rm-changed-after' WHERE account_id = 'acc_rm_li_a';
  -- Une ligne créée depuis la bascule (trafic courant) porte le nouvel identifiant et n'a pas de sauvegarde.
  INSERT INTO public.linkedin_action_log (account_id, action_type) VALUES ('acc_rm_li_a', 'rm_audit_late');
  res := public.rollback_provider_account_id_remap(batch1);
  IF (res ->> 'moved_rows')::bigint <> 1 THEN failures := failures || format('[8. %s ligne(s) modifiée(s) depuis au lieu de 1 : %s] ', res ->> 'moved_rows', res::text); END IF;
  IF (res ->> 'still_new_rows')::bigint <> 1
     OR NOT (res -> 'still_new') @> '[{"table": "linkedin_action_log", "column": "account_id", "rows": 1}]'::jsonb THEN
    failures := failures || format('[8. ligne créée depuis la bascule non comptée (still_new) : %s] ', res::text);
  END IF;
  DELETE FROM public.linkedin_action_log WHERE action_type = 'rm_audit_late';
  SELECT account_id INTO v_text FROM public.inmail_queue WHERE created_by = u_a;
  IF v_text IS DISTINCT FROM 'rm-changed-after' THEN failures := failures || '[8. une ligne modifiée depuis a été écrasée] '; END IF;
  UPDATE public.inmail_queue SET account_id = 'rm-li-a' WHERE account_id = 'rm-changed-after';
  d2 := pg_temp.rm_digest();
  IF d2 IS DISTINCT FROM d0 THEN failures := failures || '[8. les valeurs d''avant ne sont pas rétablies] '; END IF;
  SELECT sender_accounts INTO sender_before FROM public.outreach_sequences WHERE id = seq1;
  IF sender_before::text IS DISTINCT FROM '[{"label": "A", "account_id": "rm-li-a", "daily_limit": 50}, {"account_id": "rm-li-m", "daily_limit": 40}, {"account_id": "rm-other", "daily_limit": 10}, "rm-li-a"]' THEN
    failures := failures || format('[8. tableau sender_accounts restauré : %s] ', sender_before::text);
  END IF;
  SELECT count(*) INTO n FROM public.account_id_remap WHERE batch_id = batch1 AND rolled_back_at IS NOT NULL;
  IF n <> 4 THEN failures := failures || format('[8. %s paires marquées restaurées au lieu de 4] ', n); END IF;
  BEGIN
    PERFORM public.rollback_provider_account_id_remap(batch1);
    failures := failures || '[8. un lot restauré deux fois] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'REMAP_BATCH_ALREADY_ROLLED_BACK' THEN failures := failures || format('[8. double restauration : %s] ', v_hint); END IF;
  END;
  BEGIN
    PERFORM public.rollback_provider_account_id_remap(batch_unknown);
    failures := failures || '[8. lot inconnu accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IS DISTINCT FROM 'P0002' THEN failures := failures || format('[8. lot inconnu : %s] ', v_state); END IF;
  END;
  -- Le lot restauré peut être rejoué : un nouveau lot refait la bascule.
  res := public.remap_provider_account_id(batch3, 'rm-li-m', 'acc_rm_li_m', 'linkedin', u_a);
  IF (res ->> 'total_rows')::bigint <> 5 THEN failures := failures || format('[8. nouvelle bascule après restauration : %s lignes au lieu de 5] ', res ->> 'total_rows'); END IF;

  -- ===== 9. Colonne d'un type inattendu ==============================================
  -- nurturing_opportunities.linkedin_account_id passe en type name (aucune policy n'en dépend) : l'état est
  -- unsupported_type. La colonne n'est pas réécrite, mais ses lignes sont comptées et rapportées.
  ALTER TABLE public.nurturing_opportunities ALTER COLUMN linkedin_account_id TYPE name USING linkedin_account_id::name;
  INSERT INTO public.nurturing_opportunities (candidate_id, trigger_type, suggested_action, created_by, linkedin_account_id)
  VALUES ('rm-cand-9', 'silence', 'followup', u_a, 'rm-un-1'), ('rm-cand-10', 'silence', 'followup', u_a, 'rm-un-1');
  SELECT st.status INTO v_text FROM public.provider_account_id_column_state('nurturing_opportunities', 'linkedin_account_id', 'text') st;
  IF v_text IS DISTINCT FROM 'unsupported_type' THEN failures := failures || format('[9. état de la colonne : %s] ', v_text); END IF;
  SELECT rows_holding, status INTO r FROM public.provider_account_id_usage('rm-un-1') WHERE table_name = 'nurturing_opportunities';
  IF r.rows_holding IS DISTINCT FROM 2 OR r.status IS DISTINCT FROM 'unsupported_type' THEN
    failures := failures || format('[9. usage d''une colonne de type inattendu : %s / %s au lieu de 2 / unsupported_type] ', r.rows_holding, r.status);
  END IF;
  res := public.remap_provider_account_id(batch3, 'rm-un-1', 'acc_rm_un_1', 'linkedin', u_a);
  IF (res ->> 'total_rows')::bigint <> 0 THEN failures := failures || format('[9. une colonne de type inattendu a été réécrite : %s] ', res::text); END IF;
  IF NOT (res -> 'columns') @> '[{"table": "nurturing_opportunities", "column": "linkedin_account_id", "status": "unsupported_type", "skipped_rows": 2}]'::jsonb THEN
    failures := failures || format('[9. colonne sautée non rapportée avec ses lignes : %s] ', res -> 'columns');
  END IF;
  SELECT count(*) INTO n FROM public.nurturing_opportunities WHERE linkedin_account_id::text = 'rm-un-1';
  IF n <> 2 THEN failures := failures || '[9. lignes de la colonne de type inattendu modifiées] '; END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'account_remap_audit : %', failures;
  END IF;
END $$;
