import type { ReactNode } from 'react';

/** Bloc ciblé par une ancre (#credits…). scroll-mt-20 : l'en-tête ne le recouvre pas.
 *  empty:hidden : un bloc qui ne rend rien (extension masquée) ne laisse pas d'espace. */
export function SettingsAnchor({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} className="scroll-mt-20 empty:hidden">{children}</div>;
}
