/**
 * CandidateSequencesPanel — vue des séquences pour UN candidat (cross-séquences).
 *
 * Affiche pour chaque inscription :
 *   - Statut (en cours, en pause avec sa raison, a répondu, terminée…)
 *   - Nombre d'actions envoyées + prochaine action prévue
 *   - Mission/job rattaché
 *   - Historique dépliable des étapes
 *   - Actions inline : Mettre en pause / Reprendre / Marquer comme répondu
 *
 * Source : useCandidateEnrollments (pause locale sans toucher aux étapes,
 * reprise et « a répondu » par les actions serveur de process-sequences).
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCandidateEnrollments, CandidateEnrollment } from '@/hooks/useCandidateEnrollments';
import {
  actionTypeLabel,
  executionDoneVerb,
  executionStatusLabel,
  formatSequenceError,
  formatSkipReason,
  isHiddenActionType,
  isSentExecutionStatus,
  shouldShowExecutionError,
} from '@/lib/sequenceErrorMessages';
import { enrollmentStatusLabel, pausedLabel, pauseReasonHint } from '@/lib/sequenceLabels';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  GitBranch, Clock, CheckCircle2, XCircle, Send, Mail, Eye,
  StopCircle, Play, MessageCircle, Loader2, AlertCircle, ChevronDown,
  ChevronRight, Briefcase, MoreHorizontal, CheckCheck, SkipForward,
  Pause, MousePointerClick, MailOpen, RefreshCw,
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

const STATUS_STYLE: Record<string, { color: string; icon: React.ReactNode }> = {
  active: { color: 'bg-success/10 text-success border-success/30', icon: <Play className="w-3 h-3" aria-hidden="true" /> },
  paused: { color: 'bg-muted text-muted-foreground border-border', icon: <Pause className="w-3 h-3" aria-hidden="true" /> },
  replied: { color: 'bg-info/10 text-info border-info/30', icon: <MessageCircle className="w-3 h-3" aria-hidden="true" /> },
  completed: { color: 'bg-foreground/8 text-foreground border-border', icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> },
  stopped: { color: 'bg-destructive/10 text-destructive border-destructive/30', icon: <StopCircle className="w-3 h-3" aria-hidden="true" /> },
  bounced: { color: 'bg-destructive/10 text-destructive border-destructive/30', icon: <XCircle className="w-3 h-3" aria-hidden="true" /> },
  cancelled: { color: 'bg-muted text-muted-foreground border-border', icon: <XCircle className="w-3 h-3" aria-hidden="true" /> },
};
const NEUTRAL_STATUS_STYLE = { color: 'bg-muted text-muted-foreground border-border', icon: <AlertCircle className="w-3 h-3" aria-hidden="true" /> };

/** Raisons de pause qu'un « Reprendre » individuel peut lever. */
const RESUMABLE_PAUSE_REASONS = new Set<string>(['manual', 'send_failed']);

const ACTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  message: <Send className="w-3 h-3" aria-hidden="true" />,
  inmail: <Mail className="w-3 h-3" aria-hidden="true" />,
  smart_message: <Send className="w-3 h-3" aria-hidden="true" />,
  email: <Mail className="w-3 h-3" aria-hidden="true" />,
  connection_request: <Send className="w-3 h-3" aria-hidden="true" />,
  whatsapp_message: <Send className="w-3 h-3" aria-hidden="true" />,
  profile_visit: <Eye className="w-3 h-3" aria-hidden="true" />,
  wait_connection: <Clock className="w-3 h-3" aria-hidden="true" />,
  wait_reply: <Clock className="w-3 h-3" aria-hidden="true" />,
  wait_profile_visit: <Clock className="w-3 h-3" aria-hidden="true" />,
  wait_for_event: <Clock className="w-3 h-3" aria-hidden="true" />,
  condition_branch: <GitBranch className="w-3 h-3" aria-hidden="true" />,
};

const EXEC_STATUS_STYLE: Record<string, { color: string; icon: React.ReactNode }> = {
  sent: { color: 'text-success', icon: <CheckCheck className="w-3 h-3" aria-hidden="true" /> },
  opened: { color: 'text-success', icon: <MailOpen className="w-3 h-3" aria-hidden="true" /> },
  clicked: { color: 'text-success', icon: <MousePointerClick className="w-3 h-3" aria-hidden="true" /> },
  replied: { color: 'text-info', icon: <MessageCircle className="w-3 h-3" aria-hidden="true" /> },
  scheduled: { color: 'text-info', icon: <Clock className="w-3 h-3" aria-hidden="true" /> },
  sending: { color: 'text-info', icon: <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> },
  failed: { color: 'text-destructive', icon: <XCircle className="w-3 h-3" aria-hidden="true" /> },
  bounced: { color: 'text-destructive', icon: <XCircle className="w-3 h-3" aria-hidden="true" /> },
  skipped: { color: 'text-muted-foreground', icon: <SkipForward className="w-3 h-3" aria-hidden="true" /> },
  cancelled: { color: 'text-muted-foreground', icon: <XCircle className="w-3 h-3" aria-hidden="true" /> },
  waiting_event: { color: 'text-warning', icon: <Clock className="w-3 h-3" aria-hidden="true" /> },
  quota_blocked: { color: 'text-warning', icon: <Pause className="w-3 h-3" aria-hidden="true" /> },
};
const NEUTRAL_EXEC_STYLE = { color: 'text-muted-foreground', icon: <AlertCircle className="w-3 h-3" aria-hidden="true" /> };

export const CandidateSequencesPanel: React.FC<Props> = ({ profileId, hideTitle, compact }) => {
  const { enrollments, loading, error, pendingId, stop, resume, markReplied, refetch } = useCandidateEnrollments({
    profileId,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmStop, setConfirmStop] = useState<CandidateEnrollment | null>(null);
  const [confirmResume, setConfirmResume] = useState<CandidateEnrollment | null>(null);
  const [confirmReply, setConfirmReply] = useState<CandidateEnrollment | null>(null);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expand = (id: string) => {
    setExpanded(prev => new Set(prev).add(id));
  };

  if (loading && enrollments.length === 0) {
    return (
      <div className="flex items-center justify-center py-8" role="status" aria-label="Chargement des séquences">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/5 border border-destructive/30 text-destructive text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{error}</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-2xs" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" />
          Réessayer
        </Button>
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <EmptyState
        icon={<GitBranch className="w-7 h-7" />}
        title="Aucune séquence"
        description="Ce candidat n'est inscrit dans aucune séquence."
        compact
      />
    );
  }

  const sequenceName = (e: CandidateEnrollment | null) => e?.sequence_name || 'cette séquence';

  return (
    <div className="space-y-3">
      {!hideTitle && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4" aria-hidden="true" />
            Séquences ({enrollments.length})
          </h3>
        </div>
      )}

      {enrollments.map(enrollment => (
        <EnrollmentCard
          key={enrollment.id}
          enrollment={enrollment}
          isExpanded={expanded.has(enrollment.id)}
          isBusy={pendingId === enrollment.id}
          onToggleExpand={() => toggleExpanded(enrollment.id)}
          onShowError={() => expand(enrollment.id)}
          onStop={() => setConfirmStop(enrollment)}
          onResume={() => setConfirmResume(enrollment)}
          onMarkReplied={() => setConfirmReply(enrollment)}
          compact={compact}
        />
      ))}

      {/* Confirmations */}
      <AlertDialog open={!!confirmStop} onOpenChange={open => !open && setConfirmStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mettre en pause « {sequenceName(confirmStop)} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Aucun message de cette séquence ne partira vers ce candidat tant que vous ne la reprenez pas.
              Les étapes prévues gardent leur date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const target = confirmStop;
                setConfirmStop(null);
                if (target) await stop(target.id);
              }}
            >
              Mettre en pause
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmResume} onOpenChange={open => !open && setConfirmResume(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reprendre « {sequenceName(confirmResume)} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les envois reprennent pour ce candidat. Chaque étape garde sa date prévue ; celles déjà passées
              partiront dans les prochaines minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const target = confirmResume;
                setConfirmResume(null);
                if (target) await resume(target.id);
              }}
            >
              Reprendre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmReply} onOpenChange={open => !open && setConfirmReply(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marquer comme ayant répondu ?</AlertDialogTitle>
            <AlertDialogDescription>
              La séquence « {sequenceName(confirmReply)} » s'arrête définitivement pour ce candidat, qui passe
              en « A répondu ». Utile si vous reprenez la conversation vous-même ou si la réponse est venue hors LinkedIn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const target = confirmReply;
                setConfirmReply(null);
                if (target) await markReplied(target.id);
              }}
            >
              Marquer comme ayant répondu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─── EnrollmentCard ──────────────────────────────────────────────────

function EnrollmentCard({
  enrollment, isExpanded, isBusy, onToggleExpand, onShowError, onStop, onResume, onMarkReplied, compact,
}: {
  enrollment: CandidateEnrollment;
  isExpanded: boolean;
  isBusy: boolean;
  onToggleExpand: () => void;
  onShowError: () => void;
  onStop: () => void;
  onResume: () => void;
  onMarkReplied: () => void;
  compact?: boolean;
}) {
  const statusStyle = STATUS_STYLE[enrollment.status] || NEUTRAL_STATUS_STYLE;
  const isActive = enrollment.status === 'active';
  const isPaused = enrollment.status === 'paused';
  const statusLabel = isPaused ? pausedLabel(enrollment.pause_reason) : enrollmentStatusLabel(enrollment.status);
  const pauseHint = isPaused ? pauseReasonHint(enrollment.pause_reason) : null;
  const pauseReason = enrollment.pause_reason;
  // Une pause sans raison est une pause posée avant l'introduction des raisons :
  // on la traite comme une pause manuelle.
  const canResume = isPaused && (!pauseReason || RESUMABLE_PAUSE_REASONS.has(pauseReason));

  const sentCount = enrollment.sent_count;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <GitBranch className="w-4 h-4 text-foreground" strokeWidth={2} aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-[13.5px] tracking-tight truncate">
              {enrollment.sequence_name || 'Séquence'}
            </h4>
            <Badge variant="outline" className={cn('text-3xs px-1.5 h-5', statusStyle.color)}>
              <span className="inline-flex items-center gap-1">
                {statusStyle.icon}
                {statusLabel}
              </span>
            </Badge>
          </div>

          {enrollment.job_title && (
            <p className="text-2xs text-muted-foreground truncate mt-0.5 inline-flex items-center gap-1">
              <Briefcase className="w-3 h-3 shrink-0" aria-hidden="true" />
              {enrollment.job_title}
            </p>
          )}

          {/* Actions envoyées : un « X / Y » ne peut pas être juste avec les
              attentes, les variantes et les branches non suivies. */}
          <p className="text-2xs tabular-nums text-muted-foreground font-medium mt-1.5">
            {sentCount === 0
              ? 'Aucune action envoyée'
              : `${sentCount} action${sentCount > 1 ? 's' : ''} envoyée${sentCount > 1 ? 's' : ''}`}
          </p>

          {pauseHint && (
            <p className="text-2xs text-muted-foreground mt-1">{pauseHint}</p>
          )}

          {/* Next action */}
          {isActive && enrollment.next_scheduled_at && (
            <p className="text-2xs text-info mt-1.5 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              Prochaine action :{' '}
              <span className="font-medium">
                {actionTypeLabel(enrollment.next_step_action_type)}
              </span>
              {' '}· {formatDistanceToNow(new Date(enrollment.next_scheduled_at), { addSuffix: true, locale: fr })}
            </p>
          )}
          {enrollment.replied_at && (
            <p className="text-2xs text-muted-foreground mt-1.5">
              A répondu {formatDistanceToNow(new Date(enrollment.replied_at), { addSuffix: true, locale: fr })}
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
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" /> : <Pause className="w-3 h-3 mr-1" aria-hidden="true" />}
              Mettre en pause
            </Button>
          )}
          {isPaused && pauseReason === 'account_disconnected' && (
            <Button asChild variant="outline" size="sm" className="h-7 px-2 text-2xs">
              <Link to="/settings/account/connections">Reconnecter le compte</Link>
            </Button>
          )}
          {isPaused && pauseReason === 'subscription_required' && (
            <Button asChild variant="outline" size="sm" className="h-7 px-2 text-2xs">
              <Link to="/pricing">Voir les offres</Link>
            </Button>
          )}
          {isPaused && pauseReason === 'send_failed' && (
            <Button variant="outline" size="sm" className="h-7 px-2 text-2xs" onClick={onShowError}>
              <AlertCircle className="w-3 h-3 mr-1" aria-hidden="true" />
              Voir l'erreur
            </Button>
          )}
          {canResume && pauseReason !== 'send_failed' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-2xs"
              onClick={onResume}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" /> : <Play className="w-3 h-3 mr-1" aria-hidden="true" />}
              Reprendre
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions de l'inscription" disabled={isBusy}>
                <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onToggleExpand}>
                {isExpanded ? <ChevronRight className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5 mr-2" aria-hidden="true" />}
                {isExpanded ? "Masquer l'historique" : "Voir l'historique"}
              </DropdownMenuItem>
              {canResume && pauseReason === 'send_failed' && (
                <DropdownMenuItem onClick={onResume}>
                  <Play className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                  Reprendre la séquence
                </DropdownMenuItem>
              )}
              {(isActive || isPaused) && (
                <DropdownMenuItem onClick={onMarkReplied}>
                  <MessageCircle className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                  Marquer comme ayant répondu
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Historique dépliable */}
      {isExpanded && enrollment.executions.length > 0 && (
        <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-2">
          <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground mb-2">
            Historique ({enrollment.executions.length} étape{enrollment.executions.length > 1 ? 's' : ''})
          </p>
          {enrollment.executions.map((exec, idx) => (
            <ExecutionRow key={exec.id} execution={exec} index={idx} compact={compact} />
          ))}
        </div>
      )}

      {/* Footer rapide pour expand/collapse si pas via menu */}
      {!isExpanded && enrollment.executions.length > 0 && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-full px-4 py-1.5 border-t border-border bg-muted/5 text-2xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors flex items-center justify-center gap-1"
        >
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
          Voir l'historique ({enrollment.executions.length} étape{enrollment.executions.length > 1 ? 's' : ''})
        </button>
      )}
    </div>
  );
}

// ─── ExecutionRow — une ligne de l'historique ─────────────────────────

function ExecutionRow({
  execution, index, compact,
}: {
  execution: CandidateEnrollment['executions'][0];
  index: number;
  compact?: boolean;
}) {
  const statusStyle = EXEC_STATUS_STYLE[execution.status] || NEUTRAL_EXEC_STYLE;
  const actionType = execution.step?.action_type || 'message';
  const actionIcon = ACTION_TYPE_ICONS[actionType] || <Send className="w-3 h-3" aria-hidden="true" />;
  const isWaitStep = isHiddenActionType(actionType);
  const isSent = isSentExecutionStatus(execution.status);

  // Le moteur renseigne executed_at aussi sur les échecs, les sauts et
  // certaines annulations : le verbe suit le statut, jamais « Envoyé » d'office.
  const doneVerb = executionDoneVerb(execution.status);
  const dateLabel = execution.executed_at && doneVerb
    ? `${isWaitStep && isSent ? 'Franchie' : doneVerb} ${formatDistanceToNow(new Date(execution.executed_at), { addSuffix: true, locale: fr })}`
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
            {actionTypeLabel(actionType)}
          </span>
          <span className={cn('inline-flex items-center gap-1 font-semibold', statusStyle.color)}>
            {statusStyle.icon}
            {isWaitStep && isSent ? 'Franchie' : executionStatusLabel(execution.status)}
          </span>
        </div>
        <p className="text-2xs text-muted-foreground mt-0.5">{dateLabel}</p>
        {!compact && !isWaitStep && execution.final_subject && isSent && (
          <p className="text-2xs text-foreground/70 mt-1 italic truncate">
            <span className="font-semibold not-italic">Objet :</span> {execution.final_subject}
          </p>
        )}
        {/* Texte envoyé : jamais pour une attente, dont final_message porte un
            libellé interne du moteur. */}
        {!compact && !isWaitStep && execution.final_message && isSent && (
          <p
            className="text-2xs text-foreground/70 mt-0.5 line-clamp-2"
            title={execution.final_message}
          >
            {execution.final_message.length > 200
              ? execution.final_message.slice(0, 200) + '…'
              : execution.final_message}
          </p>
        )}
        {execution.error_message && shouldShowExecutionError(execution.status) && (
          <p className="text-2xs text-destructive mt-0.5 inline-flex items-start gap-1">
            <AlertCircle className="w-3 h-3 shrink-0 mt-px" aria-hidden="true" />
            {formatSequenceError(execution.error_message)}
          </p>
        )}
        {execution.skip_reason && !isSent && (
          <p className="text-2xs text-muted-foreground mt-0.5 italic">
            Raison : {formatSkipReason(execution.skip_reason)}
          </p>
        )}
      </div>
    </div>
  );
}
