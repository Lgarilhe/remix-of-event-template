-- ═══════════════════════════════════════════════════════════════════
-- Knowledge Lake: Formalize existing knowledge_chunks schema
-- ═══════════════════════════════════════════════════════════════════

-- Table (IF NOT EXISTS to preserve existing data)
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
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint (IF NOT EXISTS via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_organization_id_entity_type_entity_id_chun_key'
  ) THEN
    ALTER TABLE public.knowledge_chunks
      ADD CONSTRAINT knowledge_chunks_organization_id_entity_type_entity_id_chun_key
      UNIQUE (organization_id, entity_type, entity_id, chunk_type, content_hash);
  END IF;
END $$;

-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_entity
  ON public.knowledge_chunks (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_chunk_type
  ON public.knowledge_chunks (organization_id, chunk_type);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_expires
  ON public.knowledge_chunks (expires_at) WHERE expires_at IS NOT NULL;

-- Trigger for updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_knowledge_chunks'
  ) THEN
    CREATE TRIGGER set_updated_at_knowledge_chunks
      BEFORE UPDATE ON public.knowledge_chunks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- RLS
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- SELECT policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Org members can read knowledge_chunks' AND tablename = 'knowledge_chunks'
  ) THEN
    CREATE POLICY "Org members can read knowledge_chunks"
      ON public.knowledge_chunks FOR SELECT TO authenticated
      USING (is_org_member(auth.uid(), organization_id));
  END IF;
END $$;

-- INSERT policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Org members can insert knowledge_chunks' AND tablename = 'knowledge_chunks'
  ) THEN
    CREATE POLICY "Org members can insert knowledge_chunks"
      ON public.knowledge_chunks FOR INSERT TO authenticated
      WITH CHECK (is_org_member(auth.uid(), organization_id));
  END IF;
END $$;

-- UPDATE policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Org members can update knowledge_chunks' AND tablename = 'knowledge_chunks'
  ) THEN
    CREATE POLICY "Org members can update knowledge_chunks"
      ON public.knowledge_chunks FOR UPDATE TO authenticated
      USING (is_org_member(auth.uid(), organization_id));
  END IF;
END $$;

-- DELETE policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Org members can delete knowledge_chunks' AND tablename = 'knowledge_chunks'
  ) THEN
    CREATE POLICY "Org members can delete knowledge_chunks"
      ON public.knowledge_chunks FOR DELETE TO authenticated
      USING (is_org_member(auth.uid(), organization_id));
  END IF;
END $$;

-- Functions (CREATE OR REPLACE — safe on existing)
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