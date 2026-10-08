import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { SERVICE_LABELS, type MessagingService } from '@/lib/messagingServices';

/** Une ligne factuelle, commune aux propositions et à leur aperçu. */
export function CandidateActionSummary({ effects }: {
  effects: Array<{ kind: string; service?: MessagingService }>;
}) {
  const messages = effects.filter(effect => effect.kind === 'message').length;
  const contents = effects.length - messages;
  const services = [...new Set(effects.flatMap(effect => effect.kind === 'message' && effect.service ? [effect.service] : []))];
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground" aria-label="Contenus de la proposition" role="group">
    <span>{[messages > 0 && `${messages} message${messages > 1 ? 's' : ''}`, contents > 0 && `${contents} contenu${contents > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'Aucun contenu'}</span>
    {services.map(service => <span key={service} className="inline-flex items-center gap-1.5"><ServiceLogo service={service} decorative />{SERVICE_LABELS[service]}</span>)}
  </div>;
}
