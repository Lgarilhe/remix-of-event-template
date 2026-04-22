/**
 * Edge function: Export organization data (RGPD portability)
 *
 * Exports all data for an organization as JSON:
 * - Candidates (from candidate_job_status)
 * - Sourcing projects
 * - AI credit transactions
 * - Messages sent (from Unipile logs if available)
 *
 * Only admins can trigger this export.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const organizationId = body.organization_id;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify admin role
    const { data: membership } = await adminClient
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["admin", "owner"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all data in parallel
    const [
      { data: candidates },
      { data: projects },
      { data: transactions },
      { data: members },
    ] = await Promise.all([
      adminClient
        .from("candidate_job_status")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(10000),
      adminClient
        .from("sourcing_projects")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      adminClient
        .from("ai_credit_transactions")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(5000),
      adminClient
        .from("organization_members")
        .select("user_id, role, created_at")
        .eq("organization_id", organizationId),
    ]);

    const exportData = {
      export_date: new Date().toISOString(),
      organization_id: organizationId,
      exported_by: user.email,
      candidates: candidates || [],
      sourcing_projects: projects || [],
      ai_credit_transactions: transactions || [],
      members: members || [],
      _meta: {
        candidates_count: (candidates || []).length,
        projects_count: (projects || []).length,
        transactions_count: (transactions || []).length,
        format: "JSON",
        rgpd_article: "Article 20 — Droit à la portabilité",
      },
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="konekt-export-${organizationId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    console.error("[export-org-data] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
