-- =============================================================================
-- MIGRATION_CLEAN.sql — Skalr / Konekt backend schema
-- Target:    Fresh Supabase project (konekt-production)
-- Generated: 2026-04-21 from src/integrations/supabase/types.ts
--            (source of truth — NOT from the 173 conflicting migrations)
--
-- Run this once in the Supabase SQL Editor. It is idempotent:
--   - CREATE EXTENSION IF NOT EXISTS
--   - CREATE TYPE via DO block (no error if exists)
--   - CREATE TABLE IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION (always replaces)
--   - DROP TRIGGER IF EXISTS + CREATE TRIGGER
--   - DROP POLICY IF EXISTS + CREATE POLICY
--
-- Sections:
--   1. Extensions
--   2. Enums (app_role)
--   3. Tables (87, topologically ordered)
--   4. Helper functions (is_org_member, get_user_org_id, has_role, ...)
--   5. Business functions (credits, sequences, vivier, portals, ...)
--   6. Triggers
--   7. Row Level Security policies
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;            -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;              -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS unaccent;            -- text normalization
CREATE EXTENSION IF NOT EXISTS pg_trgm;             -- trigram similarity
CREATE EXTENSION IF NOT EXISTS pg_cron;             -- scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;  -- HTTP from SQL
CREATE EXTENSION IF NOT EXISTS pgmq;                -- message queues (email infra)
-- Note: supabase_vault is managed by the Supabase platform, not created here.


-- =============================================================================
-- 2. ENUMS
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- 3. TABLES
-- =============================================================================

-- Tables (87 total, alphabetical)

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_permissions JSONB,
  ai_model_default TEXT,
  annual_hires TEXT,
  careers_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  discovery_source TEXT,
  freelance_mode TEXT,
  logo_url TEXT,
  name TEXT NOT NULL,
  org_type TEXT,
  slug TEXT NOT NULL,
  specializations TEXT[],
  team_size TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  website TEXT
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  avg_time_to_fill_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name TEXT,
  experience_classifications JSONB,
  first_round_rate NUMERIC,
  intro_video_url TEXT,
  job_title TEXT,
  linkedin_skills TEXT[],
  linkedin_url TEXT,
  mid_round_rate NUMERIC,
  placements_count INTEGER,
  public_slug TEXT,
  rating NUMERIC,
  recruiter_bio TEXT,
  recruiter_headline TEXT,
  specializations TEXT[],
  testimonials JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  years_experience INTEGER
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  role app_role NOT NULL DEFAULT 'user',
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  currency TEXT NOT NULL DEFAULT 'EUR',
  description TEXT,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  name TEXT NOT NULL,
  price_monthly NUMERIC NOT NULL DEFAULT 0,
  price_yearly NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT
);

CREATE TABLE IF NOT EXISTS public.connector_registry (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'general',
  config_schema JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  icon_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.prospection_icps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  name TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'candidate',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sourcing_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_link TEXT,
  client_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  description TEXT,
  filters_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  hunt_bounty_percent NUMERIC,
  hunt_deadline TIMESTAMPTZ,
  hunt_max_recruiters INTEGER,
  hunt_mode BOOLEAN,
  hunt_status TEXT,
  icp_id UUID REFERENCES public.prospection_icps(id) ON DELETE SET NULL,
  job_details JSONB,
  job_id TEXT,
  job_title TEXT,
  last_search_at TIMESTAMPTZ,
  name TEXT NOT NULL,
  notes TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  stats_dismissed INTEGER NOT NULL DEFAULT 0,
  stats_messaged INTEGER NOT NULL DEFAULT 0,
  stats_scored INTEGER NOT NULL DEFAULT 0,
  stats_shortlisted INTEGER NOT NULL DEFAULT 0,
  stats_total_found INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator',
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sequence_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  steps_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  multi_sender_enabled BOOLEAN,
  name TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  rotation_mode TEXT,
  sender_accounts JSONB,
  stop_conditions JSONB,
  stop_on_company_reply BOOLEAN,
  template_id UUID REFERENCES public.sequence_templates(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  ai_personalization_prompt TEXT,
  ai_personalization_source TEXT,
  ai_tone TEXT,
  bcc_emails TEXT[],
  branch TEXT,
  cc_emails TEXT[],
  condition_type TEXT,
  condition_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delay_days INTEGER NOT NULL DEFAULT 0,
  delay_hours INTEGER NOT NULL DEFAULT 0,
  delay_minutes INTEGER,
  if_false_goto_step UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  if_true_goto_step UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  include_unsubscribe BOOLEAN,
  message_template TEXT,
  next_step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  preferred_hour_end INTEGER,
  preferred_hour_start INTEGER,
  sender_id UUID,
  sequence_id UUID NOT NULL REFERENCES public.outreach_sequences(id) ON DELETE CASCADE,
  signature_id UUID,
  step_channel TEXT,
  step_order INTEGER NOT NULL,
  subject_template TEXT,
  timeout_branch_step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  timeout_days INTEGER,
  use_ai_personalization BOOLEAN NOT NULL DEFAULT false,
  variant_group TEXT,
  variant_weight NUMERIC,
  wait_for_event TEXT
);

CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  assigned_sender_id UUID,
  company_name TEXT,
  completed_at TIMESTAMPTZ,
  connection_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  current_step_order INTEGER NOT NULL DEFAULT 0,
  email_used TEXT,
  job_id TEXT,
  job_title TEXT,
  label TEXT,
  last_check_at TIMESTAMPTZ,
  network_distance TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_used TEXT,
  profile_headline TEXT,
  profile_id TEXT NOT NULL,
  profile_name TEXT,
  profile_url TEXT,
  provider_id TEXT,
  replied_at TIMESTAMPTZ,
  resolved_profile_id TEXT,
  sequence_id UUID NOT NULL REFERENCES public.outreach_sequences(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_timezone TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS public.sequence_step_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_snippet TEXT,
  channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrollment_id UUID NOT NULL REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE,
  error_message TEXT,
  executed_at TIMESTAMPTZ,
  final_message TEXT,
  final_subject TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  personalized_subject TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL,
  skip_reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  step_id UUID NOT NULL REFERENCES public.sequence_steps(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  tracking_data JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  variant_assigned TEXT
);

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  background_image_url TEXT NOT NULL,
  created_by UUID NOT NULL DEFAULT gen_random_uuid(),
  creator TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  target_date TEXT NOT NULL,
  time TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  job_id TEXT,
  job_title TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  results_summary JSONB,
  search_config JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  credits_total INTEGER NOT NULL DEFAULT 0,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_end TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_credits INTEGER NOT NULL DEFAULT 0,
  topup_credits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  credits_used INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  metadata JSONB,
  model_id TEXT,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'usage',
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.aircall_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aircall_id BIGINT NOT NULL,
  answered_at TIMESTAMPTZ,
  callee_name TEXT,
  callee_number TEXT,
  caller_name TEXT,
  caller_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction TEXT NOT NULL,
  duration INTEGER,
  ended_at TIMESTAMPTZ,
  matched_airtable_candidate_id TEXT,
  matched_candidate_name TEXT,
  matched_candidate_phone TEXT,
  matched_linkedin_profile_id TEXT,
  notes TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  raw_number TEXT,
  recording_url TEXT,
  started_at TIMESTAMPTZ,
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tags TEXT[],
  user_email TEXT,
  user_name TEXT,
  voicemail_url TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  appointment_date TIMESTAMPTZ,
  appointment_type TEXT,
  candidate_airtable_id TEXT,
  contact_airtable_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_airtable_id TEXT,
  notes TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  shortlist_airtable_id TEXT,
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  education_level TEXT,
  email TEXT,
  experience TEXT,
  first_name TEXT,
  full_name TEXT,
  last_name TEXT,
  linkedin_url TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone TEXT,
  preferred_contract TEXT,
  raw_data JSONB,
  skills TEXT[],
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.airtable_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  benefits TEXT,
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  headcount TEXT,
  name TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  source_base TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tech_stack TEXT[],
  year_founded TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  city TEXT,
  company_airtable_id TEXT,
  contact_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT,
  full_name TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_glossary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  source_base TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  term TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  city TEXT,
  company_airtable_id TEXT,
  contract_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  criteria TEXT,
  description TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  salary TEXT,
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_kpi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  period TEXT,
  raw_data JSONB,
  source_base TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  value TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  author TEXT,
  candidate_airtable_id TEXT,
  contact_airtable_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail TEXT,
  job_airtable_id TEXT,
  note_date TIMESTAMPTZ,
  note_type TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  shortlist_airtable_id TEXT,
  source_base TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.airtable_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  candidate_airtable_id TEXT,
  company_airtable_id TEXT,
  contract_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fees TEXT,
  name TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  salary TEXT,
  source_base TEXT NOT NULL DEFAULT '',
  start_date TIMESTAMPTZ,
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.airtable_shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  candidate_airtable_id TEXT,
  company_airtable_id TEXT,
  contact_airtable_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  date_added TIMESTAMPTZ,
  estimated_fees TEXT,
  job_airtable_id TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  salary_proposed TEXT,
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.airtable_shortlists_cumulated (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  candidate_airtable_id TEXT,
  company_airtable_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_shortlist_date TIMESTAMPTZ,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  source_base TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_shortlists INTEGER
);

CREATE TABLE IF NOT EXISTS public.airtable_sync_meta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  records_count INTEGER,
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  table_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.airtable_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT NOT NULL,
  assignee TEXT,
  candidate_airtable_id TEXT,
  contact_airtable_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  due_date TIMESTAMPTZ,
  job_airtable_id TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_data JSONB,
  shortlist_airtable_id TEXT,
  source_base TEXT NOT NULL DEFAULT '',
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_type TEXT,
  title TEXT
);

CREATE TABLE IF NOT EXISTS public.call_coaching_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alerts_log JSONB,
  candidate_id TEXT NOT NULL,
  coach_feed JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID NOT NULL,
  criteria_detected JSONB,
  duration_seconds INTEGER,
  job_id TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  report JSONB,
  scorecard_id TEXT NOT NULL,
  status TEXT,
  transcript TEXT
);

CREATE TABLE IF NOT EXISTS public.candidate_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_by UUID,
  assigned_to UUID NOT NULL,
  assignment_method TEXT NOT NULL DEFAULT 'manual',
  candidate_id TEXT NOT NULL,
  candidate_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  job_id TEXT,
  mentions TEXT[],
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  candidate_id TEXT NOT NULL,
  comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_notes TEXT,
  interview_stage TEXT,
  job_id TEXT,
  job_title TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  overall_score NUMERIC,
  ratings JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation TEXT,
  summary TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  shortlist_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  candidate_name TEXT,
  company_description TEXT,
  company_logo_url TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  documents JSONB,
  estimated_days_to_next INTEGER,
  expires_at TIMESTAMPTZ,
  faq JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  job_id TEXT,
  job_title TEXT,
  next_steps TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_stage TEXT,
  recruiter_email TEXT,
  recruiter_name TEXT,
  recruiter_phone TEXT,
  stage_updated_at TIMESTAMPTZ,
  token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  embedding VECTOR(1536),
  headline TEXT,
  name TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  skills TEXT[],
  summary TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  candidate_name TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  job_id TEXT,
  job_title TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  shortlist_id TEXT,
  title TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.career_page_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  careers_url TEXT NOT NULL,
  new_roles_count INTEGER,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roles_found JSONB,
  scanned_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  category TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_email TEXT,
  client_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  permissions JSONB,
  project_ids TEXT[],
  token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.connector_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config JSONB,
  connector_id TEXT NOT NULL REFERENCES public.connector_registry(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,
  last_sync_at TIMESTAMPTZ,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.credit_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  credits INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pack_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_session_id TEXT,
  user_id UUID
);

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,
  message_id TEXT,
  metadata JSONB,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL,
  template_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.email_send_state (
  id INTEGER PRIMARY KEY,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 0,
  retry_after_until TIMESTAMPTZ,
  send_delay_ms INTEGER NOT NULL DEFAULT 0,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  is_default BOOLEAN,
  name TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.enrichment_cache (
  cache_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.feature_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist JSONB,
  contract_document_url TEXT,
  contract_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  feature TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_method_added BOOLEAN,
  status TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  validated_at TIMESTAMPTZ,
  validated_by UUID
);

CREATE TABLE IF NOT EXISTS public.hunt_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  invited_by UUID,
  match_score NUMERIC,
  message TEXT,
  project_id UUID NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  recruiter_org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  recruiter_user_id UUID NOT NULL,
  status TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inmail_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  error_message TEXT,
  message TEXT NOT NULL,
  network_distance INTEGER,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_headline TEXT,
  recipient_name TEXT,
  recipient_profile_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  subject TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_timezone TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS public.internal_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id TEXT NOT NULL,
  job_title TEXT,
  member_id UUID NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.job_candidate_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_headline TEXT,
  candidate_id TEXT NOT NULL,
  candidate_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  job_id TEXT NOT NULL,
  linkedin_profile_data JSONB,
  linkedin_profile_url TEXT,
  notion_candidate_id TEXT,
  notion_shortlist_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_stage TEXT,
  project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  recommendation TEXT,
  score NUMERIC,
  scoring_details JSONB,
  skip_reason TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  tags TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id TEXT NOT NULL,
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.job_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  embedding VECTOR(1536),
  job_id TEXT NOT NULL,
  requirements TEXT,
  skills TEXT[],
  title TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_skills_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id TEXT NOT NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding VECTOR(1536),
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  metadata JSONB,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_connector_id TEXT,
  source_id TEXT,
  source_table TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.match_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  job_id TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL DEFAULT 0,
  scoring_result JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.member_email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_status TEXT,
  email_account_id TEXT NOT NULL,
  email_address TEXT,
  linked_at TIMESTAMPTZ DEFAULT now(),
  linked_by UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT,
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.member_linkedin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by UUID NOT NULL,
  linkedin_account_id TEXT NOT NULL,
  linkedin_account_name TEXT,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  proxy_country TEXT,
  proxy_host TEXT,
  proxy_is_active BOOLEAN,
  proxy_last_error TEXT,
  proxy_mode TEXT,
  proxy_port INTEGER,
  proxy_protocol TEXT,
  proxy_updated_at TIMESTAMPTZ,
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.member_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_inmails_per_day INTEGER,
  max_messages_per_day INTEGER,
  max_profile_visits_per_day INTEGER,
  max_searches_per_day INTEGER,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.message_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  chat_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mission_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  invited_by UUID NOT NULL,
  message TEXT,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator',
  status TEXT,
  token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.mission_process_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  description TEXT,
  duration_minutes INTEGER,
  evaluation_criteria JSONB,
  interviewer_name TEXT,
  interviewer_type TEXT,
  interviewer_user_id UUID,
  is_eliminatory BOOLEAN,
  name TEXT NOT NULL,
  objectives TEXT[],
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  template_source TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mission_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  permissions JSONB,
  project_id UUID NOT NULL REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  link TEXT,
  metadata JSONB,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.notion_api_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nurturing_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_context JSONB,
  candidate_headline TEXT,
  candidate_id TEXT NOT NULL,
  candidate_name TEXT,
  candidate_profile_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  days_since_contact INTEGER,
  detected_intent TEXT,
  expires_at TIMESTAMPTZ,
  job_id TEXT,
  job_title TEXT,
  last_message_at TIMESTAMPTZ,
  linkedin_account_id TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  priority_score NUMERIC NOT NULL DEFAULT 0,
  reviewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  suggested_action TEXT NOT NULL,
  suggested_message TEXT,
  suggested_subject TEXT,
  trigger_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aircall_api_id TEXT,
  aircall_api_token TEXT,
  aircall_connected BOOLEAN NOT NULL DEFAULT false,
  airtable_api_key TEXT,
  airtable_base_id TEXT,
  airtable_base_id_2 TEXT,
  airtable_connected BOOLEAN NOT NULL DEFAULT false,
  anthropic_api_key TEXT,
  apollo_api_key TEXT,
  calendly_api_key TEXT,
  calendly_connected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notion_api_key TEXT,
  notion_candidats_db_id TEXT,
  notion_connected BOOLEAN NOT NULL DEFAULT false,
  notion_postes_db_id TEXT,
  notion_shortlist_db_id TEXT,
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  pdl_api_key TEXT,
  unipile_api_key TEXT,
  unipile_connected BOOLEAN NOT NULL DEFAULT false,
  unipile_dsn TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator',
  status TEXT NOT NULL DEFAULT 'pending',
  token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.process_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  description TEXT,
  is_default BOOLEAN,
  job_category TEXT,
  name TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.qualification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_event_id TEXT,
  calendly_invitee_id TEXT,
  candidate_headline TEXT,
  candidate_linkedin_url TEXT,
  candidate_name TEXT,
  candidate_profile_id TEXT,
  client_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  event_end_at TIMESTAMPTZ,
  event_location TEXT,
  event_name TEXT,
  event_start_at TIMESTAMPTZ,
  invitee_email TEXT,
  job_criteria JSONB,
  job_id TEXT,
  job_title TEXT,
  notes TEXT,
  notion_candidate_id TEXT,
  notion_shortlist_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  scoring_summary JSONB,
  status TEXT NOT NULL DEFAULT 'scheduled',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verdict TEXT,
  verdict_at TIMESTAMPTZ,
  verdict_by UUID,
  verdict_notes TEXT
);

CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS public.round_robin_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  last_assigned_at TIMESTAMPTZ,
  last_assigned_user_id UUID,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.saved_filter_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  description TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_id TEXT,
  job_title TEXT,
  last_used_at TIMESTAMPTZ,
  name TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  usage_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  dismissed_count INTEGER NOT NULL DEFAULT 0,
  filters_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_id TEXT NOT NULL,
  job_title TEXT,
  messaged_count INTEGER NOT NULL DEFAULT 0,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.sourcing_projects(id) ON DELETE CASCADE,
  results_count INTEGER NOT NULL DEFAULT 0,
  search_api TEXT,
  shortlisted_count INTEGER NOT NULL DEFAULT 0,
  treated_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sequence_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  date TIMESTAMPTZ NOT NULL,
  emails_clicked INTEGER,
  emails_opened INTEGER,
  emails_sent INTEGER,
  invites_accepted INTEGER,
  invites_sent INTEGER,
  messages_sent INTEGER,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_visits INTEGER,
  replies_received INTEGER,
  sequence_id UUID REFERENCES public.outreach_sequences(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.sequence_email_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  email_message_id TEXT,
  execution_id UUID NOT NULL REFERENCES public.sequence_step_executions(id) ON DELETE CASCADE,
  tracking_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sequence_processing_lock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT
);

CREATE TABLE IF NOT EXISTS public.sequence_snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  metadata JSONB,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.vivier_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_data JSONB,
  company_change_detail TEXT,
  contact_airtable_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  current_company TEXT,
  current_job_title TEXT,
  enriched_at TIMESTAMPTZ,
  generated_message TEXT,
  headline TEXT,
  is_relevant BOOLEAN,
  linkedin_url TEXT,
  location TEXT,
  match_type TEXT,
  message_status TEXT,
  message_type TEXT,
  notable_events JSONB,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  relevance_reason TEXT,
  still_same_company BOOLEAN,
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- =============================================================================
-- 4. HELPER & 5. BUSINESS FUNCTIONS
-- Extracted from supabase/migrations (latest-wins deduplication)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- update_updated_at_column — generic BEFORE UPDATE trigger fn
-- Source: 20251020114939
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- -----------------------------------------------------------------------------
-- handle_new_user — auth.users INSERT → creates profile
-- Source: 20251029164531
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  RETURN new;
END;
$$;

-- -----------------------------------------------------------------------------
-- has_role — role-based access control check
-- Source: 20251022111522
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- -----------------------------------------------------------------------------
-- is_org_member — check if a user belongs to an organization
-- Source: 20260306140155
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

-- -----------------------------------------------------------------------------
-- get_org_role — get user's role in an organization
-- Source: 20260306140155
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_role(_user_id uuid, _org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.organization_members
  WHERE user_id = _user_id AND organization_id = _org_id
  LIMIT 1
$$;

-- -----------------------------------------------------------------------------
-- get_user_org_id — get user's active org id (with per-request cache)
-- Source: 20260327124918 (latest)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_cache_key text;
BEGIN
  v_cache_key := 'app.user_org.u_' || replace(_user_id::text, '-', '_');

  BEGIN
    v_org_id := current_setting(v_cache_key, true)::uuid;
    IF v_org_id IS NOT NULL THEN
      RETURN v_org_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  SELECT active_organization_id
  INTO v_org_id
  FROM public.profiles
  WHERE user_id = _user_id
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    PERFORM set_config(v_cache_key, v_org_id::text, true);
  END IF;

  RETURN v_org_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- handle_new_organization — auto-add creator as owner when org is created
-- Source: 20260306140155
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');

  UPDATE public.profiles
  SET active_organization_id = NEW.id
  WHERE user_id = NEW.created_by
    AND active_organization_id IS NULL;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- validate_active_org — prevents cross-org bypass by setting active org
-- Source: 20260324145941
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_active_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND NEW.active_organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE user_id = NEW.user_id
        AND organization_id = NEW.active_organization_id
    ) THEN
      NEW.active_organization_id := (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = NEW.user_id
        LIMIT 1
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- enforce_role_hierarchy — only owners can assign owner role
-- Source: 20260324145941
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_role_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  caller_role := public.get_org_role(auth.uid(), NEW.organization_id);

  IF NEW.role = 'owner' AND caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can assign the owner role';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- prevent_last_owner_removal — block DELETE of last org owner
-- Source: 20260324145941
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = OLD.organization_id
        AND role = 'owner'
        AND id != OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot remove the last owner of an organization';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

-- -----------------------------------------------------------------------------
-- prevent_last_owner_demotion — block demotion of last org owner
-- Source: 20260324145941
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_last_owner_demotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' AND NEW.role != 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = OLD.organization_id
        AND role = 'owner'
        AND id != OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot demote the last owner of an organization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- auto_create_free_subscription — create free subscription when org created
-- Source: 20260313001000
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_create_free_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_subscriptions (organization_id, plan_id, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- sync_credit_balance_from_subscription — sync AI credits from plan
-- Source: 20260313001458
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_credit_balance_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits integer;
BEGIN
  SELECT COALESCE((limits->>'ai_credits')::integer, 100)
  INTO v_credits
  FROM subscription_plans
  WHERE id = NEW.plan_id;

  IF v_credits = -1 THEN
    v_credits := 999999;
  END IF;

  INSERT INTO ai_credit_balances (organization_id, credits_remaining, credits_total, period_start, period_end)
  VALUES (
    NEW.organization_id,
    v_credits,
    v_credits,
    date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month'
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    credits_remaining = EXCLUDED.credits_remaining,
    credits_total = EXCLUDED.credits_total,
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- deduct_ai_credits — atomic credit deduction with auto period reset
-- Source: 20260313001458
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_ai_credits(
  p_organization_id uuid,
  p_user_id uuid,
  p_amount integer,
  p_action text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining integer;
  v_period_end timestamptz;
BEGIN
  SELECT credits_remaining, period_end
  INTO v_remaining, v_period_end
  FROM ai_credit_balances
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_balance', 'message', 'Aucun solde de crédits trouvé');
  END IF;

  IF v_period_end <= now() THEN
    UPDATE ai_credit_balances
    SET credits_remaining = credits_total,
        period_start = date_trunc('month', now()),
        period_end = date_trunc('month', now()) + interval '1 month',
        updated_at = now()
    WHERE organization_id = p_organization_id
    RETURNING credits_remaining INTO v_remaining;
  END IF;

  IF v_remaining < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'remaining', v_remaining,
      'required', p_amount,
      'message', 'Crédits IA insuffisants'
    );
  END IF;

  UPDATE ai_credit_balances
  SET credits_remaining = credits_remaining - p_amount,
      updated_at = now()
  WHERE organization_id = p_organization_id;

  v_remaining := v_remaining - p_amount;

  INSERT INTO ai_credit_transactions (organization_id, user_id, amount, balance_after, action, description)
  VALUES (p_organization_id, p_user_id, -p_amount, v_remaining, p_action, p_description);

  RETURN jsonb_build_object('success', true, 'remaining', v_remaining);
END;
$$;

-- -----------------------------------------------------------------------------
-- check_rate_limit — per-user rate limiter
-- Source: 20260313002353
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_requests integer,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM rate_limit_log
  WHERE user_id = p_user_id
    AND action = p_action
    AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF v_count >= p_max_requests THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END;
$$;

-- -----------------------------------------------------------------------------
-- cleanup_rate_limit_log — drop rate-limit entries older than 24h
-- Source: 20260313002353
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM rate_limit_log WHERE created_at < now() - interval '24 hours';
$$;

-- -----------------------------------------------------------------------------
-- get_portal_token — read a non-expired candidate portal token (by token value)
-- Source: 20260313002307
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_portal_token(p_token text)
RETURNS SETOF public.candidate_portal_tokens
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.candidate_portal_tokens
  WHERE token = p_token
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- get_org_integration — per-org integration creds (returns single row)
-- Source: 20260306142336
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_integration(p_org_id uuid)
RETURNS public.organization_integrations
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.organization_integrations
  WHERE organization_id = p_org_id
  LIMIT 1
$$;

-- -----------------------------------------------------------------------------
-- cosine_similarity_match — pgvector similarity between candidate/job
-- Source: 20260302174017
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cosine_similarity_match(
  p_candidate_id text,
  p_job_id text
)
RETURNS float AS $$
  SELECT 1 - (c.embedding <=> j.embedding)
  FROM candidate_profiles c, job_profiles j
  WHERE c.candidate_id = p_candidate_id
  AND j.job_id = p_job_id
  AND c.embedding IS NOT NULL
  AND j.embedding IS NOT NULL
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------------------------
-- retrieve_context — single-entity knowledge retrieval via pgvector
-- Source: 20260324000705
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retrieve_context(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_query_embedding vector(1536),
  p_chunk_types text[] DEFAULT NULL,
  p_limit int DEFAULT 15
) RETURNS TABLE(
  id uuid, chunk_type text, content text, metadata jsonb, similarity float
) AS $$
  SELECT kc.id, kc.chunk_type, kc.content, kc.metadata,
         1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.organization_id = p_org_id
    AND kc.entity_type = p_entity_type
    AND kc.entity_id = p_entity_id
    AND kc.embedding IS NOT NULL
    AND (p_chunk_types IS NULL OR kc.chunk_type = ANY(p_chunk_types))
    AND (kc.expires_at IS NULL OR kc.expires_at > now())
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- -----------------------------------------------------------------------------
-- retrieve_context_multi — multi-entity knowledge retrieval via pgvector
-- Source: 20260324000705
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retrieve_context_multi(
  p_org_id uuid,
  p_entity_ids text[],
  p_query_embedding vector(1536),
  p_chunk_types text[] DEFAULT NULL,
  p_limit int DEFAULT 15
) RETURNS TABLE(
  id uuid, chunk_type text, content text, metadata jsonb, similarity float
) AS $$
  SELECT kc.id, kc.chunk_type, kc.content, kc.metadata,
         1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.organization_id = p_org_id
    AND kc.entity_id = ANY(p_entity_ids)
    AND kc.embedding IS NOT NULL
    AND (p_chunk_types IS NULL OR kc.chunk_type = ANY(p_chunk_types))
    AND (kc.expires_at IS NULL OR kc.expires_at > now())
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- -----------------------------------------------------------------------------
-- acquire_sequence_lock — atomic lock for sequence processor (with TTL)
-- Source: 20260227181053 (latest)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_sequence_lock(p_run_id text, p_ttl_minutes integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row_count integer := 0;
BEGIN
  UPDATE sequence_processing_lock
  SET locked_at = now(),
      locked_by = p_run_id
  WHERE id = 'process'
    AND (
      locked_at IS NULL
      OR locked_at < now() - (p_ttl_minutes || ' minutes')::interval
    );

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

-- -----------------------------------------------------------------------------
-- release_sequence_lock — release sequence processor lock
-- Source: 20260227170859
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_sequence_lock(p_run_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE sequence_processing_lock
  SET locked_at = NULL,
      locked_by = NULL
  WHERE id = 'process'
    AND locked_by = p_run_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- invoke_process_sequences — cron-invoked wrapper for process-sequences EF
-- Source: 20260401042432
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_process_sequences(p_action text, p_force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT value INTO v_secret FROM internal_config WHERE key = 'process_sequences_secret';
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE WARNING 'Missing internal_config for process_sequences';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/process-sequences',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := json_build_object('action', p_action, 'force', p_force)::jsonb
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- atomic_tracking_append — race-safe append to email tracking_data
-- Source: 20260402072522 (latest)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atomic_tracking_append(
  p_execution_id uuid,
  p_field text,
  p_value text,
  p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE sequence_step_executions
  SET
    tracking_data = jsonb_set(
      COALESCE(tracking_data, '{}'::jsonb),
      ARRAY[p_field],
      (COALESCE(tracking_data->p_field, '[]'::jsonb) || to_jsonb(p_value))
    ),
    status = p_new_status
  WHERE id = p_execution_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- archive_old_agent_conversations — cleanup old completed agent convos
-- Source: 20260312145933
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_old_agent_conversations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
BEGIN
  UPDATE public.agent_conversations
  SET archived_at = now()
  WHERE status IN ('completed', 'error')
    AND updated_at < now() - interval '30 days'
    AND archived_at IS NULL;

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  DELETE FROM public.agent_messages
  WHERE conversation_id IN (
    SELECT id FROM public.agent_conversations
    WHERE archived_at IS NOT NULL
      AND archived_at < now() - interval '60 days'
  );

  DELETE FROM public.agent_conversations
  WHERE archived_at IS NOT NULL
    AND archived_at < now() - interval '60 days';

  RETURN archived_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- is_mission_team_member — check mission_team by (user_id, project_id)
-- Source: 20260326183825 and 20260410000000 (identical)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_mission_team_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mission_team
    WHERE user_id = _user_id AND project_id = _project_id
  )
$$;

-- -----------------------------------------------------------------------------
-- is_mission_team_member_for_project — same check for tables with project_id
-- Source: 20260326183825
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_mission_team_member_for_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mission_team
    WHERE user_id = _user_id AND project_id = _project_id
  )
$$;

-- -----------------------------------------------------------------------------
-- is_mission_team_member_for_candidate — check mission_team via candidate_id
-- Source: 20260410000000
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_mission_team_member_for_candidate(_user_id uuid, _candidate_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_candidate_status jcs
    JOIN public.mission_team mt ON mt.project_id = jcs.project_id
    WHERE jcs.candidate_id = _candidate_id
      AND mt.user_id = _user_id
  );
$$;

-- -----------------------------------------------------------------------------
-- get_email_tracking_by_id — SECURITY DEFINER tracking pixel lookup
-- Source: 20260410000000
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_email_tracking_by_id(p_tracking_id text)
RETURNS TABLE (
  id uuid,
  execution_id uuid,
  tracking_id text,
  email_message_id text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT t.id, t.execution_id, t.tracking_id, t.email_message_id, t.created_at
  FROM public.sequence_email_tracking t
  WHERE t.tracking_id = p_tracking_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_tracking_by_id(text) TO anon, authenticated;

-- Removed: invalidate_match_scores_on_job_update — references public.jobs table
-- which does not exist in the current schema (jobs are external Notion/Airtable IDs).

-- -----------------------------------------------------------------------------
-- trigger_auto_ingest_context — fires auto-ingest-context edge function
-- Source: 20260319053948
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_auto_ingest_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_url text;
  v_anon_key text;
  v_payload jsonb;
BEGIN
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';
  SELECT value INTO v_anon_key FROM internal_config WHERE key = 'supabase_anon_key';

  IF v_url IS NULL OR v_anon_key IS NULL THEN
    RAISE WARNING 'Missing internal_config for auto-ingest-context';
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', to_jsonb(NEW),
    'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
  );

  PERFORM net.http_post(
    url := v_url || '/auto-ingest-context',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := v_payload
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- -----------------------------------------------------------------------------
-- pgmq wrappers: enqueue_email / read_email_batch / delete_email / move_to_dlq
-- Source: 20260324110915_email_infra
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- get_vivier_candidates — vivier candidate list with stats
-- Source: 20260310161838
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vivier_candidates(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_skill text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_has_notes boolean DEFAULT NULL,
  p_has_appointments boolean DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  airtable_id text,
  full_name text,
  email text,
  phone text,
  linkedin_url text,
  status text,
  skills text[],
  source_base text,
  experience text,
  education_level text,
  shortlist_count bigint,
  note_count bigint,
  appointment_count bigint,
  placement_count bigint,
  last_interaction_date timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH candidate_stats AS (
    SELECT
      c.airtable_id,
      c.full_name,
      c.email,
      c.phone,
      c.linkedin_url,
      c.status,
      c.skills,
      c.source_base,
      c.experience,
      c.education_level,
      COALESCE(s.cnt, 0) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(p.cnt, 0) AS placement_count,
      GREATEST(s.last_date, n.last_date, a.last_date, p.last_date) AS last_interaction_date
    FROM airtable_candidates c
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_shortlists
      GROUP BY candidate_airtable_id
    ) s ON s.candidate_airtable_id = c.airtable_id
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_notes
      GROUP BY candidate_airtable_id
    ) n ON n.candidate_airtable_id = c.airtable_id
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_appointments
      GROUP BY candidate_airtable_id
    ) a ON a.candidate_airtable_id = c.airtable_id
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_placements
      GROUP BY candidate_airtable_id
    ) p ON p.candidate_airtable_id = c.airtable_id
    WHERE COALESCE(s.cnt, 0) >= p_min_shortlists
      AND (COALESCE(n.cnt, 0) > 0 OR COALESCE(a.cnt, 0) > 0)
      AND (p_source_base IS NULL OR c.source_base = p_source_base)
      AND (p_skill IS NULL OR p_skill = ANY(c.skills))
      AND (p_has_notes IS NULL OR (p_has_notes = true AND COALESCE(n.cnt, 0) > 0) OR (p_has_notes = false))
      AND (p_has_appointments IS NULL OR (p_has_appointments = true AND COALESCE(a.cnt, 0) > 0) OR (p_has_appointments = false))
      AND (p_search IS NULL OR c.full_name ILIKE '%' || p_search || '%' OR c.email ILIKE '%' || p_search || '%' OR c.phone ILIKE '%' || p_search || '%')
  )
  SELECT
    cs.airtable_id,
    cs.full_name,
    cs.email,
    cs.phone,
    cs.linkedin_url,
    cs.status,
    cs.skills,
    cs.source_base,
    cs.experience,
    cs.education_level,
    cs.shortlist_count,
    cs.note_count,
    cs.appointment_count,
    cs.placement_count,
    cs.last_interaction_date,
    COUNT(*) OVER() AS total_count
  FROM candidate_stats cs
  ORDER BY cs.last_interaction_date DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- -----------------------------------------------------------------------------
-- get_vivier_contacts — vivier contact list with stats (latest signature)
-- Source: 20260409140625
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vivier_contacts(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_contact_type text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_has_placements boolean DEFAULT NULL,
  p_sort_by text DEFAULT 'recent',
  p_has_email boolean DEFAULT NULL,
  p_has_notes boolean DEFAULT NULL,
  p_has_appointments boolean DEFAULT NULL,
  p_last_interaction_days integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_min_notes integer DEFAULT 0,
  p_min_appointments integer DEFAULT 0,
  p_min_placements integer DEFAULT 0,
  p_company_name text DEFAULT NULL
)
RETURNS TABLE(
  airtable_id text,
  full_name text,
  email text,
  title text,
  contact_type text,
  city text,
  status text,
  source_base text,
  company_airtable_id text,
  company_name text,
  shortlist_count bigint,
  note_count bigint,
  appointment_count bigint,
  placement_count bigint,
  last_interaction_date text,
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH contact_stats AS (
    SELECT
      c.airtable_id,
      c.full_name,
      c.email,
      c.title,
      c.contact_type,
      c.city,
      c.status,
      c.source_base,
      c.company_airtable_id,
      comp.name AS company_name,
      COALESCE(sl.cnt, 0) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(pl.cnt, 0) AS placement_count,
      GREATEST(sl.last_date, n.last_date, a.last_date) AS last_interaction_date,
      cand.phone AS candidate_phone
    FROM airtable_contacts c
    LEFT JOIN airtable_companies comp ON comp.airtable_id = c.company_airtable_id AND comp.source_base = c.source_base
    LEFT JOIN (
      SELECT contact_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(date_added) AS last_date
      FROM airtable_shortlists WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, source_base
    ) sl ON sl.contact_airtable_id = c.airtable_id AND sl.sb = c.source_base
    LEFT JOIN (
      SELECT contact_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(note_date) AS last_date
      FROM airtable_notes WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, source_base
    ) n ON n.contact_airtable_id = c.airtable_id AND n.sb = c.source_base
    LEFT JOIN (
      SELECT contact_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(appointment_date) AS last_date
      FROM airtable_appointments WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, source_base
    ) a ON a.contact_airtable_id = c.airtable_id AND a.sb = c.source_base
    LEFT JOIN (
      SELECT s.contact_airtable_id, s.source_base AS sb, COUNT(*) AS cnt
      FROM airtable_shortlists s
      JOIN airtable_placements p ON p.candidate_airtable_id = s.candidate_airtable_id AND p.source_base = s.source_base
      WHERE s.contact_airtable_id IS NOT NULL
      GROUP BY s.contact_airtable_id, s.source_base
    ) pl ON pl.contact_airtable_id = c.airtable_id AND pl.sb = c.source_base
    LEFT JOIN airtable_candidates cand ON cand.airtable_id = c.airtable_id AND cand.source_base = c.source_base
    WHERE
      (p_source_base IS NULL OR c.source_base = p_source_base)
      AND (p_contact_type IS NULL OR c.contact_type = p_contact_type)
      AND (p_search IS NULL OR c.full_name ILIKE '%' || p_search || '%' OR c.email ILIKE '%' || p_search || '%' OR c.title ILIKE '%' || p_search || '%')
      AND (p_city IS NULL OR c.city ILIKE '%' || p_city || '%')
      AND (p_has_email IS NULL OR (p_has_email = true AND c.email IS NOT NULL AND c.email <> '') OR (p_has_email = false AND (c.email IS NULL OR c.email = '')))
      AND (p_status IS NULL OR c.status = p_status)
      AND (p_title IS NULL OR c.title ILIKE '%' || p_title || '%')
      AND (p_company_name IS NULL OR comp.name ILIKE '%' || p_company_name || '%')
  )
  SELECT
    cs.airtable_id,
    cs.full_name,
    cs.email,
    cs.title,
    cs.contact_type,
    cs.city,
    cs.status,
    cs.source_base,
    cs.company_airtable_id,
    cs.company_name,
    cs.shortlist_count,
    cs.note_count,
    cs.appointment_count,
    cs.placement_count,
    cs.last_interaction_date::text,
    COUNT(*) OVER() AS total_count
  FROM contact_stats cs
  WHERE
    cs.shortlist_count >= p_min_shortlists
    AND (p_has_placements IS NULL OR (p_has_placements = true AND cs.placement_count > 0) OR (p_has_placements = false AND cs.placement_count = 0))
    AND (p_has_notes IS NULL OR (p_has_notes = true AND cs.note_count > 0) OR (p_has_notes = false AND cs.note_count = 0))
    AND (p_has_appointments IS NULL OR (p_has_appointments = true AND cs.appointment_count > 0) OR (p_has_appointments = false AND cs.appointment_count = 0))
    AND (p_last_interaction_days IS NULL OR cs.last_interaction_date >= (CURRENT_DATE - p_last_interaction_days * INTERVAL '1 day')::text)
    AND (p_has_phone IS NULL OR (p_has_phone = true AND cs.candidate_phone IS NOT NULL AND cs.candidate_phone <> '') OR (p_has_phone = false AND (cs.candidate_phone IS NULL OR cs.candidate_phone = '')))
    AND cs.note_count >= p_min_notes
    AND cs.appointment_count >= p_min_appointments
    AND cs.placement_count >= p_min_placements
  ORDER BY
    CASE WHEN p_sort_by = 'recent' THEN cs.last_interaction_date END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'shortlists' THEN cs.shortlist_count END DESC,
    CASE WHEN p_sort_by = 'placements' THEN cs.placement_count END DESC,
    CASE WHEN p_sort_by = 'name' THEN cs.full_name END ASC,
    cs.shortlist_count DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- -----------------------------------------------------------------------------
-- get_vivier_companies — vivier company list with stats (latest signature)
-- Source: 20260409140625
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vivier_companies(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_has_placements boolean DEFAULT NULL,
  p_sort_by text DEFAULT 'recent',
  p_has_notes boolean DEFAULT NULL,
  p_last_interaction_days integer DEFAULT NULL,
  p_min_contacts integer DEFAULT 0,
  p_headcount text DEFAULT NULL,
  p_min_notes integer DEFAULT 0,
  p_min_appointments integer DEFAULT 0,
  p_min_placements integer DEFAULT 0,
  p_has_appointments boolean DEFAULT NULL
)
RETURNS TABLE(
  company_airtable_id text,
  company_name text,
  city text,
  headcount text,
  description text,
  source_base text,
  contact_count bigint,
  shortlist_count bigint,
  placement_count bigint,
  note_count bigint,
  appointment_count bigint,
  last_interaction_date text,
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH company_stats AS (
    SELECT
      co.airtable_id AS company_airtable_id,
      co.name AS company_name,
      co.city,
      co.headcount,
      co.description,
      co.source_base,
      COALESCE(ct.cnt, 0) AS contact_count,
      COALESCE(sl.cnt, 0) AS shortlist_count,
      COALESCE(pl.cnt, 0) AS placement_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      GREATEST(sl.last_date, n.last_date, a.last_date) AS last_interaction_date
    FROM airtable_companies co
    LEFT JOIN (
      SELECT company_airtable_id, source_base AS sb, COUNT(*) AS cnt
      FROM airtable_contacts WHERE company_airtable_id IS NOT NULL
      GROUP BY company_airtable_id, source_base
    ) ct ON ct.company_airtable_id = co.airtable_id AND ct.sb = co.source_base
    LEFT JOIN (
      SELECT company_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(date_added) AS last_date
      FROM airtable_shortlists WHERE company_airtable_id IS NOT NULL
      GROUP BY company_airtable_id, source_base
    ) sl ON sl.company_airtable_id = co.airtable_id AND sl.sb = co.source_base
    LEFT JOIN (
      SELECT s.company_airtable_id, s.source_base AS sb, COUNT(DISTINCT p.airtable_id) AS cnt
      FROM airtable_shortlists s
      JOIN airtable_placements p ON p.company_airtable_id = s.company_airtable_id AND p.source_base = s.source_base
      WHERE s.company_airtable_id IS NOT NULL
      GROUP BY s.company_airtable_id, s.source_base
    ) pl ON pl.company_airtable_id = co.airtable_id AND pl.sb = co.source_base
    LEFT JOIN (
      SELECT j.company_airtable_id, j.source_base AS sb, COUNT(n2.id) AS cnt, MAX(n2.note_date) AS last_date
      FROM airtable_jobs j
      JOIN airtable_notes n2 ON n2.job_airtable_id = j.airtable_id AND n2.source_base = j.source_base
      WHERE j.company_airtable_id IS NOT NULL
      GROUP BY j.company_airtable_id, j.source_base
    ) n ON n.company_airtable_id = co.airtable_id AND n.sb = co.source_base
    LEFT JOIN (
      SELECT j.company_airtable_id, j.source_base AS sb, COUNT(a2.id) AS cnt, MAX(a2.appointment_date) AS last_date
      FROM airtable_jobs j
      JOIN airtable_appointments a2 ON a2.job_airtable_id = j.airtable_id AND a2.source_base = j.source_base
      WHERE j.company_airtable_id IS NOT NULL
      GROUP BY j.company_airtable_id, j.source_base
    ) a ON a.company_airtable_id = co.airtable_id AND a.sb = co.source_base
    WHERE
      (p_source_base IS NULL OR co.source_base = p_source_base)
      AND (p_search IS NULL OR co.name ILIKE '%' || p_search || '%' OR co.city ILIKE '%' || p_search || '%' OR co.description ILIKE '%' || p_search || '%')
      AND (p_city IS NULL OR co.city ILIKE '%' || p_city || '%')
      AND (p_headcount IS NULL OR co.headcount = p_headcount)
  )
  SELECT
    cs.company_airtable_id,
    cs.company_name,
    cs.city,
    cs.headcount,
    cs.description,
    cs.source_base,
    cs.contact_count,
    cs.shortlist_count,
    cs.placement_count,
    cs.note_count,
    cs.appointment_count,
    cs.last_interaction_date::text,
    COUNT(*) OVER() AS total_count
  FROM company_stats cs
  WHERE
    cs.shortlist_count >= p_min_shortlists
    AND cs.contact_count >= p_min_contacts
    AND (p_has_placements IS NULL OR (p_has_placements = true AND cs.placement_count > 0) OR (p_has_placements = false AND cs.placement_count = 0))
    AND (p_has_notes IS NULL OR (p_has_notes = true AND cs.note_count > 0) OR (p_has_notes = false AND cs.note_count = 0))
    AND (p_has_appointments IS NULL OR (p_has_appointments = true AND cs.appointment_count > 0) OR (p_has_appointments = false AND cs.appointment_count = 0))
    AND (p_last_interaction_days IS NULL OR cs.last_interaction_date >= (CURRENT_DATE - p_last_interaction_days * INTERVAL '1 day')::text)
    AND cs.note_count >= p_min_notes
    AND cs.appointment_count >= p_min_appointments
    AND cs.placement_count >= p_min_placements
  ORDER BY
    CASE WHEN p_sort_by = 'recent' THEN cs.last_interaction_date END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'shortlists' THEN cs.shortlist_count END DESC,
    CASE WHEN p_sort_by = 'placements' THEN cs.placement_count END DESC,
    CASE WHEN p_sort_by = 'contacts' THEN cs.contact_count END DESC,
    CASE WHEN p_sort_by = 'name' THEN cs.company_name END ASC,
    cs.shortlist_count DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- =============================================================================
-- 6. TRIGGERS (idempotent: DROP TRIGGER IF EXISTS before CREATE)
-- =============================================================================

-- update_events_updated_at (public.events)
DROP TRIGGER IF EXISTS update_events_updated_at ON public.events;
CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- on_auth_user_created (auth.users)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- update_profiles_updated_at (public.profiles)
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_job_skills_cache_updated_at (public.job_skills_cache)
DROP TRIGGER IF EXISTS update_job_skills_cache_updated_at ON public.job_skills_cache;
CREATE TRIGGER update_job_skills_cache_updated_at
  BEFORE UPDATE ON public.job_skills_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_inmail_queue_updated_at (public.inmail_queue)
DROP TRIGGER IF EXISTS update_inmail_queue_updated_at ON public.inmail_queue;
CREATE TRIGGER update_inmail_queue_updated_at
  BEFORE UPDATE ON public.inmail_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_outreach_sequences_updated_at (public.outreach_sequences)
DROP TRIGGER IF EXISTS update_outreach_sequences_updated_at ON public.outreach_sequences;
CREATE TRIGGER update_outreach_sequences_updated_at
  BEFORE UPDATE ON public.outreach_sequences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_sequence_enrollments_updated_at (public.sequence_enrollments)
DROP TRIGGER IF EXISTS update_sequence_enrollments_updated_at ON public.sequence_enrollments;
CREATE TRIGGER update_sequence_enrollments_updated_at
  BEFORE UPDATE ON public.sequence_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_sequence_step_executions_updated_at (public.sequence_step_executions)
DROP TRIGGER IF EXISTS update_sequence_step_executions_updated_at ON public.sequence_step_executions;
CREATE TRIGGER update_sequence_step_executions_updated_at
  BEFORE UPDATE ON public.sequence_step_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_candidate_notes_updated_at (public.candidate_notes)
DROP TRIGGER IF EXISTS update_candidate_notes_updated_at ON public.candidate_notes;
CREATE TRIGGER update_candidate_notes_updated_at
  BEFORE UPDATE ON public.candidate_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_candidate_reminders_updated_at (public.candidate_reminders)
DROP TRIGGER IF EXISTS update_candidate_reminders_updated_at ON public.candidate_reminders;
CREATE TRIGGER update_candidate_reminders_updated_at
  BEFORE UPDATE ON public.candidate_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_nurturing_opportunities_updated_at (public.nurturing_opportunities)
DROP TRIGGER IF EXISTS update_nurturing_opportunities_updated_at ON public.nurturing_opportunities;
CREATE TRIGGER update_nurturing_opportunities_updated_at
  BEFORE UPDATE ON public.nurturing_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_job_candidate_status_updated_at (public.job_candidate_status)
DROP TRIGGER IF EXISTS update_job_candidate_status_updated_at ON public.job_candidate_status;
CREATE TRIGGER update_job_candidate_status_updated_at
  BEFORE UPDATE ON public.job_candidate_status
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_saved_filter_presets_updated_at (public.saved_filter_presets)
DROP TRIGGER IF EXISTS update_saved_filter_presets_updated_at ON public.saved_filter_presets;
CREATE TRIGGER update_saved_filter_presets_updated_at
  BEFORE UPDATE ON public.saved_filter_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_sourcing_projects_updated_at (public.sourcing_projects)
DROP TRIGGER IF EXISTS update_sourcing_projects_updated_at ON public.sourcing_projects;
CREATE TRIGGER update_sourcing_projects_updated_at
  BEFORE UPDATE ON public.sourcing_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_search_history_updated_at (public.search_history)
DROP TRIGGER IF EXISTS update_search_history_updated_at ON public.search_history;
CREATE TRIGGER update_search_history_updated_at
  BEFORE UPDATE ON public.search_history
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_message_analysis_cache_updated_at (public.message_analysis_cache)
DROP TRIGGER IF EXISTS update_message_analysis_cache_updated_at ON public.message_analysis_cache;
CREATE TRIGGER update_message_analysis_cache_updated_at
  BEFORE UPDATE ON public.message_analysis_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_qualification_sessions_updated_at (public.qualification_sessions)
DROP TRIGGER IF EXISTS update_qualification_sessions_updated_at ON public.qualification_sessions;
CREATE TRIGGER update_qualification_sessions_updated_at
  BEFORE UPDATE ON public.qualification_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- on_organization_created (public.organizations)
DROP TRIGGER IF EXISTS on_organization_created ON public.organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_organization();

-- update_organizations_updated_at (public.organizations)
DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_org_integrations_updated_at (public.organization_integrations)
DROP TRIGGER IF EXISTS update_org_integrations_updated_at ON public.organization_integrations;
CREATE TRIGGER update_org_integrations_updated_at
  BEFORE UPDATE ON public.organization_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- update_agent_conversations_updated_at (public.agent_conversations)
DROP TRIGGER IF EXISTS update_agent_conversations_updated_at ON public.agent_conversations;
CREATE TRIGGER update_agent_conversations_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- on_organization_created_subscription (public.organizations)
DROP TRIGGER IF EXISTS on_organization_created_subscription ON public.organizations;
CREATE TRIGGER on_organization_created_subscription
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_free_subscription();

-- on_subscription_sync_credits (public.organization_subscriptions)
DROP TRIGGER IF EXISTS on_subscription_sync_credits ON public.organization_subscriptions;
CREATE TRIGGER on_subscription_sync_credits
  AFTER INSERT OR UPDATE OF plan_id ON public.organization_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_credit_balance_from_subscription();

-- set_updated_at_knowledge_chunks (public.knowledge_chunks)
DROP TRIGGER IF EXISTS set_updated_at_knowledge_chunks ON public.knowledge_chunks;
CREATE TRIGGER set_updated_at_knowledge_chunks
  BEFORE UPDATE ON public.knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- trg_auto_ingest_job_candidate_status (public.job_candidate_status)
DROP TRIGGER IF EXISTS trg_auto_ingest_job_candidate_status ON public.job_candidate_status;
CREATE TRIGGER trg_auto_ingest_job_candidate_status
  AFTER INSERT OR UPDATE ON public.job_candidate_status
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

-- trg_auto_ingest_candidate_notes (public.candidate_notes)
DROP TRIGGER IF EXISTS trg_auto_ingest_candidate_notes ON public.candidate_notes;
CREATE TRIGGER trg_auto_ingest_candidate_notes
  AFTER INSERT OR UPDATE ON public.candidate_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

-- trg_auto_ingest_candidate_comments (public.candidate_comments)
DROP TRIGGER IF EXISTS trg_auto_ingest_candidate_comments ON public.candidate_comments;
CREATE TRIGGER trg_auto_ingest_candidate_comments
  AFTER INSERT OR UPDATE ON public.candidate_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

-- trg_auto_ingest_coaching_sessions (public.call_coaching_sessions)
DROP TRIGGER IF EXISTS trg_auto_ingest_coaching_sessions ON public.call_coaching_sessions;
CREATE TRIGGER trg_auto_ingest_coaching_sessions
  AFTER INSERT OR UPDATE ON public.call_coaching_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

-- trg_auto_ingest_candidate_evaluations (public.candidate_evaluations)
DROP TRIGGER IF EXISTS trg_auto_ingest_candidate_evaluations ON public.candidate_evaluations;
CREATE TRIGGER trg_auto_ingest_candidate_evaluations
  AFTER INSERT OR UPDATE ON public.candidate_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_ingest_context();

-- validate_active_org_trigger (public.profiles)
DROP TRIGGER IF EXISTS validate_active_org_trigger ON public.profiles;
CREATE TRIGGER validate_active_org_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_active_org();

-- enforce_role_insert (public.organization_members)
DROP TRIGGER IF EXISTS enforce_role_insert ON public.organization_members;
CREATE TRIGGER enforce_role_insert
  BEFORE INSERT ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_hierarchy();

-- enforce_role_update (public.organization_members)
DROP TRIGGER IF EXISTS enforce_role_update ON public.organization_members;
CREATE TRIGGER enforce_role_update
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_hierarchy();

-- prevent_last_owner (public.organization_members)
DROP TRIGGER IF EXISTS prevent_last_owner ON public.organization_members;
CREATE TRIGGER prevent_last_owner
  BEFORE DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_owner_removal();

-- prevent_last_owner_demotion (public.organization_members)
DROP TRIGGER IF EXISTS prevent_last_owner_demotion ON public.organization_members;
CREATE TRIGGER prevent_last_owner_demotion
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_owner_demotion();


-- =============================================================================
-- 7. ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- ============================================================================
-- Canonical RLS Policy Set for Skalr (Konekt)
-- ============================================================================
-- Patterns used:
--  * org-scoped          : organization_id = get_user_org_id(auth.uid())
--  * user-scoped         : user_id = auth.uid() (or id/created_by)
--  * public-read         : USING (true) — anonymous read allowed
--  * admin-only          : has_role(auth.uid(), 'admin') or org owner/admin role
--  * service-role-only   : auth.role() = 'service_role'
-- Helper functions assumed: get_user_org_id, is_org_member, get_org_role,
--                           has_role, is_mission_team_member_for_project,
--                           is_mission_team_member_for_candidate
-- ============================================================================


-- agent_conversations — org-scoped (with created_by for INSERT)
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_select" ON public.agent_conversations;
DROP POLICY IF EXISTS "org_members_insert" ON public.agent_conversations;
DROP POLICY IF EXISTS "org_members_update" ON public.agent_conversations;
CREATE POLICY "org_members_select" ON public.agent_conversations
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "org_members_insert" ON public.agent_conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "org_members_update" ON public.agent_conversations
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));


-- agent_messages — indirect org-scope via parent conversation
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_select" ON public.agent_messages;
DROP POLICY IF EXISTS "org_members_insert" ON public.agent_messages;
CREATE POLICY "org_members_select" ON public.agent_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
      AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));
CREATE POLICY "org_members_insert" ON public.agent_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
      AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));


-- ai_credit_balances — org-scoped read, service-role write
ALTER TABLE public.ai_credit_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.ai_credit_balances;
DROP POLICY IF EXISTS "service_role_all" ON public.ai_credit_balances;
CREATE POLICY "org_members_read" ON public.ai_credit_balances
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.ai_credit_balances
  FOR ALL
  USING (auth.role() = 'service_role');


-- ai_credit_transactions — org-scoped read, service-role write
ALTER TABLE public.ai_credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.ai_credit_transactions;
DROP POLICY IF EXISTS "service_role_all" ON public.ai_credit_transactions;
CREATE POLICY "org_members_read" ON public.ai_credit_transactions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.ai_credit_transactions
  FOR ALL
  USING (auth.role() = 'service_role');


-- aircall_calls — org-scoped + service-role (webhooks)
ALTER TABLE public.aircall_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.aircall_calls;
DROP POLICY IF EXISTS "service_role_all" ON public.aircall_calls;
CREATE POLICY "org_members_all" ON public.aircall_calls
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.aircall_calls
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_appointments — org-scoped read, service-role write (Airtable sync)
ALTER TABLE public.airtable_appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_appointments;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_appointments;
CREATE POLICY "org_members_read" ON public.airtable_appointments
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_appointments
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_candidates — org-scoped read, service-role write
ALTER TABLE public.airtable_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_candidates;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_candidates;
CREATE POLICY "org_members_read" ON public.airtable_candidates
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_candidates
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_companies — org-scoped read, service-role write
ALTER TABLE public.airtable_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_companies;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_companies;
CREATE POLICY "org_members_read" ON public.airtable_companies
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_companies
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_contacts — org-scoped read, service-role write
ALTER TABLE public.airtable_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_contacts;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_contacts;
CREATE POLICY "org_members_read" ON public.airtable_contacts
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_contacts
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_glossary — org-scoped read, service-role write
ALTER TABLE public.airtable_glossary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_glossary;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_glossary;
CREATE POLICY "org_members_read" ON public.airtable_glossary
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_glossary
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_jobs — org-scoped read, service-role write
ALTER TABLE public.airtable_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_jobs;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_jobs;
CREATE POLICY "org_members_read" ON public.airtable_jobs
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_jobs
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_kpi — org-scoped read, service-role write
ALTER TABLE public.airtable_kpi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_kpi;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_kpi;
CREATE POLICY "org_members_read" ON public.airtable_kpi
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_kpi
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_notes — org-scoped read, service-role write
ALTER TABLE public.airtable_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_notes;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_notes;
CREATE POLICY "org_members_read" ON public.airtable_notes
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_notes
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_placements — org-scoped read, service-role write
ALTER TABLE public.airtable_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_placements;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_placements;
CREATE POLICY "org_members_read" ON public.airtable_placements
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_placements
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_shortlists — org-scoped read, service-role write
ALTER TABLE public.airtable_shortlists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_shortlists;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_shortlists;
CREATE POLICY "org_members_read" ON public.airtable_shortlists
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_shortlists
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_shortlists_cumulated — org-scoped read, service-role write
ALTER TABLE public.airtable_shortlists_cumulated ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_shortlists_cumulated;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_shortlists_cumulated;
CREATE POLICY "org_members_read" ON public.airtable_shortlists_cumulated
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_shortlists_cumulated
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_sync_meta — service-role only (admin/operator metadata, no org link)
-- NOTE: original migration also added an optional organization_id column, but
-- the table is manipulated only by the Airtable sync edge function.
ALTER TABLE public.airtable_sync_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_sync_meta;
DROP POLICY IF EXISTS "authenticated_read" ON public.airtable_sync_meta;
CREATE POLICY "authenticated_read" ON public.airtable_sync_meta
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "service_role_all" ON public.airtable_sync_meta
  FOR ALL
  USING (auth.role() = 'service_role');


-- airtable_tasks — org-scoped read, service-role write
ALTER TABLE public.airtable_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.airtable_tasks;
DROP POLICY IF EXISTS "service_role_all" ON public.airtable_tasks;
CREATE POLICY "org_members_read" ON public.airtable_tasks
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.airtable_tasks
  FOR ALL
  USING (auth.role() = 'service_role');


-- call_coaching_sessions — org-scoped
ALTER TABLE public.call_coaching_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.call_coaching_sessions;
CREATE POLICY "org_members_all" ON public.call_coaching_sessions
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- candidate_assignments — org-scoped SELECT/INSERT + admins can fully manage
ALTER TABLE public.candidate_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_select" ON public.candidate_assignments;
DROP POLICY IF EXISTS "org_members_insert" ON public.candidate_assignments;
DROP POLICY IF EXISTS "admins_manage" ON public.candidate_assignments;
DROP POLICY IF EXISTS "service_role_all" ON public.candidate_assignments;
CREATE POLICY "org_members_select" ON public.candidate_assignments
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "org_members_insert" ON public.candidate_assignments
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "admins_manage" ON public.candidate_assignments
  FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "service_role_all" ON public.candidate_assignments
  FOR ALL
  USING (auth.role() = 'service_role');


-- candidate_comments — org-scoped + author-owned UPDATE/DELETE
ALTER TABLE public.candidate_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_select" ON public.candidate_comments;
DROP POLICY IF EXISTS "org_members_insert" ON public.candidate_comments;
DROP POLICY IF EXISTS "authors_update" ON public.candidate_comments;
DROP POLICY IF EXISTS "authors_delete" ON public.candidate_comments;
DROP POLICY IF EXISTS "service_role_all" ON public.candidate_comments;
CREATE POLICY "org_members_select" ON public.candidate_comments
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "org_members_insert" ON public.candidate_comments
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "authors_update" ON public.candidate_comments
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid());
CREATE POLICY "authors_delete" ON public.candidate_comments
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());
CREATE POLICY "service_role_all" ON public.candidate_comments
  FOR ALL
  USING (auth.role() = 'service_role');


-- candidate_evaluations — org-scoped + freelance mission_team via candidate_id
ALTER TABLE public.candidate_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "mission_team_select" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "mission_team_insert" ON public.candidate_evaluations;
DROP POLICY IF EXISTS "mission_team_update" ON public.candidate_evaluations;
CREATE POLICY "org_members_all" ON public.candidate_evaluations
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "mission_team_select" ON public.candidate_evaluations
  FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));
CREATE POLICY "mission_team_insert" ON public.candidate_evaluations
  FOR INSERT
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));
CREATE POLICY "mission_team_update" ON public.candidate_evaluations
  FOR UPDATE
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));


-- candidate_notes — org-scoped + freelance mission_team via candidate_id
ALTER TABLE public.candidate_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.candidate_notes;
DROP POLICY IF EXISTS "mission_team_select" ON public.candidate_notes;
DROP POLICY IF EXISTS "mission_team_insert" ON public.candidate_notes;
CREATE POLICY "org_members_all" ON public.candidate_notes
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "mission_team_select" ON public.candidate_notes
  FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));
CREATE POLICY "mission_team_insert" ON public.candidate_notes
  FOR INSERT
  WITH CHECK (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));


-- candidate_portal_tokens — org-scoped write; anonymous read via SECURITY DEFINER RPC (get_portal_by_token)
-- No anon-SELECT policy: candidate-facing portal queries go through the RPC with service_role.
ALTER TABLE public.candidate_portal_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.candidate_portal_tokens;
DROP POLICY IF EXISTS "service_role_all" ON public.candidate_portal_tokens;
CREATE POLICY "org_members_all" ON public.candidate_portal_tokens
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.candidate_portal_tokens
  FOR ALL
  USING (auth.role() = 'service_role');


-- candidate_profiles — org-scoped + freelance mission_team via candidate_id + service_role
ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.candidate_profiles;
DROP POLICY IF EXISTS "mission_team_select" ON public.candidate_profiles;
DROP POLICY IF EXISTS "service_role_all" ON public.candidate_profiles;
CREATE POLICY "org_members_all" ON public.candidate_profiles
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "mission_team_select" ON public.candidate_profiles
  FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));
CREATE POLICY "service_role_all" ON public.candidate_profiles
  FOR ALL
  USING (auth.role() = 'service_role');


-- candidate_reminders — org-scoped
ALTER TABLE public.candidate_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.candidate_reminders;
CREATE POLICY "org_members_all" ON public.candidate_reminders
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- career_page_scans — org-scoped read, service-role write (scan runs in edge function)
ALTER TABLE public.career_page_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.career_page_scans;
DROP POLICY IF EXISTS "service_role_all" ON public.career_page_scans;
CREATE POLICY "org_members_read" ON public.career_page_scans
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.career_page_scans
  FOR ALL
  USING (auth.role() = 'service_role');


-- chat_categories — org-scoped
ALTER TABLE public.chat_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.chat_categories;
CREATE POLICY "org_members_all" ON public.chat_categories
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- client_portal_tokens — org-scoped only; client-facing access via edge function client-portal-data (service_role)
ALTER TABLE public.client_portal_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.client_portal_tokens;
DROP POLICY IF EXISTS "service_role_all" ON public.client_portal_tokens;
CREATE POLICY "org_members_all" ON public.client_portal_tokens
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.client_portal_tokens
  FOR ALL
  USING (auth.role() = 'service_role');


-- connector_instances — org admin/owner manages, service-role for sync
ALTER TABLE public.connector_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_admins_all" ON public.connector_instances;
DROP POLICY IF EXISTS "service_role_all" ON public.connector_instances;
CREATE POLICY "org_admins_all" ON public.connector_instances
  FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "service_role_all" ON public.connector_instances
  FOR ALL
  USING (auth.role() = 'service_role');


-- connector_registry — public read of active connectors, service-role writes
ALTER TABLE public.connector_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.connector_registry;
DROP POLICY IF EXISTS "service_role_all" ON public.connector_registry;
CREATE POLICY "authenticated_read" ON public.connector_registry
  FOR SELECT TO authenticated
  USING (is_active = true);
CREATE POLICY "service_role_all" ON public.connector_registry
  FOR ALL
  USING (auth.role() = 'service_role');


-- contact_submissions — anon INSERT (public form), admin read
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert" ON public.contact_submissions;
DROP POLICY IF EXISTS "admin_read" ON public.contact_submissions;
CREATE POLICY "anon_insert" ON public.contact_submissions
  FOR INSERT
  WITH CHECK (true);
CREATE POLICY "admin_read" ON public.contact_submissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));


-- credit_purchases — org-scoped read, service-role write (Stripe webhook)
ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.credit_purchases;
DROP POLICY IF EXISTS "service_role_all" ON public.credit_purchases;
CREATE POLICY "org_members_read" ON public.credit_purchases
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.credit_purchases
  FOR ALL
  USING (auth.role() = 'service_role');


-- email_send_log — service-role only (audit trail for email queue)
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.email_send_log;
CREATE POLICY "service_role_all" ON public.email_send_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- email_send_state — service-role only (single-row config)
ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.email_send_state;
CREATE POLICY "service_role_all" ON public.email_send_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- email_signatures — org-scoped + service-role
ALTER TABLE public.email_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.email_signatures;
DROP POLICY IF EXISTS "service_role_all" ON public.email_signatures;
CREATE POLICY "org_members_all" ON public.email_signatures
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.email_signatures
  FOR ALL
  USING (auth.role() = 'service_role');


-- email_unsubscribe_tokens — service-role only (token lookup via edge function)
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.email_unsubscribe_tokens;
CREATE POLICY "service_role_all" ON public.email_unsubscribe_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- enrichment_cache — service-role only (shared cache, no org column)
ALTER TABLE public.enrichment_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.enrichment_cache;
CREATE POLICY "service_role_all" ON public.enrichment_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- event_registrations — user-scoped (user_id = auth.uid()) + event creator can view
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_rows_select" ON public.event_registrations;
DROP POLICY IF EXISTS "own_rows_insert" ON public.event_registrations;
DROP POLICY IF EXISTS "own_rows_delete" ON public.event_registrations;
DROP POLICY IF EXISTS "creators_select" ON public.event_registrations;
CREATE POLICY "own_rows_select" ON public.event_registrations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own_rows_insert" ON public.event_registrations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_rows_delete" ON public.event_registrations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "creators_select" ON public.event_registrations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id AND e.created_by = auth.uid()
  ));


-- events — creators manage their own, admins full access (template-derived, not org-scoped)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_rows_select" ON public.events;
DROP POLICY IF EXISTS "own_rows_insert" ON public.events;
DROP POLICY IF EXISTS "own_rows_update" ON public.events;
DROP POLICY IF EXISTS "own_rows_delete" ON public.events;
DROP POLICY IF EXISTS "admin_select" ON public.events;
DROP POLICY IF EXISTS "admin_update" ON public.events;
CREATE POLICY "own_rows_select" ON public.events
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());
CREATE POLICY "own_rows_insert" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "own_rows_update" ON public.events
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid());
CREATE POLICY "own_rows_delete" ON public.events
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());
CREATE POLICY "admin_select" ON public.events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update" ON public.events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- feature_activations — org-scoped
ALTER TABLE public.feature_activations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.feature_activations;
CREATE POLICY "org_members_all" ON public.feature_activations
  FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  ));


-- hunt_applications — recruiter-scoped (own app) or project-owning-org
ALTER TABLE public.hunt_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_or_project_org" ON public.hunt_applications;
CREATE POLICY "own_or_project_org" ON public.hunt_applications
  FOR ALL TO authenticated
  USING (
    recruiter_user_id = auth.uid()
    OR project_id IN (
      SELECT sp.id FROM public.sourcing_projects sp
      WHERE sp.organization_id IN (
        SELECT om.organization_id FROM public.organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );


-- inmail_queue — org-scoped
ALTER TABLE public.inmail_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.inmail_queue;
DROP POLICY IF EXISTS "service_role_all" ON public.inmail_queue;
CREATE POLICY "org_members_all" ON public.inmail_queue
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.inmail_queue
  FOR ALL
  USING (auth.role() = 'service_role');


-- internal_config — service-role only (RLS enabled, NO policies for regular users)
-- Accessed only via SECURITY DEFINER functions or direct SQL as postgres.
ALTER TABLE public.internal_config ENABLE ROW LEVEL SECURITY;
-- (intentionally no policies — no access for anon/authenticated)


-- job_assignments — org-scoped read, admin-managed
ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.job_assignments;
DROP POLICY IF EXISTS "admins_manage" ON public.job_assignments;
DROP POLICY IF EXISTS "service_role_all" ON public.job_assignments;
CREATE POLICY "org_members_read" ON public.job_assignments
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "admins_manage" ON public.job_assignments
  FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "service_role_all" ON public.job_assignments
  FOR ALL
  USING (auth.role() = 'service_role');


-- job_candidate_status — org-scoped + freelance mission_team via project_id
ALTER TABLE public.job_candidate_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_select" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_insert" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_update" ON public.job_candidate_status;
CREATE POLICY "org_members_all" ON public.job_candidate_status
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
-- mission_team members (freelancers) go through project_id (table has project_id column)
CREATE POLICY "mission_team_select" ON public.job_candidate_status
  FOR SELECT
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));
CREATE POLICY "mission_team_insert" ON public.job_candidate_status
  FOR INSERT
  WITH CHECK (public.is_mission_team_member_for_project(auth.uid(), project_id));
CREATE POLICY "mission_team_update" ON public.job_candidate_status
  FOR UPDATE
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));


-- job_favorites — user-scoped only (no organization_id column on this table)
ALTER TABLE public.job_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_rows_all" ON public.job_favorites;
CREATE POLICY "own_rows_all" ON public.job_favorites
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- job_profiles — authenticated read (derived/embeddings), service_role writes
-- (table has no organization_id column; job_id is an external ID)
ALTER TABLE public.job_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.job_profiles;
DROP POLICY IF EXISTS "service_role_all" ON public.job_profiles;
CREATE POLICY "authenticated_read" ON public.job_profiles
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "service_role_all" ON public.job_profiles
  FOR ALL
  USING (auth.role() = 'service_role');


-- job_skills_cache — authenticated read (derived), service_role writes
-- (table has no organization_id column; job_id is an external ID)
ALTER TABLE public.job_skills_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.job_skills_cache;
DROP POLICY IF EXISTS "service_role_all" ON public.job_skills_cache;
CREATE POLICY "authenticated_read" ON public.job_skills_cache
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "service_role_all" ON public.job_skills_cache
  FOR ALL
  USING (auth.role() = 'service_role');


-- knowledge_chunks — org-scoped (RAG vector store)
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.knowledge_chunks;
CREATE POLICY "org_members_all" ON public.knowledge_chunks
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));


-- match_scores — org-scoped + freelance mission_team via candidate_id
ALTER TABLE public.match_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.match_scores;
DROP POLICY IF EXISTS "mission_team_select" ON public.match_scores;
DROP POLICY IF EXISTS "service_role_all" ON public.match_scores;
CREATE POLICY "org_members_all" ON public.match_scores
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "mission_team_select" ON public.match_scores
  FOR SELECT
  USING (public.is_mission_team_member_for_candidate(auth.uid(), candidate_id));
CREATE POLICY "service_role_all" ON public.match_scores
  FOR ALL
  USING (auth.role() = 'service_role');


-- member_email_accounts — org-scoped + service_role
ALTER TABLE public.member_email_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.member_email_accounts;
DROP POLICY IF EXISTS "service_role_all" ON public.member_email_accounts;
CREATE POLICY "org_members_all" ON public.member_email_accounts
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.member_email_accounts
  FOR ALL
  USING (auth.role() = 'service_role');


-- member_linkedin_accounts — org-scoped read, admins manage, service_role
ALTER TABLE public.member_linkedin_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.member_linkedin_accounts;
DROP POLICY IF EXISTS "admins_manage" ON public.member_linkedin_accounts;
DROP POLICY IF EXISTS "service_role_all" ON public.member_linkedin_accounts;
CREATE POLICY "org_members_read" ON public.member_linkedin_accounts
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "admins_manage" ON public.member_linkedin_accounts
  FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "service_role_all" ON public.member_linkedin_accounts
  FOR ALL
  USING (auth.role() = 'service_role');


-- member_quotas — org-scoped read, admin-managed
ALTER TABLE public.member_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.member_quotas;
DROP POLICY IF EXISTS "admins_manage" ON public.member_quotas;
DROP POLICY IF EXISTS "service_role_all" ON public.member_quotas;
CREATE POLICY "org_members_read" ON public.member_quotas
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "admins_manage" ON public.member_quotas
  FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "service_role_all" ON public.member_quotas
  FOR ALL
  USING (auth.role() = 'service_role');


-- message_analysis_cache — authenticated read + account-owner UPDATE + service_role
-- Rows keyed by account_id; ownership enforced via member_linkedin_accounts join.
ALTER TABLE public.message_analysis_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.message_analysis_cache;
DROP POLICY IF EXISTS "owner_update" ON public.message_analysis_cache;
DROP POLICY IF EXISTS "service_role_all" ON public.message_analysis_cache;
CREATE POLICY "authenticated_read" ON public.message_analysis_cache
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "owner_update" ON public.message_analysis_cache
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
      AND mla.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
      AND mla.user_id = auth.uid()
  ));
CREATE POLICY "service_role_all" ON public.message_analysis_cache
  FOR ALL
  USING (auth.role() = 'service_role');


-- mission_invitations — org-scoped manage + invitee can read by email + anonymous read by token
-- Anonymous read is open (USING true) so the invitee can load the invite before login.
ALTER TABLE public.mission_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_manage" ON public.mission_invitations;
DROP POLICY IF EXISTS "public_read_by_token" ON public.mission_invitations;
DROP POLICY IF EXISTS "invitee_read" ON public.mission_invitations;
CREATE POLICY "org_members_manage" ON public.mission_invitations
  FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT om.organization_id FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  ));
CREATE POLICY "invitee_read" ON public.mission_invitations
  FOR SELECT TO authenticated
  USING (lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())));
CREATE POLICY "public_read_by_token" ON public.mission_invitations
  FOR SELECT
  USING (true);


-- mission_process_steps — org-scoped + freelance mission_team SELECT
ALTER TABLE public.mission_process_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.mission_process_steps;
DROP POLICY IF EXISTS "mission_team_select" ON public.mission_process_steps;
CREATE POLICY "org_members_all" ON public.mission_process_steps
  FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  ));
CREATE POLICY "mission_team_select" ON public.mission_process_steps
  FOR SELECT
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));


-- mission_team — members of the project's org can manage; mission_team members can read their own row
ALTER TABLE public.mission_team ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.mission_team;
DROP POLICY IF EXISTS "own_rows_select" ON public.mission_team;
CREATE POLICY "org_members_all" ON public.mission_team
  FOR ALL TO authenticated
  USING (project_id IN (
    SELECT sp.id FROM public.sourcing_projects sp
    WHERE sp.organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  ));
CREATE POLICY "own_rows_select" ON public.mission_team
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());


-- notifications — user-scoped
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_rows_select" ON public.notifications;
DROP POLICY IF EXISTS "own_rows_update" ON public.notifications;
DROP POLICY IF EXISTS "org_members_insert" ON public.notifications;
DROP POLICY IF EXISTS "service_role_all" ON public.notifications;
CREATE POLICY "own_rows_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own_rows_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "org_members_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id) OR organization_id IS NULL);
CREATE POLICY "service_role_all" ON public.notifications
  FOR ALL
  USING (auth.role() = 'service_role');


-- notion_api_cache — service-role only (shared cache, no org column)
ALTER TABLE public.notion_api_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.notion_api_cache;
CREATE POLICY "service_role_all" ON public.notion_api_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- nurturing_opportunities — org-scoped
ALTER TABLE public.nurturing_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.nurturing_opportunities;
CREATE POLICY "org_members_all" ON public.nurturing_opportunities
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- organization_integrations — org admin/owner only (stores API secrets)
ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_admins_all" ON public.organization_integrations;
DROP POLICY IF EXISTS "service_role_all" ON public.organization_integrations;
CREATE POLICY "org_admins_all" ON public.organization_integrations
  FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "service_role_all" ON public.organization_integrations
  FOR ALL
  USING (auth.role() = 'service_role');


-- organization_invitations — org admin manage + invitee read by email
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_admins_select" ON public.organization_invitations;
DROP POLICY IF EXISTS "org_admins_insert" ON public.organization_invitations;
DROP POLICY IF EXISTS "org_admins_delete" ON public.organization_invitations;
DROP POLICY IF EXISTS "invitee_read" ON public.organization_invitations;
DROP POLICY IF EXISTS "service_role_all" ON public.organization_invitations;
CREATE POLICY "org_admins_select" ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "org_admins_insert" ON public.organization_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
    AND auth.uid() = invited_by
  );
CREATE POLICY "org_admins_delete" ON public.organization_invitations
  FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "invitee_read" ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid())));
CREATE POLICY "service_role_all" ON public.organization_invitations
  FOR ALL
  USING (auth.role() = 'service_role');


-- organization_members — org-scoped read, owner/admin writes, role hierarchy enforced by trigger
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_select" ON public.organization_members;
DROP POLICY IF EXISTS "admins_insert" ON public.organization_members;
DROP POLICY IF EXISTS "owners_update" ON public.organization_members;
DROP POLICY IF EXISTS "owners_delete" ON public.organization_members;
DROP POLICY IF EXISTS "service_role_all" ON public.organization_members;
CREATE POLICY "org_members_select" ON public.organization_members
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "admins_insert" ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));
CREATE POLICY "owners_update" ON public.organization_members
  FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');
CREATE POLICY "owners_delete" ON public.organization_members
  FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');
CREATE POLICY "service_role_all" ON public.organization_members
  FOR ALL
  USING (auth.role() = 'service_role');


-- organization_subscriptions — org-scoped read, service-role write (Stripe webhook)
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_read" ON public.organization_subscriptions;
DROP POLICY IF EXISTS "service_role_insert" ON public.organization_subscriptions;
DROP POLICY IF EXISTS "service_role_update" ON public.organization_subscriptions;
CREATE POLICY "org_members_read" ON public.organization_subscriptions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_insert" ON public.organization_subscriptions
  FOR INSERT TO service_role
  WITH CHECK (true);
CREATE POLICY "service_role_update" ON public.organization_subscriptions
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);


-- organizations — members read own; authenticated can create; owners update/delete
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select" ON public.organizations;
DROP POLICY IF EXISTS "authenticated_insert" ON public.organizations;
DROP POLICY IF EXISTS "owners_update" ON public.organizations;
DROP POLICY IF EXISTS "owners_delete" ON public.organizations;
CREATE POLICY "members_select" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "authenticated_insert" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "owners_update" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), id) = 'owner');
CREATE POLICY "owners_delete" ON public.organizations
  FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), id) = 'owner');


-- outreach_sequences — org-scoped + freelance mission_team via project_id
ALTER TABLE public.outreach_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.outreach_sequences;
DROP POLICY IF EXISTS "mission_team_select" ON public.outreach_sequences;
CREATE POLICY "org_members_all" ON public.outreach_sequences
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "mission_team_select" ON public.outreach_sequences
  FOR SELECT
  USING (public.is_mission_team_member_for_project(auth.uid(), project_id));


-- process_templates — org-scoped
ALTER TABLE public.process_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.process_templates;
CREATE POLICY "org_members_all" ON public.process_templates
  FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT om.organization_id FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  ));


-- profiles — own profile write, same-org or own read, public recruiter profile read
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_or_same_org_select" ON public.profiles;
DROP POLICY IF EXISTS "public_recruiter_select" ON public.profiles;
DROP POLICY IF EXISTS "own_rows_insert" ON public.profiles;
DROP POLICY IF EXISTS "own_rows_update" ON public.profiles;
CREATE POLICY "own_or_same_org_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member(auth.uid(), active_organization_id)
  );
CREATE POLICY "public_recruiter_select" ON public.profiles
  FOR SELECT
  USING (public_slug IS NOT NULL AND recruiter_bio IS NOT NULL);
CREATE POLICY "own_rows_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_rows_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);


-- prospection_icps — org-scoped (agency-only feature)
ALTER TABLE public.prospection_icps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.prospection_icps;
CREATE POLICY "org_members_all" ON public.prospection_icps
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- qualification_sessions — org-scoped
ALTER TABLE public.qualification_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.qualification_sessions;
DROP POLICY IF EXISTS "service_role_all" ON public.qualification_sessions;
CREATE POLICY "org_members_all" ON public.qualification_sessions
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.qualification_sessions
  FOR ALL
  USING (auth.role() = 'service_role');


-- rate_limit_log — service-role only (written by check_rate_limit SECURITY DEFINER)
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.rate_limit_log;
CREATE POLICY "service_role_all" ON public.rate_limit_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- round_robin_state — org-scoped + service_role
ALTER TABLE public.round_robin_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.round_robin_state;
DROP POLICY IF EXISTS "service_role_all" ON public.round_robin_state;
CREATE POLICY "org_members_all" ON public.round_robin_state
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.round_robin_state
  FOR ALL
  USING (auth.role() = 'service_role');


-- saved_filter_presets — org-scoped
ALTER TABLE public.saved_filter_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.saved_filter_presets;
CREATE POLICY "org_members_all" ON public.saved_filter_presets
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- search_history — org-scoped
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.search_history;
CREATE POLICY "org_members_all" ON public.search_history
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));


-- sequence_analytics — org-scoped (derived from outreach_sequences)
ALTER TABLE public.sequence_analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.sequence_analytics;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_analytics;
CREATE POLICY "org_members_all" ON public.sequence_analytics
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.sequence_analytics
  FOR ALL
  USING (auth.role() = 'service_role');


-- sequence_email_tracking — service-role only; anonymous tracking pixel uses SECURITY DEFINER RPC get_email_tracking_by_id
ALTER TABLE public.sequence_email_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_email_tracking;
CREATE POLICY "service_role_all" ON public.sequence_email_tracking
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- sequence_enrollments — org-scoped + service_role
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_enrollments;
CREATE POLICY "org_members_all" ON public.sequence_enrollments
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.sequence_enrollments
  FOR ALL
  USING (auth.role() = 'service_role');


-- sequence_processing_lock — service-role only (singleton lock, no org column)
ALTER TABLE public.sequence_processing_lock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_processing_lock;
CREATE POLICY "service_role_all" ON public.sequence_processing_lock
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- sequence_snippets — org-scoped
ALTER TABLE public.sequence_snippets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.sequence_snippets;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_snippets;
CREATE POLICY "org_members_all" ON public.sequence_snippets
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.sequence_snippets
  FOR ALL
  USING (auth.role() = 'service_role');


-- sequence_step_executions — org-scoped + service_role
ALTER TABLE public.sequence_step_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.sequence_step_executions;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_step_executions;
CREATE POLICY "org_members_all" ON public.sequence_step_executions
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.sequence_step_executions
  FOR ALL
  USING (auth.role() = 'service_role');


-- sequence_steps — scoped to parent sequence (which is org-scoped)
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.sequence_steps;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_steps;
CREATE POLICY "org_members_all" ON public.sequence_steps
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.outreach_sequences s
    WHERE s.id = sequence_id
      AND s.organization_id = public.get_user_org_id(auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.outreach_sequences s
    WHERE s.id = sequence_id
      AND s.organization_id = public.get_user_org_id(auth.uid())
  ));
CREATE POLICY "service_role_all" ON public.sequence_steps
  FOR ALL
  USING (auth.role() = 'service_role');


-- sequence_templates — org-scoped + system templates readable by all authenticated
ALTER TABLE public.sequence_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_or_system_select" ON public.sequence_templates;
DROP POLICY IF EXISTS "org_members_insert" ON public.sequence_templates;
DROP POLICY IF EXISTS "org_members_update" ON public.sequence_templates;
DROP POLICY IF EXISTS "org_members_delete" ON public.sequence_templates;
DROP POLICY IF EXISTS "service_role_all" ON public.sequence_templates;
CREATE POLICY "org_or_system_select" ON public.sequence_templates
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) OR is_system = true);
CREATE POLICY "org_members_insert" ON public.sequence_templates
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "org_members_update" ON public.sequence_templates
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "org_members_delete" ON public.sequence_templates
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND is_system = false);
CREATE POLICY "service_role_all" ON public.sequence_templates
  FOR ALL
  USING (auth.role() = 'service_role');


-- sourcing_projects — org-scoped + freelance mission_team + public hunt published missions
ALTER TABLE public.sourcing_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.sourcing_projects;
DROP POLICY IF EXISTS "mission_team_select" ON public.sourcing_projects;
DROP POLICY IF EXISTS "public_hunt_select" ON public.sourcing_projects;
CREATE POLICY "org_members_all" ON public.sourcing_projects
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "mission_team_select" ON public.sourcing_projects
  FOR SELECT
  USING (public.is_mission_team_member(auth.uid(), id));
CREATE POLICY "public_hunt_select" ON public.sourcing_projects
  FOR SELECT
  USING (hunt_mode = true AND hunt_status = 'published');


-- subscription_plans — authenticated read of active plans (static config, admin-only writes via service-role)
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read" ON public.subscription_plans;
DROP POLICY IF EXISTS "service_role_all" ON public.subscription_plans;
CREATE POLICY "authenticated_read" ON public.subscription_plans
  FOR SELECT
  USING (is_active = true);
CREATE POLICY "service_role_all" ON public.subscription_plans
  FOR ALL
  USING (auth.role() = 'service_role');


-- suppressed_emails — service-role only (append-only unsub/bounce list)
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.suppressed_emails;
CREATE POLICY "service_role_all" ON public.suppressed_emails
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- user_roles — user-scoped read, admin-managed
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_rows_select" ON public.user_roles;
DROP POLICY IF EXISTS "admins_manage" ON public.user_roles;
CREATE POLICY "own_rows_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "admins_manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- vivier_enrichments — org-scoped (agency CRM feature)
ALTER TABLE public.vivier_enrichments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members_all" ON public.vivier_enrichments;
DROP POLICY IF EXISTS "service_role_all" ON public.vivier_enrichments;
CREATE POLICY "org_members_all" ON public.vivier_enrichments
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
CREATE POLICY "service_role_all" ON public.vivier_enrichments
  FOR ALL
  USING (auth.role() = 'service_role');


-- =============================================================================
-- 8. SEED DATA
-- =============================================================================
-- The auto_create_free_subscription trigger inserts into organization_subscriptions
-- with plan_id = 'free' on every new org. Without a row for 'free' here, the FK
-- constraint on organization_subscriptions.plan_id fails and org creation breaks.
-- Seed values copied from migration 20260313001000_ab0557f1-c372-4011-9096-dd18222c239f.sql
-- Idempotent via ON CONFLICT (id) DO NOTHING.
-- Prices are in cents (EUR). Limits use -1 for "unlimited".
INSERT INTO public.subscription_plans
  (id, name, description, price_monthly, price_yearly, features, limits, sort_order)
VALUES
  ('free', 'Free', 'Pour découvrir Skalr', 0, 0,
   '["3 postes actifs", "50 recherches / mois", "Scoring IA basique", "1 utilisateur"]'::jsonb,
   '{"max_jobs": 3, "max_searches": 50, "max_members": 1, "ai_credits": 100}'::jsonb,
   0),
  ('pro', 'Pro', 'Pour les recruteurs indépendants', 7900, 79000,
   '["Postes illimités", "Recherches illimitées", "Scoring IA avancé", "Séquences LinkedIn", "Inbox unifiée", "5 utilisateurs", "Support prioritaire"]'::jsonb,
   '{"max_jobs": -1, "max_searches": -1, "max_members": 5, "ai_credits": 5000}'::jsonb,
   1),
  ('enterprise', 'Enterprise', 'Pour les cabinets de recrutement', 19900, 199000,
   '["Tout Pro inclus", "Utilisateurs illimités", "Crédits IA illimités", "Intégrations ATS", "API access", "Account manager dédié", "SSO (bientôt)"]'::jsonb,
   '{"max_jobs": -1, "max_searches": -1, "max_members": -1, "ai_credits": -1}'::jsonb,
   2)
ON CONFLICT (id) DO NOTHING;
