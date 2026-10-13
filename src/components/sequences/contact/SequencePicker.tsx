// Refonte mission, lot 5f-2c : choix de la séquence dans le panneau Contacter.
//
// Présentation seulement : la liste vient du conteneur (ContactFlow) sous la
// forme d'un menu déjà trié (src/lib/missionSequencePick.ts). Ce composant ne
// lit que l'état de description du poste, pour la porte « Rédiger une séquence
// pour cette mission ».
//
// Cette porte s'ouvre dans un nouvel onglet : la sélection du Pipeline vit en
// mémoire et ne survit pas à un changement de route. Au retour sur l'onglet
// d'origine, le conteneur relit la liste et la séquence rédigée devient le choix.
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useMissionDraftReadiness } from '@/hooks/useSequenceAI';
import type { SequenceMenu } from '@/lib/missionSequencePick';
import { plural } from '@/lib/plural';
import { AI_DRAFT_NOT_DESCRIBED } from '@/lib/sequenceDraft';
import { newSequencePath } from '@/lib/sequencesBeta';
import { cn } from '@/lib/utils';
import type { ContactSequenceRow } from './useContactSequences';

interface SequencePickerProps {
  menu: SequenceMenu<ContactSequenceRow>;
  selectedId: string | null;
  status: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onSelect: (sequenceId: string) => void;
  /**
   * Identifiant de la mission (uuid nu), ou null hors mission (lot 5f-2d) : alors aucune porte « Rédiger
   * une séquence pour cette mission » (la rédaction par l'IA part du poste de la mission), les séquences
   * sont toutes celles de l'organisation.
   */
  missionId: string | null;
}

const TOUCH = 'max-lg:min-h-11';

const DRAFT_DOOR_LABEL = 'Rédiger une séquence pour cette mission';
const NEW_TAB_HINT = "S'ouvre dans un nouvel onglet. Au retour, la liste se met à jour.";
const NO_READY_SEQUENCE = "Cette mission n'a pas de séquence prête à l'emploi.";
const NO_READY_SEQUENCE_ORG = "Aucune séquence prête à l'emploi dans votre organisation.";
const LOAD_ERROR = "Les séquences n'ont pas pu être chargées.";
const PICK_PLACEHOLDER = 'Choisir une séquence';

interface SequenceItemProps {
  sequence: ContactSequenceRow;
  selected: boolean;
  onSelect: (sequenceId: string) => void;
}

function SequenceItem({ sequence, selected, onSelect }: SequenceItemProps): JSX.Element {
  return (
    <DropdownMenuItem
      data-sequence-id={sequence.id}
      aria-current={selected ? 'true' : undefined}
      onSelect={() => onSelect(sequence.id)}
      className={cn('gap-2', TOUCH)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{sequence.name}</span>
        <span className="block text-xs text-muted-foreground">{plural(sequence.stepCount, 'étape')}</span>
      </span>
      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {selected && <span className="sr-only">, séquence choisie</span>}
    </DropdownMenuItem>
  );
}

export function SequencePicker({ menu, selectedId, status, onRetry, onSelect, missionId }: SequencePickerProps): JSX.Element {
  const labelId = useId();
  const valueId = useId();
  const { loading: readinessLoading, described, cadrageHref } = useMissionDraftReadiness(missionId);
  const noMission = missionId === null;
  const canDraft = !readinessLoading && described;
  const draftHref = newSequencePath({ kind: 'ia' }, missionId);

  if (status === 'loading') {
    return (
      <div className="space-y-1.5" aria-busy="true" aria-label="Chargement des séquences">
        <span className="block text-xs font-medium text-foreground">Séquence</span>
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-foreground">{LOAD_ERROR}</p>
        <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={onRetry}>
          Réessayer
        </Button>
      </div>
    );
  }

  const all = [...menu.mission, ...menu.others];

  // Hors mission (lot 5f-2d), sans séquence utilisable : une phrase, aucune porte (la rédaction par l'IA part du poste d'une mission).
  if (all.length === 0 && noMission) {
    return (
      <div className="space-y-2" data-sequence-picker="empty">
        <p className="text-sm text-foreground">{NO_READY_SEQUENCE_ORG}</p>
      </div>
    );
  }

  // Aucune séquence utilisable : la porte tient la place du menu.
  if (all.length === 0) {
    return (
      <div className="space-y-2" data-sequence-picker="empty">
        <p className="text-sm text-foreground">{NO_READY_SEQUENCE}</p>
        {canDraft ? (
          <Button asChild variant="outline" size="sm" className={TOUCH}>
            <a href={draftHref} target="_blank" rel="noreferrer">
              <Sparkles aria-hidden="true" />
              {DRAFT_DOOR_LABEL}
            </a>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled className={TOUCH}>
            <Sparkles aria-hidden="true" />
            {DRAFT_DOOR_LABEL}
          </Button>
        )}
        {canDraft && <p className="text-xs text-muted-foreground">{NEW_TAB_HINT}</p>}
        {!readinessLoading && !described && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">{AI_DRAFT_NOT_DESCRIBED}</p>
            {cadrageHref && (
              <Link
                to={cadrageHref}
                className="inline-flex items-center text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline max-lg:min-h-11"
              >
                Décrire le poste
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  const selected = all.find((sequence) => sequence.id === selectedId) ?? null;

  return (
    <div className="space-y-1.5" data-sequence-picker="ready">
      <span id={labelId} className="block text-xs font-medium text-foreground">Séquence</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-labelledby={`${labelId} ${valueId}`}
            className={cn('w-full justify-between gap-2', TOUCH)}
          >
            <span id={valueId} className="min-w-0 flex-1 truncate text-left">{selected ? selected.name : PICK_PLACEHOLDER}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
          {menu.mission.length > 0 && (
            <>
              <DropdownMenuLabel>Séquences de la mission</DropdownMenuLabel>
              {menu.mission.map((sequence) => (
                <SequenceItem key={sequence.id} sequence={sequence} selected={sequence.id === selectedId} onSelect={onSelect} />
              ))}
            </>
          )}
          {menu.mission.length > 0 && menu.others.length > 0 && <DropdownMenuSeparator />}
          {menu.others.length > 0 && (
            <>
              <DropdownMenuLabel>{noMission ? "Séquences de l'organisation" : "Autres séquences de l'organisation"}</DropdownMenuLabel>
              {menu.others.map((sequence) => (
                <SequenceItem key={sequence.id} sequence={sequence} selected={sequence.id === selectedId} onSelect={onSelect} />
              ))}
            </>
          )}
          {!noMission && (
            <>
              <DropdownMenuSeparator />
              {canDraft ? (
                <>
                  <DropdownMenuItem asChild className={TOUCH}>
                    <a href={draftHref} target="_blank" rel="noreferrer">
                      <Sparkles className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                      {DRAFT_DOOR_LABEL}
                    </a>
                  </DropdownMenuItem>
                  <p className="px-2 pb-1.5 text-xs text-muted-foreground">{NEW_TAB_HINT}</p>
                </>
              ) : (
                <>
                  <DropdownMenuItem disabled className={TOUCH}>
                    <Sparkles className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                    {DRAFT_DOOR_LABEL}
                  </DropdownMenuItem>
                  {!readinessLoading && (
                    <>
                      <p className="px-2 pb-1 text-xs text-muted-foreground">{AI_DRAFT_NOT_DESCRIBED}</p>
                      {cadrageHref && (
                        <DropdownMenuItem asChild className={TOUCH}>
                          <Link to={cadrageHref}>Décrire le poste</Link>
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
