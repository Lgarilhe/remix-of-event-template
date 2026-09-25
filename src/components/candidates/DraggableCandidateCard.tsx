/**
 * Carte d'une candidature de la shortlist client (revue design E-22, E-28).
 *
 * Un seul arrêt de tabulation pour la carte : le nom, un bouton nommé qui
 * couvre la carte et déplie les coordonnées (Entrée), et qui se saisit au
 * clavier pour changer d'étape (Espace). « Déplacer vers… » remplace le
 * glisser au doigt. Badge d'entité neutre, lisible dans les deux thèmes.
 */
import React, { useId, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ArrowRightLeft, Briefcase, Calendar, ChevronDown, Mail, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ShortlistEntry } from '@/types/shortlist';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface DraggableCandidateCardProps {
  entry: ShortlistEntry;
  columnId: string;
  stages: { key: string; label: string }[];
  onMove: (stageKey: string) => void;
}

const LINK = 'flex w-fit max-w-full items-center gap-2 rounded-sm text-xs text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const DraggableCandidateCard: React.FC<DraggableCandidateCardProps> = ({ entry, columnId, stages, onMove }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const detailsId = useId();
  const candidate = entry.candidate;
  const name = candidate?.name || entry.name;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({
    id: entry.id,
    data: {
      type: 'card',
      columnId,
      entry,
    },
    attributes: { roleDescription: 'carte déplaçable' },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  // Le glisser part de toute la carte, sauf de ses liens, de son menu et des menus ouverts depuis elle.
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target) || target.closest('[data-no-drag]')) return;
    listeners?.onPointerDown?.(event);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    listeners?.onKeyDown?.(event);
  };

  const cvDate = formatDate(entry.cvPresentationDate);

  return (
    <div
      ref={setNodeRef}
      data-entry-id={entry.id}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative rounded-lg border border-border bg-card p-3 transition-colors duration-150 hover:border-border-strong',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">
            <Button
              ref={setActivatorNodeRef}
              type="button"
              variant="link"
              data-card-activator
              {...attributes}
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              aria-label={`Coordonnées de ${name}`}
              onClick={() => setIsExpanded(v => !v)}
              className="h-auto max-w-full justify-start gap-1 p-0 text-left hover:no-underline active:scale-100 after:absolute after:inset-0 after:rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background [&_svg]:size-3.5"
            >
              <span className="truncate">{name}</span>
              <ChevronDown
                className={cn('text-muted-foreground transition-transform duration-150', isExpanded && 'rotate-180')}
                aria-hidden="true"
              />
            </Button>
          </h3>
          {entry.positions && entry.positions.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-foreground-secondary">
              <Briefcase className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{entry.positions[0].name}</span>
            </p>
          )}
          {candidate?.expertise && candidate.expertise.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {candidate.expertise.slice(0, 2).join(', ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {entry.entity && <Badge variant="muted">{entry.entity}</Badge>}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    data-no-drag
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Déplacer ${name} vers une autre étape`}
                    className="relative z-10 text-muted-foreground opacity-0 transition-opacity duration-150 after:absolute after:-inset-2 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <ArrowRightLeft aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Déplacer vers…</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Déplacer vers…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={columnId}
                onValueChange={(stageKey) => {
                  if (stageKey !== columnId) onMove(stageKey);
                }}
              >
                {stages.map((stage) => (
                  <DropdownMenuRadioItem key={stage.key} value={stage.key}>
                    {stage.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded && (
        <div id={detailsId} data-no-drag className="relative z-10 mt-3 space-y-2 border-t border-border pt-3">
          {candidate?.email && (
            <a href={`mailto:${candidate.email}`} className={LINK}>
              <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{candidate.email}</span>
            </a>
          )}
          {candidate?.phone && (
            <a href={`tel:${candidate.phone}`} className={LINK}>
              <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
              {candidate.phone}
            </a>
          )}
          {candidate?.linkedin && (
            <a
              href={candidate.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Profil LinkedIn de ${name}`}
              className={LINK}
            >
              <ChannelIcon channel="linkedin" size="xs" showLabel />
            </a>
          )}
          {entry.presentiComments && (
            <p className="text-xs italic text-muted-foreground">{`«\u00a0${entry.presentiComments}\u00a0»`}</p>
          )}
          {cvDate && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              CV présenté le {cvDate}
            </p>
          )}
          {!candidate?.email && !candidate?.phone && !candidate?.linkedin && !entry.presentiComments && !cvDate && (
            <p className="text-xs text-muted-foreground">Aucune coordonnée enregistrée.</p>
          )}
        </div>
      )}
    </div>
  );
};
