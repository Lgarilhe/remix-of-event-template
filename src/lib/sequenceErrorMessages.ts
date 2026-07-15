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
  suppression_check_failed: "Vérification de désinscription impossible, envoi reporté",
};

// Strip des noms de vendors (règle branding : jamais user-facing).
function stripVendors(text: string): string {
  return text
    .replace(/\bUnipile(\s+WhatsApp)?(\s+\d+)?\s*:?/gi, '')
    .replace(/\bMicrosoft Graph(\s+API)?(\s+\d+)?\s*:?/gi, '')
    .replace(/\bMICROSOFT_GRAPH_TOKEN\b/g, '')
    .replace(/\bAnthropic\b/gi, 'IA')
    .replace(/\bResend\b/gi, '')
    .trim();
}

export function formatSequenceError(error: string | null | undefined): string {
  if (!error) return '';

  // Code d'erreur générique connu → label FR
  if (ERROR_CODE_LABELS[error]) return ERROR_CODE_LABELS[error];

  // ── Formats RÉELS produits par le moteur (audit 2026-07, Frontend M5) ─────
  // Les regex étaient ancrées en fin (`..._\d+$`) alors que le moteur appende
  // le corps de la réponse fournisseur : `linkedin_send_failed_429: {...}`.
  // Résultat : tous les labels FR ci-dessous étaient du code mort et l'user
  // voyait le JSON technique brut. On matche désormais par PRÉFIXE.

  // email_send_failed_<status_code>[: body]
  if (/^email_send_failed_\d+/.test(error)) {
    return ERROR_CODE_LABELS.email_send_failed;
  }
  // linkedin_send_failed_<status_code>[: body]
  const linkedinMatch = error.match(/^linkedin_send_failed_(\d+)/);
  if (linkedinMatch) {
    const code = linkedinMatch[1];
    if (code === '429') return "Quota LinkedIn atteint, on ralentit l'envoi";
    if (code === '401' || code === '403') return "Compte LinkedIn déconnecté, reconnecte-le";
    return "Échec de l'envoi LinkedIn";
  }
  // whatsapp_send_failed_<status_code>[: body]
  if (/^whatsapp_send_failed_\d+/.test(error)) {
    return "Échec de l'envoi WhatsApp";
  }
  // `Invite <status>: <body>` (envoi d'invitation refusé par le provider)
  const inviteMatch = error.match(/^Invite (\d+)/);
  if (inviteMatch) {
    if (inviteMatch[1] === '429') return "Quota d'invitations LinkedIn atteint, on ralentit";
    return "Échec de l'envoi de l'invitation LinkedIn";
  }
  // `Profile visit <status>: <body>`
  if (/^Profile visit \d+/.test(error)) {
    return "Échec de la visite de profil LinkedIn";
  }
  // `sequence-send-email <status>: <body>` (échec de la fonction d'envoi email)
  if (/^sequence-send-email \d+/.test(error)) {
    return ERROR_CODE_LABELS.email_send_failed;
  }
  // `Account status: CREDENTIALS|ERROR|...`
  const accountStatusMatch = error.match(/^Account status:\s*(\w+)/);
  if (accountStatusMatch) {
    return "Compte LinkedIn à reconnecter (envoi en pause)";
  }
  // `no_email: ...`
  if (/^no_email/.test(error)) {
    return "Pas d'adresse email pour ce candidat";
  }
  // Limites dures fournisseur
  if (/limit_exceeded|cannot_resend_yet|cannot_resend_within_24hrs/i.test(error)) {
    return "Limite LinkedIn atteinte, envoi en pause jusqu'à demain";
  }
  // Messages du janitor / recovery (déjà en français, on les laisse passer)
  if (/^Interrompu pendant l'envoi/.test(error) || /^Recovered/.test(error)) {
    return "Interrompu pendant l'envoi — relance auto désactivée pour éviter un doublon";
  }
  if (/^Failed after 3 retries/.test(error)) {
    return "Échec après 3 tentatives, action abandonnée";
  }
  // Solde InMail épuisé (message moteur déjà FR mais avec détails techniques)
  if (/Quota InMail épuisé/i.test(error)) {
    return "Crédits InMail épuisés — rechargez ou changez de mode d'envoi";
  }
  if (/InMail balance check/i.test(error)) {
    return "Vérification des crédits InMail impossible, envoi reporté";
  }
  // Timeout IA
  if (/API timeout/i.test(error)) {
    return "Génération IA trop lente, nouvel essai au prochain cycle";
  }

  // JSON-encoded errors : extraire un champ lisible (vendor-strippé —
  // audit 2026-07 M5 : parsed.detail/title partait brut vers l'UI)
  try {
    const parsed = JSON.parse(error);
    if (parsed.detail) return stripVendors(String(parsed.detail)) || ERROR_CODE_LABELS.internal_error;
    if (parsed.title) return stripVendors(String(parsed.title)) || ERROR_CODE_LABELS.internal_error;
    if (parsed.message) return stripVendors(String(parsed.message)) || ERROR_CODE_LABELS.internal_error;
  } catch {
    if (error.startsWith('{') || error.startsWith('[')) {
      const titleMatch = error.match(/"title"\s*:\s*"([^"]+)"/);
      const detailMatch = error.match(/"detail"\s*:\s*"([^"]+)"/);
      if (detailMatch) return stripVendors(detailMatch[1]) || ERROR_CODE_LABELS.internal_error;
      if (titleMatch) return stripVendors(titleMatch[1]) || ERROR_CODE_LABELS.internal_error;
    }
  }

  // Strip vendor names si on en trouve dans des messages legacy
  const sanitized = stripVendors(error);

  return sanitized || ERROR_CODE_LABELS.internal_error;
}
