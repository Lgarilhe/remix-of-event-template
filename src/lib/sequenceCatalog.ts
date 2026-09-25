/**
 * Catalogue des séquences : libellés des étapes, des statuts d'inscription et
 * d'exécution, des raisons de pause et d'arrêt. Une seule table pour la
 * messagerie, l'éditeur, la préparation, le suivi et le journal (revue design
 * D-01, D-49, D-55, D-56, D-58).
 *
 * Un identifiant technique (« connection_request », « replied ») ne s'affiche
 * jamais : une valeur inconnue prend un libellé générique.
 *
 * Module pur, sans React : les icônes et les badges sont dans
 * `src/components/outreach/SequenceBadges.tsx`.
 */

import type { Channel } from './channels';

// ─── Étapes ──────────────────────────────────────────────────────────────

export type SequenceStepKind = 'action' | 'wait' | 'condition';

export interface SequenceActionMeta {
  label: string;
  /** Canal de l'étape ; null pour une attente ou une condition multicanale. */
  channel: Channel | null;
  kind: SequenceStepKind;
}

/** Clés écrites par l'éditeur (`SequenceBuilder`) et lues par le moteur d'envoi. */
export const SEQUENCE_ACTIONS: Record<string, SequenceActionMeta> = {
  connection_request: { label: 'Invitation LinkedIn', channel: 'linkedin', kind: 'action' },
  message: { label: 'Message LinkedIn', channel: 'linkedin', kind: 'action' },
  smart_message: { label: 'Message LinkedIn (IA)', channel: 'linkedin', kind: 'action' },
  inmail: { label: 'InMail', channel: 'linkedin', kind: 'action' },
  profile_visit: { label: 'Visite du profil', channel: 'linkedin', kind: 'action' },
  email: { label: 'E-mail', channel: 'email', kind: 'action' },
  whatsapp_message: { label: 'Message WhatsApp', channel: 'whatsapp', kind: 'action' },
  check_connection: { label: 'Vérifier la connexion', channel: 'linkedin', kind: 'condition' },
  condition_branch: { label: 'Condition', channel: null, kind: 'condition' },
  wait_connection: { label: "Attendre l'acceptation", channel: 'linkedin', kind: 'wait' },
  wait_until_connected: { label: "Attendre l'acceptation", channel: 'linkedin', kind: 'wait' },
  wait_reply: { label: 'Attendre la réponse', channel: null, kind: 'wait' },
  wait_profile_visit: { label: 'Attendre une visite en retour', channel: 'linkedin', kind: 'wait' },
  wait_for_event: { label: 'Attendre un événement', channel: null, kind: 'wait' },
};

/** Anciennes clés encore présentes dans l'historique. */
const ACTION_ALIASES: Record<string, string> = {
  send_connection: 'connection_request',
  send_invitation: 'connection_request',
  send_message: 'message',
  send_smart_message: 'smart_message',
  send_inmail: 'inmail',
  send_email: 'email',
  visit_profile: 'profile_visit',
  whatsapp: 'whatsapp_message',
};

export const UNKNOWN_STEP_LABEL = 'Étape de séquence';

export function normalizeActionType(type: string | null | undefined): string | null {
  if (!type) return null;
  return ACTION_ALIASES[type] ?? type;
}

export function sequenceActionMeta(type: string | null | undefined): SequenceActionMeta | null {
  const key = normalizeActionType(type);
  return key ? SEQUENCE_ACTIONS[key] ?? null : null;
}

/** « Invitation LinkedIn », jamais « connection_request ». */
export function sequenceActionLabel(type: string | null | undefined): string {
  return sequenceActionMeta(type)?.label ?? UNKNOWN_STEP_LABEL;
}

// ─── Statuts ─────────────────────────────────────────────────────────────

/** Variante de `Badge` (fond teinté, texte de la couleur du statut). */
export type StatusTone = 'success' | 'warning' | 'info' | 'danger' | 'muted';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

/** Statut d'une inscription (`sequence_enrollments.status`). */
export const ENROLLMENT_STATUSES: Record<string, StatusMeta> = {
  active: { label: 'En cours', tone: 'info' },
  paused: { label: 'En pause', tone: 'warning' },
  replied: { label: 'A répondu', tone: 'success' },
  booked: { label: 'Rendez-vous pris', tone: 'success' },
  completed: { label: 'Terminée', tone: 'muted' },
  stopped: { label: 'Arrêtée', tone: 'muted' },
  cancelled: { label: 'Annulée', tone: 'muted' },
  bounced: { label: 'Non distribuée', tone: 'danger' },
};

/** Statut d'une étape exécutée ou prévue (`sequence_step_executions.status`). */
export const EXECUTION_STATUSES: Record<string, StatusMeta> = {
  pending: { label: 'À venir', tone: 'muted' },
  scheduled: { label: 'Planifiée', tone: 'info' },
  sending: { label: 'Envoi en cours', tone: 'info' },
  waiting_event: { label: 'En attente', tone: 'muted' },
  quota_blocked: { label: 'Limite atteinte', tone: 'warning' },
  sent: { label: 'Envoyée', tone: 'success' },
  executed: { label: 'Faite', tone: 'success' },
  opened: { label: 'Ouverte', tone: 'success' },
  clicked: { label: 'Lien cliqué', tone: 'success' },
  replied: { label: 'Réponse reçue', tone: 'success' },
  skipped: { label: 'Ignorée', tone: 'muted' },
  cancelled: { label: 'Annulée', tone: 'muted' },
  failed: { label: 'En échec', tone: 'danger' },
  bounced: { label: 'Non distribuée', tone: 'danger' },
};

const UNKNOWN_STATUS: StatusMeta = { label: 'Statut inconnu', tone: 'muted' };

export function enrollmentStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && ENROLLMENT_STATUSES[status]) || UNKNOWN_STATUS;
}

export function executionStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && EXECUTION_STATUSES[status]) || UNKNOWN_STATUS;
}

// ─── Raisons ─────────────────────────────────────────────────────────────

/**
 * Raison d'une pause (`sequence_enrollments.pause_reason`). Une pause à la
 * main (`manual`) n'a pas besoin d'explication : pas de libellé.
 */
export const PAUSE_REASONS: Record<string, string> = {
  account_disconnected: 'Compte LinkedIn déconnecté',
  quota_reached: "Limite d'envois atteinte",
  subscription_required: 'Abonnement requis',
};

export function pauseReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return PAUSE_REASONS[reason] ?? null;
}

/**
 * Raison d'une étape ignorée ou annulée (`skip_reason`, texte libre écrit par
 * le moteur d'envoi, en anglais ou en français selon l'endroit). Traduite à
 * l'affichage ; un texte inconnu garde un libellé générique plutôt que la
 * phrase technique.
 */
const SKIP_REASON_RULES: [RegExp, string][] = [
  [/reply detected|réponse marquée|marqué comme répondu/i, 'Le candidat a répondu'],
  [/calendly booking/i, 'Rendez-vous pris'],
  [/^timeout/i, "Délai d'attente dépassé"],
  [/^condition/i, 'Condition non remplie'],
  [/no phone number/i, 'Pas de numéro de téléphone'],
  [/no email/i, "Pas d'adresse e-mail"],
  [/no linkedin account|compte linkedin dissocié/i, 'Aucun compte LinkedIn relié'],
  [/bloqué le compte linkedin/i, 'Le candidat a bloqué le compte LinkedIn'],
  [/bounced/i, 'E-mail non distribué'],
  [/liste de suppression/i, 'Adresse désinscrite ou bloquée'],
  [/high failure rate/i, "Mise en pause après plusieurs échecs"],
  [/no_previous_message/i, 'Aucun message précédent à relancer'],
  [/^type d'/i, 'Étape non prise en charge'],
  [/sautée par le recruteur/i, 'Étape passée à la main'],
  [/arrêt manuel|annulé manuellement|stoppé depuis inbox|arrêt groupé/i, 'Arrêtée à la main'],
  [/enrollment became|enrollment inactive|sequence missing/i, "Inscription arrêtée avant l'envoi"],
];

export function skipReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  for (const [pattern, label] of SKIP_REASON_RULES) {
    if (pattern.test(reason)) return label;
  }
  return 'Étape non exécutée';
}

// ─── Tons ────────────────────────────────────────────────────────────────

/**
 * Tons de rédaction des messages générés pour les séquences et les InMails :
 * les mêmes mots partout, sans emoji ni abréviation (« Pro », « Cool »,
 * « Wow » : revue design D-62). Les réponses de la messagerie ont leurs
 * propres tons, envoyés à une autre fonction.
 */
export const MESSAGE_TONES = [
  { value: 'professional', label: 'Professionnel' },
  { value: 'casual', label: 'Décontracté' },
  { value: 'enthusiastic', label: 'Enthousiaste' },
] as const;

export type MessageTone = (typeof MESSAGE_TONES)[number]['value'];
