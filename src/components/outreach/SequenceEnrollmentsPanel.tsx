import React, { useState, useEffect } from 'react';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { 
  Users, 
  ExternalLink, 
  MoreHorizontal, 
  StopCircle, 
  Play,
  CheckCircle,
  MessageCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  Send,
  UserPlus,
  Eye,
  Mail,
  AlertCircle,
  CheckCircle2,
  Timer,
  SkipForward,
  RefreshCw,
  Zap,
  CalendarCheck,
  Search,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface StepExecution {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_subject: string | null;
  final_message: string | null;
  error_message: string | null;
  skip_reason: string | null;
  step?: {
    action_type: string;
    message_template: string | null;
    subject_template: string | null;
  };
}

interface Enrollment {
  id: string;
  profile_id: string;
  profile_name: string | null;
  profile_headline: string | null;
  profile_url: string | null;
  status: string;
  current_step_order: number;
  created_at: string;
  replied_at: string | null;
  connection_status: string | null;
  executions?: StepExecution[];
}

interface SequenceEnrollmentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId: string;
  sequenceName: string;
}

const statusConfig: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  active: {
    label: 'Active',
    icon: <Clock className="w-3 h-3" />,
    className: 'bg-info text-info-foreground border border-info'
  },
  paused: {
    label: 'En pause',
    icon: <StopCircle className="w-3 h-3" />,
    className: 'bg-warning text-warning-foreground border border-warning'
  },
  completed: {
    label: 'Terminée',
    icon: <CheckCircle className="w-3 h-3" />,
    className: 'bg-success text-success-foreground border border-success'
  },
  replied: {
    label: 'Répondu',
    icon: <MessageCircle className="w-3 h-3" />,
    className: 'bg-purple-500 text-white border border-purple-600'
  },
  cancelled: {
    label: 'Annulée',
    icon: <XCircle className="w-3 h-3" />,
    className: 'bg-muted text-muted-foreground border border-border'
  },
  booked: {
    label: 'RDV pris',
    icon: <CalendarCheck className="w-3 h-3" />,
    className: 'bg-success text-success-foreground border border-success'
  },
};

// Actions to hide from UI (internal/noise)
const HIDDEN_ACTION_TYPES = new Set(['wait_connection', 'check_connection', 'wait_reply', 'wait_for_event']);

const actionTypeConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  send_inmail: { label: 'InMail', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-purple-700', bgColor: 'bg-purple-500' },
  send_message: { label: 'Message', icon: <Send className="w-3.5 h-3.5" />, color: 'text-info-foreground', bgColor: 'bg-info' },
  send_invitation: { label: 'Invitation', icon: <UserPlus className="w-3.5 h-3.5" />, color: 'text-success-foreground', bgColor: 'bg-success' },
  visit_profile: { label: 'Visite du profil', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-foreground', bgColor: 'bg-muted' },
  smart_message: { label: 'Message intelligent', icon: <MessageCircle className="w-3.5 h-3.5" />, color: 'text-indigo-700', bgColor: 'bg-indigo-500' },
  profile_visit: { label: 'Visite du profil', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-foreground', bgColor: 'bg-muted' },
  connection_request: { label: 'Demande de connexion', icon: <UserPlus className="w-3.5 h-3.5" />, color: 'text-success-foreground', bgColor: 'bg-success' },
  message: { label: 'Message', icon: <Send className="w-3.5 h-3.5" />, color: 'text-info-foreground', bgColor: 'bg-info' },
  inmail: { label: 'InMail', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-purple-700', bgColor: 'bg-purple-500' },
};

// Helper to format error messages nicely
const formatErrorMessage = (error: string | null): string => {
  if (!error) return '';
  try {
    // Try to parse JSON error
    const parsed = JSON.parse(error);
    if (parsed.detail) return parsed.detail;
    if (parsed.title) return parsed.title;
    if (parsed.message) return parsed.message;
    return error;
  } catch {
    // If it starts with { and contains JSON-like content, try to extract meaningful parts
    if (error.startsWith('{') || error.startsWith('[')) {
      const titleMatch = error.match(/"title"\s*:\s*"([^"]+)"/);
      const detailMatch = error.match(/"detail"\s*:\s*"([^"]+)"/);
      if (detailMatch) return detailMatch[1];
      if (titleMatch) return titleMatch[1];
    }
    return error;
  }
};

const executionStatusConfig: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  pending: { label: 'À venir', icon: <Clock className="w-3 h-3" />, className: 'bg-muted text-muted-foreground border-border border-dashed' },
  scheduled: { label: 'Planifié', icon: <Clock className="w-3 h-3" />, className: 'bg-info/10 text-info-foreground border-info/30' },
  executed: { label: 'Exécuté', icon: <CheckCircle2 className="w-3 h-3" />, className: 'bg-success/10 text-success-foreground border-success/30' },
  sent: { label: 'Envoyé', icon: <CheckCircle2 className="w-3 h-3" />, className: 'bg-success/10 text-success-foreground border-success/30' },
  skipped: { label: 'Ignoré', icon: <SkipForward className="w-3 h-3" />, className: 'bg-muted text-muted-foreground border-border' },
  failed: { label: 'Échoué', icon: <AlertCircle className="w-3 h-3" />, className: 'bg-destructive/10 text-destructive border-destructive/30' },
  cancelled: { label: 'Annulé', icon: <XCircle className="w-3 h-3" />, className: 'bg-muted text-muted-foreground border-border' },
};

interface SequenceStep {
  id: string;
  step_order: number;
  action_type: string;
  message_template: string | null;
  subject_template: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes?: number | null;
  timeout_days?: number | null;
  timeout_branch_step_id?: string | null;
  if_true_goto_step?: string | null;
  if_false_goto_step?: string | null;
  wait_for_event?: string | null;
}

export const SequenceEnrollmentsPanel: React.FC<SequenceEnrollmentsPanelProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
}) => {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEnrollments, setExpandedEnrollments] = useState<Set<string>>(new Set());
  const [allSteps, setAllSteps] = useState<SequenceStep[]>([]);
  const [processingSequences, setProcessingSequences] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      
      // Fetch sequence steps FIRST to get the full workflow
      const { data: stepsData } = await supabase
        .from('sequence_steps')
        .select('id, action_type, message_template, subject_template, step_order, delay_days, delay_hours, delay_minutes, timeout_days, timeout_branch_step_id, if_true_goto_step, if_false_goto_step, wait_for_event')
        .eq('sequence_id', sequenceId)
        .order('step_order', { ascending: true });

      setAllSteps(stepsData || []);

      // Fetch enrollments
      const { data: enrollData, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('created_at', { ascending: false });

      if (enrollError) throw enrollError;

      // Fetch all step executions for these enrollments
      const enrollmentIds = enrollData?.map(e => e.id) || [];
      const { data: execData } = await supabase
        .from('sequence_step_executions')
        .select('*')
        .in('enrollment_id', enrollmentIds)
        .order('step_order', { ascending: true });

      // Attach executions to enrollments
      const enriched = (enrollData || []).map(enrollment => ({
        ...enrollment,
        executions: (execData || [])
          .filter(e => e.enrollment_id === enrollment.id)
          .map(exec => ({
            ...exec,
            step: stepsData?.find(s => s.id === exec.step_id),
          })),
      }));

      setEnrollments(enriched);
    } catch (err) {
      console.error('Error fetching enrollments:', err);
      toast.error('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && sequenceId) {
      fetchEnrollments();
    }
  }, [isOpen, sequenceId]);

  const toggleExpanded = (enrollmentId: string) => {
    setExpandedEnrollments(prev => {
      const next = new Set(prev);
      if (next.has(enrollmentId)) {
        next.delete(enrollmentId);
      } else {
        next.add(enrollmentId);
      }
      return next;
    });
  };

  const stopEnrollment = async (enrollmentId: string) => {
    try {
      // Update enrollment status
      const { error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused' })
        .eq('id', enrollmentId);

      if (enrollError) throw enrollError;

      // Cancel scheduled executions
      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Arrêt manuel' })
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'scheduled');

      setEnrollments(prev => 
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'paused' } : e)
      );
      toast.success('Séquence arrêtée');
    } catch (error) {
      console.error('Error stopping enrollment:', error);
      toast.error('Erreur lors de l\'arrêt');
    }
  };

  const resumeEnrollment = async (enrollmentId: string) => {
    try {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'active' })
        .eq('id', enrollmentId);

      if (error) throw error;

      // Re-schedule the next cancelled step so the backend picks it up
      const enrollment = enrollments.find(e => e.id === enrollmentId);
      if (enrollment) {
        const cancelledExecs = (enrollment.executions || [])
          .filter(e => e.status === 'cancelled')
          .sort((a, b) => a.step_order - b.step_order);
        
        if (cancelledExecs.length > 0) {
          const nextExec = cancelledExecs[0];
          const scheduledAt = new Date();
          scheduledAt.setMinutes(scheduledAt.getMinutes() + 1); // Schedule 1 min from now
          
          await supabase
            .from('sequence_step_executions')
            .update({ 
              status: 'scheduled', 
              skip_reason: null,
              scheduled_at: scheduledAt.toISOString(),
            })
            .eq('id', nextExec.id);
        }
      }

      setEnrollments(prev => 
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'active' } : e)
      );
      toast.success('Séquence reprise');
      fetchEnrollments(); // Refresh to show updated executions
    } catch (error) {
      console.error('Error resuming enrollment:', error);
      toast.error('Erreur lors de la reprise');
    }
  };

  const bulkStopActive = async () => {
    const activeEnrollments = enrollments.filter(e => e.status === 'active');
    if (activeEnrollments.length === 0) return;

    try {
      const ids = activeEnrollments.map(e => e.id);
      
      const { error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused' })
        .in('id', ids);

      if (enrollError) throw enrollError;

      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Arrêt groupé' })
        .in('enrollment_id', ids)
        .eq('status', 'scheduled');

      setEnrollments(prev => 
        prev.map(e => ids.includes(e.id) ? { ...e, status: 'paused' } : e)
      );
      toast.success(`${ids.length} séquence(s) arrêtée(s)`);
    } catch (error) {
      console.error('Error bulk stopping:', error);
      toast.error('Erreur lors de l\'arrêt groupé');
    }
  };

  const processSequencesNow = async () => {
    try {
      setProcessingSequences(true);
      toast.info('Traitement des séquences en cours...');
      
      // Call all sequence processing actions sequentially to avoid lock contention
      const processRes = await invokeEdgeFunction('process-sequences', { action: 'process' });
      
      if (processRes.error) {
        console.error('[processSequencesNow] process error:', processRes.error);
        toast.error(`Erreur: ${processRes.error.message || 'Échec du traitement'}`);
        return;
      }
      
      const processResult = processRes.data as any;
      
      if (processResult?.success) {
        const { processed = 0, failed = 0, skipped = 0, quota_blocked = 0 } = processResult.results || {};
        let message = `Traitement terminé: ${processed} action(s) exécutée(s)`;
        if (failed > 0) message += `, ${failed} échouée(s)`;
        if (skipped > 0) message += `, ${skipped} ignorée(s)`;
        if (quota_blocked > 0) message += `, ${quota_blocked} bloquée(s) (quota)`;
        
        toast.success(message);
      } else {
        console.error('[processSequencesNow] Unexpected response:', processResult);
        toast.error(processResult?.error || 'Erreur lors du traitement');
      }

      // Run secondary checks (non-blocking)
      await Promise.allSettled([
        invokeEdgeFunction('process-sequences', { action: 'check_replies' }),
        invokeEdgeFunction('process-sequences', { action: 'check_wait_events' }),
      ]);
      
      await fetchEnrollments();
    } catch (error) {
      console.error('[processSequencesNow] Exception:', error);
      toast.error('Erreur réseau lors du traitement');
    } finally {
      setProcessingSequences(false);
    }
  };

  const activeCount = enrollments.filter(e => e.status === 'active').length;
  const pausedCount = enrollments.filter(e => e.status === 'paused').length;
  const completedCount = enrollments.filter(e => ['completed', 'replied'].includes(e.status)).length;

  // Check if there are any pending executions that are past their scheduled time
  const pendingExecutions = enrollments.flatMap(e => e.executions || [])
    .filter(exec => exec.status === 'scheduled' && new Date(exec.scheduled_at) < new Date());

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:w-[500px] sm:max-w-[500px] bg-background rounded-lg border-l border-border">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 uppercase tracking-wide">
            <div className="h-7 w-7 bg-foreground text-background flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            {sequenceName}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Process now button - always show if there are pending tasks */}
          {pendingExecutions.length > 0 && (
            <div className="p-3 bg-background border border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-foreground">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {pendingExecutions.length} action(s) en attente
                  </span>
                </div>
                <button
                  onClick={processSequencesNow}
                  disabled={processingSequences}
                  className="relative overflow-hidden h-[30px] px-4 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider group disabled:opacity-50"
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    {processingSequences ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    Traiter maintenant
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-0 border border-border">
            <div className="p-3 text-center border-r border-border">
              <div className="text-xl font-bold text-foreground">{activeCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Actifs</div>
            </div>
            <div className="p-3 text-center border-r border-border">
              <div className="text-xl font-bold text-foreground">{pausedCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">En pause</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-xl font-bold text-foreground">{completedCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Terminés</div>
            </div>
          </div>

          {/* Bulk actions */}
          {activeCount > 0 && (
            <button 
              onClick={bulkStopActive}
              className="w-full relative overflow-hidden h-[34px] px-4 bg-background text-destructive border border-destructive text-xs font-medium uppercase tracking-wider group flex items-center justify-center gap-2"
            >
              <StopCircle className="w-3.5 h-3.5" />
              <span>Arrêter toutes les séquences actives ({activeCount})</span>
            </button>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Rechercher un candidat…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs border-border rounded-lg"
            />
          </div>

          {/* Enrollments list */}
          <div className="h-[calc(100vh-340px)] overflow-y-auto">
            <div className="space-y-2">
              {loading ? (
                <BrutalLoader compact messages={['Chargement des inscriptions…', 'Récupération des étapes…', 'Synchronisation…']} />
              ) : enrollments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Aucun candidat inscrit
                </div>
              ) : (() => {
                const query = searchQuery.toLowerCase().trim();
                const filtered = query
                  ? enrollments.filter(e => 
                      (e.profile_name || '').toLowerCase().includes(query) ||
                      (e.profile_headline || '').toLowerCase().includes(query)
                    )
                  : enrollments;
                return filtered.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Aucun résultat pour « {searchQuery} »
                  </div>
                ) : filtered.map((enrollment) => {
                  const status = statusConfig[enrollment.status] || statusConfig.active;
                  const isExpanded = expandedEnrollments.has(enrollment.id);
                  const executions = enrollment.executions || [];
                  
                  return (
                    <Collapsible
                      key={enrollment.id}
                      open={isExpanded}
                      onOpenChange={() => toggleExpanded(enrollment.id)}
                    >
                      <div className="border border-border">
                        {/* Header - always visible */}
                        <div className="p-3 bg-background hover:bg-accent/10 group">
                          <div className="flex items-start gap-2 w-full">
                            <CollapsibleTrigger className="flex items-start gap-2 flex-1 min-w-0 text-left">
                              <div className="mt-0.5 shrink-0">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground truncate">
                                    {enrollment.profile_name || 'Candidat'}
                                  </span>
                                  {enrollment.profile_url && (
                                    <a
                                      href={enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-[#0077B5] shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                                {enrollment.profile_headline && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                                    {enrollment.profile_headline}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <Badge className={`text-xs rounded-full ${status.className}`}>
                                    {status.icon}
                                    <span className="ml-1">{status.label}</span>
                                  </Badge>
                                  {(() => {
                                    // Find next scheduled or last executed action
                                    const scheduledExecs = executions
                                      .filter(e => e.status === 'scheduled')
                                      .filter(e => e.status === 'scheduled' && !HIDDEN_ACTION_TYPES.has(e.step?.action_type || ''))
                                      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
                                    const executedExecs = executions
                                      .filter(e => (e.status === 'executed' || e.status === 'sent') && e.executed_at && !HIDDEN_ACTION_TYPES.has(e.step?.action_type || ''))
                                      .sort((a, b) => new Date(b.executed_at!).getTime() - new Date(a.executed_at!).getTime());

                                    const nextScheduled = scheduledExecs[0];
                                    const lastExecuted = executedExecs[0];

                                    return (
                                      <>
                                        {lastExecuted && (
                                          <span className="text-xs text-success-foreground">
                                            ✓ {format(new Date(lastExecuted.executed_at!), 'dd/MM à HH:mm', { locale: fr })}
                                          </span>
                                        )}
                                        {nextScheduled && (
                                          <span className="text-xs text-info-foreground font-medium">
                                            → {(() => {
                                              const actionType = nextScheduled.step?.action_type || '';
                                              const label = actionTypeConfig[actionType]?.label || actionType;
                                              return label;
                                            })()} le {format(new Date(nextScheduled.scheduled_at), 'dd/MM à HH:mm', { locale: fr })}
                                          </span>
                                        )}
                                        {!nextScheduled && !lastExecuted && (
                                          <span className="text-xs text-muted-foreground">
                                            {executions.length} étape(s)
                                          </span>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </CollapsibleTrigger>

                            {/* Actions menu */}
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button 
                                  variant="outline" 
                                  size="icon"
                                  className="h-8 w-8 shrink-0 border-border rounded-lg"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="z-[3000] bg-background border-border rounded-lg">
                                {enrollment.status === 'active' ? (
                                  <DropdownMenuItem 
                                    onClick={() => stopEnrollment(enrollment.id)}
                                    className="text-warning-foreground"
                                  >
                                    <StopCircle className="w-4 h-4 mr-2" />
                                    Arrêter la séquence
                                  </DropdownMenuItem>
                                ) : enrollment.status === 'paused' ? (
                                  <DropdownMenuItem 
                                    onClick={() => resumeEnrollment(enrollment.id)}
                                    className="text-success-foreground"
                                  >
                                    <Play className="w-4 h-4 mr-2" />
                                    Reprendre la séquence
                                  </DropdownMenuItem>
                                ) : null}
                                {enrollment.profile_url && (
                                  <DropdownMenuItem asChild>
                                    <a
                                      href={enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="w-4 h-4 mr-2" />
                                      Voir sur LinkedIn
                                    </a>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {/* Expanded content - Full workflow timeline */}
                        <CollapsibleContent>
                          <div className="border-t border-border bg-muted p-3">
                            {allSteps.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-2">
                                Aucune étape dans la séquence
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                                  Workflow :
                                </p>
                                {allSteps.filter(s => !HIDDEN_ACTION_TYPES.has(s.action_type)).map((step, idx) => {
                                  // Find execution for this step if it exists
                                  const exec = executions.find(e => e.step_id === step.id);
                                  const actionConfig = actionTypeConfig[step.action_type] || { 
                                    label: step.action_type, 
                                    icon: <Send className="w-3.5 h-3.5" />,
                                    color: 'text-muted-foreground',
                                    bgColor: 'bg-muted'
                                  };
                                  
                                  // Determine status: from execution or 'pending' if no execution yet
                                  const status = exec?.status || 'pending';
                                  const execStatus = executionStatusConfig[status] || executionStatusConfig.pending;
                                  const isPending = status === 'pending';
                                  const isFailed = status === 'failed';
                                  const isSkipped = status === 'skipped';
                                  const isChannelSkip = isSkipped && exec?.skip_reason?.toLowerCase().includes('channel');

                                  return (
                                    <div 
                                      key={step.id}
                                      className={cn(
                                        "flex items-start gap-3 p-2.5 border transition-colors",
                                        isFailed && "bg-destructive/5 border-destructive/30",
                                        isChannelSkip && "bg-muted/50 border-border/5 opacity-60",
                                        isSkipped && !isChannelSkip && "bg-muted border-border",
                                        !isFailed && !isSkipped && execStatus.className
                                      )}
                                    >
                                      {/* Step number with icon */}
                                      <div className={cn(
                                        "flex-shrink-0 w-7 h-7 flex items-center justify-center",
                                        isPending ? 'bg-muted text-muted-foreground' : `${actionConfig.bgColor} text-white`
                                      )}>
                                        {actionConfig.icon}
                                      </div>

                                      {/* Step details */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={cn(
                                            "text-sm font-medium", 
                                            isPending ? 'text-muted-foreground' : 'text-foreground'
                                          )}>
                                            {actionConfig.label}
                                          </span>
                                          <Badge variant="outline" className={cn(
                                            "text-xs px-1.5 py-0 h-4",
                                            execStatus.className
                                          )}>
                                            {execStatus.icon}
                                            <span className="ml-0.5">{execStatus.label}</span>
                                          </Badge>
                                          {/* Show delay for pending steps */}
                                          {isPending && (step.delay_days > 0 || step.delay_hours > 0) && (
                                            <span className="text-xs text-muted-foreground">
                                              +{step.delay_days > 0 ? `${step.delay_days}j` : ''}{step.delay_hours > 0 ? `${step.delay_hours}h` : ''}
                                            </span>
                                          )}
                                        </div>


                                        {/* Timing info from execution */}
                                        {exec && (
                                          <div className="text-xs mt-1">
                                            {exec.status === 'scheduled' && (
                                              <span className="text-muted-foreground">
                                                Prévu : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}
                                              </span>
                                            )}
                                            {(exec.status === 'executed' || exec.status === 'sent') && exec.executed_at && (
                                              <span className="text-success-foreground">
                                                ✓ {format(new Date(exec.executed_at), 'dd/MM HH:mm', { locale: fr })}
                                              </span>
                                            )}
                                            {exec.status === 'skipped' && exec.skip_reason && (
                                              <span className={cn(
                                                "text-muted-foreground flex items-center gap-1",
                                                isChannelSkip && "italic"
                                              )}>
                                                {isChannelSkip && <span>⏭️</span>}
                                                {isChannelSkip 
                                                  ? `Étape ${step.step_order + 1} skippée — canal indisponible`
                                                  : exec.skip_reason
                                                }
                                              </span>
                                            )}
                                            {exec.status === 'cancelled' && exec.skip_reason && (
                                              <span className="text-muted-foreground">
                                                {exec.skip_reason}
                                              </span>
                                            )}
                                            {exec.status === 'failed' && exec.error_message && (
                                              <div className="text-destructive mt-1 p-2 bg-destructive/10 border border-destructive/20 text-xs">
                                                <strong>Erreur :</strong> {formatErrorMessage(exec.error_message)}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* Message preview if executed/sent */}
                                        {(exec?.status === 'executed' || exec?.status === 'sent') && exec.final_message && (
                                          <div className="mt-2 p-2 bg-background border border-border text-xs text-muted-foreground">
                                            {exec.final_subject && (
                                              <p className="font-medium text-foreground mb-1 pb-1 border-b text-xs">
                                                {exec.final_subject}
                                              </p>
                                            )}
                                            <p className="line-clamp-2 leading-relaxed">
                                              {exec.final_message.replace(/\\n/g, ' ').substring(0, 120)}...
                                            </p>
                                          </div>
                                        )}

                                        {/* Template preview for pending steps */}
                                        {isPending && step.message_template && (
                                          <div className="mt-1.5 text-xs text-muted-foreground/70 italic line-clamp-1">
                                            « {step.message_template.replace(/\\n/g, ' ').substring(0, 80)}... »
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
