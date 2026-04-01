import React, { useState, useCallback } from 'react';
import { Target } from '@phosphor-icons/react';
import { LinkedInFiltersState, LinkedInApiType, API_TYPE_OPTIONS } from '@/components/outreach/types';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from '@/components/outreach/LinkedInFilters';
import { JobSelector, GeneratedFilters, useJobs } from '@/components/outreach/JobSelector';
import { SourcingProject } from '@/hooks/useSourcingProjects';

import { FilterPresetsManager } from '@/components/outreach/FilterPresetsManager';
import { AutoFillFiltersButton } from '@/components/outreach/AutoFillFiltersButton';
import { QuotaDisplay } from '@/components/outreach/QuotaDisplay';
import { SearchHistory } from './SearchHistory';
import { SearchHistoryEntry } from '@/hooks/useSearchHistory';
import { Job } from '@/types/jobs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Search, Loader2, AlertTriangle, Lock, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  
  // Mission context
  activeProject?: SourcingProject | null;

  // Search source
  searchSource?: 'linkedin' | 'database';
  onSearchSourceChange?: (source: 'linkedin' | 'database') => void;
  
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
  
  // History
  searchHistory?: SearchHistoryEntry[];
  searchHistoryLoading?: boolean;
  onApplyHistoryFilters?: (filters: LinkedInFiltersState) => void;
  onDeleteHistoryEntry?: (id: string) => void;
  
  // Scoring instructions
  scoringInstructions?: string;
  onScoringInstructionsChange?: (value: string) => void;
  onOpenFilterWizard?: () => void;
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
  activeProject,
  searchSource,
  onSearchSourceChange,
  quota,
  onSearch,
  onClearFilters,
  searchHistory = [],
  searchHistoryLoading = false,
  onApplyHistoryFilters,
  onDeleteHistoryEntry,
  scoringInstructions = '',
  onScoringInstructionsChange,
  onOpenFilterWizard,
}) => {
  const [keywordsDialogOpen, setKeywordsDialogOpen] = useState(false);
  const [keywordsDraft, setKeywordsDraft] = useState('');
  const { data: allJobs = [] } = useJobs();

  const handleApplyPresetJob = useCallback((jobId: string | null, _jobTitle: string | null) => {
    if (jobId) {
      const foundJob = allJobs.find(j => j.id === jobId);
      if (foundJob) {
        onJobChange(foundJob);
      }
    }
  }, [allJobs, onJobChange]);

  const selectedAccountData = accounts.find(a => a.id === selectedAccount);
  const hasPremiumLicense = subscriptions?.recruiter || subscriptions?.sales_navigator;

  return (
    <div className="space-y-4 lg:sticky lg:top-24">
      {/* Reconnection alert */}
      {needsReconnection && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/30">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle className="text-destructive">Reconnexion requise</AlertTitle>
          <AlertDescription className="text-destructive/80">
            Le compte <strong>{selectedAccountData?.name || selectedAccountData?.identifier}</strong> est déconnecté.
          </AlertDescription>
        </Alert>
      )}

      {/* Source Toggle: Apollo (Base Konekt) vs LinkedIn */}
      {onSearchSourceChange && (
        <div className="bg-background border border-foreground p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                🔍 Source
              </span>
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border",
                searchSource === 'database'
                  ? "border-emerald-500/30 text-emerald-600 bg-emerald-50"
                  : "border-blue-500/30 text-blue-600 bg-blue-50"
              )}>
                {searchSource === 'database' ? '🟢 Base Konekt · 232M+' : '🔵 LinkedIn'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("text-[10px] font-bold uppercase tracking-wider transition-colors", searchSource === 'database' ? 'text-foreground' : 'text-muted-foreground/50')}>
                Apollo
              </span>
              <Switch
                checked={searchSource === 'linkedin'}
                onCheckedChange={(checked) => onSearchSourceChange(checked ? 'linkedin' : 'database')}
                className="data-[state=checked]:bg-blue-500"
              />
              <span className={cn("text-[10px] font-bold uppercase tracking-wider transition-colors", searchSource === 'linkedin' ? 'text-foreground' : 'text-muted-foreground/50')}>
                LinkedIn
              </span>
            </div>
          </div>
          {searchSource === 'linkedin' && accounts.length === 0 && (
            <p className="text-[10px] text-destructive mt-1.5">
              ⚠️ Aucun compte LinkedIn connecté. Connectez-en un dans Paramètres.
            </p>
          )}
        </div>
      )}

      {/* Account selector — only visible in LinkedIn mode */}
      {searchSource !== 'database' && (
      <div className="bg-background border border-foreground p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Compte</label>
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
              <SelectValue placeholder="Sélectionner">
                {selectedAccountData && (
                  <div className="flex items-center gap-2">
                    {selectedAccountData.profile_picture_url && (
                      <img 
                        src={selectedAccountData.profile_picture_url} 
                        alt="" 
                        className="w-5 h-5 rounded-none object-cover shrink-0"
                      />
                    )}
                    <span>{selectedAccountData.name || selectedAccountData.identifier}</span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-background">
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <div className="flex items-center gap-2">
                    {account.profile_picture_url && (
                      <img 
                        src={account.profile_picture_url} 
                        alt="" 
                        className="w-5 h-5 rounded-none object-cover"
                      />
                    )}
                    <span>{account.name || account.identifier}</span>
                    <div className="flex gap-1">
                      {account.subscriptions?.recruiter && (
                        <span className="text-xs px-1.5 py-0.5 bg-foreground/10 text-foreground font-medium">R</span>
                      )}
                      {account.subscriptions?.sales_navigator && (
                        <span className="text-xs px-1.5 py-0.5 bg-foreground/10 text-foreground font-medium">SN</span>
                      )}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Mode selector */}
          <TooltipProvider>
            <div className="flex gap-0.5 p-0.5 bg-muted shrink-0">
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
                    className={`w-7 h-7 text-xs font-medium transition-all ${
                      !isAvailable
                        ? 'text-foreground/20 cursor-not-allowed'
                        : filters.api === option.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-foreground/50 hover:text-foreground hover:bg-background/50'
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
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/30">
            <Lock className="h-4 w-4 text-destructive" />
            <AlertTitle className="text-destructive">Licence non disponible</AlertTitle>
            <AlertDescription className="text-destructive/80">
              Votre compte n'a pas de licence {filters.api === 'recruiter' ? 'Recruiter' : 'Sales Navigator'}.
            </AlertDescription>
          </Alert>
        )}
      </div>
      )}

      {/* Job Selector — hidden when in mission context (job auto-selected) */}
      {!activeProject && (
        <div className="space-y-3">
          <JobSelector
            selectedJob={selectedJob}
            onJobChange={onJobChange}
            onAutoFillFilters={onAutoFillFilters}
          />
        </div>
      )}

      {/* Mission context: show selected job info */}
      {activeProject && selectedJob && (
        <div className="bg-background border border-foreground p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">🎯</span>
            <span className="text-xs font-bold text-foreground uppercase tracking-widest">Poste actif</span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{selectedJob.title}</p>
          {(selectedJob as any).client?.name && (
            <p className="text-xs text-muted-foreground truncate">@ {(selectedJob as any).client.name}</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {/* Filter actions */}
        <div className="flex flex-wrap items-center gap-2">
          {onOpenFilterWizard && (
            <button
              onClick={onOpenFilterWizard}
              className="flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-black uppercase tracking-wider border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              <Target className="w-3 h-3" weight="bold" />
              Wizard filtres
            </button>
          )}
          <AutoFillFiltersButton
            selectedJob={selectedJob}
            accountId={selectedAccount}
            currentLocation={filters.location}
            onApplyFilters={(update) => setFilters(prev => ({ ...prev, ...update }))}
            searchSource={filters.api === 'database' ? 'database' : 'linkedin'}
          />

          <FilterPresetsManager
            currentFilters={filters}
            onApplyFilters={setFilters}
            selectedJob={selectedJob}
            onApplyPresetJob={handleApplyPresetJob}
          />
        </div>

        {/* Custom scoring instructions (visible when job selected) */}
        {selectedJob && onScoringInstructionsChange && (
          <div className="bg-background border border-foreground p-3">
            <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-widest">
              Consignes scoring IA <span className="font-normal text-muted-foreground/60">(optionnel)</span>
            </label>
            <textarea
              value={scoringInstructions}
              onChange={(e) => onScoringInstructionsChange(e.target.value)}
              placeholder="Ex: Privilégier les profils avec exp. cloud souverain, ignorer le critère localisation, bonus si exp. scale-up..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-foreground/30 bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground resize-none"
            />
          </div>
        )}
      </div>

      {/* Search History */}
      {selectedJob && onApplyHistoryFilters && onDeleteHistoryEntry && (
        <SearchHistory
          history={searchHistory}
          isLoading={searchHistoryLoading}
          onApplyFilters={onApplyHistoryFilters}
          onDelete={onDeleteHistoryEntry}
        />
      )}

      {/* Keywords preview + edit dialog */}
      <div className="bg-background border border-foreground p-4">
        <label className="text-sm font-medium text-foreground mb-2 block uppercase tracking-wide">
          Mots-clés
        </label>
        <button
          type="button"
          onClick={() => { setKeywordsDraft(filters.keywords); setKeywordsDialogOpen(true); }}
          className="w-full text-left flex items-center gap-2 px-3 py-2 border border-input bg-background hover:bg-accent/50 transition-colors min-h-[40px] group"
        >
          {filters.keywords ? (
            <span className="text-sm truncate flex-1">{filters.keywords}</span>
          ) : (
            <span className="text-sm text-muted-foreground flex-1">Ex: Product Manager, React...</span>
          )}
          <Pencil className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>

      <Dialog open={keywordsDialogOpen} onOpenChange={setKeywordsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mots-clés de recherche</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            value={keywordsDraft}
            onChange={(e) => setKeywordsDraft(e.target.value)}
            placeholder='Ex: (Terraform OR IaC OR "Infrastructure as Code") AND (AWS OR Azure) NOT (junior OR stagiaire)'
            className="min-h-[140px] text-sm font-mono"
            rows={6}
          />
          <div className="space-y-1.5 text-xs text-muted-foreground bg-muted/50 p-3 border border-foreground/10">
            <p className="font-medium text-foreground/70">💡 Astuces Boolean avancées :</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong>OR</strong> entre synonymes : <code className="text-xs bg-muted px-1">Java OR JEE OR J2EE</code></li>
              <li><strong>AND</strong> entre catégories : <code className="text-xs bg-muted px-1">(Java OR JEE) AND (Spring OR SpringBoot)</code></li>
              <li><strong>NOT</strong> pour exclure : <code className="text-xs bg-muted px-1">NOT (junior OR stagiaire OR freelance)</code></li>
              <li><strong>Guillemets</strong> pour expressions exactes : <code className="text-xs bg-muted px-1">"data scientist"</code></li>
              <li><strong>Wildcard *</strong> pour variantes : <code className="text-xs bg-muted px-1">cloud*</code> → cloud, cloudops, cloudstack</li>
            </ul>
            <p className="text-xs mt-1 text-muted-foreground/70">⚠️ Mettre les titres de poste dans le champ Rôle, pas ici. Limite ~200 caractères.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeywordsDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => { setFilters(f => ({ ...f, keywords: keywordsDraft })); setKeywordsDialogOpen(false); }}>
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          disabled={loading || (!selectedAccount && searchSource !== 'database') || !selectedJob || needsReconnection || !isApiModeAvailable}
          className="flex-1 bg-foreground text-background hover:bg-foreground/90"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          {loading ? 'Recherche...' : !selectedJob ? 'Sélectionnez un poste' : 'Rechercher'}
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
