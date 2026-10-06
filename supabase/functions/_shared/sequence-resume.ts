// Décision de reprise d'une inscription (actions resume_enrollments et
// re_enroll de process-sequences), sans accès base.
//
// Audit séquences 2026-09-25, SEQ-004. Avant, le navigateur réarmait « la
// première exécution annulée » choisie à l'aveugle : un message déjà reçu
// repartait, une relance prévue jeudi partait tout de suite, ou rien ne
// repartait. La règle est désormais unique et côté serveur :
//
//   1. une exécution encore en attente est gardée (sa date prévue aussi) ;
//   2. sinon on réarme la plus récente exécution annulée PAR UNE PAUSE, si son
//      étape n'est jamais partie et que rien n'a avancé depuis (une attente
//      garde sa date d'origine, son délai ne repart pas de zéro) ;
//   3. sinon on planifie l'étape qui suit la dernière exécution terminée.
//
//   deno test --no-check supabase/functions/_shared/sequence-resume.test.ts

import { ACCOUNT_DISCONNECTED_SKIP_REASON } from './linkedin-quotas.ts';
import { isDeliveredCancelled } from './sequence-engine-rules.ts';
import { GDPR_ERASED_AT_KEY, GDPR_ERASURE_SKIP_REASON } from './get-or-fetch-contact.ts';
import { implicitWaitEvent } from './sequence-wait-rules.ts';

// Raison posée sur l'exécution quand l'organisation n'a ni abonnement ni essai
// (même texte que process-sequences).
export const SUBSCRIPTION_REQUIRED_SKIP_REASON = "Abonnement requis pour l'envoi de séquences";
// Compte d'envoi absent des comptes reliés de l'organisation (SEQ-010).
export const ACCOUNT_NOT_IN_ORG_REASON = "Compte d'envoi non rattaché à l'organisation";
// Boîte e-mail d'envoi trouvée inutilisable avant l'envoi : rien n'est parti,
// l'inscription est en pause 'send_failed' et la reprise réarme l'étape.
export const MAILBOX_DISCONNECTED_SKIP_REASON = "Boîte e-mail d'envoi déconnectée : étape non envoyée";

// ─── Décision D5 (contrat §7) : effacement RGPD définitif ───────────────────

export const GDPR_ERASED_RESUME_MESSAGE = "Ce candidat a demandé l'effacement de ses données : il ne peut plus être relancé.";

/**
 * Inscription touchée par un effacement RGPD : marqueur durable
 * tracking_data.gdpr_erased_at (posé sur toutes les inscriptions trouvées,
 * terminées comprises), ou une exécution annulée par l'effacement. Ni reprise
 * ni relance, quel que soit le statut.
 */
export function isGdprErasedEnrollment(
  trackingData: unknown,
  executions: Array<{ skip_reason?: string | null }>,
): boolean {
  const tracking = trackingData && typeof trackingData === 'object' && !Array.isArray(trackingData)
    ? trackingData as Record<string, unknown>
    : null;
  const marker = tracking?.[GDPR_ERASED_AT_KEY];
  if (marker !== undefined && marker !== null && marker !== false && marker !== '') return true;
  return executions.some((e) => e.skip_reason === GDPR_ERASURE_SKIP_REASON);
}

// ─── Décision D3 (contrat §7) : rôle collaborateur ──────────────────────────

/**
 * Même règle que la RLS posée par B6 : un collaborateur n'agit que sur les
 * inscriptions qu'il a créées. Appel en clé de service (pas d'utilisateur) ou
 * autre rôle : pas de restriction supplémentaire.
 */
export function canActOnEnrollment(
  caller: { userId: string | null; role: string | null | undefined },
  enrollmentCreatedBy: string | null | undefined,
): boolean {
  if (!caller.userId || caller.role !== 'collaborator') return true;
  return !!enrollmentCreatedBy && enrollmentCreatedBy === caller.userId;
}

/**
 * tracking_data d'une inscription réactivée : le texte de la pause précédente
 * (tracking_data.pause_reason) est retiré, pour qu'une pause ultérieure sans
 * texte n'affiche pas un motif périmé (SEQ-082). null si rien ne change.
 */
export function trackingWithoutPauseReason(trackingData: unknown): Record<string, unknown> | null {
  if (!trackingData || typeof trackingData !== 'object' || Array.isArray(trackingData)) return null;
  if (!('pause_reason' in (trackingData as Record<string, unknown>))) return null;
  const copy = { ...(trackingData as Record<string, unknown>) };
  delete copy.pause_reason;
  return copy;
}

// Motifs d'annulation posés par une MISE EN PAUSE (front historique, moteur,
// dissociation de compte) : l'étape n'est jamais partie, elle est réarmable.
export const RESUMABLE_SKIP_REASONS: readonly string[] = [
  'Arrêt manuel',
  'Arrêt groupé',
  'Stoppé depuis Inbox',
  'Séquence désactivée',
  'Inscription en pause',
  'Compte LinkedIn dissocié',
  'Auto-paused: high failure rate',
  ACCOUNT_DISCONNECTED_SKIP_REASON,
  SUBSCRIPTION_REQUIRED_SKIP_REASON,
  ACCOUNT_NOT_IN_ORG_REASON,
  MAILBOX_DISCONNECTED_SKIP_REASON,
];
// Ancien moteur : exécution échue pendant une pause, passée 'skipped' sans
// être partie (SEQ-023). Réarmable elle aussi.
export const LEGACY_PAUSED_SKIP_REASON = 'Enrollment inactive';

// Échecs d'une action visible dont l'issue est inconnue : le message a pu
// partir. Jamais rejoués, la reprise repart APRÈS eux.
const UNCERTAIN_FAILURE_PREFIXES = ["Interrompu pendant l'envoi", 'Envoi incertain'];

export const RE_ENROLLABLE_STATUSES: readonly string[] = ['replied', 'completed', 'stopped', 'cancelled'];
const DONE_STATUSES = new Set(['sent', 'opened', 'clicked', 'replied', 'skipped']);
const KEEP_DATE_PENDING = new Set(['scheduled', 'quota_blocked']);
const KEEP_AS_IS_PENDING = new Set(['waiting_event', 'sending']);

export type ResumeMode = 'resume' | 're_enroll';
export type ResumeOutcome = 'resumed' | 'nothing_to_resume' | 'account_unlinked' | 'not_paused' | 'error';

export interface ResumeExecutionRow {
  id: string;
  step_id: string | null;
  step_order: number | null;
  status: string;
  skip_reason?: string | null;
  error_message?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
  /** Étape jointe : une attente réarmée garde sa date d'origine (waitsForEvent). */
  step?: { action_type?: string | null; wait_for_event?: string | null; condition_type?: string | null } | null;
}

export type ResumePlan =
  | { kind: 'not_eligible'; outcome: 'not_paused' | 'error'; message: string }
  /** Exécution encore en attente : on la garde. newScheduledAt null = date inchangée. */
  | { kind: 'keep_pending'; executionId: string; newScheduledAt: string | null }
  /** Exécution annulée par une pause, réarmée à max(date prévue, maintenant + 1 min). */
  | { kind: 'rearm'; executionId: string; fromStatus: string; scheduledAt: string }
  /** Rien à réarmer : planifier l'étape suivante. fromStepId null = depuis current_step_order - 1. */
  | { kind: 'schedule_next'; fromStepOrder: number; fromStepId: string | null };

export function isUncertainFailure(row: { status: string; error_message?: string | null }): boolean {
  return row.status === 'failed' && !!row.error_message
    && UNCERTAIN_FAILURE_PREFIXES.some((p) => (row.error_message as string).startsWith(p));
}

/** Exécution traitée : partie, sautée, ou partie peut-être (jamais à rejouer). */
function isDone(row: ResumeExecutionRow): boolean {
  return DONE_STATUSES.has(row.status) || isUncertainFailure(row) || isDeliveredCancelled(row.status, row.skip_reason);
}

function isResumableCancellation(row: ResumeExecutionRow): boolean {
  if (row.status === 'cancelled') return !!row.skip_reason && RESUMABLE_SKIP_REASONS.includes(row.skip_reason);
  return row.status === 'skipped' && row.skip_reason === LEGACY_PAUSED_SKIP_REASON;
}

const ts = (value: string | null | undefined): number => {
  const n = value ? new Date(value).getTime() : 0;
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Étape qui attend un événement (acceptation, réponse, ouverture...) : le
 * moteur la met en 'waiting_event' quand elle est due, et son délai
 * d'attente se compte depuis scheduled_at (waitStartedAt).
 */
export function waitsForEvent(step: ResumeExecutionRow['step']): boolean {
  if (!step) return false;
  return !!implicitWaitEvent(step) || step.condition_type === 'wait_until_connected';
}

/** max(date prévue, maintenant + 1 min), en ISO. */
export function resumeDate(originalIso: string | null | undefined, nowMs: number): string {
  return new Date(Math.max(ts(originalIso), nowMs + 60_000)).toISOString();
}

export function planResume(
  mode: ResumeMode,
  enrollmentStatus: string,
  currentStepOrder: number | null | undefined,
  executions: ResumeExecutionRow[],
  nowMs: number,
): ResumePlan {
  if (mode === 'resume' && enrollmentStatus !== 'paused') {
    return { kind: 'not_eligible', outcome: 'not_paused', message: "Ce candidat n'est pas en pause." };
  }
  if (mode === 're_enroll' && !RE_ENROLLABLE_STATUSES.includes(enrollmentStatus)) {
    const message = enrollmentStatus === 'paused'
      ? 'Ce candidat est en pause : utilisez « Reprendre ».'
      : enrollmentStatus === 'active'
        ? 'Ce candidat est déjà actif dans la séquence.'
        : 'Ce candidat ne peut pas être relancé.';
    return { kind: 'not_eligible', outcome: 'error', message };
  }

  const byRecent = [...executions].sort((a, b) => ts(b.created_at) - ts(a.created_at));

  // 1. Exécution encore en attente : gardée.
  const pending = byRecent.find((e) => KEEP_DATE_PENDING.has(e.status) || KEEP_AS_IS_PENDING.has(e.status));
  if (pending) {
    if (KEEP_AS_IS_PENDING.has(pending.status)) {
      // Une attente d'acceptation ou de réponse en cours reste telle quelle :
      // ni date ni statut touchés, son délai garde son point de départ.
      return { kind: 'keep_pending', executionId: pending.id, newScheduledAt: null };
    }
    const target = resumeDate(pending.scheduled_at, nowMs);
    return {
      kind: 'keep_pending',
      executionId: pending.id,
      newScheduledAt: ts(pending.scheduled_at) >= ts(target) ? null : target,
    };
  }

  // 2. Exécution annulée par une pause, dont l'étape n'est jamais partie.
  const candidate = byRecent.find((e) => isResumableCancellation(e)
    && !executions.some((o) => o.id !== e.id && o.step_id === e.step_id && isDone(o)));
  if (candidate) {
    const movedOnSince = executions.some((o) => o.id !== candidate.id && isDone(o) && ts(o.created_at) > ts(candidate.created_at));
    if (!movedOnSince) {
      return {
        kind: 'rearm',
        executionId: candidate.id,
        fromStatus: candidate.status,
        // Une attente annulée (arrêt manuel, ancienne pause) garde sa date
        // d'origine : due, le moteur réévalue aussitôt son événement et la
        // remet en 'waiting_event' sans toucher scheduled_at, son délai garde
        // son point de départ. Repoussée d'une minute, il repartait de zéro.
        scheduledAt: waitsForEvent(candidate.step) && ts(candidate.scheduled_at) > 0
          ? candidate.scheduled_at as string
          : resumeDate(candidate.scheduled_at, nowMs),
      };
    }
  }

  // 3. Étape suivante après la dernière exécution terminée (même lecture que
  // le rattrapage du moteur : la plus avancée par ordre d'étape).
  const lastDone = [...executions]
    .filter(isDone)
    .sort((a, b) => (b.step_order ?? 0) - (a.step_order ?? 0) || ts(b.created_at) - ts(a.created_at))[0];
  if (lastDone) {
    return { kind: 'schedule_next', fromStepOrder: lastDone.step_order ?? 0, fromStepId: lastDone.step_id ?? null };
  }
  return { kind: 'schedule_next', fromStepOrder: (currentStepOrder ?? 0) - 1, fromStepId: null };
}

/** Compteurs de la réponse, tous présents même à zéro. */
export function countOutcomes(results: Array<{ outcome: ResumeOutcome }>): Record<ResumeOutcome, number> {
  const counts: Record<ResumeOutcome, number> = {
    resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0,
  };
  for (const r of results) counts[r.outcome]++;
  return counts;
}
