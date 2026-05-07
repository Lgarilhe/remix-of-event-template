// Traduit les codes d'erreur techniques venant des edge functions séquence
// (sequence-send-email, process-sequences) vers du français user-facing.
// Le but est de masquer les noms de fournisseurs (Unipile, Microsoft Graph,
// Anthropic, etc.) qui ne doivent jamais apparaître côté utilisateur.

const ERROR_CODE_LABELS: Record<string, string> = {
  email_provider_not_configured: "Compte email non connecté à Konekt",
  email_send_failed: "Échec de l'envoi (provider email indisponible)",
  no_email_method_available: "Aucune méthode d'envoi email disponible",
  rate_limit: "Quota provider atteint, réessaie plus tard",
  unauthorized: "Identifiants provider expirés (reconnecte le compte)",
  not_found: "Destinataire introuvable",
  internal_error: "Erreur interne",
};

export function formatSequenceError(error: string | null | undefined): string {
  if (!error) return '';

  // Code d'erreur générique connu → label FR
  if (ERROR_CODE_LABELS[error]) return ERROR_CODE_LABELS[error];

  // email_send_failed_<status_code> → label générique
  if (/^email_send_failed_\d+$/.test(error)) {
    return ERROR_CODE_LABELS.email_send_failed;
  }
  // linkedin_send_failed_<status_code>
  if (/^linkedin_send_failed_\d+$/.test(error)) {
    const code = error.split('_').pop();
    if (code === '429') return "Quota LinkedIn atteint, on ralentit l'envoi";
    if (code === '401' || code === '403') return "Compte LinkedIn déconnecté, reconnecte-le";
    return "Échec de l'envoi LinkedIn";
  }
  // whatsapp_send_failed_<status_code>
  if (/^whatsapp_send_failed_\d+$/.test(error)) {
    return "Échec de l'envoi WhatsApp";
  }

  // JSON-encoded errors : extraire un champ lisible
  try {
    const parsed = JSON.parse(error);
    if (parsed.detail) return String(parsed.detail);
    if (parsed.title) return String(parsed.title);
    if (parsed.message) return String(parsed.message);
  } catch {
    if (error.startsWith('{') || error.startsWith('[')) {
      const titleMatch = error.match(/"title"\s*:\s*"([^"]+)"/);
      const detailMatch = error.match(/"detail"\s*:\s*"([^"]+)"/);
      if (detailMatch) return detailMatch[1];
      if (titleMatch) return titleMatch[1];
    }
  }

  // Strip vendor names si on en trouve dans des messages legacy
  const sanitized = error
    .replace(/\bUnipile(\s+WhatsApp)?(\s+\d+)?\s*:?/gi, '')
    .replace(/\bMicrosoft Graph(\s+API)?(\s+\d+)?\s*:?/gi, '')
    .replace(/\bMICROSOFT_GRAPH_TOKEN\b/g, '')
    .replace(/\bAnthropic\b/gi, 'IA')
    .replace(/\bResend\b/gi, '')
    .trim();

  return sanitized || ERROR_CODE_LABELS.internal_error;
}
