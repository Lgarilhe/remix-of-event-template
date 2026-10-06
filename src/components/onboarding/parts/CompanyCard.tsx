import React, { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LookupState } from '@/hooks/onboarding/useCompanyLookup';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Logo de la société, sinon ses initiales : jamais un avatar coloré au hasard. */
const Logo: React.FC<{ name: string; url: string | null }> = ({ name, url }) => {
  const [failed, setFailed] = useState<string | null>(null);
  const src = url && failed !== url ? url : null;
  if (!src) {
    return (
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-foreground-secondary">
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain"
    />
  );
};

interface Props {
  lookup: LookupState;
  onPick: (candidateId: string) => void;
  onNone: () => void;
  onRetry: () => void;
  className?: string;
}

/**
 * Fiche de la société, en arrière-plan : recherche en cours, plusieurs sociétés
 * possibles (on choisit la bonne), fiche trouvée, ou échec (on continue sans).
 * Rien ne s'affiche tant qu'aucune recherche n'a démarré.
 */
export const CompanyCard: React.FC<Props> = ({ lookup, onPick, onNone, onRetry, className }) => {
  if (lookup.status === 'idle') return null;
  return (
    <div key={lookup.status} className={cn('rounded-xl border border-border bg-card p-4', className)} aria-live="polite">
      {lookup.status === 'loading' && (
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="truncate text-sm font-medium text-foreground">Recherche de « {lookup.name} »…</p>
            <p className="text-xs text-muted-foreground">Logo, site et postes ouverts. Cela peut prendre une demi-minute : continuez, la fiche s'ajoutera.</p>
          </div>
        </div>
      )}

      {lookup.status === 'ready' && (
        <div className="flex items-start gap-3">
          <Logo name={lookup.company.name} url={lookup.company.logoUrl} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="truncate">{lookup.company.name}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-success">
                <Check className="h-3 w-3" aria-hidden="true" />
                Fiche trouvée
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[lookup.company.industry, lookup.company.size ? `${lookup.company.size} salariés` : null, lookup.company.location].filter(Boolean).join(' · ') ||
                'Aucun détail public trouvé.'}
            </p>
          </div>
        </div>
      )}

      {lookup.status === 'disambiguate' && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Plusieurs sociétés portent ce nom</p>
            <p className="text-xs text-muted-foreground">Choisissez la bonne pour une fiche exacte.</p>
          </div>
          <div className="space-y-1.5">
            {lookup.candidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                onClick={() => onPick(c.id)}
                className="h-auto w-full justify-start gap-3 whitespace-normal p-2.5 text-left font-normal"
              >
                <Logo name={c.name} url={c.logoUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.domain, c.industry, c.location].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onNone} className="text-muted-foreground">
            Aucune ne correspond
          </Button>
        </div>
      )}

      {lookup.status === 'failed' && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground-secondary">La fiche de « {lookup.name} » n'a pas pu être trouvée. Vous pouvez continuer sans.</p>
          <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
            <RefreshCw aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      )}
    </div>
  );
};
