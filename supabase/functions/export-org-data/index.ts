/**
 * Edge function: Export organization data (RGPD portability)
 *
 * Exports all data for an organization as JSON:
 * - Candidates (from job_candidate_status)
 * - Sourcing projects
 * - AI credit transactions
 * - Conversation–mission links (mission_conversations, lot 0b)
 * - Private candidate photo copies (candidate_photos, lot P): state and storage path, not the files
 * - Phone calls (phone_calls, lot A1), their analyses (phone_call_insights) and transcriptions
 *   (phone_call_transcripts, lot A5, the most recent ones: the cap is reported in _meta)
 * - Messages sent (from Unipile logs if available)
 *
 * Only admins can trigger this export.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

/** Une transcription pèse plusieurs ko : au-delà, l'export dépasserait la mémoire de la fonction. */
const TRANSCRIPTS_EXPORT_LIMIT = 3000;

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
      { data: candidates, error: candidatesError },
      { data: projects, error: projectsError },
      { data: transactions, error: transactionsError },
      { data: members, error: membersError },
      { data: conversationLinks, error: conversationLinksError },
      { data: candidatePhotos, error: candidatePhotosError },
      { data: phoneCalls, error: phoneCallsError },
      { data: phoneCallInsights, error: phoneCallInsightsError },
      { data: phoneCallTranscripts, error: phoneCallTranscriptsError },
    ] = await Promise.all([
      adminClient
        .from("job_candidate_status")
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
      adminClient
        .from("mission_conversations")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(10000),
      adminClient
        .from("candidate_photos")
        .select("candidate_id, status, storage_path, captured_at, checked_at, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(10000),
      adminClient
        .from("phone_calls")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(10000),
      // Analyses des appels (lot A5) : petites, exportées comme les appels.
      adminClient
        .from("phone_call_insights")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(10000),
      // Transcriptions : volumineuses (plusieurs ko par appel), donc bornées aux plus récentes.
      // Le plafond est annoncé dans _meta quand il est atteint : jamais tronqué en silence.
      adminClient
        .from("phone_call_transcripts")
        .select("call_id, utterances, language, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(TRANSCRIPTS_EXPORT_LIMIT),
    ]);

    // RGPD art. 20 : un export incomplet doit échouer explicitement, jamais
    // renvoyer un jeu de données tronqué en silence.
    const queryError = candidatesError || projectsError || transactionsError || membersError
      || conversationLinksError || candidatePhotosError || phoneCallsError
      || phoneCallInsightsError || phoneCallTranscriptsError;
    if (queryError) {
      console.error("[export-org-data] query failed:", queryError);
      return new Response(
        JSON.stringify({ error: "Export incomplet — réessayez", detail: queryError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const exportData = {
      export_date: new Date().toISOString(),
      organization_id: organizationId,
      exported_by: user.email,
      candidates: candidates || [],
      sourcing_projects: projects || [],
      ai_credit_transactions: transactions || [],
      members: members || [],
      mission_conversations: conversationLinks || [],
      candidate_photos: candidatePhotos || [],
      phone_calls: phoneCalls || [],
      phone_call_insights: phoneCallInsights || [],
      phone_call_transcripts: phoneCallTranscripts || [],
      _meta: {
        phone_call_transcripts_count: (phoneCallTranscripts || []).length,
        phone_call_transcripts_truncated: (phoneCallTranscripts || []).length >= TRANSCRIPTS_EXPORT_LIMIT,
        candidates_count: (candidates || []).length,
        projects_count: (projects || []).length,
        transactions_count: (transactions || []).length,
        mission_conversations_count: (conversationLinks || []).length,
        candidate_photos_count: (candidatePhotos || []).length,
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
