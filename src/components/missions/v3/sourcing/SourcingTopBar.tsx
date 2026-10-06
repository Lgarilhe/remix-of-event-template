// Refonte mission, écran Sourcing de la nouvelle page (rangée A, maquette
// Sourcing) : champ « Affiner » toujours visible (affinage existant en langage
// naturel, les filtres changent et la recherche ne repart que sur
// « Relancer »), bouton « Filtres (N) » qui déplie la zone des filtres, et
// « Nouvelle recherche » (fenêtre de filtres existante). La zone des filtres
// (pilules, filtres rapides, écoles et entreprises ajoutées, « À l'écoute »)
// est fournie par LinkedInSearch en enfants ; elle est repliée par défaut.
//
// Design simplifié (04/10/2026) : le champ reste un champ ; « Filtres » et
// « Nouvelle recherche » sont des boutons discrets, sans cadre ; pas de « (0) »
// quand aucun filtre n'est posé ; la zone des filtres, sans carte, ne garde
// qu'un filet fin ; cibles de 44 px sur téléphone.

import { useId, useState, type ReactNode } from 'react';
import { Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SourcingTopBarProps {
  /** Nombre de filtres posés (pilules). */
  filterCount: number;
  /** Affinage en langage naturel ; rejette en cas d'échec (message déjà affiché). */
  onRefine: (phrase: string) => Promise<void>;
  onNewSearch: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function SourcingTopBar({ filterCount, onRefine, onNewSearch, disabled = false, children }: SourcingTopBarProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const zoneId = useId();
  const armed = value.trim().length > 0;

  const submit = async () => {
    const phrase = value.trim();
    if (!phrase || busy) return;
    setBusy(true);
    try {
      await onRefine(phrase);
      setValue('');
    } catch {
      // Message déjà affiché par l'affinage ; la phrase reste pour réessayer.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="relative flex min-w-0 flex-[1_1_16rem] items-center">
          <Sparkles aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={value}
            // Pendant l'affinage : lecture seule (le focus reste dans le champ).
            readOnly={busy}
            aria-busy={busy}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
              if (e.key === 'Escape') setValue('');
            }}
            aria-label="Affiner la recherche en langage naturel"
            placeholder="Affiner : par exemple, plutôt des profils passés par un fonds"
            className={cn(
              'h-9 w-full min-w-0 rounded-lg border border-input bg-background pl-9 pr-[4.5rem] text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground max-sm:h-11',
              busy && 'text-muted-foreground',
            )}
          />
          {busy ? (
            <span role="status" className="absolute right-2.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span className="sr-only">Affinage en cours</span>
            </span>
          ) : armed ? (
            <button
              type="button"
              onClick={() => void submit()}
              aria-label="Valider la demande (Entrée)"
              className="absolute right-1.5 h-7 rounded-md bg-muted px-2.5 text-xs text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-9"
            >
              Entrée
            </button>
          ) : (
            <span aria-hidden="true" className="pointer-events-none absolute right-3 text-xs text-muted-foreground max-sm:hidden">
              Entrée
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={zoneId}
            className={cn('tabular-nums text-foreground-secondary hover:text-foreground max-sm:min-h-11', open && 'bg-muted text-foreground')}
          >
            <SlidersHorizontal aria-hidden="true" />
            {filterCount > 0 ? `Filtres (${filterCount})` : 'Filtres'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNewSearch}
            disabled={disabled}
            className="text-foreground-secondary hover:text-foreground max-sm:min-h-11"
          >
            Nouvelle recherche
          </Button>
        </div>
      </div>
      <div id={zoneId} hidden={!open} className="mt-3 border-t border-border/50 pt-3">
        {open && children}
      </div>
    </div>
  );
}
