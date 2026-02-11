import React, { useState } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { LinkedInResultCard } from '@/components/outreach/LinkedInResultCard';
import { BulkInMailModal } from '@/components/outreach/BulkInMailModal';
import { SequenceEnrollButton } from '@/components/outreach/SequenceEnrollButton';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { Job } from '@/pages/JobSpace';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Search, Loader2, Users, Mail, GitBranch, Archive,
  Eye, EyeOff, FolderPlus, Target, Sparkles, Maximize2, Minimize2
} from 'lucide-react';
import { toast } from 'sonner';

interface SearchResultsPanelProps {
  // Results
  results: LinkedInProfile[];
  filteredResults: LinkedInProfile[];
  loading: boolean;
  loadingMore: boolean;
  hasSearched: boolean;
  hasMoreResults: boolean;
  cursor: string | null;
  total: number | null;
  
  // Job & Scoring
  selectedJob: Job | null;
  selectedProfiles: Set<string>;
  jobScores: Record<string, JobMatchResult>;
  scoringInProgress: boolean;
  sortByScore: boolean;
  selectableProfiles: LinkedInProfile[];
  allSelectableSelected: boolean;
  
  // Status
  autoHideTreated: boolean;
  showDismissed: boolean;
  statusFilter: 'all' | 'untreated' | 'messaged' | 'dismissed';
  treatedCount: number;
  dismissedCount: number;
  
  // Account
  selectedAccount: string | null;
  activeProject?: SourcingProject | null;
  
  // Modal state
  showBulkInMailModal: boolean;
  
  // Actions
  onSearch: () => void;
  onLoadMore: () => void;
  onToggleProfileSelection: (id: string) => void;
  onToggleSelectAll: () => void;
  onScoreProfile: (profile: LinkedInProfile) => void;
  onBatchScore: () => void;
  onBulkDismiss: () => void;
  onBulkAddToProject: () => void;
  onSetAutoHideTreated: (v: boolean) => void;
  onSetShowDismissed: (v: boolean) => void;
  onSetStatusFilter: (v: 'all' | 'untreated' | 'messaged' | 'dismissed') => void;
  onSetSortByScore: (v: boolean) => void;
  onSetShowBulkInMailModal: (v: boolean) => void;
  onProfileTreated: (id: string) => void;
  onArchive: (profile: LinkedInProfile) => Promise<void>;
  onMessageSent: () => void;
  onSequenceEnrollSuccess: () => void;
  
  // Refine
  onRefineSearch: (direction: 'expand' | 'narrow') => Promise<void>;
  refineLoading: boolean;
  
  // Refs
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  loadMoreTriggerRef: React.RefObject<HTMLDivElement>;
}

export const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  results,
  filteredResults,
  loading,
  loadingMore,
  hasSearched,
  hasMoreResults,
  cursor,
  total,
  selectedJob,
  selectedProfiles,
  jobScores,
  scoringInProgress,
  sortByScore,
  selectableProfiles,
  allSelectableSelected,
  autoHideTreated,
  showDismissed,
  statusFilter,
  treatedCount,
  dismissedCount,
  selectedAccount,
  activeProject,
  showBulkInMailModal,
  onSearch,
  onLoadMore,
  onToggleProfileSelection,
  onToggleSelectAll,
  onScoreProfile,
  onBatchScore,
  onBulkDismiss,
  onBulkAddToProject,
  onSetAutoHideTreated,
  onSetShowDismissed,
  onSetStatusFilter,
  onSetSortByScore,
  onSetShowBulkInMailModal,
  onProfileTreated,
  onArchive,
  onMessageSent,
  onSequenceEnrollSuccess,
  onRefineSearch,
  refineLoading,
  scrollAreaRef,
  loadMoreTriggerRef,
}) => {
  return (
    <div className="bg-white rounded-xl border border-border flex flex-col h-[calc(100vh-200px)] lg:h-[calc(100vh-120px)] lg:sticky lg:top-24 min-w-0 overflow-hidden">
      {/* Results header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-border shrink-0 gap-2 sm:gap-3 flex-wrap">
        {/* Left side: Search button + count */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            onClick={hasSearched && cursor ? onLoadMore : onSearch}
            disabled={loading || !selectedJob}
            size="sm"
            className="bg-primary hover:bg-primary/90 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <Search className="w-3.5 h-3.5 mr-1.5" />
            )}
            {loading ? 'Recherche...' : hasSearched && cursor ? 'Charger +' : 'Rechercher'}
          </Button>

          {hasSearched && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">
                {filteredResults.length}
              </span>
              <span className="text-muted-foreground">
                profil{filteredResults.length > 1 ? 's' : ''}
              </span>
              {total !== null && (
                <span className="text-xs text-muted-foreground/60">
                  / {total.toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right side: Filters + Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          {/* Auto-hide treated toggle */}
          {selectedJob && hasSearched && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={autoHideTreated ? 'default' : 'ghost'}
                    size="sm"
                    className={`h-8 px-2 text-xs gap-1.5 ${autoHideTreated ? 'bg-green-600 hover:bg-green-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => onSetAutoHideTreated(!autoHideTreated)}
                  >
                    {autoHideTreated ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    Traités
                    {treatedCount > 0 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px] font-medium">
                        {treatedCount}
                      </Badge>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{autoHideTreated ? 'Afficher les profils traités' : 'Masquer les profils traités'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Status filter dropdown */}
          {selectedJob && hasSearched && results.length > 0 && !autoHideTreated && (
            <Select value={statusFilter} onValueChange={(v) => onSetStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-auto min-w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3 h-3" />
                    Tous
                  </span>
                </SelectItem>
                <SelectItem value="untreated">
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-3 h-3" />
                    Non traités
                  </span>
                </SelectItem>
                <SelectItem value="messaged">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3 h-3" />
                    Contactés
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Dismissed toggle - always visible when there are dismissed profiles */}
          {selectedJob && dismissedCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showDismissed ? 'default' : 'ghost'}
                    size="sm"
                    className={`h-8 px-2 text-xs ${showDismissed ? 'bg-red-500 hover:bg-red-600' : 'text-red-500 hover:text-red-600'}`}
                    onClick={() => onSetShowDismissed(!showDismissed)}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span className="ml-1">{dismissedCount}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{showDismissed ? 'Masquer' : 'Voir'} les écartés</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Sort by score toggle */}
          {Object.keys(jobScores).length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={sortByScore ? "default" : "ghost"}
                    size="sm"
                    onClick={() => onSetSortByScore(!sortByScore)}
                    className={`h-8 px-2 ${sortByScore ? "bg-primary hover:bg-primary/90" : ""}`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{sortByScore ? 'Tri par score actif' : 'Trier par score'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Separator + Bulk actions */}
          {selectedProfiles.size > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border">
              <span className="text-xs font-medium text-muted-foreground">
                {selectedProfiles.size}
              </span>

              {/* Batch score */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onBatchScore}
                      disabled={scoringInProgress}
                      className="h-8 px-2"
                    >
                      {scoringInProgress ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Target className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Scorer les profils sélectionnés</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Add to project */}
              {activeProject && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBulkAddToProject}
                        className="h-8 px-2 text-green-600 hover:text-green-700"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Ajouter au projet</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Bulk dismiss */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onBulkDismiss}
                      className="h-8 px-2 text-red-500 hover:text-red-600"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Archiver les profils sélectionnés</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Bulk InMail */}
              {selectedAccount && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSetShowBulkInMailModal(true)}
                        className="h-8 px-2"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Envoyer InMail groupé</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Sequence enroll */}
              {selectedAccount && (
                <SequenceEnrollButton
                  selectedProfiles={selectableProfiles.filter(p => selectedProfiles.has(p.id))}
                  accountId={selectedAccount}
                  selectedJob={selectedJob}
                  onSuccess={onSequenceEnrollSuccess}
                />
              )}
            </div>
          )}

          {/* Select all checkbox */}
          {selectedJob && results.length > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border">
              <Checkbox
                checked={allSelectableSelected && selectableProfiles.length > 0}
                onCheckedChange={onToggleSelectAll}
                id="select-all"
                className="h-4 w-4"
              />
              <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                Tout
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Results list */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        {loading && results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Recherche en cours...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground px-8">
            {hasSearched ? (
              <>
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
                  <Search className="w-10 h-10" />
                </div>
                <p className="text-lg font-medium text-foreground/60 mb-2">
                  Aucun profil trouvé
                </p>
                <p className="text-sm text-center max-w-md mb-4">
                  Essayez d'ajuster vos filtres pour élargir votre recherche
                </p>
                {selectedJob && (
                  <Button
                    onClick={() => onRefineSearch('expand')}
                    disabled={refineLoading}
                    className="gap-2 bg-green-600 hover:bg-green-700"
                  >
                    {refineLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Maximize2 className="w-4 h-4" />}
                    Élargir les filtres avec l'IA
                  </Button>
                )}
              </>
            ) : (
              <SearchWelcomeMessage />
            )}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Results stats banner */}
            {hasSearched && total !== null && total > 0 && (
              <div className="bg-primary/5 rounded-lg p-3 mb-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {total.toLocaleString()} candidats correspondent à vos critères
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {results.length} profils chargés
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRefineSearch('expand')}
                          disabled={refineLoading}
                          className="h-8 px-2.5 gap-1.5 text-xs border-green-300 text-green-700 hover:bg-green-50"
                        >
                          {refineLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Maximize2 className="w-3.5 h-3.5" />}
                          Élargir
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>IA: ajuster les filtres pour obtenir plus de résultats</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRefineSearch('narrow')}
                          disabled={refineLoading}
                          className="h-8 px-2.5 gap-1.5 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                        >
                          {refineLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Minimize2 className="w-3.5 h-3.5" />}
                          Affiner
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>IA: ajuster les filtres pour des résultats plus ciblés</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}

            {/* Profile cards */}
            {filteredResults.map((profile, index) => (
              <LinkedInResultCard
                key={profile.id || `profile-${index}`}
                profile={profile}
                selectedJob={selectedJob}
                isSelected={selectedProfiles.has(profile.id)}
                onToggleSelect={() => onToggleProfileSelection(profile.id)}
                jobScore={jobScores[profile.id]}
                onScoreProfile={() => onScoreProfile(profile)}
                accountId={selectedAccount || undefined}
                onMessageSent={onMessageSent}
                activeProject={activeProject}
                onProfileTreated={() => onProfileTreated(profile.id)}
                onArchive={selectedJob ? () => onArchive(profile) : undefined}
              />
            ))}

            {/* Infinite scroll trigger */}
            <div ref={loadMoreTriggerRef} className="py-4">
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Chargement...</span>
                </div>
              )}
              {!loadingMore && hasMoreResults && cursor && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={onLoadMore} className="gap-2">
                    <Search className="w-3.5 h-3.5" />
                    Charger 25 profils de plus
                  </Button>
                </div>
              )}
              {!hasMoreResults && results.length > 0 && (
                <p className="text-center text-xs text-muted-foreground/60 py-2">
                  Tous les profils ont été chargés ({results.length})
                </p>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

// Welcome message when no search has been performed
const SearchWelcomeMessage: React.FC = () => (
  <div className="w-full max-w-lg">
    <div className="text-center mb-8">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-4">
        <Search className="w-8 h-8 text-primary" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">
        Recherche LinkedIn
      </h3>
      <p className="text-sm text-muted-foreground">
        Trouvez des candidats qualifiés en utilisant les filtres avancés
      </p>
    </div>

    <div className="space-y-4">
      <div className="bg-amber-50 rounded-xl p-4 border border-amber-200/50">
        <h4 className="font-medium text-amber-800 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs flex items-center justify-center">1</span>
          Sélectionnez un poste
        </h4>
        <p className="text-sm text-amber-700/80 ml-8">
          Choisissez un <strong>poste de référence</strong> dans le panneau de gauche.
        </p>
      </div>

      <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
        <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center">2</span>
          Recherchez des profils
        </h4>
        <ul className="text-sm text-muted-foreground space-y-2 ml-8">
          <li>• Configurez vos filtres ou utilisez <strong>Auto-fill</strong></li>
          <li>• Cliquez sur <strong>Rechercher</strong></li>
        </ul>
      </div>

      <div className="bg-muted rounded-xl p-4 border border-border">
        <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-foreground text-background text-xs flex items-center justify-center">3</span>
          Sélectionnez et scorez
        </h4>
        <p className="text-sm text-muted-foreground ml-8">
          Sélectionnez les profils, puis cliquez sur <strong><Target className="w-3 h-3 inline" /> Scorer</strong>.
        </p>
      </div>

      <div className="bg-green-50 rounded-xl p-4 border border-green-200/50">
        <h4 className="font-medium text-green-800 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center">4</span>
          Ajoutez ou archivez
        </h4>
        <ul className="text-sm text-green-700/80 space-y-1 ml-8">
          <li>• <strong><FolderPlus className="w-3 h-3 inline" /> Ajouter au projet</strong></li>
          <li>• <strong><Archive className="w-3 h-3 inline" /> Archiver</strong></li>
        </ul>
      </div>
    </div>
  </div>
);
