/**
 * Affichage « Tableau » du pipeline global (revue design E-25) : le nom de
 * chaque ligne est un bouton qui ouvre la fiche (la ligne entière reste
 * cliquable à la souris), le tri annonce son sens (aria-sort et chevron), la
 * dernière action a le format des cartes.
 *
 * Design simplifié (lot Suite) : six colonnes qui tiennent dans l'écran
 * (candidat, étape, mission, dernière action, note, liens), sans cadre autour
 * du tableau. La source et la séquence passent sous la mission, en mots ; la
 * note est un anneau ; les liens vers LinkedIn et l'e-mail apparaissent au
 * survol de la ligne, au clavier, et restent visibles sur un écran tactile.
 *
 * Les lignes sont paginées : le tri porte sur toute la liste, seules les lignes
 * de la page courante sont rendues (avatar, infobulles et badges de chaque
 * ligne ralentissent l'écran quand la liste est longue).
 */
import React, { useState, useMemo } from 'react';
import { Bell, ChevronDown, ChevronUp, ChevronsUpDown, Mail, StickyNote } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { ScoreRing } from '@/components/ui/score-ring';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ATSPagination } from '@/components/ats/ATSPagination';
import { PAGE_SIZE, usePagination } from '@/hooks/usePagination';
import {
  ATS_SOURCE_LABELS,
  ATS_STAGES,
  type ATSCandidate,
  stagnantDays,
} from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/relativeTime';
import { enrollmentStatusLabel, manualStopLabel, pausedLabel } from '@/lib/sequenceLabels';

interface ATSTableProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
  /** Valeur dont le changement ramène à la première page (les filtres de la page). */
  resetKey?: unknown;
}

type SortKey = 'name' | 'stage' | 'jobTitle' | 'lastActivity' | 'createdAt';
type SortDirection = 'asc' | 'desc';

/** Sous la mission : la séquence et son état, sinon la source quand ce n'est pas une mission. */
function originText(candidate: ATSCandidate): string | null {
  if (candidate.sequenceName) {
    // Arrêt manuel (lot 5b) : « arrêtée par Guillaume Martin le 29/09 », le nom gardé tel quel.
    const manualStop = candidate.sequenceStatus === 'completed' ? candidate.sequenceManualStop ?? null : null;
    const stopLabel = manualStop ? manualStopLabel(manualStop, candidate.sequenceStoppedByName) : null;
    const status = stopLabel
      ? stopLabel.charAt(0).toLowerCase() + stopLabel.slice(1)
      : candidate.sequenceStatus
      ? (candidate.sequenceStatus === 'paused' ? pausedLabel(null) : enrollmentStatusLabel(candidate.sequenceStatus)).toLowerCase()
      : null;
    return status ? `Séquence ${candidate.sequenceName}, ${status}` : `Séquence ${candidate.sequenceName}`;
  }
  return candidate.source === 'local' ? null : ATS_SOURCE_LABELS[candidate.source];
}

/** Liens de la ligne : au survol, au clavier, toujours visibles sur un écran tactile. */
const REVEAL_ON_ROW =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none';

const stageLabel = (stage: string) => ATS_STAGES.find((s) => s.key === stage)?.label ?? stage;

/** Rang de la colonne dans le pipeline (tri par étape : l'ordre des colonnes, pas l'ordre alphabétique des clés). */
const stageRank = (stage: string) => {
  const index = ATS_STAGES.findIndex((s) => s.key === stage);
  return index === -1 ? ATS_STAGES.length : index;
};

/** Bouton du kit rendu comme un texte de cellule (nom, poste) ; au doigt, sa zone de toucher fait 44 px de haut. */
const TEXT_BUTTON =
  'relative h-auto min-w-0 max-w-full justify-start gap-0 rounded-sm p-0 text-left underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-1 [@media(pointer:coarse)]:after:-inset-y-3';

/** Lien en icône de 28 px, zone de toucher de 44 px. */
const ICON_LINK = 'relative after:absolute after:-inset-2';

export const ATSTable: React.FC<ATSTableProps> = ({ candidates, onCandidateClick, onJobClick, resetKey }) => {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { containerRef, currentPage, pageCount, firstRow, lastRow, goToPage, resetPage } = usePagination(
    candidates.length,
    resetKey,
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('desc'); }
    resetPage();
  };

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      switch (sortKey) {
        case 'name': aVal = a.name?.toLowerCase() || ''; bVal = b.name?.toLowerCase() || ''; break;
        case 'stage': aVal = stageRank(a.stage); bVal = stageRank(b.stage); break;
        case 'jobTitle': aVal = a.jobTitle?.toLowerCase() || ''; bVal = b.jobTitle?.toLowerCase() || ''; break;
        case 'lastActivity': aVal = a.lastActivity || ''; bVal = b.lastActivity || ''; break;
        case 'createdAt': aVal = a.createdAt || ''; bVal = b.createdAt || ''; break;
      }

      if (aVal === null || aVal === '') return 1;
      if (bVal === null || bVal === '') return -1;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortKey, sortDirection]);

  const sortHeader = (label: string, key: SortKey, className?: string) => {
    const active = sortKey === key;
    const Icon = active ? (sortDirection === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <TableHead
        className={cn('h-10 px-3', className)}
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => handleSort(key)}
          // Colonne triée à l'encre ; les autres, non choisies, restent au gris secondaire.
          className={cn('relative -mx-1.5 gap-1 rounded-md px-1.5 after:absolute after:inset-x-0 after:-inset-y-2 hover:text-foreground [&_svg]:size-3.5', active ? 'text-foreground' : 'text-muted-foreground')}
        >
          {label}
          <Icon className={cn(active && 'text-foreground')} aria-hidden="true" />
        </Button>
      </TableHead>
    );
  };

  const pageCandidates = useMemo(
    () => sortedCandidates.slice(firstRow, firstRow + PAGE_SIZE),
    [sortedCandidates, firstRow],
  );

  const now = new Date();

  return (
    <div ref={containerRef}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {sortHeader('Candidat', 'name', 'min-w-[220px]')}
            {sortHeader('Étape', 'stage')}
            {sortHeader('Mission', 'jobTitle', 'min-w-[180px]')}
            {sortHeader('Dernière action', 'lastActivity', 'min-w-[150px]')}
            <TableHead className="h-10 px-3 text-xs font-medium">Note</TableHead>
            <TableHead className="h-10 px-3 text-xs font-medium">
              <span className="sr-only">Liens</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageCandidates.map(candidate => {
            const stagnant = stagnantDays(candidate, now);
            const activity = candidate.lastActivity || candidate.createdAt;
            const origin = originText(candidate);
            return (
              <TableRow
                key={candidate.id}
                className="group cursor-pointer"
                onClick={(e) => {
                  // La ligne s'ouvre à la souris ; ses boutons et liens gardent leur action.
                  if ((e.target as HTMLElement).closest('button, a')) return;
                  onCandidateClick(candidate);
                }}
              >
                <TableCell className="px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <PersonAvatar name={candidate.name} src={candidate.pictureUrl} candidateId={candidate.candidateId} size={32} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => onCandidateClick(candidate)}
                          className={cn(TEXT_BUTTON, 'text-foreground')}
                        >
                          <span className="truncate">{candidate.name}</span>
                        </Button>
                        {candidate.hasReminder && (
                          <Bell className="h-3.5 w-3.5 shrink-0" role="img" aria-label="Rappel en attente" />
                        )}
                        {(candidate.notesCount || 0) > 0 && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                            <StickyNote className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
                            {candidate.notesCount}
                            <span className="sr-only"> note{(candidate.notesCount || 0) > 1 ? 's' : ''}</span>
                          </span>
                        )}
                      </div>
                      {candidate.headline && (
                        <p className="max-w-[260px] truncate text-xs text-muted-foreground">{candidate.headline}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5 text-sm text-foreground">
                  {stageLabel(candidate.stage)}
                  {candidate.stage === 'ITW en cours' && candidate.processStepName && (
                    <span className="block max-w-[160px] truncate text-xs text-muted-foreground">{candidate.processStepName}</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {candidate.jobTitle && (candidate.jobId && onJobClick ? (
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => onJobClick(candidate.jobId as string)}
                      className={cn(TEXT_BUTTON, 'max-w-[240px] font-normal')}
                    >
                      <span className="sr-only">Voir la mission </span>
                      <span className="truncate">{candidate.jobTitle}</span>
                    </Button>
                  ) : (
                    <span className="block max-w-[240px] truncate text-sm text-foreground-secondary">{candidate.jobTitle}</span>
                  ))}
                  {origin && <span className="block max-w-[240px] truncate text-xs text-muted-foreground">{origin}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5">
                  {stagnant !== null ? (
                    <span className="text-xs font-medium text-warning">
                      {candidate.stageEnteredAt ? `Dans cette étape depuis ${stagnant}\u00a0j` : `Dernière action il y a ${stagnant}\u00a0j`}
                    </span>
                  ) : activity ? (
                    <time
                      dateTime={activity}
                      title={new Date(activity).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}
                      className="text-xs text-muted-foreground"
                    >
                      {timeAgo(activity, { now })}
                    </time>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <ScoreRing score={candidate.score} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <div className={cn('flex items-center gap-1', REVEAL_ON_ROW)}>
                    {candidate.linkedin && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="ghost" size="icon-xs" className={ICON_LINK}>
                            <a
                              href={candidate.linkedin}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Ouvrir le profil LinkedIn de ${candidate.name}`}
                            >
                              <ChannelIcon channel="linkedin" />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Profil LinkedIn</TooltipContent>
                      </Tooltip>
                    )}
                    {candidate.email && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="ghost" size="icon-xs" className={ICON_LINK}>
                            <a href={`mailto:${candidate.email}`} aria-label={`Écrire un e-mail à ${candidate.name}`}>
                              <Mail aria-hidden="true" />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Écrire un e-mail</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ATSPagination
        total={candidates.length}
        currentPage={currentPage}
        pageCount={pageCount}
        firstRow={firstRow}
        lastRow={lastRow}
        onPageChange={goToPage}
        className="border-t border-border"
      />
    </div>
  );
};
