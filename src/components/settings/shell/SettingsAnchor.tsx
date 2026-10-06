import type { ReactNode } from 'react';
import { CardPlainProvider } from '@/components/ui/card';

/** Bloc ciblé par une ancre (#credits…). scroll-mt-20 : l'en-tête ne le recouvre pas.
 *  empty:hidden : un bloc qui ne rend rien (extension masquée) ne laisse pas d'espace.
 *  Design simplifié (lot Suite) : les cartes de la rubrique passent à plat et un
 *  filet fin sépare la rubrique de la précédente. */
export function SettingsAnchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20 border-t border-border pt-6 empty:hidden first:border-t-0 first:pt-0">
      <CardPlainProvider>{children}</CardPlainProvider>
    </div>
  );
}
