/**
 * NotificationDropdown : cloche de l'en-tête avec le centre de notifications.
 *
 * Popover shadcn, liste des 50 dernières notifications (useNotifications),
 * badge de non-lus (les messages LinkedIn sont exclus du compteur : ils ont
 * déjà leur pastille « Messages » dans la sidebar). S'ouvre aussi sur
 * l'événement DOM 'konekt:open-notifications' (menu utilisateur).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

export const NotificationDropdown: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('konekt:open-notifications', handler);
    return () => window.removeEventListener('konekt:open-notifications', handler);
  }, []);

  const hasUnread = unreadCount > 0;

  const handleClick = (notif: Notification) => {
    if (!notif.read_at) void markAsRead(notif.id);
    setOpen(false);
    if (notif.link) navigate(notif.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} non lue(s)` : 'Notifications'}
          className="relative h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-3xs font-bold tabular-nums bg-destructive text-destructive-foreground rounded-full">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-1rem)] sm:w-80 p-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Notifications
          </span>
          {hasUnread && (
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckCheck className="w-3 h-3" />
              Tout marquer lu
            </button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="w-5 h-5 mb-2 opacity-30" />
              <p className="text-xs font-medium uppercase tracking-wider">Aucune notification</p>
            </div>
          ) : (
            notifications.map(notif => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleClick(notif)}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors',
                  !notif.read_at && 'bg-primary/5',
                )}
              >
                <div className="flex items-start gap-2">
                  {!notif.read_at && (
                    <span className="mt-1.5 w-2 h-2 bg-primary rounded-full shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        'text-xs truncate',
                        !notif.read_at ? 'font-bold text-foreground' : 'font-medium text-muted-foreground',
                      )}
                    >
                      {notif.title}
                    </p>
                    {notif.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                    )}
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(parseISO(notif.created_at), { addSuffix: true, locale: fr })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
