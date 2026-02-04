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
  Users, 
  ExternalLink, 
  MoreHorizontal, 
  StopCircle, 
  Play,
  CheckCircle,
  MessageCircle,
  Clock,
  XCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

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

export const SequenceEnrollmentsPanel: React.FC<SequenceEnrollmentsPanelProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
}) => {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEnrollments(data || []);
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
                  
                  return (
                    <div 
                      key={enrollment.id}
                      className="p-3 border border-gray-100 rounded-lg hover:bg-gray-50 group"
                    >
                      <div className="flex items-start justify-between gap-3">
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
                              Étape {enrollment.current_step_order + 1}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              · {formatDistanceToNow(new Date(enrollment.created_at), { 
                                addSuffix: true, 
                                locale: fr 
                              })}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100"
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
