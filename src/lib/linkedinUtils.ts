/**
 * Shared LinkedIn URL/slug utilities.
 * Extracted from useAirtableMatch, useNotionMatch, useCandidateHistory
 * to eliminate code duplication.
 */

/** Strip trailing slash and lowercase a LinkedIn URL for comparison. */
export function normalizeLinkedInUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

/**
 * Extract the `/in/slug` part from a LinkedIn profile URL.
 * Returns the slug in lowercase, or null if not a valid profile URL.
 */
export function extractLinkedInSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}
