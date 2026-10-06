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
import {
  engineNextStepId,
  rowToSequenceStep,
  type SequenceStepRow,
} from '../components/outreach/sequence/sequenceGraph.ts';

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
  /** Le moteur a encore une étape visible après la dernière faite, sur le graphe (relance d'une inscription terminée). */
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

/** Fin d'une inscription par un rendez-vous (calendly-webhook, condition d'arrêt de process-sequences). */
export const MEETING_BOOKED_REASON = 'meeting_booked';

/** Inscription close par un rendez-vous : jamais relancée depuis l'écran. */
export function isMeetingBookedCompletion(status: string, trackingData: unknown): boolean {
  const tracking = trackingData && typeof trackingData === 'object' && !Array.isArray(trackingData) ? trackingData as Record<string, unknown> : null;
  return status === 'completed' && tracking?.completion_reason === MEETING_BOOKED_REASON;
}

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

/**
 * Étape reportée par le plafond LinkedIn (exécution `quota_blocked`) : une
 * seule forme, la même dans la ligne de statut, le Parcours et le Journal de
 * la page. Une invitation attend le plafond de la semaine, les autres actions
 * celui du jour.
 */
export function quotaBlockedLabel(actionType: string | null | undefined): string {
  return actionType === 'connection_request'
    ? 'Reporté : plafond d’invitations de la semaine atteint'
    : 'Reporté : plafond LinkedIn du jour atteint';
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
      return {
        chip: 'en-cours',
        label: quotaBlockedLabel(pending.step?.action_type),
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
      default:
        // Pause manuelle : ni son auteur ni sa date ne sont enregistrés, et
        // updated_at change à chaque écriture de la ligne. La ligne ne date donc
        // pas la pause (écart à la spécification acté dans le plan, 5c-2).
        return { chip: 'en-pause', label: 'En pause', tone: 'warning', next: null, action: action('resume', 'Reprendre la séquence') };
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
    // Rendez-vous pris (Calendly, ou condition d'arrêt du moteur) : la séquence
    // a atteint son but, rien à relancer.
    if (tracking?.completion_reason === MEETING_BOOKED_REASON) {
      return { chip: 'terminees', label: `Terminée${when} : rendez-vous pris`, tone: 'default', next: null, action: null };
    }
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

/**
 * Reste-t-il une étape visible après la dernière étape faite ? (relance d'une
 * inscription terminée). Même lecture que la reprise du serveur
 * (planResume puis scheduleNextStep) : dernière étape faite la plus avancée,
 * puis le graphe (fin de séquence, étape suivante choisie, étape visée par un
 * renvoi, fourches et étape de repli d'une attente). Une fourche dont l'issue
 * n'est pas connue compte si l'une de ses branches mène à une action visible.
 */
export function hasVisibleStepAfterLastDone(
  executions: readonly (Pick<StatusLineExecution, 'status' | 'step_order'> & { step_id?: string | null })[],
  rows: readonly SequenceStepRow[],
): boolean {
  const DONE = new Set(['sent', 'opened', 'clicked', 'replied', 'skipped']);
  const steps = rows.map(rowToSequenceStep);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = executions
    .filter((e) => DONE.has(e.status))
    .sort((a, b) => (b.step_order ?? -1) - (a.step_order ?? -1))[0];
  if (!done) return steps.some((s) => !isHiddenActionType(s.actionType));
  const from = (done.step_id ? byId.get(done.step_id) : undefined)
    ?? steps.find((s) => s.order === done.step_order);
  if (!from) return false;

  // Issues possibles après une étape (toutes les branches d'une fourche).
  const nextIds = (step: (typeof steps)[number]): string[] => {
    if (step.actionType === 'check_connection' || step.actionType === 'condition_branch') {
      const fallback = engineNextStepId(step, steps);
      return [step.ifTrueGotoStep ?? fallback, step.ifFalseGotoStep ?? fallback].filter((id): id is string => !!id);
    }
    const next = engineNextStepId(step, steps);
    const timeout = step.timeoutBranchStepId ?? null;
    return [next, timeout].filter((id): id is string => !!id);
  };

  const seen = new Set<string>([from.id]);
  const queue = nextIds(from);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const step = byId.get(id);
    if (!step) continue;
    if (!isHiddenActionType(step.actionType)) return true;
    queue.push(...nextIds(step));
  }
  return false;
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
