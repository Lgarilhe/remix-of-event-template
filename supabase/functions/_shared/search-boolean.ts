/** Shared input validation for manual and unattended LinkedIn searches.
 * Validation never repairs or rewrites a query; quoted phrases stay literal. */
export type SearchBooleanIssue = 'empty' | 'quotes' | 'parentheses' | 'operators';

export function searchBooleanIssue(input: unknown): SearchBooleanIssue | null {
  if (typeof input !== 'string' || !input.trim()) return 'empty';
  let syntax = '';
  let depth = 0;
  let inQuote = false;
  for (const ch of input) {
    if (ch === '"') {
      if (!inQuote) syntax += ' PHRASE ';
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) return 'parentheses';
        depth--;
      }
      syntax += ch;
    }
  }
  if (inQuote) return 'quotes';
  if (depth !== 0) return 'parentheses';
  // LinkedIn operators are uppercase. Lowercase words remain literal text.
  if (/\b(?:AND|OR|NOT)\s*(?:\)|$)/.test(syntax)
    || /(?:^|\()\s*(?:AND|OR)\b/.test(syntax)
    || /\b(?:AND|OR|NOT)\s+(?:AND|OR)\b/.test(syntax)
    || /\(\s*\)/.test(syntax)) return 'operators';
  return null;
}
