import { useMemo } from 'react';
import { useNotionCandidates } from './useNotionCandidates';
import { normalizeLinkedInUrl, extractLinkedInSlug } from '@/lib/linkedinUtils';
import { normalizeName } from '@/lib/stringUtils';

export interface NotionMatchInfo {
  id: string;
  name: string;
  linkedin: string | null;
}

interface NotionProfileInput {
  url?: string | null;
  name?: string | null;
}

// normalizeLinkedInUrl, extractLinkedInSlug, normalizeName
// are now imported from @/lib/linkedinUtils and @/lib/stringUtils

/**
 * Hook that checks LinkedIn profiles against Notion candidates
 * to show a Notion badge on search results.
 * Uses URL slug first, then falls back to normalized full name.
 */
export function useNotionMatch(profiles: NotionProfileInput[]) {
  const { data: notionCandidates } = useNotionCandidates();

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

  const notionNameMap = useMemo(() => {
    const map = new Map<string, NotionMatchInfo>();
    if (!notionCandidates) return map;

    for (const candidate of notionCandidates) {
      const key = normalizeName(candidate.name);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          id: candidate.id,
          name: candidate.name,
          linkedin: candidate.linkedin,
        });
      }
    }

    return map;
  }, [notionCandidates]);

  const matches = useMemo(() => {
    const result = new Map<string, NotionMatchInfo>();

    for (const profile of profiles) {
      const rawUrl = profile.url || '';
      const rawName = profile.name || '';
      let match: NotionMatchInfo | undefined;

      if (rawUrl) {
        const slug = extractLinkedInSlug(rawUrl);
        if (slug) match = notionSlugMap.get(slug);
      }

      if (!match && rawName) {
        match = notionNameMap.get(normalizeName(rawName));
      }

      if (!match) continue;

      if (rawUrl) {
        result.set(normalizeLinkedInUrl(rawUrl), match);
      }
      if (rawName) {
        result.set(`name:${normalizeName(rawName)}`, match);
      }
    }

    return result;
  }, [profiles, notionSlugMap, notionNameMap]);

  const getMatch = (profile: NotionProfileInput | undefined): NotionMatchInfo | null => {
    if (!profile) return null;

    if (profile.url) {
      const byUrl = matches.get(normalizeLinkedInUrl(profile.url));
      if (byUrl) return byUrl;
    }

    if (profile.name) {
      return matches.get(`name:${normalizeName(profile.name)}`) || null;
    }

    return null;
  };

  return { matches, getMatch, loading: !notionCandidates };
}
