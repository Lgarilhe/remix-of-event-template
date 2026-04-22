// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

// ── CORS Headers (identiques aux autres edge functions) ────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── fetchWithTimeout (pattern obligatoire) ─────────────────────────────
function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// ── Types ──────────────────────────────────────────────────────────────

const VALID_ENTITY_TYPES = ["candidate", "job", "company", "conversation"] as const;
type EntityType = (typeof VALID_ENTITY_TYPES)[number];

const VALID_CHUNK_TYPES = [
  "profile", "experience", "about", "post", "conversation",
  "call_transcript", "note", "evaluation", "job_context",
  "company", "sequence_history", "scoring_result",
] as const;
type ChunkType = (typeof VALID_CHUNK_TYPES)[number];

interface IngestChunk {
  chunk_type: ChunkType;
  content: string;
  source_table?: string;
  source_id?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
}

interface IngestRequest {
  organization_id: string;
  entity_type: EntityType;
  entity_id: string;
  source_connector_id?: string;
  chunks: IngestChunk[];
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Compute hex SHA-256 of a string using Web Crypto API */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Call OpenAI embeddings with retry on 5xx (1 retry) */
async function callOpenAIEmbeddings(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  // Truncate each input to 8000 chars
  const truncatedInputs = inputs.map((t) => t.substring(0, 8000));

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: truncatedInputs,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Sort by index to ensure correct ordering
        const sorted = (data.data as { index: number; embedding: number[] }[])
          .sort((a, b) => a.index - b.index);
        return sorted.map((d) => d.embedding);
      }

      const errBody = await res.text();
      console.error(`OpenAI API error [${res.status}] (attempt ${attempt + 1}/2):`, errBody);

      // Only retry on 5xx
      if (res.status >= 500 && attempt === 0) {
        lastError = new Error(`OpenAI API ${res.status}: ${errBody}`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      throw new Error(`OpenAI API error: ${res.status} — ${errBody}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("OpenAI API timeout (15s)");
      }
      if (attempt === 0 && lastError === null) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("OpenAI embedding failed after retries");
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── 1. Auth check — dual mode (user JWT or service role) ────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    let isInternalCall = false;
    let userId: string | null = null;

    // Check if this is a service role call (internal)
    if (token === serviceRoleKey) {
      isInternalCall = true;
      console.log("ingest-context: internal service-role call");
    } else {
      // Mode A — frontend JWT via getClaims
      const _supabaseAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: claimsData, error: claimsError } =
        // deno-lint-ignore no-explicit-any
        await (_supabaseAuth.auth as any).getClaims(token);

      if (claimsError || !claimsData?.claims?.sub) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      userId = claimsData.claims.sub;
    }

    // Service client (pour les opérations DB)
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    // ── 2. Rate limit: 60 req/min (skip for internal calls) ─────────
    if (!isInternalCall && userId) {
      const { data: allowed } = await svc.rpc("check_rate_limit", {
        p_user_id: userId,
        p_action: "ingest_context",
        p_max_requests: 60,
        p_window_seconds: 60,
      });

      if (allowed === false) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── Parse & validate request body ───────────────────────────────
    const body: IngestRequest = await req.json();

    const { organization_id, entity_type, entity_id, source_connector_id, chunks } = body;

    if (!organization_id || !entity_type || !entity_id || !Array.isArray(chunks) || chunks.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: organization_id, entity_type, entity_id, chunks (non-empty array)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!VALID_ENTITY_TYPES.includes(entity_type as EntityType)) {
      return new Response(
        JSON.stringify({ error: `Invalid entity_type. Must be one of: ${VALID_ENTITY_TYPES.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    for (const chunk of chunks) {
      if (!chunk.chunk_type || !chunk.content) {
        return new Response(
          JSON.stringify({ error: "Each chunk must have chunk_type and content" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!VALID_CHUNK_TYPES.includes(chunk.chunk_type as ChunkType)) {
        return new Response(
          JSON.stringify({ error: `Invalid chunk_type '${chunk.chunk_type}'. Must be one of: ${VALID_CHUNK_TYPES.join(", ")}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── Membership check (skip for internal calls) ──────────────────
    if (!isInternalCall && userId) {
      const { data: membership } = await svc
        .from("organization_members")
        .select("id")
        .eq("user_id", userId)
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (!membership) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── 3. Process chunks ───────────────────────────────────────────

    // 3a. Compute content hashes for all chunks
    const hashes = await Promise.all(chunks.map((c) => sha256Hex(c.content)));

    // 3b. Check which hashes already exist (to skip unchanged chunks)
    const { data: existingRows } = await svc
      .from("knowledge_chunks")
      .select("content_hash")
      .eq("organization_id", organization_id)
      .eq("entity_type", entity_type)
      .eq("entity_id", entity_id)
      .in("content_hash", hashes);

    const existingHashes = new Set(
      (existingRows ?? []).map((r: { content_hash: string }) => r.content_hash),
    );

    // Separate chunks into: to-embed (new/changed) vs skipped
    const toEmbed: { chunk: IngestChunk; hash: string; index: number }[] = [];
    let skipped = 0;

    for (let i = 0; i < chunks.length; i++) {
      // A chunk is "skipped" only if its exact combination of
      // (content_hash) already exists for this entity — meaning
      // the content hasn't changed.
      if (existingHashes.has(hashes[i])) {
        skipped++;
      } else {
        toEmbed.push({ chunk: chunks[i], hash: hashes[i], index: i });
      }
    }

    let ingested = 0;
    let updated = 0;

    if (toEmbed.length > 0) {
      // 3c. OpenAI key
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }

      // 3d. Batch embeddings (OpenAI accepts up to 2048 inputs per call)
      const MAX_BATCH = 2048;
      const allEmbeddings: number[][] = [];

      for (let batchStart = 0; batchStart < toEmbed.length; batchStart += MAX_BATCH) {
        const batchSlice = toEmbed.slice(batchStart, batchStart + MAX_BATCH);
        const batchTexts = batchSlice.map((item) => item.chunk.content);
        const batchEmbeddings = await callOpenAIEmbeddings(OPENAI_API_KEY, batchTexts);
        allEmbeddings.push(...batchEmbeddings);
      }

      // 3e. Upsert each chunk into knowledge_chunks
      for (let i = 0; i < toEmbed.length; i++) {
        const { chunk, hash } = toEmbed[i];
        const embeddingStr = `[${allEmbeddings[i].join(",")}]`;

        const row: Record<string, unknown> = {
          organization_id,
          entity_type,
          entity_id,
          chunk_type: chunk.chunk_type,
          content: chunk.content,
          content_hash: hash,
          embedding: embeddingStr,
          metadata: chunk.metadata ?? {},
          updated_at: new Date().toISOString(),
        };

        if (source_connector_id) {
          row.source_connector_id = source_connector_id;
        }
        if (chunk.source_table) {
          row.source_table = chunk.source_table;
        }
        if (chunk.source_id) {
          row.source_id = chunk.source_id;
        }
        if (chunk.expires_at) {
          row.expires_at = chunk.expires_at;
        }

        const { error: upsertError, status } = await svc
          .from("knowledge_chunks")
          .upsert(row, {
            onConflict: "organization_id,entity_type,entity_id,chunk_type,content_hash",
          });

        if (upsertError) {
          console.error(`Upsert error for chunk ${i}:`, upsertError.message);
          throw new Error(`DB upsert failed: ${upsertError.message}`);
        }

        // HTTP 201 = created, 200 = updated
        if (status === 201) {
          ingested++;
        } else {
          updated++;
        }
      }
    }

    // ── 4. Return summary ───────────────────────────────────────────
    return new Response(
      JSON.stringify({ success: true, ingested, updated, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("ingest-context error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
