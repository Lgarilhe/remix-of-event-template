// Statut et prochaine action d'une inscription, onglet « Candidats » de la page
// d'une séquence (refonte des séquences, lot 5c-2). Une seule règle pour tout
// le tableau des statuts de la spécification (spec-cible, section 3.1), plus
// l'arrêt manuel du lot 5b et le message rédigé par l'IA à relire du lot 5a-2.
//
// Module pur, testé sous Node (tests/ux/seq-v2-socle.test.mjs) : aucune
// lecture, aucune écriture. L'écran choisit le geste d'après `action.kind` et
// passe toujours par les actions existantes (src/lib/sequenceActions.ts,
// useUndoableEnrollmentAction, actions serveur de process-sequences).

import {
  actionTypeLabel,
  formatSequenceError,
  isAiReviewPending,
  isGdprErasedEnrollment,
  isHiddenActionType,
} from './sequenceErrorMessages.ts';
import { readManualStopFromTracking, manualStopLabel } from './sequenceLabels.ts';

/** Couleur du statut : la couleur ne sert qu'à ce qui demande d'agir (06-simplicite, règle 7). */
export type StatusLineTone = 'default' | 'muted' | 'brand' | 'warning' | 'danger';

/** Geste proposé en face du statut ; l'écran le relie à l'action existante. */
export type StatusActionKind =
  | 'pause'
  | 'resume'
  | 'retry'
  | 'reconnect'
  | 'pricing'
  | 'reactivate'
  | 'show_error'
  | 'stop'
  | 'conversation'
  | 'relaunch'
  | 'review';

export interface StatusAction {
  kind: StatusActionKind;
  label: string;
}

/** Puce de l'onglet « Candidats » à laquelle appartient l'inscription. */
export type EnrollmentChip = 'tous' | 'en-cours' | 'a-repondu' | 'en-pause' | 'en-echec' | 'terminees';

export interface EnrollmentStatusLine {
  chip: Exclude<EnrollmentChip, 'tous'>;
  label: string;
  tone: StatusLineTone;
  /** Prochaine action prévue, en clair (« Aujourd'hui à 14 h 20 »), ou null. */
  next: string | null;
  /** Une seule action principale, ou null (spec : « aucune »). */
  action: StatusAction | null;
}

export interface StatusLineExecution {
  status: string;
  scheduled_at: string;
  executed_at?: string | null;
  error_message?: string | null;
  skip_reason?: string | null;
  final_message?: string | null;
  step_order?: number | null;
  step?: {
    action_type?: string | null;
    timeout_days?: number | null;
    wait_for_event?: string | null;
  } | null;
}

export interface StatusLineEnrollment {
  status: string;
  pause_reason?: string | null;
  tracking_data?: unknown;
  replied_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  executions?: readonly StatusLineExecution[] | null;
}

export interface StatusLineContext {
  now?: Date;
  /** Nom d'un membre (auteur d'un arrêt) ; « vous » pour la personne connectée. */
  memberName?: (userId: string | null) => string | null;
  /** État de la séquence : une pause de séquence ne se lève qu'en la réactivant. */
  sequenceActive?: boolean | null;
  /** Propriétaire ou administrateur : « Réactiver la séquence » lui est proposé. */
  canManageSequence?: boolean;
  /** Titulaire du compte qui envoie : « Reconnecter le compte » lui est proposé. */
  isAccountHolder?: boolean;
  /** Le moteur a encore une étape visible après la dernière faite (relance d'une inscription terminée). */
  hasNextStep?: boolean;
}

// ─── Dates ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** « 02/10 » dans le fuseau du navigateur. */
export function dayMonth(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** « 14 h 20 », « 9 h », espaces insécables (l'heure ne se coupe pas en fin de ligne). */
export function clockTime(d: Date): string {
  const m = d.getMinutes();
  return m === 0 ? `${d.getHours()}\u00a0h` : `${d.getHours()}\u00a0h\u00a0${pad(m)}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « aujourd'hui à 14 h 20 », « demain à 9 h », « le 02/10 à 9 h 10 ». */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `aujourd’hui à ${clockTime(d)}`;
  if (days === 1) return `demain à ${clockTime(d)}`;
  return `le ${dayMonth(d)} à ${clockTime(d)}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const validDate = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));

// ─── Lecture des exécutions ────────────────────────────────────────────────

const PENDING = new Set(['scheduled', 'waiting_event', 'quota_blocked', 'sending']);
const FAILURE_PAUSES = new Set(['send_failed', 'auto_paused']);

/** Motif posé par le moteur quand le candidat a répondu sur un autre compte (sequence-engine-rules.ts). */
const SIBLING_REPLY_PREFIX = 'Le candidat a répondu';

function byDate(a: StatusLineExecution, b: StatusLineExecution) {
  return Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at);
}

/** Prochaine exécution en attente (la plus proche), étapes internes comprises. */
function nextPending(executions: readonly StatusLineExecution[]): StatusLineExecution | null {
  return [...executions].filter((e) => PENDING.has(e.status)).sort(byDate)[0] ?? null;
}

/** Échec le plus récent, pour « En échec : <raison> ». */
function lastFailure(executions: readonly StatusLineExecution[]): StatusLineExecution | null {
  return [...executions].filter((e) => e.status === 'failed').sort(byDate).pop() ?? null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Fin d'une attente : date de début plus le délai de l'étape. */
function waitDeadline(exec: StatusLineExecution): string | null {
  const days = exec.step?.timeout_days;
  if (!days || days <= 0 || !validDate(exec.scheduled_at)) return null;
  return new Date(Date.parse(exec.scheduled_at) + days * 86_400_000).toISOString();
}

function waitLabel(exec: StatusLineExecution): string {
  const event = exec.step?.wait_for_event
    ?? (exec.step?.action_type === 'wait_reply' ? 'reply_received' : exec.step?.action_type === 'wait_profile_visit' ? 'profile_visited' : 'connection_accepted');
  const what = event === 'reply_received'
    ? 'En attente d’une réponse'
    : event === 'profile_visited'
      ? 'En attente d’une visite de profil'
      : 'En attente de l’acceptation';
  const deadline = waitDeadline(exec);
  return deadline ? `${what}, jusqu’au ${dayMonth(deadline)}` : what;
}

/** Libellé de la prochaine action visible (« Message LinkedIn aujourd'hui à 14 h 20 »). */
function nextActionText(exec: StatusLineExecution, now: Date): string {
  const when = capitalize(whenLabel(exec.scheduled_at, now));
  const type = exec.step?.action_type;
  if (!type || isHiddenActionType(type)) return when;
  return `${actionTypeLabel(type)} ${whenLabel(exec.scheduled_at, now)}`;
}

// ─── Règle ─────────────────────────────────────────────────────────────────

const action = (kind: StatusActionKind, label: string): StatusAction => ({ kind, label });

/**
 * Statut affiché, couleur, prochaine action et geste principal d'une
 * inscription. Couvre chaque ligne du tableau 3.1 de la spécification, l'arrêt
 * manuel (« Arrêtée par Guillaume Martin le 29/09 ») et l'étape rédigée par
 * l'IA reportée par le moteur faute de relecture (« Relire le message »).
 */
export function enrollmentStatusLine(enrollment: StatusLineEnrollment, ctx: StatusLineContext = {}): EnrollmentStatusLine {
  const now = ctx.now ?? new Date();
  const executions = enrollment.executions ?? [];
  const tracking = asRecord(enrollment.tracking_data);
  const status = enrollment.status;
  const chipOf = (): EnrollmentStatusLine['chip'] => {
    if (status === 'active') return 'en-cours';
    if (status === 'replied') return 'a-repondu';
    if (status === 'paused') return FAILURE_PAUSES.has(enrollment.pause_reason ?? '') ? 'en-echec' : 'en-pause';
    return 'terminees';
  };

  // Effacement RGPD : définitif, jamais repris.
  if (isGdprErasedEnrollment(tracking?.gdpr_erased_at, executions)) {
    return { chip: chipOf(), label: 'Données effacées à la demande du candidat', tone: 'muted', next: null, action: null };
  }

  if (status === 'active') {
    const pending = nextPending(executions);
    // Lot 5a-2 : étape rédigée par l'IA, reportée tant qu'elle n'est pas relue.
    const review = executions.find((e) => isAiReviewPending({ status: e.status, error_message: e.error_message, final_message: e.final_message }));
    if (review) {
      return {
        chip: 'en-cours',
        label: 'Message rédigé par l’IA à relire',
        tone: 'warning',
        next: 'Partira après votre relecture',
        action: action('review', 'Relire le message'),
      };
    }
    if (pending?.status === 'quota_blocked') {
      const isInvite = pending.step?.action_type === 'connection_request';
      return {
        chip: 'en-cours',
        label: isInvite ? 'Reporté : plafond d’invitations de la semaine atteint' : 'Reporté : plafond LinkedIn du jour atteint',
        tone: 'warning',
        next: 'Au prochain créneau libre',
        action: null,
      };
    }
    if (pending?.status === 'waiting_event') {
      return { chip: 'en-cours', label: waitLabel(pending), tone: 'default', next: null, action: action('pause', 'Mettre en pause') };
    }
    if (pending?.status === 'sending') {
      return { chip: 'en-cours', label: 'En cours', tone: 'default', next: 'Envoi en cours', action: null };
    }
    return {
      chip: 'en-cours',
      label: 'En cours',
      tone: 'default',
      next: pending ? nextActionText(pending, now) : null,
      action: action('pause', 'Mettre en pause'),
    };
  }

  if (status === 'paused') {
    const reason = enrollment.pause_reason ?? 'manual';
    switch (reason) {
      case 'account_disconnected':
        return {
          chip: 'en-pause',
          label: 'En pause : compte LinkedIn déconnecté',
          tone: 'warning',
          next: null,
          action: ctx.isAccountHolder ? action('reconnect', 'Reconnecter le compte') : null,
        };
      case 'subscription_required':
        return { chip: 'en-pause', label: 'En pause : abonnement requis', tone: 'warning', next: null, action: action('pricing', 'Voir les offres') };
      case 'sequence_inactive':
        // Séquence de nouveau active : la pause se lève candidat par candidat.
        if (ctx.sequenceActive === true) {
          return { chip: 'en-pause', label: 'En pause avec la séquence', tone: 'warning', next: null, action: action('resume', 'Reprendre la séquence') };
        }
        return {
          chip: 'en-pause',
          label: 'En pause avec la séquence',
          tone: 'muted',
          next: null,
          action: ctx.canManageSequence ? action('reactivate', 'Réactiver la séquence') : null,
        };
      case 'auto_paused':
        return { chip: 'en-echec', label: 'En pause : trop d’échecs d’envoi', tone: 'danger', next: null, action: action('show_error', 'Voir l’erreur') };
      case 'send_failed': {
        const failure = lastFailure(executions);
        const detail = failure?.error_message
          ? formatSequenceError(failure.error_message)
          : (typeof tracking?.pause_reason === 'string' && tracking.pause_reason.trim()) || 'échec d’envoi';
        return {
          chip: 'en-echec',
          label: `En échec : ${detail.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}`,
          tone: 'danger',
          next: null,
          action: action('retry', 'Réessayer l’étape en échec'),
        };
      }
      case 'quota_reached':
        return { chip: 'en-pause', label: 'En pause : limite d’envoi atteinte', tone: 'warning', next: null, action: null };
      case 'blocked_by_candidate':
        return { chip: 'en-pause', label: 'En pause : candidat injoignable', tone: 'warning', next: null, action: action('stop', 'Arrêter pour ce candidat') };
      default: {
        const since = validDate(enrollment.updated_at) ? ` depuis le ${dayMonth(enrollment.updated_at)}` : '';
        return { chip: 'en-pause', label: `En pause${since}`, tone: 'warning', next: null, action: action('resume', 'Reprendre la séquence') };
      }
    }
  }

  if (status === 'replied') {
    const when = validDate(enrollment.replied_at) ? ` le ${dayMonth(enrollment.replied_at)}` : '';
    return { chip: 'a-repondu', label: `A répondu${when}`, tone: 'brand', next: null, action: action('conversation', 'Voir la conversation') };
  }

  if (status === 'completed') {
    // Lot 5b : « Arrêter pour ce candidat » clôt en completed avec la trace manual_stop.
    const manualStop = readManualStopFromTracking(status, enrollment.tracking_data);
    if (manualStop) {
      return { chip: 'terminees', label: manualStopLabel(manualStop, ctx.memberName?.(manualStop.by) ?? null), tone: 'muted', next: null, action: null };
    }
    const when = validDate(enrollment.completed_at) ? ` le ${dayMonth(enrollment.completed_at)}` : '';
    return {
      chip: 'terminees',
      label: `Terminée${when}, sans réponse`,
      tone: 'default',
      next: null,
      action: ctx.hasNextStep ? action('relaunch', 'Relancer depuis l’étape suivante') : null,
    };
  }

  if (status === 'stopped') {
    const siblingReply = executions.some((e) => !!e.skip_reason?.startsWith(SIBLING_REPLY_PREFIX));
    if (siblingReply) {
      return { chip: 'terminees', label: 'Arrêtée : a répondu dans une autre séquence', tone: 'default', next: null, action: action('conversation', 'Voir la conversation') };
    }
    return { chip: 'terminees', label: 'Arrêtée automatiquement', tone: 'muted', next: null, action: null };
  }

  if (status === 'cancelled') return { chip: 'terminees', label: 'Annulée', tone: 'muted', next: null, action: null };
  if (status === 'bounced') return { chip: 'terminees', label: 'Non distribuée', tone: 'muted', next: null, action: null };
  return { chip: chipOf(), label: 'Statut inconnu', tone: 'muted', next: null, action: null };
}

/** Reste-t-il une étape visible après la dernière étape faite ? (relance d'une inscription terminée) */
export function hasVisibleStepAfterLastDone(
  executions: readonly Pick<StatusLineExecution, 'status' | 'step_order'>[],
  steps: readonly { step_order: number; action_type: string }[],
): boolean {
  const DONE = new Set(['sent', 'opened', 'clicked', 'replied', 'skipped']);
  const lastDone = Math.max(-1, ...executions.filter((e) => DONE.has(e.status)).map((e) => e.step_order ?? -1));
  return steps.some((s) => s.step_order > lastDone && !isHiddenActionType(s.action_type));
}

// ─── Puces de l'onglet « Candidats » ───────────────────────────────────────

export const ENROLLMENT_CHIPS: ReadonlyArray<{ key: EnrollmentChip; label: string }> = [
  { key: 'tous', label: 'Tous' },
  { key: 'en-cours', label: 'En cours' },
  { key: 'a-repondu', label: 'A répondu' },
  { key: 'en-pause', label: 'En pause' },
  { key: 'en-echec', label: 'En échec' },
  { key: 'terminees', label: 'Terminées' },
];

export function parseEnrollmentChip(raw: string | null | undefined): EnrollmentChip {
  return ENROLLMENT_CHIPS.some((c) => c.key === raw) ? raw as EnrollmentChip : 'tous';
}

/** Compteurs de la séquence entière (get_sequence_enrollment_counts agrégé). */
export interface ChipCountsInput {
  total: number;
  active: number;
  replied: number;
  paused: number;
  pausedByReason: Record<string, number>;
}

export function enrollmentChipCounts(stats: ChipCountsInput): Record<EnrollmentChip, number> {
  const failed = [...FAILURE_PAUSES].reduce((sum, reason) => sum + (stats.pausedByReason[reason] ?? 0), 0);
  return {
    tous: stats.total,
    'en-cours': stats.active,
    'a-repondu': stats.replied,
    'en-pause': Math.max(0, stats.paused - failed),
    'en-echec': failed,
    terminees: Math.max(0, stats.total - stats.active - stats.replied - stats.paused),
  };
}

/** Filtre de lecture d'une puce : statuts et raisons de pause, appliqué par la requête (pagination juste). */
export interface ChipFilter {
  statuses: string[] | null;
  pauseReasonsIn?: string[];
  /** Pause sans raison ou d'une raison hors de cette liste. */
  pauseReasonsNotIn?: string[];
}

export function chipFilter(chip: EnrollmentChip): ChipFilter {
  switch (chip) {
    case 'en-cours': return { statuses: ['active'] };
    case 'a-repondu': return { statuses: ['replied'] };
    case 'en-pause': return { statuses: ['paused'], pauseReasonsNotIn: [...FAILURE_PAUSES] };
    case 'en-echec': return { statuses: ['paused'], pauseReasonsIn: [...FAILURE_PAUSES] };
    case 'terminees': return { statuses: ['completed', 'stopped', 'cancelled', 'bounced'] };
    default: return { statuses: null };
  }
}

/** État vide d'une puce (« Aucun candidat en échec. »). */
export function emptyChipText(chip: EnrollmentChip): string {
  switch (chip) {
    case 'en-cours': return 'Aucun candidat en cours.';
    case 'a-repondu': return 'Aucun candidat n’a encore répondu.';
    case 'en-pause': return 'Aucun candidat en pause.';
    case 'en-echec': return 'Aucun candidat en échec.';
    case 'terminees': return 'Aucune inscription terminée.';
    default: return 'Aucun candidat inscrit.';
  }
}
