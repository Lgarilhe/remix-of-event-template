import { useMemo } from 'react';
import { ActivityEventCard } from './ActivityEventCard';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { conversationTimeline, activityChannel } from '@/lib/inboxTimeline';
import { activityService, SERVICE_LABELS } from '@/lib/messagingServices';
import type { Message } from '@/hooks/useMessagesInbox';
import type { ActivityEvent } from '@/hooks/useProfileActivity';
import { cn } from '@/lib/utils';

/** Cartes, ordre des dates et rapprochement des envois communs aux deux parcours candidat. */
export function CandidateInteractionTimeline({ messages = [], events, name }: { messages?: Message[]; events: ActivityEvent[]; name: string }) {
  const timeline = useMemo(() => conversationTimeline(messages, events), [messages, events]);
  return <div className="space-y-1" data-component="candidate-interactions">{timeline.map(item => {
    if (item.kind === 'date') return <div key={item.date} className="my-6 flex items-center gap-3 text-2xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>{item.label}</span><span className="h-px flex-1 bg-border" /></div>;
    if (item.kind === 'event' && ((item.data.type !== 'message' && item.data.actionType !== 'message') || activityChannel(item.data) === 'email')) return <ActivityEventCard key={item.data.id} event={item.data} />;
    const event = item.kind === 'event' ? item.data : undefined;
    const message = item.kind === 'message' ? item.data : undefined;
    const outgoing = event ? event.direction === 'outbound' : message?.is_sender;
    const service = event ? activityService(event) : 'linkedin';
    const sequence = item.kind === 'message' ? item.sequenceEvent : event;
    const timestamp = event?.timestamp || message?.timestamp;
    return <div key={event?.id || message?.id} className={cn('flex py-2', outgoing ? 'justify-end' : 'justify-start')}><div className={cn('flex min-w-0 max-w-[85%] flex-col md:max-w-[min(80%,40rem)]', outgoing ? 'items-end' : 'items-start')}>
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><ServiceLogo service={service} decorative /><span>{SERVICE_LABELS[service]} · {outgoing ? 'Vous' : name}</span></p>
      {message?.subject && <p className="mb-1 break-words text-sm font-medium text-foreground">{message.subject}</p>}
      <p className={cn('max-w-full whitespace-pre-wrap break-words rounded-xl px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]', outgoing ? 'bg-foreground text-background' : 'bg-muted text-foreground')}>{message?.is_deleted ? 'Message supprimé' : event?.finalMessage || message?.text || message?.text_content || (message?.attachments?.length ? 'Pièce jointe dans LinkedIn' : '(Message sans texte)')}</p>
      {sequence?.sequenceName && <p className="mt-1 text-xs text-muted-foreground">{sequence.sequenceName} · Étape {sequence.stepOrder + 1}</p>}
      {timestamp && Number.isFinite(Date.parse(timestamp)) && <span className="mt-1 text-2xs tabular-nums text-muted-foreground">{new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
    </div></div>;
  })}</div>;
}
