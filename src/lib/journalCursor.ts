// Journal d'une séquence (lot 5c-2) : pagination par curseur sur
// (scheduled_at, id), du plus récent au plus ancien, à la place de la limite
// de 500 lignes du panneau. Module pur, testé sous Node.
//
// Le curseur est la dernière ligne affichée ; la page suivante prend les
// lignes strictement avant elle dans l'ordre (scheduled_at desc, id desc).
// Deux étapes prévues à la même seconde ne sont ni perdues ni répétées.

export const JOURNAL_PAGE_SIZE = 100;

export interface JournalCursor {
  scheduled_at: string;
  id: string;
}

/** Valeur citée pour un filtre `or()` de l'API (la date porte « : » et « . »). */
function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/** Filtre `or()` de la page qui suit `cursor` : avant lui, ou même date et identifiant plus petit. */
export function journalCursorFilter(cursor: JournalCursor): string {
  const at = quoted(cursor.scheduled_at);
  return `scheduled_at.lt.${at},and(scheduled_at.eq.${at},id.lt.${quoted(cursor.id)})`;
}

/** Curseur de la page suivante : la dernière ligne lue, ou null si la page n'était pas pleine. */
export function nextJournalCursor<T extends JournalCursor>(rows: readonly T[], pageSize: number = JOURNAL_PAGE_SIZE): JournalCursor | null {
  if (rows.length < pageSize) return null;
  const last = rows[rows.length - 1];
  return { scheduled_at: last.scheduled_at, id: last.id };
}
