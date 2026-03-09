import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeLinkedInUrl, extractLinkedInSlug } from '@/lib/linkedinUtils';
import { normalizeName, normalizeCompany } from '@/lib/stringUtils';

export interface AirtableMatchInfo {
  airtable_id: string;
  source_base: string;
  full_name: string | null;
  status: string | null;
  linkedin_url: string | null;
  match_type: 'url' | 'fuzzy'; // url = certain, fuzzy = name + company correlation
}

export interface ProfileMatchInput {
  url: string;
  name?: string;
  companies?: string[]; // companies from work_experience
}

// Global cache to avoid re-fetching across component re-renders
const matchCache = new Map<string, AirtableMatchInfo | null>();
const MAX_CACHE_SIZE = 500;

function evictCache(cache: Map<string, unknown>) {
  if (cache.size > MAX_CACHE_SIZE) {
    // Evict oldest entries (first inserted)
    const excess = cache.size - MAX_CACHE_SIZE;
    const keys = cache.keys();
    for (let i = 0; i < excess; i++) {
      const key = keys.next().value;
      if (key !== undefined) cache.delete(key);
    }
  }
}

/**
 * Hook that batch-checks LinkedIn profiles against the local airtable_candidates table.
 * First tries URL matching, then falls back to name + company correlation.
 */
export function useAirtableMatch(profiles: ProfileMatchInput[]) {
  const [matches, setMatches] = useState<Map<string, AirtableMatchInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const checkedRef = useRef<Set<string>>(new Set());

  const checkProfiles = useCallback(async (toCheck: ProfileMatchInput[]) => {
    const unchecked = toCheck.filter(p => p.url && !checkedRef.current.has(normalizeLinkedInUrl(p.url)));
    if (unchecked.length === 0) return;

    setLoading(true);
    try {
      // --- PASS 1: URL-based matching (certain) ---
      const slugs = unchecked
        .map(p => extractLinkedInSlug(p.url))
        .filter(Boolean) as string[];

      const urlResults: (AirtableMatchInfo & { _raw?: any })[] = [];
      if (slugs.length > 0) {
        for (let i = 0; i < slugs.length; i += 50) {
          const batch = slugs.slice(i, i + 50);
          const { data, error } = await supabase
            .from('airtable_candidates')
            .select('airtable_id, source_base, full_name, status, linkedin_url')
            .or(batch.map(s => `linkedin_url.ilike.%${s}%`).join(','));

          if (error) { console.error('Error checking Airtable URL matches:', error); continue; }
          if (data) urlResults.push(...data.map(d => ({ ...d, match_type: 'url' as const })));
        }
      }

      // Build result map from URL matches
      const newMatches = new Map(matches);
      const unmatchedProfiles: ProfileMatchInput[] = [];

      for (const profile of unchecked) {
        const slug = extractLinkedInSlug(profile.url);
        const normalizedUrl = normalizeLinkedInUrl(profile.url);

        if (slug) {
          const match = urlResults.find(r =>
            r.linkedin_url && r.linkedin_url.toLowerCase().includes(slug.toLowerCase())
          );
          if (match) {
            const info: AirtableMatchInfo = { ...match, match_type: 'url' };
            newMatches.set(normalizedUrl, info);
            matchCache.set(normalizedUrl, info);
            checkedRef.current.add(normalizedUrl);
            continue;
          }
        }

        // No URL match — try fuzzy if we have name + companies
        if (profile.name && profile.companies && profile.companies.length > 0) {
          unmatchedProfiles.push(profile);
        } else {
          matchCache.set(normalizedUrl, null);
          checkedRef.current.add(normalizedUrl);
        }
      }

      // --- PASS 2: Name + company fuzzy matching ---
      if (unmatchedProfiles.length > 0) {
        // Collect unique normalized names for batch query
        const nameQueries = [...new Set(
          unmatchedProfiles.map(p => normalizeName(p.name!)).filter(Boolean)
        )];

        if (nameQueries.length > 0) {
          const nameResults: Array<{
            airtable_id: string; source_base: string; full_name: string | null;
            status: string | null; linkedin_url: string | null; raw_data: any;
          }> = [];

          for (let i = 0; i < nameQueries.length; i += 20) {
            const batch = nameQueries.slice(i, i + 20);
            const { data, error } = await supabase
              .from('airtable_candidates')
              .select('airtable_id, source_base, full_name, status, linkedin_url, raw_data')
              .or(batch.map(n => `full_name.ilike.%${n}%`).join(','));

            if (error) { console.error('Error checking Airtable name matches:', error); continue; }
            if (data) nameResults.push(...data);
          }

          // For each unmatched profile, check if any name match also has a company overlap
          for (const profile of unmatchedProfiles) {
            const normalizedUrl = normalizeLinkedInUrl(profile.url);
            const profileNameNorm = normalizeName(profile.name!);
            const profileCompanies = (profile.companies || []).map(c => normalizeCompany(c));

            const nameMatches = nameResults.filter(r => {
              if (!r.full_name) return false;
              const airtableName = normalizeName(r.full_name);
              // Check exact name match (normalized)
              return airtableName === profileNameNorm;
            });

            // Among name matches, find one with a company in common
            const fuzzyMatch = nameMatches.find(r => {
              const airtableCompany = extractCompanyFromRawData(r.raw_data);
              if (!airtableCompany) return false;
              const normalizedAirtableCompany = normalizeCompany(airtableCompany);
              // Check if any LinkedIn company matches the Airtable company
              return profileCompanies.some(pc => 
                pc === normalizedAirtableCompany || 
                pc.includes(normalizedAirtableCompany) || 
                normalizedAirtableCompany.includes(pc)
              );
            });

            if (fuzzyMatch) {
              const info: AirtableMatchInfo = {
                airtable_id: fuzzyMatch.airtable_id,
                source_base: fuzzyMatch.source_base,
                full_name: fuzzyMatch.full_name,
                status: fuzzyMatch.status,
                linkedin_url: fuzzyMatch.linkedin_url,
                match_type: 'fuzzy',
              };
              newMatches.set(normalizedUrl, info);
              matchCache.set(normalizedUrl, info);
            } else {
              matchCache.set(normalizedUrl, null);
            }
            checkedRef.current.add(normalizedUrl);
          }
        }
      }

      evictCache(matchCache);
      setMatches(newMatches);
    } catch (err) {
      console.error('Error in useAirtableMatch:', err);
    } finally {
      setLoading(false);
    }
  }, [matches]);

  useEffect(() => {
    if (profiles.length === 0) return;

    const newMatches = new Map(matches);
    const toCheck: ProfileMatchInput[] = [];

    for (const profile of profiles) {
      if (!profile.url) continue;
      const normalized = normalizeLinkedInUrl(profile.url);
      const cached = matchCache.get(normalized);
      if (cached !== undefined) {
        if (cached) newMatches.set(normalized, cached);
      } else {
        toCheck.push(profile);
      }
    }

    if (newMatches.size > matches.size) {
      setMatches(newMatches);
    }

    if (toCheck.length > 0) {
      checkProfiles(toCheck);
    }
  }, [profiles.map(p => p.url).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const getMatch = useCallback((profileUrl: string | undefined): AirtableMatchInfo | null => {
    if (!profileUrl) return null;
    return matches.get(normalizeLinkedInUrl(profileUrl)) || null;
  }, [matches]);

  return { matches, loading, getMatch };
}

// normalizeLinkedInUrl, extractLinkedInSlug, normalizeName, normalizeCompany
// are now imported from @/lib/linkedinUtils and @/lib/stringUtils

/** Extract company name from Airtable raw_data */
function extractCompanyFromRawData(rawData: any): string | null {
  if (!rawData) return null;
  // Try common Airtable field names for current company
  return rawData['Nom de la société actuelle']
    || rawData['Société actuelle']
    || rawData['Entreprise']
    || rawData['Company']
    || rawData['Current Company']
    || null;
}
