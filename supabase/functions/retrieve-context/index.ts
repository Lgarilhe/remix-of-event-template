// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

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
      query,
      chunk_types,
      limit = 8,
      min_similarity = 0.3,
      include_related = false,
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
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
    if (!entity_type || !entity_id || !query) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: entity_type, entity_id, query" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validEntityTypes = ["candidate", "job", "company", "conversation"];
    if (!validEntityTypes.includes(entity_type)) {
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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // deno-lint-ignore no-explicit-any
    let chunks: any[] = [];

    if (include_related) {
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

      // Call retrieve_context_multi
      const embeddingStr = `[${queryEmbedding!.join(",")}]`;
      const { data, error } = await svc.rpc("retrieve_context_multi", {
        p_org_id: organizationId,
        p_entity_ids: entityIds,
        p_query_embedding: embeddingStr,
        p_chunk_types: chunk_types ?? null,
        p_limit: limit,
      });

      if (error) {
        console.error("retrieve_context_multi RPC error:", error);
        throw new Error(`RPC error: ${error.message}`);
      }
      chunks = (data ?? []).filter((c: any) => typeof c.similarity === 'number' && c.similarity >= min_similarity);
    } else {
      // Call retrieve_context (single entity)
      const embeddingStr = `[${queryEmbedding.join(",")}]`;
      const { data, error } = await svc.rpc("retrieve_context", {
        p_org_id: organizationId,
        p_entity_type: entity_type,
        p_entity_id: entity_id,
        p_query_embedding: embeddingStr,
        p_chunk_types: chunk_types ?? null,
        p_limit: limit,
      });

      if (error) {
        console.error("retrieve_context RPC error:", error);
        throw new Error(`RPC error: ${error.message}`);
      }
      chunks = (data ?? []).filter((c: any) => typeof c.similarity === 'number' && c.similarity >= min_similarity);
    }

    // ── 5. Format context for prompt injection ─────────────────
    const label = ENTITY_LABELS[entity_type] || entity_type.toUpperCase();
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
          chunk_type: c.chunk_type,
          content: c.content,
          metadata: c.metadata,
          similarity: c.similarity,
        })),
        formatted_context: formattedContext,
        total_chunks: chunks.length,
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
