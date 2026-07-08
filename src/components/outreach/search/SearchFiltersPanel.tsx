import React, { useState, useCallback } from 'react';
import { LinkedInFiltersState, LinkedInApiType, API_TYPE_OPTIONS } from '@/components/outreach/types';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from '@/components/outreach/LinkedInFilters';
import { JobSelector, GeneratedFilters, useJobs } from '@/components/outreach/JobSelector';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useOrganizationIntegrations } from '@/hooks/useOrganizationIntegrations';

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
import { Search, Loader2, AlertTriangle, Lock, Pencil, Sparkles, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterSuggestions {
  alt_skills?: string[];
  alt_titles?: string[];
  alt_locations?: string[];
  alt_companies?: string[];
  alt_certifications?: string[];
}

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
  suggestions?: FilterSuggestions | null;
  onSuggestionsGenerated?: (suggestions: FilterSuggestions | null) => void;
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
  suggestions,
  onSuggestionsGenerated,
}) => {
  const [keywordsDialogOpen, setKeywordsDialogOpen] = useState(false);
  const [keywordsDraft, setKeywordsDraft] = useState('');
  const { data: allJobs = [] } = useJobs();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  // Feature flag Base Konekt (rollout contrôlé par org). Lisible admin/owner.
  const { integrations } = useOrganizationIntegrations();
  const coresignalEnabled = integrations?.coresignal_enabled === true;

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
    <div className="space-y-2 sm:space-y-2.5 lg:sticky lg:top-24 min-w-0 overflow-hidden">
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

      {/* Sélecteur de source — visible seulement si Base Konekt activée pour l'org.
          « LinkedIn » = recherche live via la session LinkedIn. « Base Konekt » =
          recherche base de données (identité visible, sans toucher au compte). */}
      {coresignalEnabled && onSearchSourceChange && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-md">
          <button
            type="button"
            onClick={() => onSearchSourceChange('linkedin')}
            className={cn(
              'text-xs font-medium py-1.5 rounded transition-colors',
              searchSource !== 'database'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            LinkedIn
          </button>
          <button
            type="button"
            onClick={() => onSearchSourceChange('database')}
            className={cn(
              'text-xs font-medium py-1.5 rounded transition-colors',
              searchSource === 'database'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Base Konekt
          </button>
        </div>
      )}

      {/* Alerte compte LinkedIn — uniquement en mode LinkedIn (la Base Konekt
          n'exige pas de compte connecté). */}
      {searchSource !== 'database' && accounts.length === 0 && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/30 py-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle className="text-destructive text-xs">Aucun compte LinkedIn connecté</AlertTitle>
          <AlertDescription className="text-destructive/80 text-2xs">
            Connectez votre compte LinkedIn dans Paramètres pour accéder au sourcing.
          </AlertDescription>
        </Alert>
      )}

      {/* Account selector — only visible in LinkedIn mode */}
      {searchSource !== 'database' && (
      <div className="bg-background border border-border p-2 sm:p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-3xs font-bold text-muted-foreground uppercase tracking-wider">Compte</label>
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
                        alt={selectedAccountData.name || selectedAccountData.identifier || 'Photo de profil'}
                        className="w-5 h-5 rounded-lg object-cover shrink-0"
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
                        alt={account.name || account.identifier || 'Photo de profil'}
                        className="w-5 h-5 rounded-lg object-cover"
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

      {/* Mission context: poste actif compact (1 ligne) */}
      {activeProject && selectedJob && (
        <div className="bg-background border border-border p-2 sm:p-2.5 flex items-center gap-2 min-w-0">
          <span className="text-sm shrink-0" aria-hidden="true">🎯</span>
          <div className="flex flex-col gap-0 min-w-0 flex-1">
            <span className="text-3xs font-bold text-muted-foreground uppercase tracking-wider leading-tight">
              Poste actif
            </span>
            <p className="text-sm font-medium text-foreground truncate leading-tight">
              {selectedJob.title}
              {(selectedJob as any).client?.name && (
                <span className="text-muted-foreground font-normal"> · {(selectedJob as any).client.name}</span>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2 sm:space-y-3">
        {/* Filter actions — HEAD's AutoFillFiltersButton kept (no onOpenFilterWizard
            prop in HEAD signature; the wizard is invoked via the search.showFilterWizard
            state from useLinkedInSearch instead) */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <AutoFillFiltersButton
            selectedJob={selectedJob}
            accountId={selectedAccount}
            currentLocation={filters.location}
            onApplyFilters={(update) => setFilters(prev => ({ ...prev, ...update }))}
            onSuggestionsGenerated={onSuggestionsGenerated}
            searchSource={filters.api === 'database' ? 'database' : 'linkedin'}
          />
        </div>

        {/* AI Suggestions inline chips */}
        {suggestions && (() => {
          const existingTitles = new Set(filters.role.map(r => r.keywords.toLowerCase()));
          const existingSkills = new Set([
            ...filters.skills.map(s => s.name.toLowerCase()),
            ...(filters.skills_keywords || []).map(s => s.toLowerCase()),
          ]);
          const existingLocations = new Set(filters.location.map(l => l.name.toLowerCase()));

          const chips: { label: string; category: string; key: string }[] = [];
          suggestions.alt_titles?.forEach(t => {
            const k = `title:${t}`;
            if (!existingTitles.has(t.toLowerCase()) && !dismissedSuggestions.has(k))
              chips.push({ label: t, category: 'Poste', key: k });
          });
          suggestions.alt_skills?.forEach(s => {
            const k = `skill:${s}`;
            if (!existingSkills.has(s.toLowerCase()) && !dismissedSuggestions.has(k))
              chips.push({ label: s, category: 'Skill', key: k });
          });
          suggestions.alt_locations?.forEach(l => {
            const k = `loc:${l}`;
            if (!existingLocations.has(l.toLowerCase()) && !dismissedSuggestions.has(k))
              chips.push({ label: l, category: 'Lieu', key: k });
          });
          suggestions.alt_certifications?.forEach(c => {
            const k = `cert:${c}`;
            if (!existingSkills.has(c.toLowerCase()) && !dismissedSuggestions.has(k))
              chips.push({ label: c, category: 'Certif', key: k });
          });

          if (chips.length === 0) return null;

          const handleAccept = (chip: typeof chips[0]) => {
            if (chip.key.startsWith('title:')) {
              setFilters(f => ({
                ...f,
                role: [...f.role, { keywords: chip.label, priority: 'CAN_HAVE' as const, scope: 'CURRENT_OR_PAST' as const }],
              }));
            } else if (chip.key.startsWith('skill:') || chip.key.startsWith('cert:')) {
              setFilters(f => ({
                ...f,
                skills_keywords: [...(f.skills_keywords || []), chip.label],
              }));
            } else if (chip.key.startsWith('loc:')) {
              setFilters(f => ({
                ...f,
                location: [...f.location, { id: chip.label, name: chip.label, priority: 'CAN_HAVE' as const, scope: 'CURRENT' as const }],
              }));
            }
            setDismissedSuggestions(prev => new Set([...prev, chip.key]));
          };

          const handleDismiss = (chip: typeof chips[0]) => {
            setDismissedSuggestions(prev => new Set([...prev, chip.key]));
          };

          return (
            <div className="bg-background border border-border p-2 sm:p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Suggestions IA</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {chips.slice(0, 8).map(chip => (
                  <span
                    key={chip.key}
                    className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-2xs text-foreground group"
                  >
                    <span className="text-3xs text-primary/60 font-medium mr-0.5">{chip.category}</span>
                    <span className="truncate max-w-[100px]">{chip.label}</span>
                    <button
                      type="button"
                      onClick={() => handleAccept(chip)}
                      className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-primary/20 transition-colors"
                      title="Ajouter"
                    >
                      <Plus className="w-2.5 h-2.5 text-primary" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismiss(chip)}
                      className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-destructive/20 transition-colors"
                      title="Ignorer"
                    >
                      <X className="w-2.5 h-2.5 text-muted-foreground" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Custom scoring instructions (visible when job selected) */}
        {selectedJob && onScoringInstructionsChange && (
          <div className="bg-background border border-border p-2 sm:p-2.5">
            <label className="text-3xs font-bold text-muted-foreground mb-1 block uppercase tracking-wider">
              Consignes scoring IA <span className="font-normal text-muted-foreground/60 normal-case tracking-normal">(optionnel)</span>
            </label>
            <textarea
              value={scoringInstructions}
              onChange={(e) => onScoringInstructionsChange(e.target.value)}
              placeholder="Ex: Privilégier les profils avec exp. cloud souverain, ignorer la localisation, bonus si exp. scale-up…"
              rows={2}
              className="w-full px-2.5 py-1.5 text-sm border border-border bg-background rounded-md placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 resize-none"
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

      {/* Keywords preview + edit dialog — compact (label inline + bouton) */}
      <div className="bg-background border border-border p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Mots-clés
          </label>
          {filters.keywords && (
            <span className="text-3xs text-muted-foreground/60 tabular-nums">
              {filters.keywords.length} car.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setKeywordsDraft(filters.keywords); setKeywordsDialogOpen(true); }}
          className="w-full min-w-0 text-left flex items-start gap-2 px-2.5 py-1.5 border border-input bg-background hover:bg-accent/50 transition-colors min-h-[34px] group rounded-md"
        >
          {filters.keywords ? (
            <span className="text-sm whitespace-normal break-words leading-snug flex-1 min-w-0">{filters.keywords}</span>
          ) : (
            <span className="text-sm text-muted-foreground flex-1">Ex: Product Manager, React…</span>
          )}
          <Pencil className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
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
          <div className="space-y-1.5 text-xs text-muted-foreground bg-muted/50 p-3 border border-border">
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

      {/* Action buttons — sticky at bottom */}
      <div className="sticky bottom-0 z-10 bg-background pt-2 pb-1 border-t border-border -mx-0 px-0">
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
    </div>
  );
};
