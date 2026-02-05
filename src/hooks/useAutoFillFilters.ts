import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState, LinkedInApiType } from '@/components/outreach/types';
import { GeneratedFilters } from '@/components/outreach/JobSelector';
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

  const handleAutoFillFilters = useCallback((generatedFilters: GeneratedFilters) => {
    setFilters(prev => ({
      ...prev,
      // Keywords
      keywords: generatedFilters.keywords || prev.keywords,
      // Role filters (for Recruiter mode)
      role: generatedFilters.role?.length > 0 ? generatedFilters.role.map(r => ({
        keywords: r.keywords,
        priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
        scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
      })) : prev.role,
      // Seniority
      seniority: generatedFilters.seniority?.length > 0 ? generatedFilters.seniority : prev.seniority,
      // Years of experience
      calculated_experience_min: generatedFilters.years_of_experience_min ?? prev.calculated_experience_min,
      calculated_experience_max: generatedFilters.years_of_experience_max ?? prev.calculated_experience_max,
      years_of_experience_min: null,
      years_of_experience_max: null,
      // Company keywords exclusions
      company_keywords: generatedFilters.company_keywords?.length > 0
        ? generatedFilters.company_keywords.map(c => ({
            keywords: c.keywords,
            priority: c.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
            scope: c.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT',
          }))
        : prev.company_keywords,
      // School filters
      school: generatedFilters.school?.length > 0
        ? generatedFilters.school.map(s => ({
            id: s.id,
            name: s.name,
            priority: s.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
          }))
        : prev.school,
      // Location radius
      location_within_area: generatedFilters.location_within_area ?? prev.location_within_area,
      // Spotlight
      spotlight: (generatedFilters.spotlight || prev.spotlight) as typeof prev.spotlight,
      // Open to work flag
      open_to_work: generatedFilters.open_to_work ?? prev.open_to_work,
    }));

    // Resolve location keywords → location IDs
    const locationKeyword = generatedFilters.location_keywords?.[0]?.trim();
    if (locationKeyword && selectedAccount) {
      void (async () => {
        try {
          if (filtersRef.current.location.length > 0) return;

          const { data, error } = await supabase.functions.invoke('unipile-search', {
            body: {
              action: 'get_parameters',
              account_id: selectedAccount,
              type: 'LOCATION',
              keywords: locationKeyword,
              service: 'RECRUITER',
            },
          });

          if (error) throw error;
          if (!data?.success || !Array.isArray(data?.items) || data.items.length === 0) {
            console.warn('[AutoFill] Location could not be resolved:', locationKeyword);
            return;
          }

          const normalized = locationKeyword.toLowerCase();
          const best =
            data.items.find((it: any) => String(it.title || '').toLowerCase() === normalized) ||
            data.items.find((it: any) => String(it.title || '').toLowerCase().includes(normalized)) ||
            data.items[0];

          if (!best?.id || !best?.title) return;

          setFilters((curr) => ({
            ...curr,
            location: curr.location.length
              ? curr.location
              : [
                  {
                    id: String(best.id),
                    name: String(best.title),
                    priority: 'MUST_HAVE',
                    scope: 'CURRENT_OR_OPEN_TO_RELOCATE',
                  },
                ],
          }));

          console.log('[AutoFill] Resolved location:', { keyword: locationKeyword, id: best.id, title: best.title });
        } catch (e) {
          console.error('[AutoFill] Failed to resolve location:', e);
        }
      })();
    }

    console.log('[AutoFill] Applied filters:', {
      keywords: generatedFilters.keywords,
      roles: generatedFilters.role?.length,
      seniority: generatedFilters.seniority,
      calculatedXp: `${generatedFilters.years_of_experience_min}-${generatedFilters.years_of_experience_max}`,
      companyExclusions: generatedFilters.company_keywords?.length,
      schools: generatedFilters.school?.length,
      locationKeywords: generatedFilters.location_keywords,
      locationRadius: generatedFilters.location_within_area,
      spotlight: generatedFilters.spotlight,
      openToWork: generatedFilters.open_to_work,
    });
  }, [selectedAccount, filtersRef, setFilters]);

  return { handleAutoFillFilters };
}
