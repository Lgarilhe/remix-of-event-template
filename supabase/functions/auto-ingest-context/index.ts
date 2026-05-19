import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { adaptLinkedInProfile, adaptSourcingProject, type Chunk } from "../_shared/rag-adapters.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Types ──────────────────────────────────────────────────────────────
interface TriggerPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}

// ── Chunk builders per table ───────────────────────────────────────────

function buildChunksFromJobCandidateStatus(record: Record<string, unknown>): {
  entity_type: string;
  entity_id: string;
  organization_id: string;
  chunks: Array<{ chunk_type: string; content: string; metadata?: Record<string, unknown> }>;
} | null {
  const orgId = record.organization_id as string;
  const candidateId = record.candidate_id as string;
  const jobId = record.job_id as string;
  if (!orgId || !candidateId) return null;

  const chunks: Array<{ chunk_type: string; content: string; metadata?: Record<string, unknown> }> = [];

  // A. Extract full LinkedIn profile via adapter if linkedin_profile_data exists
  if (record.linkedin_profile_data && typeof record.linkedin_profile_data === 'object') {
    const profileChunks = adaptLinkedInProfile(record.linkedin_profile_data as Record<string, unknown>);
    for (const pc of profileChunks) {
      chunks.push({
        chunk_type: pc.chunk_type,
        content: pc.content,
        metadata: { ...pc.metadata, job_id: jobId, source: "linkedin_profile" },
      });
    }
  }

  // B. Fallback: minimal chunk if no linkedin_profile_data
  if (chunks.length === 0) {
    const stage = record.stage as string || "unknown";
    const candidateName = record.candidate_name as string || "Candidat";
    const jobTitle = record.job_title as string || "";
    const source = record.source as string || "";
    const updatedAt = record.updated_at as string || new Date().toISOString();

    const content = [
      `Candidat: ${candidateName}`,
      jobTitle ? `Poste: ${jobTitle}` : null,
      `Étape pipeline: ${stage}`,
      source ? `Source: ${source}` : null,
      `Dernière mise à jour: ${updatedAt}`,
    ].filter(Boolean).join("\n");

    chunks.push({
      chunk_type: "profile",
      content,
      metadata: { job_id: jobId, stage, source, date: updatedAt },
    });
  }

  return {
    entity_type: "candidate",
    entity_id: candidateId,
    organization_id: orgId,
    chunks,
  };
}

function buildChunksFromCandidateNotes(record: Record<string, unknown>) {
  const orgId = record.organization_id as string;
  const candidateId = record.candidate_id as string;
  if (!orgId || !candidateId) return null;

  const content = record.content as string || "";
  if (!content.trim()) return null;

  return {
    entity_type: "candidate",
    entity_id: candidateId,
    organization_id: orgId,
    chunks: [{
      chunk_type: "note",
      content,
      metadata: {
        created_by: record.created_by,
        shortlist_id: record.shortlist_id,
        date: record.created_at || new Date().toISOString(),
      },
    }],
  };
}

function buildChunksFromCandidateComments(record: Record<string, unknown>) {
  const orgId = record.organization_id as string;
  const candidateId = record.candidate_id as string;
  if (!orgId || !candidateId) return null;

  const content = record.content as string || "";
  if (!content.trim()) return null;

  return {
    entity_type: "candidate",
    entity_id: candidateId,
    organization_id: orgId,
    chunks: [{
      chunk_type: "note",
      content: `[Commentaire] ${content}`,
      metadata: {
        created_by: record.created_by,
        job_id: record.job_id,
        date: record.created_at || new Date().toISOString(),
      },
    }],
  };
}

function buildChunksFromCoachingSessions(record: Record<string, unknown>) {
  const orgId = record.organization_id as string;
  const candidateId = record.candidate_id as string;
  if (!orgId || !candidateId) return null;

  const parts: string[] = [];
  if (record.transcript) parts.push(`Transcription: ${record.transcript}`);
  if (record.report) parts.push(`Rapport: ${JSON.stringify(record.report)}`);
  if (!parts.length) return null;

  return {
    entity_type: "candidate",
    entity_id: candidateId,
    organization_id: orgId,
    chunks: [{
      chunk_type: "call_transcript",
      content: parts.join("\n\n"),
      metadata: {
        job_id: record.job_id,
        scorecard_id: record.scorecard_id,
        status: record.status,
        date: record.created_at || new Date().toISOString(),
      },
    }],
  };
}

function buildChunksFromEvaluations(record: Record<string, unknown>) {
  const orgId = record.organization_id as string;
  const candidateId = record.candidate_id as string;
  if (!orgId || !candidateId) return null;

  const parts: string[] = [];
  if (record.summary) parts.push(`Résumé: ${record.summary}`);
  if (record.recommendation) parts.push(`Recommandation: ${record.recommendation}`);
  if (record.follow_up_notes) parts.push(`Notes de suivi: ${record.follow_up_notes}`);
  if (record.overall_score) parts.push(`Score global: ${record.overall_score}/5`);
  if (!parts.length) return null;

  return {
    entity_type: "candidate",
    entity_id: candidateId,
    organization_id: orgId,
    chunks: [{
      chunk_type: "evaluation",
      content: parts.join("\n"),
      metadata: {
        job_id: record.job_id,
        job_title: record.job_title,
        interview_stage: record.interview_stage,
        ai_generated: record.ai_generated,
        date: record.created_at || new Date().toISOString(),
      },
    }],
  };
}

function buildChunksFromSequenceExecutions(record: Record<string, unknown>) {
  const orgId = record.organization_id as string;
  const candidateId = record.candidate_linkedin_id as string || record.candidate_id as string;
  if (!orgId || !candidateId) return null;

  const messageContent = record.message_content as string || record.actual_content as string || "";
  if (!messageContent.trim()) return null;

  return {
    entity_type: "candidate",
    entity_id: candidateId,
    organization_id: orgId,
    chunks: [{
      chunk_type: "sequence_history",
      content: `[Séquence outreach] ${messageContent}`,
      metadata: {
        step_type: record.step_type,
        status: record.status,
        sequence_enrollment_id: record.sequence_enrollment_id,
        date: record.executed_at || record.created_at || new Date().toISOString(),
      },
    }],
  };
}

// RAG v3 — mission/job : un row sourcing_projects → 1 chunk job_context
// (entity_type:'job', entity_id = project.id). adaptSourcingProject ne lit
// que les champs de brief → content_hash stable malgré le churn de stats.
function buildChunksFromSourcingProject(record: Record<string, unknown>) {
  const orgId = record.organization_id as string;
  const projectId = record.id as string;
  if (!orgId || !projectId) return null;
  const chunks = adaptSourcingProject(record).map((c) => ({
    chunk_type: c.chunk_type,
    content: c.content,
    metadata: c.metadata,
  }));
  if (chunks.length === 0) return null;
  return {
    entity_type: "job",
    entity_id: projectId,
    organization_id: orgId,
    chunks,
  };
}

// ── Table → builder mapping ────────────────────────────────────────────
const TABLE_BUILDERS: Record<string, (r: Record<string, unknown>) => { entity_type: string; entity_id: string; organization_id: string; chunks: Array<{ chunk_type: string; content: string; metadata?: any }> } | null> = {
  job_candidate_status: buildChunksFromJobCandidateStatus,
  candidate_notes: buildChunksFromCandidateNotes,
  candidate_comments: buildChunksFromCandidateComments,
  call_coaching_sessions: buildChunksFromCoachingSessions,
  candidate_evaluations: buildChunksFromEvaluations,
  sequence_step_executions: buildChunksFromSequenceExecutions,
  sourcing_projects: buildChunksFromSourcingProject,
};

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check: accept service_role key OR valid JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace('Bearer ', '');
    const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    if (token !== serviceKey) {
      // Not service_role — validate as JWT
      const _authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await (_authClient as any).auth.getUser();
      if (claimsError || !claimsData?.user?.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const payload: TriggerPayload = await req.json();
    const { type, table, record } = payload;

    console.log(`auto-ingest-context: ${type} on ${table}`);

    if (type === "DELETE") {
      return new Response(JSON.stringify({ skipped: true, reason: "DELETE not handled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const builder = TABLE_BUILDERS[table];
    if (!builder) {
      return new Response(JSON.stringify({ skipped: true, reason: `No builder for table ${table}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = builder(record);
    if (!result) {
      return new Response(JSON.stringify({ skipped: true, reason: "Builder returned null" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call ingest-context edge function
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const svcKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

    // Get a service-level token for internal call
    const ingestRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/ingest-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${svcKey}`,
      },
      body: JSON.stringify({
        organization_id: result.organization_id,
        entity_type: result.entity_type,
        entity_id: result.entity_id,
        chunks: result.chunks,
      }),
    });

    const ingestData = await ingestRes.json();
    console.log(`auto-ingest-context: ingest result for ${table}:`, JSON.stringify(ingestData));

    return new Response(JSON.stringify({ success: true, table, ...ingestData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auto-ingest-context error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
