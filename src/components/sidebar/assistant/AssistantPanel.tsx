/**
 * Panneau de l'onglet Assistant (§5.1), dans l'ordre :
 * 1. « Nouvelle conversation » : ouvre le tiroir sur un fil vide ;
 * 2. À valider, partagée avec À traiter (mêmes données, même retrait de plan) ;
 * 3. En cours : conversations dont un agent travaille (indicateur fixe, D8) ;
 * 4. Récentes : les 8 plus récentes hors À valider et En cours (exclusion par
 *    identifiant), puis « Toutes les conversations », toujours affiché.
 * Si les trois sections sont chargées et vides, une phrase d'invite ; le
 * bouton du haut suffit (D32).
 */
import { Sparkles, SquarePen } from 'lucide-react';
import { useAgent } from '@/contexts/AgentContext';
import { useAgentSignals, type AgentConversationItem } from '@/hooks/sidebar/useAgentSignals';
import { useAssistantRecent } from '@/hooks/sidebar/useAssistantRecent';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { useMissionNames } from '@/hooks/sidebar/useMyMissions';
import { formatShortTime } from '@/lib/sidebarSignals';
import { ApprovalsSection } from '../todo/ApprovalsSection';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

/** Récentes affichées au plus. */
const RECENT_LIMIT = 8;

/** Libellé d'un statut de conversation, sous-titre de repli des Récentes. */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  calibrating: 'Calibration',
  completed: 'Terminé',
  paused: 'En pause',
  failed: 'Erreur',
  error: 'Erreur',
  active: 'Conversation',
  plan_proposed: 'Plan proposé',
  running: 'En cours',
};

export function AssistantPanel() {
  const { startNewConversation, openConversation } = useAgent();
  const closeMobile = useCloseMobileSidebar();
  const signals = useAgentSignals();
  const recent = useAssistantRecent();

  // Exclusion par identifiant, jamais par statut : un plan ancien ou une
  // recherche bloquée, sortis de À valider ou d'En cours, restent ici.
  const shownElsewhere = new Set<string>([
    ...signals.plans.map((p) => p.id),
    ...signals.running.map((r) => r.id),
  ]);
  const recentRows = (recent.data ?? [])
    .filter((c) => !shownElsewhere.has(c.id))
    .slice(0, RECENT_LIMIT);

  const missionName = useMissionNames({
    enabled: signals.running.some((r) => !!r.project_id) || recentRows.some((c) => !!c.project_id),
  });
  const now = new Date();

  const open = (conv: AgentConversationItem) => {
    closeMobile();
    openConversation(conv.id);
  };

  const startNew = () => {
    closeMobile();
    startNewConversation();
  };

  const allEmpty =
    signals.status === 'ok' &&
    signals.actions.length === 0 &&
    signals.plans.length === 0 &&
    signals.running.length === 0 &&
    recent.status === 'ok' &&
    recentRows.length === 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="pb-1">
        <button
          type="button"
          onClick={startNew}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground min-h-11 md:min-h-8 transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <SquarePen aria-hidden="true" className="h-4 w-4" />
          Nouvelle conversation
        </button>
      </div>

      {allEmpty && (
        <p className="px-3 py-2 text-[12px] text-muted-foreground">
          Posez une question à l'assistant ou confiez-lui une recherche.
        </p>
      )}

      <ApprovalsSection variant="assistant" />

      <SidebarSection
        id="assistant-running"
        title="En cours"
        state={signals.status}
        stale={signals.stale}
        onRetry={signals.retry}
        isEmpty={signals.running.length === 0}
      >
        {signals.running.map((conv) => (
          <SidebarRow
            key={conv.id}
            leading={<span className="block h-1.5 w-1.5 rounded-full bg-primary" />}
            title={conv.title || conv.job_title || 'Recherche en cours'}
            sub={missionName(conv.project_id)}
            onSelect={() => open(conv)}
          />
        ))}
      </SidebarSection>

      <SidebarSection
        id="assistant-recent"
        title="Récentes"
        state={recent.status}
        stale={recent.stale}
        onRetry={recent.retry}
        isEmpty={recentRows.length === 0}
      >
        {recentRows.map((conv) => {
          const label = missionName(conv.project_id) ?? STATUS_LABELS[conv.status] ?? null;
          const time = formatShortTime(conv.updated_at, now);
          return (
            <SidebarRow
              key={conv.id}
              leading={<Sparkles />}
              title={conv.title || conv.job_title || 'Conversation'}
              sub={label ? `${label} · ${time}` : time}
              onSelect={() => open(conv)}
            />
          );
        })}
      </SidebarSection>

      <ul className="flex flex-col gap-px py-1">
        <SidebarRow title="Toutes les conversations" to="/agents" />
      </ul>
    </div>
  );
}
