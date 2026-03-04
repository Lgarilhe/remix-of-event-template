/**
 * Parse Unipile date fields which can be either:
 * - A string like "2019-01", "2019", "2019-01-15"
 * - An object like { year: 2019, month: 1 }
 * - null/undefined
 * 
 * Returns a normalized { year, month } object or null.
 */
export function parseDate(
  value: string | { year?: number; month?: number } | null | undefined
): { year: number; month?: number } | null {
  if (!value) return null;

  if (typeof value === 'object') {
    if (value.year) return { year: value.year, month: value.month };
    return null;
  }

  if (typeof value === 'string') {
    // Try "YYYY-MM-DD" or "YYYY-MM" or "YYYY"
    const parts = value.split('-');
    const year = parseInt(parts[0], 10);
    if (isNaN(year) || year < 1900) return null;
    const month = parts[1] ? parseInt(parts[1], 10) : undefined;
    return { year, month: month && !isNaN(month) ? month : undefined };
  }

  return null;
}

/** Shorthand to get just the year from a Unipile date field */
export function getYear(
  value: string | { year?: number; month?: number } | null | undefined
): number | undefined {
  return parseDate(value)?.year;
}
