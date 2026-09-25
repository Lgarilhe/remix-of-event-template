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
//      étape n'est jamais partie et que rien n'a avancé depuis ;
//   3. sinon on planifie l'étape qui suit la dernière exécution terminée.
//
//   deno test --no-check supabase/functions/_shared/sequence-resume.test.ts

import { ACCOUNT_DISCONNECTED_SKIP_REASON } from './linkedin-quotas.ts';
import { isDeliveredCancelled } from './sequence-engine-rules.ts';

// Raison posée sur l'exécution quand l'organisation n'a ni abonnement ni essai
// (même texte que process-sequences).
export const SUBSCRIPTION_REQUIRED_SKIP_REASON = "Abonnement requis pour l'envoi de séquences";
// Compte d'envoi absent des comptes reliés de l'organisation (SEQ-010).
export const ACCOUNT_NOT_IN_ORG_REASON = "Compte d'envoi non rattaché à l'organisation";

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
      // Une attente d'acceptation ou de réponse ne devient jamais 'scheduled' :
      // le moteur la prendrait pour un événement survenu.
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
        scheduledAt: resumeDate(candidate.scheduled_at, nowMs),
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
