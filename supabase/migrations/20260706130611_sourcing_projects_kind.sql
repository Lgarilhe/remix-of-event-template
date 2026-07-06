-- ============================================
-- Migration: kind ('mission' | 'search') sur sourcing_projects
-- ============================================
-- Recherches autonomes (/sourcing) : une recherche libre = un sourcing_project
-- léger avec kind='search'. Elle réutilise toute la machinerie mission
-- (filters_snapshot, job_candidate_status keyé project:{id}, stats triggers,
-- resolve_jcs_project_id) et se convertit en mission par simple UPDATE kind.
-- Les listes de missions filtrent kind='mission' côté frontend.
-- Idempotente : peut être appliquée manuellement (SQL editor / execute_sql)
-- puis rejouée sans effet par le workflow deploy-migrations.

-- ============================================
-- Phase 1: Schema
-- ============================================

ALTER TABLE public.sourcing_projects
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'mission';

DO $$
BEGIN
  ALTER TABLE public.sourcing_projects
    ADD CONSTRAINT sourcing_projects_kind_check
    CHECK (kind IN ('mission', 'search'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Les deux listes (missions, recherches) filtrent org + kind.
CREATE INDEX IF NOT EXISTS idx_sourcing_projects_org_kind
  ON public.sourcing_projects (organization_id, kind);
