/**
 * Affichage « Chronologie » du pipeline global (revue design E-26) : les
 * candidats groupés par date de dernière action. Hors « Aujourd'hui », chaque
 * ligne porte la date courte et l'heure (« 12 sept. à 14:32 »). Le nom est un
 * bouton qui ouvre la fiche ; le poste, un bouton qui ouvre le poste.
 * Les lignes sont paginées dans l'ordre affiché : un groupe qui dépasse la page
 * continue sur la suivante, son titre gardant l'effectif du groupe entier.
 *
 * Design simplifié (lot Suite) : plus de carte autour de chaque ligne ni
 * d'étiquette encadrée ; l'étape, la mission et la séquence tiennent sur une
 * ligne de texte discret, sous le nom.
 */
import React, { useMemo } from 'react';
import { format, isThisMonth, isThisWeek, isThisYear, isToday, isYesterday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Bell, Briefcase, GitBranch, Send, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ATSPagination } from '@/components/ats/ATSPagination';
import { PAGE_SIZE, usePagination } from '@/hooks/usePagination';
import { ATS_STAGES, type ATSCandidate } from '@/hooks/useATSData';

interface ATSTimelineProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
  /** Valeur dont le changement ramène à la première page (les filtres de la page). */
  resetKey?: unknown;
}

interface TimelineGroup {
  label: string;
  candidates: ATSCandidate[];
}

interface TimelinePageGroup extends TimelineGroup {
  /** Effectif du groupe entier, pas seulement de sa part sur la page. */
  total: number;
}

const SOURCE_ICONS: Record<ATSCandidate['source'], React.ElementType> = {
  local: Briefcase,
  sequence: GitBranch,
  inmail: Send,
};

const stageLabel = (stage: string) => ATS_STAGES.find((s) => s.key === stage)?.label ?? stage;

/** Le nom : un bouton du kit dont la surface cliquable (::after) couvre toute la ligne. */
const STRETCHED_BUTTON =
  'h-auto max-w-full justify-start p-0 text-left hover:no-underline active:scale-100 after:absolute after:inset-0 after:rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background';

/** « 14:32 » aujourd'hui, « 12 sept. à 14:32 » ensuite, avec l'année si elle diffère. */
function activityTimeLabel(date: Date): string {
  if (isToday(date)) return format(date, 'HH:mm');
  return format(date, isThisYear(date) ? "d MMM 'à' HH:mm" : "d MMM yyyy 'à' HH:mm", { locale: fr });
}

export const ATSTimeline: React.FC<ATSTimelineProps> = ({ candidates, onCandidateClick, onJobClick, resetKey }) => {
  const { containerRef, currentPage, pageCount, firstRow, lastRow, goToPage } = usePagination(candidates.length, resetKey);

  const timelineGroups = useMemo(() => {
    const groups: TimelineGroup[] = [];
    const today: ATSCandidate[] = [];
    const yesterday: ATSCandidate[] = [];
    const thisWeek: ATSCandidate[] = [];
    const thisMonth: ATSCandidate[] = [];
    const older: ATSCandidate[] = [];

    const sorted = [...candidates].sort((a, b) => {
      const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return dateB - dateA;
    });

    sorted.forEach(candidate => {
      if (!candidate.lastActivity) { older.push(candidate); return; }
      const date = parseISO(candidate.lastActivity);
      if (isToday(date)) today.push(candidate);
      else if (isYesterday(date)) yesterday.push(candidate);
      else if (isThisWeek(date, { weekStartsOn: 1 })) thisWeek.push(candidate);
      else if (isThisMonth(date)) thisMonth.push(candidate);
      else older.push(candidate);
    });

    if (today.length > 0) groups.push({ label: "Aujourd'hui", candidates: today });
    if (yesterday.length > 0) groups.push({ label: 'Hier', candidates: yesterday });
    if (thisWeek.length > 0) groups.push({ label: 'Cette semaine', candidates: thisWeek });
    if (thisMonth.length > 0) groups.push({ label: 'Ce mois-ci', candidates: thisMonth });
    if (older.length > 0) groups.push({ label: 'Plus ancien', candidates: older });

    return groups;
  }, [candidates]);

  // Les groupes se suivent dans l'ordre affiché : la page est la tranche [firstRow, firstRow + PAGE_SIZE) de leur mise bout à bout.
  const pageGroups = useMemo(() => {
    const result: TimelinePageGroup[] = [];
    let offset = 0;
    for (const group of timelineGroups) {
      const from = Math.max(firstRow - offset, 0);
      const to = Math.min(firstRow + PAGE_SIZE - offset, group.candidates.length);
      if (to > from) result.push({ label: group.label, total: group.candidates.length, candidates: group.candidates.slice(from, to) });
      offset += group.candidates.length;
    }
    return result;
  }, [timelineGroups, firstRow]);

  return (
    <div ref={containerRef} className="space-y-6">
      {pageGroups.map(group => (
        <section key={group.label}>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {group.label}
              <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
                {group.total}
                <span className="sr-only"> candidat{group.total > 1 ? 's' : ''}</span>
              </span>
            </h2>
            <div className="h-px flex-1 bg-border" />
          </div>

          <ol className="relative space-y-2 before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-px before:bg-border">
            {group.candidates.map(candidate => {
              const SourceIcon = SOURCE_ICONS[candidate.source];
              const jobClickable = !!candidate.jobTitle && !!candidate.jobId && !!onJobClick;
              return (
                <li key={candidate.id} className="relative pl-7">
                  <span
                    className="absolute left-0 top-3 grid h-5 w-5 place-items-center rounded-full bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    <SourceIcon className="h-3 w-3" />
                  </span>

                  <div className="relative rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-3">
                      <PersonAvatar name={candidate.name} src={candidate.pictureUrl} candidateId={candidate.candidateId} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="min-w-0 text-sm font-medium text-foreground">
                            <Button
                              type="button"
                              variant="link"
                              onClick={() => onCandidateClick(candidate)}
                              className={STRETCHED_BUTTON}
                            >
                              <span className="truncate">{candidate.name}</span>
                            </Button>
                          </h3>
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
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{candidate.headline}</p>
                        )}

                        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-foreground-secondary">
                          <span>{stageLabel(candidate.stage)}</span>
                          {candidate.stage === 'ITW en cours' && candidate.processStepName && (
                            <span className="max-w-[220px] truncate text-muted-foreground">{candidate.processStepName}</span>
                          )}
                          {candidate.jobTitle && (
                            <>
                              <span aria-hidden="true" className="text-muted-foreground">·</span>
                              {jobClickable ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  onClick={() => onJobClick?.(candidate.jobId as string)}
                                  className="relative z-10 h-auto max-w-[260px] justify-start p-0 text-sm font-normal text-foreground-secondary after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground [@media(pointer:coarse)]:after:-inset-y-3"
                                >
                                  <span className="sr-only">Voir la mission </span>
                                  <span className="truncate">{candidate.jobTitle}</span>
                                </Button>
                              ) : (
                                <span className="max-w-[260px] truncate">{candidate.jobTitle}</span>
                              )}
                            </>
                          )}
                          {candidate.sequenceName && (
                            <>
                              <span aria-hidden="true" className="text-muted-foreground">·</span>
                              <span className="inline-flex max-w-[220px] items-center gap-1 text-muted-foreground">
                                <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="sr-only">Séquence </span>
                                <span className="truncate">{candidate.sequenceName}</span>
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      {candidate.lastActivity && (
                        <time dateTime={candidate.lastActivity} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {activityTimeLabel(parseISO(candidate.lastActivity))}
                        </time>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {/* Sans cadre : un filet la sépare de la liste (design simplifié). */}
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

/** Squelette de la chronologie : deux groupes de trois lignes. */
export const ATSTimelineSkeleton: React.FC = () => (
  <div className="space-y-6" role="status" aria-label="Chargement de la chronologie">
    {[0, 1].map((group) => (
      <div key={group}>
        <div className="mb-3 flex items-center gap-3">
          <Skeleton className="h-4 w-24 rounded-sm" />
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2 pl-7">
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-40 rounded-sm" />
                <Skeleton className="h-3 w-20 rounded-sm" />
              </div>
              <Skeleton className="h-3 w-56 rounded-sm" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);
