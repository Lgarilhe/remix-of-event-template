// Refonte mission, lot 3 : la ligne « Ensuite » sous la carte « Maintenant »
// (conception 4.2, zone 3). Trois actions au plus, chacune cliquable ; une
// action sans geste (réponses reçues par un collègue, type d'organisation à
// faire choisir par le propriétaire) reste un simple texte. Sur téléphone :
// la première action, puis « N autres » qui déplie le reste.

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ActionIntent, NextAction } from '@/lib/missionNextAction';

const LINK =
  'inline rounded-sm text-left text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface ThenLineProps {
  actions: readonly NextAction[];
  /** Un rang plus bas se lit encore : la hauteur de la ligne est gardée. */
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
  const [expanded, setExpanded] = useState(false);
  if (actions.length === 0) {
    return loading ? <Skeleton data-testid="then-line-loading" className="h-5 w-2/3" aria-hidden="true" /> : null;
  }
  const hidden = actions.length - 1;
  return (
    <p data-testid="then-line" className="text-sm leading-6 text-muted-foreground">
      <span className="font-medium text-foreground">Ensuite : </span>
      {actions.map((action, i) => (
        <span key={action.key} className={cn(i > 0 && !expanded && 'max-sm:hidden')}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <ThenItem action={action} onRun={onRun} />
        </span>
      ))}
      {hidden > 0 && (
        <>
          <span aria-hidden="true" className="sm:hidden">
            {' · '}
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className={cn(LINK, 'text-muted-foreground sm:hidden max-sm:inline-flex max-sm:min-h-11 max-sm:items-center')}
          >
            {expanded ? 'Réduire' : hidden > 1 ? `${hidden} autres` : '1 autre'}
          </button>
        </>
      )}
    </p>
  );
}
