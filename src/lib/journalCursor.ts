// Pagination par curseur des pages Séquences (lot 5c-2), à la place de la
// limite de 500 lignes du panneau et des pages par décalage. Module pur,
// testé sous Node.
//
// Le curseur est la dernière ligne lue ; la page suivante prend les lignes
// strictement après elle dans l'ordre de lecture (colonne de date, puis id).
// Deux lignes à la même date ne sont ni perdues ni répétées, et une ligne qui
// change de statut entre deux pages ne décale pas la suite (contrairement à
// un décalage sur une liste filtrée).
//
// - Journal d'une séquence : (scheduled_at, id), du plus récent au plus ancien.
// - « À venir » : (scheduled_at, id), du plus proche au plus lointain.
// - Onglet « Candidats » : (created_at, id), de la plus récente inscription à la plus ancienne.

export const JOURNAL_PAGE_SIZE = 100;

export interface JournalCursor {
  scheduled_at: string;
  id: string;
}

/** Valeur citée pour un filtre `or()` de l'API (la date porte « : » et « . »). */
function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/**
 * Filtre `or()` de la page qui suit la ligne (`at`, `id`) dans l'ordre de
 * `column` : avant elle (ordre décroissant) ou après elle (croissant), ou
 * même date et identifiant plus petit (plus grand).
 */
export function keysetFilter(column: string, at: string, id: string, ascending = false): string {
  const op = ascending ? 'gt' : 'lt';
  const value = quoted(at);
  return `${column}.${op}.${value},and(${column}.eq.${value},id.${op}.${quoted(id)})`;
}

/** Filtre `or()` de la page qui suit `cursor` : avant lui (ou après, pour « À venir »). */
export function journalCursorFilter(cursor: JournalCursor, ascending = false): string {
  return keysetFilter('scheduled_at', cursor.scheduled_at, cursor.id, ascending);
}

/** Curseur de la page suivante : la dernière ligne lue, ou null si la page n'était pas pleine. */
export function nextJournalCursor<T extends JournalCursor>(rows: readonly T[], pageSize: number = JOURNAL_PAGE_SIZE): JournalCursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  return { scheduled_at: last.scheduled_at, id: last.id };
}

/** Curseur des inscriptions (onglet « Candidats ») : (created_at, id) de la dernière ligne lue. */
export interface EnrollmentCursor {
  created_at: string;
  id: string;
}

export function enrollmentCursorFilter(cursor: EnrollmentCursor): string {
  return keysetFilter('created_at', cursor.created_at, cursor.id, false);
}

export function nextEnrollmentCursor<T extends EnrollmentCursor>(rows: readonly T[], pageSize: number): EnrollmentCursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  return { created_at: last.created_at, id: last.id };
}
