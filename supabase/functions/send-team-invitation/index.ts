import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_APP_ORIGIN = "https://id-preview--08a19073-7da4-47fa-92af-b78fed96739f.lovable.app";

const resolveAppOrigin = (req: Request) => {
  const directOrigin = req.headers.get("origin");
  if (directOrigin) {
    try {
      const hostname = new URL(directOrigin).hostname;
      if (!hostname.endsWith(".lovableproject.com")) return directOrigin;
    } catch {
      // noop
    }
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (!refererUrl.hostname.endsWith(".lovableproject.com")) {
        return refererUrl.origin;
      }
    } catch {
      // noop
    }
  }

  return DEFAULT_APP_ORIGIN;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error("Configuration serveur manquante pour l'envoi d'invitations");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const userClient = createClient(
      supabaseUrl,
      anonKey,
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
      .select("id, status, token")
      .eq("organization_id", organization_id)
      .eq("email", normalizedEmail)
      .eq("status", "pending")
      .maybeSingle();

    let invitationId = existingInvitation?.id;
    let invitationToken = existingInvitation?.token;

    if (!invitationId) {
      const { data: invitation, error: invError } = await supabase
        .from("organization_invitations")
        .insert({
          organization_id,
          email: normalizedEmail,
          role: normalizedRole,
          invited_by: user.id,
        })
        .select("id, token")
        .single();

      if (invError) {
        if (invError.code === "23505") {
          throw new Error("Une invitation est déjà en cours pour cet email");
        }
        throw invError;
      }

      invitationId = invitation.id;
      invitationToken = invitation.token;
    }

    const origin = resolveAppOrigin(req);
    const inviteUrl = `${origin}/auth?invitation=${invitationId}`;
    const idempotencyKey = isResend
      ? `team-invite-resend-${invitationId}-${Date.now()}`
      : `team-invite-${invitationId}`;

    const emailResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      body: JSON.stringify({
        templateName: "team-invitation",
        recipientEmail: normalizedEmail,
        idempotencyKey,
        templateData: {
          organizationName: org?.name || "votre équipe",
          inviterName: inviterProfile?.display_name || user.email,
          role: normalizedRole,
          inviteUrl,
        },
      }),
    });

    let emailError: string | null = null;

    if (!emailResponse.ok) {
      try {
        const payload = await emailResponse.clone().json();
        emailError = payload?.error || payload?.message || `HTTP ${emailResponse.status}`;
      } catch {
        const text = await emailResponse.text();
        emailError = text || `HTTP ${emailResponse.status}`;
      }
    }

    if (emailError) {
      console.error("Failed to send invitation email:", emailError);
      throw new Error(`Impossible d'envoyer l'invitation: ${emailError}`);
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
