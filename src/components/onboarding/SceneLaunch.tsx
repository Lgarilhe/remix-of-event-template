import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';

export interface LaunchChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** Rubrique des Paramètres où terminer plus tard (affichée si non fait) */
  settingsPath?: string;
}

interface Props {
  items: LaunchChecklistItem[];
  orgName?: string;
  onFinish: () => void;
}

function configuredLabel(done: number, total: number): string {
  return done > 1 ? `${done} éléments configurés sur ${total}` : `${done} élément configuré sur ${total}`;
}

/**
 * Fin du tunnel : une coche, ce qui est fait et ce qui reste, une action.
 * Plus de confettis ni de compteur qui défile (B-65).
 */
export const SceneLaunch: React.FC<Props> = ({ items, orgName, onFinish }) => {
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <IconTile icon={Check} tone="success" size="lg" aria-hidden="true" />
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Votre espace est prêt</h1>
          <p className="text-sm text-muted-foreground">
            {orgName ? `${orgName} : ` : ''}
            {configuredLabel(doneCount, items.length)}.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            {item.done ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-success-muted text-success">
                <Check className="h-3 w-3" aria-hidden="true" />
              </span>
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                <Circle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
            <span className={cn('min-w-0 flex-1 text-sm', item.done ? 'text-foreground' : 'text-muted-foreground')}>
              {item.label}
              <span className="sr-only">{item.done ? ' : fait' : ' : à faire'}</span>
            </span>
            {!item.done && item.settingsPath && (
              <Link
                to={item.settingsPath}
                className="inline-flex min-h-11 shrink-0 items-center rounded-md text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
              >
                Terminer dans les Paramètres
              </Link>
            )}
          </li>
        ))}
      </ul>

      <Button variant="primary" size="lg" onClick={onFinish} className="min-h-11 w-full md:min-h-0">
        Créer une mission
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
};
