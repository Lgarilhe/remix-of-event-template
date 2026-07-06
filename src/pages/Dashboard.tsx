/**
 * Dashboard — page d'accueil de l'app Konekt.
 *
 * Pattern SaaS moderne (Linear / Pipedrive / Notion) : pas un wall of stats
 * mais une page d'**action** + **personnalisable** (drag-to-reorder).
 *
 * Layout :
 * - Greeting (fixe, en haut)
 * - 5 sections sortables (drag handle au hover) :
 *   1. Connections — état temps réel des 3 canaux outreach
 *   2. Focus       — alertes color-coded "à traiter aujourd'hui"
 *   3. Missions+Today — combo 2 colonnes (missions actives + agenda)
 *   4. Week        — highlight perf hebdo
 *   5. Activity    — feed des derniers mouvements candidats
 *
 * L'ordre est persisté par user dans localStorage via useDashboardLayout.
 */

import React, { useMemo, useState } from 'react';
import { Reorder } from 'framer-motion';
import { differenceInDays, parseISO } from 'date-fns';
import { Undo2 } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { PageLayout } from '@/components/layout';
import { useATSData, type ATSCandidate } from '@/hooks/useATSData';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useTodayScheduledMessages } from '@/hooks/useTodayScheduledMessages';
import { useAllReminders } from '@/hooks/useAllReminders';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useDashboardConnections } from '@/hooks/useDashboardConnections';
import { useDashboardLayout, type DashboardSectionKey } from '@/hooks/useDashboardLayout';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { ActivationChecklist } from '@/components/dashboard/ActivationChecklist';
import { DetectedRolesCard } from '@/components/dashboard/DetectedRolesCard';
import { EmployerBrandCard } from '@/components/dashboard/EmployerBrandCard';
import { DashboardFocusPanel } from '@/components/dashboard/DashboardFocusPanel';
import { DashboardConnections } from '@/components/dashboard/DashboardConnections';
import { DashboardMissionsPanel } from '@/components/dashboard/DashboardMissionsPanel';
import { DashboardTodayPanel } from '@/components/dashboard/DashboardTodayPanel';
import { DashboardWeekHighlight } from '@/components/dashboard/DashboardWeekHighlight';
import { DashboardActivityFeed } from '@/components/dashboard/DashboardActivityFeed';
import { DashboardSortableItem } from '@/components/dashboard/DashboardSortableItem';

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
  const { displayName, avatarUrl: profileAvatarUrl } = useCurrentProfile();
  const connections = useDashboardConnections();
  const { order, setOrder, resetOrder, isCustomized } = useDashboardLayout();

  // Avatar prioritaire : LinkedIn (photo réelle) > profil custom upload > fallback initiales
  const greetingAvatarUrl = connections.linkedin.avatarUrl || profileAvatarUrl;

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

  // Reminders due today (today + overdue, not done)
  const remindersToday = useMemo(
    () => [...groupedReminders.overdue, ...groupedReminders.today],
    [groupedReminders.overdue, groupedReminders.today],
  );

  /**
   * Map clé → contenu rendu. Chaque section gère son propre skeleton/empty
   * state en interne. Si une section n'a rien à afficher (loading initial,
   * etc.), on retourne `null` pour la skipper du flux Reorder.
   */
  const sections: Record<DashboardSectionKey, React.ReactNode> = {
    connections: !connections.isLoading ? (
      <DashboardConnections
        linkedin={connections.linkedin}
        whatsapp={connections.whatsapp}
        email={connections.email}
        hasIssue={connections.hasIssue}
        allConnected={connections.allConnected}
      />
    ) : null,
    focus: !loading ? (
      <DashboardFocusPanel
        unreadMessages={unreadMessages}
        stagnantCandidates={focusCounters.stagnant}
        remindersToday={focusCounters.remindersToday}
        pendingResponses={focusCounters.pending}
      />
    ) : null,
    'missions-today': (
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
    ),
    week:
      !loading && candidates.length > 0 ? (
        <div className="mb-6">
          <DashboardWeekHighlight candidates={candidates} />
        </div>
      ) : null,
    activity: !loading ? (
      <div className="mb-6">
        <DashboardActivityFeed
          candidates={candidates}
          onCandidateClick={(c) => setSelectedCandidate(c)}
        />
      </div>
    ) : null,
  };

  return (
    <PageLayout maxWidth="2xl">
      <SEOHead
        title="Dashboard | Konekt"
        description="Votre point de départ : ce qui demande votre attention aujourd'hui."
      />

      {/* 1. Greeting (fixe en haut) */}
      <DashboardGreeting
        userName={displayName}
        avatarUrl={greetingAvatarUrl}
        activeCandidatesCount={activeCandidatesCount}
        activeMissionsCount={activeMissionsCount}
      />

      {/* 1bis. Zone d'activation (refonte onboarding 06/07) — checklist
          « Bien démarrer » + postes détectés + audit marque employeur.
          Chaque carte se masque seule (dismiss / tout coché / rien à montrer). */}
      <ActivationChecklist connections={connections} projectsCount={projects.length} />
      <DetectedRolesCard />
      <EmployerBrandCard />

      {/* 2. Sections sortables — drag handle visible au hover */}
      <Reorder.Group
        axis="y"
        values={order}
        onReorder={setOrder}
        className="space-y-0 list-none"
      >
        {order.map((key) => {
          const content = sections[key];
          if (!content) return null;
          return (
            <DashboardSortableItem key={key} value={key}>
              {content}
            </DashboardSortableItem>
          );
        })}
      </Reorder.Group>

      {/* Reset order — discret en bas, visible seulement si customisé */}
      {isCustomized && (
        <div className="flex justify-end mt-2">
          <button
            onClick={resetOrder}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Undo2 className="w-3 h-3" />
            Réinitialiser l'ordre
          </button>
        </div>
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
