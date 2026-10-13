import { requireOrgAccess } from "../_shared/require-auth.ts";
import { assertAccountOwnedByOrg, describeForLog, isUnipileError, sendEmail } from "../_shared/unipile/index.ts";
import { GdprRegistryUnavailableError, isCandidateErasedForOrg } from "../_shared/get-or-fetch-contact.ts";
import { canPresentToManager, noteContent, textToHtml, validateSendPayload } from "../_shared/interview-followup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Le service est global : la boîte doit être celle que cette personne a reliée dans cette organisation.
    try {
      await assertAccountOwnedByOrg(adminClient, organizationId, sender.email_account_id, { userId, kinds: ["email"] });
    } catch (err) {
      console.error("[send-candidate-email] boîte non vérifiée:", describeForLog(err));
      const ownershipFailure = isUnipileError(err) && err.code === "account_not_owned";
      return json({
        error: ownershipFailure
          ? "Aucune boîte e-mail n'est reliée à votre compte. Reliez-la dans Paramètres, Mon compte, Connexions."
          : "Votre boîte e-mail ne peut pas être vérifiée pour l'instant. Réessayez dans un instant.",
        error_code: ownershipFailure ? "NO_MAILBOX" : "PROVIDER_UNAVAILABLE",
      }, ownershipFailure ? 409 : 503);
    }

    // Envoi au plus une fois : un envoi incertain n'est jamais donné pour parti et jamais repris.
    let outcome: Awaited<ReturnType<typeof sendEmail>>;
    try {
      outcome = await sendEmail({
        accountId: sender.email_account_id,
        to: [{ email: payload.to_email, display_name: payload.to_name || payload.to_email }],
        subject: payload.subject,
        html: textToHtml(payload.body),
      });
    } catch (err) {
      // Levée avant toute requête : clé absente, saisie invalide, identifiant de compte périmé. Rien n'est parti.
      console.error("[send-candidate-email] envoi non tenté:", describeForLog(err));
      if (isUnipileError(err) && err.kind === "account_disconnected") {
        return json({ error: "Votre boîte e-mail doit être reconnectée dans Paramètres, Mon compte, Connexions, avant d'envoyer.", error_code: "MAILBOX_RECONNECT" }, 409);
      }
      return json({ error: "Le service d'envoi est indisponible pour l'instant. Réessayez dans un instant.", error_code: "PROVIDER_UNAVAILABLE" }, 503);
    }
    if (outcome.outcome === "uncertain") {
      console.error("[send-candidate-email] envoi non confirmé:", describeForLog(outcome.error));
      return json({ error: "L'envoi n'est pas confirmé : le message est peut-être parti. Vérifiez vos éléments envoyés avant de réessayer.", error_code: "SEND_UNCERTAIN" }, 502);
    }
    if (outcome.outcome === "refused") {
      console.error("[send-candidate-email] refus du service d'envoi:", describeForLog(outcome.error));
      // Le service refuse l'accès à la boîte : même réponse qu'un envoi non tenté pour une boîte à reconnecter.
      if (outcome.kind === "account_disconnected") {
        return json({ error: "Votre boîte e-mail doit être reconnectée dans Paramètres, Mon compte, Connexions, avant d'envoyer.", error_code: "MAILBOX_RECONNECT" }, 409);
      }
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
