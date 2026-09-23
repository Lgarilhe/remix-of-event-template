/**
 * Activité (§4.3, D25) : notifications hors messages des 30 derniers jours.
 * Repliée par défaut, état mémorisé (konekt:nav:activity-open) ; lue
 * seulement ouverte. Toujours présente, même vide.
 *
 * En tête, les informations non lues de Pour vous ; puis la lecture, moins les
 * actions déjà dans Pour vous. Aucune ligne ne compte dans le chiffre : une
 * non lue porte un point neutre (« Non lu »), une lue est grisée.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSidebarActivity } from '@/hooks/sidebar/useSidebarActivity';
import { useSidebarNotifications } from '@/hooks/sidebar/useSidebarNotifications';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { ACTIVITY_OPEN_STORAGE_KEY, notificationSub } from '@/lib/sidebarSignals';
import type { Notification } from '@/lib/notificationKinds';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';
import { NotificationIcon } from './ForYouSection';

function readOpen(): boolean {
  try {
    return localStorage.getItem(ACTIVITY_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    if (open) localStorage.setItem(ACTIVITY_OPEN_STORAGE_KEY, '1');
    else localStorage.removeItem(ACTIVITY_OPEN_STORAGE_KEY);
  } catch {
    // Stockage indisponible : l'état reste valable pour cette page.
  }
}

export function ActivitySection() {
  const [open, setOpenState] = useState(readOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeOpen(next);
  }, []);

  const activity = useSidebarActivity(open);
  const { forYou, markRead } = useSidebarNotifications();
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const now = new Date();

  const infos = forYou.data?.infos ?? [];
  const inForYou = new Set([...(forYou.data?.actions ?? []), ...infos].map((n) => n.id));
  const items: Notification[] = [...infos, ...(activity.data ?? []).filter((n) => !inForYou.has(n.id))];

  const select = (n: Notification) => {
    closeMobile();
    if (!n.read_at) void markRead([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <SidebarSection
      id="activity"
      title="Activité"
      collapsible
      open={open}
      onOpenChange={setOpen}
      state={activity.status}
      stale={activity.stale}
      onRetry={activity.retry}
      isEmpty={items.length === 0}
      hideWhenEmpty={false}
      emptyText="Aucune activité ces 30 derniers jours."
    >
      {items.map((n) => (
        <SidebarRow
          key={n.id}
          leading={<NotificationIcon notification={n} />}
          title={n.title}
          sub={notificationSub(n, now)}
          dotLabel={n.read_at ? null : 'Non lu'}
          muted={!!n.read_at}
          onSelect={() => select(n)}
        />
      ))}
    </SidebarSection>
  );
}
