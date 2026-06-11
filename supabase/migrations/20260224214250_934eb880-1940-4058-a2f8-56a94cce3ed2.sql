
-- Drop constraints first (not indexes)
ALTER TABLE public.airtable_candidates DROP CONSTRAINT IF EXISTS airtable_candidates_airtable_id_key;
ALTER TABLE public.airtable_companies DROP CONSTRAINT IF EXISTS airtable_companies_airtable_id_key;
ALTER TABLE public.airtable_contacts DROP CONSTRAINT IF EXISTS airtable_contacts_airtable_id_key;
ALTER TABLE public.airtable_jobs DROP CONSTRAINT IF EXISTS airtable_jobs_airtable_id_key;
ALTER TABLE public.airtable_shortlists DROP CONSTRAINT IF EXISTS airtable_shortlists_airtable_id_key;
ALTER TABLE public.airtable_placements DROP CONSTRAINT IF EXISTS airtable_placements_airtable_id_key;
ALTER TABLE public.airtable_notes DROP CONSTRAINT IF EXISTS airtable_notes_airtable_id_key;

-- Add source_base column
ALTER TABLE public.airtable_candidates ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_companies ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_contacts ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_jobs ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_shortlists ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_placements ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_notes ADD COLUMN IF NOT EXISTS source_base text NOT NULL DEFAULT 'konekt';

-- Create composite unique constraints
ALTER TABLE public.airtable_candidates ADD CONSTRAINT airtable_candidates_airtable_id_source_key UNIQUE (airtable_id, source_base);
ALTER TABLE public.airtable_companies ADD CONSTRAINT airtable_companies_airtable_id_source_key UNIQUE (airtable_id, source_base);
ALTER TABLE public.airtable_contacts ADD CONSTRAINT airtable_contacts_airtable_id_source_key UNIQUE (airtable_id, source_base);
ALTER TABLE public.airtable_jobs ADD CONSTRAINT airtable_jobs_airtable_id_source_key UNIQUE (airtable_id, source_base);
ALTER TABLE public.airtable_shortlists ADD CONSTRAINT airtable_shortlists_airtable_id_source_key UNIQUE (airtable_id, source_base);
ALTER TABLE public.airtable_placements ADD CONSTRAINT airtable_placements_airtable_id_source_key UNIQUE (airtable_id, source_base);
ALTER TABLE public.airtable_notes ADD CONSTRAINT airtable_notes_airtable_id_source_key UNIQUE (airtable_id, source_base);

-- Rendez-vous
CREATE TABLE public.airtable_appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT NOT NULL,
  source_base TEXT NOT NULL DEFAULT 'konekt',
  title TEXT,
  appointment_date TEXT,
  appointment_type TEXT,
  status TEXT,
  notes TEXT,
  candidate_airtable_id TEXT,
  contact_airtable_id TEXT,
  job_airtable_id TEXT,
  shortlist_airtable_id TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(airtable_id, source_base)
);
ALTER TABLE public.airtable_appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read appointments" ON public.airtable_appointments;
CREATE POLICY "Authenticated users can read appointments" ON public.airtable_appointments FOR SELECT USING (auth.role() = 'authenticated'::text);
DROP POLICY IF EXISTS "Service role can manage appointments" ON public.airtable_appointments;
CREATE POLICY "Service role can manage appointments" ON public.airtable_appointments FOR ALL USING (auth.role() = 'service_role'::text);

-- Tâches
CREATE TABLE public.airtable_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT NOT NULL,
  source_base TEXT NOT NULL DEFAULT 'konekt',
  title TEXT,
  description TEXT,
  due_date TEXT,
  status TEXT,
  task_type TEXT,
  assignee TEXT,
  candidate_airtable_id TEXT,
  contact_airtable_id TEXT,
  job_airtable_id TEXT,
  shortlist_airtable_id TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(airtable_id, source_base)
);
ALTER TABLE public.airtable_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read tasks" ON public.airtable_tasks;
CREATE POLICY "Authenticated users can read tasks" ON public.airtable_tasks FOR SELECT USING (auth.role() = 'authenticated'::text);
DROP POLICY IF EXISTS "Service role can manage tasks" ON public.airtable_tasks;
CREATE POLICY "Service role can manage tasks" ON public.airtable_tasks FOR ALL USING (auth.role() = 'service_role'::text);

-- Shortlists cumulées
CREATE TABLE public.airtable_shortlists_cumulated (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT NOT NULL,
  source_base TEXT NOT NULL DEFAULT 'konekt',
  candidate_airtable_id TEXT,
  company_airtable_id TEXT,
  total_shortlists INTEGER,
  last_shortlist_date TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(airtable_id, source_base)
);
ALTER TABLE public.airtable_shortlists_cumulated ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read shortlists cumulated" ON public.airtable_shortlists_cumulated;
CREATE POLICY "Authenticated users can read shortlists cumulated" ON public.airtable_shortlists_cumulated FOR SELECT USING (auth.role() = 'authenticated'::text);
DROP POLICY IF EXISTS "Service role can manage shortlists cumulated" ON public.airtable_shortlists_cumulated;
CREATE POLICY "Service role can manage shortlists cumulated" ON public.airtable_shortlists_cumulated FOR ALL USING (auth.role() = 'service_role'::text);

-- Glossaire tech
CREATE TABLE public.airtable_glossary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT NOT NULL,
  source_base TEXT NOT NULL DEFAULT 'konekt',
  term TEXT,
  category TEXT,
  description TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(airtable_id, source_base)
);
ALTER TABLE public.airtable_glossary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read glossary" ON public.airtable_glossary;
CREATE POLICY "Authenticated users can read glossary" ON public.airtable_glossary FOR SELECT USING (auth.role() = 'authenticated'::text);
DROP POLICY IF EXISTS "Service role can manage glossary" ON public.airtable_glossary;
CREATE POLICY "Service role can manage glossary" ON public.airtable_glossary FOR ALL USING (auth.role() = 'service_role'::text);

-- KPI
CREATE TABLE public.airtable_kpi (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id TEXT NOT NULL,
  source_base TEXT NOT NULL DEFAULT 'konekt',
  name TEXT,
  value TEXT,
  period TEXT,
  category TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(airtable_id, source_base)
);
ALTER TABLE public.airtable_kpi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read KPI" ON public.airtable_kpi;
CREATE POLICY "Authenticated users can read KPI" ON public.airtable_kpi FOR SELECT USING (auth.role() = 'authenticated'::text);
DROP POLICY IF EXISTS "Service role can manage KPI" ON public.airtable_kpi;
CREATE POLICY "Service role can manage KPI" ON public.airtable_kpi FOR ALL USING (auth.role() = 'service_role'::text);

-- Update sync_meta
ALTER TABLE public.airtable_sync_meta ADD COLUMN IF NOT EXISTS source_base TEXT NOT NULL DEFAULT 'konekt';
ALTER TABLE public.airtable_sync_meta DROP CONSTRAINT IF EXISTS airtable_sync_meta_table_name_key;
ALTER TABLE public.airtable_sync_meta ADD CONSTRAINT airtable_sync_meta_table_base_key UNIQUE (table_name, source_base);
