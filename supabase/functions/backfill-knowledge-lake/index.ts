import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helpers ────────────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function callOpenAIEmbeddings(apiKey: string, inputs: string[]): Promise<number[][]> {
  const truncated = inputs.map(t => t.substring(0, 8000));
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: truncated }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
  const data = await res.json();
  return (data.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

interface ChunkToIngest {
  entity_type: string;
  entity_id: string;
  chunk_type: string;
  content: string;
  metadata?: Record<string, unknown>;
}

async function ingestBatchDirect(
  svc: ReturnType<typeof createClient>,
  openaiKey: string,
  orgId: string,
  chunks: ChunkToIngest[],
): Promise<{ ingested: number; skipped: number; errors: number }> {
  if (!chunks.length) return { ingested: 0, skipped: 0, errors: 0 };

  // Compute hashes
  const hashes = await Promise.all(chunks.map(c => sha256Hex(c.content)));

  // Check existing
  const { data: existing } = await svc
    .from("knowledge_chunks")
    .select("content_hash")
    .eq("organization_id", orgId)
    .in("content_hash", hashes);

  const existingSet = new Set((existing ?? []).map((r: { content_hash: string }) => r.content_hash));

  const toEmbed: { chunk: ChunkToIngest; hash: string; idx: number }[] = [];
  let skipped = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (existingSet.has(hashes[i])) { skipped++; } 
    else { toEmbed.push({ chunk: chunks[i], hash: hashes[i], idx: i }); }
  }

  if (!toEmbed.length) return { ingested: 0, skipped, errors: 0 };

  // Batch embed (max 2048 per OpenAI call)
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < toEmbed.length; i += 2048) {
    const slice = toEmbed.slice(i, i + 2048);
    const embeddings = await callOpenAIEmbeddings(openaiKey, slice.map(s => s.chunk.content));
    allEmbeddings.push(...embeddings);
  }

  // Upsert
  let ingested = 0;
  let errors = 0;
  for (let i = 0; i < toEmbed.length; i++) {
    const { chunk, hash } = toEmbed[i];
    const embeddingStr = `[${allEmbeddings[i].join(",")}]`;

    const { error } = await svc.from("knowledge_chunks").upsert({
      organization_id: orgId,
      entity_type: chunk.entity_type,
      entity_id: chunk.entity_id,
      chunk_type: chunk.chunk_type,
      content: chunk.content,
      content_hash: hash,
      embedding: embeddingStr,
      metadata: chunk.metadata ?? {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,entity_type,entity_id,chunk_type,content_hash" });

    if (error) {
      if (errors < 3) console.error(`Upsert error:`, error.message);
      errors++;
    } else {
      ingested++;
    }
  }

  return { ingested, skipped, errors };
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const organizationId = body.organization_id as string;
    const tables = (body.tables as string[] | undefined) ?? [
      "job_candidate_status", "candidate_notes", "candidate_comments",
      "call_coaching_sessions", "candidate_evaluations",
    ];
    const batchSize = (body.batch_size as number) || 100;
    const embeddingBatchSize = (body.embedding_batch_size as number) || 50;
    const maxRows = (body.max_rows as number) || 200;
    const startOffset = (body.offset as number) || 0;

    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

    const svc = createClient(supabaseUrl, serviceKey);
    const stats: Record<string, { processed: number; ingested: number; skipped: number; errors: number }> = {};

    // ── Helper: process a table ────────────────────────────────
    async function processTable(
      tableName: string,
      buildChunk: (row: Record<string, unknown>) => ChunkToIngest | null,
    ) {
      const tableStat = { processed: 0, ingested: 0, skipped: 0, errors: 0 };
      let offset = startOffset;
      let hasMore = true;
      let totalProcessed = 0;

      while (hasMore) {
        const { data: rows, error } = await svc
          .from(tableName)
          .select("*")
          .eq("organization_id", organizationId)
          .range(offset, offset + batchSize - 1);

        if (error || !rows?.length) { hasMore = false; break; }

        // Build chunks for this page
        const chunksToIngest: ChunkToIngest[] = [];
        for (const row of rows) {
          const chunk = buildChunk(row as Record<string, unknown>);
          if (chunk) chunksToIngest.push(chunk);
          tableStat.processed++;
          totalProcessed++;
        }

        // Process in embedding batches
        for (let i = 0; i < chunksToIngest.length; i += embeddingBatchSize) {
          const batch = chunksToIngest.slice(i, i + embeddingBatchSize);
          try {
            const result = await ingestBatchDirect(svc, openaiKey, organizationId, batch);
            tableStat.ingested += result.ingested;
            tableStat.skipped += result.skipped;
            tableStat.errors += result.errors;
          } catch (e) {
            console.error(`Batch error on ${tableName}:`, e instanceof Error ? e.message : String(e));
            tableStat.errors += batch.length;
            if (e instanceof Error && e.message.includes("429")) {
              await new Promise(r => setTimeout(r, 5000));
              try {
                const result = await ingestBatchDirect(svc, openaiKey, organizationId, batch);
                tableStat.ingested += result.ingested;
                tableStat.errors -= batch.length;
                tableStat.errors += result.errors;
              } catch { /* give up */ }
            }
          }
        }

        offset += batchSize;
        if (rows.length < batchSize || totalProcessed >= maxRows) hasMore = false;
      }

      stats[tableName] = { ...tableStat, next_offset: hasMore ? offset : null };
    }

    // ── Process each table ─────────────────────────────────────

    if (tables.includes("job_candidate_status")) {
      await processTable("job_candidate_status", (row) => {
        const candidateId = row.candidate_id as string;
        if (!candidateId) return null;
        const content = [
          `Candidat: ${row.candidate_name || "N/A"}`,
          row.job_title ? `Poste: ${row.job_title}` : null,
          `Étape: ${row.stage || "unknown"}`,
          row.source ? `Source: ${row.source}` : null,
        ].filter(Boolean).join("\n");
        return {
          entity_type: "candidate", entity_id: candidateId, chunk_type: "profile",
          content, metadata: { job_id: row.job_id, stage: row.stage, date: row.updated_at },
        };
      });
    }

    if (tables.includes("candidate_notes")) {
      await processTable("candidate_notes", (row) => {
        const content = row.content as string;
        if (!content?.trim() || !row.candidate_id) return null;
        return {
          entity_type: "candidate", entity_id: row.candidate_id as string, chunk_type: "note",
          content, metadata: { created_by: row.created_by, date: row.created_at },
        };
      });
    }

    if (tables.includes("candidate_comments")) {
      await processTable("candidate_comments", (row) => {
        const content = row.content as string;
        if (!content?.trim() || !row.candidate_id) return null;
        return {
          entity_type: "candidate", entity_id: row.candidate_id as string, chunk_type: "note",
          content: `[Commentaire] ${content}`,
          metadata: { created_by: row.created_by, job_id: row.job_id, date: row.created_at },
        };
      });
    }

    if (tables.includes("call_coaching_sessions")) {
      await processTable("call_coaching_sessions", (row) => {
        const parts: string[] = [];
        if (row.transcript) parts.push(`Transcription: ${row.transcript}`);
        if (row.report) parts.push(`Rapport: ${JSON.stringify(row.report)}`);
        if (!parts.length || !row.candidate_id) return null;
        return {
          entity_type: "candidate", entity_id: row.candidate_id as string, chunk_type: "call_transcript",
          content: parts.join("\n\n"),
          metadata: { job_id: row.job_id, date: row.created_at },
        };
      });
    }

    if (tables.includes("candidate_evaluations")) {
      await processTable("candidate_evaluations", (row) => {
        const parts: string[] = [];
        if (row.summary) parts.push(`Résumé: ${row.summary}`);
        if (row.recommendation) parts.push(`Recommandation: ${row.recommendation}`);
        if (row.follow_up_notes) parts.push(`Notes: ${row.follow_up_notes}`);
        if (row.overall_score) parts.push(`Score: ${row.overall_score}/5`);
        if (!parts.length || !row.candidate_id) return null;
        return {
          entity_type: "candidate", entity_id: row.candidate_id as string, chunk_type: "evaluation",
          content: parts.join("\n"),
          metadata: { job_id: row.job_id, job_title: row.job_title, date: row.created_at },
        };
      });
    }

    console.log("backfill-knowledge-lake complete:", JSON.stringify(stats));

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("backfill-knowledge-lake error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
