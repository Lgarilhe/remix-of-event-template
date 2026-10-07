// Carte d'une étape du fil : numéro, icône, titre, extrait, badges (« A/B · 2
// versions », « avec note », « Créneau 9 h-12 h », « Seulement si en
// relation »), point à corriger en rouge, conseil en orange. Un clic ouvre le
// panneau d'étape ; le menu « ... » (visible au survol, au focus et au
// toucher) porte les gestes de l'étape.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import type { EditorForkNode, EditorStepNode, MoveCheck, StepIssues } from '@/lib/sequenceEditor';
import { cn } from '@/lib/utils';

/** Menu de carte : visible au survol, au focus et au toucher (l'opacité seule change). */
const REVEAL = 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none';

export interface StepCardActions {
  onSelect: () => void;
  /** Ajouter une version B ou C ; absent quand le type n'en accepte pas ou qu'il y en a trois. */
  onAddVersion?: () => void;
  moveUp: MoveCheck;
  moveDown: MoveCheck;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
  removing: boolean;
}

interface StepCardProps {
  node: EditorStepNode | EditorForkNode;
  selected: boolean;
  issues?: StepIssues;
  actions: StepCardActions;
  /** Raisons d'une étape « À rédiger » (rédaction par l'IA, texte retiré par les contrôles, encore vide). */
  toWrite?: readonly string[];
}

export function StepCard({ node, selected, issues, actions, toWrite }: StepCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Carte ouverte (ou tout juste ajoutée) : ramenée dans la zone visible du fil.
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  // Texte retiré par la rédaction : « À rédiger » et sa raison, à la place de la description (« Invitation sans note… ») et de la ligne générique.
  const aiToWrite = toWrite && toWrite.length > 0 ? `À rédiger · ${toWrite.join(' ')}` : null;
  const error = aiToWrite ?? issues?.errors[0] ?? null;
  const warning = !error ? issues?.warnings[0] ?? null : null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.onSelect();
    }
  };
  const moveItem = (direction: 'up' | 'down') => {
    const check = direction === 'up' ? actions.moveUp : actions.moveDown;
    return (
      <DropdownMenuItem
        disabled={!check.allowed}
        onSelect={() => actions.onMove(direction)}
        className="items-start gap-2 max-md:min-h-11"
      >
        {direction === 'up' ? <ArrowUp className="mt-0.5 h-4 w-4" aria-hidden="true" /> : <ArrowDown className="mt-0.5 h-4 w-4" aria-hidden="true" />}
        <span className="min-w-0">
          {direction === 'up' ? 'Monter d’un cran' : 'Descendre d’un cran'}
          {!check.allowed && check.reason && <span className="block text-xs text-muted-foreground">{check.reason}</span>}
        </span>
      </DropdownMenuItem>
    );
  };

  return (
    <div className="group relative mx-auto w-full max-w-sm">
      <div
        ref={cardRef}
        data-step-card={node.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`Étape ${node.number} : ${node.title}${error ? ', point à corriger' : ''}. Modifier`}
        onClick={actions.onSelect}
        onKeyDown={onKeyDown}
        className={cn(
          'cursor-pointer rounded-xl border bg-card p-3 pr-11 text-left shadow-sm transition-colors duration-150 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          error ? 'border-danger' : 'border-border',
          selected && 'ring-2 ring-brand',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-6 min-w-6 place-items-center rounded-md bg-muted px-1 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {node.number}
          </span>
          <SequenceActionIcon type={node.actionType} className="h-4 w-4 text-foreground" />
          <h3 className="min-w-0 text-sm font-semibold text-foreground">{node.title}</h3>
        </div>
        {node.excerpt && <p className="mt-1.5 line-clamp-2 text-sm text-foreground-secondary">{node.excerpt}</p>}
        {node.description && !aiToWrite && <p className="mt-1.5 text-sm text-muted-foreground">{node.description}</p>}
        {node.badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {node.badges.map((badge) => (
              <Badge key={badge} variant={badge.startsWith('A/B') ? 'brand' : badge === 'Non pris en charge' ? 'warning' : 'muted'}>{badge}</Badge>
            ))}
          </div>
        )}
        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {warning && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {warning}
          </p>
        )}
      </div>
      <div className="absolute right-1.5 top-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions de l’étape ${node.number}`}
              className={cn(REVEAL, 'max-md:h-11 max-md:w-11')}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={actions.onSelect} className="gap-2 max-md:min-h-11">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Modifier
            </DropdownMenuItem>
            {actions.onAddVersion && (
              <DropdownMenuItem onSelect={actions.onAddVersion} className="gap-2 max-md:min-h-11">
                <Copy className="h-4 w-4" aria-hidden="true" />
                Tester une autre version (A/B)
              </DropdownMenuItem>
            )}
            {moveItem('up')}
            {moveItem('down')}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={actions.removing}
              onSelect={actions.onRemove}
              className="gap-2 text-danger focus:text-danger max-md:min-h-11"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Supprimer l’étape {node.number}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
