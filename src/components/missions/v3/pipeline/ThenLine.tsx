// Refonte mission, lot 3 : la liste « Ensuite » (conception 4.2, zone 3). Trois
// actions au plus, chacune cliquable ; une action sans geste (réponses reçues
// par un collègue, type d'organisation à faire choisir par le propriétaire)
// reste un simple texte. Design simplifié : la liste ne vit plus en ligne sous
// la carte, elle s'ouvre avec « Pourquoi maintenant ? », dans la carte.

import { Skeleton } from '@/components/ui/skeleton';
import type { ActionIntent, NextAction } from '@/lib/missionNextAction';

const LINK =
  'inline rounded-sm text-left text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11';

interface ThenLineProps {
  actions: readonly NextAction[];
  /** Un rang plus bas se lit encore : la hauteur de la liste est gardée. */
  loading: boolean;
  onRun: (intent: ActionIntent) => void;
}

function ThenItem({ action, onRun }: { action: NextAction; onRun: (intent: ActionIntent) => void }) {
  const button = action.button;
  if (!button) return <span className="text-muted-foreground">{action.short}</span>;
  if (button.intent.type === 'mailto') {
    return (
      <a href={button.intent.href} className={LINK}>
        {action.short}
      </a>
    );
  }
  const { intent } = button;
  return (
    <button type="button" onClick={() => onRun(intent)} className={LINK}>
      {action.short}
    </button>
  );
}

export function ThenLine({ actions, loading, onRun }: ThenLineProps) {
  if (actions.length === 0) {
    return loading ? <Skeleton data-testid="then-line-loading" className="h-5 w-2/3" aria-hidden="true" /> : null;
  }
  return (
    <div data-testid="then-line" className="space-y-1">
      <p className="text-sm font-medium text-foreground">Ensuite</p>
      <ul className="space-y-0.5 text-sm">
        {actions.map((action) => (
          <li key={action.key}>
            <ThenItem action={action} onRun={onRun} />
          </li>
        ))}
      </ul>
    </div>
  );
}
