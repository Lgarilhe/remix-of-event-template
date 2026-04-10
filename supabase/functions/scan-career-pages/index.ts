import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_ORGS_PER_RUN = 10;
const MIN_DAYS_BETWEEN_SCANS = 3;
const SCAN_TIMEOUT_MS = 30_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: service_role only ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const token = authHeader.replace("Bearer ", "");
    if (token !== serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — service_role only" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── 1. Fetch organizations with careers_url ──
    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, name, careers_url")
      .not("careers_url", "is", null)
      .neq("careers_url", "");

    if (orgsError) {
      console.error("[scan-career-pages] Error fetching orgs:", orgsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch organizations" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!orgs || orgs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No organizations with careers_url", scanned: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Filter out recently scanned orgs ──
    const cutoffDate = new Date(Date.now() - MIN_DAYS_BETWEEN_SCANS * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentScans } = await supabase
      .from("career_page_scans")
      .select("organization_id, scanned_at")
      .gte("scanned_at", cutoffDate);

    const recentlyScannedOrgIds = new Set(
      (recentScans ?? []).map((s: { organization_id: string }) => s.organization_id)
    );

    const eligibleOrgs = orgs
      .filter((o: { id: string }) => !recentlyScannedOrgIds.has(o.id))
      .slice(0, MAX_ORGS_PER_RUN);

    if (eligibleOrgs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "All orgs scanned recently", scanned: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[scan-career-pages] Scanning ${eligibleOrgs.length} organizations`);

    const results: { org: string; newRoles: number; error?: string }[] = [];

    for (const org of eligibleOrgs) {
      try {
        const result = await scanOrganization(supabase, supabaseUrl, serviceRoleKey, org);
        results.push({ org: org.name, newRoles: result.newRolesCount });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[scan-career-pages] Error scanning ${org.name}:`, msg);
        results.push({ org: org.name, newRoles: 0, error: msg });
      }
    }

    return new Response(
      JSON.stringify({ success: true, scanned: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[scan-career-pages] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function scanOrganization(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceRoleKey: string,
  org: { id: string; name: string; careers_url: string }
): Promise<{ newRolesCount: number }> {
  console.log(`[scan] Scanning ${org.name} — ${org.careers_url}`);

  // ── Call enrich-company in jobs_only mode with timeout ──
  let enrichResult: any;
  try {
    const enrichResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/enrich-company`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        company_name: org.name,
        careers_url: org.careers_url,
        mode: "jobs_only",
      }),
    }, SCAN_TIMEOUT_MS);
    enrichResult = await enrichResponse.json();
  } catch {
    // fetchWithTimeout handles timeout errors via AbortController
    enrichResult = { success: false, error: 'Enrichment timeout or network error' };
  }

  if (!enrichResult?.success) {
    console.warn(`[scan] Enrichment failed for ${org.name}:`, enrichResult?.error);
    // Still record the scan attempt
    await supabase.from("career_page_scans").insert({
      organization_id: org.id,
      careers_url: org.careers_url,
      roles_found: [],
      new_roles_count: 0,
    });
    return { newRolesCount: 0 };
  }

  const rolesFound: { title: string; location?: string; department?: string; url?: string; source?: string }[] =
    enrichResult.openRoles ?? [];

  // ── Compare with existing sourcing_projects ──
  const { data: existingProjects } = await supabase
    .from("sourcing_projects")
    .select("name, job_title")
    .eq("organization_id", org.id)
    .in("status", ["active", "paused"]);

  const existingTitles = new Set(
    (existingProjects ?? []).flatMap((p: { name: string; job_title: string | null }) =>
      [p.name?.toLowerCase(), p.job_title?.toLowerCase()].filter(Boolean)
    )
  );

  const newRoles = rolesFound.filter(
    (r) => r.title && !existingTitles.has(r.title.toLowerCase())
  );

  // ── Record scan ──
  await supabase.from("career_page_scans").insert({
    organization_id: org.id,
    careers_url: org.careers_url,
    roles_found: rolesFound,
    new_roles_count: newRoles.length,
  });

  // ── Notify if new roles found ──
  if (newRoles.length > 0) {
    const titlesList = newRoles
      .slice(0, 5)
      .map((r) => r.title)
      .join(", ");
    const suffix = newRoles.length > 5 ? ` (+${newRoles.length - 5} autres)` : "";

    // Get all members of this org to notify them
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", org.id);

    if (members && members.length > 0) {
      const notifications = members.map((m: { user_id: string }) => ({
        user_id: m.user_id,
        organization_id: org.id,
        type: "career_scan",
        title: `🆕 ${newRoles.length} nouveau${newRoles.length > 1 ? "x" : ""} poste${newRoles.length > 1 ? "s" : ""} détecté${newRoles.length > 1 ? "s" : ""} chez ${org.name}`,
        body: titlesList + suffix,
        link: "/missions?create=import",
        metadata: {
          company_name: org.name,
          careers_url: org.careers_url,
          new_roles: newRoles,
        },
      }));

      await supabase.from("notifications").insert(notifications);
    }

    console.log(`[scan] ${org.name}: ${newRoles.length} new roles detected`);
  } else {
    console.log(`[scan] ${org.name}: No new roles (${rolesFound.length} total found)`);
  }

  return { newRolesCount: newRoles.length };
}
