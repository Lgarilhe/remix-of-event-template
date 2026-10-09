import type { Message } from '@/hooks/useMessagesInbox';
import type { ActivityEvent } from '@/hooks/useProfileActivity';
import type { Channel } from '@/lib/channels';
import { isInternalSequenceAction, SENT_EXECUTION_STATUSES } from '@/lib/sequenceActionLabels';

export type ConversationItem =
  | { kind: 'message'; data: Message; sequenceEvent?: ActivityEvent }
  | { kind: 'event'; data: ActivityEvent }
  | { kind: 'date'; date: string; label: string };

/** Le canal figé lors de l'envoi prime sur le canal et le type de l'étape. */
export function activityChannel(event: Pick<ActivityEvent, 'type' | 'channel' | 'actionType'>): Channel {
  if (event.type === 'aircall') return 'call';
  if (event.channel === 'email' || event.channel === 'whatsapp') return event.channel;
  if (event.channel === 'linkedin') return 'linkedin';
  if (event.actionType === 'email') return 'email';
  if (event.actionType === 'whatsapp_message') return 'whatsapp';
  return 'linkedin';
}

export function activityActionType(event: ActivityEvent): string {
  if (event.type !== 'sequence_step' || isInternalSequenceAction(event.actionType) || event.actionType === 'connection_request' || event.actionType === 'profile_visit') return event.actionType;
  const channel = activityChannel(event);
  return channel === 'email' ? 'email' : channel === 'whatsapp' ? 'whatsapp_message' : event.actionType;
}

/** Les emails sont enregistrés en HTML. On n'injecte jamais ce HTML dans le fil. */
export function activityMessageText(message: string | null | undefined): string {
  if (!/<\/?(?:html|body|div|p|br|table|tr|td|a|ul|ol|li|strong|b|em|i|span|style|script|img|svg)\b/i.test(message ?? '')) return (message ?? '').trim();
  const text = (message ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = text;
    return decoder.value.trim();
  }
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Une seule copie d'un message quand la trace d'envoi identifie sa bulle LinkedIn. */
export function conversationTimeline(messages: Message[], events: ActivityEvent[], now = new Date()): ConversationItem[] {
  const linked = new Map<string, ActivityEvent>();
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const matches = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'sequence_step' || activityChannel(event) !== 'linkedin' || !['message', 'smart_message', 'inmail'].includes(event.actionType) || !(SENT_EXECUTION_STATUSES as readonly string[]).includes(event.status) || !event.finalMessage?.trim()) continue;
    const candidates = messages.filter(message => message.is_sender && normalize(message.text || message.text_content || '') === normalize(event.finalMessage!) && Math.abs(Date.parse(message.timestamp ?? '') - Date.parse(event.timestamp)) <= 60_000);
    if (candidates.length === 1) matches.set(event.id, candidates[0].id);
  }
  const remaining = events.filter(event => {
    if (event.type === 'sequence_step' && isInternalSequenceAction(event.actionType)) return false;
    const messageId = matches.get(event.id);
    if (messageId && [...matches.values()].filter(id => id === messageId).length === 1) {
      linked.set(messageId, event);
      return false;
    }
    return Number.isFinite(Date.parse(event.timestamp));
  });
  const items: ConversationItem[] = [
    ...messages.map(data => ({ kind: 'message' as const, data, sequenceEvent: data.id ? linked.get(data.id) : undefined })),
    ...remaining.map(data => ({ kind: 'event' as const, data })),
  ];
  items.sort((a, b) => {
    const time = (item: ConversationItem) => item.kind === 'date' ? 0 : Date.parse(item.data.timestamp ?? '') || 0;
    return time(a) - time(b);
  });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const result: ConversationItem[] = [];
  let previousDay = '';
  for (const item of items) {
    if (item.kind === 'date') continue;
    const date = new Date(item.data.timestamp ?? '');
    if (Number.isFinite(date.getTime())) {
      const day = localDay(date);
      if (day !== previousDay) {
        const label = day === localDay(now) ? "Aujourd'hui" : day === localDay(yesterday) ? 'Hier' : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
        result.push({ kind: 'date', date: day, label });
        previousDay = day;
      }
    }
    result.push(item);
  }
  return result;
}
