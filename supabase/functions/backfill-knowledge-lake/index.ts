// supabase/functions/backfill-knowledge-lake/index.ts
// Job one-shot (relançable) : parcourt toutes les données existantes
// et les ingère dans le Knowledge Lake via ingest-context.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import {
  adaptLinkedInProfile,
  adaptAirtableHistory,
  adaptCallData,
  adaptQualificationSession,
  adaptSequenceHistory,
} from "../_shared/rag-adapters.ts";

// ── CORS Headers ───────────────────────────────────────────────────────
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

type SourceName = "profiles" | "airtable" | "calls" | "qualifications" | "sequences" | "notes";

const ALL_SOURCES: SourceName[] = ["profiles", "airtable", "calls", "qualifications", "sequences", "notes"];

interface BackfillParams {
  organization_id?: string;
  sources?: SourceName[] | ["all"];
  batch_size?: number;
  dry_run?: boolean;
}

interface SourceReport {
  candidates: number;
  chunks: number;
}

interface BackfillReport {
  organizations_processed: number;
  sources: Record<string, SourceReport>;
  total_chunks: number;
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────

function extractLinkedInSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// deno-lint-ignore no-explicit-any
async function callIngestContext(
  supabaseUrl: string,
  anonKey: string,
  payload: { organization_id: string; entity_type: string; entity_id: string; chunks: any[] },
): Promise<{ ingested: number; updated: number; skipped: number }> {
  const res = await fetchWithTimeout(
    `${supabaseUrl}/functions/v1/ingest-context`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    30000, // longer timeout for ingestion
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ingest-context returned ${res.status}: ${errText}`);
  }

  return await res.json();
}

// ── Source Processors ──────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function processProfiles(
  svc: any,
  orgId: string,
  batchSize: number,
  dryRun: boolean,
  supabaseUrl: string,
  anonKey: string,
  errors: string[],
): Promise<SourceReport> {
  const report: SourceReport = { candidates: 0, chunks: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: rows, error } = await svc
      .from("job_candidate_status")
      .select("id, candidate_id, linkedin_profile_data, organization_id")
      .eq("organization_id", orgId)
      .not("linkedin_profile_data", "is", null)
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[profiles] Query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      try {
        const chunks = adaptLinkedInProfile(row.linkedin_profile_data);
        if (chunks.length === 0) continue;

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: row.candidate_id,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[profiles] Candidate ${row.candidate_id} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: profiles - ${offset + rows.length} processed, ${report.chunks} chunks`);

    if (rows.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return report;
}

// deno-lint-ignore no-explicit-any
async function processAirtable(
  svc: any,
  orgId: string,
  batchSize: number,
  dryRun: boolean,
  supabaseUrl: string,
  anonKey: string,
  errors: string[],
): Promise<SourceReport> {
  const report: SourceReport = { candidates: 0, chunks: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: candidates, error } = await svc
      .from("airtable_candidates")
      .select("airtable_id, full_name, linkedin_url, organization_id")
      .eq("organization_id", orgId)
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[airtable] Query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!candidates || candidates.length === 0) {
      hasMore = false;
      break;
    }

    for (const candidate of candidates) {
      try {
        const candidateAirtableId = candidate.airtable_id;

        // Fetch related data in parallel
        const [shortlistsRes, placementsRes, notesRes, appointmentsRes] = await Promise.all([
          svc.from("airtable_shortlists").select("*").eq("candidate_airtable_id", candidateAirtableId).eq("organization_id", orgId),
          svc.from("airtable_placements").select("*").eq("candidate_airtable_id", candidateAirtableId).eq("organization_id", orgId),
          svc.from("airtable_notes").select("*").eq("candidate_airtable_id", candidateAirtableId).eq("organization_id", orgId).order("note_date", { ascending: false }).limit(10),
          svc.from("airtable_appointments").select("*").eq("candidate_airtable_id", candidateAirtableId).eq("organization_id", orgId).order("appointment_date", { ascending: false }).limit(5),
        ]);

        const historyData = {
          shortlists: shortlistsRes.data || [],
          placements: placementsRes.data || [],
          notes: notesRes.data || [],
          appointments: appointmentsRes.data || [],
        };

        const chunks = adaptAirtableHistory(historyData);
        if (chunks.length === 0) continue;

        // entity_id: LinkedIn slug or airtable_id
        const entityId = extractLinkedInSlug(candidate.linkedin_url) || candidate.airtable_id;

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: entityId,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[airtable] Candidate ${candidate.airtable_id} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: airtable - ${offset + candidates.length} processed, ${report.chunks} chunks`);

    if (candidates.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return report;
}

// deno-lint-ignore no-explicit-any
async function processCalls(
  svc: any,
  orgId: string,
  batchSize: number,
  dryRun: boolean,
  supabaseUrl: string,
  anonKey: string,
  errors: string[],
): Promise<SourceReport> {
  const report: SourceReport = { candidates: 0, chunks: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: rows, error } = await svc
      .from("call_coaching_sessions")
      .select("id, candidate_id, transcript, report, organization_id, created_at")
      .eq("organization_id", orgId)
      .or("transcript.not.is.null,report.not.is.null")
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[calls] Query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      try {
        // adaptCallData expects (call, transcript?, report?)
        // Pass the row itself as the call object (it has id, created_at, etc.)
        const chunks = adaptCallData(row, row.transcript || undefined, row.report || undefined);
        if (chunks.length === 0) continue;

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: row.candidate_id,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[calls] Session ${row.id} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: calls - ${offset + rows.length} processed, ${report.chunks} chunks`);

    if (rows.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return report;
}

// deno-lint-ignore no-explicit-any
async function processQualifications(
  svc: any,
  orgId: string,
  batchSize: number,
  dryRun: boolean,
  supabaseUrl: string,
  anonKey: string,
  errors: string[],
): Promise<SourceReport> {
  const report: SourceReport = { candidates: 0, chunks: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: rows, error } = await svc
      .from("qualification_sessions")
      .select("id, candidate_linkedin_url, job_id, notes, verdict, scoring_summary, organization_id, created_at")
      .eq("organization_id", orgId)
      .or("notes.neq.,verdict.neq.pending")
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[qualifications] Query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      try {
        const chunks = adaptQualificationSession(row);
        if (chunks.length === 0) continue;

        // entity_id: LinkedIn slug from candidate_linkedin_url, or session id as fallback
        const entityId = extractLinkedInSlug(row.candidate_linkedin_url) || row.id;

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: entityId,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[qualifications] Session ${row.id} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: qualifications - ${offset + rows.length} processed, ${report.chunks} chunks`);

    if (rows.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return report;
}

// deno-lint-ignore no-explicit-any
async function processSequences(
  svc: any,
  orgId: string,
  batchSize: number,
  dryRun: boolean,
  supabaseUrl: string,
  anonKey: string,
  errors: string[],
): Promise<SourceReport> {
  const report: SourceReport = { candidates: 0, chunks: 0 };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch enrollments in batches
    const { data: enrollments, error } = await svc
      .from("sequence_enrollments")
      .select("id, profile_id, organization_id")
      .eq("organization_id", orgId)
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[sequences] Query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!enrollments || enrollments.length === 0) {
      hasMore = false;
      break;
    }

    // Group enrollments by profile_id to avoid duplicate ingestion
    // deno-lint-ignore no-explicit-any
    const byProfile = new Map<string, any[]>();
    for (const enr of enrollments) {
      if (!enr.profile_id) continue;
      if (!byProfile.has(enr.profile_id)) {
        byProfile.set(enr.profile_id, []);
      }
      byProfile.get(enr.profile_id)!.push(enr);
    }

    for (const [profileId, profileEnrollments] of byProfile) {
      try {
        // Fetch all sent executions for this candidate's enrollments
        const enrollmentIds = profileEnrollments.map((e: { id: string }) => e.id);
        const { data: executions } = await svc
          .from("sequence_step_executions")
          .select("*")
          .in("enrollment_id", enrollmentIds)
          .eq("status", "sent")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: true });

        if (!executions || executions.length === 0) continue;

        const chunks = adaptSequenceHistory(executions);
        if (chunks.length === 0) continue;

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: profileId,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[sequences] Profile ${profileId} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: sequences - ${offset + enrollments.length} enrollments processed, ${report.chunks} chunks`);

    if (enrollments.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return report;
}

// deno-lint-ignore no-explicit-any
async function processNotes(
  svc: any,
  orgId: string,
  batchSize: number,
  dryRun: boolean,
  supabaseUrl: string,
  anonKey: string,
  errors: string[],
): Promise<SourceReport> {
  const report: SourceReport = { candidates: 0, chunks: 0 };

  // Process candidate_notes
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: notes, error } = await svc
      .from("candidate_notes")
      .select("id, candidate_id, content, organization_id, created_at")
      .eq("organization_id", orgId)
      .not("content", "is", null)
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[notes] candidate_notes query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!notes || notes.length === 0) {
      hasMore = false;
      break;
    }

    for (const note of notes) {
      try {
        if (!note.content || !note.content.trim()) continue;

        const chunks = [{
          chunk_type: "note",
          content: note.content,
          source_table: "candidate_notes",
          source_id: note.id,
          metadata: { created_at: note.created_at },
        }];

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: note.candidate_id,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[notes] Note ${note.id} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: notes (candidate_notes) - ${offset + notes.length} processed, ${report.chunks} chunks`);

    if (notes.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  // Process candidate_comments
  offset = 0;
  hasMore = true;

  while (hasMore) {
    const { data: comments, error } = await svc
      .from("candidate_comments")
      .select("id, candidate_id, content, organization_id, created_at")
      .eq("organization_id", orgId)
      .not("content", "is", null)
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`[notes] candidate_comments query error org ${orgId}: ${error.message}`);
      break;
    }

    if (!comments || comments.length === 0) {
      hasMore = false;
      break;
    }

    for (const comment of comments) {
      try {
        if (!comment.content || !comment.content.trim()) continue;

        const chunks = [{
          chunk_type: "note",
          content: comment.content,
          source_table: "candidate_comments",
          source_id: comment.id,
          metadata: { created_at: comment.created_at },
        }];

        report.candidates++;
        report.chunks += chunks.length;

        if (!dryRun) {
          await callIngestContext(supabaseUrl, anonKey, {
            organization_id: orgId,
            entity_type: "candidate",
            entity_id: comment.candidate_id,
            chunks,
          });
        }
      } catch (err) {
        const msg = `[notes] Comment ${comment.id} in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`[backfill] Org ${orgId}: notes (candidate_comments) - ${offset + comments.length} processed, ${report.chunks} chunks`);

    if (comments.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return report;
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── 1. Auth check — service_role uniquement ─────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (token !== serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Forbidden — service_role only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Service client (opérations DB sans RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = createClient(supabaseUrl, serviceRoleKey!);

    // ── 2. Parse body params ────────────────────────────────────────
    let params: BackfillParams = {};
    try {
      params = await req.json();
    } catch {
      // Empty body is fine — use defaults
    }

    const targetOrgId = params.organization_id || null;
    const requestedSources: SourceName[] =
      !params.sources || (params.sources.length === 1 && params.sources[0] === "all")
        ? ALL_SOURCES
        : params.sources as SourceName[];
    const batchSize = params.batch_size || 50;
    const dryRun = params.dry_run === true;

    console.log(`[backfill] Starting. dry_run=${dryRun}, batch_size=${batchSize}, sources=${requestedSources.join(",")}, org=${targetOrgId || "ALL"}`);

    // ── 3. Determine organizations to process ───────────────────────
    let orgIds: string[] = [];

    if (targetOrgId) {
      orgIds = [targetOrgId];
    } else {
      const { data: orgs, error: orgsError } = await svc
        .from("organizations")
        .select("id");

      if (orgsError) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch organizations: ${orgsError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      orgIds = (orgs || []).map((o: { id: string }) => o.id);
    }

    console.log(`[backfill] Processing ${orgIds.length} organization(s)`);

    // ── 4. Process each organization ────────────────────────────────
    const globalReport: BackfillReport = {
      organizations_processed: 0,
      sources: {},
      total_chunks: 0,
      errors: [],
    };

    // Initialize source reports
    for (const src of requestedSources) {
      globalReport.sources[src] = { candidates: 0, chunks: 0 };
    }

    // Map source names to processor functions
    const processors: Record<SourceName, (
      // deno-lint-ignore no-explicit-any
      svc: any,
      orgId: string,
      batchSize: number,
      dryRun: boolean,
      supabaseUrl: string,
      anonKey: string,
      errors: string[],
    ) => Promise<SourceReport>> = {
      profiles: processProfiles,
      airtable: processAirtable,
      calls: processCalls,
      qualifications: processQualifications,
      sequences: processSequences,
      notes: processNotes,
    };

    for (const orgId of orgIds) {
      console.log(`[backfill] === Org ${orgId} ===`);

      for (const source of requestedSources) {
        try {
          console.log(`[backfill] Org ${orgId}: starting source "${source}"`);

          const sourceReport = await processors[source](
            svc, orgId, batchSize, dryRun, supabaseUrl, anonKey, globalReport.errors,
          );

          globalReport.sources[source].candidates += sourceReport.candidates;
          globalReport.sources[source].chunks += sourceReport.chunks;
          globalReport.total_chunks += sourceReport.chunks;

          console.log(`[backfill] Org ${orgId}: "${source}" done — ${sourceReport.candidates} candidates, ${sourceReport.chunks} chunks`);
        } catch (err) {
          const msg = `[${source}] Fatal error for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(msg);
          globalReport.errors.push(msg);
        }
      }

      globalReport.organizations_processed++;
    }

    // ── 5. Return report ────────────────────────────────────────────
    console.log(`[backfill] Complete. ${globalReport.organizations_processed} orgs, ${globalReport.total_chunks} total chunks, ${globalReport.errors.length} errors${dryRun ? " (DRY RUN)" : ""}`);

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        report: globalReport,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[backfill] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
