// Refonte mission, lot 2 : ligne d'outils du Pipeline (conception 4.2) : lien
// vers les profils jamais ouverts (au Sourcing), bascule Liste / Par étape,
// Bilan, Prise de contact.

import { BarChart3, LayoutGrid, List, Send, UserSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { unopenedLinkText, type PipelineViewMode } from '../types';

interface PipelineToolbarProps {
  /** Profils jamais ouverts ; null si les effectifs manquent. */
  unopened: number | null;
  onOpenSourcing: () => void;
  view: PipelineViewMode;
  onViewChange: (view: PipelineViewMode) => void;
  bilanOpen: boolean;
  onToggleBilan: () => void;
  onOpenContact: () => void;
}

const TOGGLE = [
  { value: 'liste' as const, label: 'Liste', icon: List },
  { value: 'etapes' as const, label: 'Par étape', icon: LayoutGrid },
];

export function PipelineToolbar({
  unopened,
  onOpenSourcing,
  view,
  onViewChange,
  bilanOpen,
  onToggleBilan,
  onOpenContact,
}: PipelineToolbarProps) {
  const unopenedText = unopenedLinkText(unopened);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unopenedText && (
        <button
          type="button"
          data-testid="unopened-link"
          onClick={onOpenSourcing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-1 text-sm text-brand underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserSearch className="h-4 w-4" aria-hidden="true" />
          {unopenedText}
        </button>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Affichage" className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
          {TOGGLE.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => onViewChange(value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-150 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === value ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" aria-expanded={bilanOpen} onClick={onToggleBilan} className={cn(bilanOpen && 'bg-muted')}>
          <BarChart3 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Bilan
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenContact}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Prise de contact
        </Button>
      </div>
    </div>
  );
}
