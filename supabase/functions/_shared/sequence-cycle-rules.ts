// Règles pures du cycle d'envoi de process-sequences (handleProcess, janitors,
// scheduleNextStep), sans accès base ni réseau.
//
// Audit séquences 2026-09-25, lot E1b. Complète sequence-engine-rules.ts (lot
// E1a) : budget de temps du cycle, cadence par compte d'envoi, auto-pause par
// séquence, reports après un refus de quota, reprise des inscriptions
// dormantes, lecture tolérante des nouveaux retours à trois états.
//
//   deno test --no-check supabase/functions/_shared/sequence-cycle-rules.test.ts

import { localDayEnd, safeTimeZone } from './sequence-engine-rules.ts';

// ─── SEQ-074 : budget de temps du cycle ─────────────────────────────────────

/** Durée après le début du cycle au-delà de laquelle plus rien ne démarre. */
export const CYCLE_BUDGET_MS = 40_000;
/** Temps restant minimal avant de verrouiller un envoi visible. */
export const MIN_REMAINING_BEFORE_VISIBLE_LOCK_MS = 20_000;
/** Temps restant minimal avant de lancer une génération IA (ou sa correction). */
export const MIN_REMAINING_BEFORE_AI_MS = 30_000;
/** Temps restant minimal avant une étape invisible (une lecture de profil, 15 s au plus). */
export const MIN_REMAINING_BEFORE_INVISIBLE_MS = 10_000;

export function remainingMs(deadlineMs: number, nowMs: number): number {
  return deadlineMs - nowMs;
}

/**
 * Peut-on verrouiller cette exécution maintenant ? Le test a lieu AVANT le
 * verrou 'sending' : une exécution qui n'a pas le temps de partir reste
 * 'scheduled' (jamais coupée en plein envoi). Une étape invisible demande
 * moins de marge qu'un envoi visible ; une génération IA en demande davantage.
 */
export function hasTimeToLock(deadlineMs: number, nowMs: number, opts: { visible: boolean; needsAi: boolean }): boolean {
  const left = remainingMs(deadlineMs, nowMs);
  if (opts.needsAi && left < MIN_REMAINING_BEFORE_AI_MS) return false;
  if (opts.visible && left < MIN_REMAINING_BEFORE_VISIBLE_LOCK_MS) return false;
  return left >= MIN_REMAINING_BEFORE_INVISIBLE_MS;
}

// ─── SEQ-187 : cadence par compte d'envoi ───────────────────────────────────

export const MAX_VISIBLE_PER_ACCOUNT_PER_CYCLE = 3;
export const MAX_INVISIBLE_PER_CYCLE = 15;

// Étapes sans envoi visible par le candidat.
export const INVISIBLE_STEP_ACTIONS: readonly string[] = [
  'profile_visit', 'check_connection', 'wait_connection',
  'wait_reply', 'wait_profile_visit', 'condition_branch',
];

export interface BatchStep { action_type?: string | null; step_channel?: string | null; sender_id?: string | null }
export interface BatchEnrollment { assigned_sender_id?: string | null; account_id?: string | null; sequence_id?: string | null }

/** Canal réel d'une étape (step_channel l'emporte sur le type d'action). */
export function stepSendChannel(step: BatchStep | null | undefined): 'email' | 'whatsapp' | 'linkedin' {
  if (step?.step_channel === 'email' || step?.action_type === 'email') return 'email';
  if (step?.step_channel === 'whatsapp' || step?.action_type === 'whatsapp_message') return 'whatsapp';
  return 'linkedin';
}

/**
 * Compte d'envoi d'une exécution : même ordre que l'envoi (étape, expéditeur
 * de rotation, compte d'inscription). Une inscription en rotation pas encore
 * attribuée est regroupée par séquence.
 */
export function sendingAccountKey(step: BatchStep | null | undefined, enrollment: BatchEnrollment | null | undefined): string {
  const account = step?.sender_id || enrollment?.assigned_sender_id || enrollment?.account_id;
  if (account) return `account:${account}`;
  return `sequence:${enrollment?.sequence_id ?? 'inconnue'}`;
}

/**
 * Sélection du cycle, dans l'ordre d'ancienneté reçu : au plus
 * MAX_VISIBLE_PER_ACCOUNT_PER_CYCLE envois LinkedIn ou WhatsApp par compte
 * d'envoi (avant : 3 pour toute la plateforme, une organisation qui inscrivait
 * 300 candidats bloquait toutes les autres), au plus MAX_INVISIBLE_PER_CYCLE
 * étapes invisibles, e-mails sans plafond par compte. Le budget de temps du
 * cycle borne le tout.
 */
export function selectCycleBatch<T extends { step?: BatchStep | null; enrollment?: BatchEnrollment | null }>(
  executions: T[],
  opts: { maxVisiblePerAccount?: number; maxInvisible?: number } = {},
): { selected: T[]; invisible: number; visible: number; email: number } {
  const maxVisiblePerAccount = opts.maxVisiblePerAccount ?? MAX_VISIBLE_PER_ACCOUNT_PER_CYCLE;
  const maxInvisible = opts.maxInvisible ?? MAX_INVISIBLE_PER_CYCLE;
  const perAccount = new Map<string, number>();
  let invisible = 0;
  let visible = 0;
  let email = 0;
  const selected: T[] = [];
  for (const exec of executions) {
    const actionType = exec.step?.action_type || '';
    if (INVISIBLE_STEP_ACTIONS.includes(actionType)) {
      if (invisible >= maxInvisible) continue;
      invisible++;
      selected.push(exec);
      continue;
    }
    if (stepSendChannel(exec.step) === 'email') {
      email++;
      selected.push(exec);
      continue;
    }
    const key = sendingAccountKey(exec.step, exec.enrollment);
    const used = perAccount.get(key) ?? 0;
    if (used >= maxVisiblePerAccount) continue;
    perAccount.set(key, used + 1);
    visible++;
    selected.push(exec);
  }
  return { selected, invisible, visible, email };
}

// ─── SEQ-195 : canal enregistré sur l'exécution ─────────────────────────────

const EXECUTION_CHANNELS = new Set(['email', 'linkedin', 'call', 'manual', 'whatsapp']);

/** Valeur de sequence_step_executions.channel (contrainte CHECK de la base). */
export function executionChannel(step: BatchStep | null | undefined): string {
  const declared = step?.step_channel ?? '';
  if (EXECUTION_CHANNELS.has(declared)) return declared;
  return stepSendChannel(step);
}

// ─── SEQ-073 : auto-pause par séquence ──────────────────────────────────────

export const AUTO_PAUSE_MIN_ACTIONS = 5;
export const AUTO_PAUSE_MAX_FAILURE_RATE = 0.3;

export interface SequenceCycleStats { actioned: number; failed: number }

/**
 * Séquences à mettre en pause pour trop d'échecs : le taux est calculé PAR
 * séquence (avant, sur tout le cycle, toutes organisations confondues : les
 * échecs d'une organisation désactivaient la séquence d'une autre), avec un
 * minimum d'actions. Seuls les échecs imputables à la séquence sont comptés
 * (ni compte déconnecté, ni profil introuvable, ni génération IA indisponible).
 */
export function sequencesToAutoPause(
  stats: Map<string, SequenceCycleStats>,
  opts: { minActions?: number; maxFailureRate?: number } = {},
): string[] {
  const minActions = opts.minActions ?? AUTO_PAUSE_MIN_ACTIONS;
  const maxRate = opts.maxFailureRate ?? AUTO_PAUSE_MAX_FAILURE_RATE;
  const out: string[] = [];
  for (const [sequenceId, s] of stats) {
    const actioned = Math.max(s.actioned, s.failed);
    if (actioned < minActions || s.failed === 0) continue;
    if (s.failed / actioned > maxRate) out.push(sequenceId);
  }
  return out;
}

// ─── SEQ-193 : report après un refus du plafond ─────────────────────────────

export type QuotaRefusalScope = 'infrastructure' | 'daily' | 'weekly' | 'inmail_credits';

/** Début de la plage d'envoi du lendemain, heure locale de `tz`. */
export function nextLocalDayAt(now: Date, tz: string | null | undefined, hour: number): Date {
  const zone = safeTimeZone(tz);
  const midnight = localDayEnd(now, zone).getTime();
  const h = Number.isFinite(hour) ? Math.min(Math.max(Math.floor(hour), 0), 23) : 8;
  // Minuit local + h heures, corrigé si un changement d'heure tombe entre les deux.
  let guess = midnight + h * 3600_000;
  const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(guess)));
  if (Number.isFinite(localHour) && localHour !== h) guess += (h - localHour) * 3600_000;
  return new Date(guess);
}

/**
 * Nouvelle date d'une exécution refusée par le plafond : panne passagère du
 * contrôle +30 min, plafond du jour au début de la plage d'envoi du lendemain,
 * plafond hebdomadaire ou crédits InMail +24 h. Avant, +24 h dans tous les cas
 * (une coupure de 30 s repoussait l'étape d'un jour).
 */
export function quotaBlockedRetryAt(
  scope: string | null | undefined,
  now: Date,
  tz: string | null | undefined,
  businessStartHour: number,
): Date {
  if (scope === 'infrastructure') return new Date(now.getTime() + 30 * 60_000);
  if (scope === 'daily') return nextLocalDayAt(now, tz, businessStartHour);
  return new Date(now.getTime() + 24 * 3600_000);
}

// ─── SEQ-077 / SEQ-078 : retours à trois états des autres lots ──────────────

export type ReplyCheckState = 'replied' | 'no_reply' | 'unknown';

/**
 * Résultat de la vérification de réponse avant envoi, quelle que soit sa forme
 * (booléen historique ou état à trois valeurs). Tout ce qui n'est pas une
 * réponse claire vaut « inconnu » : on n'envoie pas sur un doute.
 */
export function normalizeReplyCheck(value: unknown): ReplyCheckState {
  if (value === true || value === 'replied') return 'replied';
  if (value === false || value === 'no_reply') return 'no_reply';
  return 'unknown';
}

/** checkStepCondition demande un nouvel essai (lecture du profil en échec). */
export function isConditionRetry(value: unknown): value is 'retry' {
  return value === 'retry';
}

export const REPLY_CHECK_RETRY_MESSAGE = (attempt: number, max: number) =>
  `Vérification de réponse impossible : nouvel essai ${attempt}/${max} dans 30 min, rien n'a été envoyé`;
export const REPLY_CHECK_FAILED_MESSAGE =
  "Vérification de réponse impossible : message non envoyé. Vérifiez la conversation puis relancez l'étape.";
export const PROFILE_READ_RETRY_MESSAGE = (attempt: number, max: number) =>
  `Lecture du profil LinkedIn impossible : nouvel essai ${attempt}/${max} dans 30 min`;
export const PROFILE_READ_FAILED_MESSAGE =
  "Lecture du profil LinkedIn impossible après plusieurs essais : relancez l'étape plus tard.";
export const PROVIDER_UNAVAILABLE_MESSAGE = 'Service LinkedIn indisponible : nouvel essai dans 1 h';

// ─── SEQ-079 / SEQ-080 : preuves d'envoi ────────────────────────────────────

/** Envoi accepté par le fournisseur mais statut 'sent' non écrit. */
export const SENT_NOT_RECORDED_MESSAGE = 'Envoyé, statut non enregistré';
/**
 * E-mail interrompu sans preuve d'envoi (aucun identifiant de message) : peut-
 * être parti. Commence par « Envoi incertain » pour que la reprise
 * (sequence-resume.ts) ne le rejoue jamais.
 */
export const EMAIL_UNCERTAIN_MESSAGE = "Envoi incertain : e-mail peut-être parti, vérifiez la boîte d'envoi avant de relancer";

// ─── SEQ-090 : snapshot du modèle posé au verrou ────────────────────────────

/** Marqueur (tracking_data.content_origin) : final_message n'est qu'une copie du modèle. */
export const TEMPLATE_SNAPSHOT_ORIGIN = 'template_snapshot';
/** Marqueur : final_message est le texte résolu (IA, aperçu, variables) d'un essai précédent. */
export const RESOLVED_CONTENT_ORIGIN = 'resolved';

/**
 * Le texte figé sur l'exécution est-il la simple copie du modèle posée au
 * verrou d'une étape rédigée par l'IA ? Alors ce n'est pas une modification
 * du Journal : l'essai suivant doit régénérer (avant, le modèle brut partait).
 * Il faut le marqueur ET un texte identique au modèle : une vraie
 * modification faite depuis le Journal reste prioritaire.
 */
export function isStaleTemplateSnapshot(input: {
  trackingData: unknown;
  finalMessage?: string | null;
  finalSubject?: string | null;
  messageTemplate?: string | null;
  subjectTemplate?: string | null;
}): boolean {
  const td = input.trackingData;
  if (!td || typeof td !== 'object' || Array.isArray(td)) return false;
  if ((td as Record<string, unknown>).content_origin !== TEMPLATE_SNAPSHOT_ORIGIN) return false;
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();
  return same(input.finalMessage, input.messageTemplate) && same(input.finalSubject, input.subjectTemplate);
}

/** tracking_data de l'exécution avec le marqueur d'origine du contenu. */
export function withContentOrigin(trackingData: unknown, origin: string | null): Record<string, unknown> {
  const base = trackingData && typeof trackingData === 'object' && !Array.isArray(trackingData)
    ? { ...(trackingData as Record<string, unknown>) }
    : {};
  if (origin) base.content_origin = origin;
  else delete base.content_origin;
  return base;
}

// ─── SEQ-082 : reprise d'une inscription dormante ───────────────────────────

export interface DormantLastDone {
  status: string;
  skip_reason?: string | null;
  step?: {
    action_type?: string | null;
    timeout_branch_step_id?: string | null;
    if_true_goto_step?: string | null;
    if_false_goto_step?: string | null;
  } | null;
}

export type DormantRoute =
  | { kind: 'linear' }
  | { kind: 'branch'; stepId: string }
  | { kind: 'condition'; result: 'yes' | 'no' }
  | { kind: 'unknown_connection' };

/**
 * Suite d'une inscription dormante après sa dernière étape terminée, avec le
 * même routage que le moteur : délai dépassé vers la branche de délai
 * (handleCheckTimeouts), « Vérifier connexion » vers la branche oui ou non
 * selon connection_status (executeStepAction). Avant, toujours la suite
 * linéaire : message « invitation acceptée » à un candidat qui n'avait pas
 * accepté. Statut de connexion inconnu : on ne devine pas.
 */
export function dormantResumeRoute(lastDone: DormantLastDone, connectionStatus: string | null | undefined): DormantRoute {
  const step = lastDone.step ?? null;
  if (lastDone.status === 'skipped' && (lastDone.skip_reason ?? '').startsWith('Timeout')) {
    return step?.timeout_branch_step_id ? { kind: 'branch', stepId: step.timeout_branch_step_id } : { kind: 'linear' };
  }
  if (step?.action_type === 'check_connection' && lastDone.status !== 'skipped') {
    const connected = connectionStatus === 'connected';
    const notConnected = connectionStatus === 'not_connected' || connectionStatus === 'pending_invite';
    if (!connected && !notConnected) return { kind: 'unknown_connection' };
    const target = connected ? step.if_true_goto_step : step.if_false_goto_step;
    return target ? { kind: 'branch', stepId: target } : { kind: 'condition', result: connected ? 'yes' : 'no' };
  }
  return { kind: 'linear' };
}

// ─── SEQ-194 : battement de cœur des crons ──────────────────────────────────

/** 'skipped' quand le passage n'a rien traité faute de verrou. */
export function heartbeatStatusFor(payload: unknown): 'ok' | 'skipped' {
  if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).skipped_reason === 'lock_held') return 'skipped';
  return 'ok';
}

// ─── SEQ-188 : désinscription ───────────────────────────────────────────────

/** Adresse comparée à suppressed_emails (stockée en minuscules). */
export function normalizeEmailForSuppression(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e || null;
}

// ─── SEQ-197 : fuseau des heures d'envoi ────────────────────────────────────

/**
 * Fuseau réglé par le titulaire du compte d'envoi (member_quotas), sinon celui
 * de l'inscription, sinon Europe/Paris. Un fuseau invalide est ignoré.
 */
export function pickSendingTimezone(memberTimezone: string | null | undefined, enrollmentTimezone: string | null | undefined): string {
  const valid = (tz: string | null | undefined) => !!tz && safeTimeZone(tz) === tz.trim();
  if (valid(memberTimezone)) return (memberTimezone as string).trim();
  if (valid(enrollmentTimezone)) return (enrollmentTimezone as string).trim();
  return 'Europe/Paris';
}

// ─── SEQ-220 : relance d'un candidat ────────────────────────────────────────

/**
 * tracking_data d'une inscription relancée : la date de la réponse précédente
 * est gardée (previous_replied_at) avec la date de relance. replied_at repasse
 * à vide : l'interface le lit comme « a répondu » (statut courant).
 */
export function reEnrollTracking(trackingData: unknown, repliedAt: string | null | undefined, nowIso: string): Record<string, unknown> {
  const base = trackingData && typeof trackingData === 'object' && !Array.isArray(trackingData)
    ? { ...(trackingData as Record<string, unknown>) }
    : {};
  if (repliedAt) base.previous_replied_at = repliedAt;
  base.re_enrolled_at = nowIso;
  return base;
}
