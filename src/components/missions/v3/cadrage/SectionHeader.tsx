// Refonte mission, écran Cadrage : l'en-tête d'une section et ce qui la sépare
// de la précédente. Design simplifié (04/10/2026) : plus de carte autour des
// sections ; un vrai titre, une phrase d'aide dessous, un filet fin et de
// l'espace entre deux sections. Les champs de saisie gardent leur bordure.
import type { ReactNode } from 'react';

export function SectionHeader({ id, title, help }: { id: string; title: string; help?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {help && <p className="text-sm text-muted-foreground">{help}</p>}
    </div>
  );
}
