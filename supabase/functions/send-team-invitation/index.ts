import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { email, role, organization_id, resend } = await req.json();
    if (!email || !organization_id) throw new Error("Missing email or organization_id");

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = role || "member";
    const isResend = Boolean(resend);

    const { data: callerMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .single();

    if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
      throw new Error("Vous n'avez pas les droits pour inviter des membres");
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .single();

    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: existingInvitation } = await supabase
      .from("organization_invitations")
      .select("id, status")
      .eq("organization_id", organization_id)
      .eq("email", normalizedEmail)
      .eq("status", "pending")
      .maybeSingle();

    let invitationId = existingInvitation?.id;

    if (!invitationId) {
      const { data: invitation, error: invError } = await supabase
        .from("organization_invitations")
        .insert({
          organization_id,
          email: normalizedEmail,
          role: normalizedRole,
          invited_by: user.id,
        })
        .select("id")
        .single();

      if (invError) {
        if (invError.code === "23505") {
          throw new Error("Une invitation est déjà en cours pour cet email");
        }
        throw invError;
      }

      invitationId = invitation.id;
    }

    const origin = req.headers.get("origin") || "https://id-preview--08a19073-7da4-47fa-92af-b78fed96739f.lovable.app";
    const inviteUrl = `${origin}/auth`;
    const idempotencyKey = isResend
      ? `team-invite-resend-${invitationId}-${Date.now()}`
      : `team-invite-${invitationId}`;

    const { error: emailError } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "team-invitation",
        recipientEmail: normalizedEmail,
        idempotencyKey,
        templateData: {
          organizationName: org?.name || "votre équipe",
          inviterName: inviterProfile?.display_name || user.email,
          role: normalizedRole,
          inviteUrl,
        },
      },
    });

    if (emailError) {
      console.error("Failed to send invitation email:", emailError);
    }

    return new Response(JSON.stringify({ success: true, invitation_id: invitationId, resent: isResend }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("send-team-invitation failed:", message, error);

    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
