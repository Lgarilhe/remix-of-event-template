import React, { useMemo, useState } from 'react';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { LinkedInProfile } from '@/components/outreach/types';
import { LinkedInResultCard } from '@/components/outreach/LinkedInResultCard';
import { BulkInMailModal } from '@/components/outreach/BulkInMailModal';
import { SequenceEnrollButton } from '@/components/outreach/SequenceEnrollButton';
import { ProfileDetailSheet } from '@/components/outreach/result-card/ProfileDetailSheet';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { Job } from '@/pages/JobSpace';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAirtableMatch } from '@/hooks/useAirtableMatch';
import { useNotionMatch } from '@/hooks/useNotionMatch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  Search, Loader2, Users, Mail, Archive,
  Eye, FolderPlus, Target, Sparkles, Maximize2, Minimize2,
  ChevronRight, CheckCircle2, Database
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
  statusFilter: 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known';
  treatedCount: number;
  dismissedCount: number;
  
  // Account
  selectedAccount: string | null;
  activeProject?: SourcingProject | null;
  
  // Treated candidates from DB
  treatedCandidates: Map<string, JobCandidateStatus>;
  onRestoreCandidate?: (candidateId: string) => void;
  
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
  onSetStatusFilter: (v: 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known') => void;
  onSetSortByScore: (v: boolean) => void;
  onSetShowBulkInMailModal: (v: boolean) => void;
  onProfileTreated: (id: string) => void;
  onArchive: (profile: LinkedInProfile) => Promise<void>;
  onMessageSent: () => void;
  onSequenceEnrollSuccess: () => void;
  
  // Refine
  onRefineSearch: (direction: 'expand' | 'narrow') => void;
  refineLoading: boolean;
  
  // Refs
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  loadMoreTriggerRef: React.RefObject<HTMLDivElement>;
}

const getCanonicalProfileUrl = (p: Pick<LinkedInProfile, 'profile_url' | 'public_profile_url'>) =>
  p.public_profile_url || p.profile_url || '';

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
  treatedCandidates,
  onRestoreCandidate,
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
  // Profile detail sheet state
  const [detailProfile, setDetailProfile] = useState<LinkedInProfile | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const openProfileDetail = (profile: LinkedInProfile) => {
    setDetailProfile(profile);
    setDetailOpen(true);
  };


  // Airtable match - collect profile info for URL + fuzzy matching
  const profileMatchInputs = useMemo(() => 
    results.map(r => ({
      url: getCanonicalProfileUrl(r),
      name: r.name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || undefined,
      companies: (r.work_experience || []).map((w: any) => w.company).filter(Boolean) as string[],
    })).filter(p => p.url),
    [results]
  );
  const { getMatch: getAirtableMatch } = useAirtableMatch(profileMatchInputs);
  const profileUrls = useMemo(() => profileMatchInputs.map(p => p.url), [profileMatchInputs]);
  const { getMatch: getNotionMatch } = useNotionMatch(profileUrls);
  // Count by status for filter badges
  const statusCounts = React.useMemo(() => {
    const counts = { scored: 0, scored_go: 0, scored_maybe: 0, scored_contacted: 0, scored_not_contacted: 0, messaged: 0, dismissed: 0, untreated: 0, known: 0 };
    for (const r of results) {
      const profileUrl = getCanonicalProfileUrl(r);
      // Count "known" (in Airtable or Notion)
      if (getAirtableMatch(profileUrl) || getNotionMatch(profileUrl)) {
        counts.known++;
      }
      const s = treatedCandidates.get(r.id);
      if (!s) { counts.untreated++; continue; }
      if (s.status === 'scored') {
        counts.scored++;
        counts.scored_not_contacted++;
        const rec = jobScores[r.id]?.recommendation || s.recommendation;
        if (rec === 'go') counts.scored_go++;
        else if (rec === 'maybe') counts.scored_maybe++;
      }
      else if (s.status === 'messaged' || s.status === 'replied') {
        counts.messaged++;
        if (jobScores[r.id] || s.score != null) {
          counts.scored++;
          counts.scored_contacted++;
          const rec = jobScores[r.id]?.recommendation || s.recommendation;
          if (rec === 'go') counts.scored_go++;
          else if (rec === 'maybe') counts.scored_maybe++;
        }
      }
      else if (s.status === 'dismissed') counts.dismissed++;
    }
    return counts;
  }, [results, treatedCandidates, jobScores, getAirtableMatch, getNotionMatch]);

  // Apply "known" filter to filteredResults
  const displayResults = React.useMemo(() => {
    if (statusFilter !== 'known') return filteredResults;
    return filteredResults.filter(r => {
      const profileUrl = getCanonicalProfileUrl(r);
      return !!(getAirtableMatch(profileUrl) || getNotionMatch(profileUrl));
    });
  }, [filteredResults, statusFilter, getAirtableMatch, getNotionMatch]);

  return (
    <div className="bg-background border border-foreground flex flex-col min-h-[420px] lg:h-full min-w-0 overflow-hidden">
      {/* ROW 1: Search button + count + status filters */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-border shrink-0 gap-2 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-3 shrink-0">
          <Button
            onClick={onSearch}
            disabled={loading || !selectedJob}
            size="sm"
            className="bg-primary hover:bg-primary/90 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <Search className="w-3.5 h-3.5 mr-1.5" />
            )}
            {loading ? 'Recherche...' : 'Rechercher'}
          </Button>

          {hasSearched && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">
                {displayResults.length}
              </span>
              <span className="text-muted-foreground">
                profil{displayResults.length > 1 ? 's' : ''}
              </span>
              {total !== null && (
                <span className="text-xs text-muted-foreground/60">
                  / {total.toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Status filters */}
        {selectedJob && hasSearched && results.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-0.5 bg-muted/50 p-0.5 border border-foreground/20">
              {([
                { value: 'all' as const, label: 'Tous', icon: Users, count: results.length },
                { value: 'untreated' as const, label: 'Nouveaux', icon: Eye, count: statusCounts.untreated },
                { value: 'scored' as const, label: 'Scorés', icon: Target, count: statusCounts.scored },
                { value: 'messaged' as const, label: 'Contactés', icon: Mail, count: statusCounts.messaged },
                { value: 'known' as const, label: 'Connus', icon: Database, count: statusCounts.known },
                { value: 'dismissed' as const, label: 'Archivés', icon: Archive, count: statusCounts.dismissed },
              ]).map(({ value, label, icon: Icon, count }) => {
                const isActive = statusFilter === value || 
                  (value === 'scored' && (statusFilter === 'scored_go' || statusFilter === 'scored_maybe' || statusFilter === 'scored_not_contacted'));
                return (
                  <Button
                    key={value}
                    variant={isActive ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => onSetStatusFilter(value)}
                    className={`h-7 px-2 text-[11px] gap-1 ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="hidden sm:inline">{label}</span>
                    {count > 0 && (
                      <span className={`text-[10px] font-medium ${isActive ? 'text-primary-foreground/80' : 'text-muted-foreground/60'}`}>
                        {count}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ROW 1.5: Scored sub-filters (only when scored filter active) */}
      {(statusFilter === 'scored' || statusFilter === 'scored_go' || statusFilter === 'scored_maybe' || statusFilter === 'scored_not_contacted') && statusCounts.scored > 0 && (
        <div className="flex items-center gap-1 px-3 sm:px-4 py-1.5 border-b border-border/50 bg-muted/20 shrink-0">
          <div className="flex items-center gap-0.5 bg-muted/30 p-0.5 border border-foreground">
            {([
              { value: 'scored' as const, label: 'Tous', count: statusCounts.scored },
              { value: 'scored_go' as const, label: '✅ À contacter', count: statusCounts.scored_go },
              { value: 'scored_maybe' as const, label: '🤔 À évaluer', count: statusCounts.scored_maybe },
              { value: 'scored_not_contacted' as const, label: '🆕 Non contactés', count: statusCounts.scored_not_contacted },
            ]).map(({ value, label, count }) => (
              <Button
                key={value}
                variant={statusFilter === value ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onSetStatusFilter(value)}
                className={`h-6 px-2 text-[10px] gap-1 ${
                  statusFilter === value
                    ? 'bg-secondary text-secondary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                {count > 0 && (
                  <span className="text-[9px] font-medium opacity-70">{count}</span>
                )}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ROW 2: Bulk actions + sort + select all (only when relevant) */}
      {selectedJob && results.length > 0 && (
        <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 border-b border-border/50 bg-muted/10 shrink-0 gap-2">
          {/* Left: Bulk actions */}
          <div className="flex items-center gap-1.5">
            {selectedProfiles.size > 0 ? (
              <>
                <span className="text-xs font-medium text-primary">{selectedProfiles.size} sél.</span>

                {/* Batch score */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBatchScore}
                        disabled={scoringInProgress}
                        className="h-7 px-2"
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
                          className="h-7 px-2 text-green-600 hover:text-green-700"
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
                        className="h-7 px-2 text-destructive hover:text-destructive/80"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Archiver</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Bulk InMail */}
                {selectedAccount && (
                  <>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSetShowBulkInMailModal(true)}
                            className="h-7 px-2"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>InMail groupé</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <SequenceEnrollButton
                      selectedProfiles={selectableProfiles.filter(p => selectedProfiles.has(p.id))}
                      accountId={selectedAccount}
                      selectedJob={selectedJob}
                      onSuccess={onSequenceEnrollSuccess}
                    />
                  </>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Sélectionnez des profils pour les actions groupées</span>
            )}
          </div>

          {/* Right: Sort + Select all */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Sort by score toggle */}
            {Object.keys(jobScores).length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={sortByScore ? "default" : "ghost"}
                      size="sm"
                      onClick={() => onSetSortByScore(!sortByScore)}
                      className={`h-7 px-2 ${sortByScore ? "bg-primary hover:bg-primary/90" : ""}`}
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

            {/* Select all checkbox */}
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
          </div>
        </div>
      )}

      {/* Results list */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        {loading && results.length === 0 ? (
          <BrutalLoader variant="search" rows={5} />
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground px-8">
            {hasSearched ? (
              <>
                <div className="w-20 h-20 bg-muted flex items-center justify-center mb-6">
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
                    className="gap-2 bg-foreground text-background hover:bg-foreground/90"
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
          <div className="p-2 sm:p-4 space-y-2 min-w-0">
            {/* Batch workflow banner */}
            {hasSearched && total !== null && total > 0 && (
              <div className="border border-foreground/15 bg-background mb-3 overflow-hidden">
                <div className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-4">
                    {/* Left: bold typographic count */}
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-3xl sm:text-4xl font-black text-foreground tabular-nums tracking-tighter leading-none">
                        {total.toLocaleString()}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          profils trouvés
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground/70">
                            {results.length} affichés sur {total}
                          </span>
                          {statusCounts.untreated === 0 && results.length > 0 && cursor && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                              <CheckCircle2 className="w-3 h-3" />
                              traité
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: refine actions */}
                    <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRefineSearch('expand')}
                        disabled={refineLoading}
                        className="h-8 px-2.5 gap-1 text-[11px] font-bold uppercase tracking-wider border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                      >
                        {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Maximize2 className="w-3 h-3" />}
                        Élargir
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRefineSearch('narrow')}
                        disabled={refineLoading}
                        className="h-8 px-2.5 gap-1 text-[11px] font-bold uppercase tracking-wider border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                      >
                        {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Minimize2 className="w-3 h-3" />}
                        Affiner
                      </Button>
                    </div>
                  </div>

                  {/* Subtle segmented progress — only when more to load */}
                  {total > results.length && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 flex gap-px h-1">
                        {Array.from({ length: Math.min(20, Math.ceil(total / Math.max(results.length, 1))) }).map((_, i) => (
                          <div
                            key={i}
                            className={`flex-1 transition-colors duration-300 ${
                              i < Math.ceil((results.length / total) * Math.min(20, Math.ceil(total / Math.max(results.length, 1))))
                                ? 'bg-foreground'
                                : 'bg-foreground/10'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-muted-foreground/60 tabular-nums whitespace-nowrap">
                        {Math.round((results.length / total) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Profile cards */}
            {displayResults.map((profile, index) => (
              <LinkedInResultCard
                key={profile.id || `profile-${index}`}
                profile={profile}
                selectedJob={selectedJob}
                isSelected={selectedProfiles.has(profile.id)}
                isBatchScoring={scoringInProgress}
                onToggleSelect={() => onToggleProfileSelection(profile.id)}
                jobScore={jobScores[profile.id] || (treatedCandidates.get(profile.id)?.score != null ? {
                  profile_name: treatedCandidates.get(profile.id)!.candidate_name || profile.name || '',
                  match_score: treatedCandidates.get(profile.id)!.score!,
                  matching_skills: [],
                  missing_skills: [],
                  experience_match: 'incertain' as const,
                  location_match: false,
                  summary: '',
                  recommendation: (treatedCandidates.get(profile.id)!.recommendation || 'maybe') as 'go' | 'maybe' | 'skip',
                } : undefined)}
                onScoreProfile={() => onScoreProfile(profile)}
                accountId={selectedAccount || undefined}
                onMessageSent={onMessageSent}
                activeProject={activeProject}
                onProfileTreated={() => onProfileTreated(profile.id)}
                onArchive={selectedJob ? () => onArchive(profile) : undefined}
                candidateStatus={treatedCandidates.get(profile.id) ? {
                  status: treatedCandidates.get(profile.id)!.status,
                  score: treatedCandidates.get(profile.id)!.score,
                  recommendation: treatedCandidates.get(profile.id)!.recommendation,
                  updated_at: treatedCandidates.get(profile.id)!.updated_at,
                } : null}
                airtableMatch={getAirtableMatch(getCanonicalProfileUrl(profile))}
                notionMatch={getNotionMatch(getCanonicalProfileUrl(profile))}
                onOpenDetail={() => openProfileDetail(profile)}
              />
            ))}

            {/* Next batch / Load more */}
            <div ref={loadMoreTriggerRef} className="py-4">
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Chargement du lot suivant...</span>
                </div>
              )}
              {!loadingMore && hasMoreResults && cursor && (
                <div className="flex flex-col items-center gap-2 py-2">
                  {statusCounts.untreated === 0 && results.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Lot actuel traité !
                      </div>
                      <Button
                        onClick={onLoadMore}
                        className="gap-2 bg-primary hover:bg-primary/90"
                        size="default"
                      >
                        Lot suivant
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        {results.length} chargés sur {total?.toLocaleString() || '?'}
                      </span>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={onLoadMore} className="gap-2">
                      <ChevronRight className="w-3.5 h-3.5" />
                      Charger le lot suivant (25 profils)
                    </Button>
                  )}
                </div>
              )}
              {!hasMoreResults && results.length > 0 && (
                <div className="text-center py-2">
                  {total !== null && results.length < total ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {results.length} profils chargés sur {total} disponibles
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onSearch}
                        className="gap-1.5 text-xs"
                      >
                        <Search className="w-3 h-3" />
                        Relancer la recherche
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60">
                      Tous les profils ont été chargés ({results.length})
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Profile Detail Sheet */}
      <ProfileDetailSheet
        profile={detailProfile}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        selectedJob={selectedJob}
        jobScore={detailProfile ? jobScores[detailProfile.id] : undefined}
        accountId={selectedAccount || undefined}
        activeProject={activeProject}
        candidateStatus={detailProfile ? (treatedCandidates.get(detailProfile.id) ? {
          status: treatedCandidates.get(detailProfile.id)!.status,
          score: treatedCandidates.get(detailProfile.id)!.score,
          recommendation: treatedCandidates.get(detailProfile.id)!.recommendation,
          updated_at: treatedCandidates.get(detailProfile.id)!.updated_at,
        } : null) : null}
        airtableMatch={detailProfile ? getAirtableMatch(getCanonicalProfileUrl(detailProfile)) : undefined}
        notionMatch={detailProfile ? getNotionMatch(getCanonicalProfileUrl(detailProfile)) : undefined}
        onScoreProfile={detailProfile ? () => onScoreProfile(detailProfile) : undefined}
        onArchive={detailProfile && selectedJob ? () => onArchive(detailProfile) : undefined}
        onMessageSent={onMessageSent}
        onSequenceEnroll={onSequenceEnrollSuccess}
        onProfileTreated={detailProfile ? () => onProfileTreated(detailProfile.id) : undefined}
      />

      {/* Bulk InMail Modal */}
      {selectedAccount && (
        <BulkInMailModal
          isOpen={showBulkInMailModal}
          onClose={() => onSetShowBulkInMailModal(false)}
          recipients={Array.from(selectedProfiles)
            .map(id => {
              const p = results.find(r => r.id === id);
              if (!p) return null;
              return {
                id: p.id,
                name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
                headline: p.headline,
                profile_id: p.id,
                network_distance: p.network_distance,
                profile: p,
              };
            })
            .filter(Boolean) as any[]}
          accountId={selectedAccount}
          selectedJob={selectedJob}
        />
      )}
    </div>
  );
};

// Welcome message when no search has been performed
const SearchWelcomeMessage: React.FC = () => (
  <div className="w-full max-w-lg">
    <div className="text-center mb-8">
      <div className="w-16 h-16 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
        <Search className="w-8 h-8" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">
        Recherche LinkedIn
      </h3>
      <p className="text-sm text-muted-foreground">
        Trouvez des candidats qualifiés en utilisant les filtres avancés
      </p>
    </div>

    <div className="space-y-4">
      <div className="bg-muted/50 border border-foreground p-4">
        <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-foreground text-background text-xs flex items-center justify-center">1</span>
          Sélectionnez un poste
        </h4>
        <p className="text-sm text-muted-foreground ml-8">
          Choisissez un <strong>poste de référence</strong> dans le panneau de gauche.
        </p>
      </div>

      <div className="bg-muted/30 border border-foreground p-4">
        <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-foreground text-background text-xs flex items-center justify-center">2</span>
          Recherchez des profils
        </h4>
        <ul className="text-sm text-muted-foreground space-y-2 ml-8">
          <li>• Configurez vos filtres ou utilisez <strong>Auto-fill</strong></li>
          <li>• Cliquez sur <strong>Rechercher</strong></li>
        </ul>
      </div>

      <div className="bg-muted border border-foreground/10 p-4">
        <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-foreground text-background text-xs flex items-center justify-center">3</span>
          Sélectionnez et scorez
        </h4>
        <p className="text-sm text-muted-foreground ml-8">
          Sélectionnez les profils, puis cliquez sur <strong><Target className="w-3 h-3 inline" /> Scorer</strong>.
        </p>
      </div>

      <div className="bg-muted/50 border border-foreground/10 p-4">
        <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-foreground text-background text-xs flex items-center justify-center">4</span>
          Ajoutez ou archivez
        </h4>
        <ul className="text-sm text-muted-foreground space-y-1 ml-8">
          <li>• <strong><FolderPlus className="w-3 h-3 inline" /> Ajouter au projet</strong></li>
          <li>• <strong><Archive className="w-3 h-3 inline" /> Archiver</strong></li>
        </ul>
      </div>
    </div>
  </div>
);
