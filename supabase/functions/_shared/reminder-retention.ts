/**
 * Conservation des rappels et tâches (candidate_reminders) : 24 mois après leur
 * dernière activité (décision du propriétaire du 12/10/2026, à confirmer par un
 * avis juridique comme les autres durées de rgpd-purge).
 *
 * Fonctions pures, sans importation de Deno ni de client : lues par rgpd-purge
 * (étape 9) et par le test Deno reminder-retention.test.ts.
 *
 * Dernière activité d'un rappel : la plus tardive de sa création, de sa
 * dernière modification, de son échéance et de sa réalisation. Une échéance
 * lointaine garde donc le rappel jusqu'à 24 mois après elle. Une date absente
 * ou illisible est ignorée ; un rappel sans aucune date lisible n'est jamais
 * purgé (jamais de suppression sans preuve d'ancienneté). Même règle pour un
 * rappel sans organisation (extension Chrome, état hérité).
 */
import { retentionCutoff } from './phone-call-erasure.ts';

/** Durée de conservation d'un rappel après sa dernière activité. */
export const REMINDER_RETENTION_MONTHS = 24;

/** Colonnes datées qui comptent comme activité d'un rappel. */
export const REMINDER_ACTIVITY_COLUMNS = ['created_at', 'updated_at', 'due_at', 'completed_at'] as const;

export type ReminderActivityColumn = typeof REMINDER_ACTIVITY_COLUMNS[number];
export type ReminderDates = Partial<Record<ReminderActivityColumn, string | null>>;

/** Date de la dernière activité du rappel, ou null s'il n'a aucune date lisible. */
export function reminderLastActivity(row: ReminderDates): Date | null {
  let last: number | null = null;
  for (const column of REMINDER_ACTIVITY_COLUMNS) {
    const value = row[column];
    if (typeof value !== 'string' || value === '') continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (last === null || ms > last) last = ms;
  }
  return last === null ? null : new Date(last);
}

/** Borne de purge : 24 mois avant `now`, un jour de marge (retentionCutoff). */
export function reminderRetentionCutoff(now: Date): Date {
  return retentionCutoff(now, REMINDER_RETENTION_MONTHS);
}

/** Vrai si la dernière activité du rappel est strictement antérieure à la borne. */
export function isReminderExpired(row: ReminderDates, cutoff: Date): boolean {
  const last = reminderLastActivity(row);
  return last !== null && last.getTime() < cutoff.getTime();
}

/**
 * La même règle en filtres PostgREST, un `.or()` par colonne : chaque date est
 * absente ou antérieure à la borne. La création (NOT NULL en base) fournit
 * toujours une date ; isReminderExpired confirme chaque ligne lue.
 */
export function reminderAgeFilters(cutoffIso: string): string[] {
  return REMINDER_ACTIVITY_COLUMNS.map((column) => `${column}.is.null,${column}.lt."${cutoffIso}"`);
}
