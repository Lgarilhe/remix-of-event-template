// Condition types filtered by step channel
//
// Ce fichier n'importe rien : il est lu tel quel par les tests Node.

export const ALL_CONDITION_TYPES = [
  { value: 'always', label: 'Toujours exécuter' },
  { value: 'if_connected', label: 'Si connecté' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
  // Engagement e-mail
  { value: 'if_email_opened', label: '📧 Si e-mail ouvert' },
  { value: 'if_email_not_opened', label: '📧 Si e-mail non ouvert' },
  { value: 'if_link_clicked', label: '🔗 Si lien cliqué' },
  { value: 'if_link_not_clicked', label: '🔗 Si lien non cliqué' },
  // Données candidat
  { value: 'if_has_email', label: '📬 Si a un e-mail' },
  { value: 'if_no_email', label: '📬 Si pas d\'e-mail' },
  { value: 'if_has_phone', label: '📞 Si a un téléphone' },
  { value: 'if_no_phone', label: '📞 Si pas de téléphone' },
  // Statut
  { value: 'if_bounced', label: '⚠️ Si l\'e-mail est revenu en erreur' },
  { value: 'if_unsubscribed', label: '🚫 Si désinscrit' },
  { value: 'if_score_above', label: '⭐ Si score au-dessus de...' },
];

/**
 * Conditions plus proposées : gardées dans ALL_CONDITION_TYPES pour afficher
 * une étape existante, et signalées. Un e-mail revenu en erreur arrête déjà
 * l'inscription : « Si l'e-mail est revenu en erreur » n'est jamais vraie.
 */
const RETIRED_CONDITION_NOTICES: Record<string, string> = {
  if_bounced: "la condition « Si l'e-mail est revenu en erreur » n'est jamais vraie : un e-mail revenu en erreur arrête déjà la séquence. Choisissez une autre condition.",
};

export function isRetiredCondition(conditionType: string | null | undefined): boolean {
  return !!conditionType && conditionType in RETIRED_CONDITION_NOTICES;
}

export function retiredConditionNotice(conditionType: string | null | undefined): string | null {
  return conditionType && conditionType in RETIRED_CONDITION_NOTICES ? RETIRED_CONDITION_NOTICES[conditionType] : null;
}

/**
 * Ouvertures et clics : des messageries ouvrent les e-mails et suivent les
 * liens automatiquement (anti-virus, préchargement des images). Le moteur
 * filtre les cas évidents, pas tous.
 */
export function engagementConditionHint(conditionType: string | null | undefined): string | null {
  if (conditionType === 'if_email_opened' || conditionType === 'if_email_not_opened') {
    return "L'ouverture est indicative : certaines messageries ouvrent les e-mails automatiquement.";
  }
  if (conditionType === 'if_link_clicked' || conditionType === 'if_link_not_clicked') {
    return 'Le clic est indicatif : certaines messageries suivent les liens automatiquement.';
  }
  return null;
}

const COMMON_CONDITIONS = ['always', 'if_has_email', 'if_no_email', 'if_has_phone', 'if_no_phone', 'if_score_above'];

const EMAIL_CONDITIONS = [
  ...COMMON_CONDITIONS,
  'if_email_opened', 'if_email_not_opened',
  'if_link_clicked', 'if_link_not_clicked',
  'if_unsubscribed',
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
 * Returns the filtered condition types for a given actionType. Une condition
 * retirée n'est listée que si l'étape l'utilise déjà (`current`), pour que le
 * choix affiché reste lisible.
 */
export function getConditionsForActionType(actionType: string, current?: string) {
  const channel = getStepChannel(actionType);

  if (channel === 'branch') {
    // Branches can use ALL conditions (they route between channels)
    return ALL_CONDITION_TYPES.filter(c => !isRetiredCondition(c.value) || c.value === current);
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

  return ALL_CONDITION_TYPES.filter(c => allowedValues.includes(c.value) || (c.value === current && isRetiredCondition(c.value)));
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
