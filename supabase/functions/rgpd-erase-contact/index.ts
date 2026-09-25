/**
 * rgpd-erase-contact — Droit à l'effacement (RGPD art. 17)
 *
 * Qui peut effacer (SEQ-055) :
 *   - un propriétaire ou un administrateur d'organisation : effacement limité
 *     aux données de SON organisation (organisation demandée, sinon son
 *     organisation active) ;
 *   - un administrateur plateforme (KONEKT_PLATFORM_ADMIN_USER_IDS) ou un
 *     appel interne en clé de service : effacement global (ligne
 *     gdpr_erasures qui bloque les enrichissements futurs, toutes
 *     organisations).
 *   Tout autre utilisateur est refusé (403).
 *
 * Workflow (voir recordGdprErasure) :
 *   1. Reçoit email OU linkedin_url
 *   2. Effacement global seulement : INSERT dans gdpr_erasures (hash SHA-256)
 *   3. Séquences du candidat arrêtées, étapes et InMails programmés annulés,
 *      adresse ajoutée à la liste de suppression, données retirées des
 *      lignes de séquence (SEQ-054)
 *   4. DELETE des enrichissements du périmètre
 *   5. Succès renvoyé seulement une fois ces écritures faites
 *
 * Authentification obligatoire pour toutes les méthodes, plus un rate limit
 * (30 req/h par IP). Verify_jwt = false dans config.toml.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { recordGdprErasure, normalizeEmail, normalizeLinkedInUrl, sha256Hex } from "../_shared/get-or-fetch-contact.ts";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Vrai si l'utilisateur figure dans KONEKT_PLATFORM_ADMIN_USER_IDS. */
function isPlatformAdmin(userId: string | null): boolean {
  if (!userId) return false;
  const raw = Deno.env.get("KONEKT_PLATFORM_ADMIN_USER_IDS") ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Page HTML simple pour confirmer ou afficher le résultat */
function renderPage(opts: { title: string; message: string; success: boolean }): string {
  const color = opts.success ? "#10b981" : "#ef4444";
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opts.title} — Konekt</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #fafafa; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .card { background: #111; border: 1px solid #262626; border-radius: 12px; padding: 2.5rem; max-width: 480px; text-align: center; }
  .icon { width: 56px; height: 56px; margin: 0 auto 1.5rem; background: ${color}; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 28px; }
  h1 { margin: 0 0 0.75rem; font-size: 1.5rem; font-weight: 700; }
  p { margin: 0; color: #a3a3a3; line-height: 1.6; }
  .footer { margin-top: 2rem; font-size: 0.75rem; color: #525252; }
  .footer a { color: #a3a3a3; text-decoration: none; }
</style>
</head>
<body>
<div class="card">
<div class="icon">${opts.success ? "✓" : "✕"}</div>
<h1>${opts.title}</h1>
<p>${opts.message}</p>
<div class="footer">
<a href="https://konekt-app-navy.vercel.app/privacy">Politique de confidentialité</a>
</div>
</div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);

    // Effacement RGPD = opération DESTRUCTIVE. On exige une authentification pour
    // TOUTES les méthodes (POST programmatique ET GET). Le GET était public et
    // effaçait un contact arbitraire par `?email=` sans aucune preuve de
    // propriété ; aucun lien email réel ne pointe ici (le vrai désabonnement
    // passe par handle-email-unsubscribe, à token) → le fermer ne casse rien.
    // Un self-service à token signé pourra rouvrir un GET public plus tard (TODO).
    let auth: Awaited<ReturnType<typeof requireAuth>>;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResp) {
      return authResp as Response;
    }

    // Lecture des params : POST body OR query string
    let email: string | null = null;
    let linkedinUrl: string | null = null;
    let reason: string | null = null;
    let source: string = "api";
    let format: "json" | "html" = "json";
    let requestedOrgId: string | null = null;

    if (req.method === "GET") {
      // GET : params dans query string (utile pour lien dans emails)
      email = url.searchParams.get("email");
      linkedinUrl = url.searchParams.get("linkedin_url");
      reason = url.searchParams.get("reason");
      requestedOrgId = url.searchParams.get("organization_id");
      source = "unsubscribe_link";
      format = "html"; // GET = page HTML user-friendly
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      email = body.email || null;
      linkedinUrl = body.linkedin_url || null;
      reason = body.reason || null;
      source = body.source || "api";
      format = body.format === "html" ? "html" : "json";
      requestedOrgId = typeof body.organization_id === "string" ? body.organization_id : null;
    } else {
      return json({ error: "Method not allowed" }, 405);
    }

    // Validation
    const normalizedEmail = normalizeEmail(email);
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);

    if (!normalizedEmail && !normalizedUrl) {
      const msg = "Paramètre 'email' ou 'linkedin_url' requis.";
      if (format === "html") {
        return htmlResponse(renderPage({
          title: "Demande invalide",
          message: msg,
          success: false,
        }), 400);
      }
      return json({ success: false, error: msg }, 400);
    }

    // Rate limit basique par IP (header X-Forwarded-For)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    // check_rate_limit attend un uuid (p_user_id uuid) : passer l'IP en clair
    // faisait échouer le cast → rlError → fail-closed → 429 PERMANENT sur cet
    // endpoint RGPD. On dérive un uuid déterministe et stable depuis l'IP pour
    // garder un rate-limit PAR IP sans casser le cast.
    const ipHash = await sha256Hex(`rgpd_erase_ip:${clientIp}`);
    const rateLimitKey = `${ipHash.slice(0, 8)}-${ipHash.slice(8, 12)}-${ipHash.slice(12, 16)}-${ipHash.slice(16, 20)}-${ipHash.slice(20, 32)}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(
      supabaseUrl,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    try {
      const { data: rlAllowed, error: rlError } = await serviceClient.rpc("check_rate_limit", {
        p_user_id: rateLimitKey, // uuid déterministe dérivé de l'IP
        p_action: "rgpd_erase",
        p_max_requests: 30,
        p_window_seconds: 3600,
      });
      // Fail CLOSED: the rate limit is the only abuse guard on the public GET
      // path, so if it errors or denies we must reject — never silently allow.
      if (rlError || rlAllowed === false) {
        const msg = "Trop de demandes. Réessayez dans 1 heure.";
        if (format === "html") return htmlResponse(renderPage({ title: "Limite atteinte", message: msg, success: false }), 429);
        return json({ success: false, error: msg }, 429);
      }
    } catch {
      const msg = "Service temporairement indisponible. Réessayez dans quelques minutes.";
      if (format === "html") return htmlResponse(renderPage({ title: "Indisponible", message: msg, success: false }), 503);
      return json({ success: false, error: msg }, 503);
    }

    // Périmètre de l'effacement (SEQ-055).
    const reject = (title: string, msg: string, status: number): Response =>
      format === "html"
        ? htmlResponse(renderPage({ title, message: msg, success: false }), status)
        : json({ success: false, error: msg }, status);
    const globalErasure = auth.method === "service_role" || isPlatformAdmin(auth.userId);
    let scopeOrgId: string | null = null;
    if (!globalErasure) {
      const userId = auth.userId as string;
      let orgId = requestedOrgId;
      if (!orgId) {
        const { data: profile, error: profileError } = await serviceClient
          .from("profiles")
          .select("active_organization_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (profileError) return reject("Erreur", "Votre organisation n'a pas pu être vérifiée. Réessayez.", 500);
        orgId = profile?.active_organization_id ?? null;
      }
      if (!orgId) return reject("Demande invalide", "Aucune organisation active sur votre compte.", 400);
      const { data: membership, error: membershipError } = await serviceClient
        .from("organization_members")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError) return reject("Erreur", "Vos droits n'ont pas pu être vérifiés. Réessayez.", 500);
      if (membership?.role !== "owner" && membership?.role !== "admin") {
        return reject(
          "Accès refusé",
          "Seul un propriétaire ou un administrateur de l'organisation peut effacer les données d'un candidat.",
          403,
        );
      }
      scopeOrgId = orgId;
    }

    // Arrêt des séquences, annulations, liste de suppression, anonymisation
    // et suppression des enrichissements, dans le périmètre.
    const result = await recordGdprErasure(serviceClient, {
      email: normalizedEmail,
      linkedinUrl: normalizedUrl,
      reason: reason || "user_request",
      source,
      organizationId: scopeOrgId,
    });

    if (!result.success) {
      console.error("[rgpd-erase-contact] Failed:", result.error);
      const msg = "L'effacement n'a pas pu être terminé. Relancez la demande : les étapes déjà faites ne seront pas dupliquées. Si le problème persiste, contactez support@konekt.fr.";
      if (format === "html") return htmlResponse(renderPage({ title: "Erreur", message: msg, success: false }), 500);
      return json({ success: false, error: msg }, 500);
    }

    console.log(`[rgpd-erase-contact] OK — scope=${scopeOrgId ? "organization" : "global"}, email=${!!normalizedEmail}, url=${!!normalizedUrl}, source=${source}, stopped=${result.stoppedEnrollments}, ip=${clientIp}`);

    // Bilan exact de ce qui a été fait.
    const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
    const done = [
      plural(result.stoppedEnrollments, "séquence en cours arrêtée", "séquences en cours arrêtées"),
      plural(result.cancelledInmails, "InMail programmé annulé", "InMails programmés annulés"),
      "données de contact supprimées",
    ].join(", ");
    const successMsg = scopeOrgId
      ? `Effacement enregistré pour votre organisation : ${done}.`
      : `Demande d'effacement enregistrée : ${done}. Ces données ne seront plus utilisées dans les enrichissements futurs.`;

    if (format === "html") {
      return htmlResponse(renderPage({
        title: "Demande enregistrée",
        message: successMsg,
        success: true,
      }));
    }

    return json({
      success: true,
      message: successMsg,
      scope: scopeOrgId ? "organization" : "global",
      stopped_enrollments: result.stoppedEnrollments,
      anonymized_enrollments: result.anonymizedEnrollments,
      cancelled_inmails: result.cancelledInmails,
      email_suppressed: result.emailSuppressed,
    });
  } catch (err) {
    console.error("[rgpd-erase-contact] Error:", err);
    return json({ success: false, error: "Erreur serveur" }, 500);
  }
});
