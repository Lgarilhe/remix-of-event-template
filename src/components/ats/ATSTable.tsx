/**
 * Affichage « Tableau » du pipeline global (revue design E-25) : le nom de
 * chaque ligne est un bouton qui ouvre la fiche (la ligne entière reste
 * cliquable à la souris), le tri annonce son sens (aria-sort et chevron), la
 * dernière action a le format des cartes, le score passe par `ScoreBadge`.
 */
import React, { useState, useMemo } from 'react';
import { Bell, Briefcase, ChevronDown, ChevronUp, ChevronsUpDown, GitBranch, Mail, Send, StickyNote } from 'lucide-react';
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
import { ScoreBadge } from '@/components/ui/score-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EnrollmentStatusBadge } from '@/components/outreach/SequenceBadges';
import {
  ATS_SOURCE_LABELS,
  ATS_STAGES,
  type ATSCandidate,
  stagnantDays,
} from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/relativeTime';

interface ATSTableProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
}

type SortKey = 'name' | 'stage' | 'source' | 'jobTitle' | 'lastActivity' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const SOURCE_ICONS: Record<ATSCandidate['source'], React.ElementType> = {
  local: Briefcase,
  sequence: GitBranch,
  inmail: Send,
};

const stageLabel = (stage: string) => ATS_STAGES.find((s) => s.key === stage)?.label ?? stage;

/** Bouton du kit rendu comme un texte de cellule (nom, poste). */
const TEXT_BUTTON = 'h-auto min-w-0 max-w-full justify-start gap-0 rounded-sm p-0 text-left underline-offset-2';

export const ATSTable: React.FC<ATSTableProps> = ({ candidates, onCandidateClick, onJobClick }) => {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('desc'); }
  };

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      switch (sortKey) {
        case 'name': aVal = a.name?.toLowerCase() || ''; bVal = b.name?.toLowerCase() || ''; break;
        case 'stage': aVal = a.stage; bVal = b.stage; break;
        case 'source': aVal = a.source; bVal = b.source; break;
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
          className="-mx-1.5 gap-1 rounded-md px-1.5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
        >
          {label}
          <Icon className={cn(active && 'text-foreground')} aria-hidden="true" />
        </Button>
      </TableHead>
    );
  };

  const now = new Date();

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {sortHeader('Candidat', 'name', 'min-w-[220px]')}
            {sortHeader('Étape', 'stage')}
            {sortHeader('Source', 'source')}
            {sortHeader('Poste', 'jobTitle', 'min-w-[160px]')}
            <TableHead className="h-10 px-3 text-xs font-medium">Séquence</TableHead>
            {sortHeader('Dernière action', 'lastActivity', 'min-w-[150px]')}
            <TableHead className="h-10 px-3 text-xs font-medium">Score</TableHead>
            <TableHead className="h-10 px-3 text-xs font-medium">
              <span className="sr-only">Liens</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedCandidates.map(candidate => {
            const stagnant = stagnantDays(candidate, now);
            const activity = candidate.lastActivity || candidate.createdAt;
            const SourceIcon = SOURCE_ICONS[candidate.source];
            return (
              <TableRow
                key={candidate.id}
                className="cursor-pointer"
                onClick={(e) => {
                  // La ligne s'ouvre à la souris ; ses boutons et liens gardent leur action.
                  if ((e.target as HTMLElement).closest('button, a')) return;
                  onCandidateClick(candidate);
                }}
              >
                <TableCell className="px-3 py-2.5">
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
                        <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" role="img" aria-label="Rappel en attente" />
                      )}
                      {(candidate.notesCount || 0) > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                          <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                          {candidate.notesCount}
                          <span className="sr-only"> note{(candidate.notesCount || 0) > 1 ? 's' : ''}</span>
                        </span>
                      )}
                    </div>
                    {candidate.headline && (
                      <p className="max-w-[260px] truncate text-xs text-muted-foreground">{candidate.headline}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5 text-sm text-foreground">
                  {stageLabel(candidate.stage)}
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary">
                    <SourceIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {ATS_SOURCE_LABELS[candidate.source]}
                  </span>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {candidate.jobTitle && (candidate.jobId && onJobClick ? (
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => onJobClick(candidate.jobId as string)}
                      className={cn(TEXT_BUTTON, 'max-w-[200px] font-normal text-foreground-secondary hover:text-foreground')}
                    >
                      <span className="sr-only">Voir le poste </span>
                      <span className="truncate">{candidate.jobTitle}</span>
                    </Button>
                  ) : (
                    <span className="block max-w-[200px] truncate text-sm text-foreground-secondary">{candidate.jobTitle}</span>
                  ))}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  {candidate.sequenceName && (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="max-w-[160px] truncate text-sm text-foreground-secondary">{candidate.sequenceName}</span>
                      {candidate.sequenceStatus && <EnrollmentStatusBadge status={candidate.sequenceStatus} />}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5">
                  {stagnant !== null ? (
                    <span className="text-xs font-medium text-warning">Sans mouvement depuis {stagnant}{'\u00a0'}j</span>
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
                  <ScoreBadge score={candidate.score} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    {candidate.linkedin && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="ghost" size="icon-xs">
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
                          <Button asChild variant="ghost" size="icon-xs">
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
    </div>
  );
};
