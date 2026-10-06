import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Identifiant d'une ligne job_candidate_status (uuid).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Réponse tant que la fonction SQL client_portal_candidates (migration C1)
// n'est pas en place : migration et fonction edge se déploient en parallèle.
const PORTAL_UNAVAILABLE =
  "Le portail est en cours de mise à jour. Réessayez dans quelques minutes.";

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
    .select("id, organization_id, client_name, project_ids, permissions, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return jsonResponse({ error: "Invalid or unknown token" }, 404);
  }

  // 2. Check expiration : un lien sans date est refusé (colonne obligatoire
  //    depuis la migration C1, 90 jours par défaut).
  if (isExpired(tokenRow.expires_at)) {
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

  // 6. Candidats visibles (C1, R4) : seulement les retenus ou au-delà, jamais
  //    « À trier », contactés seulement ni écartés, étape traduite pour le
  //    portail. La règle vit en SQL (client_portal_candidates), seule lecture
  //    partagée avec l'avis du client ci-dessous. Pas de repli sur une
  //    lecture brute de job_candidate_status.
  const { data: allCandidates, error: candErr } = await supabase.rpc(
    "client_portal_candidates",
    { p_token: token }
  );

  if (candErr) {
    if (isMissingPortalFunction(candErr)) {
      console.error("client_portal_candidates missing:", candErr.message);
      return jsonResponse({ error: PORTAL_UNAVAILABLE }, 503);
    }
    console.error("client_portal_candidates error:", candErr.message);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

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

  if (typeof evaluation.candidate_id !== "string" || !UUID_RE.test(evaluation.candidate_id)) {
    return jsonResponse({ error: "Ce candidat n'est plus disponible dans votre portail." }, 404);
  }

  // 1. Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("client_portal_tokens")
    .select("id, organization_id, permissions, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return jsonResponse({ error: "Invalid or unknown token" }, 404);
  }

  // 2. Check expiration
  if (isExpired(tokenRow.expires_at)) {
    return jsonResponse({ error: "Ce lien a expiré. Contactez votre recruteur." }, 403);
  }

  // 3. Check permission
  const permissions = parsePermissions(tokenRow.permissions);
  if (!permissions.can_fill_scorecard) {
    return jsonResponse({ error: "Scorecard permission denied" }, 403);
  }

  // 4. Le candidat doit être visible dans ce portail : même lecture que
  //    l'affichage (missions du lien, lien non échu, retenu ou au-delà).
  //    Remplace l'ancienne vérification par mission seule, qui laissait
  //    évaluer une ligne « À trier » ou écartée de la mission.
  const { data: candidateRows, error: candErr } = await supabase
    .rpc("client_portal_candidates", { p_token: token })
    .eq("id", evaluation.candidate_id)
    .limit(1);

  if (candErr) {
    if (isMissingPortalFunction(candErr)) {
      console.error("client_portal_candidates missing:", candErr.message);
      return jsonResponse({ error: PORTAL_UNAVAILABLE }, 503);
    }
    console.error("client_portal_candidates error:", candErr.message);
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  const candidate = candidateRows?.[0] ?? null;
  if (!candidate) {
    return jsonResponse({ error: "Ce candidat n'est plus disponible dans votre portail." }, 404);
  }

  // 5. Le candidat s'enregistre comme partout ailleurs : par l'identifiant de son
  //    profil (job_candidate_status.candidate_id), pas par celui de la ligne que
  //    renvoie client_portal_candidates. Sous l'identifiant de la ligne, la grille
  //    d'un recruteur, la fiche et l'assistant ne retrouvaient jamais cet avis.
  //    Lu par une fonction SQL à part, jamais renvoyé au navigateur : cet
  //    identifiant désigne un candidat que le portail peut avoir anonymisé.
  const { data: profileId, error: profileErr } = await supabase.rpc(
    "client_portal_candidate_profile_id",
    { p_token: token, p_row_id: candidate.id }
  );

  if (profileErr) {
    if (isMissingPortalFunction(profileErr)) {
      console.error("client_portal_candidate_profile_id missing:", profileErr.message);
      return jsonResponse({ error: PORTAL_UNAVAILABLE }, 503);
    }
    console.error("client_portal_candidate_profile_id error:", profileErr.message);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
  if (typeof profileId !== "string" || profileId === "") {
    return jsonResponse({ error: "Ce candidat n'est plus disponible dans votre portail." }, 404);
  }

  // 6. Insert evaluation — use DB-resolved project_id, not client-supplied job_id
  const { error: insertErr } = await supabase
    .from("candidate_evaluations")
    .insert({
      candidate_id: profileId,
      job_id: candidate.project_id,
      project_id: candidate.project_id,
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
// Un lien sans date, à date illisible ou échue est refusé (fail-closed).
function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return Number.isNaN(t) || t <= Date.now();
}

// Fonction SQL absente (PGRST202 : inconnue du cache de schéma ; 42883 :
// fonction inexistante), le temps que la migration C1 s'applique.
function isMissingPortalFunction(err: { code?: string } | null): boolean {
  return !!err && (err.code === "PGRST202" || err.code === "42883");
}

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
