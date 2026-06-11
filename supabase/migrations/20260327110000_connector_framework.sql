-- ═══════════════════════════════════════════════════════════
-- Phase 5: Connector Framework — sync engine infrastructure
-- ═══════════════════════════════════════════════════════════

-- 0. Tables de base (fix replayability 2026-06-11) ───────────────────────────
-- connector_registry et connector_instances font partie du schéma importé
-- depuis Lovable et n'avaient JAMAIS été capturées en migration — la chaîne
-- n'était donc pas rejouable sur une base vierge (FK plus bas → 42P01).
-- Définitions reconstituées depuis la prod (types.ts généré + contraintes
-- observées : connector_instances.id est uuid (cible des FK), registry.id est
-- un slug texte matché à connector_id, l'UNIQUE(org,connector) est ajouté par
-- 20260421180000). IF NOT EXISTS → no-op partout où elles existent déjà.
-- NB types déduits du seed plus bas : l'INSERT ne fournit pas d'id (→ uuid à
-- DEFAULT) et fait ON CONFLICT (name) (→ UNIQUE sur name).
CREATE TABLE IF NOT EXISTS public.connector_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL,
  description text,
  icon_url text,
  config_schema jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.connector_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "connector_registry_read" ON public.connector_registry;
CREATE POLICY "connector_registry_read" ON public.connector_registry
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.connector_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL,
  config jsonb,
  status text NOT NULL DEFAULT 'inactive',
  error_message text,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.connector_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "connector_instances_policy" ON public.connector_instances;
CREATE POLICY "connector_instances_policy" ON public.connector_instances
  FOR ALL TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_connector_instances_org ON public.connector_instances(organization_id);

-- 1. Sync run history / audit trail
CREATE TABLE IF NOT EXISTS public.connector_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector_instance_id uuid NOT NULL REFERENCES public.connector_instances(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  direction text DEFAULT 'pull' CHECK (direction IN ('pull', 'push', 'full')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'partial', 'failed')),
  records_processed integer DEFAULT 0,
  records_created integer DEFAULT 0,
  records_updated integer DEFAULT 0,
  records_failed integer DEFAULT 0,
  error_message text,
  error_details jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.connector_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "connector_sync_runs_policy" ON public.connector_sync_runs;
CREATE POLICY "connector_sync_runs_policy" ON public.connector_sync_runs
  FOR ALL USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_sync_runs_instance ON public.connector_sync_runs(connector_instance_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_org ON public.connector_sync_runs(organization_id, started_at DESC);

-- 2. Entity mappings — map external IDs to internal IDs
CREATE TABLE IF NOT EXISTS public.connector_entity_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_instance_id uuid NOT NULL REFERENCES public.connector_instances(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  internal_id text NOT NULL,
  external_data jsonb DEFAULT '{}',
  last_synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(connector_instance_id, entity_type, external_id)
);

ALTER TABLE public.connector_entity_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "connector_entity_mappings_policy" ON public.connector_entity_mappings;
CREATE POLICY "connector_entity_mappings_policy" ON public.connector_entity_mappings
  FOR ALL USING (
    connector_instance_id IN (
      SELECT ci.id FROM public.connector_instances ci
      WHERE ci.organization_id IN (
        SELECT om.organization_id FROM public.organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_entity_mappings_lookup ON public.connector_entity_mappings(connector_instance_id, entity_type, external_id);

-- 3. Field mappings — map remote fields to local fields per connector instance
CREATE TABLE IF NOT EXISTS public.connector_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_instance_id uuid NOT NULL REFERENCES public.connector_instances(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  remote_field text NOT NULL,
  local_field text NOT NULL,
  transformation jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(connector_instance_id, entity_type, remote_field)
);

ALTER TABLE public.connector_field_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "connector_field_mappings_policy" ON public.connector_field_mappings;
CREATE POLICY "connector_field_mappings_policy" ON public.connector_field_mappings
  FOR ALL USING (
    connector_instance_id IN (
      SELECT ci.id FROM public.connector_instances ci
      WHERE ci.organization_id IN (
        SELECT om.organization_id FROM public.organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );

-- 4. Populate connector_registry with known connectors
INSERT INTO public.connector_registry (name, description, category, config_schema, is_active, icon_url) VALUES
  ('Bullhorn', 'ATS Bullhorn — synchronisation candidats, jobs, placements', 'ats', '{"type":"object","properties":{"client_id":{"type":"string"},"client_secret":{"type":"string"},"username":{"type":"string"},"password":{"type":"string"},"api_url":{"type":"string"}},"required":["client_id","client_secret","username","password"]}', true, null),
  ('Huntool', 'ATS Huntool — gestion des recrutements', 'ats', '{"type":"object","properties":{"api_key":{"type":"string"},"workspace_id":{"type":"string"}},"required":["api_key"]}', true, null),
  ('Jarvi', 'ATS Jarvi — suivi des candidatures', 'ats', '{"type":"object","properties":{"api_key":{"type":"string"},"account_id":{"type":"string"}},"required":["api_key"]}', true, null),
  ('Notion', 'Notion — bases de données candidats et postes', 'crm', '{"type":"object","properties":{"api_key":{"type":"string"},"postes_db_id":{"type":"string"},"candidats_db_id":{"type":"string"},"shortlist_db_id":{"type":"string"}},"required":["api_key"]}', true, null),
  ('Airtable', 'Airtable — CRM recrutement', 'crm', '{"type":"object","properties":{"api_key":{"type":"string"},"base_id":{"type":"string"},"base_id_2":{"type":"string"}},"required":["api_key","base_id"]}', true, null),
  ('Aircall', 'Aircall — téléphonie cloud', 'telephony', '{"type":"object","properties":{"api_id":{"type":"string"},"api_token":{"type":"string"}},"required":["api_id","api_token"]}', true, null),
  ('Calendly', 'Calendly — planification d''entretiens', 'scheduling', '{"type":"object","properties":{"api_key":{"type":"string"}},"required":["api_key"]}', true, null),
  ('LinkedIn Recruiter', 'LinkedIn via Unipile — sourcing et messagerie', 'sourcing', '{"type":"object","properties":{"dsn":{"type":"string"},"api_key":{"type":"string"}},"required":["dsn","api_key"]}', true, null)
ON CONFLICT (name) DO NOTHING;

-- 5. Add sync-related columns to connector_instances
ALTER TABLE public.connector_instances
  ADD COLUMN IF NOT EXISTS sync_schedule text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS next_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_entities text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS total_synced_records integer DEFAULT 0;
