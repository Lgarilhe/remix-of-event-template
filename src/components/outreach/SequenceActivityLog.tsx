import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatSequenceError } from '@/lib/sequenceErrorMessages';
import { sequenceActionLabel, skipReasonLabel } from '@/lib/sequenceCatalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, ErrorState, StatGrid, StatTile } from '@/components/layout';
import { ExecutionStatusBadge, SequenceActionIcon } from './SequenceBadges';
import { 
  Activity,
  Search,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Pencil,
  Ban,
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
}

interface SequenceActivityLogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Actions to hide from activity log (internal/noise)
const HIDDEN_ACTION_TYPES = new Set(['wait_connection', 'check_connection', 'wait_reply', 'wait_for_event']);

type FilterStatus = 'all' | 'scheduled' | 'sent' | 'failed' | 'skipped';
type FilterPeriod = 'all' | 'today' | 'week' | 'upcoming';

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

/** « 26/09 à 10:42 » */
const formatWhen = (value: string) => format(new Date(value), "dd/MM 'à' HH:mm", { locale: fr });

/** Verbe de la date de traitement, selon le statut de l'étape. */
const DONE_LABELS: Record<string, string> = {
  sent: 'Envoyée',
  executed: 'Faite',
  failed: 'Tentée',
  skipped: 'Ignorée',
  cancelled: 'Annulée',
};

export const SequenceActivityLog: React.FC<SequenceActivityLogProps> = ({
  isOpen,
  onClose,
}) => {
  const [executions, setExecutions] = useState<StepExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [periodFilter, setPeriodFilter] = useState<FilterPeriod>('all');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingExecution, setEditingExecution] = useState<StepExecution | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<{ id: string; candidateName: string } | null>(null);

  const fetchExecutions = async () => {
    try {
      setLoading(true);
      setLoadError(null);

      // Fetch step executions
      const { data: execData, error: execError } = await supabase
        .from('sequence_step_executions')
        .select('*')
        .order('scheduled_at', { ascending: false })
        .limit(500);

      if (execError) throw execError;

      if (!execData || execData.length === 0) {
        setExecutions([]);
        return;
      }

      // Get unique IDs for batch fetching
      const enrollmentIds = [...new Set(execData.map(e => e.enrollment_id))];
      const stepIds = [...new Set(execData.map(e => e.step_id))];

      // Fetch enrollments with sequences
      const { data: enrollmentsData, error: enrollmentsError } = await supabase
        .from('sequence_enrollments')
        .select('id, profile_name, profile_headline, profile_url, sequence_id')
        .in('id', enrollmentIds);
      if (enrollmentsError) throw enrollmentsError;

      // Get sequence IDs from enrollments
      const sequenceIds = [...new Set((enrollmentsData || []).map(e => e.sequence_id))];
      
      // Fetch sequences
      const { data: sequencesData, error: sequencesError } = await supabase
        .from('outreach_sequences')
        .select('id, name')
        .in('id', sequenceIds);
      if (sequencesError) throw sequencesError;

      // Fetch steps
      const { data: stepsData, error: stepsError } = await supabase
        .from('sequence_steps')
        .select('id, action_type, message_template, subject_template')
        .in('id', stepIds);
      if (stepsError) throw stepsError;

      // Build lookup maps
      const sequencesMap = new Map((sequencesData || []).map(s => [s.id, s]));
      const enrollmentsMap = new Map((enrollmentsData || []).map(e => [e.id, {
        ...e,
        sequence: sequencesMap.get(e.sequence_id)
      }]));
      const stepsMap = new Map((stepsData || []).map(s => [s.id, s]));

      // Merge data
      const enrichedExecutions = execData.map(exec => ({
        ...exec,
        enrollment: enrollmentsMap.get(exec.enrollment_id),
        step: stepsMap.get(exec.step_id),
      }));

      setExecutions(enrichedExecutions);
    } catch (err) {
      console.error('Error fetching executions:', err);
      // Une panne ne se lit pas comme un journal vide : état d'erreur avec « Réessayer ».
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchExecutions();
    }
  }, [isOpen]);

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

  const handleCancelExecution = async (executionId: string) => {
    setCancellingId(executionId);
    try {
      // Garde anti-race : n'annuler QUE si l'exécution est encore en attente.
      // Sans le filtre statut, annuler une exécution déjà passée en 'sending'
      // la marquait 'cancelled' alors que l'envoi partait quand même (puis le
      // cron la repassait 'sent') — l'user croyait avoir stoppé un message
      // qui est parti (audit 2026-07, Frontend H1).
      const { data: cancelled, error } = await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Annulé manuellement' })
        .eq('id', executionId)
        .in('status', ['scheduled', 'waiting_event', 'quota_blocked'])
        .select('id');

      if (error) throw error;

      if (!cancelled || cancelled.length === 0) {
        toast.error("Cette étape est déjà en cours d'envoi ou traitée : elle ne peut plus être annulée.");
      } else {
        toast.success('Étape annulée : elle ne partira pas.');
      }
      fetchExecutions();
    } catch (err) {
      console.error('Error cancelling execution:', err);
      toast.error("L'étape n'a pas pu être annulée. Réessayez.");
    } finally {
      setCancellingId(null);
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setPeriodFilter('all');
  };

  // Filter and group executions
  const filteredExecutions = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekAgo = subDays(now, 7);

    return executions.filter(exec => {
      // Hide internal actions (wait_connection, check_connection, etc.)
      const actionType = exec.step?.action_type || '';
      if (HIDDEN_ACTION_TYPES.has(actionType)) return false;

      // Status filter
      if (statusFilter !== 'all' && exec.status !== statusFilter) {
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
        const actionLabel = sequenceActionLabel(exec.step?.action_type).toLowerCase();
        
        if (!profileName.includes(query) && !sequenceName.includes(query) && !actionLabel.includes(query)) {
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

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    return {
      scheduled: executions.filter(e => e.status === 'scheduled' && isAfter(new Date(e.scheduled_at), now)).length,
      pending: executions.filter(e => e.status === 'scheduled' && isBefore(new Date(e.scheduled_at), now)).length,
      sent: executions.filter(e => e.status === 'sent').length,
      failed: executions.filter(e => e.status === 'failed').length,
    };
  }, [executions]);

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
    
    const label = format(date, 'EEEE d MMMM', { locale: fr });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetTitle>Journal d'activité</SheetTitle>
          <SheetDescription>
            Les 500 dernières étapes de vos séquences, envoyées ou planifiées.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <ActivityLogSkeleton />
          ) : loadError ? (
            <ErrorState
              title="Impossible de charger le journal"
              description="Vérifiez votre connexion, puis réessayez."
              detail={loadError}
              onRetry={fetchExecutions}
            />
          ) : executions.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Aucune étape pour l'instant"
              description="Les étapes envoyées et planifiées de vos séquences s'afficheront ici dès la première inscription."
            />
          ) : (
            <>
              <StatGrid cols={{ base: 2, sm: 4 }}>
                <StatTile label="À venir" value={stats.scheduled} />
                <StatTile label="En retard" value={stats.pending} variant="warning" accent={stats.pending > 0} />
                <StatTile label="Envoyées" value={stats.sent} />
                <StatTile label="En échec" value={stats.failed} variant="destructive" accent={stats.failed > 0} />
              </StatGrid>

              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="search"
                    aria-label="Rechercher dans le journal"
                    placeholder="Candidat, séquence ou étape"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
                    <SelectTrigger className="flex-1 sm:w-36" aria-label="Filtrer par statut">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les statuts</SelectItem>
                      <SelectItem value="scheduled">Planifiées</SelectItem>
                      <SelectItem value="sent">Envoyées</SelectItem>
                      <SelectItem value="failed">En échec</SelectItem>
                      <SelectItem value="skipped">Ignorées</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as FilterPeriod)}>
                    <SelectTrigger className="flex-1 sm:w-36" aria-label="Filtrer par période">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes les dates</SelectItem>
                      <SelectItem value="today">Aujourd'hui</SelectItem>
                      <SelectItem value="week">7 derniers jours</SelectItem>
                      <SelectItem value="upcoming">À venir</SelectItem>
                    </SelectContent>
                  </Select>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 max-md:h-11 max-md:w-11"
                        onClick={fetchExecutions}
                        aria-label="Actualiser le journal"
                      >
                        <RefreshCw aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Actualiser</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {groupedExecutions.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={Search}
                  title="Aucune étape ne correspond à ces filtres"
                  description="Élargissez la période ou le statut, ou effacez la recherche."
                  action={
                    <Button variant="outline" size="sm" onClick={resetFilters}>
                      Réinitialiser les filtres
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-5">
                  {groupedExecutions.map(([date, items]) => (
                    <section key={date} aria-labelledby={`journal-${date}`} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 id={`journal-${date}`} className="text-sm font-semibold text-foreground">
                          {formatDateHeader(date)}
                        </h3>
                        <div className="h-px flex-1 bg-border" aria-hidden="true" />
                        <span className="text-xs text-muted-foreground">{plural(items.length, 'étape')}</span>
                      </div>

                      <ul className="space-y-2">
                        {items.map((exec) => {
                          const isExpanded = expandedItems.has(exec.id);
                          const name = exec.enrollment?.profile_name || 'Candidat';
                          const message = exec.final_message || exec.step?.message_template;
                          const subject = exec.final_subject || exec.step?.subject_template;
                          const reason = ['skipped', 'cancelled', 'quota_blocked'].includes(exec.status)
                            ? skipReasonLabel(exec.skip_reason)
                            : null;
                          const isOverdue = exec.status === 'scheduled' && isBefore(new Date(exec.scheduled_at), new Date());

                          return (
                            <li key={exec.id}>
                              <Collapsible
                                open={isExpanded}
                                onOpenChange={() => toggleExpanded(exec.id)}
                                className="rounded-xl border border-border bg-card"
                              >
                                <CollapsibleTrigger className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                                    <SequenceActionIcon type={exec.step?.action_type} className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="truncate text-sm font-medium text-foreground">{name}</span>
                                      <ExecutionStatusBadge status={exec.status} />
                                      {isOverdue && <Badge variant="warning">En retard</Badge>}
                                    </div>
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                      {sequenceActionLabel(exec.step?.action_type)}
                                      {exec.enrollment?.sequence?.name && ` · ${exec.enrollment.sequence.name}`}
                                      {' · '}
                                      <span className="tabular-nums">{format(new Date(exec.scheduled_at), 'HH:mm')}</span>
                                    </p>
                                  </div>
                                  <ChevronRight
                                    className={cn('mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150', isExpanded && 'rotate-90')}
                                    aria-hidden="true"
                                  />
                                </CollapsibleTrigger>

                                <CollapsibleContent>
                                  <div className="space-y-3 border-t border-border p-3">
                                    {exec.status === 'failed' && exec.error_message && (
                                      <p className="rounded-lg bg-danger-muted px-3 py-2 text-xs text-danger">
                                        Échec : {formatSequenceError(exec.error_message)}
                                      </p>
                                    )}
                                    {reason && <p className="text-xs text-muted-foreground">Raison : {reason}</p>}

                                    {message && (
                                      <div className="rounded-lg border border-border bg-background p-3">
                                        {subject && (
                                          <p className="mb-2 border-b border-border pb-2 text-xs text-muted-foreground">
                                            <span className="font-medium text-foreground-secondary">Objet :</span> {subject}
                                          </p>
                                        )}
                                        <p className="text-sm leading-relaxed text-foreground">
                                          {message.split(/\\n|\n/).map((line, i, arr) => (
                                            <React.Fragment key={i}>
                                              {line}
                                              {i < arr.length - 1 && <br />}
                                            </React.Fragment>
                                          ))}
                                        </p>
                                      </div>
                                    )}

                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span>Planifiée le {formatWhen(exec.scheduled_at)}</span>
                                      {exec.executed_at && (
                                        <span>{DONE_LABELS[exec.status] || 'Traitée'} le {formatWhen(exec.executed_at)}</span>
                                      )}
                                    </div>

                                    {(exec.status === 'scheduled' || exec.enrollment?.profile_url) && (
                                      <div className="flex flex-wrap items-center gap-2">
                                        {exec.status === 'scheduled' && message && (
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            className="max-md:h-11"
                                            onClick={() => setEditingExecution(exec)}
                                          >
                                            <Pencil aria-hidden="true" />
                                            Modifier le message
                                          </Button>
                                        )}
                                        {exec.status === 'scheduled' && (
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            className="text-danger hover:text-danger max-md:h-11"
                                            onClick={() => setCancelConfirm({ id: exec.id, candidateName: name })}
                                            loading={cancellingId === exec.id}
                                          >
                                            {cancellingId !== exec.id && <Ban aria-hidden="true" />}
                                            Annuler l'étape
                                          </Button>
                                        )}
                                        {exec.enrollment?.profile_url && (
                                          <Button variant="ghost" size="xs" asChild className="max-md:h-11">
                                            <a href={exec.enrollment.profile_url} target="_blank" rel="noopener noreferrer">
                                              <ExternalLink aria-hidden="true" />
                                              Ouvrir le profil LinkedIn
                                            </a>
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>

      {/* Edit scheduled message modal */}
      <EditScheduledMessageModal
        isOpen={!!editingExecution}
        onClose={() => setEditingExecution(null)}
        execution={editingExecution}
        onSaved={fetchExecutions}
      />

      {/* Confirmation avant annulation d'une exécution programmée */}
      <AlertDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette étape ?</AlertDialogTitle>
            <AlertDialogDescription>
              L'envoi prévu pour <strong className="font-medium text-foreground">{cancelConfirm?.candidateName}</strong> sera
              annulé : l'étape ne partira plus. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver l'envoi</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cancelConfirm) handleCancelExecution(cancelConfirm.id);
                setCancelConfirm(null);
              }}
              className="bg-destructive"
            >
              Annuler l'étape
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
};

/** Squelette du journal : tuiles, filtres, puis des lignes d'étape. */
const ActivityLogSkeleton: React.FC = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-9 w-full rounded-lg" />
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-start gap-3 rounded-xl border border-border p-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5 rounded-sm" />
          <Skeleton className="h-3 w-3/5 rounded-sm" />
        </div>
      </div>
    ))}
  </div>
);
