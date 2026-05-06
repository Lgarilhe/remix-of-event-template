/**
 * Dashboard — page d'accueil de l'app Konekt.
 *
 * Pattern SaaS moderne (Linear / Pipedrive / Notion) : pas un wall of stats
 * mais une page d'**action** :
 * 1. Greeting personnalisé + CTAs rapides
 * 2. Focus du jour — 4 alertes color-coded "ce qui demande votre attention"
 * 3. Missions actives (gauche) + Programme du jour (droite)
 * 4. Performance hebdo highlight (1 phrase + 4 mini-stats) + lien analytics
 * 5. Activité récente (feed des derniers mouvements)
 *
 * L'analytics complet (KPIs, conversion, charts détaillés) reste accessible
 * via /pipeline?view=analytics — pas dupliqué ici.
 */

import React, { useMemo, useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { SEOHead } from '@/components/SEOHead';
import { PageLayout } from '@/components/layout';
import { useATSData, type ATSCandidate } from '@/hooks/useATSData';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useTodayScheduledMessages } from '@/hooks/useTodayScheduledMessages';
import { useAllReminders } from '@/hooks/useAllReminders';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { DashboardFocusPanel } from '@/components/dashboard/DashboardFocusPanel';
import { DashboardMissionsPanel } from '@/components/dashboard/DashboardMissionsPanel';
import { DashboardTodayPanel } from '@/components/dashboard/DashboardTodayPanel';
import { DashboardWeekHighlight } from '@/components/dashboard/DashboardWeekHighlight';
import { DashboardActivityFeed } from '@/components/dashboard/DashboardActivityFeed';

// Helpers (used to derive focus panel counters)
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

export default function Dashboard() {
  const { candidates, loading, handleStageChange, handleTagsChange, refetch } = useATSData();
  const { projects, isLoading: projectsLoading } = useSourcingProjects();
  const { data: scheduledMessages = [], isLoading: messagesLoading } = useTodayScheduledMessages();
  const { grouped: groupedReminders, isLoading: remindersLoading } = useAllReminders();
  const unreadMessages = useUnreadMessageNotifications();
  const { displayName } = useCurrentProfile();

  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Derived counters for the Focus Panel
  const focusCounters = useMemo(() => {
    const stagnant = candidates.filter(isStagnant).length;
    const pending = candidates.filter(isPendingResponse).length;
    const remindersToday = groupedReminders.today.length + groupedReminders.overdue.length;
    return {
      stagnant,
      pending,
      remindersToday,
    };
  }, [candidates, groupedReminders.today.length, groupedReminders.overdue.length]);

  // Active candidates count (exclude terminal)
  const activeCandidatesCount = useMemo(
    () => candidates.filter(c => c.stage !== 'Gagné' && c.stage !== 'Perdu').length,
    [candidates],
  );

  const activeMissionsCount = useMemo(
    () => projects.filter(p => p.status === 'active').length,
    [projects],
  );

  // displayName vient de useCurrentProfile (cascade : profiles.display_name →
  // user_metadata.full_name → user_metadata.first_name+last_name → email parsé).

  // Reminders due today (today + overdue, not done)
  const remindersToday = useMemo(
    () => [...groupedReminders.overdue, ...groupedReminders.today],
    [groupedReminders.overdue, groupedReminders.today],
  );

  return (
    <PageLayout maxWidth="2xl">
      <SEOHead
        title="Dashboard | Konekt"
        description="Votre point de départ : ce qui demande votre attention aujourd'hui."
      />

      {/* 1. Greeting */}
      <DashboardGreeting
        userName={displayName}
        activeCandidatesCount={activeCandidatesCount}
        activeMissionsCount={activeMissionsCount}
      />

      {/* 2. Focus du jour */}
      {!loading && (
        <DashboardFocusPanel
          unreadMessages={unreadMessages}
          stagnantCandidates={focusCounters.stagnant}
          remindersToday={focusCounters.remindersToday}
          pendingResponses={focusCounters.pending}
        />
      )}

      {/* 3. Missions + Aujourd'hui — 2 colonnes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <DashboardMissionsPanel projects={projects} isLoading={projectsLoading} />
        </div>
        <div>
          <DashboardTodayPanel
            scheduledMessages={scheduledMessages}
            remindersToday={remindersToday}
            isLoading={messagesLoading || remindersLoading}
          />
        </div>
      </div>

      {/* 4. Performance hebdo */}
      {!loading && candidates.length > 0 && (
        <div className="mb-6">
          <DashboardWeekHighlight candidates={candidates} />
        </div>
      )}

      {/* 5. Activité récente */}
      {!loading && (
        <DashboardActivityFeed
          candidates={candidates}
          onCandidateClick={(c) => setSelectedCandidate(c)}
        />
      )}

      {/* Modals */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
        />
      )}

      <JobDetailSheet
        jobId={selectedJobId}
        open={!!selectedJobId}
        onOpenChange={(open) => !open && setSelectedJobId(null)}
      />
    </PageLayout>
  );
}
