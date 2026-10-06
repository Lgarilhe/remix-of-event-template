/**
 * Chiffre d'À traiter (§6, D8, D9) : panne LinkedIn, réponses de candidats
 * comptées, validations de l'assistant et actions de Pour vous.
 *
 * Appelé par AppSidebar (onglet) et, sur téléphone, par AppHeader (bouton du
 * menu) : mêmes clés que le panneau, aucune requête en plus.
 * null : une source n'a encore aucune donnée, pas de pastille.
 */
import { todoCount } from '@/lib/sidebarSignals';
import { useLinkedInOutage } from './useLinkedInOutage';
import { useSidebarNotifications } from './useSidebarNotifications';
import { useAgentSignals } from './useAgentSignals';

export function useTodoSignal(): { count: number | null } {
  const linkedin = useLinkedInOutage();
  const { replies, forYou } = useSidebarNotifications();
  const signals = useAgentSignals();

  const count = todoCount({
    replies: { status: replies.status, data: replies.data },
    // queryState ne donne 'ok' qu'avec des données.
    signals: {
      status: signals.status,
      data: signals.status === 'ok' ? { actions: signals.actions, plans: signals.plans } : undefined,
    },
    forYouActionCount: { status: forYou.status, data: forYou.data?.actions.length },
    linkedinOutage: {
      status: linkedin.status,
      data: linkedin.status === 'ok' ? linkedin.outage : undefined,
    },
  });
  return { count };
}
