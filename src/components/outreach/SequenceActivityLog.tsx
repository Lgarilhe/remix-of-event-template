import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  Users,
  Timer,
  RefreshCw,
  Calendar,
  Pencil,
  Ban,
} from 'lucide-react';
import { format, formatDistanceToNow, isAfter, isBefore, startOfDay, endOfDay, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { EditScheduledMessageModal } from './activity-log/EditScheduledMessageModal';

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

const actionTypeConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  profile_visit: { label: 'Visite profil', icon: <Eye className="w-4 h-4" />, color: 'text-foreground', bgColor: 'bg-muted' },
  connection_request: { label: 'Invitation', icon: <UserPlus className="w-4 h-4" />, color: 'text-emerald-900', bgColor: 'bg-emerald-400' },
  message: { label: 'Message', icon: <Send className="w-4 h-4" />, color: 'text-blue-900', bgColor: 'bg-blue-400' },
  inmail: { label: 'InMail', icon: <Mail className="w-4 h-4" />, color: 'text-purple-900', bgColor: 'bg-purple-400' },
  smart_message: { label: 'Smart Message', icon: <MessageSquare className="w-4 h-4" />, color: 'text-indigo-900', bgColor: 'bg-indigo-400' },
};

const statusConfig: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  scheduled: { label: 'Planifié', icon: <Clock className="w-3.5 h-3.5" />, className: 'bg-info text-info-foreground border-info' },
  sent: { label: 'Envoyé', icon: <CheckCircle2 className="w-3.5 h-3.5" />, className: 'bg-success text-success-foreground border-success' },
  skipped: { label: 'Ignoré', icon: <SkipForward className="w-3.5 h-3.5" />, className: 'bg-muted text-muted-foreground border-border' },
  failed: { label: 'Échoué', icon: <XCircle className="w-3.5 h-3.5" />, className: 'bg-destructive text-destructive-foreground border-destructive' },
  cancelled: { label: 'Annulé', icon: <XCircle className="w-3.5 h-3.5" />, className: 'bg-muted text-muted-foreground border-border' },
  replied: { label: 'Répondu', icon: <MessageSquare className="w-3.5 h-3.5" />, className: 'bg-purple-500 text-white border-purple-600' },
};

type FilterStatus = 'all' | 'scheduled' | 'sent' | 'failed' | 'skipped';
type FilterPeriod = 'all' | 'today' | 'week' | 'upcoming';

export const SequenceActivityLog: React.FC<SequenceActivityLogProps> = ({
  isOpen,
  onClose,
}) => {
  const [executions, setExecutions] = useState<StepExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [periodFilter, setPeriodFilter] = useState<FilterPeriod>('all');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingExecution, setEditingExecution] = useState<StepExecution | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchExecutions = async () => {
    try {
      setLoading(true);

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
      const { data: enrollmentsData } = await supabase
        .from('sequence_enrollments')
        .select('id, profile_name, profile_headline, profile_url, sequence_id')
        .in('id', enrollmentIds);

      // Get sequence IDs from enrollments
      const sequenceIds = [...new Set((enrollmentsData || []).map(e => e.sequence_id))];
      
      // Fetch sequences
      const { data: sequencesData } = await supabase
        .from('outreach_sequences')
        .select('id, name')
        .in('id', sequenceIds);

      // Fetch steps
      const { data: stepsData } = await supabase
        .from('sequence_steps')
        .select('id, action_type, message_template, subject_template')
        .in('id', stepIds);

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
      toast.error('Erreur lors du chargement');
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
      const { error } = await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Annulé manuellement' })
        .eq('id', executionId);

      if (error) throw error;

      toast.success('Action annulée');
      fetchExecutions();
    } catch (err) {
      console.error('Error cancelling execution:', err);
      toast.error("Erreur lors de l'annulation");
    } finally {
      setCancellingId(null);
    }
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
        const actionType = actionTypeConfig[exec.step?.action_type || '']?.label.toLowerCase() || '';
        
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
    
    return format(date, 'EEEE d MMMM', { locale: fr });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:w-[600px] sm:max-w-[600px] bg-background p-0 rounded-lg border-l border-border">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Journal d'activité
          </SheetTitle>
        </SheetHeader>

        <div className="p-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-0">
            <div className="p-2.5 sm:p-3 border border-border text-center">
              <div className="text-lg sm:text-xl font-bold text-info-foreground">{stats.scheduled}</div>
              <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">À venir</div>
            </div>
            <div className="p-2.5 sm:p-3 border border-border border-l-0 text-center bg-amber-400/10">
              <div className="text-lg sm:text-xl font-bold text-destructive">{stats.pending}</div>
              <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">En retard</div>
            </div>
            <div className="p-2.5 sm:p-3 border border-border border-l-0 text-center">
              <div className="text-lg sm:text-xl font-bold text-success-foreground">{stats.sent}</div>
              <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">Envoyés</div>
            </div>
            <div className="p-2.5 sm:p-3 border border-border border-l-0 text-center">
              <div className="text-lg sm:text-xl font-bold text-destructive">{stats.failed}</div>
              <div className="text-xs sm:text-xs text-muted-foreground uppercase font-medium">Échoués</div>
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-2 sm:space-y-0 sm:flex sm:gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background border-border rounded-lg"
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
                <SelectTrigger className="flex-1 sm:w-[130px] border-border rounded-lg">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="scheduled">Planifiés</SelectItem>
                  <SelectItem value="sent">Envoyés</SelectItem>
                  <SelectItem value="failed">Échoués</SelectItem>
                  <SelectItem value="skipped">Ignorés</SelectItem>
                </SelectContent>
              </Select>
              <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as FilterPeriod)}>
                <SelectTrigger className="flex-1 sm:w-[130px] border-border rounded-lg">
                  <SelectValue placeholder="Période" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tout</SelectItem>
                  <SelectItem value="today">Aujourd'hui</SelectItem>
                  <SelectItem value="week">7 derniers jours</SelectItem>
                  <SelectItem value="upcoming">À venir</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="shrink-0 border-border rounded-lg" onClick={fetchExecutions} disabled={loading}>
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>

        {/* Activity list */}
        <ScrollArea className="h-[calc(100vh-320px)]">
          <div className="px-4 pb-6 space-y-4">
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Chargement...</div>
            ) : groupedExecutions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Aucune activité trouvée
              </div>
            ) : (
              groupedExecutions.map(([date, items]) => (
                <div key={date} className="space-y-2">
                  {/* Date header */}
                  <div className="flex items-center gap-2 py-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground uppercase tracking-wide">
                      {formatDateHeader(date)}
                    </span>
                    <div className="flex-1 h-px bg-foreground/20" />
                    <span className="text-xs text-muted-foreground font-medium">{items.length} action(s)</span>
                  </div>

                  {/* Items */}
                  {items.map((exec) => {
                    const actionConfig = actionTypeConfig[exec.step?.action_type || ''] || {
                      label: exec.step?.action_type || 'Action',
                      icon: <Activity className="w-4 h-4" />,
                      color: 'text-muted-foreground',
                      bgColor: 'bg-muted',
                    };
                    const execStatus = statusConfig[exec.status] || statusConfig.scheduled;
                    const isExpanded = expandedItems.has(exec.id);
                    const hasMessage = exec.final_message || exec.step?.message_template;
                    const hasError = exec.error_message || exec.skip_reason;
                    const isPast = isBefore(new Date(exec.scheduled_at), new Date());
                    const isOverdue = exec.status === 'scheduled' && isPast;

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
                              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", actionConfig.bgColor)}>
                                <span className={actionConfig.color}>{actionConfig.icon}</span>
                              </div>

                              {/* Main content */}
                              <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-foreground">
                                    {exec.enrollment?.profile_name || 'Candidat'}
                                  </span>
                                  {exec.enrollment?.profile_url && (
                                    <a
                                      href={exec.enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-linkedin transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  <Badge className={cn("text-xs border h-5", execStatus.className)}>
                                    {execStatus.icon}
                                    <span className="ml-1">{execStatus.label}</span>
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                  <span className={cn("font-medium", actionConfig.color)}>{actionConfig.label}</span>
                                  <span className="text-muted-foreground/50">·</span>
                                  <span className="truncate max-w-[180px]">{exec.enrollment?.sequence?.name}</span>
                                  <span className="text-muted-foreground/50">·</span>
                                  <span className="tabular-nums">{format(new Date(exec.scheduled_at), 'HH:mm')}</span>
                                </div>
                              </div>

                              {/* Expand indicator */}
                              {(hasMessage || hasError) && (
                                <div className="shrink-0 self-center">
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </div>
                              )}
                            </div>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border bg-muted/30">
                              {/* Error message */}
                              {hasError && (
                                <div className="p-2.5 bg-destructive/10 border border-destructive rounded-lg text-sm">
                                  <div className="flex items-center gap-2 font-medium text-destructive">
                                    <AlertCircle className="w-4 h-4" />
                                    {exec.status === 'failed' ? 'Erreur' : 'Raison'}
                                  </div>
                                  <p className="mt-1 text-destructive text-xs">
                                    {exec.error_message || exec.skip_reason}
                                  </p>
                                </div>
                              )}

                              {/* Message preview */}
                              {hasMessage && (
                                <div className="p-3 bg-background border border-border rounded-lg mt-2">
                                  {(exec.final_subject || exec.step?.subject_template) && (
                                    <div className="text-xs text-muted-foreground mb-2 pb-2 border-b">
                                      <span className="font-medium">Objet :</span>{' '}
                                      {exec.final_subject || exec.step?.subject_template}
                                    </div>
                                  )}
                                  <div className="text-sm text-foreground leading-relaxed">
                                    {(exec.final_message || exec.step?.message_template || 'Pas de message')
                                      .split(/\\n|\n/)
                                      .map((line, i, arr) => (
                                        <React.Fragment key={i}>
                                          {line}
                                          {i < arr.length - 1 && <br />}
                                        </React.Fragment>
                                      ))}
                                  </div>
                                </div>
                              )}

                              {/* Actions for scheduled items */}
                              {exec.status === 'scheduled' && (
                                <div className="flex items-center gap-2 pt-2">
                                  {hasMessage && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingExecution(exec);
                                      }}
                                    >
                                      <Pencil className="w-3 h-3 mr-1.5" />
                                      Modifier
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelExecution(exec.id);
                                    }}
                                    disabled={cancellingId === exec.id}
                                  >
                                    <Ban className="w-3 h-3 mr-1.5" />
                                    {cancellingId === exec.id ? 'Annulation...' : 'Annuler'}
                                  </Button>
                                </div>
                              )}

                              {/* Metadata */}
                              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span>Planifié : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}</span>
                                </div>
                                {exec.executed_at && (
                                  <div className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-success-foreground" />
                                    <span>Exécuté : {format(new Date(exec.executed_at), 'dd/MM HH:mm', { locale: fr })}</span>
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
    </Sheet>
  );
};
