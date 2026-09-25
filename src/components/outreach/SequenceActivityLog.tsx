import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  actionTypeLabel,
  executionDoneVerb,
  executionStatusLabel,
  formatSequenceError,
  formatSkipReason,
  HIDDEN_ACTION_TYPES,
  isSentExecutionStatus,
  missionEnrollmentJobIds,
  shouldShowExecutionError,
} from '@/lib/sequenceErrorMessages';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  SkipForward,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Send,
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  RefreshCw,
  Calendar,
  Pencil,
  Ban,
  Pause,
  Loader2,
  MailOpen,
  MousePointerClick,
} from 'lucide-react';
import { format, isAfter, isBefore, startOfDay, endOfDay, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { EditScheduledMessageModal } from './activity-log/EditScheduledMessageModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Nombre de lignes lues : au-delà, les compteurs portent sur les plus récentes. */
const JOURNAL_LIMIT = 500;

/** Provenance du texte affiché pour une étape. */
type PreviewSource = 'final' | 'edited' | 'override' | 'template' | 'ai' | 'template_unverified';

interface MessagePreview {
  message: string | null;
  subject: string | null;
  source: PreviewSource;
}

interface StepExecution {
  id: string;
  enrollment_id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_subject: string | null;
  final_message: string | null;
  error_message: string | null;
  skip_reason: string | null;
  enrollment?: {
    profile_name: string | null;
    profile_headline: string | null;
    profile_url: string | null;
    sequence?: {
      name: string;
    };
  };
  step?: {
    action_type: string;
    message_template: string | null;
    subject_template: string | null;
  };
  preview: MessagePreview;
}

interface SequenceActivityLogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Mission d'où le Journal est ouvert : ses inscriptions sont affichées par défaut. */
  projectId?: string | null;
}

type MessageOverride = { subject?: string; message?: string };

/** Types d'étape dont le texte est rédigé par l'IA au moment de l'envoi. */
const AI_ACTION_TYPES = new Set(['smart_message']);

const actionTypeStyle: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  profile_visit: { icon: <Eye className="w-4 h-4" aria-hidden="true" />, color: 'text-foreground', bgColor: 'bg-muted' },
  connection_request: { icon: <UserPlus className="w-4 h-4" aria-hidden="true" />, color: 'text-emerald-900', bgColor: 'bg-emerald-400' },
  message: { icon: <Send className="w-4 h-4" aria-hidden="true" />, color: 'text-blue-900', bgColor: 'bg-blue-400' },
  inmail: { icon: <Mail className="w-4 h-4" aria-hidden="true" />, color: 'text-purple-900', bgColor: 'bg-purple-400' },
  smart_message: { icon: <MessageSquare className="w-4 h-4" aria-hidden="true" />, color: 'text-indigo-900', bgColor: 'bg-indigo-400' },
  email: { icon: <Mail className="w-4 h-4" aria-hidden="true" />, color: 'text-sky-900', bgColor: 'bg-sky-400' },
  whatsapp_message: { icon: <MessageSquare className="w-4 h-4" aria-hidden="true" />, color: 'text-green-900', bgColor: 'bg-green-400' },
};
const defaultActionStyle = { icon: <Activity className="w-4 h-4" aria-hidden="true" />, color: 'text-muted-foreground', bgColor: 'bg-muted' };

const statusStyle: Record<string, { icon: React.ReactNode; className: string }> = {
  scheduled: { icon: <Clock className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-info text-info-foreground border-info' },
  sending: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />, className: 'bg-info text-info-foreground border-info' },
  waiting_event: { icon: <Clock className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' },
  quota_blocked: { icon: <Pause className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-warning/15 text-warning-foreground border-warning' },
  sent: { icon: <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-success text-success-foreground border-success' },
  opened: { icon: <MailOpen className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-success text-success-foreground border-success' },
  clicked: { icon: <MousePointerClick className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-success text-success-foreground border-success' },
  replied: { icon: <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-purple-500 text-white border-purple-600' },
  skipped: { icon: <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' },
  failed: { icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-destructive text-destructive-foreground border-destructive' },
  bounced: { icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-destructive text-destructive-foreground border-destructive' },
  cancelled: { icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' },
};
const unknownStatusStyle = { icon: <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' };

type FilterStatus = 'all' | 'scheduled' | 'sent' | 'failed' | 'skipped';
type FilterPeriod = 'all' | 'today' | 'week' | 'upcoming';
type Scope = 'mission' | 'all';

const STATUS_FILTER_MATCH: Record<Exclude<FilterStatus, 'all'>, (status: string) => boolean> = {
  scheduled: (s) => ['scheduled', 'quota_blocked', 'waiting_event', 'sending'].includes(s),
  sent: (s) => isSentExecutionStatus(s),
  failed: (s) => s === 'failed' || s === 'bounced',
  skipped: (s) => s === 'skipped' || s === 'cancelled',
};

/** Étapes encore modifiables ou retirables depuis le Journal (jamais pendant l'envoi). */
const SKIPPABLE_STATUSES = new Set(['scheduled', 'quota_blocked']);

const PREVIEW_TITLES: Record<PreviewSource, string> = {
  final: 'Message',
  edited: 'Message modifié',
  override: "Message validé à l'inscription",
  template: "Modèle, personnalisé au moment de l'envoi",
  ai: "Message rédigé par l'IA au moment de l'envoi",
  template_unverified: "Modèle de l'étape (aperçu personnalisé indisponible)",
};

/**
 * Ce qui partira vraiment : le texte figé sur l'exécution (envoyé ou modifié à
 * la main), sinon l'aperçu validé à l'inscription, sinon le modèle, présenté
 * comme tel.
 */
function computePreview(
  exec: { status: string; final_message: string | null; final_subject: string | null; step_id: string },
  step: StepExecution['step'],
  overrides: Map<string, Record<string, MessageOverride>> | null,
  enrollmentId: string,
): MessagePreview {
  const override = overrides?.get(enrollmentId)?.[exec.step_id] ?? null;
  const overrideMessage = override?.message?.trim() || null;
  const overrideSubject = override?.subject?.trim() || null;
  const subject = exec.final_subject?.trim() || overrideSubject || step?.subject_template || null;

  if (exec.final_message?.trim()) {
    return { message: exec.final_message, subject, source: exec.status === 'scheduled' ? 'edited' : 'final' };
  }
  if (overrideMessage) return { message: overrideMessage, subject, source: 'override' };
  if (step?.message_template?.trim()) {
    return { message: step.message_template, subject, source: overrides ? 'template' : 'template_unverified' };
  }
  if (step && AI_ACTION_TYPES.has(step.action_type)) return { message: null, subject, source: 'ai' };
  return { message: null, subject, source: 'template' };
}

export const SequenceActivityLog: React.FC<SequenceActivityLogProps> = ({
  isOpen,
  onClose,
  projectId,
}) => {
  const [executions, setExecutions] = useState<StepExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [periodFilter, setPeriodFilter] = useState<FilterPeriod>('all');
  const [scope, setScope] = useState<Scope>('mission');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingExecution, setEditingExecution] = useState<StepExecution | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const [skipConfirm, setSkipConfirm] = useState<{ id: string; candidateName: string } | null>(null);

  const missionScoped = !!projectId && scope === 'mission';

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);

      // Dans une mission : seulement ses inscriptions (job_id de la mission),
      // y compris celles faites avec un modèle partagé entre missions.
      let jobIds: string[] | null = null;
      if (projectId && scope === 'mission') {
        const { data: project, error: projectError } = await supabase
          .from('sourcing_projects')
          .select('job_id')
          .eq('id', projectId)
          .maybeSingle();
        if (projectError) throw projectError;
        jobIds = missionEnrollmentJobIds(projectId, project?.job_id);
      }

      // Les étapes internes (attentes, conditions) sont écartées AVANT la
      // limite : les 500 lignes lues sont toutes des actions visibles.
      let query = supabase
        .from('sequence_step_executions')
        .select(
          'id, enrollment_id, step_id, step_order, status, scheduled_at, executed_at, final_subject, final_message, error_message, skip_reason, sequence_steps!inner(action_type, message_template, subject_template), sequence_enrollments!inner(profile_name, profile_headline, profile_url, job_id, outreach_sequences(name))',
        )
        .not('sequence_steps.action_type', 'in', `(${HIDDEN_ACTION_TYPES.join(',')})`)
        .order('scheduled_at', { ascending: false })
        .limit(JOURNAL_LIMIT);
      if (jobIds) query = query.in('sequence_enrollments.job_id', jobIds);

      const { data: execData, error: execError } = await query;
      if (execError) throw execError;

      const rows = execData || [];

      // Aperçus validés à l'inscription, pour les étapes encore à venir dont
      // le texte n'est pas figé. Lecture par paquets pour garder l'URL courte.
      const needOverrides = [...new Set(
        rows.filter(r => !r.final_message?.trim() && !isSentExecutionStatus(r.status)).map(r => r.enrollment_id),
      )];
      let overrides: Map<string, Record<string, MessageOverride>> | null = new Map();
      for (let i = 0; i < needOverrides.length && overrides; i += 100) {
        const chunk = needOverrides.slice(i, i + 100);
        const { data: trackingRows, error: trackingError } = await supabase
          .from('sequence_enrollments')
          // Seul le chemin JSON utile est lu (tracking_data peut être lourd).
          .select<string, { id: string; message_overrides: unknown }>('id, message_overrides:tracking_data->message_overrides')
          .in('id', chunk);
        if (trackingError) {
          console.warn('[SequenceActivityLog] aperçus indisponibles:', trackingError);
          overrides = null;
          break;
        }
        for (const t of trackingRows || []) {
          const value = t.message_overrides;
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            overrides.set(t.id, value as Record<string, MessageOverride>);
          }
        }
      }

      const enrichedExecutions: StepExecution[] = rows.map(exec => {
        const stepRel = exec.sequence_steps;
        const enrollmentRel = exec.sequence_enrollments;
        const step = stepRel
          ? { action_type: stepRel.action_type, message_template: stepRel.message_template, subject_template: stepRel.subject_template }
          : undefined;
        const sequenceRel = enrollmentRel?.outreach_sequences;
        return {
          id: exec.id,
          enrollment_id: exec.enrollment_id,
          step_id: exec.step_id,
          step_order: exec.step_order,
          status: exec.status,
          scheduled_at: exec.scheduled_at,
          executed_at: exec.executed_at,
          final_subject: exec.final_subject,
          final_message: exec.final_message,
          error_message: exec.error_message,
          skip_reason: exec.skip_reason,
          enrollment: enrollmentRel
            ? {
                profile_name: enrollmentRel.profile_name,
                profile_headline: enrollmentRel.profile_headline,
                profile_url: enrollmentRel.profile_url,
                sequence: sequenceRel ? { name: sequenceRel.name } : undefined,
              }
            : undefined,
          step,
          preview: computePreview(exec, step, overrides, exec.enrollment_id),
        };
      });

      setExecutions(enrichedExecutions);
    } catch (err) {
      console.error('Error fetching executions:', err);
      setLoadError(true);
      toast.error("Impossible de charger le Journal d'activité");
    } finally {
      setLoading(false);
    }
  }, [projectId, scope]);

  useEffect(() => {
    if (isOpen) {
      fetchExecutions();
    }
  }, [isOpen, fetchExecutions]);

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // « Ne pas envoyer cette étape » : action serveur skip_execution, la même que
  // « Sauter » dans le suivi des inscrits. Elle marque l'étape sautée, avance la
  // séquence et planifie la suivante. Avant, le navigateur passait l'exécution
  // en 'cancelled' : l'inscription restait active sans étape et le moteur
  // replanifiait la même étape une heure plus tard.
  const handleSkipExecution = async (executionId: string, candidateName: string) => {
    setSkippingId(executionId);
    try {
      const { data, error } = await invokeEdgeFunction<{ next_step_order?: number }>('process-sequences', {
        action: 'skip_execution',
        execution_id: executionId,
      });

      if (error?.status === 409) {
        toast.error("Cette étape est déjà en cours d'envoi ou déjà traitée.");
        return;
      }
      if (error || !data?.success) {
        toast.error("L'étape n'a pas pu être retirée. Réessayez.", {
          description: error?.message || data?.error,
        });
        return;
      }

      toast.success(`${candidateName} ne recevra pas cette étape`, {
        description: "La séquence passe à l'étape suivante.",
      });
    } catch (err) {
      console.error('Error skipping execution:', err);
      toast.error("L'étape n'a pas pu être retirée. Réessayez.");
    } finally {
      setSkippingId(null);
      fetchExecutions();
    }
  };

  // Filter and group executions
  const filteredExecutions = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekAgo = subDays(now, 7);

    return executions.filter(exec => {
      // Status filter
      if (statusFilter !== 'all' && !STATUS_FILTER_MATCH[statusFilter](exec.status)) {
        return false;
      }

      // Period filter
      const scheduledAt = new Date(exec.scheduled_at);
      if (periodFilter === 'today') {
        if (isBefore(scheduledAt, todayStart) || isAfter(scheduledAt, todayEnd)) {
          return false;
        }
      } else if (periodFilter === 'week') {
        if (isBefore(scheduledAt, weekAgo)) {
          return false;
        }
      } else if (periodFilter === 'upcoming') {
        if (isBefore(scheduledAt, now)) {
          return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const profileName = exec.enrollment?.profile_name?.toLowerCase() || '';
        const sequenceName = exec.enrollment?.sequence?.name?.toLowerCase() || '';
        const actionType = actionTypeLabel(exec.step?.action_type).toLowerCase();

        if (!profileName.includes(query) && !sequenceName.includes(query) && !actionType.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [executions, statusFilter, periodFilter, searchQuery]);

  // Group by date
  const groupedExecutions = useMemo(() => {
    const groups: Record<string, StepExecution[]> = {};

    filteredExecutions.forEach(exec => {
      const date = format(new Date(exec.scheduled_at), 'yyyy-MM-dd');
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(exec);
    });

    // Sort groups by date (most recent first for past, upcoming first for future)
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredExecutions]);

  // Stats — actions visibles seulement (les étapes internes sont exclues par la requête)
  const stats = useMemo(() => {
    const now = new Date();
    return {
      scheduled: executions.filter(e => (e.status === 'scheduled' || e.status === 'quota_blocked') && isAfter(new Date(e.scheduled_at), now)).length,
      pending: executions.filter(e => e.status === 'scheduled' && isBefore(new Date(e.scheduled_at), now)).length,
      sent: executions.filter(e => isSentExecutionStatus(e.status)).length,
      failed: executions.filter(e => e.status === 'failed').length,
    };
  }, [executions]);

  const isTruncated = executions.length >= JOURNAL_LIMIT;

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = startOfDay(new Date());
    const dateStart = startOfDay(date);

    if (dateStart.getTime() === today.getTime()) {
      return "Aujourd'hui";
    }

    const yesterday = subDays(today, 1);
    if (dateStart.getTime() === yesterday.getTime()) {
      return "Hier";
    }

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateStart.getTime() === tomorrow.getTime()) {
      return "Demain";
    }

    return format(date, 'EEEE d MMMM', { locale: fr });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:w-[600px] sm:max-w-[600px] bg-background p-0 rounded-lg border-l border-border">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" aria-hidden="true" />
            Journal d'activité
          </SheetTitle>
        </SheetHeader>

        <div className="p-4 space-y-4">
          {/* Stats */}
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-0">
              <div className="p-2.5 sm:p-3 border border-border text-center">
                <div className="text-lg sm:text-xl font-bold text-info-foreground">{loadError ? '—' : stats.scheduled}</div>
                <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">À venir</div>
              </div>
              <div className="p-2.5 sm:p-3 border border-border border-l-0 text-center bg-amber-400/10">
                <div className="text-lg sm:text-xl font-bold text-destructive">{loadError ? '—' : stats.pending}</div>
                <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">En retard</div>
              </div>
              <div className="p-2.5 sm:p-3 border border-border border-l-0 text-center">
                <div className="text-lg sm:text-xl font-bold text-success-foreground">{loadError ? '—' : stats.sent}</div>
                <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">Envoyés</div>
              </div>
              <div className="p-2.5 sm:p-3 border border-border border-l-0 text-center">
                <div className="text-lg sm:text-xl font-bold text-destructive">{loadError ? '—' : stats.failed}</div>
                <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">Échoués</div>
              </div>
            </div>
            {isTruncated && !loadError && (
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Sur les {JOURNAL_LIMIT} dernières actions.
              </p>
            )}
          </div>

          {/* Filters */}
          <div className="space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Candidat, séquence ou action…"
                aria-label="Rechercher dans le Journal"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background border-border rounded-lg"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {projectId && (
                <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                  <SelectTrigger className="flex-1 sm:w-[160px] border-border rounded-lg" aria-label="Périmètre">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mission">Cette mission</SelectItem>
                    <SelectItem value="all">Toutes les missions</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
                <SelectTrigger className="flex-1 sm:w-[140px] border-border rounded-lg" aria-label="Statut">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="scheduled">Programmés</SelectItem>
                  <SelectItem value="sent">Envoyés</SelectItem>
                  <SelectItem value="failed">Échoués</SelectItem>
                  <SelectItem value="skipped">Ignorés ou annulés</SelectItem>
                </SelectContent>
              </Select>
              <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as FilterPeriod)}>
                <SelectTrigger className="flex-1 sm:w-[130px] border-border rounded-lg" aria-label="Période">
                  <SelectValue placeholder="Période" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tout</SelectItem>
                  <SelectItem value="today">Aujourd'hui</SelectItem>
                  <SelectItem value="week">7 derniers jours</SelectItem>
                  <SelectItem value="upcoming">À venir</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="shrink-0 border-border rounded-lg" onClick={fetchExecutions} disabled={loading} aria-label="Rafraîchir les activités">
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        {/* Activity list */}
        <ScrollArea className="h-[calc(100vh-320px)]">
          <div className="px-4 pb-6 space-y-4">
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Chargement…</div>
            ) : loadError ? (
              <div className="text-center py-12 space-y-3">
                <p className="text-sm text-destructive">
                  Impossible de charger le Journal. Vérifiez votre connexion puis réessayez.
                </p>
                <Button variant="outline" size="sm" onClick={fetchExecutions}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                  Réessayer
                </Button>
              </div>
            ) : groupedExecutions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {executions.length === 0
                  ? missionScoped
                    ? 'Aucune activité pour cette mission.'
                    : 'Aucune activité pour le moment.'
                  : 'Aucune activité ne correspond à ces filtres.'}
              </div>
            ) : (
              groupedExecutions.map(([date, items]) => (
                <div key={date} className="space-y-2">
                  {/* Date header */}
                  <div className="flex items-center gap-2 py-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-semibold text-foreground uppercase tracking-wide">
                      {formatDateHeader(date)}
                    </span>
                    <div className="flex-1 h-px bg-foreground/20" />
                    <span className="text-xs text-muted-foreground font-medium">
                      {items.length} action{items.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Items */}
                  {items.map((exec) => {
                    const actionType = exec.step?.action_type || '';
                    const actionStyle = actionTypeStyle[actionType] || defaultActionStyle;
                    const actionLabel = actionTypeLabel(actionType);
                    const execStatus = statusStyle[exec.status] || unknownStatusStyle;
                    const isExpanded = expandedItems.has(exec.id);
                    const preview = exec.preview;
                    const hasMessage = !!preview.message || preview.source === 'ai';
                    const showError = !!exec.error_message && shouldShowExecutionError(exec.status);
                    const showReason = !!exec.skip_reason && !isSentExecutionStatus(exec.status);
                    const isPast = isBefore(new Date(exec.scheduled_at), new Date());
                    const isOverdue = exec.status === 'scheduled' && isPast;
                    const candidateName = exec.enrollment?.profile_name || 'Candidat';
                    const doneVerb = executionDoneVerb(exec.status);
                    const canSkip = SKIPPABLE_STATUSES.has(exec.status);

                    return (
                      <Collapsible
                        key={exec.id}
                        open={isExpanded}
                        onOpenChange={() => toggleExpanded(exec.id)}
                      >
                        <div className={cn(
                          "border border-border rounded-lg overflow-hidden transition-colors",
                          isOverdue && "border-warning bg-warning/5",
                          exec.status === 'failed' && "border-destructive bg-destructive/5",
                        )}>
                          <CollapsibleTrigger className="w-full">
                            <div className="p-3 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                              {/* Action icon */}
                              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", actionStyle.bgColor)}>
                                <span className={actionStyle.color}>{actionStyle.icon}</span>
                              </div>

                              {/* Main content */}
                              <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-foreground">
                                    {candidateName}
                                  </span>
                                  {exec.enrollment?.profile_url && (
                                    <a
                                      href={exec.enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-linkedin transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label={`Voir le profil LinkedIn de ${candidateName}`}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                                    </a>
                                  )}
                                  <Badge className={cn("text-xs border h-5", execStatus.className)}>
                                    {execStatus.icon}
                                    <span className="ml-1">{executionStatusLabel(exec.status)}</span>
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                  <span className={cn("font-medium", actionStyle.color)}>{actionLabel}</span>
                                  <span className="text-muted-foreground/50">·</span>
                                  <span className="truncate max-w-[180px]">{exec.enrollment?.sequence?.name}</span>
                                  <span className="text-muted-foreground/50">·</span>
                                  <span className="tabular-nums">{format(new Date(exec.scheduled_at), 'HH:mm')}</span>
                                </div>
                              </div>

                              {/* Expand indicator */}
                              {(hasMessage || showError || showReason || canSkip) && (
                                <div className="shrink-0 self-center">
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                  )}
                                </div>
                              )}
                            </div>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border bg-muted/30">
                              {/* Error message */}
                              {showError && (
                                <div className="p-2.5 bg-destructive/10 border border-destructive rounded-lg text-sm">
                                  <div className="flex items-center gap-2 font-medium text-destructive">
                                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                                    {exec.status === 'failed' ? 'Erreur' : 'Tentative précédente'}
                                  </div>
                                  <p className="mt-1 text-destructive text-xs">
                                    {formatSequenceError(exec.error_message)}
                                  </p>
                                </div>
                              )}

                              {/* Skip reason */}
                              {showReason && (
                                <div className="p-2.5 bg-muted border border-border rounded-lg text-sm">
                                  <div className="flex items-center gap-2 font-medium text-foreground">
                                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                                    Raison
                                  </div>
                                  <p className="mt-1 text-muted-foreground text-xs">
                                    {formatSkipReason(exec.skip_reason)}
                                  </p>
                                </div>
                              )}

                              {/* Message preview */}
                              {hasMessage && (
                                <div className="p-3 bg-background border border-border rounded-lg mt-2">
                                  <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                    {PREVIEW_TITLES[preview.source]}
                                  </div>
                                  {preview.subject && (
                                    <div className="text-xs text-muted-foreground mb-2 pb-2 border-b">
                                      <span className="font-medium">Objet :</span>{' '}
                                      {preview.subject}
                                    </div>
                                  )}
                                  {preview.message && (
                                    <div className="text-sm text-foreground leading-relaxed">
                                      {preview.message
                                        .split(/\\n|\n/)
                                        .map((line, i, arr) => (
                                          <React.Fragment key={i}>
                                            {line}
                                            {i < arr.length - 1 && <br />}
                                          </React.Fragment>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Actions for pending items */}
                              {canSkip && (
                                <div className="flex items-center gap-2 pt-2">
                                  {exec.status === 'scheduled' && preview.message && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingExecution(exec);
                                      }}
                                    >
                                      <Pencil className="w-3 h-3 mr-1.5" aria-hidden="true" />
                                      Modifier
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSkipConfirm({ id: exec.id, candidateName });
                                    }}
                                    disabled={skippingId === exec.id}
                                  >
                                    {skippingId === exec.id
                                      ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" aria-hidden="true" />
                                      : <Ban className="w-3 h-3 mr-1.5" aria-hidden="true" />}
                                    Ne pas envoyer cette étape
                                  </Button>
                                </div>
                              )}

                              {/* Metadata */}
                              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" aria-hidden="true" />
                                  <span>Prévu : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}</span>
                                </div>
                                {exec.executed_at && doneVerb && (
                                  <div className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-success-foreground" aria-hidden="true" />
                                    <span>{doneVerb} : {format(new Date(exec.executed_at), 'dd/MM HH:mm', { locale: fr })}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>

      {/* Edit scheduled message modal */}
      <EditScheduledMessageModal
        isOpen={!!editingExecution}
        onClose={() => setEditingExecution(null)}
        execution={editingExecution}
        onSaved={fetchExecutions}
      />

      {/* Confirmation avant de retirer une étape programmée */}
      <AlertDialog open={!!skipConfirm} onOpenChange={(open) => !open && setSkipConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ne pas envoyer cette étape ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{skipConfirm?.candidateName}</strong> ne recevra pas cette étape. La séquence passera à
              l'étape suivante. Pour tout arrêter, mettez ce candidat en pause.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder l'envoi</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = skipConfirm;
                setSkipConfirm(null);
                if (target) handleSkipExecution(target.id, target.candidateName);
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Ne pas envoyer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
};
