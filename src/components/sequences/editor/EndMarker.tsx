// Bouts d'une branche du fil : « Fin de la séquence », ou l'étape déjà
// dessinée ailleurs que la branche rejoint.
import { CornerDownRight, Flag } from 'lucide-react';

export function EndMarker() {
  return (
    <div className="flex justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <Flag className="h-3 w-3 text-foreground" aria-hidden="true" />
        Fin de la séquence
      </span>
    </div>
  );
}

export function JoinMarker({ number, title }: { number: number; title: string }) {
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <CornerDownRight className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
      Rejoint l’étape {number} : {title}
    </p>
  );
}

/** Trait vertical entre deux éléments du fil. */
export function Connector() {
  return <div className="mx-auto h-4 w-px bg-border" aria-hidden="true" />;
}
