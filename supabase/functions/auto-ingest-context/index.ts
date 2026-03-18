// supabase/functions/auto-ingest-context/index.ts
// Called by Database Webhooks (pg_net) when source data changes.
// Routes to the correct RAG adapter and calls ingest-context internally.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import {
  adaptLinkedInProfile,
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

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, any>;
  old_record?: Record<string, any> | null;
}

interface Chunk {
  chunk_type: string;
  content: string;
  source_table?: string;
  source_id?: string;
  metadata?: Record<string, any>;
  expires_at?: string;
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── 1. Auth check — getClaims pattern ────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const _supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: claimsData, error: claimsError } =
      // deno-lint-ignore no-explicit-any
      await (_supabaseAuth.auth as any).getClaims(authHeader.replace("Bearer ", ""));

    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId = claimsData.claims.sub;

    // Service client (pour les opérations DB)
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 2. Rate limit ───────────────────────────────────────────────
    const { data: allowed } = await svc.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "auto_ingest_context",
      p_max_requests: 60,
      p_window_seconds: 60,
    });

    if (allowed === false) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Parse webhook payload ────────────────────────────────────
    let payload: WebhookPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { type, table, record, old_record } = payload;

    if (!type || !table || !record) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: type, table, record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 4. Handle DELETE — log warning, no-op ───────────────────────
    if (type === "DELETE") {
      console.warn(
        `[auto-ingest] DELETE on ${table} — chunk deletion not implemented yet. Record id: ${record.id ?? "unknown"}`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "delete_skipped", table }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 5. Resolve organization_id ──────────────────────────────────
    let organizationId: string | null = record.organization_id ?? null;

    if (!organizationId && record.created_by) {
      const { data: profile } = await svc
        .from("profiles")
        .select("active_organization_id")
        .eq("user_id", record.created_by)
        .maybeSingle();
      organizationId = profile?.active_organization_id ?? null;
    }

    if (!organizationId) {
      console.warn(
        `[auto-ingest] Could not resolve organization_id for ${table} record ${record.id ?? "unknown"}. Skipping.`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "skipped_no_org", table }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 6. Route to adapter by table ────────────────────────────────
    let chunks: Chunk[] = [];
    let entityType = "candidate";
    let entityId: string | null = null;

    switch (table) {
      // ── a. job_candidate_status ───────────────────────────────────
      case "job_candidate_status": {
        // Only process if linkedin_profile_data changed (or INSERT)
        if (
          type === "INSERT" ||
          JSON.stringify(record.linkedin_profile_data) !==
            JSON.stringify(old_record?.linkedin_profile_data)
        ) {
          if (record.linkedin_profile_data) {
            chunks = adaptLinkedInProfile(record.linkedin_profile_data);
          }
        }
        entityType = "candidate";
        entityId = record.candidate_id;
        break;
      }

      // ── b. candidate_notes ────────────────────────────────────────
      case "candidate_notes": {
        if (type === "INSERT" && (record.content || record.detail)) {
          chunks = [
            {
              chunk_type: "note",
              content: record.content || record.detail,
              source_table: "candidate_notes",
              source_id: record.id,
            },
          ];
        }
        entityType = "candidate";
        entityId = record.candidate_id;
        break;
      }

      // ── b. candidate_comments ─────────────────────────────────────
      case "candidate_comments": {
        if (type === "INSERT" && (record.content || record.detail)) {
          chunks = [
            {
              chunk_type: "note",
              content: record.content || record.detail,
              source_table: "candidate_comments",
              source_id: record.id,
            },
          ];
        }
        entityType = "candidate";
        entityId = record.candidate_id;
        break;
      }

      // ── c. call_coaching_sessions ─────────────────────────────────
      case "call_coaching_sessions": {
        // Process if transcript or report changed (or INSERT)
        if (
          type === "INSERT" ||
          record.transcript !== old_record?.transcript ||
          JSON.stringify(record.report) !== JSON.stringify(old_record?.report)
        ) {
          // Pass record as call object — it has id, created_at, etc.
          chunks = adaptCallData(record, record.transcript, record.report);
        }
        entityType = "candidate";
        entityId = record.candidate_id;
        break;
      }

      // ── d. qualification_sessions ─────────────────────────────────
      case "qualification_sessions": {
        if (
          type === "INSERT" ||
          record.notes !== old_record?.notes ||
          record.verdict !== old_record?.verdict
        ) {
          chunks = adaptQualificationSession(record);
        }
        entityType = "candidate";
        entityId = record.candidate_profile_id;
        break;
      }

      // ── e. sequence_step_executions ───────────────────────────────
      case "sequence_step_executions": {
        if (record.status === "sent" && (!old_record || old_record.status !== "sent")) {
          // Fetch enrollment to get profile_id
          const { data: enrollment } = await svc
            .from("sequence_enrollments")
            .select("profile_id")
            .eq("id", record.enrollment_id)
            .maybeSingle();

          if (enrollment?.profile_id) {
            entityId = enrollment.profile_id;

            // Fetch all executions for this enrollment
            const { data: executions } = await svc
              .from("sequence_step_executions")
              .select("*")
              .eq("enrollment_id", record.enrollment_id)
              .order("created_at", { ascending: true });

            if (executions && executions.length > 0) {
              chunks = adaptSequenceHistory(executions);
            }
          } else {
            console.warn(
              `[auto-ingest] Could not find enrollment ${record.enrollment_id} for sequence_step_executions`,
            );
          }
        }
        entityType = "candidate";
        break;
      }

      default: {
        console.warn(`[auto-ingest] Unhandled table: ${table}. Skipping.`);
        return new Response(
          JSON.stringify({ success: true, action: "skipped_unhandled_table", table }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── 7. Validate we have data to ingest ──────────────────────────
    if (chunks.length === 0 || !entityId) {
      console.log(
        `[auto-ingest] No chunks generated for ${table} (type=${type}). entity_id=${entityId ?? "null"}. Skipping ingest.`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "no_chunks", table, entity_id: entityId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 8. Call ingest-context internally ────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const ingestPayload = {
      organization_id: organizationId,
      entity_type: entityType,
      entity_id: entityId,
      chunks,
    };

    console.log(
      `[auto-ingest] Sending ${chunks.length} chunk(s) to ingest-context for ${entityType}/${entityId} from ${table}`,
    );

    const ingestRes = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/ingest-context`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ingestPayload),
      },
      30000, // 30s timeout — embedding can take time
    );

    if (!ingestRes.ok) {
      const errBody = await ingestRes.text();
      console.error(
        `[auto-ingest] ingest-context returned ${ingestRes.status}: ${errBody}`,
      );
      return new Response(
        JSON.stringify({
          error: `ingest-context failed: ${ingestRes.status}`,
          detail: errBody,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let ingestResult;
    try {
      ingestResult = await ingestRes.json();
    } catch {
      ingestResult = { raw: await ingestRes.text() };
    }

    return new Response(
      JSON.stringify({
        success: true,
        table,
        type,
        entity_type: entityType,
        entity_id: entityId,
        chunks_sent: chunks.length,
        ingest_result: ingestResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[auto-ingest] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
