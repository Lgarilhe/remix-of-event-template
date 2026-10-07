import { agentMemoryScopeLabel } from '@/types/agentMemory';
import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
  onReplay?: () => void;
}

export function AgentMemoryScopeGuide({ orgType, hasProject, onReplay }: Props) {
  return (
    <details className="space-y-2">
      <summary className="min-h-11 cursor-pointer rounded-lg py-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:min-h-0 md:py-1">
        Comment les mémoires s’appliquent
      </summary>
      <div className="space-y-3 text-sm text-foreground-secondary">
        <p>Les contraintes priment sur les préférences. À nature égale, chaque niveau encadre ceux qui le suivent :</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li><span className="font-medium text-foreground">{agentMemoryScopeLabel('organization', orgType)}</span> : règles partagées de votre espace.</li>
          {hasProject && <li><span className="font-medium text-foreground">{agentMemoryScopeLabel('project', orgType)}</span> : consignes propres à ce recrutement.</li>}
          <li><span className="font-medium text-foreground">{agentMemoryScopeLabel('user', orgType)}</span> : préférences personnelles dans cet espace.</li>
        </ol>
        <p>En cas de conflit entre des mémoires, l’assistant vous demande une clarification.</p>
        {onReplay && <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-0" onClick={onReplay}>
          <PlayCircle aria-hidden="true" className="h-4 w-4" />Revoir l’explication
        </Button>}
      </div>
    </details>
  );
}
