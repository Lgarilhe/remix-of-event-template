import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    // Get user from token
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { invitation_id, invitation_token } = await req.json();
    if (!invitation_id && !invitation_token) {
      throw new Error("Missing invitation_id or invitation_token");
    }

    // Get invitation
    const invitationIdentifier = String(invitation_id ?? invitation_token).trim();
    const shouldLookupById = Boolean(invitation_id) || UUID_REGEX.test(invitationIdentifier);

    let invitationQuery = supabase
      .from("organization_invitations")
      .select("*")
      .eq("status", "pending");

    invitationQuery = shouldLookupById
      ? invitationQuery.eq("id", invitationIdentifier)
      : invitationQuery.eq("token", invitationIdentifier);

    const { data: invitation, error: invError } = await invitationQuery.single();

    if (invError || !invitation) throw new Error("Invitation introuvable ou expirée");

    // Check email matches
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error("Cette invitation ne correspond pas à votre adresse email");
    }

    // Check not expired
    if (new Date(invitation.expires_at) < new Date()) {
      await supabase
        .from("organization_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      throw new Error("Invitation expirée");
    }

    // Check not already member
    const { data: existing } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", invitation.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      // Already a member, just mark invitation as accepted
      await supabase
        .from("organization_invitations")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);

      return new Response(JSON.stringify({ success: true, already_member: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Add as member
    const { error: memberError } = await supabase
      .from("organization_members")
      .insert({
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
      });

    if (memberError) throw memberError;

    // Mark invitation as accepted
    await supabase
      .from("organization_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    // Set as active org if user has none
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_organization_id")
      .eq("user_id", user.id)
      .single();

    if (!profile?.active_organization_id) {
      await supabase
        .from("profiles")
        .update({ active_organization_id: invitation.organization_id })
        .eq("user_id", user.id);
    }

    return new Response(JSON.stringify({ success: true, organization_id: invitation.organization_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
