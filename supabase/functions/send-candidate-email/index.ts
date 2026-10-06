import { requireOrgAccess } from "../_shared/require-auth.ts";
import { resolveUnipileCredentials } from "../_shared/resolve-org-credentials.ts";
import { GdprRegistryUnavailableError, isCandidateErasedForOrg } from "../_shared/get-or-fetch-contact.ts";
import { canPresentToManager, noteContent, textToHtml, validateSendPayload } from "../_shared/interview-followup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Envoie, depuis la boîte e-mail reliée de la personne connectée, le message de
 * suivi d'un candidat ou la présentation d'un candidat au manager, après
 * relecture dans l'interface. Un envoi réel et irréversible : tout se vérifie ici,
 * pas seulement à l'écran.
 *  - utilisateur connecté, membre de l'organisation (jamais la clé de service) ;
 *  - présentation : accord du candidat déclaré, cabinet ou freelance seulement ;
 *  - jamais vers ou pour un candidat qui a demandé l'effacement de ses données
 *    (échec fermé : un registre illisible refuse) ;
 *  - jamais vers une adresse de la liste d'exclusion (retours en erreur, désabonnements) ;
 *  - la boîte est celle de la personne qui envoie.
 * Une note est déposée sur la fiche du candidat : ce qui est parti, vers qui, quand,
 * et l'accord déclaré. Aucun changement d'étape du pipeline : un candidat déjà en
 * entretien ne recule pas, et un message n'avance personne.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "Requête illisible.", error_code: "INVALID_BODY" }, 400);

    let access;
    try {
      access = await requireOrgAccess(req, body, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const { userId, organizationId, adminClient } = access;

    const { data: allowed } = await adminClient.rpc("check_rate_limit", {
      p_user_id: userId, p_action: "send_candidate_email", p_max_requests: 20, p_window_seconds: 60,
    });
    if (allowed === false) return json({ error: "Trop d'envois. Patientez quelques secondes.", error_code: "RATE_LIMIT" }, 429);

    const checked = validateSendPayload(body);
    if (!checked.ok) return json({ error: checked.error, error_code: checked.code }, checked.status);
    const payload = checked.value;

    if (payload.kind === "manager_presentation") {
      const { data: org } = await adminClient.from("organizations").select("org_type").eq("id", organizationId).maybeSingle();
      if (!canPresentToManager((org as { org_type?: string } | null)?.org_type)) {
        return json({ error: "La présentation au manager est réservée aux cabinets et aux freelances.", error_code: "ORG_TYPE_NOT_ALLOWED" }, 403);
      }
    }

    // Candidat effacé : aucun message ni aucune présentation. Échec fermé.
    try {
      const erased = await isCandidateErasedForOrg(adminClient, {
        organizationId,
        linkedinIds: [payload.candidate_id],
        linkedinUrl: payload.linkedin_url,
      });
      if (erased) {
        return json({ error: "Ce candidat a demandé l'effacement de ses données : aucun message ne peut être envoyé.", error_code: "CANDIDATE_ERASED" }, 403);
      }
    } catch (err) {
      console.error("[send-candidate-email] contrôle d'effacement impossible:", err instanceof GdprRegistryUnavailableError ? err.message : err);
      return json({ error: "Impossible de vérifier le registre d'effacement pour l'instant. Réessayez dans un instant.", error_code: "GDPR_UNVERIFIED" }, 503);
    }

    // Liste d'exclusion : retours en erreur et désabonnements.
    const { data: suppressed } = await adminClient.from("suppressed_emails").select("email").eq("email", payload.to_email).maybeSingle();
    if (suppressed) {
      return json({ error: "Cette adresse est sur la liste d'exclusion (retour en erreur ou désabonnement) : l'envoi est refusé.", error_code: "EMAIL_SUPPRESSED" }, 422);
    }

    // La boîte de la personne qui envoie, jamais celle d'un collègue.
    const { data: mailbox } = await adminClient
      .from("member_email_accounts")
      .select("email_account_id, email_address, account_status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .or("account_status.is.null,account_status.in.(OK,CONNECTED)")
      .order("linked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sender = mailbox as { email_account_id: string; email_address: string | null } | null;
    if (!sender) {
      return json({ error: "Aucune boîte e-mail n'est reliée à votre compte. Reliez-la dans Paramètres, Mon compte, Connexions.", error_code: "NO_MAILBOX" }, 409);
    }

    let creds: { apiKey: string; dsn: string } | null = null;
    try {
      creds = await resolveUnipileCredentials(organizationId, adminClient);
    } catch (err) {
      console.error("[send-candidate-email] identifiants du service e-mail:", err);
    }
    if (!creds) {
      return json({ error: "Le service d'envoi est indisponible pour l'instant. Réessayez dans un instant.", error_code: "PROVIDER_UNAVAILABLE" }, 503);
    }
    const baseDsn = creds.dsn.startsWith("http") ? creds.dsn : `https://${creds.dsn}`;

    const res = await fetchWithTimeout(`${baseDsn}/api/v1/emails`, {
      method: "POST",
      headers: { "X-API-KEY": creds.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: sender.email_account_id,
        subject: payload.subject,
        body: textToHtml(payload.body),
        to: [{ display_name: payload.to_name || payload.to_email, identifier: payload.to_email }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[send-candidate-email] refus du service d'envoi:", res.status, detail.slice(0, 300));
      return json({ error: "L'envoi a échoué. Vérifiez que votre boîte e-mail est bien reliée, puis réessayez.", error_code: "SEND_FAILED" }, 502);
    }

    // Le message est parti : la note ne peut plus faire échouer la réponse.
    const sentAt = new Date().toISOString();
    const { error: noteError } = await adminClient.from("candidate_notes").insert({
      candidate_id: payload.candidate_id,
      organization_id: organizationId,
      created_by: userId,
      content: noteContent({
        kind: payload.kind,
        toEmail: payload.to_email,
        toName: payload.to_name,
        fromEmail: sender.email_address,
        subject: payload.subject,
        sentAtIso: sentAt,
      }),
    });
    if (noteError) console.error("[send-candidate-email] note non enregistrée:", noteError.message);

    return json({ success: true, sent_at: sentAt, from_email: sender.email_address, noted: !noteError });
  } catch (error) {
    console.error("[send-candidate-email] erreur:", error);
    return json({ error: "L'envoi n'a pas pu aboutir. Réessayez dans un instant.", error_code: "INTERNAL" }, 500);
  }
});
