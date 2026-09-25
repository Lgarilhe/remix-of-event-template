// Condition types filtered by step channel

// Libellés en français, sans emoji (revue design D-41, D-70).
export const ALL_CONDITION_TYPES = [
  { value: 'always', label: 'Toujours exécuter' },
  { value: 'if_connected', label: 'Si connecté (1er degré)' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
  // Engagement e-mail
  { value: 'if_email_opened', label: "Si l'e-mail est ouvert" },
  { value: 'if_email_not_opened', label: "Si l'e-mail n'est pas ouvert" },
  { value: 'if_link_clicked', label: 'Si un lien est cliqué' },
  { value: 'if_link_not_clicked', label: "Si aucun lien n'est cliqué" },
  // Données candidat
  { value: 'if_has_email', label: 'Si une adresse e-mail est connue' },
  { value: 'if_no_email', label: 'Si aucune adresse e-mail' },
  { value: 'if_has_phone', label: 'Si un numéro de téléphone est connu' },
  { value: 'if_no_phone', label: 'Si aucun numéro de téléphone' },
  // Statut
  { value: 'if_bounced', label: "Si l'e-mail n'a pas été distribué" },
  { value: 'if_unsubscribed', label: "Si le candidat s'est désinscrit" },
  { value: 'if_score_above', label: 'Si le score dépasse un seuil' },
];

const COMMON_CONDITIONS = ['always', 'if_has_email', 'if_no_email', 'if_has_phone', 'if_no_phone', 'if_score_above'];

const EMAIL_CONDITIONS = [
  ...COMMON_CONDITIONS,
  'if_email_opened', 'if_email_not_opened',
  'if_link_clicked', 'if_link_not_clicked',
  'if_bounced', 'if_unsubscribed',
];

const LINKEDIN_CONDITIONS = [
  ...COMMON_CONDITIONS,
  'if_connected', 'if_not_connected', 'if_no_response',
];

const WHATSAPP_CONDITIONS = [
  ...COMMON_CONDITIONS,
];

/**
 * Determine the "channel" of a step based on actionType.
 */
export function getStepChannel(actionType: string): 'email' | 'linkedin' | 'whatsapp' | 'branch' {
  if (actionType === 'email') return 'email';
  if (actionType === 'inmail') return 'linkedin';
  if (actionType === 'whatsapp_message') return 'whatsapp';
  if (['condition_branch', 'check_connection'].includes(actionType)) return 'branch';
  return 'linkedin';
}

/**
 * Returns the filtered condition types for a given actionType.
 */
export function getConditionsForActionType(actionType: string) {
  const channel = getStepChannel(actionType);

  if (channel === 'branch') {
    // Branches can use ALL conditions (they route between channels)
    return ALL_CONDITION_TYPES;
  }

  let allowedValues: string[];
  switch (channel) {
    case 'email':
      allowedValues = EMAIL_CONDITIONS;
      break;
    case 'whatsapp':
      allowedValues = WHATSAPP_CONDITIONS;
      break;
    case 'linkedin':
    default:
      allowedValues = LINKEDIN_CONDITIONS;
      break;
  }

  return ALL_CONDITION_TYPES.filter(c => allowedValues.includes(c.value));
}

/**
 * Check if a condition is cross-channel (e.g. email condition on LinkedIn step).
 */
export function isCrossChannelCondition(actionType: string, conditionType: string): boolean {
  const channel = getStepChannel(actionType);
  if (channel === 'branch') return false;
  
  const emailOnlyConditions = ['if_email_opened', 'if_email_not_opened', 'if_link_clicked', 'if_link_not_clicked', 'if_bounced', 'if_unsubscribed'];
  const linkedinOnlyConditions = ['if_connected', 'if_not_connected', 'if_no_response'];

  if (channel !== 'email' && emailOnlyConditions.includes(conditionType)) return true;
  if (channel !== 'linkedin' && linkedinOnlyConditions.includes(conditionType)) return true;
  
  return false;
}

/**
 * Returns true if the step type needs an email subject field.
 * Email and InMail both need subjects.
 */
export function needsEmailSubject(actionType: string): boolean {
  return ['inmail', 'email'].includes(actionType);
}

/**
 * Returns true if the step is an email-channel step.
 */
export function isEmailStep(actionType: string): boolean {
  return getStepChannel(actionType) === 'email';
}

/**
 * Returns true if the step is a WhatsApp step.
 */
export function isWhatsAppStep(actionType: string): boolean {
  return actionType === 'whatsapp_message';
}

/**
 * Returns true if the step is a LinkedIn step.
 */
export function isLinkedInStep(actionType: string): boolean {
  return getStepChannel(actionType) === 'linkedin';
}
