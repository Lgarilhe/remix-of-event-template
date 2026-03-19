import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helpers ────────────────────────────────────────────────────────────

async function ingestBatch(
  supabaseUrl: string,
  serviceKey: string,
  orgId: string,
  entityType: string,
  entityId: string,
  chunks: Array<{ chunk_type: string; content: string; metadata?: Record<string, unknown> }>,
): Promise<{ ingested: number; updated: number; skipped: number }> {
  if (!chunks.length) return { ingested: 0, updated: 0, skipped: 0 };

  const res = await fetch(`${supabaseUrl}/functions/v1/ingest-context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      organization_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      chunks,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Ingest failed for ${entityType}/${entityId}: ${res.status} ${errText}`);
    return { ingested: 0, updated: 0, skipped: 0 };
  }

  return await res.json();
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check — only allow service role or authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const organizationId = body.organization_id as string;
    const tables = (body.tables as string[] | undefined) ?? [
      "job_candidate_status",
      "candidate_notes",
      "candidate_comments",
      "call_coaching_sessions",
      "candidate_evaluations",
    ];
    const batchSize = (body.batch_size as number) || 100;

    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const stats: Record<string, { processed: number; ingested: number; errors: number }> = {};

    // ── Backfill job_candidate_status ───────────────────────────
    if (tables.includes("job_candidate_status")) {
      const tableStat = { processed: 0, ingested: 0, errors: 0 };
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: rows, error } = await svc
          .from("job_candidate_status")
          .select("*")
          .eq("organization_id", organizationId)
          .range(offset, offset + batchSize - 1);

        if (error || !rows?.length) {
          hasMore = false;
          break;
        }

        for (let ri = 0; ri < rows.length; ri++) {
          const row = rows[ri];
          try {
            const content = [
              `Candidat: ${row.candidate_name || "N/A"}`,
              row.job_title ? `Poste: ${row.job_title}` : null,
              `Étape: ${row.stage || "unknown"}`,
              row.source ? `Source: ${row.source}` : null,
            ].filter(Boolean).join("\n");

            const result = await ingestBatch(supabaseUrl, serviceKey, organizationId, "candidate", row.candidate_id, [
              { chunk_type: "profile", content, metadata: { job_id: row.job_id, stage: row.stage, date: row.updated_at } },
            ]);
            tableStat.ingested += result.ingested;
            // Small delay to avoid OpenAI rate limits
            if (ri % 10 === 9) await new Promise(r => setTimeout(r, 500));
          } catch (e) {
            if (tableStat.errors < 3) console.error(`backfill jcs error [${offset + ri}]:`, e instanceof Error ? e.message : String(e));
            tableStat.errors++;
          }
          tableStat.processed++;
        }

        offset += batchSize;
        if (rows.length < batchSize) hasMore = false;
      }
      stats.job_candidate_status = tableStat;
    }

    // ── Backfill candidate_notes ───────────────────────────────
    if (tables.includes("candidate_notes")) {
      const tableStat = { processed: 0, ingested: 0, errors: 0 };
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: rows, error } = await svc
          .from("candidate_notes")
          .select("*")
          .eq("organization_id", organizationId)
          .range(offset, offset + batchSize - 1);

        if (error || !rows?.length) { hasMore = false; break; }

        for (const row of rows) {
          if (!row.content?.trim()) { tableStat.processed++; continue; }
          try {
            const result = await ingestBatch(supabaseUrl, serviceKey, organizationId, "candidate", row.candidate_id, [
              { chunk_type: "note", content: row.content, metadata: { created_by: row.created_by, date: row.created_at } },
            ]);
            tableStat.ingested += result.ingested;
          } catch {
            tableStat.errors++;
          }
          tableStat.processed++;
        }

        offset += batchSize;
        if (rows.length < batchSize) hasMore = false;
      }
      stats.candidate_notes = tableStat;
    }

    // ── Backfill candidate_comments ────────────────────────────
    if (tables.includes("candidate_comments")) {
      const tableStat = { processed: 0, ingested: 0, errors: 0 };
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: rows, error } = await svc
          .from("candidate_comments")
          .select("*")
          .eq("organization_id", organizationId)
          .range(offset, offset + batchSize - 1);

        if (error || !rows?.length) { hasMore = false; break; }

        for (const row of rows) {
          if (!row.content?.trim()) { tableStat.processed++; continue; }
          try {
            const result = await ingestBatch(supabaseUrl, serviceKey, organizationId, "candidate", row.candidate_id, [
              { chunk_type: "note", content: `[Commentaire] ${row.content}`, metadata: { created_by: row.created_by, job_id: row.job_id, date: row.created_at } },
            ]);
            tableStat.ingested += result.ingested;
          } catch {
            tableStat.errors++;
          }
          tableStat.processed++;
        }

        offset += batchSize;
        if (rows.length < batchSize) hasMore = false;
      }
      stats.candidate_comments = tableStat;
    }

    // ── Backfill call_coaching_sessions ─────────────────────────
    if (tables.includes("call_coaching_sessions")) {
      const tableStat = { processed: 0, ingested: 0, errors: 0 };
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: rows, error } = await svc
          .from("call_coaching_sessions")
          .select("*")
          .eq("organization_id", organizationId)
          .range(offset, offset + batchSize - 1);

        if (error || !rows?.length) { hasMore = false; break; }

        for (const row of rows) {
          const parts: string[] = [];
          if (row.transcript) parts.push(`Transcription: ${row.transcript}`);
          if (row.report) parts.push(`Rapport: ${JSON.stringify(row.report)}`);
          if (!parts.length) { tableStat.processed++; continue; }

          try {
            const result = await ingestBatch(supabaseUrl, serviceKey, organizationId, "candidate", row.candidate_id, [
              { chunk_type: "call_transcript", content: parts.join("\n\n"), metadata: { job_id: row.job_id, date: row.created_at } },
            ]);
            tableStat.ingested += result.ingested;
          } catch {
            tableStat.errors++;
          }
          tableStat.processed++;
        }

        offset += batchSize;
        if (rows.length < batchSize) hasMore = false;
      }
      stats.call_coaching_sessions = tableStat;
    }

    // ── Backfill candidate_evaluations ─────────────────────────
    if (tables.includes("candidate_evaluations")) {
      const tableStat = { processed: 0, ingested: 0, errors: 0 };
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: rows, error } = await svc
          .from("candidate_evaluations")
          .select("*")
          .eq("organization_id", organizationId)
          .range(offset, offset + batchSize - 1);

        if (error || !rows?.length) { hasMore = false; break; }

        for (const row of rows) {
          const parts: string[] = [];
          if (row.summary) parts.push(`Résumé: ${row.summary}`);
          if (row.recommendation) parts.push(`Recommandation: ${row.recommendation}`);
          if (row.follow_up_notes) parts.push(`Notes: ${row.follow_up_notes}`);
          if (row.overall_score) parts.push(`Score: ${row.overall_score}/5`);
          if (!parts.length) { tableStat.processed++; continue; }

          try {
            const result = await ingestBatch(supabaseUrl, serviceKey, organizationId, "candidate", row.candidate_id, [
              { chunk_type: "evaluation", content: parts.join("\n"), metadata: { job_id: row.job_id, job_title: row.job_title, date: row.created_at } },
            ]);
            tableStat.ingested += result.ingested;
          } catch {
            tableStat.errors++;
          }
          tableStat.processed++;
        }

        offset += batchSize;
        if (rows.length < batchSize) hasMore = false;
      }
      stats.candidate_evaluations = tableStat;
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
