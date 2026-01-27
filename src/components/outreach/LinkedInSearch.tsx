import React, { useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from './LinkedInFilters';
import { LinkedInResultCard } from './LinkedInResultCard';
import {
  LinkedInFiltersState,
  LinkedInProfile,
  INITIAL_FILTERS,
  SENIORITY_LEVELS,
  API_TYPE_OPTIONS,
  LinkedInApiType,
} from './types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Search, Loader2, ChevronRight, AlertTriangle, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface LinkedInSearchProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
}

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

  // Check if selected account needs reconnection or has subscription issues
  const selectedAccountData = useMemo(() => 
    accounts.find(a => a.id === selectedAccount),
    [accounts, selectedAccount]
  );
  const needsReconnection = selectedAccountData && selectedAccountData.status !== 'OK';
  
  // Check subscription availability for current API mode
  const subscriptions = selectedAccountData?.subscriptions;
  const isApiModeAvailable = useMemo(() => {
    if (!subscriptions) return true; // Default to available if no subscription info
    switch (filters.api) {
      case 'recruiter': return subscriptions.recruiter;
      case 'sales_navigator': return subscriptions.sales_navigator;
      case 'classic': return subscriptions.classic;
      default: return true;
    }
  }, [subscriptions, filters.api]);

  const handleSearch = useCallback(async (newSearch = true) => {
    if (!selectedAccount) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    setLoading(true);
    try {
      const searchParams: Record<string, unknown> = {
        action: 'search',
        account_id: selectedAccount,
        api: filters.api,
        category: filters.category,
        limit: 25,
      };

      // Keywords
      if (filters.keywords) searchParams.keywords = filters.keywords;

      // Simple ID-array filters (extract IDs from FilterItem[])
      if (filters.location.length) searchParams.location = filters.location.map(f => f.id);
      if (filters.school.length) searchParams.school = filters.school.map(f => f.id);
      
      // Industry - structure with include for Recruiter/Sales Nav
      if (filters.industry.length) {
        searchParams.industry = { include: filters.industry.map(f => f.id) };
      }
      
      // Company - structure with include
      if (filters.company.length) {
        searchParams.company = { include: filters.company.map(f => f.id) };
      }

      // Job title - use current_job_title for Recruiter API with priority
      if (filters.job_title.length) {
        // Recruiter uses current_job_title, edge function handles the mapping
        searchParams.job_title = filters.job_title.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Skills - with priority
      if (filters.skills.length) {
        searchParams.skills = filters.skills.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Role - with keywords, priority, scope
      if (filters.role.length) {
        searchParams.role = filters.role.map(r => ({
          keywords: r.keywords,
          priority: r.priority,
          scope: r.scope,
        }));
      }

      // Simple arrays - Convert seniority from internal values to API values
      if (filters.seniority.length) {
        searchParams.seniority = filters.seniority.map(val => {
          const level = SENIORITY_LEVELS.find(l => l.value === val);
          return level?.apiValue || val;
        });
      }
      if (filters.network_distance.length) searchParams.network_distance = filters.network_distance;
      if (filters.profile_language.length) searchParams.profile_language = filters.profile_language;

      // Years of experience
      if (filters.years_of_experience_min !== null || filters.years_of_experience_max !== null) {
        const yearsExp: Record<string, number> = {};
        if (filters.years_of_experience_min !== null) yearsExp.min = filters.years_of_experience_min;
        if (filters.years_of_experience_max !== null) yearsExp.max = filters.years_of_experience_max;
        searchParams.years_of_experience = yearsExp;
      }

      // Tenure filters
      if (filters.tenure_at_company_min !== null || filters.tenure_at_company_max !== null) {
        const tenure: Record<string, number> = {};
        if (filters.tenure_at_company_min !== null) tenure.min = filters.tenure_at_company_min;
        if (filters.tenure_at_company_max !== null) tenure.max = filters.tenure_at_company_max;
        searchParams.tenure = [tenure];
      }

      // Boolean filters
      if (filters.open_to_work === true) searchParams.open_to_work = true;
      if (filters.open_to.length) searchParams.open_to = filters.open_to;

      // Recruiter specific
      if (filters.hiring_project) searchParams.hiring_project = filters.hiring_project;
      if (filters.talent_pool) searchParams.talent_pool = filters.talent_pool;
      if (filters.spotlight) searchParams.spotlight = filters.spotlight;

      // Company filters (Sales Navigator)
      if (filters.company_headcount.length) searchParams.company_headcount = filters.company_headcount;
      if (filters.company_type.length) searchParams.company_type = filters.company_type;

      // Past filters
      if (filters.past_company.length) {
        searchParams.past_company = { include: filters.past_company.map(f => f.id) };
      }
      if (filters.past_job_title.length) {
        searchParams.past_job_title = filters.past_job_title.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Pagination
      if (!newSearch && cursor) {
        searchParams.cursor = cursor;
      }

      console.log('Search params:', searchParams);

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
        {/* Reconnection alert */}
        {needsReconnection && (
          <Alert variant="destructive" className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800">Reconnexion requise</AlertTitle>
            <AlertDescription className="text-amber-700">
              Le compte <strong>{selectedAccountData?.name || selectedAccountData?.identifier}</strong> est déconnecté. 
              Rendez-vous dans l'onglet <strong>Comptes</strong> pour le reconnecter.
            </AlertDescription>
          </Alert>
        )}

        {/* Account selector */}
        <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
              Compte LinkedIn
            </label>
            <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un compte" />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id} className="py-2">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{account.name || account.identifier}</span>
                      <div className="flex gap-1 flex-wrap">
                        {account.subscriptions?.classic && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            Classic
                          </span>
                        )}
                        {account.subscriptions?.recruiter && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0077B5]/10 text-[#0077B5] font-medium">
                            Recruiter
                          </span>
                        )}
                        {account.subscriptions?.sales_navigator && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                            Sales Nav
                          </span>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Show selected account licenses */}
            {selectedAccountData?.subscriptions && (
              <div className="flex gap-1 mt-2">
                {selectedAccountData.subscriptions.classic && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    Classic
                  </span>
                )}
                {selectedAccountData.subscriptions.recruiter && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0077B5]/10 text-[#0077B5] font-medium">
                    Recruiter
                  </span>
                )}
                {selectedAccountData.subscriptions.sales_navigator && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                    Sales Nav
                  </span>
                )}
              </div>
            )}
          </div>

          {/* API Type selector */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
              Mode de recherche
            </label>
            <TooltipProvider>
              <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-lg">
                {API_TYPE_OPTIONS.map((option) => {
                  const isAvailable = !subscriptions || 
                    (option.value === 'classic' && subscriptions.classic) ||
                    (option.value === 'recruiter' && subscriptions.recruiter) ||
                    (option.value === 'sales_navigator' && subscriptions.sales_navigator);
                  
                  const button = (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => isAvailable && setFilters(f => ({ ...f, api: option.value as LinkedInApiType }))}
                      disabled={!isAvailable}
                      className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all relative ${
                        !isAvailable 
                          ? 'text-[#1A1A1A]/30 cursor-not-allowed'
                          : filters.api === option.value
                            ? 'bg-white text-[#0077B5] shadow-sm'
                            : 'text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-white/50'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        {!isAvailable && <Lock className="w-3 h-3" />}
                        {option.label}
                      </span>
                    </button>
                  );
                  
                  if (!isAvailable) {
                    return (
                      <Tooltip key={option.value}>
                        <TooltipTrigger asChild>
                          {button}
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[200px]">
                          <p className="text-xs">
                            Votre compte LinkedIn n'a pas de licence {option.label}. 
                            Connectez un compte avec cette licence pour utiliser ce mode.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  
                  return button;
                })}
              </div>
            </TooltipProvider>
            <p className="text-[10px] text-[#1A1A1A]/50 mt-1.5">
              {filters.api === 'recruiter' && 'Accès aux filtres avancés de recrutement'}
              {filters.api === 'sales_navigator' && 'Filtres orientés vente et prospection'}
              {filters.api === 'classic' && 'Recherche LinkedIn standard'}
            </p>
          </div>

          {/* License warning */}
          {!isApiModeAvailable && (
            <Alert variant="destructive" className="bg-red-50 border-red-200">
              <Lock className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-800">Licence non disponible</AlertTitle>
              <AlertDescription className="text-red-700">
                Votre compte LinkedIn n'a pas de licence {filters.api === 'recruiter' ? 'Recruiter' : 'Sales Navigator'}. 
                Sélectionnez le mode <strong>LinkedIn Classic</strong> ou connectez un compte avec la licence appropriée.
              </AlertDescription>
            </Alert>
          )}
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
            disabled={loading || !selectedAccount || needsReconnection || !isApiModeAvailable}
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
              {results.map((profile, index) => (
                <LinkedInResultCard key={profile.id || `profile-${index}`} profile={profile} />
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

// Re-export types for backward compatibility
export type { LinkedInFiltersState, LinkedInProfile } from './types';
