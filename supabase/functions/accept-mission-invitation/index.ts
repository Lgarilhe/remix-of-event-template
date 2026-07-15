// Accepte une invitation mission (freelance externe) côté serveur.
// Remplace l'ancien flow 100 % client (SELECT par token + INSERT mission_team
// + UPDATE status depuis le navigateur) qui ne vérifiait pas l'email invité
// et reposait sur des policies RLS trop permissives (audit 2026-07-14).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    if (!auth.userId) {
      // L'acceptation est un acte personnel : pas de service_role passthrough.
      return json({ error: "User authentication required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return json({ error: "token is required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(auth.userId);
    const userEmail = userData?.user?.email;
    if (userErr || !userEmail) {
      console.error("[accept-mission-invitation] getUserById failed:", userErr?.message);
      return json({ error: "Impossible de vérifier votre compte" }, 500);
    }

    const { data: invitation, error: invErr } = await admin
      .from("mission_invitations")
      .select("*")
      .eq("token", token)
      .eq("status", "pending")
      .maybeSingle();

    if (invErr) {
      console.error("[accept-mission-invitation] invitation lookup failed:", invErr);
      return json({ error: "Erreur serveur" }, 500);
    }
    if (!invitation) {
      return json({ error: "Invitation introuvable ou déjà utilisée" }, 404);
    }

    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      await admin
        .from("mission_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      return json({ error: "Cette invitation a expiré" }, 410);
    }

    if (String(invitation.email).toLowerCase() !== userEmail.toLowerCase()) {
      return json({ error: "Cette invitation ne correspond pas à votre adresse email" }, 403);
    }

    // Ajout à l'équipe mission (idempotent grâce au UNIQUE(project_id, user_id))
    let alreadyMember = false;
    const { error: teamErr } = await admin.from("mission_team").insert({
      project_id: invitation.project_id,
      user_id: auth.userId,
      role: invitation.role,
    });
    if (teamErr) {
      if (teamErr.code === "23505") {
        alreadyMember = true;
      } else {
        console.error("[accept-mission-invitation] mission_team insert failed:", teamErr);
        return json({ error: "Impossible de vous ajouter à la mission" }, 500);
      }
    }

    const { error: updateErr } = await admin
      .from("mission_invitations")
      .update({
        status: "accepted",
        accepted_by: auth.userId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invitation.id)
      .eq("status", "pending");
    if (updateErr) {
      console.error("[accept-mission-invitation] status update failed:", updateErr);
    }

    return json({
      success: true,
      project_id: invitation.project_id,
      already_member: alreadyMember,
    });
  } catch (err) {
    console.error("[accept-mission-invitation]", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
