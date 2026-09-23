/**
 * À valider (§4.4, D28 à D31) : actions proposées par l'assistant et plans de
 * recherche proposés. Partagée par les onglets À traiter et Assistant, mêmes
 * données, mêmes lignes. Chaque ligne compte dans le chiffre (en gras).
 *
 * « Retirer ce plan » : un seul clic, sans fenêtre. La ligne disparaît tout de
 * suite, puis la conversation est archivée ; un toast propose « Annuler »
 * pendant 8 secondes (aucune vue ne montre une conversation archivée).
 */
import type React from 'react';
import { Hand, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useAgent } from '@/contexts/AgentContext';
import {
  agentSignalsQueryKey,
  useAgentSignals,
  type AgentSignalsData,
  type PlanItem,
  type ProposedAction,
} from '@/hooks/sidebar/useAgentSignals';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { useMissionNames } from '@/hooks/sidebar/useMyMissions';
import { formatShortTime } from '@/lib/sidebarSignals';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

const ACTION_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-sidebar-foreground ' +
  'hover:bg-sidebar-accent/60 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

/** Résumé du dry-run (chaîne), lu avec une garde de type. */
function actionSummary(action: ProposedAction): string | null {
  const r = action.dry_run_result;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !('summary' in r)) return null;
  const summary = (r as { summary: unknown }).summary;
  return typeof summary === 'string' && summary.trim() !== '' ? summary.trim() : null;
}

export const ApprovalsSection: React.FC<{ variant: 'todo' | 'assistant' }> = ({ variant }) => {
  const { actions, plans, status, stale, retry } = useAgentSignals();
  const { openConversation } = useAgent();
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();
  const missionName = useMissionNames({ enabled: plans.some((p) => !!p.project_id) });
  const now = new Date();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['sidebar', 'agent-signals'] });
    void queryClient.invalidateQueries({ queryKey: ['sidebar', 'assistant-recent'] });
  };

  const restore = async (planId: string) => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('agent_conversations')
        .update({ archived_at: null })
        .eq('id', planId)
        .eq('created_by', userId)
        .select('id');
      if (error || data?.length !== 1) throw error ?? new Error('Aucune conversation rétablie');
    } catch (err) {
      console.warn('[ApprovalsSection] rétablissement du plan en échec :', err);
      toast.error("Le plan n'a pas été rétabli. Réessayez.");
    }
    invalidate();
  };

  const withdraw = async (plan: PlanItem) => {
    if (!userId) return;
    const key = agentSignalsQueryKey(userId, organizationId);
    try {
      await queryClient.cancelQueries({ queryKey: key });
    } catch {
      // Annulation impossible : le retrait optimiste reste valable.
    }
    const previous = queryClient.getQueryData<AgentSignalsData>(key);
    if (previous) {
      queryClient.setQueryData<AgentSignalsData>(key, {
        ...previous,
        plans: previous.plans.filter((p) => p.id !== plan.id),
      });
    }
    try {
      const { data, error } = await supabase
        .from('agent_conversations')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', plan.id)
        .eq('created_by', userId)
        .eq('status', 'plan_proposed')
        .select('id');
      if (error || data?.length !== 1) throw error ?? new Error('Aucune conversation archivée');
      toast('Plan retiré.', {
        action: { label: 'Annuler', onClick: () => void restore(plan.id) },
        duration: 8000,
      });
    } catch (err) {
      console.warn('[ApprovalsSection] retrait du plan en échec :', err);
      if (previous) queryClient.setQueryData<AgentSignalsData>(key, previous);
      toast.error("Le plan n'a pas été retiré. Réessayez.");
    }
    invalidate();
  };

  const openAction = (action: ProposedAction) => {
    closeMobile();
    if (action.conversation_id) openConversation(action.conversation_id);
    else navigate('/settings/account/journal');
  };

  const openPlan = (plan: PlanItem) => {
    closeMobile();
    openConversation(plan.id);
  };

  return (
    <SidebarSection
      id={`approvals-${variant}`}
      title="À valider"
      state={status}
      stale={stale}
      onRetry={retry}
      isEmpty={actions.length === 0 && plans.length === 0}
      errorText="Impossible de charger les validations."
    >
      {actions.map((action) => (
        <SidebarRow
          key={`action:${action.id}`}
          leading={<Hand />}
          title={actionSummary(action) ?? "Action proposée par l'assistant"}
          sub={formatShortTime(action.proposed_at, now)}
          strong
          onSelect={() => openAction(action)}
        />
      ))}
      {plans.map((plan) => {
        const label = plan.title || plan.job_title || missionName(plan.project_id);
        const time = formatShortTime(plan.updated_at, now);
        return (
          <SidebarRow
            key={`plan:${plan.id}`}
            leading={<Hand />}
            title="Plan de recherche proposé"
            sub={label ? `${label} · ${time}` : time}
            strong
            onSelect={() => openPlan(plan)}
            action={
              <button
                type="button"
                aria-label="Retirer ce plan"
                title="Retirer ce plan"
                onClick={() => void withdraw(plan)}
                className={ACTION_BUTTON_CLASS}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            }
          />
        );
      })}
    </SidebarSection>
  );
};
