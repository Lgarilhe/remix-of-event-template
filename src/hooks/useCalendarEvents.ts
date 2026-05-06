/**
 * useCalendarEvents — agrège les événements à venir pour le calendrier interne.
 *
 * Sources :
 * - `qualification_sessions` (entretiens / qualifs) — y compris ceux créés via
 *   webhook Calendly (calendly_event_id non-null)
 * - `inmail_queue` (InMails programmés)
 * - `sequence_step_executions` (étapes de séquence à venir, hors waits)
 *
 * V2 (mai 2026) : enrichissement majeur — chaque event qualif expose maintenant
 * manager (created_by → display_name + avatar), mission (project_id → name +
 * client), location (Google Meet / Zoom / Bureau / Calendly), Calendly metadata
 * pour deep-linking. Permet aux EventCards de montrer en 1 coup d'œil "qui
 * voit qui pour quel poste" + bouton Calendly direct.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, endOfDay, format, addDays, parseISO } from 'date-fns';

export type CalendarEventType =
  | 'qualification' // entretien / qualif candidat
  | 'inmail' // InMail programmé
  | 'sequence_step' // étape séquence (email, message)
  | 'reminder'; // rappel manuel (futur)

export interface CalendarEventManager {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Format du meeting détecté automatiquement depuis location/event_name. */
export type CalendarEventFormat = 'video' | 'phone' | 'in_person' | 'unknown';

/** Round/étape de l'entretien inféré depuis event_name + ordre chronologique. */
export type CalendarEventRound =
  | { kind: 'numbered'; n: number; label: string } // "1er", "2e", "3e", etc.
  | { kind: 'final'; label: string }
  | null;

export interface CalendarEventMeta {
  candidateId?: string;
  candidateName?: string | null;
  candidateHeadline?: string | null;
  candidateAvatarUrl?: string | null;
  jobId?: string;
  jobTitle?: string | null;
  clientName?: string | null;
  /** Mission Konekt (sourcing_project) liée à l'event */
  projectId?: string | null;
  projectName?: string | null;
  manager?: CalendarEventManager | null;
  /** Lieu / link de l'event ("Google Meet", "Zoom", "Bureau Konekt", URL...) */
  location?: string | null;
  /** Format détecté (visio / présentiel / téléphone) */
  format?: CalendarEventFormat;
  /** Round/étape de l'entretien (1er, 2e, final, etc.) — uniquement qualifs */
  round?: CalendarEventRound;
  /** Calendly event id (si event créé via webhook Calendly) */
  calendlyEventId?: string | null;
  /** Notes de l'event (qualif notes, etc.) */
  notes?: string | null;
  sequenceId?: string;
  sequenceName?: string | null;
}

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
  meta?: CalendarEventMeta;
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

/**
 * Détecte le format d'un meeting depuis sa location.
 * - URLs http(s) → 'video' (Meet/Zoom/Teams/etc.)
 * - "téléphone" / "phone" / "tel" / "+33..." → 'phone'
 * - "bureau" / adresse postale → 'in_person'
 * - sinon → 'unknown'
 */
const detectFormat = (location: string | null | undefined): CalendarEventFormat => {
  if (!location) return 'unknown';
  const lower = location.toLowerCase();
  if (/^https?:\/\//i.test(location)) return 'video';
  if (/(téléphone|telephone|phone|appel|^\+\d|\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2})/i.test(lower)) {
    return 'phone';
  }
  if (/(bureau|office|adresse|rue|avenue|boulevard|paris|lyon|marseille|nantes|bordeaux|in person|in-person|sur place)/i.test(lower)) {
    return 'in_person';
  }
  return 'unknown';
};

/**
 * Infère le round/étape d'un entretien depuis event_name.
 * Patterns reconnus :
 * - "final", "last round" → final
 * - "premier", "1er", "first", "initial", "découverte", "kickoff", "qualif" → 1
 * - "deuxième", "2e", "second" → 2
 * - "troisième", "3e" → 3
 * - sinon null (pas inféré, l'UI cache le badge)
 *
 * Si on reconnaît clairement un round numbered, on retourne kind='numbered'.
 * Si on reconnaît "final", on retourne kind='final'.
 */
const inferRound = (eventName: string | null | undefined): CalendarEventRound => {
  if (!eventName) return null;
  const lower = eventName.toLowerCase();

  // Final round (avant les autres pour éviter conflit)
  if (/(final|last round|dernier(?:[\s-]tour)?|final round)/i.test(lower)) {
    return { kind: 'final', label: 'Final' };
  }

  // Round 3
  if (/(troisième|trois[ièm]+e|3[èe]?me|3e[\s)]|round[\s-]?3|3rd)/i.test(lower)) {
    return { kind: 'numbered', n: 3, label: '3e tour' };
  }

  // Round 2
  if (/(deuxième|deux[ièm]+e|2[èe]?me|2e[\s)]|second|round[\s-]?2|2nd)/i.test(lower)) {
    return { kind: 'numbered', n: 2, label: '2e tour' };
  }

  // Round 1 / qualif initiale
  if (
    /(premier|premi[èe]re|1er|1[èe]?re|first|initial|kickoff|d[ée]couverte|qualif|découv|caf[ée][\s-]?découverte)/i.test(
      lower,
    )
  ) {
    return { kind: 'numbered', n: 1, label: '1er tour' };
  }

  return null;
};

async function fetchCalendarEvents(from: Date, days: number): Promise<CalendarEvent[]> {
  const rangeStart = startOfDay(from).toISOString();
  const rangeEnd = endOfDay(addDays(from, days - 1)).toISOString();
  const events: CalendarEvent[] = [];

  // 1. Qualifications (entretiens) — pull tous les champs riches utiles à l'UI
  const { data: qualifs } = await supabase
    .from('qualification_sessions')
    .select(
      [
        'id',
        'status',
        'event_start_at',
        'event_end_at',
        'event_location',
        'event_name',
        'candidate_name',
        'candidate_headline',
        'candidate_profile_id',
        'job_id',
        'job_title',
        'client_name',
        'project_id',
        'created_by',
        'calendly_event_id',
        'notes',
      ].join(', '),
    )
    .gte('event_start_at', rangeStart)
    .lte('event_start_at', rangeEnd)
    .order('event_start_at', { ascending: true });

  // Resolve unique manager userIds + project ids → batch lookup (1 query each)
  const managerIds = new Set<string>();
  const projectIds = new Set<string>();
  const candidateProfileIds = new Set<string>();
  if (qualifs) {
    for (const q of qualifs as any[]) {
      if (q.created_by) managerIds.add(q.created_by);
      if (q.project_id) projectIds.add(q.project_id);
      if (q.candidate_profile_id) candidateProfileIds.add(q.candidate_profile_id);
    }
  }

  // Batch fetch managers (display_name)
  const managerMap = new Map<string, CalendarEventManager>();
  if (managerIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', Array.from(managerIds));
    if (profiles) {
      for (const p of profiles as any[]) {
        managerMap.set(p.user_id, {
          userId: p.user_id,
          displayName: p.display_name || null,
          avatarUrl: null, // pas exposé dans profiles, fallback initiales côté UI
        });
      }
    }
  }

  // Batch fetch missions (sourcing_projects)
  const projectMap = new Map<string, { id: string; name: string; client_name: string | null }>();
  if (projectIds.size > 0) {
    const { data: projects } = await supabase
      .from('sourcing_projects')
      .select('id, name, client_name')
      .in('id', Array.from(projectIds));
    if (projects) {
      for (const p of projects as any[]) {
        projectMap.set(p.id, p);
      }
    }
  }

  // Batch fetch candidate avatars depuis job_candidate_status (linkedin_profile_data)
  const candidateAvatarMap = new Map<string, string | null>();
  if (candidateProfileIds.size > 0) {
    const { data: jcs } = await supabase
      .from('job_candidate_status')
      .select('candidate_id, linkedin_profile_data')
      .in('candidate_id', Array.from(candidateProfileIds));
    if (jcs) {
      for (const c of jcs as any[]) {
        const data = c.linkedin_profile_data as Record<string, unknown> | null;
        const url =
          (data?.profile_picture_url as string | undefined) ||
          (data?.profile_picture_url_large as string | undefined) ||
          null;
        if (!candidateAvatarMap.has(c.candidate_id)) {
          candidateAvatarMap.set(c.candidate_id, url);
        }
      }
    }
  }

  if (qualifs) {
    for (const q of qualifs as any[]) {
      if (!q.event_start_at) continue;
      const project = q.project_id ? projectMap.get(q.project_id) : null;
      const manager = q.created_by ? managerMap.get(q.created_by) : null;
      const candidateAvatar = q.candidate_profile_id
        ? candidateAvatarMap.get(q.candidate_profile_id) ?? null
        : null;
      const eventName = q.event_name as string | null;
      const format = detectFormat(q.event_location);
      const round = inferRound(eventName);
      events.push({
        id: `qualif-${q.id}`,
        type: 'qualification',
        startAt: q.event_start_at,
        endAt: q.event_end_at ?? null,
        title: eventName || (q.job_title ? `Qualif · ${q.job_title}` : 'Qualification'),
        subtitle: q.candidate_name ?? null,
        status: q.status ?? 'scheduled',
        meta: {
          candidateId: q.candidate_profile_id ?? undefined,
          candidateName: q.candidate_name ?? null,
          candidateHeadline: q.candidate_headline ?? null,
          candidateAvatarUrl: candidateAvatar,
          jobId: q.job_id ?? undefined,
          jobTitle: q.job_title ?? null,
          clientName: q.client_name ?? null,
          projectId: q.project_id ?? null,
          projectName: project?.name ?? null,
          manager: manager ?? null,
          location: q.event_location ?? null,
          format,
          round,
          calendlyEventId: q.calendly_event_id ?? null,
          notes: q.notes ?? null,
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
        meta: {
          candidateName: im.recipient_name ?? null,
          candidateHeadline: im.recipient_headline ?? null,
        },
      });
    }
  }

  // 3. Étapes de séquence visibles
  const { data: stepExecs } = await supabase
    .from('sequence_step_executions')
    .select('id, scheduled_at, status, step_id, enrollment_id')
    .gte('scheduled_at', rangeStart)
    .lte('scheduled_at', rangeEnd)
    .in('status', ['pending', 'scheduled'])
    .order('scheduled_at', { ascending: true })
    .limit(100);

  if (stepExecs && stepExecs.length > 0) {
    // Resolve sequence + enrollment names in batch
    const stepIds = [...new Set((stepExecs as any[]).map((s) => s.step_id).filter(Boolean))];
    const enrollmentIds = [
      ...new Set((stepExecs as any[]).map((s) => s.enrollment_id).filter(Boolean)),
    ];

    const stepMap = new Map<string, string>(); // step_id → action_type
    const seqMap = new Map<
      string,
      {
        sequenceName: string;
        candidateName: string | null;
        candidateId: string | null;
        sequenceId: string | null;
      }
    >();

    if (stepIds.length > 0) {
      const { data: steps } = await supabase
        .from('sequence_steps' as any)
        .select('id, action_type')
        .in('id', stepIds);
      if (steps) {
        for (const s of steps as any[]) stepMap.set(s.id, s.action_type);
      }
    }
    if (enrollmentIds.length > 0) {
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('id, profile_name, profile_id, sequence_id, outreach_sequences(id, name)')
        .in('id', enrollmentIds);
      if (enrollments) {
        for (const e of enrollments as any[]) {
          seqMap.set(e.id, {
            sequenceName: (e as any).outreach_sequences?.name || 'Séquence',
            candidateName: e.profile_name || null,
            candidateId: e.profile_id || null,
            sequenceId: e.sequence_id || null,
          });
        }
      }
    }

    for (const s of stepExecs as any[]) {
      const actionType = stepMap.get(s.step_id);
      if (actionType && HIDDEN_SEQUENCE_ACTIONS.has(actionType)) continue;
      const seqInfo = seqMap.get(s.enrollment_id);
      events.push({
        id: `step-${s.id}`,
        type: 'sequence_step',
        startAt: s.scheduled_at,
        endAt: null,
        title: seqInfo?.sequenceName ? `Séquence · ${seqInfo.sequenceName}` : 'Étape de séquence',
        subtitle: seqInfo?.candidateName ?? null,
        status: s.status,
        meta: {
          candidateId: seqInfo?.candidateId ?? undefined,
          candidateName: seqInfo?.candidateName ?? null,
          sequenceId: seqInfo?.sequenceId ?? undefined,
          sequenceName: seqInfo?.sequenceName ?? null,
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
