-- ============================================
-- Phase 3: Add organization_id to remaining tables
-- 16 tables that MUST have organization_id
-- Pattern: same as 20260306141246*.sql
-- ============================================

-- ============================================
-- PART A: ADD COLUMNS + FK
-- ============================================

-- 1. aircall_calls
ALTER TABLE public.aircall_calls
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_aircall_calls_org_id ON public.aircall_calls(organization_id);

-- 2. airtable_appointments
ALTER TABLE public.airtable_appointments
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_appointments_org_id ON public.airtable_appointments(organization_id);

-- 3. airtable_candidates
ALTER TABLE public.airtable_candidates
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_candidates_org_id ON public.airtable_candidates(organization_id);

-- 4. airtable_companies
ALTER TABLE public.airtable_companies
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_companies_org_id ON public.airtable_companies(organization_id);

-- 5. airtable_contacts
ALTER TABLE public.airtable_contacts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_contacts_org_id ON public.airtable_contacts(organization_id);

-- 6. airtable_jobs
ALTER TABLE public.airtable_jobs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_jobs_org_id ON public.airtable_jobs(organization_id);

-- 7. airtable_kpi
ALTER TABLE public.airtable_kpi
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_kpi_org_id ON public.airtable_kpi(organization_id);

-- 8. airtable_notes
ALTER TABLE public.airtable_notes
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_notes_org_id ON public.airtable_notes(organization_id);

-- 9. airtable_placements
ALTER TABLE public.airtable_placements
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_placements_org_id ON public.airtable_placements(organization_id);

-- 10. airtable_shortlists
ALTER TABLE public.airtable_shortlists
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_shortlists_org_id ON public.airtable_shortlists(organization_id);

-- 11. airtable_shortlists_cumulated
ALTER TABLE public.airtable_shortlists_cumulated
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_shortlists_cumulated_org_id ON public.airtable_shortlists_cumulated(organization_id);

-- 12. airtable_tasks
ALTER TABLE public.airtable_tasks
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_airtable_tasks_org_id ON public.airtable_tasks(organization_id);

-- 13. job_favorites
ALTER TABLE public.job_favorites
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_job_favorites_org_id ON public.job_favorites(organization_id);

-- 14. job_profiles
ALTER TABLE public.job_profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_job_profiles_org_id ON public.job_profiles(organization_id);

-- 15. job_skills_cache
ALTER TABLE public.job_skills_cache
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_job_skills_cache_org_id ON public.job_skills_cache(organization_id);

-- 16. sequence_analytics
ALTER TABLE public.sequence_analytics
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_sequence_analytics_org_id ON public.sequence_analytics(organization_id);


-- ============================================
-- PART B: BACKFILL organization_id
-- ============================================

-- B1. airtable_* tables: via source_base → organization_integrations.airtable_base_id
UPDATE public.airtable_appointments SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_appointments.source_base = sub.base AND airtable_appointments.organization_id IS NULL;

UPDATE public.airtable_candidates SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_candidates.source_base = sub.base AND airtable_candidates.organization_id IS NULL;

UPDATE public.airtable_companies SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_companies.source_base = sub.base AND airtable_companies.organization_id IS NULL;

UPDATE public.airtable_contacts SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_contacts.source_base = sub.base AND airtable_contacts.organization_id IS NULL;

UPDATE public.airtable_jobs SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_jobs.source_base = sub.base AND airtable_jobs.organization_id IS NULL;

UPDATE public.airtable_kpi SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_kpi.source_base = sub.base AND airtable_kpi.organization_id IS NULL;

UPDATE public.airtable_notes SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_notes.source_base = sub.base AND airtable_notes.organization_id IS NULL;

UPDATE public.airtable_placements SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_placements.source_base = sub.base AND airtable_placements.organization_id IS NULL;

UPDATE public.airtable_shortlists SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_shortlists.source_base = sub.base AND airtable_shortlists.organization_id IS NULL;

UPDATE public.airtable_shortlists_cumulated SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_shortlists_cumulated.source_base = sub.base AND airtable_shortlists_cumulated.organization_id IS NULL;

UPDATE public.airtable_tasks SET organization_id = sub.organization_id
  FROM (SELECT airtable_base_id AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id IS NOT NULL
        UNION
        SELECT airtable_base_id_2 AS base, organization_id FROM public.organization_integrations WHERE airtable_base_id_2 IS NOT NULL) sub
  WHERE airtable_tasks.source_base = sub.base AND airtable_tasks.organization_id IS NULL;

-- B2. job_favorites: via user_id → profiles.active_organization_id
UPDATE public.job_favorites SET organization_id = (
  SELECT active_organization_id FROM public.profiles WHERE user_id = job_favorites.user_id LIMIT 1
) WHERE organization_id IS NULL;

-- B3. job_profiles: via job_id → sourcing_projects (job_id match)
UPDATE public.job_profiles SET organization_id = (
  SELECT sp.organization_id FROM public.sourcing_projects sp
  WHERE sp.job_id = job_profiles.job_id AND sp.organization_id IS NOT NULL LIMIT 1
) WHERE organization_id IS NULL;

-- B4. job_skills_cache: via job_id → sourcing_projects
UPDATE public.job_skills_cache SET organization_id = (
  SELECT sp.organization_id FROM public.sourcing_projects sp
  WHERE sp.job_id = job_skills_cache.job_id AND sp.organization_id IS NOT NULL LIMIT 1
) WHERE organization_id IS NULL;

-- B5. sequence_analytics: via sequence_id → outreach_sequences.organization_id
UPDATE public.sequence_analytics SET organization_id = (
  SELECT os.organization_id FROM public.outreach_sequences os
  WHERE os.id = sequence_analytics.sequence_id AND os.organization_id IS NOT NULL LIMIT 1
) WHERE organization_id IS NULL;

-- B6. aircall_calls: no created_by → try via user_email → auth.users.email → profiles
-- This is best-effort; some rows may remain NULL
UPDATE public.aircall_calls SET organization_id = sub.active_organization_id
  FROM (
    SELECT au.email, p.active_organization_id
    FROM auth.users au
    JOIN public.profiles p ON p.user_id = au.id
    WHERE p.active_organization_id IS NOT NULL
  ) sub
  WHERE aircall_calls.user_email = sub.email AND aircall_calls.organization_id IS NULL;


-- ============================================
-- PART C: RLS POLICIES
-- ============================================

-- Enable RLS on tables that may not have it yet
ALTER TABLE public.aircall_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_kpi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_shortlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_shortlists_cumulated ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_skills_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_analytics ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------
-- C1. aircall_calls (no created_by)
-- -----------------------------------------------
DROP POLICY IF EXISTS "Users can view their own aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Users can create aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Users can update aircall calls" ON public.aircall_calls;
DROP POLICY IF EXISTS "Users can delete aircall calls" ON public.aircall_calls;

CREATE POLICY "Org members can view aircall calls"
  ON public.aircall_calls FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Org members can insert aircall calls"
  ON public.aircall_calls FOR INSERT
  WITH CHECK (
    organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Org members can update aircall calls"
  ON public.aircall_calls FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Org members can delete aircall calls"
  ON public.aircall_calls FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

-- Service role bypass for webhook inserts
CREATE POLICY "Service role full access aircall calls"
  ON public.aircall_calls FOR ALL
  USING (auth.role() = 'service_role');

-- -----------------------------------------------
-- C2-C12. airtable_* tables (no created_by — same pattern)
-- These are primarily written by service_role (sync functions)
-- and read by authenticated org members.
-- -----------------------------------------------

-- C2. airtable_appointments
DROP POLICY IF EXISTS "Anyone can view airtable_appointments" ON public.airtable_appointments;
DROP POLICY IF EXISTS "Anyone can manage airtable_appointments" ON public.airtable_appointments;

CREATE POLICY "Org members can view airtable appointments"
  ON public.airtable_appointments FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable appointments"
  ON public.airtable_appointments FOR ALL
  USING (auth.role() = 'service_role');

-- C3. airtable_candidates
DROP POLICY IF EXISTS "Anyone can view airtable_candidates" ON public.airtable_candidates;
DROP POLICY IF EXISTS "Anyone can manage airtable_candidates" ON public.airtable_candidates;

CREATE POLICY "Org members can view airtable candidates"
  ON public.airtable_candidates FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable candidates"
  ON public.airtable_candidates FOR ALL
  USING (auth.role() = 'service_role');

-- C4. airtable_companies
DROP POLICY IF EXISTS "Anyone can view airtable_companies" ON public.airtable_companies;
DROP POLICY IF EXISTS "Anyone can manage airtable_companies" ON public.airtable_companies;

CREATE POLICY "Org members can view airtable companies"
  ON public.airtable_companies FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable companies"
  ON public.airtable_companies FOR ALL
  USING (auth.role() = 'service_role');

-- C5. airtable_contacts
DROP POLICY IF EXISTS "Anyone can view airtable_contacts" ON public.airtable_contacts;
DROP POLICY IF EXISTS "Anyone can manage airtable_contacts" ON public.airtable_contacts;

CREATE POLICY "Org members can view airtable contacts"
  ON public.airtable_contacts FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable contacts"
  ON public.airtable_contacts FOR ALL
  USING (auth.role() = 'service_role');

-- C6. airtable_jobs
DROP POLICY IF EXISTS "Anyone can view airtable_jobs" ON public.airtable_jobs;
DROP POLICY IF EXISTS "Anyone can manage airtable_jobs" ON public.airtable_jobs;

CREATE POLICY "Org members can view airtable jobs"
  ON public.airtable_jobs FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable jobs"
  ON public.airtable_jobs FOR ALL
  USING (auth.role() = 'service_role');

-- C7. airtable_kpi
DROP POLICY IF EXISTS "Anyone can view airtable_kpi" ON public.airtable_kpi;
DROP POLICY IF EXISTS "Anyone can manage airtable_kpi" ON public.airtable_kpi;

CREATE POLICY "Org members can view airtable kpi"
  ON public.airtable_kpi FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable kpi"
  ON public.airtable_kpi FOR ALL
  USING (auth.role() = 'service_role');

-- C8. airtable_notes
DROP POLICY IF EXISTS "Anyone can view airtable_notes" ON public.airtable_notes;
DROP POLICY IF EXISTS "Anyone can manage airtable_notes" ON public.airtable_notes;

CREATE POLICY "Org members can view airtable notes"
  ON public.airtable_notes FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable notes"
  ON public.airtable_notes FOR ALL
  USING (auth.role() = 'service_role');

-- C9. airtable_placements
DROP POLICY IF EXISTS "Anyone can view airtable_placements" ON public.airtable_placements;
DROP POLICY IF EXISTS "Anyone can manage airtable_placements" ON public.airtable_placements;

CREATE POLICY "Org members can view airtable placements"
  ON public.airtable_placements FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable placements"
  ON public.airtable_placements FOR ALL
  USING (auth.role() = 'service_role');

-- C10. airtable_shortlists
DROP POLICY IF EXISTS "Anyone can view airtable_shortlists" ON public.airtable_shortlists;
DROP POLICY IF EXISTS "Anyone can manage airtable_shortlists" ON public.airtable_shortlists;

CREATE POLICY "Org members can view airtable shortlists"
  ON public.airtable_shortlists FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable shortlists"
  ON public.airtable_shortlists FOR ALL
  USING (auth.role() = 'service_role');

-- C11. airtable_shortlists_cumulated
DROP POLICY IF EXISTS "Anyone can view airtable_shortlists_cumulated" ON public.airtable_shortlists_cumulated;
DROP POLICY IF EXISTS "Anyone can manage airtable_shortlists_cumulated" ON public.airtable_shortlists_cumulated;

CREATE POLICY "Org members can view airtable shortlists cumulated"
  ON public.airtable_shortlists_cumulated FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable shortlists cumulated"
  ON public.airtable_shortlists_cumulated FOR ALL
  USING (auth.role() = 'service_role');

-- C12. airtable_tasks
DROP POLICY IF EXISTS "Anyone can view airtable_tasks" ON public.airtable_tasks;
DROP POLICY IF EXISTS "Anyone can manage airtable_tasks" ON public.airtable_tasks;

CREATE POLICY "Org members can view airtable tasks"
  ON public.airtable_tasks FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Service role full access airtable tasks"
  ON public.airtable_tasks FOR ALL
  USING (auth.role() = 'service_role');

-- -----------------------------------------------
-- C13. job_favorites (has user_id, no created_by)
-- -----------------------------------------------
DROP POLICY IF EXISTS "Users can view their own job favorites" ON public.job_favorites;
DROP POLICY IF EXISTS "Users can create their own job favorites" ON public.job_favorites;
DROP POLICY IF EXISTS "Users can delete their own job favorites" ON public.job_favorites;

CREATE POLICY "Org members can view job favorites"
  ON public.job_favorites FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND user_id = auth.uid())
  );

CREATE POLICY "Org members can create job favorites"
  ON public.job_favorites FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id))
  );

CREATE POLICY "Org members can delete job favorites"
  ON public.job_favorites FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND user_id = auth.uid())
  );

-- -----------------------------------------------
-- C14. job_profiles (no created_by — technical/derived data)
-- -----------------------------------------------
DROP POLICY IF EXISTS "Anyone can view job profiles" ON public.job_profiles;
DROP POLICY IF EXISTS "Anyone can manage job profiles" ON public.job_profiles;

CREATE POLICY "Org members can view job profiles"
  ON public.job_profiles FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Org members can manage job profiles"
  ON public.job_profiles FOR ALL
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

-- -----------------------------------------------
-- C15. job_skills_cache (no created_by — cache/derived)
-- -----------------------------------------------
DROP POLICY IF EXISTS "Anyone can view job skills cache" ON public.job_skills_cache;
DROP POLICY IF EXISTS "Anyone can manage job skills cache" ON public.job_skills_cache;

CREATE POLICY "Org members can view job skills cache"
  ON public.job_skills_cache FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Org members can manage job skills cache"
  ON public.job_skills_cache FOR ALL
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

-- -----------------------------------------------
-- C16. sequence_analytics (no created_by — derived via sequence)
-- -----------------------------------------------
DROP POLICY IF EXISTS "Anyone can view sequence analytics" ON public.sequence_analytics;
DROP POLICY IF EXISTS "Anyone can manage sequence analytics" ON public.sequence_analytics;

CREATE POLICY "Org members can view sequence analytics"
  ON public.sequence_analytics FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );

CREATE POLICY "Org members can manage sequence analytics"
  ON public.sequence_analytics FOR ALL
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR organization_id IS NULL
  );
