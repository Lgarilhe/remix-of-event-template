/**
 * CandidateSequencesPanel — vue des séquences pour UN candidat (cross-séquences).
 *
 * Affiche pour chaque inscription :
 *   - Statut (active/paused/replied/completed)
 *   - Étape courante (ex: 3/7) + prochaine action prévue
 *   - Mission/job rattaché
 *   - Timeline cliquable des executions (sent/scheduled/skipped)
 *   - Actions inline : Arrêter / Reprendre / Marquer répondu
 *
 * Source : useCandidateEnrollments hook (qui réplique la logique du
 * SequenceEnrollmentsPanel — single source of truth pour stop/resume).
 */

import React, { useState } from 'react';
import { useCandidateEnrollments, CandidateEnrollment } from '@/hooks/useCandidateEnrollments';
import { formatSequenceError } from '@/lib/sequenceErrorMessages';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  GitBranch, Clock, CheckCircle2, XCircle, Send, Mail, Eye,
  StopCircle, Play, MessageCircle, Loader2, AlertCircle, ChevronDown,
  ChevronRight, Briefcase, MoreHorizontal, CheckCheck, SkipForward,
  Pause,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

interface Props {
  /** profile_id du candidat. */
  profileId: string;
  /** Si true, n'affiche pas le titre (utile en tab où il y a déjà un header). */
  hideTitle?: boolean;
  /** Compact mode : moins d'infos, plus dense. */
  compact?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active: { label: 'En cours', color: 'bg-success/10 text-success border-success/30', icon: <Play className="w-3 h-3" /> },
  paused: { label: 'En pause', color: 'bg-muted text-muted-foreground border-border', icon: <Pause className="w-3 h-3" /> },
  replied: { label: 'Répondu', color: 'bg-info/10 text-info border-info/30', icon: <MessageCircle className="w-3 h-3" /> },
  completed: { label: 'Terminé', color: 'bg-foreground/8 text-foreground border-border', icon: <CheckCircle2 className="w-3 h-3" /> },
  stopped: { label: 'Stoppé', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: <StopCircle className="w-3 h-3" /> },
};

// Libellé d'une inscription en pause selon sequence_enrollments.pause_reason.
const PAUSE_REASON_LABELS: Record<string, string> = {
  account_disconnected: 'En pause (compte déconnecté)',
  quota_reached: 'En pause (limite atteinte)',
  subscription_required: 'En pause (abonnement requis)',
};
const pausedLabel = (reason: string | null | undefined): string =>
  PAUSE_REASON_LABELS[reason || ''] || 'En pause';

const ACTION_TYPE_LABELS: Record<string, string> = {
  message: 'Message LinkedIn',
  inmail: 'InMail',
  smart_message: 'Smart Message',
  email: 'Email',
  connection_request: 'Invitation LinkedIn',
  whatsapp_message: 'WhatsApp',
  profile_visit: 'Visite profil',
  wait_connection: 'Attente acceptation',
  wait_reply: 'Attente réponse',
};

const ACTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  message: <Send className="w-3 h-3" />,
  inmail: <Mail className="w-3 h-3" />,
  smart_message: <Send className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
  connection_request: <Send className="w-3 h-3" />,
  whatsapp_message: <Send className="w-3 h-3" />,
  profile_visit: <Eye className="w-3 h-3" />,
  wait_connection: <Clock className="w-3 h-3" />,
  wait_reply: <Clock className="w-3 h-3" />,
};

const EXEC_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  sent: { label: 'Envoyé', color: 'text-success', icon: <CheckCheck className="w-3 h-3" /> },
  scheduled: { label: 'Programmé', color: 'text-info', icon: <Clock className="w-3 h-3" /> },
  sending: { label: "En cours d'envoi", color: 'text-info', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  failed: { label: 'Échoué', color: 'text-destructive', icon: <XCircle className="w-3 h-3" /> },
  skipped: { label: 'Skippé', color: 'text-muted-foreground', icon: <SkipForward className="w-3 h-3" /> },
  cancelled: { label: 'Annulé', color: 'text-muted-foreground', icon: <XCircle className="w-3 h-3" /> },
  waiting_event: { label: 'En attente', color: 'text-warning', icon: <Clock className="w-3 h-3" /> },
  quota_blocked: { label: 'Quota atteint', color: 'text-warning', icon: <Pause className="w-3 h-3" /> },
};

export const CandidateSequencesPanel: React.FC<Props> = ({ profileId, hideTitle, compact }) => {
  const { enrollments, loading, error, stop, resume, markReplied, refetch } = useCandidateEnrollments({
    profileId,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [confirmReply, setConfirmReply] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/5 border border-destructive/30 text-destructive text-sm">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <EmptyState
        icon={<GitBranch className="w-7 h-7" />}
        title="Aucune séquence en cours"
        description="Ce candidat n'est inscrit dans aucune séquence outreach."
        compact
      />
    );
  }

  return (
    <div className="space-y-3">
      {!hideTitle && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Séquences ({enrollments.length})
          </h3>
        </div>
      )}

      {enrollments.map(enrollment => (
        <EnrollmentCard
          key={enrollment.id}
          enrollment={enrollment}
          isExpanded={expanded.has(enrollment.id)}
          onToggleExpand={() => toggleExpanded(enrollment.id)}
          onStop={() => setConfirmStop(enrollment.id)}
          onResume={() => resume(enrollment.id)}
          onMarkReplied={() => setConfirmReply(enrollment.id)}
          compact={compact}
        />
      ))}

      {/* Confirmations */}
      <AlertDialog open={!!confirmStop} onOpenChange={open => !open && setConfirmStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arrêter cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les actions programmées (messages, relances, InMails) seront annulées. Tu pourras reprendre la séquence plus tard depuis le step courant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmStop) await stop(confirmStop);
                setConfirmStop(null);
              }}
            >
              Arrêter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmReply} onOpenChange={open => !open && setConfirmReply(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marquer comme répondu ?</AlertDialogTitle>
            <AlertDialogDescription>
              La séquence sera arrêtée et marquée comme "Répondu". Utile si tu prends la conversation à la main ou si la réponse est venue hors LinkedIn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmReply) await markReplied(confirmReply);
                setConfirmReply(null);
              }}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─── EnrollmentCard ──────────────────────────────────────────────────

function EnrollmentCard({
  enrollment, isExpanded, onToggleExpand, onStop, onResume, onMarkReplied, compact,
}: {
  enrollment: CandidateEnrollment;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onStop: () => void;
  onResume: () => void;
  onMarkReplied: () => void;
  compact?: boolean;
}) {
  const statusCfg = STATUS_CONFIG[enrollment.status] || STATUS_CONFIG.completed;
  const isActive = enrollment.status === 'active';
  const isPaused = enrollment.status === 'paused';
  const statusLabel = isPaused ? pausedLabel(enrollment.pause_reason) : statusCfg.label;

  const sentCount = enrollment.executions.filter(e => e.status === 'sent').length;
  const totalSteps = enrollment.total_steps || enrollment.executions.length;
  const progress = totalSteps > 0 ? Math.round((sentCount / totalSteps) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <GitBranch className="w-4 h-4 text-foreground" strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-[13.5px] tracking-tight truncate">
              {enrollment.sequence_name || 'Séquence'}
            </h4>
            <Badge variant="outline" className={cn('text-3xs px-1.5 h-5', statusCfg.color)}>
              <span className="inline-flex items-center gap-1">
                {statusCfg.icon}
                {statusLabel}
              </span>
            </Badge>
          </div>

          {enrollment.job_title && (
            <p className="text-2xs text-muted-foreground truncate mt-0.5 inline-flex items-center gap-1">
              <Briefcase className="w-3 h-3 shrink-0" />
              {enrollment.job_title}
            </p>
          )}

          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-500',
                  isActive ? 'bg-success' : isPaused ? 'bg-muted-foreground/40' : 'bg-foreground/40'
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-2xs tabular-nums text-muted-foreground font-medium shrink-0">
              {sentCount}/{totalSteps}
            </span>
          </div>

          {/* Next action */}
          {isActive && enrollment.next_scheduled_at && (
            <p className="text-2xs text-info mt-1.5 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Prochaine action :{' '}
              <span className="font-medium">
                {ACTION_TYPE_LABELS[enrollment.next_step_action_type || ''] || enrollment.next_step_action_type}
              </span>
              {' '}— {formatDistanceToNow(new Date(enrollment.next_scheduled_at), { addSuffix: true, locale: fr })}
            </p>
          )}
          {enrollment.replied_at && (
            <p className="text-2xs text-muted-foreground mt-1.5">
              Répondu {formatDistanceToNow(new Date(enrollment.replied_at), { addSuffix: true, locale: fr })}
            </p>
          )}
        </div>

        {/* Actions menu */}
        <div className="flex items-center gap-1 shrink-0">
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-2xs"
              onClick={onStop}
            >
              <StopCircle className="w-3 h-3 mr-1" />
              Arrêter
            </Button>
          )}
          {isPaused && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-2xs"
              onClick={onResume}
            >
              <Play className="w-3 h-3 mr-1" />
              Reprendre
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={onToggleExpand}>
                {isExpanded ? <ChevronRight className="w-3.5 h-3.5 mr-2" /> : <ChevronDown className="w-3.5 h-3.5 mr-2" />}
                {isExpanded ? 'Réduire' : 'Voir la timeline'}
              </DropdownMenuItem>
              {isActive && (
                <DropdownMenuItem onClick={onMarkReplied}>
                  <MessageCircle className="w-3.5 h-3.5 mr-2" />
                  Marquer comme répondu
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Timeline expandable */}
      {isExpanded && enrollment.executions.length > 0 && (
        <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-2">
          <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground mb-2">
            Timeline ({enrollment.executions.length} actions)
          </p>
          {enrollment.executions.map((exec, idx) => (
            <ExecutionRow key={exec.id} execution={exec} index={idx} compact={compact} />
          ))}
        </div>
      )}

      {/* Footer rapide pour expand/collapse si pas via menu */}
      {!isExpanded && enrollment.executions.length > 0 && (
        <button
          onClick={onToggleExpand}
          className="w-full px-4 py-1.5 border-t border-border bg-muted/5 text-2xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors flex items-center justify-center gap-1"
        >
          <ChevronDown className="w-3 h-3" />
          Voir la timeline ({enrollment.executions.length} étapes)
        </button>
      )}
    </div>
  );
}

// ─── ExecutionRow — une ligne de la timeline ─────────────────────────

function ExecutionRow({
  execution, index, compact,
}: {
  execution: CandidateEnrollment['executions'][0];
  index: number;
  compact?: boolean;
}) {
  const statusCfg = EXEC_STATUS_CONFIG[execution.status] || EXEC_STATUS_CONFIG.cancelled;
  const actionType = execution.step?.action_type || 'message';
  const actionIcon = ACTION_TYPE_ICONS[actionType] || <Send className="w-3 h-3" />;
  const actionLabel = ACTION_TYPE_LABELS[actionType] || actionType;

  const dateLabel = execution.executed_at
    ? `Envoyé ${formatDistanceToNow(new Date(execution.executed_at), { addSuffix: true, locale: fr })}`
    : execution.scheduled_at && execution.status === 'scheduled'
    ? `Prévu ${formatDistanceToNow(new Date(execution.scheduled_at), { addSuffix: true, locale: fr })}`
    : execution.scheduled_at
    ? format(new Date(execution.scheduled_at), 'd MMM HH:mm', { locale: fr })
    : '—';

  return (
    <div className="flex items-start gap-2.5 text-2xs">
      {/* Step number circle */}
      <div className="h-5 w-5 rounded-full bg-background border border-border grid place-items-center text-3xs font-bold text-muted-foreground shrink-0 mt-0.5 tabular-nums">
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-foreground/80 font-medium">
            {actionIcon}
            {actionLabel}
          </span>
          <span className={cn('inline-flex items-center gap-1 font-semibold', statusCfg.color)}>
            {statusCfg.icon}
            {statusCfg.label}
          </span>
        </div>
        <p className="text-2xs text-muted-foreground mt-0.5">{dateLabel}</p>
        {!compact && execution.final_subject && (
          <p className="text-2xs text-foreground/70 mt-1 italic truncate">
            <span className="font-semibold not-italic">Objet :</span> {execution.final_subject}
          </p>
        )}
        {!compact && execution.final_message && execution.status === 'sent' && (
          <p
            className="text-2xs text-foreground/70 mt-0.5 line-clamp-2"
            title={execution.final_message}
          >
            {execution.final_message.length > 200
              ? execution.final_message.slice(0, 200) + '…'
              : execution.final_message}
          </p>
        )}
        {execution.error_message && (
          <p className="text-2xs text-destructive mt-0.5">
            ⚠ {formatSequenceError(execution.error_message)}
          </p>
        )}
        {execution.skip_reason && execution.status !== 'sent' && (
          <p className="text-2xs text-muted-foreground mt-0.5 italic">
            Raison : {execution.skip_reason}
          </p>
        )}
      </div>
    </div>
  );
}
