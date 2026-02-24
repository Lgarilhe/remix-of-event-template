import { useMemo } from 'react';
import { useNotionCandidates } from './useNotionCandidates';

export interface NotionMatchInfo {
  id: string;
  name: string;
  linkedin: string | null;
}

function normalizeLinkedInUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

function extractLinkedInSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Hook that checks LinkedIn profile URLs against Notion candidates
 * to show a Notion badge on search results.
 * Uses the already-cached React Query data from useNotionCandidates.
 */
export function useNotionMatch(profileUrls: string[]) {
  const { data: notionCandidates } = useNotionCandidates();

  // Build a slug -> candidate map from Notion data
  const notionSlugMap = useMemo(() => {
    const map = new Map<string, NotionMatchInfo>();
    if (!notionCandidates) return map;

    for (const candidate of notionCandidates) {
      if (!candidate.linkedin) continue;
      const slug = extractLinkedInSlug(candidate.linkedin);
      if (slug) {
        map.set(slug, {
          id: candidate.id,
          name: candidate.name,
          linkedin: candidate.linkedin,
        });
      }
    }
    return map;
  }, [notionCandidates]);

  // Check each profile URL against the Notion map
  const matches = useMemo(() => {
    const result = new Map<string, NotionMatchInfo>();
    for (const url of profileUrls) {
      if (!url) continue;
      const slug = extractLinkedInSlug(url);
      if (!slug) continue;
      const match = notionSlugMap.get(slug);
      if (match) {
        result.set(normalizeLinkedInUrl(url), match);
      }
    }
    return result;
  }, [profileUrls, notionSlugMap]);

  const getMatch = (profileUrl: string | undefined): NotionMatchInfo | null => {
    if (!profileUrl) return null;
    return matches.get(normalizeLinkedInUrl(profileUrl)) || null;
  };

  return { matches, getMatch, loading: !notionCandidates };
}
