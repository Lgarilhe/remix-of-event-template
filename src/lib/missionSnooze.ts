/**
 * Reports « Plus tard » de la carte Maintenant (refonte mission, lot 3).
 *
 * Module pur, sans import : chargé tel quel par les tests, lu par la règle
 * (src/lib/missionNextAction.ts) et par le hook des reports. Un report est une
 * ligne par personne, par mission et par action (table mission_action_snoozes) :
 * la personne ne voit plus cette action jusqu'à l'échéance, le lendemain matin
 * à 6 h, heure du navigateur.
 *
 * Il n'agit jamais sur le chiffre d'« À traiter » de la barre latérale : rien
 * ici ne lit ni n'écrit les notifications.
 */

/**
 * Natures d'action reportables. Le rang n'est pas stocké : la règle d'ordre
 * peut changer sans migration. blocked_plan et blocked_rights sont réservées
 * (aucun blocage de ce type au lot 3).
 */
export const SNOOZE_KINDS = [
  'blocked_linkedin',
  'blocked_plan',
  'blocked_org_type',
  'blocked_rights',
  'reply',
  'stalled_interview',
  'retained_uncontacted',
  'to_sort',
  'unopened_profiles',
  'first_search',
  'describe_brief',
] as const;
export type SnoozeKind = (typeof SNOOZE_KINDS)[number];

/** Heure locale de la fin d'un report : le lendemain matin. */
export const SNOOZE_END_HOUR = 6;

/** « nature » pour un ensemble, « nature:identifiant » pour une personne (candidate_id). */
export function snoozeKey(kind: SnoozeKind, subjectId?: string | null): string {
  const subject = typeof subjectId === 'string' ? subjectId.trim() : '';
  return subject ? `${kind}:${subject}` : kind;
}

/**
 * Demain 06:00, heure locale. Le constructeur local gère le changement
 * d'heure : un jour de passage à l'heure d'été ou d'hiver n'avance ni ne
 * recule la fin du report. Quelle que soit l'heure du clic (3 h comprise),
 * c'est bien le lendemain.
 */
export function nextLocalMorning(now: Date | number): Date {
  const d = typeof now === 'number' ? new Date(now) : now;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, SNOOZE_END_HOUR, 0, 0, 0);
}

export interface SnoozeRow {
  id: string;
  projectId: string;
  actionKey: string;
  /** Fin du report, chaîne de la base. */
  expiresAt: string;
  /** Instant du dernier report, posé par le serveur. */
  updatedAt: string;
}

export const snoozeIndexKey = (projectId: string, actionKey: string): string => `${projectId}|${actionKey}`;

/**
 * Vrai si l'action est reportée à `now`. `lastEventAt` : date du dernier
 * événement de l'action (dernier message reçu d'un candidat, par exemple) ;
 * un événement postérieur au report l'annule. Une date illisible annule aussi
 * le report : montrer une action de trop vaut mieux que la cacher. Une
 * échéance illisible ou passée ne reporte rien.
 */
export function isSnoozed(
  rows: ReadonlyMap<string, SnoozeRow> | null | undefined,
  projectId: string,
  actionKey: string,
  now: Date | number,
  lastEventAt: string | null = null,
): boolean {
  const row = rows?.get(snoozeIndexKey(projectId, actionKey));
  if (!row) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const expires = Date.parse(row.expiresAt);
  if (Number.isNaN(expires) || expires <= nowMs) return false;
  if (lastEventAt === null) return true;
  const event = Date.parse(lastEventAt);
  const snoozedAt = Date.parse(row.updatedAt);
  if (Number.isNaN(event) || Number.isNaN(snoozedAt)) return false;
  return event <= snoozedAt;
}

/** Test d'un report pour une mission : ce que la règle de la prochaine action reçoit en entrée. */
export type SnoozeCheck = (actionKey: string, lastEventAt?: string | null) => boolean;

/** Fige la mission, la date et la liste des reports : la règle n'a plus qu'une clé à fournir. */
export function snoozeChecker(
  rows: ReadonlyMap<string, SnoozeRow> | null | undefined,
  projectId: string,
  now: Date | number,
): SnoozeCheck {
  return (actionKey, lastEventAt = null) => isSnoozed(rows, projectId, actionKey, now, lastEventAt);
}
