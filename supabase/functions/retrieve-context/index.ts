// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";
import { callClaudeCompat } from "../_shared/call-claude.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── In-memory embedding cache (avoids re-embedding the same job query) ──
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedEmbedding(queryHash: string): number[] | null {
  const entry = embeddingCache.get(queryHash);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    embeddingCache.delete(queryHash);
    return null;
  }
  return entry.embedding;
}

function setCachedEmbedding(queryHash: string, embedding: number[]): void {
  // Evict expired entries periodically (keep cache small)
  if (embeddingCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of embeddingCache) {
      if (now - v.timestamp > CACHE_TTL_MS) embeddingCache.delete(k);
    }
  }
  embeddingCache.set(queryHash, { embedding, timestamp: Date.now() });
}

async function hashQuery(query: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(query);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Entity label mapping for formatted_context header ──
const ENTITY_LABELS: Record<string, string> = {
  candidate: "CANDIDAT",
  job: "JOB",
  company: "ENTREPRISE",
  conversation: "CONVERSATION",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── 0. Parse body ──────────────────────────────────────────
    const body = await req.json();
    const {
      organization_id: bodyOrgId,
      entity_type,
      entity_id,
      // RAG v2 — org-wide / role-scoped retrieval. When org_wide=true, the
      // search spans the whole org (no single entity_id). entity_ids is an
      // optional allow-list (collaborator scoping, computed by the caller).
      org_wide = false,
      entity_ids,
      query,
      chunk_types,
      limit = 8,
      min_similarity = 0.3,
      include_related = false,
      // I2 Sprint 2 (RAG_AGENT_AUDIT.md) — re-ranking via Claude Haiku
      // Si rerank=true (default), on fetch top 30 vectoriel puis on rescore via Claude.
      // Désactivable côté caller via { rerank: false } (utile si on veut pure cosine speed).
      rerank = true,
    } = body;

    // ── 1. Auth — dual mode (requireAuth) ─────────────────────
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }

    let organizationId: string | null = null;
    const isInternalCall = auth.method === "service_role";

    if (!isInternalCall && auth.userId) {
      // Mode A — authenticated user
      const svcAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
      );

      // Rate limit
      const { data: allowed } = await svcAuth.rpc("check_rate_limit", {
        p_user_id: auth.userId,
        p_action: "retrieve_context",
        p_max_requests: 60,
        p_window_seconds: 60,
      });
      if (allowed === false) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (bodyOrgId) {
        const { data: membership } = await svcAuth
          .from("organization_members")
          .select("id")
          .eq("user_id", auth.userId)
          .eq("organization_id", bodyOrgId)
          .maybeSingle();
        if (!membership) {
          return new Response(
            JSON.stringify({ error: "Forbidden — not a member of this organization" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        organizationId = bodyOrgId;
      } else {
        const { data: profile } = await svcAuth
          .from("profiles")
          .select("active_organization_id")
          .eq("user_id", auth.userId)
          .maybeSingle();
        organizationId = profile?.active_organization_id ?? null;
      }
    } else if (bodyOrgId) {
      // Mode B — internal call (service_role)
      organizationId = bodyOrgId;
      console.log("retrieve-context: internal call mode for org", organizationId);
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "No organization_id resolved" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Validate required fields ────────────────────────────
    // org_wide path: only `query` is required (entity_type/entity_id optional).
    // anchored path (back-compat): entity_type + entity_id + query required.
    if (!query || (!org_wide && (!entity_type || !entity_id))) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: query (+ entity_type, entity_id unless org_wide)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validEntityTypes = ["candidate", "job", "company", "conversation"];
    if (entity_type && !validEntityTypes.includes(entity_type)) {
      return new Response(
        JSON.stringify({ error: `entity_type must be one of: ${validEntityTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Embed the query via OpenAI (with cache) ───────────
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const queryText = query.substring(0, 8000);
    const queryHash = await hashQuery(queryText);
    let queryEmbedding = getCachedEmbedding(queryHash);

    if (queryEmbedding) {
      console.log("retrieve-context: embedding cache HIT");
    } else {
      const embeddingRes = await fetchWithTimeout(
        "https://api.openai.com/v1/embeddings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: queryText,
          }),
        },
        15000,
      );

      if (!embeddingRes.ok) {
        const errBody = await embeddingRes.text();
        console.error(`OpenAI API error [${embeddingRes.status}]:`, errBody);
        throw new Error(`OpenAI embedding error: ${embeddingRes.status}`);
      }

      const embeddingData = await embeddingRes.json();
      queryEmbedding = embeddingData.data[0].embedding as number[];
      setCachedEmbedding(queryHash, queryEmbedding!);
    }

    // ── 4. Call the RPC ────────────────────────────────────────
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    // I2 — Si re-ranking activé et qu'on a un ANTHROPIC_API_KEY, on fetch
    // 3-4× plus de chunks que le `limit` final pour donner du choix au reranker.
    const rerankEnabled = rerank && Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
    const initialFetchLimit = rerankEnabled ? Math.min(limit * 4, 30) : limit;

    // deno-lint-ignore no-explicit-any
    let chunks: any[] = [];

    if (org_wide) {
      // RAG v2 — org-wide cosine (optionally filtered by entity_type and an
      // entity_id allow-list for collaborator scoping). Returns entity_id/
      // entity_type so the caller can attribute each extract to its entity.
      const embeddingStr = `[${queryEmbedding!.join(",")}]`;
      const allowList = Array.isArray(entity_ids) && entity_ids.length > 0
        ? entity_ids
        : null;
      const { data, error } = await svc.rpc("retrieve_context_org", {
        p_org_id: organizationId,
        p_query_embedding: embeddingStr,
        p_entity_type: entity_type ?? null,
        p_entity_ids: allowList,
        p_chunk_types: chunk_types ?? null,
        p_limit: initialFetchLimit,
      });

      if (error) {
        console.error("retrieve_context_org RPC error:", error);
        throw new Error(`RPC error: ${error.message}`);
      }
      chunks = (data ?? []).filter((c: any) => typeof c.similarity === 'number' && c.similarity >= min_similarity);
    } else if (include_related) {
      // Gather related entity IDs
      const entityIds = [entity_id];

      if (entity_type === "candidate") {
        // Find jobs linked to this candidate
        const { data: links } = await svc
          .from("job_candidate_status")
          .select("job_id")
          .eq("candidate_id", entity_id)
          .eq("organization_id", organizationId);
        if (links) {
          for (const link of links) {
            if (link.job_id && !entityIds.includes(link.job_id)) {
              entityIds.push(link.job_id);
            }
          }
        }
      } else if (entity_type === "job") {
        // Find candidates linked to this job
        const { data: links } = await svc
          .from("job_candidate_status")
          .select("candidate_id")
          .eq("job_id", entity_id)
          .eq("organization_id", organizationId);
        if (links) {
          for (const link of links) {
            if (link.candidate_id && !entityIds.includes(link.candidate_id)) {
              entityIds.push(link.candidate_id);
            }
          }
        }
      }

      // Call retrieve_context_multi (fetch initialFetchLimit, will rerank below)
      const embeddingStr = `[${queryEmbedding!.join(",")}]`;
      const { data, error } = await svc.rpc("retrieve_context_multi", {
        p_org_id: organizationId,
        p_entity_ids: entityIds,
        p_query_embedding: embeddingStr,
        p_chunk_types: chunk_types ?? null,
        p_limit: initialFetchLimit,
      });

      if (error) {
        console.error("retrieve_context_multi RPC error:", error);
        throw new Error(`RPC error: ${error.message}`);
      }
      chunks = (data ?? []).filter((c: any) => typeof c.similarity === 'number' && c.similarity >= min_similarity);
    } else {
      // Call retrieve_context (single entity, fetch initialFetchLimit)
      const embeddingStr = `[${queryEmbedding!.join(",")}]`;
      const { data, error } = await svc.rpc("retrieve_context", {
        p_org_id: organizationId,
        p_entity_type: entity_type,
        p_entity_id: entity_id,
        p_query_embedding: embeddingStr,
        p_chunk_types: chunk_types ?? null,
        p_limit: initialFetchLimit,
      });

      if (error) {
        console.error("retrieve_context RPC error:", error);
        throw new Error(`RPC error: ${error.message}`);
      }
      chunks = (data ?? []).filter((c: any) => typeof c.similarity === 'number' && c.similarity >= min_similarity);
    }

    // ── 4.5 Re-ranking via Claude Haiku ────────────────────────
    // Si on a fetché plus que `limit`, on demande à Claude Haiku de noter chaque
    // chunk de 0-10 sur la pertinence à la query. Coût ~$0.001/call (Haiku).
    // Gain attendu : +30-40% de pertinence (audit RAG_AGENT_AUDIT.md §1).
    let rerankedFromCount = chunks.length;
    if (rerankEnabled && chunks.length > limit) {
      try {
        const rerankPrompt = chunks.map((c, i) =>
          `[${i}] type=${c.chunk_type} sim=${c.similarity?.toFixed(2)}\n${String(c.content).slice(0, 500)}`,
        ).join('\n\n');

        const rerankResult = await callClaudeCompat({
          messages: [
            {
              role: 'system',
              content: `Tu reçois une liste de chunks de contexte numérotés [0]..[N] et une query. Pour chaque chunk, score sa pertinence à répondre à la query, de 0 (pas pertinent) à 10 (parfaitement pertinent). Tu ignores la similarité cosine fournie (peu fiable seule). Réponds via tool call uniquement.`,
            },
            {
              role: 'user',
              content: `QUERY: ${queryText}\n\nCHUNKS:\n${rerankPrompt}`,
            },
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'rank_chunks',
              description: 'Return relevance scores for each chunk',
              parameters: {
                type: 'object',
                properties: {
                  scores: {
                    type: 'array',
                    description: 'Array of {index, score} objects, one per chunk',
                    items: {
                      type: 'object',
                      properties: {
                        index: { type: 'integer' },
                        score: { type: 'number', description: '0-10 relevance' },
                      },
                      required: ['index', 'score'],
                    },
                  },
                },
                required: ['scores'],
              },
            },
          }],
          tool_choice: { type: 'function', function: { name: 'rank_chunks' } },
          max_tokens: 1500,
          timeoutMs: 12000,
        });

        const ranked = rerankResult.toolCall?.input as { scores?: Array<{ index: number; score: number }> } | null;
        if (ranked?.scores && Array.isArray(ranked.scores)) {
          const scoreMap = new Map(ranked.scores.map((s) => [s.index, s.score]));
          chunks = chunks
            .map((c, i) => ({ ...c, _rerank_score: scoreMap.get(i) ?? 0 }))
            .filter((c) => c._rerank_score >= 3) // drop les < 3/10 (clairement non pertinent)
            .sort((a, b) => b._rerank_score - a._rerank_score)
            .slice(0, limit);
          console.log(`retrieve-context: reranked ${rerankedFromCount} → ${chunks.length} chunks`);
        }
      } catch (e) {
        // Fallback : si rerank échoue, on garde top `limit` par cosine
        console.warn('retrieve-context: rerank failed, falling back to cosine top-limit:', e);
        chunks = chunks.slice(0, limit);
      }
    } else if (chunks.length > limit) {
      // Pas de rerank : on tronque à limit
      chunks = chunks.slice(0, limit);
    }

    // ── 5. Format context for prompt injection ─────────────────
    const label = entity_type
      ? (ENTITY_LABELS[entity_type] || entity_type.toUpperCase())
      : "ORG";
    const formattedSections = chunks.map((c) => {
      const datePart = c.metadata?.date ? ` | DATE: ${c.metadata.date}` : "";
      const sim = typeof c.similarity === "number" ? c.similarity.toFixed(2) : "N/A";
      return `[TYPE: ${c.chunk_type} | SIMILARITY: ${sim}${datePart}]\n${c.content}`;
    });

    const formattedContext = chunks.length > 0
      ? `=== CONTEXTE ${label} (RAG) ===\n${formattedSections.join("\n\n")}\n=== FIN CONTEXTE ===`
      : `=== CONTEXTE ${label} (RAG) ===\nAucun contexte trouvé.\n=== FIN CONTEXTE ===`;

    // ── 6. Return response ─────────────────────────────────────
    if (isInternalCall) {
      console.log(`retrieve-context: returned ${chunks.length} chunks for ${entity_type}/${entity_id}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunks: chunks.map((c) => ({
          id: c.id,
          // entity_id/entity_type only present on the org_wide RPC return;
          // undefined for anchored paths (dropped by JSON.stringify) →
          // existing callers unaffected.
          entity_id: c.entity_id,
          entity_type: c.entity_type,
          chunk_type: c.chunk_type,
          content: c.content,
          metadata: c.metadata,
          similarity: c.similarity,
          rerank_score: c._rerank_score,
        })),
        formatted_context: formattedContext,
        total_chunks: chunks.length,
        reranked: rerankEnabled && rerankedFromCount > limit,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("retrieve-context error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
