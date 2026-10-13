// Envoi d'un e-mail de séquence par la boîte reliée du membre (Gmail, Outlook,
// IMAP), par le client partagé du service de connexion.
//
// Au plus un envoi : un délai dépassé, une erreur serveur ou une réponse
// illisible donnent `send_uncertain` (l'e-mail a pu partir) et ne sont jamais
// repris. Aucun texte du fournisseur ne sort d'ici : les codes rendus sont ceux
// que lit sequence-send-email, et le corps brut reste dans les journaux.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/sequence-email-send.test.ts

import { describeForLog, isUnipileError, sendEmail, type TransportOptions } from './unipile/index.ts';
import { providerMessageId } from './sequence-email-policy.mjs';

export interface EmailSendResult {
  success: boolean;
  messageId?: string | null;
  /**
   * Code d'échec : `send_uncertain`, `sender_mailbox_disconnected`,
   * `sender_mailbox_limited`, `email_provider_not_configured`,
   * `email_send_failed_<code HTTP>` ou `email_send_failed`.
   */
  error?: string;
  /** Limite de débit ou de volume : l'étape est reportée d'une heure. */
  rateLimited?: boolean;
}

export interface MailboxEmail {
  accountId: string;
  /** Nom affiché de l'expéditeur (profil Konekt). */
  senderName: string;
  /** Adresse de la boîte, exigée par le fournisseur à côté d'un nom affiché. */
  senderAddress: string | null;
  to: string;
  subject: string;
  htmlBody: string;
  cc?: string[];
  bcc?: string[];
}

/** Envoie l'e-mail. Ne lève jamais : tout échec est un code de `EmailSendResult`. */
export async function sendViaMailbox(mail: MailboxEmail, options: TransportOptions = {}): Promise<EmailSendResult> {
  const ccRecipients = (mail.cc || []).filter(Boolean).map((email) => ({ email }));
  const bccRecipients = (mail.bcc || []).filter(Boolean).map((email) => ({ email }));

  // Pas de suivi natif du fournisseur (tracking_options) : ses événements ne
  // sont rattachés à rien, il doublait le pixel et chaque redirection de lien.
  const request = {
    accountId: mail.accountId,
    to: [{ email: mail.to }],
    ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
    ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
    subject: mail.subject,
    html: mail.htmlBody,
  };
  // Le nom affiché est celui du profil Konekt de l'expéditeur. Le fournisseur
  // exige alors l'adresse de la boîte à côté du nom ; sans adresse connue, la
  // boîte envoie sous son propre nom.
  const from = mail.senderName && mail.senderAddress
    ? { email: mail.senderAddress, display_name: mail.senderName }
    : undefined;

  let outcome: Awaited<ReturnType<typeof sendEmail>>;
  try {
    outcome = await sendEmail(from ? { ...request, from } : request, options);
    if (from && outcome.outcome === 'refused' && outcome.kind === 'validation') {
      // Refus de l'expéditeur : rien n'est parti, un seul nouvel essai sous le nom de la boîte.
      console.warn('[sequence-send-email] expéditeur refusé, nouvel essai sans nom affiché');
      outcome = await sendEmail(request, options);
    }
  } catch (err) {
    // Levée avant toute requête (clé du service absente, identifiant de boîte
    // ancien, saisie invalide) : rien n'est parti.
    console.error('[sequence-send-email] envoi non tenté:', describeForLog(err));
    if (isUnipileError(err) && err.kind === 'account_disconnected') return { success: false, error: 'sender_mailbox_disconnected' };
    if (isUnipileError(err) && err.kind === 'validation') return { success: false, error: 'email_send_failed_400' };
    return { success: false, error: 'email_provider_not_configured' };
  }

  if (outcome.outcome === 'sent') {
    // Envoi accepté. Identifiant réel du fournisseur, jamais un identifiant
    // inventé : l'en-tête Message-ID du courrier (celui qu'une réponse citera)
    // quand il est connu, sinon l'identifiant du courrier chez le fournisseur.
    const messageId = providerMessageId({ message_id: outcome.messageId, id: outcome.emailId });
    console.log(`[sequence-send-email] email sent: ${messageId ?? '(sans identifiant)'}`);
    return { success: true, messageId };
  }

  console.error(`[sequence-send-email] email provider ${outcome.outcome}: ${describeForLog(outcome.error)}`);
  // Délai dépassé, 5xx ou réponse illisible : le fournisseur a pu accepter
  // l'e-mail. Issue inconnue, pas de relance automatique.
  if (outcome.outcome === 'uncertain') return { success: false, error: 'send_uncertain' };
  const status = outcome.error.status;
  switch (outcome.kind) {
    case 'rate_limited':
      return { success: false, error: `email_send_failed_${status ?? 429}`, rateLimited: true };
    case 'provider_limit':
      // Limite d'usage du fournisseur : seule une 429 est reprise (le code porte
      // « 429 », lu par sequence-send-email). Un 403 ou 422 de quota n'est pas
      // un débit à attendre : échec définitif, sinon l'étape repartirait chaque
      // heure sans fin.
      return { success: false, error: `email_send_failed_${status ?? 429}` };
    case 'account_disconnected':
      return { success: false, error: 'sender_mailbox_disconnected' };
    case 'account_degraded':
      return { success: false, error: 'sender_mailbox_limited' };
    default:
      return { success: false, error: status === null ? 'email_send_failed' : `email_send_failed_${status}` };
  }
}
