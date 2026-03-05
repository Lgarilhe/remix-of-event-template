import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay, format } from 'date-fns';

export interface ScheduledMessage {
  id: string;
  type: 'inmail' | 'sequence';
  recipientName: string | null;
  recipientHeadline: string | null;
  subject: string | null;
  messageContent: string | null;
  scheduledAt: string;
  status: string;
  sequenceName?: string;
  stepOrder?: number;
  actionType?: string;
}

async function fetchTodayScheduledMessages(): Promise<ScheduledMessage[]> {
  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();
  const messages: ScheduledMessage[] = [];

  // 1. InMails scheduled for today
  const { data: inmails } = await supabase
    .from('inmail_queue')
    .select('id, recipient_name, recipient_headline, subject, message, scheduled_at, status')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .in('status', ['pending', 'scheduled', 'sent'])
    .order('scheduled_at', { ascending: true });

  if (inmails) {
    inmails.forEach((im: any) => {
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
    });
  }

  // 2. Sequence step executions scheduled for today (only visible actions)
  const HIDDEN_ACTIONS = ['wait_connection', 'check_connection', 'wait_reply', 'wait_for_event'];
  const { data: executions } = await supabase
    .from('sequence_step_executions' as any)
    .select('id, scheduled_at, status, step_order, enrollment_id, final_subject, final_message, step_id')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .in('status', ['scheduled', 'executed', 'sent'])
    .order('scheduled_at', { ascending: true })
    .limit(100);

  if (executions && (executions as any[]).length > 0) {
    // Get step action_types to filter out hidden actions
    const stepIds = [...new Set((executions as any[]).map((e: any) => e.step_id).filter(Boolean))];
    let stepActionMap = new Map<string, string>();
    if (stepIds.length > 0) {
      const { data: steps } = await supabase
        .from('sequence_steps' as any)
        .select('id, action_type')
        .in('id', stepIds);
      if (steps) {
        (steps as any[]).forEach((s: any) => stepActionMap.set(s.id, s.action_type));
      }
    }

    // Filter out hidden actions
    const visibleExecutions = (executions as any[]).filter((exec: any) => {
      const actionType = stepActionMap.get(exec.step_id) || '';
      return !HIDDEN_ACTIONS.includes(actionType);
    });

    // Get enrollment details for names
    const enrollmentIds = [...new Set(visibleExecutions.map((e: any) => e.enrollment_id))];
    
    let enrollmentMap = new Map<string, { name: string; headline: string; sequenceName: string }>();
    
    if (enrollmentIds.length > 0) {
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('id, profile_name, profile_headline, outreach_sequences (name)')
        .in('id', enrollmentIds);
      
      if (enrollments) {
        enrollments.forEach((e: any) => {
          enrollmentMap.set(e.id, {
            name: e.profile_name || 'Profil LinkedIn',
            headline: e.profile_headline || null,
            sequenceName: e.outreach_sequences?.name || 'Séquence',
          });
        });
      }
    }

    visibleExecutions.forEach((exec: any) => {
      const enrollment = enrollmentMap.get(exec.enrollment_id);
      const actionType = stepActionMap.get(exec.step_id) || '';
      messages.push({
        id: `seq-${exec.id}`,
        type: 'sequence',
        recipientName: enrollment?.name || 'Profil LinkedIn',
        recipientHeadline: enrollment?.headline || null,
        subject: exec.final_subject || null,
        messageContent: exec.final_message || null,
        scheduledAt: exec.scheduled_at,
        status: exec.status,
        sequenceName: enrollment?.sequenceName,
        stepOrder: exec.step_order,
        actionType,
      });
    });
  }

  // Sort all by scheduled time
  messages.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return messages;
}

export function useTodayScheduledMessages() {
  return useQuery({
    queryKey: ['today-scheduled-messages'],
    queryFn: fetchTodayScheduledMessages,
    staleTime: 2 * 60 * 1000, // 2 min
    gcTime: 5 * 60 * 1000,
  });
}
