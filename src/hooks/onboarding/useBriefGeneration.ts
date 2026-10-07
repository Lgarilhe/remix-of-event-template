import { useCallback, useEffect, useRef, useState } from 'react';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { parseBriefResponse, type BriefDraft } from '@/lib/onboarding/brief';
import { useOrganization } from '@/hooks/useOrganization';
import { requireGeneratedFilters } from '@/components/outreach/search/generateFiltersFromJob';

export type BriefGenState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; reason: 'credits' | 'other' };

export interface BriefRequest {
  title: string;
  client: string | null;
  sector: string | null;
  /** Ce que l'on sait de la société : donne du grain à l'analyse d'un simple intitulé. */
  context: string;
}

/**
 * Analyse d'un intitulé de poste par l'IA Konekt (`generate-search-filters`) :
 * compétences, expérience, lieu, viviers. De 5 à 15 secondes. Le résultat est
 * rendu à l'appelant, qui le garde : revenir sur la scène ne repaie pas l'analyse.
 */
export function useBriefGeneration(onDraft: (draft: BriefDraft) => void) {
  const { organizationId } = useOrganization();
  const [state, setState] = useState<BriefGenState>({ status: 'idle' });
  const runRef = useRef(0);
  const organizationRef = useRef(organizationId);
  organizationRef.current = organizationId;
  const previousOrganizationRef = useRef(organizationId);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (previousOrganizationRef.current === organizationId) return;
    previousOrganizationRef.current = organizationId;
    runRef.current += 1;
    setState(current => current.status === 'loading' ? { status: 'failed', reason: 'other' } : current);
  }, [organizationId]);

  const generate = useCallback(
    async (req: BriefRequest) => {
      const run = ++runRef.current;
      setState({ status: 'loading' });
      const description = [req.title, req.client ? `Poste chez ${req.client}.` : '', req.context].filter(Boolean).join('\n');
      try {
        const { data, error } = await invokeWithCredits('generate-search-filters', 'brief_analysis', {
          organization_id: organizationId,
          project_id: null,
          job: {
            id: 'draft',
            title: req.title,
            description,
            client: req.client ? { name: req.client, sector: req.sector ?? '' } : null,
            location: null,
            skills: [],
            seniority: null,
          },
          search_source: 'linkedin',
        });
        if (!mountedRef.current || run !== runRef.current || organizationRef.current !== organizationId) return;
        if (error) {
          setState({ status: 'failed', reason: isInsufficientCreditsError(error) ? 'credits' : 'other' });
          return;
        }
        requireGeneratedFilters(data);
        const draft = parseBriefResponse(data, req.title);
        if (!draft) {
          setState({ status: 'failed', reason: 'other' });
          return;
        }
        onDraft(draft);
        setState({ status: 'ready' });
      } catch {
        if (mountedRef.current && run === runRef.current && organizationRef.current === organizationId) setState({ status: 'failed', reason: 'other' });
      }
    },
    [onDraft, organizationId],
  );

  return { state, generate };
}
