import { useCallback, useRef, useState } from 'react';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { parseBriefResponse, type BriefDraft } from '@/lib/onboarding/brief';

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
  const [state, setState] = useState<BriefGenState>({ status: 'idle' });
  const runRef = useRef(0);

  const generate = useCallback(
    async (req: BriefRequest) => {
      const run = ++runRef.current;
      setState({ status: 'loading' });
      const description = [req.title, req.client ? `Poste chez ${req.client}.` : '', req.context].filter(Boolean).join('\n');
      try {
        const { data, error } = await invokeWithCredits('generate-search-filters', 'filter_generation', {
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
        if (run !== runRef.current) return;
        if (error) {
          setState({ status: 'failed', reason: isInsufficientCreditsError(error) ? 'credits' : 'other' });
          return;
        }
        const draft = parseBriefResponse(data, req.title);
        if (!draft) {
          setState({ status: 'failed', reason: 'other' });
          return;
        }
        onDraft(draft);
        setState({ status: 'ready' });
      } catch {
        if (run === runRef.current) setState({ status: 'failed', reason: 'other' });
      }
    },
    [onDraft],
  );

  return { state, generate };
}
