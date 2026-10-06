// Tableau des séquences de l'organisation (lot 5c-2), sans cadre : un filet
// sous l'en-tête et entre les lignes. Les colonnes chiffrées s'effacent sous
// 768 px (elles passent sous le nom), les expéditeurs sous 1 024 px.
import type React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export const ACCEPT_HINT = 'Invitations acceptées sur invitations envoyées.';
export const REPLY_HINT = 'Candidats qui ont répondu sur candidats contactés.';

export function SequencesTable({ children, footnote }: { children: React.ReactNode; footnote?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Séquences de l’organisation</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="w-16 py-2 pl-3 pr-2 font-medium"><span className="sr-only">Activation</span></th>
            <th scope="col" className="py-2 pr-3 font-medium">Séquence</th>
            <th scope="col" className="hidden w-24 py-2 pr-3 font-medium lg:table-cell"><abbr title="Expéditeurs" className="no-underline">Expéd.</abbr></th>
            <th scope="col" className="hidden w-48 py-2 pr-4 font-medium md:table-cell">Candidats</th>
            <th scope="col" className="hidden w-20 py-2 pr-3 font-medium md:table-cell"><abbr title={ACCEPT_HINT} className="no-underline">Accept.</abbr></th>
            <th scope="col" className="hidden w-20 py-2 pr-3 font-medium md:table-cell"><abbr title={REPLY_HINT} className="no-underline">Rép.</abbr></th>
            <th scope="col" className="w-12 py-2 pr-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}

/** Chargement : six lignes aux dimensions finales, jamais de zéro. */
export function SequencesTableSkeleton() {
  return (
    <div role="status" aria-label="Chargement des séquences" className="divide-y divide-border border-y border-border">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex h-14 items-center gap-4 px-3">
          <Skeleton className="h-6 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3 rounded-sm" />
            <Skeleton className="h-3 w-1/2 rounded-sm" />
          </div>
          <Skeleton className="hidden h-1.5 w-40 rounded-full md:block" />
        </div>
      ))}
    </div>
  );
}
