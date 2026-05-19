-- ═══════════════════════════════════════════════════════════════════
-- Knowledge Lake — RAG v2: org-wide / role-scoped semantic retrieval
-- ═══════════════════════════════════════════════════════════════════
-- Adds retrieve_context_org(): cosine search across the WHOLE org's
-- knowledge_chunks (not anchored to a single entity_id), with optional
-- entity_type and entity_id allow-list filters. Powers cross-candidate
-- recall in the IA copilot ("quels candidats ont parlé de télétravail").
--
--  • p_entity_ids NULL  → whole org (privileged: owner/admin)
--  • p_entity_ids [...]  → restricted to that allow-list (collaborator:
--                          only candidates in their own/team missions —
--                          the allow-list is computed in the tool layer)
--
-- Returns entity_type/entity_id so the caller can attribute each extract
-- back to its candidate. Mirrors the existing retrieve_context /
-- retrieve_context_multi style (SECURITY DEFINER, called via service role
-- from the retrieve-context edge function). Idempotent (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.retrieve_context_org(
  p_org_id uuid,
  p_query_embedding vector(1536),
  p_entity_type text DEFAULT NULL,
  p_entity_ids text[] DEFAULT NULL,
  p_chunk_types text[] DEFAULT NULL,
  p_limit int DEFAULT 15
) RETURNS TABLE(
  id uuid, entity_type text, entity_id text, chunk_type text,
  content text, metadata jsonb, similarity float
) AS $$
  SELECT kc.id, kc.entity_type, kc.entity_id, kc.chunk_type, kc.content, kc.metadata,
         1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.organization_id = p_org_id
    AND kc.embedding IS NOT NULL
    AND (p_entity_type IS NULL OR kc.entity_type = p_entity_type)
    AND (p_entity_ids IS NULL OR kc.entity_id = ANY(p_entity_ids))
    AND (p_chunk_types IS NULL OR kc.chunk_type = ANY(p_chunk_types))
    AND (kc.expires_at IS NULL OR kc.expires_at > now())
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
