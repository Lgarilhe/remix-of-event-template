/**
 * useAutoTaskSuggestions — détecte les contextes qui méritent une tâche
 * automatique et propose à l'user de les créer en 1 clic.
 *
 * Pas de création silencieuse — on respecte l'agency de l'user. On affiche
 * des "suggestions" en haut de /tasks, click → crée la tâche.
 *
 * Stratégies de détection (idempotent — pas de doublon si tâche déjà existante) :
 *
 * 1. **Debrief post-RDV manquant** : event qualif terminé dans les dernières
 *    24h, status='scheduled' (pas marqué completed), aucune tâche category=
 *    'debrief' avec source_event_id = event.id → suggère "Faire le debrief
 *    de l'entretien {candidat}".
 *
 * 2. **Brief pré-RDV manquant** (futur) : event qualif dans <24h, pas de
 *    tâche category='interview_prep' → suggère "Préparer l'entretien {X}".
 *
 * 3. **Candidat stagnant sans relance** (futur) : candidat à un stage > X
 *    jours, pas de tâche category='follow_up' active → suggère "Relancer X".
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { differenceInHours, parseISO } from 'date-fns';

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
  /** Event qualif source (pour dédup debrief) */
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

const fetchSuggestions = async (orgId: string): Promise<AutoTaskSuggestion[]> => {
  const suggestions: AutoTaskSuggestion[] = [];
  const now = new Date();

  // ─── 1. Debrief post-RDV manquant ─────────────────────────────────────
  // Events qualif terminés entre il y a 24h et il y a 30 min (laisse le
  // temps au RDV de se terminer)
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const until = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  const { data: pastEvents } = await supabase
    .from('qualification_sessions')
    .select(
      'id, event_start_at, event_end_at, event_name, candidate_name, candidate_profile_id, candidate_headline, job_title, client_name, project_id, status',
    )
    .eq('organization_id', orgId)
    .gte('event_end_at', since)
    .lte('event_end_at', until)
    .neq('status', 'completed');

  const events = (pastEvents || []) as RawEvent[];
  if (events.length === 0) return suggestions;

  // Récupère les debrief existants pour ces events (dédup)
  const eventIds = events.map((e) => e.id);
  const { data: existingDebriefs } = await supabase
    .from('candidate_reminders')
    .select('source_event_id')
    .in('source_event_id', eventIds)
    .eq('category', 'debrief');

  const debriefedEventIds = new Set(
    (existingDebriefs || []).map((d: any) => d.source_event_id),
  );

  for (const ev of events) {
    if (debriefedEventIds.has(ev.id)) continue;
    if (!ev.candidate_name) continue; // skip events sans candidat
    const endAt = ev.event_end_at ? parseISO(ev.event_end_at) : new Date(ev.event_start_at);
    const hoursSince = differenceInHours(now, endAt);

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
      dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // dans 2h
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
