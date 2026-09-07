// Administration du cercle partenaires de la marketplace (lot M, 2026-09-07).
// Réservée aux identifiants listés dans le secret KONEKT_PLATFORM_ADMIN_USER_IDS
// (séparés par des virgules). Sans ce secret, `whoami` répond faux et toute
// autre action est refusée : la validation se fait alors dans l'éditeur SQL.
// Aucun appel externe : client service role uniquement.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const PARTNER_FEATURE = "marketplace_recruit";

type PartnerRow = {
  organization_id: string;
  status: string | null;
  requested_at: string | null;
  requested_by: string | null;
  validated_at: string | null;
  created_at: string | null;
};

/** Vrai si l'utilisateur figure dans KONEKT_PLATFORM_ADMIN_USER_IDS. */
function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false;
  const raw = Deno.env.get("KONEKT_PLATFORM_ADMIN_USER_IDS") ?? "";
  const allow = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(userId);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée" }, 405);
  }

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";

    const admin = isPlatformAdmin(auth.userId);

    if (action === "whoami") {
      return json({ is_platform_admin: admin });
    }
    if (!admin) {
      return json(
        { error: "Administration plateforme non disponible", errorType: "NOT_PLATFORM_ADMIN" },
        403,
      );
    }
    // Ici auth.userId est forcément défini (isPlatformAdmin refuse le service role).
    const adminUserId = auth.userId as string;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    // ------------------------------------------------------------------
    // list_partners : toutes les demandes du cercle, avec organisation,
    // demandeur et nombre de membres.
    // ------------------------------------------------------------------
    if (action === "list_partners") {
      const { data: rows, error: rowsErr } = await db
        .from("feature_activations")
        .select("organization_id, status, requested_at, requested_by, validated_at, created_at")
        .eq("feature", PARTNER_FEATURE)
        .order("requested_at", { ascending: false, nullsFirst: false });
      if (rowsErr) {
        console.error("[marketplace-admin] list_partners failed:", rowsErr);
        return json({ error: "Erreur serveur" }, 500);
      }
      const partners = (rows ?? []) as PartnerRow[];
      const orgIds = Array.from(new Set(partners.map((p) => p.organization_id)));
      const requesterIds = Array.from(
        new Set(partners.map((p) => p.requested_by).filter((v): v is string => !!v)),
      );

      const orgById = new Map<string, { name: string | null; org_type: string | null }>();
      const memberCount = new Map<string, number>();
      const nameByUser = new Map<string, string | null>();

      if (orgIds.length > 0) {
        const [{ data: orgs }, { data: members }] = await Promise.all([
          db.from("organizations").select("id, name, org_type").in("id", orgIds),
          db.from("organization_members").select("organization_id").in("organization_id", orgIds),
        ]);
        for (const o of (orgs ?? []) as Array<{ id: string; name: string | null; org_type: string | null }>) {
          orgById.set(o.id, { name: o.name, org_type: o.org_type });
        }
        for (const m of (members ?? []) as Array<{ organization_id: string }>) {
          memberCount.set(m.organization_id, (memberCount.get(m.organization_id) ?? 0) + 1);
        }
      }
      if (requesterIds.length > 0) {
        const { data: profiles } = await db
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", requesterIds);
        for (const p of (profiles ?? []) as Array<{ user_id: string; display_name: string | null }>) {
          nameByUser.set(p.user_id, p.display_name);
        }
      }

      return json({
        partners: partners.map((p) => ({
          organization_id: p.organization_id,
          organization_name: orgById.get(p.organization_id)?.name ?? null,
          org_type: orgById.get(p.organization_id)?.org_type ?? null,
          status: p.status ?? "inactive",
          requested_at: p.requested_at ?? p.created_at ?? null,
          requested_by_name: p.requested_by ? (nameByUser.get(p.requested_by) ?? null) : null,
          validated_at: p.validated_at,
          member_count: memberCount.get(p.organization_id) ?? 0,
        })),
      });
    }

    // ------------------------------------------------------------------
    // validate_partner / suspend_partner : changement de statut d'une
    // organisation.
    // ------------------------------------------------------------------
    if (action === "validate_partner" || action === "suspend_partner") {
      const organizationId = typeof body?.organization_id === "string" ? body.organization_id.trim() : "";
      if (!organizationId) {
        return json({ error: "organization_id requis" }, 400);
      }

      const { data: current, error: currentErr } = await db
        .from("feature_activations")
        .select("id, status")
        .eq("organization_id", organizationId)
        .eq("feature", PARTNER_FEATURE)
        .maybeSingle();
      if (currentErr) {
        console.error("[marketplace-admin] activation lookup failed:", currentErr);
        return json({ error: "Erreur serveur" }, 500);
      }
      if (!current) {
        return json({ error: "Aucune demande pour cette organisation" }, 404);
      }

      const nextStatus = action === "validate_partner" ? "active" : "suspended";
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status: nextStatus, updated_at: now };
      if (nextStatus === "active") {
        patch.validated_by = adminUserId;
        patch.validated_at = now;
      }
      const { error: updateErr } = await db
        .from("feature_activations")
        .update(patch)
        .eq("id", current.id);
      if (updateErr) {
        console.error("[marketplace-admin] status update failed:", updateErr);
        return json({ error: "Erreur serveur" }, 500);
      }

      // Notification aux propriétaires et administrateurs, seulement quand
      // l'organisation entre dans le cercle (pas à une nouvelle validation).
      if (nextStatus === "active" && current.status !== "active") {
        const { data: members } = await db
          .from("organization_members")
          .select("user_id, role")
          .eq("organization_id", organizationId);
        const all = (members ?? []) as Array<{ user_id: string; role: string | null }>;
        const managers = all.filter((m) => m.role === "owner" || m.role === "admin");
        // Organisation sans propriétaire ni administrateur : tous les membres
        // sont prévenus, sinon personne ne saurait que le cercle est ouvert.
        const recipients = managers.length > 0 ? managers : all;
        if (recipients.length > 0) {
          const { error: notifErr } = await db.from("notifications").insert(
            recipients.map((m) => ({
              user_id: m.user_id,
              organization_id: organizationId,
              type: "success",
              title: "Bienvenue dans le cercle partenaires",
              body: "Votre organisation peut maintenant consulter les missions publiées et postuler.",
              link: "/marketplace",
              metadata: { source: "marketplace_admin", feature: PARTNER_FEATURE },
            })),
          );
          if (notifErr) {
            console.warn("[marketplace-admin] notification insert failed:", notifErr.message);
          }
        }
      }

      return json({ status: nextStatus });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (err) {
    // Le détail reste dans les journaux : l'écran n'affiche pas de message technique.
    console.error("[marketplace-admin]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
});
