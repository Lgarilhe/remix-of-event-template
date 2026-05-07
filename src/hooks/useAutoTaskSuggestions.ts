/**
 * useAutoTaskSuggestions — détecte les contextes qui méritent une tâche
 * automatique et propose à l'user de les créer en 1 clic.
 *
 * Pas de création silencieuse — on respecte l'agency de l'user. On affiche
 * des "suggestions" en haut de /tasks, click → crée la tâche.
 *
 * Stratégies de détection (toutes idempotentes — pas de doublon si tâche
 * déjà existante côté DB) :
 *
 * 1. **Debrief post-RDV manquant** : event qualif terminé dans les 24h
 *    précédentes, status='scheduled', aucune task category='debrief'
 *    avec source_event_id = event.id → suggère "Faire le debrief de
 *    l'entretien {candidat}" pour dans 2h.
 *
 * 2. **Préparation pré-RDV manquante** : event qualif dans les 24h à
 *    venir, aucune task category='interview_prep' avec source_event_id
 *    = event.id → suggère "Préparer l'entretien {candidat}" pour 1h
 *    avant le début.
 *
 * 3. **Candidat stagnant sans relance active** : candidat à un stage
 *    actif depuis > guide_time + 2 jours, aucune task category='follow_up'
 *    active liée → suggère "Relancer {candidat} stagnant depuis {N}j".
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { differenceInDays, differenceInHours, parseISO } from 'date-fns';

export interface AutoTaskSuggestion {
  /** Clé unique pour dédup côté UI (pas d'id DB tant que pas créée) */
  key: string;
  category: 'debrief' | 'interview_prep' | 'follow_up';
  title: string;
  description: string;
  /** Date d'échéance suggérée */
  dueAt: Date;
  candidate: {
    candidateId: string | null;
    name: string;
    avatarUrl: string | null;
    headline: string | null;
  } | null;
  projectId: string | null;
  /** Event qualif source (pour dédup debrief/prep) */
  sourceEventId: string | null;
  /** Pour explication UI */
  reason: string;
}

interface RawEvent {
  id: string;
  event_start_at: string;
  event_end_at: string | null;
  event_name: string | null;
  candidate_name: string | null;
  candidate_profile_id: string | null;
  candidate_headline: string | null;
  job_title: string | null;
  client_name: string | null;
  project_id: string | null;
  status: string;
}

interface RawCandidateStatus {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  job_id: string | null;
  pipeline_stage: string | null;
  status: string;
  updated_at: string;
}

// Guide times par stage (jours) — au-delà du guide + 2j on flag stagnant
const GUIDE_TIMES: Record<string, number> = {
  Nouveau: 3,
  Contacté: 5,
  Répondu: 3,
  Pressenti: 5,
  'Pré-qualif': 7,
  'CV envoyé': 5,
  'ITW en cours': 10,
  Offre: 7,
};
const STAGNANT_TOLERANCE_DAYS = 2;

const fetchSuggestions = async (orgId: string): Promise<AutoTaskSuggestion[]> => {
  const suggestions: AutoTaskSuggestion[] = [];
  const now = new Date();

  // ─── 1. DEBRIEF post-RDV manquant ─────────────────────────────────────
  // Events terminés entre 24h ago et 30min ago
  const debriefSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const debriefUntil = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  const { data: pastEvents } = await supabase
    .from('qualification_sessions')
    .select(
      'id, event_start_at, event_end_at, event_name, candidate_name, candidate_profile_id, candidate_headline, job_title, client_name, project_id, status',
    )
    .eq('organization_id', orgId)
    .gte('event_end_at', debriefSince)
    .lte('event_end_at', debriefUntil)
    .neq('status', 'completed');

  // ─── 2. INTERVIEW_PREP pre-RDV manquant ──────────────────────────────
  // Events à venir dans les 24h
  const prepSince = now.toISOString();
  const prepUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: upcomingEvents } = await supabase
    .from('qualification_sessions')
    .select(
      'id, event_start_at, event_end_at, event_name, candidate_name, candidate_profile_id, candidate_headline, job_title, client_name, project_id, status',
    )
    .eq('organization_id', orgId)
    .gte('event_start_at', prepSince)
    .lte('event_start_at', prepUntil)
    .neq('status', 'completed');

  // Récupère les debrief + prep existants pour dédup en bulk
  const allEvents = [...((pastEvents || []) as RawEvent[]), ...((upcomingEvents || []) as RawEvent[])];
  const eventIds = allEvents.map((e) => e.id);

  if (eventIds.length > 0) {
    const { data: existingTasks } = await supabase
      .from('candidate_reminders')
      .select('source_event_id, category')
      .in('source_event_id', eventIds)
      .in('category', ['debrief', 'interview_prep']);

    const existingByCategory = new Map<string, Set<string>>();
    existingByCategory.set('debrief', new Set());
    existingByCategory.set('interview_prep', new Set());
    for (const t of (existingTasks || []) as any[]) {
      if (t.source_event_id && existingByCategory.has(t.category)) {
        existingByCategory.get(t.category)!.add(t.source_event_id);
      }
    }

    // 1. Suggestions debrief
    for (const ev of (pastEvents || []) as RawEvent[]) {
      if (existingByCategory.get('debrief')!.has(ev.id)) continue;
      if (!ev.candidate_name) continue;
      const endAt = ev.event_end_at ? parseISO(ev.event_end_at) : new Date(ev.event_start_at);
      const hoursSince = Math.max(differenceInHours(now, endAt), 1);
      suggestions.push({
        key: `debrief-${ev.id}`,
        category: 'debrief',
        title: `Débrief de l'entretien ${ev.candidate_name}`,
        description: [
          `Entretien ${ev.event_name || 'qualif'} terminé il y a ${hoursSince}h.`,
          ev.client_name ? `Client : ${ev.client_name}.` : null,
          ev.job_title ? `Poste : ${ev.job_title}.` : null,
          'Note tes observations + envoie le retour client.',
        ]
          .filter(Boolean)
          .join(' '),
        dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        candidate: {
          candidateId: ev.candidate_profile_id,
          name: ev.candidate_name,
          avatarUrl: null,
          headline: ev.candidate_headline,
        },
        projectId: ev.project_id,
        sourceEventId: ev.id,
        reason: `Entretien terminé il y a ${hoursSince}h sans débrief enregistré`,
      });
    }

    // 2. Suggestions interview_prep
    for (const ev of (upcomingEvents || []) as RawEvent[]) {
      if (existingByCategory.get('interview_prep')!.has(ev.id)) continue;
      if (!ev.candidate_name) continue;
      const startAt = parseISO(ev.event_start_at);
      const hoursUntil = Math.max(differenceInHours(startAt, now), 1);
      // Échéance prep = 1h avant le début (ou maintenant si l'event est dans <2h)
      const prepDueAt = new Date(Math.max(startAt.getTime() - 60 * 60 * 1000, now.getTime() + 30 * 60 * 1000));
      suggestions.push({
        key: `prep-${ev.id}`,
        category: 'interview_prep',
        title: `Préparer l'entretien ${ev.candidate_name}`,
        description: [
          `RDV ${ev.event_name || 'qualif'} dans ${hoursUntil}h.`,
          ev.client_name ? `Client : ${ev.client_name}.` : null,
          ev.job_title ? `Poste : ${ev.job_title}.` : null,
          'Relire CV + scoring + questions à creuser.',
        ]
          .filter(Boolean)
          .join(' '),
        dueAt: prepDueAt,
        candidate: {
          candidateId: ev.candidate_profile_id,
          name: ev.candidate_name,
          avatarUrl: null,
          headline: ev.candidate_headline,
        },
        projectId: ev.project_id,
        sourceEventId: ev.id,
        reason: `RDV dans ${hoursUntil}h sans tâche de prep enregistrée`,
      });
    }
  }

  // ─── 3. FOLLOW_UP candidats stagnants ────────────────────────────────
  // On flag les candidats actifs (pas Gagné/Perdu) dont updated_at est
  // antérieur au guide_time + tolerance jours.
  // On limite à 8 suggestions stagnant pour pas spammer
  const { data: candidates } = await supabase
    .from('job_candidate_status')
    .select(
      'id, candidate_id, candidate_name, candidate_headline, job_id, pipeline_stage, status, updated_at',
    )
    .eq('organization_id', orgId)
    .not('candidate_name', 'is', null)
    .neq('pipeline_stage', 'Gagné')
    .neq('pipeline_stage', 'Perdu')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: true })
    .limit(50);

  const stagnantCandidates: RawCandidateStatus[] = [];
  for (const c of (candidates || []) as RawCandidateStatus[]) {
    const stage = c.pipeline_stage || 'Nouveau';
    const guide = GUIDE_TIMES[stage];
    if (!guide) continue;
    const days = differenceInDays(now, parseISO(c.updated_at));
    if (days > guide + STAGNANT_TOLERANCE_DAYS) {
      stagnantCandidates.push(c);
    }
    if (stagnantCandidates.length >= 8) break;
  }

  // Dédup : check si task follow_up active déjà créée pour ce candidat
  if (stagnantCandidates.length > 0) {
    const stagCandidateIds = stagnantCandidates.map((c) => c.candidate_id);
    const { data: existingFollowUps } = await supabase
      .from('candidate_reminders')
      .select('candidate_id')
      .in('candidate_id', stagCandidateIds)
      .eq('category', 'follow_up')
      .is('completed_at', null);

    const followedUp = new Set((existingFollowUps || []).map((r: any) => r.candidate_id));
    for (const c of stagnantCandidates) {
      if (followedUp.has(c.candidate_id)) continue;
      const stage = c.pipeline_stage || 'Nouveau';
      const days = differenceInDays(now, parseISO(c.updated_at));
      suggestions.push({
        key: `followup-${c.id}`,
        category: 'follow_up',
        title: `Relancer ${c.candidate_name}`,
        description: [
          `Stagnant en "${stage}" depuis ${days}j (guide ${GUIDE_TIMES[stage] || '?'}j).`,
          'Renvoie un message ou propose une nouvelle action.',
        ]
          .filter(Boolean)
          .join(' '),
        dueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        candidate: {
          candidateId: c.candidate_id,
          name: c.candidate_name!,
          avatarUrl: null,
          headline: c.candidate_headline,
        },
        projectId: null, // job_id !== project_id, on garde null
        sourceEventId: null,
        reason: `Stagnant depuis ${days}j en "${stage}"`,
      });
    }
  }

  return suggestions;
};

export function useAutoTaskSuggestions(): {
  suggestions: AutoTaskSuggestion[];
  isLoading: boolean;
} {
  const { organizationId } = useOrganization();

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['auto-task-suggestions', organizationId],
    queryFn: () => fetchSuggestions(organizationId!),
    enabled: !!organizationId,
    staleTime: 60 * 1000, // 1 min
    refetchInterval: 5 * 60 * 1000, // re-check toutes les 5 min
  });

  return useMemo(() => ({ suggestions, isLoading }), [suggestions, isLoading]);
}
