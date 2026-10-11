import { useCallback, useEffect, useRef } from 'react';
import type { LinkedInFiltersState } from '@/components/outreach/types';
import { mapGeneratedFilters, type GeneratedFilters } from '@/components/outreach/search/generateFiltersFromJob';
import { toast } from 'sonner';

interface AutoFillOptions {
  selectedAccount: string | null;
  filtersRef: React.MutableRefObject<LinkedInFiltersState>;
  setFilters: React.Dispatch<React.SetStateAction<LinkedInFiltersState>>;
}

export function useAutoFillFilters({
  selectedAccount,
  filtersRef,
  setFilters,
}: AutoFillOptions) {
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const contextKey = JSON.stringify([selectedAccount, filtersRef.current]);
  const contextRef = useRef(contextKey);
  // Publish the rendered account/filter context immediately, before effects:
  // a late location resolution must not apply to another search.
  contextRef.current = contextKey;

  useEffect(() => {
    const generation = generationRef;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generation.current++;
    };
  }, [contextKey]);

  const handleAutoFillFilters = useCallback(async (generatedFilters: GeneratedFilters) => {
    if (!mountedRef.current || contextRef.current !== contextKey) return;
    const generation = ++generationRef.current;
    const snapshot = filtersRef.current;
    const isCurrent = () => mountedRef.current
      && generationRef.current === generation
      && contextRef.current === contextKey
      && JSON.stringify([selectedAccount, filtersRef.current]) === contextKey;

    try {
      const { update } = await mapGeneratedFilters(generatedFilters, {
        accountId: selectedAccount,
        api: snapshot.api,
        currentLocation: snapshot.location,
        currentRoles: snapshot.role,
        currentKeywords: snapshot.keywords,
      });
      // Retain this legacy entry point's explicit school priorities and any
      // calculated bound omitted by a partial generation.
      if (update.school) {
        update.school = update.school.map((school, index) => ({
          ...school,
          priority: generatedFilters.school[index].priority as LinkedInFiltersState['school'][number]['priority'],
        }));
      }
      if (typeof generatedFilters.years_of_experience_min !== 'number') delete update.calculated_experience_min;
      if (typeof generatedFilters.years_of_experience_max !== 'number') delete update.calculated_experience_max;
      if (!isCurrent()) return;
      setFilters(previous => isCurrent() && JSON.stringify([selectedAccount, previous]) === contextKey
        ? { ...previous, ...update }
        : previous);
    } catch (error) {
      if (!isCurrent()) return;
      toast.error(error instanceof Error
        ? error.message
        : 'Les filtres n’ont pas pu être appliqués. Réessayez dans quelques instants.');
    }
  }, [selectedAccount, filtersRef, setFilters, contextKey]);

  return { handleAutoFillFilters };
}
