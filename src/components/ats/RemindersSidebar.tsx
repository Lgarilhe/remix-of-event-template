import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { 
  X, 
  Bell, 
  Clock, 
  CheckCircle2, 
  Loader2,
  Plus
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

interface Reminder {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  job_id: string | null;
  job_title: string | null;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
  created_at: string;
}

interface RemindersSidebarProps {
  onClose: () => void;
  onReminderClick: (candidateId: string) => void;
}

export const RemindersSidebar: React.FC<RemindersSidebarProps> = ({
  onClose,
  onReminderClick,
}) => {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const fetchReminders = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('candidate_reminders')
        .select('*')
        .order('due_at', { ascending: true });

      if (!showCompleted) {
        query = query.is('completed_at', null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setReminders(data || []);
    } catch (error) {
      console.error('Error fetching reminders:', error);
      toast.error('Erreur lors du chargement des rappels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
  }, [showCompleted]);

  const toggleComplete = async (reminder: Reminder) => {
    try {
      const newCompletedAt = reminder.completed_at ? null : new Date().toISOString();
      
      const { error } = await supabase
        .from('candidate_reminders')
        .update({ completed_at: newCompletedAt })
        .eq('id', reminder.id);

      if (error) throw error;

      setReminders(prev => prev.map(r => 
        r.id === reminder.id ? { ...r, completed_at: newCompletedAt } : r
      ));

      toast.success(newCompletedAt ? 'Rappel terminé' : 'Rappel réactivé');
    } catch (error) {
      console.error('Error updating reminder:', error);
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const getDueDateLabel = (dueAt: string) => {
    const date = parseISO(dueAt);
    
    if (isPast(date) && !isToday(date)) {
      return { label: 'En retard', className: 'bg-red-100 text-red-700' };
    }
    if (isToday(date)) {
      return { label: "Aujourd'hui", className: 'bg-amber-100 text-amber-700' };
    }
    if (isTomorrow(date)) {
      return { label: 'Demain', className: 'bg-blue-100 text-blue-700' };
    }
    return { 
      label: format(date, 'd MMM', { locale: fr }), 
      className: 'bg-gray-100 text-gray-700' 
    };
  };

  return (
    <div className="w-80 bg-white rounded-xl border border-[#1A1A1A]/10 flex-shrink-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#1A1A1A]/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-[#1A1A1A]">Rappels</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-[#1A1A1A]/10">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox 
            checked={showCompleted}
            onCheckedChange={(checked) => setShowCompleted(!!checked)}
          />
          <span className="text-sm text-[#1A1A1A]/70">Afficher terminés</span>
        </label>
      </div>

      {/* Reminders list */}
      <ScrollArea className="h-[500px]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[#1A1A1A]/40" />
          </div>
        ) : reminders.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Bell className="w-10 h-10 mx-auto text-[#1A1A1A]/20 mb-3" />
            <p className="text-sm text-[#1A1A1A]/50">
              {showCompleted ? 'Aucun rappel' : 'Aucun rappel en attente'}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {reminders.map(reminder => {
              const dueDateInfo = getDueDateLabel(reminder.due_at);
              const isCompleted = !!reminder.completed_at;
              
              return (
                <div
                  key={reminder.id}
                  className={`
                    p-3 rounded-lg border transition-all cursor-pointer
                    ${isCompleted 
                      ? 'bg-gray-50 border-gray-200 opacity-60' 
                      : 'bg-white border-[#1A1A1A]/10 hover:border-[#1A1A1A]/20'
                    }
                  `}
                  onClick={() => onReminderClick(reminder.candidate_id)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isCompleted}
                      onCheckedChange={() => toggleComplete(reminder)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                    />
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-medium text-sm ${isCompleted ? 'line-through text-[#1A1A1A]/50' : 'text-[#1A1A1A]'}`}>
                          {reminder.title}
                        </span>
                      </div>
                      
                      {reminder.candidate_name && (
                        <p className="text-xs text-[#1A1A1A]/60 mb-1">
                          {reminder.candidate_name}
                        </p>
                      )}
                      
                      {reminder.job_title && (
                        <p className="text-xs text-[#1A1A1A]/50 mb-2">
                          {reminder.job_title}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] px-1.5 py-0 ${dueDateInfo.className}`}>
                          <Clock className="w-2.5 h-2.5 mr-1" />
                          {dueDateInfo.label}
                        </Badge>
                        
                        {isCompleted && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600">
                            <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                            Terminé
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
