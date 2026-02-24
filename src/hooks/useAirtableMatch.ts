import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AirtableMatchInfo {
  airtable_id: string;
  source_base: string;
  full_name: string | null;
  status: string | null;
  linkedin_url: string | null;
}

// Global cache to avoid re-fetching across component re-renders
const matchCache = new Map<string, AirtableMatchInfo | null>();

/**
 * Hook that batch-checks LinkedIn profile URLs against the local airtable_candidates table
 * to show a "Déjà dans Airtable" badge on search results.
 */
export function useAirtableMatch(profileUrls: string[]) {
  const [matches, setMatches] = useState<Map<string, AirtableMatchInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const checkedRef = useRef<Set<string>>(new Set());

  const checkProfiles = useCallback(async (urls: string[]) => {
    // Filter to only URLs we haven't checked yet
    const unchecked = urls.filter(url => url && !checkedRef.current.has(normalizeLinkedInUrl(url)));
    if (unchecked.length === 0) return;

    setLoading(true);
    try {
      // Extract LinkedIn slugs for matching
      const slugs = unchecked
        .map(url => extractLinkedInSlug(url))
        .filter(Boolean) as string[];

      if (slugs.length === 0) return;

      // Query in batches of 50
      const allResults: AirtableMatchInfo[] = [];
      for (let i = 0; i < slugs.length; i += 50) {
        const batch = slugs.slice(i, i + 50);
        // Use ilike with each slug to find matches
        // We search for any candidate whose linkedin_url contains the slug
        const { data, error } = await supabase
          .from('airtable_candidates')
          .select('airtable_id, source_base, full_name, status, linkedin_url')
          .or(batch.map(s => `linkedin_url.ilike.%${s}%`).join(','));

        if (error) {
          console.error('Error checking Airtable matches:', error);
          continue;
        }
        if (data) allResults.push(...(data as AirtableMatchInfo[]));
      }

      // Map results back to original URLs
      const newMatches = new Map(matches);
      for (const url of unchecked) {
        const slug = extractLinkedInSlug(url);
        const normalizedUrl = normalizeLinkedInUrl(url);
        checkedRef.current.add(normalizedUrl);

        if (!slug) continue;

        const match = allResults.find(r => 
          r.linkedin_url && r.linkedin_url.toLowerCase().includes(slug.toLowerCase())
        );

        if (match) {
          newMatches.set(normalizedUrl, match);
          matchCache.set(normalizedUrl, match);
        } else {
          matchCache.set(normalizedUrl, null);
        }
      }

      setMatches(newMatches);
    } catch (err) {
      console.error('Error in useAirtableMatch:', err);
    } finally {
      setLoading(false);
    }
  }, [matches]);

  useEffect(() => {
    if (profileUrls.length === 0) return;

    // First, load from cache
    const newMatches = new Map(matches);
    const toCheck: string[] = [];

    for (const url of profileUrls) {
      if (!url) continue;
      const normalized = normalizeLinkedInUrl(url);
      const cached = matchCache.get(normalized);
      if (cached !== undefined) {
        if (cached) newMatches.set(normalized, cached);
      } else {
        toCheck.push(url);
      }
    }

    if (newMatches.size > matches.size) {
      setMatches(newMatches);
    }

    if (toCheck.length > 0) {
      checkProfiles(toCheck);
    }
  }, [profileUrls.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const getMatch = useCallback((profileUrl: string | undefined): AirtableMatchInfo | null => {
    if (!profileUrl) return null;
    return matches.get(normalizeLinkedInUrl(profileUrl)) || null;
  }, [matches]);

  return { matches, loading, getMatch };
}

function normalizeLinkedInUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

function extractLinkedInSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}
