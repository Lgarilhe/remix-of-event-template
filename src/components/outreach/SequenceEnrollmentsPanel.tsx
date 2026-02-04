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

const actionTypeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  send_inmail: { label: 'InMail', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-purple-600' },
  send_message: { label: 'Message', icon: <Send className="w-3.5 h-3.5" />, color: 'text-blue-600' },
  send_invitation: { label: 'Invitation', icon: <UserPlus className="w-3.5 h-3.5" />, color: 'text-green-600' },
  visit_profile: { label: 'Visite profil', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-gray-600' },
  smart_message: { label: 'Smart Message', icon: <MessageCircle className="w-3.5 h-3.5" />, color: 'text-indigo-600' },
  check_connection: { label: 'Check connexion', icon: <Users className="w-3.5 h-3.5" />, color: 'text-orange-600' },
  wait_for_event: { label: 'Attente', icon: <Timer className="w-3.5 h-3.5" />, color: 'text-amber-600' },
};

const executionStatusConfig: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  scheduled: { label: 'Planifié', icon: <Clock className="w-3 h-3" />, className: 'bg-blue-50 text-blue-600 border-blue-200' },
  executed: { label: 'Exécuté', icon: <CheckCircle2 className="w-3 h-3" />, className: 'bg-green-50 text-green-600 border-green-200' },
  skipped: { label: 'Ignoré', icon: <SkipForward className="w-3 h-3" />, className: 'bg-gray-50 text-gray-500 border-gray-200' },
  failed: { label: 'Échoué', icon: <AlertCircle className="w-3 h-3" />, className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled: { label: 'Annulé', icon: <XCircle className="w-3 h-3" />, className: 'bg-gray-50 text-gray-500 border-gray-200' },
};

export const SequenceEnrollmentsPanel: React.FC<SequenceEnrollmentsPanelProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
}) => {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEnrollments, setExpandedEnrollments] = useState<Set<string>>(new Set());
  const [steps, setSteps] = useState<Record<string, any>>({});

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      
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

      // Fetch sequence steps for action type info
      const { data: stepsData } = await supabase
        .from('sequence_steps')
        .select('id, action_type, message_template, subject_template, step_order')
        .eq('sequence_id', sequenceId);

      // Create steps lookup
      const stepsLookup: Record<string, any> = {};
      stepsData?.forEach(s => { stepsLookup[s.id] = s; });
      setSteps(stepsLookup);

      // Attach executions to enrollments
      const enriched = (enrollData || []).map(enrollment => ({
        ...enrollment,
        executions: (execData || [])
          .filter(e => e.enrollment_id === enrollment.id)
          .map(exec => ({
            ...exec,
            step: stepsLookup[exec.step_id],
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

  const activeCount = enrollments.filter(e => e.status === 'active').length;
  const pausedCount = enrollments.filter(e => e.status === 'paused').length;
  const completedCount = enrollments.filter(e => ['completed', 'replied'].includes(e.status)).length;

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

                        {/* Expanded content - Step executions timeline */}
                        <CollapsibleContent>
                          <div className="border-t border-gray-100 bg-gray-50 p-3">
                            {executions.length === 0 ? (
                              <p className="text-xs text-gray-500 text-center py-2">
                                Aucune étape planifiée
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-gray-600 mb-2">
                                  Timeline des actions :
                                </p>
                                {executions.map((exec, idx) => {
                                  const actionType = exec.step?.action_type || 'unknown';
                                  const actionConfig = actionTypeConfig[actionType] || { 
                                    label: actionType, 
                                    icon: <Send className="w-3.5 h-3.5" />,
                                    color: 'text-gray-600'
                                  };
                                  const execStatus = executionStatusConfig[exec.status] || executionStatusConfig.scheduled;

                                  return (
                                    <div 
                                      key={exec.id}
                                      className={cn(
                                        "flex items-start gap-3 p-2 rounded-lg border",
                                        execStatus.className
                                      )}
                                    >
                                      {/* Step number */}
                                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white border border-current flex items-center justify-center text-[10px] font-bold">
                                        {idx + 1}
                                      </div>

                                      {/* Step details */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className={cn("flex items-center gap-1 text-sm font-medium", actionConfig.color)}>
                                            {actionConfig.icon}
                                            {actionConfig.label}
                                          </span>
                                          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", execStatus.className)}>
                                            {execStatus.icon}
                                            <span className="ml-0.5">{execStatus.label}</span>
                                          </Badge>
                                        </div>

                                        {/* Timing info */}
                                        <div className="text-[10px] text-gray-500 mt-1">
                                          {exec.status === 'scheduled' && (
                                            <span>
                                              Prévu : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}
                                            </span>
                                          )}
                                          {exec.status === 'executed' && exec.executed_at && (
                                            <span>
                                              Exécuté : {format(new Date(exec.executed_at), 'dd/MM HH:mm', { locale: fr })}
                                            </span>
                                          )}
                                          {exec.status === 'skipped' && exec.skip_reason && (
                                            <span className="text-gray-400">
                                              Raison : {exec.skip_reason}
                                            </span>
                                          )}
                                          {exec.status === 'cancelled' && exec.skip_reason && (
                                            <span className="text-gray-400">
                                              {exec.skip_reason}
                                            </span>
                                          )}
                                          {exec.status === 'failed' && exec.error_message && (
                                            <span className="text-red-500">
                                              Erreur : {exec.error_message}
                                            </span>
                                          )}
                                        </div>

                                        {/* Message preview if executed */}
                                        {exec.status === 'executed' && exec.final_message && (
                                          <div className="mt-1.5 p-2 bg-white rounded border border-gray-100 text-[11px] text-gray-600 line-clamp-2">
                                            {exec.final_subject && (
                                              <p className="font-medium mb-0.5">📧 {exec.final_subject}</p>
                                            )}
                                            {exec.final_message}
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
