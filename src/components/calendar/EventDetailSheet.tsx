/**
 * EventDetailSheet — fiche d'un événement de l'agenda, ouverte au clic.
 *
 * Candidat, mission, animateur, lieu et notes, puis une seule action
 * principale : le compte rendu d'un entretien passé (même page que la barre
 * latérale), sinon rejoindre la réunion quand elle a un lien, sinon préparer
 * l'entretien. Le reste (tâches de préparation et de compte rendu) est dans le
 * menu « Plus » (revue design A-47).
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarCheck2, CheckSquare, ClipboardList, Copy, FileText, MapPin, MoreHorizontal, Phone, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { EVENT_TYPES, roundLabel } from '@/components/calendar/eventMeta';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface EventDetailSheetProps {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Lieu : libellé lisible, icône et lien éventuel. */
const getLocationMeta = (
  location: string | null | undefined,
): { icon: React.ElementType; label: string; href: string | null } => {
  if (!location) return { icon: MapPin, label: 'Lieu non précisé', href: null };
  const lower = location.toLowerCase();
  if (lower.trim() === 'visio') return { icon: Video, label: 'Visio, lien à venir', href: null };
  if (lower.includes('meet.google')) return { icon: Video, label: 'Google Meet', href: location };
  if (lower.includes('zoom.us')) return { icon: Video, label: 'Zoom', href: location };
  if (lower.includes('teams.microsoft') || lower.includes('teams.live')) return { icon: Video, label: 'Microsoft Teams', href: location };
  if (lower.startsWith('http')) return { icon: Video, label: 'Lien de visio', href: location };
  if (lower.includes('téléphone') || lower.includes('phone') || lower.includes('appel')) return { icon: Phone, label: location, href: null };
  return { icon: MapPin, label: location, href: null };
};

const Block: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <h3 className="eyebrow mb-2">{title}</h3>
    {children}
  </section>
);

export const EventDetailSheet: React.FC<EventDetailSheetProps> = ({ event, open, onOpenChange }) => {
  const navigate = useNavigate();
  const [taskModalOpen, setTaskModalOpen] = useState<'prep' | 'debrief' | null>(null);

  if (!event) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full p-0 sm:max-w-md" />
      </Sheet>
    );
  }

  const type = EVENT_TYPES[event.type];
  const TypeIcon = type.icon;
  const meta = event.meta || {};
  const location = getLocationMeta(meta.location);
  const LocationIcon = location.icon;
  const round = roundLabel(meta.round);

  const startDate = (() => {
    try {
      return parseISO(event.startAt);
    } catch {
      return null;
    }
  })();
  const endDate = (() => {
    if (!event.endAt) return null;
    try {
      return parseISO(event.endAt);
    } catch {
      return null;
    }
  })();
  const durationMin = startDate && endDate ? differenceInMinutes(endDate, startDate) : null;

  const dateLabel = startDate ? format(startDate, 'EEEE d MMMM', { locale: fr }).replace(/^./, (c) => c.toUpperCase()) : 'Date inconnue';
  const timeRangeLabel = startDate
    ? endDate
      ? `de ${format(startDate, 'HH:mm')} à ${format(endDate, 'HH:mm')}`
      : `à ${format(startDate, 'HH:mm')}`
    : '';

  const isInterview = event.type === 'qualification';
  const refDate = endDate ?? startDate;
  const isPast = refDate ? refDate.getTime() < Date.now() : false;
  // Identifiant de la session d'entretien (événements « qualif-<id> »)
  const sessionId = isInterview && event.id.startsWith('qualif-') ? event.id.slice('qualif-'.length) : null;
  const canPrepare = isInterview && !isPast && !!meta.candidateId;
  const openReport = () => {
    navigate(`/qualification/${sessionId}`);
    onOpenChange(false);
  };
  const prepareInterview = () => {
    navigate(`/pipeline?candidate=${meta.candidateId}&tab=evaluation&prepareInterview=1`);
    onOpenChange(false);
  };

  // Rien à copier pour le préréglage « Visio » sans lien.
  const canCopyLocation = !!meta.location && meta.location.trim().toLowerCase() !== 'visio';
  const handleCopyLocation = async () => {
    if (!meta.location) return;
    try {
      await navigator.clipboard.writeText(meta.location);
      toast.success(location.href ? 'Lien copié' : 'Adresse copiée');
    } catch {
      toast.error("La copie n'a pas abouti. Sélectionnez le texte à la main.");
    }
  };

  // Une action principale : le compte rendu d'un entretien passé, sinon
  // rejoindre la visio si elle a un lien, sinon préparer l'entretien.
  const primary: 'report' | 'join' | 'prepare' | null =
    isPast && sessionId ? 'report' : !isPast && location.href ? 'join' : canPrepare ? 'prepare' : null;
  const hasMenu = isInterview;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-2 border-b border-border px-6 pb-4 pt-6 text-left">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {type.label}
            </span>
            {round && <span>· {round}</span>}
            {meta.calendlyEventId && (
              <span className="inline-flex items-center gap-1">
                · <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> Pris via Calendly
              </span>
            )}
          </p>
          <SheetTitle className="pr-8 text-lg">{event.title}</SheetTitle>
          <SheetDescription>
            {dateLabel} {timeRangeLabel}
            {durationMin ? ` (${durationMin} min)` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-6 py-5">
          {meta.candidateName && (
            <Block title="Candidat">
              {meta.candidateId ? (
                <Link
                  to={`/pipeline?candidate=${meta.candidateId}`}
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CandidateAvatar name={meta.candidateName} avatarUrl={meta.candidateAvatarUrl ?? null} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{meta.candidateName}</span>
                    {meta.candidateHeadline && <span className="block truncate text-xs text-muted-foreground">{meta.candidateHeadline}</span>}
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <CandidateAvatar name={meta.candidateName} avatarUrl={meta.candidateAvatarUrl ?? null} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{meta.candidateName}</span>
                    {meta.candidateHeadline && <span className="block truncate text-xs text-muted-foreground">{meta.candidateHeadline}</span>}
                  </span>
                </div>
              )}
            </Block>
          )}

          {(meta.projectName || meta.jobTitle || meta.clientName) && (
            <Block title="Mission">
              {(() => {
                const content = (
                  <>
                    <MissionCompanyLogo company={meta.clientName || meta.projectName || null} size={36} />
                    <span className="min-w-0 flex-1">
                      {/* Le nom de mission reprend souvent poste et client : on montre le poste, puis le client. */}
                      <span className="block truncate text-sm font-medium text-foreground">
                        {meta.jobTitle || meta.projectName || meta.clientName}
                      </span>
                      {meta.clientName && (meta.jobTitle || meta.projectName) && (
                        <span className="block truncate text-xs text-muted-foreground">{meta.clientName}</span>
                      )}
                    </span>
                  </>
                );
                return meta.projectId ? (
                  <Link
                    to={`/missions/${meta.projectId}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">{content}</div>
                );
              })()}
            </Block>
          )}

          {meta.manager && (
            <Block title="Animé par">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <CandidateAvatar name={meta.manager.displayName || 'Membre'} avatarUrl={meta.manager.avatarUrl ?? null} size={32} />
                <span className="truncate text-sm font-medium text-foreground">{meta.manager.displayName || 'Membre sans nom'}</span>
              </div>
            </Block>
          )}

          {meta.location && (
            <Block title="Lieu">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
                  <LocationIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{location.label}</span>
                  {location.href && <span className="block truncate text-xs text-muted-foreground">{meta.location}</span>}
                </span>
                {canCopyLocation && (
                  <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={handleCopyLocation}>
                    <Copy aria-hidden="true" />
                    Copier
                  </Button>
                )}
              </div>
            </Block>
          )}

          {meta.notes && (
            <Block title="Notes">
              <p className="whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-3 text-sm leading-relaxed text-foreground">
                {meta.notes}
              </p>
            </Block>
          )}
        </div>

        {(primary || hasMenu) && (
          <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-popover px-6 py-4">
            {primary === 'report' && (
              <Button type="button" variant="primary" className="flex-1" onClick={openReport}>
                <FileText aria-hidden="true" />
                Ouvrir le compte rendu
              </Button>
            )}
            {primary === 'join' && location.href && (
              <Button asChild variant="primary" className="flex-1">
                <a href={location.href} target="_blank" rel="noopener noreferrer">
                  <Video aria-hidden="true" />
                  Rejoindre la réunion
                </a>
              </Button>
            )}
            {primary === 'prepare' && (
              <Button type="button" variant="primary" className="flex-1" onClick={prepareInterview}>
                <ClipboardList aria-hidden="true" />
                Préparer l'entretien
              </Button>
            )}
            {hasMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className={primary ? undefined : 'flex-1'}>
                    <MoreHorizontal aria-hidden="true" />
                    Plus
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {canPrepare && primary !== 'prepare' && (
                    <DropdownMenuItem onSelect={prepareInterview}>
                      <ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />
                      Préparer l'entretien
                    </DropdownMenuItem>
                  )}
                  {!isPast && (
                    <DropdownMenuItem onSelect={() => setTaskModalOpen('prep')}>
                      <CheckSquare className="mr-2 h-4 w-4" aria-hidden="true" />
                      Créer une tâche de préparation
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setTaskModalOpen('debrief')}>
                    <CheckSquare className="mr-2 h-4 w-4" aria-hidden="true" />
                    Créer une tâche de compte rendu
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </SheetContent>

      {taskModalOpen && (
        <CreateTaskModal
          open={!!taskModalOpen}
          onOpenChange={(o) => !o && setTaskModalOpen(null)}
          prefillCandidate={
            meta.candidateId && meta.candidateName
              ? {
                  candidateId: meta.candidateId,
                  name: meta.candidateName,
                  headline: meta.candidateHeadline ?? null,
                  avatarUrl: meta.candidateAvatarUrl ?? null,
                }
              : undefined
          }
          prefillProjectId={meta.projectId ?? undefined}
          prefillCategory={taskModalOpen === 'prep' ? 'interview_prep' : 'debrief'}
          prefillTitle={
            taskModalOpen === 'prep'
              ? `Préparer l'entretien avec ${meta.candidateName ?? 'le candidat'}`
              : `Compte rendu de l'entretien avec ${meta.candidateName ?? 'le candidat'}`
          }
          prefillDescription={
            taskModalOpen === 'prep'
              ? [
                  `Entretien le ${dateLabel.toLowerCase()} ${timeRangeLabel}.`,
                  meta.clientName ? `Client : ${meta.clientName}.` : null,
                  meta.jobTitle ? `Poste : ${meta.jobTitle}.` : null,
                  'Relisez le CV et le score, puis préparez vos questions.',
                ]
                  .filter(Boolean)
                  .join(' ')
              : [
                  `Entretien du ${dateLabel.toLowerCase()}.`,
                  meta.clientName ? `Client : ${meta.clientName}.` : null,
                  'Notez vos observations, puis envoyez le retour au client.',
                ]
                  .filter(Boolean)
                  .join(' ')
          }
          prefillDueAt={
            taskModalOpen === 'prep'
              ? startDate
                ? new Date(startDate.getTime() - 60 * 60 * 1000) // 1 h avant
                : undefined
              : endDate
                ? new Date(endDate.getTime() + 2 * 60 * 60 * 1000) // 2 h après
                : undefined
          }
          sourceEventId={event.id.startsWith('qualif-') ? event.id.replace(/^qualif-/, '') : undefined}
        />
      )}
    </Sheet>
  );
};
