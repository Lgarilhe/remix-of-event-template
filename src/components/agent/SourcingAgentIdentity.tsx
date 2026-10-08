import { Check } from 'lucide-react';
import { AgentOrb } from './AgentOrb';
import { Badge } from '@/components/ui/badge';
import { sourcingAgentStateLabel, type SourcingAgent } from '@/types/sourcingAgent';

interface Props {
  agent?: SourcingAgent | null;
  projectName?: string;
  step: 0 | 1 | 2;
  verified: boolean;
}

const steps = [
  { title: 'Préparer', description: 'Mission, source et limites' },
  { title: 'Calibrer', description: '5 profils, vos avis motivés' },
  { title: 'Activer', description: 'Vous validez, il recherche' },
];

export function SourcingAgentIdentity({ agent, projectName, step, verified }: Props) {
  const running = Boolean(verified && agent && ['active', 'calibrating'].includes(agent.status)
    && agent.lease_until && new Date(agent.lease_until).getTime() > Date.now());
  const tone = agent && ['paused', 'stopped', 'blocked'].includes(agent.status) ? 'slate'
    : step === 0 ? 'amber' : step === 1 ? 'violet' : 'teal';
  const activated = Boolean(verified && agent?.status === 'active');
  return <header className="space-y-6">
    <div className="flex items-center gap-5 sm:gap-7">
      <AgentOrb tone={tone} size="hero" animated={running} className="max-sm:h-20 max-sm:w-20 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Recherche de talents{projectName ? ` · ${projectName}` : ''}</p>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Votre agent de sourcing</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={agent?.status === 'blocked' || agent?.status === 'awaiting_review' ? 'warning' : agent?.status === 'active' ? 'info' : 'muted'}>{agent ? sourcingAgentStateLabel(agent) : verified ? 'À configurer' : 'À vérifier'}</Badge>
          {!verified && agent && <span className="text-xs text-muted-foreground">Dernier état connu</span>}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">Il cherche et évalue des profils pour votre mission. Vous lui donnez le cap, puis vous décidez quels profils retenir et contacter.</p>
      </div>
    </div>
    <ol aria-label="Étapes de préparation de l’agent" className="grid grid-cols-3 gap-2 border-b border-border pb-5 sm:gap-5">
      {steps.map((item, index) => {
        const completed = index < step || (index === 2 && activated);
        return <li key={item.title} aria-current={index === step && !activated ? 'step' : undefined} className="flex min-w-0 gap-2 sm:gap-3">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${completed || index === step ? 'border-brand text-brand' : 'border-border text-muted-foreground'}`}>
            {completed ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <div className="min-w-0"><p className="text-sm font-medium">{item.title}</p><p className="hidden text-xs text-muted-foreground sm:block">{item.description}</p><span className="sr-only">{completed ? 'Terminé' : index === step ? 'Étape actuelle' : 'À venir'}</span></div>
        </li>;
      })}
    </ol>
  </header>;
}
