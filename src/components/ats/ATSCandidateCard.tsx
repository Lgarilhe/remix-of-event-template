/**
 * Carte d'un candidat dans les colonnes du pipeline global (revue design E-18,
 * E-19, E-22, E-43).
 *
 * Trois lignes : le nom et le score ; la mission (un bouton qui ouvre la fiche de
 * la mission, avec le nom de l'étape d'entretien en sous-titre pour En
 * entretien) ou, à défaut, l'intitulé du candidat ; un seul signal daté (« A
 * répondu il y a 2 h », le statut de séquence traduit, sinon « Dans cette étape
 * depuis 6 j », en warning au-delà du délai de l'étape). La colonne porte
 * l'étape : la carte ne la répète pas.
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
import { PersonAvatar } from '@/components/ui/person-avatar';
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
import { type ATSCandidate, daysInStage, stagnantDays } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/relativeTime';

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
  | { kind: 'stagnant' | 'reply' | 'age' | 'activity'; text: string }
  | { kind: 'sequence'; status: string; ago: string | null };

function cardSignal(candidate: ATSCandidate, now: Date): CardSignal | null {
  // Plan 0c, section 6.4 : le temps se compte depuis l'entrée dans l'étape.
  const stagnant = stagnantDays(candidate, now);
  // Un candidat de séquence ou d'InMail n'a pas de date d'entrée dans l'étape : le délai
  // vient de sa dernière action, et la phrase le dit.
  if (stagnant !== null) {
    return {
      kind: 'stagnant',
      text: candidate.stageEnteredAt ? `Dans cette étape depuis ${stagnant}\u00a0j` : `Dernière action il y a ${stagnant}\u00a0j`,
    };
  }

  const ago = timeAgo(candidate.lastActivity || candidate.createdAt, { now });
  const reply =
    REPLY_LABELS[candidate.outreachStatus ?? ''] ??
    (candidate.repliedAt || candidate.sequenceStatus === 'replied' ? REPLY_LABELS.replied : null);
  if (reply && STAGES_BEFORE_REPLY.has(candidate.stage)) {
    return { kind: 'reply', text: ago ? `${reply} ${ago}` : reply };
  }
  if (candidate.sequenceStatus && candidate.sequenceStatus !== 'replied') {
    return { kind: 'sequence', status: candidate.sequenceStatus, ago };
  }
  // Une ligne de mission porte sa date d'entrée dans l'étape ; un candidat de
  // séquence ou d'InMail n'a que sa dernière action.
  if (candidate.stageEnteredAt) {
    const days = daysInStage(candidate, now);
    if (days !== null) return { kind: 'age', text: `Dans cette étape depuis ${days}\u00a0j` };
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
  // Nom de l'étape d'entretien de la mission, sous la mission : colonne En entretien seulement.
  const stepName = candidate.stage === 'ITW en cours' ? candidate.processStepName : null;
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
          <PersonAvatar name={candidate.name} src={candidate.pictureUrl} candidateId={candidate.candidateId} size={28} />
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{candidate.name}</p>
          <ScoreBadge score={candidate.score} className="shrink-0" />
        </div>
        {(candidate.jobTitle || candidate.headline) && (
          <p className="mt-1 truncate text-xs text-foreground-secondary">{candidate.jobTitle || candidate.headline}</p>
        )}
        {stepName && <p className="mt-1 truncate text-xs text-muted-foreground">{stepName}</p>}
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
        <PersonAvatar name={candidate.name} src={candidate.pictureUrl} candidateId={candidate.candidateId} size={28} />
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
          <span className="sr-only">Voir la mission </span>
          <span className="truncate">{candidate.jobTitle}</span>
        </Button>
      ) : candidate.jobTitle || candidate.headline ? (
        <p className="mt-1 truncate text-xs text-foreground-secondary">{candidate.jobTitle || candidate.headline}</p>
      ) : null}
      {stepName && <p className="mt-1 truncate text-xs text-muted-foreground">{stepName}</p>}

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
