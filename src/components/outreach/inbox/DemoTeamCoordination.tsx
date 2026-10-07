import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { SERVICE_LABELS } from '@/lib/messagingServices';
import type { DemoActionResult, DemoCandidateAction } from '@/lib/inboxDemoActions';

/** Les messages aux collègues restent distincts des échanges avec le candidat. */
export function DemoTeamCoordination({ actions, results }: {
  actions: DemoCandidateAction[];
  results: Record<string, DemoActionResult>;
}) {
  const messages = actions.flatMap(action => {
    const result = results[action.id];
    if (!result) return [];
    return action.effects.flatMap(effect => effect.kind === 'message' && effect.audience === 'team'
      ? [{ key: `${action.id}-${effect.id}`, effect, result }]
      : []);
  });
  if (messages.length === 0) return null;

  return <section className="mt-6 border-t border-border pt-4" aria-label="Coordination avec l’équipe" data-component="demo-team-coordination">
    <h4 className="text-sm font-semibold text-foreground">Coordination avec l’équipe</h4>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Messages adressés à vos collègues pour ce candidat.</p>
    <div className="mt-3 divide-y divide-border">{messages.map(({ key, effect, result }) => <article key={key} aria-label={effect.label} className="space-y-2 py-3 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <ServiceLogo service={effect.service} decorative />
        <h5 className="min-w-0 break-words text-sm font-medium text-foreground">{effect.label}</h5>
        <span className="text-xs text-muted-foreground">{SERVICE_LABELS[effect.service]}</span>
      </div>
      <p className="break-words text-xs text-foreground-secondary [overflow-wrap:anywhere]">À : {effect.recipient}</p>
      {effect.subject && <p className="break-words text-sm font-medium text-foreground">{effect.subject}</p>}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">{result.contents[effect.id]}</p>
      <p className="text-xs text-muted-foreground">Envoyé dans la démo le <time dateTime={result.appliedAt}>{new Date(result.appliedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>.</p>
    </article>)}</div>
  </section>;
}
