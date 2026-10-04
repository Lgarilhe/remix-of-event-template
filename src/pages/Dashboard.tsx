/**
 * Dashboard — page d'accueil de l'application (design simplifié,
 * docs/design/06-simplicite.md).
 *
 * L'en-tête, puis deux sections :
 *   1. À faire — ce qui attend une action (compte LinkedIn à reconnecter,
 *      réponses, relances, candidats qui n'avancent plus), puis les tâches en
 *      retard et la journée (entretiens, envois, tâches).
 *   2. Missions en cours — une ligne par mission, visages des candidats en
 *      entretien, chiffres au total.
 *
 * Décision du propriétaire (04/10/2026) : plus de cartes des canaux (une ligne
 * « À faire » quand LinkedIn est à reconnecter), plus de « Cette semaine » ni
 * d'activité récente sur l'accueil (Pipeline, onglet Analyse, et la fiche de
 * chaque candidat), plus de réordonnancement des sections.
 *
 * Chaque section a ses états : chargement (squelette), erreur avec
 * « Réessayer », vide avec la prochaine action (docs/design/01-direction.md, § 8).
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useATSData, daysInStage, stagnantDays, countPeople, type ATSCandidate } from '@/hooks/useATSData';
import { STALE_EXEMPT_STAGES } from '@/lib/stageDisplay';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useTodayScheduledMessages } from '@/hooks/useTodayScheduledMessages';
import { useAllReminders } from '@/hooks/useAllReminders';
import { useSidebarNotifications } from '@/hooks/sidebar/useSidebarNotifications';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useDashboardConnections } from '@/hooks/useDashboardConnections';
import { useCandidateAvatars } from '@/hooks/useCandidateAvatars';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { DashboardFocusPanel, type FocusPerson } from '@/components/dashboard/DashboardFocusPanel';
import { DashboardMissionsPanel, type InterviewingPeople } from '@/components/dashboard/DashboardMissionsPanel';
import { DashboardTodayPanel } from '@/components/dashboard/DashboardTodayPanel';

// Stagnant : même règle que la carte, le tableau et l'analyse du /pipeline
// (délais de useATSData, jours depuis l'entrée dans l'étape). À trier et Retenu
// sont exemptés (plan 0c, section 6.4), comme les étapes terminales.
const isStagnant = (c: ATSCandidate): boolean => {
  if (c.generalStage && STALE_EXEMPT_STAGES.has(c.generalStage)) return false;
  return stagnantDays(c) !== null;
};

// À relancer : a répondu, et sans suite depuis un jour ou plus dans l'étape.
const isPendingResponse = (c: ATSCandidate): boolean => {
  if (c.stage !== 'Répondu') return false;
  const days = daysInStage(c);
  return days === null || days >= 1;
};

// Ligne de job_candidate_status qui porte la photo enregistrée du candidat.
const photoKeyOf = (c: ATSCandidate): string =>
  c.source === 'local' && c.id.startsWith('local-') ? c.id.slice('local-'.length) : c.sourceId;

// Visages montrés par pile : trois personnes distinctes au plus.
const STACK_FACES = 3;
const firstPeople = (list: ATSCandidate[]): ATSCandidate[] => {
  const seen = new Set<string>();
  const out: ATSCandidate[] = [];
  for (const c of list) {
    const key = c.candidateId || c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === STACK_FACES) break;
  }
  return out;
};

export default function Dashboard() {
  const { candidates, loading, error: candidatesError } = useATSData();
  const { projects, isLoading: projectsLoading, error: projectsError, refetch: refetchProjects } = useSourcingProjects();
  const {
    data: scheduledMessages = [],
    isLoading: messagesLoading,
    error: messagesError,
    refetch: refetchMessages,
  } = useTodayScheduledMessages();
  const {
    grouped: groupedReminders,
    isLoading: remindersLoading,
    error: remindersError,
    refetch: refetchReminders,
    toggleComplete,
  } = useAllReminders();
  // Réponses de candidats comptées par la barre : mêmes clés, même nombre que
  // les lignes en gras de la section Réponses. null : inconnu.
  const { replies } = useSidebarNotifications();
  const unreadMessages = replies.data ? replies.data.candidates.filter((c) => c.counted).length : null;
  const unreadPeople = replies.data?.candidates.filter((c) => c.counted).slice(0, STACK_FACES).map((r) => ({ name: r.name }));
  const unreadMessagesUnavailable = replies.status === 'error' || replies.status === 'offline';
  const { displayName } = useCurrentProfile();
  const connections = useDashboardConnections();

  const candidatesUnavailable = !!candidatesError && candidates.length === 0;

  const pendingList = useMemo(() => (candidatesUnavailable ? [] : candidates.filter(isPendingResponse)), [candidates, candidatesUnavailable]);
  const stagnantList = useMemo(() => (candidatesUnavailable ? [] : candidates.filter(isStagnant)), [candidates, candidatesUnavailable]);

  // Candidats en entretien en ce moment, par mission (étape générale du lot 0c).
  const interviewingByMission = useMemo(() => {
    const byMission = new Map<string, ATSCandidate[]>();
    for (const c of candidates) {
      if (c.generalStage !== 'interviewing' || !c.projectId) continue;
      byMission.set(c.projectId, [...(byMission.get(c.projectId) ?? []), c]);
    }
    return byMission;
  }, [candidates]);

  // Une seule lecture des photos pour toutes les piles de visages.
  const shown = useMemo(() => {
    const lists = [firstPeople(pendingList), firstPeople(stagnantList)];
    for (const list of interviewingByMission.values()) lists.push(firstPeople(list));
    return lists;
  }, [pendingList, stagnantList, interviewingByMission]);
  const photoKeys = useMemo(() => Array.from(new Set(shown.flat().map(photoKeyOf).filter(Boolean))), [shown]);
  const photos = useCandidateAvatars(photoKeys);
  const personOf = (c: ATSCandidate): FocusPerson => ({ name: c.name, src: photos.get(photoKeyOf(c)) ?? null });

  const interviewing = useMemo(() => {
    const out: Record<string, InterviewingPeople> = {};
    for (const [projectId, list] of interviewingByMission) {
      out[projectId] = {
        people: firstPeople(list).map((c) => ({ name: c.name, src: photos.get(photoKeyOf(c)) ?? null })),
        total: countPeople(list),
      };
    }
    return out;
  }, [interviewingByMission, photos]);

  // Candidats actifs : hors étapes terminales, une personne comptée une fois
  // même présente dans deux missions. Les profils jamais ouverts sont déjà
  // exclus par useATSData.
  const activeCandidatesCount = useMemo(
    () => countPeople(candidates.filter(c => c.stage !== 'Gagné' && c.stage !== 'Perdu')),
    [candidates],
  );

  const activeMissionsCount = useMemo(
    () => projects.filter(p => p.status === 'active').length,
    [projects],
  );

  // Client d'une mission, pour les initiales d'une tâche sans candidat.
  const missionClientOf = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.jd_client || p.client_name || null]));
    return (jobId: string) => byId.get(jobId.replace(/^project:/, '')) ?? null;
  }, [projects]);

  // Tâches du jour : aujourd'hui et en retard, non terminées.
  const remindersToday = useMemo(
    () => [...groupedReminders.overdue, ...groupedReminders.today],
    [groupedReminders.overdue, groupedReminders.today],
  );

  const todayError = remindersError ?? (messagesError ? (messagesError as { message?: string }).message ?? 'Erreur' : null);
  const retryToday = () => {
    void refetchReminders();
    void refetchMessages();
  };

  return (
    <PageLayout maxWidth="md">
      <SEOHead
        title="Tableau de bord | Konekt"
        description="Votre point de départ : ce qui demande votre attention aujourd'hui."
      />

      <DashboardGreeting
        userName={displayName}
        activeCandidatesCount={activeCandidatesCount}
        activeMissionsCount={activeMissionsCount}
      />

      <div className="mt-4 space-y-12">
        <section aria-labelledby="dashboard-todo">
          <div className="flex flex-wrap items-baseline justify-between gap-4 pb-1">
            <h2 id="dashboard-todo" className="text-lg font-semibold text-foreground">
              À faire
            </h2>
            <Button asChild variant="link" size="sm" className="min-h-11 px-0 text-muted-foreground md:min-h-0">
              <Link to="/tasks">Toutes les tâches</Link>
            </Button>
          </div>
          <DashboardFocusPanel
            isLoading={loading}
            linkedinIssue={connections.linkedin.status === 'error'}
            unreadMessages={unreadMessages}
            unreadMessagesUnavailable={unreadMessagesUnavailable}
            unreadPeople={unreadPeople}
            pendingResponses={candidatesUnavailable ? null : pendingList.length}
            pendingPeople={firstPeople(pendingList).map(personOf)}
            stagnantCandidates={candidatesUnavailable ? null : stagnantList.length}
            stagnantPeople={firstPeople(stagnantList).map(personOf)}
          />
          <DashboardTodayPanel
            scheduledMessages={scheduledMessages}
            remindersToday={remindersToday}
            missionClientOf={missionClientOf}
            isLoading={messagesLoading || remindersLoading}
            error={todayError}
            onRetry={retryToday}
            onToggleReminder={toggleComplete}
          />
        </section>

        <DashboardMissionsPanel
          projects={projects}
          interviewing={interviewing}
          isLoading={projectsLoading}
          error={projectsError ? (projectsError as { message?: string }).message ?? 'Erreur' : null}
          onRetry={() => void refetchProjects()}
        />
      </div>
    </PageLayout>
  );
}
