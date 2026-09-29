// Refonte mission, écran Sourcing de la nouvelle page (rangée A, maquette
// Sourcing) : champ « Affiner » toujours visible (affinage existant en langage
// naturel, les filtres changent et la recherche ne repart que sur
// « Relancer »), bouton « Filtres (N) » qui déplie la zone des filtres, et
// « Nouvelle recherche » (fenêtre de filtres existante). La zone des filtres
// (pilules, filtres rapides, écoles et entreprises ajoutées, « À l'écoute »)
// est fournie par LinkedInSearch en enfants ; elle est repliée par défaut.

import { useId, useState, type ReactNode } from 'react';
import { Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex min-w-0 flex-[1_1_16rem] items-center">
          <Sparkles aria-hidden="true" className="pointer-events-none absolute left-3 h-[15px] w-[15px] text-muted-foreground" />
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
              'h-9 w-full min-w-0 rounded-lg border border-border bg-background pl-9 pr-[4.5rem] text-[13.5px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
              busy && 'opacity-60',
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
              className="absolute right-1.5 h-6 rounded-md border border-border bg-muted px-2 text-[11.5px] text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Entrée
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 rounded-[5px] border border-border px-1.5 py-px text-[11.5px] text-muted-foreground"
            >
              Entrée
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={zoneId}
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium tabular-nums text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open ? 'border-border-strong bg-muted/60' : 'border-border bg-transparent',
          )}
        >
          <SlidersHorizontal className="h-[15px] w-[15px]" aria-hidden="true" />
          Filtres ({filterCount})
        </button>
        <button
          type="button"
          onClick={onNewSearch}
          disabled={disabled}
          className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-transparent px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          Nouvelle recherche
        </button>
      </div>
      <div id={zoneId} hidden={!open} className="mt-3 rounded-lg border border-border bg-card/40 p-3">
        {open && children}
      </div>
    </div>
  );
}
