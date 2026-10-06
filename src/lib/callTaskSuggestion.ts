/**
 * Résumé d'appel et tâches proposées : la partie sans effet de bord de
 * l'écran (échéance, textes, messages d'état).
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux).
 */

export type InsightStatus = 'pending' | 'transcribed' | 'ready' | 'unavailable' | 'failed';

/**
 * Échéance d'une tâche proposée : 9 h le jour voulu, ou dans une heure si ce
 * moment est déjà passé (tâche « aujourd'hui » proposée l'après-midi).
 */
export function suggestionDueAt(dueInDays: number, now: Date): Date {
  const days = Number.isFinite(dueInDays) ? Math.min(60, Math.max(0, Math.round(dueInDays))) : 2;
  const due = new Date(now.getTime());
  due.setDate(due.getDate() + days);
  due.setHours(9, 0, 0, 0);
  return due.getTime() > now.getTime() ? due : new Date(now.getTime() + 60 * 60_000);
}

/** « aujourd'hui », « demain », « sous 3 jours ». */
export function suggestionDueLabel(dueInDays: number): string {
  if (dueInDays <= 0) return "aujourd'hui";
  if (dueInDays === 1) return 'demain';
  return `sous ${dueInDays} jours`;
}

/** Description de la tâche créée : le motif donné par l'IA, puis la date de l'appel. */
export function suggestionDescription(reason: string | null, callStartedAt: string | null): string {
  const d = callStartedAt ? new Date(callStartedAt) : null;
  const when = d && !Number.isNaN(d.getTime())
    ? `Suite à l'appel du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.`
    : "Suite à un appel.";
  return reason ? `${reason}\n${when}` : when;
}

export interface InsightNotice {
  text: string;
  /** « Réessayer » a une chance de réussir. */
  canRetry: boolean;
}

/**
 * Ce qu'il faut dire quand l'appel n'a pas (encore) de résumé. Null quand le
 * résumé est là, ou quand il n'y a rien à dire.
 */
export function insightNotice(status: InsightStatus, errorCode: string | null, hasSummary: boolean): InsightNotice | null {
  if (hasSummary) return null;
  if (status === 'ready') {
    return errorCode === 'too_short' ? { text: 'Appel trop court pour être résumé.', canRetry: false } : null;
  }
  if (status === 'unavailable') {
    return {
      text: "Aircall n'a pas de transcription pour cet appel. Elle demande le module AI Assist d'Aircall et un appel enregistré.",
      canRetry: true,
    };
  }
  if (status === 'failed') {
    if (errorCode === 'no_credentials') {
      return { text: 'Les identifiants Aircall manquent. Reliez de nouveau Aircall dans les Paramètres.', canRetry: false };
    }
    if (errorCode === 'format') return { text: "La transcription d'Aircall n'a pas pu être lue.", canRetry: true };
    return { text: "Aircall n'a pas répondu.", canRetry: true };
  }
  if (status === 'transcribed') {
    if (errorCode === 'credits') return { text: 'Crédits IA insuffisants pour résumer cet appel.', canRetry: true };
    if (errorCode === 'no_user') return { text: "Aucun compte n'a pu être débité pour ce résumé.", canRetry: true };
    if (errorCode === 'llm') return { text: "Le résumé n'a pas pu être généré.", canRetry: true };
    return { text: 'Résumé en attente.', canRetry: true };
  }
  return { text: 'Transcription en cours de récupération.', canRetry: true };
}

/** Un appel décroché, assez long pour porter une transcription : le bouton « récupérer » se justifie. */
export function canRequestInsights(outcome: string | undefined, talkSeconds: number | undefined): boolean {
  return outcome === 'done' && (talkSeconds ?? 0) >= 20;
}
