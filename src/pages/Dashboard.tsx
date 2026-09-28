/**
 * Dashboard — page d'accueil de l'application.
 *
 * Une page d'action plutôt qu'un mur de chiffres : l'en-tête, puis cinq
 * sections dans l'ordre choisi par l'utilisateur (mode « Personnaliser »,
 * mémorisé par useDashboardLayout) :
 *   1. Canaux        — état de LinkedIn et de l'e-mail
 *   2. Pour aujourd'hui — ce qui attend une action
 *   3. Missions et journée — missions actives, programme du jour
 *   4. Cette semaine — variation et chiffres de la semaine
 *   5. Activité      — derniers mouvements sur les candidats
 *
 * Chaque section a ses états : chargement (squelette à hauteur fixe), erreur
 * avec « Réessayer », vide avec la prochaine action (docs/design/01-direction.md, § 8).
 */

import React, { useMemo, useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { Check, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { PageLayout, Section, ErrorState } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useATSData, type ATSCandidate } from '@/hooks/useATSData';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useTodayScheduledMessages } from '@/hooks/useTodayScheduledMessages';
import { useAllReminders } from '@/hooks/useAllReminders';
import { useSidebarNotifications } from '@/hooks/sidebar/useSidebarNotifications';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useDashboardConnections } from '@/hooks/useDashboardConnections';
import { useDashboardLayout, type DashboardSectionKey } from '@/hooks/useDashboardLayout';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { DashboardFocusPanel } from '@/components/dashboard/DashboardFocusPanel';
import { DashboardConnections } from '@/components/dashboard/DashboardConnections';
import { DashboardMissionsPanel } from '@/components/dashboard/DashboardMissionsPanel';
import { DashboardTodayPanel } from '@/components/dashboard/DashboardTodayPanel';
import { DashboardWeekHighlight } from '@/components/dashboard/DashboardWeekHighlight';
import { DashboardActivityFeed } from '@/components/dashboard/DashboardActivityFeed';
import { DashboardSortableItem } from '@/components/dashboard/DashboardSortableItem';

// Délais indicatifs par étape, au-delà desquels un candidat est « stagnant ».
const STAGE_GUIDE_TIMES: Record<string, number> = {
  'Nouveau': 3, 'Contacté': 5, 'Répondu': 3, 'Pressenti': 5,
  'Pré-qualif': 7, 'CV envoyé': 5, 'ITW en cours': 10, 'Offre': 7,
};

const isStagnant = (c: ATSCandidate): boolean => {
  const guide = STAGE_GUIDE_TIMES[c.stage];
  if (!guide || !c.lastActivity) return false;
  try {
    return differenceInDays(new Date(), parseISO(c.lastActivity)) > guide;
  } catch {
    return false;
  }
};

const isPendingResponse = (c: ATSCandidate): boolean => {
  if (c.stage !== 'Répondu') return false;
  if (!c.lastActivity) return true;
  try {
    return differenceInDays(new Date(), parseISO(c.lastActivity)) >= 1;
  } catch {
    return true;
  }
};

const SECTION_LABELS: Record<DashboardSectionKey, string> = {
  connections: 'Vos canaux',
  focus: "Pour aujourd'hui",
  'missions-today': 'Missions et journée',
  week: 'Cette semaine',
  activity: 'Activité récente',
};

/** Section dont les données chargent ou n'ont pas pu être lues. */
const PanelPlaceholder: React.FC<{
  title: string;
  loading: boolean;
  error: string | null;
  errorTitle: string;
  onRetry: () => void;
}> = ({ title, loading, error, errorTitle, onRetry }) => (
  <Section headingLevel={2} title={title}>
    <div className="p-3">
      {loading ? (
        <div role="status" aria-label="Chargement">
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : (
        <ErrorState
          variant="compact"
          className="border-0 bg-transparent"
          title={errorTitle}
          description="Vérifiez votre connexion, puis réessayez."
          detail={error}
          onRetry={onRetry}
        />
      )}
    </div>
  </Section>
);

export default function Dashboard() {
  const { candidates, loading, error: candidatesError, handleStageChange, handleTagsChange, refetch } = useATSData();
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
  const unreadMessagesUnavailable = replies.status === 'error' || replies.status === 'offline';
  const { displayName } = useCurrentProfile();
  const connections = useDashboardConnections();
  const { order, setOrder, resetOrder, isCustomized } = useDashboardLayout();

  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const candidatesUnavailable = !!candidatesError && candidates.length === 0;

  const focusCounters = useMemo(() => ({
    stagnant: candidatesUnavailable ? null : candidates.filter(isStagnant).length,
    pending: candidatesUnavailable ? null : candidates.filter(isPendingResponse).length,
    remindersToday: remindersError ? null : groupedReminders.today.length + groupedReminders.overdue.length,
  }), [candidates, candidatesUnavailable, remindersError, groupedReminders.today.length, groupedReminders.overdue.length]);

  // Candidats actifs : hors étapes terminales.
  const activeCandidatesCount = useMemo(
    () => candidates.filter(c => c.stage !== 'Gagné' && c.stage !== 'Perdu').length,
    [candidates],
  );

  const activeMissionsCount = useMemo(
    () => projects.filter(p => p.status === 'active').length,
    [projects],
  );

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

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setAnnouncement(`${SECTION_LABELS[next[target]]} : position ${target + 1} sur ${next.length}.`);
  };

  const sections: Record<DashboardSectionKey, React.ReactNode> = {
    connections: (
      <DashboardConnections linkedin={connections.linkedin} email={connections.email} isLoading={connections.isLoading} />
    ),
    focus: (
      <DashboardFocusPanel
        isLoading={loading || remindersLoading}
        unreadMessages={unreadMessages}
        unreadMessagesUnavailable={unreadMessagesUnavailable}
        stagnantCandidates={focusCounters.stagnant}
        remindersToday={focusCounters.remindersToday}
        pendingResponses={focusCounters.pending}
      />
    ),
    'missions-today': (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardMissionsPanel
            projects={projects}
            isLoading={projectsLoading}
            error={projectsError ? (projectsError as { message?: string }).message ?? 'Erreur' : null}
            onRetry={() => void refetchProjects()}
          />
        </div>
        <DashboardTodayPanel
          scheduledMessages={scheduledMessages}
          remindersToday={remindersToday}
          isLoading={messagesLoading || remindersLoading}
          error={todayError}
          onRetry={retryToday}
          onToggleReminder={toggleComplete}
        />
      </div>
    ),
    week:
      loading || candidatesUnavailable ? (
        <PanelPlaceholder
          title="Cette semaine"
          loading={loading}
          error={candidatesError}
          errorTitle="Impossible de calculer la semaine"
          onRetry={refetch}
        />
      ) : candidates.length > 0 ? (
        <DashboardWeekHighlight candidates={candidates} />
      ) : null,
    activity:
      loading || candidatesUnavailable ? (
        <PanelPlaceholder
          title="Activité récente"
          loading={loading}
          error={candidatesError}
          errorTitle="Impossible de charger l'activité"
          onRetry={refetch}
        />
      ) : (
        <DashboardActivityFeed candidates={candidates} onCandidateClick={(c) => setSelectedCandidate(c)} />
      ),
  };

  return (
    <PageLayout maxWidth="2xl">
      <SEOHead
        title="Tableau de bord | Konekt"
        description="Votre point de départ : ce qui demande votre attention aujourd'hui."
      />

      <DashboardGreeting
        userName={displayName}
        activeCandidatesCount={activeCandidatesCount}
        activeMissionsCount={activeMissionsCount}
      />

      {editing && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3">
          <p className="text-sm text-foreground">Réordonnez les sections avec les flèches. L'ordre est enregistré pour vous.</p>
          <div className="flex items-center gap-2">
            {isCustomized && (
              <Button type="button" variant="ghost" size="sm" onClick={resetOrder}>
                <RotateCcw aria-hidden="true" />
                Rétablir l'ordre par défaut
              </Button>
            )}
            <Button type="button" variant="primary" size="sm" onClick={() => setEditing(false)}>
              <Check aria-hidden="true" />
              Terminé
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-6">
        {order.map((key, index) => {
          const content = sections[key];
          if (!content) return null;
          return (
            <DashboardSortableItem
              key={key}
              label={SECTION_LABELS[key]}
              editing={editing}
              isFirst={index === 0}
              isLast={index === order.length - 1}
              onMoveUp={() => moveSection(index, -1)}
              onMoveDown={() => moveSection(index, 1)}
            >
              {content}
            </DashboardSortableItem>
          );
        })}
      </ul>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {!editing && (
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <SlidersHorizontal aria-hidden="true" />
            Personnaliser la page
          </Button>
        </div>
      )}

      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
        />
      )}
    </PageLayout>
  );
}
