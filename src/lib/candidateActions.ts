import type { ActivityEvent } from '@/hooks/useProfileActivity';
import type { CandidateActionEffect, CandidateActionPlan, CandidateActionMessageRecord } from '../../supabase/functions/_shared/candidate-actions/types';
import { activityMessageText } from '@/lib/inboxTimeline';

export type { CandidateActionScope, CandidateActionSource, CandidateActionTarget, CandidateActionEffect, CandidateActionPlan, CandidateActionEdits, CandidateActionsResponse, CandidateActionMessageRecord } from '../../supabase/functions/_shared/candidate-actions/types';

export const candidateActionCompleted = (plan: CandidateActionPlan) => plan.effects.length > 0 && plan.effects.every(effect => effect.status === 'succeeded' || effect.status === 'skipped');
export const candidateActionNeedsReview = (plan: CandidateActionPlan) => plan.effects.some(effect => effect.status === 'unknown' || effect.status === 'running');
export const candidateActionCanResume = (plan: CandidateActionPlan) => ['approved', 'running', 'partial'].includes(plan.status) && !candidateActionNeedsReview(plan) && plan.effects.some(effect => effect.status === 'prepared' || effect.status === 'failed');
/** Le dernier envoi LinkedIn peut déplacer le candidat dans le pipeline. */
export function candidateActionExecutionOrder(effects: CandidateActionEffect[]): CandidateActionEffect[] {
  const rank = (effect: CandidateActionEffect) => effect.kind !== 'message' ? 0 : effect.audience === 'candidate' && effect.channel === 'linkedin' ? 2 : 1;
  return [...effects].sort((a, b) => rank(a) - rank(b));
}
export function candidateEffectStatus(effect: CandidateActionEffect): string {
  if (effect.status === 'succeeded') return effect.kind === 'message' ? 'Envoyé' : 'Enregistré';
  if (effect.status === 'skipped' && (effect.result?.completedAt || effect.result?.referenceId || effect.result?.providerId)) return 'Déjà réalisé';
  return { prepared: 'À valider', running: 'En cours', failed: 'Échec confirmé', unknown: 'Résultat à vérifier', skipped: 'Non exécuté' }[effect.status];
}
export function candidateActionConfirmLabel(plan: CandidateActionPlan): string {
  const remaining = plan.effects.filter(effect => effect.status === 'prepared' || effect.status === 'failed');
  const messages = remaining.filter(effect => effect.kind === 'message').length;
  const documents = remaining.length - messages;
  return [messages && `Envoyer ${messages} message${messages > 1 ? 's' : ''}`, documents && `${messages ? 'enregistrer' : 'Enregistrer'} ${documents} contenu${documents > 1 ? 's' : ''}`].filter(Boolean).join(' et ') || 'Fermer le résultat';
}

/** Le journal d'exécution est une preuve d'envoi, jamais un message fictif. */
export function mergeCandidateActionEvents(events: ActivityEvent[], plans: CandidateActionPlan[], messages: Array<{ id?: string; timestamp?: string; is_sender?: boolean; text?: string; text_content?: string }> = [], ledger: CandidateActionMessageRecord[] = [], currentAccountId?: string | null, actorName?: (userId: string) => string | null): Array<ActivityEvent & { authorName?: string; missionUnidentified?: boolean }> {
  const normalize = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
  const recorded = [...new Map(ledger.filter(row => row.audience === 'candidate').map(row => [`${row.account_id}:${row.provider_message_id}`, row])).values()];
  const recordedEvents = recorded.flatMap(row => {
    // Un même identifiant de fournisseur dans deux comptes n'est pas la même conversation.
    if (row.account_id === currentAccountId && messages.some(message => message.id === row.provider_message_id)) return [];
    const sameEvent = events.some(event => event.id === row.id || (row.direction === 'outbound' && event.channel === row.channel && normalize(event.finalMessage) === normalize(activityMessageText(row.content)) && event.recipient === row.recipient && Math.abs(Date.parse(event.timestamp) - Date.parse(row.occurred_at)) <= 60_000));
    if (sameEvent) return [];
    return [{ id: `candidate-ledger-${row.id}`, type: 'message' as const, timestamp: row.occurred_at, actionType: row.channel === 'email' ? 'email' : row.channel === 'whatsapp' ? 'whatsapp_message' : 'message', stepOrder: 0, status: row.direction === 'inbound' ? 'received' : 'sent', finalMessage: activityMessageText(row.content), finalSubject: row.subject, channel: row.channel, service: row.service, recipient: row.direction === 'inbound' ? row.sender : row.recipient, direction: row.direction, missionUnidentified: row.project_id === null, authorName: row.direction === 'outbound' ? actorName?.(row.owner_user_id) || row.sender : undefined }];
  });
  const additions = plans.flatMap(plan => plan.effects.flatMap(effect => {
    if (effect.kind !== 'message' || effect.audience !== 'candidate' || effect.status !== 'succeeded' || !effect.result?.completedAt) return [];
    if (recorded.some(row => row.action_plan_id === plan.id && row.effect_id === effect.id)) return [];
    const time = Date.parse(effect.result.completedAt);
    const sameMessage = effect.senderAccountId === currentAccountId && messages.some(message => message.is_sender && ((effect.result?.providerId && effect.result.providerId === message.id) || (effect.channel === 'linkedin' && normalize(message.text || message.text_content) === normalize(effect.content) && Math.abs(Date.parse(message.timestamp ?? '') - time) <= 60_000)));
    const sameEvent = events.some(event => event.id === effect.result?.referenceId || (event.channel === effect.channel && event.direction !== 'inbound' && normalize(event.finalMessage) === normalize(effect.content) && Math.abs(Date.parse(event.timestamp) - time) <= 60_000));
    if (sameMessage || sameEvent) return [];
    return [{ id: `candidate-action-${plan.id}-${effect.id}`, type: 'message' as const, timestamp: effect.result.completedAt, actionType: effect.channel === 'email' ? 'email' : effect.channel === 'whatsapp' ? 'whatsapp_message' : 'message', stepOrder: 0, status: 'sent', finalMessage: effect.content, finalSubject: effect.subject, channel: effect.channel, service: effect.service, recipient: effect.recipient, direction: 'outbound' as const }];
  }));
  return [...events, ...recordedEvents, ...additions].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
