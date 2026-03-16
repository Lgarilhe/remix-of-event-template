
-- Merge Skalr (251903d7-7ec1-43fc-85e5-1a56adfdb381) into Konekt (2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82)
-- All FK tables to organizations

UPDATE search_history SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE job_candidate_status SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE inmail_queue SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE outreach_sequences SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE sequence_steps SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE sequence_enrollments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE sequence_step_executions SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE nurturing_opportunities SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE saved_filter_presets SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE sourcing_projects SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE agent_conversations SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_profiles SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE chat_categories SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE call_coaching_sessions SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE ai_credit_transactions SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_evaluations SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_portal_tokens SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_comments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_notes SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_reminders SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE candidate_assignments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE qualification_sessions SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE match_scores SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE notifications SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE prospection_icps SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE vivier_enrichments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE job_assignments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE member_quotas SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE round_robin_state SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE member_linkedin_accounts SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';

-- Airtable tables (likely empty but handle anyway)
UPDATE airtable_companies SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_contacts SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_jobs SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_candidates SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_shortlists SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_placements SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_notes SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_appointments SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_tasks SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_shortlists_cumulated SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_glossary SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE airtable_kpi SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
UPDATE aircall_calls SET organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';

-- Delete Skalr-specific records
DELETE FROM organization_subscriptions WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
DELETE FROM organization_integrations WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
DELETE FROM ai_credit_balances WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
DELETE FROM organization_invitations WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
DELETE FROM organization_members WHERE organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';

-- Redirect profiles
UPDATE profiles SET active_organization_id = '2f3e9aa7-adb1-4a56-8ba4-f05cf6931e82' WHERE active_organization_id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';

-- Delete Skalr org
DELETE FROM organizations WHERE id = '251903d7-7ec1-43fc-85e5-1a56adfdb381';
