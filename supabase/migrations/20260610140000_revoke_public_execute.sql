-- ====================================================================
-- SECURITY HARDENING (complément de 20260610120000) : REVOKE PUBLIC
--
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut à la création de toute
-- fonction. La migration 20260610120000 a révoqué les grants directs
-- anon/authenticated, mais le grant implicite PUBLIC restait → les
-- advisors flaggaient encore 46/52 fonctions (vérifié post-deploy
-- 2026-06-10). Les 6 disparues (enqueue_email, read_email_batch,
-- delete_email, move_to_dlq, record_*) avaient un REVOKE FROM PUBLIC
-- explicite dans leurs migrations d'origine — preuve du mécanisme.
--
-- Fix : REVOKE EXECUTE FROM PUBLIC sur les 52 fonctions flaggées.
-- Sans effet fonctionnel sur la surface client intentionnelle : les
-- helpers RLS et fonctions token-scoped gardent leurs grants EXPLICITES
-- anon/authenticated (re-grantés en 20260610120000), get_vivier_* garde
-- authenticated, service_role garde ses grants explicites partout.
-- Les triggers et crons ne vérifient pas l'EXECUTE de l'appelant.
--
-- + default privileges : les futures fonctions ne recevront plus le
-- grant PUBLIC implicite.
--
-- Idempotente, rejouable.
-- ====================================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  fn text;
  rec record;
  flagged text[] := ARRAY[
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
    'get_email_tracking_by_id',
    'get_org_integration',
    'get_org_role',
    'get_portal_token',
    'get_user_org_id',
    'get_vivier_candidates',
    'get_vivier_companies',
    'get_vivier_contacts',
    'handle_new_organization',
    'handle_new_user',
    'has_role',
    'increment_enrichment_quota',
    'invoke_process_email_queue',
    'invoke_process_enrichment_queue',
    'invoke_process_inmail_queue',
    'invoke_process_scheduled_actions',
    'invoke_process_sequences',
    'invoke_refresh_pedigree_by_funding_stage',
    'invoke_resolve_pedigree_directory',
    'is_mission_team_member',
    'is_mission_team_member_for_candidate',
    'is_mission_team_member_for_project',
    'is_org_member',
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
BEGIN
  FOREACH fn IN ARRAY flagged LOOP
    FOR rec IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', rec.sig);
    END LOOP;
  END LOOP;
END $$;
