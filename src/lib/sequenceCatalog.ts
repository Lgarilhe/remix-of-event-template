/**
 * Catalogue des séquences : canal, nature et ton de badge des étapes et des
 * statuts, pour la messagerie, l'éditeur, la préparation, le suivi et le
 * journal (revue design D-01, D-49, D-55, D-58).
 *
 * Les libellés sont ceux de l'audit des séquences (`sequenceLabels.ts`,
 * `sequenceErrorMessages.ts`) : une étape ou un statut porte le même mot
 * partout. Une raison de pause se lit avec `pausedLabel`, une raison de saut
 * avec `formatSkipReason`.
 *
 * Un identifiant technique (« connection_request », « replied ») ne s'affiche
 * jamais : une valeur inconnue prend un libellé générique.
 *
 * Module pur, sans React : les icônes et les badges sont dans
 * `src/components/outreach/SequenceBadges.tsx`.
 */

import type { Channel } from './channels';
import { ENROLLMENT_STATUS_LABELS } from './sequenceLabels';
import { ACTION_TYPE_LABELS, EXECUTION_STATUS_LABELS } from './sequenceErrorMessages';

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
  connection_request: { label: ACTION_TYPE_LABELS.connection_request, channel: 'linkedin', kind: 'action' },
  message: { label: ACTION_TYPE_LABELS.message, channel: 'linkedin', kind: 'action' },
  smart_message: { label: ACTION_TYPE_LABELS.smart_message, channel: 'linkedin', kind: 'action' },
  inmail: { label: ACTION_TYPE_LABELS.inmail, channel: 'linkedin', kind: 'action' },
  profile_visit: { label: ACTION_TYPE_LABELS.profile_visit, channel: 'linkedin', kind: 'action' },
  email: { label: ACTION_TYPE_LABELS.email, channel: 'email', kind: 'action' },
  whatsapp_message: { label: ACTION_TYPE_LABELS.whatsapp_message, channel: 'whatsapp', kind: 'action' },
  check_connection: { label: ACTION_TYPE_LABELS.check_connection, channel: 'linkedin', kind: 'condition' },
  condition_branch: { label: ACTION_TYPE_LABELS.condition_branch, channel: null, kind: 'condition' },
  wait_connection: { label: ACTION_TYPE_LABELS.wait_connection, channel: 'linkedin', kind: 'wait' },
  wait_until_connected: { label: ACTION_TYPE_LABELS.wait_connection, channel: 'linkedin', kind: 'wait' },
  wait_reply: { label: ACTION_TYPE_LABELS.wait_reply, channel: null, kind: 'wait' },
  wait_profile_visit: { label: ACTION_TYPE_LABELS.wait_profile_visit, channel: 'linkedin', kind: 'wait' },
  wait_for_event: { label: ACTION_TYPE_LABELS.wait_for_event, channel: null, kind: 'wait' },
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

/** Ordre stable des canaux : les mêmes icônes aux mêmes places d'une séquence à l'autre. */
const CHANNEL_ORDER: Channel[] = ['linkedin', 'email', 'whatsapp', 'call'];

/** Canaux employés par les étapes d'une séquence (liste des séquences, messagerie). */
export function sequenceChannels(steps: readonly unknown[]): Channel[] {
  const used = new Set<Channel>();
  for (const step of steps) {
    const channel = sequenceActionMeta((step as { action_type?: string | null } | null)?.action_type)?.channel;
    if (channel) used.add(channel);
  }
  return CHANNEL_ORDER.filter((channel) => used.has(channel));
}

/**
 * Délai avant une étape, en entier : « 2 j 4 h 30 min » (revue design D-40).
 * Chaîne vide quand il n'y a aucun délai.
 */
export function formatStepDelay(days?: number | null, hours?: number | null, minutes?: number | null): string {
  return [
    days && days > 0 ? `${days} j` : '',
    hours && hours > 0 ? `${hours} h` : '',
    minutes && minutes > 0 ? `${minutes} min` : '',
  ].filter(Boolean).join(' ');
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
  active: { label: ENROLLMENT_STATUS_LABELS.active, tone: 'info' },
  paused: { label: ENROLLMENT_STATUS_LABELS.paused, tone: 'warning' },
  replied: { label: ENROLLMENT_STATUS_LABELS.replied, tone: 'success' },
  completed: { label: ENROLLMENT_STATUS_LABELS.completed, tone: 'muted' },
  stopped: { label: ENROLLMENT_STATUS_LABELS.stopped, tone: 'muted' },
  cancelled: { label: ENROLLMENT_STATUS_LABELS.cancelled, tone: 'muted' },
  bounced: { label: ENROLLMENT_STATUS_LABELS.bounced, tone: 'danger' },
};

/** Statut d'une étape exécutée ou prévue (`sequence_step_executions.status`). */
export const EXECUTION_STATUSES: Record<string, StatusMeta> = {
  scheduled: { label: EXECUTION_STATUS_LABELS.scheduled, tone: 'info' },
  sending: { label: EXECUTION_STATUS_LABELS.sending, tone: 'info' },
  waiting_event: { label: EXECUTION_STATUS_LABELS.waiting_event, tone: 'muted' },
  quota_blocked: { label: EXECUTION_STATUS_LABELS.quota_blocked, tone: 'warning' },
  sent: { label: EXECUTION_STATUS_LABELS.sent, tone: 'success' },
  opened: { label: EXECUTION_STATUS_LABELS.opened, tone: 'success' },
  clicked: { label: EXECUTION_STATUS_LABELS.clicked, tone: 'success' },
  replied: { label: EXECUTION_STATUS_LABELS.replied, tone: 'success' },
  skipped: { label: EXECUTION_STATUS_LABELS.skipped, tone: 'muted' },
  cancelled: { label: EXECUTION_STATUS_LABELS.cancelled, tone: 'muted' },
  failed: { label: EXECUTION_STATUS_LABELS.failed, tone: 'danger' },
  bounced: { label: EXECUTION_STATUS_LABELS.bounced, tone: 'danger' },
};

const UNKNOWN_STATUS: StatusMeta = { label: 'Statut inconnu', tone: 'muted' };

export function enrollmentStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && ENROLLMENT_STATUSES[status]) || UNKNOWN_STATUS;
}

export function executionStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && EXECUTION_STATUSES[status]) || UNKNOWN_STATUS;
}

// ─── Tons ────────────────────────────────────────────────────────────────

// Lot 5e-2 : plus de liste de tons pour les messages rédigés par l'IA. Le style
// (longueur, ton, spontanéité, accroche, appel à l'action, toujours au
// vouvoiement) se règle dans « Votre style » et à chaque rédaction :
// src/lib/writingStyle.ts.
