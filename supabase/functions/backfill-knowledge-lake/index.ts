import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import {
  adaptAirtableHistory,
  adaptCallData,
  adaptLinkedInProfile,
  adaptQualificationSession,
  adaptSequenceHistory,
  type Chunk,
} from "../_shared/rag-adapters.ts";

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
  source_table?: string;
  source_id?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
}

async function ingestBatchDirect(
  svc: ReturnType<typeof createClient>,
  openaiKey: string,
  orgId: string,
  chunks: ChunkToIngest[],
): Promise<{ ingested: number; skipped: number; errors: number }> {
  if (!chunks.length) return { ingested: 0, skipped: 0, errors: 0 };

  const hashes = await Promise.all(chunks.map(c => sha256Hex(c.content)));

  const { data: existing } = await svc
    .from("knowledge_chunks")
    .select("content_hash")
    .eq("organization_id", orgId)
    .in("content_hash", hashes);

  const existingSet = new Set((existing ?? []).map((r: { content_hash: string }) => r.content_hash));

  const toEmbed: { chunk: ChunkToIngest; hash: string }[] = [];
  let skipped = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (existingSet.has(hashes[i])) { skipped++; }
    else { toEmbed.push({ chunk: chunks[i], hash: hashes[i] }); }
  }

  if (!toEmbed.length) return { ingested: 0, skipped, errors: 0 };

  const allEmbeddings: number[][] = [];
  for (let i = 0; i < toEmbed.length; i += 2048) {
    const slice = toEmbed.slice(i, i + 2048);
    const embeddings = await callOpenAIEmbeddings(openaiKey, slice.map(s => s.chunk.content));
    allEmbeddings.push(...embeddings);
  }

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
      source_table: chunk.source_table ?? null,
      source_id: chunk.source_id ?? null,
      metadata: chunk.metadata ?? {},
      expires_at: chunk.expires_at ?? null,
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

// ── Adapter: convert rag-adapters Chunk[] to ChunkToIngest[] ───────────

function toIngestChunks(entityType: string, entityId: string, adapterChunks: Chunk[]): ChunkToIngest[] {
  return adapterChunks.map(c => ({
    entity_type: entityType,
    entity_id: entityId,
    chunk_type: c.chunk_type,
    content: c.content,
    source_table: c.source_table,
    source_id: c.source_id,
    metadata: c.metadata,
    expires_at: c.expires_at,
  }));
}

// ── All supported sources ──────────────────────────────────────────────

const ALL_TABLES = [
  "job_candidate_status",
  "candidate_notes",
  "candidate_comments",
  "call_coaching_sessions",
  "candidate_evaluations",
  "candidate_profiles",
  "airtable_candidates",
  "airtable_notes",
  "airtable_shortlists",
  "sequence_step_executions",
  "aircall_calls",
];

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
    // Validate JWT or service_role
    const token = authHeader.replace('Bearer ', '');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (token !== serviceKey) {
      const _authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await (_authClient as any).auth.getUser();
      if (claimsError || !claimsData?.user?.id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const organizationId = body.organization_id as string;
    const tables = (body.tables as string[] | undefined) ?? ALL_TABLES;
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
    // deno-lint-ignore no-explicit-any
    const stats: Record<string, any> = {};

    // ── Helper: process a table ────────────────────────────────
    async function processTable(
      tableName: string,
      buildChunks: (row: Record<string, unknown>) => ChunkToIngest[],
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

        const chunksToIngest: ChunkToIngest[] = [];
        for (const row of rows) {
          const chunks = buildChunks(row as Record<string, unknown>);
          chunksToIngest.push(...chunks);
          tableStat.processed++;
          totalProcessed++;
        }

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
        if (!candidateId) return [];

        const allChunks: ChunkToIngest[] = [];

        // A. Extract full LinkedIn profile via adapter if linkedin_profile_data exists
        if (row.linkedin_profile_data && typeof row.linkedin_profile_data === 'object') {
          const profileChunks = adaptLinkedInProfile(row.linkedin_profile_data as Record<string, unknown>);
          for (const pc of profileChunks) {
            allChunks.push({
              entity_type: "candidate",
              entity_id: candidateId,
              chunk_type: pc.chunk_type,
              content: pc.content,
              source_table: pc.source_table,
              source_id: pc.source_id,
              metadata: { ...pc.metadata, job_id: row.job_id, source: "linkedin_profile" },
            });
          }
        }

        // B. Fallback: minimal chunk if no linkedin_profile_data or adapter returned nothing
        if (allChunks.length === 0) {
          const content = [
            row.candidate_name ? `Candidat: ${row.candidate_name}` : null,
            row.candidate_headline ? `Titre: ${row.candidate_headline}` : null,
            row.job_title ? `Poste visé: ${row.job_title}` : null,
            row.stage ? `Étape: ${row.stage}` : null,
          ].filter(Boolean).join("\n");
          if (content) {
            allChunks.push({
              entity_type: "candidate", entity_id: candidateId,
              chunk_type: "profile", content,
              metadata: { job_id: row.job_id, stage: row.stage },
            });
          }
        }

        return allChunks;
      });
    }

    if (tables.includes("candidate_notes")) {
      await processTable("candidate_notes", (row) => {
        const content = row.content as string;
        if (!content?.trim() || !row.candidate_id) return [];
        return [{
          entity_type: "candidate", entity_id: row.candidate_id as string, chunk_type: "note",
          content, source_table: "candidate_notes", source_id: row.id as string,
          metadata: { created_by: row.created_by, date: row.created_at },
        }];
      });
    }

    if (tables.includes("candidate_comments")) {
      await processTable("candidate_comments", (row) => {
        const content = row.content as string;
        if (!content?.trim() || !row.candidate_id) return [];
        return [{
          entity_type: "candidate", entity_id: row.candidate_id as string, chunk_type: "note",
          content: `[Commentaire] ${content}`, source_table: "candidate_comments", source_id: row.id as string,
          metadata: { created_by: row.created_by, job_id: row.job_id, date: row.created_at },
        }];
      });
    }

    if (tables.includes("call_coaching_sessions")) {
      await processTable("call_coaching_sessions", (row) => {
        if (!row.candidate_id) return [];
        const adapterChunks = adaptCallData(
          { started_at: row.created_at, duration: row.duration_seconds, direction: "outbound" },
          row.transcript as string | undefined,
          row.report,
        );
        return toIngestChunks("candidate", row.candidate_id as string, adapterChunks);
      });
    }

    if (tables.includes("candidate_evaluations")) {
      await processTable("candidate_evaluations", (row) => {
        if (!row.candidate_id) return [];
        const adapterChunks = adaptQualificationSession({
          id: row.id,
          verdict: row.recommendation,
          notes: row.follow_up_notes || row.summary,
          scoring_summary: row.ratings,
          job_title: row.job_title,
          event_start_at: row.created_at,
          job_id: row.job_id,
        });
        return toIngestChunks("candidate", row.candidate_id as string, adapterChunks);
      });
    }

    if (tables.includes("candidate_profiles")) {
      await processTable("candidate_profiles", (row) => {
        const candidateId = row.candidate_id as string;
        if (!candidateId) return [];
        const lines: string[] = [];
        if (row.name) lines.push(`Nom: ${row.name}`);
        if (row.headline) lines.push(`Titre: ${row.headline}`);
        if (row.summary) lines.push(`Résumé: ${(row.summary as string).substring(0, 800)}`);
        if (row.skills && (row.skills as string[]).length > 0) lines.push(`Compétences: ${(row.skills as string[]).join(', ')}`);
        if (lines.length < 2) return []; // Skip near-empty profiles
        return [{
          entity_type: "candidate", entity_id: candidateId, chunk_type: "profile",
          content: lines.join("\n"), source_table: "candidate_profiles", source_id: row.id as string,
          metadata: { name: row.name, headline: row.headline, date: row.updated_at },
        }];
      });
    }

    // ── New sources ────────────────────────────────────────────

    if (tables.includes("airtable_candidates")) {
      await processTable("airtable_candidates", (row) => {
        const name = (row.full_name || row.first_name || "") as string;
        if (!name.trim()) return [];
        const lines = [
          name.trim(),
          row.experience ? `Expérience: ${row.experience}` : null,
          row.education_level ? `Formation: ${row.education_level}` : null,
          row.skills && (row.skills as string[]).length > 0 ? `Compétences: ${(row.skills as string[]).join(", ")}` : null,
          row.status ? `Statut: ${row.status}` : null,
        ].filter(Boolean).join("\n");
        return [{
          entity_type: "candidate", entity_id: row.airtable_id as string, chunk_type: "profile",
          content: lines, source_table: "airtable_candidates", source_id: row.airtable_id as string,
          metadata: { name, source_base: row.source_base, date: row.synced_at },
        }];
      });
    }

    if (tables.includes("airtable_notes")) {
      await processTable("airtable_notes", (row) => {
        if (!row.candidate_airtable_id || (!row.detail && !row.title)) return [];
        const adapterChunks = adaptAirtableHistory({
          notes: [{ title: row.title, detail: row.detail, airtable_id: row.airtable_id, note_date: row.note_date, author: row.author, note_type: row.note_type }],
        });
        return toIngestChunks("candidate", row.candidate_airtable_id as string, adapterChunks);
      });
    }

    if (tables.includes("airtable_shortlists")) {
      await processTable("airtable_shortlists", (row) => {
        if (!row.candidate_airtable_id) return [];
        const adapterChunks = adaptAirtableHistory({
          shortlists: [{ job_title: row.job_airtable_id, company_name: row.company_airtable_id, date_added: row.date_added, status: row.status }],
        });
        return toIngestChunks("candidate", row.candidate_airtable_id as string, adapterChunks);
      });
    }

    if (tables.includes("sequence_step_executions")) {
      // Group by enrollment_id, process sent/replied steps
      const execStat = { processed: 0, ingested: 0, skipped: 0, errors: 0 };
      // Get distinct enrollment_ids
      const { data: enrollments } = await svc
        .from("sequence_enrollments")
        .select("id, profile_id, organization_id")
        .eq("organization_id", organizationId)
        .range(startOffset, startOffset + maxRows - 1);

      if (enrollments) {
        for (const enrollment of enrollments) {
          const { data: executions } = await svc
            .from("sequence_step_executions")
            .select("*, step:step_id(action_type)")
            .eq("enrollment_id", enrollment.id)
            .in("status", ["sent", "replied"])
            .order("step_order", { ascending: true })
            .limit(20);

          if (!executions?.length) continue;

          const adapterChunks = adaptSequenceHistory(executions);
          const ingestChunks = toIngestChunks("candidate", enrollment.profile_id, adapterChunks);

          if (ingestChunks.length > 0) {
            try {
              const result = await ingestBatchDirect(svc, openaiKey, organizationId, ingestChunks);
              execStat.ingested += result.ingested;
              execStat.skipped += result.skipped;
              execStat.errors += result.errors;
            } catch (e) {
              console.error("Batch error on sequence_step_executions:", e instanceof Error ? e.message : String(e));
              execStat.errors += ingestChunks.length;
            }
          }
          execStat.processed++;
        }
      }
      stats["sequence_step_executions"] = execStat;
    }

    if (tables.includes("aircall_calls")) {
      await processTable("aircall_calls", (row) => {
        const notes = row.notes as string | undefined;
        const recording = row.recording_url as string | undefined;
        if (!notes && !recording) return [];
        // Use matched candidate ID or fallback to aircall_id
        const entityId = (row.matched_airtable_candidate_id || row.matched_linkedin_profile_id || `aircall_${row.aircall_id}`) as string;
        const adapterChunks = adaptCallData(
          { started_at: row.started_at, duration: row.duration, direction: row.direction },
          notes || undefined,
          undefined, // no report for raw aircall calls
        );
        return toIngestChunks("candidate", entityId, adapterChunks);
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
