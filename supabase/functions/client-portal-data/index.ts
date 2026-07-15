import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    // ── Route: POST = submit evaluation, GET = fetch portal data ──
    if (req.method === "POST") {
      return await handleSubmitEvaluation(req, supabase);
    }

    return await handleFetchPortal(req, supabase);
  } catch (error) {
    console.error("client-portal-data error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET handler — fetch portal data
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleFetchPortal(req: Request, supabase: any) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return jsonResponse({ error: "Missing token parameter" }, 400);
  }

  // 1. Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("client_portal_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return jsonResponse({ error: "Invalid or unknown token" }, 404);
  }

  // 2. Check expiration
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    return jsonResponse({ error: "Token expired" }, 403);
  }

  // 3. Update last_accessed_at (fire-and-forget)
  supabase
    .from("client_portal_tokens")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("id", tokenRow.id)
    .then(() => {});

  // 4. Fetch organization info
  const { data: org } = await supabase
    .from("organizations")
    .select("name, logo_url")
    .eq("id", tokenRow.organization_id)
    .maybeSingle();

  // 5. Fetch projects (scoped to token's project_ids if set)
  const projectIds = tokenRow.project_ids as string[] | null;
  let projectsQuery = supabase
    .from("sourcing_projects")
    .select("id, name, status")
    .eq("organization_id", tokenRow.organization_id);

  if (projectIds && projectIds.length > 0) {
    projectsQuery = projectsQuery.in("id", projectIds);
  }

  const { data: projects, error: projErr } = await projectsQuery.order(
    "created_at",
    { ascending: false }
  );

  if (projErr || !projects || projects.length === 0) {
    return jsonResponse({
      client_name: tokenRow.client_name,
      org_name: org?.name || null,
      org_logo: org?.logo_url || null,
      projects: [],
      permissions: parsePermissions(tokenRow.permissions),
    });
  }

  // 6. Fetch candidates for all projects in one query
  const allProjectIds = projects.map((p: any) => p.id);
  const { data: allCandidates } = await supabase
    .from("job_candidate_status")
    .select(
      "id, candidate_name, candidate_headline, pipeline_stage, score, updated_at, created_at, project_id"
    )
    .in("project_id", allProjectIds)
    .order("updated_at", { ascending: false });

  // Group candidates by project — anonymisation CÔTÉ SERVEUR.
  // Si le client n'a pas la permission de voir les noms (souvent RGPD), on ne
  // renvoie JAMAIS candidate_name/candidate_headline : le masquage front seul
  // était contournable en lisant la réponse JSON dans l'onglet Réseau.
  const permissions = parsePermissions(tokenRow.permissions);
  const candidatesByProject = new Map<string, any[]>();
  (allCandidates || []).forEach((c: any) => {
    const candidate = permissions.can_see_names
      ? c
      : { ...c, candidate_name: null, candidate_headline: null };
    const list = candidatesByProject.get(c.project_id) || [];
    list.push(candidate);
    candidatesByProject.set(c.project_id, list);
  });

  const portalProjects = projects.map((proj: any) => ({
    id: proj.id,
    name: proj.name,
    status: proj.status,
    candidates: candidatesByProject.get(proj.id) || [],
  }));

  return jsonResponse({
    client_name: tokenRow.client_name,
    org_name: org?.name || null,
    org_logo: org?.logo_url || null,
    projects: portalProjects,
    permissions,
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST handler — submit candidate evaluation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleSubmitEvaluation(req: Request, supabase: any) {
  const body = await req.json();
  const { token, evaluation } = body;

  if (!token || !evaluation) {
    return jsonResponse({ error: "Missing token or evaluation" }, 400);
  }

  // 1. Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("client_portal_tokens")
    .select("id, organization_id, project_ids, permissions, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return jsonResponse({ error: "Invalid or unknown token" }, 404);
  }

  // 2. Check expiration
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    return jsonResponse({ error: "Token expired" }, 403);
  }

  // 3. Check permission
  const permissions = parsePermissions(tokenRow.permissions);
  if (!permissions.can_fill_scorecard) {
    return jsonResponse({ error: "Scorecard permission denied" }, 403);
  }

  // 4. Verify the candidate's project belongs to this token's scope
  const { data: candidate } = await supabase
    .from("job_candidate_status")
    .select("project_id")
    .eq("id", evaluation.candidate_id)
    .maybeSingle();

  if (!candidate) {
    return jsonResponse({ error: "Candidate not found" }, 404);
  }

  const allowedProjectIds = tokenRow.project_ids as string[] | null;
  if (allowedProjectIds && allowedProjectIds.length > 0) {
    if (!allowedProjectIds.includes(candidate.project_id)) {
      return jsonResponse({ error: "Candidate not in allowed projects" }, 403);
    }
  } else {
    // If no project_ids filter, verify the project belongs to the org
    const { data: project } = await supabase
      .from("sourcing_projects")
      .select("organization_id")
      .eq("id", candidate.project_id)
      .maybeSingle();

    if (!project || project.organization_id !== tokenRow.organization_id) {
      return jsonResponse({ error: "Candidate not in allowed projects" }, 403);
    }
  }

  // 5. Insert evaluation — use DB-resolved project_id, not client-supplied job_id
  const { error: insertErr } = await supabase
    .from("candidate_evaluations")
    .insert({
      candidate_id: evaluation.candidate_id,
      job_id: candidate.project_id,
      organization_id: tokenRow.organization_id,
      criteria: evaluation.criteria,
      ratings: evaluation.ratings,
      comments: evaluation.comments,
      overall_score: evaluation.overall_score,
      recommendation: evaluation.recommendation,
      summary: evaluation.summary,
      ai_generated: false,
      created_by: "00000000-0000-0000-0000-000000000000",
    });

  if (insertErr) {
    console.error("Evaluation insert error:", insertErr);
    return jsonResponse({ error: "Failed to save evaluation" }, 500);
  }

  return jsonResponse({ success: true });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function parsePermissions(raw: any) {
  const defaults = {
    can_comment: true,
    can_see_names: true,
    can_fill_scorecard: true,
  };
  if (!raw || typeof raw !== "object") return defaults;
  return {
    can_comment:
      typeof raw.can_comment === "boolean" ? raw.can_comment : defaults.can_comment,
    can_see_names:
      typeof raw.can_see_names === "boolean"
        ? raw.can_see_names
        : defaults.can_see_names,
    can_fill_scorecard:
      typeof raw.can_fill_scorecard === "boolean"
        ? raw.can_fill_scorecard
        : defaults.can_fill_scorecard,
  };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
