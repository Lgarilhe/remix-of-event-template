/**
 * rgpd-erase-contact — Endpoint public pour le droit à l'effacement (RGPD art. 17)
 *
 * Usage typique :
 *   - Lien dans les emails outreach : https://konekt-app-navy.vercel.app/api/rgpd-erase?email=...&token=...
 *   - Frontend admin Konekt qui appelle ce endpoint avec un email/linkedin_url
 *   - Webhook depuis suppression list (Resend, etc.)
 *
 * Workflow :
 *   1. Reçoit email OU linkedin_url
 *   2. INSERT dans gdpr_erasures (hash SHA-256 only)
 *   3. DELETE en cascade dans candidate_enrichments matching
 *   4. Retourne 200 OK avec un message de confirmation
 *
 * IMPORTANT : aucune authentification requise (endpoint public).
 * La sécurité repose sur :
 *   - Le token signé dans le lien (validé côté lien d'unsubscribe — TODO V2)
 *   - Le rate limit (max 30 req/h par IP)
 *   - Le hash SHA-256 (on ne révèle jamais si un email existe en BDD)
 *
 * Verify_jwt = false dans config.toml.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { recordGdprErasure, normalizeEmail, normalizeLinkedInUrl } from "../_shared/get-or-fetch-contact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    // Lecture des params : POST body OR query string
    let email: string | null = null;
    let linkedinUrl: string | null = null;
    let reason: string | null = null;
    let source: string = "api";
    let format: "json" | "html" = "json";

    if (req.method === "GET") {
      // GET : params dans query string (utile pour lien dans emails)
      email = url.searchParams.get("email");
      linkedinUrl = url.searchParams.get("linkedin_url");
      reason = url.searchParams.get("reason");
      source = "unsubscribe_link";
      format = "html"; // GET = page HTML user-friendly
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      email = body.email || null;
      linkedinUrl = body.linkedin_url || null;
      reason = body.reason || null;
      source = body.source || "api";
      format = body.format === "html" ? "html" : "json";
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(
      supabaseUrl,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    try {
      const { data: rlAllowed } = await serviceClient.rpc("check_rate_limit", {
        p_user_id: clientIp, // utilise l'IP comme clé
        p_action: "rgpd_erase",
        p_max_requests: 30,
        p_window_seconds: 3600,
      });
      if (rlAllowed === false) {
        const msg = "Trop de demandes. Réessayez dans 1 heure.";
        if (format === "html") return htmlResponse(renderPage({ title: "Limite atteinte", message: msg, success: false }), 429);
        return json({ success: false, error: msg }, 429);
      }
    } catch { /* RPC indispo, on laisse passer */ }

    // Enregistrement de la demande + DELETE en cascade
    const result = await recordGdprErasure(serviceClient, {
      email: normalizedEmail,
      linkedinUrl: normalizedUrl,
      reason: reason || "user_request",
      source,
    });

    if (!result.success) {
      console.error("[rgpd-erase-contact] Failed:", result.error);
      const msg = "Une erreur est survenue lors du traitement de votre demande. Réessayez ou contactez support@konekt.fr.";
      if (format === "html") return htmlResponse(renderPage({ title: "Erreur", message: msg, success: false }), 500);
      return json({ success: false, error: msg }, 500);
    }

    console.log(`[rgpd-erase-contact] OK — email=${!!normalizedEmail}, url=${!!normalizedUrl}, source=${source}, ip=${clientIp}`);

    const successMsg = "Votre demande d'effacement a bien été enregistrée. Vos données de contact ont été retirées de notre base et ne seront plus utilisées dans nos enrichissements futurs.";

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
    });
  } catch (err) {
    console.error("[rgpd-erase-contact] Error:", err);
    return json({ success: false, error: "Erreur serveur" }, 500);
  }
});
