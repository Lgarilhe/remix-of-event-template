/**
 * useCandidateSearch — autocomplete sur les candidats existants de l'org.
 *
 * Cherche dans `job_candidate_status` par candidate_name (ILIKE), dédoublonne
 * par candidate_id (un même candidat peut être sur plusieurs missions →
 * on garde 1 ligne par candidat avec aggregation des missions).
 *
 * Utilisé par le CandidateAutocomplete dans CreateEventModal.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export interface CandidateSearchResult {
  /** LinkedIn profile_id (= candidate_id côté JCS) */
  candidateId: string;
  name: string;
  headline: string | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  /** Dernière mission liée (pour contexte UX) */
  lastJobTitle: string | null;
  lastJobId: string | null;
}

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 6;

export function useCandidateSearch(query: string): {
  results: CandidateSearchResult[];
  loading: boolean;
} {
  const { organizationId } = useOrganization();
  const [results, setResults] = useState<CandidateSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !organizationId || trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('job_candidate_status')
          .select(
            'candidate_id, candidate_name, candidate_headline, linkedin_profile_url, linkedin_profile_data, job_id, updated_at',
          )
          .eq('organization_id', organizationId)
          .not('candidate_name', 'is', null)
          .ilike('candidate_name', `%${trimmed}%`)
          .order('updated_at', { ascending: false })
          .limit(40); // pull large, dedupe ensuite

        if (cancelled) return;
        if (error) {
          console.warn('[useCandidateSearch]', error);
          setResults([]);
          return;
        }

        // Dedup par candidate_id (garde la 1re row la plus récente)
        const seen = new Map<string, CandidateSearchResult>();
        for (const row of data || []) {
          const r = row as any;
          if (!r.candidate_id || seen.has(r.candidate_id)) continue;
          const profileData = r.linkedin_profile_data as Record<string, unknown> | null;
          const avatar =
            (profileData?.profile_picture_url as string | undefined) ||
            (profileData?.profile_picture_url_large as string | undefined) ||
            null;
          seen.set(r.candidate_id, {
            candidateId: r.candidate_id,
            name: r.candidate_name,
            headline: r.candidate_headline ?? null,
            linkedinUrl: r.linkedin_profile_url ?? null,
            avatarUrl: avatar,
            lastJobTitle: null, // job titles sont dans sourcing_projects, pas JCS
            lastJobId: r.job_id ?? null,
          });
          if (seen.size >= MAX_RESULTS) break;
        }

        setResults(Array.from(seen.values()));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, organizationId]);

  return { results, loading };
}
