-- ====================================================================
-- SECURITY HARDENING: revoke EXECUTE on SECURITY DEFINER functions
-- from client roles (anon / authenticated).
--
-- Contexte (audit 2026-06-10, AUDITS/CODE_AUDIT_2026-06-10.md, P0.1) :
-- la migration 20260421180000_grants_bootstrap_owner_uniques.sql a fait
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO authenticated, anon;
-- → 52 fonctions SECURITY DEFINER (bypass RLS) appelables par n'importe
-- qui via POST /rest/v1/rpc/<name> avec la clé anon publique, dont
-- deduct_ai_credits, get_org_integration, get_vivier_*, enqueue_email...
--
-- Inventaire des appels clients réels (vérifié dans le code) :
--   - Frontend (authenticated) : get_vivier_contacts, get_vivier_companies,
--     get_email_signatures, get_portal_by_token (token-scoped, non flaggée)
--   - Edge functions : tous les .rpc() utilisent un client service_role
--     → non impactés par ce REVOKE
--   - Triggers / pg_cron : EXECUTE du caller non requis au déclenchement
--
-- Idempotente, rejouable. service_role conserve tous ses droits.
-- ====================================================================

-- 1. Default privileges : les futures fonctions ne sont plus exécutables
--    par défaut par les rôles clients. Toute fonction destinée au client
--    devra recevoir un GRANT EXECUTE explicite dans sa migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 2. Revoke ciblé sur les fonctions SECURITY DEFINER existantes.
--    Résolution par nom via pg_proc (toutes signatures, ignore les absentes).
DO $$
DECLARE
  fn text;
  rec record;
  -- Fonctions internes : aucune raison d'être appelables par un client.
  -- (crons pg_cron, workers de queue, triggers, helpers edge service_role)
  revoke_both text[] := ARRAY[
    'acquire_sequence_lock',
    'archive_old_agent_conversations',
    'atomic_tracking_append',
    'auto_create_free_subscription',
    'candidate_cvs_enforce_single_primary',
    'check_linkedin_action_quota',
    'check_rate_limit',
    'cleanup_linkedin_action_log',
    'cleanup_old_webhook_events',
    'cleanup_rate_limit_log',
    'deduct_ai_credits',
    'delete_email',
    'enforce_role_hierarchy',
    'enqueue_email',
    'get_org_integration',
    'get_portal_token',           -- legacy, remplacée par get_portal_by_token
    'get_vivier_candidates',      -- appelée uniquement via adminClient (agent-tools)
    'handle_new_organization',
    'handle_new_user',
    'increment_enrichment_quota',
    'invoke_process_email_queue',
    'invoke_process_enrichment_queue',
    'invoke_process_inmail_queue',
    'invoke_process_scheduled_actions',
    'invoke_process_sequences',
    'invoke_refresh_pedigree_by_funding_stage',
    'invoke_resolve_pedigree_directory',
    'move_to_dlq',
    'prevent_last_owner_demotion',
    'prevent_last_owner_removal',
    'prevent_linkedin_account_cross_tenant',
    'read_email_batch',
    'record_cron_heartbeat',
    'record_webhook_event',
    'refresh_project_shortlist_stats',
    'release_sequence_lock',
    'retrieve_context',
    'retrieve_context_multi',
    'retrieve_context_org',
    'sync_credit_balance_from_subscription',
    'trigger_auto_ingest_context',
    'validate_active_org'
  ];
  -- Appelées par le frontend authentifié (page Prospection / vivier) :
  -- on retire seulement anon. ⚠️ Suivi : ces fonctions ne vérifient pas
  -- l'org de l'appelant en interne (voir addendum audit) — un garde
  -- org_type='agency' doit être ajouté dans une migration dédiée.
  revoke_anon_only text[] := ARRAY[
    'get_vivier_contacts',
    'get_vivier_companies'
  ];
BEGIN
  FOREACH fn IN ARRAY revoke_both LOOP
    FOR rec IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', rec.sig);
    END LOOP;
  END LOOP;

  FOREACH fn IN ARRAY revoke_anon_only LOOP
    FOR rec IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', rec.sig);
    END LOOP;
  END LOOP;
END $$;

-- 3. Surface client intentionnelle — re-GRANT explicites (documentation
--    + robustesse au rejeu après le changement de default privileges).
DO $$
DECLARE
  fn text;
  rec record;
  -- Helpers référencés dans les policies RLS : le rôle qui exécute la
  -- requête doit avoir EXECUTE dessus (certaines policies n'ont pas de
  -- clause TO et s'évaluent donc aussi pour anon). Surface minime :
  -- booléens / uuid d'org, auth.uid() est NULL pour anon.
  grant_both text[] := ARRAY[
    'has_role',
    'is_org_member',
    'get_org_role',
    'get_user_org_id',
    'is_mission_team_member',
    'is_mission_team_member_for_candidate',
    'is_mission_team_member_for_project',
    -- Token-scoped by design (pixel de tracking email, portail candidat) :
    'get_email_tracking_by_id',
    'get_portal_by_token'
  ];
  grant_authenticated text[] := ARRAY[
    'get_vivier_contacts',
    'get_vivier_companies'
  ];
BEGIN
  FOREACH fn IN ARRAY grant_both LOOP
    FOR rec IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', rec.sig);
    END LOOP;
  END LOOP;

  FOREACH fn IN ARRAY grant_authenticated LOOP
    FOR rec IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', rec.sig);
    END LOOP;
  END LOOP;
END $$;
