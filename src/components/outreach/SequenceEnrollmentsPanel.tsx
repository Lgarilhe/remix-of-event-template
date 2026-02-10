import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
    className: 'bg-blue-100 text-blue-700' 
  },
  paused: { 
    label: 'En pause', 
    icon: <StopCircle className="w-3 h-3" />, 
    className: 'bg-yellow-100 text-yellow-700' 
  },
  completed: { 
    label: 'Terminée', 
    icon: <CheckCircle className="w-3 h-3" />, 
    className: 'bg-green-100 text-green-700' 
  },
  replied: { 
    label: 'Répondu', 
    icon: <MessageCircle className="w-3 h-3" />, 
    className: 'bg-purple-100 text-purple-700' 
  },
  cancelled: { 
    label: 'Annulée', 
    icon: <XCircle className="w-3 h-3" />, 
    className: 'bg-gray-100 text-gray-600' 
  },
};

const actionTypeConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  // Standard action names
  send_inmail: { label: 'InMail', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  send_message: { label: 'Message', icon: <Send className="w-3.5 h-3.5" />, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  send_invitation: { label: 'Invitation', icon: <UserPlus className="w-3.5 h-3.5" />, color: 'text-green-600', bgColor: 'bg-green-100' },
  visit_profile: { label: 'Visite du profil', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  smart_message: { label: 'Message intelligent', icon: <MessageCircle className="w-3.5 h-3.5" />, color: 'text-indigo-600', bgColor: 'bg-indigo-100' },
  check_connection: { label: 'Vérification connexion', icon: <Users className="w-3.5 h-3.5" />, color: 'text-orange-600', bgColor: 'bg-orange-100' },
  wait_for_event: { label: 'Attente événement', icon: <Timer className="w-3.5 h-3.5" />, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  // Alternative action names (used in some steps)
  profile_visit: { label: 'Visite du profil', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  connection_request: { label: 'Demande de connexion', icon: <UserPlus className="w-3.5 h-3.5" />, color: 'text-green-600', bgColor: 'bg-green-100' },
  message: { label: 'Message', icon: <Send className="w-3.5 h-3.5" />, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  inmail: { label: 'InMail', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  wait_connection: { label: 'Attente connexion', icon: <Timer className="w-3.5 h-3.5" />, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  wait_reply: { label: 'Attente réponse', icon: <Timer className="w-3.5 h-3.5" />, color: 'text-amber-600', bgColor: 'bg-amber-100' },
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
  pending: { label: 'À venir', icon: <Clock className="w-3 h-3" />, className: 'bg-gray-50 text-gray-400 border-gray-200 border-dashed' },
  scheduled: { label: 'Planifié', icon: <Clock className="w-3 h-3" />, className: 'bg-blue-50 text-blue-600 border-blue-200' },
  executed: { label: 'Exécuté', icon: <CheckCircle2 className="w-3 h-3" />, className: 'bg-green-50 text-green-600 border-green-200' },
  sent: { label: 'Envoyé', icon: <CheckCircle2 className="w-3 h-3" />, className: 'bg-green-50 text-green-600 border-green-200' },
  skipped: { label: 'Ignoré', icon: <SkipForward className="w-3 h-3" />, className: 'bg-gray-50 text-gray-500 border-gray-200' },
  failed: { label: 'Échoué', icon: <AlertCircle className="w-3 h-3" />, className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled: { label: 'Annulé', icon: <XCircle className="w-3 h-3" />, className: 'bg-gray-50 text-gray-500 border-gray-200' },
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

      setEnrollments(prev => 
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'active' } : e)
      );
      toast.success('Séquence reprise');
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
      
      // Call all sequence processing actions
      const results = await Promise.all([
        supabase.functions.invoke('process-sequences', { body: { action: 'process' } }),
        supabase.functions.invoke('process-sequences', { body: { action: 'check_replies' } }),
        supabase.functions.invoke('process-sequences', { body: { action: 'check_wait_events' } }),
      ]);
      
      const processResult = results[0].data;
      
      if (processResult?.success) {
        const { processed = 0, failed = 0, skipped = 0, quota_blocked = 0 } = processResult.results || {};
        let message = `Traitement terminé: ${processed} action(s) exécutée(s)`;
        if (failed > 0) message += `, ${failed} échouée(s)`;
        if (skipped > 0) message += `, ${skipped} ignorée(s)`;
        if (quota_blocked > 0) message += `, ${quota_blocked} bloquée(s) (quota)`;
        
        toast.success(message);
        await fetchEnrollments();
      } else {
        toast.error('Erreur lors du traitement');
      }
    } catch (error) {
      console.error('Error processing sequences:', error);
      toast.error('Erreur lors du traitement des séquences');
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
      <SheetContent className="w-[500px] sm:max-w-[500px] bg-white">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            {sequenceName}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Process now button - always show if there are pending tasks */}
          {pendingExecutions.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {pendingExecutions.length} action(s) en attente
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={processSequencesNow}
                  disabled={processingSequences}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {processingSequences ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  Traiter maintenant
                </Button>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-3">
            <div className="flex-1 p-3 rounded-lg bg-blue-50 text-center">
              <div className="text-xl font-bold text-blue-700">{activeCount}</div>
              <div className="text-xs text-blue-600">Actifs</div>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-yellow-50 text-center">
              <div className="text-xl font-bold text-yellow-700">{pausedCount}</div>
              <div className="text-xs text-yellow-600">En pause</div>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-green-50 text-center">
              <div className="text-xl font-bold text-green-700">{completedCount}</div>
              <div className="text-xs text-green-600">Terminés</div>
            </div>
          </div>

          {/* Bulk actions */}
          {activeCount > 0 && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={bulkStopActive}
              className="w-full text-orange-600 border-orange-200 hover:bg-orange-50"
            >
              <StopCircle className="w-4 h-4 mr-2" />
              Arrêter toutes les séquences actives ({activeCount})
            </Button>
          )}

          {/* Enrollments list */}
          <ScrollArea className="h-[calc(100vh-300px)]">
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-8 text-gray-500">Chargement...</div>
              ) : enrollments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  Aucun candidat inscrit
                </div>
              ) : (
                enrollments.map((enrollment) => {
                  const status = statusConfig[enrollment.status] || statusConfig.active;
                  const isExpanded = expandedEnrollments.has(enrollment.id);
                  const executions = enrollment.executions || [];
                  
                  return (
                    <Collapsible
                      key={enrollment.id}
                      open={isExpanded}
                      onOpenChange={() => toggleExpanded(enrollment.id)}
                    >
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Header - always visible */}
                        <div className="p-3 bg-white hover:bg-gray-50 group">
                          <div className="flex items-start justify-between gap-3">
                            <CollapsibleTrigger className="flex items-start gap-2 flex-1 min-w-0 text-left">
                              <div className="mt-0.5">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-gray-400" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900 truncate">
                                    {enrollment.profile_name || 'Candidat'}
                                  </span>
                                  {enrollment.profile_url && (
                                    <a
                                      href={enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gray-400 hover:text-[#0077B5]"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                                {enrollment.profile_headline && (
                                  <p className="text-xs text-gray-500 truncate mt-0.5">
                                    {enrollment.profile_headline}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1.5">
                                  <Badge className={`text-[10px] ${status.className}`}>
                                    {status.icon}
                                    <span className="ml-1">{status.label}</span>
                                  </Badge>
                                  <span className="text-[10px] text-gray-400">
                                    {executions.length} étape(s)
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    · {formatDistanceToNow(new Date(enrollment.created_at), { 
                                      addSuffix: true, 
                                      locale: fr 
                                    })}
                                  </span>
                                </div>
                              </div>
                            </CollapsibleTrigger>

                            {/* Actions menu */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-8 w-8 opacity-0 group-hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-white">
                                {enrollment.status === 'active' ? (
                                  <DropdownMenuItem 
                                    onClick={() => stopEnrollment(enrollment.id)}
                                    className="text-orange-600"
                                  >
                                    <StopCircle className="w-4 h-4 mr-2" />
                                    Arrêter la séquence
                                  </DropdownMenuItem>
                                ) : enrollment.status === 'paused' ? (
                                  <DropdownMenuItem 
                                    onClick={() => resumeEnrollment(enrollment.id)}
                                    className="text-green-600"
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
                          <div className="border-t border-gray-100 bg-gray-50 p-3">
                            {allSteps.length === 0 ? (
                              <p className="text-xs text-gray-500 text-center py-2">
                                Aucune étape dans la séquence
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-gray-600 mb-2">
                                  Workflow complet ({allSteps.length} étapes) :
                                </p>
                                {allSteps.map((step, idx) => {
                                  // Find execution for this step if it exists
                                  const exec = executions.find(e => e.step_id === step.id);
                                  const actionConfig = actionTypeConfig[step.action_type] || { 
                                    label: step.action_type, 
                                    icon: <Send className="w-3.5 h-3.5" />,
                                    color: 'text-gray-600',
                                    bgColor: 'bg-gray-100'
                                  };
                                  
                                  // Determine status: from execution or 'pending' if no execution yet
                                  const status = exec?.status || 'pending';
                                  const execStatus = executionStatusConfig[status] || executionStatusConfig.pending;
                                  const isPending = status === 'pending';
                                  const isFailed = status === 'failed';
                                  const isSkipped = status === 'skipped';

                                  return (
                                    <div 
                                      key={step.id}
                                      className={cn(
                                        "flex items-start gap-3 p-2.5 rounded-lg border transition-colors",
                                        isFailed && "bg-red-50/70 border-red-200",
                                        isSkipped && "bg-gray-50/70 border-gray-200",
                                        !isFailed && !isSkipped && execStatus.className
                                      )}
                                    >
                                      {/* Step number with icon */}
                                      <div className={cn(
                                        "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center",
                                        isPending ? 'bg-gray-100 text-gray-400' : actionConfig.bgColor,
                                        !isPending && actionConfig.color
                                      )}>
                                        {actionConfig.icon}
                                      </div>

                                      {/* Step details */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={cn(
                                            "text-sm font-medium", 
                                            isPending ? 'text-gray-400' : 'text-foreground'
                                          )}>
                                            {actionConfig.label}
                                          </span>
                                          <Badge variant="outline" className={cn(
                                            "text-[9px] px-1.5 py-0 h-4",
                                            execStatus.className
                                          )}>
                                            {execStatus.icon}
                                            <span className="ml-0.5">{execStatus.label}</span>
                                          </Badge>
                                          {/* Show delay for pending steps */}
                                          {isPending && (step.delay_days > 0 || step.delay_hours > 0) && (
                                            <span className="text-[10px] text-muted-foreground">
                                              +{step.delay_days > 0 ? `${step.delay_days}j` : ''}{step.delay_hours > 0 ? `${step.delay_hours}h` : ''}
                                            </span>
                                          )}
                                        </div>

                                        {/* Contextual info for wait/check steps */}
                                        {(step.action_type === 'wait_connection' || step.action_type === 'wait_reply') && (
                                          <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1 border border-amber-200">
                                            {step.timeout_days ? (
                                              <>
                                                <span className="font-medium">⏳ Timeout : {step.timeout_days} jour{step.timeout_days > 1 ? 's' : ''}</span>
                                                {step.timeout_branch_step_id && (() => {
                                                  const timeoutStep = allSteps.find(s => s.id === step.timeout_branch_step_id);
                                                  const timeoutLabel = timeoutStep ? (actionTypeConfig[timeoutStep.action_type]?.label || timeoutStep.action_type) : '?';
                                                  return <span> → si non accepté : <strong>{timeoutLabel}</strong> (étape {timeoutStep?.step_order})</span>;
                                                })()}
                                                {!step.timeout_branch_step_id && <span> → si non accepté : fin de séquence</span>}
                                              </>
                                            ) : (
                                              <span>⏳ Attente indéfinie (pas de timeout configuré)</span>
                                            )}
                                            {exec?.status === 'scheduled' && step.timeout_days && (
                                              <div className="mt-0.5 text-amber-600">
                                                Expire le {format(
                                                  new Date(new Date(exec.scheduled_at).getTime() + (step.timeout_days * 24 * 60 * 60 * 1000)),
                                                  'dd/MM/yyyy à HH:mm',
                                                  { locale: fr }
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {step.action_type === 'check_connection' && (
                                          <div className="mt-1 text-[10px] text-indigo-700 bg-indigo-50 rounded px-2 py-1 border border-indigo-200">
                                            <span className="font-medium">🔀 Branchement :</span>
                                            {step.if_true_goto_step && (() => {
                                              const trueStep = allSteps.find(s => s.id === step.if_true_goto_step);
                                              const trueLabel = trueStep ? (actionTypeConfig[trueStep.action_type]?.label || trueStep.action_type) : '?';
                                              return <span> Si connecté → <strong>{trueLabel}</strong> (ét. {trueStep?.step_order})</span>;
                                            })()}
                                            {step.if_false_goto_step && (() => {
                                              const falseStep = allSteps.find(s => s.id === step.if_false_goto_step);
                                              const falseLabel = falseStep ? (actionTypeConfig[falseStep.action_type]?.label || falseStep.action_type) : '?';
                                              return <span> · Si non connecté → <strong>{falseLabel}</strong> (ét. {falseStep?.step_order})</span>;
                                            })()}
                                          </div>
                                        )}

                                        {/* Timing info from execution */}
                                        {exec && (
                                          <div className="text-[11px] mt-1">
                                            {exec.status === 'scheduled' && (
                                              <span className="text-muted-foreground">
                                                Prévu : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}
                                              </span>
                                            )}
                                            {(exec.status === 'executed' || exec.status === 'sent') && exec.executed_at && (
                                              <span className="text-green-600">
                                                ✓ {format(new Date(exec.executed_at), 'dd/MM HH:mm', { locale: fr })}
                                              </span>
                                            )}
                                            {exec.status === 'skipped' && exec.skip_reason && (
                                              <span className="text-gray-500">
                                                {exec.skip_reason}
                                              </span>
                                            )}
                                            {exec.status === 'cancelled' && exec.skip_reason && (
                                              <span className="text-gray-500">
                                                {exec.skip_reason}
                                              </span>
                                            )}
                                            {exec.status === 'failed' && exec.error_message && (
                                              <div className="text-red-600 mt-1 p-2 bg-red-100/50 rounded text-[10px]">
                                                <strong>Erreur :</strong> {formatErrorMessage(exec.error_message)}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* Message preview if executed/sent */}
                                        {(exec?.status === 'executed' || exec?.status === 'sent') && exec.final_message && (
                                          <div className="mt-2 p-2 bg-white rounded-lg border text-[11px] text-muted-foreground">
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
                                          <div className="mt-1.5 text-[10px] text-muted-foreground/70 italic line-clamp-1">
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
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
};
