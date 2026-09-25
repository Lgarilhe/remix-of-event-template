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
import { actionTypeLabel, formatSequenceError, formatSkipReason } from '@/lib/sequenceErrorMessages';
import aircallLogo from '@/assets/aircall-logo.webp';

// Types d'étape réels (sequence_steps.action_type) : libellé une fois l'action
// faite. Un échec, une étape sautée ou annulée s'affichent avec le nom de
// l'action et leur statut, jamais comme une action réussie.
const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  profile_visit: { icon: Eye, label: 'Profil visité', color: 'text-blue-500' },
  connection_request: { icon: UserPlus, label: 'Invitation envoyée', color: 'text-green-500' },
  message: { icon: MessageSquare, label: 'Message envoyé', color: 'text-primary' },
  smart_message: { icon: MessageSquare, label: 'Message IA envoyé', color: 'text-primary' },
  inmail: { icon: Mail, label: 'InMail envoyé', color: 'text-purple-500' },
  email: { icon: Mail, label: 'E-mail envoyé', color: 'text-primary' },
  whatsapp_message: { icon: MessageSquare, label: 'WhatsApp envoyé', color: 'text-green-600' },
  wait_connection: { icon: Hourglass, label: "Attente d'acceptation", color: 'text-amber-500' },
  wait_reply: { icon: Hourglass, label: 'Attente de réponse', color: 'text-amber-500' },
  check_connection: { icon: GitBranch, label: 'Vérification de la connexion', color: 'text-muted-foreground' },
  calendly_booking: { icon: CalendarCheck, label: '📅 RDV planifié', color: 'text-emerald-500' },
  aircall_call: { icon: Phone, label: 'Appel Aircall', color: 'text-green-600' },
};

/** Mention de statut d'une étape non réussie (« Échec », « Sauté », « Annulé »), null sinon. */
function statusMention(status: string): string | null {
  if (status === 'failed' || status === 'bounced') return 'Échec';
  if (status === 'skipped') return 'Sauté';
  if (status === 'cancelled') return 'Annulé';
  return null;
}

const STATUS_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  sent: { icon: CheckCircle2, color: 'text-green-500' },
  failed: { icon: XCircle, color: 'text-destructive' },
  skipped: { icon: SkipForward, color: 'text-amber-500' },
  waiting_event: { icon: Clock, color: 'text-amber-500' },
};

export const ActivityEventCard: React.FC<{ event: ActivityEvent }> = ({ event }) => {
  const navigate = useNavigate();
  const baseConfig = ACTION_CONFIG[event.actionType] || { icon: GitBranch, label: actionTypeLabel(event.actionType), color: 'text-muted-foreground' };
  const mention = event.type === 'sequence_step' ? statusMention(event.status) : null;
  // Étape non partie (échec, sautée, annulée) : nom de l'action
  // (« Invitation LinkedIn ») suivi du statut, pas « Invitation envoyée ».
  const config = mention ? { ...baseConfig, label: actionTypeLabel(event.actionType) } : baseConfig;
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
            ? "bg-success/10 border-success/30 cursor-pointer hover:bg-success/20 transition-colors"
            : isAircall
              ? "bg-whatsapp/10 border-whatsapp/30"
              : "bg-muted/50 border-border"
        )}
        onClick={isBooking && event.qualificationSessionId ? () => navigate(`/qualification/${event.qualificationSessionId}`) : undefined}
      >
        {isAircall ? (
          <img src={aircallLogo} alt="Aircall" className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Icon className={cn("w-3.5 h-3.5 shrink-0", config.color)} />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">
            {isAircall 
              ? `${event.callDirection === 'inbound' ? '📞 Appel entrant' : '📞 Appel sortant'}`
              : config.label
            }
          </span>
          {isAircall && event.callDuration != null && event.callDuration > 0 && (
            <span className="text-xs text-muted-foreground">
              ({formatDuration(event.callDuration)})
            </span>
          )}
          {isAircall && event.callUserName && (
            <span className="text-xs text-muted-foreground truncate">
              — {event.callUserName}
            </span>
          )}
          {isBooking && event.eventName && (
            <span className="text-xs text-muted-foreground truncate">
              — {event.eventName}
            </span>
          )}
          {mention && (
            <span className={cn('text-xs font-medium', mention === 'Échec' ? 'text-destructive' : 'text-muted-foreground')}>
              · {mention}
            </span>
          )}
          {event.status === 'skipped' && event.skipReason && (
            <span className="text-xs text-muted-foreground truncate">
              ({formatSkipReason(event.skipReason)})
            </span>
          )}
          {event.status === 'failed' && event.errorMessage && (
            <span className="text-xs text-destructive truncate">
              ({formatSequenceError(event.errorMessage)})
            </span>
          )}
          {StatusIcon && !isBooking && !isAircall && (
            <StatusIcon className={cn("w-3 h-3 shrink-0", statusConfig.color)} />
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {formatMessageTime(event.timestamp)}
        </span>
      </div>
    </div>
  );
};
