import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityEvent } from '@/hooks/useProfileActivity';
import { cn } from '@/lib/utils';
import {
  Eye,
  UserPlus,
  MessageSquare,
  Mail,
  Clock,
  GitBranch,
  CheckCircle2,
  XCircle,
  SkipForward,
  Hourglass,
  CalendarCheck,
  PhoneIncoming,
  PhoneOutgoing,
  Phone,
} from 'lucide-react';
import { formatMessageTime } from '@/hooks/useMessagesInboxHelpers';
import aircallLogo from '@/assets/aircall-logo.webp';

const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  profile_visit: { icon: Eye, label: 'Visite de profil', color: 'text-blue-500' },
  send_connection: { icon: UserPlus, label: 'Invitation envoyée', color: 'text-green-500' },
  send_message: { icon: MessageSquare, label: 'Message séquence', color: 'text-primary' },
  send_inmail: { icon: Mail, label: 'InMail séquence', color: 'text-purple-500' },
  send_smart_message: { icon: MessageSquare, label: 'Smart message', color: 'text-primary' },
  wait_connection: { icon: Hourglass, label: 'Attente connexion', color: 'text-amber-500' },
  check_connection: { icon: GitBranch, label: 'Vérification connexion', color: 'text-muted-foreground' },
  calendly_booking: { icon: CalendarCheck, label: '📅 RDV planifié', color: 'text-emerald-500' },
  aircall_call: { icon: Phone, label: 'Appel Aircall', color: 'text-green-600' },
};

const STATUS_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  sent: { icon: CheckCircle2, color: 'text-green-500' },
  failed: { icon: XCircle, color: 'text-destructive' },
  skipped: { icon: SkipForward, color: 'text-amber-500' },
  waiting_event: { icon: Clock, color: 'text-amber-500' },
};

export const ActivityEventCard: React.FC<{ event: ActivityEvent }> = ({ event }) => {
  const navigate = useNavigate();
  const config = ACTION_CONFIG[event.actionType] || { icon: GitBranch, label: event.actionType, color: 'text-muted-foreground' };
  const statusConfig = STATUS_ICONS[event.status];
  const Icon = config.icon;
  const StatusIcon = statusConfig?.icon;

  const isBooking = event.type === 'booking';
  const isAircall = event.type === 'aircall';

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  };

  return (
    <div className="flex justify-center my-2">
      <div
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 border border-dashed rounded-sm max-w-[85%]",
          isBooking
            ? "bg-emerald-500/10 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/20 transition-colors"
            : isAircall
              ? "bg-green-500/10 border-green-500/30"
              : "bg-muted/50 border-foreground/15"
        )}
        onClick={isBooking && event.qualificationSessionId ? () => navigate(`/qualification/${event.qualificationSessionId}`) : undefined}
      >
        {isAircall ? (
          <img src={aircallLogo} alt="Aircall" className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Icon className={cn("w-3.5 h-3.5 shrink-0", config.color)} />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-foreground truncate">
            {isAircall 
              ? `${event.callDirection === 'inbound' ? '📞 Appel entrant' : '📞 Appel sortant'}`
              : config.label
            }
          </span>
          {isAircall && event.callDuration != null && event.callDuration > 0 && (
            <span className="text-[9px] text-muted-foreground">
              ({formatDuration(event.callDuration)})
            </span>
          )}
          {isAircall && event.callUserName && (
            <span className="text-[9px] text-muted-foreground truncate">
              — {event.callUserName}
            </span>
          )}
          {isBooking && event.eventName && (
            <span className="text-[9px] text-muted-foreground truncate">
              — {event.eventName}
            </span>
          )}
          {event.status === 'skipped' && event.skipReason && (
            <span className="text-[9px] text-muted-foreground truncate">
              ({event.skipReason})
            </span>
          )}
          {event.status === 'failed' && event.errorMessage && (
            <span className="text-[9px] text-destructive truncate">
              ({event.errorMessage.slice(0, 40)})
            </span>
          )}
          {StatusIcon && !isBooking && !isAircall && (
            <StatusIcon className={cn("w-3 h-3 shrink-0", statusConfig.color)} />
          )}
        </div>
        <span className="text-[9px] text-muted-foreground whitespace-nowrap shrink-0">
          {formatMessageTime(event.timestamp)}
        </span>
      </div>
    </div>
  );
};
