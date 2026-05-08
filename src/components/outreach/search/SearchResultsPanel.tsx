import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { SourcingReadinessPanel } from '@/components/missions/SourcingReadinessPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { LinkedInProfile } from '@/components/outreach/types';
import { LinkedInResultCard } from '@/components/outreach/LinkedInResultCard';
import { CompactResultsTable } from './CompactResultsTable';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { BulkInMailModal } from '@/components/outreach/BulkInMailModal';
import { SequenceEnrollButton } from '@/components/outreach/SequenceEnrollButton';
import { BulkEnrichButton } from '@/components/outreach/result-card/BulkEnrichButton';
import { ProfileDetailSheet } from '@/components/outreach/result-card/ProfileDetailSheet';
import { JobMatchResult, BatchScoringStats as BatchScoringStatsType } from '@/components/outreach/JobScoreDisplay';
import { BatchScoringReport, BatchReportEntry } from '@/components/outreach/BatchScoringReport';
import { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { ScoredSortBy } from '@/hooks/useFilteredResults';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAirtableMatch } from '@/hooks/useAirtableMatch';
import { useNotionMatch } from '@/hooks/useNotionMatch';
import { useNotionShortlist } from '@/hooks/useNotionCandidates';
import { useProjectEnrollments } from '@/hooks/useProjectEnrollments';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  Search, Loader2, Users, Mail, Archive,
  Eye, FolderPlus, Target, Sparkles, Maximize2, Minimize2,
  ChevronRight, CheckCircle2, Database, ArrowUpDown, ArrowDown, ArrowUp, Clock,
  Rows3, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ModelPicker } from '@/components/ai/ModelPicker';

interface SearchResultsPanelProps {
  // Results
  results: LinkedInProfile[];
  mergedResults: LinkedInProfile[];
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
  
  // Readiness panel props
  searchSource?: 'linkedin' | 'database';
  onSourceChange?: (source: 'linkedin' | 'database') => void;
  onAutoFill?: () => void;
  autoFillLoading?: boolean;
  filtersReady?: boolean;
  accountName?: string | null;
  accountStatus?: string | null;
  
  // Treated candidates from DB
  treatedCandidates: Map<string, JobCandidateStatus>;
  onRestoreCandidate?: (candidateId: string) => void;
  
  // Modal state
  showBulkInMailModal: boolean;

  // Pool
  poolCount?: number;
  showPoolView?: boolean;
  onSetShowPoolView?: (v: boolean) => void;
  
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
  scoredSortBy: ScoredSortBy;
  onSetScoredSortBy: (v: ScoredSortBy) => void;
  onSetShowBulkInMailModal: (v: boolean) => void;
  onProfileTreated: (id: string) => void;
  onArchive: (profile: LinkedInProfile) => Promise<void>;
  onMessageSent: () => void;
  onSequenceEnrollSuccess: () => void;
  // Refine
  onRefineSearch: (direction: 'expand' | 'narrow') => void;
  refineLoading: boolean;
  
  // Batch report
  batchReport?: BatchReportEntry[];
  batchStats?: BatchScoringStatsType | null;
  batchDurationMs?: number;
  onClearBatchReport?: () => void;

  // Scoring model picker (per-mission, persisted in localStorage)
  scoringModel?: string | null;
  onScoringModelChange?: (model: string | null) => void;

  // Refs
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  loadMoreTriggerRef: React.RefObject<HTMLDivElement>;
}

const getCanonicalProfileUrl = (p: Pick<LinkedInProfile, 'profile_url' | 'public_profile_url'>) =>
  p.public_profile_url || p.profile_url || '';

const getProfileDisplayName = (p: Pick<LinkedInProfile, 'name' | 'first_name' | 'last_name'>) =>
  p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || undefined;

export const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  results,
  mergedResults,
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
  searchSource,
  onSourceChange,
  onAutoFill,
  autoFillLoading,
  filtersReady,
  accountName,
  accountStatus,
  treatedCandidates,
  onRestoreCandidate,
  showBulkInMailModal,
  poolCount = 0,
  showPoolView = true,
  onSetShowPoolView,
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
  scoredSortBy,
  onSetScoredSortBy,
  onSetShowBulkInMailModal,
  onProfileTreated,
  onArchive,
  onMessageSent,
  onSequenceEnrollSuccess,
  onRefineSearch,
  refineLoading,
  batchReport,
  batchStats: batchStatsData,
  batchDurationMs,
  onClearBatchReport,
  scoringModel,
  onScoringModelChange,
  scrollAreaRef,
  loadMoreTriggerRef,
}) => {
  // Profile detail sheet state
  const [detailProfile, setDetailProfile] = useState<LinkedInProfile | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // View mode (Compact / Detaille) — preference user persistee en localStorage
  type ViewMode = 'compact' | 'detailed';
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem('konekt_search_view_mode');
      return stored === 'compact' ? 'compact' : 'detailed';
    } catch {
      return 'detailed';
    }
  });
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try { localStorage.setItem('konekt_search_view_mode', mode); } catch { /* noop */ }
  }, []);

  const [enriching, setEnriching] = useState(false);

  // Contextual hints (dismissible, persisted in localStorage)
  const [hintSearchDismissed, setHintSearchDismissed] = useState(() =>
    localStorage.getItem('hint:after-first-search') === 'dismissed'
  );
  const [hintScoringDismissed, setHintScoringDismissed] = useState(() =>
    localStorage.getItem('hint:after-first-scoring') === 'dismissed'
  );
  const dismissHint = useCallback((key: string, setter: (v: boolean) => void) => {
    localStorage.setItem(key, 'dismissed');
    setter(true);
  }, []);

  const hasScoredProfiles = useMemo(() =>
    Object.keys(jobScores).length > 0, [jobScores]
  );

  const openProfileDetail = useCallback(async (profile: LinkedInProfile) => {
    setDetailProfile(profile);
    setDetailOpen(true);

    // If profile comes from Base Konekt and has a LinkedIn URL, enrich via Unipile
    const source = (profile as any)._source;
    const linkedinUrl = profile.public_profile_url || profile.profile_url || (profile as any).linkedin_url;

    // Enrich via Unipile if the profile lacks detailed data
    // Apollo provides work_experience titles but NO descriptions, NO summary, NO education details
    // So we check for data QUALITY, not just presence
    const hasSummary = !!(profile.summary || (profile as any).about);
    const hasEducation = ((profile as any).education?.length || 0) > 0;
    const hasDetailedExperience = profile.work_experience?.some(
      (w: any) => w.description || w.summary || w.bullet_points?.length
    );
    const hasSkills = (profile.skills?.length || 0) > 0;
    const needsEnrichment = !hasSummary || !hasEducation || !hasDetailedExperience || !hasSkills;

    if (source === 'database' && linkedinUrl && selectedAccount && needsEnrichment) {
      setEnriching(true);
      try {
        const { data } = await invokeUnipile({
          body: {
            action: 'get_profile',
            account_id: selectedAccount,
            profile_url: linkedinUrl,
          },
        });

        if (data?.success && data?.profile) {
          const enriched = data.profile as Record<string, unknown>;
          console.log('[SearchResults] Enrichment data keys:', Object.keys(enriched));
          console.log('[SearchResults] Enrichment work_exp:', (enriched.work_experience as any[])?.length || 0);
          console.log('[SearchResults] Enrichment education:', (enriched.education as any[])?.length || 0);
          console.log('[SearchResults] Enrichment skills:', (enriched.skills as any[])?.length || 0);
          console.log('[SearchResults] Enrichment summary:', (enriched.summary as string)?.slice(0, 100) || 'none');

          // Merge enriched data — only override fields that are non-empty
          // Prevents Apollo data from being wiped by empty Unipile responses
          const safeEnriched: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(enriched)) {
            if (value === null || value === undefined) continue;
            if (Array.isArray(value) && value.length === 0) continue;
            if (typeof value === 'string' && value.trim() === '') continue;
            safeEnriched[key] = value;
          }
          const merged: LinkedInProfile = {
            ...profile,         // Base Konekt data (keep as fallback)
            ...safeEnriched,    // Unipile data (only non-empty fields)
            id: profile.id,
            _source: (profile as any)._source,
          } as LinkedInProfile;
          setDetailProfile(merged);
          console.log('[SearchResults] Enriched Base Konekt profile via Unipile');
        }
      } catch (e) {
        console.warn('[SearchResults] Unipile enrichment failed (non-blocking):', e);
      } finally {
        setEnriching(false);
      }
    }
  }, [selectedAccount]);

  // Navigation helpers for profile detail sheet
  const detailIndex = useMemo(() => {
    if (!detailProfile) return -1;
    return filteredResults.findIndex(r => r.id === detailProfile.id);
  }, [detailProfile, filteredResults]);

  const navigatePrev = useMemo(() => {
    if (detailIndex <= 0) return undefined;
    return () => setDetailProfile(filteredResults[detailIndex - 1]);
  }, [detailIndex, filteredResults]);

  const navigateNext = useMemo(() => {
    if (detailIndex < 0 || detailIndex >= filteredResults.length - 1) return undefined;
    return () => setDetailProfile(filteredResults[detailIndex + 1]);
  }, [detailIndex, filteredResults]);


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
  const notionMatchInputs = useMemo(
    () => results.map((r) => ({ url: getCanonicalProfileUrl(r), name: getProfileDisplayName(r) })),
    [results]
  );
  const { getMatch: getNotionMatch } = useNotionMatch(notionMatchInputs);
  // Pre-fetch Notion shortlist data so it's available in ProfileDetailSheet & LinkedInResultCard
  useNotionShortlist();
  // Enrollments existants pour cette mission → permet d'afficher un badge
  // "En séquence X · Étape N" sur les cards. L'user voit immédiatement
  // qu'un candidat est déjà en séquence avant d'agir dessus.
  const enrollmentJobId = activeProject?.job_id || activeProject?.id || null;
  const { enrollments: projectEnrollments } = useProjectEnrollments(enrollmentJobId);
  // Count by status for filter badges — based on renderable profiles only
  const statusCounts = React.useMemo(() => {
    const counts = { scored: 0, scored_go: 0, scored_maybe: 0, scored_contacted: 0, scored_not_contacted: 0, messaged: 0, dismissed: 0, untreated: 0, known: 0 };
    const renderableIds = new Set(mergedResults.map((r) => r.id));

    // Count only candidates we can actually render in the current view universe
    for (const candidateId of renderableIds) {
      const s = treatedCandidates.get(candidateId);
      if (!s || s.status === 'discovered') { counts.untreated++; continue; }
      if (s.status === 'scored') {
        counts.scored++;
        counts.scored_not_contacted++;
        const rec = jobScores[candidateId]?.recommendation || s.recommendation;
        if (rec === 'go') counts.scored_go++;
        else if (rec === 'maybe') counts.scored_maybe++;
      }
      else if (s.status === 'messaged' || s.status === 'replied') {
        counts.messaged++;
        if (jobScores[candidateId] || s.score != null) {
          counts.scored++;
          counts.scored_contacted++;
          const rec = jobScores[candidateId]?.recommendation || s.recommendation;
          if (rec === 'go') counts.scored_go++;
          else if (rec === 'maybe') counts.scored_maybe++;
        }
      }
      else if (s.status === 'dismissed') counts.dismissed++;
    }

    // Count "known" from renderable profiles
    for (const r of mergedResults) {
      const profileUrl = getCanonicalProfileUrl(r);
      const notionMatch = getNotionMatch({
        url: profileUrl,
        name: getProfileDisplayName(r),
      });
      if (getAirtableMatch(profileUrl) || notionMatch) {
        counts.known++;
      }
    }

    return counts;
  }, [mergedResults, treatedCandidates, jobScores, getAirtableMatch, getNotionMatch]);

  // Apply "known" filter to filteredResults
  const displayResults = React.useMemo(() => {
    if (statusFilter !== 'known') return filteredResults;
    return filteredResults.filter(r => {
      const profileUrl = getCanonicalProfileUrl(r);
      return !!(
        getAirtableMatch(profileUrl) ||
        getNotionMatch({ url: profileUrl, name: getProfileDisplayName(r) })
      );
    });
  }, [filteredResults, statusFilter, getAirtableMatch, getNotionMatch]);

  return (
    <div className="bg-background border border-border rounded-xl flex w-full max-w-full min-w-0 flex-col min-h-[420px] lg:min-h-0 lg:h-full overflow-hidden">
      {/* HEADER: count clarifié + actions globales */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0 min-w-0">
        {hasSearched && (
          <div className="flex items-baseline gap-1.5 text-[12.5px] whitespace-nowrap">
            <span className="font-display font-bold text-foreground tabular-nums">{displayResults.length}</span>
            <span className="text-muted-foreground">candidat{displayResults.length > 1 ? 's' : ''} affiché{displayResults.length > 1 ? 's' : ''}</span>
            {total !== null && total > displayResults.length && (
              <span className="text-muted-foreground/60">· {total.toLocaleString()} total</span>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Pool toggle */}
        {poolCount > 0 && onSetShowPoolView && (
          <Button
            variant={showPoolView ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onSetShowPoolView(!showPoolView)}
            className="h-7 px-2.5 text-[11.5px] gap-1.5 rounded-full shrink-0"
            title={showPoolView ? 'Voir les nouveaux résultats' : 'Voir les profils déjà connus'}
          >
            <Database className="w-3 h-3" />
            {showPoolView ? 'Vue : Pool' : 'Vue : Résultats'}
          </Button>
        )}
      </div>

      {/* TOOLBAR: Status filters + actions — single compact row */}
      {selectedJob && hasSearched && displayResults.length > 0 && (
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border shrink-0 min-w-0 overflow-x-auto no-scrollbar">
          {/* Eyebrow label */}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0 hidden md:inline">
            Filtrer
          </span>

          {/* Status filter pills with explicit labels */}
          <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-full border border-border shrink-0">
            {([
              { value: 'all' as const,        label: 'Tous',         icon: '👥', count: mergedResults.length, tooltip: 'Tous les candidats' },
              { value: 'untreated' as const,  label: 'Non traités',  icon: '👁',  count: statusCounts.untreated, tooltip: 'Candidats pas encore évalués' },
              { value: 'scored' as const,     label: 'Scorés',       icon: '🎯', count: statusCounts.scored,    tooltip: 'Candidats déjà scorés par l\'IA' },
              { value: 'messaged' as const,   label: 'Contactés',    icon: '✉️', count: statusCounts.messaged,  tooltip: 'Candidats déjà contactés' },
              { value: 'known' as const,      label: 'Déjà connus',  icon: '📋', count: statusCounts.known,     tooltip: 'Candidats présents dans ton vivier' },
              { value: 'dismissed' as const,  label: 'Archivés',     icon: '📦', count: statusCounts.dismissed, tooltip: 'Candidats archivés / écartés' },
            ]).map(({ value, label, icon, count, tooltip }) => {
              const isActive = statusFilter === value ||
                (value === 'scored' && (statusFilter === 'scored_go' || statusFilter === 'scored_maybe' || statusFilter === 'scored_not_contacted'));
              return (
                <button
                  key={value}
                  onClick={() => onSetStatusFilter(value)}
                  title={tooltip}
                  className={`inline-flex items-center gap-1 h-6 px-2 text-[11.5px] rounded-full transition-colors shrink-0 ${
                    isActive
                      ? 'bg-foreground text-background font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                >
                  <span className="text-[11px]">{icon}</span>
                  <span className="hidden lg:inline">{label}</span>
                  {count > 0 && (
                    <span className={`tabular-nums ${isActive ? 'opacity-90' : 'text-muted-foreground/80'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-border shrink-0" />

          {/* Scorer les pertinents */}
          {selectedProfiles.size === 0 && selectedJob && filteredResults.some((p: any) => p._preScore?.tier === 'high' && !jobScores[p.id]) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const highTier = filteredResults
                  .filter((p: any) => p._preScore?.tier === 'high' && !jobScores[p.id])
                  .map(p => p.id);
                if (highTier.length === 0) {
                  toast.info('Aucun profil à haut potentiel non scoré');
                  return;
                }
                highTier.forEach(id => onToggleProfileSelection(id));
                toast.success(`${highTier.length} profils à haut potentiel sélectionnés`);
              }}
              className="h-7 px-3 text-[11.5px] gap-1.5 rounded-full text-emerald-500 hover:bg-emerald-500/10 shrink-0 font-medium"
              disabled={scoringInProgress}
              title="Sélectionne automatiquement les profils détectés comme à haut potentiel par l'IA pré-scoring (avant LLM)"
            >
              <Sparkles className="w-3 h-3" />
              <span className="hidden sm:inline">Sélectionner les top profils</span>
              <span className="sm:hidden">Top</span>
            </Button>
          )}

          {/* Bulk actions — pattern Gmail/Notion : compteur + actions
              avec labels visibles à partir de md (pas juste des icônes). */}
          {selectedProfiles.size > 0 && (
            <div className="flex items-center gap-1 shrink-0 bg-foreground/[0.04] rounded-lg border border-border px-2 py-1">
              <span className="text-[11px] font-semibold text-foreground px-1.5 py-0.5 rounded-md bg-foreground/10">
                {selectedProfiles.size} sélectionné{selectedProfiles.size > 1 ? 's' : ''}
              </span>
              <div className="w-px h-4 bg-border mx-0.5" aria-hidden="true" />
              <button
                onClick={onBatchScore}
                disabled={scoringInProgress}
                className="inline-flex items-center gap-1.5 h-7 px-2 text-[11px] font-medium rounded-md text-foreground hover:bg-foreground/10 transition-colors disabled:opacity-40"
                title="Scorer les profils sélectionnés"
              >
                {scoringInProgress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">Scorer</span>
              </button>
              {onScoringModelChange && (
                <div className="hidden lg:inline-flex">
                  <ModelPicker
                    actionId="scoring"
                    value={scoringModel}
                    onChange={onScoringModelChange}
                    compact
                    disabled={scoringInProgress}
                  />
                </div>
              )}
              <BulkEnrichButton
                profiles={selectableProfiles.filter(p => selectedProfiles.has(p.id))}
              />
              {activeProject && (
                <button
                  onClick={onBulkAddToProject}
                  className="inline-flex items-center gap-1.5 h-7 px-2 text-[11px] font-medium rounded-md text-success hover:bg-success/10 transition-colors"
                  title="Shortlister pour cette mission"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Shortlister</span>
                </button>
              )}
              {selectedAccount && (
                <SequenceEnrollButton
                  selectedProfiles={selectableProfiles.filter(p => selectedProfiles.has(p.id))}
                  accountId={selectedAccount}
                  selectedJob={selectedJob}
                  onSuccess={onSequenceEnrollSuccess}
                />
              )}
              {selectedAccount && (
                <button
                  onClick={() => onSetShowBulkInMailModal(true)}
                  className="inline-flex items-center gap-1.5 h-7 px-2 text-[11px] font-medium rounded-md text-foreground hover:bg-foreground/10 transition-colors"
                  title="Envoyer un InMail groupé"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">InMail</span>
                </button>
              )}
              <button
                onClick={onBulkDismiss}
                className="inline-flex items-center gap-1.5 h-7 px-2 text-[11px] font-medium rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                title="Archiver les profils sélectionnés"
              >
                <Archive className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Archiver</span>
              </button>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Eyebrow label "Affichage" */}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0 hidden lg:inline">
            Affichage
          </span>

          {/* View mode toggle (Compact / Détaillé) */}
          <div
            className="flex items-center bg-muted/40 p-0.5 rounded-full border border-border shrink-0"
            role="group"
            aria-label="Mode d'affichage"
          >
            <button
              onClick={() => setViewMode('compact')}
              className={`inline-flex items-center gap-1.5 h-6 px-2 text-[11.5px] rounded-full transition-colors ${
                viewMode === 'compact'
                  ? 'bg-foreground text-background font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Vue compacte (1 ligne par profil)"
              aria-pressed={viewMode === 'compact'}
            >
              <Rows3 className="w-3 h-3" aria-hidden="true" />
              <span className="hidden xl:inline">Compact</span>
            </button>
            <button
              onClick={() => setViewMode('detailed')}
              className={`inline-flex items-center gap-1.5 h-6 px-2 text-[11.5px] rounded-full transition-colors ${
                viewMode === 'detailed'
                  ? 'bg-foreground text-background font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Vue détaillée (mini-CV complet)"
              aria-pressed={viewMode === 'detailed'}
            >
              <Layers className="w-3 h-3" aria-hidden="true" />
              <span className="hidden xl:inline">Détaillé</span>
            </button>
          </div>

          {/* Sort by score */}
          {Object.keys(jobScores).length > 0 && (
            <button
              onClick={() => onSetSortByScore(!sortByScore)}
              className={`inline-flex items-center gap-1.5 h-6 px-2 text-[11.5px] rounded-full border transition-colors shrink-0 ${
                sortByScore
                  ? 'bg-foreground text-background border-foreground font-semibold'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
              }`}
              title={sortByScore ? 'Tri par score actif — clic pour désactiver' : 'Trier les profils par score décroissant'}
            >
              <Sparkles className="w-3 h-3" />
              <span className="hidden xl:inline">{sortByScore ? 'Tri ★ actif' : 'Trier par score'}</span>
              <span className="xl:hidden">★</span>
            </button>
          )}

          {/* Select all */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-border shrink-0">
            <Checkbox
              checked={allSelectableSelected && selectableProfiles.length > 0}
              onCheckedChange={onToggleSelectAll}
              id="select-all"
              className="h-3.5 w-3.5"
            />
            <label htmlFor="select-all" className="text-[11.5px] text-muted-foreground hover:text-foreground cursor-pointer select-none">
              Tout sélectionner
            </label>
          </div>
        </div>
      )}

      {/* Scored sub-filters (inline, only when scored active) */}
      {(statusFilter === 'scored' || statusFilter === 'scored_go' || statusFilter === 'scored_maybe') && statusCounts.scored > 0 && (
        <div className="flex items-center justify-between px-2 sm:px-3 py-1 border-b border-border/50 bg-muted/20 shrink-0 gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-px bg-muted/30 p-px border border-border shrink-0">
            {([
              { value: 'scored' as const, label: 'Tous', count: statusCounts.scored },
              { value: 'scored_go' as const, label: '✅ Go', count: statusCounts.scored_go },
              { value: 'scored_maybe' as const, label: '🤔 Maybe', count: statusCounts.scored_maybe },
            ]).map(({ value, label, count }) => (
              <button
                key={value}
                onClick={() => onSetStatusFilter(value)}
                className={`h-5 px-1.5 text-xs shrink-0 transition-colors ${
                  statusFilter === value
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label} {count > 0 && <span className="opacity-70">{count}</span>}
              </button>
            ))}
          </div>
          <Select value={scoredSortBy} onValueChange={(v) => onSetScoredSortBy(v as ScoredSortBy)}>
            <SelectTrigger className="h-5 w-auto min-w-[120px] max-w-[160px] text-xs border-border bg-muted/30 gap-1 px-1.5">
              <ArrowUpDown className="w-2.5 h-2.5 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score_desc" className="text-xs"><span className="flex items-center gap-1"><ArrowDown className="w-3 h-3" /> Score ↓</span></SelectItem>
              <SelectItem value="score_asc" className="text-xs"><span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /> Score ↑</span></SelectItem>
              <SelectItem value="recent" className="text-xs"><span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Récents</span></SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto" ref={scrollAreaRef}>
        {loading && results.length === 0 ? (
          <BrutalLoader variant="search" rows={5} />
        ) : !hasSearched ? (
          <div className="flex flex-col items-center justify-start pt-6 pb-24 text-muted-foreground px-4 sm:px-8">
            {activeProject ? (
              <SourcingReadinessPanel
                project={activeProject}
                selectedAccount={selectedAccount}
                searchSource={searchSource}
                onSourceChange={onSourceChange}
                onAutoFill={onAutoFill}
                autoFillLoading={autoFillLoading}
                onSearch={onSearch}
                filtersReady={filtersReady}
                accountName={accountName}
                accountStatus={accountStatus}
              />
            ) : (
              <SearchWelcomeMessage />
            )}
          </div>
        ) : displayResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground px-8">
            <div className="w-20 h-20 bg-muted flex items-center justify-center mb-6">
              <Search className="w-10 h-10" />
            </div>
            {/*
              Empty state contextualisé : on évite "Aucun profil trouvé →
              Élargir les filtres" quand en réalité l'user a juste tout traité
              dans le lot actuel et qu'il y a encore des profils à charger
              côté LinkedIn (pagination Unipile non épuisée).

              Cas 1 : statusFilter='untreated' + hasMoreResults + cursor
                → tous les profils chargés ont été traités, mais il reste des
                  profils à découvrir → CTA "Charger le lot suivant"
              Cas 2 : statusFilter ≠ 'all' + total > 0 (results filtrés mais
                d'autres profils existent dans d'autres statuts)
                → "Voir tous les profils" (reset statusFilter à 'all')
              Cas 3 (défaut) : vraie absence de résultats
                → "Élargir les filtres"
            */}
            {statusFilter === 'untreated' && hasMoreResults && cursor && results.length > 0 ? (
              <>
                <p className="text-lg font-medium text-foreground/60 mb-2">Lot actuel traité ✓</p>
                <p className="text-sm text-center max-w-md mb-4">
                  Tu as traité les {results.length} profils chargés.
                  {total !== null && total > results.length && (
                    <> Il reste <span className="font-semibold text-foreground">{total - results.length} profils</span> à découvrir sur LinkedIn.</>
                  )}
                </p>
                <Button
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="gap-2 bg-foreground text-background hover:bg-foreground/90"
                >
                  {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  Charger le lot suivant
                </Button>
              </>
            ) : statusFilter !== 'all' && (mergedResults.length > 0 || total !== null && total > 0) ? (
              <>
                <p className="text-lg font-medium text-foreground/60 mb-2">Aucun profil dans ce filtre</p>
                <p className="text-sm text-center max-w-md mb-4">
                  Tes profils sont peut-être dans une autre catégorie. Affiche tous les profils pour les retrouver.
                </p>
                <Button
                  onClick={() => onSetStatusFilter('all')}
                  variant="default"
                  className="gap-2"
                >
                  Voir tous les profils
                </Button>
              </>
            ) : (
              <>
                <p className="text-lg font-medium text-foreground/60 mb-2">Aucun profil trouvé</p>
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
            )}
          </div>
        ) : (
          <div className="p-2 sm:p-4 space-y-2 min-w-0">
            {/* Batch workflow banner */}
            {hasSearched && total !== null && total > 0 && (
              <div className="border border-border bg-accent/15 mb-3 overflow-hidden">
                <div className="h-0.5 bg-accent" />
                <div className="p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* Left: bold typographic count */}
                    <div className="flex items-baseline gap-2 min-w-0">
                      <NumberTicker
                        value={total}
                        className="text-3xl sm:text-4xl font-black text-foreground tabular-nums tracking-tighter leading-none"
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          profils trouvés
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/70">
                            {displayResults.length} affichés sur {total}
                          </span>
                          {statusCounts.untreated === 0 && displayResults.length > 0 && cursor && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-emerald-500">
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
                        className="h-8 px-2.5 gap-1 text-xs font-bold uppercase tracking-wider border-border text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                      >
                        {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Maximize2 className="w-3 h-3" />}
                        Élargir
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRefineSearch('narrow')}
                        disabled={refineLoading}
                        className="h-8 px-2.5 gap-1 text-xs font-bold uppercase tracking-wider border-border text-muted-foreground hover:text-foreground hover:border-border transition-colors"
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
                      <span className="text-xs text-muted-foreground/60 tabular-nums whitespace-nowrap">
                        {Math.round((results.length / total) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Batch summary removed — report below is sufficient */}

            {/* Batch scoring report */}
            {batchReport && batchReport.length > 0 && (
              <BatchScoringReport
                entries={batchReport}
                stats={batchStatsData || null}
                durationMs={batchDurationMs}
                onClose={onClearBatchReport}
              />
            )}

            {/* Transition CTA: Go candidates ready for outreach */}
            {(() => {
              const goProfiles = Object.values(jobScores).filter(s => s.recommendation === 'go');
              const goCount = goProfiles.length;
              if (goCount > 0 && activeProject && !scoringInProgress) {
                return (
                  <div className="border border-success/30 bg-success/5 p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {goCount} candidat{goCount > 1 ? 's' : ''} scoré{goCount > 1 ? 's' : ''} Go
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Inscrivez-les dans une séquence d'outreach pour les contacter automatiquement.
                      </p>
                    </div>
                    <SequenceEnrollButton
                      // 🐛 BUG FIX (Opus audit) : jobScores est indexé par `profile.id`
                      // (voir useLinkedInScoring.ts:478 `setJobScores(prev => ({ ...prev, [profile.id]: mapped }))`),
                      // pas par `public_identifier` ni `provider_id`. Avant, ce filter
                      // retournait 0 profils silencieusement → le bouton envoyait une
                      // séquence vide en croyant avoir N candidats "Go".
                      selectedProfiles={filteredResults.filter(p => jobScores[p.id]?.recommendation === 'go')}
                      accountId={selectedAccount}
                      selectedJob={selectedJob}
                      onSuccess={onSequenceEnrollSuccess}
                    />
                  </div>
                );
              }
              return null;
            })()}

            {/* Contextual hint: after first search */}
            <AnimatePresence>
              {hasSearched && !hintSearchDismissed && !hasScoredProfiles && displayResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border border-accent/30 bg-accent/5 p-3 flex items-start gap-2.5"
                >
                  <span className="text-sm shrink-0">🎯</span>
                  <p className="text-xs text-foreground/80 leading-relaxed flex-1">
                    Sélectionnez les profils intéressants et cliquez <strong className="text-foreground">Score</strong> pour que l'IA les évalue selon votre brief.
                  </p>
                  <button
                    onClick={() => dismissHint('hint:after-first-search', setHintSearchDismissed)}
                    className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                  >✕</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Contextual hint: after first scoring batch */}
            <AnimatePresence>
              {hasScoredProfiles && !hintScoringDismissed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border border-accent/30 bg-accent/5 p-3 flex items-start gap-2.5"
                >
                  <span className="text-sm shrink-0">🟢</span>
                  <p className="text-xs text-foreground/80 leading-relaxed flex-1">
                    Les profils sont scorés ! Les <strong className="text-accent">Go</strong> sont les meilleurs matchs. Envoyez-leur un message ou ajoutez-les au pipeline.
                  </p>
                  <button
                    onClick={() => dismissHint('hint:after-first-scoring', setHintScoringDismissed)}
                    className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                  >✕</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Vue table compacte — quand viewMode === 'compact', on bascule
                sur une vraie table avec colonnes critères au lieu des cards.
                Plus dense, scan rapide, comparable + column picker. */}
            {viewMode === 'compact' && displayResults.length > 0 && (
              <CompactResultsTable
                profiles={displayResults}
                selectedJob={selectedJob}
                jobScores={jobScores}
                selectedProfiles={selectedProfiles}
                treatedCandidates={treatedCandidates}
                onToggleSelect={onToggleProfileSelection}
                onToggleSelectAll={onToggleSelectAll}
                allSelected={allSelectableSelected}
                onOpenDetail={openProfileDetail}
                onArchive={selectedJob ? onArchive : undefined}
                storageKey={selectedJob?.id || 'no-job'}
              />
            )}

            {/* Vue cards (mode 'detailed') — chaque profil dans sa card riche */}
            {viewMode !== 'compact' && displayResults.map((profile, index) => (
              <motion.div
                key={profile.id || `profile-${index}`}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  delay: Math.min(index * 0.05, 1.2),
                  duration: 0.35,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
                className="transition-shadow duration-200 hover:shadow-md"
              >
                <LinkedInResultCard
                  profile={profile}
                  selectedJob={selectedJob}
                  isSelected={selectedProfiles.has(profile.id)}
                  isBatchScoring={scoringInProgress}
                  viewMode={viewMode}
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
                  enrollmentInfo={projectEnrollments.get(profile.id) || null}
                  airtableMatch={getAirtableMatch(getCanonicalProfileUrl(profile))}
                  notionMatch={getNotionMatch({ url: getCanonicalProfileUrl(profile), name: getProfileDisplayName(profile) })}
                  onOpenDetail={() => openProfileDetail(profile)}
                />
              </motion.div>
            ))}

            {/* Next batch / Load more */}
            <div ref={loadMoreTriggerRef} className="py-4">
              {loadingMore && (
                <div className="border border-border bg-accent/10 p-4 sm:p-6">
                  <BrutalLoader
                    variant="search"
                    messages={[
                      'Chargement du lot suivant…',
                      'On recrute les meilleurs profils…',
                      'Encore quelques secondes…',
                      'LinkedIn nous répond…',
                      'Tri des nouveaux candidats…',
                      'Bientôt 25 nouveaux profils…',
                      'Ça arrive, promis…',
                    ]}
                    rows={3}
                    compact={false}
                  />
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
                        className="gap-2 bg-foreground text-background hover:bg-foreground/90"
                        size="default"
                      >
                        Lot suivant
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground">
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
                <div className="text-center py-3">
                  <div className="flex flex-col items-center gap-2 p-4 border border-dashed border-muted-foreground/30 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                      <Search className="w-4 h-4" />
                      Fin des résultats LinkedIn
                    </div>
                    <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
                      {total !== null && results.length < total
                        ? `${results.length} profils chargés sur ${total} disponibles (certains filtrés côté client).`
                        : `Tous les profils ont été parcourus (${results.length}).`
                      }
                      {' '}Élargissez vos filtres ou modifiez vos mots-clés pour trouver plus de candidats.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onSearch}
                      className="gap-1.5 text-xs mt-1"
                    >
                      <Search className="w-3 h-3" />
                      Relancer la recherche
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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
        notionMatch={detailProfile ? getNotionMatch({ url: getCanonicalProfileUrl(detailProfile), name: getProfileDisplayName(detailProfile) }) : undefined}
        onScoreProfile={detailProfile ? () => onScoreProfile(detailProfile) : undefined}
        onArchive={detailProfile && selectedJob ? () => onArchive(detailProfile) : undefined}
        onMessageSent={onMessageSent}
        onSequenceEnroll={onSequenceEnrollSuccess}
        onProfileTreated={detailProfile ? () => onProfileTreated(detailProfile.id) : undefined}
        onNavigatePrev={navigatePrev}
        onNavigateNext={navigateNext}
        currentIndex={detailIndex >= 0 ? detailIndex : undefined}
        totalCount={filteredResults.length}
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
    <motion.div
      className="text-center mb-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="w-16 h-16 bg-foreground text-background flex items-center justify-center mx-auto mb-4"
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
      >
        <Search className="w-8 h-8" />
      </motion.div>
      <h3 className="text-xl font-semibold text-foreground mb-2">
        Recherche LinkedIn
      </h3>
      <p className="text-sm text-muted-foreground">
        Trouvez des candidats qualifiés en utilisant les filtres avancés
      </p>
    </motion.div>

    <div className="space-y-4">
      {[
        {
          num: '1',
          title: 'Sélectionnez un poste',
          content: <p className="text-sm text-muted-foreground ml-8">Choisissez un <strong>poste de référence</strong> dans le panneau de gauche.</p>,
          bg: 'bg-muted/50 border-border',
        },
        {
          num: '2',
          title: 'Recherchez des profils',
          content: (
            <ul className="text-sm text-muted-foreground space-y-2 ml-8">
              <li>• Configurez vos filtres ou utilisez <strong>Auto-fill</strong></li>
              <li>• Cliquez sur <strong>Rechercher</strong></li>
            </ul>
          ),
          bg: 'bg-muted/30 border-border',
        },
        {
          num: '3',
          title: 'Sélectionnez et scorez',
          content: <p className="text-sm text-muted-foreground ml-8">Sélectionnez les profils, puis cliquez sur <strong><Target className="w-3 h-3 inline" /> Scorer</strong>.</p>,
          bg: 'bg-muted border-border',
        },
        {
          num: '4',
          title: 'Ajoutez ou archivez',
          content: (
            <ul className="text-sm text-muted-foreground space-y-1 ml-8">
              <li>• <strong><FolderPlus className="w-3 h-3 inline" /> Ajouter au projet</strong></li>
              <li>• <strong><Archive className="w-3 h-3 inline" /> Archiver</strong></li>
            </ul>
          ),
          bg: 'bg-muted/50 border-border',
        },
      ].map((step, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 + i * 0.1, duration: 0.4, ease: 'easeOut' }}
          className={`${step.bg} border p-4 transition-all duration-200 hover:translate-x-1`}
        >
          <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
            <motion.span
              className="w-6 h-6 bg-foreground text-background text-xs flex items-center justify-center"
              whileHover={{ scale: 1.2, rotate: 5 }}
            >
              {step.num}
            </motion.span>
            {step.title}
          </h4>
          {step.content}
        </motion.div>
      ))}
    </div>
  </div>
);
