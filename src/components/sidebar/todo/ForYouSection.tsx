/**
 * Pour vous (§4.2) : notifications non lues qui demandent une action, hors
 * messages et hors panne LinkedIn (qui a sa ligne en tête). Toutes comptent
 * dans le chiffre (en gras). Un clic marque lu puis ouvre le lien.
 *
 * Icônes : la fin d'essai (lien vers /pricing) est grise, ce n'est pas une
 * panne ; les autres erreurs sont des pannes, en rouge (D8).
 */
import type React from 'react';
import { AlertTriangle, AtSign, Bell, Briefcase, CreditCard, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSidebarNotifications } from '@/hooks/sidebar/useSidebarNotifications';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { notificationSub } from '@/lib/sidebarSignals';
import type { Notification } from '@/lib/notificationKinds';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';
import { SIDEBAR_GHOST_CLASS } from '../sidebarButtonClass';

/** Classes ajoutées au Button du kit (taille xs) : 44 px sur téléphone, 28 px sur ordinateur. */
const HEADER_BUTTON_CLASS = cn(
  SIDEBAR_GHOST_CLASS,
  'rounded-md px-2 min-h-11 md:min-h-7 text-xs font-medium text-muted-foreground',
);

const sourceOf = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('source' in metadata)) return null;
  const source = (metadata as { source: unknown }).source;
  return typeof source === 'string' ? source : null;
};

/** Icône d'une notification (Pour vous et Activité). */
export const NotificationIcon: React.FC<{ notification: Notification }> = ({ notification: n }) => {
  if (n.type === 'mention') return <AtSign />;
  if (n.type === 'error') {
    if ((n.link ?? '').startsWith('/pricing')) return <CreditCard />;
    return <AlertTriangle className="text-destructive" />;
  }
  const source = sourceOf(n.metadata);
  if (source === 'marketplace') return <Briefcase />;
  if (source === 'agent_background_task' || source === 'agent_search') return <Target />;
  return <Bell />;
};

export function ForYouSection() {
  const { forYou, markRead, markAllForYouRead } = useSidebarNotifications();
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const actions = forYou.data?.actions ?? [];
  const now = new Date();

  const open = (n: Notification) => {
    closeMobile();
    void markRead([n.id]);
    if (n.link) navigate(n.link);
  };

  const headerAction =
    actions.length > 0 ? (
      <Button type="button" variant="ghost" size="xs" onClick={() => void markAllForYouRead()} className={HEADER_BUTTON_CLASS}>
        Tout marquer comme lu
      </Button>
    ) : undefined;

  return (
    <SidebarSection
      id="for-you"
      title="Pour vous"
      state={forYou.status}
      stale={forYou.stale}
      onRetry={forYou.retry}
      isEmpty={actions.length === 0}
      headerAction={headerAction}
    >
      {actions.map((n) => (
        <SidebarRow
          key={n.id}
          leading={<NotificationIcon notification={n} />}
          title={n.title}
          sub={notificationSub(n, now)}
          strong
          onSelect={() => open(n)}
        />
      ))}
    </SidebarSection>
  );
}
