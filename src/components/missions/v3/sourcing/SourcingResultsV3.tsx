// Refonte mission, écran Sourcing de la nouvelle page (conception 5.1, maquette
// Sourcing) : les résultats de la recherche en trois groupes, À trier, Retenus
// et Écartés, sous une rangée « N profils chargés » et son seul bouton
// (« Relancer avec les nouveaux filtres » ou « Voir la suite »).
//
// Rendu seulement : la recherche, la notation et les écritures restent celles
// de LinkedInSearch (useLinkedInSearch, useLinkedInScoring,
// useJobCandidateStatus, qui écrit l'étape par src/lib/candidateStage.ts).
// Pas de date de recherche ni de tri un par un (lot 4), pas d'« Annuler » dans
// les messages (annulation non branchée), pas de raisons d'écart au choix.
//
// Design simplifié (04/10/2026, docs/design/06-simplicite.md) : une seule rangée
// (puces d'état sans cadre, comme au Pipeline, et bascule d'affichage sur fond
// neutre) ; « Noter » est le seul bouton plein de l'écran, son coût écrit à côté ;
// lignes avec visage et note en anneau ; décisions en boutons discrets ; une
// seule phrase de pied de liste, qui dit combien de profils sont chargés.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Mail, Maximize2, Search, Sparkles, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconTile } from '@/components/ui/IconTile';
import { Illustration } from '@/components/ui/illustration';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { SequenceEnrollButton } from '@/components/outreach/SequenceEnrollButton';
import { BulkEnrichButton } from '@/components/outreach/result-card/BulkEnrichButton';
import type { LinkedInProfile } from '@/components/outreach/types';
import type { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import type { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import type { Job } from '@/types/jobs';
import { ACTION_COSTS } from '@/types/aiCredits';
import { GENERAL_STAGE_LABEL } from '@/lib/stageDisplay';
import { missionV3Path } from '@/lib/missionBeta';
import { plural } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { ScorePill } from '../pipeline/CandidateListRow';
import {
  SOURCING_GROUPS,
  SOURCING_GROUP_LABEL,
  isAiSkip,
  joinNames,
  noteOf,
  reasonOf,
  isGoRecommendation,
  recommendationOf,
  rejectedReasonOf,
  retainedStageOf,
  scoreButtonText,
  scoreCostText,
  sortToSort,
  sourcingGroupOf,
  type ReasonTone,
  type SourcingGroup,
} from './sourcingGroups';

/** Nombre de profils notés d'un clic (même lot que « Scorer les 20 premiers »). */
const SCORE_BATCH = 20;
const SCORING_FLOOR = ACTION_COSTS.scoring?.floor ?? 2;

/**
 * Affichages des profils à trier : « Tri » (une ligne de décision, la maquette),
 * « Liste » (tableau dense de l'ancienne recherche : années d'expérience,
 * postes, formation, compétences) et « Détaillé » (une fiche par profil). Le
 * choix est gardé par SearchResultsPanel, dans la même clé que l'ancienne
 * recherche ; la Liste reste l'affichage par défaut.
 */
export type SourcingView = 'triage' | 'compact' | 'detailed';
const VIEW_OPTIONS: ReadonlyArray<{ value: SourcingView; label: string }> = [
  { value: 'triage', label: 'Tri' },
  { value: 'compact', label: 'Liste' },
  { value: 'detailed', label: 'Détaillé' },
];

/** Puces d'état : mêmes formes que la barre d'étapes du Pipeline (32 px, cible de 44 px sur téléphone). */
const CHIP_SHAPE =
  'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors duration-150 ease-out ' +
  'before:absolute before:inset-x-0 before:-inset-y-1.5 sm:before:hidden ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const CHIP_ACTIVE = 'bg-muted font-semibold text-foreground';
const CHIP_IDLE = 'text-foreground-secondary hover:bg-accent hover:text-foreground';

/** Zone de toucher de 44 px autour d'une case de 16 px, sur téléphone. */
const TAP_CHECKBOX = 'relative before:absolute before:-inset-3.5 sm:before:hidden';

/** Boutons de décision d'une ligne : sans cadre, 44 px sur téléphone. Retenir à l'encre, Écarter (retrait) au gris secondaire. */
const DECISION_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground max-sm:h-11 max-sm:w-11';

const REASON_TONE: Record<ReasonTone, string> = {
  muted: 'text-muted-foreground',
  ai: 'text-warning',
  default: 'text-foreground-secondary',
};

export function profileName(p: Pick<LinkedInProfile, 'name' | 'first_name' | 'last_name'>): string {
  return (p.name || `${p.first_name || ''} ${p.last_name || ''}`).trim() || 'Profil sans nom';
}

interface Row {
  profile: LinkedInProfile;
  name: string;
  status: JobCandidateStatus | undefined;
  score: JobMatchResult | undefined;
  note: number | null;
  group: SourcingGroup;
}

export interface SourcingResultsV3Props {
  /** Profils affichables : résultats de la recherche en cours, retenus et écartés de la mission. */
  profiles: LinkedInProfile[];
  /** Résultats de la recherche en cours (compte « chargés »). */
  results: LinkedInProfile[];
  loading: boolean;
  loadingMore: boolean;
  hasSearched: boolean;
  hasMoreResults: boolean;
  cursor: string | null;
  total: number | null;
  selectedJob: Job | null;
  selectedProfiles: Set<string>;
  jobScores: Record<string, JobMatchResult>;
  scoringInProgress: boolean;
  canBatchScore: boolean;
  treatedCandidates: Map<string, JobCandidateStatus>;
  selectedAccount: string | null;
  activeProject: SourcingProject | null | undefined;
  chipsDirty: boolean;
  refineLoading: boolean;
  scrollAreaRef: RefObject<HTMLDivElement>;
  onRerun?: () => void;
  onLoadMore: () => void;
  onRefineSearch: (direction: 'expand' | 'narrow') => void;
  onSetSelection: (ids: string[]) => void;
  onToggleProfileSelection: (id: string) => void;
  onBatchScore: (profileIds?: string[]) => void;
  onRetainProfiles: (profiles: LinkedInProfile[]) => Promise<void>;
  onDismissProfiles: (profiles: LinkedInProfile[]) => Promise<void>;
  onRestoreCandidate?: (candidateId: string) => Promise<void> | void;
  onOpenProfile: (profile: LinkedInProfile) => void;
  /** Ordre du groupe affiché, pour les flèches de la fiche. */
  onOrderChange?: (profiles: LinkedInProfile[]) => void;
  onOpenInMail: () => void;
  onSequenceEnrollSuccess: () => void;
  /** Affichage des profils à trier et son changement (choix gardé par SearchResultsPanel). */
  view?: SourcingView;
  onViewChange?: (view: SourcingView) => void;
  /** Tableau dense des profils à trier (affichage « Liste ») ; fourni par SearchResultsPanel. */
  renderCompact?: (args: { profiles: LinkedInProfile[]; allSelected: boolean; onToggleSelectAll: () => void }) => ReactNode;
  /** Fiche d'un profil (affichage « Détaillé ») ; fournie par SearchResultsPanel. */
  renderCard?: (profile: LinkedInProfile, index: number) => ReactNode;
}

export function SourcingResultsV3(props: SourcingResultsV3Props) {
  const {
    profiles, results, loading, loadingMore, hasSearched, hasMoreResults, cursor, total, selectedJob,
    selectedProfiles, jobScores, scoringInProgress, canBatchScore, treatedCandidates, selectedAccount,
    activeProject, chipsDirty, refineLoading, scrollAreaRef, onRerun, onLoadMore, onRefineSearch, onSetSelection,
    onToggleProfileSelection, onBatchScore, onRetainProfiles, onDismissProfiles, onRestoreCandidate, onOpenProfile,
    onOrderChange, onOpenInMail, onSequenceEnrollSuccess, renderCompact, renderCard, view = 'compact', onViewChange,
  } = props;

  const [tab, setTab] = useState<SourcingGroup>('to_sort');
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [scoringIds, setScoringIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmAi, setConfirmAi] = useState(false);
  const tabRefs = useRef<Record<SourcingGroup, HTMLButtonElement | null>>({ to_sort: null, retained: null, rejected: null });
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const focusIndexRef = useRef<number | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const aiTriggerRef = useRef<HTMLButtonElement>(null);
  const selectAllRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);
  // Annonce vocale du chargement de la suite : le bouton « Voir la suite » reste en place (le focus ne se perd pas).
  const [loadAnnouncement, setLoadAnnouncement] = useState('');
  const wasLoadingMoreRef = useRef(false);

  const rows = useMemo<Row[]>(() => profiles.map((profile) => {
    const status = treatedCandidates.get(profile.id);
    const score = jobScores[profile.id];
    return {
      profile,
      name: profileName(profile),
      status,
      score,
      note: noteOf(score, status),
      group: sourcingGroupOf(status),
    };
  }), [profiles, treatedCandidates, jobScores]);

  const groups = useMemo(() => {
    const byGroup: Record<SourcingGroup, Row[]> = { to_sort: [], retained: [], rejected: [] };
    for (const row of rows) byGroup[row.group].push(row);
    byGroup.to_sort = sortToSort(byGroup.to_sort, (row) => row.note);
    byGroup.retained = sortToSort(byGroup.retained, (row) => row.note);
    return byGroup;
  }, [rows]);

  const toSort = groups.to_sort;
  const unscored = useMemo(() => toSort.filter((row) => row.note === null), [toSort]);
  const toScore = useMemo(() => unscored.slice(0, SCORE_BATCH), [unscored]);
  const aiSuggestions = useMemo(() => toSort.filter((row) => isAiSkip(row.score, row.status)), [toSort]);
  const selectedRows = useMemo(() => toSort.filter((row) => selectedProfiles.has(row.profile.id)), [toSort, selectedProfiles]);
  const newlyRetained = useMemo(
    () => groups.retained.filter((row) => retainedStageOf(row.status) === 'retained'),
    [groups.retained],
  );

  const loadedLabel = `${plural(results.length, 'profil chargé', 'profils chargés')}${
    total !== null && total > results.length ? ` sur ${total.toLocaleString('fr-FR')}` : ''
  }`;
  useEffect(() => {
    if (loadingMore) {
      wasLoadingMoreRef.current = true;
      setLoadAnnouncement('Chargement de la suite');
      return;
    }
    if (!wasLoadingMoreRef.current) return;
    wasLoadingMoreRef.current = false;
    setLoadAnnouncement(`${loadedLabel}.`);
  }, [loadingMore, loadedLabel]);

  // Fin de notation : plus de « Notation en cours » sur les lignes lancées.
  useEffect(() => {
    if (!scoringInProgress && scoringIds.size > 0) setScoringIds(new Set());
  }, [scoringInProgress, scoringIds.size]);

  // Après une décision sur une ligne, le focus passe à la ligne suivante du groupe.
  useEffect(() => {
    const index = focusIndexRef.current;
    if (index === null || !tbodyRef.current) return;
    focusIndexRef.current = null;
    const names = tbodyRef.current.querySelectorAll<HTMLButtonElement>('button[data-row-name]');
    const target = names[Math.min(index, names.length - 1)];
    target?.focus();
  }, [groups, pending]);

  // Confirmation des suggestions de l'IA : le focus y entre, puis revient au
  // bouton d'origine (ou à « Tout sélectionner » s'il a disparu).
  useEffect(() => {
    if (confirmAi) {
      wasConfirmingRef.current = true;
      confirmRef.current?.focus();
      return;
    }
    if (!wasConfirmingRef.current) return;
    wasConfirmingRef.current = false;
    (aiTriggerRef.current ?? selectAllRef.current)?.focus();
  }, [confirmAi]);

  const visibleOrder = groups[tab];
  useEffect(() => {
    onOrderChange?.(visibleOrder.map((row) => row.profile));
  }, [visibleOrder, onOrderChange]);

  useEffect(() => {
    if (confirmAi && aiSuggestions.length === 0) setConfirmAi(false);
  }, [confirmAi, aiSuggestions.length]);

  const run = useCallback(async (list: Row[], action: (p: LinkedInProfile[]) => Promise<void>, focusIndex?: number) => {
    const ids = list.map((row) => row.profile.id);
    setPending((prev) => new Set([...prev, ...ids]));
    try {
      await action(list.map((row) => row.profile));
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (focusIndex !== undefined) focusIndexRef.current = focusIndex;
    }
  }, []);

  const pickTab = (next: SourcingGroup) => {
    if (next === tab) return;
    setTab(next);
    wasConfirmingRef.current = false;
    setConfirmAi(false);
    if (selectedProfiles.size > 0) onSetSelection([]);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = SOURCING_GROUPS.indexOf(tab);
    let next: SourcingGroup | null = null;
    if (e.key === 'ArrowRight') next = SOURCING_GROUPS[(index + 1) % SOURCING_GROUPS.length];
    if (e.key === 'ArrowLeft') next = SOURCING_GROUPS[(index + SOURCING_GROUPS.length - 1) % SOURCING_GROUPS.length];
    if (e.key === 'Home') next = SOURCING_GROUPS[0];
    if (e.key === 'End') next = SOURCING_GROUPS[SOURCING_GROUPS.length - 1];
    if (!next) return;
    e.preventDefault();
    pickTab(next);
    tabRefs.current[next]?.focus();
  };

  const scoreRows = (list: Row[]) => {
    const ids = list.map((row) => row.profile.id);
    if (ids.length === 0) return;
    setScoringIds(new Set(ids));
    onBatchScore(ids);
  };

  // ------------------------------------------------------------ chargement

  if (loading && results.length === 0) {
    return (
      <div role="status" aria-busy="true" aria-label="Chargement des résultats" className="flex min-h-[420px] flex-col">
        <div className="flex h-8 items-center gap-3">
          <span className="h-3.5 w-52 rounded bg-muted" />
          <span className="h-3.5 w-36 rounded bg-muted/60" />
          <span className="ml-auto hidden h-8 w-64 rounded-lg bg-muted/70 sm:block" />
        </div>
        <div className="mt-2.5 flex h-8 items-center gap-2 pl-2">
          <span className="h-4 w-4 rounded bg-muted" />
          <span className="h-8 w-32 rounded-lg bg-muted/70" />
          <span className="hidden h-8 w-80 rounded-lg bg-muted/50 sm:block" />
        </div>
        <div className="mt-2.5 h-[30px] border-b border-border" />
        {[62, 48, 70, 55, 66, 44, 58, 50].map((w, i) => (
          <div key={i} className="flex h-[52px] items-center gap-3 border-b border-border/50 px-2">
            <span className="h-4 w-4 shrink-0 rounded bg-muted/70" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="h-3 rounded bg-muted" style={{ width: `${w}%` }} />
              <span className="h-2.5 w-2/5 rounded bg-muted/50" />
            </span>
            <span className="hidden h-3 flex-1 rounded bg-muted/60 sm:block" />
            <span className="h-3 w-6 rounded bg-muted" />
            <span className="hidden h-3 flex-1 rounded bg-muted/50 md:block" />
          </div>
        ))}
      </div>
    );
  }

  // ------------------------------------------------------------ aucun profil

  if (hasSearched && !loading && profiles.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-16 text-center">
        <IconTile icon={Search} size="lg" aria-hidden="true" className="mb-4" />
        <p className="text-base font-semibold text-foreground">Aucun profil trouvé</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">Essayez d'ajuster vos filtres pour élargir votre recherche.</p>
        {chipsDirty && onRerun && (
          <Button variant="primary" className="mt-4" onClick={onRerun} disabled={loading}>
            Relancer avec les nouveaux filtres
          </Button>
        )}
        {selectedJob && (
          <Button
            variant={chipsDirty && onRerun ? 'ghost' : 'primary'}
            className={cn('gap-2', chipsDirty && onRerun ? 'mt-2' : 'mt-4')}
            onClick={() => onRefineSearch('expand')}
            disabled={refineLoading}
          >
            {refineLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
            Élargir les filtres avec l'IA
          </Button>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ résultats

  const canLoadMore = hasMoreResults && !!cursor;
  const allToSortSelected = toSort.length > 0 && selectedRows.length === toSort.length;
  const someToSortSelected = selectedRows.length > 0 && !allToSortSelected;
  const activeTabId = `sourcing-onglet-${tab}`;
  // Les affichages riches ne concernent que les profils à trier ; Retenus et
  // Écartés gardent leur tableau (étape, « Remettre à trier »).
  const richAvailable = !!renderCompact && !!renderCard && tab === 'to_sort';
  const richCompact = richAvailable && view === 'compact';
  const richDetailed = richAvailable && view === 'detailed';
  // Écartés : la colonne « Raison » n'existe que si au moins une ligne a une raison à lire.
  const showReason = tab === 'to_sort' || (tab === 'rejected' && groups.rejected.some((row) => rejectedReasonOf(row.status) !== ''));

  return (
    <div className="flex min-h-[420px] w-full min-w-0 flex-col lg:h-full lg:min-h-0">
      {/* Rangée B : une seule rangée, comme au Pipeline : puces d'état sans cadre et bascule d'affichage. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div role="tablist" aria-label="Groupes de résultats" className="flex shrink-0 items-center gap-1">
          {SOURCING_GROUPS.map((group) => {
            const selected = group === tab;
            const count = groups[group].length;
            return (
              <button
                key={group}
                ref={(el) => { tabRefs.current[group] = el; }}
                type="button"
                role="tab"
                id={`sourcing-onglet-${group}`}
                // Le nom garde le chiffre, zéro compris : seul l'affichage l'omet.
                aria-label={`${SOURCING_GROUP_LABEL[group]} ${count}`}
                aria-selected={selected}
                aria-controls="sourcing-groupe"
                tabIndex={selected ? 0 : -1}
                onClick={() => pickTab(group)}
                onKeyDown={onTabKey}
                className={cn(CHIP_SHAPE, selected ? CHIP_ACTIVE : CHIP_IDLE)}
              >
                <span className={cn(count === 0 && !selected && 'text-muted-foreground')}>{SOURCING_GROUP_LABEL[group]}</span>
                {count > 0 && (
                  <span className="font-semibold tabular-nums text-foreground" aria-hidden="true">
                    {count.toLocaleString('fr-FR')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {chipsDirty && onRerun && (
          <button
            type="button"
            onClick={onRerun}
            disabled={loading}
            className="inline-flex h-8 items-center rounded-md px-1 text-sm text-brand underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:no-underline max-sm:min-h-11"
          >
            {loading ? 'Recherche en cours' : 'Relancer avec les nouveaux filtres'}
          </button>
        )}
        {renderCompact && renderCard && onViewChange && (
          <div role="group" aria-label="Affichage des profils à trier" className="ml-auto inline-flex shrink-0 items-center rounded-lg bg-muted p-0.5">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => onViewChange(option.value)}
                className={cn(
                  'relative inline-flex h-8 items-center rounded-md px-3 text-sm transition-colors duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-1.5 sm:before:hidden',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  view === option.value ? 'bg-card font-semibold text-foreground dark:bg-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <section id="sourcing-groupe" role="tabpanel" aria-labelledby={activeTabId} className="flex min-h-0 flex-1 flex-col">
        {/* Rangée C : actions du groupe. */}
        {tab === 'to_sort' && !confirmAi && (
          <div role="toolbar" aria-label="Actions sur les profils à trier" className={cn('mt-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2', !richCompact && 'pl-2')}>
            {!richCompact && (
              <Checkbox
                ref={selectAllRef}
                checked={allToSortSelected ? true : someToSortSelected ? 'indeterminate' : false}
                disabled={toSort.length === 0}
                onCheckedChange={(value) => onSetSelection(value === true ? toSort.map((row) => row.profile.id) : [])}
                aria-label="Tout sélectionner"
                className={cn('mr-1.5', TAP_CHECKBOX)}
              />
            )}
            {selectedJob && canBatchScore && (scoringInProgress ? (
              <Button variant="ghost" size="sm" disabled className="max-sm:min-h-11">
                <Loader2 className="animate-spin" aria-hidden="true" />
                Notation en cours
              </Button>
            ) : toScore.length > 0 ? (
              // Le seul bouton plein de l'écran ; le coût s'écrit à côté, en texte discret.
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => scoreRows(toScore)}
                  aria-describedby="sourcing-cout-notation"
                  className="tabular-nums max-sm:min-h-11"
                >
                  {scoreButtonText(toScore.length, unscored.length)}
                </Button>
                <span id="sourcing-cout-notation" className="text-sm tabular-nums text-muted-foreground">
                  {scoreCostText(toScore.length, SCORING_FLOOR)}
                </span>
              </>
            ) : null)}
            {aiSuggestions.length > 0 && (
              <Button ref={aiTriggerRef} variant="ghost" size="sm" onClick={() => setConfirmAi(true)} className="text-foreground-secondary hover:text-foreground max-sm:min-h-11">
                {aiSuggestions.length > 1
                  ? `Écarter les ${aiSuggestions.length} suggestions de l'IA`
                  : "Écarter la suggestion de l'IA"}
              </Button>
            )}
          </div>
        )}
        {tab === 'to_sort' && confirmAi && (
          <div
            role="group"
            aria-labelledby="sourcing-confirmation-ia"
            onKeyDown={(e) => { if (e.key === 'Escape') setConfirmAi(false); }}
            className="mt-3 flex min-h-8 flex-wrap items-center gap-2 rounded-lg bg-muted/60 py-1 pl-3 pr-1"
          >
            <span id="sourcing-confirmation-ia" className="min-w-0 flex-1 text-sm text-foreground">
              Écarter {joinNames(aiSuggestions.map((row) => row.name))}, selon l'IA ? La décision vous revient.
            </span>
            <Button
              ref={confirmRef}
              size="sm"
              variant="destructive"
              className="max-sm:min-h-11"
              disabled={aiSuggestions.some((row) => pending.has(row.profile.id))}
              onClick={async () => {
                const list = aiSuggestions;
                await run(list, onDismissProfiles);
                setConfirmAi(false);
              }}
            >
              {aiSuggestions.length > 1 ? `Écarter les ${aiSuggestions.length}` : 'Écarter'}
            </Button>
            <Button size="sm" variant="ghost" className="max-sm:min-h-11" onClick={() => setConfirmAi(false)}>
              Annuler
            </Button>
          </div>
        )}
        {tab === 'retained' && (
          <div className="mt-3 flex min-h-8 flex-wrap items-center gap-2 pl-2 max-sm:flex-col max-sm:items-start">
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              Profils retenus depuis vos recherches. Les retenus suivent leur étape dans le Pipeline, avec ceux de toute l'équipe.
            </span>
            {selectedAccount && newlyRetained.length > 0 && (
              <SequenceEnrollButton
                selectedProfiles={newlyRetained.map((row) => row.profile)}
                accountId={selectedAccount}
                selectedJob={selectedJob}
                onSuccess={onSequenceEnrollSuccess}
                triggerLabel={newlyRetained.length > 1
                  ? `Contacter les ${newlyRetained.length} nouveaux retenus`
                  : `Contacter ${newlyRetained[0].name}`}
                quiet
              />
            )}
            {activeProject && (
              <Button asChild variant="ghost" size="sm" className="max-sm:min-h-11">
                <Link to={missionV3Path(activeProject.id)}>Ouvrir le Pipeline</Link>
              </Button>
            )}
          </div>
        )}
        {tab === 'rejected' && (
          <div className="mt-3 flex min-h-8 items-center pl-2">
            <span className="text-sm text-muted-foreground">
              Profils écartés depuis vos recherches. Remettre à trier renvoie le profil dans À trier et efface sa note.
            </span>
          </div>
        )}

        <div ref={scrollAreaRef} className="relative mt-3 min-h-0 flex-1 lg:overflow-y-auto">
          {(richCompact || richDetailed) && (
            // Une erreur d'affichage ne bloque pas le reste du Sourcing : « Tri » reste disponible.
            <SectionErrorBoundary key={view} fallbackTitle="Cet affichage n'a pas pu s'afficher. Passez en Tri.">
              {richCompact && renderCompact && toSort.length > 0 && renderCompact({
                profiles: toSort.map((row) => row.profile),
                allSelected: allToSortSelected,
                onToggleSelectAll: () => onSetSelection(allToSortSelected ? [] : toSort.map((row) => row.profile.id)),
              })}
              {richDetailed && renderCard && (
                <div className="space-y-3">
                  {toSort.map((row, index) => (
                    <div key={row.profile.id}>{renderCard(row.profile, index)}</div>
                  ))}
                </div>
              )}
            </SectionErrorBoundary>
          )}
          {!richCompact && !richDetailed && (
          <table className="w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="h-[34px] border-b border-border text-sm text-muted-foreground">
                {tab === 'to_sort' && <th scope="col" className="w-9 pl-2 font-normal"><span className="sr-only">Sélection</span></th>}
                <th scope="col" className={cn('pr-3 font-normal sm:w-[40%] xl:w-[28%]', tab !== 'to_sort' && 'pl-2')}>Nom</th>
                <th scope="col" className="hidden pr-3 font-normal xl:table-cell">Poste</th>
                <th scope="col" className="w-14 pr-3 text-right font-normal">Note</th>
                {tab === 'retained' ? (
                  <th scope="col" className="w-[7.5rem] pr-2 font-normal sm:w-[22%]">Étape</th>
                ) : showReason && (
                  <th scope="col" className="hidden pr-3 font-normal md:table-cell md:w-[30%]">Raison</th>
                )}
                {tab === 'to_sort' && <th scope="col" className="w-[76px] pr-2 font-normal max-sm:w-[104px]"><span className="sr-only">Décision</span></th>}
                {tab === 'rejected' && <th scope="col" className="w-[9.5rem] pr-2 font-normal max-sm:w-14"><span className="sr-only">Action</span></th>}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {groups[tab].map((row, index) => {
                const id = row.profile.id;
                const busy = pending.has(id);
                const selected = tab === 'to_sort' && selectedProfiles.has(id);
                const recommended = isGoRecommendation(recommendationOf(row.score, row.status));
                const reason = tab === 'rejected'
                  ? { text: rejectedReasonOf(row.status), tone: 'default' as ReasonTone }
                  : reasonOf(row.score, row.status, { scoring: scoringInProgress && scoringIds.has(id) });
                const headline = row.profile.headline || row.status?.candidate_headline || '';
                const stage = retainedStageOf(row.status);
                return (
                  <tr
                    key={id}
                    data-row-id={id}
                    onClick={() => onOpenProfile(row.profile)}
                    className={cn(
                      'h-14 cursor-pointer border-b border-border/50 transition-colors',
                      selected ? 'bg-muted/60' : 'hover:bg-muted/40',
                      busy && 'opacity-60',
                    )}
                  >
                    {tab === 'to_sort' && (
                      <td className="pl-2 align-middle" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => onToggleProfileSelection(id)}
                          aria-label={`Sélectionner ${row.name}`}
                          className={TAP_CHECKBOX}
                        />
                      </td>
                    )}
                    <td className={cn('min-w-0 py-1.5 pr-3 align-middle', tab !== 'to_sort' && 'pl-2')}>
                      <span className="flex min-w-0 items-center gap-3">
                        <PersonAvatar name={row.name} src={row.profile.profile_picture_url} size={32} className="max-[359px]:hidden" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              data-row-name=""
                              onClick={(e) => { e.stopPropagation(); onOpenProfile(row.profile); }}
                              className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:break-words"
                            >
                              {row.name}
                            </button>
                          </span>
                          {/* Deuxième ligne : le lieu quand le titre a sa colonne (grand écran), sinon le titre. L'avis de l'IA s'y lit
                              à la suite : il ne prend plus de place sur la ligne du nom, qui ne se coupe plus à la taille d'une tablette. */}
                          <span className="flex min-w-0 items-baseline gap-1.5 text-sm text-muted-foreground">
                            {row.profile.location && <span className="hidden min-w-0 truncate xl:block">{row.profile.location}</span>}
                            {headline && <span className="min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal xl:hidden">{headline}</span>}
                            {recommended && tab === 'to_sort' && (
                              <span className="shrink-0 text-success max-sm:hidden">Recommandé</span>
                            )}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden truncate pr-3 align-middle text-sm text-foreground-secondary xl:table-cell" title={headline || undefined}>
                      {headline}
                    </td>
                    <td className="pr-3 text-right align-middle">
                      {row.note !== null && row.note > 0 ? <ScorePill score={row.note} /> : null}
                    </td>
                    {tab === 'retained' ? (
                      <td className="pr-2 align-middle">
                        <span className="block truncate text-sm text-foreground-secondary">{GENERAL_STAGE_LABEL[stage]}</span>
                      </td>
                    ) : showReason && (
                      <td className={cn('hidden truncate pr-3 align-middle text-sm md:table-cell', REASON_TONE[reason.tone])} title={reason.text || undefined}>
                        {reason.text}
                      </td>
                    )}
                    {tab === 'to_sort' && (
                      <td className="pr-2 align-middle" onClick={(e) => e.stopPropagation()}>
                        <span className="flex justify-end gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run([row], onRetainProfiles, index)}
                            aria-label={`Retenir ${row.name}`}
                            title="Retenir"
                            className={cn(DECISION_BUTTON, 'text-foreground hover:bg-success-muted hover:text-success')}
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run([row], onDismissProfiles, index)}
                            aria-label={`Écarter ${row.name}`}
                            title="Écarter"
                            className={cn(DECISION_BUTTON, 'text-muted-foreground hover:text-danger')}
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </span>
                      </td>
                    )}
                    {tab === 'rejected' && (
                      <td className="pr-2 text-right align-middle" onClick={(e) => e.stopPropagation()}>
                        {onRestoreCandidate && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void run([row], async (list) => { await onRestoreCandidate(list[0].id); }, index)}
                            aria-label={`Remettre ${row.name} à trier`}
                            title="Remettre à trier"
                            className="max-sm:h-11 max-sm:w-11 max-sm:px-0"
                          >
                            <Undo2 aria-hidden="true" className="sm:hidden" />
                            <span className="max-sm:hidden">Remettre à trier</span>
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {tab === 'to_sort' && loadingMore && [0, 1, 2].map((i) => (
                <tr key={`suite-${i}`} aria-hidden="true" className="h-14 border-b border-border/50">
                  <td colSpan={6} className="px-2">
                    <span className="block h-3 w-1/2 rounded bg-muted/60" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <span role="status" className="sr-only">{loadAnnouncement}</span>

          {groups[tab].length === 0 && tab === 'to_sort' && !(hasSearched && results.length === 0) && (
            <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
              <Illustration name="tri" size="lg" />
              <p className="text-sm text-muted-foreground">Aucun profil à trier.</p>
            </div>
          )}
          {groups[tab].length === 0 && !(tab === 'to_sort' && !(hasSearched && results.length === 0)) && (
            <p className="px-2 py-5 text-sm text-muted-foreground">
              {tab === 'to_sort'
                ? hasSearched && results.length === 0
                  ? 'Aucun profil à trier. Cette recherche ne trouve aucun profil : ajustez vos filtres.'
                  : 'Aucun profil à trier.'
                : tab === 'retained' ? 'Aucun profil retenu.' : 'Aucun profil écarté.'}
            </p>
          )}
          {/* Pied de liste : une seule phrase, qui dit où en est le chargement. */}
          {tab === 'to_sort' && !hasMoreResults && results.length > 0 && groups.to_sort.length > 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              Tous les profils de cette recherche sont chargés. Élargissez vos filtres pour en trouver d'autres.
            </p>
          )}
          {tab === 'to_sort' && (canLoadMore || loadingMore) && (
            <div className="flex flex-wrap items-center gap-x-1 px-2 py-3 text-sm text-muted-foreground">
              <span>{loadedLabel}.</span>
              {/* Le bouton reste en place pendant le chargement (aria-disabled, jamais disabled) : le focus ne tombe pas sur la page. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={loadingMore ? undefined : onLoadMore}
                disabled={loading && !loadingMore}
                aria-disabled={loadingMore || undefined}
                className={cn('text-foreground max-sm:min-h-11', loadingMore && 'cursor-default hover:bg-transparent')}
              >
                {loadingMore ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {loadingMore ? 'Chargement de la suite' : 'Voir la suite'}
              </Button>
            </div>
          )}

          {/* Barre de sélection, flottante en bas (À trier seulement). */}
          {tab === 'to_sort' && selectedRows.length > 0 && (
            <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex px-2 pb-1">
              <div
                role="toolbar"
                aria-label="Actions sur la sélection"
                className="pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-border bg-popover py-2 pl-3.5 pr-2 text-popover-foreground shadow-lg"
              >
                <span className="mr-1.5 text-sm font-semibold tabular-nums text-foreground">
                  {plural(selectedRows.length, 'sélectionné', 'sélectionnés')}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="max-sm:min-h-11"
                  disabled={selectedRows.some((row) => pending.has(row.profile.id))}
                  onClick={() => void run(selectedRows, onRetainProfiles)}
                >
                  Retenir
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="max-sm:min-h-11"
                  disabled={selectedRows.some((row) => pending.has(row.profile.id))}
                  onClick={() => void run(selectedRows, onDismissProfiles)}
                >
                  Écarter
                </Button>
                {selectedAccount && (
                  <SequenceEnrollButton
                    selectedProfiles={selectedRows.map((row) => row.profile)}
                    accountId={selectedAccount}
                    selectedJob={selectedJob}
                    onSuccess={onSequenceEnrollSuccess}
                    triggerLabel="Contacter"
                    quiet
                  />
                )}
                {selectedJob && canBatchScore && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="max-sm:min-h-11"
                    disabled={scoringInProgress}
                    onClick={() => scoreRows(selectedRows)}
                  >
                    {scoringInProgress ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                    Noter
                  </Button>
                )}
                {selectedAccount && (
                  <Button size="sm" variant="ghost" className="max-sm:min-h-11" onClick={onOpenInMail}>
                    <Mail aria-hidden="true" />
                    InMail
                  </Button>
                )}
                <BulkEnrichButton profiles={selectedRows.map((row) => row.profile)} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 max-sm:h-11 max-sm:w-11"
                  aria-label="Tout désélectionner"
                  onClick={() => onSetSelection([])}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
