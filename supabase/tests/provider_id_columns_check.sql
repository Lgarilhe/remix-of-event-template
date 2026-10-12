-- =====================================================================
-- Contrôle de complétude de la bascule des identifiants de compte (API v1 vers v2).
-- LECTURE SEULE : une seule requête SELECT, aucune écriture, aucune fonction du dépôt
-- appelée. À coller dans l'éditeur SQL de Supabase (production) par le propriétaire,
-- avant la bascule. Elle ne dépend d'aucune migration de la bascule.
--
-- Résultat : une ligne par objet, triée avec les lignes à examiner en tête.
--   section  colonne        colonne dont le nom contient account_id, chat_id, provider_id,
--                           message_id ou attendee (tables du schéma public)
--            registre       colonne que la bascule réécrit mais qui n'existe pas dans cette base
--            orphelin       colonne réécrite par la bascule qui contient des identifiants ne correspondant à
--                           aucun compte relié (tables member_*), ni au format acc_, ni à un uuid : anciens
--                           identifiants (compte reconnecté ou supprimé) que la bascule ne peut pas apparier ;
--                           le nombre de lignes est dans la note. Lecture seule (query_to_xml ne fait que compter)
--            jsonb          clé jsonb connue qui porte un identifiant de compte
--            internal_config  clé de internal_config dont le nom contient « account »
--            fonction       fonction du schéma public dont le texte mentionne une colonne de compte
--            policy         policy dont la condition mentionne une colonne de compte
--            declencheur    déclencheur dont la fonction mentionne une colonne de compte
--   statut   COUVERT        réécrite par la bascule (liste ci-dessous = registre de la migration
--                           *_provider_account_id_remap.sql, gardée identique par un test)
--            LAISSE         laissée telle quelle, avec la raison dans la colonne note
--            A EXAMINER     colonne inconnue du dépôt : à décider avant la bascule
--            A LIRE         fonction, policy ou déclencheur : lit une colonne de compte ; la bascule
--                           réécrit les colonnes et ces objets lisent les valeurs de la base, ils
--                           n'ont donc rien à changer, sauf s'ils portent un identifiant écrit en dur
--                           (à chercher dans le texte de ceux qui sont listés)
--
-- Ce que la requête ne voit pas : le contenu des colonnes jsonb et texte libre. Les clés jsonb
-- listées sont celles que le code du dépôt écrit.
-- =====================================================================
WITH remapped(table_name, column_name) AS (
  VALUES
    ('sequence_enrollments', 'account_id'),
    ('sequence_enrollments', 'assigned_sender_id'),
    ('sequence_steps', 'sender_id'),
    ('outreach_sequences', 'sender_accounts'),
    ('inmail_queue', 'account_id'),
    ('linkedin_action_log', 'account_id'),
    ('mission_conversations', 'account_id'),
    ('candidate_action_messages', 'account_id'),
    ('profile_enrichment_queue', 'account_id'),
    ('nurturing_opportunities', 'linkedin_account_id'),
    ('sourcing_agents', 'account_id'),
    ('chat_categories', 'account_id'),
    ('message_analysis_cache', 'account_id'),
    ('internal_config', 'value'),
    ('member_calendar_accounts', 'account_id'),
    ('member_whatsapp_accounts', 'whatsapp_account_id'),
    ('member_email_accounts', 'email_account_id'),
    ('member_linkedin_accounts', 'linkedin_account_id')
),
left_alone(table_name, column_name, reason) AS (
  VALUES
    ('webhook_event_log', 'account_id', 'journal de diagnostic, aucun lecteur par compte'),
    ('search_failure_log', 'account_id', 'journal de diagnostic, lu sur 12 heures'),
    ('connection_attempts', 'account_id', 'écrite après la bascule, déjà au format acc_'),
    ('connection_attempts', 'reconnect_account_id', 'écrite après la bascule, contrainte CHECK au format acc_'),
    ('qualification_sessions', 'calendar_account_id', 'clé étrangère uuid vers member_calendar_accounts, pas un identifiant du prestataire'),
    ('mission_conversations', 'chat_id', 'aucune correspondance ancien/nouveau identifiant de conversation : relié à nouveau par la lecture du compte et du candidat'),
    ('mission_conversations', 'last_outbound_message_id', 'aucune correspondance ancien/nouveau identifiant de message'),
    ('chat_categories', 'chat_id', 'aucune correspondance ancien/nouveau identifiant de conversation'),
    ('message_analysis_cache', 'chat_id', 'aucune correspondance ancien/nouveau identifiant de conversation (cache)'),
    ('candidate_action_messages', 'provider_message_id', 'identifiant de message du journal, clé d''unicité avec account_id'),
    ('candidate_action_messages', 'provider_thread_id', 'identifiant de fil du journal'),
    ('sequence_enrollments', 'provider_id', 'identifiant LinkedIn du candidat, pas un compte'),
    ('profile_enrichment_queue', 'provider_id', 'identifiant LinkedIn du candidat, pas un compte'),
    ('candidate_enrichment_cache', 'provider_id', 'identifiant LinkedIn du candidat, pas un compte'),
    ('email_send_log', 'message_id', 'identifiant de message d''un envoi transactionnel, sans lien avec un compte relié'),
    ('sequence_email_tracking', 'email_message_id', 'identifiant de message e-mail suivi (pixel, liens)'),
    ('jarvis_messages', 'message_id', 'identifiant interne de message de l''assistant'),
    ('agent_memory_proposals', 'source_message_id', 'uuid interne de message de l''assistant'),
    ('agent_tool_executions', 'message_id', 'uuid interne de message de l''assistant')
),
account_pattern(re) AS (
  VALUES ('(account_id|linkedin_account_id|email_account_id|whatsapp_account_id|sender_accounts|assigned_sender_id)')
),
found_columns AS (
  SELECT c.table_name::text AS table_name, c.column_name::text AS column_name, c.data_type::text AS data_type
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND (c.column_name ILIKE '%account_id%' OR c.column_name ILIKE '%chat_id%' OR c.column_name ILIKE '%provider_id%'
         OR c.column_name ILIKE '%message_id%' OR c.column_name ILIKE '%attendee%')
),
column_rows AS (
  SELECT 'colonne'::text AS section, f.table_name, f.column_name, f.data_type,
         CASE
           WHEN r.table_name IS NOT NULL AND f.data_type IN ('text', 'character varying', 'jsonb') THEN 'COUVERT'
           WHEN r.table_name IS NOT NULL THEN 'A EXAMINER'
           WHEN l.table_name IS NOT NULL THEN 'LAISSE'
           ELSE 'A EXAMINER'
         END AS statut,
         CASE
           WHEN r.table_name IS NOT NULL AND f.data_type IN ('text', 'character varying', 'jsonb') THEN 'réécrite par la bascule'
           WHEN r.table_name IS NOT NULL THEN 'au registre mais de type ' || f.data_type || ' : la bascule la saute (seules les colonnes texte et jsonb sont réécrites)'
           WHEN l.table_name IS NOT NULL THEN l.reason
           ELSE 'colonne inconnue du dépôt : dire si elle porte un identifiant de compte'
         END AS note
  FROM found_columns f
  LEFT JOIN remapped r ON r.table_name = f.table_name AND r.column_name = f.column_name
  LEFT JOIN left_alone l ON l.table_name = f.table_name AND l.column_name = f.column_name
),
registry_rows AS (
  SELECT 'registre'::text, r.table_name::text, r.column_name::text, NULL::text,
         'A EXAMINER'::text,
         'au registre de la bascule mais absente de cette base : sautée sans effet (vérifier que ce n''est pas un autre nom)'::text
  FROM remapped r
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = r.column_name
  )
),
member_union AS (
  SELECT string_agg(format('SELECT %I::text AS v FROM public.%I', r.column_name, r.table_name), ' UNION ') AS sql
  FROM remapped r
  WHERE r.table_name LIKE 'member\_%'
    AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = r.column_name
    )
),
orphan_queries AS MATERIALIZED (
  SELECT r.table_name::text AS table_name, r.column_name::text AS column_name,
         CASE
           WHEN c.data_type = 'jsonb' THEN format(
             'SELECT count(*) AS n FROM public.%1$I t CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.%2$I) = ''array'' THEN t.%2$I ELSE ''[]''::jsonb END) AS e(value) '
             || 'WHERE jsonb_typeof(e.value) = ''object'' AND btrim(coalesce(e.value ->> ''account_id'', '''')) <> '''' AND e.value ->> ''account_id'' !~ ''^acc_'' '
             || 'AND NOT EXISTS (SELECT 1 FROM (%3$s) m WHERE m.v = e.value ->> ''account_id'')',
             r.table_name, r.column_name, coalesce((SELECT sql FROM member_union), 'SELECT NULL::text AS v WHERE false'))
           ELSE format(
             'SELECT count(*) AS n FROM public.%1$I t WHERE t.%2$I IS NOT NULL AND btrim(t.%2$I::text) <> '''' AND t.%2$I::text !~ ''^acc_'' '
             || 'AND t.%2$I::text !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' '
             || 'AND NOT EXISTS (SELECT 1 FROM (%3$s) m WHERE m.v = t.%2$I::text)%4$s',
             r.table_name, r.column_name, coalesce((SELECT sql FROM member_union), 'SELECT NULL::text AS v WHERE false'),
             CASE WHEN r.table_name = 'internal_config' THEN ' AND t.key = ''pedigree_resolver_account_id''' ELSE '' END)
         END AS sql_text
  FROM remapped r
  JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = r.column_name
  WHERE r.table_name NOT LIKE 'member\_%'
    AND c.data_type IN ('text', 'character varying', 'jsonb')
),
orphan_rows AS (
  SELECT 'orphelin'::text, q.table_name, q.column_name, NULL::text, 'A EXAMINER'::text,
         (q.n || ' ligne(s) portent un identifiant qui ne correspond à aucun compte relié : ancien identifiant que la bascule ne peut pas apparier (compte reconnecté ou supprimé). A reconnecter ou à accepter avant la bascule.')::text
  FROM (
    SELECT o.table_name, o.column_name,
           (xpath('/row/n/text()', query_to_xml(o.sql_text, false, true, '')))[1]::text::bigint AS n
    FROM orphan_queries o
  ) q
  WHERE q.n > 0
),
jsonb_rows AS (
  SELECT * FROM (VALUES
    ('jsonb', 'outreach_sequences', 'sender_accounts[].account_id', 'jsonb', 'COUVERT', 'tableau réécrit élément par élément, ordre gardé'),
    ('jsonb', 'notifications', 'metadata.linkedin_account_id, metadata.account_id', 'jsonb', 'LAISSE', 'information seule, aucun lecteur dans le code'),
    ('jsonb', 'agent_tool_executions', 'params, dry_run_result (propositions en attente)', 'jsonb', 'LAISSE', 'le compte d''envoi est relu à l''exécution ; le nombre de propositions concernées est rendu par provider_account_id_usage'),
    ('jsonb', 'sourcing_agents', 'context_snapshot.account_id', 'jsonb', 'LAISSE', 'le contexte d''un agent change avec le compte : à recalibrer après la bascule')
  ) AS v(section, table_name, column_name, data_type, statut, note)
),
config_rows AS (
  SELECT 'internal_config'::text, 'internal_config'::text, k.key::text, 'text'::text,
         CASE WHEN k.key = 'pedigree_resolver_account_id' THEN 'COUVERT' ELSE 'A EXAMINER' END,
         CASE WHEN k.key = 'pedigree_resolver_account_id' THEN 'valeur réécrite par la bascule (la ligne seule)'
              ELSE 'clé dont le nom contient « account » : dire si sa valeur est un identifiant de compte' END
  FROM public.internal_config k
  WHERE k.key ILIKE '%account%'
),
function_rows AS (
  SELECT 'fonction'::text, p.proname::text, pg_get_function_identity_arguments(p.oid)::text, NULL::text,
         'A LIRE'::text,
         (CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
          || ' : mentionne une colonne de compte, lit les valeurs de la base')::text
  FROM pg_proc p
  CROSS JOIN account_pattern ap
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prokind = 'f'
    AND p.prosrc ~* ap.re
    AND p.proname NOT IN ('provider_account_id_columns', 'provider_account_id_column_state', 'provider_account_id_row_match',
                          'provider_account_id_usage', 'provider_account_id_orphans', 'remap_provider_account_id',
                          'rollback_provider_account_id_remap')
),
policy_rows AS (
  SELECT 'policy'::text, (pol.tablename || '.' || pol.policyname)::text, pol.cmd::text, NULL::text,
         'A LIRE'::text,
         'condition qui mentionne une colonne de compte, lit les valeurs de la base'::text
  FROM pg_policies pol
  CROSS JOIN account_pattern ap
  WHERE pol.schemaname = 'public'
    AND (coalesce(pol.qual, '') ~* ap.re OR coalesce(pol.with_check, '') ~* ap.re)
),
trigger_rows AS (
  SELECT 'declencheur'::text, (c.relname || '.' || t.tgname)::text, p.proname::text, NULL::text,
         'A LIRE'::text,
         'déclencheur dont la fonction mentionne une colonne de compte, lit les valeurs de la base'::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid AND c.relnamespace = 'public'::regnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  CROSS JOIN account_pattern ap
  WHERE NOT t.tgisinternal
    AND p.prosrc ~* ap.re
)
SELECT * FROM (
  SELECT * FROM column_rows
  UNION ALL SELECT * FROM registry_rows
  UNION ALL SELECT * FROM orphan_rows
  UNION ALL SELECT * FROM jsonb_rows
  UNION ALL SELECT * FROM config_rows
  UNION ALL SELECT * FROM function_rows
  UNION ALL SELECT * FROM policy_rows
  UNION ALL SELECT * FROM trigger_rows
) all_rows(section, table_name, column_name, data_type, statut, note)
ORDER BY
  CASE statut WHEN 'A EXAMINER' THEN 0 WHEN 'COUVERT' THEN 1 WHEN 'LAISSE' THEN 2 ELSE 3 END,
  section, table_name, column_name;
