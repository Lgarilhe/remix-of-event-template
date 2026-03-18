
-- ═══════════════════════════════════════════════════════════════
-- CONNECTOR FRAMEWORK + KNOWLEDGE LAKE
-- ═══════════════════════════════════════════════════════════════

-- 1. connector_registry — catalogue des connecteurs disponibles
CREATE TABLE IF NOT EXISTS public.connector_registry (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  icon_url text,
  category text NOT NULL DEFAULT 'other',
  config_schema jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connector_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read connector_registry"
  ON public.connector_registry FOR SELECT
  TO authenticated
  USING (true);

-- 2. connector_instances — instances de connecteurs par organisation
CREATE TABLE IF NOT EXISTS public.connector_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector_id text NOT NULL REFERENCES public.connector_registry(id),
  config jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, connector_id)
);

ALTER TABLE public.connector_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read connector_instances"
  ON public.connector_instances FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org admins can manage connector_instances"
  ON public.connector_instances FOR ALL
  TO authenticated
  USING (
    public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin')
  );

-- 3. knowledge_chunks — le Knowledge Lake RAG
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  chunk_type text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(1536),
  metadata jsonb DEFAULT '{}'::jsonb,
  source_connector_id text,
  source_table text,
  source_id text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, entity_id, chunk_type, content_hash)
);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read knowledge_chunks"
  ON public.knowledge_chunks FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Index for entity lookup
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_entity
  ON public.knowledge_chunks (organization_id, entity_type, entity_id);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_expires
  ON public.knowledge_chunks (expires_at)
  WHERE expires_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- retrieve_context: single entity similarity search
CREATE OR REPLACE FUNCTION public.retrieve_context(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_query_embedding vector(1536),
  p_chunk_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 15
)
RETURNS TABLE (
  id uuid,
  chunk_type text,
  content text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    kc.id,
    kc.chunk_type,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.organization_id = p_org_id
    AND kc.entity_type = p_entity_type
    AND kc.entity_id = p_entity_id
    AND (p_chunk_types IS NULL OR kc.chunk_type = ANY(p_chunk_types))
    AND (kc.expires_at IS NULL OR kc.expires_at > now())
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

-- retrieve_context_multi: multi-entity similarity search
CREATE OR REPLACE FUNCTION public.retrieve_context_multi(
  p_org_id uuid,
  p_entity_ids text[],
  p_query_embedding vector(1536),
  p_chunk_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 15
)
RETURNS TABLE (
  id uuid,
  chunk_type text,
  content text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    kc.id,
    kc.chunk_type,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.organization_id = p_org_id
    AND kc.entity_id = ANY(p_entity_ids)
    AND (p_chunk_types IS NULL OR kc.chunk_type = ANY(p_chunk_types))
    AND (kc.expires_at IS NULL OR kc.expires_at > now())
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — 8 connecteurs
-- ═══════════════════════════════════════════════════════════════

INSERT INTO public.connector_registry (id, name, description, category) VALUES
  ('linkedin', 'LinkedIn', 'Profils, posts et messages LinkedIn via Unipile', 'sourcing'),
  ('notion', 'Notion', 'Base de données Notion (postes, candidats, shortlists)', 'ats'),
  ('airtable', 'Airtable', 'Base Airtable CRM (candidats, contacts, notes)', 'crm'),
  ('aircall', 'Aircall', 'Appels et transcriptions Aircall', 'communication'),
  ('calendly', 'Calendly', 'Événements et rendez-vous Calendly', 'scheduling'),
  ('email', 'Email', 'Conversations email via Unipile', 'communication'),
  ('manual', 'Saisie manuelle', 'Notes et évaluations saisies manuellement', 'other'),
  ('qualification', 'Qualification', 'Sessions de qualification et scorecards', 'evaluation')
ON CONFLICT (id) DO NOTHING;
