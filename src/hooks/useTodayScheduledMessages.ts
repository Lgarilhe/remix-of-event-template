import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { startOfDay, endOfDay } from 'date-fns';
import {
  executionStatusLabel,
  HIDDEN_ACTION_TYPES,
  isSentExecutionStatus,
} from '@/lib/sequenceErrorMessages';

export interface ScheduledMessage {
  id: string;
  type: 'inmail' | 'sequence';
  recipientName: string | null;
  recipientHeadline: string | null;
  subject: string | null;
  messageContent: string | null;
  scheduledAt: string;
  /**
   * Statut de l'envoi. Pour une séquence, une étape ouverte, cliquée ou
   * répondue est rapportée comme 'sent' : elle est partie.
   */
  status: string;
  /** Libellé français du statut réel (ex. « Reporté (limite LinkedIn du jour atteinte) »). */
  statusLabel?: string;
  sequenceName?: string;
  stepOrder?: number;
  actionType?: string;
}

/**
 * Étapes de séquence du jour : à venir (programmées, en cours d'envoi,
 * reportées par la limite LinkedIn) et déjà parties (envoyées, ouvertes,
 * cliquées, répondues).
 */
const TODAY_EXECUTION_STATUSES = ['scheduled', 'sending', 'quota_blocked', 'sent', 'opened', 'clicked', 'replied'];

async function fetchTodayScheduledMessages(organizationId: string): Promise<ScheduledMessage[]> {
  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();
  const messages: ScheduledMessage[] = [];

  // 1. InMails scheduled for today
  const { data: inmails, error: inmailError } = await supabase
    .from('inmail_queue')
    .select('id, recipient_name, recipient_headline, subject, message, scheduled_at, status')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .in('status', ['pending', 'scheduled', 'sent'])
    .order('scheduled_at', { ascending: true });
  // Une source en échec n'efface pas l'autre ; les deux en échec = erreur.
  if (inmailError) console.error('[useTodayScheduledMessages] InMails indisponibles:', inmailError);

  for (const im of inmails || []) {
    messages.push({
      id: `inmail-${im.id}`,
      type: 'inmail',
      recipientName: im.recipient_name,
      recipientHeadline: im.recipient_headline,
      subject: im.subject,
      messageContent: im.message || null,
      scheduledAt: im.scheduled_at,
      status: im.status,
    });
  }

  // 2. Étapes de séquence du jour, actions visibles seulement. Les étapes
  // internes sont écartées dans la requête, AVANT la limite, et l'inscription
  // est jointe pour son organisation et son statut.
  const { data: executions, error: execError } = await supabase
    .from('sequence_step_executions')
    .select(
      'id, scheduled_at, status, step_order, final_subject, final_message, sequence_steps!inner(action_type), sequence_enrollments!inner(status, organization_id, profile_name, profile_headline, outreach_sequences(name))',
    )
    .eq('sequence_enrollments.organization_id', organizationId)
    .not('sequence_steps.action_type', 'in', `(${HIDDEN_ACTION_TYPES.join(',')})`)
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .in('status', TODAY_EXECUTION_STATUSES)
    .order('scheduled_at', { ascending: true })
    .limit(100);
  if (execError) {
    console.error('[useTodayScheduledMessages] étapes de séquence indisponibles:', execError);
    if (inmailError) throw execError;
  }

  for (const exec of executions || []) {
    const enrollment = exec.sequence_enrollments;
    const sent = isSentExecutionStatus(exec.status);
    // Une étape à venir d'une inscription en pause ou close ne partira pas :
    // le moteur ne traite que les inscriptions actives.
    if (!sent && enrollment?.status !== 'active') continue;

    messages.push({
      id: `seq-${exec.id}`,
      type: 'sequence',
      recipientName: enrollment?.profile_name || 'Profil LinkedIn',
      recipientHeadline: enrollment?.profile_headline || null,
      subject: exec.final_subject || null,
      messageContent: exec.final_message || null,
      scheduledAt: exec.scheduled_at,
      status: sent ? 'sent' : exec.status,
      statusLabel: executionStatusLabel(exec.status),
      sequenceName: enrollment?.outreach_sequences?.name || 'Séquence',
      stepOrder: exec.step_order,
      actionType: exec.sequence_steps?.action_type || '',
    });
  }

  // Sort all by scheduled time
  messages.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return messages;
}

export function useTodayScheduledMessages() {
  const { organizationId } = useOrganization();
  return useQuery({
    // L'organisation fait partie de la clé : changer d'espace ne ressert pas
    // les envois du précédent.
    queryKey: ['today-scheduled-messages', organizationId],
    queryFn: () => fetchTodayScheduledMessages(organizationId as string),
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000, // 2 min
    gcTime: 5 * 60 * 1000,
  });
}
