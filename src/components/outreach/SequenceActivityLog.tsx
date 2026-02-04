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

const actionTypeConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  profile_visit: { label: 'Visite profil', icon: <Eye className="w-4 h-4" />, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  connection_request: { label: 'Invitation', icon: <UserPlus className="w-4 h-4" />, color: 'text-green-600', bgColor: 'bg-green-100' },
  message: { label: 'Message', icon: <Send className="w-4 h-4" />, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  inmail: { label: 'InMail', icon: <Mail className="w-4 h-4" />, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  smart_message: { label: 'Smart Message', icon: <MessageSquare className="w-4 h-4" />, color: 'text-indigo-600', bgColor: 'bg-indigo-100' },
  check_connection: { label: 'Check connexion', icon: <Users className="w-4 h-4" />, color: 'text-orange-600', bgColor: 'bg-orange-100' },
  wait_connection: { label: 'Attente connexion', icon: <Timer className="w-4 h-4" />, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  wait_reply: { label: 'Attente réponse', icon: <Timer className="w-4 h-4" />, color: 'text-amber-600', bgColor: 'bg-amber-100' },
};

const statusConfig: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  scheduled: { label: 'Planifié', icon: <Clock className="w-3.5 h-3.5" />, className: 'bg-blue-50 text-blue-700 border-blue-200' },
  sent: { label: 'Envoyé', icon: <CheckCircle2 className="w-3.5 h-3.5" />, className: 'bg-green-50 text-green-700 border-green-200' },
  skipped: { label: 'Ignoré', icon: <SkipForward className="w-3.5 h-3.5" />, className: 'bg-gray-50 text-gray-600 border-gray-200' },
  failed: { label: 'Échoué', icon: <XCircle className="w-3.5 h-3.5" />, className: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Annulé', icon: <XCircle className="w-3.5 h-3.5" />, className: 'bg-gray-50 text-gray-500 border-gray-200' },
  replied: { label: 'Répondu', icon: <MessageSquare className="w-3.5 h-3.5" />, className: 'bg-purple-50 text-purple-700 border-purple-200' },
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

      // Fetch step executions with enrollment and step data
      const { data: execData, error: execError } = await supabase
        .from('sequence_step_executions')
        .select(`
          *,
          step:sequence_steps(action_type, message_template, subject_template),
          enrollment:sequence_enrollments(
            profile_name,
            profile_headline,
            profile_url,
            sequence:outreach_sequences(name)
          )
        `)
        .order('scheduled_at', { ascending: false })
        .limit(500);

      if (execError) throw execError;

      setExecutions(execData || []);
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
      <SheetContent className="w-[600px] sm:max-w-[600px] bg-white p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Journal d'activité
          </SheetTitle>
        </SheetHeader>

        <div className="p-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="p-3 rounded-lg bg-blue-50 text-center">
              <div className="text-xl font-bold text-blue-700">{stats.scheduled}</div>
              <div className="text-xs text-blue-600">À venir</div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 text-center">
              <div className="text-xl font-bold text-amber-700">{stats.pending}</div>
              <div className="text-xs text-amber-600">En retard</div>
            </div>
            <div className="p-3 rounded-lg bg-green-50 text-center">
              <div className="text-xl font-bold text-green-700">{stats.sent}</div>
              <div className="text-xs text-green-600">Envoyés</div>
            </div>
            <div className="p-3 rounded-lg bg-red-50 text-center">
              <div className="text-xl font-bold text-red-700">{stats.failed}</div>
              <div className="text-xs text-red-600">Échoués</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
              <SelectTrigger className="w-[130px]">
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
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Période" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tout</SelectItem>
                <SelectItem value="today">Aujourd'hui</SelectItem>
                <SelectItem value="week">7 derniers jours</SelectItem>
                <SelectItem value="upcoming">À venir</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchExecutions} disabled={loading}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Activity list */}
        <ScrollArea className="h-[calc(100vh-320px)]">
          <div className="px-4 pb-6 space-y-4">
            {loading ? (
              <div className="text-center py-12 text-gray-500">Chargement...</div>
            ) : groupedExecutions.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                Aucune activité trouvée
              </div>
            ) : (
              groupedExecutions.map(([date, items]) => (
                <div key={date} className="space-y-2">
                  {/* Date header */}
                  <div className="flex items-center gap-2 py-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-600 capitalize">
                      {formatDateHeader(date)}
                    </span>
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400">{items.length} action(s)</span>
                  </div>

                  {/* Items */}
                  {items.map((exec) => {
                    const actionConfig = actionTypeConfig[exec.step?.action_type || ''] || {
                      label: exec.step?.action_type || 'Action',
                      icon: <Activity className="w-4 h-4" />,
                      color: 'text-gray-600',
                      bgColor: 'bg-gray-100',
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
                          "border rounded-lg overflow-hidden transition-colors",
                          isOverdue && "border-amber-300 bg-amber-50/30",
                          exec.status === 'failed' && "border-red-200 bg-red-50/20",
                          exec.status === 'sent' && "border-green-200 bg-green-50/20",
                          exec.status === 'skipped' && "border-gray-200 bg-gray-50/50",
                          !isOverdue && exec.status === 'scheduled' && "border-blue-200 bg-blue-50/20",
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
                                      className="text-muted-foreground hover:text-[#0077B5] transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  <Badge className={cn("text-[10px] border h-5", execStatus.className)}>
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
                            <div className="px-3 pb-3 pt-2 space-y-2 border-t bg-muted/20">
                              {/* Error message */}
                              {hasError && (
                                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm">
                                  <div className="flex items-center gap-2 font-medium text-red-700">
                                    <AlertCircle className="w-4 h-4" />
                                    {exec.status === 'failed' ? 'Erreur' : 'Raison'}
                                  </div>
                                  <p className="mt-1 text-red-600 text-xs">
                                    {exec.error_message || exec.skip_reason}
                                  </p>
                                </div>
                              )}

                              {/* Message preview */}
                              {hasMessage && (
                                <div className="p-3 bg-white border rounded-lg mt-2">
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
                                    className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
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
                              <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span>Planifié : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}</span>
                                </div>
                                {exec.executed_at && (
                                  <div className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-green-600" />
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
