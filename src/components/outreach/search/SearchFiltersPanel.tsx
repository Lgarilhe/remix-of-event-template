import React from 'react';
import { LinkedInFiltersState, LinkedInApiType, API_TYPE_OPTIONS } from '@/components/outreach/types';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from '@/components/outreach/LinkedInFilters';
import { JobSelector, GeneratedFilters } from '@/components/outreach/JobSelector';
import { FilterAssistantModal } from '@/components/outreach/FilterAssistantModal';
import { FilterWizard } from '@/components/outreach/filter-wizard';
import { FilterPresetsManager } from '@/components/outreach/FilterPresetsManager';
import { AutoFillFiltersButton } from '@/components/outreach/AutoFillFiltersButton';
import { QuotaDisplay } from '@/components/outreach/QuotaDisplay';
import { Job } from '@/pages/JobSpace';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Search, Loader2, AlertTriangle, Lock, Sparkles } from 'lucide-react';

interface SearchFiltersPanelProps {
  // Account
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
  
  // Filters
  filters: LinkedInFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<LinkedInFiltersState>>;
  
  // Job
  selectedJob: Job | null;
  onJobChange: (job: Job | null) => void;
  onAutoFillFilters: (filters: GeneratedFilters) => void;
  
  // State
  loading: boolean;
  needsReconnection: boolean;
  isApiModeAvailable: boolean;
  subscriptions?: { recruiter?: boolean; sales_navigator?: boolean };
  
  // Quota
  quota: {
    quotas: {
      searchResultsFetched: number;
      profileVisits: number;
      messagesSent: number;
      invitationsSent: number;
      inmailsSent: number;
    };
    apiMode: LinkedInApiType;
  };
  
  // Actions
  onSearch: () => void;
  onClearFilters: () => void;
  
  // Wizard
  showFilterWizard: boolean;
  setShowFilterWizard: (v: boolean) => void;
}

export const SearchFiltersPanel: React.FC<SearchFiltersPanelProps> = ({
  accounts,
  selectedAccount,
  onAccountChange,
  filters,
  setFilters,
  selectedJob,
  onJobChange,
  onAutoFillFilters,
  loading,
  needsReconnection,
  isApiModeAvailable,
  subscriptions,
  quota,
  onSearch,
  onClearFilters,
  showFilterWizard,
  setShowFilterWizard,
}) => {
  const selectedAccountData = accounts.find(a => a.id === selectedAccount);
  const hasPremiumLicense = subscriptions?.recruiter || subscriptions?.sales_navigator;

  return (
    <div className="space-y-4 sticky top-24">
      {/* Reconnection alert */}
      {needsReconnection && (
        <Alert variant="destructive" className="bg-amber-50 border-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Reconnexion requise</AlertTitle>
          <AlertDescription className="text-amber-700">
            Le compte <strong>{selectedAccountData?.name || selectedAccountData?.identifier}</strong> est déconnecté.
          </AlertDescription>
        </Alert>
      )}

      {/* Account selector */}
      <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[#1A1A1A]/70">Compte</label>
          <QuotaDisplay
            searchResultsFetched={quota.quotas.searchResultsFetched}
            profileVisits={quota.quotas.profileVisits}
            messagesSent={quota.quotas.messagesSent}
            invitationsSent={quota.quotas.invitationsSent}
            inmailsSent={quota.quotas.inmailsSent}
            apiMode={quota.apiMode}
            compact={true}
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
            <SelectTrigger className="h-8 text-sm flex-1">
              <SelectValue placeholder="Sélectionner" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <div className="flex items-center gap-2">
                    <span>{account.name || account.identifier}</span>
                    <div className="flex gap-1">
                      {account.subscriptions?.recruiter && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0077B5]/10 text-[#0077B5] font-medium">R</span>
                      )}
                      {account.subscriptions?.sales_navigator && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">SN</span>
                      )}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Mode selector */}
          <TooltipProvider>
            <div className="flex gap-0.5 p-0.5 bg-gray-100 rounded-md shrink-0">
              {API_TYPE_OPTIONS.map((option) => {
                let isAvailable: boolean;
                if (option.value === 'classic') {
                  isAvailable = !hasPremiumLicense;
                } else if (option.value === 'recruiter') {
                  isAvailable = !!subscriptions?.recruiter;
                } else if (option.value === 'sales_navigator') {
                  isAvailable = !!subscriptions?.sales_navigator;
                } else {
                  isAvailable = true;
                }

                const shortLabel = option.value === 'recruiter' ? 'R' : option.value === 'sales_navigator' ? 'SN' : 'C';

                const button = (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => isAvailable && setFilters(f => ({ ...f, api: option.value as LinkedInApiType }))}
                    disabled={!isAvailable}
                    className={`w-7 h-7 text-[10px] font-medium rounded transition-all ${
                      !isAvailable
                        ? 'text-[#1A1A1A]/20 cursor-not-allowed'
                        : filters.api === option.value
                          ? 'bg-white text-[#0077B5] shadow-sm'
                          : 'text-[#1A1A1A]/50 hover:text-[#1A1A1A] hover:bg-white/50'
                    }`}
                  >
                    {!isAvailable ? <Lock className="w-2.5 h-2.5 mx-auto" /> : shortLabel}
                  </button>
                );

                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">
                        {!isAvailable
                          ? option.value === 'classic' && hasPremiumLicense
                            ? 'Désactivé (licence premium active)'
                            : `Licence ${option.label} requise`
                          : option.label}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>

        {/* License warning */}
        {!isApiModeAvailable && (
          <Alert variant="destructive" className="bg-red-50 border-red-200">
            <Lock className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-800">Licence non disponible</AlertTitle>
            <AlertDescription className="text-red-700">
              Votre compte n'a pas de licence {filters.api === 'recruiter' ? 'Recruiter' : 'Sales Navigator'}.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Job Selector */}
      <div className="space-y-3">
        <JobSelector
          selectedJob={selectedJob}
          onJobChange={onJobChange}
          onAutoFillFilters={onAutoFillFilters}
        />

        {/* Filter actions */}
        <div className="flex flex-wrap items-center gap-2">
          <AutoFillFiltersButton
            selectedJob={selectedJob}
            accountId={selectedAccount}
            currentLocation={filters.location}
            onApplyFilters={(update) => setFilters(prev => ({ ...prev, ...update }))}
          />

          {selectedJob ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilterWizard(true)}
              className="gap-2 bg-gradient-to-r from-green-50 to-emerald-50 border-green-300 hover:border-green-400 text-green-700"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Assistant IA</span>
            </Button>
          ) : (
            <FilterAssistantModal
              currentFilters={filters}
              onApplyFilters={(update) => setFilters(prev => ({ ...prev, ...update }))}
              accountId={selectedAccount || undefined}
              selectedJob={selectedJob}
            />
          )}

          <FilterPresetsManager
            currentFilters={filters}
            onApplyFilters={setFilters}
            selectedJob={selectedJob}
          />
        </div>

        {/* Filter Wizard Modal */}
        {selectedJob && (
          <FilterWizard
            open={showFilterWizard}
            onOpenChange={setShowFilterWizard}
            job={selectedJob}
            accountId={selectedAccount || undefined}
            onApplyFilters={(update) => setFilters(prev => ({ ...prev, ...update }))}
          />
        )}
      </div>

      {/* Keywords input */}
      <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4">
        <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
          Mots-clés
        </label>
        <Textarea
          value={filters.keywords}
          onChange={(e) => setFilters(f => ({ ...f, keywords: e.target.value }))}
          placeholder="Ex: Product Manager, React..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && selectedJob) {
              e.preventDefault();
              onSearch();
            }
          }}
          className="min-h-[40px] max-h-[200px] resize-y text-sm"
          rows={1}
        />
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
          onClick={onSearch}
          disabled={loading || !selectedAccount || !selectedJob || needsReconnection || !isApiModeAvailable}
          className="flex-1 bg-[#0077B5] hover:bg-[#005E93]"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          {!selectedJob ? 'Sélectionnez un poste' : loading ? 'Recherche...' : 'Rechercher'}
        </Button>
        <Button
          variant="outline"
          onClick={onClearFilters}
          disabled={loading}
        >
          Effacer
        </Button>
      </div>
    </div>
  );
};
