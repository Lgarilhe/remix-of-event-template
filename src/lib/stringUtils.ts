/**
 * Shared string normalization utilities.
 * Extracted from useAirtableMatch, useNotionMatch, useAircallHistory
 * to eliminate code duplication.
 */

/**
 * Normalize a person's name for comparison:
 * lowercase, remove accents/diacritics, strip non-alpha chars, collapse whitespace.
 */
export function normalizeName(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a company name for comparison:
 * strips common legal suffixes (SAS, SARL, Inc, Ltd, etc.), removes accents.
 */
export function normalizeCompany(company: string): string {
  return company
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(sas|sarl|sa|sasu|inc|ltd|llc|gmbh|group|groupe)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a phone number for comparison:
 * strips non-digit chars, converts French local (0X) → international (+33X).
 */
export function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+33' + cleaned.slice(1);
  }
  if (cleaned.startsWith('33') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned || null;
}
