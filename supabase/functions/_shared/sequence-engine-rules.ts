// Règles pures du moteur de séquences (process-sequences), sans accès base.
//
// Audit séquences 2026-09-25, lot E1a. Chaque décision qui peut provoquer un
// double envoi, un envoi après une réponse ou une clôture à tort est isolée
// ici pour être testée sans réseau :
//
//   deno test --no-check supabase/functions/_shared/sequence-engine-rules.test.ts

// Statuts d'une exécution réellement partie chez le candidat.
export const SENT_EXECUTION_STATUSES: readonly string[] = ['sent', 'opened', 'clicked', 'replied'];

// Actions qui produisent un envoi visible par le candidat.
export const VISIBLE_SEND_ACTIONS: readonly string[] = [
  'message', 'smart_message', 'inmail', 'email', 'whatsapp_message', 'connection_request',
];

// Ancien libellé du moteur quand l'inscription changeait de statut PENDANT
// l'appel d'envoi : le message était parti mais la ligne passait 'cancelled'
// (BUG-095). Ces lignes sont des envois livrés, jamais à rejouer.
const DELIVERED_CANCELLED_RE = /^Enrollment became \S+ during execution$/;

/** Ligne 'cancelled' héritée de BUG-095 : le message est en fait parti. */
export function isDeliveredCancelled(status: string | null | undefined, skipReason: string | null | undefined): boolean {
  return status === 'cancelled' && !!skipReason && DELIVERED_CANCELLED_RE.test(skipReason);
}

/** L'exécution compte comme un envoi parti (statut envoyé, ou ligne héritée de BUG-095). */
export function countsAsSent(row: { status: string; skip_reason?: string | null }): boolean {
  return SENT_EXECUTION_STATUSES.includes(row.status) || isDeliveredCancelled(row.status, row.skip_reason);
}

// ─── SEQ-001 : « Envoyer les actions du jour » ──────────────────────────────

// Seuls les envois visibles avancent. Les invitations (quota hebdomadaire),
// les attentes et les conditions (les avancer court-circuite le délai) et
// les visites ne bougent jamais.
export const NUDGE_ACTION_TYPES: readonly string[] = ['message', 'smart_message', 'inmail', 'email', 'whatsapp_message'];

/** Fuseau IANA valide, sinon Europe/Paris. */
export function safeTimeZone(tz: string | null | undefined): string {
  const candidate = (tz || '').trim();
  if (!candidate) return 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'Europe/Paris';
  }
}

/** Heure murale de `instant` dans `tz`, exprimée comme un instant UTC. */
function wallClockMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

/** Minuit suivant, heure locale de `tz` (fin de la journée en cours). */
export function localDayEnd(now: Date, tz: string | null | undefined): Date {
  const zone = safeTimeZone(tz);
  const wall = new Date(wallClockMs(now.getTime(), zone));
  const nextMidnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
  let guess = nextMidnightWall - (wallClockMs(nextMidnightWall, zone) - nextMidnightWall);
  guess = nextMidnightWall - (wallClockMs(guess, zone) - guess);
  return new Date(guess);
}

/**
 * Une exécution planifiée peut-elle être avancée à maintenant ? Oui seulement
 * si elle est prévue plus tard AUJOURD'HUI dans le fuseau de l'inscription :
 * une relance à J+3 garde sa date.
 */
export function isNudgeable(scheduledAt: string | null | undefined, now: Date, tz: string | null | undefined): boolean {
  if (!scheduledAt) return false;
  const at = new Date(scheduledAt).getTime();
  if (Number.isNaN(at)) return false;
  return at > now.getTime() && at < localDayEnd(now, tz).getTime();
}

// ─── SEQ-003 : relecture de l'inscription après un envoi réussi ─────────────

export type PostSendDecision =
  | { kind: 'proceed' }
  | { kind: 'record_sent_and_stop'; skipReason: string; writeExecution: boolean };

/**
 * Le fournisseur a accepté l'envoi, puis l'inscription a changé de statut
 * (pause, réponse, fin). Le message est parti : l'exécution est « envoyée »,
 * jamais « annulée » (une reprise la renverrait). La suite n'est pas planifiée.
 * Pour un e-mail, sequence-send-email a déjà écrit le statut : on n'y touche pas.
 */
export function decidePostSendRecheck(freshStatus: string | null | undefined, actionType: string): PostSendDecision {
  if (!freshStatus || freshStatus === 'active') return { kind: 'proceed' };
  return {
    kind: 'record_sent_and_stop',
    skipReason: `Inscription devenue ${freshStatus} pendant l'envoi`,
    writeExecution: actionType !== 'email',
  };
}

// ─── SEQ-004 : filet au moment de l'envoi ───────────────────────────────────

/** Une autre exécution de la même étape est déjà partie chez ce candidat. */
export function hasAlreadySentStep(otherExecutionsOfStep: Array<{ status: string; skip_reason?: string | null }>): boolean {
  return otherExecutionsOfStep.some(countsAsSent);
}

// ─── SEQ-005 : envoi dont l'issue est inconnue ──────────────────────────────

const UNCERTAIN_ACTIONS = new Set(['message', 'smart_message', 'inmail', 'whatsapp_message', 'connection_request']);
const UNCERTAIN_PREFIX_RE = /^(?:linkedin_send_failed_|whatsapp_send_failed_|invite )5\d\d\b/;

export const UNCERTAIN_SEND_MESSAGE = 'Envoi incertain : vérifiez la conversation avant de relancer';

/**
 * Erreur survenue APRÈS le POST d'envoi d'une action visible (5xx ou délai du
 * fournisseur) : le message a pu partir. Aucune relance automatique. Les
 * erreurs antérieures à l'envoi (429, contrôle de solde, résolution du profil,
 * recherche du fil) restent relancées. L'e-mail a son propre filet.
 */
export function isUncertainSendError(error: string | null | undefined, actionType: string): boolean {
  if (!error || !UNCERTAIN_ACTIONS.has(actionType)) return false;
  const e = error.toLowerCase();
  if (e.includes('send_uncertain')) return true;
  return UNCERTAIN_PREFIX_RE.test(e.trim());
}

/** sequence-send-email a envoyé l'e-mail mais n'a pas pu écrire son statut. */
export function isEmailSentButNotRecorded(error: string | null | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes('status_update_failed') || e.includes('email sent but failed to update');
}

// ─── SEQ-029 / SEQ-066 : sauts et garde « no_previous_message » ─────────────

export const EMAIL_CHANNEL_SKIP_REASON = 'Aucune adresse e-mail connue pour ce candidat : étape e-mail sautée';
export const LEGACY_EMAIL_CHANNEL_SKIP_REASON = 'No email — channel skipped';
export const LINKEDIN_CHANNEL_SKIP_REASON = 'No LinkedIn account — channel skipped';
export const WHATSAPP_CHANNEL_SKIP_REASON = 'No phone number — WhatsApp skipped';
export const MANUAL_SKIP_REASON = 'Manuellement sautée par le recruteur';
export const CONDITION_SKIP_PREFIX = 'Condition:';

const CHANNEL_SKIP_REASONS = new Set([
  EMAIL_CHANNEL_SKIP_REASON, LEGACY_EMAIL_CHANNEL_SKIP_REASON,
  LINKEDIN_CHANNEL_SKIP_REASON, WHATSAPP_CHANNEL_SKIP_REASON,
]);

/**
 * Saut qui ne doit pas bloquer l'étape suivante : canal indisponible,
 * condition non remplie, saut manuel (le dialogue « Sauter » annonce que la
 * séquence passe à l'étape suivante).
 */
export function isNonBlockingSkip(skipReason: string | null | undefined): boolean {
  if (!skipReason) return false;
  return CHANNEL_SKIP_REASONS.has(skipReason)
    || skipReason === MANUAL_SKIP_REASON
    || skipReason.startsWith(CONDITION_SKIP_PREFIX);
}

const BLOCKING_PRIOR_STATUSES = new Set(['failed', 'cancelled', 'bounced']);

/**
 * Faut-il clore l'inscription au lieu d'envoyer une relance ? Seulement si
 * aucun message antérieur n'est parti ET qu'au moins un a échoué, a été
 * annulé ou sauté pour un autre motif qu'un canal indisponible, une condition
 * ou un saut manuel. Sinon l'étape part comme premier message.
 */
export function shouldCloseForNoPreviousMessage(prior: Array<{ status: string; skip_reason?: string | null }>): boolean {
  if (prior.some(countsAsSent)) return false;
  return prior.some((s) => BLOCKING_PRIOR_STATUSES.has(s.status)
    || (s.status === 'skipped' && !isNonBlockingSkip(s.skip_reason)));
}

// ─── SEQ-020 : contenu envoyé (édition du Journal, aperçu d'inscription) ────

export interface StepContentInput {
  finalMessage?: string | null;
  finalSubject?: string | null;
  override?: { message?: string | null; subject?: string | null } | null;
  messageTemplate?: string | null;
  subjectTemplate?: string | null;
}

/**
 * Texte figé au verrouillage, champ par champ : une modification faite dans le
 * Journal (final_message / final_subject déjà renseignés) l'emporte sur
 * l'aperçu validé à l'inscription, qui l'emporte sur le modèle de l'étape.
 */
export function resolveStepContent(input: StepContentInput): {
  message: string; subject: string; editedMessage: boolean; editedSubject: boolean; usedOverride: boolean;
} {
  const editedMessage = !!input.finalMessage?.trim();
  const editedSubject = !!input.finalSubject?.trim();
  const overrideMessage = input.override?.message?.trim() || '';
  const overrideSubject = input.override?.subject?.trim() || '';
  const message = editedMessage ? (input.finalMessage as string) : (overrideMessage || input.messageTemplate || '');
  const subject = editedSubject ? (input.finalSubject as string) : (overrideSubject || input.subjectTemplate || '');
  const usedOverride = (!editedMessage && !!overrideMessage) || (!editedSubject && !!overrideSubject);
  return { message, subject, editedMessage, editedSubject, usedOverride };
}

// ─── SEQ-035 : texte vide ───────────────────────────────────────────────────

const TEXT_REQUIRED_ACTIONS = new Set(['message', 'inmail', 'smart_message', 'whatsapp_message']);

/** Un message, InMail ou WhatsApp sans texte ne part jamais (une invitation peut être sans note). */
export function isMissingRequiredText(actionType: string, message: string | null | undefined): boolean {
  return TEXT_REQUIRED_ACTIONS.has(actionType) && !(message || '').trim();
}

// ─── SEQ-006 : mission de l'inscription ─────────────────────────────────────

/** Les deux formes d'identifiant d'une mission dans job_candidate_status. */
export function missionJobIds(jobId: string | null | undefined): string[] | null {
  if (!jobId) return null;
  const base = String(jobId).replace(/^project:/, '').trim();
  return base ? [base, `project:${base}`] : null;
}
