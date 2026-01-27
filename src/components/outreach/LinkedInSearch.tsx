import React, { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from './LinkedInFilters';
import { LinkedInResultCard } from './LinkedInResultCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

export interface LinkedInFiltersState {
  keywords: string;
  location: string[];
  company: string[];
  industry: string[];
  job_title: string[];
  school: string[];
  seniority: string[];
  skills: string[];
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  open_to_work: boolean | null;
  hiring_project: string;
  talent_pool: string;
  spotlight: string;
}

export interface LinkedInProfile {
  id: string;
  provider_id: string;
  first_name: string;
  last_name: string;
  headline: string;
  profile_url: string;
  profile_picture_url: string;
  location: string;
  current_company: string;
  current_position: string;
  connection_level: number;
  open_to_work: boolean;
}

interface LinkedInSearchProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
}

const INITIAL_FILTERS: LinkedInFiltersState = {
  keywords: '',
  location: [],
  company: [],
  industry: [],
  job_title: [],
  school: [],
  seniority: [],
  skills: [],
  years_of_experience_min: null,
  years_of_experience_max: null,
  open_to_work: null,
  hiring_project: '',
  talent_pool: '',
  spotlight: '',
};

export const LinkedInSearch: React.FC<LinkedInSearchProps> = ({
  accounts,
  selectedAccount,
  onAccountChange,
}) => {
  const [filters, setFilters] = useState<LinkedInFiltersState>(INITIAL_FILTERS);
  const [results, setResults] = useState<LinkedInProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async (newSearch = true) => {
    if (!selectedAccount) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    setLoading(true);
    try {
      const searchParams: any = {
        action: 'search',
        account_id: selectedAccount,
        service: 'RECRUITER',
        limit: 25,
      };

      // Add filters
      if (filters.keywords) searchParams.keywords = filters.keywords;
      if (filters.location.length) searchParams.location = filters.location;
      if (filters.company.length) searchParams.company = filters.company;
      if (filters.industry.length) searchParams.industry = filters.industry;
      if (filters.job_title.length) searchParams.job_title = filters.job_title;
      if (filters.school.length) searchParams.school = filters.school;
      if (filters.seniority.length) searchParams.seniority = filters.seniority;
      if (filters.skills.length) searchParams.skills = filters.skills;
      if (filters.years_of_experience_min) searchParams.years_of_experience_min = filters.years_of_experience_min;
      if (filters.years_of_experience_max) searchParams.years_of_experience_max = filters.years_of_experience_max;
      if (filters.open_to_work !== null) searchParams.open_to_work = filters.open_to_work;
      if (filters.hiring_project) searchParams.hiring_project = filters.hiring_project;
      if (filters.talent_pool) searchParams.talent_pool = filters.talent_pool;
      if (filters.spotlight) searchParams.spotlight = filters.spotlight;

      // Pagination
      if (!newSearch && cursor) {
        searchParams.cursor = cursor;
      }

      const response = await supabase.functions.invoke('unipile-search', {
        body: searchParams,
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      const newResults = response.data.results || [];
      
      if (newSearch) {
        setResults(newResults);
      } else {
        setResults(prev => [...prev, ...newResults]);
      }
      
      setCursor(response.data.cursor || null);
      setTotal(response.data.total || null);
      setHasSearched(true);

      if (newResults.length === 0 && newSearch) {
        toast.info('Aucun résultat trouvé');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de recherche');
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, filters, cursor]);

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setResults([]);
    setHasSearched(false);
    setCursor(null);
    setTotal(null);
  };

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-6">
      {/* Filters sidebar */}
      <div className="space-y-4">
        {/* Account selector */}
        <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4">
          <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
            Compte LinkedIn
          </label>
          <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un compte" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name || account.identifier}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search input */}
        <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4">
          <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
            Mots-clés
          </label>
          <div className="flex gap-2">
            <Input
              value={filters.keywords}
              onChange={(e) => setFilters(f => ({ ...f, keywords: e.target.value }))}
              placeholder="Ex: Product Manager, React..."
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
        </div>

        {/* Filters */}
        <LinkedInFilters
          filters={filters}
          onChange={setFilters}
          accountId={selectedAccount}
        />

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => handleSearch()}
            disabled={loading || !selectedAccount}
            className="flex-1 bg-[#0077B5] hover:bg-[#005E93]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Rechercher
          </Button>
          <Button
            variant="outline"
            onClick={handleClearFilters}
            disabled={loading}
          >
            Effacer
          </Button>
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-lg border border-[#1A1A1A]/10 min-h-[600px]">
        {/* Results header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A1A1A]/10">
          <div className="text-sm text-[#1A1A1A]/60">
            {hasSearched ? (
              total !== null ? (
                <span>{total.toLocaleString()} résultat{total > 1 ? 's' : ''}</span>
              ) : (
                <span>{results.length} résultat{results.length > 1 ? 's' : ''}</span>
              )
            ) : (
              <span>Lancez une recherche</span>
            )}
          </div>
        </div>

        {/* Results list */}
        <ScrollArea className="h-[calc(100vh-300px)]">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#0077B5]" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#1A1A1A]/40">
              <Search className="w-12 h-12 mb-4" />
              <p>
                {hasSearched
                  ? 'Aucun résultat pour ces critères'
                  : 'Configurez vos filtres et lancez une recherche'}
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {results.map((profile) => (
                <LinkedInResultCard key={profile.id || profile.provider_id} profile={profile} />
              ))}
              
              {/* Load more */}
              {cursor && (
                <div className="pt-4 text-center">
                  <Button
                    variant="outline"
                    onClick={() => handleSearch(false)}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2" />
                    )}
                    Charger plus
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};
