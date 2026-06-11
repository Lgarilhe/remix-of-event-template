
-- Table: Entreprises Airtable
CREATE TABLE public.airtable_companies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  name text NOT NULL,
  city text,
  description text,
  year_founded text,
  headcount text,
  tech_stack text[],
  benefits text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: Contacts Airtable
CREATE TABLE public.airtable_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  full_name text,
  email text,
  title text,
  contact_type text,
  city text,
  status text,
  company_airtable_id text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: Jobs Airtable
CREATE TABLE public.airtable_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  title text,
  status text,
  contract_type text,
  salary text,
  city text,
  description text,
  criteria text,
  company_airtable_id text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: Candidats Airtable
CREATE TABLE public.airtable_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  linkedin_url text,
  status text,
  experience text,
  skills text[],
  preferred_contract text,
  education_level text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index on LinkedIn URL for fast matching
CREATE INDEX idx_airtable_candidates_linkedin ON public.airtable_candidates (linkedin_url);
CREATE INDEX idx_airtable_candidates_email ON public.airtable_candidates (email);
CREATE INDEX idx_airtable_candidates_name ON public.airtable_candidates (full_name);

-- Table: Shortlists Airtable
CREATE TABLE public.airtable_shortlists (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  status text,
  date_added text,
  salary_proposed text,
  estimated_fees text,
  candidate_airtable_id text,
  job_airtable_id text,
  company_airtable_id text,
  contact_airtable_id text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: Placements Airtable
CREATE TABLE public.airtable_placements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  name text,
  status text,
  salary text,
  start_date text,
  contract_type text,
  fees text,
  candidate_airtable_id text,
  company_airtable_id text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: Notes Airtable
CREATE TABLE public.airtable_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  airtable_id text NOT NULL UNIQUE,
  title text,
  detail text,
  note_type text,
  note_date text,
  author text,
  candidate_airtable_id text,
  job_airtable_id text,
  contact_airtable_id text,
  shortlist_airtable_id text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.airtable_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_notes ENABLE ROW LEVEL SECURITY;

-- RLS: Authenticated users can read all Airtable data (read-only integration)
DROP POLICY IF EXISTS "Authenticated users can read companies" ON public.airtable_companies;
CREATE POLICY "Authenticated users can read companies" ON public.airtable_companies FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage companies" ON public.airtable_companies;
CREATE POLICY "Service role can manage companies" ON public.airtable_companies FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read contacts" ON public.airtable_contacts;
CREATE POLICY "Authenticated users can read contacts" ON public.airtable_contacts FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage contacts" ON public.airtable_contacts;
CREATE POLICY "Service role can manage contacts" ON public.airtable_contacts FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read jobs" ON public.airtable_jobs;
CREATE POLICY "Authenticated users can read jobs" ON public.airtable_jobs FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage jobs" ON public.airtable_jobs;
CREATE POLICY "Service role can manage jobs" ON public.airtable_jobs FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read candidates" ON public.airtable_candidates;
CREATE POLICY "Authenticated users can read candidates" ON public.airtable_candidates FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage candidates" ON public.airtable_candidates;
CREATE POLICY "Service role can manage candidates" ON public.airtable_candidates FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read shortlists" ON public.airtable_shortlists;
CREATE POLICY "Authenticated users can read shortlists" ON public.airtable_shortlists FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage shortlists" ON public.airtable_shortlists;
CREATE POLICY "Service role can manage shortlists" ON public.airtable_shortlists FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read placements" ON public.airtable_placements;
CREATE POLICY "Authenticated users can read placements" ON public.airtable_placements FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage placements" ON public.airtable_placements;
CREATE POLICY "Service role can manage placements" ON public.airtable_placements FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read notes" ON public.airtable_notes;
CREATE POLICY "Authenticated users can read notes" ON public.airtable_notes FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage notes" ON public.airtable_notes;
CREATE POLICY "Service role can manage notes" ON public.airtable_notes FOR ALL USING (auth.role() = 'service_role');

-- Sync metadata table to track last sync time
CREATE TABLE public.airtable_sync_meta (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name text NOT NULL UNIQUE,
  last_synced_at timestamp with time zone NOT NULL DEFAULT now(),
  records_count integer DEFAULT 0,
  status text DEFAULT 'idle'
);
ALTER TABLE public.airtable_sync_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read sync meta" ON public.airtable_sync_meta;
CREATE POLICY "Authenticated users can read sync meta" ON public.airtable_sync_meta FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role can manage sync meta" ON public.airtable_sync_meta;
CREATE POLICY "Service role can manage sync meta" ON public.airtable_sync_meta FOR ALL USING (auth.role() = 'service_role');
