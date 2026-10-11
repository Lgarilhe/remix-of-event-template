import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AutoFillFiltersButton } from '@/components/outreach/AutoFillFiltersButton';
import { LinkedInFilters } from '@/components/outreach/LinkedInFilters';
import { SearchPromptBar } from '@/components/outreach/search/SearchPromptBar';
import { INITIAL_FILTERS, type LinkedInFiltersState, type LinkedInApiType } from '@/components/outreach/types';
import { buildSearchParams } from '@/hooks/useLinkedInSearchActions';
import { invokeUnipile } from '@/lib/invokeUnipile';

type FixtureWindow = Window & {
  qaFilters: LinkedInFiltersState;
  qaEditFilters: (patch: Partial<LinkedInFiltersState>) => void;
};
const w = window as FixtureWindow;
const job = { id: 'job-fixture', title: 'Data engineer', description: 'Ingénieur data confirmé.' };

/** Real generation controls, editor and request builder. Identity and transport
 * come from the existing inbox-loading mocks; no production route is added. */
export function SourcingFiltersFixture() {
  const [filters, setFilters] = useState<LinkedInFiltersState>(() => {
    const api = new URLSearchParams(location.search).get('api') as LinkedInApiType || 'classic';
    return {
      ...INITIAL_FILTERS, api, keywords: 'Java',
      location: [{ id: '105015875', name: 'Paris', priority: 'MUST_HAVE', scope: 'CURRENT' }],
      role: [{ keywords: 'Consultant', priority: 'DOESNT_HAVE', scope: api === 'classic' ? 'CURRENT_OR_PAST' : 'CURRENT' }],
    };
  });
  useEffect(() => {
    w.qaFilters = filters;
    w.qaEditFilters = patch => setFilters(previous => ({ ...previous, ...patch }));
  }, [filters]);
  const apply = (update: Partial<LinkedInFiltersState>) => setFilters(previous => ({ ...previous, ...update }));
  const search = async () => {
    try {
      await invokeUnipile({ body: buildSearchParams(filters, 'account') });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Recherche impossible');
    }
  };
  const generationProps = {
    selectedJob: job, accountId: 'account', api: filters.api,
    currentLocation: filters.location, currentRoles: filters.role, currentKeywords: filters.keywords,
    filtersKey: JSON.stringify(filters), onApplyFilters: apply,
  };
  return <TooltipProvider><Toaster /><main className="mx-auto max-w-3xl space-y-4 p-4">
    <h1 className="text-xl">Filtres de sourcing</h1>
    <SearchPromptBar {...generationProps} searchSource="linkedin" />
    <AutoFillFiltersButton {...generationProps} />
    <LinkedInFilters filters={filters} onChange={setFilters} accountId="account" />
    <button type="button" onClick={search} className="min-h-11 rounded border px-4">Rechercher</button>
  </main></TooltipProvider>;
}

createRoot(document.getElementById('root')!).render(<SourcingFiltersFixture />);
