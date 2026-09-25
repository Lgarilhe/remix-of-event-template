/**
 * Carte d'un candidat dans les colonnes du pipeline global (revue design E-18,
 * E-19, E-22, E-43).
 *
 * Trois lignes : le nom et le score ; le poste (un bouton qui ouvre la fiche du
 * poste) ou, à défaut, l'intitulé du candidat ; un seul signal daté (« Sans
 * mouvement depuis 6 j », « A répondu il y a 2 h », le statut de séquence
 * traduit, sinon la dernière action). La colonne porte l'étape : la carte ne
 * la répète pas.
 *
 * Un seul arrêt de tabulation pour la carte : le nom, un bouton qui couvre
 * toute la carte. Entrée ouvre la fiche, Espace saisit la carte pour la
 * déplacer au clavier. La case de sélection apparaît au survol, au focus et
 * dès qu'une carte est cochée ; « Déplacer vers… » remplace le glisser au
 * doigt.
 */
import React from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { ArrowRightLeft, Bell, Briefcase, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScoreBadge } from '@/components/ui/score-badge';
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
import { EnrollmentStatusBadge } from '@/components/outreach/SequenceBadges';
import { type ATSCandidate, stagnantDays, timeAgoLabel } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';

/** Liaison au glisser-déposer, fournie par `ATSDraggableCard`. */
export interface CardDragBindings {
  setNodeRef: (element: HTMLElement | null) => void;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

interface ATSCandidateCardProps {
  candidate: ATSCandidate;
  /** Ouvre la fiche du candidat. */
  onOpen?: () => void;
  onJobClick?: (jobId: string) => void;
  /** Case de sélection pour les actions groupées (absente sans `onToggleSelect`). */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Au moins une carte est cochée : toutes les cases restent visibles. */
  selectionMode?: boolean;
  /** Étapes proposées par « Déplacer vers… » (menu absent sans `onMove`). */
  stages?: { key: string; label: string }[];
  onMove?: (stageKey: string) => void;
  drag?: CardDragBindings;
  isDragging?: boolean;
  /** Aperçu qui suit le pointeur pendant un glisser : rendu statique, sans contrôle. */
  overlay?: boolean;
}

/** Réponse du candidat, écrite en mots (jamais le statut brut). */
const REPLY_LABELS: Record<string, string> = {
  replied: 'A répondu',
  interested: 'Réponse positive',
  not_interested: 'Réponse négative',
};

/** Avant l'étape « Répondu » : la réponse est une nouvelle à traiter. Après, la colonne la dit déjà. */
const STAGES_BEFORE_REPLY = new Set(['Nouveau', 'Contacté']);

type CardSignal =
  | { kind: 'stagnant' | 'reply' | 'activity'; text: string }
  | { kind: 'sequence'; status: string; ago: string | null };

function cardSignal(candidate: ATSCandidate, now: Date): CardSignal | null {
  const stagnant = stagnantDays(candidate, now);
  if (stagnant !== null) return { kind: 'stagnant', text: `Sans mouvement depuis ${stagnant}\u00a0j` };

  const ago = timeAgoLabel(candidate.lastActivity || candidate.createdAt, now);
  const reply =
    REPLY_LABELS[candidate.outreachStatus ?? ''] ?? (candidate.sequenceStatus === 'replied' ? REPLY_LABELS.replied : null);
  if (reply && STAGES_BEFORE_REPLY.has(candidate.stage)) {
    return { kind: 'reply', text: ago ? `${reply} ${ago}` : reply };
  }
  if (candidate.sequenceStatus && candidate.sequenceStatus !== 'replied') {
    return { kind: 'sequence', status: candidate.sequenceStatus, ago };
  }
  return ago ? { kind: 'activity', text: `Dernière action ${ago}` } : null;
}

/** Contrôle secondaire d'une carte : au-dessus du bouton qui couvre la carte, jamais une poignée de glisser. */
const CONTROL = 'relative z-10';

/**
 * Le nom : un bouton du kit dont la surface cliquable (::after) couvre toute la
 * carte, avec l'anneau de focus autour de la carte plutôt que du texte.
 */
const STRETCHED_BUTTON =
  'h-auto max-w-full justify-start p-0 text-left hover:no-underline active:scale-100 after:absolute after:inset-0 after:rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background';

/** Puce du poste : un bouton du kit à la taille d'une puce, cible élargie au doigt. */
const JOB_CHIP =
  'flex h-auto w-fit max-w-full gap-1 rounded-full px-2 py-0.5 font-normal text-foreground-secondary hover:text-foreground [&_svg]:size-3 after:absolute after:inset-0 [@media(pointer:coarse)]:after:-inset-y-3';

/** Révélé au survol et au focus ; toujours visible sur un écran tactile. */
const REVEAL =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100';

export const ATSCandidateCard: React.FC<ATSCandidateCardProps> = ({
  candidate,
  onOpen,
  onJobClick,
  selected = false,
  onToggleSelect,
  selectionMode = false,
  stages,
  onMove,
  drag,
  isDragging = false,
  overlay = false,
}) => {
  const signal = cardSignal(candidate, new Date());
  const jobClickable = !overlay && !!candidate.jobTitle && !!candidate.jobId && !!onJobClick;

  // Le glisser part de toute la carte, sauf de ses contrôles et des menus ouverts
  // depuis elle (rendus hors de la carte, mais remontés par React).
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target) || target.closest('[data-no-drag]')) return;
    drag?.listeners?.onPointerDown?.(event);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    drag?.listeners?.onKeyDown?.(event);
  };

  const signalLine = signal && (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs',
        signal.kind === 'stagnant' ? 'font-medium text-warning' : 'text-muted-foreground',
      )}
    >
      {signal.kind === 'sequence' ? (
        <>
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="sr-only">
            {candidate.sequenceName ? `Séquence « ${candidate.sequenceName} » :` : 'Séquence :'}
          </span>
          <EnrollmentStatusBadge status={signal.status} className="shrink-0" />
          {signal.ago && <span className="truncate">{signal.ago}</span>}
        </>
      ) : (
        <span className="truncate">{signal.text}</span>
      )}
    </p>
  );

  if (overlay) {
    return (
      <div className="w-[264px] rounded-lg border border-border-strong bg-card p-3 shadow-lg">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{candidate.name}</p>
          <ScoreBadge score={candidate.score} className="shrink-0" />
        </div>
        {(candidate.jobTitle || candidate.headline) && (
          <p className="mt-1 truncate text-xs text-foreground-secondary">{candidate.jobTitle || candidate.headline}</p>
        )}
        {signalLine && <div className="mt-2">{signalLine}</div>}
      </div>
    );
  }

  return (
    <div
      ref={drag?.setNodeRef}
      data-card-id={candidate.id}
      onPointerDown={drag ? handlePointerDown : undefined}
      onKeyDown={drag ? handleKeyDown : undefined}
      className={cn(
        'group relative rounded-lg border bg-card p-3 transition-colors duration-150',
        selected ? 'border-brand' : 'border-border hover:border-border-strong',
        isDragging && 'opacity-50',
      )}
    >
      {/* Case de sélection posée sur le coin de la carte : elle n'occupe pas de place dans les lignes. */}
      {onToggleSelect && (
        <Checkbox
          data-no-drag
          checked={selected}
          onCheckedChange={() => onToggleSelect()}
          aria-label={`Sélectionner ${candidate.name}`}
          className={cn(
            'absolute -left-1.5 -top-1.5 z-10 bg-card',
            'after:absolute after:-inset-1.5 [@media(pointer:coarse)]:after:-inset-3.5',
            !(selected || selectionMode) && REVEAL,
          )}
        />
      )}
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium text-foreground">
          <Button
            ref={drag?.setActivatorNodeRef}
            type="button"
            variant="link"
            data-card-activator
            onClick={onOpen}
            {...drag?.attributes}
            className={STRETCHED_BUTTON}
          >
            <span className="truncate">{candidate.name}</span>
          </Button>
        </h3>
        {candidate.hasReminder && (
          <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" role="img" aria-label="Rappel en attente" />
        )}
        <ScoreBadge score={candidate.score} className="shrink-0" />
      </div>

      {jobClickable ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-no-drag
          onClick={() => onJobClick?.(candidate.jobId as string)}
          className={cn(CONTROL, JOB_CHIP, 'mt-1.5')}
        >
          <Briefcase aria-hidden="true" />
          <span className="sr-only">Voir le poste </span>
          <span className="truncate">{candidate.jobTitle}</span>
        </Button>
      ) : candidate.jobTitle || candidate.headline ? (
        <p className="mt-1 truncate text-xs text-foreground-secondary">{candidate.jobTitle || candidate.headline}</p>
      ) : null}

      {(signalLine || (stages && onMove)) && (
        <div className="mt-2 flex min-h-7 items-center justify-between gap-2">
          {signalLine ?? <span />}
          {stages && onMove && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      data-no-drag
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Déplacer ${candidate.name} vers une autre étape`}
                      className={cn(CONTROL, 'shrink-0 text-muted-foreground after:absolute after:-inset-2', REVEAL)}
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
                  value={candidate.stage}
                  onValueChange={(stageKey) => {
                    if (stageKey !== candidate.stage) onMove(stageKey);
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
          )}
        </div>
      )}
    </div>
  );
};
