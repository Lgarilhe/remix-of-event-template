import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { GeneratedFilters } from '@/components/outreach/search/generateFiltersFromJob';
import {
  FirstSearchError,
  runFirstSearch,
  scorePreview,
  type LinkedInSubscriptions,
  type PreviewCandidate,
  type PreviewScore,
  type ScoringJob,
} from '@/lib/onboarding/search';

export interface PreviewResults {
  candidates: PreviewCandidate[];
  total: number | null;
  scores: Record<string, PreviewScore>;
  /** pending : l'IA lit les profils ; done : scores reçus ; none : scoring indisponible, l'aperçu s'en passe. */
  scoring: 'pending' | 'done' | 'none';
}

export type FirstSearchState =
  | { status: 'loading' }
  | { status: 'ready'; results: PreviewResults }
  | { status: 'error'; message: string; kind: FirstSearchError['kind'] };

type Raw = Record<string, unknown>;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** Poste de scoring bâti sur le brief enregistré de la mission. */
function scoringJobOf(missionId: string, row: { name: string; client_name: string | null; description: string | null; job_details: unknown }): ScoringJob {
  const jd = (row.job_details && typeof row.job_details === 'object' ? row.job_details : {}) as Raw;
  const must = list(jd.skills_must_have);
  const should = list(jd.skills_should_have);
  const client = jd.client && typeof jd.client === 'object' ? (jd.client as Raw) : {};
  return {
    id: `project:${missionId}`,
    title: typeof jd.title === 'string' && jd.title ? jd.title : row.name,
    client: row.client_name ? { name: row.client_name, sector: typeof client.sector === 'string' ? client.sector : '' } : null,
    skills: [...must, ...should],
    description: typeof jd.mission_description === 'string' ? jd.mission_description : (row.description ?? ''),
    location: typeof jd.location === 'string' ? jd.location : null,
    xpMin: typeof jd.experience_min === 'number' ? jd.experience_min : null,
    xpMax: typeof jd.experience_max === 'number' ? jd.experience_max : null,
    mustHave: must.join(', '),
  };
}

/**
 * La première recherche : filtres relus sur la mission, une page de résultats
 * sur le compte LinkedIn, puis les scores qui arrivent après coup. Les
 * résultats sont gardés par le parcours (`initial`) : revenir sur la scène ne
 * relance ni la recherche ni le scoring.
 */
export function useFirstSearch(input: {
  missionId: string;
  account: { id: string; subscriptions: LinkedInSubscriptions | null };
  initial: PreviewResults | null;
  onResults: (results: PreviewResults) => void;
}) {
  const { missionId, account, initial, onResults } = input;
  const [state, setState] = useState<FirstSearchState>(initial ? { status: 'ready', results: initial } : { status: 'loading' });
  const runRef = useRef(0);
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  const run = useCallback(async () => {
    const id = ++runRef.current;
    setState({ status: 'loading' });
    try {
      const { data: row, error } = await supabase
        .from('sourcing_projects')
        .select('name, client_name, description, filters_snapshot, job_details')
        .eq('id', missionId)
        .maybeSingle();
      if (error || !row) throw new FirstSearchError("La mission n'a pas pu être relue. Réessayez dans un instant.", 'other');
      const { generated_at: _g, brief_text: _b, source: _s, ...filters } = (row.filters_snapshot ?? {}) as Raw;
      void _g; void _b; void _s;

      const found = await runFirstSearch({ filters: filters as unknown as GeneratedFilters, accountId: account.id, subscriptions: account.subscriptions, limit: 10 });
      if (id !== runRef.current) return;
      const first: PreviewResults = { candidates: found.candidates, total: found.total, scores: {}, scoring: found.candidates.length > 0 ? 'pending' : 'none' };
      setState({ status: 'ready', results: first });
      onResultsRef.current(first);
      if (found.candidates.length === 0) return;

      const scores = await scorePreview(found.candidates, scoringJobOf(missionId, row));
      if (id !== runRef.current) return;
      const done: PreviewResults = { ...first, scores: Object.fromEntries(scores.map((s) => [s.id, s])), scoring: scores.length > 0 ? 'done' : 'none' };
      setState({ status: 'ready', results: done });
      onResultsRef.current(done);
    } catch (e) {
      if (id !== runRef.current) return;
      const err = e instanceof FirstSearchError ? e : new FirstSearchError("La recherche n'a pas abouti. Réessayez dans un instant.", 'other');
      setState({ status: 'error', message: err.message, kind: err.kind });
    }
  }, [missionId, account.id, account.subscriptions]);

  useEffect(() => {
    if (!initial) void run();
    return () => {
      runRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, retry: run };
}
