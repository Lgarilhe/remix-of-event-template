import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSubscriptionGate } from "../_shared/subscription-gate.ts";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Le lien d'invitation est toujours construit depuis APP_URL : jamais depuis
// l'en-tête Origin ou Referer (un appelant pourrait y glisser son propre site).
const resolveAppOrigin = (_req: Request) =>
  (Deno.env.get("APP_URL") || "https://konekt-app-navy.vercel.app").replace(/\/+$/, "");

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
    // Whitelist stricte : jamais "owner" ni valeur arbitraire via le body
    // (escalade de privilège — accept-invitation insère ce rôle tel quel).
    const ALLOWED_INVITE_ROLES = ["admin", "member", "collaborator"];
    const normalizedRole = role ? String(role).trim().toLowerCase() : "member";
    if (!ALLOWED_INVITE_ROLES.includes(normalizedRole)) {
      throw new Error("Rôle d'invitation invalide");
    }
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
      // Sièges (lot P0-C) : un siège = une ligne organization_members, et une
      // invitation en attente réserve un siège. Le renvoi d'une invitation déjà
      // en attente n'en consomme pas de nouveau, d'où le contrôle ici seulement.
      const gate = await getSubscriptionGate(supabase, organization_id);
      const { count: pendingCount, error: pendingError } = await supabase
        .from("organization_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization_id)
        .eq("status", "pending");
      if (pendingError) {
        console.error("[send-team-invitation] pending invitations count failed:", pendingError.message);
        throw new Error("Impossible de vérifier les sièges disponibles");
      }
      if (gate.seatCount + (pendingCount ?? 0) >= gate.seatLimit) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "seats_exceeded",
            error: "Tous vos sièges sont utilisés. Ajoutez un siège dans Abonnement.",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // expires_at + token + status explicits car la table organization_invitations
      // a une contrainte NOT NULL sur "token" sans default value en BDD.
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Token random hex 64 chars (256 bits entropy) — safe pour URL, non-guessable
      const tokenBytes = new Uint8Array(32);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const { data: invitation, error: invError } = await supabase
        .from("organization_invitations")
        .insert({
          organization_id,
          email: normalizedEmail,
          role: normalizedRole,
          invited_by: user.id,
          expires_at: expiresAt,
          status: "pending",
          token,
        })
        .select("id, token")
        .single();

      if (invError) {
        if (invError.code === "23505") {
          throw new Error("Une invitation est déjà en cours pour cet email");
        }
        // CRITIQUE : invError est un PostgresError, pas un Error JS standard.
        // Sans wrapping, le catch principal voit error instanceof Error === false
        // → renvoie "Unknown error" générique au frontend. Wrapping forcé :
        throw new Error(`DB insert failed: ${invError.message || invError.code || JSON.stringify(invError)}`);
      }

      invitationId = invitation.id;
      invitationToken = invitation.token;
    }

    const origin = resolveAppOrigin(req);
    // Inclut email + org name dans l'URL pour :
    // 1. Pré-remplir le champ email côté front (UX)
    // 2. Permettre au front d'afficher Sign Up par défaut (au lieu de Sign In)
    //    car l'invité n'a probablement pas encore de compte Konekt
    // 3. Afficher un message contextuel "Vous êtes invité à rejoindre {orgName}"
    const orgNameParam = org?.name ? `&org=${encodeURIComponent(org.name)}` : '';
    const inviteUrl = `${origin}/auth?invitation=${invitationId}&email=${encodeURIComponent(normalizedEmail)}${orgNameParam}`;
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
        // payload = { error: 'Failed to prepare email', details: 'real cause' }
        const baseErr = payload?.error || payload?.message || `HTTP ${emailResponse.status}`;
        const details = payload?.details ? ` (${payload.details})` : '';
        emailError = `${baseErr}${details}`;
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
    // Extraction défensive du message — on couvre Error standard, PostgresError
    // (avec .message + .code + .details), et tout objet avec une propriété message.
    let message = "Erreur inconnue lors de l'envoi de l'invitation";
    if (error instanceof Error) {
      message = error.message;
    } else if (error && typeof error === "object") {
      const errObj = error as Record<string, unknown>;
      message = String(errObj.message || errObj.error || errObj.code || JSON.stringify(error));
    } else if (typeof error === "string") {
      message = error;
    }
    console.error("[send-team-invitation] FAILED:", message, "| raw:", error);

    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
