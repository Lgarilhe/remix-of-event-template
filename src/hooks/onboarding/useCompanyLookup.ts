import { useCallback, useRef, useState } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { parseCandidates, parseCompany, type CompanyBrief, type CompanyCandidate } from '@/lib/onboarding/company';

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; name: string }
  | { status: 'disambiguate'; name: string; candidates: CompanyCandidate[] }
  | { status: 'ready'; name: string; company: CompanyBrief }
  | { status: 'failed'; name: string };

/**
 * Fiche société en arrière-plan. La recherche prend de quelques secondes à une
 * demi-minute : elle ne bloque jamais une scène, elle se termine pendant que
 * l'utilisateur répond à la question suivante. Sans `force_refresh`, une société
 * déjà connue revient du cache en moins d'une seconde.
 */
export function useCompanyLookup() {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  // Une réponse tardive d'une ancienne recherche ne remplace jamais la plus récente.
  const runRef = useRef(0);

  const start = useCallback(async (rawName: string, selectedId?: string) => {
    const name = rawName.trim();
    if (name.length < 2) return;
    const run = ++runRef.current;
    setState({ status: 'loading', name });
    try {
      const { data, error } = await invokeEdgeFunction<{ company?: unknown; disambiguate?: boolean; candidates?: unknown }>('enrich-company', {
        company_name: name,
        country: 'France',
        ...(selectedId ? { selected_apollo_id: selectedId } : {}),
      });
      if (run !== runRef.current) return;
      if (error || !data?.success) {
        setState({ status: 'failed', name });
        return;
      }
      const candidates = parseCandidates(data.candidates);
      if (data.disambiguate && candidates.length > 0) {
        setState({ status: 'disambiguate', name, candidates });
        return;
      }
      setState({ status: 'ready', name, company: parseCompany(data.company, name) });
    } catch {
      if (run === runRef.current) setState({ status: 'failed', name });
    }
  }, []);

  const reset = useCallback(() => {
    runRef.current += 1;
    setState({ status: 'idle' });
  }, []);

  return { state, start, reset };
}
