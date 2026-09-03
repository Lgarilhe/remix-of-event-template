import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CheckCheck } from 'lucide-react';
import iconBell3d from '@/assets/icon-bell-3d.webp';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export const NotificationDropdown: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = (notif: Notification) => {
    markAsRead(notif.id);
    if (notif.link) {
      navigate(notif.link);
    }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="true"
        className="relative overflow-hidden bg-background text-foreground h-11 w-11 flex items-center justify-center text-xs font-medium uppercase border border-border rounded-lg leading-none hover:bg-accent transition-colors"
      >
        <img src={iconBell3d} alt="" aria-hidden="true" className="w-5 h-5 object-contain" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 z-20 min-w-[14px] h-3.5 flex items-center justify-center px-0.5 text-3xs font-bold bg-destructive text-destructive-foreground rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed md:absolute left-2 right-2 md:left-auto md:right-0 top-[52px] md:top-[38px] md:w-80 bg-background border border-border shadow-lg rounded-xl z-[2100] max-h-[400px] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck className="w-3 h-3" />
                Tout lire
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <img src={iconBell3d} alt="" aria-hidden="true" className="w-6 h-6 mb-2 opacity-30" />
                <p className="text-xs font-medium uppercase tracking-wider">Aucune notification</p>
              </div>
            ) : (
              notifications.slice(0, 20).map(notif => (
                <button
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b border-border hover:bg-muted/50 transition-colors",
                    !notif.read_at && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!notif.read_at && (
                      <span className="mt-1.5 w-2 h-2 bg-primary rounded-full shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-xs truncate",
                        !notif.read_at ? "font-bold text-foreground" : "font-medium text-muted-foreground"
                      )}>
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
        </div>
      )}
    </div>
  );
};
