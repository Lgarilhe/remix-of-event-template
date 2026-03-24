import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { email, role, organization_id } = await req.json();
    if (!email || !organization_id) throw new Error("Missing email or organization_id");

    // Verify caller is admin/owner of the org
    const { data: callerMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .single();

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      throw new Error("Vous n'avez pas les droits pour inviter des membres");
    }

    // Get org name
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .single();

    // Get inviter profile name
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    // Create invitation
    const { data: invitation, error: invError } = await supabase
      .from("organization_invitations")
      .insert({
        organization_id,
        email: email.toLowerCase(),
        role: role || "member",
        invited_by: user.id,
      })
      .select()
      .single();

    if (invError) {
      if (invError.code === "23505") throw new Error("Une invitation est déjà en cours pour cet email");
      throw invError;
    }

    // Determine app URL for the invitation link
    const origin = req.headers.get("origin") || "https://id-preview--08a19073-7da4-47fa-92af-b78fed96739f.lovable.app";
    const inviteUrl = `${origin}/auth`;

    // Send invitation email via transactional email system
    const { error: emailError } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "team-invitation",
        recipientEmail: email.toLowerCase(),
        idempotencyKey: `team-invite-${invitation.id}`,
        templateData: {
          organizationName: org?.name || "votre équipe",
          inviterName: inviterProfile?.full_name || user.email,
          role: role || "member",
          inviteUrl,
        },
      },
    });

    if (emailError) {
      console.error("Failed to send invitation email:", emailError);
      // Don't fail the whole operation — invitation is created
    }

    return new Response(JSON.stringify({ success: true, invitation_id: invitation.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
