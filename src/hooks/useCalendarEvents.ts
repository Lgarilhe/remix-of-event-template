/**
 * useCalendarEvents — agrège les événements à venir pour le calendrier interne (B5).
 *
 * Sources :
 * - `qualification_sessions` (entretiens / qualifs)
 * - `inmail_queue` (InMails programmés)
 * - `sequence_step_executions` (étapes de séquence à venir, hors waits)
 *
 * Le hook expose des events normalisés au format CalendarEvent pour rendu unifié.
 *
 * Phase 1 (MVP) : lecture seule. Pas de création d'event, ça passe par les flows
 * existants (Calendly, qualification, séquences).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay, format, addDays, parseISO } from 'date-fns';

export type CalendarEventType =
  | 'qualification'   // entretien / qualif candidat
  | 'inmail'          // InMail programmé
  | 'sequence_step'   // étape séquence (email, message)
  | 'reminder';       // rappel manuel (futur)

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  /** ISO string */
  startAt: string;
  /** ISO string, optional (durée par défaut 30min pour qualif) */
  endAt: string | null;
  title: string;
  /** Sous-titre (ex. nom candidat, sujet message) */
  subtitle: string | null;
  /** Status pour styling (scheduled, sent, completed, cancelled) */
  status: string;
  /** Méta optionnelle pour drill-down */
  meta?: {
    candidateId?: string;
    candidateName?: string | null;
    jobId?: string;
    jobTitle?: string | null;
    sequenceId?: string;
    sequenceName?: string | null;
  };
}

export interface UseCalendarEventsOptions {
  /** Date de début (default : aujourd'hui) */
  from?: Date;
  /** Nombre de jours (default : 7) */
  days?: number;
}

const HIDDEN_SEQUENCE_ACTIONS = new Set([
  'wait_connection',
  'check_connection',
  'wait_reply',
  'wait_for_event',
]);

async function fetchCalendarEvents(from: Date, days: number): Promise<CalendarEvent[]> {
  const rangeStart = startOfDay(from).toISOString();
  const rangeEnd = endOfDay(addDays(from, days - 1)).toISOString();
  const events: CalendarEvent[] = [];

  // 1. Qualifications (entretiens) avec event_start_at non null
  const { data: qualifs } = await supabase
    .from('qualification_sessions')
    .select('id, status, event_start_at, event_end_at, candidate_name, job_title, candidate_profile_id, job_id')
    .gte('event_start_at', rangeStart)
    .lte('event_start_at', rangeEnd)
    .order('event_start_at', { ascending: true });

  if (qualifs) {
    for (const q of qualifs as any[]) {
      if (!q.event_start_at) continue;
      events.push({
        id: `qualif-${q.id}`,
        type: 'qualification',
        startAt: q.event_start_at,
        endAt: q.event_end_at ?? null,
        title: q.job_title ? `Qualif · ${q.job_title}` : 'Qualification',
        subtitle: q.candidate_name ?? null,
        status: q.status ?? 'scheduled',
        meta: {
          candidateId: q.candidate_profile_id ?? undefined,
          candidateName: q.candidate_name ?? null,
          jobId: q.job_id ?? undefined,
          jobTitle: q.job_title ?? null,
        },
      });
    }
  }

  // 2. InMails programmés
  const { data: inmails } = await supabase
    .from('inmail_queue')
    .select('id, recipient_name, recipient_headline, subject, scheduled_at, status')
    .gte('scheduled_at', rangeStart)
    .lte('scheduled_at', rangeEnd)
    .in('status', ['pending', 'scheduled', 'sent'])
    .order('scheduled_at', { ascending: true });

  if (inmails) {
    for (const im of inmails as any[]) {
      events.push({
        id: `inmail-${im.id}`,
        type: 'inmail',
        startAt: im.scheduled_at,
        endAt: null,
        title: im.subject || 'InMail LinkedIn',
        subtitle: im.recipient_name || im.recipient_headline || null,
        status: im.status,
        meta: { candidateName: im.recipient_name ?? null },
      });
    }
  }

  // 3. Étapes de séquence visibles
  const { data: stepExecs } = await supabase
    .from('sequence_step_executions')
    .select('id, scheduled_at, status, action_type, candidate_name, sequence_name, sequence_id, candidate_id')
    .gte('scheduled_at', rangeStart)
    .lte('scheduled_at', rangeEnd)
    .in('status', ['pending', 'scheduled'])
    .order('scheduled_at', { ascending: true });

  if (stepExecs) {
    for (const s of stepExecs as any[]) {
      if (HIDDEN_SEQUENCE_ACTIONS.has(s.action_type)) continue;
      events.push({
        id: `step-${s.id}`,
        type: 'sequence_step',
        startAt: s.scheduled_at,
        endAt: null,
        title: s.sequence_name ? `Séquence · ${s.sequence_name}` : 'Étape de séquence',
        subtitle: s.candidate_name ?? null,
        status: s.status,
        meta: {
          candidateId: s.candidate_id ?? undefined,
          candidateName: s.candidate_name ?? null,
          sequenceId: s.sequence_id ?? undefined,
          sequenceName: s.sequence_name ?? null,
        },
      });
    }
  }

  // Sort global par startAt asc
  events.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return events;
}

export function useCalendarEvents(options: UseCalendarEventsOptions = {}) {
  const { from = new Date(), days = 7 } = options;
  const fromKey = format(from, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['calendar-events', fromKey, days],
    queryFn: () => fetchCalendarEvents(from, days),
    staleTime: 60 * 1000, // 1min
    refetchOnWindowFocus: false,
  });
}

/**
 * Group events by day (yyyy-MM-dd) — utile pour rendu week view.
 */
export function groupEventsByDay(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    try {
      const day = format(parseISO(ev.startAt), 'yyyy-MM-dd');
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(ev);
    } catch {
      // skip dates invalides
    }
  }
  return grouped;
}
